import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type {
  AuthContext,
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "../../contracts.js";
import { auditLog } from "../../logger.js";
import { resolveMemoryPath, toMemoryRelativePath } from "../../memory/paths.js";
import type { ToolExecutorLike } from "../tool-executor.js";
import {
  validateProcessGuardrailArtifact,
  type ProcessGuardrailArtifactValidationInput,
  type ProcessGuardrailPrerequisite,
} from "./artifact-validator.js";
import { processGuardrailControlTools } from "./control-tools.js";
import { stageDefinitionFor } from "./process-definition.js";
import type { ProcessGuardrailStage } from "./state-machine.js";

type PreparedMutation = {
  validationInput: ProcessGuardrailArtifactValidationInput;
  originalDigest: string | null;
  candidateDigest: string;
  canonicalInput: Record<string, unknown>;
};

export type GuardedProcessToolExecutorOptions = {
  pageId: string;
  stage: ProcessGuardrailStage;
  prerequisites: ProcessGuardrailPrerequisite[];
  journalEligibility: "eligible" | "ineligible" | "not_applicable";
  approve?: (input: {
    toolName: string;
    path: string;
  }) => Promise<"approved" | "denied">;
};

export class GuardedProcessToolExecutor implements ToolExecutorLike {
  private readonly controls = new Map(
    processGuardrailControlTools().map((tool) => [tool.name, tool])
  );
  private readonly prepared = new Map<string, PreparedMutation>();

  constructor(
    private readonly base: ToolExecutorLike,
    private readonly options: GuardedProcessToolExecutorOptions
  ) {}

  listTools(auth: AuthContext): ToolDefinition[] {
    return [
      ...this.base.listTools(auth).filter((tool) => isGuardedBaseTool(tool.name)),
      ...this.controls.values(),
    ];
  }

  getTool(name: string): ToolDefinition | undefined {
    if (this.controls.has(name)) {
      return this.controls.get(name);
    }
    return isGuardedBaseTool(name) ? this.base.getTool(name) : undefined;
  }

  async preflight(
    _auth: AuthContext,
    context: ToolContext,
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolExecutionResult | null> {
    if (name === "memory_read") {
      return this.validateRead(context, input);
    }
    if (!isMutation(name)) {
      return null;
    }
    const prepared = await this.prepareMutation(context, name, input);
    if ("status" in prepared) {
      return prepared;
    }
    this.prepared.set(cacheKey(context, name, input), prepared);
    return null;
  }

  async execute(
    auth: AuthContext,
    context: ToolContext,
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    const control = this.controls.get(name);
    if (control) {
      try {
        return { status: "ok", output: await control.execute(context, input) };
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
    if (name === "memory_read") {
      const denied = this.validateRead(context, input);
      return denied ?? this.base.execute(auth, context, name, input);
    }
    if (!isGuardedBaseTool(name)) {
      return failure("guardrail_tool_forbidden");
    }
    if (!isMutation(name)) {
      return this.base.execute(auth, context, name, input);
    }

    const key = cacheKey(context, name, input);
    let prepared = this.prepared.get(key);
    const cameFromLoopPreflight = prepared !== undefined;
    this.prepared.delete(key);
    if (!prepared) {
      const result = await this.prepareMutation(context, name, input);
      if ("status" in result) {
        return result;
      }
      prepared = result;
    }

    if (!cameFromLoopPreflight && this.getTool(name)?.requiresApproval) {
      const decision = await this.options.approve?.({
        toolName: name,
        path: prepared.validationInput.targetPath,
      }) ?? "denied";
      if (decision === "denied") {
        return {
          status: "denied",
          output: { code: "approval_denied", message: "Denied by owner" },
        };
      }
    }

    const unchanged = await this.originalStillMatches(context, prepared);
    if (!unchanged) {
      return {
        status: "error",
        output: {
          code: "owner_edit_conflict",
          message: "The canonical artifact changed after validation",
          artifact_digest: prepared.candidateDigest,
        },
        recoverable: true,
      };
    }

    const delegated = await this.base.execute(
      auth,
      context,
      name,
      prepared.canonicalInput
    );
    const reconciliation = await this.reconcile(context, prepared);
    auditLog("process_guardrails.tool_result", {
      stage: this.options.stage,
      path: prepared.validationInput.targetPath,
      artifact_digest: prepared.candidateDigest,
      status: delegated.status,
      reconciliation,
      correlation_id: context.correlationId,
    });

    if (reconciliation === "applied") {
      return {
        status: "ok",
        output: {
          artifact_path: prepared.validationInput.targetPath,
          artifact_digest: prepared.candidateDigest,
          reconciliation,
        },
      };
    }
    return {
      status: delegated.status === "denied" ? "denied" : "error",
      output: {
        code: delegated.status === "ok"
          ? "tool_result_inconsistent"
          : "ambiguous_not_applied",
        message: delegated.status === "ok"
          ? "Tool reported success but the canonical artifact did not match"
          : "Tool outcome did not produce the validated artifact",
        artifact_path: prepared.validationInput.targetPath,
        artifact_digest: prepared.candidateDigest,
        reconciliation,
      },
      recoverable: true,
    };
  }

  private async prepareMutation(
    context: ToolContext,
    name: string,
    input: Record<string, unknown>
  ): Promise<PreparedMutation | ToolExecutionResult> {
    const requestedPath = String(input.path ?? "");
    let absolutePath: string;
    try {
      absolutePath = resolveMemoryPath(context.memoryRoot, requestedPath);
    } catch {
      return failure("guardrail_validation_failed", ["artifact_path_invalid"]);
    }
    const targetPath = toMemoryRelativePath(context.memoryRoot, absolutePath);
    const original = await readOptional(absolutePath);
    let candidate: string;
    let edit: { find: string; replace: string } | undefined;

    if (name === "memory_edit") {
      if (original === null) {
        return failure("edit_target_not_found");
      }
      const find = String(input.find ?? "");
      const replace = String(input.replace ?? "");
      const count = find.length === 0 ? 0 : countOccurrences(original, find);
      if (count === 0) {
        return failure("edit_target_not_found");
      }
      if (count > 1) {
        return failure("edit_target_not_unique");
      }
      candidate = original.replace(find, replace);
      edit = { find, replace };
    } else if (name === "memory_write") {
      candidate = String(input.content ?? "");
    } else {
      candidate = "";
    }

    const validationInput: ProcessGuardrailArtifactValidationInput = {
      pageId: this.options.pageId,
      stage: this.options.stage,
      toolName: name,
      targetPath,
      candidateContent: candidate,
      originalContent: original,
      prerequisites: this.options.prerequisites,
      journalEligibility: this.options.journalEligibility,
      ...(edit ? { edit } : {}),
    };
    const validation = validateProcessGuardrailArtifact(validationInput);
    if (!validation.ok) {
      auditLog("process_guardrails.validation_failed", {
        stage: this.options.stage,
        path: targetPath,
        validator_codes: validation.codes,
        correlation_id: context.correlationId,
      });
      return failure("guardrail_validation_failed", validation.codes);
    }

    return {
      validationInput,
      originalDigest: original === null ? null : digest(original),
      candidateDigest: digest(candidate),
      canonicalInput: { ...input },
    };
  }

  private validateRead(
    context: ToolContext,
    input: Record<string, unknown>
  ): ToolExecutionResult | null {
    let relativePath: string;
    try {
      const absolute = resolveMemoryPath(context.memoryRoot, String(input.path ?? ""));
      relativePath = toMemoryRelativePath(context.memoryRoot, absolute);
    } catch {
      return failure("guardrail_read_forbidden");
    }
    const allowed = stageDefinitionFor(this.options.stage).allowedReads.map((fileName) =>
      fileName.startsWith("me/")
        ? fileName
        : `documents/${this.options.pageId}/${fileName}`
    );
    return allowed.includes(relativePath)
      ? null
      : failure("guardrail_read_forbidden");
  }

  private async originalStillMatches(
    context: ToolContext,
    prepared: PreparedMutation
  ): Promise<boolean> {
    const current = await readOptional(resolveMemoryPath(
      context.memoryRoot,
      prepared.validationInput.targetPath
    ));
    return (current === null ? null : digest(current)) === prepared.originalDigest;
  }

  private async reconcile(
    context: ToolContext,
    prepared: PreparedMutation
  ): Promise<"applied" | "not_applied"> {
    const current = await readOptional(resolveMemoryPath(
      context.memoryRoot,
      prepared.validationInput.targetPath
    ));
    return current !== null && digest(current) === prepared.candidateDigest
      ? "applied"
      : "not_applied";
  }
}

function isMutation(name: string): boolean {
  return ["memory_write", "memory_edit", "memory_delete"].includes(name);
}

function isGuardedBaseTool(name: string): boolean {
  return ["memory_read", "memory_write", "memory_edit", "memory_delete"].includes(name);
}

async function readOptional(target: string): Promise<string | null> {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function cacheKey(
  context: ToolContext,
  name: string,
  input: Record<string, unknown>
): string {
  return `${context.correlationId}:${name}:${JSON.stringify(input)}`;
}

function countOccurrences(value: string, search: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    const found = value.indexOf(search, index);
    if (found === -1) return count;
    count += 1;
    index = found + search.length;
  }
}

function failure(code: string, validatorCodes: readonly string[] = []): ToolExecutionResult {
  return {
    status: "error",
    output: {
      code,
      message: "Guarded artifact mutation was rejected",
      ...(validatorCodes.length > 0 ? { validator_codes: validatorCodes } : {}),
    },
    recoverable: true,
  };
}
