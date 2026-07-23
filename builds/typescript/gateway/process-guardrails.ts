import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { ModelAdapter } from "../adapters/base.js";
import type {
  ApprovalMode,
  AuthContext,
  GatewayEngineRequest,
  StreamEvent,
  ToolDefinition,
  ToolExecutionResult,
} from "../contracts.js";
import { ApprovalStore } from "../engine/approval-store.js";
import { runAgentLoop, type ToolExecutionGuard } from "../engine/loop.js";
import {
  validateProcessGuardrailArtifact,
  type ProcessGuardrailPrerequisite,
} from "../engine/process-guardrails/artifact-validator.js";
import { buildProcessGuardrailStageContext } from "../engine/process-guardrails/context.js";
import {
  type ProcessGuardrailArtifactInspector,
  type ProcessGuardrailControllerPrerequisite,
  type ProcessGuardrailOwnerOverride,
  type ProcessGuardrailStageResult,
  type ProcessGuardrailStageRuntime,
} from "../engine/process-guardrails/controller.js";
import { processGuardrailControlTools } from "../engine/process-guardrails/control-tools.js";
import { GuardedProcessToolExecutor } from "../engine/process-guardrails/guarded-tool-executor.js";
import { loadProcessGuardrailInstructions } from "../engine/process-guardrails/instruction-loader.js";
import {
  PROCESS_GUARDRAIL_PROCESS_KIND,
  type ProcessGuardrailArtifactReference,
  type ProcessGuardrailStage,
} from "../engine/process-guardrails/state-machine.js";
import type { ToolExecutorLike } from "../engine/tool-executor.js";
import { resolveMemoryPath } from "../memory/paths.js";
import type { PromptAuditRecorder } from "../memory/prompt-audit-store.js";

const PROCESS_CONTROL_NAMES = new Set([
  "process_start",
  "process_stage_outcome",
  "process_owner_override",
]);

export class ProcessStartToolExecutor implements ToolExecutorLike {
  private readonly startTool = processGuardrailControlTools().find(
    (tool) => tool.name === "process_start"
  )!;

  constructor(private readonly base: ToolExecutorLike) {}

  listTools(auth: AuthContext): ToolDefinition[] {
    return [...this.base.listTools(auth), this.startTool];
  }

  getTool(name: string): ToolDefinition | undefined {
    return name === this.startTool.name
      ? this.startTool
      : this.base.getTool(name);
  }

  async preflight(
    auth: AuthContext,
    context: Parameters<NonNullable<ToolExecutorLike["preflight"]>>[1],
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolExecutionResult | null> {
    if (name === this.startTool.name) {
      return null;
    }
    return this.base.preflight?.(auth, context, name, input) ?? null;
  }

  async execute(
    auth: AuthContext,
    context: Parameters<ToolExecutorLike["execute"]>[1],
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    if (name !== this.startTool.name) {
      return this.base.execute(auth, context, name, input);
    }
    try {
      return {
        status: "ok",
        output: await this.startTool.execute(context, input),
      };
    } catch {
      return {
        status: "error",
        output: {
          code: "invalid_process_control",
          message: "Invalid guarded process control input",
        },
        recoverable: true,
      };
    }
  }
}

export class ProcessOwnerOverrideToolExecutor implements ToolExecutorLike {
  private readonly overrideTool = processGuardrailControlTools().find(
    (tool) => tool.name === "process_owner_override"
  )!;

  listTools(): ToolDefinition[] {
    return [this.overrideTool];
  }

  getTool(name: string): ToolDefinition | undefined {
    return name === this.overrideTool.name ? this.overrideTool : undefined;
  }

