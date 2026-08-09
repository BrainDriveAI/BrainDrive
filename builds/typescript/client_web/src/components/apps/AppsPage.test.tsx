import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import * as appsApi from "@/api/apps-adapter";
import AppsPage from "./AppsPage";

vi.mock("@/api/apps-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/api/apps-adapter")>("@/api/apps-adapter");
  return { ...actual, getResumeBuilderApp: vi.fn(), mutateResumeBuilderApp: vi.fn(), launchResumeBuilderApp: vi.fn(), closeResumeBuilderSession: vi.fn(), sendResumeBuilderBridgeMessage: vi.fn(), callResumeBuilderCapability: vi.fn() };
});

const base: appsApi.ResumeBuilderAppStatus = {
  contract_version: 1,
  identity: { app_id: "ai.braindrive.resume-builder", display_name: "Resume Builder", publisher_id: "ai.braindrive", publisher_name: "BrainDrive", installation_id: null, package_digest: null },
  state: "not_installed", generation: 0,
  version: { installed: null, available: "3.0.0" },
  trust: { status: "not_verified", policy_version: 1, signing_key_id: null, checked_at: null, revocation_status: "not_checked" },
  source: { kind: "repository_fixture", label: "Bundled BrainDrive app source" },
  compatibility: { host: null, app_contract: 1, mcp_protocol: "2026-07-28", data_schema: { read_min: 1, read_max: 1, write_version: 1 } },
  capabilities: { requested: ["career.context.read", "app.inference.request"], granted: [] },
  retention: { owner_data_preserved: true, retained_data_present: false, compatibility: "missing", safe_message: "No retained Resume Builder data is present.", uninstall_removes: ["app code", "disposable cache", "runtime authority", "capability grants"], uninstall_retains: ["career data", "resume and job history", "artifact metadata", "owner exports", "lifecycle evidence"] },
  progress: null, recovery: { available: false, action: "none" }, updated_at: "2026-08-07T00:00:00.000Z",
};

function installed(overrides: Partial<appsApi.ResumeBuilderAppStatus> = {}): appsApi.ResumeBuilderAppStatus {
  return { ...base, state: "active", generation: 2, identity: { ...base.identity, installation_id: crypto.randomUUID(), package_digest: `sha256:${"a".repeat(64)}` }, version: { installed: "3.0.0", available: "3.0.0" }, trust: { ...base.trust, status: "verified", signing_key_id: "braindrive-app-release-fixture-2026", checked_at: "2026-08-07T00:00:00.000Z", revocation_status: "not_revoked_fresh" }, compatibility: { ...base.compatibility, host: true }, capabilities: { ...base.capabilities, granted: [...base.capabilities.requested] }, retention: { ...base.retention, compatibility: "ready" }, ...overrides };
}

const launch = {
  launch_version: 1 as const, session_id: crypto.randomUUID(), installation_id: crypto.randomUUID(), view_id: crypto.randomUUID(), operation_id: crypto.randomUUID(),
  bridge_token_id: crypto.randomUUID(), server_id: crypto.randomUUID(), expires_at: "2030-01-01T00:00:00.000Z",
  protocol: { core: "2026-07-28", apps_extension: "2026-01-26", server_name: "fixture", server_version: "3.0.0" },
  resource: { uri: "ui://resume-builder/main", mime_type: "text/html;profile=mcp-app" as const, content_digest: `sha256:${"a".repeat(64)}`, size_bytes: 32, html: "<!doctype html><main>Fixture</main>" },
  allowed_tools: ["fixture.status"], allowed_capabilities: ["career.context.read"], entry_point: "direct" as const,
};

