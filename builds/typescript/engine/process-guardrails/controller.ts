import type { GatewayEngineRequest } from "../../contracts.js";
import type {
  ProcessGuardrailStateLoadResult,
  ProcessGuardrailTuple,
} from "../../memory/process-guardrail-state-store.js";
import type { ProcessGuardrailTraceEvent } from "../../memory/process-guardrail-trace-store.js";
import {
  PROCESS_GUARDRAIL_PROCESS_KIND,
  PROCESS_GUARDRAIL_STAGES,
  createInitialProcessGuardrailState,
  isTerminalProcessGuardrailOutcome,
  type ProcessGuardrailArtifactReference,
  type ProcessGuardrailReference,
  type ProcessGuardrailStage,
  type ProcessGuardrailState,
  type ProcessGuardrailTransition,
} from "./state-machine.js";

export type ProcessGuardrailOwnerOverride =
  | { category: "ambiguous" }
  | { category: "skip"; targetStage?: ProcessGuardrailStage }
  | { category: "reorder"; targetStage?: ProcessGuardrailStage }
  | { category: "redo"; targetStage?: ProcessGuardrailStage }
  | { category: "stop" }
  | { category: "resume" };

export type ProcessGuardrailControllerPrerequisite = {
  kind: ProcessGuardrailStage;
  status: "accepted" | "absent_by_owner_choice";
  artifactRefs: ProcessGuardrailArtifactReference[];
};

export type ProcessGuardrailPreparedStage = {
  request: GatewayEngineRequest;
  instructionRefs: ProcessGuardrailReference[];
};

type ProcessGuardrailStageResultCore =
  | { type: "waiting_for_owner" }
  | { type: "needs_owner_action"; code: string }
  | { type: "owner_override"; override: ProcessGuardrailOwnerOverride }
  | {
      type: "candidate";
      validation: { ok: boolean; codes: string[] };
      artifactRefs: ProcessGuardrailArtifactReference[];
      next: "auto_chain" | "wait_for_owner";
    }
  | {
      type: "handoff_complete_no_entry";
    }
  | {
      type: "failure";
      category:
        | "provider_timeout"
        | "provider_rate_limited"
        | "provider_unavailable"
        | "provider_empty_completion_exhausted"
        | "approval_denied"
        | "context_too_large"
        | "artifact_write_failed"
        | "artifact_write_ambiguous"
        | "artifact_conflict";
      code?: string;
    };

export type ProcessGuardrailStageResult = ProcessGuardrailStageResultCore & {
  diagnostics?: {
    modelCallId?: string;
    toolCallId?: string;
    operationId?: string;
    durationMs?: number;
    providerEmptyRetryCount?: number;
  };
};

export type ProcessGuardrailAttemptIdentity = {
  runId: string;
  stage: ProcessGuardrailStage;
  stageRevision: number;
  automaticAttempt: 1 | 2;
  stateRevision: number;
};

export type ProcessGuardrailStageRuntime = {
  prepare(input: {
    state: ProcessGuardrailState;
    stage: ProcessGuardrailStage;
    ownerDirection: { messageIds: string[]; content: string };
    prerequisites: ProcessGuardrailControllerPrerequisite[];
    structuralFeedbackCodes: string[];
  }): Promise<ProcessGuardrailPreparedStage>;
  invoke(input: {
    identity: ProcessGuardrailAttemptIdentity;
    request: GatewayEngineRequest;
  }): Promise<ProcessGuardrailStageResult>;
  reconcileAttempt?(input: {
    state: ProcessGuardrailState;
    identity: ProcessGuardrailAttemptIdentity;
  }): Promise<ProcessGuardrailStageResult | null>;
};

export type ProcessGuardrailArtifactInspector = {
  inspect(input: {
    stage: ProcessGuardrailStage;
    reference: ProcessGuardrailArtifactReference;
  }): Promise<
    | { status: "unchanged" }
    | { status: "changed_valid"; reference: ProcessGuardrailArtifactReference }
    | { status: "changed_invalid"; code: string }
    | { status: "missing"; code: string }
  >;
};

type ProcessGuardrailStateStoreLike = {
  create(
    tuple: ProcessGuardrailTuple,
    initialState: ProcessGuardrailState
  ): Promise<ProcessGuardrailState>;
  load(tuple: ProcessGuardrailTuple): Promise<ProcessGuardrailStateLoadResult>;
  transition(
    tuple: ProcessGuardrailTuple,
    input: {
      expectedRevision: number;
      transition: ProcessGuardrailTransition;
    }
  ): Promise<{ status: "updated" | "replayed"; state: ProcessGuardrailState }>;
};

type ProcessGuardrailTraceStoreLike = {
  append(event: ProcessGuardrailTraceEvent): Promise<unknown>;
  readRunEvents(runId: string): Promise<ProcessGuardrailTraceEvent[]>;
};

