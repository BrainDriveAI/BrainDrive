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

  it("uploads PDF attachments through the selected project and sends a durable upload event", async () => {
    const user = userEvent.setup();
    const hookState = makeHookState();
    const onUploadDocument = vi.fn(async () => ({
      name: "statement.md",
      path: "documents/finance/statement.md",
      ownerLabel: "Northbridge credit card statement",
      statementMonth: "May 2026",
      destinationLabel: "Finance",
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
      expect(onUploadDocument).toHaveBeenCalledWith(file, { openAfterUpload: false });
    });
    await waitFor(() => {
      expect(hookState.append).toHaveBeenCalledWith(
        expect.stringContaining("Uploaded 1 file:"),
        expect.any(Object)
      );
    });
    expect(hookState.append).toHaveBeenCalledWith(
      expect.stringContaining("Northbridge credit card statement (May 2026 - Finance)"),
      expect.any(Object)
    );
    expect(hookState.append).not.toHaveBeenCalledWith(
      expect.stringContaining("documents/finance/statement.md"),
      expect.any(Object)
    );
    expect(screen.queryByText(/Source evidence:/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("Source evidence: documents/finance/statement.md")).toBeInTheDocument();
  });

  it("uploads multiple selected project documents sequentially", async () => {
    const user = userEvent.setup();
    const hookState = makeHookState();
    const lifecycleEvents: Array<Record<string, unknown>> = [];
    function handleLifecycle(event: Event) {
      lifecycleEvents.push((event as CustomEvent<Record<string, unknown>>).detail);
    }
    window.addEventListener("braindrive:upload-lifecycle", handleLifecycle);
    const onUploadDocument = vi
      .fn()
      .mockResolvedValueOnce({
        name: "february.md",
        path: "documents/finance/february.md",
      })
      .mockResolvedValueOnce({
        name: "march.md",
        path: "documents/finance/march.md",
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
    expect(onUploadDocument.mock.calls[0]).toEqual([february, { openAfterUpload: false }]);
    expect(onUploadDocument.mock.calls[1]).toEqual([march, { openAfterUpload: false }]);
    await waitFor(() => {
      expect(hookState.append).toHaveBeenCalledWith(
        expect.stringContaining("Uploaded 2 files:"),
        expect.any(Object)
      );
    });
    expect(lifecycleEvents.map((event) => event.stage)).toEqual(expect.arrayContaining([
      "selected",
      "accepted_by_client_validation",
      "upload_request_started",
      "saved_to_memory",
      "visible_receipt_rendered",
      "attached_to_message",
    ]));
    expect(new Set(lifecycleEvents.map((event) => event.batchId)).size).toBe(1);
    window.removeEventListener("braindrive:upload-lifecycle", handleLifecycle);
  });

  it("preserves successful uploads when another file fails with owner-safe copy", async () => {
    const user = userEvent.setup();
    const hookState = makeHookState();
    const onUploadDocument = vi
      .fn()
      .mockResolvedValueOnce({
        name: "may.md",
        path: "documents/finance/may.md",
        ownerLabel: "Capital One credit card statement",
        statementMonth: "May 2026",
        destinationLabel: "Finance",
      })
      .mockRejectedValueOnce(new Error("ai_pdf_to_markdown returned empty markdown from OpenRouter parser"));
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
    const csv = new File(["Date,Amount"], "may.csv", { type: "text/csv" });
    const pdf = new File(["%PDF-1.6"], "june.pdf", { type: "application/pdf" });
    await user.upload(input as HTMLInputElement, [csv, pdf]);
    await user.click(screen.getAllByRole("button", { name: "Send message" })[0]!);

    await waitFor(() => {
      expect(onUploadDocument).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(hookState.append).toHaveBeenCalledWith(
        expect.stringContaining("Capital One credit card statement"),
        expect.any(Object)
      );
    });
    expect(hookState.append).toHaveBeenCalledWith(
      expect.stringContaining("We could not read this PDF"),
      expect.any(Object)
    );
    expect(hookState.append).not.toHaveBeenCalledWith(
      expect.stringContaining("ai_pdf_to_markdown"),
      expect.any(Object)
    );
  });

  it("retries a failed upload activity without re-uploading saved files", async () => {
    const user = userEvent.setup();
    const hookState = makeHookState();
    const onUploadDocument = vi
      .fn()
      .mockRejectedValueOnce(new Error("Document conversion provider failed."))
      .mockResolvedValueOnce({
        name: "june.md",
        path: "documents/finance/june.md",
        ownerLabel: "June statement",
        destinationLabel: "Finance",
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
    const pdf = new File(["%PDF-1.6"], "june.pdf", { type: "application/pdf" });
    await user.upload(input as HTMLInputElement, pdf);
    await user.click(screen.getAllByRole("button", { name: "Send message" })[0]!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(onUploadDocument).toHaveBeenCalledTimes(2);
    });
    expect(onUploadDocument.mock.calls[1]).toEqual([pdf, { openAfterUpload: false }]);
    await waitFor(() => {
      expect(hookState.append).toHaveBeenCalledWith(
        expect.stringContaining("June statement"),
        expect.any(Object)
      );
    });
  });
});
