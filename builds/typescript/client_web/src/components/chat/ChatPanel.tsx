import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { getConversation, type ConversationDetail } from "@/api/gateway-adapter";
import { useGatewayChat } from "@/api/useGatewayChat";
import type { Message } from "@/types/ui";

import Composer from "./Composer";
import ConnectionBanner from "./ConnectionBanner";
import EmptyState from "./EmptyState";
import ErrorMessage from "./ErrorMessage";
import MessageList from "./MessageList";

const TOOL_STATUS_LABELS: Record<string, string> = {
  memory_read: "Reading from your library...",
  memory_write: "Writing to your library...",
  memory_list: "Looking through your files...",
  memory_search: "Searching your library...",
  memory_delete: "Updating your library...",
  memory_history: "Checking version history...",
  memory_export: "Preparing export...",
  auth_whoami: "Checking identity...",
  auth_check: "Checking permissions...",
};

function formatToolStatus(toolName: string): string {
  if (toolName.startsWith("Approval")) {
    return toolName;
  }
  return TOOL_STATUS_LABELS[toolName] ?? `Using ${toolName.replace(/_/g, " ")}...`;
}

type ChatPanelProps = {
  activeConversationId: string | null;
  activeProjectId?: string | null;
  draftKey?: string | null;
  isEmpty?: boolean;
  onConversationComplete?: (conversationId: string) => void;
  messageMetadata?: Record<string, unknown>;
  contentOverride?: ReactNode;
  onSendMessage?: () => void;
  onOpenSettings?: () => void;
};

function mapConversationMessages(conversation: ConversationDetail): Message[] {
  return conversation.messages
    .filter((message): message is { role: "user" | "assistant"; content: string } =>
      message.role === "user" || message.role === "assistant"
    )
    .map((message, index) => ({
      id: `${conversation.id}-${index + 1}`,
      role: message.role,
      content: message.content
    }));
}