export type ProcessGuardrailControllerRequest = {
  tuple: ProcessGuardrailTuple;
  correlationId: string;
  ownerDirection: {
    messageIds: string[];
    content: string;
  };
  start?: {
    runId: string;
    providerId: "ollama" | "braindrive-models" | "openrouter";
    providerClass: "local" | "cloud";
    modelId: string;
    configuredScope: "missing" | "empty" | "none" | "local" | "cloud" | "all";
    resolvedScope: "none" | "local" | "cloud" | "all";
  };
  override?: ProcessGuardrailOwnerOverride;
  autoChain?: boolean;
};

export type ProcessGuardrailControllerResult = {
  outcome:
    | "active_awaiting_owner"
    | "needs_owner_action"
    | "paused_recoverable"
    | "completed"
    | "stopped_by_owner"
    | "failed_internal";
  state: ProcessGuardrailState | null;
  reason: string;
  message: string;
  modelInvocations: number;
  staleResultIgnored: boolean;
  persistenceFailure: boolean;
};

type ControllerOptions = {
  now?: () => Date;
  id?: () => string;
};

type ProcessGuardrailTransitionInput =
  ProcessGuardrailTransition extends infer Transition
    ? Transition extends ProcessGuardrailTransition
      ? Omit<Transition, "transition_id" | "timestamp">
      : never
    : never;

const RECOVERY_CHOICES =
  "You can edit the artifact, explicitly redo the stage, skip it, or stop the process.";
const activeControllerRuns = new Set<string>();

export class ProcessGuardrailController {
  private readonly now: () => Date;
  private readonly id: () => string;

  constructor(
    private readonly stateStore: ProcessGuardrailStateStoreLike,
    private readonly traceStore: ProcessGuardrailTraceStoreLike,
    private readonly runtime: ProcessGuardrailStageRuntime,
    private readonly artifactInspector: ProcessGuardrailArtifactInspector,
    options: ControllerOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? (() => crypto.randomUUID());
  }

  async run(
    request: ProcessGuardrailControllerRequest
  ): Promise<ProcessGuardrailControllerResult> {
    const lockKey = [
      request.tuple.conversationId,
      request.tuple.pageId,
      request.tuple.processKind,
    ].join("\u0000");
    if (activeControllerRuns.has(lockKey) && !request.override) {
      try {
        const loaded = await this.stateStore.load(request.tuple);
        if (loaded.status === "ok") {
          return resultForState(
            loaded.state,
            "concurrent_request_conflict",
            0
          );
        }
      } catch {
        // The active request remains authoritative; never start a second run.
      }
      return resultWithoutState(
        "failed_internal",
        "concurrent_request_conflict",
        "Another guarded request is already active for this conversation and page."
      );
    }

    const ownsLock = !activeControllerRuns.has(lockKey);
    if (ownsLock) {
      activeControllerRuns.add(lockKey);
    }
    try {
      return await this.runExclusive(request);
    } finally {
      if (ownsLock) {
        activeControllerRuns.delete(lockKey);
      }
    }
  }

