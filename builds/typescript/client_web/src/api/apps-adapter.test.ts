import { authenticatedFetch } from "./auth-adapter";
import { AppCapabilityError, callAppCapability, closeAppSession, finalizeResumeBuilderExport, getApp, getAppCatalog, launchApp, mutateApp, sendAppAppsBridgeMessage, sendAppBridgeMessage, type AppLaunch, type AppStatus } from "./apps-adapter";

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
