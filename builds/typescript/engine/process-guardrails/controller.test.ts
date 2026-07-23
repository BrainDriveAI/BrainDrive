import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type { GatewayEngineRequest } from "../../contracts.js";
import type {
  ProcessGuardrailStateLoadResult,
  ProcessGuardrailTuple,
} from "../../memory/process-guardrail-state-store.js";
import { ProcessGuardrailStateStore } from "../../memory/process-guardrail-state-store.js";
import type { ProcessGuardrailTraceEvent } from "../../memory/process-guardrail-trace-store.js";
import { ProcessGuardrailTraceStore } from "../../memory/process-guardrail-trace-store.js";
import {
  ProcessGuardrailController,
  type ProcessGuardrailArtifactInspector,
  type ProcessGuardrailControllerPrerequisite,
  type ProcessGuardrailControllerRequest,
  type ProcessGuardrailPreparedStage,
  type ProcessGuardrailStageResult,
  type ProcessGuardrailStageRuntime,
} from "./controller.js";
import {
  applyProcessGuardrailTransition,
  createInitialProcessGuardrailState,
  type ProcessGuardrailArtifactReference,
  type ProcessGuardrailStage,
  type ProcessGuardrailState,
  type ProcessGuardrailTransition,
} from "./state-machine.js";

const BASE_TIME = "2026-07-23T12:00:00.000Z";
const DIGESTS = {
  interview: "1".repeat(64),
  specification: "2".repeat(64),
  plan: "3".repeat(64),
  journal_handoff: "4".repeat(64),
};
const ARTIFACT_DIGESTS = {
  spec: "a".repeat(64),
  plan: "b".repeat(64),
  journal: "c".repeat(64),
  edited: "d".repeat(64),
};
const tuple: ProcessGuardrailTuple = {
  conversationId: "conversation-1",
  pageId: "career",
  processKind: "page-alignment-v1",
};

type QueuedRuntimeResult =
  | ProcessGuardrailStageResult
  | Error
  | (() => Promise<ProcessGuardrailStageResult>);

type TransitionInput =
  ProcessGuardrailTransition extends infer Transition
    ? Transition extends ProcessGuardrailTransition
      ? Omit<Transition, "transition_id" | "timestamp">
      : never
    : never;

class MemoryStateStore {
  state: ProcessGuardrailState | null = null;
  loadResult: ProcessGuardrailStateLoadResult | null = null;
  failTransitionType: ProcessGuardrailTransition["type"] | null = null;

  async create(
    _tuple: ProcessGuardrailTuple,
    state: ProcessGuardrailState
  ): Promise<ProcessGuardrailState> {
    if (this.state) {
      throw codedError("state_exists");
    }
    this.state = state;
    return state;
  }

  async load(_tuple: ProcessGuardrailTuple): Promise<ProcessGuardrailStateLoadResult> {
    if (this.loadResult) {
      return this.loadResult;
    }
    return this.state
      ? { status: "ok", state: this.state }
      : { status: "missing" };
  }

  async transition(
    _tuple: ProcessGuardrailTuple,
    input: {
      expectedRevision: number;
      transition: ProcessGuardrailTransition;
    }
  ): Promise<{ status: "updated" | "replayed"; state: ProcessGuardrailState }> {
    if (!this.state) {
      throw codedError("state_load_failed");
    }
    if (this.failTransitionType === input.transition.type) {
      throw codedError("state_persist_failed");
    }
    if (this.state.last_transition_id === input.transition.transition_id) {
      return { status: "replayed", state: this.state };
    }
    if (this.state.revision !== input.expectedRevision) {
      throw codedError("state_revision_conflict");
    }
    this.state = applyProcessGuardrailTransition(this.state, input.transition);
    return { status: "updated", state: this.state };
  }
}

class MemoryTraceStore {
  events: ProcessGuardrailTraceEvent[] = [];
  fail = false;

  async readRunEvents(runId: string): Promise<ProcessGuardrailTraceEvent[]> {
    if (this.fail) {
      throw codedError("trace_load_failed");
    }
    return this.events.filter((event) => event.run_id === runId);
  }

  async append(event: ProcessGuardrailTraceEvent): Promise<void> {
    if (this.fail) {
      throw codedError("trace_persist_failed");
    }
    this.events.push(event);
  }
}

class FakeRuntime implements ProcessGuardrailStageRuntime {
  readonly prepareCalls: Array<{
    stage: ProcessGuardrailStage;
    prerequisites: ProcessGuardrailControllerPrerequisite[];
    structuralFeedbackCodes: string[];
    ownerContent: string;
  }> = [];
  readonly invokeCalls: Array<{
    stage: ProcessGuardrailStage;
    attempt: number;
    request: GatewayEngineRequest;
  }> = [];
  readonly queues = new Map<ProcessGuardrailStage, QueuedRuntimeResult[]>();
  readonly instructionDigests = { ...DIGESTS };
  reconciledAttempt: ProcessGuardrailStageResult | null = null;
  prepareError: Error | null = null;

