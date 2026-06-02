import { render, screen, waitFor } from "@testing-library/react";
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
        error: new Error("This conversation has grown too large."),
        errorCode: "context_overflow",
      })
    );

    render(
      <ChatPanel
        activeConversationId={null}
        activeProjectId="finance"
        activeAppPath="/apps/budget"
        isEmpty={false}
      />
    );

    expect(screen.getByText(/This Budget conversation has grown too large/)).toBeInTheDocument();
    expect(screen.getByText(/continue from those saved files/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start New Conversation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue in New Conversation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try Again" })).not.toBeInTheDocument();
  });

  it("shows Budget file open actions after a saved Budget reply", async () => {
    const user = userEvent.setup();
    const onOpenProjectFile = vi.fn();
    useGatewayChatMock.mockReturnValue(
      makeHookState({
        messages: [
          {
            id: "a-1",
            role: "assistant",
            content: "I saved the Budget and refreshed the latest Budget report.",
          },
        ],
      })
    );

    render(
      <ChatPanel
        activeConversationId={null}
        activeProjectId="finance"
        activeAppPath="/apps/budget"
        isEmpty={false}
        onOpenProjectFile={onOpenProjectFile}
      />
    );

    expect(screen.getByText("Budget files are ready to review")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Latest Report" }));

    expect(onOpenProjectFile).toHaveBeenCalledWith("documents/finance/budget/reports/latest.md");
  });

  it("uploads PDF attachments through the selected project and sends a durable upload event", async () => {
    const user = userEvent.setup();
    const hookState = makeHookState();
    const onUploadDocument = vi.fn(async () => ({
      name: "statement.md",
      path: "documents/finance/statement.md",
      ownerLabel: "Statement",
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
      expect(onUploadDocument).toHaveBeenCalledWith(file);
    });
    await waitFor(() => {
      expect(hookState.append).toHaveBeenCalledWith(
        expect.stringContaining("Uploaded 1 statement:"),
        expect.any(Object)
      );
    });
    expect(hookState.append).toHaveBeenCalledWith(
      expect.stringContaining("Statement"),
      expect.any(Object)
    );
    expect(hookState.append).not.toHaveBeenCalledWith(
      expect.stringContaining("documents/finance/statement.md"),
      expect.any(Object)
    );
  });

  it("uploads multiple selected project documents sequentially", async () => {
    const user = userEvent.setup();
    const hookState = makeHookState();
    const lifecycleEvents: Array<Record<string, unknown>> = [];
    const onLifecycleEvent = (event: Event) => {
      lifecycleEvents.push({ ...((event as CustomEvent).detail as Record<string, unknown>) });
    };
    window.addEventListener("braindrive:upload-lifecycle", onLifecycleEvent);
    const onUploadDocument = vi
      .fn()
      .mockResolvedValueOnce({
        name: "february.md",
        path: "documents/finance/budget/statements/february.md",
        ownerLabel: "February statement",
        destinationLabel: "Budget statements",
      })
      .mockResolvedValueOnce({
        name: "march.md",
        path: "documents/finance/budget/statements/march.md",
        ownerLabel: "March statement",
        destinationLabel: "Budget statements",
      });
    useGatewayChatMock.mockReturnValue(hookState);

    try {
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
        expect.stringContaining("Uploaded 2 statements:"),
        expect.any(Object)
      );
    });
      expect(hookState.append).toHaveBeenCalledWith(
        expect.stringContaining("I received all 2 statements."),
        expect.any(Object)
      );
      expect(hookState.append).not.toHaveBeenCalledWith(
        expect.stringContaining("propagate completed statement-gathering state"),
        expect.any(Object)
      );

      expect(new Set(lifecycleEvents.map((event) => event.batchId)).size).toBe(1);
      expect(lifecycleEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ fileName: "february.csv", selectedFileCount: 2, stage: "selected" }),
        expect.objectContaining({ fileName: "march.csv", selectedFileCount: 2, stage: "selected" }),
        expect.objectContaining({ fileName: "february.csv", selectedFileCount: 2, stage: "saved_to_memory" }),
        expect.objectContaining({ fileName: "march.csv", selectedFileCount: 2, stage: "saved_to_memory" }),
        expect.objectContaining({ fileName: "february.csv", selectedFileCount: 2, stage: "attached_to_message" }),
        expect.objectContaining({ fileName: "march.csv", selectedFileCount: 2, stage: "attached_to_message" }),
      ]));
    } finally {
      window.removeEventListener("braindrive:upload-lifecycle", onLifecycleEvent);
    }
  });

  it("renders friendly upload receipts without raw source paths by default", async () => {
    const user = userEvent.setup();
    const hookState = makeHookState();
    const onUploadDocument = vi.fn(async () => ({
      name: "2026-04-northbridge.md",
      path: "documents/finance/budget/statements/2026-04-northbridge.md",
      ownerLabel: "Northbridge credit card statement",
      statementMonth: "April 2026",
      destinationLabel: "Budget statements",
      sourceType: "Credit card",
      accountName: "Northbridge",
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

    const statement = new File(["Date,Amount"], "northbridge.csv", { type: "text/csv" });
    await user.upload(input as HTMLInputElement, statement);
    await user.click(screen.getAllByRole("button", { name: "Send message" })[0]!);

    expect(await screen.findByText("Saved Northbridge credit card statement.")).toBeInTheDocument();
    expect(screen.getByText("April 2026 · Budget statements")).toBeInTheDocument();
    expect(screen.queryByText(/documents\/finance/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("Saved status: saved to Budget statements")).toBeInTheDocument();
    expect(screen.getByText("Original file: northbridge.csv (11 B)")).toBeInTheDocument();
    expect(screen.getByText("Source type: Credit card")).toBeInTheDocument();
    expect(screen.getByText("Account: Northbridge")).toBeInTheDocument();
  });

  it("collapses completed upload receipts after the assistant acknowledges them", async () => {
    const user = userEvent.setup();
    const hookState = makeHookState();
    const onUploadDocument = vi.fn(async () => ({
      name: "2026-04-northbridge.md",
      path: "documents/finance/budget/statements/2026-04-northbridge.md",
      ownerLabel: "Northbridge credit card statement",
      statementMonth: "April 2026",
      destinationLabel: "Budget statements",
    }));
    useGatewayChatMock.mockReturnValue(hookState);

    const props = {
      activeConversationId: null,
      activeProjectId: "finance",
      isEmpty: false,
      onUploadDocument,
    };
    const { container, rerender } = render(<ChatPanel {...props} />);

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    await user.upload(input as HTMLInputElement, new File(["Date,Amount"], "northbridge.csv", { type: "text/csv" }));
    await user.click(screen.getAllByRole("button", { name: "Send message" })[0]!);

    expect(await screen.findByText("Saved Northbridge credit card statement.")).toBeInTheDocument();

    useGatewayChatMock.mockReturnValue(makeHookState({ isLoading: true }));
    rerender(<ChatPanel {...props} />);
    useGatewayChatMock.mockReturnValue(
      makeHookState({
        isLoading: false,
        messages: [{ id: "a-1", role: "assistant", content: "I updated the received checklist." }],
      })
    );
    rerender(<ChatPanel {...props} />);

    await waitFor(() => {
      expect(screen.getByText("1 statement saved")).toBeInTheDocument();
    });
    expect(screen.queryByText("April 2026 · Budget statements")).not.toBeInTheDocument();
    expect(screen.queryByText(/documents\/finance/)).not.toBeInTheDocument();
  });
});
