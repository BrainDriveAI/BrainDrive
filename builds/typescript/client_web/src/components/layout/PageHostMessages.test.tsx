import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as gateway from "@/api/gateway-adapter";
import { AI_NOTICE, MEMORY_NOTICE, exportFileList, isRetiredPage, mockAddPage, noteFirstMessage, proposeInstructionChange, resetExpertsMock, startExport, startInstallStep, submitPluginFile, uniquePageName, usePageSetup } from "@/api/experts";
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
  const forum = screen.getByRole("link", { name: "BrainDrive forum (community.braindrive.ai)" });
  expect(forum).toHaveAttribute("href", "https://community.braindrive.ai");
  expect(forum).toHaveAttribute("target", "_blank");
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
  expect(card).toHaveTextContent("Warning: BrainDrive has not reviewed this. Install it only if you trust who made it.");
  expect(card).not.toHaveTextContent("shape what the AI tells you");
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

it("Cancel on the install step closes it, installs nothing and offers the two buttons again", async () => {
  const user = userEvent.setup();
  render(<Harness />); await addPage();
  await user.click(screen.getByRole("button", { name: "Install an Expert" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Nothing was installed.")).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Choose (plugin file|file from the forum)$/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Install from somewhere else" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create an Expert" })).toBeVisible();
  await act(async () => { await submitPluginFile("p1", "garden-helper.zip", "forum"); });
  expect(screen.queryByLabelText("From BrainDrive: review before installing")).not.toBeInTheDocument();
});

it("Cancel on Add plugin leaves an Expert page as it was", async () => {
  const user = userEvent.setup();
  let seen: ReturnType<typeof usePageSetup>;
  function Probe() { seen = usePageSetup({ id: "finance", name: "Finance" }); return null; }
  function FinanceHarness() { const project = { id: "finance", name: "Finance" }; return <PageHostMessages project={project} setup={usePageSetup(project)} takenNames={[]} renamePage={renamePage} />; }
  render(<><FinanceHarness /><Probe /></>);
  await act(async () => { startInstallStep("finance", "plugin"); });
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Nothing was installed.")).toBeVisible();
  expect(seen!.installStep).toBeNull();
  expect(seen!.plugins.map((plugin) => plugin.name)).toEqual(["BrainDrive"]);
  expect(screen.queryByRole("button", { name: "Create an Expert" })).not.toBeInTheDocument();
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
  // The fingerprint is the SHA-256 of the chosen file's bytes, with its first 12 characters as the label (AC-8.3).
  const card = screen.getByLabelText("From BrainDrive: review before installing");
  expect(card).toHaveTextContent("2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881");
  expect(screen.getByText("2d711642b726")).toBeVisible();
  expect(screen.getByRole("button", { name: "Copy" })).toBeVisible();
});

it("shows a BrainDrive review card with summary first and every file in full, then installs on THIS page", async () => {
  const user = userEvent.setup();
  render(<Harness taken={["Start a Business"]} />); await addPage();
  await user.click(screen.getByRole("button", { name: "Install an Expert" }));
  await submit("start-a-business.zip");
  const card = await screen.findByLabelText("From BrainDrive: review before installing");
  expect(card).toHaveTextContent("by Sample Author (unverified)");
  expect(card).toHaveTextContent("MIT");
  expect(card).toHaveTextContent("An Expert with instructions and a spec template.");
  // The full instructions are shown up front, before anything is expanded (AC-8.3).
  const instructions = screen.getByRole("region", { name: "Instructions" });
  expect(instructions).toHaveTextContent("These instructions will guide this page's Expert.");
  expect(instructions).toHaveTextContent("Ask one question at a time.");
  expect(instructions).not.toHaveTextContent("description:");
  expect(card).toHaveTextContent("instructions: How this Expert works with you.");
  expect(card).toHaveTextContent(MEMORY_NOTICE);
  expect(card).toHaveTextContent("renames it to that name (numbered if the name is taken)");
  expect(card).toHaveTextContent("Fingerprint");
  expect(screen.queryByText("templates/spec.md")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "See every file" }));
  expect(screen.getByText("templates/spec.md")).toBeVisible();
  expect(screen.getAllByText(/Ask one question at a time/)).toHaveLength(2);
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

describe("Share this Expert", () => {
  const card = () => screen.getByLabelText("From BrainDrive: share this Expert");
  async function built() {
    const user = userEvent.setup();
    render(<Harness />); await addPage();
    await user.click(screen.getByRole("button", { name: "Create an Expert" }));
    act(() => startExport("p1"));
    return user;
  }

  it("shows the fixed warnings and every file that will be in the plugin file, generated ones included", async () => {
    const user = await built();
    expect(card()).toHaveTextContent("Everything inside this Expert goes with it. If you're not sure what it's sharing, don't share it.");
    expect(card()).toHaveTextContent("will be readable by anyone who installs it");
    expect(card()).toHaveTextContent("BrainDrive pages, Your Memory and BrainDrive's tools don't travel with this Expert.");
    expect(card()).toHaveTextContent("The BrainDrive forum accepts MIT only.");
    expect(card()).toHaveTextContent("You can edit any of these files in Page Settings before you share.");
    expect(card()).not.toHaveTextContent(/remove it|leave something out/i);
    for (const path of ["plugin.json", "skills/my-expert/SKILL.md", "LICENSE"]) expect(screen.getByRole("button", { name: path })).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); // nothing to tick
    await user.click(screen.getByRole("button", { name: "skills/my-expert/SKILL.md" }));
    expect(card()).toHaveTextContent("This Expert helps you with the job you describe");
  });

  it("leaves the creator blank and the license MIT by default, and writes the owner's choices into the files", async () => {
    const user = await built();
    expect(screen.getByLabelText("Creator name (optional)")).toHaveValue("");
    expect(screen.getByLabelText("License")).toHaveValue("MIT");
    await user.click(screen.getByRole("button", { name: "LICENSE" }));
    expect(card()).toHaveTextContent("the creator of this plugin");
    await user.type(screen.getByLabelText("Creator name (optional)"), "Dana");
    expect(card()).toHaveTextContent(/Copyright \(c\) \d{4} Dana/);
    await user.selectOptions(screen.getByLabelText("License"), "none");
    expect(screen.queryByRole("button", { name: "LICENSE" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "plugin.json" }));
    expect(card()).toHaveTextContent('"author": "Dana"');
    expect(card()).not.toHaveTextContent('"license"');
  });

  it("explains what a license is from an info button beside License", async () => {
    const user = await built();
    const info = screen.getByRole("button", { name: "What is a license?" });
    expect(info).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/A license tells other people/)).not.toBeInTheDocument();
    await user.click(info);
    expect(screen.getByText(/A license tells other people what they are allowed to do with your Expert/)).toBeVisible();
    expect(screen.getByLabelText("License")).toHaveValue("MIT");
    await user.click(info);
    expect(screen.queryByText(/A license tells other people/)).not.toBeInTheDocument();
  });

  it("Save as a plugin says where the file went and how to share it on the forum; BrainDrive posts nothing", async () => {
    const user = await built();
    await user.click(screen.getByRole("button", { name: "Save as a plugin" }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved my-expert.zip to your computer. Nothing was sent anywhere.");
    expect(card()).toHaveTextContent("You make the post yourself; BrainDrive posts nothing.");
    expect(card()).toHaveTextContent("held until a moderator has checked it");
    expect(screen.getByRole("link", { name: "Share on the forum" })).toHaveAttribute("href", "https://community.braindrive.ai");
    expect(screen.queryByRole("button", { name: "Save as a plugin" })).not.toBeInTheDocument();
  });

  it("Cancel saves nothing", async () => {
    const user = await built();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Nothing was saved.")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Share on the forum" })).not.toBeInTheDocument();
  });

  it("shows the warning again every time, and keeps only one card waiting", async () => {
    await built();
    act(() => startExport("p1"));
    act(() => startExport("p1"));
    expect(screen.getAllByText(/Everything inside this Expert goes with it/)).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Save as a plugin" })).toHaveLength(1);
  });

  it("keeps the original creator and license of an Expert installed from someone else", async () => {
    const user = userEvent.setup();
    render(<Harness />); await addPage();
    await user.click(screen.getByRole("button", { name: "Install an Expert" }));
    await submit("garden-helper.zip");
    await user.click(await screen.findByRole("button", { name: "Install" }));
    await screen.findByText(/Installed Garden Helper/);
    act(() => startExport("p1"));
    expect(card()).toHaveTextContent("Creator: Sample Author. License: MIT. Both are kept from the original and cannot be changed here.");
    expect(screen.queryByLabelText("Creator name (optional)")).not.toBeInTheDocument();
  });

  it("puts instructions, templates and reference files where the package format says", () => {
    const paths = exportFileList({ name: "Start a Business", files: { "instructions.md": "a", "templates/spec.md": "b", "references/run-interview.md": "c" } }, { creator: "", license: "other", otherLicense: "CC-BY-4.0" }).map(([path]) => path);
    expect(paths).toEqual(["plugin.json", "skills/start-a-business/SKILL.md", "skills/start-a-business/assets/spec.md", "skills/start-a-business/references/run-interview.md"]);
  });

  it("marks the plugin as an Expert in plugin.json under extensions, with no separate marker file", () => {
    const files = exportFileList({ name: "Garden", files: { "instructions.md": "a" } }, { creator: "", license: "MIT", otherLicense: "" });
    const manifest = JSON.parse(files.find(([path]) => path === "plugin.json")![1]);
    expect(manifest.extensions).toEqual({ "ai.braindrive": { type: "expert", format_version: 1 } });
    expect(files.some(([path]) => path.startsWith("ai.braindrive/"))).toBe(false);
  });
});

