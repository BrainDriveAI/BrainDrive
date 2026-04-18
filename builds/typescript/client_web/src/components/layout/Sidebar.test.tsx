import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Project } from "@/types/ui";

import Sidebar from "./Sidebar";

const mockProjects: Project[] = [
  {
    id: "finance",
    name: "Finance",
    icon: "dollar-sign",
    conversationId: "conv-finance"
  },
  {
    id: "career",
    name: "Career",
    icon: "briefcase",
    conversationId: null
  }
];

const baseProps = {
  isCollapsed: false,
  onToggle: () => {},
  projects: mockProjects,
  selectedProjectId: null,
  selectedProject: null,
  projectFiles: [],
  isLoadingProjects: false,
  isLoadingFiles: false,
  onSelectProject: () => {},
  onDeselectProject: () => {},
  onReturnToChat: () => {},
  onFileClick: () => {},
  onOpenSettings: () => {},
  onLogout: () => {},
  showUpdateIndicator: false,
  onUpdateIndicatorClick: () => {}
};

describe("Sidebar", () => {
  it("calls onClose when a project is selected", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<Sidebar {...baseProps} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Finance" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens and closes the profile menu", async () => {
    const user = userEvent.setup();

    render(<Sidebar {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Open profile menu" }));

    expect(screen.getByRole("button", { name: "BrainDrive Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log Out" })).toBeInTheDocument();

    await user.click(document.body);

    expect(
      screen.queryByRole("button", { name: "BrainDrive Settings" })
    ).not.toBeInTheDocument();
  });

  it("shows the selected project's files in drilled-in view", () => {
    render(
      <Sidebar
        {...baseProps}
        selectedProjectId="finance"
        selectedProject={mockProjects[0]!}
        projectFiles={[{ name: "budget.md", path: "finance/budget.md" }]}
      />
    );

    expect(screen.getByRole("button", { name: "Finance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "budget.md" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search chats...")).not.toBeInTheDocument();
  });

  it("keeps project list navigation and return-to-chat separate in drilled-in view", async () => {
    const user = userEvent.setup();
    const onDeselectProject = vi.fn();
    const onReturnToChat = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        selectedProjectId="finance"
        selectedProject={mockProjects[0]!}
        projectFiles={[{ name: "budget.md", path: "finance/budget.md" }]}
        onDeselectProject={onDeselectProject}
        onReturnToChat={onReturnToChat}
      />
    );

    await user.click(screen.getByRole("button", { name: "Back to project list" }));
    await user.click(screen.getByRole("button", { name: "Finance" }));

    expect(onDeselectProject).toHaveBeenCalledTimes(1);
    expect(onReturnToChat).toHaveBeenCalledTimes(1);
  });

  it("hides update indicator when no update is available", () => {
    render(<Sidebar {...baseProps} showUpdateIndicator={false} />);

    expect(screen.queryByText("Update available")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /update available/i })
    ).not.toBeInTheDocument();
  });

  it("shows an amber update indicator above the profile section", () => {
    render(<Sidebar {...baseProps} showUpdateIndicator />);

    const updateButton = screen.getByRole("button", { name: /update available/i });

    expect(updateButton).toBeInTheDocument();
    expect(updateButton).toHaveAccessibleName(/Update available/i);
    expect(updateButton.className).toContain("border-bd-amber");
    expect(screen.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it("invokes update callback without triggering unrelated sidebar actions", async () => {
    const user = userEvent.setup();
    const onUpdateIndicatorClick = vi.fn();
    const onSelectProject = vi.fn();
    const onOpenSettings = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        showUpdateIndicator
        onUpdateIndicatorClick={onUpdateIndicatorClick}
        onSelectProject={onSelectProject}
        onOpenSettings={onOpenSettings}
      />
    );

    await user.click(screen.getByRole("button", { name: /update available/i }));

    expect(onUpdateIndicatorClick).toHaveBeenCalledTimes(1);
    expect(onSelectProject).not.toHaveBeenCalled();
    expect(onOpenSettings).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "BrainDrive Settings" })
    ).not.toBeInTheDocument();
  });
});
