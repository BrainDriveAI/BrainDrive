import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeletePage from "./DeletePage";

const project = { id: "sample", name: "Sample" };

it("states the five things Page changes PC-3.1 asks for, nothing about plugins, and changes nothing until confirmed", async () => {
  const del = vi.fn();
  render(<DeletePage project={project} onClose={vi.fn()} onDeleted={vi.fn()} onDeletePage={del} />);
  for (const line of [
    "The page leaves your sidebar.",
    "Its Expert stops and won't run again, even after a restart or a Memory import.",
    "Every file on the page, and every file its Expert came with, stays in your Memory folder.",
    "Anything the Expert saved to Your Memory stays there. You can correct or remove it, and Memory history keeps earlier versions.",
    "There's no way to bring the page or its Expert back in this version.",
  ]) expect(screen.getByText(line)).toBeVisible();
  expect(screen.queryByText(/plugin/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /restore|undo/i })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(del).not.toHaveBeenCalled();
});

it("deletes the page after confirmation", async () => {
  const del = vi.fn().mockResolvedValue(undefined), done = vi.fn();
  render(<DeletePage project={project} onClose={vi.fn()} onDeleted={done} onDeletePage={del} />);
  await userEvent.click(screen.getByRole("button", { name: "Delete page" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(del).toHaveBeenCalledWith("sample");
});

it("reports a failed delete", async () => {
  render(<DeletePage project={project} onClose={vi.fn()} onDeleted={vi.fn()} onDeletePage={vi.fn().mockRejectedValue(new Error("Storage unavailable"))} />);
  await userEvent.click(screen.getByRole("button", { name: "Delete page" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Storage unavailable");
});
