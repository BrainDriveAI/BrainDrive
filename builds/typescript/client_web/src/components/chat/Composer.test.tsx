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

    expect(onSend).toHaveBeenCalledWith("Hello BrainDrive", []);
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

  it("accepts CSV, image, and PDF attachments from the file picker", async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn();

    const { container } = render(<Composer onAttach={onAttach} />);
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect((input as HTMLInputElement).accept).toContain(".csv");
    expect((input as HTMLInputElement).accept).toContain(".png");
    expect((input as HTMLInputElement).accept).toContain(".pdf");

    const csvFile = new File(["a,b\n1,2"], "transactions.csv", { type: "text/csv" });
    await user.upload(input as HTMLInputElement, csvFile);

    expect(onAttach).toHaveBeenCalledWith([
      {
        file: csvFile,
        name: "transactions.csv",
        size: "7 B",
      }
    ]);

    const imageFile = new File(["png"], "receipt.png", { type: "image/png" });
    await user.upload(input as HTMLInputElement, imageFile);

    expect(onAttach).toHaveBeenLastCalledWith([
      {
        file: imageFile,
        name: "receipt.png",
        size: "3 B",
      }
    ]);

    const pdfFile = new File(["%PDF-1.6"], "statement.pdf", { type: "application/pdf" });
    await user.upload(input as HTMLInputElement, pdfFile);

    expect(onAttach).toHaveBeenLastCalledWith([
      {
        file: pdfFile,
        name: "statement.pdf",
        size: "8 B",
      }
    ]);
  });
});
