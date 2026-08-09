import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import type { PermissionSet } from "../../contracts.js";
import { registerAppLifecycleRoutes } from "./routes.js";
import { createLifecycleHarness } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const permissions: PermissionSet = { memory_access: true, tool_access: true, system_actions: true, delegation: true, approval_authority: true, administration: true };

function installBody(generation = 0, operationId = crypto.randomUUID()) {
  return { operation_id: operationId, idempotency_key: operationId, expected_generation: generation, installation_id: null, version: "1.0.0", approve_capabilities: true };
}

describe("owner lifecycle gateway routes", () => {
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
