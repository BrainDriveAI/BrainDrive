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
        projectFiles={[{ name: "budget.md", path: "finance/budget.md" }]}
      />
    );

    expect(screen.getByRole("button", { name: "Your Finance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Budget" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search chats...")).not.toBeInTheDocument();
  });

  it("shows Draft 3 project scope with owner labels and app entry", async () => {
    const user = userEvent.setup();
    const onSelectAppPath = vi.fn();
    const onFileClick = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        selectedProjectId="finance"
        selectedProject={mockProjects[0]!}
        projectFiles={[
          { name: "spec.md", path: "documents/finance/spec.md" },
          { name: "plan.md", path: "documents/finance/plan.md" },
          { name: "budget/budget.md", path: "documents/finance/budget/budget.md" },
          { name: "budget/reports/latest.md", path: "documents/finance/budget/reports/latest.md" },
          { name: "budget/statements/2026-05-card.md", path: "documents/finance/budget/statements/2026-05-card.md" }
        ]}
        onSelectAppPath={onSelectAppPath}
        onFileClick={onFileClick}
      />
    );

    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your Goals" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your Plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your Budget" })).toBeInTheDocument();
    expect(screen.queryByText("Generated")).not.toBeInTheDocument();
    expect(screen.queryByText("Source")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Your Budget" }));

    expect(onSelectAppPath).toHaveBeenCalledWith("budget");
    expect(onFileClick).toHaveBeenCalledWith({
      name: "budget/budget.md",
      path: "documents/finance/budget/budget.md"
    });
  });

  it("groups Draft 3 app files and hides managed instructions until advanced is shown", async () => {
    const user = userEvent.setup();
    const onFileClick = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        selectedProjectId="finance"
        selectedProject={mockProjects[0]!}
        activeAppPath="budget"
        projectFiles={[
          { name: "budget/budget.md", path: "documents/finance/budget/budget.md" },
          { name: "budget/compare.md", path: "documents/finance/budget/compare.md" },
          { name: "budget/compare-user.md", path: "documents/finance/budget/compare-user.md" },
          { name: "budget/reports/latest.md", path: "documents/finance/budget/reports/latest.md" },
          { name: "budget/statements/2026-05-card.md", path: "documents/finance/budget/statements/2026-05-card.md" }
        ]}
        onFileClick={onFileClick}
      />
    );

    expect(screen.getByText("Your Files")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reports" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Statements" })).toBeInTheDocument();
    expect(screen.getByText("Advanced")).toBeInTheDocument();
    expect(screen.getByText("compare.md")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Customize compare.md" }));

    expect(onFileClick).toHaveBeenCalledWith({
      name: "compare-user.md",
      path: "documents/finance/budget/compare-user.md"
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
        projectFiles={[{ name: "budget.md", path: "finance/budget.md" }]}
        onDeselectProject={onDeselectProject}
        onReturnToChat={onReturnToChat}
      />
    );

    await user.click(screen.getByRole("button", { name: "Back to project list" }));
    await user.click(screen.getByRole("button", { name: "Your Finance" }));

    expect(onDeselectProject).toHaveBeenCalledTimes(1);
    expect(onReturnToChat).toHaveBeenCalledTimes(1);
  });

  it("uploads a document from a selected project", async () => {
    const user = userEvent.setup();
    const onUploadDocument = vi.fn(async () => {});

    const { container } = render(
      <Sidebar
        {...baseProps}
        selectedProjectId="finance"
        selectedProject={mockProjects[0]!}
        projectFiles={[{ name: "budget.md", path: "finance/budget.md" }]}
        onUploadDocument={onUploadDocument}
      />
    );

    expect(screen.getByRole("button", { name: "Upload document to Your Finance" })).toBeInTheDocument();

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect((input as HTMLInputElement).accept).toContain(".csv");

    const file = new File(["Date,Amount\n2026-05-12,4.50"], "transactions.csv", { type: "text/csv" });
    await user.upload(input as HTMLInputElement, file);

    expect(onUploadDocument).toHaveBeenCalledWith(file);
  });
});
