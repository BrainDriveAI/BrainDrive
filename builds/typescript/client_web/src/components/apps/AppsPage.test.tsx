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
        label: "Launch",
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
      label: "Launch",
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

const dependencyReady: appsApi.CapabilityDependencyReadiness = {
  status: "ready",
  required_available: true,
  optional_available: true,
  blocking_operation_ids: [],
  degraded_operation_ids: [],
};

function dependencyStatus(
  operationId: string,
  requirement: "required" | "optional",
  state: appsApi.CapabilityDependencyState,
  overrides: Partial<appsApi.CapabilityDependencyStatus> = {},
): appsApi.CapabilityDependencyStatus {
  return {
    operation_id: operationId,
    requirement,
    unavailable_behavior: requirement === "required" ? "block_activation" : "degrade_with_safe_status",
    state,
    callable: state === "available",
    provider_count: state === "missing" ? 0 : 1,
    failure_code: state === "available" ? null : "provider_unavailable",
    safe_message: state === "available" ? "Capability dependency is available." : "Capability provider is unavailable.",
    checked_at: "2026-09-01T12:05:00.000Z",
    ...overrides,
  };
}

function providerPackage(overrides: Partial<appsApi.InstalledPackageStatus> = {}): appsApi.InstalledPackageStatus {
  return {
    projection_version: 1,
    identity: {
      package_id: "ai.braindrive.internet-search.searxng",
      display_name: "Internet Search Provider",
      publisher_id: "ai.braindrive",
      installation_id: crypto.randomUUID(),
      package_digest: `sha256:${"7".repeat(64)}`,
    },
    package_kind: ["capability_provider"],
    state: "enabled",
    generation: 1,
    version: { installed: "1.0.0", previous_package_digest: null },
    trust: { status: "verified", policy_version: 1, checked_at: "2026-09-01T12:00:00.000Z" },
    source: { kind: "repository_fixture", label: "Internet Search provider package fixture" },
    components: [
      {
        component_id: "search.provider",
        component_kind: "capability_provider",
        display_name: "Search Provider",
        owner_component_id: null,
        state: "enabled",
        health: "not_applicable",
        launchable: false,
        owner_visible_actions: ["enable", "disable", "update", "uninstall", "health", "launch"],
        provided_operations: ["web.search@1", "web.read@1"],
        required_capabilities: [],
        capability_dependency_status: [],
        dependency_readiness: dependencyReady,
        sidecar_count: 1,
        target_support: [],
      },
      {
        component_id: "search.runtime",
        component_kind: "sidecar",
        display_name: "Search Runtime",
        owner_component_id: "search.provider",
        state: "running",
        health: "healthy",
        launchable: false,
        owner_visible_actions: ["start", "stop", "restart", "health", "launch"],
        provided_operations: [],
        required_capabilities: [],
        capability_dependency_status: [],
        dependency_readiness: dependencyReady,
        sidecar_count: 0,
        target_support: [{ target: "docker_linux_x64", runtime_kind: "container" }],
      },
    ],
    operations: [
      { operation_id: "web.search@1", provider_component_id: "search.provider", result_classification: "generic_envelope" },
      { operation_id: "web.read@1", provider_component_id: "search.provider", result_classification: "generic_envelope" },
    ],
    capability_dependencies: [],
    capability_dependency_status: [],
    dependency_readiness: dependencyReady,
    retention: {
      runtime_authority: "ephemeral_remove_on_stop_or_uninstall",
      sidecar_runtime_state: "remove_on_uninstall",
      provider_cache: "delete_by_default_unless_owner_preserves",
      diagnostics: "bounded_redacted",
      evidence: "content_free_bounded",
    },
    available_actions: ["disable", "update", "uninstall", "launch"],
    updated_at: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

function dependencyPackage(overrides: Partial<appsApi.InstalledPackageStatus> = {}): appsApi.InstalledPackageStatus {
  return {
    ...providerPackage(),
    identity: {
      package_id: "ai.braindrive.shared-index",
      display_name: "Shared Index Service",
      publisher_id: "ai.braindrive",
      installation_id: crypto.randomUUID(),
      package_digest: `sha256:${"8".repeat(64)}`,
    },
    package_kind: ["dependency_service"],
    state: "disabled",
    version: { installed: "0.4.0", previous_package_digest: null },
    source: { kind: "repository_fixture", label: "Shared service package fixture" },
    components: [{
      component_id: "index.service",
      component_kind: "dependency_service",
      display_name: "Index Service",
      owner_component_id: null,
      state: "unavailable",
      health: "unhealthy",
      launchable: false,
      owner_visible_actions: ["enable", "disable", "health"],
      provided_operations: [],
      required_capabilities: [{
        operation_id: "web.search@1",
        requirement: "optional",
        unavailable_behavior: "degrade_with_safe_status",
      }],
      capability_dependency_status: [dependencyStatus("web.search@1", "optional", "unhealthy", {
        failure_code: "provider_unhealthy",
        safe_message: "Capability provider is unhealthy.",
      })],
      dependency_readiness: {
        ...dependencyReady,
        status: "degraded",
        optional_available: false,
        degraded_operation_ids: ["web.search@1"],
      },
      sidecar_count: 0,
      target_support: [{ target: "desktop_macos_universal", runtime_kind: "packaged_process" }],
    }],
    operations: [],
    capability_dependencies: [{
      operation_id: "web.search@1",
      requirement: "optional",
      unavailable_behavior: "degrade_with_safe_status",
    }],
    capability_dependency_status: [dependencyStatus("web.search@1", "optional", "unhealthy", {
      failure_code: "provider_unhealthy",
      safe_message: "Capability provider is unhealthy.",
    })],
    dependency_readiness: {
      ...dependencyReady,
      status: "degraded",
      optional_available: false,
      degraded_operation_ids: ["web.search@1"],
    },
    available_actions: ["enable", "update", "uninstall"],
    updated_at: "2026-09-01T12:30:00.000Z",
    ...overrides,
  };
}

function consumerPackage(overrides: Partial<appsApi.InstalledPackageStatus> = {}): appsApi.InstalledPackageStatus {
  const blocked = dependencyStatus("web.search@1", "required", "missing");
  return {
    ...providerPackage(),
    identity: {
      package_id: "ai.braindrive.research-consumer",
      display_name: "Research Consumer",
      publisher_id: "ai.braindrive",
      installation_id: crypto.randomUUID(),
      package_digest: `sha256:${"9".repeat(64)}`,
    },
    package_kind: ["app"],
    components: [{
      component_id: "research.app",
      component_kind: "app",
      display_name: "Research Consumer",
      owner_component_id: null,
      state: "enabled",
      health: "not_applicable",
      launchable: true,
      owner_visible_actions: ["enable", "disable", "stop", "update", "uninstall", "health"],
      provided_operations: [],
      required_capabilities: [{
        operation_id: "web.search@1",
        requirement: "required",
        unavailable_behavior: "block_activation",
      }],
      capability_dependency_status: [blocked],
      dependency_readiness: {
        ...dependencyReady,
        status: "blocked",
        required_available: false,
        blocking_operation_ids: ["web.search@1"],
      },
      sidecar_count: 0,
      target_support: [],
    }],
    operations: [],
    capability_dependencies: [{
      operation_id: "web.search@1",
      requirement: "required",
      unavailable_behavior: "block_activation",
    }],
    capability_dependency_status: [blocked],
    dependency_readiness: {
      ...dependencyReady,
      status: "blocked",
      required_available: false,
      blocking_operation_ids: ["web.search@1"],
    },
    available_actions: ["disable", "update", "uninstall"],
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

  it("shows blocked dependencies on legacy app cards without Install, Launch, or Enable controls", async () => {
    const blockedSearch = dependencyStatus("web.search@1", "required", "missing");
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({
      catalog_version: 1,
      apps: [installed({
        route_key: "research-consumer",
        identity: {
          ...base.identity,
          app_id: "ai.braindrive.research-consumer",
          display_name: "Research Consumer",
          installation_id: crypto.randomUUID(),
          package_digest: `sha256:${"9".repeat(64)}`,
        },
        capabilities: { requested: ["web.search"], granted: ["web.search"] },
        capability_dependency_status: [blockedSearch],
        dependency_readiness: {
          ...dependencyReady,
          status: "blocked",
          required_available: false,
          blocking_operation_ids: ["web.search@1"],
        },
        available_actions: ["disable", "uninstall"],
      })],
      packages: [consumerPackage()],
    });
    const { container } = renderApps(<AppsPage />);
    const appCatalog = await screen.findByTestId("app-catalog");

    expect(within(appCatalog).getByRole("heading", { name: "Research Consumer" })).toBeInTheDocument();
    expect(within(appCatalog).getByRole("alert", { name: "Research Consumer dependency readiness" })).toHaveTextContent("Required dependency blocked: web.search@1");
    expect(within(appCatalog).queryByRole("button", { name: "Install Research Consumer" })).not.toBeInTheDocument();
    expect(within(appCatalog).queryByRole("button", { name: "Launch" })).not.toBeInTheDocument();
    expect(within(appCatalog).queryByRole("button", { name: "Enable Research Consumer" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show detailed cards" }));
    expect(container.querySelector('[data-app-key="research-consumer"]')).toHaveTextContent("Dependencies: Required: web.search@1 - missing");
  });

  it("renders app readiness states and Search/Read disclosure from owner-safe projections", async () => {
    const selectionRequired = dependencyStatus("web.search@1", "required", "selection_required", {
      callable: false,
      provider_count: 2,
      failure_code: "provider_selection_required",
      safe_message: "Choose an Internet Search provider before launch.",
    });
    const optionalMissing = dependencyStatus("web.read@1", "optional", "missing", {
      callable: false,
      provider_count: 0,
      safe_message: "Internet Read is unavailable.",
    });
    const unknownRequired = dependencyStatus("web.search@1", "required", "unknown", {
      callable: false,
      provider_count: 0,
      failure_code: "unknown",
      safe_message: "Dependency readiness could not be checked.",
    });
    const readySearch = dependencyStatus("web.search@1", "required", "available");
    const blockedApp = installed({
      route_key: "selection-required",
      identity: { ...base.identity, app_id: "ai.braindrive.selection-required", display_name: "Selection Required", installation_id: crypto.randomUUID(), package_digest: `sha256:${"1".repeat(64)}` },
      capability_dependency_status: [selectionRequired],
      dependency_readiness: { ...dependencyReady, status: "blocked", required_available: false, blocking_operation_ids: ["web.search@1"] },
      available_actions: ["launch", "disable", "uninstall"],
    });
    const degradedApp = installed({
      route_key: "optional-degraded",
      identity: { ...base.identity, app_id: "ai.braindrive.optional-degraded", display_name: "Optional Degraded", installation_id: crypto.randomUUID(), package_digest: `sha256:${"2".repeat(64)}` },
      capability_dependency_status: [optionalMissing],
      dependency_readiness: { ...dependencyReady, status: "degraded", optional_available: false, degraded_operation_ids: ["web.read@1"] },
      available_actions: ["launch", "disable"],
    });
    const unknownApp = installed({
      route_key: "unknown-readiness",
      identity: { ...base.identity, app_id: "ai.braindrive.unknown-readiness", display_name: "Unknown Readiness", installation_id: crypto.randomUUID(), package_digest: `sha256:${"3".repeat(64)}` },
      capability_dependency_status: [unknownRequired],
      dependency_readiness: { status: "unknown", required_available: false, optional_available: true, blocking_operation_ids: ["web.search@1"], degraded_operation_ids: [] },
      available_actions: ["launch", "disable"],
    });
    const readyApp = installed({
      route_key: "ready-search",
      identity: { ...base.identity, app_id: "ai.braindrive.ready-search", display_name: "Ready Search", installation_id: crypto.randomUUID(), package_digest: `sha256:${"4".repeat(64)}` },
      capability_dependency_status: [readySearch],
      dependency_readiness: { ...dependencyReady, blocking_operation_ids: [], degraded_operation_ids: [] },
      available_actions: ["launch"],
    });
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [blockedApp, degradedApp, unknownApp, readyApp], packages: [] });
    vi.mocked(appsApi.launchApp).mockResolvedValue(launch);

    const user = userEvent.setup();
    const { container } = renderApps(<AppsPage />);
    await screen.findByRole("heading", { name: "Selection Required" });

    const blockedCard = container.querySelector('[data-app-key="selection-required"]') as HTMLElement;
    const degradedCard = container.querySelector('[data-app-key="optional-degraded"]') as HTMLElement;
    const unknownCard = container.querySelector('[data-app-key="unknown-readiness"]') as HTMLElement;
    const readyCard = container.querySelector('[data-app-key="ready-search"]') as HTMLElement;

    expect(within(blockedCard).getByRole("alert", { name: "Selection Required dependency readiness" })).toHaveTextContent("Required dependency blocked: web.search@1");
    expect(blockedCard).toHaveTextContent("Owner/admin provider selection is required before launch. BrainDrive will not choose a provider silently.");
    expect(within(blockedCard).queryByRole("button", { name: "Launch" })).not.toBeInTheDocument();

    expect(within(degradedCard).getByRole("status", { name: "Optional Degraded dependency readiness" })).toHaveTextContent("Optional dependency degraded: web.read@1");
    expect(degradedCard).toHaveTextContent("This app can launch only in its declared degraded mode");
    expect(degradedCard).toHaveTextContent("Queries and URLs may be sent to the selected provider. Provider keys and unrelated owner data are not sent.");
    expect(degradedCard).toHaveTextContent("Owner-managed provider costs are handled outside BrainDrive");
    await user.click(within(degradedCard).getByRole("button", { name: "Launch" }));
    expect(appsApi.launchApp).toHaveBeenCalledWith("optional-degraded", "direct");

    expect(within(unknownCard).getByRole("status", { name: "Unknown Readiness dependency readiness" })).toHaveTextContent("Dependency readiness unknown: web.search@1");
    expect(unknownCard).toHaveTextContent("Refresh Apps or ask an owner/admin to check provider status before launch.");
    expect(within(unknownCard).queryByRole("button", { name: "Launch" })).not.toBeInTheDocument();

    expect(within(readyCard).getByRole("status", { name: "Ready Search dependency readiness" })).toHaveTextContent("Dependencies ready: web.search@1");
    expect(readyCard).toHaveTextContent("All declared dependencies are available for this app.");
    expect(container.querySelector('[data-testid="app-catalog"]')?.textContent ?? "").not.toMatch(/searxng|localhost|127\.|0\.0\.0\.0|\bport\b|endpoint|private_binding|host_path|payload\/|adapter|secret|credential|BrainDrive billing|credits/i);
  });

  it("renders providers and dependency services from the safe package projection without Launch", async () => {
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({
      catalog_version: 1,
      apps: [installed()],
      packages: [providerPackage(), dependencyPackage()],
    });
    const user = userEvent.setup();
    const { container } = renderApps(<AppsPage />);

    expect(await screen.findByRole("heading", { name: "Internet Search Provider" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shared Index Service" })).toBeInTheDocument();
    expect(screen.getByText("Capability provider")).toBeInTheDocument();
    expect(screen.getByText("Dependency service")).toBeInTheDocument();
    expect(screen.getByText(/Operations: web\.search@1, web\.read@1/)).toBeInTheDocument();
    expect(screen.getByText(/Docker Linux x64/)).toBeInTheDocument();
    expect(screen.getByText(/Desktop macOS universal/)).toBeInTheDocument();
    expect(screen.getByRole("alert", { name: "Shared Index Service package health" })).toHaveTextContent("Unhealthy or unavailable");
    expect(screen.getByRole("status", { name: "Shared Index Service dependency readiness" })).toHaveTextContent("Optional dependency degraded: web.search@1");

    expect(screen.queryByRole("button", { name: "Launch Internet Search Provider" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Launch Shared Index Service" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disable Internet Search Provider" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start Search Runtime" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Show detailed cards" }));
    expect(screen.getAllByText(/bounded redacted diagnostics/)).toHaveLength(2);
    expect(screen.getAllByText(/content free bounded evidence/)).toHaveLength(2);
    expect(screen.getAllByText("Optional: web.search@1 - unhealthy").length).toBeGreaterThan(0);

    const serialized = container.querySelector('[data-testid="package-catalog"]')?.textContent ?? "";
    expect(serialized).not.toMatch(/https?:\/\/|127\.0\.0\.1|localhost|:\d{4,5}|secret|credential|private_binding|host_path|payload\/|adapter|service_name/i);
  });

  it("shows required generic dependency blocks without offering start or provider install actions", async () => {
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({
      catalog_version: 1,
      apps: [],
      packages: [consumerPackage()],
    });
    const { container } = renderApps(<AppsPage />);

    expect(await screen.findByRole("heading", { name: "Research Consumer" })).toBeInTheDocument();
    expect(screen.getByRole("alert", { name: "Research Consumer dependency readiness" })).toHaveTextContent("Required dependency blocked: web.search@1");
    expect(container.querySelector('[data-package-id="ai.braindrive.research-consumer"]')).toHaveTextContent("Required: web.search@1 - missing");
    expect(screen.queryByRole("button", { name: "Start Research Consumer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Install.*Provider/i })).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="package-catalog"]')?.textContent ?? "").not.toMatch(/searxng|localhost|127\.|0\.0\.0\.0|\bport\b|endpoint|private_binding|host_path|payload\/|adapter|secret|credential/i);
  });

  it("renders package selection-required and unknown states without provider mutation controls", async () => {
    const selectionRequired = dependencyStatus("web.search@1", "required", "selection_required", {
      callable: false,
      provider_count: 2,
      failure_code: "provider_selection_required",
      safe_message: "Choose an Internet Search provider before dependent apps use Search.",
    });
    const unknownOptional = dependencyStatus("web.read@1", "optional", "unknown", {
      callable: false,
      provider_count: 0,
      failure_code: "unknown",
      safe_message: "Read provider readiness could not be checked.",
    });
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({
      catalog_version: 1,
      apps: [],
      packages: [
        consumerPackage({
          capability_dependency_status: [selectionRequired],
          dependency_readiness: { ...dependencyReady, status: "blocked", required_available: false, blocking_operation_ids: ["web.search@1"] },
          available_actions: ["launch", "disable", "update"],
        }),
        dependencyPackage({
          identity: { ...dependencyPackage().identity, package_id: "ai.braindrive.read-cache", display_name: "Read Cache" },
          capability_dependency_status: [unknownOptional],
          dependency_readiness: { status: "unknown", required_available: true, optional_available: false, blocking_operation_ids: [], degraded_operation_ids: ["web.read@1"] },
          available_actions: ["launch", "enable", "update"],
        }),
      ],
    });
    const { container } = renderApps(<AppsPage />);

    const researchPackage = await screen.findByRole("heading", { name: "Research Consumer" });
    const blockedCard = researchPackage.closest("article") as HTMLElement;
    const readCacheCard = screen.getByRole("heading", { name: "Read Cache" }).closest("article") as HTMLElement;

    expect(within(blockedCard).getByRole("alert", { name: "Research Consumer dependency readiness" })).toHaveTextContent("Required dependency blocked: web.search@1");
    expect(blockedCard).toHaveTextContent("Owner/admin provider selection is required before dependent apps can use this operation. BrainDrive will not choose a provider silently.");
    expect(within(blockedCard).queryByRole("button", { name: "Launch Research Consumer" })).not.toBeInTheDocument();
    expect(within(blockedCard).queryByRole("button", { name: /Choose|Select/i })).not.toBeInTheDocument();

    expect(within(readCacheCard).getByRole("status", { name: "Read Cache dependency readiness" })).toHaveTextContent("Dependency readiness unknown: web.read@1");
    expect(readCacheCard).toHaveTextContent("Refresh Apps or ask an owner/admin to check provider readiness before dependent apps rely on this package.");
    expect(readCacheCard).toHaveTextContent("Apps using these operations may send queries and URLs to the selected provider.");
    expect(readCacheCard).toHaveTextContent("This package is not a launchable app unless the Host projection includes a launchable app component.");
    expect(container.querySelector('[data-testid="package-catalog"]')?.textContent ?? "").not.toMatch(/https?:\/\/|127\.0\.0\.1|localhost|:\d{4,5}|secret|credential|private_binding|host_path|payload\/|adapter|service_name|BrainDrive billing|credits/i);
  });

  it("keeps provider projection text inert and filters adversarial launch actions", async () => {
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({
      catalog_version: 1,
      apps: [],
      packages: [providerPackage({
        identity: {
          ...providerPackage().identity,
          display_name: '<button>Launch</button><script>bad()</script>',
        },
        source: { kind: "repository_fixture", label: '<a href="https://evil.invalid">source</a>' },
      })],
    });
    const { container } = renderApps(<AppsPage />);

    expect(await screen.findByText('<button>Launch</button><script>bad()</script>')).toBeInTheDocument();
    expect(screen.queryAllByRole("button").filter((button) => button.textContent === "Launch")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Show detailed cards" }));
    expect(screen.getByText('<a href="https://evil.invalid">source</a>')).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href="https://evil.invalid"]')).toBeNull();
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

  it("passes the current entry point to sandbox launches and restores focus after close", async () => {
    vi.mocked(appsApi.getAppCatalog).mockResolvedValue({ catalog_version: 1, apps: [installed()] });
    vi.mocked(appsApi.launchApp).mockResolvedValue(launch);
    const user = userEvent.setup(); renderApps(<AppsPage entryPoint="career" />);
    const launchButton = await screen.findByRole("button", { name: /^Launch$/ });
    await user.click(launchButton);
    expect(appsApi.launchApp).toHaveBeenCalledWith("resume-builder", "career");
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
    const launchButton = await screen.findByRole("button", { name: "Launch" });
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Launch" })).toHaveFocus());
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
