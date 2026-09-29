import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { getConversation, type ConversationDetail } from "@/api/gateway-adapter";
import { useGatewayChat } from "@/api/useGatewayChat";
import type { ChatEvent } from "@/api/types";
import type { Message } from "@/types/ui";

import Composer from "./Composer";
import ConnectionBanner from "./ConnectionBanner";
import EmptyState, { type ProjectIntro } from "./EmptyState";
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
  app_action_resume_create: "Creating your resume...",
  app_action_resume_export_pdf_request: "Preparing your resume download...",
  app_action_resume_profile_read: "Reading your resume profile...",
  app_action_resume_profile_update: "Updating your resume profile...",
  app_action_resume_state_read: "Checking your resume workspace...",
  app_action_career_fact_propose: "Updating your career profile...",
  app_action_career_fact_confirm: "Saving your career profile...",
};

// AC-11.4 requires the stall state by 60 seconds without progress. Trigger it
// with a small scheduling margin because the shared surface begins measuring
// after the request enters the async chat lifecycle, not at the click event.
const STALL_NOTICE_AFTER_MS = 58_000;
const OPERATION_STATUS_POLL_MS = 100;

function formatToolStatus(toolName: string): string {
  if (toolName.startsWith("Approval")) {
    return toolName;
  }
  if (TOOL_STATUS_LABELS[toolName]) {
    return TOOL_STATUS_LABELS[toolName];
  }
  if (toolName.startsWith("app_action_")) {
    return `${ownerActionVerb(toolName.slice("app_action_".length))}...`;
  }
  return `Using ${toolName.replace(/_/g, " ")}...`;
}

function ownerActionVerb(actionName: string): string {
  const words = actionName.replace(/[_-]+/g, " ").trim();
  if (words.includes("export")) return "Preparing download";
  if (words.includes("read")) return `Reading ${words.replace(/\bread\b/g, "").trim() || "app data"}`;
  if (words.includes("write") || words.includes("confirm") || words.includes("save")) return `Saving ${words.replace(/\b(write|confirm|save)\b/g, "").trim() || "app data"}`;
  if (words.includes("create")) return `Creating ${words.replace(/\bcreate\b/g, "").trim() || "app result"}`;
  if (words.includes("propose") || words.includes("update")) return `Updating ${words.replace(/\b(propose|update)\b/g, "").trim() || "app data"}`;
  return `Working on ${words || "app action"}`;
}

