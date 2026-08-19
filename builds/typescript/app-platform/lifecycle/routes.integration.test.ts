import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import type { PermissionSet } from "../../contracts.js";
import { SUPERVISOR_POLICY } from "../contracts/package.js";
import { revokeFixtureVersion } from "./fixture-repository.js";
import { PackageVerifier } from "./package-verifier.js";
import { createAppLifecycleRoutePlatform, registerAppLifecycleRoutes } from "./routes.js";
import { createLifecycleHarness } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const permissions: PermissionSet = { memory_access: true, tool_access: true, system_actions: true, delegation: true, approval_authority: true, administration: true };

function installBody(generation = 0, operationId = crypto.randomUUID()) {
  return { operation_id: operationId, idempotency_key: operationId, expected_generation: generation, installation_id: null, version: "1.0.0", approve_capabilities: true };
}

describe("owner lifecycle gateway routes", () => {
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
      expect.objectContaining({ route_key: "brief-builder", trust: expect.objectContaining({ status: "verified" }), availability: expect.objectContaining({ status: "available", error_code: null }), catalog: expect.objectContaining({ provenance: "verified_first_party_package", primary_resource_uri: "ui://brief-builder/main" }), retention: expect.objectContaining({ retained_data_present: null, compatibility: "not_inspected", uninstall_retains: ["owner data", "owner exports", "lifecycle evidence"] }), available_actions: ["install"] }),
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
});
