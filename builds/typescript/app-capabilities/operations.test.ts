import { describe, expect, it, vi } from "vitest";

import { CapabilityOperationCoordinator, type CapabilityOperationRequest } from "./operations.js";

const identity = {
  installationId: "10000000-0000-4000-8000-000000000001",
  connectionId: "10000000-0000-4000-8000-000000000002",
  viewId: "10000000-0000-4000-8000-000000000003",
};

function request(overrides: Partial<CapabilityOperationRequest> = {}): CapabilityOperationRequest {
  return {
    ...identity,
    capability: "resume.jobs.write" as const,
    capabilityVersion: 1,
    operationId: "10000000-0000-4000-8000-000000000004",
    idempotencyKey: "aaaaaaaaaaaaaaaa",
    input: { safe_label: "Synthetic role" },
    deadlineAt: Date.now() + 10_000,
    ...overrides,
  };
}

describe("M4 replay-safe capability operations", () => {
  it("coalesces concurrent and completed equivalent retries into one adapter call", async () => {
    const coordinator = new CapabilityOperationCoordinator();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const adapter = vi.fn(async () => { await pending; return { record_id: crypto.randomUUID() }; });
    const first = coordinator.execute(request(), adapter);
    const duplicate = coordinator.execute(request(), adapter);
    release();
    expect(await duplicate).toEqual(await first);
    expect(await coordinator.execute(request(), adapter)).toEqual(await first);
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched reuse without a second adapter call", async () => {
    const coordinator = new CapabilityOperationCoordinator();
    const adapter = vi.fn(async () => ({ status: "completed" }));
    await coordinator.execute(request(), adapter);
    await expect(coordinator.execute(request({ input: { safe_label: "Different role" } }), adapter)).rejects.toMatchObject({
      code: "idempotency_conflict",
      statusCode: 409,
    });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("enforces size, deadline, cancellation, and per-view rate bounds before side effects", async () => {
    let now = Date.now();
    const coordinator = new CapabilityOperationCoordinator({ now: () => now });
    const adapter = vi.fn(async () => ({ status: "completed" }));
    await expect(coordinator.execute(request({ input: { content: "x".repeat(262_145) } }), adapter)).rejects.toMatchObject({ code: "invalid_input", statusCode: 413 });
    await expect(coordinator.execute(request({ deadlineAt: now }), adapter)).rejects.toMatchObject({ code: "cancelled" });
    await expect(coordinator.execute(request({ isCancelled: () => true }), adapter)).rejects.toMatchObject({ code: "cancelled" });
    expect(adapter).not.toHaveBeenCalled();

    for (let index = 0; index < 100; index += 1) {
      await coordinator.execute(request({
        operationId: crypto.randomUUID(),
        idempotencyKey: `m4-rate-operation-${String(index).padStart(4, "0")}`,
        input: { index },
      }), adapter);
    }
    await expect(coordinator.execute(request({ operationId: crypto.randomUUID(), idempotencyKey: "m4-rate-operation-overflow", input: { index: 101 } }), adapter)).rejects.toMatchObject({ statusCode: 429 });
    now += 10_001;
    await expect(coordinator.execute(request({ operationId: crypto.randomUUID(), idempotencyKey: "m4-rate-operation-reset", input: { index: 102 }, deadlineAt: now + 10_000 }), adapter)).resolves.toEqual({ status: "completed" });
  });
});
