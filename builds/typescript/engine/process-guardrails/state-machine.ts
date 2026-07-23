import { z } from "zod";

import {
  PROCESS_GUARDRAIL_SCOPES,
  type ProcessGuardrailProviderClass,
  type ProcessGuardrailScope,
} from "./contracts.js";

export const PROCESS_GUARDRAIL_STATE_SCHEMA_VERSION = 1;
export const PROCESS_GUARDRAIL_CONTRACT_VERSION = 1;
export const PROCESS_GUARDRAIL_PROCESS_KIND = "page-alignment-v1" as const;
export const PROCESS_GUARDRAIL_STAGES = [
  "interview",
  "specification",
  "plan",
  "journal_handoff",
] as const;

const processGuardrailScopeSchema = z.enum(PROCESS_GUARDRAIL_SCOPES);
const configuredScopeSchema = z.union([
  processGuardrailScopeSchema,
  z.literal("missing"),
  z.literal("empty"),
]);
const stageKindSchema = z.enum(PROCESS_GUARDRAIL_STAGES);
const providerClassSchema = z.enum(["local", "cloud"]);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });
const safeIdentifierSchema = z.string().trim().min(1).max(256);
const safeCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,127}$/);

const referenceSchema = z
  .object({
    path: z.string().trim().min(1).max(1024),
    digest: digestSchema,
  })
  .strict();

const artifactReferenceSchema = referenceSchema
  .extend({
    accepted_at: timestampSchema,
  })
  .strict();

const stageStatusSchema = z.enum([
  "pending",
  "active",
  "validating",
  "retry_pending",
  "accepted",
  "skipped_by_owner",
  "handoff_complete_no_entry",
  "needs_owner_action",
  "paused_recoverable",
  "stopped_by_owner",
  "failed_internal",
]);

const stageStateSchema = z
  .object({
    status: stageStatusSchema,
    revision: z.number().int().positive(),
    automatic_attempt: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    instruction_refs: z.array(referenceSchema),
    artifact_refs: z.array(artifactReferenceSchema),
    validation_codes: z.array(safeCodeSchema),
    started_at: timestampSchema.nullable(),
    completed_at: timestampSchema.nullable(),
  })
  .strict();

const pendingOperationSchema = z
  .object({
    operation_id: safeIdentifierSchema,
    tool_call_id: safeIdentifierSchema,
    stage: stageKindSchema,
    stage_revision: z.number().int().positive(),
    automatic_attempt: z.union([z.literal(1), z.literal(2)]),
    status: z.enum(["pending", "ambiguous"]),
    target_path: z.string().trim().min(1).max(1024),
    expected_digest: digestSchema.nullable(),
    created_at: timestampSchema,
  })
  .strict();

const processOutcomeSchema = z.enum([
  "active",
  "needs_owner_action",
  "paused_recoverable",
  "completed",
  "stopped_by_owner",
  "failed_internal",
]);

