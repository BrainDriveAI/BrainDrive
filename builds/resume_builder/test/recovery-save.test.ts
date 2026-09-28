import { describe, expect, it, vi } from "vitest";

import {
  RECOVERY_RECONCILIATION_POLICY,
  RecoverySaveCoordinator,
  classifyRecoveryProjection,
  nextRecoveryPollElapsedMs,
  validateRecoveryAcknowledgement,
  type RecoverySaveBinding,
} from "../src/recovery-save.js";

const slot = {
  session_id: "10000000-0000-4000-8000-000000000001",
  job_fact_revision_id: null,
  question_id: "contact-question",
  field_id: "answer",
};

const binding: RecoverySaveBinding = {
  slot,
  value: "Résumé text 🚀",
  value_digest: `sha256:${"a".repeat(64)}`,
  expected_revision: 4,
  operation_id: "20000000-0000-4000-8000-000000000001",
  edit_generation: 7,
};

describe("Spec 10 recovery-save orchestration", () => {
  it("freezes the accepted display threshold, exact early cadence, bounded backoff, and host-aligned terminal", () => {
    expect(RECOVERY_RECONCILIATION_POLICY).toEqual({
      initial_ui_transition_ms: 500,
      early_poll_elapsed_ms: [625, 750, 1_000, 1_500, 2_500, 4_500, 8_500],
      maximum_poll_interval_ms: 5_000,
      final_authoritative_read_ms: 120_000,
    });
    expect([0, 625, 750, 1_000, 1_500, 2_500, 4_500, 8_500, 13_500, 119_999, 120_000].map(nextRecoveryPollElapsedMs))
      .toEqual([625, 750, 1_000, 1_500, 2_500, 4_500, 8_500, 13_500, 18_500, 120_000, null]);
  });

  it("treats early not-found and current-process uncertainty as pending, then accepts only exact committed truth", () => {
    expect(classifyRecoveryProjection(binding, {
      lifecycle_state: "pending", host_operation_settled: false,
      operation: { state: "not_found_within_scope" },
    }, null, 625)).toEqual({ state: "pending", final: false });
    expect(classifyRecoveryProjection(binding, {
      lifecycle_state: "current_process_lifecycle_unknown", host_operation_settled: false,
      operation: { state: "not_found_within_scope" },
    }, null, 8_500)).toEqual({ state: "pending", final: false });
    expect(classifyRecoveryProjection(binding, {
      lifecycle_state: "committed", host_operation_settled: true,
      operation: { state: "committed", operation_id: binding.operation_id, value_digest: binding.value_digest, revision: 5 },
    }, null, 750)).toEqual({ state: "saved", final: true });
    expect(classifyRecoveryProjection(binding, {
      lifecycle_state: "committed", host_operation_settled: true,
      operation: { state: "committed", operation_id: binding.operation_id, value_digest: `sha256:${"b".repeat(64)}`, revision: 5 },
    }, null, 750)).toEqual({ state: "conflict", final: true });
  });

  it("requires final authoritative workspace proof before terminal not-saved and preserves conflicts", () => {
    const failed = { lifecycle_state: "failed", host_operation_settled: true, operation: { state: "failed" as const } };
    expect(classifyRecoveryProjection(binding, failed, { state: "no_commit" }, 119_999)).toEqual({ state: "pending", final: false });
    expect(classifyRecoveryProjection(binding, failed, { state: "no_commit" }, 120_000)).toEqual({ state: "not_saved", final: true });
    expect(classifyRecoveryProjection(binding, failed, {
      state: "different_commit", value_digest: `sha256:${"c".repeat(64)}`, revision: 5,
    }, 120_000)).toEqual({ state: "conflict", final: true });
    expect(classifyRecoveryProjection(binding, failed, {
      state: "matching_commit", operation_id: null, value_digest: binding.value_digest, revision: 5,
    }, 120_000)).toEqual({ state: "conflict", final: true });
  });

  it("rejects acknowledgements with stale slot, value, revision, operation, or edit generation", () => {
    const acknowledgement = {
      slot, value: binding.value, value_digest: binding.value_digest, revision: 5,
      operation_id: binding.operation_id, edit_generation: 7,
    };
    expect(validateRecoveryAcknowledgement(binding, acknowledgement)).toBe(true);
    for (const changed of [
      { ...acknowledgement, value: "different" },
      { ...acknowledgement, revision: 6 },
      { ...acknowledgement, operation_id: "20000000-0000-4000-8000-000000000002" },
      { ...acknowledgement, edit_generation: 8 },
      { ...acknowledgement, slot: { ...slot, field_id: "other" } },
    ]) expect(validateRecoveryAcknowledgement(binding, changed)).toBe(false);
  });

  it("shares one attempt and executes each duplicate guarded intent once after the matching save", async () => {
    const coordinator = new RecoverySaveCoordinator();
    const write = vi.fn(async () => ({ state: "saved" as const }));
    const transition = vi.fn(async () => undefined);
    const first = coordinator.guard(binding, "pause", write, transition);
    const duplicate = coordinator.guard(binding, "pause", write, transition);
    expect(duplicate).toBe(first);
    await expect(Promise.all([first, duplicate])).resolves.toEqual([true, true]);
    expect(write).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledTimes(1);
  });

  it.each(["submit", "save_answer", "complete_for_now", "pause", "back", "stage_navigation"])(
    "runs duplicate %s intent requests exactly once",
    async (intent) => {
      const coordinator = new RecoverySaveCoordinator();
      const write = vi.fn(async () => ({ state: "saved" as const }));
      const transition = vi.fn(async () => undefined);
      await Promise.all([
        coordinator.guard(binding, intent, write, transition),
        coordinator.guard(binding, intent, write, transition),
      ]);
      expect(write).toHaveBeenCalledTimes(1);
      expect(transition).toHaveBeenCalledTimes(1);
    },
  );

  it("shares one autosave across all converging guarded intents and runs each requested transition once", async () => {
    const coordinator = new RecoverySaveCoordinator();
    let release!: (value: { state: "saved" }) => void;
    const write = vi.fn(() => new Promise<{ state: "saved" }>((resolve) => { release = resolve; }));
    const autosave = coordinator.attempt(binding, write);
    const intents = ["submit", "save_answer", "complete_for_now", "pause", "back", "stage_navigation"];
    const transitions = intents.map(() => vi.fn(async () => undefined));
    const guarded = intents.map((intent, index) => coordinator.guard(binding, intent, write, transitions[index]));
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    release({ state: "saved" });
    await expect(autosave).resolves.toEqual({ state: "saved" });
    await expect(Promise.all(guarded)).resolves.toEqual(Array(intents.length).fill(true));
    expect(transitions.every((transition) => transition.mock.calls.length === 1)).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed/conflicted intent waiting until an explicit retry or discard choice", async () => {
    const coordinator = new RecoverySaveCoordinator();
    const transition = vi.fn(async () => undefined);
    await expect(coordinator.guard(binding, "back", async () => ({ state: "not_saved" }), transition)).resolves.toBe(false);
    expect(transition).not.toHaveBeenCalled();
    expect(coordinator.waitingIntents(binding)).toEqual(["back"]);
    await expect(coordinator.retry(binding, async () => ({ state: "saved" }))).resolves.toEqual([true]);
    expect(transition).toHaveBeenCalledTimes(1);

    const conflicted = { ...binding, value_digest: `sha256:${"d".repeat(64)}`, operation_id: "20000000-0000-4000-8000-000000000004" };
    await coordinator.guard(conflicted, "complete_for_now", async () => ({ state: "conflict" }), transition);
    coordinator.discard(conflicted);
    expect(coordinator.waitingIntents(conflicted)).toEqual([]);
    expect(transition).toHaveBeenCalledTimes(1);
  });

  it("separates a newer Unicode/max-length edit into a distinct semantic attempt", async () => {
    const coordinator = new RecoverySaveCoordinator();
    const oldWrite = vi.fn(async () => ({ state: "saved" as const }));
    const newWrite = vi.fn(async () => ({ state: "saved" as const }));
    const newer = { ...binding, value: `${"界".repeat(15_998)}\n🚀`, value_digest: `sha256:${"e".repeat(64)}`, edit_generation: 8, operation_id: "20000000-0000-4000-8000-000000000005" };
    await Promise.all([coordinator.attempt(binding, oldWrite), coordinator.attempt(newer, newWrite)]);
    expect(oldWrite).toHaveBeenCalledTimes(1);
    expect(newWrite).toHaveBeenCalledTimes(1);
  });

  it("does not let edit-away-then-back inherit an older acknowledgement or guarded authorization", async () => {
    const coordinator = new RecoverySaveCoordinator();
    let releaseOld!: (value: { state: "saved" }) => void;
    const oldAttempt = new Promise<{ state: "saved" }>((resolve) => { releaseOld = resolve; });
    const oldTransition = vi.fn(async () => undefined);
    const currentTransition = vi.fn(async () => undefined);
    const old = coordinator.guard(binding, "stage_navigation", () => oldAttempt, oldTransition);
    coordinator.supersedeUnfinishedIntents();
    const awayThenBack = { ...binding, edit_generation: binding.edit_generation + 2 };
    const current = coordinator.guard(awayThenBack, "stage_navigation", async () => ({ state: "saved" }), currentTransition);
    await expect(current).resolves.toBe(true);
    expect(currentTransition).toHaveBeenCalledTimes(1);
    expect(oldTransition).not.toHaveBeenCalled();
    releaseOld({ state: "saved" });
    await expect(old).resolves.toBe(false);
    expect(oldTransition).not.toHaveBeenCalled();
    expect(currentTransition).toHaveBeenCalledTimes(1);
  });

  it("bounds retained completed attempts and guarded intents", async () => {
    const coordinator = new RecoverySaveCoordinator();
    for (let index = 0; index < 100; index += 1) {
      const item = {
        ...binding,
        value_digest: `sha256:${index.toString(16).padStart(64, "0")}`,
        operation_id: `20000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        edit_generation: index,
      };
      await coordinator.guard(item, "pause", async () => ({ state: "saved" }), async () => undefined);
    }
    expect(coordinator.retainedIdentityCounts()).toEqual({ attempts: 64, guardedIntents: 64 });
  });

  it("never evicts active attempts or unfinished guards under completed-retention pressure", async () => {
    const attemptCoordinator = new RecoverySaveCoordinator();
    const attemptReleases: Array<(value: { state: "saved" }) => void> = [];
    const attemptPromises = Array.from({ length: 70 }, (_, index) => {
      const item = {
        ...binding,
        value_digest: `sha256:${(index + 100).toString(16).padStart(64, "0")}`,
        operation_id: `30000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        edit_generation: index + 100,
      };
      const execute = vi.fn(() => new Promise<{ state: "saved" }>((resolve) => attemptReleases.push(resolve)));
      const first = attemptCoordinator.attempt(item, execute);
      expect(attemptCoordinator.attempt(item, execute)).toBe(first);
      return first;
    });
    await Promise.resolve();
    expect(attemptCoordinator.retainedIdentityCounts()).toEqual({ attempts: 70, guardedIntents: 0 });
    attemptReleases.forEach((release) => release({ state: "saved" }));
    await Promise.all(attemptPromises);
    expect(attemptCoordinator.retainedIdentityCounts()).toEqual({ attempts: 64, guardedIntents: 0 });

    const guardCoordinator = new RecoverySaveCoordinator();
    const guardReleases: Array<(value: { state: "saved" }) => void> = [];
    const transitions = Array.from({ length: 70 }, () => vi.fn(async () => undefined));
    const guardPromises = Array.from({ length: 70 }, (_, index) => {
      const item = {
        ...binding,
        value_digest: `sha256:${(index + 200).toString(16).padStart(64, "0")}`,
        operation_id: `40000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        edit_generation: index + 200,
      };
      const execute = vi.fn(() => new Promise<{ state: "saved" }>((resolve) => guardReleases.push(resolve)));
      const first = guardCoordinator.guard(item, "pause", execute, transitions[index]);
      expect(guardCoordinator.guard(item, "pause", execute, transitions[index])).toBe(first);
      return first;
    });
    await Promise.resolve();
    expect(guardCoordinator.retainedIdentityCounts()).toEqual({ attempts: 70, guardedIntents: 70 });
    guardReleases.forEach((release) => release({ state: "saved" }));
    await expect(Promise.all(guardPromises)).resolves.toEqual(Array(70).fill(true));
    expect(transitions.every((transition) => transition.mock.calls.length === 1)).toBe(true);
    expect(guardCoordinator.retainedIdentityCounts()).toEqual({ attempts: 64, guardedIntents: 64 });
  });
});