  queue(stage: ProcessGuardrailStage, ...results: QueuedRuntimeResult[]): this {
    this.queues.set(stage, [...(this.queues.get(stage) ?? []), ...results]);
    return this;
  }

  async prepare(input: {
    state: ProcessGuardrailState;
    stage: ProcessGuardrailStage;
    ownerDirection: { messageIds: string[]; content: string };
    prerequisites: ProcessGuardrailControllerPrerequisite[];
    structuralFeedbackCodes: string[];
  }): Promise<ProcessGuardrailPreparedStage> {
    if (this.prepareError) {
      throw this.prepareError;
    }
    this.prepareCalls.push({
      stage: input.stage,
      prerequisites: structuredClone(input.prerequisites),
      structuralFeedbackCodes: [...input.structuralFeedbackCodes],
      ownerContent: input.ownerDirection.content,
    });
    return {
      request: {
        messages: [
          { role: "system", content: `fresh:${input.stage}:${this.prepareCalls.length}` },
          { role: "user", content: input.ownerDirection.content },
        ],
        metadata: {
          correlation_id: `stage-${this.prepareCalls.length}`,
          conversation_id: input.state.conversation_id,
        },
      },
      instructionRefs: [{
        path: `documents/career/${input.stage}.md`,
        digest: this.instructionDigests[input.stage],
      }],
    };
  }

  async invoke(input: Parameters<ProcessGuardrailStageRuntime["invoke"]>[0]) {
    this.invokeCalls.push({
      stage: input.identity.stage,
      attempt: input.identity.automaticAttempt,
      request: input.request,
    });
    const next = this.queues.get(input.identity.stage)?.shift() ?? waiting();
    if (next instanceof Error) {
      throw next;
    }
    return typeof next === "function" ? next() : next;
  }

  async reconcileAttempt() {
    return this.reconciledAttempt;
  }
}

class FakeArtifactInspector implements ProcessGuardrailArtifactInspector {
  responses = new Map<string, Awaited<ReturnType<ProcessGuardrailArtifactInspector["inspect"]>>>();

  async inspect(input: {
    stage: ProcessGuardrailStage;
    reference: ProcessGuardrailArtifactReference;
  }): Promise<Awaited<ReturnType<ProcessGuardrailArtifactInspector["inspect"]>>> {
    return this.responses.get(input.reference.path) ?? { status: "unchanged" };
  }
}

function harness(input: {
  store?: MemoryStateStore;
  trace?: MemoryTraceStore;
  runtime?: FakeRuntime;
  inspector?: FakeArtifactInspector;
} = {}) {
  const store = input.store ?? new MemoryStateStore();
  const trace = input.trace ?? new MemoryTraceStore();
  const runtime = input.runtime ?? new FakeRuntime();
  const inspector = input.inspector ?? new FakeArtifactInspector();
  let id = 0;
  const controller = new ProcessGuardrailController(
    store,
    trace,
    runtime,
    inspector,
    {
      now: () => new Date(Date.parse(BASE_TIME) + id * 1000),
      id: () => `controller-${++id}`,
    }
  );
  return { controller, store, trace, runtime, inspector };
}

function request(
  overrides: Partial<ProcessGuardrailControllerRequest> = {}
): ProcessGuardrailControllerRequest {
  return {
    tuple,
    correlationId: "correlation-1",
    ownerDirection: {
      messageIds: ["message-1"],
      content: "Continue the process.",
    },
    start: {
      runId: "run-1",
      providerId: "ollama",
      providerClass: "local",
      modelId: "test-model",
      configuredScope: "all",
      resolvedScope: "all",
    },
    ...overrides,
  };
}

function waiting(): ProcessGuardrailStageResult {
  return { type: "waiting_for_owner" };
}

function valid(
  stage: ProcessGuardrailStage,
  next: "auto_chain" | "wait_for_owner" = "auto_chain"
): ProcessGuardrailStageResult {
  const artifactRefs = stage === "specification"
    ? [artifact("documents/career/spec.md", ARTIFACT_DIGESTS.spec)]
    : stage === "plan"
      ? [artifact("documents/career/plan.md", ARTIFACT_DIGESTS.plan)]
      : stage === "journal_handoff"
        ? [artifact("documents/career/journal.md", ARTIFACT_DIGESTS.journal)]
        : [];
  return {
    type: "candidate",
    validation: { ok: true, codes: [] },
    artifactRefs,
    next,
  };
}

function invalid(code = "required_section_missing"): ProcessGuardrailStageResult {
  return {
    type: "candidate",
    validation: { ok: false, codes: [code] },
    artifactRefs: [],
    next: "auto_chain",
  };
}

