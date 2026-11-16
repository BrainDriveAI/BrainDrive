import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetExpertsMock, type PageSetup } from "@/api/experts";
import ProjectContentView, { pastedTableToMarkdown } from "./ProjectContentView";

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
  const shortcuts = within(screen.getByRole("region", { name: "Goals, Plan and Journal" }));
  expect(shortcuts.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Your Goals", "Your Journal"]);
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
  expect(screen.queryByRole("region", { name: "Goals, Plan and Journal" })).not.toBeInTheDocument();
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

describe("Goals, Plan and Journal shortcuts", () => {
  const all = [file("brief-0.md"), file("journal.md"), file("plan.md"), file("spec.md")];
  const region = (name: string) => within(screen.getByRole("region", { name }));

  it("shows Goals, Plan and Journal at the top, in that order, apart from Your work", () => {
    render(<ProjectContentView {...props} view="files" files={all} />);
    expect(region("Goals, Plan and Journal").getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Your Goals", "Your Plan", "Your Journal"]);
    expect(region("Your work").getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Brief 0"]);
  });

  it("shows only the shortcuts whose files exist", () => {
    render(<ProjectContentView {...props} view="files" files={[file("journal.md")]} />);
    expect(region("Goals, Plan and Journal").getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Your Journal"]);
  });

  it("has no pin or unpin control", () => {
    render(<ProjectContentView {...props} view="files" files={all} />);
    expect(screen.queryByRole("button", { name: /^(Pin|Unpin) / })).not.toBeInTheDocument();
  });

  it("opens the file when a shortcut is chosen", async () => {
    const onOpenFile = vi.fn();
    render(<ProjectContentView {...props} view="files" files={all} onOpenFile={onOpenFile} />);
    await userEvent.click(screen.getByRole("button", { name: "Your Plan" }));
    expect(onOpenFile).toHaveBeenCalledWith(all[2]);
  });
});

const setup = (over: Partial<PageSetup> = {}): PageSetup => ({ events: [], installStep: null, noticeShown: false, expert: null, plugins: [], ...over });

it("shows what an installed Expert comes with in Page Settings, with no plugin list and no Add plugin", () => {
  render(<ProjectContentView {...props} view="plugins" setup={setup({
    expert: { name: "Start a Business", files: { "instructions.md": "Be helpful." } },
    plugins: [
      { id: "behavior", name: "Start a Business", source: "installed from a plugin file", skills: [] },
      { id: "p", name: "Research", source: "installed from a plugin file", skills: [{ name: "Find sources", needs: "Needs web search (not available yet)" }] },
    ],
  })} />);
  const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
  expect(headings).toEqual(["What Start a Business comes with"]);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Page Settings");
  expect(screen.getAllByText("Installed from a plugin file", { exact: false }).length).toBeGreaterThan(0);
  expect(screen.queryByText("Research")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add plugin" })).not.toBeInTheDocument();
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
  const onStart = vi.fn();
  render(<ProjectContentView {...props} view="plugins" onStartExpert={onStart} onInstallExpert={vi.fn()} />);
  expect(screen.queryByLabelText("About this Expert")).not.toBeInTheDocument();
  expect(screen.queryByText("Advanced")).not.toBeInTheDocument();
  expect(screen.getByText("This page has no Expert yet.")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Create an Expert" }));
  expect(onStart).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Add plugin" })).not.toBeInTheDocument();
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

it("shows where an Expert came from and no access setting", () => {
  render(<ProjectContentView {...props} view="plugins" setup={setup({ expert: { name: "Finance", files: {}, backend: true } })} />);
  const about = screen.getByLabelText("About this Expert");
  expect(about).toHaveTextContent("OriginIncluded with BrainDrive");
  expect(about).toHaveTextContent("Creatorby BrainDrive");
  expect(about).toHaveTextContent("LicenseMIT");
  expect(screen.queryByRole("heading", { name: "Access" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
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

describe("adding a file by pasting text", () => {
  const user = () => userEvent.setup();
  const open = async (onCreateFile = vi.fn().mockResolvedValue(undefined), files = [file("spec.md")]) => {
    render(<ProjectContentView {...props} view="files" files={files} onCreateFile={onCreateFile} />);
    await userEvent.click(screen.getByRole("button", { name: "New file" }));
    return onCreateFile;
  };

  it("offers New file only when the page can save one", () => {
    render(<ProjectContentView {...props} view="files" />);
    expect(screen.queryByRole("button", { name: "New file" })).not.toBeInTheDocument();
  });

  it("saves the pasted text, exactly, to the page's added folder and closes", async () => {
    const onCreateFile = await open();
    await userEvent.type(screen.getByLabelText("File name"), "Bank Notes: March!");
    await userEvent.click(screen.getByLabelText("Paste or type your text"));
    await userEvent.paste("  Rent 1200\nFood 400  ");
    await userEvent.click(screen.getByRole("button", { name: "Save file" }));
    expect(onCreateFile).toHaveBeenCalledWith("documents/start-a-business/added/bank-notes-march.md", "  Rent 1200\nFood 400  ");
    expect(screen.queryByRole("form", { name: "New file" })).not.toBeInTheDocument();
  });

  it("asks for a name and some text before saving", async () => {
    const onCreateFile = await open();
    await userEvent.click(screen.getByRole("button", { name: "Save file" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give the file a name");
    await userEvent.type(screen.getByLabelText("File name"), "notes");
    await userEvent.click(screen.getByRole("button", { name: "Save file" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Paste or type some text first");
    expect(onCreateFile).not.toHaveBeenCalled();
  });

  it("never overwrites: a name already in use is refused", async () => {
    const onCreateFile = await open(undefined, [{ name: "notes.md", path: "documents/start-a-business/added/notes.md" }]);
    await userEvent.type(screen.getByLabelText("File name"), "Notes");
    await userEvent.type(screen.getByLabelText("Paste or type your text"), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Save file" }));
    expect(screen.getByRole("alert")).toHaveTextContent("already exists");
    expect(onCreateFile).not.toHaveBeenCalled();
  });

  it("keeps the text and says so when the save fails", async () => {
    await open(vi.fn().mockRejectedValue(new Error("offline")));
    await userEvent.type(screen.getByLabelText("File name"), "notes");
    await userEvent.type(screen.getByLabelText("Paste or type your text"), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Save file" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved");
    expect(screen.getByLabelText("Paste or type your text")).toHaveValue("hello");
  });

  it("cancels without saving", async () => {
    const onCreateFile = await open();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "New file" })).not.toBeInTheDocument();
    expect(onCreateFile).not.toHaveBeenCalled();
    void user;
  });

  it("turns pasted spreadsheet cells into a table and leaves other text alone", async () => {
    await open();
    await userEvent.click(screen.getByLabelText("Paste or type your text"));
    await userEvent.paste("Item\tCost\nRent\t1200\nFood\t400\n");
    expect(screen.getByLabelText("Paste or type your text")).toHaveValue("| Item | Cost |\n| --- | --- |\n| Rent | 1200 |\n| Food | 400 |\n");
    expect(pastedTableToMarkdown("just a sentence\nand another")).toBeNull();
    expect(pastedTableToMarkdown("one\tline only")).toBeNull();
    expect(pastedTableToMarkdown("a|b\tc\nd\te\tf")).toBe("| a\\|b | c |  |\n| --- | --- | --- |\n| d | e | f |");
  });

  it("lists a file the owner added in Your work with a You added badge, never as a setup file", () => {
    render(<ProjectContentView {...props} view="files" files={[{ name: "budget-template.md", path: "documents/start-a-business/added/budget-template.md" }]} />);
    const work = within(screen.getByRole("region", { name: "Your work" }));
    expect(work.getByRole("button", { name: "Budget Template" })).toHaveTextContent("You added");
  });
});

it("shows in Page Settings when an installed Expert was not reviewed by BrainDrive", () => {
  render(<ProjectContentView {...props} view="plugins" setup={setup({
    expert: { name: "Garden", files: {} },
    plugins: [
      { id: "behavior", name: "Garden", source: "installed from a plugin file", skills: [], route: "elsewhere" },
    ],
  })} />);
  expect(screen.getByText("Installed from a plugin file. Not reviewed by BrainDrive.")).toBeVisible();
});

it("shows in Page Settings when an installed Expert came from the BrainDrive forum", () => {
  render(<ProjectContentView {...props} view="plugins" setup={setup({
    expert: { name: "Garden", files: {} },
    plugins: [{ id: "behavior", name: "Garden", source: "installed from a plugin file", skills: [], route: "forum" }],
  })} />);
  expect(screen.getByText("Installed from a plugin file from the BrainDrive forum")).toBeVisible();
});

it("offers Share this Expert in Page Settings, above Delete page, only on a page with an Expert", async () => {
  const onShareExpert = vi.fn();
  const { unmount } = render(<ProjectContentView {...props} view="plugins" onShareExpert={onShareExpert} onDeletePage={vi.fn()} setup={setup({ expert: { name: "Finance", files: {}, backend: true } })} />);
  const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
  expect(headings.slice(-2)).toEqual(["Share this Expert", "Delete page"]);
  await userEvent.click(screen.getByRole("button", { name: "Share this Expert" }));
  expect(onShareExpert).toHaveBeenCalled();
  unmount();
  render(<ProjectContentView {...props} view="plugins" onShareExpert={onShareExpert} onDeletePage={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Share this Expert" })).not.toBeInTheDocument();
});

it("lists every file a default Expert comes with in Page Settings, methods and reference files included", async () => {
  const onOpenFile = vi.fn();
  const files = [file("AGENT.md"), file("run-interview.md"), file("run-planning.md"), file("run-journal.md"), file("spec.md")];
  render(<ProjectContentView {...props} view="plugins" files={files} onOpenFile={onOpenFile} setup={setup({ expert: { name: "Start a Business", files: {}, backend: true } })} />);
  for (const name of ["Instructions", "Interview", "Planning", "Journal"]) expect(screen.getByRole("button", { name })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Your Goals" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Planning" }));
  expect(onOpenFile).toHaveBeenCalledWith(files[2]);
});

describe("About this Expert and Advanced (AC-4.1, AC-8.8)", () => {
  const installed = (over: Partial<PageSetup["plugins"][number]> = {}) => setup({
    expert: { name: "Garden Planner", files: { "SKILL.md": "---\nname: garden-plan\ndescription: Plans a garden.\n---\nHelp.", "templates/spec.md": "# Spec" } },
    plugins: [{ id: "behavior", name: "Garden Planner", source: "installed from a plugin file", skills: [], route: "forum", creator: "Sample Author", license: "MIT", fileName: "garden-planner-expert.zip", version: "1.0.0", installedAt: "2026-11-16T12:00:00Z", ...over }],
  });

  it("shows creator, license, version, install date and skills for an installed Expert", () => {
    render(<ProjectContentView {...props} view="plugins" setup={installed()} />);
    const about = screen.getByLabelText("About this Expert");
    expect(about).toHaveTextContent("Creatorby Sample Author");
    expect(about).toHaveTextContent("LicenseMIT");
    expect(about).toHaveTextContent("Version1.0.0");
    expect(about).toHaveTextContent("InstalledNovember 16, 2026");
    expect(about).toHaveTextContent("Skillsgarden-plan");
  });

  it("says by unknown when the plugin names no creator", () => {
    render(<ProjectContentView {...props} view="plugins" setup={installed({ creator: "" })} />);
    expect(screen.getByLabelText("About this Expert")).toHaveTextContent("Creatorby unknown");
  });

  it("says made by you, with no license, version or install date, for an owner-made Expert", () => {
    render(<ProjectContentView {...props} view="plugins" setup={setup({ expert: { name: "My Expert", files: { "instructions.md": "Be helpful." } } })} />);
    const about = screen.getByLabelText("About this Expert");
    expect(about).toHaveTextContent("Creatormade by you");
    expect(about).not.toHaveTextContent(/License|Version|Installed/);
  });

  it("keeps the install record under a closed Advanced section", async () => {
    render(<ProjectContentView {...props} view="plugins" setup={installed()} />);
    const record = screen.getByText("Install record");
    expect(record).not.toBeVisible();
    await userEvent.click(screen.getByText("Advanced"));
    expect(record).toBeVisible();
    expect(screen.getByText("installed from a plugin file (garden-planner-expert.zip)")).toBeVisible();
  });
});
