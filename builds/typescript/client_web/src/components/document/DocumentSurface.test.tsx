import { fireEvent, render, screen } from "@testing-library/react";

import DocumentSurface from "./DocumentSurface";

describe("DocumentSurface", () => {
  it("renders page documents as readable Markdown", () => {
    render(<DocumentSurface mode="read" content={"# Your Goals\n\nA clear first step."} />);

    expect(screen.getByRole("heading", { name: "Your Goals" })).toBeInTheDocument();
    expect(screen.getByText("A clear first step.")).toBeInTheDocument();
  });

  it("keeps the document editable as plain text", () => {
    const onChange = vi.fn();
    render(<DocumentSurface mode="edit" content="# Your Plan" onChange={onChange} />);

    const editor = screen.getByRole("textbox", { name: "Document content" });
    expect(editor).toHaveValue("# Your Plan");
    fireEvent.change(editor, { target: { value: "# Updated plan" } });
    expect(onChange).toHaveBeenCalledWith("# Updated plan");
  });
});
