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
      idempotencyKey: "m4-token-operation-0001",
      tokenGeneration: 7,
      ttlMs: 60_000,
    });

    expect(broker.consume(issued.token, {
      audience: "app_data", capability: "career.context.read", installationId: grant.installation_id,
      ownerId: grant.owner_id, actorId: grant.actor_id, appId: grant.app_id, publisherId: grant.publisher_id,
      packageDigest: grant.package_digest, grantId: grant.grant_id, grantRevision: grant.grant_revision,
      revocationGeneration: grant.revocation_generation, tokenGeneration: 7,
      connectionId: issued.claims.connection_id, viewId: null, operationId: issued.claims.operation_id,
      idempotencyKey: "m4-token-operation-0001", recordScopes: grant.record_scopes, currentGrant: grant,
    }).token_id)
      .toBe(issued.claims.token_id);
    expect(() => broker.consume(issued.token, { audience: "app_data", capability: "career.context.read", installationId: grant.installation_id }))
      .toThrowError(expect.objectContaining({ code: "token_replayed" }));

    const second = broker.issue({ grant, audience: "app_data", capabilities: ["career.context.read"], connectionId: crypto.randomUUID(), operationId: crypto.randomUUID(), idempotencyKey: "m4-token-operation-0002", tokenGeneration: 7, ttlMs: 60_000 });
    broker.revokeInstallation(grant.installation_id);
    expect(() => broker.consume(second.token, { audience: "app_data", capability: "career.context.read", installationId: grant.installation_id }))
      .toThrowError(expect.objectContaining({ code: "token_revoked" }));
    broker.permitInstallation(grant.installation_id);
    const expired = broker.issue({ grant, audience: "app_data", capabilities: ["career.context.read"], connectionId: crypto.randomUUID(), operationId: crypto.randomUUID(), idempotencyKey: "m4-token-operation-expiry", tokenGeneration: 7, ttlMs: 1_000 });
    vi.advanceTimersByTime(1_001);
    expect(() => broker.consume(expired.token, { audience: "app_data", capability: "career.context.read", installationId: grant.installation_id }))
      .toThrowError(expect.objectContaining({ code: "token_expired" }));
    vi.useRealTimers();
  });

  it("rejects widened grants and audience confusion", () => {
    const grant = makeGrant();
    const broker = new CapabilityTokenBroker();
    expect(() => broker.issue({ grant, audience: "app_export", capabilities: ["career.context.read"], connectionId: crypto.randomUUID(), operationId: crypto.randomUUID(), idempotencyKey: "m4-token-operation-0003", tokenGeneration: 1, ttlMs: 60_000 }))
      .toThrowError(expect.objectContaining({ code: "token_audience_invalid" }));
    expect(() => broker.issue({ grant, audience: "app_data", capabilities: ["resume.jobs.write"], connectionId: crypto.randomUUID(), operationId: crypto.randomUUID(), idempotencyKey: "m4-token-operation-0004", tokenGeneration: 1, ttlMs: 60_000 }))
      .toThrowError(expect.objectContaining({ code: "widened_grant" }));
    expect(() => broker.issue({ grant, audience: "app_data", capabilities: ["career.context.read"], connectionId: crypto.randomUUID(), operationId: crypto.randomUUID(), idempotencyKey: "m4-token-scope-widening", tokenGeneration: 1, recordScopes: [crypto.randomUUID()], ttlMs: 60_000 }))
      .toThrowError(expect.objectContaining({ code: "widened_grant" }));
    expect(() => broker.issue({ grant, audience: "app_data", capabilities: ["career.context.read"], connectionId: crypto.randomUUID(), operationId: crypto.randomUUID(), idempotencyKey: "m4-token-long-lifetime", tokenGeneration: 1, ttlMs: 5 * 60_000 + 1 }))
      .toThrowError(expect.objectContaining({ code: "token_invalid" }));
  });

  it("rejects forgery and every wrong grant, package, connection, view, operation, generation, and idempotency binding", () => {
    const grant = makeGrant();
    const broker = new CapabilityTokenBroker();
    const connectionId = crypto.randomUUID();
    const viewId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const issued = broker.issue({ grant, audience: "app_data", capabilities: ["career.context.read"], connectionId, viewId, operationId, idempotencyKey: "m4-token-exact-binding", tokenGeneration: 3, ttlMs: 60_000 });
    const expected = {
      audience: "app_data" as const, capability: "career.context.read" as const, installationId: grant.installation_id,
      ownerId: grant.owner_id, actorId: grant.actor_id, appId: grant.app_id, publisherId: grant.publisher_id,
      packageDigest: grant.package_digest, grantId: grant.grant_id, grantRevision: grant.grant_revision,
      revocationGeneration: grant.revocation_generation, tokenGeneration: 3, connectionId, viewId, operationId,
      idempotencyKey: "m4-token-exact-binding", recordScopes: grant.record_scopes, currentGrant: grant,
    };
    expect(() => broker.consume("forged-token-value-that-does-not-exist", expected)).toThrowError(expect.objectContaining({ code: "token_invalid" }));
    for (const override of [
      { ownerId: crypto.randomUUID() }, { actorId: crypto.randomUUID() }, { appId: "different.app" },
      { publisherId: "different.publisher" }, { packageDigest: `sha256:${"f".repeat(64)}` }, { grantId: crypto.randomUUID() },
      { grantRevision: 2 }, { revocationGeneration: 1 }, { tokenGeneration: 4 }, { connectionId: crypto.randomUUID() },
      { viewId: crypto.randomUUID() }, { operationId: crypto.randomUUID() }, { idempotencyKey: "m4-token-different-key" },
      { recordScopes: [crypto.randomUUID()] },
    ]) {
      expect(() => broker.consume(issued.token, { ...expected, ...override })).toThrowError(expect.objectContaining({ code: "token_scope_invalid" }));
    }
    expect(broker.consume(issued.token, expected).token_id).toBe(issued.claims.token_id);
  });

  it("revokes exact connection and view authority without widening to unrelated views", () => {
    const grant = makeGrant();
    const broker = new CapabilityTokenBroker();
    const connectionId = crypto.randomUUID();
    const firstView = crypto.randomUUID();
    const secondView = crypto.randomUUID();
    const issue = (viewId: string, key: string) => broker.issue({
      grant, audience: "app_data", capabilities: ["career.context.read"], connectionId, viewId,
      operationId: crypto.randomUUID(), idempotencyKey: key, tokenGeneration: 2, ttlMs: 60_000,
    });
    const revokedView = issue(firstView, "m4-view-revocation-0001");
    const liveView = issue(secondView, "m4-view-revocation-0002");
    broker.revokeView(firstView);
    expect(() => broker.consume(revokedView.token, { audience: "app_data", capability: "career.context.read", installationId: grant.installation_id })).toThrowError(expect.objectContaining({ code: "token_revoked" }));
    expect(broker.consume(liveView.token, { audience: "app_data", capability: "career.context.read", installationId: grant.installation_id }).view_id).toBe(secondView);
    const connectionToken = issue(secondView, "m4-connection-revocation");
    broker.revokeConnection(connectionId);
    expect(() => broker.consume(connectionToken.token, { audience: "app_data", capability: "career.context.read", installationId: grant.installation_id })).toThrowError(expect.objectContaining({ code: "token_revoked" }));
  });
});
