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
  messageMetadata?: Record<string, unknown>;
  contentOverride?: ReactNode;
  onSendMessage?: () => void;
  onUploadDocument?: (file: File, options?: { openAfterUpload?: boolean }) => Promise<ProjectFile | void>;
  onOpenSettings?: () => void;
};

type UploadActivity = {
  id: string;
  batchId: string;
  file: File;
  fileName: string;
  fileType: string;
  fileSize: number;
  selectedFileCount: number;
  status: "uploading" | "converting" | "saved" | "failed";
  message: string;
  savedPath?: string;
  ownerLabel?: string;
  statementMonth?: string | null;
  destinationLabel?: string;
  sourceType?: string;
  accountName?: string | null;
  detailsOpen?: boolean;
  error?: string;
};

type UploadSuccess = {
  fileName: string;
  savedPath: string;
  ownerLabel?: string;
  statementMonth?: string | null;
  destinationLabel?: string;
};

type UploadFailure = {
  fileName: string;
  error: string;
};

type UploadLifecycleStage =
  | "selected"
  | "accepted_by_client_validation"
  | "conversion_started"
  | "upload_request_started"
  | "conversion_completed"
  | "saved_to_memory"
  | "visible_receipt_rendered"
  | "attached_to_message"
  | "failed";

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

function ownerSafeUploadError(error: unknown, fileName?: string): string {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "");
  const normalized = `${rawMessage} ${fileName ?? ""}`.toLowerCase();
  if (
    normalized.includes(".pdf") ||
    normalized.includes("pdf") ||
    normalized.includes("ai_pdf_to_markdown") ||
    normalized.includes("file-parser") ||
    normalized.includes("parser")
  ) {
    return "We could not read this PDF. Retry it, upload a CSV/export version, or continue with incomplete evidence.";
  }

  if (
    normalized.includes("provider") ||
    normalized.includes("model") ||
    normalized.includes("conversion") ||
    normalized.includes("markdown")
  ) {
    return "Document upload failed. Retry the file or upload a CSV/export version.";
  }

  return rawMessage || "Document upload failed. Retry the file or upload a CSV/export version.";
}

function dispatchUploadLifecycle(detail: {
  batchId: string;
  stage: UploadLifecycleStage;
  fileName: string;
  fileType: string;
  fileSize: number;
  selectedFileCount: number;
  projectId: string | null;
  status: UploadActivity["status"] | "selected" | "accepted" | "saved" | "attached";
  savedPath?: string;
  ownerLabel?: string;
  conversionStatus?: string;
  error?: string;
}) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent("braindrive:upload-lifecycle", { detail }));
}

