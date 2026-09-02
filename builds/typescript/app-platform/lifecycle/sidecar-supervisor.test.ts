import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { PackageComponentManifest } from "../contracts/package-components.js";
import { InstalledPackageStore } from "./installed-package-store.js";
import {
  GenericSidecarSupervisor,
  type PrivateSidecarBindingCandidate,
  type SidecarRuntimeDriver,
  type SidecarRuntimeDriverContext,
} from "./sidecar-supervisor.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

type Corpus = {
  valid_cases: Array<{ fixture_id: string; manifest?: PackageComponentManifest }>;
};

class FakeSidecarDriver implements SidecarRuntimeDriver {
  running = false;
  healthy = true;
  startCount = 0;
  stopCount = 0;
  uninstallCount = 0;
  cleanupCount = 0;
  healthCount = 0;
  errorCode: string | null = null;

  constructor(
    readonly runtimeKind: "container" | "packaged_process",
    private readonly candidate: PrivateSidecarBindingCandidate,
  ) {}

  async start(_context: SidecarRuntimeDriverContext): Promise<PrivateSidecarBindingCandidate> {
    this.running = true;
    this.startCount += 1;
    return this.candidate;
  }

  async health(_context: SidecarRuntimeDriverContext) {
    this.healthCount += 1;
    return { healthy: this.running && this.healthy, error_code: this.errorCode };
  }

  async stop(_context: SidecarRuntimeDriverContext): Promise<void> {
    this.running = false;
    this.stopCount += 1;
  }

  async uninstall(_context: SidecarRuntimeDriverContext): Promise<void> {
    this.running = false;
    this.uninstallCount += 1;
  }

  async cleanup(_context: SidecarRuntimeDriverContext): Promise<void> {
    this.cleanupCount += 1;
  }
}

async function fixture(fixtureId: string): Promise<PackageComponentManifest> {
  const raw = await readFile(new URL("../contracts/fixtures/sidecar-package/sc-001-conformance-corpus.json", import.meta.url), "utf8");
  const source = JSON.parse(raw) as Corpus;
  const manifest = source.valid_cases.find((candidate) => candidate.fixture_id === fixtureId)?.manifest;
  if (!manifest) throw new Error(`missing fixture: ${fixtureId}`);
  return JSON.parse(JSON.stringify(manifest)) as PackageComponentManifest;
}

