import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AppShell from "./AppShell";
import type { Project, ProjectFile } from "@/types/ui";

const refreshProjectsMock = vi.fn();
const refreshSelectedProjectFilesMock = vi.fn<() => Promise<ProjectFile[]>>();
const selectProjectMock = vi.fn();
const clearProjectConversationMock = vi.fn<(id: string) => Promise<void>>();

const projects: Project[] = [
  {
    id: "braindrive-plus-one",
    name: "BrainDrive+1",
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

vi.mock("@/api/gateway-adapter", () => ({
  getMemoryUpdateReport: vi.fn(),
  getMemoryUpdateStatus: vi.fn(async () => ({
    migration_id: "none",
    report_path: null,
    deferred_paths: [],
  })),
  getOnboardingStatus: vi.fn(async () => ({
    onboarding_required: false,
    active_provider_profile: null,
    default_provider_profile: null,
    providers: [],
  })),
  uploadProjectDocument: vi.fn(),
}));

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
    clearProjectConversation: clearProjectConversationMock,
  }),
}));

vi.mock("./Sidebar", () => ({
  default: (props: {
    selectedProjectId: string | null;
    projectFiles: ProjectFile[];
  }) => (
    <aside>
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
    onStartNewConversation?: () => void | Promise<void>;
  }) => (
    <div>
      <button type="button" onClick={() => props.onConversationComplete?.("conv-finance")}>
        Complete conversation
      </button>
      <button type="button" onClick={() => void props.onStartNewConversation?.()}>
        Start fresh
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
    clearProjectConversationMock.mockReset();
    clearProjectConversationMock.mockResolvedValue();

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

  it("detaches the selected project conversation before starting fresh", async () => {
    const user = userEvent.setup();

    render(<AppShell />);

    await user.click(screen.getByRole("button", { name: "Start fresh" }));

    await waitFor(() => {
      expect(clearProjectConversationMock).toHaveBeenCalledWith("finance");
    });
  });
});
