import { authenticatedFetch } from "./auth-adapter";
import { AppCapabilityError, AppDocumentError, callAppCapability, closeAppSession, finalizeResumeBuilderExport, getApp, getAppCatalog, launchApp, launchAppChatWorkspace, mutateApp, readAppChatWorkspaceDocument, readAppChatWorkspaceSession, runRetainedAppDataAction, sendAppAppsBridgeMessage, sendAppBridgeMessage, writeAppChatWorkspaceDocument, type AppChatWorkspaceLaunch, type AppLaunch, type AppStatus } from "./apps-adapter";

vi.mock("./auth-adapter", () => ({ authenticatedFetch: vi.fn() }));
const fetchMock = vi.mocked(authenticatedFetch);

const status: AppStatus = {
  contract_version: 1,
  identity: { app_id: "ai.braindrive.resume-builder", display_name: "Resume Builder", publisher_id: "ai.braindrive", publisher_name: "BrainDrive", installation_id: null, package_digest: null },
  route_key: "resume-builder",
  state: "not_installed", generation: 0, version: { installed: null, available: "3.0.0" },
  trust: { status: "not_verified", policy_version: 1, signing_key_id: null, checked_at: null, revocation_status: "not_checked" },
  source: { kind: "repository_fixture", label: "Bundled BrainDrive app source" }, compatibility: { host: null, app_contract: 1, mcp_protocol: "2026-07-28", data_schema: { read_min: 1, read_max: 1, write_version: 1 } },
  capabilities: { requested: [], granted: [] }, retention: { owner_data_preserved: true, retained_data_present: false, compatibility: "missing", safe_message: "No retained data.", uninstall_removes: [], uninstall_retains: [] },
  progress: null, recovery: { available: false, action: "none" }, updated_at: "2026-08-07T00:00:00.000Z",
  catalog: { summary: "Build an evidence-grounded resume.", icon: null, retention_summary: "Owner data is retained.", primary_resource_uri: "ui://resume-builder/main", provenance: "verified_first_party_package" },
  availability: { status: "available", package_digest: `sha256:${"b".repeat(64)}`, error_code: null, safe_message: null },
  available_actions: ["install"],
};