  async execute(
    _auth: AuthContext,
    context: Parameters<ToolExecutorLike["execute"]>[1],
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    if (name !== this.overrideTool.name) {
      return {
        status: "error",
        output: {
          code: "tool_not_available",
          message: "Only process_owner_override is available for this turn",
        },
        recoverable: true,
      };
    }
    try {
      return {
        status: "ok",
        output: await this.overrideTool.execute(context, input),
      };
    } catch {
      return {
        status: "error",
        output: {
          code: "invalid_process_control",
          message: "Invalid guarded process control input",
        },
        recoverable: true,
      };
    }
  }
}

export type ProcessGuardrailStageRuntimeOptions = {
  memoryRoot: string;
  pageId: string;
  conversationId: string;
  correlationId: string;
  safetyContext: string;
  tokenBudget: number;
  modelAdapter: ModelAdapter;
  baseToolExecutor: ToolExecutorLike;
  approvalStore: ApprovalStore;
  auth: AuthContext;
  approvalMode: ApprovalMode;
  safetyIterationLimit?: number;
  toolExecutionGuard?: ToolExecutionGuard;
  promptAudit?: {
    recorder: PromptAuditRecorder;
    adapterName: string;
    providerProfile?: string;
    model?: string;
  };
  onEvent(event: StreamEvent): Promise<void> | void;
};

export class GatewayProcessGuardrailStageRuntime
implements ProcessGuardrailStageRuntime {
  deferredError: Extract<StreamEvent, { type: "error" }> | null = null;
  private readonly prerequisites = new Map<
    ProcessGuardrailStage,
    ProcessGuardrailControllerPrerequisite[]
  >();

  constructor(private readonly options: ProcessGuardrailStageRuntimeOptions) {}

  async prepare(input: Parameters<ProcessGuardrailStageRuntime["prepare"]>[0]) {
    const instructions = await loadProcessGuardrailInstructions({
      memoryRoot: this.options.memoryRoot,
      pageId: this.options.pageId,
      stage: input.stage,
    });
    const prerequisites = await buildPrerequisiteContext(
      this.options.memoryRoot,
      input.prerequisites
    );
    const context = buildProcessGuardrailStageContext({
      stage: input.stage,
      safetyContext: this.options.safetyContext,
      ownerDirection: input.ownerDirection,
      instructions,
      prerequisites,
      structuralFeedbackCodes: input.structuralFeedbackCodes,
      tokenBudget: this.options.tokenBudget,
    });
    this.prerequisites.set(input.stage, input.prerequisites);

    return {
      request: {
        messages: context.messages,
        metadata: {
          correlation_id: this.options.correlationId,
          conversation_id: this.options.conversationId,
          trigger: `process_guardrail:${input.stage}`,
        },
      },
      instructionRefs: context.manifest.instruction_refs,
    };
  }

  async invoke(
    input: Parameters<ProcessGuardrailStageRuntime["invoke"]>[0]
  ): Promise<ProcessGuardrailStageResult> {
    this.deferredError = null;
    const startedAt = Date.now();
    const stage = input.identity.stage;
    const prerequisiteStates = this.prerequisites.get(stage) ?? [];
    const guardedExecutor = new ActiveProcessToolExecutor(
      new GuardedProcessToolExecutor(
        this.options.baseToolExecutor,
        {
          pageId: this.options.pageId,
          stage,
          prerequisites: prerequisiteStates.map(toValidatorPrerequisite),
          journalEligibility: stage === "journal_handoff"
            ? "eligible"
            : "not_applicable",
        }
      )
    );
    const controlCalls = new Map<string, string>();
    const stageToolCalls = new Map<string, string>();
    const artifactRefs: ProcessGuardrailArtifactReference[] = [];
    const validationCodes = new Set<string>();
    let artifactFailure: Extract<
      ProcessGuardrailStageResult,
      { type: "failure" }
    > | null = null;
    let lastToolCallId: string | undefined;

    for await (const event of runAgentLoop(
      this.options.modelAdapter,
      guardedExecutor,
      this.options.approvalStore,
      input.request,
      this.options.auth,
      {
        memoryRoot: this.options.memoryRoot,
        approvalMode: this.options.approvalMode,
        safetyIterationLimit: this.options.safetyIterationLimit,
        toolExecutionGuard: this.options.toolExecutionGuard,
        ...(this.options.promptAudit
          ? { promptAudit: this.options.promptAudit }
          : {}),
      }
    )) {
      if (event.type === "tool-call" && isProcessControlName(event.name)) {
        controlCalls.set(event.id, event.name);
        continue;
      }
      if (event.type === "tool-call") {
        stageToolCalls.set(event.id, event.name);
      }

      if (event.type === "tool-result" && controlCalls.has(event.id)) {
        lastToolCallId = event.id;
        const control = parseProcessControlResult(event.output);
        if (!control || event.status !== "ok") {
          return withDiagnostics(
            {
              type: "needs_owner_action",
              code: "invalid_process_control",
            },
            startedAt,
            lastToolCallId
          );
        }
        if (control.control === "process_owner_override") {
          return withDiagnostics(
            {
              type: "owner_override",
              override: control.value,
            },
            startedAt,
            lastToolCallId
          );
        }
        if (control.control === "process_stage_outcome") {
          return withDiagnostics(
            artifactFailure ?? resultForStageOutcome(
                stage,
                control.value,
                artifactRefs,
                [...validationCodes]
              ),
            startedAt,
            lastToolCallId
          );
        }
        continue;
      }

      if (event.type === "tool-result") {
        lastToolCallId = event.id;
        collectArtifactReference(event, artifactRefs);
        collectValidationCodes(event, validationCodes);
        artifactFailure ??= classifyArtifactFailure(
          stageToolCalls.get(event.id),
          event
        );
        await this.options.onEvent(event);
        if (event.status === "denied") {
          return withDiagnostics(
            { type: "failure", category: "approval_denied" },
            startedAt,
            lastToolCallId
          );
        }
        continue;
      }

      if (event.type === "error") {
        this.deferredError = event;
        return withDiagnostics(
          event.code === "context_overflow"
            ? { type: "failure", category: "context_too_large" }
            : event.code === "tool_error"
              ? { type: "failure", category: "artifact_write_failed" }
              : { type: "failure", category: "provider_unavailable" },
          startedAt,
          lastToolCallId
        );
      }

      if (event.type === "done") {
        break;
      }
      await this.options.onEvent(event);
    }

    if (validationCodes.size > 0) {
      return withDiagnostics(
        {
          type: "candidate",
          validation: { ok: false, codes: [...validationCodes] },
          artifactRefs,
          next: "wait_for_owner",
        },
        startedAt,
        lastToolCallId
      );
    }
    if (artifactFailure) {
      return withDiagnostics(artifactFailure, startedAt, lastToolCallId);
    }
    return withDiagnostics(
      { type: "waiting_for_owner" },
      startedAt,
      lastToolCallId
    );
  }
}

class ActiveProcessToolExecutor implements ToolExecutorLike {
  constructor(private readonly guarded: ToolExecutorLike) {}

