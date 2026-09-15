import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Composer from "./Composer";

describe("Composer", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("disables send when empty and clears after sending", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(<Composer onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("Message your BrainDrive...");
    const sendButton = screen.getByRole("button", { name: "Send message" });

    expect(sendButton).toBeDisabled();

    await user.type(textarea, "Hello BrainDrive");

    expect(sendButton).not.toBeDisabled();

    await user.click(sendButton);

    expect(onSend).toHaveBeenCalledWith("Hello BrainDrive");
    expect(textarea).toHaveValue("");
    expect(sendButton).toBeDisabled();

    await waitFor(() => {
      expect(textarea).toHaveFocus();
    });
  });

  it("restores textarea focus after streaming completes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Composer isStreaming={true} />);

    const textarea = screen.getByPlaceholderText("Message your BrainDrive...");
    const stopButton = screen.getByRole("button", { name: "Stop generating" });

    await user.click(stopButton);
    expect(textarea).not.toHaveFocus();

    rerender(<Composer isStreaming={false} />);

    await waitFor(() => {
      expect(textarea).toHaveFocus();
    });
  });

  it("does not expose document attachment controls", () => {
    const { container } = render(<Composer />);

    expect(container.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach file" })).not.toBeInTheDocument();
  });

  it("persists an unsent draft across remount without sending it", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const draftKey = "braindrive:test-draft:owner:resume-builder:workspace:composer";

    const rendered = render(<Composer onSend={onSend} draftKey={draftKey} />);
    await user.type(screen.getByPlaceholderText("Message your BrainDrive..."), "Unsent resume details");

    expect(window.localStorage.getItem(draftKey)).toBe("Unsent resume details");
    expect(onSend).not.toHaveBeenCalled();

    rendered.unmount();
    render(<Composer onSend={onSend} draftKey={draftKey} />);

    expect(screen.getByPlaceholderText("Message your BrainDrive...")).toHaveValue("Unsent resume details");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("clears the stored draft after sending", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const draftKey = "braindrive:test-draft:owner:resume-builder:send:composer";
    window.localStorage.setItem(draftKey, "Send this later");

    render(<Composer onSend={onSend} draftKey={draftKey} />);
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSend).toHaveBeenCalledWith("Send this later");
    expect(window.localStorage.getItem(draftKey)).toBeNull();
    expect(screen.getByPlaceholderText("Message your BrainDrive...")).toHaveValue("");
  });

  it("does not restore drafts from another scoped key", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("braindrive:test-draft:owner-a:resume-builder:composer", "Owner A draft");

    render(<Composer draftKey="braindrive:test-draft:owner-b:resume-builder:composer" />);

    const textarea = screen.getByPlaceholderText("Message your BrainDrive...");
    expect(textarea).toHaveValue("");

    await user.type(textarea, "Owner B draft");

    expect(window.localStorage.getItem("braindrive:test-draft:owner-a:resume-builder:composer")).toBe("Owner A draft");
    expect(window.localStorage.getItem("braindrive:test-draft:owner-b:resume-builder:composer")).toBe("Owner B draft");
  });
});
