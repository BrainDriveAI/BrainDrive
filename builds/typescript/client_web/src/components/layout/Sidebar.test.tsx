import { act, render, screen } from "@testing-library/react";
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
  onOpenProjectView: () => {},
  onOpenSettings: () => {},
  onOpenApps: () => {},
  isAppsActive: false,
  onLogout: () => {}
};

describe("Sidebar", () => {
  it("opens one top-level Apps entry and exposes its active state without color alone", async () => {
    const user = userEvent.setup();
    const onOpenApps = vi.fn();
    render(<Sidebar {...baseProps} onOpenApps={onOpenApps} isAppsActive />);
    const apps = screen.getByRole("button", { name: "Apps" });
    expect(apps).toHaveAttribute("aria-current", "page");
    await user.click(apps);
    expect(onOpenApps).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when a project is selected", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<Sidebar {...baseProps} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Finances" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens the profile menu from the footer identity and dots, and closes on repeat or outside clicks", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(<Sidebar {...baseProps} onToggle={onToggle} />);
    const account = screen.getByRole("button", { name: "Open profile menu" });
    const identity = screen.getByText("Local Owner");
    expect(account).toContainElement(identity);
    expect(account.querySelector("button, a, input, [tabindex]")).toBeNull();
    await user.click(identity);

    expect(screen.getByRole("button", { name: "BrainDrive Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log Out" })).toBeInTheDocument();
    await user.click(identity);
    expect(screen.queryByRole("button", { name: "BrainDrive Settings" })).not.toBeInTheDocument();
    await user.click(account.querySelector("svg")!);
    expect(screen.getByRole("button", { name: "BrainDrive Settings" })).toBeInTheDocument();
    await user.click(document.body);
    expect(
      screen.queryByRole("button", { name: "BrainDrive Settings" })
    ).not.toBeInTheDocument();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("uses simple parent labels for core projects and a command label for creating projects", () => {
    render(<Sidebar {...baseProps} onAddProject={async () => {}} />);

    expect(screen.getByRole("button", { name: "Your Agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Career" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finances" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create project" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New project" })).not.toBeInTheDocument();
  });

  it("keeps Home navigation and Conversation separate without repeating the Expert name", async () => {
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

    expect(screen.queryByRole("button", { name: "Your Finances" })).not.toBeInTheDocument();
    act(() => screen.getByRole("button", { name: /^Home$/ }).focus());
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Conversation" }));

    expect(onDeselectProject).toHaveBeenCalledTimes(1);
    expect(onReturnToChat).toHaveBeenCalledTimes(1);
  });

  it("returns to chat from a document using the Conversation entry", async () => {
    const user = userEvent.setup();
    const onReturnToChat = vi.fn();
    const onClose = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        selectedProjectId="finance"
        selectedProject={mockProjects[0]!}
        projectFiles={[{ name: "plan.md", path: "documents/finance/plan.md" }]}
        activeFilePath="documents/finance/plan.md"
        onReturnToChat={onReturnToChat}
        onClose={onClose}
      />
    );

    const conversation = screen.getByRole("button", { name: "Conversation" });
    expect(conversation).not.toHaveAttribute("aria-current");

    await user.click(conversation);

    expect(onReturnToChat).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("marks Conversation as current when the chat is open", () => {
    render(
      <Sidebar
        {...baseProps}
        selectedProjectId="finance"
        selectedProject={mockProjects[0]!}
        projectFiles={[{ name: "plan.md", path: "documents/finance/plan.md" }]}
        activeFilePath={null}
      />
    );

    expect(screen.getByRole("button", { name: "Conversation" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /^Home$/ })).not.toHaveAttribute("aria-current");
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

    expect(screen.queryByRole("button", { name: "Upload document to Your Finances" })).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });
});


it("shows four distinct page entries with a persistent Conversation accent", async () => {
  const user = userEvent.setup();
  const onOpenProjectView = vi.fn();
  const onClose = vi.fn();
  render(<Sidebar {...baseProps} selectedProjectId="finance" selectedProject={mockProjects[0]!}
    activeView="files" onOpenProjectView={onOpenProjectView} onClose={onClose}
    projectFiles={["spec.md", "plan.md", "journal.md", "brief.md", "AGENT.md"].map((name) => ({ name, path: `documents/finance/${name}` }))} />);
  const nav = screen.getByRole("navigation", { name: "Page navigation" });
  expect([...nav.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Conversation", "Your Files", "Tools", "Behavior"]);
  expect(nav.querySelectorAll("[aria-expanded]")).toHaveLength(0);
  expect(screen.queryByRole("button", { name: "Apps" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Brief" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Your Files" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "Conversation" })).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("button", { name: "Conversation" })).toHaveClass("text-bd-amber", "border-bd-amber");
  screen.getByRole("button", { name: "Tools" }).focus();
  await user.keyboard("{Enter}");
  expect(onOpenProjectView).toHaveBeenLastCalledWith("tools");
  await user.click(screen.getByRole("button", { name: "Behavior" }));
  expect(onOpenProjectView).toHaveBeenLastCalledWith("expert");
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("keeps direct page entries available even when there are no saved files", () => {
  render(<Sidebar {...baseProps} selectedProjectId="finance" selectedProject={mockProjects[0]!} />);
  expect(screen.queryByRole("button", { name: "To-do" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Your Files" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Tools" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Behavior" })).toBeVisible();
});


it.each(["files", "tools", "expert"] as const)("returns from %s with keyboard activation and closes the mobile drawer", async (activeView) => {
  const user = userEvent.setup();
  const onReturnToChat = vi.fn();
  const onClose = vi.fn();
  render(<Sidebar {...baseProps} selectedProjectId="finance" selectedProject={mockProjects[0]!}
    activeView={activeView} onReturnToChat={onReturnToChat} onClose={onClose} />);
  const conversation = screen.getByRole("button", { name: "Conversation" });
  expect(conversation).not.toHaveAttribute("aria-current");
  conversation.focus();
  await user.keyboard("{Enter}");
  expect(onReturnToChat).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it.each([[null, "Conversation"], ["files", "Your Files"], ["tools", "Tools"], ["expert", "Behavior"]] as const)("retains the Expert rail and %s selection when collapsing and expanding", async (activeView, label) => {
  const user = userEvent.setup();
  const onToggle = vi.fn();
  const onSelectProject = vi.fn();
  const onDeselectProject = vi.fn();
  const onOpenProjectView = vi.fn();
  const onReturnToChat = vi.fn();
  const props = { ...baseProps, selectedProjectId: "finance", selectedProject: mockProjects[0]!, activeView,
    onToggle, onSelectProject, onDeselectProject, onOpenProjectView, onReturnToChat };
  const { rerender } = render(<Sidebar {...props} />);
  const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
  await user.hover(collapse);
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Collapse sidebar");
  await user.click(collapse);
  expect(onToggle).toHaveBeenCalledTimes(1);
  rerender(<Sidebar {...props} isCollapsed />);
  expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("navigation", { name: "Page navigation" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Finances" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Apps" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveFocus();
  await user.keyboard("{Enter}");
  rerender(<Sidebar {...props} />);
  expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveFocus();
  expect(onToggle).toHaveBeenCalledTimes(2);
  expect(onSelectProject).not.toHaveBeenCalled();
  expect(onDeselectProject).not.toHaveBeenCalled();
  expect(onOpenProjectView).not.toHaveBeenCalled();
  expect(onReturnToChat).not.toHaveBeenCalled();
});

it("routes each collapsed Expert destination without expanding or selecting a different project", async () => {
  const user = userEvent.setup();
  const onToggle = vi.fn();
  const onSelectProject = vi.fn();
  const onDeselectProject = vi.fn();
  const onOpenProjectView = vi.fn();
  const onReturnToChat = vi.fn();
  render(<Sidebar {...baseProps} isCollapsed selectedProjectId="finance" selectedProject={mockProjects[0]!}
    activeFilePath="documents/finance/plan.md" onToggle={onToggle} onSelectProject={onSelectProject}
    onDeselectProject={onDeselectProject} onOpenProjectView={onOpenProjectView} onReturnToChat={onReturnToChat} />);
  expect(screen.getByRole("button", { name: "Your Files" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "Conversation" })).not.toHaveAttribute("aria-current");
  for (const [label, view] of [["Your Files", "files"], ["Tools", "tools"], ["Behavior", "expert"]]) {
    await user.click(screen.getByRole("button", { name: label }));
    expect(onOpenProjectView).toHaveBeenLastCalledWith(view);
  }
  await user.click(screen.getByRole("button", { name: "Conversation" }));
  expect(onReturnToChat).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Home" }));
  expect(onDeselectProject).toHaveBeenCalledTimes(1);
  expect(onToggle).not.toHaveBeenCalled();
  expect(onSelectProject).not.toHaveBeenCalled();
});

it("offers an icon-only Home with a tooltip and keeps the logo routed to BrainDrive home", async () => {
  const user = userEvent.setup();
  const onDeselectProject = vi.fn();
  const onSelectProject = vi.fn();
  const onClose = vi.fn();
  render(<Sidebar {...baseProps} selectedProjectId="finance" selectedProject={mockProjects[0]!}
    onDeselectProject={onDeselectProject} onSelectProject={onSelectProject} onClose={onClose} />);
  const home = screen.getByRole("button", { name: "Home" });
  expect(home.textContent).toBe("");
  await user.hover(home);
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Home");
  await user.click(home);
  expect(onDeselectProject).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Go to BrainDrive home" }));
  expect(onSelectProject).toHaveBeenCalledWith("your-agent");
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("keeps the global rail for Apps instead of exposing the previous Expert destinations", () => {
  render(<Sidebar {...baseProps} isCollapsed isAppsActive selectedProjectId="finance" selectedProject={mockProjects[0]!} />);
  expect(screen.getByRole("button", { name: "Apps" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "Finances" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Page navigation" })).not.toBeInTheDocument();
});

it.each([false, true])("keeps the integrated account footer's existing settings access (collapsed: %s)", async (isCollapsed) => {
  const user = userEvent.setup();
  const onOpenSettings = vi.fn();
  const onOpenProjectView = vi.fn();
  render(<Sidebar {...baseProps} isCollapsed={isCollapsed} selectedProjectId="finance" selectedProject={mockProjects[0]!}
    onOpenSettings={onOpenSettings} onOpenProjectView={onOpenProjectView} />);
  const toggle = screen.getByRole("button", { name: isCollapsed ? "Expand sidebar" : "Collapse sidebar" });
  const account = screen.getByRole("button", { name: "Open profile menu" });
  expect(account.contains(toggle)).toBe(false);
  expect(screen.queryByRole("button", { name: "Open BrainDrive settings" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "BrainDrive Settings" })).not.toBeInTheDocument();
  await user.click(account);
  expect(screen.getByRole("button", { name: "Log Out" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "BrainDrive Settings" }));
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
  expect(onOpenProjectView).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Behavior" }));
  expect(onOpenProjectView).toHaveBeenCalledWith("expert");
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
});

it.each([false, true])("activates the account menu and sidebar toggle independently (collapsed: %s)", async (isCollapsed) => {
  const user = userEvent.setup();
  const onToggle = vi.fn();
  const onOpenSettings = vi.fn();
  const onSelectProject = vi.fn();
  render(<Sidebar {...baseProps} isCollapsed={isCollapsed} selectedProjectId="finance" selectedProject={mockProjects[0]!}
    onToggle={onToggle} onOpenSettings={onOpenSettings} onSelectProject={onSelectProject} />);
  const toggle = screen.getByRole("button", { name: isCollapsed ? "Expand sidebar" : "Collapse sidebar" });
  const account = screen.getByRole("button", { name: "Open profile menu" });
  await user.click(toggle);
  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "BrainDrive Settings" })).not.toBeInTheDocument();
  await user.hover(account);
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Open profile menu");
  account.focus();
  await user.keyboard("{Enter}");
  expect(account).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "BrainDrive Settings" })).toBeVisible();
  expect(onToggle).toHaveBeenCalledTimes(1);
  await user.click(toggle);
  expect(onToggle).toHaveBeenCalledTimes(2);
  expect(account).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: "BrainDrive Settings" })).not.toBeInTheDocument();
  expect(onOpenSettings).not.toHaveBeenCalled();
  expect(onSelectProject).not.toHaveBeenCalled();
});

it.each([false, true])("opens the account menu with Space and restores trigger focus on Escape (collapsed: %s)", async (isCollapsed) => {
  const user = userEvent.setup();
  const onToggle = vi.fn();
  render(<Sidebar {...baseProps} isCollapsed={isCollapsed} onToggle={onToggle} />);
  const account = screen.getByRole("button", { name: "Open profile menu" });
  const toggle = screen.getByRole("button", { name: isCollapsed ? "Expand sidebar" : "Collapse sidebar" });
  (isCollapsed ? toggle : account).focus();
  await user.tab();
  expect(isCollapsed ? account : toggle).toHaveFocus();
  account.focus();
  await user.keyboard(" ");
  expect(account).toHaveAttribute("aria-expanded", "true");
  screen.getByRole("button", { name: "BrainDrive Settings" }).focus();
  await user.keyboard("{Escape}");
  expect(account).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: "BrainDrive Settings" })).not.toBeInTheDocument();
  expect(account).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("button", { name: "BrainDrive Settings" })).toBeInTheDocument();
  await user.keyboard("{Enter}");
  expect(account).toHaveAttribute("aria-expanded", "false");
  expect(onToggle).not.toHaveBeenCalled();
});