  private async runExclusive(
    request: ProcessGuardrailControllerRequest
  ): Promise<ProcessGuardrailControllerResult> {
    let modelInvocations = 0;
    let state: ProcessGuardrailState;

    if (request.override?.category === "ambiguous") {
      try {
        const existing = await this.stateStore.load(request.tuple);
        if (existing.status === "ok") {
          return resultForState(
            existing.state,
            "ambiguous_owner_direction",
            modelInvocations
          );
        }
        if (existing.status === "corrupt" || existing.status === "unsupported") {
          return resultWithoutState(
            "needs_owner_action",
            existing.failureCode,
            "Saved guarded-process progress cannot be trusted. Existing owner artifacts were left unchanged."
          );
        }
        return resultWithoutState(
          "needs_owner_action",
          "ambiguous_owner_direction",
          "The owner direction was ambiguous, so guarded process state was not changed."
        );
      } catch (error) {
        return resultWithoutState(
          "failed_internal",
          errorCode(error),
          "Guarded process state could not be loaded."
        );
      }
    }

    const loaded = await this.loadState(request);
    if ("result" in loaded) {
      return loaded.result;
    }
    state = loaded.state;

    if (loaded.created) {
      state = await this.recordTrace(request, state, "process_started");
    }

    if (isTerminalProcessGuardrailOutcome(state.outcome)) {
      return resultForState(state, "duplicate_terminal_outcome", modelInvocations);
    }

    if (request.override) {
      const overridden = await this.applyOwnerOverride(request, state);
      state = overridden.state;
      if (overridden.stop) {
        return resultForState(state, overridden.reason, modelInvocations);
      }
    }

    if (state.outcome === "paused_recoverable" || state.outcome === "needs_owner_action") {
      return resultForState(state, state.recovery_reason ?? state.outcome, modelInvocations);
    }

    const reconciled = await this.reconcileAcceptedArtifacts(request, state);
    state = reconciled.state;
    if (reconciled.stop) {
      return resultForState(state, reconciled.reason, modelInvocations);
    }

    while (state.outcome === "active" && state.active_stage) {
      const stage = state.active_stage;
      const stageState = state.stages[stage];

      if (stageState.status === "validating") {
        const recovered = await this.reconcileInFlightAttempt(request, state);
        state = recovered.state;
        if (!recovered.stageResult) {
          return resultForState(state, recovered.reason, modelInvocations);
        }
        const handled = await this.handleStageResult(
          request,
          state,
          recovered.stageResult,
          modelInvocations
        );
        state = handled.state;
        if (handled.done) {
          return resultForState(
            state,
            handled.reason,
            modelInvocations,
            handled.staleResultIgnored
          );
        }
        continue;
      }

      let prepared: ProcessGuardrailPreparedStage;
      try {
        prepared = await this.runtime.prepare({
          state,
          stage,
          ownerDirection: request.ownerDirection,
          prerequisites: prerequisitesFor(state, stage),
          structuralFeedbackCodes: [...stageState.validation_codes],
        });
      } catch (error) {
        const code = errorCode(error);
        if (isOwnerRecoverablePreparationCode(code)) {
          const transitioned = await this.safeTransition(request, state, {
            type: "mark_needs_owner_action",
            stage,
            recovery_reason: code,
          });
          return resultForTransitionFailureOrState(
            transitioned,
            code,
            modelInvocations
          );
        }
        return this.failInternal(request, state, modelInvocations);
      }

      if (
        stageState.automatic_attempt > 0 &&
        !sameReferences(stageState.instruction_refs, prepared.instructionRefs)
      ) {
        const transitioned = await this.safeTransition(request, state, {
          type: "mark_needs_owner_action",
          stage,
          recovery_reason: "instruction_changed",
        });
        return resultForTransitionFailureOrState(
          transitioned,
          "instruction_changed",
          modelInvocations
        );
      }

      if (stageState.automatic_attempt === 0 || stageState.status === "retry_pending") {
        const begun = await this.safeTransition(request, state, {
          type: "begin_attempt",
          stage,
          instruction_refs: prepared.instructionRefs,
        });
        if (!begun.ok) {
          return transitionFailureResult(begun, modelInvocations);
        }
        state = begun.state;
        state = await this.recordTrace(
          request,
          state,
          stageState.status === "retry_pending" ? "retry_started" : "stage_activated",
          stageState.status === "retry_pending"
            ? { retry_class: "structural" }
            : undefined
        );
      }

      const active = state.stages[stage];
      if (active.automatic_attempt !== 1 && active.automatic_attempt !== 2) {
        return this.failInternal(request, state, modelInvocations);
      }
      const identity: ProcessGuardrailAttemptIdentity = {
        runId: state.run_id,
        stage,
        stageRevision: active.revision,
        automaticAttempt: active.automatic_attempt,
        stateRevision: state.revision,
      };

      let stageResult: ProcessGuardrailStageResult;
      try {
        modelInvocations += 1;
        stageResult = await this.runtime.invoke({
          identity,
          request: prepared.request,
        });
      } catch {
        return this.failInternal(request, state, modelInvocations);
      }

      let fresh: ProcessGuardrailStateLoadResult;
      try {
        fresh = await this.stateStore.load(request.tuple);
      } catch (error) {
        return {
          ...resultForState(state, errorCode(error), modelInvocations),
          persistenceFailure: true,
          message: "Guarded process progress could not be reloaded. Accepted artifacts remain unchanged.",
        };
      }
      if (
        fresh.status !== "ok" ||
        !sameAttemptIdentity(fresh.state, identity)
      ) {
        const latest = fresh.status === "ok" ? fresh.state : state;
        state = await this.recordTrace(request, latest, "stale_result_ignored");
        return resultForState(
          state,
          "stale_result_ignored",
          modelInvocations,
          true
        );
      }
      state = fresh.state;
      state = await this.recordTrace(request, state, "candidate_received", {
        status: stageResult.type,
        ...(stageResult.diagnostics?.modelCallId
          ? { model_call_id: stageResult.diagnostics.modelCallId }
          : {}),
        ...(stageResult.diagnostics?.toolCallId
          ? { tool_call_id: stageResult.diagnostics.toolCallId }
          : {}),
        ...(stageResult.diagnostics?.operationId
          ? { operation_id: stageResult.diagnostics.operationId }
          : {}),
        ...(stageResult.diagnostics?.durationMs !== undefined
          ? { duration_ms: stageResult.diagnostics.durationMs }
          : {}),
        ...(stageResult.diagnostics?.providerEmptyRetryCount !== undefined
          ? {
              provider_empty_retry_count:
                stageResult.diagnostics.providerEmptyRetryCount,
            }
          : {}),
      });

      if (stageResult.type === "failure" && stageResult.category === "artifact_write_ambiguous") {
        const reconciledAttempt = await this.runtime.reconcileAttempt?.({
          state,
          identity,
        });
        if (reconciledAttempt) {
          stageResult = reconciledAttempt;
        }
      }

      const handled = await this.handleStageResult(
        request,
        state,
        stageResult,
        modelInvocations
      );
      state = handled.state;
      if (handled.done) {
        return resultForState(
          state,
          handled.reason,
          modelInvocations,
          handled.staleResultIgnored
        );
      }
    }

    return resultForState(state, state.outcome, modelInvocations);
  }

