import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { PermissionSet } from "../../contracts.js";
import { AppPlatformError } from "../lifecycle/errors.js";
import { HostOwnerCapabilityAuthorization } from "../../resume-domain/capability-policy.js";
import type { AppMcpHost } from "./app-host.js";
import { registerAppMcpHostRoutes } from "./routes.js";

const permissions: PermissionSet = {
  memory_access: true,
  tool_access: true,
  system_actions: true,
  delegation: true,
  approval_authority: true,
  administration: true,
};

function createHost() {
  return {
    launch: vi.fn(async () => ({ launch_version: 1, session_id: crypto.randomUUID() })),
    handleBridge: vi.fn(async () => ({ status: "ready" })),
    handleAppsBridge: vi.fn(async () => ({ jsonrpc: "2.0", id: "request", result: {} })),
    cancelAppsBridgeRequest: vi.fn(() => true),
    handleServerCapability: vi.fn(async () => ({ status: "completed" })),
    handleOwnerCapability: vi.fn(async () => ({ status: "ok" })),
    placeCareerReturn: vi.fn(async () => ({ placement: "career_journal", committed: true })),
    close: vi.fn(() => true),
  } as unknown as AppMcpHost;
}

describe("owner MCP Apps host gateway routes", () => {
  it("requires owner administration and accepts only the narrow sandbox marker", async () => {
    const host = createHost();
    const app = Fastify();
    app.addHook("preHandler", async (request) => {
      request.authContext = {
        actorId: "owner",
        actorType: "owner",
        mode: "local-owner",
        permissions: request.headers["x-test-denied"] ? { ...permissions, administration: false } : permissions,
      };
    });
    registerAppMcpHostRoutes(app, host);

    expect((await app.inject({ method: "POST", url: "/apps/resume-builder/launch", headers: { "x-test-denied": "1" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/apps/resume-builder/launch" })).statusCode).toBe(200);
    const resume = { session_id: crypto.randomUUID(), view_id: crypto.randomUUID(), operation_id: crypto.randomUUID(), bridge_generation: 4 };
    expect((await app.inject({ method: "POST", url: "/apps/resume-builder/launch", payload: { entry_point: "career", resume } })).statusCode).toBe(200);
    expect(host.launch).toHaveBeenLastCalledWith("career", {
      sessionId: resume.session_id,
      viewId: resume.view_id,
      operationId: resume.operation_id,
      bridgeGeneration: 4,
    });

    const sessionId = crypto.randomUUID();
    const invalid = await app.inject({
      method: "POST",
      url: "/apps/resume-builder/bridge",
      payload: { session_id: sessionId, origin: "https://host.invalid", source: "window", message: {} },
    });
    expect(invalid.json()).toEqual({ error: "invalid_request" });
    expect(host.handleBridge).not.toHaveBeenCalled();

    const valid = await app.inject({
      method: "POST",
      url: "/apps/resume-builder/bridge",
      payload: { session_id: sessionId, origin: "null", source: "sandbox_iframe", message: {} },
    });
    expect(valid.json()).toEqual({ status: "ready" });
    expect(host.handleBridge).toHaveBeenCalledWith(sessionId, {}, { origin: "null", sourceMatches: true });

    const envelope = { bridge_envelope_version: 1 };
    const apps = await app.inject({ method: "POST", url: "/apps/resume-builder/apps-bridge", payload: { session_id: sessionId, envelope } });
    expect(apps.json()).toMatchObject({ jsonrpc: "2.0", id: "request" });
    expect(host.handleAppsBridge).toHaveBeenCalledWith(sessionId, envelope);

    const requestId = crypto.randomUUID();
    expect((await app.inject({ method: "DELETE", url: `/apps/resume-builder/sessions/${sessionId}/requests/${requestId}` })).statusCode).toBe(204);
    expect(host.cancelAppsBridgeRequest).toHaveBeenCalledWith(sessionId, requestId);
    await app.close();
  });

  it("keeps app-server capability calls behind a bearer token instead of owner auth", async () => {
    const host = createHost();
    const app = Fastify();
    registerAppMcpHostRoutes(app, host);
    const operationId = crypto.randomUUID();
    const payload = {
      request_version: 1, capability: "career.context.read", capability_version: 1,
      operation_id: operationId, idempotency_key: "m4-server-operation-0001", input: { entry_point: "direct" },
    };
    expect((await app.inject({ method: "POST", url: "/internal/apps/resume-builder/capabilities", payload })).statusCode).toBe(401);
    const response = await app.inject({
      method: "POST", url: "/internal/apps/resume-builder/capabilities",
      headers: { authorization: `Bearer ${"a".repeat(43)}` }, payload,
    });
    expect(response.statusCode).toBe(200);
    expect(host.handleServerCapability).toHaveBeenCalledWith(
      "a".repeat(43), "career.context.read", 1, { entry_point: "direct" }, operationId, "m4-server-operation-0001",
    );

    vi.mocked(host.handleServerCapability).mockRejectedValueOnce(new AppPlatformError("token_scope_invalid", "private grant and record detail", 403));
    const denied = await app.inject({
      method: "POST", url: "/internal/apps/resume-builder/capabilities",
      headers: { authorization: `Bearer ${"b".repeat(43)}` }, payload,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: "denied", correlation_id: operationId } });
    expect(denied.json()).not.toHaveProperty("owner_state");
    expect(denied.body).not.toContain("private grant and record detail");
    await app.close();
  });

  it("returns stable safe errors and closes only the named session", async () => {
    const host = createHost();
    vi.mocked(host.launch).mockRejectedValue(new AppPlatformError("protocol_incompatible", "internal protocol detail"));
    const app = Fastify();
    app.addHook("preHandler", async (request) => {
      request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions };
    });
    registerAppMcpHostRoutes(app, host);

    const launch = await app.inject({ method: "POST", url: "/apps/resume-builder/launch" });
    expect(launch.json()).toEqual({ error: "protocol_incompatible", retryable: false });
    expect(launch.body).not.toContain("internal protocol detail");

    const sessionId = crypto.randomUUID();
    expect((await app.inject({ method: "DELETE", url: `/apps/resume-builder/sessions/${sessionId}` })).statusCode).toBe(204);
    expect(host.close).toHaveBeenCalledWith(sessionId);
    await app.close();
  });

  it("keeps owner-confirmed data and Career return calls behind owner administration", async () => {
    const host = createHost();
    const app = Fastify();
    app.addHook("preHandler", async (request) => {
      request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions: request.headers["x-test-denied"] ? { ...permissions, administration: false } : permissions };
    });
    registerAppMcpHostRoutes(app, host);
    const operationId = crypto.randomUUID();
    const payload = { capability: "career.facts.confirm", operation_id: operationId, input: {}, owner_confirmed: true };
    expect((await app.inject({ method: "POST", url: "/apps/resume-builder/data/call", headers: { "x-test-denied": "1" }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/apps/resume-builder/data/call", payload })).statusCode).toBe(200);
    expect(host.handleOwnerCapability).toHaveBeenCalledWith("career.facts.confirm", {}, operationId, true, expect.any(HostOwnerCapabilityAuthorization));

    const summary = { summary_version: 1, status: "completed", outcome_summary: "Synthetic completion", approved_reference: null, stable_fact_proposals: [], next_career_action: null, updated_at: "2026-08-07T12:00:00.000Z" };
    const returnOperationId = crypto.randomUUID();
    expect((await app.inject({ method: "POST", url: "/apps/resume-builder/career-return", payload: { operation_id: returnOperationId, entry_point: "career", summary } })).statusCode).toBe(200);
    expect(host.placeCareerReturn).toHaveBeenCalledWith(summary, "career", returnOperationId);
    await app.close();
  });

  it("returns an owner-safe conflict DTO for data calls", async () => {
    const host = createHost();
    vi.mocked(host.handleOwnerCapability).mockRejectedValue(new AppPlatformError("conflict", "private current record content", 409, { currentRevision: 4 }));
    const app = Fastify();
    app.addHook("preHandler", async (request) => {
      request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions };
    });
    registerAppMcpHostRoutes(app, host);
    const operationId = crypto.randomUUID();
    const response = await app.inject({
      method: "POST",
      url: "/apps/resume-builder/data/call",
      payload: { capability: "career.facts.confirm", operation_id: operationId, input: {}, owner_confirmed: true },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "conflict", correlation_id: operationId },
      owner_state: { state: "conflict", current_revision: 4, proposal_preserved: true },
    });
    expect(response.body).not.toContain("private current record content");
    await app.close();
  });
});
