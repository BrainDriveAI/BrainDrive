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

  it("groups Draft 3 files and hides managed instructions until advanced is shown", async () => {
    const user = userEvent.setup();
    const onFileClick = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        selectedProjectId="finance"
        selectedProject={mockProjects[0]!}
        projectFiles={[
          { name: "budget/budget.md", path: "documents/finance/budget/budget.md" },
          { name: "budget/compare.md", path: "documents/finance/budget/compare.md" },
          { name: "budget/compare-user.md", path: "documents/finance/budget/compare-user.md" },
          { name: "reports/latest.md", path: "documents/finance/reports/latest.md" },
          { name: "statements/2026-05-card.md", path: "documents/finance/statements/2026-05-card.md" }
        ]}
        onFileClick={onFileClick}
      />
    );

    expect(screen.getByText("Goals And Plan")).toBeInTheDocument();
    expect(screen.getByText("Reports")).toBeInTheDocument();
    expect(screen.getByText("Sources")).toBeInTheDocument();
    expect(screen.getByText("Custom Instructions")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /budget\/compare.md/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show advanced instructions/i }));

    expect(screen.getByText("Advanced Instructions")).toBeInTheDocument();
    expect(screen.getByText("budget/compare.md")).toBeInTheDocument();
    expect(screen.getByText("Generated")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Customize budget/compare.md" }));

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
    await user.click(screen.getByRole("button", { name: "Finance" }));

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

    expect(screen.getByRole("button", { name: "Upload document to Finance" })).toBeInTheDocument();

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect((input as HTMLInputElement).accept).toContain(".csv");

    const file = new File(["Date,Amount\n2026-05-12,4.50"], "transactions.csv", { type: "text/csv" });
    await user.upload(input as HTMLInputElement, file);

    expect(onUploadDocument).toHaveBeenCalledWith(file);
  });
});
