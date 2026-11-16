import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as gateway from "@/api/gateway-adapter";
import DocumentView from "./DocumentView";
import { resetFileHistoryMock } from "@/prototype/fileHistoryMock";

vi.mock("@/api/gateway-adapter", () => ({ readFileContent: vi.fn(), writeFileContent: vi.fn(), deleteFileContent: vi.fn() }));

const props = { projectId: "finance", projectName: "Finance", file: { name: "notes.md", path: "documents/finance/added/notes.md" }, onBack: vi.fn() };

beforeEach(() => {
  resetFileHistoryMock();
  vi.mocked(gateway.writeFileContent).mockReset().mockResolvedValue(undefined);
  vi.mocked(gateway.readFileContent).mockReset().mockResolvedValue("# Notes");
  vi.mocked(gateway.deleteFileContent).mockReset().mockResolvedValue(undefined);
});

it("has no Delete file unless the page allows it for this file", async () => {
  render(<DocumentView {...props} />);
  await screen.findByText("Notes");
  expect(screen.queryByRole("button", { name: "Delete file" })).not.toBeInTheDocument();
});

it("asks before deleting, and Keep it deletes nothing", async () => {
  const onDeleted = vi.fn();
  render(<DocumentView {...props} onDeleted={onDeleted} />);
  await screen.findByText("Notes");
  await userEvent.click(screen.getByRole("button", { name: "Delete file" }));
  const dialog = screen.getByRole("alertdialog", { name: "Delete this file?" });
  expect(dialog).toHaveTextContent("Delete this file? It will be removed from this page. You can't bring it back from inside BrainDrive yet.");
  await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(gateway.deleteFileContent).not.toHaveBeenCalled();
  expect(onDeleted).not.toHaveBeenCalled();
});

it("deletes the file on confirm and tells the page", async () => {
  const onDeleted = vi.fn();
  render(<DocumentView {...props} onDeleted={onDeleted} />);
  await screen.findByText("Notes");
  await userEvent.click(screen.getByRole("button", { name: "Delete file" }));
  await userEvent.click(screen.getAllByRole("button", { name: "Delete file" })[1]!);
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  expect(gateway.deleteFileContent).toHaveBeenCalledWith("finance", "documents/finance/added/notes.md");
});

it("keeps the file open and shows the reason when the delete is refused", async () => {
  vi.mocked(gateway.deleteFileContent).mockRejectedValue(new Error("This file cannot be deleted"));
  const onDeleted = vi.fn();
  render(<DocumentView {...props} onDeleted={onDeleted} />);
  await screen.findByText("Notes");
  await userEvent.click(screen.getByRole("button", { name: "Delete file" }));
  await userEvent.click(screen.getAllByRole("button", { name: "Delete file" })[1]!);
  expect(await screen.findByText("This file cannot be deleted")).toBeVisible();
  expect(onDeleted).not.toHaveBeenCalled();
  expect(screen.getByText("Notes")).toBeVisible();
});

it("offers no Delete file while editing", async () => {
  render(<DocumentView {...props} onDeleted={vi.fn()} />);
  await screen.findByText("Notes");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.queryByRole("button", { name: "Delete file" })).not.toBeInTheDocument();
});