  listTools(auth: AuthContext): ToolDefinition[] {
    return this.guarded
      .listTools(auth)
      .filter((tool) => tool.name !== "process_start");
  }

  getTool(name: string): ToolDefinition | undefined {
    return name === "process_start"
      ? undefined
      : this.guarded.getTool(name);
  }

  preflight(
    auth: AuthContext,
    context: Parameters<NonNullable<ToolExecutorLike["preflight"]>>[1],
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolExecutionResult | null> {
    if (name === "process_start") {
      return Promise.resolve({
        status: "error",
        output: {
          code: "invalid_process_control",
          message: "Process already started",
        },
        recoverable: true,
      });
    }
    return this.guarded.preflight?.(auth, context, name, input) ??
      Promise.resolve(null);
  }

  execute(
    auth: AuthContext,
    context: Parameters<ToolExecutorLike["execute"]>[1],
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    if (name === "process_start") {
      return Promise.resolve({
        status: "error",
        output: {
          code: "invalid_process_control",
          message: "Process already started",
        },
        recoverable: true,
      });
    }
    return this.guarded.execute(auth, context, name, input);
  }
}

export function createProcessGuardrailArtifactInspector(
  memoryRoot: string,
  pageId: string
): ProcessGuardrailArtifactInspector {
  return {
    inspect: async ({ stage, reference }) => {
      let content: string;
      try {
        content = await readFile(resolveMemoryPath(memoryRoot, reference.path), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { status: "missing", code: "artifact_missing" };
        }
        throw error;
      }
      const nextDigest = digest(content);
      if (nextDigest === reference.digest) {
        return { status: "unchanged" };
      }
      const validation = validateProcessGuardrailArtifact({
        pageId,
        stage,
        toolName: "memory_edit",
        targetPath: reference.path,
        candidateContent: content,
        originalContent: content,
        prerequisites: prerequisiteForPersistedStage(stage),
        journalEligibility: stage === "journal_handoff"
          ? "eligible"
          : "not_applicable",
      });
      return validation.ok
        ? {
            status: "changed_valid",
            reference: {
              ...reference,
              digest: nextDigest,
              accepted_at: new Date().toISOString(),
            },
          }
        : {
            status: "changed_invalid",
            code: validation.codes[0] ?? "artifact_invalid",
          };
    },
  };
}

function prerequisiteForPersistedStage(
  stage: ProcessGuardrailStage
): ProcessGuardrailPrerequisite[] {
  if (stage === "interview") {
    return [];
  }
  return [{
    kind: stage === "specification"
      ? "interview"
      : stage === "plan"
        ? "specification"
        : "plan",
    status: "accepted",
  }];
}

export function isProcessControlName(name: string): boolean {
  return PROCESS_CONTROL_NAMES.has(name);
}

export function parseProcessControlResult(output: unknown):
  | {
      control: "process_start";
      value: { process_kind: typeof PROCESS_GUARDRAIL_PROCESS_KIND };
    }
  | {
      control: "process_stage_outcome";
      value: {
        stage: ProcessGuardrailStage;
        outcome:
          | "candidate_ready"
          | "needs_owner_action"
          | "handoff_complete_no_entry";
      };
    }
  | {
      control: "process_owner_override";
      value: Exclude<ProcessGuardrailOwnerOverride, { category: "ambiguous" }>;
    }
  | null {
  if (!isRecord(output) || output.accepted !== true || typeof output.control !== "string") {
    return null;
  }
  if (output.control === "process_start" && isRecord(output.value) &&
      output.value.process_kind === PROCESS_GUARDRAIL_PROCESS_KIND) {
    return {
      control: "process_start",
      value: { process_kind: PROCESS_GUARDRAIL_PROCESS_KIND },
    };
  }
  if (output.control === "process_stage_outcome" && isRecord(output.value) &&
      isProcessStage(output.value.stage) &&
      ["candidate_ready", "needs_owner_action", "handoff_complete_no_entry"]
        .includes(String(output.value.outcome))) {
    return {
      control: "process_stage_outcome",
      value: {
        stage: output.value.stage,
        outcome: output.value.outcome as
          | "candidate_ready"
          | "needs_owner_action"
          | "handoff_complete_no_entry",
      },
    };
  }
  if (output.control === "process_owner_override" && isRecord(output.value) &&
      ["skip", "reorder", "redo", "stop", "resume"].includes(String(output.value.category)) &&
      (output.value.target_stage === undefined || isProcessStage(output.value.target_stage))) {
    return {
      control: "process_owner_override",
      value: {
        category: output.value.category as
          | "skip"
          | "reorder"
          | "redo"
          | "stop"
          | "resume",
        ...(output.value.target_stage
          ? { targetStage: output.value.target_stage }
          : {}),
      },
    };
  }
  return null;
}

async function buildPrerequisiteContext(
  memoryRoot: string,
  prerequisites: ProcessGuardrailControllerPrerequisite[]
): Promise<PrerequisiteContextInput[]> {
  const result: PrerequisiteContextInput[] = [];
  for (const prerequisite of prerequisites) {
    if (prerequisite.status === "absent_by_owner_choice") {
      result.push({
        kind: prerequisite.kind,
        status: "absent_by_owner_choice",
      });
      continue;
    }
    for (const reference of prerequisite.artifactRefs) {
      let content: string;
      try {
        content = await readFile(resolveMemoryPath(memoryRoot, reference.path), "utf8");
      } catch {
        throw codedError("context_prerequisite_missing");
      }
      if (digest(content) !== reference.digest) {
        throw codedError("context_mismatch");
      }
      result.push({
        kind: prerequisite.kind,
        status: "accepted",
        path: reference.path,
        digest: reference.digest,
        content,
      });
    }
    if (prerequisite.artifactRefs.length === 0) {
      result.push({
        kind: prerequisite.kind,
        status: "accepted",
      });
    }
  }
  return result;
}

type PrerequisiteContextInput =
  | {
      kind: ProcessGuardrailStage;
      status: "accepted";
      path: string;
      digest: string;
      content: string;
    }
  | {
      kind: ProcessGuardrailStage;
      status: "accepted";
    }
  | {
      kind: ProcessGuardrailStage;
      status: "absent_by_owner_choice";
    };

function resultForStageOutcome(
  stage: ProcessGuardrailStage,
  control: {
    stage: ProcessGuardrailStage;
    outcome:
      | "candidate_ready"
      | "needs_owner_action"
      | "handoff_complete_no_entry";
  },
  artifactRefs: ProcessGuardrailArtifactReference[],
  validationCodes: string[]
): ProcessGuardrailStageResult {
  if (control.stage !== stage) {
    return {
      type: "candidate",
      validation: { ok: false, codes: ["stage_outcome_mismatch"] },
      artifactRefs,
      next: "wait_for_owner",
    };
  }
  if (control.outcome === "needs_owner_action") {
    return { type: "needs_owner_action", code: "stage_needs_owner_action" };
  }
  if (control.outcome === "handoff_complete_no_entry") {
    return stage === "journal_handoff"
      ? { type: "handoff_complete_no_entry" }
      : {
          type: "candidate",
          validation: { ok: false, codes: ["stage_outcome_mismatch"] },
          artifactRefs,
          next: "wait_for_owner",
        };
  }
  const artifactRequired = stage !== "interview" && artifactRefs.length === 0;
  const codes = artifactRequired
    ? [...validationCodes, "artifact_required"]
    : validationCodes;
  return {
    type: "candidate",
    validation: { ok: codes.length === 0, codes },
    artifactRefs,
    next: "wait_for_owner",
  };
}

function collectArtifactReference(
  event: Extract<StreamEvent, { type: "tool-result" }>,
  artifactRefs: ProcessGuardrailArtifactReference[]
): void {
  if (event.status !== "ok" || !isRecord(event.output) ||
      typeof event.output.artifact_path !== "string" ||
      typeof event.output.artifact_digest !== "string") {
    return;
  }
  artifactRefs.push({
    path: event.output.artifact_path,
    digest: event.output.artifact_digest,
    accepted_at: new Date().toISOString(),
  });
}

function collectValidationCodes(
  event: Extract<StreamEvent, { type: "tool-result" }>,
  codes: Set<string>
): void {
  if (event.status !== "error" || !isRecord(event.output) ||
      !Array.isArray(event.output.validator_codes)) {
    return;
  }
  for (const code of event.output.validator_codes) {
    if (typeof code === "string") {
      codes.add(code);
    }
  }
}

function classifyArtifactFailure(
  toolName: string | undefined,
  event: Extract<StreamEvent, { type: "tool-result" }>
): Extract<ProcessGuardrailStageResult, { type: "failure" }> | null {
  if (
    event.status !== "error" ||
    !["memory_write", "memory_edit", "memory_delete"].includes(toolName ?? "") ||
    !isRecord(event.output)
  ) {
    return null;
  }
  const code = typeof event.output.code === "string"
    ? event.output.code
    : "artifact_write_failed";
  if (code === "guardrail_validation_failed") {
    return null;
  }
  if (code === "owner_edit_conflict") {
    return { type: "failure", category: "artifact_conflict", code };
  }
  if (
    code === "ambiguous_not_applied" ||
    code === "tool_result_inconsistent"
  ) {
    return { type: "failure", category: "artifact_write_ambiguous", code };
  }
  return { type: "failure", category: "artifact_write_failed", code };
}

function toValidatorPrerequisite(
  prerequisite: ProcessGuardrailControllerPrerequisite
): ProcessGuardrailPrerequisite {
  return {
    kind: prerequisite.kind,
    status: prerequisite.status,
  };
}

function withDiagnostics<T extends ProcessGuardrailStageResult>(
  result: T,
  startedAt: number,
  toolCallId?: string
): T {
  return {
    ...result,
    diagnostics: {
      ...(toolCallId ? { toolCallId } : {}),
      durationMs: Date.now() - startedAt,
    },
  };
}

function isProcessStage(value: unknown): value is ProcessGuardrailStage {
  return [
    "interview",
    "specification",
    "plan",
    "journal_handoff",
  ].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
