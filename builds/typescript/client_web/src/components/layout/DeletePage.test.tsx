import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeletePage from "./DeletePage";

const project = { id: "sample", name: "Sample" };

it("states all four consequences and changes nothing until confirmed", async () => {
  const del = vi.fn();
  render(<DeletePage project={project} onClose={vi.fn()} onDeleted={vi.fn()} onDeletePage={del} />);
  expect(screen.getByText(/files stay in Your Memory/)).toBeVisible();
  expect(screen.getByText(/plugins are detached/)).toBeVisible();
  expect(screen.getByText(/Other plugins stay available/)).toBeVisible();
  expect(screen.getByText(/leaves your sidebar/)).toBeVisible();
  expect(screen.getByText(/no way to restore/)).toBeVisible();
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
