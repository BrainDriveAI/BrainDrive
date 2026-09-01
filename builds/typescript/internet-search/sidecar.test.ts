import { describe, expect, it } from "vitest";

import { InternetSearchCapabilityRegistry } from "./registry.js";
import {
  SearxngSidecarLifecycle,
  assertPrivateSearxngBinding,
  type SearxngSidecarBinding,
  type SearxngSidecarDriver,
} from "./sidecar.js";

class FakeSearxngDriver implements SearxngSidecarDriver {
  installed = false;
  running = false;
  healthy = true;
  installCount = 0;
  startCount = 0;
  stopCount = 0;
  uninstallCount = 0;
  healthCount = 0;
  cleanupCount = 0;

  async install(): Promise<void> {
    this.installed = true;
    this.installCount += 1;
  }

  async start(): Promise<void> {
    this.running = true;
    this.startCount += 1;
  }

  async health(): Promise<{ healthy: boolean; error_code: string | null }> {
    this.healthCount += 1;
    return { healthy: this.running && this.healthy, error_code: this.healthy ? null : "health_failed" };
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopCount += 1;
  }

  async uninstall(): Promise<void> {
    this.installed = false;
    this.running = false;
    this.uninstallCount += 1;
  }

  async cleanup(): Promise<void> {
    this.cleanupCount += 1;
  }
}

const privateBinding: SearxngSidecarBinding = {
  transport: "container_internal",
  endpoint_url: "http://internet-search-searxng:8080",
};

function lifecycleWith(driver = new FakeSearxngDriver(), adapterHealthy = true) {
  return new SearxngSidecarLifecycle({
    driver,
    binding: privateBinding,
    now: () => "2026-09-01T00:00:00.000Z",
    sleep: async () => undefined,
    readinessTimeoutMs: 1,
    readinessPollMs: 1,
    adapterHealth: () => adapterHealthy,
  });
}

