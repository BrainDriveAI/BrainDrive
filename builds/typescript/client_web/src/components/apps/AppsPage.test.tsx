import type { ReactElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import * as appsApi from "@/api/apps-adapter";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppsPage from "./AppsPage";

vi.mock("@/api/apps-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/api/apps-adapter")>("@/api/apps-adapter");
  return { ...actual, getAppCatalog: vi.fn(), getApp: vi.fn(), mutateApp: vi.fn(), launchApp: vi.fn(), launchAppChatWorkspace: vi.fn(), readAppChatWorkspaceSession: vi.fn(), closeAppSession: vi.fn(), sendAppBridgeMessage: vi.fn(), callAppCapability: vi.fn() };
});

function renderApps(ui: ReactElement) {
  return render(ui, { wrapper: TooltipProvider });
}

const base: appsApi.AppStatus = {
  contract_version: 1,
  identity: { app_id: "ai.braindrive.resume-builder", display_name: "Resume Builder", publisher_id: "ai.braindrive", publisher_name: "BrainDrive", installation_id: null, package_digest: null },
  route_key: "resume-builder",
  state: "not_installed", generation: 0,
  version: { installed: null, available: "3.1.0" },
  trust: { status: "not_verified", policy_version: 1, signing_key_id: null, checked_at: null, revocation_status: "not_checked" },
  source: { kind: "repository_fixture", label: "Bundled BrainDrive app source" },
  compatibility: { host: null, app_contract: 1, mcp_protocol: "2026-07-28", data_schema: { read_min: 1, read_max: 1, write_version: 1 } },
  capabilities: { requested: ["career.context.read", "app.inference.request"], granted: [] },
  retention: { owner_data_preserved: true, retained_data_present: false, compatibility: "missing", safe_message: "No retained Resume Builder data is present.", uninstall_removes: ["app code", "disposable cache", "runtime authority", "capability grants"], uninstall_retains: ["career data", "resume and job history", "artifact metadata", "owner exports", "lifecycle evidence"] },
  progress: null, recovery: { available: false, action: "none" }, updated_at: "2026-08-07T00:00:00.000Z",
  catalog: { summary: "Create, tailor, review, and export resumes using your confirmed career information.", icon: null, retention_summary: "Resume records remain owner-controlled.", primary_resource_uri: "ui://resume-builder/main", provenance: "verified_first_party_package" },
  availability: { status: "available", package_digest: `sha256:${"b".repeat(64)}`, error_code: null, safe_message: null },
  available_actions: ["install"],
};

function installed(overrides: Partial<appsApi.AppStatus> = {}): appsApi.AppStatus {
  return { ...base, state: "active", generation: 2, identity: { ...base.identity, installation_id: crypto.randomUUID(), package_digest: `sha256:${"a".repeat(64)}` }, version: { installed: "3.1.0", available: "3.1.0" }, trust: { ...base.trust, status: "verified", signing_key_id: "braindrive-app-release-fixture-2026", checked_at: "2026-08-07T00:00:00.000Z", revocation_status: "not_revoked_fresh" }, compatibility: { ...base.compatibility, host: true }, capabilities: { ...base.capabilities, granted: [...base.capabilities.requested] }, retention: { ...base.retention, compatibility: "ready" }, available_actions: ["launch", "disable", "uninstall"], ...overrides };
}

const brief: appsApi.AppStatus = {
  ...base,
  route_key: "brief-builder",
  identity: { ...base.identity, app_id: "ai.braindrive.brief-builder", display_name: "Brief Builder" },
  version: { installed: null, available: "1.0.0" },
  capabilities: { requested: ["brief.sources.read"], granted: [] },
  retention: { ...base.retention, safe_message: "Owner data is not inspected during catalog reads.", uninstall_retains: ["owner data", "owner exports", "lifecycle evidence"] },
  catalog: { summary: "Summarize source material into a concise, supported brief you can review, edit, and approve.", icon: null, retention_summary: "Approved briefs remain owner-controlled.", primary_resource_uri: "ui://brief-builder/main", provenance: "verified_first_party_package" },
};

