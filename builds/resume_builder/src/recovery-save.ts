export const RECOVERY_RECONCILIATION_POLICY = Object.freeze({
  initial_ui_transition_ms: 500,
  early_poll_elapsed_ms: [625, 750, 1_000, 1_500, 2_500, 4_500, 8_500] as const,
  maximum_poll_interval_ms: 5_000,
  final_authoritative_read_ms: 120_000,
});

export type RecoverySlotIdentity = {
  session_id: string;
  job_fact_revision_id: string | null;
  question_id: string;
  field_id: string;
};

export type RecoverySaveStatus = "idle" | "saving" | "reconciling" | "saved" | "not_saved" | "verification_failed" | "conflict";

export type RecoverySaveBinding = {
  slot: RecoverySlotIdentity;
  value: string;
  value_digest: string;
  expected_revision: number | null;
  operation_id: string;
  edit_generation: number;
};

export type RecoveryAcknowledgement = {
  slot: RecoverySlotIdentity;
  value: string;
  value_digest: string;
  revision: number;
  operation_id: string;
  edit_generation: number;
};

export type RecoveryProjection = {
  lifecycle_state: string;
  host_operation_settled: boolean;
  operation:
    | { state: "not_found_within_scope" }
    | { state: "committed"; operation_id: string; value_digest: string; revision: number }
    | { state: "conflict"; conflict_class?: string }
    | { state: "cancelled" }
    | { state: "failed" };
};

export type RecoveryWorkspaceReadback =
  | { state: "matching_commit"; operation_id: string | null; value_digest: string; revision: number }
  | { state: "different_commit"; value_digest: string; revision: number }
  | { state: "no_commit" };

export type RecoveryTerminal = { state: "saved" | "conflict" | "not_saved" | "cancelled" };

export function nextRecoveryPollElapsedMs(elapsedMs: number): number | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new TypeError("Recovery elapsed time must be non-negative");
  if (elapsedMs >= RECOVERY_RECONCILIATION_POLICY.final_authoritative_read_ms) return null;
  const early = RECOVERY_RECONCILIATION_POLICY.early_poll_elapsed_ms.find((candidate) => candidate > elapsedMs);
  if (early !== undefined) return early;
  return Math.min(
    elapsedMs + RECOVERY_RECONCILIATION_POLICY.maximum_poll_interval_ms,
    RECOVERY_RECONCILIATION_POLICY.final_authoritative_read_ms,
  );
}

export function sameRecoverySlot(left: RecoverySlotIdentity | null, right: RecoverySlotIdentity | null): boolean {
  return Boolean(left && right
    && left.session_id === right.session_id
    && left.job_fact_revision_id === right.job_fact_revision_id
    && left.question_id === right.question_id
    && left.field_id === right.field_id);
}

export function validateRecoveryAcknowledgement(binding: RecoverySaveBinding, acknowledgement: RecoveryAcknowledgement): boolean {
  return sameRecoverySlot(binding.slot, acknowledgement.slot)
    && binding.value === acknowledgement.value
    && binding.value_digest === acknowledgement.value_digest
    && binding.operation_id === acknowledgement.operation_id
    && binding.edit_generation === acknowledgement.edit_generation
    && acknowledgement.revision === (binding.expected_revision ?? 0) + 1;
}

export function classifyRecoveryProjection(
  binding: RecoverySaveBinding,
  projection: RecoveryProjection,
  workspace: RecoveryWorkspaceReadback | null,
  elapsedMs: number,
): { state: "pending" | RecoveryTerminal["state"]; final: boolean } {
  if (projection.operation.state === "committed") {
    const exact = projection.operation.operation_id === binding.operation_id
      && projection.operation.value_digest === binding.value_digest
      && projection.operation.revision === (binding.expected_revision ?? 0) + 1;
    return exact ? { state: "saved", final: true } : { state: "conflict", final: true };
  }
  if (projection.operation.state === "conflict") return { state: "conflict", final: true };
  if (projection.host_operation_settled && workspace?.state === "matching_commit") {
    const exact = workspace.operation_id === binding.operation_id
      && workspace.value_digest === binding.value_digest
      && workspace.revision === (binding.expected_revision ?? 0) + 1;
    return exact ? { state: "saved", final: true } : { state: "conflict", final: true };
  }
  if (projection.host_operation_settled && workspace?.state === "different_commit") return { state: "conflict", final: true };
  if (projection.operation.state === "cancelled" && projection.host_operation_settled && workspace?.state === "no_commit") {
    return { state: "cancelled", final: true };
  }
  if (elapsedMs >= RECOVERY_RECONCILIATION_POLICY.final_authoritative_read_ms
      && projection.host_operation_settled && workspace?.state === "no_commit") {
    return { state: "not_saved", final: true };
  }
  return { state: "pending", final: false };
}

