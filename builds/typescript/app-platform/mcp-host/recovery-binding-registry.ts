export class CurrentProcessRecoveryBindingRegistry<TBinding extends { lifecycleState: string }> {
  private readonly bindings = new Map<string, TBinding>();
  private readonly terminalOrder: Array<{ key: string; binding: TBinding }> = [];
  private readonly terminalKeys = new Set<string>();

  constructor(private readonly maximumTerminalEntries = 1_000) {
    if (!Number.isInteger(maximumTerminalEntries) || maximumTerminalEntries < 0) {
      throw new TypeError("Recovery binding terminal retention must be a non-negative integer");
    }
  }

  get(key: string): TBinding | undefined {
    return this.bindings.get(key);
  }

  remember(key: string, binding: TBinding): TBinding {
    const existing = this.bindings.get(key);
    if (existing) return existing;
    this.bindings.set(key, binding);
    return binding;
  }

  markTerminal(key: string): void {
    const binding = this.bindings.get(key);
    if (!binding || binding.lifecycleState === "pending" || this.terminalKeys.has(key)) return;
    this.terminalKeys.add(key);
    this.terminalOrder.push({ key, binding });
    this.pruneTerminalEntries();
  }

  stats(): { entries: number; pending: number; terminal: number } {
    return {
      entries: this.bindings.size,
      pending: [...this.bindings.values()].filter((binding) => binding.lifecycleState === "pending").length,
      terminal: this.terminalKeys.size,
    };
  }

  private pruneTerminalEntries(): void {
    while (this.terminalKeys.size > this.maximumTerminalEntries) {
      const oldest = this.terminalOrder.shift();
      if (!oldest) return;
      if (this.bindings.get(oldest.key) !== oldest.binding) continue;
      if (oldest.binding.lifecycleState === "pending") {
        this.terminalKeys.delete(oldest.key);
        continue;
      }
      this.bindings.delete(oldest.key);
      this.terminalKeys.delete(oldest.key);
    }
  }
}
