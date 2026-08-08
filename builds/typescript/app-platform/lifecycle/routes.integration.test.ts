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

describe("owner lifecycle gateway routes", () => {
  it("requires owner administration and never returns host paths or connection authority", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-routes-")); roots.push(root);
    const h = await createLifecycleHarness(root);
    const app = Fastify();
    app.addHook("preHandler", async (request) => {
      request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions: request.headers["x-test-denied"] ? { ...permissions, administration: false } : permissions };
    });
    registerAppLifecycleRoutes(app, h.service);

    expect((await app.inject({ method: "GET", url: "/apps/resume-builder", headers: { "x-test-denied": "1" } })).statusCode).toBe(403);
    const installed = await app.inject({ method: "POST", url: "/apps/resume-builder/install", payload: { version: "1.0.0", idempotency_key: "route-install-key1", approve_capabilities: true } });
    expect(installed.statusCode).toBe(200);
    expect(installed.json()).toMatchObject({ app_id: "ai.braindrive.resume-builder", state: "active", retained_owner_data: true });
    const serialized = installed.body.toLowerCase();
    expect(serialized).not.toContain(root.toLowerCase());
    expect(serialized).not.toContain("connection_token");
    expect(serialized).not.toContain("private_key");

    const session = await app.inject({ method: "POST", url: "/apps/resume-builder/session", payload: { audience: "app_data", capabilities: ["career.context.read"], operation_id: crypto.randomUUID() } });
    expect(session.statusCode).toBe(200);
    expect(session.json().token).toMatch(/^[A-Za-z0-9_-]+$/);
    await app.close();
  });

  it("returns stable validation and lifecycle error codes without leaking package metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-route-error-")); roots.push(root);
    const h = await createLifecycleHarness(root);
    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, h.service);
    expect((await app.inject({ method: "POST", url: "/apps/resume-builder/install", payload: { version: "1.0.0" } })).json()).toEqual({ error: "invalid_request" });
    const denied = await app.inject({ method: "POST", url: "/apps/resume-builder/install", payload: { version: "1.0.0", idempotency_key: "route-install-key1", approve_capabilities: false } });
    expect(denied.json()).toEqual({ error: "grant_approval_required", retryable: false });
    await app.close();
  });
});
