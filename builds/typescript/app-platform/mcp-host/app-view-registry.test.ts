import { describe, expect, it } from "vitest";

import { AppViewRegistry, type AppViewAuthority } from "./app-view-registry.js";

const installationId = "10000000-0000-4000-8000-000000000001";
const packageDigest = `sha256:${"a".repeat(64)}` as const;

function authority(overrides: Partial<AppViewAuthority> = {}): AppViewAuthority {
  return {
    installationId,
    packageDigest,
    lifecycleGeneration: 3,
    connectionId: "10000000-0000-4000-8000-000000000002",
    connectionGeneration: 7,
    entryPoint: "direct",
    ...overrides,
  };
}

describe("M7 app view reconnect registry", () => {
  it("rotates session and bridge generation while retaining view and operation identity", () => {
    const registry = new AppViewRegistry();
    const firstPlan = registry.plan(authority());
    const first = registry.commit(firstPlan);
    const resumedPlan = registry.plan(authority({
      connectionId: "10000000-0000-4000-8000-000000000003",
      connectionGeneration: 8,
    }), {
      sessionId: first.sessionId,
      viewId: first.viewId,
      operationId: first.operationId,
      bridgeGeneration: first.bridgeGeneration,
    });
    const resumed = registry.commit(resumedPlan);

    expect(resumed).toMatchObject({
      viewId: first.viewId,
      operationId: first.operationId,
      bridgeGeneration: 2,
      resumed: true,
      supersededSessionId: first.sessionId,
      connectionId: "10000000-0000-4000-8000-000000000003",
      connectionGeneration: 8,
    });
    expect(resumed.sessionId).not.toBe(first.sessionId);
    expect(registry.isCurrentSession(first.sessionId)).toBe(false);
    expect(registry.isCurrentSession(resumed.sessionId)).toBe(true);
  });

  it("rejects stale, mismatched, and racing resume handshakes without replacing the live view", () => {
    const registry = new AppViewRegistry();
    const first = registry.commit(registry.plan(authority()));
    const request = {
      sessionId: first.sessionId,
      viewId: first.viewId,
      operationId: first.operationId,
      bridgeGeneration: first.bridgeGeneration,
    };
    const racingPlan = registry.plan(authority(), request);
    expect(() => registry.plan(authority(), { ...request, operationId: crypto.randomUUID() }))
      .toThrowError(expect.objectContaining({ code: "session_closed" }));
    const resumed = registry.commit(registry.plan(authority(), request));
    expect(() => registry.commit(racingPlan)).toThrowError(expect.objectContaining({ code: "session_closed" }));
    expect(registry.isCurrentSession(resumed.sessionId)).toBe(true);
  });

  it("keeps concurrent views and exact close authority isolated", () => {
    const registry = new AppViewRegistry({ maxViewsPerInstallation: 2 });
    const first = registry.commit(registry.plan(authority()));
    const second = registry.commit(registry.plan(authority({ entryPoint: "career" })));
    expect(first.viewId).not.toBe(second.viewId);
    expect(first.operationId).not.toBe(second.operationId);
    expect(() => registry.plan(authority())).toThrowError(expect.objectContaining({ code: "denied" }));

    expect(registry.close(first.sessionId)).toEqual({ closed: true, viewId: first.viewId });
    expect(registry.isCurrentSession(second.sessionId)).toBe(true);
    expect(registry.close(first.sessionId)).toEqual({ closed: false, viewId: null });
    expect(registry.commit(registry.plan(authority()))).toMatchObject({ bridgeGeneration: 1, resumed: false });
  });

  it("expires transient views and refuses reconnect after lifecycle authority changes", () => {
    let now = Date.parse("2026-08-09T12:00:00.000Z");
    const registry = new AppViewRegistry({ now: () => now, ttlMs: 1_000 });
    const first = registry.commit(registry.plan(authority()));
    expect(() => registry.plan(authority({ lifecycleGeneration: 4 }), {
      sessionId: first.sessionId,
      viewId: first.viewId,
      operationId: first.operationId,
      bridgeGeneration: first.bridgeGeneration,
    })).toThrowError(expect.objectContaining({ code: "session_closed" }));
    now += 1_001;
    expect(registry.isCurrentSession(first.sessionId)).toBe(false);
    expect(registry.viewCountForTest()).toBe(0);
  });
});
