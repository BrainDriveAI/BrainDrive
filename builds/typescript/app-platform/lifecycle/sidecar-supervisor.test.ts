import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parsePackageComponentManifestForConformance,
  type PackageComponentManifest,
} from "../contracts/package-components.js";
import { InstalledPackageStore } from "./installed-package-store.js";
import { PackagedProcessSidecarDriver } from "./packaged-process-sidecar-driver.js";
import { SidecarBundleStore, createVerifiedSidecarPackageBundleFromStore, type SidecarBundleReference } from "./sidecar-bundle-store.js";
import {
  GenericSidecarSupervisor,
  type PrivateSidecarBindingCandidate,
  type SidecarRuntimeDriver,
  type SidecarRuntimeDriverContext,
} from "./sidecar-supervisor.js";
import { ImmutablePackageStore } from "./verified-package-store.js";

const roots: string[] = [];
const drivers: PackagedProcessSidecarDriver[] = [];
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((driver) => driver.close()));
  await Promise.all(roots.splice(0).map(async (root) => {
    await makeWritable(root);
    await rm(root, { recursive: true, force: true });
  }));
});

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

async function makeWritable(root: string): Promise<void> {
  await chmod(root, 0o700).catch(() => undefined);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) await makeWritable(child);
    else await chmod(child, 0o600).catch(() => undefined);
  }));
}

