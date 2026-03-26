type BudgetCounter = {
  dateKey: string;
  calls: number;
};

export class AdjudicatorBudgetTracker {
  private readonly counters = new Map<string, BudgetCounter>();

  canRun(profileId: string, maxCallsPerDay: number): boolean {
    const today = new Date().toISOString().slice(0, 10);
    const current = this.counters.get(profileId);
    if (!current || current.dateKey !== today) {
      this.counters.set(profileId, { dateKey: today, calls: 0 });
      return true;
    }

    return current.calls < maxCallsPerDay;
  }

  markCall(profileId: string): void {
    const today = new Date().toISOString().slice(0, 10);
    const current = this.counters.get(profileId);
    if (!current || current.dateKey !== today) {
      this.counters.set(profileId, { dateKey: today, calls: 1 });
      return;
    }

    this.counters.set(profileId, {
      dateKey: today,
      calls: current.calls + 1,
    });
  }
}
