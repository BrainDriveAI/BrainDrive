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

    await user.click(screen.getByRole("button", { name: "Your Finances" }));

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

  it("shows the selected project's files in drilled-in view with owner-language labels", () => {
    render(
      <Sidebar
        {...baseProps}
        selectedProjectId="finance"
        selectedProject={mockProjects[0]!}
        projectFiles={[
          { name: "AGENT.md", path: "documents/finance/AGENT.md" },
          { name: "spec.md", path: "documents/finance/spec.md" },
          { name: "plan.md", path: "documents/finance/plan.md" },
          { name: "run-interview.md", path: "documents/finance/run-interview.md" },
          { name: "budget/AGENT.md", path: "documents/finance/budget/AGENT.md" },
          { name: "budget/budget.md", path: "documents/finance/budget/budget.md" },
          { name: "reports/README.md", path: "documents/finance/reports/README.md" }
        ]}
      />
    );

    expect(screen.getByRole("button", { name: "Finance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Your Agent/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Your Goals/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Your Plan/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Your Budget/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your Work" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Advanced" })).toBeInTheDocument();
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
        projectFiles={[{ name: "budget.md", path: "finance/budget/budget.md" }]}
        onDeselectProject={onDeselectProject}
        onReturnToChat={onReturnToChat}
      />
    );

    await user.click(screen.getByRole("button", { name: "Back to project list" }));
    await user.click(screen.getByRole("button", { name: "Finance" }));

    expect(onDeselectProject).toHaveBeenCalledTimes(1);
    expect(onReturnToChat).toHaveBeenCalledTimes(1);
  });

  it("renders BD+1 root sidebar without a BrainDrive+1 row and with Your To-Do at bottom", () => {
    render(
      <Sidebar
        {...baseProps}
        selectedProjectId="braindrive-plus-one"
        onAddProject={async () => {}}
      />
    );

    expect(screen.queryByRole("button", { name: "BrainDrive+1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your Finances" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your Career" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your To-Do" })).toBeInTheDocument();
  });

  it("enters app scope on Your Budget click and shows breadcrumb", async () => {
    const user = userEvent.setup();
    render(
      <Sidebar
        {...baseProps}
        selectedProjectId="finance"
        selectedProject={mockProjects[0]!}
        projectFiles={[
          { name: "AGENT.md", path: "documents/finance/AGENT.md" },
          { name: "budget/AGENT.md", path: "documents/finance/budget/AGENT.md" },
          { name: "budget/budget.md", path: "documents/finance/budget/budget.md" },
          { name: "budget/budget-rules.md", path: "documents/finance/budget/budget-rules.md" },
          { name: "budget/create.md", path: "documents/finance/budget/create.md" }
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: /Your Budget/ }));

    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Your Rules/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Your Work" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Finance" })).toBeInTheDocument();
  });

  it("backs out of app scope to project scope via breadcrumb", async () => {
    const user = userEvent.setup();
    render(
      <Sidebar
        {...baseProps}
        selectedProjectId="finance"
        selectedProject={mockProjects[0]!}
        projectFiles={[
          { name: "AGENT.md", path: "documents/finance/AGENT.md" },
          { name: "spec.md", path: "documents/finance/spec.md" },
          { name: "budget/AGENT.md", path: "documents/finance/budget/AGENT.md" },
          { name: "budget/budget.md", path: "documents/finance/budget/budget.md" }
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: /Your Budget/ }));
    await user.click(screen.getByRole("button", { name: "Back to Finance" }));

    expect(screen.getByRole("button", { name: /Your Goals/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to project list" })).toBeInTheDocument();
  });

  it("uploads a document from a selected project", async () => {
    const user = userEvent.setup();
    const onUploadDocument = vi.fn(async () => {});

    const { container } = render(
      <Sidebar
        {...baseProps}
        selectedProjectId="finance"
        selectedProject={mockProjects[0]!}
        projectFiles={[{ name: "budget.md", path: "finance/budget/budget.md" }]}
        onUploadDocument={onUploadDocument}
      />
    );

    expect(screen.getByRole("button", { name: "Upload document to Finance" })).toBeInTheDocument();

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect((input as HTMLInputElement).accept).toContain(".csv");

    const file = new File(["Date,Amount\n2026-05-12,4.50"], "transactions.csv", { type: "text/csv" });
    await user.upload(input as HTMLInputElement, file);

    expect(onUploadDocument).toHaveBeenCalledWith(file);
  });
});
