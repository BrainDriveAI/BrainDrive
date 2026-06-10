import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, FileText, Loader2, RotateCcw } from "lucide-react";
import { createPortal } from "react-dom";

import {
  isAcceptedFile,
  formatFileSize,
  requiresMarkdownConversion,
  rejectFileMessage,
  type AttachedFile
} from "@/utils/file-utils";
import { getConversation, type ConversationDetail } from "@/api/gateway-adapter";
import { useGatewayChat } from "@/api/useGatewayChat";
import type { Message, ProjectFile } from "@/types/ui";

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
  activeAppPath?: string | null;
  draftKey?: string | null;
  isEmpty?: boolean;
  onConversationComplete?: (conversationId: string) => void;
  onStartNewConversation?: () => void | Promise<void>;
  messageMetadata?: Record<string, unknown>;
  contentOverride?: ReactNode;
  onSendMessage?: () => void;
  onUploadDocument?: (file: File) => Promise<ProjectFile | void>;
  onOpenSettings?: () => void;
};

type UploadActivity = {
  id: string;
  file: File;
  fileName: string;
  status: "uploading" | "converting" | "saved" | "failed";
  message: string;
  savedPath?: string;
  error?: string;
};

type UploadSuccess = {
  fileName: string;
  savedPath: string;
};

type UploadFailure = {
  fileName: string;
  error: string;
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

function readTextAttachment(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const fileContent = reader.result as string;
      resolve(`---\n**File: ${file.name}**\n\`\`\`\n${fileContent}\n\`\`\``);
    };
    reader.onerror = () => {
      reject(new Error(`Failed to read file: ${file.name}`));
    };
    reader.readAsText(file);
  });
}