const launch = {
  launch_version: 1 as const, session_id: crypto.randomUUID(), installation_id: crypto.randomUUID(), view_id: crypto.randomUUID(), operation_id: crypto.randomUUID(),
  bridge_generation: 1, resumed: false,
  bridge_token_id: crypto.randomUUID(), server_id: crypto.randomUUID(), expires_at: "2030-01-01T00:00:00.000Z",
  protocol: { core: "2026-07-28", apps_extension: "2026-01-26", server_name: "fixture", server_version: "3.0.0" },
  resource: { uri: "ui://resume-builder/main", mime_type: "text/html;profile=mcp-app" as const, content_digest: `sha256:${"a".repeat(64)}`, size_bytes: 32, html: "<!doctype html><main>Fixture</main>" },
  allowed_tools: ["fixture.status"], allowed_capabilities: ["career.context.read"], entry_point: "direct" as const,
};

function chatPresentation(): NonNullable<appsApi.AppStatus["catalog"]>["presentations"] {
  return {
    presentation_set_version: 1,
    default_presentation_id: "chat",
    profiles: [
      {
        profile_version: 1,
        presentation_id: "chat",
        type: "chat_workspace",
        label: "Just Chat With It",
        description: "Open the native app workspace.",
        workspace_id: "resume.chat",
        owner_visibility: "primary",
      },
      {
        profile_version: 1,
        presentation_id: "surface",
        type: "surface",
        label: "Open App",
        description: "Open the sandboxed app surface.",
        resource_uri: "ui://resume-builder/main",
        owner_visibility: "internal",
      },
    ],
  };
}

function chatLaunch(overrides: Partial<appsApi.AppChatWorkspaceLaunch> = {}): appsApi.AppChatWorkspaceLaunch {
  const session = {
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
  };
  return {
    launch_version: 1,
    kind: "chat_workspace",
    session,
    resumed: false,
    presentation: {
      profile_version: 1,
      presentation_id: "chat",
      type: "chat_workspace",
      label: "Just Chat With It",
      description: "Open the native app workspace.",
      workspace_id: "resume.chat",
      owner_visibility: "primary",
    },
    workspace: {
      workspace_version: 1,
      workspace_id: "resume.chat",
      title: "Resume Workspace",
      description: "Native app-chat workspace.",
      default_document_id: "conversation",
      empty_state: {
        empty_state_version: 1,
        heading: "Let's build your resume",
        description: "Tell me the role you want, paste an existing resume, or describe your experience.",
        cta_label: "Let's get started",
        cta_message: "I want to build my resume.",
      },
      documents: [
        {
          document_version: 1,
          document_id: "conversation",
          role: "conversation",
          title: "Conversation",
          description: "Native app conversation.",
          editable: true,
          default_visibility: "primary",
          model_access: "read_write_draft",
          resource_id: null,
          data_binding_id: null,
        },
        {
          document_version: 1,
          document_id: "profile",
          role: "source_document",
          title: "Your Profile",
          description: "Owner-editable app document.",
          editable: true,
          default_visibility: "primary",
          model_access: "read_write_draft",
          resource_id: null,
          data_binding_id: "profile.current",
        },
        {
          document_version: 1,
          document_id: "instructions",
          role: "advanced_resource",
          title: "Agent Instructions",
          description: "Package-provided resource descriptor.",
          editable: false,
          default_visibility: "advanced",
          model_access: "read_reference",
          resource_id: "instructions",
          data_binding_id: null,
        },
      ],
      resources: [{
        resource_version: 1,
        resource_id: "instructions",
        role: "agent_instructions",
        title: "Agent Instructions",
        description: "Read-only package resource.",
        package_path: "payload/resources/instructions.md",
        media_type: "text/markdown",
        content_digest: `sha256:${"e".repeat(64)}`,
        owner_editable: false,
        prompt_inclusion: "workspace_start",
      }],
      actions: [],
    },
    context: {
      context_projection_set_version: 1,
      context_grant_set_digest: session.context_grant_set_digest,
      items: [],
    },
    ...overrides,
  };
}