type ChatPanelProps = {
  activeConversationId: string | null;
  activeProjectId?: string | null;
  draftKey?: string | null;
  isEmpty?: boolean;
  onConversationComplete?: (conversationId: string) => void;
  messageMetadata?: Record<string, unknown>;
  contentOverride?: ReactNode;
  emptyStateIntro?: ProjectIntro;
  onSendMessage?: () => void;
  onOpenSettings?: () => void;
  onStreamEvent?: (event: ChatEvent) => void | Promise<void>;
  statusNotice?: { tone: "info" | "success" | "error"; message: string } | null;
  queuedMessage?: { id: string; content: string } | null;
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
  emptyStateIntro,
  onSendMessage,
  onOpenSettings,
  onStreamEvent,
  statusNotice,
  queuedMessage
}: ChatPanelProps) {
  const [mobileComposerHeight, setMobileComposerHeight] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "disconnected" | "reconnecting"
  >("connected");
  const [historyMessages, setHistoryMessages] = useState<Message[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [operationAgeMs, setOperationAgeMs] = useState(0);
  const wasLoadingRef = useRef(false);
  const completedConversationIdRef = useRef<string | null>(null);
  const hasUsedToolRef = useRef(false);
  const lastQueuedMessageIdRef = useRef<string | null>(null);

  const {
    messages,
    isLoading,
    operationStartedAtMs,
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
    initialMessages: historyMessages,
    onStreamEvent,
  });

  useEffect(() => {
    if (!queuedMessage || queuedMessage.id === lastQueuedMessageIdRef.current) return;
    lastQueuedMessageIdRef.current = queuedMessage.id;
    append(queuedMessage.content, { metadata: messageMetadata });
    onSendMessage?.();
  }, [append, messageMetadata, onSendMessage, queuedMessage]);

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

  // Conversation state can be changed by another owner view. Refresh the
  // persisted transcript while this view is idle so an already-open view
  // receives committed turns without requiring a reload.
  useEffect(() => {
    if (!activeConversationId) {
      return;
    }

    let cancelled = false;
    const refresh = () => {
      if (cancelled || isLoading) {
        return;
      }

      void getConversation(activeConversationId)
        .then((conversation) => {
          if (!cancelled) {
            setHistoryMessages(mapConversationMessages(conversation));
          }
        })
        .catch(() => {
          // The initial load owns connection-error presentation. A transient
          // background refresh failure should not hide the current transcript.
        });
    };

    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeConversationId, isLoading]);

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
    if (!isLoading || operationStartedAtMs === null) {
      setOperationAgeMs(0);
      return;
    }
    const startedAt = operationStartedAtMs ?? Date.now();
    const update = () => setOperationAgeMs(Math.max(0, Date.now() - startedAt));
    update();
    const timer = window.setInterval(update, OPERATION_STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [isLoading, operationStartedAtMs]);

  useEffect(() => {
    if (wasLoadingRef.current && !isLoading && conversationId) {
      if (completedConversationIdRef.current !== conversationId) {
        completedConversationIdRef.current = conversationId;
        onConversationComplete?.(conversationId);
      }
    }

    if (isLoading) {
      completedConversationIdRef.current = null;
    }

    wasLoadingRef.current = isLoading;
  }, [conversationId, isLoading, onConversationComplete]);

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
  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant" && message.content.trim().length > 0) ?? null;
  const incompleteMessageId = lastAssistantMessage?.status === "incomplete"
    ? lastAssistantMessage.id
    : visibleChatError && lastAssistantMessage
      ? lastAssistantMessage.id
      : null;
  const isStalled = isLoading && operationAgeMs >= STALL_NOTICE_AFTER_MS;
  const isSlow = isLoading && operationAgeMs >= 3_000;

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
    onStop: stop,
    draftKey: draftKey ? `${draftKey}:composer` : null,
  };

  function renderIncompleteRetry() {
    if (!lastUserMessage) return undefined;
    return () => handleRetryCurrentTurn();
  }

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
              intro={emptyStateIntro}
              onSuggestionClick={(suggestion) => append(suggestion, { metadata: messageMetadata })}
            />
          ) : (
            <MessageList
              messages={messages}
              isTyping={showTypingFeedback}
              typingStatus={typingStatus}
              incompleteMessageId={incompleteMessageId}
              onRetryIncomplete={renderIncompleteRetry()}
            >
              {isSlow ? (
                <div role="status" aria-live="polite" className="mx-auto w-full max-w-[780px] rounded-xl border border-bd-amber/40 bg-bd-amber/10 px-4 py-3 text-sm text-bd-text-primary">
                  <p>{isStalled ? "This response is taking longer than expected. You can cancel it or try again." : "BrainDrive is still working on this response."}</p>
                  {isStalled ? (
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={stop} className="rounded-lg bg-bd-bg-tertiary px-3 py-1.5 text-xs text-bd-text-secondary">Cancel</button>
                      {lastUserMessage ? <button type="button" onClick={handleRetryCurrentTurn} className="rounded-lg bg-bd-bg-tertiary px-3 py-1.5 text-xs text-bd-text-secondary">Try Again</button> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {statusNotice ? (
                <div
                  role={statusNotice.tone === "error" ? "alert" : "status"}
                  className={`rounded-xl border px-4 py-3 text-sm ${
                    statusNotice.tone === "error"
                      ? "border-bd-danger-border bg-bd-danger-bg text-bd-danger"
                      : "border-bd-border bg-bd-bg-secondary text-bd-text-primary"
                  }`}
                >
                  {statusNotice.message}
                </div>
              ) : null}
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
              {visibleChatError && !incompleteMessageId && (
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
