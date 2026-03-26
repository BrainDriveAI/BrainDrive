import { describe, expect, it } from "vitest";

import { WorkflowLockStore } from "./workflow-lock-store.js";

const DEFAULT_LOCK_CONFIG = {
  ttl_turns: 2,
  max_total_turns: 4,
  allow_user_override: true,
};

describe("WorkflowLockStore", () => {
  it("sets and renews locks with lease semantics", () => {
    const store = new WorkflowLockStore();

    const setResult = store.applyPlan(
      "conv-a",
      {
        action: "set",
        profile_id: "interview",
        reason: "start",
      },
      DEFAULT_LOCK_CONFIG
    );
    expect(setResult.event).toBe("set");
    expect(setResult.state?.remainingTurns).toBe(2);

    const turnOne = store.loadForTurn("conv-a", DEFAULT_LOCK_CONFIG);
    expect(turnOne.lock?.remainingTurns).toBe(1);
    expect(turnOne.expired).toBe(false);

    const renewResult = store.applyPlan(
      "conv-a",
      {
        action: "keep",
        profile_id: "interview",
        reason: "continue",
      },
      DEFAULT_LOCK_CONFIG
    );
    expect(renewResult.event).toBe("renewed");
    expect(renewResult.state?.remainingTurns).toBe(2);
  });

  it("expires lock when lease is consumed without keep", () => {
    const store = new WorkflowLockStore();

    store.applyPlan(
      "conv-b",
      {
        action: "set",
        profile_id: "interview",
      },
      {
        ...DEFAULT_LOCK_CONFIG,
        ttl_turns: 1,
      }
    );

    const firstTurn = store.loadForTurn("conv-b", DEFAULT_LOCK_CONFIG);
    expect(firstTurn.lock?.remainingTurns).toBe(0);
    expect(firstTurn.expired).toBe(false);

    const secondTurn = store.loadForTurn("conv-b", DEFAULT_LOCK_CONFIG);
    expect(secondTurn.lock).toBeNull();
    expect(secondTurn.expired).toBe(true);
  });

  it("expires lock when max total turns is exceeded", () => {
    const store = new WorkflowLockStore();
    const longLeaseConfig = {
      ...DEFAULT_LOCK_CONFIG,
      ttl_turns: 10,
    };

    store.applyPlan(
      "conv-c",
      {
        action: "set",
        profile_id: "interview",
      },
      longLeaseConfig
    );

    expect(store.loadForTurn("conv-c", longLeaseConfig).lock).not.toBeNull();
    expect(store.loadForTurn("conv-c", longLeaseConfig).lock).not.toBeNull();
    expect(store.loadForTurn("conv-c", longLeaseConfig).lock).not.toBeNull();

    const overflowTurn = store.loadForTurn("conv-c", longLeaseConfig);
    expect(overflowTurn.lock).toBeNull();
    expect(overflowTurn.expired).toBe(true);
  });

  it("clears lock immediately when clear action is applied", () => {
    const store = new WorkflowLockStore();

    store.applyPlan(
      "conv-d",
      {
        action: "set",
        profile_id: "interview",
      },
      DEFAULT_LOCK_CONFIG
    );

    const clearResult = store.applyPlan(
      "conv-d",
      {
        action: "clear",
        reason: "user_requested_clear",
      },
      DEFAULT_LOCK_CONFIG
    );
    expect(clearResult.event).toBe("cleared");

    const postClear = store.loadForTurn("conv-d", DEFAULT_LOCK_CONFIG);
    expect(postClear.lock).toBeNull();
    expect(postClear.expired).toBe(false);
  });
});
