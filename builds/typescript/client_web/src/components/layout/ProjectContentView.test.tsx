import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetExpertsMock, type PageSetup } from "@/api/experts";
import ProjectContentView from "./ProjectContentView";

vi.mock("@/api/gateway-adapter", () => ({ createProject: vi.fn() }));
const props = {
  project: { id: "start-a-business", name: "Start A Business", icon: "briefcase", conversationId: null },
  files: [], isLoading: false, onOpenFile: vi.fn(), onBack: vi.fn(),
};
const file = (name: string) => ({ name, path: `documents/start-a-business/${name}` });

it.each([0, 1, 3])("organizes %i outputs separately from direction, progress, and setup", async (count) => {
  const files = Array.from({ length: count }, (_, i) => file(`brief-${i}.md`));
  const onOpenFile = vi.fn();
  render(<ProjectContentView {...props} view="files" files={[file("spec.md"), file("journal.md"), file("AGENT.md"), ...files]} onOpenFile={onOpenFile} />);
  const outputs = within(screen.getByRole("region", { name: "Your work" }));
  const pinned = within(screen.getByRole("region", { name: "Pinned" }));
  expect(pinned.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Your Goals", "Unpin Your Goals", "Your Journal", "Unpin Your Journal"]);
  if (!count) expect(outputs.getByText(/No outputs saved yet/)).toBeVisible();
  else {
    expect(outputs.getAllByRole("button", { name: /^Brief/ })).toHaveLength(count);
    await userEvent.click(outputs.getAllByRole("button", { name: /^Brief/ })[0]!);
    expect(onOpenFile).toHaveBeenCalledWith(files[0]);
  }
  expect(outputs.queryByRole("button", { name: /Journal|Goals/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Agent Instructions/ })).not.toBeInTheDocument();
});

it("shows an honest empty workspace without creating files or fake To-do synchronization", () => {
  render(<ProjectContentView {...props} view="files" />);
  expect(screen.queryByRole("region", { name: "Pinned" })).not.toBeInTheDocument();
  expect(screen.getByText(/No outputs saved yet/)).toBeVisible();
  expect(screen.queryByRole("button", { name: /Goals|Plan|To-do|Journal/ })).not.toBeInTheDocument();
});

it("distinguishes failed file loading from an empty workspace", () => {
  render(<ProjectContentView {...props} view="files" hasFilesError />);
  expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
  expect(screen.queryByText(/No outputs saved yet/)).not.toBeInTheDocument();
});

it("opens an existing To-do file with its original metadata", async () => {
  const todo = file("todo.md");
  const onOpenFile = vi.fn();
  render(<ProjectContentView {...props} view="files" files={[todo]} onOpenFile={onOpenFile} />);
  await userEvent.click(screen.getByRole("button", { name: "To-do" }));
  expect(onOpenFile).toHaveBeenCalledWith(todo);
  expect(screen.queryByText(/isn’t set up/)).not.toBeInTheDocument();
});

describe("pinning files", () => {
  const all = [file("spec.md"), file("plan.md"), file("journal.md"), file("brief-0.md")];
  const region = (name: string) => within(screen.getByRole("region", { name }));
  beforeEach(() => localStorage.clear());

  it("pins Goals, Plan and Journal by default, in order", () => {
    render(<ProjectContentView {...props} view="files" files={all} />);
    expect(region("Pinned").getAllByRole("button", { name: /^Your / }).map((b) => b.getAttribute("aria-label"))).toEqual(["Your Goals", "Your Plan", "Your Journal"]);
    expect(region("Your work").getByRole("button", { name: "Pin Brief 0" })).toBeVisible();
  });

  it("moves an unpinned Your Plan into Your work and hides Pinned when empty", async () => {
    render(<ProjectContentView {...props} view="files" files={all} />);
    await userEvent.click(screen.getByRole("button", { name: "Unpin Your Plan" }));
    expect(region("Pinned").queryByRole("button", { name: "Your Plan" })).not.toBeInTheDocument();
    expect(region("Your work").getByRole("button", { name: "Your Plan" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Unpin Your Goals" }));
    await userEvent.click(screen.getByRole("button", { name: "Unpin Your Journal" }));
    expect(screen.queryByRole("region", { name: "Pinned" })).not.toBeInTheDocument();
  });

  it("pins an output to the end of Pinned without opening it", async () => {
    const onOpenFile = vi.fn();
    render(<ProjectContentView {...props} view="files" files={all} onOpenFile={onOpenFile} />);
    await userEvent.click(screen.getByRole("button", { name: "Pin Brief 0" }));
    expect(region("Pinned").getAllByRole("button", { name: /^(Your |Brief)/ }).map((b) => b.getAttribute("aria-label"))).toEqual(["Your Goals", "Your Plan", "Your Journal", "Brief 0"]);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("keeps pin state after remount for the same page only", async () => {
    const { unmount } = render(<ProjectContentView {...props} view="files" files={all} />);
    await userEvent.click(screen.getByRole("button", { name: "Unpin Your Plan" }));
    await userEvent.click(screen.getByRole("button", { name: "Pin Brief 0" }));
    unmount();
    render(<ProjectContentView {...props} view="files" files={all} />);
    expect(region("Pinned").queryByRole("button", { name: "Your Plan" })).not.toBeInTheDocument();
    expect(region("Pinned").getByRole("button", { name: "Brief 0" })).toBeVisible();
    unmount();
    cleanup();
    render(<ProjectContentView {...props} project={{ ...props.project, id: "other" }} view="files" files={all.map((f) => ({ ...f, path: f.path.replace("start-a-business", "other") }))} />);
    expect(region("Pinned").getByRole("button", { name: "Your Plan" })).toBeVisible();
  });
});

const setup = (over: Partial<PageSetup> = {}): PageSetup => ({ events: [], installStep: null, noticeShown: false, expert: null, plugins: [], ...over });

it("pins Behavior first in Plugins for an Expert page, then lists other plugins with their skills", () => {
  render(<ProjectContentView {...props} view="plugins" onAddPlugin={vi.fn()} setup={setup({
    expert: { name: "Start a Business", files: { "instructions.md": "Be helpful." } },
    plugins: [
      { id: "behavior", name: "Start a Business", source: "installed from a plugin file", skills: [] },
      { id: "p", name: "Research", source: "installed from a plugin file", skills: [{ name: "Find sources", needs: "Needs web search (not available yet)" }] },
    ],
  })} />);
  const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
  expect(headings).toEqual(["Access", "What Start a Business comes with", "Plugins it uses"]);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Page Settings");
  expect(screen.getAllByText("Installed from a plugin file", { exact: false }).length).toBeGreaterThan(0);
  expect(screen.getByText("Research")).toBeVisible();
  expect(screen.getByText("Needs web search (not available yet)")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Remove|Delete/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/Connections|Agents|Coming later/)).not.toBeInTheDocument();
});

it("edits and saves a built Expert's instructions from the Behavior entry", async () => {
  const user = userEvent.setup();
  resetExpertsMock();
  render(<ProjectContentView {...props} view="plugins" setup={setup({ expert: { name: "My Expert", files: { "instructions.md": "Original" } } })} />);
  expect(screen.queryByText("SKILL.md")).not.toBeInTheDocument();
  expect(screen.getByText("How this Expert works with you")).toBeVisible();
  expect(screen.getByText("No templates saved yet.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Instructions" }));
  const editor = screen.getByLabelText("Edit instructions.md");
  expect(editor).toHaveValue("Original");
  await user.clear(editor); await user.type(editor, "Changed");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("status")).toHaveTextContent("Saved");
});

it("shows no Behavior entry on a page without an Expert, and how to start one", async () => {
  const onStart = vi.fn(), onAdd = vi.fn();
  render(<ProjectContentView {...props} view="plugins" onStartExpert={onStart} onInstallExpert={vi.fn()} onAddPlugin={onAdd} />);
  expect(screen.queryByRole("heading", { name: "Access" })).not.toBeInTheDocument();
  expect(screen.getByText("This page has no Expert yet.")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Create an Expert" }));
  expect(onStart).toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Add plugin" }));
  expect(onAdd).toHaveBeenCalled();
});

it("opens the real instruction and template files of a page that comes with BrainDrive", async () => {
  const files = ["AGENT.md", "business-idea-brief-template.md"].map(file);
  const onOpenFile = vi.fn();
  render(<ProjectContentView {...props} project={{ ...props.project, id: "start-a-business", name: "Finance" }} view="plugins" files={files} onOpenFile={onOpenFile}
    setup={setup({ expert: { name: "Finance", files: {}, backend: true }, plugins: [{ id: "braindrive", name: "BrainDrive", source: "included with BrainDrive", skills: [{ name: "Journal method" }] }] })} />);
  expect(screen.getByRole("heading", { name: "What Finance comes with" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Instructions" }));
  expect(onOpenFile).toHaveBeenLastCalledWith(files[0]);
  expect(screen.getAllByText("included with BrainDrive", { exact: false }).length).toBeGreaterThan(0);
});

it("lists installed template files as a Templates card, matching the default-page pattern", async () => {
  const user = userEvent.setup();
  resetExpertsMock();
  render(<ProjectContentView {...props} view="plugins" setup={setup({ expert: { name: "Start a Business", files: { "SKILL.md": "Help.", "templates/spec.md": "# Spec" } } })} />);
  expect(screen.queryByText("No templates saved yet.")).not.toBeInTheDocument();
  expect(screen.queryByText("SKILL.md")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "spec.md" }));
  expect(screen.getByLabelText("Edit templates/spec.md")).toHaveValue("# Spec");
});

it("shows a mock Access section with a Change choice for an Expert that comes with BrainDrive", async () => {
  render(<ProjectContentView {...props} view="plugins" setup={setup({ expert: { name: "Finance", files: {}, backend: true } })} />);
  expect(screen.getByText("Included with BrainDrive")).toBeVisible();
  expect(screen.getByText(/Anything relevant from the rest of your BrainDrive, through Your Agent/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Change" }));
  for (const name of ["Yes", "Ask me each time", "Only this page"]) expect(screen.getByRole("radio", { name })).toBeVisible();
});

it("puts Delete page at the bottom of Page Settings, after everything else", async () => {
  const onDeletePage = vi.fn();
  render(<ProjectContentView {...props} view="plugins" onDeletePage={onDeletePage} setup={setup({
    expert: { name: "Start a Business", files: { "instructions.md": "Be helpful." } },
    plugins: [{ id: "behavior", name: "Start a Business", source: "installed from a plugin file", skills: [] }],
  })} />);
  const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
  expect(headings[headings.length - 1]).toBe("Delete page");
  expect(screen.getByText(/Your files stay in your Memory folder/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Delete page" }));
  expect(onDeletePage).toHaveBeenCalledTimes(1);
});

it("shows no Delete page in Your Files", () => {
  render(<ProjectContentView {...props} view="files" onDeletePage={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Delete page" })).not.toBeInTheDocument();
});

it("pins a Journal that appears later, but not one the owner unpinned before", async () => {
  localStorage.clear();
  const user = userEvent.setup();
  const plan = { name: "plan.md", path: "documents/start-a-business/plan.md" };
  const journal = { name: "journal.md", path: "documents/start-a-business/journal.md" };
  const { unmount } = render(<ProjectContentView {...props} view="files" files={[plan]} />);
  await user.click(screen.getByRole("button", { name: "Unpin Your Plan" }));
  await user.click(screen.getByRole("button", { name: "Pin Your Plan" }));
  unmount();
  const second = render(<ProjectContentView {...props} view="files" files={[plan, journal]} />);
  const pinnedNames = () => screen.queryAllByRole("button", { name: /^Unpin / }).map((b) => b.getAttribute("aria-label"));
  expect(pinnedNames()).toContain("Unpin Your Journal");
  await user.click(screen.getByRole("button", { name: "Unpin Your Journal" }));
  second.unmount();
  render(<ProjectContentView {...props} view="files" files={[plan, journal]} />);
  expect(pinnedNames()).not.toContain("Unpin Your Journal");
});
