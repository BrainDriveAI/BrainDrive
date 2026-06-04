import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";

import AppShell from "./AppShell";
import { uploadProjectDocument } from "@/api/gateway-adapter";
import type { Project, ProjectFile } from "@/types/ui";

const gatewayMocks = vi.hoisted(() => ({
  getMemoryUpdateStatus: vi.fn(),
  getMemoryUpdateReport: vi.fn(),
}));

const refreshProjectsMock = vi.fn();
const refreshSelectedProjectFilesMock = vi.fn<() => Promise<ProjectFile[]>>();
const selectProjectMock = vi.fn();

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
  getMemoryUpdateReport: gatewayMocks.getMemoryUpdateReport,
  getMemoryUpdateStatus: gatewayMocks.getMemoryUpdateStatus,
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
    contentOverride?: ReactNode;
    onConversationComplete?: (conversationId: string) => void;
    onUploadDocument?: (file: File, options?: { openAfterUpload?: boolean }) => Promise<unknown>;
  }) => (
    <div>
      {props.contentOverride}
      <button type="button" onClick={() => props.onConversationComplete?.("conv-finance")}>
        Complete conversation
      </button>
      <button
        type="button"
        onClick={() => props.onUploadDocument?.(new File(["Date,Amount"], "statement.csv", { type: "text/csv" }), { openAfterUpload: false })}
      >
        Upload from chat
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
    vi.mocked(uploadProjectDocument).mockReset();
    vi.mocked(uploadProjectDocument).mockResolvedValue({
      name: "statement.md",
      path: "documents/finance/statement.md",
    });
    gatewayMocks.getMemoryUpdateStatus.mockReset();
    gatewayMocks.getMemoryUpdateStatus.mockResolvedValue({
      migration_id: "none",
      report_path: null,
      deferred_paths: [],
    });
    gatewayMocks.getMemoryUpdateReport.mockReset();
    gatewayMocks.getMemoryUpdateReport.mockResolvedValue("Memory update report");

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

  it("does not open document read mode after chat-origin upload opts out of opening", async () => {
    const user = userEvent.setup();

    render(<AppShell />);

    await user.click(screen.getByRole("button", { name: "Upload from chat" }));

    await waitFor(() => {
      expect(uploadProjectDocument).toHaveBeenCalledWith("finance", expect.any(File));
      expect(refreshSelectedProjectFilesMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: "Back to chat" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "statement.md" })).not.toBeInTheDocument();
  });

  it("does not show non-critical memory update banners over a selected project", async () => {
    gatewayMocks.getMemoryUpdateStatus.mockResolvedValueOnce({
      migration_id: "starter-pack-26.5.25",
      report_path: "system/updates/reports/starter-pack-26.5.25.md",
      deferred_paths: [],
    });

    render(<AppShell />);

    await waitFor(() => {
      expect(gatewayMocks.getMemoryUpdateReport).toHaveBeenCalledWith("starter-pack-26.5.25");
    });
    expect(screen.queryByText("BrainDrive is up to date.")).not.toBeInTheDocument();
    expect(screen.queryByText("Memory instructions were updated so the latest features work correctly.")).not.toBeInTheDocument();
  });

  it("still surfaces memory update notices that need owner review", async () => {
    gatewayMocks.getMemoryUpdateStatus.mockResolvedValueOnce({
      migration_id: "starter-pack-26.5.25",
      report_path: "system/updates/reports/starter-pack-26.5.25.md",
      deferred_paths: ["documents/finance/AGENT.md"],
    });

    render(<AppShell />);

    expect(await screen.findByText("BrainDrive is up to date.")).toBeInTheDocument();
    expect(screen.getByText("Safe memory updates were applied. One item was left unchanged because it has custom content.")).toBeInTheDocument();
  });
});
