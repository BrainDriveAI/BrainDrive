import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { PackageComponentManifest } from "../contracts/package-components.js";
import { AppPlatformError } from "./errors.js";
import { InstalledPackageStore } from "./installed-package-store.js";
import {
  HostSidecarLifecycleService,
  SidecarLifecycleAuthorityStore,
  type SidecarRollbackPackageResolver,
  type SidecarSupervisorPort,
} from "./sidecar-lifecycle-authority.js";
import type { SidecarLifecycleSnapshot } from "./sidecar-supervisor.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

type Corpus = {
  valid_cases: Array<{ fixture_id: string; manifest?: PackageComponentManifest }>;
};

class RecordingSidecarSupervisor implements SidecarSupervisorPort {
  readonly bindingService = {
    cleanup: (packageId: string, componentId: string) => {
      this.events.push(`revoke:${packageId}:${componentId}`);
      this.binding = null;
    },
  };
  readonly events: string[] = [];
  startCount = 0;
  stopCount = 0;
  restartCount = 0;
  uninstallCount = 0;
  cleanupCount = 0;
  running = false;
  generation = 0;
  failNextReadiness = false;
  releaseStart: (() => void) | null = null;
  enteredStart: Promise<void> | null = null;
  private enteredStartResolve: (() => void) | null = null;
  private binding: { runtime_id: string; binding_generation: number } | null = null;

  blockNextStart(): void {
    this.enteredStart = new Promise((resolve) => { this.enteredStartResolve = resolve; });
    this.releaseStart = null;
    void new Promise<void>((resolve) => { this.releaseStart = resolve; });
  }

  async start(input: { packageId: string; componentId: string }) {
    this.events.push(`start:${input.packageId}:${input.componentId}`);
    this.startCount += 1;
    this.enteredStartResolve?.();
    this.enteredStartResolve = null;
    if (this.releaseStart) {
      const release = this.releaseStart;
      this.releaseStart = null;
      await new Promise<void>((resolve) => {
        const original = release;
        this.releaseStart = () => { original(); resolve(); };
      });
    }
    this.running = true;
    this.binding = { runtime_id: `runtime-${++this.generation}`, binding_generation: this.generation };
    return snapshot(input.packageId, input.componentId, "starting", "unknown", this.binding);
  }

  async awaitReadiness(input: { packageId: string; componentId: string }) {
    this.events.push(`ready:${input.packageId}:${input.componentId}`);
    if (this.failNextReadiness) {
      this.failNextReadiness = false;
      throw new AppPlatformError("readiness_failed", "Synthetic sidecar readiness failure");
    }
    return snapshot(input.packageId, input.componentId, "running", "healthy", this.binding);
  }

  async health(input: { packageId: string; componentId: string }) {
    return snapshot(input.packageId, input.componentId, this.running ? "running" : "stopped", this.running ? "healthy" : "unknown", this.binding);
  }

  async restart(input: { packageId: string; componentId: string }) {
    this.events.push(`restart:${input.packageId}:${input.componentId}`);
    this.restartCount += 1;
    await this.stop(input);
    return await this.start(input);
  }

  async stop(input: { packageId: string; componentId: string }) {
    this.events.push(`stop:${input.packageId}:${input.componentId}`);
    this.stopCount += 1;
    this.running = false;
    this.binding = null;
    return snapshot(input.packageId, input.componentId, "stopped", "unknown", null);
  }

  async uninstall(input: { packageId: string; componentId: string }) {
    this.events.push(`uninstall:${input.packageId}:${input.componentId}`);
    this.uninstallCount += 1;
    this.running = false;
    this.binding = null;
    return snapshot(input.packageId, input.componentId, "uninstalled", "unknown", null);
  }

  async cleanup(input: { packageId: string; componentId: string }) {
    this.events.push(`cleanup:${input.packageId}:${input.componentId}`);
    this.cleanupCount += 1;
  }
}

class InMemoryRollbackResolver implements SidecarRollbackPackageResolver {
  private readonly packages = new Map<string, { manifest: PackageComponentManifest; source: ReturnType<typeof installInput>["source"] }>();

  add(manifest: PackageComponentManifest, packageDigest: `sha256:${string}`): void {
    this.packages.set(packageDigest, {
      manifest: JSON.parse(JSON.stringify(manifest)) as PackageComponentManifest,
      source: { kind: "repository_fixture", label: "Immutable package authority fixture" },
    });
  }

