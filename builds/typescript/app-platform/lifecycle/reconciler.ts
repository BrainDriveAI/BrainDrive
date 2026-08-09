import type { DurableLifecycleResult, LifecycleStore } from "./durable-store.js";

export type LifecycleReconciliation = {
  operationId: string;
  result: DurableLifecycleResult;
};

/**
 * Restart-only M2 reconciliation. It reads durable intent and repairs pointers
 * or terminal journal state; it has no package, process, grant, or owner-data
 * adapter and therefore cannot execute or delete application data.
 */
export class LifecycleReconciler {
  constructor(private readonly store: LifecycleStore) {}

  async reconcile(): Promise<LifecycleReconciliation[]> {
    const journals = await this.store.listJournals();
    const pending = journals.filter((journal) =>
      !["committed", "rolled_back", "failed_recoverable"].includes(journal.status));
    const results: LifecycleReconciliation[] = [];
    for (const journal of pending) {
      results.push({
        operationId: journal.operation_id,
        result: await this.store.reconcileOperation(journal.operation_id),
      });
    }
    return results;
  }
}
