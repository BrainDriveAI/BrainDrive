import type {
  WorkflowLockPlan,
  WorkflowLockSnapshot,
  WorkflowLockState,
  WorkflowLockStoreConfig,
  WorkflowLockUpdateResult,
} from "./types.js";

export class WorkflowLockStore {
  private readonly locks = new Map<string, WorkflowLockState>();

  loadForTurn(conversationId: string, config: WorkflowLockStoreConfig): WorkflowLockSnapshot {
    const current = this.locks.get(conversationId);
    if (!current) {
      return {
        lock: null,
        expired: false,
      };
    }

    const nextState: WorkflowLockState = {
      ...current,
      remainingTurns: current.remainingTurns - 1,
      totalTurns: current.totalTurns + 1,
      updatedAt: new Date().toISOString(),
    };

    if (nextState.remainingTurns < 0 || nextState.totalTurns > config.max_total_turns) {
      this.locks.delete(conversationId);
      return {
        lock: null,
        expired: true,
      };
    }

    this.locks.set(conversationId, nextState);
    return {
      lock: nextState,
      expired: false,
    };
  }

  applyPlan(conversationId: string, plan: WorkflowLockPlan, config: WorkflowLockStoreConfig): WorkflowLockUpdateResult {
    const existing = this.locks.get(conversationId);
    const now = new Date().toISOString();

    switch (plan.action) {
      case "set": {
        if (!plan.profile_id) {
          return {
            event: "none",
            state: existing ?? null,
            reason: "set_without_profile",
          };
        }

        const nextState: WorkflowLockState = {
          profileId: plan.profile_id,
          remainingTurns: normalizePositiveInt(plan.ttl_turns, config.ttl_turns),
          totalTurns: existing?.profileId === plan.profile_id ? existing.totalTurns : 1,
          updatedAt: now,
          reason: plan.reason ?? "workflow_started",
        };
        this.locks.set(conversationId, nextState);
        return {
          event: "set",
          state: nextState,
          reason: nextState.reason,
        };
      }
      case "keep": {
        if (!existing) {
          return {
            event: "none",
            state: null,
            reason: "keep_without_existing_lock",
          };
        }

        const renewedState: WorkflowLockState = {
          ...existing,
          remainingTurns: normalizePositiveInt(plan.ttl_turns, config.ttl_turns),
          updatedAt: now,
          reason: plan.reason ?? existing.reason,
        };
        this.locks.set(conversationId, renewedState);
        return {
          event: "renewed",
          state: renewedState,
          reason: renewedState.reason,
        };
      }
      case "clear":
      case "expire": {
        this.locks.delete(conversationId);
        return {
          event: "cleared",
          state: null,
          reason: plan.reason ?? (plan.action === "expire" ? "expired" : "cleared"),
        };
      }
      case "none":
      default:
        return {
          event: "none",
          state: existing ?? null,
          reason: plan.reason ?? "no_lock_change",
        };
    }
  }
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}
