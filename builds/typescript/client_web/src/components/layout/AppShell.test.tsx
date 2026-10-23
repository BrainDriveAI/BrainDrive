import type { ReactNode } from "react";
import * as gateway from "@/api/gateway-adapter";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AppShell from "./AppShell";
import type { Project, ProjectFile } from "@/types/ui";

const refreshProjectsMock = vi.fn();
const refreshSelectedProjectFilesMock = vi.fn<() => Promise<ProjectFile[]>>();
const selectProjectMock = vi.fn();

const projects: Project[] = [
  {
    id: "your-agent",
    name: "Your Agent",
    icon: "sparkles",
    conversationId: "conv-home",
  },
  {
    id: "finance",
    name: "Finance",
    icon: "finance",
    conversationId: "conv-finance",
  },
];

const initialProjectFiles: ProjectFile[] = [
  {
    name: "statement.md",
    path: "documents/finance/statement.md",
  },
];

vi.mock("@/api/gateway-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/api/gateway-adapter")>("@/api/gateway-adapter");
  return {
    ...actual,
    readFileContent: vi.fn(),
    getOnboardingStatus: vi.fn(async () => ({
      onboarding_required: false,
      active_provider_profile: null,
      default_provider_profile: null,
      providers: [],
    })),
  };
});

vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => ({
    projects,
    selectedProjectId: "finance",
    selectedProject: projects[1],
    projectFiles: initialProjectFiles,
    isLoadingProjects: false,
    isLoadingFiles: false,
    activeConversationId: "conv-finance",
    selectProject: selectProjectMock,
    deselectProject: vi.fn(),
    refreshProjects: refreshProjectsMock,
    refreshSelectedProjectFiles: refreshSelectedProjectFilesMock,
    addProject: vi.fn(),
    removeProject: vi.fn(),
    renameProject: vi.fn(),
    clearProjectConversation: vi.fn(),
  }),
}));

vi.mock("./Sidebar", () => ({
  default: (props: {
    isCollapsed: boolean;
    onToggle: () => void;
    selectedProjectId: string | null;
    projectFiles: ProjectFile[];
    onOpenProjectView: (view: "files") => void;
    onReturnToChat: () => void;
    onFileClick: (file: ProjectFile) => void;
    onSelectProject: (projectId: string) => void;
  }) => (
    <aside>
      <button type="button" onClick={props.onToggle}>{props.isCollapsed ? "Expand sidebar" : "Collapse sidebar"}</button>
      <button type="button" onClick={() => props.onOpenProjectView("files")}>Your Files</button>
      <button type="button" onClick={props.onReturnToChat}>Conversation</button>
      <button type="button" onClick={() => props.onSelectProject("finance")}>Finance</button>
      <button type="button" onClick={() => props.onFileClick({ name: "plan.md", path: "documents/finance/plan.md" })}>Open plan</button>
      <button type="button" onClick={() => props.onFileClick(initialProjectFiles[0]!)}>Open statement</button>
      <div data-testid="selected-project">{props.selectedProjectId}</div>
      <div data-testid="sidebar-files">
        {props.projectFiles.map((file) => file.path).join(",")}
      </div>
    </aside>
  ),
}));

vi.mock("@/components/chat/ChatPanel", () => ({
  default: (props: {
    onConversationComplete?: (conversationId: string) => void;
    contentOverride?: ReactNode;
  }) => (
    <div>
      {props.contentOverride}
      <button type="button" onClick={() => props.onConversationComplete?.("conv-finance")}>
        Complete conversation
      </button>
    </div>
  ),
}));

describe("AppShell project file refresh", () => {
  beforeEach(() => {
    refreshProjectsMock.mockReset();
    refreshSelectedProjectFilesMock.mockReset();
    refreshSelectedProjectFilesMock.mockResolvedValue([]);
    selectProjectMock.mockReset();

    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens Your Files in the content area, and returns to the collection", async () => {
    window.sessionStorage.clear();
    vi.mocked(gateway.readFileContent).mockResolvedValue("# Saved statement\n");
    const user = userEvent.setup();
    render(<AppShell />);
    await user.click(screen.getByRole("button", { name: "Your Files" }));
    expect(screen.getByRole("region", { name: "Your Files content" })).toBeVisible();
    await user.click(screen.getByTitle("statement.md"));
    await screen.findByRole("heading", { name: "Saved statement" });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Unfinished work");
    await user.click(screen.getByRole("button", { name: "Back to Your Files" }));
    await user.click(screen.getByRole("button", { name: "Conversation" }));
    expect(screen.getByLabelText("Expert title")).toBeVisible();
    expect(screen.queryByLabelText("Current view")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Your Files" }));
    await user.click(screen.getByTitle("statement.md"));
    expect(await screen.findByRole("heading", { name: "Saved statement" })).toBeVisible();
    window.sessionStorage.clear();
  });

  it("preserves the open editor and unsaved document while toggling the sidebar", async () => {
    window.sessionStorage.clear();
    vi.mocked(gateway.readFileContent).mockResolvedValue("# Saved statement\n");
    const user = userEvent.setup();
    render(<AppShell />);
    await user.click(screen.getByRole("button", { name: "Your Files" }));
    await user.click(screen.getByTitle("statement.md"));
    await screen.findByRole("heading", { name: "Saved statement" });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Unfinished statement draft");
    const editor = screen.getByRole("textbox");
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("textbox")).toBe(editor);
    expect(editor).toHaveValue("Unfinished statement draft");
    expect(screen.getByTestId("selected-project")).toHaveTextContent("finance");
    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByRole("textbox")).toBe(editor);
    expect(editor).toHaveValue("Unfinished statement draft");
    expect(selectProjectMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Back to Your Files" }));
    await user.click(screen.getByTitle("statement.md"));
    expect(await screen.findByRole("heading", { name: "Saved statement" })).toBeVisible();
    window.sessionStorage.clear();
  });

  it("refreshes selected project files after a completed chat turn without leaving the project", async () => {
    const user = userEvent.setup();

    render(<AppShell />);

    await user.click(screen.getByRole("button", { name: "Complete conversation" }));

    expect(refreshProjectsMock).toHaveBeenCalled();
    await waitFor(() => {
      expect(refreshSelectedProjectFilesMock).toHaveBeenCalled();
    });
    expect(screen.getByTestId("selected-project")).toHaveTextContent("finance");
    expect(selectProjectMock).not.toHaveBeenCalled();
  });

  it("ignores stale legacy memory update notice state", () => {
    window.localStorage.setItem("braindrive.memoryUpdateReportSeen.starter-pack-26.4.20", "1");

    render(<AppShell />);

    expect(screen.queryByText("BrainDrive is up to date.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss memory update notice" })).not.toBeInTheDocument();
  });

});
