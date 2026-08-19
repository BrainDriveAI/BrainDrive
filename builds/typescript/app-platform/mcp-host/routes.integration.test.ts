import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { PermissionSet } from "../../contracts.js";
import { AppPlatformError } from "../lifecycle/errors.js";
import type { AppMcpHost } from "./app-host.js";
import { createAppMcpHostRoutePlatform, registerAppMcpHostRoutes } from "./routes.js";

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
    appId: "ai.braindrive.resume-builder",
    routeKey: "resume-builder",
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
  it("rejects host identity swaps and keeps registered route entries effectively immutable", () => {
    const resume = createHost();
    const brief = {
      ...createHost(),
      appId: "ai.braindrive.brief-builder",
      routeKey: "brief-builder",
    } as unknown as AppMcpHost;

    expect(() => createAppMcpHostRoutePlatform([
      { appId: "ai.braindrive.resume-builder", routeKey: "resume-builder", host: brief },
    ])).toThrowError(expect.objectContaining({ code: "descriptor_invalid" }));
    expect(() => createAppMcpHostRoutePlatform([
      { appId: "ai.braindrive.resume-builder", routeKey: "resume-builder", host: { ...resume, routeKey: "brief-builder" } as unknown as AppMcpHost },
    ])).toThrowError(expect.objectContaining({ code: "descriptor_invalid" }));

    const platform = createAppMcpHostRoutePlatform([
      { appId: resume.appId, routeKey: resume.routeKey, host: resume },
      { appId: brief.appId, routeKey: brief.routeKey, host: brief },
    ]);
    const resolvedResume = platform.resolve("resume-builder");
    expect(Object.isFrozen(platform.entries)).toBe(true);
    expect(Object.isFrozen(resolvedResume)).toBe(true);
    expect(Reflect.set(resolvedResume, "appId", brief.appId)).toBe(false);
    expect(Reflect.set(resolvedResume, "routeKey", brief.routeKey)).toBe(false);
    expect(Reflect.set(resolvedResume, "host", brief)).toBe(false);
    expect(platform.resolve("resume-builder")).toMatchObject({ appId: resume.appId, routeKey: resume.routeKey, host: resume });
    expect(platform.resolve("brief-builder")).toMatchObject({ appId: brief.appId, routeKey: brief.routeKey, host: brief });

    expect(Reflect.set(resume, "appId", brief.appId)).toBe(true);
    expect(() => platform.resolve("resume-builder")).toThrowError(expect.objectContaining({ code: "descriptor_invalid" }));
    expect(platform.resolve("brief-builder").host).toBe(brief);
  });

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
    expect(host.handleOwnerCapability).toHaveBeenCalledWith("career.facts.confirm", {}, operationId, true, "owner");

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

  it("projects only host-authored confirmation presentation with the resolved capability identity", async () => {
    const host = createHost();
    vi.mocked(host.handleOwnerCapability).mockRejectedValue(new AppPlatformError("denied", "private policy detail", 403, {
      confirmation: { title: "Confirm career facts", actionLabel: "Confirm facts" },
    }));
    const app = Fastify();
    app.addHook("preHandler", async (request) => {
      request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions };
    });
    registerAppMcpHostRoutes(app, host);
    const operationId = crypto.randomUUID();
    const response = await app.inject({
      method: "POST", url: "/apps/resume-builder/data/call",
      payload: { capability: "career.facts.confirm", operation_id: operationId, input: { title: "Forged app title" }, owner_confirmed: false },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "confirmation_required", confirmation: { capability: "career.facts.confirm", title: "Confirm career facts", action_label: "Confirm facts" } },
      owner_state: { state: "unavailable", proposal_preserved: true },
    });
    expect(response.body).not.toContain("Forged app title");
    expect(response.body).not.toContain("private policy detail");
    await app.close();
  });

  it("projects a generic app-safe inference error for the non-Resume Brief capability", async () => {
    const host = {
      ...createHost(),
      appId: "ai.braindrive.brief-builder",
      routeKey: "brief-builder",
    } as unknown as AppMcpHost;
    const operationId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    vi.mocked(host.handleOwnerCapability).mockRejectedValueOnce(new AppPlatformError(
      "validation_failed",
      "PRIVATE_INTERNAL_EXCEPTION_CANARY",
      409,
      {
        safeCode: "candidate_invalid",
        operationId,
        attemptCount: 2,
        completionMode: "none",
        appIssueIds: ["brief.generate/schema-title-invalid"],
        retryable: false,
        recoveryMetadata: { action: "review_source", blocked: true },
        prompt_body: "PRIVATE_PROMPT_CANARY",
      },
    ));
    const app = Fastify();
    app.addHook("preHandler", async (request) => {
      request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions };
    });
    registerAppMcpHostRoutes(app, host);

    const response = await app.inject({
      method: "POST",
      url: "/apps/brief-builder/data/call",
      payload: { capability: "app.inference.request", operation_id: correlationId, input: {}, owner_confirmed: false },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: "candidate_invalid",
        safe_message: "The app action could not be completed safely.",
        retryable: false,
        correlation_id: correlationId,
        operation_id: operationId,
        attempt_count: 2,
        completion_mode: "none",
        app_issue_ids: ["brief.generate/schema-title-invalid"],
        recovery_metadata: { action: "review_source", blocked: true },
      },
      owner_state: { state: "unavailable", proposal_preserved: true },
    });
    expect(response.body).not.toMatch(/PRIVATE_INTERNAL_EXCEPTION_CANARY|PRIVATE_PROMPT_CANARY/);

    const poisonedOperationId = crypto.randomUUID();
    vi.mocked(host.handleOwnerCapability).mockRejectedValueOnce(new AppPlatformError(
      "validation_failed",
      "PRIVATE_INTERNAL_EXCEPTION_CANARY",
      409,
      {
        safeCode: "candidate_invalid",
        operationId: poisonedOperationId,
        attemptCount: 2,
        completionMode: "none",
        appIssueIds: ["brief.generate/schema-title-invalid"],
        recoveryMetadata: { action: "review_source", owner_text: "PRIVATE_OWNER_TEXT_CANARY" },
      },
    ));
    const poisoned = await app.inject({
      method: "POST",
      url: "/apps/brief-builder/data/call",
      payload: { capability: "app.inference.request", operation_id: poisonedOperationId, input: {}, owner_confirmed: false },
    });
    expect(poisoned.json().error).not.toHaveProperty("recovery_metadata");
    expect(poisoned.body).not.toMatch(/PRIVATE_INTERNAL_EXCEPTION_CANARY|PRIVATE_OWNER_TEXT_CANARY/);
    await app.close();
  });

  it("resolves the route before body, bearer, session, or host work and rejects cross-app swaps", async () => {
    const resume = createHost();
    const brief = {
      ...createHost(),
      appId: "ai.braindrive.brief-builder",
      routeKey: "brief-builder",
      launch: vi.fn(async () => ({ launch_version: 1, session_id: crypto.randomUUID() })),
      handleBridge: vi.fn(async () => { throw new AppPlatformError("session_closed", "safe", 410); }),
      handleServerCapability: vi.fn(async () => { throw new AppPlatformError("token_scope_invalid", "safe", 403); }),
      close: vi.fn(() => false),
    } as unknown as AppMcpHost;
    const platform = createAppMcpHostRoutePlatform([
      { appId: resume.appId, routeKey: resume.routeKey, host: resume },
      { appId: brief.appId, routeKey: brief.routeKey, host: brief },
    ]);
    const app = Fastify();
    app.addHook("preHandler", async (request) => {
      request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions };
    });
    registerAppMcpHostRoutes(app, platform);

    expect((await app.inject({ method: "POST", url: "/apps/unknown/launch", payload: { unexpected: true } })).statusCode).toBe(404);
    expect(resume.launch).not.toHaveBeenCalled();
    expect(brief.launch).not.toHaveBeenCalled();
    expect((await app.inject({ method: "POST", url: "/apps/resume-builder/launch" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/apps/brief-builder/launch" })).statusCode).toBe(200);
    expect(resume.launch).toHaveBeenCalledTimes(1);
    expect(brief.launch).toHaveBeenCalledTimes(1);

    const resumeSession = crypto.randomUUID();
    const crossBridge = await app.inject({
      method: "POST", url: "/apps/brief-builder/bridge",
      payload: { session_id: resumeSession, origin: "null", source: "sandbox_iframe", message: {} },
    });
    expect(crossBridge.statusCode).toBe(410);
    expect(brief.handleBridge).toHaveBeenCalledWith(resumeSession, {}, { origin: "null", sourceMatches: true });
    expect(resume.handleBridge).not.toHaveBeenCalled();

    const operationId = crypto.randomUUID();
    const privateSwap = await app.inject({
      method: "POST", url: "/internal/apps/brief-builder/capabilities",
      headers: { authorization: `Bearer ${"z".repeat(43)}` },
      payload: { request_version: 1, capability: "career.context.read", capability_version: 1, operation_id: operationId, idempotency_key: "m4-cross-app-private-0001", input: {} },
    });
    expect(privateSwap.statusCode).toBe(403);
    expect(brief.handleServerCapability).toHaveBeenCalled();
    expect(resume.handleServerCapability).not.toHaveBeenCalled();

    expect((await app.inject({ method: "DELETE", url: `/apps/brief-builder/sessions/${resumeSession}` })).statusCode).toBe(204);
    expect(brief.close).toHaveBeenCalledWith(resumeSession);
    expect(resume.close).not.toHaveBeenCalled();
    await app.close();
  });
});