describe("owner lifecycle Apps surface", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows identity, trust, source, compatibility, capabilities, retention, and installs from one control", async () => {
    vi.mocked(appsApi.getResumeBuilderApp).mockResolvedValue(base);
    vi.mocked(appsApi.mutateResumeBuilderApp).mockResolvedValue(installed());
    const user = userEvent.setup(); render(<AppsPage />);
    expect(await screen.findByRole("heading", { name: "Resume Builder" })).toBeInTheDocument();
    expect(screen.getByText("not verified")).toBeInTheDocument();
    expect(screen.getByText("Bundled BrainDrive app source")).toBeInTheDocument();
    expect(screen.getByText("2026-07-28")).toBeInTheDocument();
    expect(screen.getByText(/retains career data, resume and job history/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Install Resume Builder" }));
    expect(appsApi.mutateResumeBuilderApp).toHaveBeenCalledWith("install", base);
    expect(await screen.findByText("Active and ready")).toBeInTheDocument();
  });

  it("uses a focused confirmation that states exact removal and retention, supports Escape, and restores focus", async () => {
    vi.mocked(appsApi.getResumeBuilderApp).mockResolvedValue(installed());
    const user = userEvent.setup(); render(<AppsPage />);
    const uninstallButton = await screen.findByRole("button", { name: "Uninstall" });
    await user.click(uninstallButton);
    expect(screen.getByRole("dialog", { name: "Uninstall Resume Builder?" })).toBeInTheDocument();
    expect(screen.getByText(/revoke its capability authority/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(/career data, resume and job history/i);
    expect(screen.getByRole("button", { name: "Uninstall app code" })).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: "Uninstall app code" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(uninstallButton).toHaveFocus());
  });

  it("submits uninstall once after confirmation and disables duplicate lifecycle controls", async () => {
    const current = installed();
    vi.mocked(appsApi.getResumeBuilderApp).mockResolvedValue(current);
    let release!: (value: appsApi.ResumeBuilderAppStatus) => void;
    vi.mocked(appsApi.mutateResumeBuilderApp).mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const user = userEvent.setup(); render(<AppsPage />);
    await user.click(await screen.findByRole("button", { name: "Uninstall" }));
    const confirm = screen.getByRole("button", { name: "Uninstall app code" });
    await user.click(confirm);
    expect(appsApi.mutateResumeBuilderApp).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Uninstall" })).toBeDisabled();
    release({ ...base, generation: 4, retention: { ...base.retention, retained_data_present: true, compatibility: "ready" } });
    expect(await screen.findByRole("button", { name: "Reinstall Resume Builder" })).toBeInTheDocument();
  });

  it("represents progress, quarantined, and recoverable states with readable text and actions", async () => {
    const operationId = crypto.randomUUID();
    vi.mocked(appsApi.getResumeBuilderApp).mockResolvedValue(installed({ state: "updating", progress: { operation_version: 1, operation_id: operationId, installation_id: crypto.randomUUID(), kind: "update", status: "running", stage: "verifying_package", completed_stages: [], commit_outcome: "not_committed", prior_state: "active", target_state: "active", result_state: null, error_code: null, recovery_action: "none", started_at: "2026-08-07T00:00:00.000Z", updated_at: "2026-08-07T00:00:01.000Z", completed_at: null } }));
    const { rerender } = render(<AppsPage />);
    expect(await screen.findByText("Verifying signed package")).toBeInTheDocument();
    vi.mocked(appsApi.getResumeBuilderApp).mockResolvedValue(installed({ state: "quarantined", trust: { ...base.trust, status: "quarantined", revocation_status: "revoked" } }));
    rerender(<AppsPage />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh app status" }));
    expect(await screen.findByText(/Quarantined because package trust changed/)).toBeInTheDocument();
    vi.mocked(appsApi.getResumeBuilderApp).mockResolvedValue(installed({ state: "failed_recoverable", recovery: { available: true, action: "retry_recovery_or_reinstall" } }));
    await userEvent.click(screen.getByRole("button", { name: "Refresh app status" }));
    expect(await screen.findByRole("button", { name: "Retry recovery" })).toBeInTheDocument();
  });

  it("reports transport ambiguity only after authoritative refresh evidence", async () => {
    const current = installed();
    vi.mocked(appsApi.getResumeBuilderApp).mockResolvedValue(current);
    vi.mocked(appsApi.mutateResumeBuilderApp).mockResolvedValue({ ...current, state: "disabled", generation: 3, request_resolution: "refreshed_after_ambiguous_response" });
    const user = userEvent.setup(); render(<AppsPage />);
    await user.click(await screen.findByRole("button", { name: "Disable" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/response was interrupted/i);
    expect(screen.getByText("Disabled — your saved data is retained")).toBeInTheDocument();
  });

  it("returns keyboard focus to Launch after the sandbox session closes and preserves Career entry", async () => {
    vi.mocked(appsApi.getResumeBuilderApp).mockResolvedValue(installed());
    vi.mocked(appsApi.launchResumeBuilderApp).mockResolvedValue({ ...launch, entry_point: "career" });
    const user = userEvent.setup(); render(<AppsPage entryPoint="career" />);
    const launchButton = await screen.findByRole("button", { name: "Continue from Career" });
    await user.click(launchButton);
    expect(appsApi.launchResumeBuilderApp).toHaveBeenCalledWith("career");
    await user.click(await screen.findByRole("button", { name: "Close app" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue from Career" })).toHaveFocus());
  });

  it("keeps a single-column base layout with responsive enhancement classes", async () => {
    vi.mocked(appsApi.getResumeBuilderApp).mockResolvedValue(base);
    render(<AppsPage />);
    const page = await screen.findByTestId("apps-page");
    expect(page).toHaveClass("px-4");
    expect(page.querySelector(".sm\\:grid-cols-2")).toBeInTheDocument();
  });
});