describe("Apps gateway adapter", () => {
  beforeEach(() => fetchMock.mockReset());

  it("uses the owner lifecycle API and explicit v3 capability approval", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...status, state: "active", version: { installed: "3.0.0", available: "3.0.0" } }), { status: 200, headers: { "content-type": "application/json" } }));
    const operationId = crypto.randomUUID();
    const result = await mutateApp("resume-builder", "install", status, operationId);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/apps/resume-builder/install");
    expect(JSON.parse(String(init?.body))).toMatchObject({ operation_id: operationId, idempotency_key: operationId, expected_generation: 0, installation_id: null, version: "3.0.0", approve_capabilities: true });
    expect(result.state).toBe("active");
    expect(result.request_resolution).toBe("confirmed_response");
  });

  it("uses trusted owner confirmation for post-uninstall retained-data actions", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      operation_id: "10000000-0000-4000-8000-000000000001",
      app_id: status.identity.app_id,
      action: "archive",
      retained: true,
      result_digest: `sha256:${"a".repeat(64)}`,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const operationId = crypto.randomUUID();

    await expect(runRetainedAppDataAction("resume-builder", "archive", status, operationId)).resolves.toMatchObject({ action: "archive", retained: true });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/apps/resume-builder/data/archive");
    expect(JSON.parse(String(init?.body))).toEqual({
      operation_id: operationId,
      idempotency_key: operationId,
      confirm_app_id: status.identity.app_id,
      trusted_owner_confirmation: true,
    });
  });

  it("launches, bridges, closes, and reads status only through authenticated gateway routes", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(status), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ session_id: "session" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ready" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await getApp("resume-builder"); await launchApp("resume-builder", "career"); await sendAppBridgeMessage("resume-builder", "00000000-0000-4000-8000-000000000001", { type: "bridge.ready" }); await closeAppSession("resume-builder", "00000000-0000-4000-8000-000000000001");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/apps/resume-builder/status", "/api/apps/resume-builder/launch", "/api/apps/resume-builder/bridge",
      "/api/apps/resume-builder/sessions/00000000-0000-4000-8000-000000000001",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ entry_point: "career" });
  });

  it("sends an official session-bound Apps envelope without serializing the bridge credential", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: "2.0", id: "host", result: {} }), { status: 200 }));
    const launch = {
      launch_version: 1, session_id: crypto.randomUUID(), installation_id: crypto.randomUUID(), view_id: crypto.randomUUID(), operation_id: crypto.randomUUID(),
      bridge_generation: 3, resumed: true,
      bridge_token_id: crypto.randomUUID(), server_id: crypto.randomUUID(), expires_at: "2030-01-01T00:00:00.000Z",
      protocol: { core: "2026-07-28", apps_extension: "2026-01-26", server_name: "fixture", server_version: "3.0.0" },
      resource: { uri: "ui://resume-builder/main", mime_type: "text/html;profile=mcp-app", content_digest: `sha256:${"a".repeat(64)}`, size_bytes: 1, html: "x" },
      allowed_tools: ["fixture.status"], allowed_capabilities: [], entry_point: "direct",
    } satisfies AppLaunch;
    await sendAppAppsBridgeMessage("resume-builder", launch, { jsonrpc: "2.0", id: "view-request", method: "tools/call", params: { name: "fixture.status", arguments: {} } });
    const [url, init] = fetchMock.mock.calls[0]!;
    const serialized = String(init?.body);
    expect(url).toBe("/api/apps/resume-builder/apps-bridge");
    expect(JSON.parse(serialized)).toMatchObject({
      session_id: launch.session_id,
      envelope: { installation_id: launch.installation_id, view_id: launch.view_id, operation_id: launch.operation_id, bridge_generation: 3, provenance: { source_window_match: true, opaque_origin: "null", same_server_id: launch.server_id } },
    });
    expect(serialized).not.toContain(launch.bridge_token_id);
  });

  it("requests bounded reconnect with stable identities and no resource or bridge credential", async () => {
    const prior = {
      launch_version: 1, session_id: crypto.randomUUID(), installation_id: crypto.randomUUID(), view_id: crypto.randomUUID(), operation_id: crypto.randomUUID(),
      bridge_generation: 2, resumed: false, bridge_token_id: crypto.randomUUID(), server_id: crypto.randomUUID(), expires_at: "2030-01-01T00:00:00.000Z",
      protocol: { core: "2026-07-28", apps_extension: "2026-01-26", server_name: "fixture", server_version: "3.0.0" },
      resource: { uri: "ui://resume-builder/main", mime_type: "text/html;profile=mcp-app", content_digest: `sha256:${"a".repeat(64)}`, size_bytes: 14, html: "private-html" },
      allowed_tools: ["fixture.status"], allowed_capabilities: [], entry_point: "career",
    } satisfies AppLaunch;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...prior, session_id: crypto.randomUUID(), bridge_generation: 3, resumed: true }), { status: 200 }));
    await launchApp("resume-builder", "career", prior);
    const body = String(fetchMock.mock.calls[0]![1]?.body);
    expect(JSON.parse(body)).toEqual({
      entry_point: "career",
      resume: { session_id: prior.session_id, view_id: prior.view_id, operation_id: prior.operation_id, bridge_generation: 2 },
    });
    expect(body).not.toContain(prior.bridge_token_id);
    expect(body).not.toContain(prior.resource.html);
    expect(body).not.toContain(prior.server_id);
  });

  it("launches and reads app-chat workspace sessions through the additive generic routes", async () => {
    const chat = {
      launch_version: 1,
      kind: "chat_workspace",
      session: {
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
        package_digest: `sha256:${"c".repeat(64)}` as const,
        lifecycle_generation: 2,
        grant_id: crypto.randomUUID(),
        grant_revision: 1,
        revocation_generation: 0,
        presentation_id: "chat",
        workspace_id: "resume.chat",
        context_grant_set_digest: `sha256:${"d".repeat(64)}` as const,
        created_at: "2026-08-26T12:00:00.000Z",
        expires_at: "2026-08-26T12:05:00.000Z",
      },
      resumed: false,
      presentation: { profile_version: 1, presentation_id: "chat", type: "chat_workspace", label: "Just Chat With It", description: "Open chat.", workspace_id: "resume.chat", owner_visibility: "primary" },
      workspace: { workspace_version: 1, workspace_id: "resume.chat", title: "Workspace", description: "Shell.", default_document_id: "conversation", documents: [], resources: [], actions: [] },
      context: { context_projection_set_version: 1, context_grant_set_digest: `sha256:${"d".repeat(64)}` as const, items: [] },
    } satisfies AppChatWorkspaceLaunch;
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(chat), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(chat.session), { status: 200 }));

    await expect(launchAppChatWorkspace("resume-builder", { presentationId: "chat", workspaceId: "resume.chat" })).resolves.toMatchObject({ kind: "chat_workspace" });
    await expect(readAppChatWorkspaceSession("resume-builder", chat.session.session_id)).resolves.toMatchObject({ session_id: chat.session.session_id });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/apps/resume-builder/chat-workspaces/launch",
      `/api/apps/resume-builder/chat-workspaces/sessions/${chat.session.session_id}`,
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ presentation_id: "chat", workspace_id: "resume.chat" });
  });

  it("reads and writes generic app-chat workspace documents without caller-supplied authority", async () => {
    const sessionId = crypto.randomUUID();
    const readResult = {
      result_version: 1,
      state: "current",
      document_id: "resume.profile",
      document_binding_id: "resume.profile.current",
      record: { revision: 2, media_type: "text/markdown", content: "# Profile" },
    };
    const writeResult = {
      ...readResult,
      record: { revision: 3, media_type: "text/markdown", content: "# Updated" },
    };
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(readResult), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(writeResult), { status: 200 }));

    await expect(readAppChatWorkspaceDocument("resume-builder", sessionId, "resume.profile")).resolves.toMatchObject({ state: "current", record: { revision: 2 } });
    await expect(writeAppChatWorkspaceDocument("resume-builder", sessionId, "resume.profile", {
      expectedRevision: 2,
      content: "# Updated",
      mediaType: "text/markdown",
    })).resolves.toMatchObject({ record: { revision: 3, content: "# Updated" } });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/apps/resume-builder/chat-workspaces/sessions/${sessionId}/documents/resume.profile`,
      `/api/apps/resume-builder/chat-workspaces/sessions/${sessionId}/documents/resume.profile`,
    ]);
    const writeBody = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body));
    expect(writeBody).toMatchObject({
      expected_revision: 2,
      media_type: "text/markdown",
      content: "# Updated",
    });
    expect(writeBody.operation_id).toMatch(/[0-9a-f-]{36}/);
    expect(writeBody.idempotency_key).toBe(writeBody.operation_id);
    expect(JSON.stringify(writeBody)).not.toContain("grant");
    expect(JSON.stringify(writeBody)).not.toContain("package_digest");
  });

  it("projects stale app document writes as typed safe errors", async () => {
    const sessionId = crypto.randomUUID();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        code: "conflict",
        safe_message: "The saved version changed. Refresh and review before saving again.",
        retryable: false,
        current_revision: 4,
      },
      document_state: {
        state_version: 1,
        state: "conflict",
        safe_message: "The saved version changed. Refresh and review before saving again.",
        retryable: false,
        refresh_required: true,
        current_revision: 4,
      },
    }), { status: 409, headers: { "content-type": "application/json" } }));

    const error = await writeAppChatWorkspaceDocument("resume-builder", sessionId, "resume.profile", {
      expectedRevision: 2,
      content: "# Updated",
      mediaType: "text/markdown",
    }).catch((failure) => failure);

    expect(error).toBeInstanceOf(AppDocumentError);
    expect(error).toMatchObject({
      code: "conflict",
      safeMessage: "The saved version changed. Refresh and review before saving again.",
      currentRevision: 4,
      refreshRequired: true,
    });
  });

  it("reconnects an app-chat workspace without serializing sandbox bridge credentials or app resources", async () => {
    const chat = {
      launch_version: 1,
      kind: "chat_workspace",
      session: {
        session_id: crypto.randomUUID(),
        view_id: crypto.randomUUID(),
        operation_id: crypto.randomUUID(),
        session_generation: 4,
        owner_id: crypto.randomUUID(),
        account_id: crypto.randomUUID(),
        actor_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        publisher_id: "ai.braindrive",
        installation_id: crypto.randomUUID(),
        package_digest: `sha256:${"c".repeat(64)}` as const,
        lifecycle_generation: 2,
        grant_id: crypto.randomUUID(),
        grant_revision: 1,
        revocation_generation: 0,
        presentation_id: "chat",
        workspace_id: "resume.chat",
        context_grant_set_digest: `sha256:${"d".repeat(64)}` as const,
        created_at: "2026-08-26T12:00:00.000Z",
        expires_at: "2026-08-26T12:05:00.000Z",
      },
      resumed: true,
      presentation: { profile_version: 1, presentation_id: "chat", type: "chat_workspace", label: "Just Chat With It", description: "Open chat.", workspace_id: "resume.chat", owner_visibility: "primary" },
      workspace: {
        workspace_version: 1,
        workspace_id: "resume.chat",
        title: "Workspace",
        description: "Shell.",
        default_document_id: "conversation",
        documents: [],
        resources: [{ resource_version: 1, resource_id: "instructions", role: "agent_instructions", title: "Instructions", description: "Resource.", package_path: "payload/resources/instructions.md", media_type: "text/markdown", content_digest: `sha256:${"e".repeat(64)}`, owner_editable: false, prompt_inclusion: "workspace_start" }],
        actions: [],
      },
      context: { context_projection_set_version: 1, context_grant_set_digest: `sha256:${"d".repeat(64)}` as const, items: [] },
    } satisfies AppChatWorkspaceLaunch;
    const next = { ...chat, session: { ...chat.session, session_id: crypto.randomUUID(), session_generation: 5 } };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(next), { status: 200 }));

    await launchAppChatWorkspace("resume-builder", { presentationId: "chat", workspaceId: "resume.chat", resume: chat });

    const body = String(fetchMock.mock.calls[0]![1]?.body);
    expect(JSON.parse(body)).toEqual({
      presentation_id: "chat",
      workspace_id: "resume.chat",
      resume: {
        session_id: chat.session.session_id,
        view_id: chat.session.view_id,
        operation_id: chat.session.operation_id,
        session_generation: 4,
      },
    });
    expect(body).not.toContain("payload/resources/instructions.md");
    expect(body).not.toContain("bridge_token_id");
    expect(body).not.toContain("server_id");
  });

  it("refreshes authoritative status after a lost committed response without declaring request failure", async () => {
    const operationId = crypto.randomUUID();
    fetchMock
      .mockRejectedValueOnce(new TypeError("network interrupted"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...status, state: "active", generation: 2, identity: { ...status.identity, installation_id: crypto.randomUUID() } }), { status: 200 }));
    const result = await mutateApp("resume-builder", "install", status, operationId);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/apps/resume-builder/install", "/api/apps/resume-builder/status"]);
    expect(result).toMatchObject({ state: "active", request_resolution: "refreshed_after_ambiguous_response" });
  });

  it("encodes a validated app key for every generic maintained API route", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(status), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(status), { status: 200 }));
    await getApp("brief-builder");
    await mutateApp("brief-builder", "install", status, crypto.randomUUID());
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/apps/brief-builder/status", "/api/apps/brief-builder/install",
    ]);
    expect(() => getApp("../resume-builder")).toThrow("Invalid app key");
    expect(() => getApp("Brief Builder")).toThrow("Invalid app key");
  });

  it("loads the deterministic host catalog rather than an app-specific status", async () => {
    const brief = { ...status, route_key: "brief-builder", identity: { ...status.identity, app_id: "ai.braindrive.brief-builder", display_name: "Brief Builder" } };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ catalog_version: 1, apps: [brief, status] }), { status: 200 }));
    await expect(getAppCatalog()).resolves.toMatchObject({ apps: [{ route_key: "brief-builder" }, { route_key: "resume-builder" }] });
    expect(fetchMock).toHaveBeenCalledWith("/api/apps", undefined);
  });

  it("finalizes a host export with opaque artifact identity and no path", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ receipt_revision_id: crypto.randomUUID(), safe_destination_label: "resume.pdf", outcome: "cancelled" }), { status: 200 }));
    await finalizeResumeBuilderExport({ artifact_revision_id: crypto.randomUUID(), artifact_digest: `sha256:${"a".repeat(64)}`, safe_destination_label: "resume.pdf", outcome: "cancelled" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/apps/resume-builder/exports/finalize");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ safe_destination_label: "resume.pdf", outcome: "cancelled" });
    expect(JSON.stringify(body)).not.toContain("/");
  });

  it("preserves host-authored confirmation presentation and capability identity without trusting app wording", async () => {
    const operationId = crypto.randomUUID();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        code: "confirmation_required",
        safe_message: "Review this action in BrainDrive before continuing.",
        retryable: false,
        correlation_id: operationId,
        confirmation: { capability: "career.facts.confirm", title: "Confirm career facts", action_label: "Confirm facts" },
      },
      owner_state: {
        state_version: 1,
        state: "unavailable",
        safe_message: "Review this action in BrainDrive before continuing.",
        retryable: false,
        refresh_required: false,
        current_revision: null,
        proposal_preserved: true,
      },
    }), { status: 403, headers: { "content-type": "application/json" } }));
    const error = await callAppCapability("resume-builder", "career.facts.confirm", { confirmation_title: "Forged app title" }, operationId).catch((failure) => failure);
    expect(error).toBeInstanceOf(AppCapabilityError);
    expect(error).toMatchObject({ code: "confirmation_required", capability: "career.facts.confirm", confirmation: { title: "Confirm career facts", actionLabel: "Confirm facts" } });
    expect(JSON.stringify(error)).not.toContain("Forged app title");
  });

  it("parses the generic safe inference envelope without replacing its app code", async () => {
    const operationId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
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
      owner_state: {
        state_version: 1,
        state: "unavailable",
        safe_message: "The app action could not be completed safely.",
        retryable: false,
        refresh_required: false,
        current_revision: null,
        proposal_preserved: true,
      },
    }), { status: 409, headers: { "content-type": "application/json" } }));

    const error = await callAppCapability("brief-builder", "app.inference.request", {}, operationId).catch((failure) => failure);

    expect(error).toBeInstanceOf(AppCapabilityError);
    expect(error).toMatchObject({
      code: "candidate_invalid",
      retryable: false,
      correlationId,
      operationId,
      attemptCount: 2,
      completionMode: "none",
      appIssueIds: ["brief.generate/schema-title-invalid"],
      recoveryMetadata: { action: "review_source", blocked: true },
    });
    expect(error.safeEnvelope).toMatchObject({
      code: "candidate_invalid",
      safe_message: "The app action could not be completed safely.",
      correlation_id: correlationId,
      operation_id: operationId,
      app_issue_ids: ["brief.generate/schema-title-invalid"],
      owner_state: { state: "unavailable" },
    });
  });
});
