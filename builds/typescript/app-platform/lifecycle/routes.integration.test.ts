import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import type { PermissionSet } from "../../contracts.js";
import { SUPERVISOR_POLICY } from "../contracts/package.js";
import { createSyntheticFirstPartyFixtureRepository, MODERN_FIXTURE_VERSION, revokeFixtureVersion } from "./fixture-repository.js";
import { PackageVerifier } from "./package-verifier.js";
import { InstalledPackageStore, type CapabilityDependencyResolver } from "./installed-package-store.js";
import { createAppLifecycleRoutePlatform, registerAppLifecycleRoutes, registerSidecarLifecycleRoutes } from "./routes.js";
import { HostSidecarLifecycleService, SidecarLifecycleAuthorityStore, type SidecarSupervisorPort } from "./sidecar-lifecycle-authority.js";
import type { SidecarLifecycleSnapshot } from "./sidecar-supervisor.js";
import { createLifecycleHarness } from "./test-helpers.js";
import type { PackageComponentManifest } from "../contracts/package-components.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const permissions: PermissionSet = { memory_access: true, tool_access: true, system_actions: true, delegation: true, approval_authority: true, administration: true };

function installBody(generation = 0, operationId = crypto.randomUUID()) {
  return { operation_id: operationId, idempotency_key: operationId, expected_generation: generation, installation_id: null, version: "1.0.0", approve_capabilities: true };
}