describe("changing the Expert's instructions (AC-2.5, AC-7.14)", () => {
  let seen: ReturnType<typeof usePageSetup>;
  async function expertPage() {
    const user = userEvent.setup();
    function Probe() { seen = usePageSetup({ id: "p1", name: "New page" }); return null; }
    render(<><Harness /><Probe /></>); await addPage();
    await user.click(screen.getByRole("button", { name: "Create an Expert" }));
    return user;
  }
  const say = async (text: string) => { await act(async () => { proposeInstructionChange("p1", text); }); };
  const instructions = () => seen!.expert!.files["instructions.md"]!;

  it("shows the exact wording on a BrainDrive card and saves nothing until Change it is pressed", async () => {
    const user = await expertPage();
    const before = instructions();
    await say("Please stop calling me Mark");
    const card = screen.getByLabelText("From BrainDrive: change this Expert's instructions");
    expect(card).toHaveTextContent("Change this Expert's instructions?");
    expect(card).toHaveTextContent('Adding: "Do not call the owner Mark."');
    expect(instructions()).toBe(before);
    await user.click(screen.getByRole("button", { name: "Change it" }));
    expect(instructions()).toContain("Do not call the owner Mark.");
    expect(screen.getByText("Updated: I won't call you Mark anymore.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Undo/ })).not.toBeInTheDocument();
  });

  it("Keep as is changes nothing", async () => {
    const user = await expertPage();
    const before = instructions();
    await say("call me Dave");
    await user.click(screen.getByRole("button", { name: "Keep as is" }));
    expect(instructions()).toBe(before);
    expect(screen.getByRole("status")).toHaveTextContent("Kept as is. Nothing was changed.");
  });

  it("'no, that's wrong' proposes removing the last change on the same kind of card", async () => {
    const user = await expertPage();
    const before = instructions();
    await say("call me Dave");
    await user.click(screen.getByRole("button", { name: "Change it" }));
    await say("No, that's wrong");
    expect(screen.getByText("Undo this change to the Expert's instructions?")).toBeVisible();
    expect(screen.getByText(/Removing:/).parentElement).toHaveTextContent('Removing: "Call the owner Dave."');
    await user.click(screen.getByRole("button", { name: "Undo it" }));
    expect(instructions().trim()).toBe(before.trim());
    expect(screen.getByText("Undone: I'll call you Dave.")).toBeVisible();
  });

  it("makes no card on a page without an Expert, or for an ordinary message", async () => {
    render(<Harness />); await addPage();
    await say("call me Dave");
    expect(screen.queryByLabelText("From BrainDrive: change this Expert's instructions")).not.toBeInTheDocument();
  });
});
