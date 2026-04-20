import { render, screen } from "@testing-library/react";

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
});
