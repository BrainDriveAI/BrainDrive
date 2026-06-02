import { render, screen } from "@testing-library/react";

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

  it("renders owner-facing labels instead of internal Memory paths in assistant messages", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content:
              "Updated `documents/finance/budget/budget.md`, documents/finance/budget/reports/latest.md, and me/todo.md.",
          },
        ]}
      />
    );

    expect(screen.getByText(/saved Budget/)).toBeInTheDocument();
    expect(screen.getByText(/latest Budget report/)).toBeInTheDocument();
    expect(screen.getByText(/Todo list/)).toBeInTheDocument();
    expect(screen.queryByText(/documents\/finance/)).not.toBeInTheDocument();
    expect(screen.queryByText(/me\/todo/)).not.toBeInTheDocument();
  });

  it("softens unsupported finance confidence language in owner-visible assistant messages", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content:
              "This is perfect data with a fully completed actuals ledger. Everything is completely reconciled and permanently mapped behind the scenes. Send extra cash directly to destroy the Northbridge Visa and get the banks' hands out of your pockets.",
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("available data");
    expect(rendered).toContain("draft actuals ledger");
    expect(rendered).toContain("reconciled based on the visible rows");
    expect(rendered).toContain("categorized in this budget draft");
    expect(rendered).toContain("directly toward paying down the Northbridge Visa");
    expect(rendered).toContain("reduce the interest you pay to lenders");
    expect(rendered).not.toMatch(/perfect data|fully completed actuals ledger|completely reconciled|permanently mapped|behind the scenes|destroy the Northbridge Visa|banks' hands out of your pockets/i);
  });
});
