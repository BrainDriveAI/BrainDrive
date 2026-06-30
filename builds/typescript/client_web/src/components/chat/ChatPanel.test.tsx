import { fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.queryByRole("button", { name: "Start New Conversation" })).not.toBeInTheDocument();
  });

  it("does not expose fresh conversation actions for overflow errors", () => {
    useGatewayChatMock.mockReturnValue(
      makeHookState({
        messages: [{ id: "u-1", role: "user", content: "Continue from this prompt" }],
        error: new Error("This session has gotten long."),
        errorCode: "context_overflow",
      })
    );

    render(<ChatPanel activeConversationId={null} isEmpty={false} />);

    expect(screen.queryByRole("button", { name: "Start New Conversation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue in New Conversation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try Again" })).not.toBeInTheDocument();
  });

  it("treats provider timeout messages as provider errors regardless of casing", () => {
    const onOpenSettings = vi.fn();
    const hookState = makeHookState({
      messages: [{ id: "u-1", role: "user", content: "Please build my finance plan." }],
      error: new Error("Provider did not respond in time.\nWhat to check:\n1. Retry the request."),
      errorCode: "provider_error",
    });
    useGatewayChatMock.mockReturnValue(hookState);

    render(<ChatPanel activeConversationId={null} isEmpty={false} onOpenSettings={onOpenSettings} />);

    expect(screen.getByText(/The model connection was interrupted/)).toBeInTheDocument();
    expect(screen.queryByText(/Provider did not respond in time/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));

    expect(hookState.append).toHaveBeenCalledWith("Please build my finance plan.", {
      metadata: {
        retry_of_message_id: "u-1",
        retry_reason: "provider_error",
      },
      echoUserMessage: false,
    });
  });

  it("does not offer a fresh conversation action for normal existing history", () => {
    const hookState = makeHookState({
      messages: [
        { id: "u-1", role: "user", content: "I want to work on career planning." },
        { id: "a-1", role: "assistant", content: "Let's start with your current role." },
      ],
    });
    useGatewayChatMock.mockReturnValue(hookState);

    render(
      <ChatPanel
        activeConversationId="conversation-1"
        isEmpty={false}
      />
    );

    expect(screen.queryByRole("button", { name: "Start New Conversation" })).not.toBeInTheDocument();
    expect(hookState.startNewConversation).not.toHaveBeenCalled();
  });

  it("does not expose retired document upload controls", () => {
    const hookState = makeHookState();
    useGatewayChatMock.mockReturnValue(hookState);

    const { container } = render(
      <ChatPanel
        activeConversationId={null}
        activeProjectId="finance"
        isEmpty={false}
      />
    );

    expect(container.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach file" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Drop file here/)).not.toBeInTheDocument();
  });

  it("ignores dropped files and sends only typed chat text", async () => {
    const user = userEvent.setup();
    const hookState = makeHookState();
    useGatewayChatMock.mockReturnValue(hookState);

    const { container } = render(
      <ChatPanel
        activeConversationId={null}
        activeProjectId="finance"
        isEmpty={false}
      />
    );

    fireEvent.drop(container.firstElementChild ?? document.body, {
      dataTransfer: {
        files: [new File(["Date,Amount"], "statement.csv", { type: "text/csv" })],
      },
    });
    expect(screen.queryByText(/statement.csv/)).not.toBeInTheDocument();

    await user.type(screen.getAllByPlaceholderText("Message your BrainDrive...")[0]!, "Use ordinary chat.");
    await user.click(screen.getAllByRole("button", { name: "Send message" })[0]!);

    expect(hookState.append).not.toHaveBeenCalledWith(
      expect.stringContaining("statement.csv"),
      expect.any(Object)
    );
    expect(hookState.append).toHaveBeenCalledWith("Use ordinary chat.", expect.any(Object));
  });
});
