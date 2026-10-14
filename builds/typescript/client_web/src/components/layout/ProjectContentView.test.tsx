import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getProjectSkills, listSkills } from "@/api/gateway-adapter";
import ProjectContentView from "./ProjectContentView";

vi.mock("@/api/gateway-adapter", () => ({ getProjectSkills: vi.fn(), listSkills: vi.fn() }));
const props = {
  project: { id: "start-a-business", name: "Start A Business", icon: "briefcase", conversationId: null },
  files: [], isLoading: false, onOpenFile: vi.fn(), onBack: vi.fn(), onOpenApps: vi.fn(),
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
  const todo = { ...file("todo.md"), readOnly: true };
  const onOpenFile = vi.fn();
  render(<ProjectContentView {...props} view="files" files={[todo]} onOpenFile={onOpenFile} />);
  await userEvent.click(screen.getByRole("button", { name: "To-do" }));
  expect(onOpenFile).toHaveBeenCalledWith(todo);
  expect(screen.queryByText(/isn’t set up/)).not.toBeInTheDocument();
});

it("shows only assigned skills and makes unavailable page capabilities explicit", async () => {
  vi.mocked(getProjectSkills).mockResolvedValue(["assigned"]);
  vi.mocked(listSkills).mockResolvedValue(["assigned", "other"].map((id) => ({ id, name: id, description: `${id} description`, scope: "global", version: 1, status: "active", tags: [], updated_at: "" })));
  render(<ProjectContentView {...props} view="tools" />);
  expect(await screen.findByText("assigned description")).toBeVisible();
  expect(getProjectSkills).toHaveBeenCalledWith("start-a-business");
  expect(screen.queryByText("other description")).not.toBeInTheDocument();
  expect(screen.getByText(/No credentials are copied or permissions granted here/)).toBeVisible();
  expect(screen.getByText(/Page agent assignments are not available/)).toBeVisible();
});

it("reports an unavailable skill lookup without claiming no assignments exist", async () => {
  vi.mocked(getProjectSkills).mockRejectedValue(new Error("offline"));
  vi.mocked(listSkills).mockResolvedValue([]);
  render(<ProjectContentView {...props} view="tools" />);
  expect(await screen.findByRole("status")).toHaveTextContent("could not be loaded");
  expect(screen.queryByText(/No registered skills assigned/)).not.toBeInTheDocument();
});

it("keeps owner-facing settings simple and technical files reachable without changing file metadata", async () => {
  const user = userEvent.setup();
  const files = ["AGENT.md", "AGENT-user.md", "business-idea-interview.md", "business-idea-brief-template.md", "business-idea-brief.md", "run-planning.md"].map(file);
  const onOpenFile = vi.fn();
  render(<ProjectContentView {...props} view="expert" files={files} onOpenFile={onOpenFile} />);
  expect(screen.getByRole("heading", { name: "Behavior" })).toBeVisible();
  expect(screen.getByText("See and change how your Expert helps you")).toBeVisible();
  expect(screen.getByRole("heading", { name: "What this Expert is for" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Your instructions" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Agent Instructions" }).closest("details")).not.toHaveAttribute("open");
  await user.click(screen.getByRole("button", { name: "Your instructions" }));
  expect(onOpenFile).toHaveBeenLastCalledWith(files[1]);
  await user.click(screen.getByRole("button", { name: "Business Idea Brief Template" }));
  expect(onOpenFile).toHaveBeenLastCalledWith(files[3]);
  expect(screen.queryByTitle("business-idea-brief.md")).not.toBeInTheDocument();
  await user.click(screen.getByText("Technical details", { selector: "summary" }));
  await user.click(screen.getByRole("button", { name: "Agent Instructions" }));
  expect(onOpenFile).toHaveBeenLastCalledWith(files[0]);
  expect(screen.queryByRole("button", { name: "Customize Agent Instructions" })).not.toBeInTheDocument();
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