function UploadActivityList({
  activities,
  onRetry
}: {
  activities: UploadActivity[];
  onRetry: (activity: UploadActivity) => void;
}) {
  if (activities.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 py-2">
      {activities.map((activity) => {
        const isPending = activity.status === "uploading" || activity.status === "converting";
        return (
          <div
            key={activity.id}
            className="flex items-start gap-3 rounded-lg border border-bd-border bg-bd-bg-secondary px-3 py-2 text-sm text-bd-text-primary"
          >
            {isPending ? (
              <Loader2 size={16} strokeWidth={1.7} className="mt-0.5 shrink-0 animate-spin text-bd-amber" />
            ) : activity.status === "saved" ? (
              <CheckCircle2 size={16} strokeWidth={1.7} className="mt-0.5 shrink-0 text-emerald-500" />
            ) : (
              <AlertCircle size={16} strokeWidth={1.7} className="mt-0.5 shrink-0 text-bd-danger" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate">{activity.message}</div>
              {activity.savedPath ? (
                <div className="truncate pt-0.5 text-xs text-bd-text-muted">
                  Source evidence: {activity.savedPath}
                </div>
              ) : null}
              {activity.error ? (
                <div className="pt-0.5 text-xs leading-5 text-bd-danger">{activity.error}</div>
              ) : null}
            </div>
            {activity.status === "failed" ? (
              <button
                type="button"
                onClick={() => onRetry(activity)}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-bd-border px-2 py-1 text-xs text-bd-text-secondary transition-colors hover:bg-bd-bg-hover hover:text-bd-text-primary"
              >
                <RotateCcw size={13} strokeWidth={1.7} />
                Retry
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function ChatPanel({
  activeConversationId,
  activeProjectId,
  activeAppPath,
  draftKey = null,
  isEmpty = false,
  onConversationComplete,
  onStartNewConversation,
  messageMetadata,
  contentOverride,
  onSendMessage,
  onUploadDocument,
  onOpenSettings
}: ChatPanelProps) {
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [uploadActivities, setUploadActivities] = useState<UploadActivity[]>([]);
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
  const uploadActivityCounterRef = useRef(0);

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
    setAttachments([]);
    setUploadActivities([]);
    setFileError(null);
  }, [activeProjectId, activeAppPath]);

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
  const shouldShowManualConversationReset =
    messages.length > 0 &&
    !isLoading &&
    !contextWindowWarning &&
    !visibleChatError;

  function resetErrorPresentation() {
    setHistoryError(null);
    if (visibleChatError) {
      setDismissedError(visibleChatError);
    }
    setConnectionStatus("connected");
  }

  async function handleStartNewConversation() {
    resetErrorPresentation();
    setHistoryMessages([]);
    startNewConversation();
    try {
      await onStartNewConversation?.();
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
      setConnectionStatus("disconnected");
    }
  }

  async function handleContinueInNewConversation() {
    const replayContent = lastUserMessage?.content?.trim();
    await handleStartNewConversation();
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

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const rejected = files.find((file) => !isAcceptedFile(file));
    if (rejected) {
      setFileError(rejectFileMessage(rejected.name));
      return;
    }

    setAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        file,
        name: file.name,
        size: formatFileSize(file.size)
      }))
    ]);
  }

  function handleAttach(attachedFiles: AttachedFile[]) {
    const rejected = attachedFiles.find((attached) => !isAcceptedFile(attached.file));
    if (rejected) {
      setFileError(rejectFileMessage(rejected.file.name));
      return;
    }

    setFileError(null);
    setAttachments((current) => [...current, ...attachedFiles]);
  }

  function removeAttachment(index: number) {
    setAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function nextUploadActivityId(): string {
    uploadActivityCounterRef.current += 1;
    return `upload-${uploadActivityCounterRef.current}`;
  }

  function updateUploadActivity(
    id: string,
    updater: (activity: UploadActivity) => UploadActivity
  ) {
    setUploadActivities((current) =>
      current.map((activity) => activity.id === id ? updater(activity) : activity)
    );
  }

  function buildUploadSummaryMessage(
    message: string,
    successes: UploadSuccess[],
    failures: UploadFailure[]
  ): string {
    const lines: string[] = [];
    const trimmed = message.trim();
    if (trimmed.length > 0) {
      lines.push(trimmed, "");
    }

    if (successes.length === 1) {
      lines.push("Uploaded 1 file:");
    } else if (successes.length > 1) {
      lines.push(`Uploaded ${successes.length} files:`);
    }
    for (const success of successes) {
      lines.push(`- ${success.fileName} -> ${success.savedPath}`);
    }

    if (failures.length > 0) {
      if (successes.length > 0) {
        lines.push("");
      }
      lines.push(failures.length === 1 ? "1 file did not upload:" : `${failures.length} files did not upload:`);
      for (const failure of failures) {
        lines.push(`- ${failure.fileName}: ${failure.error}`);
      }
    }

    lines.push("", "Please acknowledge the uploaded statement evidence and update the received/missing checklist for the budget setup before continuing.");
    return lines.join("\n");
  }

  async function uploadProjectFiles(message: string, files: File[]) {
    if (!onUploadDocument || !activeProjectId || activeProjectId === "braindrive-plus-one") {
      return;
    }

    const activities = files.map((file) => ({
      id: nextUploadActivityId(),
      file,
      fileName: file.name,
      status: requiresMarkdownConversion(file) ? "converting" as const : "uploading" as const,
      message: requiresMarkdownConversion(file)
        ? `Converting ${file.name} to markdown...`
        : `Uploading ${file.name}...`,
    }));
    setUploadActivities((current) => [...current, ...activities]);

    const successes: UploadSuccess[] = [];
    const failures: UploadFailure[] = [];

    for (const activity of activities) {
      try {
        const uploadedFile = await onUploadDocument(activity.file);
        const uploadedPath = uploadedFile?.path ?? activity.fileName;
        successes.push({
          fileName: activity.fileName,
          savedPath: uploadedPath,
        });
        updateUploadActivity(activity.id, (current) => ({
          ...current,
          status: "saved",
          savedPath: uploadedPath,
          message: `Saved ${current.fileName}.`,
        }));
      } catch (uploadError) {
        const errorMessage = uploadError instanceof Error ? uploadError.message : "Document upload failed.";
        failures.push({
          fileName: activity.fileName,
          error: errorMessage,
        });
        updateUploadActivity(activity.id, (current) => ({
          ...current,
          status: "failed",
          error: errorMessage,
          message: `Failed to upload ${current.fileName}.`,
        }));
      }
    }

    if (successes.length > 0) {
      onSendMessage?.();
      append(buildUploadSummaryMessage(message, successes, failures), { metadata: messageMetadata });
    } else if (failures.length > 0) {
      setFileError(failures.length === 1 ? failures[0]!.error : "Document uploads failed.");
    }
  }

  async function retryUpload(activity: UploadActivity) {
    setFileError(null);
    updateUploadActivity(activity.id, (current) => ({
      ...current,
      status: requiresMarkdownConversion(current.file) ? "converting" : "uploading",
      error: undefined,
      message: requiresMarkdownConversion(current.file)
        ? `Converting ${current.fileName} to markdown...`
        : `Uploading ${current.fileName}...`,
    }));

    try {
      const uploadedFile = await onUploadDocument?.(activity.file);
      const uploadedPath = uploadedFile?.path ?? activity.fileName;
      updateUploadActivity(activity.id, (current) => ({
        ...current,
        status: "saved",
        savedPath: uploadedPath,
        message: `Saved ${current.fileName}.`,
      }));
      onSendMessage?.();
      append(buildUploadSummaryMessage("", [{ fileName: activity.fileName, savedPath: uploadedPath }], []), {
        metadata: messageMetadata
      });
    } catch (uploadError) {
      const errorMessage = uploadError instanceof Error ? uploadError.message : "Document upload failed.";
      updateUploadActivity(activity.id, (current) => ({
        ...current,
        status: "failed",
        error: errorMessage,
        message: `Failed to upload ${current.fileName}.`,
      }));
      setFileError(errorMessage);
    }
  }

  const composerProps = {
    onSend: (message: string, files: File[] = []) => {
      if (files.length > 0) {
        if (onUploadDocument && activeProjectId && activeProjectId !== "braindrive-plus-one") {
          setAttachments([]);
          void uploadProjectFiles(message, files);
          return;
        }

        const convertedFile = files.find((file) => requiresMarkdownConversion(file));
        if (convertedFile) {
          setFileError("Open a project folder to upload images or PDFs for markdown conversion.");
          return;
        }

        void (async () => {
          try {
            const fileBlocks = await Promise.all(files.map(readTextAttachment));
            const combined = message
              ? `${message}\n\n${fileBlocks.join("\n\n")}`
              : fileBlocks.join("\n\n");
            setAttachments([]);
            onSendMessage?.();
            append(combined, { metadata: messageMetadata });
          } catch (readError) {
            setHistoryError(readError instanceof Error ? readError.message : "Failed to read attachment.");
          }
        })();
      } else {
        onSendMessage?.();
        append(message, { metadata: messageMetadata });
      }
    },
    attachments,
    onAttach: handleAttach,
    onRemoveAttachment: removeAttachment,
    onClearAttachments: () => setAttachments([]),
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
              .txt, .md, .vtt, .csv, images, or .pdf
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: '1 1 0%', minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          {shouldShowConversation ? (shouldShowEmptyState ? (
            <EmptyState
              projectId={activeProjectId}
              appPath={activeAppPath}
              onSuggestionClick={(suggestion) => append(suggestion, { metadata: messageMetadata })}
            />
          ) : (
            <MessageList
              messages={messages}
              isTyping={showTypingFeedback}
              typingStatus={typingStatus}
            >
              <UploadActivityList activities={uploadActivities} onRetry={retryUpload} />
              {shouldShowManualConversationReset && (
                <div className="mx-auto flex w-full max-w-[780px] justify-end px-4 py-2">
                  <button
                    type="button"
                    onClick={handleStartNewConversation}
                    className="rounded-lg border border-bd-border-primary px-3 py-1.5 text-xs font-medium text-bd-text-secondary transition-colors hover:border-bd-amber/50 hover:text-bd-text-primary"
                  >
                    Start New Conversation
                  </button>
                </div>
              )}
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
