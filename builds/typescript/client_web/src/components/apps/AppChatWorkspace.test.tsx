import type { ReactNode } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import * as appsApi from "@/api/apps-adapter";
import AppChatWorkspace, { buildAppChatMessageMetadata, extractPreparedAppChatExport } from "./AppChatWorkspace";

const { chatPanelProps } = vi.hoisted(() => ({
  chatPanelProps: [] as Array<{
    activeConversationId?: string | null;
    draftKey?: string | null;
    onConversationComplete?: (conversationId: string) => void;
    onStreamEvent?: (event: unknown) => void | Promise<void>;
    queuedMessage?: { id: string; content: string } | null;
  }>,
}));

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
    appendConversationHostMessage: vi.fn(async () => ({
      conversation_id: "conversation-resume-builder",
      message_id: "00000000-0000-4000-8000-000000000098",
      role: "assistant",
      content: "BrainDrive host update: Owner pressed Create resume. Your Resume created.",
      timestamp: "2026-08-26T12:00:00.000Z",
    })),
    closeAppSession: vi.fn(async () => undefined),
    executeAppChatWorkspaceAction: vi.fn(),
    finalizeAppExport: vi.fn(async (appKey: string, input: { safe_destination_label: string; outcome: string }) => ({
      receipt_revision_id: "00000000-0000-4000-8000-000000000099",
      safe_destination_label: input.safe_destination_label,
      outcome: input.outcome,
      appKey,
    })),
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
    activeConversationId?: string | null;
    draftKey?: string | null;
    messageMetadata?: Record<string, unknown>;
    onConversationComplete?: (conversationId: string) => void;
    onStreamEvent?: (event: unknown) => void | Promise<void>;
    queuedMessage?: { id: string; content: string } | null;
    statusNotice?: { message: string } | null;
  }) => {
    chatPanelProps.push(props);
    return (
      <section aria-label="Native chat panel">
        <div data-testid="chat-metadata">{JSON.stringify(props.messageMetadata)}</div>
        {props.statusNotice ? <div data-testid="chat-status-notice">{props.statusNotice.message}</div> : null}
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
    );
  },
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

function withProfileDocumentPresentation(current: appsApi.AppChatWorkspaceLaunch): appsApi.AppChatWorkspaceLaunch {
  return {
    ...current,
    workspace: {
      ...current.workspace,
      documents: current.workspace.documents.map((document) => document.document_id === "profile" ? {
        ...document,
        presentation: {
          presentation_version: 1,
          renderer: "markdown_document",
          chrome: "document",
          title: "Your Resume Profile",
          subtitle: "Resume Builder",
          header_actions: [
            { type: "back_to_chat", label: "Back to chat" },
            { type: "edit_document", label: "Edit Profile" },
          ],
        },
      } : document),
    },
  };
}

function withDirectResumeActions(current: appsApi.AppChatWorkspaceLaunch): appsApi.AppChatWorkspaceLaunch {
  const resumeDocument: appsApi.AppWorkspaceDocumentDescriptor = {
    document_version: 1,
    document_id: "resume",
    role: "derived_document",
    title: "Resume",
    description: "Generated resume.",
    editable: false,
    default_visibility: "primary",
    model_access: "action_result",
    resource_id: null,
    data_binding_id: "resume.current",
    presentation: {
      presentation_version: 1,
      renderer: "paper_document",
      chrome: "document",
      title: "Your Resume",
      subtitle: "Resume Builder",
      header_actions: [
        { type: "back_to_chat", label: "Back to chat" },
        { type: "app_action", action_id: "resume.export.pdf.request", label: "Export PDF", delivery: "direct_action", action_input: { format: "pdf", destination_intent: "new_download" } },
      ],
    },
  };
  const documents = current.workspace.documents.some((document) => document.document_id === "resume")
    ? current.workspace.documents
    : [...current.workspace.documents, resumeDocument];
  return {
    ...current,
    workspace: {
      ...current.workspace,
      documents: documents.map((document) => document.document_id === "profile" ? {
        ...document,
        presentation: {
          presentation_version: 1,
          renderer: "markdown_document",
          chrome: "document",
          title: "Your Resume Profile",
          subtitle: "Resume Builder",
          header_actions: [
            { type: "back_to_chat", label: "Back to chat" },
            { type: "app_action", action_id: "resume.create", label: "Create resume", delivery: "direct_action" },
            { type: "edit_document", label: "Edit Profile" },
          ],
        },
      } : document),
      actions: [
        ...current.workspace.actions,
        {
          action_version: 1,
          action_id: "resume.create",
          kind: "render",
          title: "Create Resume",
          description: "Create the current general Resume.",
          input_schema_id: "resume.create.input",
          result_schema_id: "resume.create.result",
          confirmation: "owner_confirmation",
          idempotency_policy: "required",
          model_exposure: "available",
        },
        {
          action_version: 1,
          action_id: "resume.export.pdf.request",
          kind: "export",
          title: "Request PDF Export",
          description: "Request a PDF export.",
          input_schema_id: "resume.export.pdf.input",
          result_schema_id: "resume.export.pdf.result",
          confirmation: "trusted_owner_confirmation",
          idempotency_policy: "required",
          model_exposure: "available",
        },
      ],
    },
  };
}