  async resolvePackage(input: { packageDigest: `sha256:${string}` }) {
    const resolved = this.packages.get(input.packageDigest);
    return resolved ? {
      manifest: JSON.parse(JSON.stringify(resolved.manifest)) as PackageComponentManifest,
      source: resolved.source,
    } : null;
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

async function harness() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac004-sidecar-"));
  roots.push(root);
  const packageStore = new InstalledPackageStore(path.join(root, "packages"));
  const authorityStore = new SidecarLifecycleAuthorityStore(path.join(root, "authority"));
  const supervisor = new RecordingSidecarSupervisor();
  const resolver = new InMemoryRollbackResolver();
  const manifest = await fixture("valid-app-owned-sidecar");
  resolver.add(manifest, digest("a"));
  const service = new HostSidecarLifecycleService({ packageStore, authorityStore, supervisor, rollbackResolver: resolver, cleanupRetentionMs: 1 });
  await service.initialize();
  return { root, packageStore, authorityStore, supervisor, resolver, service, manifest };
}

function installInput(manifest: PackageComponentManifest, seed = "a", idempotencyKey = "install-sidecar-key-0001") {
  return {
    authority: { kind: "host" as const },
    manifest,
    packageDigest: digest(seed),
    componentId: "notes.worker",
    idempotencyKey,
    source: { kind: "repository_fixture" as const, label: "Synthetic AC-004 package" },
  };
}

function actionInput(packageId: string, componentId = "notes.worker", idempotencyKey = `${componentId}-operation-key-0001`, expectedGeneration?: number) {
  return { authority: { kind: "host" as const }, packageId, componentId, idempotencyKey, expectedGeneration };
}

function snapshot(
  packageId: string,
  componentId: string,
  state: "starting" | "running" | "stopped" | "uninstalled" | "unavailable" | "failed",
  health: "unknown" | "healthy" | "unhealthy",
  binding: { runtime_id: string; binding_generation: number } | null,
): SidecarLifecycleSnapshot {
  return {
    package_id: packageId,
    installation_id: "10000000-0000-4000-8000-000000000004",
    component_id: componentId,
    owner_component_id: "notes.app",
    state,
    health,
    restart_attempt: 0,
    target: "desktop_windows_x64" as const,
    runtime_kind: "packaged_process" as const,
    binding: binding ? {
      binding_version: 1,
      binding_id: `binding-${binding.binding_generation}`,
      package_id: packageId,
      installation_id: "10000000-0000-4000-8000-000000000004",
      component_id: componentId,
      owner_component_id: "notes.app",
      runtime_id: binding.runtime_id,
      binding_generation: binding.binding_generation,
      target: "desktop_windows_x64" as const,
      transport: "loopback" as const,
      endpoint_class: "loopback_authenticated" as const,
      audience: "owning_app_private" as const,
      public_bind: false,
      created_at: "2026-09-03T12:00:00.000Z",
    } : null,
    safe_message: "Sidecar lifecycle test snapshot.",
    updated_at: "2026-09-03T12:00:00.000Z",
  };
}

function expectNoPrivateProjection(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(/https?:|127\.|localhost|0\.0\.0\.0|\bport\b|endpoint"|authorization|token|secret|pid|process_id|host_path|argv|env|payload\/|adapter|raw_/i);
}

async function serializedHostSidecarState(root: string): Promise<string> {
  const stateRoot = path.join(root, "authority", "host-sidecar-state");
  const chunks: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(child);
      else chunks.push(await readFile(child, "utf8"));
    }
  }
  await visit(stateRoot);
  return chunks.join("\n");
}

function expectContentFreeHostSidecarState(serialized: string): void {
  expect(serialized).not.toMatch(/"manifest"|entrypoint|artifact_path|dependency_bundle|package_path|secrets|adapter|payload\/|https?:|127\.|localhost|0\.0\.0\.0|\bport\b|authorization|token|secret|pid|process_id|host_path|argv|env|raw_/i);
}

