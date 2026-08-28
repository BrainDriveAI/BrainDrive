import Fastify from "fastify";
import { createHash } from "node:crypto";
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
  const chatSession = {
    session_id: crypto.randomUUID(),
    view_id: crypto.randomUUID(),
    operation_id: crypto.randomUUID(),
    session_generation: 1,
    owner_id: crypto.randomUUID(),
    account_id: crypto.randomUUID(),
    actor_id: crypto.randomUUID(),
    app_id: "ai.braindrive.resume-builder",
    publisher_id: "ai.braindrive",
    installation_id: crypto.randomUUID(),
    package_digest: `sha256:${"a".repeat(64)}` as const,
    lifecycle_generation: 2,
    grant_id: crypto.randomUUID(),
    grant_revision: 1,
    revocation_generation: 0,
    presentation_id: "chat",
    workspace_id: "resume.chat",
    context_grant_set_digest: `sha256:${"b".repeat(64)}` as const,
    created_at: "2026-08-26T12:00:00.000Z",
    expires_at: "2026-08-26T12:05:00.000Z",
  };
  const storageAuthority = {
    authority_version: 1 as const,
    owner_id: chatSession.owner_id,
    actor_id: chatSession.actor_id,
    app_id: chatSession.app_id,
    publisher_id: chatSession.publisher_id,
    installation_id: chatSession.installation_id,
    package_digest: chatSession.package_digest,
    lifecycle_generation: chatSession.lifecycle_generation,
    grant_id: chatSession.grant_id,
    grant_revision: chatSession.grant_revision,
    revocation_generation: chatSession.revocation_generation,
  };
  const documentRecord = (documentId: string) => ({
    record_version: 1 as const,
    record_kind: "document" as const,
    owner_id: chatSession.owner_id,
    actor_id: chatSession.actor_id,
    app_id: chatSession.app_id,
    publisher_id: chatSession.publisher_id,
    installation_id: chatSession.installation_id,
    package_digest: chatSession.package_digest,
    lifecycle_generation: chatSession.lifecycle_generation,
    grant_id: chatSession.grant_id,
    grant_revision: chatSession.grant_revision,
    revocation_generation: chatSession.revocation_generation,
    document_id: documentId,
    document_binding_id: `${documentId}.current`,
    role: "source_document" as const,
    retention_class: "durable_owner_data" as const,
    media_type: "text/markdown" as const,
    revision: 3,
    revision_id: crypto.randomUUID(),
    prior_revision_id: null,
    operation_id: crypto.randomUUID(),
    idempotency_key: "document-route-fixture-0001",
    content_digest: `sha256:${"c".repeat(64)}` as const,
    content_size_bytes: 9,
    content: "# Profile",
    created_at: "2026-08-26T12:00:00.000Z",
    created_by: storageAuthority,
    updated_at: "2026-08-26T12:01:00.000Z",
    updated_by: storageAuthority,
  });
  return {
    appId: "ai.braindrive.resume-builder",
    routeKey: "resume-builder",
    launch: vi.fn(async () => ({ launch_version: 1, session_id: crypto.randomUUID() })),
    launchChatWorkspace: vi.fn(async () => ({
      launch_version: 1,
      kind: "chat_workspace",
      session: chatSession,
      resumed: false,
      presentation: {
        profile_version: 1,
        presentation_id: "chat",
        type: "chat_workspace",
        label: "Just Chat With It",
        description: "Open the native chat workspace.",
        workspace_id: "resume.chat",
        owner_visibility: "primary",
      },
      workspace: {
        workspace_version: 1,
        workspace_id: "resume.chat",
        title: "Resume Workspace",
        description: "Native app-chat workspace.",
        default_document_id: "conversation",
        documents: [],
        resources: [],
        actions: [],
      },
      context: {
        context_projection_set_version: 1,
        context_grant_set_digest: chatSession.context_grant_set_digest,
        items: [],
      },
    })),
    readChatWorkspaceSession: vi.fn(async () => chatSession),
    listAppDocuments: vi.fn(async () => ({
      result_version: 1,
      owner_id: chatSession.owner_id,
      app_id: chatSession.app_id,
      publisher_id: chatSession.publisher_id,
      installation_id: chatSession.installation_id,
      records: [documentRecord("resume.profile")],
      audits: [],
    })),
    readAppDocument: vi.fn(async (_sessionId: string, documentId: string) => ({
      result_version: 1,
      state: documentId === "missing" ? "missing" : "current",
      document_id: documentId,
      document_binding_id: `${documentId}.current`,
      record: documentId === "missing" ? null : documentRecord(documentId),
    })),
    writeAppDocument: vi.fn(async (_sessionId: string, documentId: string, input: unknown) => ({
      result_version: 1,
      state: "current",
      document_id: documentId,
      document_binding_id: `${documentId}.current`,
      record: {
        revision: 4,
        content: (input as { content?: unknown }).content,
      },
    })),
    deleteAppDocument: vi.fn(async (_sessionId: string, documentId: string, input: Record<string, unknown>) => ({
      result_version: 1,
      state: "deleted",
      delete_mode: input.delete_mode ?? "tombstone",
      tombstone: {
        tombstone_version: 1,
        ...documentRecord(documentId),
        record_version: undefined,
        revision: 4,
        revision_id: crypto.randomUUID(),
        prior_revision_id: crypto.randomUUID(),
        operation_id: input.operation_id,
        idempotency_key: input.idempotency_key,
        delete_mode: input.delete_mode ?? "tombstone",
        prior_content_digest: `sha256:${"c".repeat(64)}`,
        prior_content_size_bytes: 9,
        deleted_at: "2026-08-26T12:02:00.000Z",
        deleted_by: storageAuthority,
        content: undefined,
        content_digest: undefined,
        content_size_bytes: undefined,
        created_at: undefined,
        created_by: undefined,
        updated_at: undefined,
        updated_by: undefined,
      },
      audit: {
        audit_projection_version: 1,
        event: "app.storage.document.delete",
        owner_id: chatSession.owner_id,
        actor_id: chatSession.actor_id,
        app_id: chatSession.app_id,
        publisher_id: chatSession.publisher_id,
        installation_id: chatSession.installation_id,
        package_digest: chatSession.package_digest,
        lifecycle_generation: chatSession.lifecycle_generation,
        grant_id: chatSession.grant_id,
        grant_revision: chatSession.grant_revision,
        revocation_generation: chatSession.revocation_generation,
        document_id: documentId,
        document_binding_id: `${documentId}.current`,
        record_kind: "document",
        role: "source_document",
        retention_class: "durable_owner_data",
        revision: 4,
        revision_id: crypto.randomUUID(),
        prior_revision_id: crypto.randomUUID(),
        operation_id: input.operation_id,
        idempotency_key_digest: `sha256:${"d".repeat(64)}`,
        content_digest: `sha256:${"c".repeat(64)}`,
        content_size_bytes: 9,
        delete_mode: input.delete_mode ?? "tombstone",
        deleted_at: "2026-08-26T12:02:00.000Z",
        updated_at: "2026-08-26T12:02:00.000Z",
      },
    })),
    handleBridge: vi.fn(async () => ({ status: "ready" })),
    handleAppsBridge: vi.fn(async () => ({ jsonrpc: "2.0", id: "request", result: {} })),
    cancelAppsBridgeRequest: vi.fn(() => true),
    handleServerCapability: vi.fn(async () => ({ status: "completed" })),
    handleOwnerCapability: vi.fn(async () => ({ status: "ok" })),
    registerAppArtifact: vi.fn(async (input: Record<string, unknown>) => ({
      result_version: 1,
      artifact: {
        record_version: 1,
        app_id: chatSession.app_id,
        publisher_id: chatSession.publisher_id,
        owner_id: chatSession.owner_id,
        actor_id: chatSession.actor_id,
        installation_id: chatSession.installation_id,
        package_digest: chatSession.package_digest,
        lifecycle_generation: chatSession.lifecycle_generation,
        grant_id: chatSession.grant_id,
        grant_revision: chatSession.grant_revision,
        revocation_generation: chatSession.revocation_generation,
        artifact_id: crypto.randomUUID(),
        artifact_revision_id: crypto.randomUUID(),
        operation_id: input.operation_id,
        idempotency_key: input.idempotency_key,
        source: input.source,
        content_digest: input.content_digest,
        content_size_bytes: input.content_size_bytes,
        retention_class: input.retention_class,
        media_type: input.media_type,
        owner_visible_label: input.owner_visible_label,
        created_at: "2026-08-27T12:00:00.000Z",
        created_by: {},
      },
      replayed: false,
    })),
    requestAppExport: vi.fn(async (input: Record<string, unknown>) => ({
      result_version: 1,
      status: "prepared",
      artifact: {
        artifact_revision_id: crypto.randomUUID(),
        content_digest: input.content_digest,
        media_type: input.media_type,
      },
      filename: input.filename,
      media_type: input.media_type,
      bytes_base64: input.bytes_base64,
      safe_destination_label: input.filename,
      replayed: false,
    })),
    placeCareerReturn: vi.fn(async () => ({ placement: "career_journal", committed: true })),
    finalizeOwnerExport: vi.fn(async (input: Record<string, unknown>) => ({
      projection_version: 1,
      status: "completed",
      receipt_revision_id: crypto.randomUUID(),
      artifact_revision_id: input.artifact_revision_id,
      content_digest: input.content_digest,
      media_type: input.media_type,
      outcome: input.outcome,
      safe_destination_label: input.safe_destination_label,
      replayed: false,
    })),
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

    const chatResume = { session_id: crypto.randomUUID(), view_id: crypto.randomUUID(), operation_id: crypto.randomUUID(), session_generation: 2 };
    const chat = await app.inject({
      method: "POST",
      url: "/apps/resume-builder/chat-workspaces/launch",
      payload: { presentation_id: "chat", workspace_id: "resume.chat", resume: chatResume },
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.json()).toMatchObject({ kind: "chat_workspace", session: { presentation_id: "chat", workspace_id: "resume.chat" } });
    expect(host.launchChatWorkspace).toHaveBeenCalledWith({
      presentationId: "chat",
      workspaceId: "resume.chat",
      resume: {
        sessionId: chatResume.session_id,
        viewId: chatResume.view_id,
        operationId: chatResume.operation_id,
        sessionGeneration: 2,
      },
    });

    const readSession = await app.inject({
      method: "GET",
      url: `/apps/resume-builder/chat-workspaces/sessions/${chat.json().session.session_id}`,
    });
    expect(readSession.statusCode).toBe(200);
    expect(host.readChatWorkspaceSession).toHaveBeenCalledWith(chat.json().session.session_id);

    const documentList = await app.inject({
      method: "GET",
      url: `/apps/resume-builder/chat-workspaces/sessions/${chat.json().session.session_id}/documents`,
    });
    expect(documentList.statusCode).toBe(200);
    expect(documentList.json()).toMatchObject({
      result_version: 1,
      records: [{ document_id: "resume.profile", revision: 3, content: "# Profile" }],
      audits: [],
    });
    expect(documentList.body).not.toContain("/home/");
    expect(documentList.body).not.toContain("authorization");
    expect(host.listAppDocuments).toHaveBeenCalledWith(chat.json().session.session_id);

    const documentRead = await app.inject({
      method: "GET",
      url: `/apps/resume-builder/chat-workspaces/sessions/${chat.json().session.session_id}/documents/resume.profile`,
    });
    expect(documentRead.statusCode).toBe(200);
    expect(documentRead.json()).toMatchObject({
      result_version: 1,
      state: "current",
      document_id: "resume.profile",
      document_binding_id: "resume.profile.current",
      record: { revision: 3, content: "# Profile" },
    });
    expect(documentRead.body).not.toContain("/home/");
    expect(documentRead.body).not.toContain("authorization");
    expect(host.readAppDocument).toHaveBeenCalledWith(chat.json().session.session_id, "resume.profile");

    const writeOperationId = crypto.randomUUID();
    const documentWrite = await app.inject({
      method: "PUT",
      url: `/apps/resume-builder/chat-workspaces/sessions/${chat.json().session.session_id}/documents/resume.profile`,
      payload: {
        operation_id: writeOperationId,
        idempotency_key: "document-route-write-0001",
        expected_revision: 3,
        media_type: "text/markdown",
        content: "# Updated",
      },
    });
    expect(documentWrite.statusCode).toBe(200);
    expect(documentWrite.json()).toMatchObject({
      state: "current",
      document_id: "resume.profile",
      record: { revision: 4, content: "# Updated" },
    });
    expect(host.writeAppDocument).toHaveBeenCalledWith(chat.json().session.session_id, "resume.profile", {
      operation_id: writeOperationId,
      idempotency_key: "document-route-write-0001",
      expected_revision: 3,
      media_type: "text/markdown",
      content: "# Updated",
    });

    const deleteOperationId = crypto.randomUUID();
    const documentDelete = await app.inject({
      method: "DELETE",
      url: `/apps/resume-builder/chat-workspaces/sessions/${chat.json().session.session_id}/documents/resume.profile`,
      payload: {
        operation_id: deleteOperationId,
        idempotency_key: "document-route-delete-0001",
        expected_revision: 4,
      },
    });
    expect(documentDelete.statusCode).toBe(200);
    expect(documentDelete.json()).toMatchObject({
      state: "deleted",
      delete_mode: "tombstone",
      tombstone: {
        document_id: "resume.profile",
        revision: 4,
        prior_content_digest: `sha256:${"c".repeat(64)}`,
      },
      audit: {
        event: "app.storage.document.delete",
        delete_mode: "tombstone",
      },
    });
    expect(documentDelete.body).not.toContain("# Profile");
    expect(host.deleteAppDocument).toHaveBeenCalledWith(chat.json().session.session_id, "resume.profile", {
      operation_id: deleteOperationId,
      idempotency_key: "document-route-delete-0001",
      expected_revision: 4,
      delete_mode: "tombstone",
    });

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

  it("projects stale document writes without leaking private storage details", async () => {
    const host = createHost();
    vi.mocked(host.writeAppDocument).mockRejectedValueOnce(new AppPlatformError("revision_conflict", "private stale record content", 409, { currentRevision: 7 }));
    const app = Fastify();
    app.addHook("preHandler", async (request) => {
      request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions };
    });
    registerAppMcpHostRoutes(app, host);
    const sessionId = crypto.randomUUID();
    const operationId = crypto.randomUUID();

    const response = await app.inject({
      method: "PUT",
      url: `/apps/resume-builder/chat-workspaces/sessions/${sessionId}/documents/resume.profile`,
      payload: {
        operation_id: operationId,
        idempotency_key: "document-stale-route-0001",
        expected_revision: 4,
        media_type: "text/markdown",
        content: "# Draft",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: "conflict",
        current_revision: 7,
        safe_message: "The saved version changed. Refresh and review before saving again.",
      },
      document_state: {
        state: "conflict",
        refresh_required: true,
        current_revision: 7,
      },
    });
    expect(response.body).not.toContain("private stale record content");
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

  it("mediates generic artifact registration, export requests, and safe receipt finalization", async () => {
    const host = createHost();
    const app = Fastify();
    app.addHook("preHandler", async (request) => {
      request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions };
    });
    registerAppMcpHostRoutes(app, host);
    const artifactOperationId = crypto.randomUUID();
    const bytes = Buffer.from("%PDF-1.4\nroute", "utf8");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const source = { kind: "app_document", source_id: "resume.document" };

    const artifact = await app.inject({
      method: "POST",
      url: "/apps/resume-builder/artifacts/register",
      payload: {
        request_version: 1,
        operation_id: artifactOperationId,
        idempotency_key: "route-artifact-register-0001",
        source,
        content_digest: digest,
        content_size_bytes: bytes.length,
        retention_class: "durable_owner_data",
        media_type: "application/pdf",
        owner_visible_label: "resume.pdf",
      },
    });
    expect(artifact.statusCode).toBe(200);
    expect(host.registerAppArtifact).toHaveBeenCalledWith(expect.objectContaining({
      operation_id: artifactOperationId,
      source,
      owner_visible_label: "resume.pdf",
    }));
    expect(artifact.body).not.toMatch(/(?:\/home\/|[A-Za-z]:\\|bytes_base64)/);

    const deniedPath = await app.inject({
      method: "POST",
      url: "/apps/resume-builder/exports/request",
      payload: {
        request_version: 1,
        operation_id: crypto.randomUUID(),
        idempotency_key: "route-export-denied-path",
        source,
        content_digest: digest,
        content_size_bytes: bytes.length,
        media_type: "application/pdf",
        filename: "/home/owner/resume.pdf",
        destination_intent: "new_download",
        overwrite_confirmed: false,
        owner_confirmed: true,
        bytes_base64: bytes.toString("base64"),
      },
    });
    expect(deniedPath.statusCode).toBe(400);
    expect(host.requestAppExport).not.toHaveBeenCalled();

    vi.mocked(host.requestAppExport).mockRejectedValueOnce(new AppPlatformError("denied", "private confirmation detail", 403, {
      confirmation: { title: "Export app artifact?", actionLabel: "Export" },
    }));
    const needsConfirmation = await app.inject({
      method: "POST",
      url: "/apps/resume-builder/exports/request",
      payload: {
        request_version: 1,
        operation_id: crypto.randomUUID(),
        idempotency_key: "route-export-owner-confirm",
        source,
        content_digest: digest,
        content_size_bytes: bytes.length,
        media_type: "application/pdf",
        filename: "resume.pdf",
        destination_intent: "new_download",
        overwrite_confirmed: false,
        owner_confirmed: false,
        bytes_base64: bytes.toString("base64"),
      },
    });
    expect(needsConfirmation.statusCode).toBe(403);
    expect(needsConfirmation.json()).toMatchObject({
      error: {
        code: "confirmation_required",
        confirmation: { capability: "app.export.request", title: "Export app artifact?", action_label: "Export" },
      },
    });
    expect(needsConfirmation.body).not.toContain("private confirmation detail");

    const overwriteDenied = await app.inject({
      method: "POST",
      url: "/apps/resume-builder/exports/request",
      payload: {
        request_version: 1,
        operation_id: crypto.randomUUID(),
        idempotency_key: "route-export-overwrite",
        source,
        content_digest: digest,
        content_size_bytes: bytes.length,
        media_type: "application/pdf",
        filename: "resume.pdf",
        destination_intent: "replace_existing",
        overwrite_confirmed: false,
        owner_confirmed: true,
        bytes_base64: bytes.toString("base64"),
      },
    });
    expect(overwriteDenied.statusCode).toBe(400);

    const prepared = await app.inject({
      method: "POST",
      url: "/apps/resume-builder/exports/request",
      payload: {
        request_version: 1,
        operation_id: crypto.randomUUID(),
        idempotency_key: "route-export-confirmed",
        source,
        content_digest: digest,
        content_size_bytes: bytes.length,
        media_type: "application/pdf",
        filename: "resume.pdf",
        destination_intent: "replace_existing",
        overwrite_confirmed: true,
        owner_confirmed: true,
        bytes_base64: bytes.toString("base64"),
      },
    });
    expect(prepared.statusCode).toBe(200);
    expect(host.requestAppExport).toHaveBeenLastCalledWith(expect.objectContaining({
      filename: "resume.pdf",
      destination_intent: "replace_existing",
      overwrite_confirmed: true,
      owner_confirmed: true,
    }), "owner");

    const finalizeOperationId = crypto.randomUUID();
    const finalized = await app.inject({
      method: "POST",
      url: "/apps/resume-builder/exports/finalize",
      payload: {
        request_version: 1,
        operation_id: finalizeOperationId,
        idempotency_key: "route-export-finalize",
        artifact_revision_id: crypto.randomUUID(),
        content_digest: digest,
        media_type: "application/pdf",
        outcome: "completed",
        safe_destination_label: "chosen-resume.pdf",
      },
    });
    expect(finalized.statusCode).toBe(200);
    expect(finalized.json()).toMatchObject({
      status: "completed",
      content_digest: digest,
      safe_destination_label: "chosen-resume.pdf",
      replayed: false,
    });
    expect(finalized.body).not.toMatch(/(?:bytes_base64|%PDF|\/home\/|[A-Za-z]:\\)/);
    expect(host.finalizeOwnerExport).toHaveBeenCalledWith(expect.objectContaining({
      request_version: 1,
      safe_destination_label: "chosen-resume.pdf",
      outcome: "completed",
    }), finalizeOperationId);
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