function withEditableAdvancedResource(current: appsApi.AppChatWorkspaceLaunch): appsApi.AppChatWorkspaceLaunch {
  return {
    ...current,
    workspace: {
      ...current.workspace,
      documents: current.workspace.documents.map((document) => document.document_id === "instructions" ? {
        ...document,
        editable: true,
        model_access: "read_reference",
        data_binding_id: "instructions.owner",
        presentation: {
          presentation_version: 1,
          renderer: "markdown_document",
          chrome: "document",
          title: "Agent Instructions.md",
          subtitle: "Owner editable app instructions",
          header_actions: [
            { type: "back_to_chat", label: "Back to chat" },
            { type: "edit_document", label: "Edit" },
          ],
        },
      } : document),
      resources: current.workspace.resources.map((resource) => resource.resource_id === "instructions" ? {
        ...resource,
        owner_editable: true,
      } : resource),
    },
  };
}

describe("AppChatWorkspace", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    chatPanelProps.length = 0;
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.mocked(appsApi.executeAppChatWorkspaceAction).mockResolvedValue({
      action_id: "resume.create",
      operation_id: "00000000-0000-4000-8000-000000000501",
      idempotency_key: "app-chat-action-00000000-0000-4000-8000-000000000501",
      result: { result_version: 1, status: "completed" },
    });
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

  it("persists the completed native app-chat conversation across app session relaunches", async () => {
    const current = launch();
    const relaunched = launch({
      session: {
        ...current.session,
        session_id: "00000000-0000-4000-8000-000000000301",
        view_id: "00000000-0000-4000-8000-000000000302",
        operation_id: "00000000-0000-4000-8000-000000000303",
      },
      resumed: true,
    });
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);

    const rendered = render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={current} onSessionClosed={() => undefined} />);

    await screen.findByText("Conversation transcript");
    const initialChat = chatPanelProps.at(-1);
    expect(initialChat?.activeConversationId).toBeNull();
    expect(initialChat?.draftKey).toContain("resume-builder");
    expect(initialChat?.draftKey).not.toContain(current.session.view_id);

    act(() => {
      initialChat?.onConversationComplete?.("conversation-resume-builder");
    });

    expect(chatPanelProps.at(-1)?.activeConversationId).toBe("conversation-resume-builder");

    rendered.unmount();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(relaunched.session);
    render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={relaunched} onSessionClosed={() => undefined} />);

    await screen.findByText("Conversation transcript");
    expect(chatPanelProps.at(-1)?.activeConversationId).toBe("conversation-resume-builder");
    expect(chatPanelProps.at(-1)?.draftKey).not.toContain(relaunched.session.view_id);
    expect(window.localStorage.getItem(initialChat?.draftKey ?? "")).toBe("conversation-resume-builder");
    expect(window.sessionStorage.getItem(initialChat?.draftKey ?? "")).toBeNull();
  });

  it("restores an app-chat conversation pointer from durable browser storage in a new tab or relaunch", async () => {
    const current = launch();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);

    const initial = render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={current} onSessionClosed={() => undefined} />);
    await screen.findByText("Conversation transcript");
    const storageKey = chatPanelProps.at(-1)?.draftKey;
    expect(storageKey).toContain("resume-builder");
    initial.unmount();

    window.sessionStorage.clear();
    window.localStorage.setItem(storageKey!, "conversation-durable");

    render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={current} onSessionClosed={() => undefined} />);
    await screen.findByText("Conversation transcript");

    expect(chatPanelProps.at(-1)?.activeConversationId).toBe("conversation-durable");
  });

  it("does not reuse a stored app-chat conversation after reinstall changes installation identity", async () => {
    const current = launch();
    const reinstalled = launch({
      session: {
        ...current.session,
        session_id: "00000000-0000-4000-8000-000000000401",
        view_id: "00000000-0000-4000-8000-000000000402",
        operation_id: "00000000-0000-4000-8000-000000000403",
        installation_id: "00000000-0000-4000-8000-000000000404",
      },
    });
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);

    const rendered = render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={current} onSessionClosed={() => undefined} />);
    await screen.findByText("Conversation transcript");
    act(() => {
      chatPanelProps.at(-1)?.onConversationComplete?.("conversation-before-reinstall");
    });

    rendered.unmount();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(reinstalled.session);
    render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={reinstalled} onSessionClosed={() => undefined} />);

    await screen.findByText("Conversation transcript");
    expect(chatPanelProps.at(-1)?.activeConversationId).toBeNull();
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

  it("opens workspace navigation in a mobile drawer and closes it after selection", async () => {
    const current = launch();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    const user = userEvent.setup();

    render(<AppChatWorkspace appKey="test-builder" appName="Test Builder" launch={current} onSessionClosed={() => undefined} />);

    await screen.findByText("Conversation transcript");
    expect(screen.queryByRole("dialog", { name: "Test Builder workspace navigation" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open workspace navigation menu" }));
    const drawer = screen.getByRole("dialog", { name: "Test Builder workspace navigation" });
    expect(within(drawer).getByRole("button", { name: "Close workspace navigation" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Profile" })).toBeInTheDocument();

    await user.click(within(drawer).getByRole("button", { name: "Profile" }));
    expect(screen.queryByRole("dialog", { name: "Test Builder workspace navigation" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Profile" })).toHaveFocus();
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
    expect(screen.getByText("Saved Profile.")).toBeInTheDocument();
  });

  it("confirms document-chrome saves, returns to preview, and renders markdown emphasis", async () => {
    const current = withProfileDocumentPresentation(launch());
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    vi.mocked(appsApi.readAppChatWorkspaceDocument).mockResolvedValueOnce({
      result_version: 1,
      state: "current",
      document_id: "profile",
      document_binding_id: "profile.current",
      record: {
        revision: 2,
        media_type: "text/markdown",
        content: "## **Experience**\n- Reduced launch slips by 38%.",
      } as appsApi.AppDocumentRecord,
    });
    vi.mocked(appsApi.writeAppChatWorkspaceDocument).mockResolvedValueOnce({
      result_version: 1,
      state: "current",
      document_id: "profile",
      document_binding_id: "profile.current",
      record: {
        revision: 3,
        media_type: "text/markdown",
        content: "## **Experience**\n- Improved review cycle time.",
      } as appsApi.AppDocumentRecord,
    });
    const user = userEvent.setup();

    render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={current} onSessionClosed={() => undefined} />);

    await screen.findByText("Conversation transcript");
    await user.click(screen.getByRole("button", { name: "Profile" }));

    expect(await screen.findByRole("heading", { name: "Experience" })).toBeInTheDocument();
    expect(screen.queryByText("**Experience**")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Profile content" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit Profile" }));
    const editor = await screen.findByRole("textbox", { name: "Profile content" });
    await user.clear(editor);
    await user.type(editor, "## **Experience**\n- Improved review cycle time.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(appsApi.writeAppChatWorkspaceDocument).toHaveBeenCalledWith("resume-builder", current.session.session_id, "profile", {
      expectedRevision: 2,
      content: "## **Experience**\n- Improved review cycle time.",
      mediaType: "text/markdown",
    }));
    expect(screen.getByText("Saved Profile.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Profile content" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Experience" })).toBeInTheDocument();
    expect(screen.queryByText("**Experience**")).not.toBeInTheDocument();
  });

  it("executes Create resume directly from the header action without queueing a chat prompt", async () => {
    const current = withDirectResumeActions(launch());
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    const user = userEvent.setup();

    render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={current} onSessionClosed={() => undefined} />);

    await screen.findByText("Conversation transcript");
    await user.click(screen.getByRole("button", { name: "Profile" }));
    await user.click(await screen.findByRole("button", { name: "Create resume" }));

    await waitFor(() => expect(appsApi.executeAppChatWorkspaceAction).toHaveBeenCalledWith("resume-builder", current.session.session_id, "resume.create", {
      actionInput: {},
      ownerConfirmed: true,
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Create resume completed.");
    expect(chatPanelProps.some((props) => props.queuedMessage?.content.includes("Please create"))).toBe(false);
  });

  it("records a durable host message after direct Create resume completes", async () => {
    const current = withDirectResumeActions(launch());
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    vi.mocked(appsApi.executeAppChatWorkspaceAction).mockResolvedValueOnce({
      action_id: "resume.create",
      operation_id: "00000000-0000-4000-8000-000000000701",
      idempotency_key: "app-chat-action-00000000-0000-4000-8000-000000000701",
      result: {
        definition: {
          metadata: {
            revision: 2,
            revision_id: "00000000-0000-4000-8000-000000000702",
          },
        },
      },
    });
    const user = userEvent.setup();

    render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={current} onSessionClosed={() => undefined} />);

    await screen.findByText("Conversation transcript");
    act(() => {
      chatPanelProps.at(-1)?.onConversationComplete?.("conversation-resume-builder");
    });
    await user.click(screen.getByRole("button", { name: "Profile" }));
    await user.click(await screen.findByRole("button", { name: "Create resume" }));

    await waitFor(() => expect(appsApi.appendConversationHostMessage).toHaveBeenCalledWith(
      "conversation-resume-builder",
      "Owner pressed Create resume. Your Resume revision 2 created.",
    ));
  });

  it("creates a durable host-message conversation for direct Create resume before any chat turn", async () => {
    const current = withDirectResumeActions(launch());
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    vi.mocked(appsApi.executeAppChatWorkspaceAction).mockResolvedValueOnce({
      action_id: "resume.create",
      operation_id: "00000000-0000-4000-8000-000000000721",
      idempotency_key: "app-chat-action-00000000-0000-4000-8000-000000000721",
      result: {
        definition: {
          metadata: {
            revision: 3,
            revision_id: "00000000-0000-4000-8000-000000000722",
          },
        },
      },
    });
    const user = userEvent.setup();

    render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={current} onSessionClosed={() => undefined} />);

    await screen.findByText("Conversation transcript");
    await user.click(screen.getByRole("button", { name: "Profile" }));
    await user.click(await screen.findByRole("button", { name: "Create resume" }));

    await waitFor(() => expect(appsApi.appendConversationHostMessage).toHaveBeenCalledWith(
      null,
      "Owner pressed Create resume. Your Resume revision 3 created.",
    ));
    await waitFor(() => expect(chatPanelProps.at(-1)?.activeConversationId).toBe("conversation-resume-builder"));
  });

  it("executes Export PDF directly from the header action and downloads without queueing a chat prompt", async () => {
    const current = withDirectResumeActions(launch());
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    vi.mocked(appsApi.executeAppChatWorkspaceAction).mockResolvedValueOnce({
      action_id: "resume.export.pdf.request",
      operation_id: "00000000-0000-4000-8000-000000000601",
      idempotency_key: "app-chat-action-00000000-0000-4000-8000-000000000601",
      result: {
        result_version: 1,
        status: "prepared",
        artifact: {
          artifact_revision_id: "00000000-0000-4000-8000-000000000602",
          content_digest: `sha256:${"e".repeat(64)}`,
          content_size_bytes: 8,
          media_type: "application/pdf",
          owner_visible_label: "resume.pdf",
        },
        filename: "resume.pdf",
        media_type: "application/pdf",
        bytes_base64: btoa("%PDF-1.4"),
        safe_destination_label: "resume.pdf",
        replayed: false,
      },
    });
    delete window.__TAURI_INTERNALS__;
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:direct-resume-export");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const user = userEvent.setup();

    try {
      render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={current} onSessionClosed={() => undefined} />);

      await screen.findByText("Conversation transcript");
      await user.click(screen.getByRole("button", { name: "Resume" }));
      await user.click(await screen.findByRole("button", { name: "Export PDF" }));

      await waitFor(() => expect(appsApi.executeAppChatWorkspaceAction).toHaveBeenCalledWith("resume-builder", current.session.session_id, "resume.export.pdf.request", {
        actionInput: { format: "pdf", destination_intent: "new_download" },
        ownerConfirmed: true,
      }));
      await waitFor(() => {
        expect(anchorClick).toHaveBeenCalledTimes(1);
        expect(appsApi.finalizeAppExport).toHaveBeenCalledWith("resume-builder", {
          artifact_revision_id: "00000000-0000-4000-8000-000000000602",
          artifact_digest: `sha256:${"e".repeat(64)}`,
          safe_destination_label: "resume.pdf",
          outcome: "completed",
        });
      });
      expect(await screen.findByText("Export PDF completed.")).toBeInTheDocument();
      expect(chatPanelProps.some((props) => props.queuedMessage?.content.includes("Please export"))).toBe(false);
    } finally {
      create.mockRestore();
      revoke.mockRestore();
      anchorClick.mockRestore();
    }
  });

  it("records a durable host message after direct Export PDF completes", async () => {
    const current = withDirectResumeActions(launch());
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    vi.mocked(appsApi.executeAppChatWorkspaceAction).mockResolvedValueOnce({
      action_id: "resume.export.pdf.request",
      operation_id: "00000000-0000-4000-8000-000000000711",
      idempotency_key: "app-chat-action-00000000-0000-4000-8000-000000000711",
      result: {
        result_version: 1,
        status: "prepared",
        artifact: {
          artifact_revision_id: "00000000-0000-4000-8000-000000000712",
          content_digest: `sha256:${"7".repeat(64)}`,
          content_size_bytes: 8,
          media_type: "application/pdf",
          owner_visible_label: "resume.pdf",
        },
        filename: "resume.pdf",
        media_type: "application/pdf",
        bytes_base64: btoa("%PDF-1.4"),
        safe_destination_label: "resume.pdf",
        replayed: false,
      },
    });
    delete window.__TAURI_INTERNALS__;
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:direct-resume-export");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const user = userEvent.setup();

    try {
      render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={current} onSessionClosed={() => undefined} />);

      await screen.findByText("Conversation transcript");
      act(() => {
        chatPanelProps.at(-1)?.onConversationComplete?.("conversation-resume-builder");
      });
      await user.click(screen.getByRole("button", { name: "Resume" }));
      await user.click(await screen.findByRole("button", { name: "Export PDF" }));

      await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(appsApi.appendConversationHostMessage).toHaveBeenCalledWith(
        "conversation-resume-builder",
        "Owner pressed Export PDF. Downloaded resume.pdf through the browser.",
      ));
    } finally {
      create.mockRestore();
      revoke.mockRestore();
      anchorClick.mockRestore();
    }
  });

  it("clears a stale failed export banner after a successful direct header export", async () => {
    const current = withDirectResumeActions(launch());
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    vi.mocked(appsApi.executeAppChatWorkspaceAction).mockResolvedValueOnce({
      action_id: "resume.export.pdf.request",
      operation_id: "00000000-0000-4000-8000-000000000611",
      idempotency_key: "app-chat-action-00000000-0000-4000-8000-000000000611",
      result: {
        result_version: 1,
        status: "prepared",
        artifact: {
          artifact_revision_id: "00000000-0000-4000-8000-000000000612",
          content_digest: `sha256:${"f".repeat(64)}`,
          content_size_bytes: 8,
          media_type: "application/pdf",
          owner_visible_label: "resume.pdf",
        },
        filename: "resume.pdf",
        media_type: "application/pdf",
        bytes_base64: btoa("%PDF-1.4"),
        safe_destination_label: "resume.pdf",
        replayed: false,
      },
    });
    delete window.__TAURI_INTERNALS__;
    const create = vi.spyOn(URL, "createObjectURL")
      .mockImplementationOnce(() => { throw new Error("download_blocked"); })
      .mockImplementation(() => "blob:direct-resume-export");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const user = userEvent.setup();

    try {
      render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={current} onSessionClosed={() => undefined} />);

      await screen.findByText("Conversation transcript");
      const onStreamEvent = chatPanelProps.at(-1)?.onStreamEvent;
      expect(onStreamEvent).toBeTypeOf("function");
      await user.click(screen.getByRole("button", { name: "Resume" }));
      await act(async () => {
        await onStreamEvent?.({
          type: "tool-result",
          id: "tool-1",
          status: "ok",
          output: {
            action_id: "resume.export.pdf.request",
            operation_id: "00000000-0000-4000-8000-000000000621",
            idempotency_key: "app-chat-action-00000000-0000-4000-8000-000000000621",
            result: {
              result_version: 1,
              status: "prepared",
              artifact: {
                artifact_revision_id: "00000000-0000-4000-8000-000000000622",
                content_digest: `sha256:${"d".repeat(64)}`,
                content_size_bytes: 8,
                media_type: "application/pdf",
                owner_visible_label: "resume.pdf",
              },
              filename: "resume.pdf",
              media_type: "application/pdf",
              bytes_base64: btoa("%PDF-1.4"),
              safe_destination_label: "resume.pdf",
              replayed: false,
            },
          },
        });
      });
      expect(await screen.findByText("BrainDrive could not download the export.")).toBeInTheDocument();

      await user.click(await screen.findByRole("button", { name: "Export PDF" }));

      await waitFor(() => {
        expect(anchorClick).toHaveBeenCalledTimes(1);
        expect(appsApi.finalizeAppExport).toHaveBeenCalledWith("resume-builder", {
          artifact_revision_id: "00000000-0000-4000-8000-000000000612",
          artifact_digest: `sha256:${"f".repeat(64)}`,
          safe_destination_label: "resume.pdf",
          outcome: "completed",
        });
      });
      expect(await screen.findByText("Downloaded resume.pdf.")).toBeInTheDocument();
      expect(await screen.findByText("Export PDF completed.")).toBeInTheDocument();
      expect(screen.queryByText("BrainDrive could not download the export.")).not.toBeInTheDocument();
    } finally {
      create.mockRestore();
      revoke.mockRestore();
      anchorClick.mockRestore();
    }
  });

  it("does not mark a saved direct export as failed when receipt recording fails", async () => {
    const current = withDirectResumeActions(launch());
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    vi.mocked(appsApi.executeAppChatWorkspaceAction).mockResolvedValueOnce({
      action_id: "resume.export.pdf.request",
      operation_id: "00000000-0000-4000-8000-000000000631",
      idempotency_key: "app-chat-action-00000000-0000-4000-8000-000000000631",
      result: {
        result_version: 1,
        status: "prepared",
        artifact: {
          artifact_revision_id: "00000000-0000-4000-8000-000000000632",
          content_digest: `sha256:${"9".repeat(64)}`,
          content_size_bytes: 8,
          media_type: "application/pdf",
          owner_visible_label: "resume.pdf",
        },
        filename: "resume.pdf",
        media_type: "application/pdf",
        bytes_base64: btoa("%PDF-1.4"),
        safe_destination_label: "resume.pdf",
        replayed: false,
      },
    });
    vi.mocked(appsApi.finalizeAppExport).mockRejectedValueOnce(new Error("receipt_failed"));
    delete window.__TAURI_INTERNALS__;
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:direct-resume-export");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const user = userEvent.setup();

    try {
      render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={current} onSessionClosed={() => undefined} />);

      await screen.findByText("Conversation transcript");
      await user.click(screen.getByRole("button", { name: "Resume" }));
      await user.click(await screen.findByRole("button", { name: "Export PDF" }));

      await waitFor(() => {
        expect(anchorClick).toHaveBeenCalledTimes(1);
        expect(appsApi.finalizeAppExport).toHaveBeenCalledTimes(1);
      });
      expect(await screen.findByText("Downloaded resume.pdf.")).toBeInTheDocument();
      expect(await screen.findByText("Export PDF completed.")).toBeInTheDocument();
      expect(screen.queryByText("BrainDrive could not download the export.")).not.toBeInTheDocument();
      expect(screen.queryByText("Export PDF could not complete safely.")).not.toBeInTheDocument();
    } finally {
      create.mockRestore();
      revoke.mockRestore();
      anchorClick.mockRestore();
    }
  });

  it("edits owner overrides for advanced resource-backed documents without showing a package pane", async () => {
    const current = withEditableAdvancedResource(launch());
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    vi.mocked(appsApi.readAppChatWorkspaceDocument).mockResolvedValueOnce({
      result_version: 1,
      state: "current",
      document_id: "instructions",
      document_binding_id: "instructions.owner",
      record: {
        revision: 1,
        media_type: "text/markdown",
        content: "# Agent Instructions\nUse the package default.",
      } as appsApi.AppDocumentRecord,
    });
    vi.mocked(appsApi.writeAppChatWorkspaceDocument).mockResolvedValueOnce({
      result_version: 1,
      state: "current",
      document_id: "instructions",
      document_binding_id: "instructions.owner",
      record: {
        revision: 2,
        media_type: "text/markdown",
        content: "# Agent Instructions\nUse owner edits.",
      } as appsApi.AppDocumentRecord,
    });
    const user = userEvent.setup();

    render(<AppChatWorkspace appKey="test-builder" appName="Test Builder" launch={current} onSessionClosed={() => undefined} />);

    await screen.findByText("Conversation transcript");
    await user.click(screen.getByRole("button", { name: "Show advanced" }));
    await user.click(screen.getByRole("button", { name: "Agent Instructions" }));

    expect(await screen.findByRole("heading", { name: "Agent Instructions.md" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Package resource" })).not.toBeInTheDocument();
    expect(appsApi.readAppChatWorkspaceResource).not.toHaveBeenCalledWith("test-builder", current.session.session_id, "instructions");
    expect(screen.queryByRole("textbox", { name: "Agent Instructions content" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editor = await screen.findByRole("textbox", { name: "Agent Instructions content" });
    await user.clear(editor);
    await user.type(editor, "# Agent Instructions\nUse owner edits.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(appsApi.writeAppChatWorkspaceDocument).toHaveBeenCalledWith("test-builder", current.session.session_id, "instructions", {
      expectedRevision: 1,
      content: "# Agent Instructions\nUse owner edits.",
      mediaType: "text/markdown",
    }));
    expect(screen.getByText("Saved Agent Instructions.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Agent Instructions content" })).not.toBeInTheDocument();
  });

  it("resets owner-edited agent instructions to the verified package default", async () => {
    const current = withEditableAdvancedResource(launch());
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    vi.mocked(appsApi.readAppChatWorkspaceDocument).mockResolvedValueOnce({
      result_version: 1,
      state: "current",
      document_id: "instructions",
      document_binding_id: "instructions.owner",
      record: {
        revision: 2,
        media_type: "text/markdown",
        content: "# Agent Instructions\nUse owner edits.",
      } as appsApi.AppDocumentRecord,
    });
    vi.mocked(appsApi.readAppChatWorkspaceResource).mockResolvedValueOnce({
      result_version: 1,
      resource_id: "instructions",
      title: "Agent Instructions",
      description: "Read-only app package resource.",
      role: "agent_instructions",
      media_type: "text/markdown",
      content_digest: `sha256:${"c".repeat(64)}`,
      owner_editable: true,
      prompt_inclusion: "workspace_start",
      content: "# Agent Instructions\nUse the package default.",
    });
    vi.mocked(appsApi.writeAppChatWorkspaceDocument).mockResolvedValueOnce({
      result_version: 1,
      state: "current",
      document_id: "instructions",
      document_binding_id: "instructions.owner",
      record: {
        revision: 3,
        media_type: "text/markdown",
        content: "# Agent Instructions\nUse the package default.",
      } as appsApi.AppDocumentRecord,
    });
    const user = userEvent.setup();

    render(<AppChatWorkspace appKey="test-builder" appName="Test Builder" launch={current} onSessionClosed={() => undefined} />);

    await screen.findByText("Conversation transcript");
    await user.click(screen.getByRole("button", { name: "Show advanced" }));
    await user.click(screen.getByRole("button", { name: "Agent Instructions" }));
    expect(await screen.findByText("Use owner edits.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset to package default" }));

    await waitFor(() => expect(appsApi.readAppChatWorkspaceResource).toHaveBeenCalledWith("test-builder", current.session.session_id, "instructions"));
    await waitFor(() => expect(appsApi.writeAppChatWorkspaceDocument).toHaveBeenCalledWith("test-builder", current.session.session_id, "instructions", {
      expectedRevision: 2,
      content: "# Agent Instructions\nUse the package default.",
      mediaType: "text/markdown",
    }));
    expect(screen.getByText("Reset Agent Instructions to package default.")).toBeInTheDocument();
    expect(await screen.findByText("Use the package default.")).toBeInTheDocument();
  });

  it("keeps app-chat workspace sessions alive while the editor is open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const current = launch();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);

    render(<AppChatWorkspace appKey="test-builder" appName="Test Builder" launch={current} onSessionClosed={() => undefined} />);

    await screen.findByText("Conversation transcript");
    expect(appsApi.readAppChatWorkspaceSession).toHaveBeenCalledWith("test-builder", current.session.session_id);

    await vi.advanceTimersByTimeAsync(2 * 60_000);

    expect(appsApi.readAppChatWorkspaceSession).toHaveBeenCalledTimes(2);
    expect(appsApi.readAppChatWorkspaceSession).toHaveBeenLastCalledWith("test-builder", current.session.session_id);
  });

  it("recovers an expired app-chat document session and retries save without losing the draft", async () => {
    const current = launch();
    const renewed = launch({
      session: {
        ...current.session,
        session_id: "00000000-0000-4000-8000-000000000201",
        session_generation: 1,
      },
    });
    const onRenewSession = vi.fn(async () => renewed);
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
    vi.mocked(appsApi.writeAppChatWorkspaceDocument)
      .mockRejectedValueOnce(new appsApi.AppDocumentError(
        "This workspace document binding is unavailable.",
        410,
        "session_closed",
        {
          state_version: 1,
          state: "unavailable",
          safe_message: "This workspace document binding is unavailable.",
          retryable: false,
          refresh_required: true,
          current_revision: null,
        },
      ))
      .mockResolvedValueOnce({
        result_version: 1,
        state: "current",
        document_id: "profile",
        document_binding_id: "profile.current",
        record: {
          revision: 3,
          media_type: "text/markdown",
          content: "# Owner draft",
        } as appsApi.AppDocumentRecord,
      });
    const user = userEvent.setup();

    render(<AppChatWorkspace appKey="test-builder" appName="Test Builder" launch={current} onSessionClosed={() => undefined} onRenewSession={onRenewSession} />);

    await screen.findByText("Conversation transcript");
    await user.click(screen.getByRole("button", { name: "Profile" }));
    const editor = await screen.findByRole("textbox", { name: "Profile content" });
    await user.clear(editor);
    await user.type(editor, "# Owner draft");
    await user.click(screen.getByRole("button", { name: "Save Profile" }));

    await waitFor(() => expect(appsApi.writeAppChatWorkspaceDocument).toHaveBeenCalledTimes(2));
    expect(onRenewSession).toHaveBeenCalledWith(current);
    expect(appsApi.writeAppChatWorkspaceDocument).toHaveBeenNthCalledWith(2, "test-builder", renewed.session.session_id, "profile", {
      expectedRevision: 2,
      content: "# Owner draft",
      mediaType: "text/markdown",
    });
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

  it("treats stale app-chat session close failures as best-effort cleanup", async () => {
    const current = launch();
    const onSessionClosed = vi.fn();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    vi.mocked(appsApi.closeAppSession).mockRejectedValueOnce(new Error("Unable to close app session"));
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

  it("downloads and finalizes prepared app-chat exports from stream tool results", async () => {
    const current = launch();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);
    delete window.__TAURI_INTERNALS__;
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:resume-export");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    try {
      render(
        <AppChatWorkspace
          appKey="test-builder"
          appName="Test Builder"
          launch={current}
          onSessionClosed={() => undefined}
        />
      );

      await screen.findByText("Conversation transcript");
      const onStreamEvent = chatPanelProps.at(-1)?.onStreamEvent;
      expect(onStreamEvent).toBeTypeOf("function");
      const exportEvent = {
        type: "tool-result",
        id: "tool-1",
        status: "ok",
        output: {
          action_id: "app.export.request",
          operation_id: "00000000-0000-4000-8000-000000000071",
          idempotency_key: "app-export-00000000-0000-4000-8000-000000000071",
          result: {
            result_version: 1,
            status: "prepared",
            artifact: {
              artifact_revision_id: "00000000-0000-4000-8000-000000000072",
              content_digest: `sha256:${"c".repeat(64)}`,
              content_size_bytes: 8,
              media_type: "application/pdf",
              owner_visible_label: "resume.pdf",
            },
            filename: "resume.pdf",
            media_type: "application/pdf",
            bytes_base64: btoa("%PDF-1.4"),
            safe_destination_label: "resume.pdf",
            replayed: false,
          },
        },
      };
      expect(extractPreparedAppChatExport(exportEvent.output)).toMatchObject({
        artifactRevisionId: "00000000-0000-4000-8000-000000000072",
        artifactDigest: `sha256:${"c".repeat(64)}`,
        payload: { filename: "resume.pdf", mime_type: "application/pdf" },
      });

      await act(async () => {
        await onStreamEvent?.(exportEvent);
      });

      await waitFor(() => {
        expect(anchorClick).toHaveBeenCalledTimes(1);
        expect(appsApi.finalizeAppExport).toHaveBeenCalledWith("test-builder", {
          artifact_revision_id: "00000000-0000-4000-8000-000000000072",
          artifact_digest: `sha256:${"c".repeat(64)}`,
          safe_destination_label: "resume.pdf",
          outcome: "completed",
        });
      });
      expect(screen.getByTestId("chat-status-notice")).toHaveTextContent("Downloaded resume.pdf.");
    } finally {
      create.mockRestore();
      revoke.mockRestore();
      anchorClick.mockRestore();
    }
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

  it("does not pass a host-side local responder into the native chat panel", async () => {
    const current = launch();
    vi.mocked(appsApi.readAppChatWorkspaceSession).mockResolvedValue(current.session);

    render(<AppChatWorkspace appKey="resume-builder" appName="Resume Builder" launch={current} onSessionClosed={vi.fn()} onOpenSettings={vi.fn()} />);

    await waitFor(() => expect(chatPanelProps.length).toBeGreaterThan(0));
    expect(chatPanelProps.at(-1)).not.toHaveProperty("localResponseForMessage");
  });
});
