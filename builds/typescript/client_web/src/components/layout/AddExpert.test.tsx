import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "@/api/experts";
import AddExpert from "./AddExpert";
import RemoveExpert from "./RemoveExpert";

vi.mock("@/api/experts", () => ({ STARTER_SOURCE: "starter-expert.zip", createExpert: vi.fn(), reviewExpert: vi.fn(), installExpert: vi.fn() }));
const review: api.ExpertReview = {
  manifest: { id: "sample", name: "Sample Expert", version: "1.0.0", description: "Help with a task", creator: "Sample Author", licence: "MIT", page: "sample", skills: [], testedIn: [] },
  digest: "abc123", source: "sample.zip", conflicts: [], files: { "AGENT.md": "Exact package text" },
  verification: "Not checked.", permissions: "This Expert only works inside its own page.",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.createExpert).mockResolvedValue({ id: "new-expert" });
  vi.mocked(api.reviewExpert).mockResolvedValue(review);
  vi.mocked(api.installExpert).mockResolvedValue({ projectId: "sample" });
});
it("opens a normal new page immediately without requiring a setup form", async () => {
  const onOpen = vi.fn(); render(<AddExpert onClose={vi.fn()} onOpenExpert={onOpen} />);
  await userEvent.click(screen.getByRole("button", { name: /Create your own/ }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith("new-expert"));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
async function choosePackage() {
  await userEvent.click(screen.getByRole("button", { name: /Install Expert/ }));
  await userEvent.upload(screen.getByLabelText("Expert package (.zip)"), new File(["test"], "sample.zip", { type: "application/zip" }));
}
it("shows contents, source and limits before the owner confirms installation", async () => {
  const onOpen = vi.fn(); render(<AddExpert onClose={vi.fn()} onOpenExpert={onOpen} />); await choosePackage();
  expect(await screen.findByText(/Sample Author/)).toBeInTheDocument();
  expect(screen.getByText(review.permissions)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Install Expert" })).toBeDisabled();
  await userEvent.click(screen.getByText("AGENT.md"));
  expect(screen.getByText("Exact package text")).toBeVisible();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Install Expert" }));
  expect(api.installExpert).toHaveBeenCalledWith(review);
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith("sample"));
});
it("shows rejected packages without enabling install", async () => {
  vi.mocked(api.reviewExpert).mockRejectedValue(new Error("Unsafe package path."));
  render(<AddExpert onClose={vi.fn()} onOpenExpert={vi.fn()} />); await choosePackage();
  expect(await screen.findByRole("alert")).toHaveTextContent("Unsafe package path.");
  expect(api.installExpert).not.toHaveBeenCalled();
});
it("blocks conflicts and resets approval when another package is selected", async () => {
  render(<AddExpert onClose={vi.fn()} onOpenExpert={vi.fn()} />); await choosePackage();
  await userEvent.click(await screen.findByRole("checkbox"));
  vi.mocked(api.reviewExpert).mockResolvedValue({ ...review, conflicts: ["Page already exists."] });
  await userEvent.upload(screen.getByLabelText("Expert package (.zip)"), new File(["other"], "other.zip", { type: "application/zip" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Page already exists.");
  expect(screen.getByRole("button", { name: "Install Expert" })).toBeDisabled();
});
it("reports failed creation without opening a page", async () => {
  vi.mocked(api.createExpert).mockRejectedValue(new Error("Storage unavailable"));
  const onOpen = vi.fn(); render(<AddExpert onClose={vi.fn()} onOpenExpert={onOpen} />);
  await userEvent.click(screen.getByRole("button", { name: /Create your own/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Storage unavailable");
  expect(onOpen).not.toHaveBeenCalled();
});
it("reviews the starter Expert and waits for owner confirmation", async () => {
  render(<AddExpert onClose={vi.fn()} onOpenExpert={vi.fn()} />);
  expect(api.reviewExpert).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: /Install Expert/ }));
  await userEvent.click(screen.getByRole("button", { name: "Install Start a Business" }));
  expect(await screen.findByText(/Included with BrainDrive/)).toBeInTheDocument();
  expect(api.reviewExpert).toHaveBeenCalledWith("starter-expert.zip");
  expect(api.installExpert).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Install Expert" }));
  expect(api.installExpert).toHaveBeenCalledWith(review);
});
it("opens an installed Expert without overwriting it", async () => {
  vi.mocked(api.reviewExpert).mockResolvedValue({ ...review, existingProjectId: "sample", conflicts: ["Already active"] });
  const open = vi.fn(); render(<AddExpert onClose={vi.fn()} onOpenExpert={open} />); await choosePackage();
  await userEvent.click(await screen.findByRole("button", { name: "Open existing Expert" }));
  expect(open).toHaveBeenCalledWith("sample"); expect(api.installExpert).not.toHaveBeenCalled();
});
it("cancels removal without changing anything", async () => {
  const close = vi.fn(), removePage = vi.fn();
  render(<RemoveExpert project={{ id: "sample", name: "Sample Expert" }} onClose={close} onRemoved={vi.fn()} onRemovePage={removePage} />);
  expect(screen.getByText(/Your goals, plan, journal/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalled(); expect(removePage).not.toHaveBeenCalled();
});
it("removes the Expert from the sidebar and keeps its files", async () => {
  const removePage = vi.fn().mockResolvedValue(undefined), done = vi.fn();
  render(<RemoveExpert project={{ id: "sample", name: "Sample Expert" }} onClose={vi.fn()} onRemoved={done} onRemovePage={removePage} />);
  await userEvent.click(screen.getByRole("button", { name: "Remove and keep my work" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(removePage).toHaveBeenCalledWith("sample");
});