function digest(seed: string): `sha256:${string}` {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

function realDigest(bytes: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sidecarScript(mode: "healthy" | "flood" | "crash" | "descendant" = "healthy", pidFile?: string): string {
  return `#!${process.execPath}
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const http = require("node:http");
const token = process.env.BRAINDRIVE_SIDECAR_CONNECTION_TOKEN;
const bind = process.env.BRAINDRIVE_SIDECAR_BIND;
if (!token || !bind) process.exit(33);
const [host, portText] = bind.split(":");
if (${JSON.stringify(mode)} === "descendant") {
  const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  writeFileSync(${JSON.stringify(pidFile ?? "")}, String(descendant.pid));
}
if (${JSON.stringify(mode)} === "flood") setInterval(() => process.stdout.write("sensitive-output-canary".repeat(256)), 1);
if (${JSON.stringify(mode)} === "crash") setTimeout(() => process.exit(42), 50);
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== "Bearer " + token) { response.writeHead(401).end(); return; }
  if (request.url !== "/healthz") { response.writeHead(404).end(); return; }
  response.writeHead(200, { "content-type": "application/json" });
  response.end('{"status":"ok"}');
});
server.listen(Number(portText), host);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
`;
}

async function installPackagedSidecar(
  mode: "healthy" | "flood" | "crash" | "descendant" = "healthy",
  options: { restartAttempts?: number; memoryMb?: number; chmodEntrypoint?: number; pidFile?: string } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac003-sidecar-"));
  roots.push(root);
  const manifest = await fixture("valid-app-owned-sidecar");
  const target = manifest.sidecars[0]!.targets.find((candidate) => candidate.target === "desktop_windows_x64");
  if (!target || target.runtime_kind !== "packaged_process") throw new Error("expected packaged-process fixture target");
  target.resources.restart_attempts = options.restartAttempts ?? target.resources.restart_attempts;
  target.resources.memory_mb = options.memoryMb ?? target.resources.memory_mb;
  const fileBytes = new Map<string, Buffer>();
  for (const file of manifest.files) {
    const body = file.path === target.entrypoint
      ? sidecarScript(mode, options.pidFile)
      : `${manifest.package_id}:${manifest.package_version}:${file.path}\n`;
    const bytes = Buffer.from(body, "utf8");
    fileBytes.set(file.path, bytes);
    file.size_bytes = bytes.byteLength;
    file.digest = realDigest(bytes);
  }
  const filesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  for (const sidecar of manifest.sidecars) {
    for (const candidateTarget of sidecar.targets) {
      if (candidateTarget.runtime_kind !== "packaged_process") continue;
      candidateTarget.dependency_bundle.bundle_digest = filesByPath.get(candidateTarget.artifact_path)!.digest;
      candidateTarget.dependency_bundle.lockfile_digest = filesByPath.get(candidateTarget.dependency_bundle.lockfile_path)!.digest;
      candidateTarget.dependency_bundle.provenance_digest = filesByPath.get(candidateTarget.dependency_bundle.provenance_path)!.digest;
      candidateTarget.dependency_bundle.sbom_digest = filesByPath.get(candidateTarget.dependency_bundle.sbom_path)!.digest;
    }
  }
  const parsed = parsePackageComponentManifestForConformance(manifest);
  const packageDigest = realDigest(JSON.stringify({ package_id: parsed.package_id, package_version: parsed.package_version, mode }));
  const packageStageRoot = path.join(root, "package-stage");
  for (const [filePath, bytes] of fileBytes) {
    const targetPath = path.join(packageStageRoot, ...filePath.split("/"));
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, bytes);
  }
  await writeFile(path.join(packageStageRoot, parsed.archive.manifest_path), `${JSON.stringify(parsed)}\n`, "utf8");
  if (options.chmodEntrypoint !== undefined) await chmod(path.join(packageStageRoot, target.entrypoint), options.chmodEntrypoint);
  const packageStore = new ImmutablePackageStore(path.join(root, "package-store"));
  await packageStore.promote({
    manifest: parsed,
    packageDigest,
    descriptorDigest: realDigest(`descriptor:${packageDigest}`),
    stageRoot: packageStageRoot,
    entrypoint: path.join(packageStageRoot, target.entrypoint),
    target: "desktop_windows_x64",
  });
  const verifiedPackage = await createVerifiedSidecarPackageBundleFromStore({ packageStore, packageDigest, manifest: parsed });
  const bundleStore = new SidecarBundleStore(path.join(root, "bundle-store"));
  const staged = await bundleStore.stage({ verifiedPackage, sidecarComponentId: "notes.worker", target: "desktop_windows_x64" });
  if (options.chmodEntrypoint !== undefined) {
    const resolution = await bundleStore.resolveForDriver(staged.reference);
    await chmod(resolution.entrypoint, options.chmodEntrypoint);
  }
  const store = new InstalledPackageStore(path.join(root, "installed"));
  await store.initialize();
  await store.installPackage({
    manifest: parsed,
    packageDigest,
    source: { kind: "repository_fixture", label: "Synthetic AC-003 packaged sidecar fixture" },
    installedAt: "2026-09-01T12:00:00.000Z",
  });
  return { root, store, manifest: parsed, bundleStore, bundleReference: staged.reference };
}

function makeDriver(
  bundleStore: SidecarBundleStore,
  bundleReference: SidecarBundleReference,
  options: Partial<ConstructorParameters<typeof PackagedProcessSidecarDriver>[0]> = {},
) {
  const driver = new PackagedProcessSidecarDriver({
    ...options,
    bundleStore,
    bundleReferenceFor: () => bundleReference,
  });
  drivers.push(driver);
  return driver;
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

describe("AC-003 packaged-process sidecar driver and containment", () => {
  it("runs the normal lifecycle from an AC-002 staged bundle with private binding rotation and stale binding denial", async () => {
    const { store, manifest, bundleStore, bundleReference } = await installPackagedSidecar("healthy");
    const driver = makeDriver(bundleStore, bundleReference, { readinessTimeoutMs: 2_000, stopTimeoutMs: 500 });
    const supervisor = new GenericSidecarSupervisor({ store, target: "desktop_windows_x64", drivers: [driver], readinessPollMs: 25, readinessTimeoutMs: 2_000 });

    const started = await supervisor.start({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });
    expect(started).toMatchObject({ state: "starting", binding: { transport: "loopback", endpoint_class: "loopback_authenticated", public_bind: false } });
    assertNoPrivateRuntimeProjection(started);
    const ready = await supervisor.awaitReadiness({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });
    expect(ready).toMatchObject({ state: "running", health: "healthy" });
    expect(await supervisor.health({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } })).toMatchObject({ health: "healthy" });
    const privateBinding = supervisor.bindingService.bindingForOwningApp(manifest.package_id, "notes.worker", "notes.app");
    expect(privateBinding.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(privateBinding.authorization).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(driver.inspectForTest(manifest.package_id, "notes.worker")).toMatchObject({
      command_line_exposed: false,
      executable_authority: "verified_staged_entrypoint",
    });

    const restarted = await supervisor.restart({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });
    expect(restarted.binding?.binding_generation).toBeGreaterThan(ready.binding!.binding_generation);
    expect(restarted.binding?.runtime_id).not.toBe(ready.binding!.runtime_id);
    expectSyncErrorCode(() => supervisor.bindingService.bindingForOwningApp(
      manifest.package_id,
      "notes.worker",
      "notes.app",
      { runtimeId: ready.binding!.runtime_id, bindingGeneration: ready.binding!.binding_generation },
    ), "ambiguous_runtime_state");
    await supervisor.awaitReadiness({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });

    await supervisor.stop({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });
    expect(driver.inspectForTest(manifest.package_id, "notes.worker")).toBeNull();
    const uninstalled = await supervisor.uninstall({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });
    expect(uninstalled).toMatchObject({ state: "uninstalled" });
    assertNoPrivateRuntimeProjection(supervisor.diagnosticsFor(manifest.package_id, "notes.worker"));
  });

  it("denies public binding and rejects resource policies before spawn", async () => {
    const accepted = await installPackagedSidecar("healthy", { memoryMb: 256 });
    const acceptedDriver = makeDriver(accepted.bundleStore, accepted.bundleReference, { maxMemoryMb: 512 });
    const acceptedSupervisor = new GenericSidecarSupervisor({ store: accepted.store, target: "desktop_windows_x64", drivers: [acceptedDriver] });
    await expect(acceptedSupervisor.start({ packageId: accepted.manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } }))
      .resolves.toMatchObject({ state: "starting" });

    const publicBind = await installPackagedSidecar("healthy");
    const publicDriver = makeDriver(publicBind.bundleStore, publicBind.bundleReference, { allocateLoopback: async () => ({ host: "0.0.0.0", port: 31_337 }) });
    const publicSupervisor = new GenericSidecarSupervisor({ store: publicBind.store, target: "desktop_windows_x64", drivers: [publicDriver] });
    await expect(publicSupervisor.start({ packageId: publicBind.manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } }))
      .rejects.toMatchObject({ code: "denied" });

    const rejected = await installPackagedSidecar("healthy", { memoryMb: 1024 });
    const rejectedDriver = makeDriver(rejected.bundleStore, rejected.bundleReference, { maxMemoryMb: 128 });
    const rejectedSupervisor = new GenericSidecarSupervisor({ store: rejected.store, target: "desktop_windows_x64", drivers: [rejectedDriver] });
    await expect(rejectedSupervisor.start({ packageId: rejected.manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } }))
      .rejects.toMatchObject({ code: "resource_invalid" });
    expect(rejectedDriver.inspectForTest(rejected.manifest.package_id, "notes.worker")).toBeNull();

    const disk = await installPackagedSidecar("healthy");
    const diskTarget = disk.manifest.sidecars[0]!.targets.find((candidate) => candidate.target === "desktop_windows_x64");
    if (!diskTarget || diskTarget.runtime_kind !== "packaged_process") throw new Error("expected packaged-process fixture target");
    diskTarget.resources.disk_mb = 1;
    const diskDriver = makeDriver(disk.bundleStore, disk.bundleReference, { maxDiskMb: 0 });
    const diskSupervisor = new GenericSidecarSupervisor({ store: disk.store, target: "desktop_windows_x64", drivers: [diskDriver] });
    await expect(diskSupervisor.start({ packageId: disk.manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } }))
      .rejects.toMatchObject({ code: "resource_invalid" });
  });

  it("rejects structural fake bundle stores and forged bundle resolutions", async () => {
    const staged = await installPackagedSidecar("healthy");
    expect(() => new PackagedProcessSidecarDriver({
      bundleStore: { resolveForDriver: staged.bundleStore.resolveForDriver.bind(staged.bundleStore) } as SidecarBundleStore,
      bundleReferenceFor: () => staged.bundleReference,
    })).toThrow();

    const driver = makeDriver(staged.bundleStore, staged.bundleReference);
    staged.bundleStore.resolveForDriver = async () => ({
      packageDigest: staged.bundleReference.package_digest as `sha256:${string}`,
      contentRoot: staged.root,
      artifactPath: path.join(staged.root, "host-script.js"),
      entrypoint: path.join(staged.root, "host-script.js"),
      target: "desktop_windows_x64",
      bundleDigest: staged.bundleReference.bundle_digest as `sha256:${string}`,
      lockfileDigest: staged.bundleReference.lockfile_digest as `sha256:${string}`,
      contentBytes: 1,
      dependencies: staged.bundleReference.dependencies,
    });
    await writeFile(path.join(staged.root, "host-script.js"), sidecarScript("healthy"));
    await chmod(path.join(staged.root, "host-script.js"), 0o700);
    const supervisor = new GenericSidecarSupervisor({ store: staged.store, target: "desktop_windows_x64", drivers: [driver] });
    await expect(supervisor.start({ packageId: staged.manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } }))
      .rejects.toMatchObject({ code: "start_failed" });
    expect(driver.inspectForTest(staged.manifest.package_id, "notes.worker")).toBeNull();
  });

  it("kills output floods with content-free diagnostics", async () => {
    const { store, manifest, bundleStore, bundleReference } = await installPackagedSidecar("flood");
    const driver = makeDriver(bundleStore, bundleReference, { outputLimitBytes: 2_048, restartBackoffMs: [1, 1, 1] });
    const supervisor = new GenericSidecarSupervisor({ store, target: "desktop_windows_x64", drivers: [driver], readinessTimeoutMs: 250, readinessPollMs: 10 });
    await supervisor.start({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });

    await expect(supervisor.awaitReadiness({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } }))
      .rejects.toMatchObject({ code: "readiness_failed" });
    const diagnostics = driver.diagnosticsFor(manifest.package_id, "notes.worker");
    expect(diagnostics.some((entry) => entry.error_code === "output_limit_exceeded")).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain("sensitive-output-canary");
    expect(driver.logSummaryFor(manifest.package_id, "notes.worker")).toMatchObject({ content_stored: false, truncated: true });
  });

  it("classifies crashes, rotates restarted bindings, and exhausts the restart budget", async () => {
    const { store, manifest, bundleStore, bundleReference } = await installPackagedSidecar("healthy", { restartAttempts: 1 });
    const driver = makeDriver(bundleStore, bundleReference, { restartBackoffMs: [1, 1, 1] });
    const supervisor = new GenericSidecarSupervisor({ store, target: "desktop_windows_x64", drivers: [driver], readinessTimeoutMs: 1_000, readinessPollMs: 10 });
    const started = await supervisor.start({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });
    const ready = await supervisor.awaitReadiness({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });
    await driver.crashForTest(manifest.package_id, "notes.worker");
    await expect(supervisor.health({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } }))
      .resolves.toMatchObject({ state: "failed", health: "unhealthy" });

    const restarted = await supervisor.restart({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });
    expect(restarted.restart_attempt).toBe(1);
    expect(restarted.binding?.binding_generation).toBeGreaterThan(ready.binding!.binding_generation);
    expect(restarted.binding?.runtime_id).not.toBe(started.binding?.runtime_id);
    await expect(supervisor.restart({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } }))
      .rejects.toMatchObject({ code: "lifecycle_failed" });
    expect(supervisor.diagnosticsFor(manifest.package_id, "notes.worker").at(-1)).toMatchObject({ error_code: "restart_exhausted" });
  });

  it("caps packaged-process restart attempts at the supervisor-supported diagnostic budget", async () => {
    const { store, manifest, bundleStore, bundleReference } = await installPackagedSidecar("healthy", { restartAttempts: 10 });
    const driver = makeDriver(bundleStore, bundleReference, { restartBackoffMs: [1, 1, 1] });
    const supervisor = new GenericSidecarSupervisor({ store, target: "desktop_windows_x64", drivers: [driver], readinessTimeoutMs: 1_000, readinessPollMs: 10 });
    await supervisor.start({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });

    for (const expectedAttempt of [1, 2, 3]) {
      await expect(supervisor.restart({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } }))
        .resolves.toMatchObject({ restart_attempt: expectedAttempt });
      await supervisor.awaitReadiness({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });
    }
    await expect(supervisor.restart({ packageId: manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } }))
      .rejects.toMatchObject({ code: "lifecycle_failed" });
    expect(supervisor.diagnosticsFor(manifest.package_id, "notes.worker").at(-1)).toMatchObject({ restart_attempt: 3, error_code: "restart_exhausted" });
  });

  it("classifies stop timeout and OS security blocks without leaking private details", async () => {
    const timeout = await installPackagedSidecar("healthy");
    const timeoutDriver = makeDriver(timeout.bundleStore, timeout.bundleReference, { waitForExit: async () => false, stopTimeoutMs: 1 });
    const timeoutSupervisor = new GenericSidecarSupervisor({ store: timeout.store, target: "desktop_windows_x64", drivers: [timeoutDriver], readinessTimeoutMs: 1_000, readinessPollMs: 10 });
    await timeoutSupervisor.start({ packageId: timeout.manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });
    await timeoutSupervisor.awaitReadiness({ packageId: timeout.manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });
    await expect(timeoutSupervisor.stop({ packageId: timeout.manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } }))
      .rejects.toMatchObject({ code: "lifecycle_failed" });
    expect(timeoutSupervisor.diagnosticsFor(timeout.manifest.package_id, "notes.worker").at(-1)).toMatchObject({ error_code: "stop_timeout" });

    const blocked = await installPackagedSidecar("healthy", { chmodEntrypoint: 0o400 });
    const blockedDriver = makeDriver(blocked.bundleStore, blocked.bundleReference);
    const blockedSupervisor = new GenericSidecarSupervisor({ store: blocked.store, target: "desktop_windows_x64", drivers: [blockedDriver] });
    await expect(blockedSupervisor.start({ packageId: blocked.manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } }))
      .rejects.toMatchObject({ code: "start_failed" });
    expect(blockedSupervisor.diagnosticsFor(blocked.manifest.package_id, "notes.worker").at(-1)).toMatchObject({ error_code: "os_security_block" });
    assertNoPrivateRuntimeProjection(timeoutSupervisor.diagnosticsFor(timeout.manifest.package_id, "notes.worker"));
    assertNoPrivateRuntimeProjection(blockedSupervisor.diagnosticsFor(blocked.manifest.package_id, "notes.worker"));
  });

  it("cleans descendants and rejects stale runtime identities", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac003-descendant-"));
    roots.push(root);
    const pidFile = path.join(root, "descendant.pid");
    const staged = await installPackagedSidecar("descendant", { pidFile });
    const driver = makeDriver(staged.bundleStore, staged.bundleReference);
    const supervisor = new GenericSidecarSupervisor({ store: staged.store, target: "desktop_windows_x64", drivers: [driver], readinessTimeoutMs: 1_000, readinessPollMs: 10 });
    const started = await supervisor.start({ packageId: staged.manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });
    await supervisor.awaitReadiness({ packageId: staged.manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });
    let descendantPid = 0;
    for (let attempt = 0; attempt < 100 && descendantPid === 0; attempt += 1) {
      descendantPid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
      if (!descendantPid) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(() => process.kill(descendantPid, 0)).not.toThrow();
    await supervisor.stop({ packageId: staged.manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(descendantPid, 0); await new Promise((resolve) => setTimeout(resolve, 10)); }
      catch { break; }
    }
    expect(() => process.kill(descendantPid, 0)).toThrow();
    await expect(supervisor.health({ packageId: staged.manifest.package_id, componentId: "notes.worker", authority: { kind: "host" } }))
      .rejects.toMatchObject({ code: "ambiguous_runtime_state" });
    expect(started.binding).not.toHaveProperty("endpoint");
    await expect(access(pidFile)).resolves.toBeUndefined();
  });
});