  private async loadState(
    request: ProcessGuardrailControllerRequest
  ): Promise<
    | { state: ProcessGuardrailState; created: boolean }
    | { result: ProcessGuardrailControllerResult }
  > {
    let loaded: ProcessGuardrailStateLoadResult;
    try {
      loaded = await this.stateStore.load(request.tuple);
    } catch (error) {
      return {
        result: resultWithoutState(
          "failed_internal",
          errorCode(error),
          "Guarded process state could not be loaded."
        ),
      };
    }
    if (loaded.status === "corrupt" || loaded.status === "unsupported") {
      return {
        result: resultWithoutState(
          "needs_owner_action",
          loaded.failureCode,
          "Saved guarded-process progress cannot be trusted. Existing owner artifacts were left unchanged."
        ),
      };
    }
    if (loaded.status === "ok") {
      return { state: loaded.state, created: false };
    }
    if (!request.start) {
      return {
        result: resultWithoutState(
          "needs_owner_action",
          "process_start_required",
          "No resumable guarded process exists for this conversation and page."
        ),
      };
    }

    const createdAt = this.timestamp();
    const initial = createInitialProcessGuardrailState({
      runId: request.start.runId,
      conversationId: request.tuple.conversationId,
      pageId: request.tuple.pageId,
      providerId: request.start.providerId,
      providerClass: request.start.providerClass,
      modelId: request.start.modelId,
      configuredScope: request.start.configuredScope,
      resolvedScope: request.start.resolvedScope,
      createdAt,
      transitionId: this.id(),
    });
    try {
      return {
        state: await this.stateStore.create(request.tuple, initial),
        created: true,
      };
    } catch (error) {
      if (errorCode(error) === "state_exists" || errorCode(error) === "state_revision_conflict") {
        const current = await this.stateStore.load(request.tuple);
        if (current.status === "ok") {
          return { state: current.state, created: false };
        }
      }
      return {
        result: resultWithoutState(
          "failed_internal",
          errorCode(error),
          "Guarded process state could not be created."
        ),
      };
    }
  }

  private async applyOwnerOverride(
    request: ProcessGuardrailControllerRequest,
    state: ProcessGuardrailState
  ): Promise<{ state: ProcessGuardrailState; stop: boolean; reason: string }> {
    const override = request.override!;
    if (override.category === "ambiguous") {
      return { state, stop: true, reason: "ambiguous_owner_direction" };
    }

    if (override.category === "resume") {
      if (
        state.outcome === "needs_owner_action" &&
        state.active_stage &&
        state.stages[state.active_stage].automatic_attempt === 2 &&
        state.stages[state.active_stage].validation_codes.length > 0
      ) {
        return { state, stop: true, reason: "explicit_redo_required" };
      }
      const transition = state.outcome === "paused_recoverable" && state.active_stage
        ? { type: "resume_process" as const, stage: state.active_stage }
        : state.outcome === "needs_owner_action" && state.active_stage
          ? { type: "resume_owner_action" as const, stage: state.active_stage }
          : null;
      if (!transition) {
        return { state, stop: true, reason: "resume_not_applicable" };
      }
      const resumed = await this.safeTransition(request, state, transition);
      if (!resumed.ok) {
        return {
          state: resumed.state,
          stop: true,
          reason: resumed.reason,
        };
      }
      const traced = await this.recordTrace(request, resumed.state, "process_resumed", {
        override_category: "resume",
      });
      return { state: traced, stop: false, reason: "owner_resume" };
    }

    if (override.category === "stop") {
      const stopped = await this.safeTransition(request, state, { type: "stop_process" });
      if (!stopped.ok) {
        return { state: stopped.state, stop: true, reason: stopped.reason };
      }
      let traced = await this.recordTrace(request, stopped.state, "override_applied", {
        override_category: "stop",
      });
      traced = await this.recordTrace(request, traced, "process_stopped", {
        terminal_state: "stopped_by_owner",
      });
      return { state: traced, stop: true, reason: "owner_stop" };
    }

    const target = override.targetStage ?? (
      override.category === "skip" ? state.active_stage : null
    );
    if (!target) {
      return { state, stop: true, reason: "ambiguous_owner_direction" };
    }
    const transition = override.category === "skip"
      ? { type: "skip_stage" as const, stage: target }
      : override.category === "reorder"
        ? { type: "reorder_stage" as const, stage: target }
        : { type: "redo_stage" as const, stage: target };
    const changed = await this.safeTransition(request, state, transition);
    if (!changed.ok) {
      return { state: changed.state, stop: true, reason: changed.reason };
    }
    const traced = await this.recordTrace(
      request,
      changed.state,
      override.category === "skip"
        ? "stage_skipped"
        : override.category === "redo"
          ? "stage_redo"
          : "override_applied",
      {
        override_category: override.category,
        stage: target,
        stage_revision: changed.state.stages[target].revision,
        automatic_attempt: changed.state.stages[target].automatic_attempt,
      }
    );
    return {
      state: traced,
      stop: traced.outcome !== "active",
      reason: `owner_${override.category}`,
    };
  }

