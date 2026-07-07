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
  onLogout: () => {}
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

  it("uses simple parent labels for core projects and a command label for creating projects", () => {
    render(<Sidebar {...baseProps} onAddProject={async () => {}} />);

    expect(screen.getByRole("button", { name: "Your Agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Career" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create project" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New project" })).not.toBeInTheDocument();
  });

  it("shows the selected project's files in drilled-in view", () => {
    render(
      <Sidebar
        {...baseProps}
        selectedProjectId="finance"
        selectedProject={mockProjects[0]!}
        projectFiles={[
          { name: "spec.md", path: "documents/finance/spec.md" },
          { name: "plan.md", path: "documents/finance/plan.md" },
          { name: "journal.md", path: "documents/finance/journal.md" },
          { name: "2026-05-capital-one.md", path: "documents/finance/2026-05-capital-one.md" },
          { name: "AGENT.md", path: "finance/AGENT.md" },
          { name: "journal/journal.md", path: "documents/finance/journal/journal.md" },
          { name: "run-interview.md", path: "finance/run-interview.md" },
          { name: "run-planning.md", path: "finance/run-planning.md" },
          { name: "run-journal.md", path: "finance/run-journal.md" }
        ]}
      />
    );

    expect(screen.getByRole("button", { name: "Your Finance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your Goals" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your Plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your Journal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2026 05 Capital One" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show advanced" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Journal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Journal" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search chats...")).not.toBeInTheDocument();
  });

  it("shows Finance project scope with owner labels and generic uploaded files", async () => {
    const user = userEvent.setup();
    const onFileClick = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        selectedProjectId="finance"
        selectedProject={mockProjects[0]!}
        projectFiles={[
          { name: "spec.md", path: "documents/finance/spec.md" },
          { name: "plan.md", path: "documents/finance/plan.md" },
          { name: "2026-05-capital-one.md", path: "documents/finance/2026-05-capital-one.md" },
          { name: "archive/retired-budget/budget.md", path: "documents/finance/archive/retired-budget/budget.md" }
        ]}
        onFileClick={onFileClick}
      />
    );

    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your Goals" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your Plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2026 05 Capital One" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Budget" })).toBeInTheDocument();
    expect(screen.queryByText("Apps")).not.toBeInTheDocument();
    expect(screen.queryByText("Generated")).not.toBeInTheDocument();
    expect(screen.queryByText("Source")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2026 05 Capital One" }));

    expect(onFileClick).toHaveBeenCalledWith({
      name: "2026-05-capital-one.md",
      path: "documents/finance/2026-05-capital-one.md"
    });
  });

  it("shows nested folder files as project files without app navigation", async () => {
    const user = userEvent.setup();
    const onFileClick = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        selectedProjectId="home"
        selectedProject={{
          id: "home",
          name: "Home",
          icon: "home",
          conversationId: null
        }}
        projectFiles={[
          { name: "garden/garden.md", path: "documents/home/garden/garden.md" },
          { name: "garden/compare.md", path: "documents/home/garden/compare.md" },
          { name: "garden/compare-user.md", path: "documents/home/garden/compare-user.md" },
          { name: "garden/reports/latest.md", path: "documents/home/garden/reports/latest.md" },
          { name: "garden/sources/seed-list.md", path: "documents/home/garden/sources/seed-list.md" }
        ]}
        onFileClick={onFileClick}
      />
    );

    expect(screen.getByText("Your Files")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Garden" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "LatestGenerated" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seed List" })).toBeInTheDocument();
    expect(screen.queryByText("Apps")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reports" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sources" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show advanced" }));
    await user.click(screen.getByRole("button", { name: "Customize Compare" }));

    expect(onFileClick).toHaveBeenCalledWith({
      name: "compare-user.md",
      path: "documents/home/garden/compare-user.md"
    });
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
        projectFiles={[{ name: "plan.md", path: "documents/finance/plan.md" }]}
        onDeselectProject={onDeselectProject}
        onReturnToChat={onReturnToChat}
      />
    );

    await user.click(screen.getByRole("button", { name: "Back to project list" }));
    await user.click(screen.getByRole("button", { name: "Your Finance" }));

    expect(onDeselectProject).toHaveBeenCalledTimes(1);
    expect(onReturnToChat).toHaveBeenCalledTimes(1);
  });

  it("does not show the document upload control in the project sidebar", () => {
    const { container } = render(
      <Sidebar
        {...baseProps}
        selectedProjectId="finance"
        selectedProject={mockProjects[0]!}
        projectFiles={[{ name: "plan.md", path: "documents/finance/plan.md" }]}
      />
    );

    expect(screen.queryByRole("button", { name: "Upload document to Your Finance" })).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });
});