describe("Put inside the Expert (AC-3.7)", () => {
  it("is not offered unless the page allows it for this file", async () => {
    render(<DocumentView {...props} />);
    await screen.findByText("Notes");
    expect(screen.queryByRole("button", { name: "Put inside the Expert" })).not.toBeInTheDocument();
  });

  it("asks first, says the file will travel when shared, and Keep it in my files changes nothing", async () => {
    const onPutInside = vi.fn(async () => undefined);
    render(<DocumentView {...props} onPutInside={onPutInside} />);
    await screen.findByText("Notes");
    await userEvent.click(screen.getByRole("button", { name: "Put inside the Expert" }));
    const dialog = screen.getByRole("alertdialog", { name: "Put this file inside the Expert?" });
    expect(dialog).toHaveTextContent("it will travel with the Expert when you share it");
    expect(dialog).toHaveTextContent("Your own copy stays in Your Files");
    await userEvent.click(screen.getByRole("button", { name: "Keep it in my files" }));
    expect(onPutInside).not.toHaveBeenCalled();
  });

  it("on confirm passes the file's text and says it is now inside", async () => {
    const onPutInside = vi.fn(async () => undefined);
    render(<DocumentView {...props} onPutInside={onPutInside} />);
    await screen.findByText("Notes");
    await userEvent.click(screen.getByRole("button", { name: "Put inside the Expert" }));
    await userEvent.click(screen.getByRole("button", { name: "Put it inside" }));
    await waitFor(() => expect(onPutInside).toHaveBeenCalledWith("# Notes"));
    expect(screen.getByRole("status")).toHaveTextContent("A copy is now inside this Expert");
    expect(screen.queryByRole("button", { name: "Put inside the Expert" })).not.toBeInTheDocument();
  });

  it("shows the reason when it cannot be done", async () => {
    const onPutInside = vi.fn(async () => { throw new Error("This file is over 256 KiB, the most a file inside an Expert can hold. Nothing was changed."); });
    render(<DocumentView {...props} onPutInside={onPutInside} />);
    await screen.findByText("Notes");
    await userEvent.click(screen.getByRole("button", { name: "Put inside the Expert" }));
    await userEvent.click(screen.getByRole("button", { name: "Put it inside" }));
    expect(await screen.findByText(/over 256 KiB/)).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("last-saved time and Earlier versions (PC-7.1, PC-7.2, prototype)", () => {
  const text = "# Plan\nStep one\nStep two\nStep three\nStep four";

  it("shows nothing about history unless asked", async () => {
    render(<DocumentView {...props} />);
    await screen.findByText("Notes");
    expect(screen.queryByRole("button", { name: "Earlier versions" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Last saved/)).not.toBeInTheDocument();
  });

  it("opens an earlier version read-only and makes it current by saving its text", async () => {
    vi.mocked(gateway.readFileContent).mockResolvedValue(text);
    render(<DocumentView {...props} showHistory />);
    await screen.findByText(/Step four/);
    expect(screen.getByText(/^Last saved /)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Earlier versions" }));
    const list = screen.getByRole("region", { name: "Earlier versions" });
    const versions = list.querySelectorAll("li button");
    expect(versions.length).toBeGreaterThan(0);
    await userEvent.click(versions[0] as HTMLElement);
    expect(screen.getByRole("region", { name: "Earlier version" })).toHaveTextContent("It is read-only.");
    expect(screen.queryByText(/Step four/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Make this the current version" }));
    await waitFor(() => expect(gateway.writeFileContent).toHaveBeenCalledWith("finance", props.file.path, expect.not.stringContaining("Step four")));
    expect(await screen.findByRole("status")).toHaveTextContent("The text it replaced is now an earlier version.");
  });

  it("keeps the replaced text as an earlier version, so a restore can be undone", async () => {
    vi.mocked(gateway.readFileContent).mockResolvedValue(text);
    render(<DocumentView {...props} showHistory />);
    await screen.findByText(/Step four/);
    await userEvent.click(screen.getByRole("button", { name: "Earlier versions" }));
    await userEvent.click(screen.getByRole("region", { name: "Earlier versions" }).querySelector("li button") as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: "Make this the current version" }));
    await screen.findByRole("status");
    await userEvent.click(screen.getByRole("button", { name: "Earlier versions" }));
    await userEvent.click(screen.getByRole("region", { name: "Earlier versions" }).querySelector("li button") as HTMLElement);
    expect(screen.getByText(/Step four/)).toBeVisible();
  });

  it("Back to the current version changes nothing", async () => {
    vi.mocked(gateway.readFileContent).mockResolvedValue(text);
    render(<DocumentView {...props} showHistory />);
    await screen.findByText(/Step four/);
    await userEvent.click(screen.getByRole("button", { name: "Earlier versions" }));
    await userEvent.click(screen.getByRole("region", { name: "Earlier versions" }).querySelector("li button") as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: "Back to the current version" }));
    expect(screen.getByText(/Step four/)).toBeVisible();
    expect(gateway.writeFileContent).not.toHaveBeenCalled();
  });
});
