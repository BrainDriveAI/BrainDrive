import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Composer from "./Composer";

describe("Composer", () => {
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

    expect(onSend).toHaveBeenCalledWith("Hello BrainDrive", undefined);
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
});
