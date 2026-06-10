import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Message } from "@/types/ui";

import ChatPanel from "./ChatPanel";

const useGatewayChatMock = vi.fn();

vi.mock("@/api/useGatewayChat", () => ({
  useGatewayChat: (...args: unknown[]) => useGatewayChatMock(...args),
}));

function makeHookState(overrides: Partial<{
  messages: Message[];
  isLoading: boolean;
  error: Error | null;
  errorCode: string | null;
  toolStatus: string | null;
  contextWindowWarning: {
    estimated_tokens: number;
    budget_tokens: number;
    ratio: number;
    threshold: number;
    managed: boolean;
    message: string;
  } | null;
}> = {}) {
  return {
    messages: overrides.messages ?? [],
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    errorCode: overrides.errorCode ?? null,
    conversationId: null,
    toolStatus: overrides.toolStatus ?? null,
    pendingApprovals: [],
    activity: [],
    contextWindowWarning: overrides.contextWindowWarning ?? null,
    append: vi.fn(),
    resolveApproval: vi.fn(async () => undefined),
    stop: vi.fn(),
    startNewConversation: vi.fn(),
  };
}

describe("ChatPanel typing indicator behavior", () => {
  beforeEach(() => {
    useGatewayChatMock.mockReset();
  });

  it("shows typing indicator before first assistant delta", () => {
    useGatewayChatMock.mockReturnValue(
      makeHookState({
        isLoading: true,
        messages: [{ id: "u-1", role: "user", content: "Tell me a joke" }],
      })
    );

    render(<ChatPanel activeConversationId={null} isEmpty={false} />);

    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("keeps typing indicator visible while assistant text is still streaming", () => {
    useGatewayChatMock.mockReturnValue(
      makeHookState({
        isLoading: true,
        messages: [
          { id: "u-1", role: "user", content: "Tell me a joke" },
          { id: "a-1", role: "assistant", content: "Why did the..." },
        ],
      })
    );

    render(<ChatPanel activeConversationId={null} isEmpty={false} />);

    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("shows context warning banner when near limit", () => {
    useGatewayChatMock.mockReturnValue(
      makeHookState({
        contextWindowWarning: {
          estimated_tokens: 80_000,
          budget_tokens: 100_000,
          ratio: 0.8,
          threshold: 0.8,
          managed: false,
          message: "This session is getting long.",
        },
      })
    );

    render(<ChatPanel activeConversationId={null} isEmpty={false} />);

    expect(screen.getByText("This session is getting long.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start New Conversation" })).toBeInTheDocument();
  });

  it("shows overflow-specific recovery actions", () => {
    useGatewayChatMock.mockReturnValue(
      makeHookState({
        messages: [{ id: "u-1", role: "user", content: "Continue from this prompt" }],
        error: new Error("This session has gotten long."),
        errorCode: "context_overflow",
      })
    );

    render(<ChatPanel activeConversationId={null} isEmpty={false} />);

    expect(screen.getByRole("button", { name: "Start New Conversation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue in New Conversation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try Again" })).not.toBeInTheDocument();
  });

  it("treats provider timeout messages as provider errors regardless of casing", () => {
    const onOpenSettings = vi.fn();
    useGatewayChatMock.mockReturnValue(
      makeHookState({
        error: new Error("Provider did not respond in time.\nWhat to check:\n1. Retry the request."),
        errorCode: "provider_error",
      })
    );

    render(<ChatPanel activeConversationId={null} isEmpty={false} onOpenSettings={onOpenSettings} />);

    expect(screen.getByText(/Provider did not respond in time/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
  });

  it("offers a fresh conversation action for normal existing history", async () => {
    const hookState = makeHookState({
      messages: [
        { id: "u-1", role: "user", content: "I want to work on career planning." },
        { id: "a-1", role: "assistant", content: "Let's start with your current role." },
      ],
    });
    const onStartNewConversation = vi.fn(async () => undefined);
    useGatewayChatMock.mockReturnValue(hookState);

    render(
      <ChatPanel
        activeConversationId="conversation-1"
        isEmpty={false}
        onStartNewConversation={onStartNewConversation}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Start New Conversation" }));

    expect(hookState.startNewConversation).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(onStartNewConversation).toHaveBeenCalledTimes(1);
    });
  });

  it("uploads PDF attachments through the selected project and sends a durable upload event", async () => {
    const user = userEvent.setup();
    const hookState = makeHookState();
    const onUploadDocument = vi.fn(async () => ({
      name: "statement.md",
      path: "documents/finance/statement.md",
    }));
    useGatewayChatMock.mockReturnValue(hookState);

    const { container } = render(
      <ChatPanel
        activeConversationId={null}
        activeProjectId="finance"
        isEmpty={false}
        onUploadDocument={onUploadDocument}
      />
    );

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    const file = new File(["%PDF-1.6"], "statement.pdf", { type: "application/pdf" });
    await user.upload(input as HTMLInputElement, file);
    await user.click(screen.getAllByRole("button", { name: "Send message" })[0]!);

    await waitFor(() => {
      expect(onUploadDocument).toHaveBeenCalledWith(file);
    });
    await waitFor(() => {
      expect(hookState.append).toHaveBeenCalledWith(
        expect.stringContaining("Uploaded 1 file:"),
        expect.any(Object)
      );
    });
    expect(hookState.append).toHaveBeenCalledWith(
      expect.stringContaining("documents/finance/statement.md"),
      expect.any(Object)
    );
  });

  it("uploads multiple selected project documents sequentially", async () => {
    const user = userEvent.setup();
    const hookState = makeHookState();
    const onUploadDocument = vi
      .fn()
      .mockResolvedValueOnce({
        name: "february.md",
        path: "documents/finance/budget/statements/february.md",
      })
      .mockResolvedValueOnce({
        name: "march.md",
        path: "documents/finance/budget/statements/march.md",
      });
    useGatewayChatMock.mockReturnValue(hookState);

    const { container } = render(
      <ChatPanel
        activeConversationId={null}
        activeProjectId="finance"
        isEmpty={false}
        onUploadDocument={onUploadDocument}
      />
    );

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    const february = new File(["Date,Amount"], "february.csv", { type: "text/csv" });
    const march = new File(["Date,Amount"], "march.csv", { type: "text/csv" });
    await user.upload(input as HTMLInputElement, [february, march]);
    await user.click(screen.getAllByRole("button", { name: "Send message" })[0]!);

    await waitFor(() => {
      expect(onUploadDocument).toHaveBeenCalledTimes(2);
    });
    expect(onUploadDocument.mock.calls[0]?.[0]).toBe(february);
    expect(onUploadDocument.mock.calls[1]?.[0]).toBe(march);
    await waitFor(() => {
      expect(hookState.append).toHaveBeenCalledWith(
        expect.stringContaining("Uploaded 2 files:"),
        expect.any(Object)
      );
    });
  });
});