export const processGuardrailStateSchema = z
  .object({
    schema_version: z.literal(PROCESS_GUARDRAIL_STATE_SCHEMA_VERSION),
    contract_version: z.literal(PROCESS_GUARDRAIL_CONTRACT_VERSION),
    revision: z.number().int().positive(),
    last_transition_id: safeIdentifierSchema,
    run_id: safeIdentifierSchema,
    conversation_id: safeIdentifierSchema,
    page_id: safeIdentifierSchema,
    process_kind: z.literal(PROCESS_GUARDRAIL_PROCESS_KIND),
    provider_id: z.enum(["ollama", "braindrive-models", "openrouter"]),
    provider_class: providerClassSchema,
    model_id: safeIdentifierSchema,
    configured_scope: configuredScopeSchema,
    resolved_scope: processGuardrailScopeSchema,
    active_stage: stageKindSchema.nullable(),
    stages: z
      .object({
        interview: stageStateSchema,
        specification: stageStateSchema,
        plan: stageStateSchema,
        journal_handoff: stageStateSchema,
      })
      .strict(),
    pending_operation: pendingOperationSchema.nullable(),
    outcome: processOutcomeSchema,
    recovery_reason: safeCodeSchema.nullable(),
    diagnostic_health: z
      .object({
        status: z.enum(["healthy", "degraded"]),
        failure_codes: z.array(safeCodeSchema),
      })
      .strict(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
    terminal_at: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    const expectedProviderClass = state.provider_id === "ollama" ? "local" : "cloud";
    if (state.provider_class !== expectedProviderClass) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provider_class"],
        message: "Provider class does not match the stable provider identity",
      });
    }
    if (
      state.resolved_scope === "none" ||
      (state.resolved_scope !== "all" && state.resolved_scope !== state.provider_class)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolved_scope"],
        message: "Resolved scope does not enable the stored provider",
      });
    }

    const activeEntries = PROCESS_GUARDRAIL_STAGES.filter((stage) =>
      ["active", "validating", "retry_pending", "needs_owner_action", "paused_recoverable"]
        .includes(state.stages[stage].status)
    );

    if (state.outcome === "active") {
      const activeStatuses = activeEntries.filter((stage) =>
        ["active", "validating", "retry_pending"].includes(state.stages[stage].status)
      );
      if (activeStatuses.length !== 1 || state.active_stage !== activeStatuses[0]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "State must have exactly one active or resumable stage",
        });
      }
    } else if (state.outcome === "needs_owner_action") {
      if (
        activeEntries.length !== 1 ||
        state.active_stage !== activeEntries[0] ||
        state.stages[activeEntries[0]!].status !== "needs_owner_action"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Needs-owner-action state must identify exactly one matching stage",
        });
      }
    } else if (state.outcome === "paused_recoverable") {
      if (
        activeEntries.length !== 1 ||
        state.active_stage !== activeEntries[0] ||
        state.stages[activeEntries[0]!].status !== "paused_recoverable"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Paused state must identify exactly one matching stage",
        });
      }
    } else if (state.active_stage !== null || activeEntries.length !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Terminal state cannot retain an active stage",
      });
    }

    const isTerminal = isTerminalProcessGuardrailOutcome(state.outcome);
    if (isTerminal !== (state.terminal_at !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Terminal timestamp must exist exactly for terminal outcomes",
      });
    }

    if (state.outcome === "completed") {
      const resolvedStatuses = new Set(["accepted", "skipped_by_owner", "handoff_complete_no_entry"]);
      if (PROCESS_GUARDRAIL_STAGES.some((stage) => !resolvedStatuses.has(state.stages[stage].status))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Completed process requires every stage to be resolved",
        });
      }
    }

    for (const stage of PROCESS_GUARDRAIL_STAGES) {
      const stageState = state.stages[stage];
      if (stageState.status === "pending" && stageState.automatic_attempt !== 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", stage, "automatic_attempt"],
          message: "Pending stage cannot have an automatic attempt",
        });
      }
      if (
        ["validating", "retry_pending"].includes(stageState.status) &&
        stageState.automatic_attempt === 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", stage, "automatic_attempt"],
          message: "Validation state requires an automatic attempt",
        });
      }
      if (stageState.status === "retry_pending" && stageState.automatic_attempt !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", stage, "automatic_attempt"],
          message: "Retry-pending state must follow the first attempt",
        });
      }
      if (
        stageState.status === "accepted" &&
        ["specification", "plan", "journal_handoff"].includes(stage) &&
        stageState.artifact_refs.length === 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", stage, "artifact_refs"],
          message: `Accepted ${stage} requires an artifact reference`,
        });
      }
    }

    if (
      state.pending_operation &&
      (state.active_stage !== state.pending_operation.stage ||
        state.stages[state.pending_operation.stage].revision !== state.pending_operation.stage_revision)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pending_operation"],
        message: "Pending operation must match the active stage revision",
      });
    }

    if (
      (state.diagnostic_health.status === "healthy") !==
      (state.diagnostic_health.failure_codes.length === 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["diagnostic_health"],
        message: "Diagnostic health and failure codes disagree",
      });
    }
  });

export type ProcessGuardrailState = z.infer<typeof processGuardrailStateSchema>;
export type ProcessGuardrailStage = (typeof PROCESS_GUARDRAIL_STAGES)[number];
export type ProcessGuardrailOutcome = z.infer<typeof processOutcomeSchema>;
export type ProcessGuardrailReference = z.infer<typeof referenceSchema>;
export type ProcessGuardrailArtifactReference = z.infer<typeof artifactReferenceSchema>;

type TransitionBase = {
  transition_id: string;
  timestamp: string;
};