  private async reconcileAcceptedArtifacts(
    request: ProcessGuardrailControllerRequest,
    initial: ProcessGuardrailState
  ): Promise<{ state: ProcessGuardrailState; stop: boolean; reason: string }> {
    let state = initial;
    for (const stage of PROCESS_GUARDRAIL_STAGES) {
      if (state.stages[stage].status !== "accepted") {
        continue;
      }
      for (const reference of state.stages[stage].artifact_refs) {
        let inspected: Awaited<ReturnType<ProcessGuardrailArtifactInspector["inspect"]>>;
        try {
          inspected = await this.artifactInspector.inspect({ stage, reference });
        } catch {
          const paused = await this.pauseCurrent(
            request,
            state,
            "artifact_inspection_failed"
          );
          return {
            state: paused.state,
            stop: true,
            reason: paused.ok ? "artifact_inspection_failed" : paused.reason,
          };
        }
        if (inspected.status === "unchanged") {
          continue;
        }
        if (inspected.status === "changed_valid") {
          const changed = await this.safeTransition(request, state, {
            type: "reconcile_artifact",
            stage,
            artifact_ref: inspected.reference,
          });
          if (!changed.ok) {
            return { state: changed.state, stop: true, reason: changed.reason };
          }
          state = await this.recordTrace(
            request,
            changed.state,
            "artifact_reconciled",
            {
              artifact_refs: [{
                path: inspected.reference.path,
                digest: inspected.reference.digest,
              }],
              status: "owner_artifact_revalidated",
              stage,
              stage_revision: changed.state.stages[stage].revision,
              automatic_attempt: changed.state.stages[stage].automatic_attempt,
            }
          );
          continue;
        }
        if (!state.active_stage) {
          return { state, stop: true, reason: inspected.code };
        }
        const needsOwner = await this.safeTransition(request, state, {
          type: "mark_needs_owner_action",
          stage: state.active_stage,
          recovery_reason: inspected.code,
        });
        return {
          state: needsOwner.state,
          stop: true,
          reason: needsOwner.ok ? inspected.code : needsOwner.reason,
        };
      }
    }
    return { state, stop: false, reason: "artifacts_reconciled" };
  }

  private async reconcileInFlightAttempt(
    request: ProcessGuardrailControllerRequest,
    state: ProcessGuardrailState
  ): Promise<{
    state: ProcessGuardrailState;
    stageResult: ProcessGuardrailStageResult | null;
    reason: string;
  }> {
    const stage = state.active_stage!;
    const stageState = state.stages[stage];
    if (stageState.automatic_attempt !== 1 && stageState.automatic_attempt !== 2) {
      const failed = await this.failInternal(request, state, 0);
      return { state: failed.state ?? state, stageResult: null, reason: failed.reason };
    }
    const stageResult = await this.runtime.reconcileAttempt?.({
      state,
      identity: {
        runId: state.run_id,
        stage,
        stageRevision: stageState.revision,
        automaticAttempt: stageState.automatic_attempt,
        stateRevision: state.revision,
      },
    });
    if (stageResult) {
      return { state, stageResult, reason: "attempt_reconciled" };
    }
    const needsOwner = await this.safeTransition(request, state, {
      type: "mark_needs_owner_action",
      stage,
      recovery_reason: "attempt_outcome_ambiguous",
    });
    return {
      state: needsOwner.state,
      stageResult: null,
      reason: needsOwner.ok ? "attempt_outcome_ambiguous" : needsOwner.reason,
    };
  }

