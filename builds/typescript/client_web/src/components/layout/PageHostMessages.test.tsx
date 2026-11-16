import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as gateway from "@/api/gateway-adapter";
import { AI_NOTICE, isRetiredPage, mockAddPage, noteFirstMessage, resetExpertsMock, startInstallStep, submitPluginFile, uniquePageName, usePageSetup } from "@/api/experts";
import PageHostMessages from "./PageHostMessages";

vi.mock("@/api/gateway-adapter", () => ({ createProject: vi.fn() }));

const renamePage = vi.fn(async () => undefined);
function Harness({ name = "New page", taken = [] as string[] }: { name?: string; taken?: string[] }) {
  const project = { id: "p1", name };
  const setup = usePageSetup(project);
  return <PageHostMessages project={project} setup={setup} takenNames={taken} renamePage={renamePage} />;
}
async function addPage() { await act(async () => { await mockAddPage(); }); }
async function submit(name: string, route: "forum" | "elsewhere" = "forum") { await act(async () => { await submitPluginFile("p1", name, route); }); }

beforeEach(() => {
  resetExpertsMock(); renamePage.mockClear(); vi.mocked(gateway.createProject).mockClear();
  vi.mocked(gateway.createProject).mockResolvedValue({ id: "p1", name: "New page", icon: "folder", conversationId: null });
});

it("opens with fixed BrainDrive text and exactly two buttons, with no model needed", async () => {
  render(<Harness />); await addPage();
  expect(screen.getByText(/create an Expert for this page, or install one/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Create an Expert" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Install an Expert" })).toBeVisible();
  expect(screen.getByText(/Create builds a new Expert by talking it through/)).toBeVisible();
  expect(screen.getByLabelText("From BrainDrive")).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Choose (plugin file|file from the forum)$/ })).not.toBeInTheDocument();
});

it("Create an Expert attaches the BrainDrive plugin and a Behavior plugin, with no try-now or question count", async () => {
  const user = userEvent.setup();
  let seen: ReturnType<typeof usePageSetup>;
  function Probe() { seen = usePageSetup({ id: "p1", name: "New page" }); return null; }
  render(<><Harness /><Probe /></>); await addPage();
  await user.click(screen.getByRole("button", { name: "Create an Expert" }));
  expect(screen.getByText(/Let's create your Expert\. Its starting instructions are in this page's Settings/)).toBeVisible();
  expect(seen!.expert?.name).toBe("My Expert");
  expect(seen!.plugins.map((plugin) => plugin.name)).toEqual(["My Expert", "BrainDrive"]);
  expect(seen!.plugins[1]!.source).toBe("included with BrainDrive");
  expect(screen.queryByText(/try it now|questions/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Choose (plugin file|file from the forum)$/ })).not.toBeInTheDocument();
});

it("Install an Expert leads with the forum and keeps other sources behind a smaller option", async () => {
  const user = userEvent.setup();
  render(<Harness />); await addPage();
  await user.click(screen.getByRole("button", { name: "Install an Expert" }));
  expect(screen.getByText("Install an Expert from the BrainDrive community forum.")).toBeVisible();
  expect(screen.getByText(/have been reviewed by the BrainDrive team/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Choose file from the forum" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Install from somewhere else" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: "Choose plugin file" })).not.toBeInTheDocument();
  expect(screen.queryByText(/coming later/)).not.toBeInTheDocument();
  expect(screen.queryByText(/drop/i)).not.toBeInTheDocument();
});

