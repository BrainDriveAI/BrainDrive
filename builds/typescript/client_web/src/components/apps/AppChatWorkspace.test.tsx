import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import * as appsApi from "@/api/apps-adapter";
import AppChatWorkspace, { buildAppChatMessageMetadata } from "./AppChatWorkspace";

vi.mock("@/api/auth-adapter", () => ({
  getSession: vi.fn(async () => ({
    user: {
      name: "demo",
      initials: "DE",
      email: "demo@local.braindrive",
    },
  })),
}));

vi.mock("@/api/apps-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/api/apps-adapter")>("@/api/apps-adapter");
  return {
    ...actual,
    closeAppSession: vi.fn(async () => undefined),
    readAppChatWorkspaceSession: vi.fn(),
    readAppChatWorkspaceDocument: vi.fn(),
    readAppChatWorkspaceResource: vi.fn(),
    writeAppChatWorkspaceDocument: vi.fn(),
  };
});

vi.mock("@/components/chat/ChatPanel", () => ({
  default: (props: {
    contentOverride?: ReactNode;
    emptyStateIntro?: { heading: string; description: string; cta?: string };
    messageMetadata?: Record<string, unknown>;
  }) => (
    <section aria-label="Native chat panel">
      <div data-testid="chat-metadata">{JSON.stringify(props.messageMetadata)}</div>
      {props.emptyStateIntro ? (
        <div data-testid="chat-empty-intro">
          <h2>{props.emptyStateIntro.heading}</h2>
          <p>{props.emptyStateIntro.description}</p>
          {props.emptyStateIntro.cta ? <button type="button">{props.emptyStateIntro.cta}</button> : null}
        </div>
      ) : null}
      {props.contentOverride ?? <div>Conversation transcript</div>}
      <textarea placeholder="Message your BrainDrive..." />
    </section>
  ),
}));

function launch(overrides: Partial<appsApi.AppChatWorkspaceLaunch> = {}): appsApi.AppChatWorkspaceLaunch {
  const session = {
    session_id: "00000000-0000-4000-8000-000000000001",
    view_id: "00000000-0000-4000-8000-000000000002",
    operation_id: "00000000-0000-4000-8000-000000000003",
    session_generation: 1,
    owner_id: "00000000-0000-4000-8000-000000000004",
    account_id: "00000000-0000-4000-8000-000000000005",
    actor_id: "00000000-0000-4000-8000-000000000006",
    app_id: "ai.braindrive.test-builder",
    publisher_id: "ai.braindrive",
    installation_id: "00000000-0000-4000-8000-000000000007",
    package_digest: `sha256:${"a".repeat(64)}` as const,
    lifecycle_generation: 2,
    grant_id: "00000000-0000-4000-8000-000000000008",
    grant_revision: 1,
    revocation_generation: 0,
    presentation_id: "chat",
    workspace_id: "test.chat",
    context_grant_set_digest: `sha256:${"b".repeat(64)}` as const,
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
      label: "Chat",
      description: "Open chat.",
      workspace_id: "test.chat",
      owner_visibility: "primary",
    },
    workspace: {
      workspace_version: 1,
      workspace_id: "test.chat",
      title: "Test Workspace",
      description: "Native app-chat workspace.",
      default_document_id: "conversation",
      empty_state: null,
      documents: [
        {
          document_version: 1,
          document_id: "conversation",
          role: "conversation",
          title: "Conversation",
          description: "Native conversation.",
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
          title: "Profile",
          description: "Editable source document.",
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
          description: "App package instructions.",
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
        description: "Read-only app package resource.",
        package_path: "payload/resources/instructions.md",
        media_type: "text/markdown",
        content_digest: `sha256:${"c".repeat(64)}`,
        owner_editable: false,
        prompt_inclusion: "workspace_start",
      }],
      actions: [{
        action_version: 1,
        action_id: "profile.write",
        kind: "write",
        title: "Update Profile",
        description: "Declared future action.",
        input_schema_id: "profile.input",
        result_schema_id: "profile.result",
        confirmation: "owner_confirmation",
        idempotency_policy: "required",
        model_exposure: "available",
      }],
    },
    context: {
      context_projection_set_version: 1,
      context_grant_set_digest: session.context_grant_set_digest,
      items: [],
    },
    ...overrides,
  };
}