function artifact(path: string, digest: string): ProcessGuardrailArtifactReference {
  return { path, digest, accepted_at: BASE_TIME };
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

let seedTransition = 0;
function apply(
  state: ProcessGuardrailState,
  transition: TransitionInput
): ProcessGuardrailState {
  seedTransition += 1;
  return applyProcessGuardrailTransition(state, {
    ...transition,
    transition_id: `seed-${seedTransition}`,
    timestamp: new Date(Date.parse(BASE_TIME) + seedTransition * 1000).toISOString(),
  } as ProcessGuardrailTransition);
}

function initialState(): ProcessGuardrailState {
  return createInitialProcessGuardrailState({
    runId: "run-1",
    conversationId: tuple.conversationId,
    pageId: tuple.pageId,
    providerId: "ollama",
    providerClass: "local",
    modelId: "test-model",
    configuredScope: "all",
    resolvedScope: "all",
    createdAt: BASE_TIME,
    transitionId: "seed-created",
  });
}

function acceptedThroughSpecification(): ProcessGuardrailState {
  let state = initialState();
  state = apply(state, { type: "begin_attempt", stage: "interview" });
  state = apply(state, { type: "begin_validation", stage: "interview" });
  state = apply(state, {
    type: "accept_stage",
    stage: "interview",
    artifact_refs: [],
    next_stage: "specification",
  });
  state = apply(state, { type: "begin_attempt", stage: "specification" });
  state = apply(state, { type: "begin_validation", stage: "specification" });
  return apply(state, {
    type: "accept_stage",
    stage: "specification",
    artifact_refs: [artifact("documents/career/spec.md", ARTIFACT_DIGESTS.spec)],
    next_stage: "plan",
  });
}

describe("ProcessGuardrailController", () => {
  it("persists controller state and allowlisted trace events through the real stores", async () => {
    const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "guardrail-controller-"));
    try {
      const stateStore = new ProcessGuardrailStateStore(memoryRoot);
      const traceStore = new ProcessGuardrailTraceStore(memoryRoot);
      const runtime = new FakeRuntime().queue(
        "interview",
        valid("interview", "wait_for_owner")
      );
      let id = 0;
      const controller = new ProcessGuardrailController(
        stateStore,
        traceStore,
        runtime,
        new FakeArtifactInspector(),
        {
          now: () => new Date(Date.parse(BASE_TIME) + id * 1000),
          id: () => `real-store-${++id}`,
        }
      );

      const result = await controller.run(request());
      const reloaded = await new ProcessGuardrailStateStore(memoryRoot).load(tuple);
      const events = await new ProcessGuardrailTraceStore(memoryRoot)
        .readRunEvents("run-1");

      expect(result.outcome).toBe("active_awaiting_owner");
      expect(reloaded.status === "ok" ? reloaded.state.active_stage : null)
        .toBe("specification");
      expect(events.map((event) => event.event)).toEqual([
        "process_started",
        "stage_activated",
        "candidate_received",
        "stage_accepted",
      ]);
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("auto-chains four freshly assembled stages and completes only after journal handoff", async () => {
    const runtime = new FakeRuntime()
      .queue("interview", valid("interview"))
      .queue("specification", valid("specification"))
      .queue("plan", valid("plan"))
      .queue("journal_handoff", { type: "handoff_complete_no_entry" });
    const { controller, store, trace } = harness({ runtime });

    const result = await controller.run(request({ autoChain: true }));

    expect(result).toMatchObject({
      outcome: "completed",
      reason: "process_completed",
      modelInvocations: 4,
    });
    expect(runtime.prepareCalls.map((call) => call.stage)).toEqual([
      "interview",
      "specification",
      "plan",
      "journal_handoff",
    ]);
    expect(new Set(runtime.invokeCalls.map((call) => call.request))).toHaveProperty("size", 4);
    expect(store.state?.stages.journal_handoff.status).toBe("handoff_complete_no_entry");
    expect(trace.events.filter((event) => event.event === "process_completed")).toHaveLength(1);
  });

  it("keeps a multi-turn stage on one durable structural attempt", async () => {
    const runtime = new FakeRuntime().queue(
      "interview",
      waiting(),
      valid("interview", "wait_for_owner")
    );
    const { controller, store } = harness({ runtime });

    const first = await controller.run(request());
    const second = await controller.run(request({ start: undefined }));

    expect(first.outcome).toBe("active_awaiting_owner");
    expect(second.outcome).toBe("active_awaiting_owner");
    expect(store.state?.active_stage).toBe("specification");
    expect(store.state?.stages.interview.automatic_attempt).toBe(1);
    expect(runtime.invokeCalls.map((call) => call.attempt)).toEqual([1, 1]);
  });

  it("does not auto-chain when the request or stage outcome requires owner input", async () => {
    const runtime = new FakeRuntime().queue("interview", valid("interview"));
    const { controller, store } = harness({ runtime });

    const result = await controller.run(request({ autoChain: false }));

    expect(result.outcome).toBe("active_awaiting_owner");
    expect(store.state?.active_stage).toBe("specification");
    expect(runtime.invokeCalls).toHaveLength(1);
  });

  it("never reaches plan after two invalid specification outcomes", async () => {
    const runtime = new FakeRuntime()
      .queue("interview", valid("interview"))
      .queue("specification", invalid("stage_order_invalid"), invalid("stage_order_invalid"));
    const { controller, store } = harness({ runtime });

    const result = await controller.run(request({ autoChain: true }));

    expect(result).toMatchObject({
      outcome: "needs_owner_action",
      reason: "structural_retry_exhausted",
      modelInvocations: 3,
    });
    expect(store.state?.stages.specification).toMatchObject({
      status: "needs_owner_action",
      automatic_attempt: 2,
      validation_codes: ["stage_order_invalid"],
    });
    expect(store.state?.stages.plan.status).toBe("pending");
    expect(runtime.prepareCalls.at(-1)?.structuralFeedbackCodes).toEqual([
      "stage_order_invalid",
    ]);
  });

  it("cannot complete before an explicit journal handoff outcome", async () => {
    const runtime = new FakeRuntime()
      .queue("interview", valid("interview"))
      .queue("specification", valid("specification"))
      .queue("plan", valid("plan"))
      .queue("journal_handoff", waiting());
    const { controller, store } = harness({ runtime });

    const result = await controller.run(request({ autoChain: true }));

    expect(result.outcome).toBe("active_awaiting_owner");
    expect(store.state?.active_stage).toBe("journal_handoff");
    expect(store.state?.outcome).toBe("active");
  });

  it("honors skip and passes absent-by-owner-choice prerequisites downstream", async () => {
    const runtime = new FakeRuntime().queue("plan", waiting());
    const { controller, store } = harness({ runtime });

    const result = await controller.run(request({
      override: { category: "reorder", targetStage: "plan" },
    }));

    expect(result.outcome).toBe("active_awaiting_owner");
    expect(store.state?.stages.interview.status).toBe("skipped_by_owner");
    expect(store.state?.stages.specification.status).toBe("skipped_by_owner");
    expect(runtime.prepareCalls[0]?.prerequisites).toEqual([
      { kind: "interview", status: "absent_by_owner_choice", artifactRefs: [] },
      { kind: "specification", status: "absent_by_owner_choice", artifactRefs: [] },
    ]);
  });

  it("honors explicit skip, stop, and ambiguous no-op before model execution", async () => {
    const skipHarness = harness();
    const skipped = await skipHarness.controller.run(request({
      override: { category: "skip" },
    }));
    expect(skipped.state?.stages.interview.status).toBe("skipped_by_owner");
    expect(skipHarness.runtime.invokeCalls[0]?.stage).toBe("specification");

    const stopHarness = harness();
    const stopped = await stopHarness.controller.run(request({
      override: { category: "stop" },
    }));
    expect(stopped.outcome).toBe("stopped_by_owner");
    expect(stopHarness.runtime.invokeCalls).toHaveLength(0);

    const ambiguousHarness = harness();
    const before = initialState();
    ambiguousHarness.store.state = before;
    const ambiguous = await ambiguousHarness.controller.run(request({
      start: undefined,
      override: { category: "ambiguous" },
    }));
    expect(ambiguous.reason).toBe("ambiguous_owner_direction");
    expect(ambiguousHarness.store.state).toEqual(before);
    expect(ambiguousHarness.runtime.invokeCalls).toHaveLength(0);
  });

  it("applies a structurally reported owner override from the active stage", async () => {
    const runtime = new FakeRuntime()
      .queue("interview", {
        type: "owner_override",
        override: { category: "skip", targetStage: "interview" },
      })
      .queue("specification", waiting());
    const { controller, store } = harness({ runtime });

    const result = await controller.run(request());

    expect(result.reason).toBe("waiting_for_owner");
    expect(result.modelInvocations).toBe(2);
    expect(store.state?.stages.interview.status).toBe("skipped_by_owner");
    expect(store.state?.active_stage).toBe("specification");
  });

  it("uses a new stage revision for explicit redo instead of a third automatic attempt", async () => {
    const store = new MemoryStateStore();
    let exhausted = initialState();
    exhausted = apply(exhausted, { type: "begin_attempt", stage: "interview" });
    exhausted = apply(exhausted, { type: "begin_validation", stage: "interview" });
    exhausted = apply(exhausted, {
      type: "validation_failed",
      stage: "interview",
      validation_codes: ["required_section_missing"],
    });
    exhausted = apply(exhausted, { type: "begin_attempt", stage: "interview" });
    exhausted = apply(exhausted, { type: "begin_validation", stage: "interview" });
    exhausted = apply(exhausted, {
      type: "validation_failed",
      stage: "interview",
      validation_codes: ["required_section_missing"],
    });
    store.state = exhausted;
    const runtime = new FakeRuntime().queue("interview", waiting());
    const { controller } = harness({ store, runtime });

    const result = await controller.run(request({
      start: undefined,
      override: { category: "redo", targetStage: "interview" },
    }));

    expect(result.outcome).toBe("active_awaiting_owner");
    expect(store.state?.stages.interview).toMatchObject({
      revision: 2,
      automatic_attempt: 1,
      status: "active",
    });
    expect(runtime.invokeCalls).toHaveLength(1);
  });

  it("preserves the previously accepted artifact through a failed owner-directed redo", async () => {
    const store = new MemoryStateStore();
    store.state = acceptedThroughSpecification();
    const acceptedDigest = store.state.stages.specification.artifact_refs[0]?.digest;
    const runtime = new FakeRuntime().queue(
      "specification",
      invalid(),
      invalid()
    );
    const { controller } = harness({ store, runtime });

    const result = await controller.run(request({
      start: undefined,
      override: { category: "redo", targetStage: "specification" },
    }));

    expect(result.outcome).toBe("needs_owner_action");
    expect(store.state?.stages.specification).toMatchObject({
      revision: 2,
      automatic_attempt: 2,
      status: "needs_owner_action",
    });
    expect(store.state?.stages.specification.artifact_refs[0]?.digest).toBe(
      acceptedDigest
    );
  });

  it("retries one structural failure and accepts a successful second attempt", async () => {
    const runtime = new FakeRuntime().queue(
      "interview",
      invalid(),
      valid("interview", "wait_for_owner")
    );
    const { controller, store, trace } = harness({ runtime });

    const result = await controller.run(request({ autoChain: true }));

    expect(result.outcome).toBe("active_awaiting_owner");
    expect(runtime.invokeCalls.map((call) => call.attempt)).toEqual([1, 2]);
    expect(store.state?.stages.interview).toMatchObject({
      status: "accepted",
      automatic_attempt: 2,
    });
    expect(trace.events.some((event) =>
      event.event === "retry_started" && event.retry_class === "structural"
    )).toBe(true);
  });

  it("does not perform a third attempt after exhaustion or restart", async () => {
    const runtime = new FakeRuntime().queue("interview", invalid(), invalid());
    const setup = harness({ runtime });
    const first = await setup.controller.run(request());
    const restartedRuntime = new FakeRuntime().queue("interview", valid("interview"));
    const restarted = harness({
      store: setup.store,
      trace: setup.trace,
      runtime: restartedRuntime,
    });

    const second = await restarted.controller.run(request({ start: undefined }));

    expect(first.outcome).toBe("needs_owner_action");
    expect(second.outcome).toBe("needs_owner_action");
    expect(restartedRuntime.invokeCalls).toHaveLength(0);
    expect(setup.store.state?.stages.interview.automatic_attempt).toBe(2);

    const explicitResume = await restarted.controller.run(request({
      start: undefined,
      override: { category: "resume" },
    }));
    expect(explicitResume.reason).toBe("explicit_redo_required");
    expect(restartedRuntime.invokeCalls).toHaveLength(0);
  });

  it("resumes a persisted retry_pending stage with attempt two only", async () => {
    const store = new MemoryStateStore();
    let state = initialState();
    state = apply(state, {
      type: "begin_attempt",
      stage: "interview",
      instruction_refs: [{
        path: "documents/career/interview.md",
        digest: DIGESTS.interview,
      }],
    });
    state = apply(state, { type: "begin_validation", stage: "interview" });
    state = apply(state, {
      type: "validation_failed",
      stage: "interview",
      validation_codes: ["required_section_missing"],
    });
    store.state = state;
    const runtime = new FakeRuntime().queue("interview", valid("interview"));
    const { controller } = harness({ store, runtime });

    await controller.run(request({ start: undefined }));

    expect(runtime.invokeCalls.map((call) => call.attempt)).toEqual([2]);
    expect(store.state?.stages.interview.automatic_attempt).toBe(2);
  });

  it("restarts after acceptance at the first unfinished stage", async () => {
    const runtime = new FakeRuntime().queue("interview", valid("interview"));
    const setup = harness({ runtime });
    await setup.controller.run(request());
    const restartedRuntime = new FakeRuntime().queue("specification", waiting());
    const restarted = harness({
      store: setup.store,
      trace: setup.trace,
      runtime: restartedRuntime,
    });

    await restarted.controller.run(request({ start: undefined }));

    expect(restartedRuntime.invokeCalls.map((call) => call.stage)).toEqual([
      "specification",
    ]);
  });

  it("reconciles a validating attempt after restart without repeating the model call", async () => {
    const store = new MemoryStateStore();
    let state = acceptedThroughSpecification();
    state = apply(state, {
      type: "begin_attempt",
      stage: "plan",
      instruction_refs: [{
        path: "documents/career/plan.md",
        digest: DIGESTS.plan,
      }],
    });
    state = apply(state, { type: "begin_validation", stage: "plan" });
    store.state = state;
    const runtime = new FakeRuntime();
    runtime.reconciledAttempt = valid("plan");
    const { controller } = harness({ store, runtime });

    const result = await controller.run(request({ start: undefined }));

    expect(result.outcome).toBe("active_awaiting_owner");
    expect(store.state?.stages.plan.status).toBe("accepted");
    expect(store.state?.active_stage).toBe("journal_handoff");
    expect(runtime.invokeCalls).toHaveLength(0);
  });

  it.each([
    "provider_timeout",
    "provider_rate_limited",
    "provider_unavailable",
    "provider_empty_completion_exhausted",
  ] as const)("maps %s to a recoverable pause without changing accepted hashes", async (category) => {
    const store = new MemoryStateStore();
    store.state = acceptedThroughSpecification();
    const before = store.state.stages.specification.artifact_refs[0]?.digest;
    const runtime = new FakeRuntime().queue("plan", {
      type: "failure",
      category,
      ...(category === "provider_empty_completion_exhausted"
        ? {
            diagnostics: {
              modelCallId: "provider-call-1",
              durationMs: 25,
              providerEmptyRetryCount: 1,
            },
          }
        : {}),
    });
    const { controller, trace } = harness({ store, runtime });

    const result = await controller.run(request({ start: undefined }));

    expect(result.outcome).toBe("paused_recoverable");
    expect(store.state?.stages.specification.artifact_refs[0]?.digest).toBe(before);
    if (category === "provider_empty_completion_exhausted") {
      expect(trace.events.some((event) =>
        event.retry_class === "provider_empty_completion" &&
        event.provider_empty_retry_count === 1
      )).toBe(true);
      expect(store.state?.stages.plan.automatic_attempt).toBe(1);
    }
  });

  it("resumes a provider pause without resetting its structural attempt", async () => {
    const runtime = new FakeRuntime().queue(
      "interview",
      { type: "failure", category: "provider_timeout" },
      waiting()
    );
    const setup = harness({ runtime });
    await setup.controller.run(request());

    const resumed = await setup.controller.run(request({
      start: undefined,
      override: { category: "resume" },
    }));

    expect(resumed.outcome).toBe("active_awaiting_owner");
    expect(runtime.invokeCalls.map((call) => call.attempt)).toEqual([1, 1]);
  });

  it.each([
    ["approval_denied", "needs_owner_action"],
    ["context_too_large", "needs_owner_action"],
    ["artifact_conflict", "needs_owner_action"],
    ["artifact_write_failed", "paused_recoverable"],
    ["artifact_write_ambiguous", "paused_recoverable"],
  ] as const)("maps %s to %s", async (category, expected) => {
    const store = new MemoryStateStore();
    store.state = acceptedThroughSpecification();
    const acceptedDigest = store.state.stages.specification.artifact_refs[0]?.digest;
    const runtime = new FakeRuntime().queue("plan", {
      type: "failure",
      category,
    });
    const { controller } = harness({ store, runtime });

    const result = await controller.run(request({ start: undefined }));

    expect(result.outcome).toBe(expected);
    expect(result.reason).toBe(category);
    expect(store.state?.stages.specification.artifact_refs[0]?.digest).toBe(
      acceptedDigest
    );
  });

  it("reconciles an ambiguous write before deciding whether to repeat work", async () => {
    const runtime = new FakeRuntime().queue("interview", {
      type: "failure",
      category: "artifact_write_ambiguous",
    });
    runtime.reconciledAttempt = valid("interview");
    const { controller, store } = harness({ runtime });

    const result = await controller.run(request());

    expect(result.outcome).toBe("active_awaiting_owner");
    expect(store.state?.stages.interview.status).toBe("accepted");
    expect(runtime.invokeCalls).toHaveLength(1);
  });

  it("surfaces state persistence failure without accepting or advancing", async () => {
    const store = new MemoryStateStore();
    store.state = acceptedThroughSpecification();
    const acceptedDigest = store.state.stages.specification.artifact_refs[0]?.digest;
    store.failTransitionType = "accept_stage";
    const runtime = new FakeRuntime().queue("plan", valid("plan"));
    const { controller } = harness({ store, runtime });

    const result = await controller.run(request({ start: undefined }));

    expect(result.persistenceFailure).toBe(true);
    expect(result.reason).toBe("state_persist_failed");
    expect(store.state?.stages.plan.status).toBe("validating");
    expect(store.state?.stages.journal_handoff.status).toBe("pending");
    expect(store.state?.stages.specification.artifact_refs[0]?.digest).toBe(
      acceptedDigest
    );
  });

  it("marks diagnostics degraded when trace persistence fails", async () => {
    const trace = new MemoryTraceStore();
    trace.fail = true;
    const store = new MemoryStateStore();
    store.state = acceptedThroughSpecification();
    const acceptedDigest = store.state.stages.specification.artifact_refs[0]?.digest;
    const runtime = new FakeRuntime().queue("plan", waiting());
    const { controller } = harness({ trace, store, runtime });

    const result = await controller.run(request({ start: undefined }));

    expect(result.outcome).toBe("active_awaiting_owner");
    expect(store.state?.diagnostic_health).toEqual({
      status: "degraded",
      failure_codes: ["trace_persist_failed"],
    });
    expect(store.state?.stages.specification.artifact_refs[0]?.digest).toBe(
      acceptedDigest
    );
  });

  it.each([
    "instruction_missing",
    "context_budget_exceeded",
  ])("maps preparation failure %s to owner action without a model call", async (code) => {
    const store = new MemoryStateStore();
    store.state = acceptedThroughSpecification();
    const acceptedDigest = store.state.stages.specification.artifact_refs[0]?.digest;
    const runtime = new FakeRuntime();
    runtime.prepareError = codedError(code);
    const { controller } = harness({ store, runtime });

    const result = await controller.run(request({ start: undefined }));

    expect(result).toMatchObject({
      outcome: "needs_owner_action",
      reason: code,
      modelInvocations: 0,
    });
    expect(store.state?.stages.specification.artifact_refs[0]?.digest).toBe(
      acceptedDigest
    );
  });

  it.each([
    {
      label: "corrupt",
      result: {
        status: "corrupt",
        failureCode: "state_corrupt",
        statePath: "/preserved/state.json",
      } as const,
    },
    {
      label: "unsupported",
      result: {
        status: "unsupported",
        failureCode: "state_unsupported_version",
        statePath: "/preserved/state.json",
      } as const,
    },
  ])("preserves $label resume state for manual recovery", async ({ result: loadResult }) => {
    const store = new MemoryStateStore();
    store.loadResult = loadResult;
    const { controller, runtime } = harness({ store });

    const result = await controller.run(request({ start: undefined }));

    expect(result).toMatchObject({
      outcome: "needs_owner_action",
      state: null,
      reason: loadResult.failureCode,
    });
    expect(runtime.invokeCalls).toHaveLength(0);
  });

  it("does not create state for ambiguous direction when no run exists", async () => {
    const setup = harness();

    const result = await setup.controller.run(request({
      override: { category: "ambiguous" },
    }));

    expect(result).toMatchObject({
      outcome: "needs_owner_action",
      state: null,
      reason: "ambiguous_owner_direction",
    });
    expect(setup.store.state).toBeNull();
    expect(setup.trace.events).toHaveLength(0);
  });

  it("ignores a stale async result after a newer owner revision wins", async () => {
    const store = new MemoryStateStore();
    let release!: (result: ProcessGuardrailStageResult) => void;
    const pending = new Promise<ProcessGuardrailStageResult>((resolve) => {
      release = resolve;
    });
    const runtime = new FakeRuntime().queue("interview", () => pending);
    const { controller, trace } = harness({ store, runtime });

    const running = controller.run(request());
    while (runtime.invokeCalls.length === 0) {
      await Promise.resolve();
    }
    if (!store.state) throw new Error("Expected active state");
    store.state = apply(store.state, {
      type: "redo_stage",
      stage: "interview",
    });
    release(valid("interview"));
    const result = await running;

    expect(result.staleResultIgnored).toBe(true);
    expect(store.state.stages.interview).toMatchObject({
      status: "active",
      revision: 2,
      automatic_attempt: 0,
    });
    expect(trace.events.some((event) => event.event === "stale_result_ignored")).toBe(true);
  });

  it("returns a conflict for a concurrent ordinary request without a duplicate model call", async () => {
    let release!: (result: ProcessGuardrailStageResult) => void;
    const pending = new Promise<ProcessGuardrailStageResult>((resolve) => {
      release = resolve;
    });
    const runtime = new FakeRuntime().queue("interview", () => pending);
    const setup = harness({ runtime });

    const first = setup.controller.run(request());
    while (runtime.invokeCalls.length === 0) {
      await Promise.resolve();
    }
    const second = await setup.controller.run(request({ start: undefined }));
    release(waiting());
    const firstResult = await first;

    expect(second).toMatchObject({
      outcome: "active_awaiting_owner",
      reason: "concurrent_request_conflict",
      modelInvocations: 0,
    });
    expect(firstResult.outcome).toBe("active_awaiting_owner");
    expect(runtime.invokeCalls).toHaveLength(1);
  });

  it("lets a concurrent owner stop supersede an in-flight result", async () => {
    let release!: (result: ProcessGuardrailStageResult) => void;
    const pending = new Promise<ProcessGuardrailStageResult>((resolve) => {
      release = resolve;
    });
    const runtime = new FakeRuntime().queue("interview", () => pending);
    const setup = harness({ runtime });

    const running = setup.controller.run(request());
    while (runtime.invokeCalls.length === 0) {
      await Promise.resolve();
    }
    const stopped = await setup.controller.run(request({
      start: undefined,
      override: { category: "stop" },
    }));
    release(valid("interview"));
    const stale = await running;

    expect(stopped.outcome).toBe("stopped_by_owner");
    expect(stale.staleResultIgnored).toBe(true);
    expect(setup.store.state?.outcome).toBe("stopped_by_owner");
    expect(setup.store.state?.stages.specification.status).toBe("pending");
  });

  it("detects a mid-stage instruction edit and requires explicit redo", async () => {
    const runtime = new FakeRuntime().queue("interview", waiting(), waiting());
    const setup = harness({ runtime });
    await setup.controller.run(request());
    runtime.instructionDigests.interview = "f".repeat(64);

    const changed = await setup.controller.run(request({ start: undefined }));

    expect(changed).toMatchObject({
      outcome: "needs_owner_action",
      reason: "instruction_changed",
    });
    expect(runtime.invokeCalls).toHaveLength(1);
  });

  it("lets a valid owner artifact edit win and updates the accepted digest", async () => {
    const store = new MemoryStateStore();
    store.state = acceptedThroughSpecification();
    const inspector = new FakeArtifactInspector();
    inspector.responses.set("documents/career/spec.md", {
      status: "changed_valid",
      reference: artifact("documents/career/spec.md", ARTIFACT_DIGESTS.edited),
    });
    const runtime = new FakeRuntime().queue("plan", waiting());
    const { controller } = harness({ store, inspector, runtime });

    await controller.run(request({ start: undefined }));

    expect(store.state?.stages.specification.artifact_refs[0]?.digest).toBe(
      ARTIFACT_DIGESTS.edited
    );
    expect(runtime.invokeCalls[0]?.stage).toBe("plan");
  });

  it("preserves the last accepted digest when an owner edit fails revalidation", async () => {
    const store = new MemoryStateStore();
    store.state = acceptedThroughSpecification();
    const inspector = new FakeArtifactInspector();
    inspector.responses.set("documents/career/spec.md", {
      status: "changed_invalid",
      code: "owner_artifact_invalid",
    });
    const { controller, runtime } = harness({ store, inspector });

    const result = await controller.run(request({ start: undefined }));

    expect(result.outcome).toBe("needs_owner_action");
    expect(store.state?.stages.specification.artifact_refs[0]?.digest).toBe(
      ARTIFACT_DIGESTS.spec
    );
    expect(runtime.invokeCalls).toHaveLength(0);
  });

  it("pauses safely when accepted-artifact inspection itself fails", async () => {
    const store = new MemoryStateStore();
    store.state = acceptedThroughSpecification();
    const acceptedDigest = store.state.stages.specification.artifact_refs[0]?.digest;
    const inspector = new FakeArtifactInspector();
    inspector.inspect = async () => {
      throw new Error("injected artifact read failure");
    };
    const { controller, runtime } = harness({
      store,
      inspector,
    });

    const result = await controller.run(request({ start: undefined }));

    expect(result).toMatchObject({
      outcome: "paused_recoverable",
      reason: "artifact_inspection_failed",
    });
    expect(store.state?.stages.specification.artifact_refs[0]?.digest).toBe(
      acceptedDigest
    );
    expect(runtime.invokeCalls).toHaveLength(0);
  });

  it("does not repeat terminal completion or journal side effects", async () => {
    const runtime = new FakeRuntime()
      .queue("interview", valid("interview"))
      .queue("specification", valid("specification"))
      .queue("plan", valid("plan"))
      .queue("journal_handoff", { type: "handoff_complete_no_entry" });
    const setup = harness({ runtime });
    const first = await setup.controller.run(request({ autoChain: true }));
    const second = await setup.controller.run(request({
      start: undefined,
      autoChain: true,
    }));

    expect(first.outcome).toBe("completed");
    expect(second).toMatchObject({
      outcome: "completed",
      reason: "duplicate_terminal_outcome",
      modelInvocations: 0,
    });
    expect(runtime.invokeCalls).toHaveLength(4);
    expect(setup.trace.events.filter((event) => event.event === "process_completed"))
      .toHaveLength(1);
  });

  it("persists FAILED_INTERNAL for an unexpected runtime exception", async () => {
    const store = new MemoryStateStore();
    store.state = acceptedThroughSpecification();
    const acceptedDigest = store.state.stages.specification.artifact_refs[0]?.digest;
    const runtime = new FakeRuntime().queue(
      "plan",
      new Error("unexpected adapter failure")
    );
    const { controller } = harness({ runtime, store });

    const result = await controller.run(request({ start: undefined }));

    expect(result.outcome).toBe("failed_internal");
    expect(store.state?.outcome).toBe("failed_internal");
    expect(result.message).not.toContain("unexpected adapter failure");
    expect(store.state?.stages.specification.artifact_refs[0]?.digest).toBe(
      acceptedDigest
    );
  });
});