export type ProcessGuardrailTransition =
  | (TransitionBase & {
      type: "begin_attempt";
      stage: ProcessGuardrailStage;
      instruction_refs?: ProcessGuardrailReference[];
    })
  | (TransitionBase & { type: "begin_validation"; stage: ProcessGuardrailStage })
  | (TransitionBase & {
      type: "validation_failed";
      stage: ProcessGuardrailStage;
      validation_codes: string[];
    })
  | (TransitionBase & {
      type: "accept_stage";
      stage: ProcessGuardrailStage;
      artifact_refs: ProcessGuardrailArtifactReference[];
      next_stage: ProcessGuardrailStage | null;
    })
  | (TransitionBase & {
      type: "complete_journal_handoff_no_entry";
      stage: "journal_handoff";
    })
  | (TransitionBase & {
      type: "pause_process";
      stage: ProcessGuardrailStage;
      recovery_reason: string;
    })
  | (TransitionBase & { type: "resume_process"; stage: ProcessGuardrailStage })
  | (TransitionBase & { type: "resume_owner_action"; stage: ProcessGuardrailStage })
  | (TransitionBase & {
      type: "mark_needs_owner_action";
      stage: ProcessGuardrailStage;
      recovery_reason: string;
    })
  | (TransitionBase & {
      type: "skip_stage";
      stage: ProcessGuardrailStage;
    })
  | (TransitionBase & {
      type: "reorder_stage";
      stage: ProcessGuardrailStage;
    })
  | (TransitionBase & {
      type: "redo_stage";
      stage: ProcessGuardrailStage;
    })
  | (TransitionBase & {
      type: "reconcile_artifact";
      stage: ProcessGuardrailStage;
      artifact_ref: ProcessGuardrailArtifactReference;
    })
  | (TransitionBase & { type: "stop_process" })
  | (TransitionBase & { type: "fail_internal" })
  | (TransitionBase & {
      type: "mark_diagnostics_degraded";
      failure_code: string;
    });

export class ProcessGuardrailTransitionError extends Error {
  readonly code = "invalid_process_guardrail_transition";

  constructor(message: string) {
    super(message);
    this.name = "ProcessGuardrailTransitionError";
  }
}

export function createInitialProcessGuardrailState(input: {
  runId: string;
  conversationId: string;
  pageId: string;
  providerId: "ollama" | "braindrive-models" | "openrouter";
  providerClass: Exclude<ProcessGuardrailProviderClass, "unclassified">;
  modelId: string;
  configuredScope: ProcessGuardrailScope | "missing" | "empty";
  resolvedScope: ProcessGuardrailScope;
  createdAt: string;
  transitionId: string;
}): ProcessGuardrailState {
  const pendingStage = () => ({
    status: "pending" as const,
    revision: 1,
    automatic_attempt: 0 as const,
    instruction_refs: [],
    artifact_refs: [],
    validation_codes: [],
    started_at: null,
    completed_at: null,
  });

  return parseProcessGuardrailState({
    schema_version: PROCESS_GUARDRAIL_STATE_SCHEMA_VERSION,
    contract_version: PROCESS_GUARDRAIL_CONTRACT_VERSION,
    revision: 1,
    last_transition_id: input.transitionId,
    run_id: input.runId,
    conversation_id: input.conversationId,
    page_id: input.pageId,
    process_kind: PROCESS_GUARDRAIL_PROCESS_KIND,
    provider_id: input.providerId,
    provider_class: input.providerClass,
    model_id: input.modelId,
    configured_scope: input.configuredScope,
    resolved_scope: input.resolvedScope,
    active_stage: "interview",
    stages: {
      interview: {
        ...pendingStage(),
        status: "active",
      },
      specification: pendingStage(),
      plan: pendingStage(),
      journal_handoff: pendingStage(),
    },
    pending_operation: null,
    outcome: "active",
    recovery_reason: null,
    diagnostic_health: {
      status: "healthy",
      failure_codes: [],
    },
    created_at: input.createdAt,
    updated_at: input.createdAt,
    terminal_at: null,
  });
}

export function parseProcessGuardrailState(value: unknown): ProcessGuardrailState {
  const parsed = processGuardrailStateSchema.parse(value);
  assertNoSensitiveProcessGuardrailValue(parsed);
  return parsed;
}