export default function ChatPanel({
  activeConversationId,
  activeProjectId,
  draftKey = null,
  isEmpty = false,
  onConversationComplete,
  messageMetadata,
  contentOverride,
  onSendMessage,
  onOpenSettings
}: ChatPanelProps) {
  const [mobileComposerHeight, setMobileComposerHeight] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "disconnected" | "reconnecting"
  >("connected");
  const [historyMessages, setHistoryMessages] = useState<Message[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const wasLoadingRef = useRef(false);
  const completedConversationIdRef = useRef<string | null>(null);
  const hasUsedToolRef = useRef(false);

  const {
    messages,
    isLoading,
    error,
    errorCode,
    conversationId,
    toolStatus,
    pendingApprovals,
    contextWindowWarning,
    append,
    stop,
  } = useGatewayChat({
    conversationId: activeConversationId,
    projectId: activeProjectId ?? null,
    draftKey,
    initialMessages: historyMessages
  });

  useEffect(() => {
    let cancelled = false;

    setHistoryMessages([]);
    setHistoryError(null);

    if (!activeConversationId) {
      setConnectionStatus("connected");
      return () => {
        cancelled = true;
      };
    }

    void getConversation(activeConversationId)
      .then((conversation) => {
        if (cancelled) {
          return;
        }

        setHistoryMessages(mapConversationMessages(conversation));
        setConnectionStatus("connected");
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }

        setHistoryError(loadError instanceof Error ? loadError.message : String(loadError));
        setConnectionStatus("disconnected");
      });

    return () => {
      cancelled = true;
    };
  }, [activeConversationId]);

  useEffect(() => {
    if (error) {
      setConnectionStatus("disconnected");
    } else if (isLoading) {
      setConnectionStatus("connected");
    }
  }, [error, isLoading]);

  useEffect(() => {
    setDismissedError(null);
  }, [error, historyError]);

  useEffect(() => {
    if (wasLoadingRef.current && !isLoading && !error && conversationId) {
      if (completedConversationIdRef.current !== conversationId) {
        completedConversationIdRef.current = conversationId;
        onConversationComplete?.(conversationId);
      }
    }

    if (isLoading) {
      completedConversationIdRef.current = null;
    }

    wasLoadingRef.current = isLoading;
  }, [conversationId, error, isLoading, onConversationComplete]);

  if (toolStatus) {
    hasUsedToolRef.current = true;
  }
  if (!isLoading) {
    hasUsedToolRef.current = false;
  }

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const hasStartedAssistantReply = isLoading && lastMessage?.role === "assistant";
  const isWaitingForReply = isLoading && !hasStartedAssistantReply;
  const showTypingFeedback = isLoading && pendingApprovals.length === 0;
  const typingStatus = isLoading
    ? toolStatus
      ? formatToolStatus(toolStatus)
      : hasUsedToolRef.current ? "Working..." : "Thinking..."
    : undefined;
  const chatError = historyError ?? error?.message ?? null;
  const visibleChatError =
    chatError && chatError !== dismissedError ? chatError : null;
  const isContextOverflowError = errorCode === "context_overflow";
  const normalizedVisibleChatError = visibleChatError?.toLowerCase() ?? "";
  const isProviderError = visibleChatError != null && (
    normalizedVisibleChatError.includes("credentials") ||
    normalizedVisibleChatError.includes("quota") ||
    normalizedVisibleChatError.includes("credits") ||
    normalizedVisibleChatError.includes("api key") ||
    normalizedVisibleChatError.includes("could not be reached") ||
    normalizedVisibleChatError.includes("provider") ||
    normalizedVisibleChatError.includes("model")
  ) && !isContextOverflowError;
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user") ?? null;
  const visibleRecoveryMessage = isProviderError
    ? "The model connection was interrupted. Try again, or open settings if this keeps happening."
    : visibleChatError;
  const shouldShowEmptyState = isEmpty && messages.length === 0 && !isLoading;
  const shouldShowConversation = contentOverride === undefined;

  function resetErrorPresentation() {
    setHistoryError(null);
    if (visibleChatError) {
      setDismissedError(visibleChatError);
    }
    setConnectionStatus("connected");
  }

  function handleRetryCurrentTurn() {
    const retryMessage = lastUserMessage;
    const replayContent = retryMessage?.content?.trim();
    resetErrorPresentation();
    if (!retryMessage || !replayContent) {
      return;
    }

    append(replayContent, {
      metadata: {
        ...messageMetadata,
        retry_of_message_id: retryMessage.id,
        retry_reason: errorCode ?? "chat_error",
      },
      echoUserMessage: false,
    });
  }

  function ignoreDroppedFiles(event: DragEvent) {
    const types = event.dataTransfer.types ? Array.from(event.dataTransfer.types) : [];
    if (types.includes("Files") || event.dataTransfer.files.length > 0) {
      event.preventDefault();
    }
  }

  const composerProps = {
    onSend: (message: string) => {
      onSendMessage?.();
      append(message, { metadata: messageMetadata });
    },
    isStreaming: isWaitingForReply,
    onStop: stop
  };

  const mobileComposer = typeof document === "undefined"
    ? null
    : createPortal(
        <div
          className="pointer-events-none fixed inset-x-0 z-40 md:hidden"
          style={{ bottom: "var(--keyboard-inset)" }}
        >
          <Composer
            {...composerProps}
            layout="mobile-fixed"
            onHeightChange={setMobileComposerHeight}
          />
        </div>,
        document.body
      );

  const mobileComposerVar = {
    "--mobile-composer-height": `${mobileComposerHeight}px`
  } as CSSProperties;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-bd-bg-chat"
      style={mobileComposerVar}
      onDragOver={ignoreDroppedFiles}
      onDrop={ignoreDroppedFiles}
    >
      {connectionStatus !== "connected" && (
        <ConnectionBanner
          status={connectionStatus}
          onRetry={() => setConnectionStatus("connected")}
        />
      )}

      <div style={{ flex: '1 1 0%', minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          {shouldShowConversation ? (shouldShowEmptyState ? (
            <EmptyState
              projectId={activeProjectId}
              onSuggestionClick={(suggestion) => append(suggestion, { metadata: messageMetadata })}
            />
          ) : (
            <MessageList
              messages={messages}
              isTyping={showTypingFeedback}
              typingStatus={typingStatus}
            >
              {contextWindowWarning && !visibleChatError && (
                <div className="mx-auto w-full max-w-[780px] py-2">
                  <div className="rounded-xl border border-bd-amber/40 bg-bd-amber/10 px-4 py-3 text-sm text-bd-text-primary">
                    <p>
                      {contextWindowWarning.message}{" "}
                      <span className="text-bd-text-secondary">
                        ({Math.round(contextWindowWarning.ratio * 100)}% of current prompt budget)
                      </span>
                    </p>
                  </div>
                </div>
              )}
              {visibleChatError && (
                <ErrorMessage
                  message={visibleRecoveryMessage ?? visibleChatError}
                  onOpenSettings={isProviderError ? onOpenSettings : undefined}
                  onRetry={
                    isContextOverflowError
                      ? undefined
                      : isProviderError && lastUserMessage
                        ? handleRetryCurrentTurn
                        : () => resetErrorPresentation()
                  }
                  onDismiss={() => {
                    setHistoryError(null);
                    setDismissedError(visibleChatError);
                  }}
                />
              )}
            </MessageList>
          )) : contentOverride}
        </div>
      </div>
      <div className="hidden md:block">
        <Composer {...composerProps} />
      </div>
      {mobileComposer}
    </div>
  );
}