  private async handleStageResult(
    request: ProcessGuardrailControllerRequest,
    initial: ProcessGuardrailState,
    stageResult: ProcessGuardrailStageResult,
    _modelInvocations: number
  ): Promise<{
    state: ProcessGuardrailState;
    done: boolean;
    reason: string;
    staleResultIgnored: boolean;
  }> {
    let state = initial;
    const stage = state.active_stage!;

    if (stageResult.type === "owner_override") {
      const overridden = await this.applyOwnerOverride(
        { ...request, override: stageResult.override },
        state
      );
      return {
        state: overridden.state,
        done: overridden.stop || overridden.state.outcome !== "active",
        reason: overridden.reason,
        staleResultIgnored: false,
      };
    }
    if (stageResult.type === "waiting_for_owner") {
      return {
        state,
        done: true,
        reason: "waiting_for_owner",
        staleResultIgnored: false,
      };
    }
    if (stageResult.type === "needs_owner_action") {
      const needsOwner = await this.safeTransition(request, state, {
        type: "mark_needs_owner_action",
        stage,
        recovery_reason: stageResult.code,
      });
      return {
        state: needsOwner.state,
        done: true,
        reason: needsOwner.ok ? stageResult.code : needsOwner.reason,
        staleResultIgnored: false,
      };
    }
    if (stageResult.type === "failure") {
      if (isProviderFailure(stageResult.category) ||
          ["artifact_write_failed", "artifact_write_ambiguous"].includes(stageResult.category)) {
        const paused = await this.pauseCurrent(
          request,
          state,
          stageResult.code ?? stageResult.category
        );
        if (!paused.ok) {
          return {
            state: paused.state,
            done: true,
            reason: paused.reason,
            staleResultIgnored: false,
          };
        }
        state = paused.state;
        state = await this.recordTrace(request, state, "process_paused", {
          recovery_reason: stageResult.code ?? stageResult.category,
          ...(stageResult.category === "provider_empty_completion_exhausted"
            ? {
                retry_class: "provider_empty_completion" as const,
                provider_empty_retry_count:
                  stageResult.diagnostics?.providerEmptyRetryCount ?? 1,
              }
            : {}),
        });
        return {
          state,
          done: true,
          reason: stageResult.code ?? stageResult.category,
          staleResultIgnored: false,
        };
      }
      const needsOwner = await this.safeTransition(request, state, {
        type: "mark_needs_owner_action",
        stage,
        recovery_reason: stageResult.code ?? stageResult.category,
      });
      return {
        state: needsOwner.state,
        done: true,
        reason: needsOwner.ok
          ? stageResult.code ?? stageResult.category
          : needsOwner.reason,
        staleResultIgnored: false,
      };
    }

    if (state.stages[stage].status !== "validating") {
      const validating = await this.safeTransition(request, state, {
        type: "begin_validation",
        stage,
      });
      if (!validating.ok) {
        return {
          state: validating.state,
          done: true,
          reason: validating.reason,
          staleResultIgnored: false,
        };
      }
      state = validating.state;
    }

    if (stageResult.type === "handoff_complete_no_entry") {
      const completed = await this.safeTransition(request, state, {
        type: "complete_journal_handoff_no_entry",
        stage: "journal_handoff",
      });
      if (!completed.ok) {
        return {
          state: completed.state,
          done: true,
          reason: completed.reason,
          staleResultIgnored: false,
        };
      }
      state = await this.recordTrace(request, completed.state, "process_completed", {
        terminal_state: "completed",
      });
      return {
        state,
        done: true,
        reason: "process_completed",
        staleResultIgnored: false,
      };
    }

    if (!stageResult.validation.ok) {
      const failed = await this.safeTransition(request, state, {
        type: "validation_failed",
        stage,
        validation_codes: stageResult.validation.codes,
      });
      if (!failed.ok) {
        return {
          state: failed.state,
          done: true,
          reason: failed.reason,
          staleResultIgnored: false,
        };
      }
      state = await this.recordTrace(request, failed.state, "validation_failed", {
        validator_codes: stageResult.validation.codes,
      });
      if (state.outcome === "needs_owner_action") {
        state = await this.recordTrace(request, state, "retry_exhausted", {
          retry_class: "structural",
          terminal_state: "needs_owner_action",
        });
        return {
          state,
          done: true,
          reason: "structural_retry_exhausted",
          staleResultIgnored: false,
        };
      }
      state = await this.recordTrace(request, state, "retry_scheduled", {
        retry_class: "structural",
      });
      return {
        state,
        done: false,
        reason: "structural_retry_scheduled",
        staleResultIgnored: false,
      };
    }

    const accepted = await this.safeTransition(request, state, {
      type: "accept_stage",
      stage,
      artifact_refs: stageResult.artifactRefs,
      next_stage: nextUnresolvedAfter(state, stage),
    });
    if (!accepted.ok) {
      return {
        state: accepted.state,
        done: true,
        reason: accepted.reason,
        staleResultIgnored: false,
      };
    }
    state = await this.recordTrace(request, accepted.state, "stage_accepted", {
      artifact_refs: stageResult.artifactRefs.map(({ path, digest }) => ({ path, digest })),
      stage,
      stage_revision: accepted.state.stages[stage].revision,
      automatic_attempt: accepted.state.stages[stage].automatic_attempt,
    });
    if (state.outcome === "completed") {
      state = await this.recordTrace(request, state, "process_completed", {
        terminal_state: "completed",
      });
      return {
        state,
        done: true,
        reason: "process_completed",
        staleResultIgnored: false,
      };
    }
    if (!request.autoChain || stageResult.next !== "auto_chain") {
      return {
        state,
        done: true,
        reason: "waiting_for_owner",
        staleResultIgnored: false,
      };
    }
    return {
      state,
      done: false,
      reason: "auto_chain",
      staleResultIgnored: false,
    };
  }