function UploadActivityList({
  activities,
  onRetry,
  onToggleDetails,
}: {
  activities: UploadActivity[];
  onRetry: (activity: UploadActivity) => void;
  onToggleDetails: (activity: UploadActivity) => void;
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
              {activity.destinationLabel || activity.statementMonth ? (
                <div className="truncate pt-0.5 text-xs text-bd-text-muted">
                  {[activity.statementMonth, activity.destinationLabel].filter(Boolean).join(" - ")}
                </div>
              ) : null}
              {activity.savedPath && activity.detailsOpen ? (
                <div className="truncate pt-0.5 text-xs text-bd-text-muted">
                  Source evidence: {activity.savedPath}
                </div>
              ) : null}
              {activity.error ? (
                <div className="pt-0.5 text-xs leading-5 text-bd-danger">{activity.error}</div>
              ) : null}
            </div>
            {activity.status === "saved" && activity.savedPath ? (
              <button
                type="button"
                onClick={() => onToggleDetails(activity)}
                className="inline-flex shrink-0 items-center rounded-md border border-bd-border px-2 py-1 text-xs text-bd-text-secondary transition-colors hover:bg-bd-bg-hover hover:text-bd-text-primary"
              >
                {activity.detailsOpen ? "Hide" : "Details"}
              </button>
            ) : null}
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

  function toggleUploadActivityDetails(activity: UploadActivity) {
    updateUploadActivity(activity.id, (current) => ({
      ...current,
      detailsOpen: !current.detailsOpen,
    }));
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
      const label = success.ownerLabel ?? success.fileName;
      const detail = [success.statementMonth, success.destinationLabel].filter(Boolean).join(" - ");
      lines.push(detail ? `- ${label} (${detail})` : `- ${label}`);
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

    const batchId = nextUploadActivityId();
    const selectedFileCount = files.length;
    const activities = files.map((file) => ({
      id: nextUploadActivityId(),
      batchId,
      file,
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      fileSize: file.size,
      selectedFileCount,
      status: requiresMarkdownConversion(file) ? "converting" as const : "uploading" as const,
      message: requiresMarkdownConversion(file)
        ? `Converting ${file.name} to markdown...`
        : `Uploading ${file.name}...`,
    }));
    setUploadActivities((current) => [...current, ...activities]);
    for (const activity of activities) {
      dispatchUploadLifecycle({
        batchId,
        stage: "selected",
        fileName: activity.fileName,
        fileType: activity.fileType,
        fileSize: activity.fileSize,
        selectedFileCount,
        projectId: activeProjectId ?? null,
        status: "selected",
      });
      dispatchUploadLifecycle({
        batchId,
        stage: "accepted_by_client_validation",
        fileName: activity.fileName,
        fileType: activity.fileType,
        fileSize: activity.fileSize,
        selectedFileCount,
        projectId: activeProjectId ?? null,
        status: activity.status,
      });
    }

    const successes: UploadSuccess[] = [];
    const failures: UploadFailure[] = [];

    for (const activity of activities) {
      try {
        dispatchUploadLifecycle({
          batchId: activity.batchId,
          stage: activity.status === "converting" ? "conversion_started" : "upload_request_started",
          fileName: activity.fileName,
          fileType: activity.fileType,
          fileSize: activity.fileSize,
          selectedFileCount: activity.selectedFileCount,
          projectId: activeProjectId ?? null,
          status: activity.status,
        });
        const uploadedFile = await onUploadDocument(activity.file, { openAfterUpload: false });
        const uploadedPath = uploadedFile?.path ?? activity.fileName;
        const ownerLabel = uploadedFile?.ownerLabel ?? activity.fileName;
        successes.push({
          fileName: activity.fileName,
          savedPath: uploadedPath,
          ownerLabel,
          statementMonth: uploadedFile?.statementMonth,
          destinationLabel: uploadedFile?.destinationLabel,
        });
        updateUploadActivity(activity.id, (current) => ({
          ...current,
          status: "saved",
          savedPath: uploadedPath,
          ownerLabel,
          statementMonth: uploadedFile?.statementMonth,
          destinationLabel: uploadedFile?.destinationLabel,
          sourceType: uploadedFile?.sourceType,
          accountName: uploadedFile?.accountName,
          message: `Saved ${ownerLabel}.`,
        }));
        if (activity.status === "converting") {
          dispatchUploadLifecycle({
            batchId: activity.batchId,
            stage: "conversion_completed",
            fileName: activity.fileName,
            fileType: activity.fileType,
            fileSize: activity.fileSize,
            selectedFileCount: activity.selectedFileCount,
            projectId: activeProjectId ?? null,
            status: "saved",
            savedPath: uploadedPath,
            ownerLabel,
            conversionStatus: "completed",
          });
        }
        dispatchUploadLifecycle({
          batchId: activity.batchId,
          stage: "saved_to_memory",
          fileName: activity.fileName,
          fileType: activity.fileType,
          fileSize: activity.fileSize,
          selectedFileCount: activity.selectedFileCount,
          projectId: activeProjectId ?? null,
          status: "saved",
          savedPath: uploadedPath,
          ownerLabel,
        });
      } catch (uploadError) {
        const errorMessage = ownerSafeUploadError(uploadError, activity.fileName);
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
        dispatchUploadLifecycle({
          batchId: activity.batchId,
          stage: "failed",
          fileName: activity.fileName,
          fileType: activity.fileType,
          fileSize: activity.fileSize,
          selectedFileCount: activity.selectedFileCount,
          projectId: activeProjectId ?? null,
          status: "failed",
          error: errorMessage,
        });
      }
    }

    if (successes.length > 0) {
      onSendMessage?.();
      append(buildUploadSummaryMessage(message, successes, failures), { metadata: messageMetadata });
      for (const success of successes) {
        const activity = activities.find((candidate) => candidate.fileName === success.fileName);
        if (!activity) {
          continue;
        }
        dispatchUploadLifecycle({
          batchId: activity.batchId,
          stage: "visible_receipt_rendered",
          fileName: activity.fileName,
          fileType: activity.fileType,
          fileSize: activity.fileSize,
          selectedFileCount: activity.selectedFileCount,
          projectId: activeProjectId ?? null,
          status: "saved",
          savedPath: success.savedPath,
          ownerLabel: success.ownerLabel,
        });
        dispatchUploadLifecycle({
          batchId: activity.batchId,
          stage: "attached_to_message",
          fileName: activity.fileName,
          fileType: activity.fileType,
          fileSize: activity.fileSize,
          selectedFileCount: activity.selectedFileCount,
          projectId: activeProjectId ?? null,
          status: "attached",
          savedPath: success.savedPath,
          ownerLabel: success.ownerLabel,
        });
      }
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
      dispatchUploadLifecycle({
        batchId: activity.batchId,
        stage: activity.status === "converting" ? "conversion_started" : "upload_request_started",
        fileName: activity.fileName,
        fileType: activity.fileType,
        fileSize: activity.fileSize,
        selectedFileCount: activity.selectedFileCount,
        projectId: activeProjectId ?? null,
        status: requiresMarkdownConversion(activity.file) ? "converting" : "uploading",
      });
      const uploadedFile = await onUploadDocument?.(activity.file, { openAfterUpload: false });
      const uploadedPath = uploadedFile?.path ?? activity.fileName;
      const ownerLabel = uploadedFile?.ownerLabel ?? activity.fileName;
      updateUploadActivity(activity.id, (current) => ({
        ...current,
        status: "saved",
        savedPath: uploadedPath,
        ownerLabel,
        statementMonth: uploadedFile?.statementMonth,
        destinationLabel: uploadedFile?.destinationLabel,
        sourceType: uploadedFile?.sourceType,
        accountName: uploadedFile?.accountName,
        message: `Saved ${ownerLabel}.`,
      }));
      dispatchUploadLifecycle({
        batchId: activity.batchId,
        stage: "saved_to_memory",
        fileName: activity.fileName,
        fileType: activity.fileType,
        fileSize: activity.fileSize,
        selectedFileCount: activity.selectedFileCount,
        projectId: activeProjectId ?? null,
        status: "saved",
        savedPath: uploadedPath,
        ownerLabel,
      });
      onSendMessage?.();
      append(buildUploadSummaryMessage("", [{
        fileName: activity.fileName,
        savedPath: uploadedPath,
        ownerLabel,
        statementMonth: uploadedFile?.statementMonth,
        destinationLabel: uploadedFile?.destinationLabel,
      }], []), {
        metadata: messageMetadata
      });
      dispatchUploadLifecycle({
        batchId: activity.batchId,
        stage: "visible_receipt_rendered",
        fileName: activity.fileName,
        fileType: activity.fileType,
        fileSize: activity.fileSize,
        selectedFileCount: activity.selectedFileCount,
        projectId: activeProjectId ?? null,
        status: "saved",
        savedPath: uploadedPath,
        ownerLabel,
      });
      dispatchUploadLifecycle({
        batchId: activity.batchId,
        stage: "attached_to_message",
        fileName: activity.fileName,
        fileType: activity.fileType,
        fileSize: activity.fileSize,
        selectedFileCount: activity.selectedFileCount,
        projectId: activeProjectId ?? null,
        status: "attached",
        savedPath: uploadedPath,
        ownerLabel,
      });
    } catch (uploadError) {
      const errorMessage = ownerSafeUploadError(uploadError, activity.fileName);
      updateUploadActivity(activity.id, (current) => ({
        ...current,
        status: "failed",
        error: errorMessage,
        message: `Failed to upload ${current.fileName}.`,
      }));
      setFileError(errorMessage);
      dispatchUploadLifecycle({
        batchId: activity.batchId,
        stage: "failed",
        fileName: activity.fileName,
        fileType: activity.fileType,
        fileSize: activity.fileSize,
        selectedFileCount: activity.selectedFileCount,
        projectId: activeProjectId ?? null,
        status: "failed",
        error: errorMessage,
      });
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
              <UploadActivityList
                activities={uploadActivities}
                onRetry={retryUpload}
                onToggleDetails={toggleUploadActivityDetails}
              />
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
