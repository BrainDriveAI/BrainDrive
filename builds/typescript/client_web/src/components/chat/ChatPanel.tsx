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
import {
  destinationLabelForMemoryPath,
  ownerLabelForMemoryPath,
  statementMonthLabelForMemoryPath
} from "@/utils/owner-labels";
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

function isBudgetApp(projectId?: string | null, appPath?: string | null): boolean {
  return projectId === "finance" && (!appPath || appPath.includes("/budget"));
}

function contextOverflowRecoveryMessage(projectId?: string | null, appPath?: string | null): string {
  if (isBudgetApp(projectId, appPath)) {
    return [
      "This Budget conversation has grown too large to continue in one reply.",
      "Your uploaded statements, Budget draft, latest report, and Todos are saved in Memory if they appear in the saved files.",
      "Start a new Budget conversation and I will continue from those saved files.",
    ].join("\n");
  }

  return [
    "This conversation has grown too large to continue in one reply.",
    "Your saved Memory files remain available.",
    "Start a new conversation to continue from saved files.",
  ].join("\n");
}

function providerErrorRecoveryMessage(): string {
  return [
    "The assistant could not finish that reply.",
    "Your conversation and files are still here.",
    "Try again in a moment. If this keeps happening, contact your BrainDrive admin with the time of this failure.",
  ].join("\n");
}

function ownerVisibleUploadError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : "";
  if (/\b(?:ai_pdf_to_markdown|ai_image_to_markdown|AI conversion).{0,80}empty markdown\b/i.test(rawMessage) ||
      /\breturned empty markdown\b/i.test(rawMessage) ||
      /\bPDF requires\b/i.test(rawMessage) ||
      /\bOpenRouter PDF parsing\b/i.test(rawMessage) ||
      /\bextractable page images\b/i.test(rawMessage)) {
    return "We could not read this PDF. Retry it, upload a CSV/export version, or continue with incomplete evidence.";
  }
  if (rawMessage.trim().length > 0) {
    return rawMessage;
  }
  return "Document upload failed. Retry the file or upload a CSV/export version.";
}

function shouldShowBudgetFileActions(input: {
  messages: Message[];
  activeProjectId?: string | null;
  activeAppPath?: string | null;
  canOpenProjectFile: boolean;
}): boolean {
  if (!input.canOpenProjectFile || !isBudgetApp(input.activeProjectId, input.activeAppPath)) {
    return false;
  }

  const assistantText = input.messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .join("\n");

  return /\b(?:saved Budget|latest Budget report|Budget report|budget comparison|reports? updated|first-pass Budget|draft actuals baseline|Needs Review)\b/i.test(assistantText);
}

function shouldShowFinancePlanActions(input: {
  messages: Message[];
  activeProjectId?: string | null;
  activeAppPath?: string | null;
  canOpenProjectFile: boolean;
}): boolean {
  if (!input.canOpenProjectFile || input.activeProjectId !== "finance" || input.activeAppPath?.includes("/budget")) {
    return false;
  }

  const assistantText = input.messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .join("\n");

  return /\b(?:Finance plan|Your Plan|payoff|pay down|APR|minimum payment|Roth IRA|retirement boundary|owner decision)\b/i.test(assistantText);
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
  onOpenProjectFile?: (filePath: string) => void;
  onOpenSettings?: () => void;
};

type UploadActivity = {
  id: string;
  batchId: string;
  file: File;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: "uploading" | "converting" | "saved" | "failed";
  message: string;
  savedPath?: string;
  ownerLabel?: string;
  statementMonth?: string | null;
  destinationLabel?: string;
  sourceType?: string;
  accountName?: string | null;
  detailsOpen?: boolean;
  collapsed?: boolean;
  error?: string;
};