function assertNoSensitiveProjection(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(/internet-search-searxng|searxng-local|https?:|localhost|127\.|0\.0\.0\.0|\bport\b|credential|secret|vault|\/(?:home|tmp|etc|var|Users)\//i);
}

describe("SearXNG sidecar lifecycle", () => {
  it("gates Internet Search discovery until install, start, and readiness succeed", async () => {
    const driver = new FakeSearxngDriver();
    const lifecycle = lifecycleWith(driver);
    const registry = new InternetSearchCapabilityRegistry(undefined, { statusProvider: lifecycle });

    expect(registry.discover("web.search@1", { authorized: true })).toMatchObject({
      state: "unavailable",
      callable: false,
      capability: null,
    });

    const started = await lifecycle.start();

    expect(started).toMatchObject({ installed: true, lifecycle_state: "available", health: { state: "healthy" } });
    expect(driver.installCount).toBe(1);
    expect(driver.startCount).toBe(1);

    const projection = registry.discover("web.search@1", { authorized: true });
    expect(projection).toMatchObject({
      state: "available",
      callable: true,
      capability: { capability_id: "internet-search" },
      provider_profile: { profile_id: "local-owner-managed" },
      health: { state: "healthy" },
    });
    assertNoSensitiveProjection(projection);
  });

  it("keeps discovery unavailable when readiness times out", async () => {
    const driver = new FakeSearxngDriver();
    driver.healthy = false;
    const lifecycle = lifecycleWith(driver);
    const registry = new InternetSearchCapabilityRegistry(undefined, { statusProvider: lifecycle });

    const started = await lifecycle.start();

    expect(started).toMatchObject({
      installed: true,
      lifecycle_state: "unavailable",
      health: { state: "unhealthy" },
      safe_message: "Internet Search needs attention.",
    });
    expect(registry.discover("web.read@1", { authorized: true })).toMatchObject({
      state: "unhealthy",
      callable: false,
      message: "Internet Search needs attention.",
    });
    assertNoSensitiveProjection(lifecycle.diagnostics());
  });

  it("degrades health and discovery after a sidecar crash", async () => {
    const driver = new FakeSearxngDriver();
    const lifecycle = lifecycleWith(driver);
    const registry = new InternetSearchCapabilityRegistry(undefined, { statusProvider: lifecycle });

    await lifecycle.start();
    driver.running = false;

    expect(await lifecycle.health()).toMatchObject({
      lifecycle_state: "unavailable",
      health: { state: "unhealthy" },
    });
    expect(registry.discover("web.search@1", { authorized: true })).toMatchObject({
      state: "unhealthy",
      callable: false,
    });
  });

  it("sanitizes driver-provided diagnostic error codes at the lifecycle boundary", async () => {
    const driver = new FakeSearxngDriver();
    driver.healthy = false;
    driver.health = async () => {
      driver.healthCount += 1;
      return { healthy: false, error_code: "CANARY_SECRET http://internet-search-searxng:8080 /home/canary/log" };
    };
    const lifecycle = new SearxngSidecarLifecycle({
      driver,
      binding: privateBinding,
      installed: true,
      now: () => "2026-09-01T00:00:00.000Z",
    });

    await lifecycle.health();

    expect(lifecycle.diagnostics()).toContainEqual(expect.objectContaining({
      action: "health",
      error_code: "unknown",
    }));
    assertNoSensitiveProjection(lifecycle.diagnostics());
  });

  it("requires adapter health before advertising availability", async () => {
    const driver = new FakeSearxngDriver();
    const lifecycle = lifecycleWith(driver, false);
    const registry = new InternetSearchCapabilityRegistry(undefined, { statusProvider: lifecycle });

    await lifecycle.start();

    expect(lifecycle.snapshot()).toMatchObject({
      lifecycle_state: "available",
      health: { state: "unhealthy" },
      safe_message: "Internet Search needs attention.",
    });
    expect(registry.discover("web.search@1", { authorized: true })).toMatchObject({
      state: "unhealthy",
      callable: false,
    });
  });

  it("restarts, stops, uninstalls, and records cleanup without leaving discovery callable", async () => {
    const driver = new FakeSearxngDriver();
    const lifecycle = lifecycleWith(driver);
    const registry = new InternetSearchCapabilityRegistry(undefined, { statusProvider: lifecycle });

    await lifecycle.start();
    await lifecycle.restart();
    expect(driver.stopCount).toBe(1);
    expect(driver.startCount).toBe(2);
    expect(registry.discover("web.read@1", { authorized: true })).toMatchObject({ state: "available" });

    await lifecycle.stop("operator_stop");
    expect(registry.discover("web.read@1", { authorized: true })).toMatchObject({
      state: "unavailable",
      callable: false,
      health: { state: "unknown" },
    });

    await lifecycle.uninstall();
    expect(driver.uninstallCount).toBe(1);
    expect(driver.cleanupCount).toBe(1);
    expect(registry.discover("web.read@1", { authorized: true })).toMatchObject({
      state: "unavailable",
      callable: false,
      capability: null,
      provider_profile: null,
      health: null,
      message: "Internet Search is not installed.",
    });
  });

  it("rejects public, credential-bearing, and non-loopback sidecar bindings", () => {
    expect(() => assertPrivateSearxngBinding(privateBinding)).not.toThrow();
    expect(() => assertPrivateSearxngBinding({ transport: "loopback", endpoint_url: "http://127.0.0.1:8080" })).not.toThrow();
    expect(() => assertPrivateSearxngBinding({ transport: "loopback", endpoint_url: "http://0.0.0.0:8080" })).toThrow(/private/i);
    expect(() => assertPrivateSearxngBinding({ transport: "loopback", endpoint_url: "http://10.0.0.12:8080" })).toThrow(/private/i);
    expect(() => assertPrivateSearxngBinding({ transport: "container_internal", endpoint_url: "http://user:pass@internet-search-searxng:8080" })).toThrow(/credentials/i);
  });
});
