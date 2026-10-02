import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";

import type { Message } from "@/types/ui";
import MarkdownContent from "@/components/markdown/MarkdownContent";
import TypingIndicator from "./TypingIndicator";

type MessageListProps = {
  messages: Message[];
  isTyping?: boolean;
  typingStatus?: string;
  incompleteMessageId?: string | null;
  incompleteErrorCode?: string | null;
  onRetryIncomplete?: () => void;
  children?: ReactNode;
};

export default function MessageList({
  messages,
  isTyping = false,
  typingStatus,
  incompleteMessageId = null,
  incompleteErrorCode = null,
  onRetryIncomplete,
  children
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const hasRenderedMessagesRef = useRef(false);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    function handleScroll() {
      if (!container) return;
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      isNearBottomRef.current = distanceFromBottom < 150;
      setShowJumpToBottom(distanceFromBottom > 150);
    }

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Keep assistant replies anchored so users can read from the start as content streams in.
  // User messages still scroll down to reveal the submitted prompt and response area.
  useEffect(() => {
    const messageCount = messages.length;
    const lastMessage = messages[messageCount - 1];
    const shouldScrollForNewUserMessage =
      hasRenderedMessagesRef.current &&
      messageCount > prevMessageCountRef.current &&
      lastMessage?.role === "user" &&
      isNearBottomRef.current;

    if (shouldScrollForNewUserMessage) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    hasRenderedMessagesRef.current = true;
    prevMessageCountRef.current = messageCount;
  }, [messages]);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowJumpToBottom(false);
  }

  return (
    <div
      ref={scrollRef}
      className="relative overflow-y-auto overscroll-contain px-4 pb-[calc(var(--mobile-composer-height,0px)+1.5rem)] pt-6 sm:px-6 md:pb-6"
      style={{
        height: '100%',
        WebkitOverflowScrolling: "touch",
        touchAction: "pan-y",
        overflowY: 'auto',
        paddingLeft: "max(1rem, var(--safe-area-left))",
        paddingRight: "max(1rem, var(--safe-area-right))"
      }}
    >
      <div className="mx-auto flex w-full max-w-[780px] flex-col gap-4">
        {messages.map((message) => {
          if (message.role === "assistant") {
            return (
              <article key={message.id} className="py-4">
                <div className="max-w-full">
                  <div className="prose-bd text-[15px] leading-7 text-bd-text-primary">
                  <MarkdownContent content={message.content} />
                  </div>
                  {message.id === incompleteMessageId ? (
                    <div className="mt-3 rounded-xl border border-bd-danger-border bg-bd-danger-bg px-4 py-3 text-sm text-bd-text-primary">
                      <p role="status" aria-live="polite">
                        {incompleteErrorCode === "tool_error"
                          ? "This response is incomplete because a tool or app action failed. The failed action’s changes could not be confirmed. Your saved conversation and documents remain available. Check the app’s current state before trying again."
                          : "This response is incomplete because the model connection was interrupted. Your saved conversation and documents remain available. Try again to finish the response."}
                      </p>
                      {onRetryIncomplete ? (
                        <button
                          type="button"
                          onClick={onRetryIncomplete}
                          className="mt-2 flex items-center gap-1.5 rounded-lg bg-bd-bg-tertiary px-3 py-1.5 text-xs text-bd-text-secondary transition-colors hover:bg-bd-bg-hover"
                        >
                          Try Again
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          }

          return (
            <article key={message.id} className="py-4">
              <div className="flex justify-end">
                <div className="ml-auto w-fit max-w-[80%] rounded-[24px] bg-bd-bg-tertiary px-5 py-4 text-right">
                  <div className="whitespace-pre-wrap text-[15px] leading-7 text-bd-text-primary">
                    {message.content}
                  </div>
                  {message.status === "waiting_for_model" ? (
                    <div role="status" aria-live="polite" className="mt-2 text-xs text-bd-text-secondary">Waiting for the model</div>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}

        {isTyping && <TypingIndicator statusText={typingStatus} />}

        {children}

        <div ref={bottomRef} />
      </div>

      {showJumpToBottom && (
        <button
          type="button"
          aria-label="Jump to bottom"
          onClick={scrollToBottom}
          className="absolute bottom-[calc(var(--mobile-composer-height,0px)+1rem)] left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-bd-border bg-bd-bg-secondary shadow-lg transition-all duration-200 hover:bg-bd-bg-tertiary md:bottom-4"
        >
          <ArrowDown size={16} strokeWidth={1.5} className="text-bd-text-secondary" />
        </button>
      )}
    </div>
  );
}