  private async pauseCurrent(
    request: ProcessGuardrailControllerRequest,
    state: ProcessGuardrailState,
    recoveryReason: string
  ): Promise<
    | { ok: true; state: ProcessGuardrailState; reason: string }
    | { ok: false; state: ProcessGuardrailState; reason: string }
  > {
    if (!state.active_stage) {
      return { ok: false, state, reason: "active_stage_missing" };
    }
    const paused = await this.safeTransition(request, state, {
      type: "pause_process",
      stage: state.active_stage,
      recovery_reason: recoveryReason,
    });
    return paused.ok
      ? { ok: true, state: paused.state, reason: recoveryReason }
      : { ok: false, state: paused.state, reason: paused.reason };
  }

  private async failInternal(
    request: ProcessGuardrailControllerRequest,
    state: ProcessGuardrailState,
    modelInvocations: number
  ): Promise<ProcessGuardrailControllerResult> {
    const failed = await this.safeTransition(request, state, { type: "fail_internal" });
    if (!failed.ok) {
      return transitionFailureResult(failed, modelInvocations);
    }
    const traced = await this.recordTrace(request, failed.state, "process_failed", {
      terminal_state: "failed_internal",
    });
    return resultForState(traced, "unexpected_internal_error", modelInvocations);
  }

  private async safeTransition(
    request: ProcessGuardrailControllerRequest,
    state: ProcessGuardrailState,
    transition: ProcessGuardrailTransitionInput
  ): Promise<
    | { ok: true; state: ProcessGuardrailState }
    | { ok: false; state: ProcessGuardrailState; reason: string; persistenceFailure: boolean }
  > {
    try {
      const persisted = await this.stateStore.transition(request.tuple, {
        expectedRevision: state.revision,
        transition: {
          ...transition,
          transition_id: this.id(),
          timestamp: this.timestamp(),
        } as ProcessGuardrailTransition,
      });
      return { ok: true, state: persisted.state };
    } catch (error) {
      const code = errorCode(error);
      if (code === "state_revision_conflict") {
        try {
          const latest = await this.stateStore.load(request.tuple);
          if (latest.status === "ok") {
            return {
              ok: false,
              state: latest.state,
              reason: code,
              persistenceFailure: false,
            };
          }
        } catch {
          return {
            ok: false,
            state,
            reason: "state_load_failed",
            persistenceFailure: true,
          };
        }
      }
      return {
        ok: false,
        state,
        reason: code,
        persistenceFailure: true,
      };
    }
  }