export function applyProcessGuardrailTransition(
  current: ProcessGuardrailState,
  transition: ProcessGuardrailTransition
): ProcessGuardrailState {
  const state = parseProcessGuardrailState(current);
  if (state.last_transition_id === transition.transition_id) {
    return state;
  }

  if (
    isTerminalProcessGuardrailOutcome(state.outcome) &&
    transition.type !== "mark_diagnostics_degraded"
  ) {
    throw new ProcessGuardrailTransitionError("Terminal process state cannot transition");
  }

  const next = structuredClone(state);

  switch (transition.type) {
    case "begin_attempt": {
      requireActiveStage(next, transition.stage);
      const stage = next.stages[transition.stage];
      if (stage.status === "active" && stage.automatic_attempt === 0) {
        stage.automatic_attempt = 1;
        stage.instruction_refs = structuredClone(transition.instruction_refs ?? []);
      } else if (stage.status === "retry_pending" && stage.automatic_attempt === 1) {
        if (
          transition.instruction_refs &&
          !sameReferences(stage.instruction_refs, transition.instruction_refs)
        ) {
          throw new ProcessGuardrailTransitionError(
            "Automatic retry cannot change the recorded stage instructions"
          );
        }
        stage.status = "active";
        stage.automatic_attempt = 2;
      } else {
        throw new ProcessGuardrailTransitionError("Automatic attempt cannot exceed two or restart an active attempt");
      }
      stage.started_at ??= transition.timestamp;
      stage.validation_codes = [];
      break;
    }
    case "begin_validation": {
      requireActiveStage(next, transition.stage);
      const stage = next.stages[transition.stage];
      if (stage.status !== "active" || stage.automatic_attempt === 0) {
        throw new ProcessGuardrailTransitionError("Only an attempted active stage can begin validation");
      }
      stage.status = "validating";
      break;
    }
    case "validation_failed": {
      requireActiveStage(next, transition.stage);
      const stage = next.stages[transition.stage];
      if (stage.status !== "validating") {
        throw new ProcessGuardrailTransitionError("Validation failure requires a validating stage");
      }
      stage.validation_codes = [...new Set(transition.validation_codes)];
      if (stage.automatic_attempt === 1) {
        stage.status = "retry_pending";
      } else if (stage.automatic_attempt === 2) {
        stage.status = "needs_owner_action";
        next.outcome = "needs_owner_action";
      } else {
        throw new ProcessGuardrailTransitionError("Validation failure has no valid automatic attempt");
      }
      break;
    }
    case "accept_stage": {
      requireActiveStage(next, transition.stage);
      const stage = next.stages[transition.stage];
      if (stage.status !== "validating") {
        throw new ProcessGuardrailTransitionError("Stage acceptance requires validation");
      }
      const expectedNextStage = nextUnresolvedStageAfter(next, transition.stage);
      if (transition.next_stage !== expectedNextStage) {
        throw new ProcessGuardrailTransitionError("Default stage acceptance must activate the next fixed stage");
      }
      stage.status = "accepted";
      stage.artifact_refs = structuredClone(transition.artifact_refs);
      stage.validation_codes = [];
      stage.completed_at = transition.timestamp;
      if (transition.next_stage) {
        const nextStage = next.stages[transition.next_stage];
        if (nextStage.status !== "pending") {
          throw new ProcessGuardrailTransitionError("Next stage is not pending");
        }
        nextStage.status = "active";
        next.active_stage = transition.next_stage;
      } else {
        next.active_stage = null;
        next.outcome = "completed";
        next.terminal_at = transition.timestamp;
      }
      break;
    }
    case "complete_journal_handoff_no_entry": {
      requireActiveStage(next, transition.stage);
      const stage = next.stages.journal_handoff;
      if (!["active", "validating"].includes(stage.status)) {
        throw new ProcessGuardrailTransitionError("Journal handoff is not active");
      }
      if (PROCESS_GUARDRAIL_STAGES.slice(0, 3).some((kind) =>
        !["accepted", "skipped_by_owner"].includes(next.stages[kind].status)
      )) {
        throw new ProcessGuardrailTransitionError("Journal handoff cannot complete before prior stages resolve");
      }
      stage.status = "handoff_complete_no_entry";
      stage.completed_at = transition.timestamp;
      next.active_stage = null;
      next.outcome = "completed";
      next.terminal_at = transition.timestamp;
      break;
    }
    case "pause_process": {
      requireActiveStage(next, transition.stage);
      const stage = next.stages[transition.stage];
      if (!["active", "validating", "retry_pending"].includes(stage.status)) {
        throw new ProcessGuardrailTransitionError("Only active work can pause");
      }
      stage.status = "paused_recoverable";
      next.outcome = "paused_recoverable";
      next.recovery_reason = transition.recovery_reason;
      break;
    }
    case "resume_process": {
      if (
        next.outcome !== "paused_recoverable" ||
        next.active_stage !== transition.stage ||
        next.stages[transition.stage].status !== "paused_recoverable"
      ) {
        throw new ProcessGuardrailTransitionError("Only the paused stage can resume");
      }
      next.stages[transition.stage].status = "active";
      next.outcome = "active";
      next.recovery_reason = null;
      break;
    }
    case "resume_owner_action": {
      if (
        next.outcome !== "needs_owner_action" ||
        next.active_stage !== transition.stage ||
        next.stages[transition.stage].status !== "needs_owner_action"
      ) {
        throw new ProcessGuardrailTransitionError("Only the needs-owner-action stage can resume");
      }
      next.stages[transition.stage].status = "active";
      next.outcome = "active";
      next.recovery_reason = null;
      break;
    }
    case "mark_needs_owner_action": {
      if (
        next.active_stage !== transition.stage ||
        !["active", "validating", "retry_pending", "paused_recoverable"].includes(
          next.stages[transition.stage].status
        )
      ) {
        throw new ProcessGuardrailTransitionError(
          "Only the current resumable stage can require owner action"
        );
      }
      next.stages[transition.stage].status = "needs_owner_action";
      next.outcome = "needs_owner_action";
      next.recovery_reason = transition.recovery_reason;
      break;
    }
    case "skip_stage": {
      const stage = next.stages[transition.stage];
      if (!["pending", "active", "validating", "retry_pending", "needs_owner_action", "paused_recoverable"]
        .includes(stage.status)) {
        throw new ProcessGuardrailTransitionError("Only an unresolved stage can be skipped");
      }
      const wasActive = next.active_stage === transition.stage;
      stage.status = "skipped_by_owner";
      stage.completed_at = transition.timestamp;
      stage.validation_codes = [];
      if (wasActive) {
        activateFirstUnresolvedOrComplete(next, transition.timestamp);
      }
      break;
    }
    case "reorder_stage": {
      const targetIndex = PROCESS_GUARDRAIL_STAGES.indexOf(transition.stage);
      if (targetIndex < 0) {
        throw new ProcessGuardrailTransitionError("Unknown reordered stage");
      }
      for (const [index, kind] of PROCESS_GUARDRAIL_STAGES.entries()) {
        const stage = next.stages[kind];
        if (index < targetIndex && isUnresolvedStageStatus(stage.status)) {
          stage.status = "skipped_by_owner";
          stage.completed_at = transition.timestamp;
          stage.validation_codes = [];
        } else if (kind !== transition.stage && next.active_stage === kind) {
          resetStageForOwner(stage, false);
        }
      }
      const target = next.stages[transition.stage];
      const incrementRevision = target.status !== "pending" || target.automatic_attempt > 0;
      resetStageForOwner(target, incrementRevision);
      target.status = "active";
      next.active_stage = transition.stage;
      next.outcome = "active";
      next.recovery_reason = null;
      next.terminal_at = null;
      break;
    }
    case "redo_stage": {
      const targetIndex = PROCESS_GUARDRAIL_STAGES.indexOf(transition.stage);
      if (targetIndex < 0) {
        throw new ProcessGuardrailTransitionError("Unknown redo stage");
      }
      for (const [index, kind] of PROCESS_GUARDRAIL_STAGES.entries()) {
        if (index > targetIndex) {
          resetStageForOwner(next.stages[kind], false);
        } else if (kind !== transition.stage && next.active_stage === kind) {
          resetStageForOwner(next.stages[kind], false);
        }
      }
      const target = next.stages[transition.stage];
      resetStageForOwner(target, true);
      target.status = "active";
      next.active_stage = transition.stage;
      next.outcome = "active";
      next.recovery_reason = null;
      next.terminal_at = null;
      next.pending_operation = null;
      break;
    }
    case "reconcile_artifact": {
      const stage = next.stages[transition.stage];
      if (stage.status !== "accepted") {
        throw new ProcessGuardrailTransitionError(
          "Only an accepted artifact can be reconciled"
        );
      }
      const artifactIndex = stage.artifact_refs.findIndex(
        (reference) => reference.path === transition.artifact_ref.path
      );
      if (artifactIndex < 0) {
        throw new ProcessGuardrailTransitionError(
          "Reconciled artifact must match an accepted path"
        );
      }
      stage.artifact_refs[artifactIndex] = structuredClone(transition.artifact_ref);
      break;
    }
    case "stop_process":
      setTerminalOutcome(next, "stopped_by_owner", "stopped_by_owner", transition.timestamp);
      break;
    case "fail_internal":
      setTerminalOutcome(next, "failed_internal", "failed_internal", transition.timestamp);
      break;
    case "mark_diagnostics_degraded":
      next.diagnostic_health.status = "degraded";
      next.diagnostic_health.failure_codes = [
        ...new Set([...next.diagnostic_health.failure_codes, transition.failure_code]),
      ];
      break;
  }

  next.revision += 1;
  next.last_transition_id = transition.transition_id;
  next.updated_at = transition.timestamp;
  return parseProcessGuardrailState(next);
}

