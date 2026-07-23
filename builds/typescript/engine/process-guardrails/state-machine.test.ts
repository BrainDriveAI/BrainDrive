import { describe, expect, it } from "vitest";

import {
  ProcessGuardrailTransitionError,
  applyProcessGuardrailTransition,
  createInitialProcessGuardrailState,
  parseProcessGuardrailState,
  type ProcessGuardrailState,
  type ProcessGuardrailTransition,
} from "./state-machine.js";

const BASE_TIME = "2026-07-23T12:00:00.000Z";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function initialState(overrides: Partial<Parameters<typeof createInitialProcessGuardrailState>[0]> = {}) {
  return createInitialProcessGuardrailState({
    runId: "run-1",
    conversationId: "conversation-1",
    pageId: "career",
    providerId: "ollama",
    providerClass: "local",
    modelId: "test-model",
    configuredScope: "all",
    resolvedScope: "all",
    createdAt: BASE_TIME,
    transitionId: "created",
    ...overrides,
  });
}

type TransitionInput = ProcessGuardrailTransition extends infer Transition
  ? Transition extends ProcessGuardrailTransition
    ? Omit<Transition, "transition_id" | "timestamp">
    : never
  : never;

function transition(
  state: ProcessGuardrailState,
  input: TransitionInput,
  sequence: number
) {
  return applyProcessGuardrailTransition(state, {
    ...input,
    transition_id: `transition-${sequence}`,
    timestamp: new Date(Date.parse(BASE_TIME) + sequence * 1000).toISOString(),
  } as ProcessGuardrailTransition);
}

function acceptedReference(path: string, digest: string) {
  return {
    path,
    digest,
    accepted_at: BASE_TIME,
  };
}

function advanceThroughInterview(state = initialState()) {
  let next = transition(state, { type: "begin_attempt", stage: "interview" }, 1);
  next = transition(next, { type: "begin_validation", stage: "interview" }, 2);
  return transition(next, {
    type: "accept_stage",
    stage: "interview",
    artifact_refs: [],
    next_stage: "specification",
  }, 3);
}

