import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { createPortal } from "react-dom";

import {
  isAcceptedFile,
  formatFileSize,
  rejectFileMessage,
  type AttachedFile
} from "@/utils/file-utils";
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
  const [attachment, setAttachment] = useState<AttachedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
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
    startNewConversation,
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
  const isProviderError = visibleChatError != null && (
    visibleChatError.includes("credentials") ||
    visibleChatError.includes("could not be reached") ||
    visibleChatError.includes("provider") ||
    visibleChatError.includes("model")
  ) && !isContextOverflowError;
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user") ?? null;
  const shouldShowEmptyState = isEmpty && messages.length === 0 && !isLoading;
  const shouldShowConversation = contentOverride === undefined;

  function resetErrorPresentation() {
    setHistoryError(null);
    if (visibleChatError) {
      setDismissedError(visibleChatError);
    }
    setConnectionStatus("connected");
  }

  function handleStartNewConversation() {
    resetErrorPresentation();
    startNewConversation();
  }

  function handleContinueInNewConversation() {
    const replayContent = lastUserMessage?.content?.trim();
    handleStartNewConversation();
    if (replayContent && replayContent.length > 0) {
      append(replayContent, { metadata: messageMetadata });
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    setFileError(null);

    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (!isAcceptedFile(file)) {
      setFileError(rejectFileMessage(file.name));
      return;
    }

    setAttachment({
      file,
      name: file.name,
      size: formatFileSize(file.size)
    });
  }

  function handleAttach(attached: AttachedFile) {
    if (!isAcceptedFile(attached.file)) {
      setFileError(
        `"${attached.file.name}" is not supported. Upload .txt, .md, or .vtt files.`
      );
      return;
    }

    setFileError(null);
    setAttachment(attached);
  }

  const composerProps = {
    onSend: (message: string, file?: File) => {
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          const fileContent = reader.result as string;
          const combined = message
            ? `${message}\n\n---\n**File: ${file.name}**\n\`\`\`\n${fileContent}\n\`\`\``
            : `Here is the content of ${file.name}:\n\n\`\`\`\n${fileContent}\n\`\`\``;
          onSendMessage?.();
          append(combined, { metadata: messageMetadata });
        };
        reader.onerror = () => {
          setHistoryError(`Failed to read file: ${file.name}`);
        };
        reader.readAsText(file);
      } else {
        onSendMessage?.();
        append(message, { metadata: messageMetadata });
      }
    },
    attachment,
    onAttach: handleAttach,
    onRemoveAttachment: () => setAttachment(null),
    fileError,
    onClearFileError: () => setFileError(null),
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
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {connectionStatus !== "connected" && (
        <ConnectionBanner
          status={connectionStatus}
          onRetry={() => setConnectionStatus("connected")}
        />
      )}

      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-bd-bg-primary/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-bd-amber px-12 py-10">
            <FileText
              size={32}
              strokeWidth={1.5}
              className="text-bd-amber"
            />
            <div className="text-sm font-medium text-bd-text-heading">
              Drop file here
            </div>
            <div className="text-xs text-bd-text-muted">
              .txt, .md, or .vtt
            </div>
          </div>
        </div>
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
                    <button
                      type="button"
                      onClick={handleStartNewConversation}
                      className="mt-2 rounded-lg bg-bd-amber px-3 py-1.5 text-xs font-medium text-bd-bg-primary transition-colors hover:bg-bd-amber-hover"
                    >
                      Start New Conversation
                    </button>
                  </div>
                </div>
              )}
              {visibleChatError && (
                <ErrorMessage
                  message={visibleChatError}
                  onOpenSettings={isProviderError ? onOpenSettings : undefined}
                  onRetry={isContextOverflowError ? undefined : () => resetErrorPresentation()}
                  primaryActionLabel={isContextOverflowError ? "Start New Conversation" : undefined}
                  onPrimaryAction={isContextOverflowError ? handleStartNewConversation : undefined}
                  secondaryActionLabel={
                    isContextOverflowError && lastUserMessage ? "Continue in New Conversation" : undefined
                  }
                  onSecondaryAction={
                    isContextOverflowError && lastUserMessage ? handleContinueInNewConversation : undefined
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