export function isTerminalProcessGuardrailOutcome(outcome: ProcessGuardrailOutcome): boolean {
  return ["completed", "stopped_by_owner", "failed_internal"].includes(outcome);
}

function requireActiveStage(state: ProcessGuardrailState, stage: ProcessGuardrailStage): void {
  if (state.active_stage !== stage || state.outcome !== "active") {
    throw new ProcessGuardrailTransitionError("Transition does not target the active stage");
  }
}

function nextUnresolvedStageAfter(
  state: ProcessGuardrailState,
  stage: ProcessGuardrailStage
): ProcessGuardrailStage | null {
  const index = PROCESS_GUARDRAIL_STAGES.indexOf(stage);
  return PROCESS_GUARDRAIL_STAGES
    .slice(index + 1)
    .find((candidate) => isUnresolvedStageStatus(state.stages[candidate].status)) ?? null;
}

function isUnresolvedStageStatus(status: ProcessGuardrailState["stages"][ProcessGuardrailStage]["status"]): boolean {
  return [
    "pending",
    "active",
    "validating",
    "retry_pending",
    "needs_owner_action",
    "paused_recoverable",
  ].includes(status);
}

function resetStageForOwner(
  stage: ProcessGuardrailState["stages"][ProcessGuardrailStage],
  incrementRevision: boolean
): void {
  stage.status = "pending";
  stage.revision += incrementRevision ? 1 : 0;
  stage.automatic_attempt = 0;
  stage.instruction_refs = [];
  stage.validation_codes = [];
  stage.started_at = null;
  stage.completed_at = null;
}