function digest(seed: string): `sha256:${string}` {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

async function packageComponentFixture(fixtureId: string): Promise<PackageComponentManifest> {
  const raw = await readFile(new URL("../contracts/fixtures/sidecar-package/sc-001-conformance-corpus.json", import.meta.url), "utf8");
  const source = JSON.parse(raw) as { valid_cases: Array<{ fixture_id: string; manifest?: PackageComponentManifest }> };
  const manifest = source.valid_cases.find((candidate) => candidate.fixture_id === fixtureId)?.manifest;
  if (!manifest) throw new Error(`missing fixture: ${fixtureId}`);
  return JSON.parse(JSON.stringify(manifest)) as PackageComponentManifest;
}

function withSearchDependency(
  manifest: PackageComponentManifest,
  appId: string,
  routeKey: string,
  requirement: "required" | "optional" = "required",
): PackageComponentManifest {
  const dependency = {
    operation_id: "web.search@1",
    requirement,
    unavailable_behavior: requirement === "required" ? "block_activation" as const : "degrade_with_safe_status" as const,
    provider_selection: "owner_or_admin_policy" as const,
    silent_install_or_switch: false as const,
  };
  return {
    ...manifest,
    package_id: appId,
    catalog: { ...manifest.catalog, display_name: "Research Consumer" },
    components: manifest.components.map((component) => component.component_kind === "app"
      ? { ...component, display_name: "Research Consumer", app_id: appId, route_key: routeKey, requested_capabilities: [dependency] }
      : component),
    capability_dependencies: [dependency],
  };
}

function withRequiredSearchDependency(manifest: PackageComponentManifest, appId: string, routeKey: string): PackageComponentManifest {
  return withSearchDependency(manifest, appId, routeKey, "required");
}

function withOptionalSearchDependency(manifest: PackageComponentManifest, appId: string, routeKey: string): PackageComponentManifest {
  return withSearchDependency(manifest, appId, routeKey, "optional");
}

type DependencyResolution = Awaited<ReturnType<CapabilityDependencyResolver["resolveDependency"]>>;

class RouteSidecarSupervisor implements SidecarSupervisorPort {
  readonly bindingService = { cleanup: () => undefined };
  startCount = 0;
  generation = 0;
  async start(input: { packageId: string; componentId: string }) {
    this.startCount += 1;
    return this.snapshot(input.packageId, input.componentId, "starting", "unknown");
  }
  async awaitReadiness(input: { packageId: string; componentId: string }) {
    return this.snapshot(input.packageId, input.componentId, "running", "healthy");
  }
  async health(input: { packageId: string; componentId: string }) {
    return this.snapshot(input.packageId, input.componentId, "running", "healthy");
  }
  async restart(input: { packageId: string; componentId: string }) {
    return this.snapshot(input.packageId, input.componentId, "starting", "unknown");
  }
  async stop(input: { packageId: string; componentId: string }) {
    return this.snapshot(input.packageId, input.componentId, "stopped", "unknown", null);
  }
  async uninstall(input: { packageId: string; componentId: string }) {
    return this.snapshot(input.packageId, input.componentId, "uninstalled", "unknown", null);
  }
  async cleanup() {}
  private snapshot(
    packageId: string,
    componentId: string,
    state: "starting" | "running" | "stopped" | "uninstalled",
    health: "unknown" | "healthy",
    runtime: { runtime_id: string; binding_generation: number } | null = { runtime_id: `route-runtime-${++this.generation}`, binding_generation: this.generation },
  ): SidecarLifecycleSnapshot {
    return {
      package_id: packageId,
      installation_id: "10000000-0000-4000-8000-000000000005",
      component_id: componentId,
      owner_component_id: "notes.app",
      state,
      health,
      restart_attempt: 0,
      target: "desktop_windows_x64" as const,
      runtime_kind: "packaged_process" as const,
      binding: runtime ? {
        binding_version: 1,
        binding_id: `route-binding-${runtime.binding_generation}`,
        package_id: packageId,
        installation_id: "10000000-0000-4000-8000-000000000005",
        component_id: componentId,
        owner_component_id: "notes.app",
        runtime_id: runtime.runtime_id,
        binding_generation: runtime.binding_generation,
        target: "desktop_windows_x64" as const,
        transport: "loopback" as const,
        endpoint_class: "loopback_authenticated" as const,
        audience: "owning_app_private" as const,
        public_bind: false,
        created_at: "2026-09-03T12:00:00.000Z",
      } : null,
      safe_message: "Route sidecar snapshot.",
      updated_at: "2026-09-03T12:00:00.000Z",
    };
  }
}

function dependencyResolver(state: DependencyResolution): CapabilityDependencyResolver {
  return { resolveDependency: async (operationId) => ({ ...state, operation_id: operationId }) };
}

describe("owner lifecycle gateway routes", () => {
  it("exposes owner-only generic sidecar lifecycle routes with redacted DTOs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac004-sidecar-routes-")); roots.push(root);
    const manifest = await packageComponentFixture("valid-app-owned-sidecar");
    const packageStore = new InstalledPackageStore(path.join(root, "packages"));
    const authorityStore = new SidecarLifecycleAuthorityStore(path.join(root, "authority"));
    const supervisor = new RouteSidecarSupervisor();
    const service = new HostSidecarLifecycleService({ packageStore, authorityStore, supervisor });
    await service.initialize();
    const installed = await service.install({
      authority: { kind: "host" },
      manifest,
      packageDigest: digest("4"),
      componentId: "notes.worker",
      idempotencyKey: "route-install-sidecar-0001",
      source: { kind: "repository_fixture", label: "Synthetic route sidecar fixture" },
    });

    const app = Fastify();
    app.addHook("preHandler", async (request) => {
      if (!request.headers["x-test-consumer"]) request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions };
    });
    registerSidecarLifecycleRoutes(app, service);

    const denied = await app.inject({
      method: "POST",
      url: `/packages/${manifest.package_id}/sidecars/notes.worker/start`,
      headers: { "x-test-consumer": "1" },
      payload: { idempotency_key: "aaaaaaaaaaaaaaaa", expected_generation: installed.record.lifecycle_generation },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: "owner_authorization_required" });
    expect(supervisor.startCount).toBe(0);

    const started = await app.inject({
      method: "POST",
      url: `/packages/${manifest.package_id}/sidecars/notes.worker/start`,
      payload: { idempotency_key: "bbbbbbbbbbbbbbbb", expected_generation: installed.record.lifecycle_generation },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({
      package_id: manifest.package_id,
      component_id: "notes.worker",
      state: "running",
      health: "healthy",
      runtime: { endpoint_class: "private_authority_redacted" },
      operation: { kind: "start", status: "committed" },
    });
    expect(supervisor.startCount).toBe(1);

    const replay = await app.inject({
      method: "POST",
      url: `/packages/${manifest.package_id}/sidecars/notes.worker/start`,
      payload: { idempotency_key: "bbbbbbbbbbbbbbbb", expected_generation: installed.record.lifecycle_generation },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().operation.operation_id).toBe(started.json().operation.operation_id);
    expect(supervisor.startCount).toBe(1);

    const projection = await app.inject({ method: "GET", url: `/packages/${manifest.package_id}/sidecars/notes.worker/lifecycle` });
    expect(projection.statusCode).toBe(200);
    const serialized = `${started.body}\n${projection.body}`;
    expect(serialized).not.toMatch(/https?:|127\.|localhost|0\.0\.0\.0|\bport\b|endpoint"|authorization|token|secret|pid|process_id|host_path|argv|env|payload\/|adapter|raw_/i);
    await app.close();
  });

  it("adds safe installed package projections without exposing sidecar internals or changing app catalog behavior", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-sc002-routes-")); roots.push(root);
    const h = await createLifecycleHarness(path.join(root, "apps"));
    const packageStore = new InstalledPackageStore(path.join(root, "packages"));
    await packageStore.initialize();
    await packageStore.installPackage({
      manifest: await packageComponentFixture("valid-provider-sidecar"),
      packageDigest: `sha256:${"7".repeat(64)}`,
      source: { kind: "repository_fixture", label: "Synthetic SideCar provider fixture" },
      installedAt: "2026-09-01T12:00:00.000Z",
    });
    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, createAppLifecycleRoutePlatform([
      { routeKey: "resume-builder", displayName: "Resume Builder", publisherName: "BrainDrive", availableVersion: "1.0.0", service: h.service },
    ], 2, { packageStore }));

    const response = await app.inject({ method: "GET", url: "/apps" });
    expect(response.statusCode).toBe(200);
    const catalog = response.json();
    expect(catalog.apps).toHaveLength(1);
    expect(catalog.apps[0]).toMatchObject({ route_key: "resume-builder", available_actions: ["install"] });
    expect(catalog.packages).toHaveLength(1);
    expect(catalog.packages[0]).toMatchObject({
      projection_version: 1,
      identity: { package_id: "ai.braindrive.internet-search.searxng", display_name: "Internet Search Provider" },
      package_kind: ["capability_provider"],
      state: "enabled",
      operations: [{ operation_id: "web.search@1" }, { operation_id: "web.read@1" }],
      components: expect.arrayContaining([
        expect.objectContaining({ component_id: "search.provider", component_kind: "capability_provider", launchable: false }),
        expect.objectContaining({ component_id: "search.runtime", component_kind: "sidecar", launchable: false, health: "unknown" }),
      ]),
    });
    expect(catalog.packages[0].available_actions).not.toContain("launch");
    const serialized = JSON.stringify(catalog.packages[0]);
    expect(serialized).not.toMatch(/payload\/|adapter|export_name|provider-key|secret|endpoint|private_binding|host_path|raw_response|service_name|https?:\/\//i);
    await app.close();
  });

  it("blocks legacy app install and enable actions when dual-projected required dependencies are unavailable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-sc007-legacy-dependency-")); roots.push(root);
    const routeKey = "research-consumer";
    const appId = "ai.braindrive.research-consumer";
    const h = await createLifecycleHarness(path.join(root, "app"), { appId, routeKey, displayName: "Research Consumer" });
    const packageStore = new InstalledPackageStore(path.join(root, "packages"));
    await packageStore.initialize();
    await packageStore.installPackage({
      manifest: withRequiredSearchDependency(await packageComponentFixture("valid-app-owned-sidecar"), appId, routeKey),
      packageDigest: `sha256:${"9".repeat(64)}`,
      source: { kind: "repository_fixture", label: "Synthetic app consumer fixture" },
      installedAt: "2026-09-01T12:00:00.000Z",
    });

    const missingResolver = dependencyResolver({
      operation_id: "web.search@1",
      state: "missing",
      callable: false,
      provider_count: 0,
      failure_code: "provider_unavailable",
      safe_message: "Capability provider is unavailable.",
      checked_at: "2026-09-01T12:05:00.000Z",
    });
    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, createAppLifecycleRoutePlatform([
      { routeKey, displayName: "Research Consumer", publisherName: "BrainDrive", availableVersion: "1.0.0", service: h.service },
    ], 2, { packageStore, capabilityDependencyResolver: missingResolver }));

    const blockedCatalog = (await app.inject({ method: "GET", url: "/apps" })).json();
    expect(blockedCatalog.apps[0]).toMatchObject({
      route_key: routeKey,
      dependency_readiness: { status: "blocked", required_available: false, blocking_operation_ids: ["web.search@1"] },
      capability_dependency_status: [{ operation_id: "web.search@1", requirement: "required", state: "missing", callable: false }],
      available_actions: [],
    });
    expect(blockedCatalog.packages[0]).toMatchObject({
      dependency_readiness: { status: "blocked", blocking_operation_ids: ["web.search@1"] },
    });

    const blockedInstall = await app.inject({ method: "POST", url: `/apps/${routeKey}/install`, payload: installBody() });
    expect(blockedInstall.statusCode).toBe(409);
    expect(blockedInstall.json()).toMatchObject({ error: "provider_unavailable", retryable: false });
    expect(await h.service.status()).toMatchObject({ state: "not_installed", generation: 0 });
    expect(h.supervisor.startCount).toBe(0);
    await app.close();

    const mutable: DependencyResolution = {
      operation_id: "web.search@1",
      state: "available",
      callable: true,
      provider_count: 1,
      failure_code: null,
      safe_message: "Capability dependency is available.",
      checked_at: "2026-09-01T12:10:00.000Z",
    };
    const enabledApp = Fastify();
    enabledApp.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(enabledApp, createAppLifecycleRoutePlatform([
      { routeKey, displayName: "Research Consumer", publisherName: "BrainDrive", availableVersion: "1.0.0", service: h.service },
    ], 2, { packageStore, capabilityDependencyResolver: dependencyResolver(mutable) }));
    const installed = await enabledApp.inject({ method: "POST", url: `/apps/${routeKey}/install`, payload: installBody() });
    expect(installed.statusCode).toBe(200);
    const disabled = await enabledApp.inject({
      method: "POST",
      url: `/apps/${routeKey}/disable`,
      payload: { operation_id: crypto.randomUUID(), idempotency_key: "cccccccccccccccc", expected_generation: installed.json().generation, installation_id: installed.json().identity.installation_id },
    });
    expect(disabled.statusCode).toBe(200);
    mutable.state = "unhealthy";
    mutable.callable = false;
    mutable.failure_code = "provider_unhealthy";
    mutable.safe_message = "Capability provider is unhealthy.";

    const blockedStatus = (await enabledApp.inject({ method: "GET", url: `/apps/${routeKey}/status` })).json();
    expect(blockedStatus).toMatchObject({
      state: "disabled",
      dependency_readiness: { status: "blocked", blocking_operation_ids: ["web.search@1"] },
      capability_dependency_status: [{ operation_id: "web.search@1", state: "unhealthy", callable: false }],
      available_actions: ["uninstall"],
    });
    const blockedEnable = await enabledApp.inject({
      method: "POST",
      url: `/apps/${routeKey}/enable`,
      payload: { operation_id: crypto.randomUUID(), idempotency_key: "dddddddddddddddd", expected_generation: blockedStatus.generation, installation_id: installed.json().identity.installation_id },
    });
    expect(blockedEnable.statusCode).toBe(409);
    expect(blockedEnable.json()).toMatchObject({ error: "provider_unavailable", retryable: false });
    expect(await h.service.status()).toMatchObject({ state: "disabled", generation: blockedStatus.generation });
    await enabledApp.close();
  });

  it.each([
    ["missing", 0, "provider_unavailable"],
    ["unavailable", 1, "provider_unavailable"],
    ["disabled", 1, "provider_unavailable"],
    ["unhealthy", 1, "provider_unhealthy"],
    ["unauthorized", 1, "not_authorized"],
    ["selection_required", 2, "provider_selection_required"],
    ["unsupported_target", 1, "unsupported_target"],
    ["unknown", 0, "unknown"],
  ] as const)("blocks required %s dependency before install staging or runtime start", async (state, providerCount, failureCode) => {
    const root = await mkdtemp(path.join(os.tmpdir(), `bd-ac003-required-${state}-`)); roots.push(root);
    const routeKey = "research-consumer";
    const appId = "ai.braindrive.research-consumer";
    const h = await createLifecycleHarness(path.join(root, "app"), { appId, routeKey, displayName: "Research Consumer" });
    const packageStore = new InstalledPackageStore(path.join(root, "packages"));
    await packageStore.initialize();
    await packageStore.installPackage({
      manifest: withRequiredSearchDependency(await packageComponentFixture("valid-app-owned-sidecar"), appId, routeKey),
      packageDigest: `sha256:${"b".repeat(64)}`,
      source: { kind: "repository_fixture", label: "Synthetic required dependency fixture" },
      installedAt: "2026-09-01T12:00:00.000Z",
    });
    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, createAppLifecycleRoutePlatform([
      { routeKey, displayName: "Research Consumer", publisherName: "BrainDrive", availableVersion: "1.0.0", service: h.service },
    ], 2, {
      packageStore,
      capabilityDependencyResolver: dependencyResolver({
        operation_id: "web.search@1",
        state,
        callable: false,
        provider_count: providerCount,
        failure_code: failureCode,
        safe_message: "Capability dependency is not ready.",
        checked_at: "2026-09-01T12:05:00.000Z",
      }),
    }));

    const status = (await app.inject({ method: "GET", url: `/apps/${routeKey}/status` })).json();
    expect(status).toMatchObject({
      dependency_readiness: { status: "blocked", blocking_operation_ids: ["web.search@1"] },
      capability_dependency_status: [{ state, callable: false, failure_code: failureCode }],
      available_actions: [],
    });
    const blockedInstall = await app.inject({ method: "POST", url: `/apps/${routeKey}/install`, payload: installBody() });
    expect(blockedInstall.statusCode).toBe(409);
    expect(blockedInstall.json()).toMatchObject({ error: "provider_unavailable", retryable: false });
    expect(await h.service.status()).toMatchObject({ state: "not_installed", generation: 0, installation_id: null, pending_operation_id: null });
    expect(await h.store.listOperations()).toHaveLength(0);
    expect(h.supervisor.startCount).toBe(0);
    await app.close();
  });

  it("keeps optional unavailable dependencies visible as degraded while allowing declared degraded launch", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac003-optional-degraded-")); roots.push(root);
    const routeKey = "research-consumer";
    const appId = "ai.braindrive.research-consumer";
    const h = await createLifecycleHarness(path.join(root, "app"), { appId, routeKey, displayName: "Research Consumer" });
    const packageStore = new InstalledPackageStore(path.join(root, "packages"));
    await packageStore.initialize();
    await packageStore.installPackage({
      manifest: withOptionalSearchDependency(await packageComponentFixture("valid-app-owned-sidecar"), appId, routeKey),
      packageDigest: `sha256:${"c".repeat(64)}`,
      source: { kind: "repository_fixture", label: "Synthetic optional dependency fixture" },
      installedAt: "2026-09-01T12:00:00.000Z",
    });
    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, createAppLifecycleRoutePlatform([
      { routeKey, displayName: "Research Consumer", publisherName: "BrainDrive", availableVersion: "1.0.0", service: h.service },
    ], 2, {
      packageStore,
      capabilityDependencyResolver: dependencyResolver({
        operation_id: "web.search@1",
        state: "missing",
        callable: false,
        provider_count: 0,
        failure_code: "provider_unavailable",
        safe_message: "Capability provider is unavailable.",
        checked_at: "2026-09-01T12:05:00.000Z",
      }),
    }));

    const catalog = (await app.inject({ method: "GET", url: `/apps/${routeKey}/status` })).json();
    expect(catalog).toMatchObject({
      dependency_readiness: { status: "degraded", required_available: true, optional_available: false, degraded_operation_ids: ["web.search@1"] },
      capability_dependency_status: [{ operation_id: "web.search@1", requirement: "optional", unavailable_behavior: "degrade_with_safe_status", state: "missing", callable: false }],
      available_actions: ["install"],
    });
    expect(catalog.capability_dependency_status[0].safe_message).toBe("Capability provider is unavailable.");

    const installed = await app.inject({ method: "POST", url: `/apps/${routeKey}/install`, payload: installBody() });
    expect(installed.statusCode).toBe(200);
    expect(installed.json()).toMatchObject({
      state: "active",
      dependency_readiness: { status: "degraded", degraded_operation_ids: ["web.search@1"] },
      capability_dependency_status: [{ requirement: "optional", state: "missing", callable: false }],
    });
    expect(installed.json().available_actions).toContain("launch");
    expect(h.supervisor.startCount).toBe(1);
    await app.close();
  });

  it("blocks new lifecycle sessions after a required dependency becomes unavailable post-launch", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac003-post-launch-session-")); roots.push(root);
    const routeKey = "research-consumer";
    const appId = "ai.braindrive.research-consumer";
    const h = await createLifecycleHarness(path.join(root, "app"), { appId, routeKey, displayName: "Research Consumer" });
    const packageStore = new InstalledPackageStore(path.join(root, "packages"));
    await packageStore.initialize();
    await packageStore.installPackage({
      manifest: withRequiredSearchDependency(await packageComponentFixture("valid-app-owned-sidecar"), appId, routeKey),
      packageDigest: `sha256:${"d".repeat(64)}`,
      source: { kind: "repository_fixture", label: "Synthetic required dependency fixture" },
      installedAt: "2026-09-01T12:00:00.000Z",
    });
    const mutable: DependencyResolution = {
      operation_id: "web.search@1",
      state: "available",
      callable: true,
      provider_count: 1,
      failure_code: null,
      safe_message: "Capability dependency is available.",
      checked_at: "2026-09-01T12:10:00.000Z",
    };
    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, createAppLifecycleRoutePlatform([
      { routeKey, displayName: "Research Consumer", publisherName: "BrainDrive", availableVersion: "1.0.0", service: h.service },
    ], 2, { packageStore, capabilityDependencyResolver: dependencyResolver(mutable) }));

    const installed = await app.inject({ method: "POST", url: `/apps/${routeKey}/install`, payload: installBody() });
    expect(installed.statusCode).toBe(200);
    expect(h.supervisor.startCount).toBe(1);

    mutable.state = "disabled";
    mutable.callable = false;
    mutable.failure_code = "provider_unavailable";
    mutable.safe_message = "Capability provider is disabled.";

    const refreshed = (await app.inject({ method: "GET", url: `/apps/${routeKey}/status` })).json();
    expect(refreshed).toMatchObject({
      state: "active",
      dependency_readiness: { status: "blocked", blocking_operation_ids: ["web.search@1"] },
      capability_dependency_status: [{ state: "disabled", callable: false }],
    });
    expect(refreshed.available_actions).not.toContain("launch");

    const session = await app.inject({
      method: "POST",
      url: `/apps/${routeKey}/session`,
      payload: { audience: "app_bridge", capabilities: ["career.context.read"], operation_id: crypto.randomUUID() },
    });
    expect(session.statusCode).toBe(409);
    expect(session.json()).toMatchObject({ error: "provider_unavailable", retryable: false });
    expect(session.json()).not.toHaveProperty("token");
    expect(h.supervisor.startCount).toBe(1);
    await app.close();
  });

  it("projects selection-required and unknown readiness through route DTOs without leaking provider internals", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac002-routes-readiness-")); roots.push(root);
    const routeKey = "research-consumer";
    const appId = "ai.braindrive.research-consumer";
    const h = await createLifecycleHarness(path.join(root, "app"), { appId, routeKey, displayName: "Research Consumer" });
    const packageStore = new InstalledPackageStore(path.join(root, "packages"));
    await packageStore.initialize();
    await packageStore.installPackage({
      manifest: withRequiredSearchDependency(await packageComponentFixture("valid-app-owned-sidecar"), appId, routeKey),
      packageDigest: `sha256:${"a".repeat(64)}`,
      source: { kind: "repository_fixture", label: "Synthetic app consumer fixture" },
      installedAt: "2026-09-01T12:00:00.000Z",
    });

    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, createAppLifecycleRoutePlatform([
      { routeKey, displayName: "Research Consumer", publisherName: "BrainDrive", availableVersion: "1.0.0", service: h.service },
    ], 2, {
      packageStore,
      capabilityDependencyResolver: dependencyResolver({
        operation_id: "web.search@1",
        state: "selection_required",
        callable: false,
        provider_count: 2,
        failure_code: "provider_selection_required",
        safe_message: "Owner or admin provider selection is required.",
        checked_at: "2026-09-01T12:05:00.000Z",
      }),
    }));

    const selectionRequired = (await app.inject({ method: "GET", url: `/apps/${routeKey}/status` })).json();
    expect(selectionRequired).toMatchObject({
      dependency_readiness: { status: "blocked", blocking_operation_ids: ["web.search@1"] },
      capability_dependency_status: [{ state: "selection_required", callable: false, provider_count: 2, failure_code: "provider_selection_required" }],
      available_actions: [],
    });
    expect(JSON.stringify(selectionRequired)).not.toMatch(/provider_id|payload\/|adapter|export_name|provider-key|secret|endpoint|private_binding|host_path|raw_response|service_name|https?:\/\//i);
    await app.close();

    const unknownApp = Fastify();
    unknownApp.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(unknownApp, createAppLifecycleRoutePlatform([
      { routeKey, displayName: "Research Consumer", publisherName: "BrainDrive", availableVersion: "1.0.0", service: h.service },
    ], 2, {
      packageStore,
      capabilityDependencyResolver: { resolveDependency: async () => { throw new Error("private resolver stack with http://127.0.0.1:8080"); } },
    }));

    const unknownStatus = (await unknownApp.inject({ method: "GET", url: `/apps/${routeKey}/status` })).json();
    expect(unknownStatus).toMatchObject({
      dependency_readiness: { status: "blocked", blocking_operation_ids: ["web.search@1"] },
      capability_dependency_status: [{ state: "unknown", callable: false, provider_count: 0, failure_code: "unknown" }],
      available_actions: [],
    });
    expect(JSON.stringify(unknownStatus)).not.toMatch(/resolver stack|127\.0\.0\.1|8080|provider_id|payload\/|adapter|export_name|secret|endpoint|private_binding|host_path|raw_response|service_name|https?:\/\//i);
    await unknownApp.close();
  });

  it("uses one generic handler family for two app keys and resolves unknown keys before parsing bodies", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-routes-multi-")); roots.push(root);
    const resume = await createLifecycleHarness(path.join(root, "resume"), {
      appId: "ai.braindrive.resume-builder", routeKey: "resume-builder", displayName: "Resume Builder",
    });
    const brief = await createLifecycleHarness(path.join(root, "brief"), {
      appId: "ai.braindrive.brief-builder", routeKey: "brief-builder", displayName: "Brief Builder",
    });
    const audit: Array<{ event: string; details: Record<string, unknown> }> = [];
    resume.dependencies.audit = (event, details) => audit.push({ event, details });
    brief.dependencies.audit = (event, details) => audit.push({ event, details });
    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, createAppLifecycleRoutePlatform([
      { routeKey: "resume-builder", displayName: "Resume Builder", publisherName: "BrainDrive", availableVersion: "1.0.0", service: resume.service },
      { routeKey: "brief-builder", displayName: "Brief Builder", publisherName: "BrainDrive", availableVersion: "1.0.0", service: brief.service },
    ]));

    const initialCatalog = (await app.inject({ method: "GET", url: "/apps" })).json();
    const repeatedInitialCatalog = (await app.inject({ method: "GET", url: "/apps" })).json();
    expect(repeatedInitialCatalog).toEqual(initialCatalog);
    expect(initialCatalog.apps.map((entry: { route_key: string }) => entry.route_key)).toEqual(["brief-builder", "resume-builder"]);
    expect(initialCatalog.apps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        route_key: "brief-builder",
        trust: expect.objectContaining({ status: "verified" }),
        availability: expect.objectContaining({ status: "available", error_code: null }),
        catalog: expect.objectContaining({ provenance: "verified_first_party_package", primary_resource_uri: "ui://brief-builder/main" }),
        retention: expect.objectContaining({
          retained_data_present: null,
          compatibility: "not_inspected",
          uninstall_removes: ["runtime authority", "app code", "disposable cache", "capability grants"],
          uninstall_retains: ["app storage", "artifact metadata", "export receipts", "owner exports", "lifecycle evidence"],
          post_uninstall_controls: ["delete", "export", "archive"],
        }),
        available_actions: ["install"],
      }),
    ]));
    const briefInitial = initialCatalog.apps.find((entry: { route_key: string }) => entry.route_key === "brief-builder");
    expect(JSON.stringify(briefInitial).toLowerCase()).not.toMatch(/resume|career data|job history/);

    for (const routeKey of ["resume-builder", "brief-builder"]) {
      expect((await app.inject({ method: "GET", url: `/apps/${routeKey}/status` })).statusCode).toBe(200);
      const installed = await app.inject({ method: "POST", url: `/apps/${routeKey}/install`, payload: installBody() });
      expect(installed.statusCode).toBe(200);
      expect(installed.json()).toMatchObject({ state: "active", identity: { app_id: `ai.braindrive.${routeKey}` } });
    }
    const catalog = (await app.inject({ method: "GET", url: "/apps" })).json();
    expect(catalog.apps.map((entry: { route_key: string }) => entry.route_key)).toEqual(["brief-builder", "resume-builder"]);
    expect(catalog.apps.every((entry: { catalog: { provenance: string } }) => entry.catalog.provenance === "verified_first_party_package")).toBe(true);
    expect(JSON.stringify(catalog)).not.toMatch(/entrypoint|binding_id|handler|https?:\/\//i);
    expect(audit.filter(({ event }) => event === "app.catalog.projection")).toEqual(expect.arrayContaining([
      expect.objectContaining({ details: expect.objectContaining({ app_id: "ai.braindrive.resume-builder", package_version: "1.0.0", decision: "included", error_code: null }) }),
      expect.objectContaining({ details: expect.objectContaining({ app_id: "ai.braindrive.brief-builder", package_version: "1.0.0", decision: "included", error_code: null }) }),
    ]));

    const unknown = await app.inject({ method: "POST", url: "/apps/unknown-builder/install", payload: { private_other_app_state: true } });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: "app_not_found" });
    await app.close();
  });

  it.each([
    ["revoked", "package_revoked"],
    ["unverified", "package_signature_invalid"],
    ["incompatible", "host_incompatible"],
  ] as const)("keeps an uninstalled %s available package non-launchable without staging or data access", async (failure, errorCode) => {
    const root = await mkdtemp(path.join(os.tmpdir(), `bd-app-catalog-${failure}-`)); roots.push(root);
    const h = await createLifecycleHarness(root, { appId: "ai.braindrive.brief-builder", routeKey: "brief-builder", displayName: "Brief Builder" });
    let dataAccessCount = 0;
    h.dependencies.ownerDataLifecycle = {
      prepareActivation: async () => undefined,
      cleanupDefaultUninstall: async () => undefined,
      repairState: async () => { dataAccessCount += 1; throw new Error("catalog must not inspect owner data"); },
    };
    if (failure === "revoked") await revokeFixtureVersion(h.repository, "1.0.0", "ai.braindrive.brief-builder");
    if (failure === "unverified") {
      const descriptor = h.repository.packagesByAppVersion!["ai.braindrive.brief-builder@1.0.0"]!.descriptorPath;
      await import("node:fs/promises").then(async ({ writeFile }) => writeFile(descriptor, "{not-signed}\n", "utf8"));
    }
    if (failure === "incompatible") h.dependencies.verifier = new PackageVerifier("0.1.0");
    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, createAppLifecycleRoutePlatform([
      { routeKey: "brief-builder", displayName: "Brief Builder", publisherName: "BrainDrive", availableVersion: "1.0.0", service: h.service },
    ]));

    const catalog = (await app.inject({ method: "GET", url: "/apps" })).json().apps[0];
    expect(catalog).toMatchObject({ state: "not_installed", availability: { error_code: errorCode }, available_actions: [] });
    expect(catalog.available_actions).not.toContain("launch");
    expect(catalog.available_actions).not.toContain("install");
    expect(dataAccessCount).toBe(0);
    expect(h.supervisor.startCount).toBe(0);
    expect(await h.service.status()).toMatchObject({ state: "not_installed", generation: 0 });
    await app.close();
  });

  it("admits at most two active first-party apps and denies a third before staging or data preparation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-routes-admission-")); roots.push(root);
    const harnesses = await Promise.all(["one-builder", "two-builder", "three-builder"].map((routeKey) =>
      createLifecycleHarness(path.join(root, routeKey), { appId: `ai.braindrive.${routeKey}`, routeKey, displayName: routeKey })));
    const audit: Array<{ event: string; details: Record<string, unknown> }> = [];
    harnesses.forEach((harness) => { harness.dependencies.audit = (event, details) => audit.push({ event, details }); });
    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, createAppLifecycleRoutePlatform(harnesses.map((harness, index) => ({
      routeKey: ["one-builder", "two-builder", "three-builder"][index]!, displayName: `App ${index + 1}`, publisherName: "BrainDrive", availableVersion: "1.0.0", service: harness.service,
    }))));
    const results = await Promise.all(["one-builder", "two-builder", "three-builder"].map((routeKey) =>
      app.inject({ method: "POST", url: `/apps/${routeKey}/install`, payload: installBody() })));
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 200, 409]);
    const deniedIndex = results.findIndex((result) => result.statusCode === 409);
    expect(results[deniedIndex]!.json()).toMatchObject({ error: "active_app_limit_reached", retryable: false });
    expect(await harnesses[deniedIndex]!.service.status()).toMatchObject({ state: "not_installed", generation: 0 });
    expect(harnesses[deniedIndex]!.supervisor.startCount).toBe(0);
    expect(audit).toContainEqual({ event: "app.lifecycle.admission", details: expect.objectContaining({ app_id: `ai.braindrive.${["one-builder", "two-builder", "three-builder"][deniedIndex]}`, package_version: "1.0.0", decision: "denied", error_code: "active_app_limit_reached" }) });
    expect(SUPERVISOR_POLICY).toMatchObject({ max_cpu_cores: 1, max_memory_bytes: 536_870_912, max_crash_restarts: 3 });
    await app.close();
  });

  it("requires exact owner administration and rejects cross-owner requests before mutation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-routes-auth-")); roots.push(root);
    const h = await createLifecycleHarness(root);
    const app = Fastify();
    app.addHook("preHandler", async (request) => {
      if (request.headers["x-test-anonymous"]) return;
      request.authContext = { actorId: request.headers["x-test-other-owner"] ? "other-owner" : "owner", actorType: "owner", mode: "local-owner", permissions: request.headers["x-test-denied"] ? { ...permissions, administration: false } : permissions };
    });
    registerAppLifecycleRoutes(app, h.service);

    expect((await app.inject({ method: "GET", url: "/apps/resume-builder", headers: { "x-test-anonymous": "1" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/apps/resume-builder", headers: { "x-test-denied": "1" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/apps/resume-builder/install", headers: { "x-test-other-owner": "1" }, payload: installBody() })).statusCode).toBe(403);
    expect((await h.service.status()).state).toBe("not_installed");
    await app.close();
  });

  it("returns stable owner-safe identity, trust, source, compatibility, capability, and retention DTOs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-routes-safe-")); roots.push(root);
    const h = await createLifecycleHarness(root);
    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, h.service);

    const body = installBody();
    const installed = await app.inject({ method: "POST", url: "/apps/resume-builder/install", payload: body });
    expect(installed.statusCode).toBe(200);
    expect(installed.json()).toMatchObject({
      contract_version: 1,
      identity: { app_id: "ai.braindrive.resume-builder", display_name: "Resume Builder", publisher_name: "BrainDrive" },
      state: "active",
      trust: { status: "verified" },
      source: { kind: "repository_fixture" },
      compatibility: { host: true },
      retention: { owner_data_preserved: true },
      operation: { operation_id: body.operation_id, status: "committed" },
    });
    expect((await app.inject({ method: "GET", url: "/apps" })).json().apps).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: "/apps/resume-builder/inspect" })).statusCode).toBe(200);
    const serialized = installed.body.toLowerCase();
    expect(serialized).not.toContain(root.toLowerCase());
    expect(serialized).not.toContain("connection_token");
    expect(serialized).not.toContain("private_key");
    expect(serialized).not.toContain("package_root");
    await app.close();
  });

  it("projects owner-safe modern chat presentations without workspace internals", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-routes-presentations-")); roots.push(root);
    const h = await createLifecycleHarness(root);
    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, createAppLifecycleRoutePlatform([
      { routeKey: "resume-builder", displayName: "Resume Builder", publisherName: "BrainDrive", availableVersion: MODERN_FIXTURE_VERSION, service: h.service },
    ]));

    const installed = await app.inject({ method: "POST", url: "/apps/resume-builder/install", payload: { ...installBody(), version: MODERN_FIXTURE_VERSION } });
    expect(installed.statusCode).toBe(200);
    const catalog = (await app.inject({ method: "GET", url: "/apps" })).json().apps[0];
    expect(catalog.catalog.presentations).toEqual({
      presentation_set_version: 1,
      default_presentation_id: "just.chat",
      profiles: [
        expect.objectContaining({
          presentation_id: "just.chat",
          type: "chat_workspace",
          label: "Launch",
          workspace_id: "resume.chat",
          owner_visibility: "primary",
        }),
        expect.objectContaining({
          presentation_id: "structured.internal",
          type: "surface",
          resource_uri: "ui://resume-builder/main",
          owner_visibility: "internal",
        }),
      ],
    });
    expect(JSON.stringify(catalog.catalog.presentations)).not.toMatch(/workspace_version|documents|actions|payload\/resources|content_digest|workspace_start/i);
    await app.close();
  });

  it("binds installation and generation, returns safe conflicts, and replays one committed operation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-route-binding-")); roots.push(root);
    const h = await createLifecycleHarness(root);
    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, h.service);
    const body = installBody();
    const first = await app.inject({ method: "POST", url: "/apps/resume-builder/install", payload: body });
    const replay = await app.inject({ method: "POST", url: "/apps/resume-builder/install", payload: body });
    expect(replay.json().operation.operation_id).toBe(first.json().operation.operation_id);
    expect(h.supervisor.startCount).toBe(1);

    const status = first.json();
    const wrongInstall = await app.inject({ method: "POST", url: "/apps/resume-builder/disable", payload: { operation_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(), expected_generation: status.generation, installation_id: crypto.randomUUID() } });
    expect(wrongInstall).toMatchObject({ statusCode: 403 });
    expect(wrongInstall.json()).toMatchObject({ error: "denied", retryable: false });
    const stale = await app.inject({ method: "POST", url: "/apps/resume-builder/disable", payload: { operation_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(), expected_generation: 0, installation_id: status.identity.installation_id } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: "conflict", retryable: true });
    expect((await h.service.status()).state).toBe("active");
    await app.close();
  });

  it("requires explicit install approval and retained-data uninstall confirmation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-route-confirm-")); roots.push(root);
    const h = await createLifecycleHarness(root);
    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, h.service);
    expect((await app.inject({ method: "POST", url: "/apps/resume-builder/install", payload: { ...installBody(), approve_capabilities: false } })).json()).toEqual({ error: "invalid_request" });
    const installed = (await app.inject({ method: "POST", url: "/apps/resume-builder/install", payload: installBody() })).json();
    const uninstall = { operation_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(), expected_generation: installed.generation, installation_id: installed.identity.installation_id };
    expect((await app.inject({ method: "POST", url: "/apps/resume-builder/uninstall", payload: uninstall })).json()).toEqual({ error: "invalid_request" });
    expect((await h.service.status()).state).toBe("active");
    await app.close();
  });

  it("requires fresh approval for widening app updates and allows narrowing while replacing grants", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac008-route-update-grants-")); roots.push(root);
    const routeKey = "research-consumer";
    const appId = "ai.braindrive.research-consumer";
    const h = await createLifecycleHarness(path.join(root, "app"), { appId, routeKey, displayName: "Research Consumer" });
    h.dependencies.repository = await createSyntheticFirstPartyFixtureRepository(path.join(root, "app", "source"), [
      { appId, routeKey, displayName: "Research Consumer", version: "1.0.0", requestedCapabilities: ["career.context.read"] },
      { appId, routeKey, displayName: "Research Consumer", version: "2.0.0", requestedCapabilities: ["career.context.read", "app.inference.request"] },
      { appId, routeKey, displayName: "Research Consumer", version: "3.0.0", requestedCapabilities: ["career.context.read"] },
    ]);
    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, createAppLifecycleRoutePlatform([
      { routeKey, displayName: "Research Consumer", publisherName: "BrainDrive", service: h.service },
    ]));

    const installed = (await app.inject({ method: "POST", url: `/apps/${routeKey}/install`, payload: installBody() })).json();
    const prior = await h.service.ownerDescriptor();
    const priorGrant = prior.grant!;
    expect(priorGrant.capabilities).toEqual(["career.context.read"]);

    const oldSessionResponse = await app.inject({
      method: "POST",
      url: `/apps/${routeKey}/session`,
      payload: { audience: "app_data", capabilities: ["career.context.read"], operation_id: crypto.randomUUID() },
    });
    expect(oldSessionResponse.statusCode).toBe(200);
    const oldSession = oldSessionResponse.json();
    expect(oldSession.claims).toMatchObject({
      audience: "app_data",
      installation_id: installed.identity.installation_id,
      capabilities: ["career.context.read"],
    });
    expect(oldSession.claims).not.toHaveProperty("grant_id");

    const wideningDenied = await app.inject({
      method: "POST",
      url: `/apps/${routeKey}/update`,
      payload: {
        operation_id: crypto.randomUUID(),
        idempotency_key: "eeeeeeeeeeeeeeee",
        expected_generation: installed.generation,
        installation_id: installed.identity.installation_id,
        version: "2.0.0",
        approve_capabilities: false,
      },
    });
    expect(wideningDenied.statusCode).toBe(409);
    expect(wideningDenied.json()).toMatchObject({ error: "grant_widening_approval_required", retryable: false });
    expect(await h.service.status()).toMatchObject({ state: "active", generation: installed.generation, grant_id: priorGrant.grant_id });

    const widened = (await app.inject({
      method: "POST",
      url: `/apps/${routeKey}/update`,
      payload: {
        operation_id: crypto.randomUUID(),
        idempotency_key: "ffffffffffffffff",
        expected_generation: installed.generation,
        installation_id: installed.identity.installation_id,
        version: "2.0.0",
        approve_capabilities: true,
      },
    })).json();
    const widenedGrant = (await h.service.ownerDescriptor()).grant!;
    expect(widenedGrant.capabilities).toEqual(["career.context.read", "app.inference.request"]);
    expect(widenedGrant.grant_id).not.toBe(priorGrant.grant_id);
    expect((await h.store.readGrant(priorGrant.grant_id))?.revoked_at).not.toBeNull();
    expect(() => h.tokenBroker.consume(oldSession.token, {
      audience: "app_data",
      capability: "career.context.read",
      installationId: installed.identity.installation_id,
      currentGrant: widenedGrant,
    })).toThrowError(expect.objectContaining({ code: "token_scope_invalid" }));
    expect((await app.inject({
      method: "POST",
      url: `/apps/${routeKey}/session`,
      payload: { audience: "app_inference", capabilities: ["app.inference.request"], operation_id: crypto.randomUUID() },
    })).statusCode).toBe(200);

    const narrowed = await app.inject({
      method: "POST",
      url: `/apps/${routeKey}/update`,
      payload: {
        operation_id: crypto.randomUUID(),
        idempotency_key: "gggggggggggggggg",
        expected_generation: widened.generation,
        installation_id: widened.identity.installation_id,
        version: "3.0.0",
        approve_capabilities: false,
      },
    });
    expect(narrowed.statusCode).toBe(200);
    const narrowedGrant = (await h.service.ownerDescriptor()).grant!;
    expect(narrowedGrant.capabilities).toEqual(["career.context.read"]);
    expect((await h.store.readGrant(widenedGrant.grant_id))?.revoked_at).not.toBeNull();
    const narrowedInference = await app.inject({
      method: "POST",
      url: `/apps/${routeKey}/session`,
      payload: { audience: "app_inference", capabilities: ["app.inference.request"], operation_id: crypto.randomUUID() },
    });
    expect(narrowedInference.statusCode).toBe(409);
    expect(narrowedInference.json()).toMatchObject({ error: "widened_grant", retryable: false });

    await app.close();
  });

  it("offers update from recoverable failure when a newer verified package is available", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-route-failed-update-")); roots.push(root);
    const routeKey = "research-consumer";
    const appId = "ai.braindrive.research-consumer";
    const h = await createLifecycleHarness(path.join(root, "app"), { appId, routeKey, displayName: "Research Consumer" });
    h.dependencies.repository = await createSyntheticFirstPartyFixtureRepository(path.join(root, "app", "source"), [
      { appId, routeKey, displayName: "Research Consumer", version: "1.0.0" },
      { appId, routeKey, displayName: "Research Consumer", version: "2.0.0" },
    ]);
    const installed = await h.service.install({ version: "1.0.0", idempotencyKey: "failed-update-install", approveCapabilities: true });
    for (const runtime of h.supervisor.inspect(installed.record.installation_id!)) await h.supervisor.stop(runtime, "reconcile");
    const failed = { ...installed.record, state: "failed_recoverable" as const, generation: installed.record.generation + 1, updated_at: new Date().toISOString() };
    await h.store.compareAndSwapLifecycle(installed.record.generation, failed);

    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, createAppLifecycleRoutePlatform([
      { routeKey, displayName: "Research Consumer", publisherName: "BrainDrive", availableVersion: "2.0.0", service: h.service },
    ]));

    const catalog = (await app.inject({ method: "GET", url: "/apps" })).json();
    expect(catalog.apps[0]).toMatchObject({
      state: "failed_recoverable",
      version: { installed: "1.0.0", available: "2.0.0" },
    });
    expect(catalog.apps[0].available_actions).toEqual(["update", "recover", "uninstall"]);

    const updated = await app.inject({
      method: "POST",
      url: `/apps/${routeKey}/update`,
      payload: {
        operation_id: crypto.randomUUID(),
        idempotency_key: "hhhhhhhhhhhhhhhh",
        expected_generation: failed.generation,
        installation_id: failed.installation_id,
        version: "2.0.0",
        approve_capabilities: true,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ state: "active", version: { installed: "2.0.0", available: "2.0.0" } });

    await app.close();
  });
});
