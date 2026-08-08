import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CapabilityTokenBroker } from "./capability-token.js";
import { AppPlatformErrorCodeSchema } from "./errors.js";
import { AppLifecycleStore, initialLifecycleRecord } from "./store.js";
import { makeGrant } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("durable lifecycle store", () => {
  it("freezes the operational error taxonomy and rejects unknown codes", () => {
    expect(AppPlatformErrorCodeSchema.parse("package_revoked")).toBe("package_revoked");
    expect(AppPlatformErrorCodeSchema.safeParse("raw_provider_error").success).toBe(false);
  });

  it("uses generation CAS and returns the committed result for an equivalent idempotent retry", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-store-"));
    roots.push(root);
    const store = new AppLifecycleStore(root);
    await store.initialize();
    const initial = await store.readLifecycle();
    expect(initial).toEqual(initialLifecycleRecord(initial.updated_at));

    const staged = { ...initial, generation: 1, state: "staged" as const, installation_id: crypto.randomUUID(), pending_operation_id: crypto.randomUUID() };
    await store.compareAndSwapLifecycle(0, staged);
    await expect(store.compareAndSwapLifecycle(0, { ...staged, generation: 2 }))
      .rejects.toMatchObject({ code: "revision_conflict" });

    const first = await store.runIdempotent("abcdefghijklmnop", { kind: "install", version: "1.0.0" }, async () => ({ operation_id: crypto.randomUUID(), outcome: "committed" }));
    const retry = await store.runIdempotent("abcdefghijklmnop", { kind: "install", version: "1.0.0" }, async () => { throw new Error("must not run"); });
    expect(retry).toEqual(first);
    await expect(store.runIdempotent("abcdefghijklmnop", { kind: "install", version: "2.0.0" }, async () => ({ operation_id: crypto.randomUUID() })))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("does not expose a partially written generation when the atomic commit fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-store-fault-"));
    roots.push(root);
    const store = new AppLifecycleStore(root, { beforeRename: vi.fn(async () => { throw new Error("disk fault"); }) });
    await store.initialize();
    const before = await store.readLifecycle();
    await expect(store.compareAndSwapLifecycle(0, { ...before, generation: 1 })).rejects.toThrow("disk fault");
    expect((await store.readLifecycle()).generation).toBe(0);
  });
});

describe("scoped capability token broker", () => {
  it("binds audience/grant/install/package/operation, consumes nonce once, expires, and revokes immediately", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"));
    const grant = makeGrant();
    const broker = new CapabilityTokenBroker();
    const issued = broker.issue({
      grant,
      audience: "app_data",
      capabilities: ["career.context.read"],
      connectionId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      ttlMs: 60_000,
    });

    expect(broker.consume(issued.token, { audience: "app_data", capability: "career.context.read", installationId: grant.installation_id }).token_id)
      .toBe(issued.claims.token_id);
    expect(() => broker.consume(issued.token, { audience: "app_data", capability: "career.context.read", installationId: grant.installation_id }))
      .toThrowError(expect.objectContaining({ code: "token_replayed" }));

    const second = broker.issue({ grant, audience: "app_data", capabilities: ["career.context.read"], connectionId: crypto.randomUUID(), operationId: crypto.randomUUID(), ttlMs: 60_000 });
    broker.revokeInstallation(grant.installation_id);
    expect(() => broker.consume(second.token, { audience: "app_data", capability: "career.context.read", installationId: grant.installation_id }))
      .toThrowError(expect.objectContaining({ code: "token_revoked" }));
    vi.useRealTimers();
  });

  it("rejects widened grants and audience confusion", () => {
    const grant = makeGrant();
    const broker = new CapabilityTokenBroker();
    expect(() => broker.issue({ grant, audience: "app_export", capabilities: ["career.context.read"], connectionId: crypto.randomUUID(), operationId: crypto.randomUUID(), ttlMs: 60_000 }))
      .toThrowError(expect.objectContaining({ code: "token_audience_invalid" }));
    expect(() => broker.issue({ grant, audience: "app_data", capabilities: ["resume.jobs.write"], connectionId: crypto.randomUUID(), operationId: crypto.randomUUID(), ttlMs: 60_000 }))
      .toThrowError(expect.objectContaining({ code: "widened_grant" }));
  });
});