describe("manifest-driven Apps surface", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [brief, base] }); });

  it("renders two deterministic cards from server metadata as plain text and host-authored actions", async () => {
    const user = userEvent.setup();
    const { container } = renderApps(<AppsPage />);
    const headings = await screen.findAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual(["Brief Builder", "Resume Builder"]);
    expect(screen.getByText("Summarize source material.")).toBeInTheDocument();
    expect(screen.getByText("Build an evidence-grounded resume.")).toBeInTheDocument();
    await user.hover(screen.getByRole("button", { name: "More about Brief Builder" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Summarize source material into a concise, supported brief you can review, edit, and approve.");
    await user.click(screen.getByRole("button", { name: "Show detailed cards" }));
    expect(screen.getByText(/ui:\/\/brief-builder\/main/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install Brief Builder" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable Brief Builder" })).not.toBeInTheDocument();

    const briefCard = container.querySelector('[data-app-key="brief-builder"]');
    expect(briefCard).not.toBeNull();
    expect(briefCard).toHaveClass("flex", "h-full", "flex-col");
    expect(briefCard?.querySelector(".lucide-app-window")?.parentElement).toHaveClass("size-12", "items-center", "justify-center");
    expect(within(briefCard as HTMLElement).getByText("Not installed")).toHaveClass("whitespace-nowrap");
    expect(briefCard?.querySelector('[aria-label="Brief Builder controls"]')).toHaveClass("mt-auto", "pt-6");
  });

  it("renders manifest-looking markup as bounded text and never creates app-authored controls", async () => {
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [{ ...brief, identity: { ...brief.identity, display_name: '<a href="https://evil.invalid">Launch</a>' }, catalog: { ...brief.catalog!, summary: '<button>Approve</button><script>bad()</script>' } }, base] });
    const user = userEvent.setup();
    const { container } = renderApps(<AppsPage />);
    expect(await screen.findByText('<a href="https://evil.invalid">Launch</a>')).toBeInTheDocument();
    await user.hover(screen.getByRole("button", { name: 'More about <a href="https://evil.invalid">Launch</a>' }));
    expect(await screen.findByText('<button>Approve</button><script>bad()</script>')).toBeInTheDocument();
    expect(container.querySelector('a[href="https://evil.invalid"]')).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("keeps one unavailable card isolated without disabling the unrelated app", async () => {
    const unavailableBrief = { ...brief, availability: { status: "unavailable" as const, package_digest: null, error_code: "package_revoked", safe_message: "This app version is revoked and cannot be installed." }, available_actions: [] };
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [unavailableBrief, base] });
    renderApps(<AppsPage />);
    expect(await screen.findByText("This app version is revoked and cannot be installed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install Brief Builder" })).not.toBeInTheDocument();
    const resumeInstall = screen.getByRole("button", { name: "Install Resume Builder" });
    expect(resumeInstall).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("revoked");
  });

  it("scopes lifecycle busy state to only the selected app card", async () => {
    let release!: (value: appsApi.AppStatus) => void;
    vi.mocked(appsApi.mutateApp).mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const user = userEvent.setup(); renderApps(<AppsPage />);
    await user.click(await screen.findByRole("button", { name: "Install Brief Builder" }));
    expect(screen.getByRole("button", { name: "Install Brief Builder" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Install Resume Builder" })).toBeEnabled();
    release({ ...installed(), route_key: "brief-builder", identity: { ...installed().identity, app_id: "ai.braindrive.brief-builder", display_name: "Brief Builder" } });
    expect(await screen.findByText("Active and ready")).toBeInTheDocument();
  });

  it("shows identity, trust, source, compatibility, capabilities, retention, and installs from one control", async () => {
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [base] });
    vi.mocked(appsApi.mutateApp).mockResolvedValue(installed());
    const user = userEvent.setup(); renderApps(<AppsPage />);
    expect(await screen.findByRole("heading", { name: "Resume Builder" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show detailed cards" }));
    expect(screen.getByText("not verified")).toBeInTheDocument();
    expect(screen.getByText("Bundled BrainDrive app source")).toBeInTheDocument();
    expect(screen.getByText("2026-07-28")).toBeInTheDocument();
    expect(screen.getByText(/Uninstall retains career data, resume and job history/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Install Resume Builder" }));
    expect(appsApi.mutateApp).toHaveBeenCalledWith("resume-builder", "install", base);
    expect(await screen.findByText("Active and ready")).toBeInTheDocument();
  });

  it("offers an explicit owner-approved update for an installed older package", async () => {
    const prior = installed({ version: { installed: "3.0.2", available: "3.1.0" }, available_actions: ["launch", "disable", "uninstall", "update"] });
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [prior] });
    vi.mocked(appsApi.mutateApp).mockResolvedValue(installed());
    const user = userEvent.setup(); renderApps(<AppsPage />);

    await user.click(await screen.findByRole("button", { name: "Update Resume Builder" }));
    expect(appsApi.mutateApp).toHaveBeenCalledWith("resume-builder", "update", prior);
    expect(await screen.findByText("Version 3.1.0")).toBeInTheDocument();
  });

  it("uses a focused confirmation that states exact removal and retention, supports Escape, and restores focus", async () => {
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [installed()] });
    const user = userEvent.setup(); renderApps(<AppsPage />);
    const uninstallButton = await screen.findByRole("button", { name: "Remove app code for Resume Builder" });
    await user.click(uninstallButton);
    expect(screen.getByRole("dialog", { name: "Uninstall Resume Builder?" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(/capability grants/i);
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
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [current] });
    let release!: (value: appsApi.AppStatus) => void;
    vi.mocked(appsApi.mutateApp).mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const user = userEvent.setup(); renderApps(<AppsPage />);
    await user.click(await screen.findByRole("button", { name: "Remove app code for Resume Builder" }));
    const confirm = screen.getByRole("button", { name: "Uninstall app code" });
    await user.click(confirm);
    expect(appsApi.mutateApp).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Remove app code for Resume Builder" })).toBeDisabled();
    release({ ...base, generation: 4, retention: { ...base.retention, retained_data_present: true, compatibility: "ready" }, available_actions: ["install"] });
    expect(await screen.findByRole("button", { name: "Install Resume Builder" })).toBeInTheDocument();
  });

  it("represents progress, quarantined, and recoverable states with readable text and actions", async () => {
    const operationId = crypto.randomUUID();
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [installed({ state: "updating", available_actions: [], progress: { operation_version: 1, operation_id: operationId, installation_id: crypto.randomUUID(), kind: "update", status: "running", stage: "verifying_package", completed_stages: [], commit_outcome: "not_committed", prior_state: "active", target_state: "active", result_state: null, error_code: null, recovery_action: "none", started_at: "2026-08-07T00:00:00.000Z", updated_at: "2026-08-07T00:00:01.000Z", completed_at: null } })] });
    const { rerender } = renderApps(<AppsPage />);
    expect(await screen.findByText("Verifying signed package")).toBeInTheDocument();
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [installed({ state: "quarantined", available_actions: ["uninstall"], trust: { ...base.trust, status: "quarantined", revocation_status: "revoked" } })] });
    rerender(<AppsPage />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh app catalog" }));
    expect(await screen.findByText(/Quarantined because package trust changed/)).toBeInTheDocument();
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [installed({ state: "failed_recoverable", available_actions: ["recover", "uninstall"], recovery: { available: true, action: "retry_recovery_or_reinstall" } })] });
    await userEvent.click(screen.getByRole("button", { name: "Refresh app catalog" }));
    expect(await screen.findByRole("button", { name: "Retry recovery Resume Builder" })).toBeInTheDocument();
  });

  it("reports transport ambiguity only after authoritative refresh evidence", async () => {
    const current = installed();
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [current] });
    vi.mocked(appsApi.mutateApp).mockResolvedValue({ ...current, state: "disabled", generation: 3, available_actions: ["enable", "uninstall"], request_resolution: "refreshed_after_ambiguous_response" });
    const user = userEvent.setup(); renderApps(<AppsPage />);
    await user.click(await screen.findByRole("button", { name: "Disable Resume Builder" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/response was interrupted/i);
    expect(screen.getByText("Disabled — your saved data is retained")).toBeInTheDocument();
  });

  it("returns keyboard focus to Launch after the sandbox session closes through the generic direct launch path", async () => {
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [installed()] });
    vi.mocked(appsApi.launchApp).mockResolvedValue(launch);
    const user = userEvent.setup(); renderApps(<AppsPage entryPoint="career" />);
    const launchButton = await screen.findByRole("button", { name: /^Launch$/ });
    await user.click(launchButton);
    expect(appsApi.launchApp).toHaveBeenCalledWith("resume-builder", "direct");
    await user.click(await screen.findByRole("button", { name: "Close app" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Launch$/ })).toHaveFocus());
  });

  it("routes a primary chat workspace presentation to the native shell and restores focus after close", async () => {
    const current = installed({ catalog: { ...installed().catalog!, presentations: chatPresentation() } });
    const launched = chatLaunch();
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [current] });
    vi.mocked(appsApi.launchAppChatWorkspace).mockResolvedValue(launched);
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(launched.session);

    const user = userEvent.setup();
    renderApps(<AppsPage />);
    const launchButton = await screen.findByRole("button", { name: "Just Chat With It" });
    await user.click(launchButton);

    expect(appsApi.launchAppChatWorkspace).toHaveBeenCalledWith("resume-builder", { presentationId: "chat", workspaceId: "resume.chat" });
    expect(appsApi.launchApp).not.toHaveBeenCalled();
    expect(await screen.findByRole("region", { name: "Resume Builder native app workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your Profile" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agent Instructions" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show advanced" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Your Profile" }));
    expect(await screen.findByRole("heading", { name: "Your Profile" })).toHaveFocus();
    expect(screen.getAllByPlaceholderText("Message your BrainDrive...").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Back to Apps" }));
    await waitFor(() => expect(appsApi.closeAppSession).toHaveBeenCalledWith("resume-builder", launched.session.session_id));
    await waitFor(() => expect(screen.getByRole("button", { name: "Just Chat With It" })).toHaveFocus());
  });

  it("keeps surface presentations on the sandbox launch path", async () => {
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [installed()] });
    vi.mocked(appsApi.launchApp).mockResolvedValue(launch);

    const user = userEvent.setup();
    renderApps(<AppsPage />);
    await user.click(await screen.findByRole("button", { name: /^Launch$/ }));

    expect(appsApi.launchApp).toHaveBeenCalledWith("resume-builder", "direct");
    expect(appsApi.launchAppChatWorkspace).not.toHaveBeenCalled();
    expect(await screen.findByTitle("Resume Builder sandbox proxy")).toBeInTheDocument();
  });

  it("reloads through the bounded reconnect handshake before the old session is torn down", async () => {
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [installed()] });
    const resumed = { ...launch, session_id: crypto.randomUUID(), bridge_generation: 2, resumed: true };
    vi.mocked(appsApi.launchApp).mockResolvedValueOnce(launch).mockResolvedValueOnce(resumed);
    const user = userEvent.setup(); renderApps(<AppsPage />);
    await user.click(await screen.findByRole("button", { name: /^Launch$/ }));
    await user.click(await screen.findByRole("button", { name: "Reload app" }));
    await waitFor(() => expect(appsApi.launchApp).toHaveBeenLastCalledWith("resume-builder", "direct", launch));
    const reconnectOrder = vi.mocked(appsApi.launchApp).mock.invocationCallOrder[1]!;
    const closeIndex = vi.mocked(appsApi.closeAppSession).mock.calls.findIndex(([appKey, sessionId]) => appKey === "resume-builder" && sessionId === launch.session_id);
    if (closeIndex >= 0) expect(vi.mocked(appsApi.closeAppSession).mock.invocationCallOrder[closeIndex]).toBeGreaterThan(reconnectOrder);
  });

  it("keeps a single-column base layout with responsive enhancement classes", async () => {
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [base] });
    renderApps(<AppsPage />);
    const page = await screen.findByTestId("apps-page");
    expect(page).toHaveClass("px-4");
    expect(screen.getByTestId("app-catalog")).toHaveClass("grid-cols-1", "lg:grid-cols-2");
  });

  it("toggles between detailed and compact cards without hiding identity or actions", async () => {
    const user = userEvent.setup();
    renderApps(<AppsPage />);

    expect(await screen.findByRole("heading", { name: "Brief Builder" })).toBeInTheDocument();
    expect(screen.queryByText("Trust and source")).not.toBeInTheDocument();
    expect(screen.queryByText("Requested capabilities")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage and retention")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install Brief Builder" })).toBeInTheDocument();
    const detailedToggle = screen.getByRole("button", { name: "Show detailed cards" });
    expect(detailedToggle).toHaveAttribute("aria-pressed", "true");

    await user.click(detailedToggle);
    expect(await screen.findAllByText("Trust and source")).toHaveLength(2);
    const compactToggle = screen.getByRole("button", { name: "Show compact cards" });
    expect(compactToggle).toHaveAttribute("aria-pressed", "false");
    await user.click(compactToggle);
    expect(screen.queryByText("Trust and source")).not.toBeInTheDocument();
  });
});