type GuardRecord = {
  key: string;
  bindingKey: string;
  intent: string;
  transition: () => Promise<void> | void;
  promise: Promise<boolean>;
  completed: boolean;
  superseded: boolean;
};

export class RecoverySaveCoordinator {
  static readonly MAX_RETAINED_IDENTITIES = 64;
  readonly #attempts = new Map<string, Promise<RecoveryTerminal>>();
  readonly #completedAttempts = new Map<string, RecoveryTerminal>();
  readonly #guards = new Map<string, GuardRecord>();
  readonly #completedGuards = new Set<string>();

  attempt(binding: RecoverySaveBinding, execute: () => Promise<RecoveryTerminal>): Promise<RecoveryTerminal> {
    const key = recoverySaveBindingKey(binding);
    const existing = this.#attempts.get(key);
    if (existing) return existing;
    const completed = this.#completedAttempts.get(key);
    if (completed) return Promise.resolve(completed);
    const promise = Promise.resolve().then(execute);
    this.#attempts.set(key, promise);
    void promise.then((result) => {
      if (this.#attempts.get(key) === promise) this.#attempts.delete(key);
      if (result.state === "saved") {
        this.#completedAttempts.set(key, result);
        this.#trimCompleted(this.#completedAttempts);
      }
    }, () => {
      if (this.#attempts.get(key) === promise) this.#attempts.delete(key);
    });
    return promise;
  }

  guard(
    binding: RecoverySaveBinding,
    intent: string,
    execute: () => Promise<RecoveryTerminal>,
    transition: () => Promise<void> | void,
  ): Promise<boolean> {
    const bindingKey = recoverySaveBindingKey(binding);
    const key = `${bindingKey}|${intent}`;
    if (this.#completedGuards.has(key)) return Promise.resolve(true);
    const existing = this.#guards.get(key);
    if (existing) return existing.promise;
    const record: GuardRecord = { key, bindingKey, intent, transition, promise: Promise.resolve(false), completed: false, superseded: false };
    record.promise = this.#run(record, binding, execute);
    this.#guards.set(key, record);
    return record.promise;
  }

  retry(binding: RecoverySaveBinding, execute: () => Promise<RecoveryTerminal>): Promise<boolean[]> {
    const bindingKey = recoverySaveBindingKey(binding);
    this.#attempts.delete(bindingKey);
    this.#completedAttempts.delete(bindingKey);
    const records = [...this.#guards.values()].filter((record) => record.bindingKey === bindingKey && !record.completed);
    const attempt = this.attempt(binding, execute);
    return Promise.all(records.map((record) => {
      record.promise = this.#continue(record, attempt);
      return record.promise;
    }));
  }

  waitingIntents(binding: RecoverySaveBinding): string[] {
    const bindingKey = recoverySaveBindingKey(binding);
    return [...this.#guards.values()]
      .filter((record) => record.bindingKey === bindingKey && !record.completed)
      .map((record) => record.intent)
      .sort();
  }

  discard(binding: RecoverySaveBinding): void {
    const bindingKey = recoverySaveBindingKey(binding);
    this.#attempts.delete(bindingKey);
    this.#completedAttempts.delete(bindingKey);
    for (const [key, record] of this.#guards) if (record.bindingKey === bindingKey && !record.completed) this.#guards.delete(key);
    for (const key of this.#completedGuards) if (key.startsWith(`${bindingKey}|`)) this.#completedGuards.delete(key);
  }

  supersedeUnfinishedIntents(): void {
    for (const [key, record] of this.#guards) {
      if (record.completed) continue;
      record.superseded = true;
      this.#guards.delete(key);
    }
  }

  retainedIdentityCounts(): { attempts: number; guardedIntents: number } {
    return {
      attempts: this.#attempts.size + this.#completedAttempts.size,
      guardedIntents: this.#guards.size + this.#completedGuards.size,
    };
  }

  #run(record: GuardRecord, binding: RecoverySaveBinding, execute: () => Promise<RecoveryTerminal>): Promise<boolean> {
    return this.#continue(record, this.attempt(binding, execute));
  }

  async #continue(record: GuardRecord, attempt: Promise<RecoveryTerminal>): Promise<boolean> {
    const result = await attempt;
    if (result.state !== "saved" || record.superseded) return false;
    if (!record.completed) {
      await record.transition();
      record.completed = true;
      this.#guards.delete(record.key);
      this.#completedGuards.add(record.key);
      this.#trimCompleted(this.#completedGuards);
    }
    return true;
  }

  #trimCompleted(collection: Map<string, unknown> | Set<string>): void {
    while (collection.size > RecoverySaveCoordinator.MAX_RETAINED_IDENTITIES) {
      const oldest = collection.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      collection.delete(oldest);
    }
  }
}

export function recoverySaveBindingKey(binding: RecoverySaveBinding): string {
  return `${binding.operation_id}|${binding.value_digest}|${binding.expected_revision ?? "new"}|generation:${binding.edit_generation}`;
}