describe("AppChatWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(appsApi.readAppChatWorkspaceDocument).mockResolvedValue({
      result_version: 1,
      state: "missing",
      document_id: "profile",
      document_binding_id: "profile.current",
      record: null,
    });
    vi.mocked(appsApi.readAppChatWorkspaceResource).mockResolvedValue({
      result_version: 1,
      resource_id: "instructions",
      title: "Agent Instructions",
      description: "Read-only app package resource.",
      role: "agent_instructions",
      media_type: "text/markdown",
      content_digest: `sha256:${"c".repeat(64)}`,
      owner_editable: false,
      prompt_inclusion: "workspace_start",
      content: "# Agent Instructions\n\n- Use the package-owned instructions.",
    });
  });

  it("renders loading, then the native conversation workspace after session validation", async () => {
    const current = launch();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);

    render(<AppChatWorkspace appKey="test-builder" appName="Test Builder" launch={current} onSessionClosed={() => undefined} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading app workspace");
    expect(await screen.findByRole("region", { name: "Test Builder native app workspace" })).toBeInTheDocument();
    expect(screen.getByText("Conversation transcript")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Message your BrainDrive...")).toBeInTheDocument();
    expect(screen.getByTestId("app-chat-workspace-pane")).toHaveClass("flex", "min-h-0", "flex-1", "flex-col", "overflow-hidden");
    expect(screen.queryByRole("button", { name: /reload/i })).not.toBeInTheDocument();
  });

  it("uses app-declared empty-state copy for the conversation start", async () => {
    const current = launch({
      workspace: {
        ...launch().workspace,
        empty_state: {
          empty_state_version: 1,
          heading: "Let's build your resume",
          description: "Tell me the role you want, paste an existing resume, or describe your experience.",
          cta_label: "Let's get started",
          cta_message: "I want to build my resume.",
        },
      },
    });
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);

    render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={current} onSessionClosed={() => undefined} />);

    expect(await screen.findByRole("heading", { name: "Let's build your resume" })).toBeInTheDocument();
    expect(screen.getByText(/Tell me the role you want/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Let's get started" })).toBeInTheDocument();
  });

  it("navigates documents and advanced resources with focus moving to the selected heading", async () => {
    const current = launch();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    const user = userEvent.setup();

    render(<AppChatWorkspace appKey="test-builder" appName="Test Builder" launch={current} onSessionClosed={() => undefined} />);

    await screen.findByText("Conversation transcript");
    await user.click(screen.getByRole("button", { name: "Profile" }));
    expect(await screen.findByRole("heading", { name: "Profile" })).toHaveFocus();
    expect(screen.getByText("profile.current")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Message your BrainDrive...")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Agent Instructions" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show advanced" }));
    await user.click(screen.getByRole("button", { name: "Agent Instructions" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Agent Instructions" })).toHaveFocus();
    expect(screen.getByText("Package resource")).toBeInTheDocument();
    expect(await screen.findByText("Use the package-owned instructions.")).toBeInTheDocument();
    expect(screen.getByText(/text\/markdown/)).toBeInTheDocument();
    expect(screen.queryByText("Declared actions")).not.toBeInTheDocument();
    expect(screen.queryByText("payload/resources/instructions.md")).not.toBeInTheDocument();
    expect(appsApi.readAppChatWorkspaceResource).toHaveBeenCalledWith("test-builder", current.session.session_id, "instructions");
  });

  it("opens, edits, and saves a generic bound workspace document while keeping the composer available", async () => {
    const current = launch();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    vi.mocked(appsApi.readAppChatWorkspaceDocument).mockResolvedValueOnce({
      result_version: 1,
      state: "current",
      document_id: "profile",
      document_binding_id: "profile.current",
      record: {
        record_version: 1,
        record_kind: "document",
        owner_id: current.session.owner_id,
        actor_id: current.session.actor_id,
        app_id: current.session.app_id,
        publisher_id: current.session.publisher_id,
        installation_id: current.session.installation_id,
        package_digest: current.session.package_digest,
        lifecycle_generation: current.session.lifecycle_generation,
        grant_id: current.session.grant_id,
        grant_revision: current.session.grant_revision,
        revocation_generation: current.session.revocation_generation,
        document_id: "profile",
        document_binding_id: "profile.current",
        role: "source_document",
        retention_class: "durable_owner_data",
        media_type: "text/markdown",
        revision: 2,
        revision_id: "00000000-0000-4000-8000-000000000101",
        prior_revision_id: null,
        operation_id: "00000000-0000-4000-8000-000000000102",
        idempotency_key: "profile-write-test-0001",
        content_digest: `sha256:${"d".repeat(64)}`,
        content_size_bytes: 9,
        content: "# Profile",
        created_at: "2026-08-26T12:00:00.000Z",
        created_by: {} as never,
        updated_at: "2026-08-26T12:01:00.000Z",
        updated_by: {} as never,
      },
    });
    vi.mocked(appsApi.writeAppChatWorkspaceDocument).mockResolvedValueOnce({
      result_version: 1,
      state: "current",
      document_id: "profile",
      document_binding_id: "profile.current",
      record: {
        revision: 3,
        media_type: "text/markdown",
        content: "# Updated profile",
      } as appsApi.AppDocumentRecord,
    });
    const user = userEvent.setup();

    render(<AppChatWorkspace appKey="test-builder" appName="Test Builder" launch={current} onSessionClosed={() => undefined} />);

    await screen.findByText("Conversation transcript");
    await user.click(screen.getByRole("button", { name: "Profile" }));
    const editor = await screen.findByRole("textbox", { name: "Profile content" });
    expect(editor).toHaveValue("# Profile");
    expect(screen.getByText("Revision 2")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Message your BrainDrive...")).toBeInTheDocument();

    await user.clear(editor);
    await user.type(editor, "# Updated profile");
    await user.click(screen.getByRole("button", { name: "Save Profile" }));

    await waitFor(() => expect(appsApi.writeAppChatWorkspaceDocument).toHaveBeenCalledWith("test-builder", current.session.session_id, "profile", {
      expectedRevision: 2,
      content: "# Updated profile",
      mediaType: "text/markdown",
    }));
    expect(await screen.findByText("Revision 3")).toBeInTheDocument();
  });

  it("shows stale revision errors and keeps the owner draft available for review", async () => {
    const current = launch();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    vi.mocked(appsApi.readAppChatWorkspaceDocument).mockResolvedValueOnce({
      result_version: 1,
      state: "current",
      document_id: "profile",
      document_binding_id: "profile.current",
      record: {
        revision: 2,
        media_type: "text/markdown",
        content: "# Profile",
      } as appsApi.AppDocumentRecord,
    });
    vi.mocked(appsApi.writeAppChatWorkspaceDocument).mockRejectedValueOnce(new appsApi.AppDocumentError(
      "The saved version changed. Refresh and review before saving again.",
      409,
      "conflict",
      {
        state_version: 1,
        state: "conflict",
        safe_message: "The saved version changed. Refresh and review before saving again.",
        retryable: false,
        refresh_required: true,
        current_revision: 4,
      },
    ));
    const user = userEvent.setup();

    render(<AppChatWorkspace appKey="test-builder" appName="Test Builder" launch={current} onSessionClosed={() => undefined} />);

    await screen.findByText("Conversation transcript");
    await user.click(screen.getByRole("button", { name: "Profile" }));
    const editor = await screen.findByRole("textbox", { name: "Profile content" });
    await user.clear(editor);
    await user.type(editor, "# Owner draft");
    await user.click(screen.getByRole("button", { name: "Save Profile" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The saved version changed");
    expect(screen.getByRole("alert")).toHaveTextContent("current revision is 4");
    expect(screen.getByRole("textbox", { name: "Profile content" })).toHaveValue("# Owner draft");
    expect(screen.getByPlaceholderText("Message your BrainDrive...")).toBeInTheDocument();
  });

  it("shows unavailable binding errors at document level", async () => {
    const current = launch();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    vi.mocked(appsApi.readAppChatWorkspaceDocument).mockRejectedValueOnce(new appsApi.AppDocumentError(
      "This workspace document binding is unavailable.",
      403,
      "denied",
      {
        state_version: 1,
        state: "unavailable",
        safe_message: "This workspace document binding is unavailable.",
        retryable: false,
        refresh_required: false,
        current_revision: null,
      },
    ));
    const user = userEvent.setup();

    render(<AppChatWorkspace appKey="test-builder" appName="Test Builder" launch={current} onSessionClosed={() => undefined} />);

    await screen.findByText("Conversation transcript");
    await user.click(screen.getByRole("button", { name: "Profile" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This workspace document binding is unavailable.");
    expect(screen.getByPlaceholderText("Message your BrainDrive...")).toBeInTheDocument();
  });

  it("supports arrow-key navigation within one workspace nav model", async () => {
    const current = launch();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    const user = userEvent.setup();

    render(<AppChatWorkspace appKey="test-builder" appName="Test Builder" launch={current} onSessionClosed={() => undefined} />);

    const navigation = screen.getByRole("navigation", { name: "Test Builder workspace navigation" });
    const conversation = within(navigation).getByRole("button", { name: "Conversation" });
    conversation.focus();
    await user.keyboard("{ArrowDown}");
    expect(within(navigation).getByRole("button", { name: "Profile" })).toHaveFocus();
  });

  it("closes only the active app-chat session and reports session close to the parent", async () => {
    const current = launch();
    const onSessionClosed = vi.fn();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    const user = userEvent.setup();

    render(<AppChatWorkspace appKey="test-builder" appName="Test Builder" launch={current} onSessionClosed={onSessionClosed} />);

    await user.click(await screen.findByRole("button", { name: "Back to Apps" }));
    expect(appsApi.closeAppSession).toHaveBeenCalledWith("test-builder", current.session.session_id);
    expect(onSessionClosed).toHaveBeenCalledTimes(1);
  });

  it("exposes the shell profile menu at the bottom of the app sidebar", async () => {
    const current = launch();
    const onOpenSettings = vi.fn();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    const user = userEvent.setup();

    render(
      <AppChatWorkspace
        appKey="test-builder"
        appName="Test Builder"
        launch={current}
        onSessionClosed={() => undefined}
        onOpenSettings={onOpenSettings}
        tier="local"
      />
    );

    await screen.findByText("Conversation transcript");
    expect(await screen.findByText("demo")).toBeInTheDocument();
    expect(screen.getByText("BrainDrive Local")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open profile menu" }));

    expect(screen.getByRole("button", { name: "BrainDrive Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BrainDrive Community" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "BrainDrive Settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("builds app-chat message metadata without bridge credentials, resource HTML, host paths, or raw grants", () => {
    const current = launch();
    const metadata = buildAppChatMessageMetadata(current);
    const serialized = JSON.stringify(metadata);

    expect(metadata).toMatchObject({
      client: "web",
      app_chat: {
        app_id: "ai.braindrive.test-builder",
        session_id: current.session.session_id,
        workspace_id: "test.chat",
      },
    });
    expect(serialized).not.toContain(current.session.grant_id);
    expect(serialized).not.toContain("payload/resources/instructions.md");
    expect(serialized).not.toContain("bridge_token");
    expect(serialized).not.toContain("server_id");
    expect(serialized).not.toContain("/home/");
  });
});