  private async recordTrace(
    request: ProcessGuardrailControllerRequest,
    state: ProcessGuardrailState,
    event: ProcessGuardrailTraceEvent["event"],
    fields: Partial<ProcessGuardrailTraceEvent> = {}
  ): Promise<ProcessGuardrailState> {
    try {
      const existing = await this.traceStore.readRunEvents(state.run_id);
      await this.traceStore.append({
        schema_version: 1,
        timestamp: this.timestamp(),
        event_id: this.id(),
        sequence: (existing.at(-1)?.sequence ?? 0) + 1,
        event,
        run_id: state.run_id,
        conversation_id: state.conversation_id,
        correlation_id: request.correlationId,
        process_kind: PROCESS_GUARDRAIL_PROCESS_KIND,
        configured_scope: state.configured_scope,
        resolved_scope: state.resolved_scope,
        provider_id: state.provider_id,
        provider_class: state.provider_class,
        model_id: state.model_id,
        state_revision: state.revision,
        diagnostic_health: state.diagnostic_health.status,
        ...(state.active_stage ? {
          stage: state.active_stage,
          stage_revision: state.stages[state.active_stage].revision,
          automatic_attempt: state.stages[state.active_stage].automatic_attempt,
        } : {}),
        ...fields,
      } as ProcessGuardrailTraceEvent);
      return state;
    } catch {
      if (state.diagnostic_health.failure_codes.includes("trace_persist_failed")) {
        return state;
      }
      const degraded = await this.safeTransition(request, state, {
        type: "mark_diagnostics_degraded",
        failure_code: "trace_persist_failed",
      });
      return degraded.state;
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function prerequisitesFor(
  state: ProcessGuardrailState,
  stage: ProcessGuardrailStage
): ProcessGuardrailControllerPrerequisite[] {
  const stageIndex = PROCESS_GUARDRAIL_STAGES.indexOf(stage);
  return PROCESS_GUARDRAIL_STAGES.slice(0, stageIndex).map((kind) => {
    const prerequisite = state.stages[kind];
    return prerequisite.status === "skipped_by_owner"
      ? { kind, status: "absent_by_owner_choice", artifactRefs: [] }
      : { kind, status: "accepted", artifactRefs: [...prerequisite.artifact_refs] };
  });
}

function nextUnresolvedAfter(
  state: ProcessGuardrailState,
  stage: ProcessGuardrailStage
): ProcessGuardrailStage | null {
  const index = PROCESS_GUARDRAIL_STAGES.indexOf(stage);
  return PROCESS_GUARDRAIL_STAGES.slice(index + 1).find((candidate) =>
    ["pending", "active", "validating", "retry_pending", "needs_owner_action", "paused_recoverable"]
      .includes(state.stages[candidate].status)
  ) ?? null;
}

function sameAttemptIdentity(
  state: ProcessGuardrailState,
  identity: ProcessGuardrailAttemptIdentity
): boolean {
  const stage = state.stages[identity.stage];
  return (
    state.run_id === identity.runId &&
    state.outcome === "active" &&
    state.active_stage === identity.stage &&
    stage.status === "active" &&
    stage.revision === identity.stageRevision &&
    stage.automatic_attempt === identity.automaticAttempt &&
    state.revision === identity.stateRevision
  );
}

function sameReferences(
  left: ProcessGuardrailReference[],
  right: ProcessGuardrailReference[]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isProviderFailure(
  category: Extract<ProcessGuardrailStageResult, { type: "failure" }>["category"]
): boolean {
  return [
    "provider_timeout",
    "provider_rate_limited",
    "provider_unavailable",
    "provider_empty_completion_exhausted",
  ].includes(category);
}

function isOwnerRecoverablePreparationCode(code: string): boolean {
  return [
    "instruction_missing",
    "instruction_unreadable",
    "page_unsupported",
    "context_prerequisite_missing",
    "context_budget_exceeded",
    "context_mismatch",
  ].includes(code);
}

function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "unexpected_internal_error";
}

function resultForTransitionFailureOrState(
  transition:
    | { ok: true; state: ProcessGuardrailState }
    | { ok: false; state: ProcessGuardrailState; reason: string; persistenceFailure: boolean },
  reason: string,
  modelInvocations: number
): ProcessGuardrailControllerResult {
  return transition.ok
    ? resultForState(transition.state, reason, modelInvocations)
    : transitionFailureResult(transition, modelInvocations);
}

function transitionFailureResult(
  transition: {
    state: ProcessGuardrailState;
    reason: string;
    persistenceFailure: boolean;
  },
  modelInvocations: number
): ProcessGuardrailControllerResult {
  return {
    ...resultForState(transition.state, transition.reason, modelInvocations),
    persistenceFailure: transition.persistenceFailure,
    message: "Guarded process progress was not marked complete. Accepted artifacts remain unchanged.",
  };
}

function resultForState(
  state: ProcessGuardrailState,
  reason: string,
  modelInvocations: number,
  staleResultIgnored = false
): ProcessGuardrailControllerResult {
  const outcome = state.outcome === "active"
    ? "active_awaiting_owner"
    : state.outcome;
  const persistenceFailure = [
    "state_persist_failed",
    "state_load_failed",
  ].includes(reason);
  return {
    outcome,
    state,
    reason,
    message: persistenceFailure
      ? "Guarded process progress was not marked complete. Accepted artifacts remain unchanged."
      : resultMessage(outcome, reason, state),
    modelInvocations,
    staleResultIgnored,
    persistenceFailure,
  };
}

function resultWithoutState(
  outcome: "needs_owner_action" | "failed_internal",
  reason: string,
  message: string
): ProcessGuardrailControllerResult {
  return {
    outcome,
    state: null,
    reason,
    message,
    modelInvocations: 0,
    staleResultIgnored: false,
    persistenceFailure: false,
  };
}

function resultMessage(
  outcome: ProcessGuardrailControllerResult["outcome"],
  reason: string,
  state: ProcessGuardrailState
): string {
  if (reason === "ambiguous_owner_direction") {
    return "The owner direction was ambiguous, so guarded process state was not changed.";
  }
  if (reason === "structural_retry_exhausted" || reason === "explicit_redo_required") {
    const codes = state.active_stage
      ? state.stages[state.active_stage].validation_codes.join(", ")
      : "";
    return `The stage still has structural issues${codes ? `: ${codes}` : ""}. ${RECOVERY_CHOICES}`;
  }
  if (outcome === "active_awaiting_owner") {
    return "The guarded process is active and waiting for owner input.";
  }
  if (outcome === "needs_owner_action") {
    return `The guarded process needs owner action (${reason}). ${RECOVERY_CHOICES}`;
  }
  if (outcome === "paused_recoverable") {
    return `The guarded process is paused (${reason}). Accepted artifacts remain unchanged and the process can be resumed.`;
  }
  if (outcome === "completed") {
    return "The guarded process completed with every stage resolved.";
  }
  if (outcome === "stopped_by_owner") {
    return "The guarded process stopped at the owner's direction.";
  }
  return "The guarded process stopped after an internal failure. Accepted artifacts remain unchanged.";
}
