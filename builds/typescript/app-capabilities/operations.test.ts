import { afterEach, describe, expect, it, vi } from "vitest";

import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import { CapabilityOperationCoordinator, type CapabilityOperationDisposition, type CapabilityOperationRequest } from "./operations.js";

afterEach(() => vi.useRealTimers());

const identity = {
  appId: "ai.braindrive.resume-builder",
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
    const dispositions: CapabilityOperationDisposition[] = [];
    const coordinator = new CapabilityOperationCoordinator({ onDisposition: (event) => dispositions.push(event) });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const adapter = vi.fn(async () => { await pending; return { record_id: crypto.randomUUID() }; });
    const first = coordinator.execute(request(), adapter);
    const duplicate = coordinator.execute(request(), adapter);
    release();
    expect(await duplicate).toEqual(await first);
    expect(await coordinator.execute(request(), adapter)).toEqual(await first);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(dispositions.map(({ idempotencyDisposition, finalDisposition }) => [idempotencyDisposition, finalDisposition])).toEqual([
      ["created", "pending"],
      ["coalesced", "pending"],
      ["created", "completed"],
      ["coalesced", "completed"],
      ["replayed", "completed"],
    ]);
    expect(new Set(dispositions.map(({ operationId: id }) => id))).toEqual(new Set([request().operationId]));
  });

  it("rejects mismatched reuse without a second adapter call", async () => {
    const dispositions: CapabilityOperationDisposition[] = [];
    const coordinator = new CapabilityOperationCoordinator({ onDisposition: (event) => dispositions.push(event) });
    const adapter = vi.fn(async () => ({ status: "completed" }));
    await coordinator.execute(request(), adapter);
    await expect(coordinator.execute(request({ input: { safe_label: "Different role" } }), adapter)).rejects.toMatchObject({
      code: "idempotency_conflict",
      statusCode: 409,
    });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(dispositions.at(-1)).toMatchObject({
      idempotencyDisposition: "conflict",
      finalDisposition: "conflict",
      conflictClass: "idempotency_input_mismatch",
      errorCode: "idempotency_conflict",
    });
  });

  it("aborts at the exact host deadline, reports cancellation, and cleans failed identities for a fresh retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    const dispositions: CapabilityOperationDisposition[] = [];
    const coordinator = new CapabilityOperationCoordinator({ onDisposition: (event) => dispositions.push(event) });
    const deadlineAt = Date.now() + 120_000;
    const adapter = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise<{ status: string }>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new AppPlatformError("cancelled", "Synthetic host deadline", 408)), { once: true });
    }));
    const pending = coordinator.execute(request({ deadlineAt }), adapter);
    const rejected = expect(pending).rejects.toMatchObject({ code: "cancelled", statusCode: 408 });
    await vi.advanceTimersByTimeAsync(120_000);
    await rejected;
    expect(dispositions.at(-1)).toMatchObject({
      idempotencyDisposition: "created",
      finalDisposition: "cancelled",
      errorCode: "cancelled",
      elapsedMs: 120_000,
    });
    await expect(coordinator.execute(request({ deadlineAt: Date.now() + 1_000 }), async () => ({ status: "retried" })))
      .resolves.toEqual({ status: "retried" });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("rejects the caller at 120 seconds while retaining pending lifecycle identity until no-commit cleanup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    const coordinator = new CapabilityOperationCoordinator();
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve; });
    const pending = coordinator.execute(request({ deadlineAt: Date.now() + 120_000 }), async ({ signal }) => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      await cleanup;
      throw new AppPlatformError("cancelled", "Synthetic atomic work quiesced", 408);
    });
    const callerDeadline = expect(pending).rejects.toMatchObject({ code: "cancelled", statusCode: 408 });

    await vi.advanceTimersByTimeAsync(120_000);
    await callerDeadline;
    const lifecycle = coordinator.inspectLifecycle({
      appId: identity.appId,
      installationId: identity.installationId,
      capability: request().capability,
      operationId: request().operationId,
    });
    expect(lifecycle).toMatchObject({ state: "pending", inputDigest: expect.stringMatching(/^sha256:/) });
    const equalRetryAdapter = vi.fn();
    await expect(coordinator.execute(request({ deadlineAt: Date.now() + 1_000 }), equalRetryAdapter))
      .rejects.toMatchObject({ code: "cancelled", statusCode: 408 });
    const changedRetryAdapter = vi.fn();
    await expect(coordinator.execute(request({ deadlineAt: Date.now() + 1_000, input: { safe_label: "Changed" } }), changedRetryAdapter))
      .rejects.toMatchObject({ code: "idempotency_conflict", statusCode: 409 });
    expect(equalRetryAdapter).not.toHaveBeenCalled();
    expect(changedRetryAdapter).not.toHaveBeenCalled();

    releaseCleanup();
    await expect(lifecycle!.settled).resolves.toMatchObject({ state: "cancelled", errorCode: "cancelled" });
    await expect(coordinator.execute(request({ deadlineAt: Date.now() + 1_000 }), async () => ({ status: "retried" })))
      .resolves.toEqual({ status: "retried" });
  });

  it("retains a late committed lifecycle for authoritative readback and replay after caller deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    const coordinator = new CapabilityOperationCoordinator();
    let publish!: () => void;
    const publication = new Promise<void>((resolve) => { publish = resolve; });
    const adapter = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      await publication;
      return { reused: false, status: "committed" };
    });
    const pending = coordinator.execute(request({ deadlineAt: Date.now() + 120_000 }), adapter);
    const callerDeadline = expect(pending).rejects.toMatchObject({ code: "cancelled", statusCode: 408 });
    await vi.advanceTimersByTimeAsync(120_000);
    await callerDeadline;
    const lifecycle = coordinator.inspectLifecycle({
      appId: identity.appId,
      installationId: identity.installationId,
      capability: request().capability,
      operationId: request().operationId,
    });
    expect(lifecycle?.state).toBe("pending");
    publish();
    await expect(lifecycle!.settled).resolves.toMatchObject({ state: "completed", errorCode: null });
    await expect(coordinator.execute(request({ deadlineAt: Date.now() + 1_000 }), adapter))
      .resolves.toEqual({ reused: true, status: "committed" });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("isolates observer failures from committed results and replay identity", async () => {
    const coordinator = new CapabilityOperationCoordinator({ onDisposition: () => { throw new Error("synthetic observer failure"); } });
    const adapter = vi.fn(async () => ({ reused: false, status: "committed" }));
    await expect(coordinator.execute(request(), adapter)).resolves.toEqual({ reused: false, status: "committed" });
    await expect(coordinator.execute(request(), adapter)).resolves.toEqual({ reused: true, status: "committed" });
    expect(adapter).toHaveBeenCalledTimes(1);

    const sourceError = new AppPlatformError("denied", "Synthetic adapter denial", 403);
    await expect(coordinator.execute(request({ operationId: crypto.randomUUID(), idempotencyKey: "observer-source-error", input: { safe_label: "Denied" } }), async () => {
      throw sourceError;
    })).rejects.toBe(sourceError);
  });

  it("scopes identical operation and idempotency identities by app and installation", async () => {
    const coordinator = new CapabilityOperationCoordinator();
    const adapter = vi.fn(async () => ({ status: "completed" }));
    await coordinator.execute(request(), adapter);
    await coordinator.execute(request({ appId: "ai.braindrive.brief-builder" }), adapter);
    expect(adapter).toHaveBeenCalledTimes(2);
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