type UploadSuccess = {
  fileName: string;
  savedPath: string;
  ownerLabel: string;
  statementMonth?: string | null;
  destinationLabel: string;
  sourceType?: string;
  accountName?: string | null;
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
  | "assistant_acknowledged"
  | "failed";

type UploadLifecycleEventDetail = {
  batchId: string;
  stage: UploadLifecycleStage;
  fileName: string;
  fileType: string;
  fileSize: number;
  selectedFileCount: number;
  projectId: string;
  status: "pending" | "ok" | "error";
  savedPath?: string;
  ownerLabel?: string;
  conversionStatus?: "not_needed" | "started" | "completed" | "failed";
  error?: string;
};

const UPLOAD_LIFECYCLE_EVENT = "braindrive:upload-lifecycle";

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
  onRetry,
  onToggleDetails
}: {
  activities: UploadActivity[];
  onRetry: (activity: UploadActivity) => void;
  onToggleDetails: (activity: UploadActivity) => void;
}) {
  if (activities.length === 0) {
    return null;
  }

  const collapsedSaved = activities.filter((activity) => activity.status === "saved" && activity.collapsed);
  const visibleActivities = activities.filter((activity) => activity.status !== "saved" || !activity.collapsed);

  return (
    <div className="space-y-2 py-2">
      {collapsedSaved.length > 0 ? (
        <div className="rounded-lg border border-bd-border bg-bd-bg-secondary px-3 py-2 text-sm text-bd-text-primary">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={16} strokeWidth={1.7} className="mt-0.5 shrink-0 text-emerald-500" />
            <div className="min-w-0 flex-1">
              <div>
                {collapsedSaved.length === 1
                  ? "1 statement saved"
                  : `${collapsedSaved.length} statements saved`}
              </div>
              <div className="truncate pt-0.5 text-xs text-bd-text-muted">
                {collapsedSaved.map((activity) => activity.ownerLabel ?? activity.fileName).join(", ")}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {visibleActivities.map((activity) => {
        const isPending = activity.status === "uploading" || activity.status === "converting";
        const secondary = [
          activity.statementMonth,
          activity.destinationLabel
        ].filter(Boolean).join(" · ");
        return (
          <div
            key={activity.id}
            data-upload-batch-id={activity.batchId}
            data-upload-file-name={activity.fileName}
            data-upload-status={activity.status}
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
              {secondary ? (
                <div className="truncate pt-0.5 text-xs text-bd-text-muted">
                  {secondary}
                </div>
              ) : null}
              {activity.savedPath && activity.status === "saved" ? (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => onToggleDetails(activity)}
                    className="text-xs text-bd-text-muted underline-offset-2 transition-colors hover:text-bd-text-secondary hover:underline"
                  >
                    {activity.detailsOpen ? "Hide details" : "Details"}
                  </button>
                  {activity.detailsOpen ? (
                    <div className="space-y-0.5 pt-1 text-xs text-bd-text-muted">
                      <div>Saved status: saved to Budget statements</div>
                      <div>Owner label: {activity.ownerLabel ?? activity.fileName}</div>
                      <div>Original file: {activity.fileName} ({formatFileSize(activity.fileSize)})</div>
                      {activity.sourceType ? <div>Source type: {activity.sourceType}</div> : null}
                      {activity.accountName ? <div>Account: {activity.accountName}</div> : null}
                      <div className="truncate">Source evidence path: {activity.savedPath}</div>
                    </div>
                  ) : null}
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

function BudgetFileActions({ onOpenProjectFile }: { onOpenProjectFile?: (filePath: string) => void }) {
  return (
    <div className="mx-auto w-full max-w-[780px] py-2">
      <div className="rounded-lg border border-bd-border bg-bd-bg-secondary px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-bd-text-heading">Budget files are ready to review</div>
            <div className="mt-1 text-xs leading-5 text-bd-text-secondary">
              Open the saved Budget or latest Budget report from here.
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onOpenProjectFile?.("documents/finance/budget/budget.md")}
              className="inline-flex items-center gap-2 rounded-md border border-bd-border px-3 py-2 text-xs font-medium text-bd-text-primary transition-colors hover:bg-bd-bg-hover"
            >
              <FileText size={14} strokeWidth={1.7} />
              Open Budget
            </button>
            <button
              type="button"
              onClick={() => onOpenProjectFile?.("documents/finance/budget/reports/latest.md")}
              className="inline-flex items-center gap-2 rounded-md bg-bd-amber px-3 py-2 text-xs font-medium text-bd-bg-primary transition-colors hover:bg-bd-amber-hover"
            >
              <FileText size={14} strokeWidth={1.7} />
              Open Latest Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FinancePlanActions({ onOpenProjectFile }: { onOpenProjectFile?: (filePath: string) => void }) {
  return (
    <div className="mx-auto w-full max-w-[780px] py-2">
      <div className="rounded-lg border border-bd-border bg-bd-bg-secondary px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-bd-text-heading">Finance plan is ready to review</div>
            <div className="mt-1 text-xs leading-5 text-bd-text-secondary">
              Open Your Plan before acting on payoff or retirement-boundary steps.
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onOpenProjectFile?.("documents/finance/spec.md")}
              className="inline-flex items-center gap-2 rounded-md border border-bd-border px-3 py-2 text-xs font-medium text-bd-text-primary transition-colors hover:bg-bd-bg-hover"
            >
              <FileText size={14} strokeWidth={1.7} />
              Open Your Goals
            </button>
            <button
              type="button"
              onClick={() => onOpenProjectFile?.("documents/finance/plan.md")}
              className="inline-flex items-center gap-2 rounded-md bg-bd-amber px-3 py-2 text-xs font-medium text-bd-bg-primary transition-colors hover:bg-bd-amber-hover"
            >
              <FileText size={14} strokeWidth={1.7} />
              Open Your Plan
            </button>
          </div>
        </div>
      </div>
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
  onOpenProjectFile
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
  const uploadBatchCounterRef = useRef(0);
  const acknowledgedUploadBatchesRef = useRef(new Set<string>());

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
    if (wasLoadingRef.current && !isLoading && !error) {
      if (conversationId && completedConversationIdRef.current !== conversationId) {
        completedConversationIdRef.current = conversationId;
        onConversationComplete?.(conversationId);
      }
      collapseSavedUploadActivities();
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
  const isProviderError = errorCode === "provider_error";
  const displayedChatError = isContextOverflowError
    ? contextOverflowRecoveryMessage(activeProjectId, activeAppPath)
    : isProviderError && visibleChatError
      ? providerErrorRecoveryMessage()
    : visibleChatError;
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user") ?? null;
  const shouldShowEmptyState = isEmpty && messages.length === 0 && !isLoading;
  const shouldShowConversation = contentOverride === undefined;
  const showBudgetFileActions = shouldShowBudgetFileActions({
    messages,
    activeProjectId,
    activeAppPath,
    canOpenProjectFile: Boolean(onOpenProjectFile),
  });
  const showFinancePlanActions = shouldShowFinancePlanActions({
    messages,
    activeProjectId,
    activeAppPath,
    canOpenProjectFile: Boolean(onOpenProjectFile),
  });

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

  function handleRetryCurrentTurn() {
    const replayContent = lastUserMessage?.content?.trim();
    resetErrorPresentation();
    if (replayContent && replayContent.length > 0) {
      append(replayContent, {
        metadata: {
          ...messageMetadata,
          retry_of_message_id: lastUserMessage?.id,
          retry_reason: errorCode ?? "chat_error",
        },
        echoUserMessage: false,
      });
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

  function nextUploadBatchId(): string {
    uploadBatchCounterRef.current += 1;
    return `upload-batch-${Date.now()}-${uploadBatchCounterRef.current}`;
  }

  function emitUploadLifecycleEvent(detail: UploadLifecycleEventDetail) {
    if (typeof window === "undefined") {
      return;
    }
    window.dispatchEvent(new CustomEvent(UPLOAD_LIFECYCLE_EVENT, { detail }));
  }

  function updateUploadActivity(
    id: string,
    updater: (activity: UploadActivity) => UploadActivity
  ) {
    setUploadActivities((current) =>
      current.map((activity) => activity.id === id ? updater(activity) : activity)
    );
  }

  function collapseSavedUploadActivities() {
    const unacknowledgedBatchIds = [
      ...new Set(
        uploadActivities
          .filter((activity) => activity.status === "saved" && !acknowledgedUploadBatchesRef.current.has(activity.batchId))
          .map((activity) => activity.batchId)
      ),
    ];

    for (const batchId of unacknowledgedBatchIds) {
      const batchActivities = uploadActivities.filter((activity) => activity.batchId === batchId);
      for (const activity of batchActivities.filter((candidate) => candidate.status === "saved")) {
        emitUploadLifecycleEvent({
          batchId: activity.batchId,
          stage: "assistant_acknowledged",
          fileName: activity.fileName,
          fileType: activity.fileType,
          fileSize: activity.fileSize,
          selectedFileCount: batchActivities.length,
          projectId: activeProjectId ?? "",
          status: "ok",
          savedPath: activity.savedPath,
          ownerLabel: activity.ownerLabel,
          conversionStatus: requiresMarkdownConversion(activity.file) ? "completed" : "not_needed",
        });
      }
      acknowledgedUploadBatchesRef.current.add(batchId);
    }

    setUploadActivities((current) =>
      current.map((activity) =>
        activity.status === "saved"
          ? { ...activity, collapsed: true, detailsOpen: false }
          : activity
      )
    );
  }

  function toggleUploadActivityDetails(activity: UploadActivity) {
    setUploadActivities((current) =>
      current.map((currentActivity) =>
        currentActivity.id === activity.id
          ? { ...currentActivity, detailsOpen: !currentActivity.detailsOpen }
          : currentActivity
      )
    );
  }

  function uploadReceiptForFile(uploadedFile: ProjectFile | void, fileName: string): UploadSuccess {
    const savedPath = uploadedFile?.path ?? fileName;
    return {
      fileName,
      savedPath,
      ownerLabel: uploadedFile?.ownerLabel ?? ownerLabelForMemoryPath(savedPath, fileName),
      statementMonth: uploadedFile?.statementMonth ?? statementMonthLabelForMemoryPath(savedPath),
      destinationLabel: uploadedFile?.destinationLabel ?? destinationLabelForMemoryPath(savedPath),
      sourceType: uploadedFile?.sourceType,
      accountName: uploadedFile?.accountName,
    };
  }

  function buildUploadSummaryMessage(
    message: string,
    successes: UploadSuccess[],
    failures: UploadFailure[]
  ): string {
    const lines: string[] = [];
    const trimmed = ownerVisibleUploadMessage(message);
    if (trimmed.length > 0) {
      lines.push(trimmed, "");
    }

    const totalFiles = successes.length + failures.length;

    if (successes.length === 1) {
      lines.push("Uploaded 1 statement:");
    } else if (successes.length > 1) {
      lines.push(`Uploaded ${successes.length} statements:`);
    }
    for (const success of successes) {
      const secondary = [success.statementMonth, success.destinationLabel].filter(Boolean).join(" · ");
      lines.push(`- ${success.ownerLabel}${secondary ? ` (${secondary})` : ""}`);
    }

    if (failures.length > 0) {
      if (successes.length > 0) {
        lines.push("");
        lines.push(`${successes.length} of ${totalFiles} files uploaded. ${failures.length} need attention before I can build a complete Budget from this batch.`);
      }
      lines.push(failures.length === 1 ? "1 file did not upload:" : `${failures.length} files did not upload:`);
      for (const failure of failures) {
        lines.push(`- ${failure.fileName}: ${failure.error}`);
      }
      lines.push("");
      lines.push("Retry the failed file, upload a CSV/export version, or continue only if you want me to work from incomplete evidence.");
    }

    if (failures.length === 0 && successes.length > 0) {
      lines.push(
        "",
        `I received ${successes.length === 1 ? "this statement" : `all ${successes.length} statements`}.`
      );
    }
    return lines.join("\n");
  }

  function ownerVisibleUploadMessage(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    return trimmed
      .replace(/\bAcknowledge the upload in a short receipt only:[\s\S]*?(?:first-pass Budget\.|$)/gi, "")
      .replace(/\bSave detailed statement analysis[\s\S]*?(?:first-pass Budget\.|$)/gi, "")
      .trim();
  }

  async function uploadProjectFiles(message: string, files: File[]) {
    if (!onUploadDocument || !activeProjectId || activeProjectId === "braindrive-plus-one") {
      return;
    }

    const batchId = nextUploadBatchId();
    const activities = files.map((file) => ({
      id: nextUploadActivityId(),
      batchId,
      file,
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      fileSize: file.size,
      status: requiresMarkdownConversion(file) ? "converting" as const : "uploading" as const,
      message: requiresMarkdownConversion(file)
        ? `Converting ${file.name} to markdown...`
        : `Uploading ${file.name}...`,
    }));
    for (const activity of activities) {
      emitUploadLifecycleEvent({
        batchId,
        stage: "selected",
        fileName: activity.fileName,
        fileType: activity.fileType,
        fileSize: activity.fileSize,
        selectedFileCount: files.length,
        projectId: activeProjectId,
        status: "ok",
      });
      emitUploadLifecycleEvent({
        batchId,
        stage: "accepted_by_client_validation",
        fileName: activity.fileName,
        fileType: activity.fileType,
        fileSize: activity.fileSize,
        selectedFileCount: files.length,
        projectId: activeProjectId,
        status: "ok",
      });
      if (requiresMarkdownConversion(activity.file)) {
        emitUploadLifecycleEvent({
          batchId,
          stage: "conversion_started",
          fileName: activity.fileName,
          fileType: activity.fileType,
          fileSize: activity.fileSize,
          selectedFileCount: files.length,
          projectId: activeProjectId,
          status: "pending",
          conversionStatus: "started",
        });
      }
    }
    setUploadActivities((current) => [...current, ...activities]);

    const successes: UploadSuccess[] = [];
    const failures: UploadFailure[] = [];

    for (const activity of activities) {
      try {
        emitUploadLifecycleEvent({
          batchId,
          stage: "upload_request_started",
          fileName: activity.fileName,
          fileType: activity.fileType,
          fileSize: activity.fileSize,
          selectedFileCount: files.length,
          projectId: activeProjectId,
          status: "pending",
          conversionStatus: requiresMarkdownConversion(activity.file) ? "started" : "not_needed",
        });
        const uploadedFile = await onUploadDocument(activity.file, { openAfterUpload: false });
        const receipt = uploadReceiptForFile(uploadedFile, activity.fileName);
        successes.push(receipt);
        if (requiresMarkdownConversion(activity.file)) {
          emitUploadLifecycleEvent({
            batchId,
            stage: "conversion_completed",
            fileName: activity.fileName,
            fileType: activity.fileType,
            fileSize: activity.fileSize,
            selectedFileCount: files.length,
            projectId: activeProjectId,
            status: "ok",
            savedPath: receipt.savedPath,
            ownerLabel: receipt.ownerLabel,
            conversionStatus: "completed",
          });
        }
        emitUploadLifecycleEvent({
          batchId,
          stage: "saved_to_memory",
          fileName: activity.fileName,
          fileType: activity.fileType,
          fileSize: activity.fileSize,
          selectedFileCount: files.length,
          projectId: activeProjectId,
          status: "ok",
          savedPath: receipt.savedPath,
          ownerLabel: receipt.ownerLabel,
          conversionStatus: requiresMarkdownConversion(activity.file) ? "completed" : "not_needed",
        });
        updateUploadActivity(activity.id, (current) => ({
          ...current,
          status: "saved",
          savedPath: receipt.savedPath,
          ownerLabel: receipt.ownerLabel,
          statementMonth: receipt.statementMonth,
          destinationLabel: receipt.destinationLabel,
          sourceType: receipt.sourceType,
          accountName: receipt.accountName,
          message: `Saved ${receipt.ownerLabel}.`,
        }));
        emitUploadLifecycleEvent({
          batchId,
          stage: "visible_receipt_rendered",
          fileName: activity.fileName,
          fileType: activity.fileType,
          fileSize: activity.fileSize,
          selectedFileCount: files.length,
          projectId: activeProjectId,
          status: "ok",
          savedPath: receipt.savedPath,
          ownerLabel: receipt.ownerLabel,
          conversionStatus: requiresMarkdownConversion(activity.file) ? "completed" : "not_needed",
        });
      } catch (uploadError) {
        const rawErrorMessage = uploadError instanceof Error ? uploadError.message : "Document upload failed.";
        const errorMessage = ownerVisibleUploadError(uploadError);
        failures.push({
          fileName: activity.fileName,
          error: errorMessage,
        });
        emitUploadLifecycleEvent({
          batchId,
          stage: "failed",
          fileName: activity.fileName,
          fileType: activity.fileType,
          fileSize: activity.fileSize,
          selectedFileCount: files.length,
          projectId: activeProjectId,
          status: "error",
          error: rawErrorMessage,
          conversionStatus: requiresMarkdownConversion(activity.file) ? "failed" : "not_needed",
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
      for (const success of successes) {
        const activity = activities.find((candidate) => candidate.fileName === success.fileName);
        if (!activity) {
          continue;
        }
        emitUploadLifecycleEvent({
          batchId,
          stage: "attached_to_message",
          fileName: activity.fileName,
          fileType: activity.fileType,
          fileSize: activity.fileSize,
          selectedFileCount: files.length,
          projectId: activeProjectId,
          status: "ok",
          savedPath: success.savedPath,
          ownerLabel: success.ownerLabel,
          conversionStatus: requiresMarkdownConversion(activity.file) ? "completed" : "not_needed",
        });
      }
      append(buildUploadSummaryMessage(message, successes, failures), { metadata: messageMetadata });
      setFileError(null);
    } else if (failures.length > 0) {
      setFileError(buildUploadSummaryMessage(message, successes, failures));
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
      const uploadedFile = await onUploadDocument?.(activity.file, { openAfterUpload: false });
      const receipt = uploadReceiptForFile(uploadedFile, activity.fileName);
      updateUploadActivity(activity.id, (current) => ({
        ...current,
        status: "saved",
        savedPath: receipt.savedPath,
        ownerLabel: receipt.ownerLabel,
        statementMonth: receipt.statementMonth,
        destinationLabel: receipt.destinationLabel,
        sourceType: receipt.sourceType,
        accountName: receipt.accountName,
        collapsed: false,
        detailsOpen: false,
        message: `Saved ${receipt.ownerLabel}.`,
      }));
      onSendMessage?.();
      append(buildUploadSummaryMessage("", [receipt], []), {
        metadata: messageMetadata
      });
    } catch (uploadError) {
      const errorMessage = ownerVisibleUploadError(uploadError);
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
        collapseSavedUploadActivities();
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
          onRetry={lastUserMessage && !isContextOverflowError ? handleRetryCurrentTurn : () => setConnectionStatus("connected")}
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
                activities={visibleChatError
                  ? uploadActivities.filter((activity) => activity.status !== "saved")
                  : uploadActivities}
                onRetry={retryUpload}
                onToggleDetails={toggleUploadActivityDetails}
              />
              {showBudgetFileActions && (
                <BudgetFileActions onOpenProjectFile={onOpenProjectFile} />
              )}
              {showFinancePlanActions && (
                <FinancePlanActions onOpenProjectFile={onOpenProjectFile} />
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
              {displayedChatError && (
                <ErrorMessage
                  message={displayedChatError}
                  onRetry={isContextOverflowError ? undefined : handleRetryCurrentTurn}
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
