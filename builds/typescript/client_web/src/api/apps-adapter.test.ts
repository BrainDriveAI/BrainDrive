import { authenticatedFetch } from "./auth-adapter";
import { callResumeBuilderCapability, closeResumeBuilderSession, finalizeResumeBuilderExport, getResumeBuilderApp, launchResumeBuilderApp, mutateResumeBuilderApp, ResumeCapabilityError, sendResumeBuilderBridgeMessage, type ResumeBuilderAppStatus } from "./apps-adapter";

vi.mock("./auth-adapter", () => ({ authenticatedFetch: vi.fn() }));
const fetchMock = vi.mocked(authenticatedFetch);

const status: ResumeBuilderAppStatus = {
  contract_version: 1,
  identity: { app_id: "ai.braindrive.resume-builder", display_name: "Resume Builder", publisher_id: "ai.braindrive", publisher_name: "BrainDrive", installation_id: null, package_digest: null },
  state: "not_installed", generation: 0, version: { installed: null, available: "3.0.0" },
  trust: { status: "not_verified", policy_version: 1, signing_key_id: null, checked_at: null, revocation_status: "not_checked" },
  source: { kind: "repository_fixture", label: "Bundled BrainDrive app source" }, compatibility: { host: null, app_contract: 1, mcp_protocol: "2026-07-28", data_schema: { read_min: 1, read_max: 1, write_version: 1 } },
  capabilities: { requested: [], granted: [] }, retention: { owner_data_preserved: true, retained_data_present: false, compatibility: "missing", safe_message: "No retained data.", uninstall_removes: [], uninstall_retains: [] },
  progress: null, recovery: { available: false, action: "none" }, updated_at: "2026-08-07T00:00:00.000Z",
};

describe("Apps gateway adapter", () => {
  beforeEach(() => fetchMock.mockReset());

  it("uses the owner lifecycle API and explicit v3 capability approval", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...status, state: "active", version: { installed: "3.0.0", available: "3.0.0" } }), { status: 200, headers: { "content-type": "application/json" } }));
    const operationId = crypto.randomUUID();
    const result = await mutateResumeBuilderApp("install", status, operationId);
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
    await getResumeBuilderApp(); await launchResumeBuilderApp("career"); await sendResumeBuilderBridgeMessage("00000000-0000-4000-8000-000000000001", { type: "bridge.ready" }); await closeResumeBuilderSession("00000000-0000-4000-8000-000000000001");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/apps/resume-builder/status", "/api/apps/resume-builder/launch", "/api/apps/resume-builder/bridge",
      "/api/apps/resume-builder/sessions/00000000-0000-4000-8000-000000000001",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ entry_point: "career" });
  });

  it("refreshes authoritative status after a lost committed response without declaring request failure", async () => {
    const operationId = crypto.randomUUID();
    fetchMock
      .mockRejectedValueOnce(new TypeError("network interrupted"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...status, state: "active", generation: 2, identity: { ...status.identity, installation_id: crypto.randomUUID() } }), { status: 200 }));
    const result = await mutateResumeBuilderApp("install", status, operationId);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/apps/resume-builder/install", "/api/apps/resume-builder/status"]);
    expect(result).toMatchObject({ state: "active", request_resolution: "refreshed_after_ambiguous_response" });
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

  it("preserves the owner-safe conflict state without exposing internal error details", async () => {
    const operationId = crypto.randomUUID();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        error_version: 1,
        code: "conflict",
        safe_message: "The saved version changed. Refresh and review the preserved proposal.",
        retryable: false,
        correlation_id: operationId,
        occurred_at: "2026-08-08T12:00:00.000Z",
        details: { category: "stale_revision", current_revision: 3 },
      },
      owner_state: {
        state_version: 1,
        state: "conflict",
        safe_message: "The saved version changed. Refresh and review the preserved proposal.",
        retryable: false,
        refresh_required: true,
        current_revision: 3,
        proposal_preserved: true,
      },
    }), { status: 409, headers: { "content-type": "application/json" } }));
    const error = await callResumeBuilderCapability("career.facts.confirm", {}, operationId, true).catch((failure) => failure);
    expect(error).toBeInstanceOf(ResumeCapabilityError);
    expect(error).toMatchObject({ code: "conflict", ownerState: { state: "conflict", current_revision: 3, proposal_preserved: true } });
    expect(JSON.stringify(error)).not.toContain("private");
  });
});
