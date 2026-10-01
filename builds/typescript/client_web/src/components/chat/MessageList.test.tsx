import { fireEvent, render, screen } from "@testing-library/react";

import type { Message } from "@/types/ui";

import MessageList from "./MessageList";

const scrollIntoViewMock = vi.fn();

beforeEach(() => {
  scrollIntoViewMock.mockReset();
  Element.prototype.scrollIntoView = scrollIntoViewMock;
});

describe("MessageList scroll behavior", () => {
  it("does not jump to the bottom when an assistant response starts", () => {
    const userMessage: Message = { id: "u-1", role: "user", content: "Build me a fitness plan" };
    const assistantMessage: Message = { id: "a-1", role: "assistant", content: "Here is a plan..." };

    const { rerender } = render(<MessageList messages={[userMessage]} />);
    scrollIntoViewMock.mockClear();

    rerender(<MessageList messages={[userMessage, assistantMessage]} />);

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("scrolls down when the user submits a new message", () => {
    const userMessage: Message = { id: "u-1", role: "user", content: "Build me a fitness plan" };

    const { rerender } = render(<MessageList messages={[]} />);
    scrollIntoViewMock.mockClear();

    rerender(<MessageList messages={[userMessage]} />);

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });
});


describe("MessageList incomplete responses", () => {
  it.each([
    ["tool_error", "a tool or app action failed"],
    ["stream_incomplete", "the model connection was interrupted"],
  ])("explains %s and offers recovery", (code, reason) => {
    const retry = vi.fn();
    render(<MessageList messages={[{ id: "partial", role: "assistant", content: "Partial answer", status: "incomplete" }]}
      incompleteMessageId="partial" incompleteErrorCode={code} onRetryIncomplete={retry} />);
    expect(screen.getByRole("status")).toHaveTextContent(reason);
    expect(screen.getByRole("status")).toHaveTextContent("Your saved conversation and documents remain available");
    if (code === "tool_error") expect(screen.getByRole("status")).not.toHaveTextContent("model connection");
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