function activateFirstUnresolvedOrComplete(
  state: ProcessGuardrailState,
  timestamp: string
): void {
  const unresolved = PROCESS_GUARDRAIL_STAGES.find((stage) =>
    isUnresolvedStageStatus(state.stages[stage].status)
  );
  if (unresolved) {
    const stage = state.stages[unresolved];
    if (stage.status !== "pending") {
      throw new ProcessGuardrailTransitionError(
        "Owner skip left a conflicting resumable stage"
      );
    }
    stage.status = "active";
    state.active_stage = unresolved;
    state.outcome = "active";
    state.recovery_reason = null;
    return;
  }
  state.active_stage = null;
  state.outcome = "completed";
  state.recovery_reason = null;
  state.terminal_at = timestamp;
}

function sameReferences(
  left: ProcessGuardrailReference[],
  right: ProcessGuardrailReference[]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function setTerminalOutcome(
  state: ProcessGuardrailState,
  outcome: "stopped_by_owner" | "failed_internal",
  stageStatus: "stopped_by_owner" | "failed_internal",
  timestamp: string
): void {
  if (!state.active_stage) {
    throw new ProcessGuardrailTransitionError("Terminal transition requires an active stage");
  }
  state.stages[state.active_stage].status = stageStatus;
  state.stages[state.active_stage].completed_at = timestamp;
  state.active_stage = null;
  state.outcome = outcome;
  state.pending_operation = null;
  state.terminal_at = timestamp;
}

function assertNoSensitiveProcessGuardrailValue(value: unknown): void {
  if (typeof value === "string") {
    if (
      /Bearer\s+[A-Za-z0-9._-]{8,}/i.test(value) ||
      /\bsk-[A-Za-z0-9_-]{8,}\b/.test(value) ||
      /-----BEGIN [^-]+ PRIVATE KEY-----/.test(value) ||
      /[?&](?:api[_-]?key|token|password|secret)=/i.test(value)
    ) {
      throw new Error("Process guardrail state contains secret-shaped data");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitiveProcessGuardrailValue);
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  Object.values(value as Record<string, unknown>).forEach(assertNoSensitiveProcessGuardrailValue);
}
