import type { Message } from "@/types/ui";

import Composer from "@/components/chat/Composer";
import MessageList from "@/components/chat/MessageList";

export type ResumeConversationAction = {
  id: string;
  label: string;
  primary?: boolean;
};

export type ResumeEvidenceSummary = {
  confirmedCount: number;
  needsAttentionCount: number;
  stillToDiscussCount: number;
  recentFacts: Array<{
    id: string;
    label: string;
    value: string;
  }>;
};

export type ResumeConversationState = {
  messages: Message[];
  actions: ResumeConversationAction[];
  busy: boolean;
  inputEnabled: boolean;
  inputPlaceholder: string;
  stageLabel: string;
  supportLabel: string;
  evidence: ResumeEvidenceSummary;
};

export default function ResumeBuilderConversation({
  conversation,
  onSend,
  onAction,
}: {
  conversation: ResumeConversationState;
  onSend: (message: string) => void;
  onAction: (actionId: string) => void;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-bd-bg-chat" aria-label="Resume Builder conversation">
      <header className="border-b border-bd-border px-4 py-3 sm:px-6">
        <p className="text-xs uppercase tracking-[0.16em] text-bd-text-muted">Resume Builder</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-heading text-lg font-semibold text-bd-text-heading">Conversation</h1>
          <span className="rounded-full border border-bd-border px-2.5 py-1 text-xs text-bd-text-secondary">
            {conversation.stageLabel}
          </span>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <MessageList
            messages={conversation.messages}
            isTyping={conversation.busy}
            typingStatus={conversation.busy ? "Saving your answer..." : undefined}
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
          {conversation.busy
            ? "Saving this turn in BrainDrive..."
            : "Use a conversation action or the supporting panel to continue."}
        </div>
      )}
    </section>
  );
}
