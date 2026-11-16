import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as gateway from "@/api/gateway-adapter";
import DocumentView from "./DocumentView";

vi.mock("@/api/gateway-adapter", () => ({ readFileContent: vi.fn(), writeFileContent: vi.fn(), deleteFileContent: vi.fn() }));

const props = { projectId: "finance", projectName: "Finance", file: { name: "notes.md", path: "documents/finance/added/notes.md" }, onBack: vi.fn() };

beforeEach(() => {
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
  expect(dialog).toHaveTextContent("Delete this file? It will be removed from this page. BrainDrive keeps earlier versions in Your Memory's history.");
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
