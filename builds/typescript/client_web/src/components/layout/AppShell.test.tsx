import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    selectedProjectId: string | null;
    projectFiles: ProjectFile[];
    onOpenApps: () => void;
    onSelectProject: (projectId: string) => void;
  }) => (
    <aside>
      <button type="button" onClick={props.onOpenApps}>Apps</button>
      <button type="button" onClick={() => props.onSelectProject("finance")}>Finance</button>
      <div data-testid="selected-project">{props.selectedProjectId}</div>
      <div data-testid="sidebar-files">
        {props.projectFiles.map((file) => file.path).join(",")}
      </div>
    </aside>
  ),
}));

vi.mock("@/components/apps/AppsPage", () => ({
  default: function MockAppsPage({
    onOpenSettings,
    onSessionClosed,
    onWorkspaceActiveChange,
    onGoHome,
  }: {
    onOpenSettings?: () => void;
    onSessionClosed?: () => void;
    onWorkspaceActiveChange?: (active: boolean) => void;
    onGoHome?: () => void;
  }) {
    const [selected, setSelected] = useState(false);
    return (
    <section aria-label="Apps surface">
      {selected ? <span>Selected workspace session</span> : null}
      Apps surface
      <input aria-label="App draft" defaultValue="" />
      <button type="button" onClick={onOpenSettings}>Open model settings recovery</button>
      <button type="button" onClick={onSessionClosed}>Close app session</button>
      <button type="button" onClick={onGoHome}>Go to BrainDrive home</button>
      <button type="button" onClick={() => { setSelected(true); onWorkspaceActiveChange?.(true); }}>Open app workspace</button>
      <button type="button" onClick={() => onWorkspaceActiveChange?.(false)}>Back to app catalog</button>
    </section>
    );
  },
}));

vi.mock("@/components/chat/ChatPanel", () => ({
  default: (props: {
    onConversationComplete?: (conversationId: string) => void;
  }) => (
    <div>
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

  it("refreshes project documents after an installed app session closes", async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await user.click(screen.getByRole("button", { name: "Apps" }));
    await user.click(screen.getByRole("button", { name: "Close app session" }));
    await waitFor(() => expect(refreshSelectedProjectFilesMock).toHaveBeenCalled());
  });

  it("ignores stale legacy memory update notice state", () => {
    window.localStorage.setItem("braindrive.memoryUpdateReportSeen.starter-pack-26.4.20", "1");

    render(<AppShell />);

    expect(screen.queryByText("BrainDrive is up to date.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss memory update notice" })).not.toBeInTheDocument();
  });

  it("opens the single Apps surface without changing the selected project", async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await user.click(screen.getByRole("button", { name: "Apps" }));
    expect(screen.getByRole("region", { name: "Apps surface" })).toBeInTheDocument();
    expect(selectProjectMock).not.toHaveBeenCalled();
  });

  it("routes app workspace home navigation to the root agent", async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await user.click(screen.getByRole("button", { name: "Apps" }));
    await user.click(within(screen.getByRole("region", { name: "Apps surface" })).getByRole("button", { name: "Go to BrainDrive home" }));
    expect(selectProjectMock).toHaveBeenCalledWith("your-agent");
    expect(screen.queryByRole("region", { name: "Apps surface" })).not.toBeInTheDocument();
  });

  it("preserves the mounted Apps workspace while navigating through BrainDrive", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(screen.getByRole("button", { name: "Apps" }));
    await user.type(screen.getByRole("textbox", { name: "App draft" }), "unfinished resume details");
    await user.click(screen.getByRole("button", { name: "Finance" }));

    expect(screen.queryByRole("region", { name: "Apps surface" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apps" }));
    expect(screen.getByRole("textbox", { name: "App draft" })).toHaveValue("unfinished resume details");
  });

  it("routes app model recovery into the existing settings modal", async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await user.click(screen.getByRole("button", { name: "Apps" }));
    await user.click(screen.getByRole("button", { name: "Open model settings recovery" }));
    expect(screen.getAllByText("Settings").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Close settings" }).length).toBeGreaterThan(0);
  });

  it("preserves the workspace subtree and draft when Launch toggles workspace ownership", async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await user.click(screen.getByRole("button", { name: "Apps" }));
    const workspace = screen.getByRole("region", { name: "Apps surface" });
    const draft = screen.getByRole("textbox", { name: "App draft" });
    await user.type(draft, "selected workspace state");
    const main = screen.getByRole("main");
    await user.click(screen.getByRole("button", { name: "Open app workspace" }));
    expect(screen.getByText("Selected workspace session")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBe(main);
    expect(main.style.getPropertyValue("--mobile-header-height")).toBe("0px");
    expect(screen.getByRole("region", { name: "Apps surface" })).toBe(workspace);
    expect(screen.getByRole("textbox", { name: "App draft" })).toBe(draft);
    expect(draft).toHaveValue("selected workspace state");
    await user.click(screen.getByRole("button", { name: "Back to app catalog" }));
    expect(screen.getByRole("region", { name: "Apps surface" })).toBe(workspace);
    expect(draft).toHaveValue("selected workspace state");
  });

  it("hides the BrainDrive sidebar while an app workspace owns the page", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    expect(screen.getByRole("complementary")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apps" }));
    await user.click(screen.getByRole("button", { name: "Open app workspace" }));

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Apps surface" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to app catalog" }));
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("opens and closes the host mobile sidebar through the shared drawer shell", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close sidebar backdrop" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

});
