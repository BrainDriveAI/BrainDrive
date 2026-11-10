import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { readFileContent, writeFileContent } from "@/api/gateway-adapter";

import DocumentView from "./DocumentView";

vi.mock("@/api/gateway-adapter", () => ({
  readFileContent: vi.fn(),
  writeFileContent: vi.fn(),
}));

describe("DocumentView", () => {
  const readFileContentMock = vi.mocked(readFileContent);
  const writeFileContentMock = vi.mocked(writeFileContent);

  beforeEach(() => {
    readFileContentMock.mockResolvedValue("# Original\n");
    writeFileContentMock.mockResolvedValue(undefined);
  });

  it("shows the page and source document and saves plain text edits", async () => {
    const user = userEvent.setup();
    const onStateChange = vi.fn();

    render(
      <DocumentView
        projectId="finance"
        projectName="Finance"
        file={{ name: "plan.md", path: "documents/finance/plan.md" }}
        onBack={vi.fn()}
        onStateChange={onStateChange}
      />
    );

    expect(await screen.findByText("Original")).toBeInTheDocument();
    expect(screen.getByLabelText("Document source")).toHaveTextContent(
      "From Your Finance · Source: documents/finance/plan.md"
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(onStateChange).toHaveBeenLastCalledWith("editing");

    const editor = screen.getByRole("textbox");
    await user.clear(editor);
    await user.type(editor, "# Updated\nPlain text remains plain.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(writeFileContentMock).toHaveBeenCalledWith(
        "finance",
        "documents/finance/plan.md",
        "# Updated\nPlain text remains plain."
      );
    });
    expect(onStateChange).toHaveBeenLastCalledWith("viewing");
  });

  it("asks before leaving with unsaved changes", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();

    render(
      <DocumentView
        projectId="finance"
        projectName="Finance"
        file={{ name: "plan.md", path: "documents/finance/plan.md" }}
        onBack={onBack}
      />
    );

    await screen.findByText("Original");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(screen.getByRole("textbox"), "Changed");
    await user.click(screen.getByRole("button", { name: "Back to chat" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Keep your unsaved changes?");
    expect(onBack).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to chat" }));
    await user.click(screen.getByRole("button", { name: "Discard and go back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft visible when saving loses permission", async () => {
    const user = userEvent.setup();
    writeFileContentMock.mockRejectedValueOnce(new Error("401 unauthorized"));

    render(
      <DocumentView
        projectId="finance"
        projectName="Finance"
        file={{ name: "plan.md", path: "documents/finance/plan.md" }}
        onBack={vi.fn()}
      />
    );

    await screen.findByText("Original");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("textbox");
    await user.type(editor, " Keep this draft");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session no longer allows this edit. Your changes are still here."
    );
    expect(screen.getByRole("textbox")).toHaveValue("# Original\n Keep this draft");
  });
});
