import { describe, expect, it } from "vitest";

import { CurrentProcessRecoveryBindingRegistry } from "./recovery-binding-registry.js";

type Binding = { lifecycleState: "pending" | "completed" | "cancelled" | "failed" };

describe("current-process recovery binding registry", () => {
  it("bounds terminal retention without evicting pending lifecycle evidence under pressure", () => {
    const registry = new CurrentProcessRecoveryBindingRegistry<Binding>(3);
    const pending = { lifecycleState: "pending" as const };
    registry.remember("pending", pending);

    for (let index = 0; index < 20; index += 1) {
      const terminal = { lifecycleState: "failed" as const };
      const key = `terminal-${index}`;
      registry.remember(key, terminal);
      registry.markTerminal(key);
    }

    expect(registry.stats()).toEqual({ entries: 4, pending: 1, terminal: 3 });
    expect(registry.get("pending")).toBe(pending);
    expect(registry.get("terminal-0")).toBeUndefined();
    expect(registry.get("terminal-19")).toEqual({ lifecycleState: "failed" });
  });

  it("preserves the first binding and makes a settled pending entry eligible for bounded eviction", () => {
    const registry = new CurrentProcessRecoveryBindingRegistry<Binding>(1);
    const pending: Binding = { lifecycleState: "pending" };
    expect(registry.remember("operation", pending)).toBe(pending);
    expect(registry.remember("operation", { lifecycleState: "failed" })).toBe(pending);

    pending.lifecycleState = "cancelled";
    registry.markTerminal("operation");
    registry.remember("new-terminal", { lifecycleState: "completed" });
    registry.markTerminal("new-terminal");

    expect(registry.get("operation")).toBeUndefined();
    expect(registry.stats()).toEqual({ entries: 1, pending: 0, terminal: 1 });
  });
});