it("installing from somewhere else needs the warning read and the at-my-own-risk tick first", async () => {
  const user = userEvent.setup();
  render(<Harness />); await addPage();
  await user.click(screen.getByRole("button", { name: "Install an Expert" }));
  await user.click(screen.getByRole("button", { name: "Install from somewhere else" }));
  const group = screen.getByRole("group", { name: "Install from somewhere else" });
  expect(group).toHaveTextContent("BrainDrive has not reviewed files from anywhere else, including GitHub.");
  expect(group).toHaveTextContent("It can read all of Your Memory.");
  expect(group).toHaveTextContent("Only install it if you trust who made it.");
  expect(screen.getByRole("button", { name: "Choose plugin file" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "I understand. Install at my own risk." }));
  expect(screen.getByRole("button", { name: "Choose plugin file" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Choose plugin file" }));
  fireEvent.change(screen.getByLabelText("Plugin file"), { target: { files: [new File(["x"], "garden-helper.zip")] } });
  const card = await screen.findByLabelText("From BrainDrive: review before installing");
  expect(card).toHaveTextContent("Somewhere else. Not reviewed by BrainDrive.");
  expect(card).toHaveTextContent("Warning: BrainDrive has not reviewed this.");
});

it("says a forum file's source is the owner's word, and keeps the source on the installed Expert", async () => {
  const user = userEvent.setup();
  let seen: ReturnType<typeof usePageSetup>;
  function Probe() { seen = usePageSetup({ id: "p1", name: "New page" }); return null; }
  render(<><Harness /><Probe /></>); await addPage();
  await user.click(screen.getByRole("button", { name: "Install an Expert" }));
  await user.click(screen.getByRole("button", { name: "Choose file from the forum" }));
  fireEvent.change(screen.getByLabelText("Plugin file"), { target: { files: [new File(["x"], "garden-helper.zip")] } });
  const card = await screen.findByLabelText("From BrainDrive: review before installing");
  expect(card).toHaveTextContent("The BrainDrive forum, as you chose. BrainDrive cannot confirm where a file came from.");
  expect(card).not.toHaveTextContent("Warning: BrainDrive has not reviewed this.");
  await user.click(screen.getByRole("button", { name: "Install" }));
  await waitFor(() => expect(seen!.plugins[0]!.route).toBe("forum"));
});

it("does not check a file that arrives before the owner has said where it came from", async () => {
  const user = userEvent.setup();
  render(<Harness />); await addPage();
  await user.click(screen.getByRole("button", { name: "Install an Expert" }));
  await act(async () => { await submitPluginFile("p1", "garden-helper.zip"); });
  expect(await screen.findByRole("alert")).toHaveTextContent("First choose where this file came from");
  expect(screen.queryByLabelText("From BrainDrive: review before installing")).not.toBeInTheDocument();
});

it("checks the file first and shows a one-line plain reason when it fails", async () => {
  const user = userEvent.setup();
  render(<Harness />); await addPage();
  await user.click(screen.getByRole("button", { name: "Install an Expert" }));
  await submit("notes.txt");
  expect(await screen.findByRole("alert")).toHaveTextContent("This is not a valid ZIP file.");
  await submit("my-scripts.zip");
  expect(screen.getAllByRole("alert")[1]).toHaveTextContent("Scripts are not supported in this version.");
  expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
});

it("takes a chosen file from the button into the check", async () => {
  const user = userEvent.setup();
  render(<Harness />); await addPage();
  await user.click(screen.getByRole("button", { name: "Install an Expert" }));
  fireEvent.change(screen.getByLabelText("Plugin file"), { target: { files: [new File(["x"], "start-a-business.zip")] } });
  expect(await screen.findByRole("heading", { name: "Start a Business" })).toBeVisible();
});

it("shows a BrainDrive review card with summary first and every file in full, then installs on THIS page", async () => {
  const user = userEvent.setup();
  render(<Harness taken={["Start a Business"]} />); await addPage();
  await user.click(screen.getByRole("button", { name: "Install an Expert" }));
  await submit("start-a-business.zip");
  const card = await screen.findByLabelText("From BrainDrive: review before installing");
  expect(card).toHaveTextContent("unverified");
  expect(card).toHaveTextContent("MIT");
  expect(card).toHaveTextContent("What it adds");
  expect(card).toHaveTextContent("These instructions will become this page's instructions.");
  expect(screen.queryByText("templates/spec.md")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "See every file" }));
  expect(screen.getByText("templates/spec.md")).toBeVisible();
  expect(screen.getByText(/Ask one question at a time/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Install" }));
  await waitFor(() => expect(renamePage).toHaveBeenCalledWith("p1", "Start a Business 2"));
  expect(gateway.createProject).toHaveBeenCalledTimes(1); // no new page
  expect(await screen.findByText(/Installed Start a Business 2/)).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Choose (plugin file|file from the forum)$/ })).not.toBeInTheDocument();
});

it("Cancel installs nothing and offers the two buttons again", async () => {
  const user = userEvent.setup();
  render(<Harness />); await addPage();
  await user.click(screen.getByRole("button", { name: "Install an Expert" }));
  await submit("start-a-business.zip");
  await user.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(renamePage).not.toHaveBeenCalled();
  expect(screen.getByText("Nothing was installed.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Create an Expert" })).toBeVisible();
});

it("Add plugin adds a plugin to the current page only, and refuses an Expert file", async () => {
  const user = userEvent.setup();
  let seen: ReturnType<typeof usePageSetup>;
  function Probe() { seen = usePageSetup({ id: "p1", name: "Finance" }); return null; }
  render(<><Harness name="Finance" /><Probe /></>);
  await act(async () => { startInstallStep("p1", "plugin"); });
  expect(screen.getByText("Add a plugin from the BrainDrive community forum.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Choose file from the forum" })).toBeVisible();
  await submit("expert-pack.zip");
  expect(await screen.findByRole("alert")).toHaveTextContent("This is an Expert; install it on a new page.");
  await submit("research-helper.zip");
  await user.click(await screen.findByRole("button", { name: "Install" }));
  expect(renamePage).not.toHaveBeenCalled();
  expect(seen!.plugins.map((plugin) => plugin.name)).toContain("Research Helper");
});

it("shows the AI notice once, on the first message of a page with an Expert", async () => {
  const user = userEvent.setup();
  render(<Harness />); await addPage();
  await user.click(screen.getByRole("button", { name: "Create an Expert" }));
  expect(screen.queryByText(AI_NOTICE)).not.toBeInTheDocument();
  act(() => noteFirstMessage("p1", "New page"));
  act(() => noteFirstMessage("p1", "New page"));
  expect(screen.getAllByText(AI_NOTICE)).toHaveLength(1);
});

it("numbers a taken page name", () => {
  expect(uniquePageName("Start a Business", ["start a business", "Start a Business 2"])).toBe("Start a Business 3");
  expect(uniquePageName("Fresh", ["Other"])).toBe("Fresh");
});

it("retires the New Project page from navigation", () => {
  expect(isRetiredPage({ id: "new-project", name: "Your New Project" })).toBe(true);
  expect(isRetiredPage({ id: "x", name: "New project" })).toBe(true);
  expect(isRetiredPage({ id: "finance", name: "Finance" })).toBe(false);
});

it("treats the default pages as Experts with the BrainDrive plugin, and other pages as having none", () => {
  let finance: ReturnType<typeof usePageSetup>, other: ReturnType<typeof usePageSetup>;
  function Probe() { finance = usePageSetup({ id: "finance", name: "Finance" }); other = usePageSetup({ id: "garden", name: "Garden" }); return null; }
  render(<Probe />);
  expect(finance!.expert?.name).toBe("Finance");
  expect(finance!.plugins.map((plugin) => plugin.name)).toEqual(["BrainDrive"]);
  expect(other).toBeUndefined();
});
