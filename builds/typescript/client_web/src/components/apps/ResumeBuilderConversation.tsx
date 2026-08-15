import type { Message } from "@/types/ui";

import Composer from "@/components/chat/Composer";
import MessageList from "@/components/chat/MessageList";

export type ResumeConversationAction = {
  id: string;
  label: string;
  primary?: boolean;
};

export type ResumeInlineConfirmation = {
  id: string;
  title: string;
  details: string[];
  confirmLabel: string;
};

export type ResumeConversationState = {
  messages: Message[];
  actions: ResumeConversationAction[];
  busy: boolean;
  inputEnabled: boolean;
  inputPlaceholder: string;
  stageLabel: string;
  supportLabel: string;
  reviewFacts: Array<{
    id: string;
    label: string;
    value: string;
  }>;
};

export default function ResumeBuilderConversation({
  conversation,
  confirmation,
  onSend,
  onAction,
  onConfirm,
  onEditConfirmation,
  onOpenReview,
}: {
  conversation: ResumeConversationState;
  confirmation?: ResumeInlineConfirmation | null;
  onSend: (message: string) => void;
  onAction: (actionId: string) => void;
  onConfirm: () => void;
  onEditConfirmation: () => void;
  onOpenReview: () => void;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-bd-bg-chat" aria-label="Resume Builder conversation">
      <header className="border-b border-bd-border px-4 py-3 sm:px-6">
        <p className="text-xs uppercase tracking-[0.16em] text-bd-text-muted">Resume Builder</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-lg font-semibold text-bd-text-heading">Resume interview</h1>
            <span className="rounded-full border border-bd-border px-2.5 py-1 text-xs text-bd-text-secondary">
              {conversation.stageLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenReview}
            className="rounded-md px-2 py-1.5 text-xs text-bd-text-muted underline decoration-bd-border underline-offset-4 transition-colors hover:text-bd-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber"
          >
            Review what I’ve shared
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <MessageList
            messages={conversation.messages}
            isTyping={conversation.busy && !confirmation}
            typingStatus={conversation.busy && !confirmation ? "Saving your answer..." : undefined}
          >
            {conversation.actions.length > 0 ? (
              <div className="flex flex-wrap gap-2 py-3" aria-label="Conversation actions">
                {conversation.actions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    disabled={conversation.busy}
                    onClick={() => onAction(action.id)}
                    className={[
                      "rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      action.primary
                        ? "border-bd-amber bg-bd-amber text-bd-bg-primary hover:bg-bd-amber-hover"
                        : "border-bd-border bg-bd-bg-secondary text-bd-text-primary hover:bg-bd-bg-hover",
                    ].join(" ")}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ) : null}
            {confirmation ? (
              <section
                key={confirmation.id}
                aria-label="Confirm shared information"
                className="my-3 border-l-2 border-bd-amber py-2 pl-4"
              >
                <p className="text-[15px] font-medium leading-7 text-bd-text-heading">{confirmation.title}</p>
                {confirmation.details.length > 1 ? (
                  <ul className="mt-2 space-y-1 text-sm leading-6 text-bd-text-primary">
                    {confirmation.details.map((detail, index) => <li key={`${index}-${detail}`}>• {detail}</li>)}
                  </ul>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-bd-text-primary">
                    {confirmation.details[0] ?? "Review this proposed fact before it is saved."}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2" aria-label="Fact confirmation actions">
                  <button
                    type="button"
                    onClick={onConfirm}
                    className="rounded-lg bg-bd-amber px-3 py-2 text-sm font-semibold text-bd-bg-primary hover:bg-bd-amber-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber"
                  >
                    {confirmation.confirmLabel}
                  </button>
                  <button
                    type="button"
                    onClick={onEditConfirmation}
                    className="rounded-lg border border-bd-border bg-bd-bg-secondary px-3 py-2 text-sm font-medium text-bd-text-primary hover:bg-bd-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber"
                  >
                    Edit
                  </button>
                </div>
              </section>
            ) : null}
            <p className="pb-3 text-xs text-bd-text-muted">
              {conversation.supportLabel}
            </p>
          </MessageList>
        </div>
      </div>

      {conversation.inputEnabled && !conversation.busy ? (
        <Composer
          onSend={onSend}
          placeholder={conversation.inputPlaceholder}
        />
      ) : (
        <div className="border-t border-bd-border px-4 py-3 text-center text-xs text-bd-text-muted sm:px-6">
          {confirmation
            ? "Confirm what I heard, or choose Edit and reply with a correction."
            : conversation.busy
            ? "Saving this turn in BrainDrive..."
            : "Continue from the conversation or open Review when you want the full workspace."}
        </div>
      )}
    </section>
  );
}