describe("AC-004 host sidecar lifecycle authority", () => {
  it("orders lifecycle commands and revokes private authority before stop, restart, uninstall, and shutdown", async () => {
    const h = await harness();
    const installed = await h.service.install(installInput(h.manifest, "a"));
    expect(installed.record).toMatchObject({ state: "enabled", health: "unknown", lifecycle_generation: 1 });

    const started = await h.service.start(actionInput(h.manifest.package_id, "notes.worker", "start-sidecar-key-0001", installed.record.lifecycle_generation));
    expect(started.record).toMatchObject({ state: "running", health: "healthy", lifecycle_generation: 2 });
    expect(started.record.runtime).toMatchObject({ runtime_id: "runtime-1", binding_generation: 1 });

    const restarted = await h.service.restart(actionInput(h.manifest.package_id, "notes.worker", "restart-sidecar-key-0001", started.record.lifecycle_generation));
    expect(restarted.record.runtime?.runtime_id).toBe("runtime-2");
    expect(h.supervisor.events).toEqual(expect.arrayContaining([
      `revoke:${h.manifest.package_id}:notes.worker`,
      `stop:${h.manifest.package_id}:notes.worker`,
      `start:${h.manifest.package_id}:notes.worker`,
    ]));

    const disabled = await h.service.disable(actionInput(h.manifest.package_id, "notes.worker", "disable-sidecar-key-0001", restarted.record.lifecycle_generation));
    const revokeBeforeStop = h.supervisor.events.findIndex((entry) => entry.startsWith("revoke:"));
    const stopAfterRevoke = h.supervisor.events.findIndex((entry, index) => index > revokeBeforeStop && entry.startsWith("stop:"));
    expect(revokeBeforeStop).toBeGreaterThanOrEqual(0);
    expect(stopAfterRevoke).toBeGreaterThan(revokeBeforeStop);
    expect(disabled.record).toMatchObject({ state: "disabled", runtime: null });

    const enabled = await h.service.enable(actionInput(h.manifest.package_id, "notes.worker", "enable-sidecar-key-0001", disabled.record.lifecycle_generation));
    await h.service.start(actionInput(h.manifest.package_id, "notes.worker", "restart-after-enable-0001", enabled.record.lifecycle_generation));
    const uninstalled = await h.service.uninstall(actionInput(h.manifest.package_id, "notes.worker", "uninstall-sidecar-key-0001"));
    expect(uninstalled.record).toMatchObject({ state: "uninstalled", runtime: null });

    await h.service.shutdown({ authority: { kind: "host" }, idempotencyKey: "shutdown-sidecars-key-0001" });
    expectNoPrivateProjection(await h.service.ownerProjection(h.manifest.package_id, "notes.worker"));
  });

  it("replays equivalent idempotency input, rejects changed input, stale generation, and component authority", async () => {
    const h = await harness();
    const first = await h.service.install(installInput(h.manifest, "a", "same-install-key-0001"));
    const replay = await h.service.install(installInput(h.manifest, "a", "same-install-key-0001"));
    expect(replay.operation.operation_id).toBe(first.operation.operation_id);
    expect((await h.packageStore.listPackages())).toHaveLength(1);
    await expect(h.service.install(installInput(h.manifest, "b", "same-install-key-0001"))).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(h.service.start(actionInput(h.manifest.package_id, "notes.worker", "stale-start-key-0001", 0))).rejects.toMatchObject({ code: "conflict" });
    await expect(h.service.start({ ...actionInput(h.manifest.package_id), authority: { kind: "component" as const, componentId: "notes.app" } })).rejects.toMatchObject({ code: "denied" });
  });

  it("persists only an operation key digest when an idempotency key contains private-shaped text", async () => {
    const h = await harness();
    const unsafeKey = "https://127.0.0.1:4317/token/raw_secret/payload/adapter/package_path";
    const first = await h.service.install(installInput(h.manifest, "a", unsafeKey));
    const replay = await h.service.install(installInput(h.manifest, "a", unsafeKey));
    expect(replay.operation.operation_id).toBe(first.operation.operation_id);
    const serialized = await serializedHostSidecarState(h.root);
    expect(serialized).not.toContain(unsafeKey);
    expect(serialized).toContain("\"operation_key_digest\"");
    expect(serialized).not.toContain("\"idempotency_key\"");
    expectContentFreeHostSidecarState(serialized);
  });

  it("rejects disable and uninstall while another sidecar operation is active", async () => {
    const h = await harness();
    const installed = await h.service.install(installInput(h.manifest, "a"));
    h.supervisor.blockNextStart();
    const starting = h.service.start(actionInput(h.manifest.package_id, "notes.worker", "blocked-start-key-0001", installed.record.lifecycle_generation));
    await h.supervisor.enteredStart;

    await expect(h.service.disable(actionInput(h.manifest.package_id, "notes.worker", "blocked-disable-key-0001", installed.record.lifecycle_generation))).rejects.toMatchObject({ code: "runtime_conflict" });
    await expect(h.service.uninstall(actionInput(h.manifest.package_id, "notes.worker", "blocked-uninstall-key-0001", installed.record.lifecycle_generation))).rejects.toMatchObject({ code: "runtime_conflict" });
    h.supervisor.releaseStart?.();
    await expect(starting).resolves.toMatchObject({ record: { state: "running" } });
  });

  it("preserves active runtime on candidate failure, records LKG on update, and rolls back to LKG", async () => {
    const h = await harness();
    const installed = await h.service.install(installInput(h.manifest, "a"));
    const started = await h.service.start(actionInput(h.manifest.package_id, "notes.worker", "start-before-update-0001", installed.record.lifecycle_generation));
    const v2 = { ...h.manifest, package_version: "2.0.0", catalog: { ...h.manifest.catalog, display_name: "Notes Assistant Updated" } };
    h.resolver.add(v2, digest("b"));
    h.service.candidateReadiness = async () => { throw new AppPlatformError("readiness_failed", "Synthetic candidate failed"); };
    await expect(h.service.update({
      ...installInput(v2, "b", "update-failure-key-0001"),
      packageId: h.manifest.package_id,
      expectedGeneration: started.record.lifecycle_generation,
    })).rejects.toMatchObject({ code: "readiness_failed" });
    expect(await h.service.ownerProjection(h.manifest.package_id, "notes.worker")).toMatchObject({
      state: "running",
      package_digest: digest("a"),
      last_known_good_package_digest: null,
    });
    expect(h.supervisor.running).toBe(true);

    h.service.candidateReadiness = async () => undefined;
    const updated = await h.service.update({
      ...installInput(v2, "b", "update-success-key-0001"),
      packageId: h.manifest.package_id,
      expectedGeneration: started.record.lifecycle_generation,
    });
    expect(updated.record).toMatchObject({ state: "running", package_digest: digest("b"), last_known_good_package_digest: digest("a") });
    expectContentFreeHostSidecarState(await serializedHostSidecarState(h.root));

    const failClosed = new HostSidecarLifecycleService({ packageStore: h.packageStore, authorityStore: h.authorityStore, supervisor: h.supervisor, cleanupRetentionMs: 1 });
    await failClosed.initialize();
    await expect(failClosed.rollback(actionInput(h.manifest.package_id, "notes.worker", "rollback-no-resolver-0001", updated.record.lifecycle_generation))).rejects.toMatchObject({ code: "rollback_unavailable" });

    const rolledBack = await h.service.rollback(actionInput(h.manifest.package_id, "notes.worker", "rollback-sidecar-key-0001", updated.record.lifecycle_generation));
    expect(rolledBack.record).toMatchObject({ state: "running", package_digest: digest("a"), last_known_good_package_digest: digest("b") });
    expectContentFreeHostSidecarState(await serializedHostSidecarState(h.root));
  });

  it("reconciles offline restart, recovers partial cleanup, preserves owner data, and keeps projections content-free", async () => {
    const h = await harness();
    const installed = await h.service.install(installInput(h.manifest, "a"));
    const started = await h.service.start(actionInput(h.manifest.package_id, "notes.worker", "offline-start-key-0001", installed.record.lifecycle_generation));
    const restartedSupervisor = new RecordingSidecarSupervisor();
    const restarted = new HostSidecarLifecycleService({ packageStore: h.packageStore, authorityStore: h.authorityStore, supervisor: restartedSupervisor, cleanupRetentionMs: 1 });
    await restarted.initialize();

    const reconciled = await restarted.reconcileOfflineRestart(actionInput(h.manifest.package_id, "notes.worker", "offline-restart-key-0001", started.record.lifecycle_generation));
    expect(reconciled.record).toMatchObject({ state: "running", health: "healthy" });
    expect(restartedSupervisor.startCount).toBe(1);
    expectNoPrivateProjection(await restarted.ownerProjection(h.manifest.package_id, "notes.worker"));

    const ownerDataRoot = path.join(h.root, "owner-data");
    await mkdir(ownerDataRoot, { recursive: true });
    await writeFile(path.join(ownerDataRoot, "sentinel.json"), "{}\n", "utf8");
    await restarted.shutdown({ authority: { kind: "host" }, idempotencyKey: "shutdown-offline-key-0001" });
    const uninstalled = await restarted.uninstall(actionInput(h.manifest.package_id, "notes.worker", "cleanup-uninstall-key-0001"));
    expect(uninstalled.record).toMatchObject({ state: "uninstalled" });
    await restarted.cleanupExpired();
    expect(await h.authorityStore.readAuthority(h.manifest.package_id, "notes.worker")).toBeNull();
    expect(await readFile(path.join(ownerDataRoot, "sentinel.json"), "utf8")).toBe("{}\n");
  });
});