function digest(seed: string): `sha256:${string}` {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

async function installFixture(fixtureId: string, seed = "a") {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-sc003-sidecar-"));
  roots.push(root);
  const store = new InstalledPackageStore(root);
  await store.initialize();
  const manifest = await fixture(fixtureId);
  await store.installPackage({
    manifest,
    packageDigest: digest(seed),
    source: { kind: "repository_fixture", label: "Synthetic SC-003 sidecar fixture" },
    installedAt: "2026-09-01T12:00:00.000Z",
  });
  return { store, manifest };
}

function assertNoPrivateRuntimeProjection(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(/https?:|127\.|localhost|0\.0\.0\.0|\bport\b|"endpoint"\s*:|authorization|credential|secret|token|container_id|process_id|host_path|payload\/|\/(?:home|tmp|etc|var|Users)\//i);
}

function expectSyncErrorCode(action: () => void, code: string): void {
  let thrown: unknown;
  try { action(); } catch (error) { thrown = error; }
  expect(thrown).toMatchObject({ code });
}

describe("SC-003 generic sidecar supervisor and private binding", () => {
  it("starts, readies, health-checks, restarts, stops, and uninstalls a provider sidecar by descriptor", async () => {
    const { store, manifest } = await installFixture("valid-provider-sidecar", "b");
    const driver = new FakeSidecarDriver("container", {
      transport: "container_internal",
      endpoint: "http://search-runtime:8080",
      authorization: "private-driver-authority",
    });
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const supervisor = new GenericSidecarSupervisor({
      store,
      target: "docker_linux_x64",
      drivers: [driver],
      readinessPollMs: 1,
      audit: (event, details) => events.push({ event, details }),
    });

    const started = await supervisor.start({ packageId: manifest.package_id, componentId: "search.runtime", authority: { kind: "host" } });
    expect(started).toMatchObject({
      component_id: "search.runtime",
      owner_component_id: "search.provider",
      state: "starting",
      health: "unknown",
      binding: { audience: "provider_adapter_only", endpoint_class: "container_internal_authenticated", public_bind: false },
    });
    assertNoPrivateRuntimeProjection(started);

    const ready = await supervisor.awaitReadiness({ packageId: manifest.package_id, componentId: "search.runtime", authority: { kind: "host" } });
    expect(ready).toMatchObject({ state: "running", health: "healthy" });
    expect(await store.readComponent(manifest.package_id, "search.runtime")).toMatchObject({ state: "running", health: "healthy" });
    expect(await supervisor.health({ packageId: manifest.package_id, componentId: "search.runtime", authority: { kind: "host" } })).toMatchObject({ state: "running", health: "healthy" });

    const adapterBinding = supervisor.bindingService.bindingForProviderAdapter(manifest.package_id, "search.runtime", "search.provider");
    expect(adapterBinding).toMatchObject({ endpoint: "http://search-runtime:8080", authorization: "private-driver-authority" });
    expectSyncErrorCode(() => supervisor.bindingService.bindingForConsumer(manifest.package_id, "search.runtime"), "denied");

    const restarted = await supervisor.restart({ packageId: manifest.package_id, componentId: "search.runtime", authority: { kind: "host" } });
    expect(restarted.binding?.binding_generation).toBeGreaterThan(ready.binding!.binding_generation);
    expect(restarted.restart_attempt).toBe(1);
    await supervisor.awaitReadiness({ packageId: manifest.package_id, componentId: "search.runtime", authority: { kind: "host" } });
    expect(driver.startCount).toBe(2);
    expect(driver.stopCount).toBe(1);

    await supervisor.stop({ packageId: manifest.package_id, componentId: "search.runtime", authority: { kind: "host" } });
    expect(await store.readComponent(manifest.package_id, "search.runtime")).toMatchObject({ state: "stopped", health: "unknown" });
    expectSyncErrorCode(() => supervisor.bindingService.bindingForProviderAdapter(manifest.package_id, "search.runtime", "search.provider"), "ambiguous_runtime_state");

    const uninstalled = await supervisor.uninstall({ packageId: manifest.package_id, componentId: "search.runtime", authority: { kind: "host" } });
    expect(uninstalled).toMatchObject({ state: "uninstalled", binding: expect.any(Object) });
    expect(await store.readComponent(manifest.package_id, "search.runtime")).toMatchObject({ state: "uninstalled", health: "unknown" });
    expect(driver.uninstallCount).toBe(1);
    expect(driver.cleanupCount).toBe(1);
    assertNoPrivateRuntimeProjection(supervisor.diagnosticsFor(manifest.package_id, "search.runtime"));
    assertNoPrivateRuntimeProjection(events);
  });

  it("allows only the owning app component to receive an app-private sidecar binding", async () => {
    const { store, manifest } = await installFixture("valid-app-owned-sidecar", "c");
    const driver = new FakeSidecarDriver("packaged_process", {
      transport: "loopback",
      endpoint: "http://127.0.0.1:43119",
      authorization: "private-app-authority",
    });
    const supervisor = new GenericSidecarSupervisor({ store, target: "desktop_windows_x64", drivers: [driver], readinessPollMs: 1 });

    await supervisor.start({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });
    const ready = await supervisor.awaitReadiness({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });

    expect(ready).toMatchObject({ binding: { audience: "owning_app_private", endpoint_class: "loopback_authenticated", public_bind: false } });
    expect(supervisor.bindingService.bindingForOwningApp(manifest.package_id, "notes.worker", "notes.app")).toMatchObject({
      endpoint: "http://127.0.0.1:43119",
      authorization: "private-app-authority",
    });
    expectSyncErrorCode(() => supervisor.bindingService.bindingForProviderAdapter(manifest.package_id, "notes.worker", "search.provider"), "denied");
    expectSyncErrorCode(() => supervisor.bindingService.bindingForConsumer(manifest.package_id, "notes.worker"), "denied");
    assertNoPrivateRuntimeProjection(ready);
  });

  it("rejects app/component attempts to start arbitrary sidecars", async () => {
    const { store, manifest } = await installFixture("valid-provider-sidecar", "d");
    const driver = new FakeSidecarDriver("container", { transport: "container_internal", endpoint: "http://search-runtime:8080" });
    const supervisor = new GenericSidecarSupervisor({ store, target: "docker_linux_x64", drivers: [driver] });

    await expect(supervisor.start({
      packageId: manifest.package_id,
      componentId: "search.runtime",
      authority: { kind: "component", componentId: "notes.app" },
    })).rejects.toMatchObject({ code: "denied" });
    expect(driver.startCount).toBe(0);
    expect(await store.readComponent(manifest.package_id, "search.runtime")).toMatchObject({ state: "stopped", health: "unknown" });
  });

  it("fails closed for public or host-private binding candidates", async () => {
    const { store, manifest } = await installFixture("valid-provider-sidecar", "e");
    const driver = new FakeSidecarDriver("container", {
      transport: "container_internal",
      endpoint: "http://0.0.0.0:8080",
      publicBind: true,
      containerId: "raw-container-id",
    });
    const supervisor = new GenericSidecarSupervisor({ store, target: "docker_linux_x64", drivers: [driver] });

    await expect(supervisor.start({ packageId: manifest.package_id, componentId: "search.runtime", authority: { kind: "host" } }))
      .rejects.toMatchObject({ code: "denied" });
    expect(await store.readComponent(manifest.package_id, "search.runtime")).toMatchObject({ state: "failed", health: "unhealthy" });
    assertNoPrivateRuntimeProjection(supervisor.diagnosticsFor(manifest.package_id, "search.runtime"));
  });

  it("records timeout and crash states with redacted diagnostics", async () => {
    const { store, manifest } = await installFixture("valid-provider-sidecar", "f");
    const driver = new FakeSidecarDriver("container", { transport: "container_internal", endpoint: "http://search-runtime:8080" });
    driver.healthy = false;
    driver.errorCode = "SECRET_TOKEN http://127.0.0.1:8080 /home/owner/log";
    const supervisor = new GenericSidecarSupervisor({ store, target: "docker_linux_x64", drivers: [driver], readinessTimeoutMs: 1, readinessPollMs: 1 });

    await supervisor.start({ packageId: manifest.package_id, componentId: "search.runtime", authority: { kind: "host" } });
    await expect(supervisor.awaitReadiness({ packageId: manifest.package_id, componentId: "search.runtime", authority: { kind: "host" } }))
      .rejects.toMatchObject({ code: "readiness_failed" });
    expect(await store.readComponent(manifest.package_id, "search.runtime")).toMatchObject({ state: "unavailable", health: "unhealthy" });

    driver.running = false;
    const health = await supervisor.health({ packageId: manifest.package_id, componentId: "search.runtime", authority: { kind: "host" } });
    expect(health).toMatchObject({ state: "failed", health: "unhealthy" });
    expect(supervisor.diagnosticsFor(manifest.package_id, "search.runtime").at(-1)).toMatchObject({ error_code: "health_failed" });
    assertNoPrivateRuntimeProjection(supervisor.diagnosticsFor(manifest.package_id, "search.runtime"));
  });

  it("rejects unsupported target descriptors before driver start", async () => {
    const { store, manifest } = await installFixture("valid-provider-sidecar", "1");
    const driver = new FakeSidecarDriver("container", { transport: "container_internal", endpoint: "http://search-runtime:8080" });
    const supervisor = new GenericSidecarSupervisor({ store, target: "desktop_windows_x64", drivers: [driver] });

    await expect(supervisor.start({ packageId: manifest.package_id, componentId: "search.runtime", authority: { kind: "host" } }))
      .rejects.toMatchObject({ code: "host_incompatible" });
    expect(driver.startCount).toBe(0);
  });
});
