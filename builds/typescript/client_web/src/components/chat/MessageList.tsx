import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";

import type { Message } from "@/types/ui";
import MarkdownContent from "@/components/markdown/MarkdownContent";
import { polishOwnerVisibleAssistantCopy } from "@/utils/owner-copy";
import TypingIndicator from "./TypingIndicator";

type MessageListProps = {
  messages: Message[];
  isTyping?: boolean;
  typingStatus?: string;
  children?: ReactNode;
};

export default function MessageList({
  messages,
  isTyping = false,
  typingStatus,
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
        {messages.map((message, index) => {
          if (message.role === "assistant") {
            return (
              <article key={message.id} className="py-4">
                <div className="prose-bd max-w-full text-[15px] leading-7 text-bd-text-primary">
                  <MarkdownContent content={polishOwnerVisibleAssistantCopy(message.content)} />
                </div>
              </article>
            );
          }

          const hasLaterAssistantReply = messages.slice(index + 1).some((candidate) => candidate.role === "assistant");
          const compactReceipt = hasLaterAssistantReply
            ? compactAcknowledgedUploadReceipt(message.content)
            : null;

          return (
            <article key={message.id} className="py-4">
              <div className="flex justify-end">
                <div className="ml-auto w-fit max-w-[80%] rounded-[24px] bg-bd-bg-tertiary px-5 py-4 text-right">
                  <div className="whitespace-pre-wrap text-[15px] leading-7 text-bd-text-primary">
                    {compactReceipt ? (
                      <details>
                        <summary className="cursor-pointer list-none">{compactReceipt.summary}</summary>
                        <div className="mt-3 text-left text-[13px] leading-6 text-bd-text-secondary">
                          {message.content}
                        </div>
                      </details>
                    ) : (
                      message.content
                    )}
                  </div>
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

function compactAcknowledgedUploadReceipt(content: string): { summary: string } | null {
  const match = content.match(/^Uploaded\s+(\d+)\s+statements?:\s*$/im);
  if (!match) {
    return null;
  }

  const failedMatch = content.match(/(?:^|\n)(\d+)\s+(?:file|files)\s+did not upload:/i);
  const count = Number(match[1]);
  if (!Number.isFinite(count) || count <= 0 || failedMatch) {
    return null;
  }

  return {
    summary: `${count} statement${count === 1 ? "" : "s"} uploaded. Details collapsed after BrainDrive acknowledged them.`,
  };
}
