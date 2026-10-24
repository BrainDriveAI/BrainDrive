import { render, screen, within } from "@testing-library/react";
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
  const direction = within(screen.getByRole("region", { name: "Direction & progress" }));
  expect(direction.getByRole("button", { name: "Goals" })).toBeVisible();
  expect(direction.getByRole("button", { name: "Journal" })).toBeVisible();
  if (!count) expect(outputs.getByText(/No outputs saved yet/)).toBeVisible();
  else {
    expect(outputs.getAllByRole("button", { name: /Brief/ })).toHaveLength(count);
    await userEvent.click(outputs.getAllByRole("button", { name: /Brief/ })[0]!);
    expect(onOpenFile).toHaveBeenCalledWith(files[0]);
  }
  expect(outputs.queryByRole("button", { name: /Journal|Goals/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Agent Instructions/ })).not.toBeInTheDocument();
});

it("shows an honest empty workspace without creating files or fake To-do synchronization", () => {
  render(<ProjectContentView {...props} view="files" />);
  expect(screen.getByText(/No direction or progress files saved yet/)).toBeVisible();
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
  expect(headings[0]).toBe("Behavior · Start a Business");
  expect(screen.getByText("Research")).toBeVisible();
  expect(screen.getByText("Needs web search (not available yet)")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Remove|Delete/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/Connections|Agents|Coming later/)).not.toBeInTheDocument();
});

it("edits and saves a built Expert's instructions from the Behavior entry", async () => {
  const user = userEvent.setup();
  resetExpertsMock();
  render(<ProjectContentView {...props} view="plugins" setup={setup({ expert: { name: "My Expert", files: { "instructions.md": "Original" } } })} />);
  await user.click(screen.getByText("instructions.md"));
  const editor = screen.getByLabelText("Edit instructions.md");
  expect(editor).toHaveValue("Original");
  await user.clear(editor); await user.type(editor, "Changed");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("status")).toHaveTextContent("Saved");
});

it("shows no Behavior entry on a page without an Expert, and how to start one", async () => {
  const onStart = vi.fn(), onAdd = vi.fn();
  render(<ProjectContentView {...props} view="plugins" onStartExpert={onStart} onAddPlugin={onAdd} />);
  expect(screen.queryByRole("heading", { name: /Behavior ·/ })).not.toBeInTheDocument();
  expect(screen.getByText(/no Expert yet/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Start an Expert" }));
  expect(onStart).toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Add plugin" }));
  expect(onAdd).toHaveBeenCalled();
});

it("opens the real instruction and template files of a page that comes with BrainDrive", async () => {
  const files = ["AGENT.md", "business-idea-brief-template.md"].map(file);
  const onOpenFile = vi.fn();
  render(<ProjectContentView {...props} project={{ ...props.project, id: "start-a-business", name: "Finance" }} view="plugins" files={files} onOpenFile={onOpenFile}
    setup={setup({ expert: { name: "Finance", files: {}, backend: true }, plugins: [{ id: "braindrive", name: "BrainDrive", source: "included with BrainDrive", skills: [{ name: "Journal method" }] }] })} />);
  expect(screen.getByRole("heading", { name: "Behavior · Finance" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Instructions" }));
  expect(onOpenFile).toHaveBeenLastCalledWith(files[0]);
  expect(screen.getByText("included with BrainDrive", { exact: false })).toBeVisible();
});

const previewPath = "/tmp/sidebar-fixture/documents/start-a-business";
function configureLocalFolder() {
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_LOCAL_PREVIEW_ORIGIN", window.location.origin);
  vi.stubEnv("VITE_LOCAL_PREVIEW_PROJECT_ID", "start-a-business");
  vi.stubEnv("VITE_LOCAL_PREVIEW_FOLDER_PATH", previewPath);
}
afterEach(() => vi.unstubAllEnvs());

it("shows the configured local folder with direct Finder instructions and copies the full path", async () => {
  configureLocalFolder();
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(<ProjectContentView {...props} view="files" />);
  expect(screen.getByText("These files are saved on this computer. You can open the folder in Finder.")).toBeVisible();
  expect(screen.getByText(previewPath)).toBeVisible();
  expect(screen.getByText(/Go to Folder/)).toBeVisible();
  expect(screen.queryByText("Technical details")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Copy folder path" }));
  expect(copy).toHaveBeenCalledWith(previewPath);
  expect(await screen.findByRole("status")).toHaveTextContent("Folder path copied.");
  expect(screen.queryByRole("button", { name: /Open.*folder/ })).not.toBeInTheDocument();
});

it.each(["production", "different-origin", "different-project", "unconfigured"])("does not expose the preview host path for %s", (scenario) => {
  configureLocalFolder();
  if (scenario === "production") vi.stubEnv("DEV", false);
  if (scenario === "different-origin") vi.stubEnv("VITE_LOCAL_PREVIEW_ORIGIN", "https://example.com");
  if (scenario === "different-project") vi.stubEnv("VITE_LOCAL_PREVIEW_PROJECT_ID", "another-project");
  if (scenario === "unconfigured") vi.stubEnv("VITE_LOCAL_PREVIEW_FOLDER_PATH", "");
  render(<ProjectContentView {...props} view="files" />);
  expect(screen.queryByText(previewPath)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Copy folder path" })).not.toBeInTheDocument();
  expect(screen.getByText("documents/start-a-business/")).toBeVisible();
});

it("reports clipboard failure honestly", async () => {
  configureLocalFolder();
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
  render(<ProjectContentView {...props} view="files" />);
  await user.click(screen.getByRole("button", { name: "Copy folder path" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Copy is unavailable");
});