describe("process guardrail state machine", () => {
  it("creates a versioned state with exactly one active stage and no content bodies", () => {
    const state = initialState();

    expect(state).toMatchObject({
      schema_version: 1,
      contract_version: 1,
      revision: 1,
      process_kind: "page-alignment-v1",
      active_stage: "interview",
      outcome: "active",
      terminal_at: null,
      diagnostic_health: {
        status: "healthy",
        failure_codes: [],
      },
    });
    expect(state.stages.interview.status).toBe("active");
    expect(Object.values(state.stages).filter((stage) => stage.status === "active")).toHaveLength(1);
    expect(JSON.stringify(state)).not.toContain("owner_message");
    expect(JSON.stringify(state)).not.toContain("artifact_body");
  });

  it("permits exactly two automatic attempts and rejects a third", () => {
    let state = transition(initialState(), { type: "begin_attempt", stage: "interview" }, 1);
    expect(state.stages.interview.automatic_attempt).toBe(1);

    state = transition(state, { type: "begin_validation", stage: "interview" }, 2);
    state = transition(state, {
      type: "validation_failed",
      stage: "interview",
      validation_codes: ["required_section_missing"],
    }, 3);
    expect(state.stages.interview.status).toBe("retry_pending");

    state = transition(state, { type: "begin_attempt", stage: "interview" }, 4);
    expect(state.stages.interview.automatic_attempt).toBe(2);
    state = transition(state, { type: "begin_validation", stage: "interview" }, 5);
    state = transition(state, {
      type: "validation_failed",
      stage: "interview",
      validation_codes: ["required_section_missing"],
    }, 6);

    expect(state.outcome).toBe("needs_owner_action");
    expect(state.stages.interview.status).toBe("needs_owner_action");

    state = transition(state, { type: "resume_owner_action", stage: "interview" }, 7);
    expect(() => transition(state, { type: "begin_attempt", stage: "interview" }, 8))
      .toThrowError(ProcessGuardrailTransitionError);
  });

  it("requires accepted specification, plan, and journal artifacts to have digests", () => {
    let state = advanceThroughInterview();
    state = transition(state, { type: "begin_attempt", stage: "specification" }, 4);
    state = transition(state, { type: "begin_validation", stage: "specification" }, 5);

    expect(() => transition(state, {
      type: "accept_stage",
      stage: "specification",
      artifact_refs: [],
      next_stage: "plan",
    }, 6)).toThrowError(/accepted specification requires an artifact reference/i);

    expect(() => parseProcessGuardrailState({
      ...state,
      stages: {
        ...state.stages,
        specification: {
          ...state.stages.specification,
          status: "accepted",
          artifact_refs: [{ path: "documents/career/spec.md", digest: "not-a-digest", accepted_at: BASE_TIME }],
        },
      },
    })).toThrow();
  });

  it("advances all four stages and reaches completion exactly once", () => {
    let state = advanceThroughInterview();
    state = transition(state, { type: "begin_attempt", stage: "specification" }, 4);
    state = transition(state, { type: "begin_validation", stage: "specification" }, 5);
    state = transition(state, {
      type: "accept_stage",
      stage: "specification",
      artifact_refs: [acceptedReference("documents/career/spec.md", DIGEST_A)],
      next_stage: "plan",
    }, 6);
    state = transition(state, { type: "begin_attempt", stage: "plan" }, 7);
    state = transition(state, { type: "begin_validation", stage: "plan" }, 8);
    state = transition(state, {
      type: "accept_stage",
      stage: "plan",
      artifact_refs: [acceptedReference("documents/career/plan.md", DIGEST_B)],
      next_stage: "journal_handoff",
    }, 9);
    state = transition(state, {
      type: "complete_journal_handoff_no_entry",
      stage: "journal_handoff",
    }, 10);

    expect(state).toMatchObject({
      outcome: "completed",
      active_stage: null,
      terminal_at: new Date(Date.parse(BASE_TIME) + 10_000).toISOString(),
    });
    expect(state.stages.journal_handoff.status).toBe("handoff_complete_no_entry");

    expect(() => transition(state, { type: "stop_process" }, 11))
      .toThrowError(/terminal process state cannot transition/i);
  });

  it.each([
    ["stop_process", "stopped_by_owner"],
    ["fail_internal", "failed_internal"],
  ] as const)("supports terminal %s and forbids leaving it", (type, expectedOutcome) => {
    const terminal = transition(initialState(), { type }, 1);

    expect(terminal.outcome).toBe(expectedOutcome);
    expect(terminal.active_stage).toBeNull();
    expect(terminal.terminal_at).not.toBeNull();
    expect(() => transition(terminal, { type: "resume_process", stage: "interview" }, 2))
      .toThrowError(/terminal process state cannot transition/i);
  });

  it("pauses and resumes without resetting the attempt", () => {
    let state = transition(initialState(), { type: "begin_attempt", stage: "interview" }, 1);
    state = transition(state, {
      type: "pause_process",
      stage: "interview",
      recovery_reason: "provider_unavailable",
    }, 2);

    expect(state.outcome).toBe("paused_recoverable");
    expect(state.stages.interview.automatic_attempt).toBe(1);

    state = transition(state, { type: "resume_process", stage: "interview" }, 3);
    expect(state.outcome).toBe("active");
    expect(state.stages.interview.automatic_attempt).toBe(1);
  });

  it("records instruction identity before an attempt and rejects retry drift", () => {
    const refs = [{ path: "documents/career/run-interview.md", digest: DIGEST_A }];
    let state = transition(initialState(), {
      type: "begin_attempt",
      stage: "interview",
      instruction_refs: refs,
    }, 1);
    state = transition(state, { type: "begin_validation", stage: "interview" }, 2);
    state = transition(state, {
      type: "validation_failed",
      stage: "interview",
      validation_codes: ["required_section_missing"],
    }, 3);

    expect(state.stages.interview.instruction_refs).toEqual(refs);
    expect(() => transition(state, {
      type: "begin_attempt",
      stage: "interview",
      instruction_refs: [{ ...refs[0], digest: DIGEST_B }],
    }, 4)).toThrow(/cannot change the recorded stage instructions/i);
  });

  it("skips an active prerequisite and advances with an explicit owner outcome", () => {
    let state = transition(initialState(), {
      type: "skip_stage",
      stage: "interview",
    }, 1);
    state = transition(state, {
      type: "skip_stage",
      stage: "specification",
    }, 2);

    expect(state.stages.interview.status).toBe("skipped_by_owner");
    expect(state.stages.specification.status).toBe("skipped_by_owner");
    expect(state.active_stage).toBe("plan");

    state = transition(state, { type: "begin_attempt", stage: "plan" }, 3);
    state = transition(state, { type: "begin_validation", stage: "plan" }, 4);
    state = transition(state, {
      type: "accept_stage",
      stage: "plan",
      artifact_refs: [acceptedReference("documents/career/plan.md", DIGEST_B)],
      next_stage: "journal_handoff",
    }, 5);
    expect(state.active_stage).toBe("journal_handoff");
  });

  it("reorders forward by marking unresolved prerequisites skipped", () => {
    const state = transition(initialState(), {
      type: "reorder_stage",
      stage: "plan",
    }, 1);

    expect(state.active_stage).toBe("plan");
    expect(state.stages.interview.status).toBe("skipped_by_owner");
    expect(state.stages.specification.status).toBe("skipped_by_owner");
    expect(state.stages.plan.status).toBe("active");
  });

  it("uses an owner-directed revision for redo and invalidates downstream acceptance", () => {
    let state = advanceThroughInterview();
    state = transition(state, { type: "begin_attempt", stage: "specification" }, 4);
    state = transition(state, { type: "begin_validation", stage: "specification" }, 5);
    state = transition(state, {
      type: "accept_stage",
      stage: "specification",
      artifact_refs: [acceptedReference("documents/career/spec.md", DIGEST_A)],
      next_stage: "plan",
    }, 6);

    state = transition(state, { type: "redo_stage", stage: "specification" }, 7);

    expect(state.active_stage).toBe("specification");
    expect(state.stages.specification).toMatchObject({
      status: "active",
      revision: 2,
      automatic_attempt: 0,
    });
    expect(state.stages.specification.artifact_refs).toEqual([
      acceptedReference("documents/career/spec.md", DIGEST_A),
    ]);
    expect(state.stages.plan).toMatchObject({
      status: "pending",
      automatic_attempt: 0,
    });
  });

  it("moves recoverable work to owner action and reconciles an accepted owner edit", () => {
    let state = advanceThroughInterview();
    state = transition(state, {
      type: "mark_needs_owner_action",
      stage: "specification",
      recovery_reason: "approval_denied",
    }, 4);
    expect(state).toMatchObject({
      outcome: "needs_owner_action",
      recovery_reason: "approval_denied",
    });

    state = transition(state, { type: "resume_owner_action", stage: "specification" }, 5);
    state = transition(state, { type: "begin_attempt", stage: "specification" }, 6);
    state = transition(state, { type: "begin_validation", stage: "specification" }, 7);
    state = transition(state, {
      type: "accept_stage",
      stage: "specification",
      artifact_refs: [acceptedReference("documents/career/spec.md", DIGEST_A)],
      next_stage: "plan",
    }, 8);
    state = transition(state, {
      type: "reconcile_artifact",
      stage: "specification",
      artifact_ref: acceptedReference("documents/career/spec.md", DIGEST_B),
    }, 9);

    expect(state.stages.specification.artifact_refs[0]?.digest).toBe(DIGEST_B);
    expect(state.active_stage).toBe("plan");
  });

  it("tracks diagnostic degradation without changing a terminal outcome", () => {
    const stopped = transition(initialState(), { type: "stop_process" }, 1);
    const degraded = transition(stopped, {
      type: "mark_diagnostics_degraded",
      failure_code: "trace_persist_failed",
    }, 2);

    expect(degraded.outcome).toBe("stopped_by_owner");
    expect(degraded.diagnostic_health).toEqual({
      status: "degraded",
      failure_codes: ["trace_persist_failed"],
    });
  });

  it("rejects multiple active stages and content-shaped state fields", () => {
    const state = initialState();

    expect(() => parseProcessGuardrailState({
      ...state,
      stages: {
        ...state.stages,
        specification: {
          ...state.stages.specification,
          status: "active",
        },
      },
    })).toThrow(/exactly one active or resumable stage/i);

    expect(() => parseProcessGuardrailState({
      ...state,
      owner_message: "must never persist",
    })).toThrow();
  });

  it("rejects provider classes and resolved scopes that do not match stable identity", () => {
    const state = initialState();

    expect(() => parseProcessGuardrailState({
      ...state,
      provider_class: "cloud",
    })).toThrow(/provider class does not match/i);
    expect(() => parseProcessGuardrailState({
      ...state,
      resolved_scope: "cloud",
    })).toThrow(/resolved scope does not enable/i);
  });

  it("validates pending operation identity without storing candidate content", () => {
    const state = transition(initialState(), { type: "begin_attempt", stage: "interview" }, 1);
    const withOperation = parseProcessGuardrailState({
      ...state,
      pending_operation: {
        operation_id: "operation-1",
        tool_call_id: "tool-call-1",
        stage: "interview",
        stage_revision: 1,
        automatic_attempt: 1,
        status: "pending",
        target_path: "documents/career/spec.md",
        expected_digest: null,
        created_at: BASE_TIME,
      },
    });

    expect(withOperation.pending_operation).toMatchObject({
      operation_id: "operation-1",
      stage: "interview",
    });
    expect(JSON.stringify(withOperation.pending_operation)).not.toContain("candidate_content");
    expect(() => parseProcessGuardrailState({
      ...withOperation,
      pending_operation: {
        ...withOperation.pending_operation,
        stage_revision: 2,
      },
    })).toThrow(/must match the active stage revision/i);
  });
});
