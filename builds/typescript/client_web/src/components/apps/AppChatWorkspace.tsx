import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import { AlertCircle, ArrowLeft, ChevronLeft, Download, FileText, LoaderCircle, PencilLine, RefreshCw, Save, Send, ShieldCheck, Sparkles, X } from "lucide-react";

import { getSession } from "@/api/auth-adapter";
import { deleteConversation, listConversations } from "@/api/gateway-adapter";
import { reportOwnerFailure } from "@/api/owner-failure";
import {
  appendConversationHostMessage,
  closeAppSession,
  executeAppChatWorkspaceAction,
  finalizeAppExport,
  readAppChatWorkspaceDocument,
  readAppChatWorkspaceResource,
  readAppChatWorkspaceSession,
  writeAppChatWorkspaceDocument,
  AppDocumentError,
  type AppChatWorkspaceLaunch,
  type AppDocumentReadResult,
  type AppDocumentRecord,
  type AppResourceReadResult,
  type AppResourceDescriptor,
  type AppWorkspaceDocumentHeaderAction,
  type AppWorkspaceDocumentDescriptor,
} from "@/api/apps-adapter";
import { isTauriRuntime } from "@/api/runtime-api-base";
import type { ChatEvent } from "@/api/types";
import ChatPanel from "@/components/chat/ChatPanel";
import { MobileSidebarDrawer, MobileSidebarHeader } from "@/components/layout/MobileSidebarShell";
import ProfileMenu from "@/components/layout/ProfileMenu";
import { DocumentButton, DocumentHeader, documentStyles } from "@/components/document/DocumentSurface";
import MarkdownContent, { markdownStyles } from "@/components/markdown/MarkdownContent";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parsePaperInlineMarkdown } from "@/lib/paper-inline-markdown";
import { BrowserActionBroker } from "@/mcp-apps/browser-policy";
import type { UserProfile } from "@/types/ui";
import { appExportPayloadSizeBytes, parseHostAppExportPayload, saveHostAppExport, type HostAppExportPayload } from "./app-export-download";

type WorkspaceItem =
  | { key: string; kind: "document"; document: AppWorkspaceDocumentDescriptor }
  | { key: string; kind: "resource"; resource: AppResourceDescriptor };

type AppChatPreparedExport = {
  artifactRevisionId: string;
  artifactDigest: string;
  safeDestinationLabel: string;
  payload: HostAppExportPayload;
};
type AppChatExportHandlingResult = "ignored" | "completed" | "cancelled" | "failed";
type MissingResumeEssentials = {
  missing_essentials: Array<{ label: string }>;
};

type AppChatWorkspaceProps = {
  appKey: string;
  appName: string;
  launch: AppChatWorkspaceLaunch;
  onSessionClosed: () => void;
  onGoHome?: () => void;
  onRenewSession?: (launch: AppChatWorkspaceLaunch) => Promise<AppChatWorkspaceLaunch | null>;
  onOpenSettings?: () => void;
  onLogout?: () => void;
  tier?: "local" | "concierge";
};

const APP_CHAT_SESSION_HEARTBEAT_MS = 2 * 60_000;
const APP_CHAT_CONVERSATION_STORAGE_PREFIX = "braindrive:app-chat-conversation:";

function createClientOperationId(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DEFAULT_USER: UserProfile = {
  name: "Local Owner",
  initials: "LO",
  email: "owner@local.braindrive",
};

const FALLBACK_CONVERSATION: AppWorkspaceDocumentDescriptor = {
  document_version: 1,
  document_id: "conversation",
  role: "conversation",
  title: "Conversation",
  description: "Native BrainDrive conversation for this app workspace.",
  editable: true,
  default_visibility: "primary",
  model_access: "read_write_draft",
  resource_id: null,
  data_binding_id: null,
};

function itemKey(item: WorkspaceItem): string {
  return item.key;
}

function roleLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function descriptorDigestLabel(digest: string): string {
  return digest.length > 24 ? `${digest.slice(0, 18)}...${digest.slice(-8)}` : digest;
}

function buildItems(launch: AppChatWorkspaceLaunch): WorkspaceItem[] {
  const documents = launch.workspace.documents.length > 0 ? launch.workspace.documents : [FALLBACK_CONVERSATION];
  const documentResourceIds = new Set(documents.map((document) => document.resource_id).filter(Boolean));
  const items: WorkspaceItem[] = documents.map((document) => ({ key: `document:${document.document_id}`, kind: "document", document }));
  for (const resource of launch.workspace.resources) {
    if (!documentResourceIds.has(resource.resource_id)) {
      items.push({ key: `resource:${resource.resource_id}`, kind: "resource", resource });
    }
  }
  return items;
}

function defaultItemKey(launch: AppChatWorkspaceLaunch, items: WorkspaceItem[]): string {
  const defaultDocument = items.find((item) => item.kind === "document" && item.document.document_id === launch.workspace.default_document_id);
  const conversation = items.find((item) => item.kind === "document" && item.document.role === "conversation");
  return itemKey(defaultDocument ?? conversation ?? items[0] ?? { key: "document:conversation", kind: "document", document: FALLBACK_CONVERSATION });
}

function workspaceEmptyStateIntro(launch: AppChatWorkspaceLaunch) {
  const emptyState = launch.workspace.empty_state;
  if (!emptyState) return undefined;
  return {
    heading: emptyState.heading,
    description: emptyState.description,
    cta: emptyState.cta_label ?? undefined,
    ctaMessage: emptyState.cta_message ?? undefined,
  };
}

function appChatConversationStorageKey(appKey: string, launch: AppChatWorkspaceLaunch): string {
  return `${APP_CHAT_CONVERSATION_STORAGE_PREFIX}${[
    appKey,
    launch.session.app_id,
    launch.session.owner_id,
    launch.session.installation_id,
    launch.session.presentation_id,
    launch.session.workspace_id,
  ].map(encodeURIComponent).join(":")}`;
}

function readStoredAppChatConversationId(storageKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(storageKey) ?? window.sessionStorage.getItem(storageKey);
    return value && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeStoredAppChatConversationId(storageKey: string, conversationId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, conversationId);
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Only the opaque pointer is cached here; the gateway conversation remains durable.
  }
}

export function extractPreparedAppChatExport(output: unknown): AppChatPreparedExport | null {
  if (!isRecord(output) || !isRecord(output.result)) return null;
  const result = output.result;
  if (result.result_version !== 1 || result.status !== "prepared") return null;
  if (!isRecord(result.artifact)) return null;
  const artifactRevisionId = result.artifact.artifact_revision_id;
  const artifactDigest = result.artifact.content_digest;
  const safeDestinationLabel = result.safe_destination_label;
  if (typeof artifactRevisionId !== "string" || typeof artifactDigest !== "string" || typeof safeDestinationLabel !== "string") return null;
  try {
    return {
      artifactRevisionId,
      artifactDigest,
      safeDestinationLabel,
      payload: parseHostAppExportPayload({
        ...result,
        mime_type: typeof result.mime_type === "string" ? result.mime_type : result.media_type,
      }),
    };
  } catch {
    return null;
  }
}

export function buildAppChatMessageMetadata(launch: AppChatWorkspaceLaunch): Record<string, unknown> {
  return {
    client: "web",
    app_chat: {
      metadata_version: 1,
      app_id: launch.session.app_id,
      installation_id: launch.session.installation_id,
      package_digest: launch.session.package_digest,
      session_id: launch.session.session_id,
      view_id: launch.session.view_id,
      operation_id: launch.session.operation_id,
      session_generation: launch.session.session_generation,
      presentation_id: launch.session.presentation_id,
      workspace_id: launch.session.workspace_id,
      context_grant_set_digest: launch.session.context_grant_set_digest,
    },
  };
}

export default function AppChatWorkspace({
  appKey,
  appName,
  launch,
  onSessionClosed,
  onGoHome,
  onRenewSession,
  onOpenSettings,
  onLogout,
  tier = "local",
}: AppChatWorkspaceProps) {
  const items = useMemo(() => buildItems(launch), [launch]);
  const itemKeysSignature = useMemo(() => items.map(itemKey).join("|"), [items]);
  const workspaceIdentity = `${launch.session.app_id}:${launch.session.package_digest}:${launch.session.lifecycle_generation}:${launch.presentation.presentation_id}:${launch.workspace.workspace_id}:${itemKeysSignature}`;
  const conversationStorageKey = appChatConversationStorageKey(appKey, launch);
  const [activeItemKey, setActiveItemKey] = useState(() => defaultItemKey(launch, items));
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => readStoredAppChatConversationId(conversationStorageKey));
  const [sessionState, setSessionState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [queuedChatMessage, setQueuedChatMessage] = useState<{ id: string; content: string } | null>(null);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);
  const [exportNotice, setExportNotice] = useState<{ tone: "info" | "success" | "error"; message: string } | null>(null);
  const activeHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const navButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const closedSessionIdsRef = useRef(new Set<string>());
  const cleanupTimerRef = useRef<{ sessionId: string; timer: number } | null>(null);
  const intentionalDepartureRef = useRef(false);
  const exportStatusByIdRef = useRef(new Map<string, AppChatExportHandlingResult>());
  const inFlightExportIdsRef = useRef(new Set<string>());
  const launchRef = useRef(launch);
  const activeConversationIdRef = useRef(activeConversationId);
  const pendingHostMessagesRef = useRef<string[]>([]);
  const hostMessageQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    launchRef.current = launch;
  }, [launch]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    intentionalDepartureRef.current = false;
    return () => {
      intentionalDepartureRef.current = true;
    };
  }, []);

  const activeItem = items.find((item) => item.key === activeItemKey) ?? items[0] ?? {
    key: "document:conversation",
    kind: "document" as const,
    document: FALLBACK_CONVERSATION,
  };
  const activeDocument = activeItem.kind === "document" ? activeItem.document : null;
  const activeResource = activeItem.kind === "resource"
    ? activeItem.resource
    : activeDocument?.resource_id
      ? launch.workspace.resources.find((resource) => resource.resource_id === activeDocument.resource_id) ?? null
      : null;
  const isConversation = activeDocument?.role === "conversation";
  const activeItemTitle = activeItem.kind === "document" ? activeItem.document.title : activeItem.resource.title;
  const messageMetadata = useMemo(() => buildAppChatMessageMetadata(launch), [launch]);
  const emptyStateIntro = useMemo(() => workspaceEmptyStateIntro(launch), [launch]);

  const closeSessionById = useCallback((sessionId: string) => {
    if (closedSessionIdsRef.current.has(sessionId)) return;
    closedSessionIdsRef.current.add(sessionId);
    void Promise.resolve(closeAppSession(appKey, sessionId)).catch(() => undefined);
  }, [appKey]);

  useEffect(() => {
    const pendingCleanup = cleanupTimerRef.current;
    if (pendingCleanup?.sessionId === launch.session.session_id) {
      window.clearTimeout(pendingCleanup.timer);
      cleanupTimerRef.current = null;
    }

    return () => {
      const sessionId = launch.session.session_id;
      cleanupTimerRef.current = {
        sessionId,
        timer: window.setTimeout(() => closeSessionById(sessionId), 0),
      };
    };
  }, [closeSessionById, launch.session.session_id]);

  useEffect(() => {
    let cancelled = false;
    const storedConversationId = readStoredAppChatConversationId(conversationStorageKey);

    void listConversations()
      .then((conversations) => {
        if (cancelled) return;

        // The server list is the durable source of truth across profiles/tabs.
        // Keep a stored pointer only when it still names a known conversation;
        // otherwise return to the server's most recently active conversation.
        const storedConversation = storedConversationId
          ? conversations.find((conversation) => conversation.id === storedConversationId)
          : undefined;
        const latestConversation = conversations.reduce<typeof conversations[number] | undefined>(
          (latest, conversation) => !latest || conversation.updated_at > latest.updated_at ? conversation : latest,
          undefined,
        );
        const selectedConversationId = storedConversation?.id ?? latestConversation?.id ?? storedConversationId;
        if (!selectedConversationId) return;
        setActiveConversationId(selectedConversationId);
        writeStoredAppChatConversationId(conversationStorageKey, selectedConversationId);
      })
      .catch(() => {
        // Preserve a previously durable pointer during a transient list failure.
        if (!cancelled && storedConversationId) setActiveConversationId(storedConversationId);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationStorageKey]);

  useEffect(() => {
    setActiveItemKey((current) => items.some((item) => item.key === current) ? current : defaultItemKey(launch, items));
  }, [items, launch, workspaceIdentity]);

  const recoverSession = useCallback(async (): Promise<string | null> => {
    if (intentionalDepartureRef.current) return null;
    if (!onRenewSession) return null;
    try {
      const renewed = await onRenewSession(launchRef.current);
      if (intentionalDepartureRef.current) return null;
      if (!renewed) return null;
      launchRef.current = renewed;
      setSessionState("ready");
      setSessionError(null);
      return renewed.session.session_id;
    } catch {
      return null;
    }
  }, [onRenewSession]);

  useEffect(() => {
    let cancelled = false;
    setSessionState("loading");
    setSessionError(null);
    void readAppChatWorkspaceSession(appKey, launch.session.session_id)
      .then(() => {
        if (!cancelled) setSessionState("ready");
      })
      .catch(async () => {
        const recoveredSessionId = await recoverSession();
        if (!cancelled) {
          if (recoveredSessionId) {
            setSessionState("ready");
            setSessionError(null);
          } else {
            setSessionState("unavailable");
            setSessionError("This app workspace session is no longer available.");
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [appKey, launch.session.session_id, recoverSession]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(() => {
      const currentSessionId = launchRef.current.session.session_id;
      void readAppChatWorkspaceSession(appKey, currentSessionId)
        .then(() => {
          if (!cancelled) {
            setSessionState("ready");
            setSessionError(null);
          }
        })
        .catch(async () => {
          const recoveredSessionId = await recoverSession();
          if (!cancelled && !recoveredSessionId) {
            setSessionState("unavailable");
            setSessionError("This app workspace session is no longer available.");
          }
        });
    }, APP_CHAT_SESSION_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [appKey, recoverSession]);

  useEffect(() => {
    activeHeadingRef.current?.focus({ preventScroll: true });
  }, [activeItemKey]);

  function closeWorkspace(afterClose?: () => void) {
    intentionalDepartureRef.current = true;
    setIsMobileNavOpen(false);
    if (cleanupTimerRef.current) {
      window.clearTimeout(cleanupTimerRef.current.timer);
      cleanupTimerRef.current = null;
    }
    closeSessionById(launch.session.session_id);
    onSessionClosed();
    afterClose?.();
  }

  function queueWorkspaceChatPrompt(prompt: string) {
    setExportNotice(null);
    setActiveItemKey(itemKey(items.find((item) => item.kind === "document" && item.document.role === "conversation") ?? items[0] ?? { key: "document:conversation", kind: "document", document: FALLBACK_CONVERSATION }));
    setQueuedChatMessage({
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      content: prompt,
    });
  }

  const appendDurableHostMessage = useCallback((content: string) => {
    hostMessageQueueRef.current = hostMessageQueueRef.current.then(async () => {
      const response = await appendConversationHostMessage(activeConversationIdRef.current, content);
      if (!activeConversationIdRef.current) {
        activeConversationIdRef.current = response.conversation_id;
        setActiveConversationId(response.conversation_id);
        writeStoredAppChatConversationId(conversationStorageKey, response.conversation_id);
      }
    }).catch(() => undefined);
    void hostMessageQueueRef.current;
  }, [conversationStorageKey]);

  const handlePreparedAppChatExport = useCallback(async (output: unknown): Promise<AppChatExportHandlingResult> => {
    const prepared = extractPreparedAppChatExport(output);
    if (!prepared) return "ignored";
    const exportKey = `${prepared.artifactRevisionId}:${prepared.artifactDigest}`;
    const priorStatus = exportStatusByIdRef.current.get(exportKey);
    if (priorStatus) return priorStatus;
    if (inFlightExportIdsRef.current.has(exportKey)) return "ignored";
    inFlightExportIdsRef.current.add(exportKey);
    setExportNotice({ tone: "info", message: `Downloading ${prepared.payload.filename}...` });
    try {
      const browserBroker = new BrowserActionBroker({
        allowedLinkOrigins: [],
        clipboardWrite: false,
        exportMimeTypes: ["application/pdf", "text/plain"],
        maxClipboardBytes: 0,
        maxExportBytes: 2_097_152,
      });
      const exportDecision = browserBroker.validateExport({
        safeFilename: prepared.payload.filename,
        mimeType: prepared.payload.mime_type,
        sizeBytes: appExportPayloadSizeBytes(prepared.payload.bytes_base64),
      }, true, true);
      if (!exportDecision.allowed) throw new Error(exportDecision.code);
      const projection = await saveHostAppExport(prepared.payload);
      let safeDestinationLabel = projection.safe_destination_label;
      try {
        const receipt = await finalizeAppExport(appKey, {
          artifact_revision_id: prepared.artifactRevisionId,
          artifact_digest: prepared.artifactDigest,
          safe_destination_label: projection.safe_destination_label,
          outcome: "completed",
        });
        safeDestinationLabel = receipt.safe_destination_label || safeDestinationLabel;
      } catch {
        // The file is already saved; receipt recording must not be reported as a failed download.
      }
      setExportNotice({ tone: "success", message: `Downloaded ${safeDestinationLabel}.` });
      exportStatusByIdRef.current.set(exportKey, "completed");
      return "completed";
    } catch (downloadError) {
      const cancelled = downloadError instanceof Error && downloadError.message === "cancelled";
      await finalizeAppExport(appKey, {
        artifact_revision_id: prepared.artifactRevisionId,
        artifact_digest: prepared.artifactDigest,
        safe_destination_label: prepared.safeDestinationLabel,
        outcome: cancelled ? "cancelled" : "failed",
      }).catch(() => undefined);
      const result = cancelled ? "cancelled" : "failed";
      setExportNotice({
        tone: cancelled ? "info" : "error",
        message: cancelled ? "Export was cancelled." : "BrainDrive could not download the export.",
      });
      exportStatusByIdRef.current.set(exportKey, result);
      return result;
    } finally {
      inFlightExportIdsRef.current.delete(exportKey);
    }
  }, [appKey]);

  const handleAppChatStreamEvent = useCallback(async (event: ChatEvent) => {
    if (event.type !== "tool-result" || event.status !== "ok") return;
    await handlePreparedAppChatExport(event.output);
  }, [handlePreparedAppChatExport]);

  const handleConversationComplete = useCallback((conversationId: string) => {
    activeConversationIdRef.current = conversationId;
    setActiveConversationId(conversationId);
    writeStoredAppChatConversationId(conversationStorageKey, conversationId);
    const pending = pendingHostMessagesRef.current.splice(0);
    for (const content of pending) {
      void appendConversationHostMessage(conversationId, content).catch(() => undefined);
    }
  }, [conversationStorageKey]);

  function selectWorkspaceItem(key: string) {
    setActiveItemKey(key);
    setIsMobileNavOpen(false);
  }

  async function handleDeleteConversation() {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId || isDeletingConversation) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this conversation?")) return;
    setIsDeletingConversation(true);
    try {
      await deleteConversation(conversationId);
      activeConversationIdRef.current = null;
      setActiveConversationId(null);
      window.localStorage.removeItem(conversationStorageKey);
      window.sessionStorage.removeItem(conversationStorageKey);
      setActiveItemKey(defaultItemKey(launch, items));
    } finally {
      setIsDeletingConversation(false);
    }
  }

  function moveNavigationFocus(event: KeyboardEvent<HTMLButtonElement>, currentKey: string) {
    const visibleItems = advancedOpen ? items : items.filter((item) => item.kind !== "resource" && item.document.default_visibility !== "advanced");
    const keys = visibleItems.map(itemKey);
    const currentIndex = keys.indexOf(currentKey);
    if (currentIndex < 0) return;
    const keyActions: Record<string, number | "first" | "last"> = {
      ArrowDown: Math.min(currentIndex + 1, keys.length - 1),
      ArrowRight: Math.min(currentIndex + 1, keys.length - 1),
      ArrowUp: Math.max(currentIndex - 1, 0),
      ArrowLeft: Math.max(currentIndex - 1, 0),
      Home: "first",
      End: "last",
    };
    const next = keyActions[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const nextKey = next === "first" ? keys[0] : next === "last" ? keys[keys.length - 1] : keys[next];
    if (nextKey) navButtonRefs.current.get(nextKey)?.focus();
  }

  const primaryItems = items.filter((item) => item.kind === "document" && item.document.default_visibility !== "advanced");
  const advancedItems = items.filter((item) => item.kind === "resource" || (item.kind === "document" && item.document.default_visibility === "advanced"));
  const chatPanel = (
    <ChatPanel
      activeConversationId={activeConversationId}
      draftKey={conversationStorageKey}
      isEmpty={activeConversationId === null}
      onConversationComplete={handleConversationComplete}
      messageMetadata={messageMetadata}
      emptyStateIntro={emptyStateIntro}
      contentOverride={isConversation ? undefined : (
        <WorkspaceDetail
          appKey={appKey}
          appName={appName}
          sessionId={launch.session.session_id}
          workspaceTitle={launch.workspace.title}
          item={activeItem}
          resource={activeResource}
          documents={launch.workspace.documents}
          actions={launch.workspace.actions}
          headingRef={activeHeadingRef}
          onRecoverSession={recoverSession}
          onBackToChat={() => setActiveItemKey(itemKey(items.find((candidate) => candidate.kind === "document" && candidate.document.role === "conversation") ?? items[0] ?? { key: "document:conversation", kind: "document", document: FALLBACK_CONVERSATION }))}
          onOpenWorkspaceItem={(documentId) => {
            const target = items.find((candidate) => candidate.kind === "document" && candidate.document.document_id === documentId);
            if (target) setActiveItemKey(itemKey(target));
          }}
          onQueueChatPrompt={queueWorkspaceChatPrompt}
          onClearExportNotice={() => setExportNotice(null)}
          onDirectActionResult={handlePreparedAppChatExport}
          onDirectActionComplete={appendDurableHostMessage}
        />
      )}
      queuedMessage={queuedChatMessage}
      onOpenSettings={onOpenSettings}
      onStreamEvent={handleAppChatStreamEvent}
      statusNotice={isConversation ? exportNotice : null}
    />
  );

  const NavigationRegion = isConversation ? "div" : "aside";

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-bd-bg-chat text-bd-text-primary md:flex-row" aria-label={`${appName} native app workspace`} data-testid="app-chat-workspace">
      <div className="md:hidden">
        <MobileSidebarHeader
          openLabel="Open workspace navigation menu"
          onOpen={() => setIsMobileNavOpen(true)}
          eyebrow={isConversation ? appName : undefined}
          title={isConversation ? activeItemTitle : undefined}
        />
      </div>

      <NavigationRegion className="hidden md:flex md:shrink-0">
        <WorkspaceNavigation
          appName={appName}
          sessionError={sessionError}
          primaryItems={primaryItems}
          advancedItems={advancedItems}
          activeItemKey={activeItemKey}
          advancedOpen={advancedOpen}
          navButtonRefs={navButtonRefs}
          onSelect={selectWorkspaceItem}
          onToggleAdvanced={() => setAdvancedOpen((current) => !current)}
          onMoveFocus={moveNavigationFocus}
          onCloseWorkspace={() => closeWorkspace()}
          onGoHome={() => closeWorkspace(onGoHome)}
          activeConversationId={activeConversationId}
          isDeletingConversation={isDeletingConversation}
          onDeleteConversation={() => void handleDeleteConversation()}
          onOpenSettings={onOpenSettings}
          onLogout={onLogout}
          tier={tier}
        />
      </NavigationRegion>

      <MobileSidebarDrawer
        isOpen={isMobileNavOpen}
        ariaLabel={`${appName} workspace navigation`}
        closeBackdropLabel="Close workspace navigation backdrop"
        onClose={() => setIsMobileNavOpen(false)}
      >
        <WorkspaceNavigation
          appName={appName}
          sessionError={sessionError}
          primaryItems={primaryItems}
          advancedItems={advancedItems}
          activeItemKey={activeItemKey}
          advancedOpen={advancedOpen}
          navButtonRefs={navButtonRefs}
          onSelect={selectWorkspaceItem}
          onToggleAdvanced={() => setAdvancedOpen((current) => !current)}
          onMoveFocus={moveNavigationFocus}
          onCloseWorkspace={() => closeWorkspace()}
          onGoHome={() => closeWorkspace(onGoHome)}
          activeConversationId={activeConversationId}
          isDeletingConversation={isDeletingConversation}
          onDeleteConversation={() => void handleDeleteConversation()}
          onCloseNavigation={() => setIsMobileNavOpen(false)}
          onOpenSettings={onOpenSettings}
          onLogout={onLogout}
          tier={tier}
        />
      </MobileSidebarDrawer>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="app-chat-workspace-pane">
        {!isConversation && exportNotice ? (
          <div
            role={exportNotice.tone === "error" ? "alert" : "status"}
            className={cn(
              "mx-4 mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-sm md:mx-6",
              exportNotice.tone === "error"
                ? "border-bd-danger-border bg-bd-danger-bg text-bd-danger"
                : "border-bd-border bg-bd-bg-secondary text-bd-text-primary",
            )}
          >
            {exportNotice.tone === "error" ? <AlertCircle size={15} className="mt-0.5 shrink-0" /> : <ShieldCheck size={15} className="mt-0.5 shrink-0 text-bd-amber" />}
            <span>{exportNotice.message}</span>
          </div>
        ) : null}
        {sessionState === "loading" ? (
          <div className="flex h-full min-h-[320px] items-center justify-center gap-3 text-bd-text-secondary" role="status" aria-live="polite">
            <LoaderCircle size={18} className="animate-spin" />
            <span>Loading app workspace...</span>
          </div>
        ) : sessionState === "unavailable" ? (
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
            <AlertCircle size={22} className="text-bd-danger" aria-hidden="true" />
            <h2 className="mt-3 font-heading text-lg text-bd-text-heading">Workspace unavailable</h2>
            <p className="mt-2 max-w-sm text-sm text-bd-text-secondary">Return to Apps and launch a current app workspace.</p>
          </div>
        ) : chatPanel}
      </main>
    </section>
  );
}

function WorkspaceNavigation({
  appName,
  sessionError,
  primaryItems,
  advancedItems,
  activeItemKey,
  advancedOpen,
  navButtonRefs,
  onSelect,
  onToggleAdvanced,
  onMoveFocus,
  onCloseWorkspace,
  onGoHome,
  activeConversationId,
  isDeletingConversation,
  onDeleteConversation,
  onCloseNavigation,
  onOpenSettings,
  onLogout,
  tier,
}: {
  appName: string;
  sessionError: string | null;
  primaryItems: WorkspaceItem[];
  advancedItems: WorkspaceItem[];
  activeItemKey: string;
  advancedOpen: boolean;
  navButtonRefs: MutableRefObject<Map<string, HTMLButtonElement>>;
  onSelect: (key: string) => void;
  onToggleAdvanced: () => void;
  onMoveFocus: (event: KeyboardEvent<HTMLButtonElement>, currentKey: string) => void;
  onCloseWorkspace: () => void;
  onGoHome: () => void;
  activeConversationId: string | null;
  isDeletingConversation: boolean;
  onDeleteConversation: () => void;
  onCloseNavigation?: () => void;
  onOpenSettings?: () => void;
  onLogout?: () => void;
  tier: "local" | "concierge";
}) {
  return (
    <nav className="flex h-dvh w-[300px] flex-col border-r border-bd-border bg-bd-bg-secondary md:h-full md:w-sidebar" aria-label={`${appName} workspace navigation`}>
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <button
          type="button"
          aria-label="Go to BrainDrive home"
          onClick={onGoHome}
          className="cursor-pointer bg-transparent p-0 hover:opacity-80"
        >
          <img src="/braindrive-logo.svg" alt="BrainDrive" className="h-7 w-auto" />
        </button>
        {onCloseNavigation ? (
          <button
            type="button"
            aria-label="Close workspace navigation"
            onClick={onCloseNavigation}
            className="flex h-8 w-8 items-center justify-center rounded-md text-bd-text-secondary transition-all duration-200 hover:bg-bd-bg-hover md:hidden"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCloseWorkspace} className="mb-7 w-fit gap-2 px-1 text-bd-text-secondary hover:bg-transparent hover:text-bd-text-heading">
          <ChevronLeft size={16} />
          Back to Apps
        </Button>

        <p className="px-1 text-[11px] font-medium uppercase tracking-normal text-bd-text-muted">{appName}</p>
        {sessionError ? (
          <div role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-bd-danger-border bg-bd-danger-bg px-3 py-2 text-sm text-bd-danger">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{sessionError}</span>
          </div>
        ) : null}

        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          <WorkspaceNavGroup
            label={null}
            items={primaryItems}
            activeKey={activeItemKey}
            navButtonRefs={navButtonRefs}
            onSelect={onSelect}
            onMoveFocus={onMoveFocus}
          />
          {activeItemKey === "document:conversation" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDeleteConversation}
              disabled={isDeletingConversation || !activeConversationId}
              aria-label="Delete conversation"
              className="mt-1 w-full justify-start gap-2 px-3 text-bd-danger hover:bg-bd-danger-bg"
            >
              {isDeletingConversation ? <LoaderCircle size={15} className="animate-spin" /> : <X size={15} />}
              Delete conversation
            </Button>
          ) : null}
          {advancedItems.length > 0 ? (
            <div className="pt-4">
              <button
                type="button"
                aria-expanded={advancedOpen}
                onClick={onToggleAdvanced}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs text-bd-text-muted transition-colors duration-200 hover:bg-bd-bg-hover hover:text-bd-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber"
              >
                <span>{advancedOpen ? "Hide advanced" : "Show advanced"}</span>
              </button>
              {advancedOpen ? (
                <WorkspaceNavGroup
                  label={null}
                  items={advancedItems}
                  activeKey={activeItemKey}
                  navButtonRefs={navButtonRefs}
                  onSelect={onSelect}
                  onMoveFocus={onMoveFocus}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-auto space-y-2 pt-4">
          <AppWorkspaceProfileControl
            onOpenSettings={onOpenSettings}
            onLogout={onLogout}
            tier={tier}
          />
        </div>
      </div>
    </nav>
  );
}

function WorkspaceNavGroup({
  label,
  items,
  activeKey,
  navButtonRefs,
  onSelect,
  onMoveFocus,
}: {
  label: string | null;
  items: WorkspaceItem[];
  activeKey: string;
  navButtonRefs: MutableRefObject<Map<string, HTMLButtonElement>>;
  onSelect: (key: string) => void;
  onMoveFocus: (event: KeyboardEvent<HTMLButtonElement>, currentKey: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-1" aria-label={label ?? "Workspace"}>
      {label ? (
        <div className="hidden items-center justify-between px-2 pb-1 pt-5 text-xs text-bd-text-muted md:flex">
          <span>{label}</span>
        </div>
      ) : null}
      {items.map((item) => {
        const title = item.kind === "document" ? item.document.title : item.resource.title;
        const Icon = item.kind === "document" && item.document.role === "conversation" ? Sparkles : item.kind === "resource" ? ShieldCheck : FileText;
        return (
          <button
            key={item.key}
            ref={(node) => { if (node) navButtonRefs.current.set(item.key, node); else navButtonRefs.current.delete(item.key); }}
            type="button"
            aria-current={activeKey === item.key ? "page" : undefined}
            onClick={() => onSelect(item.key)}
            onKeyDown={(event) => onMoveFocus(event, item.key)}
            className={cn(
              "flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] transition-all duration-200 hover:bg-bd-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber",
              activeKey === item.key ? "border-l-2 border-bd-amber bg-bd-bg-tertiary pl-[10px] text-bd-text-primary" : "text-bd-text-secondary",
            )}
          >
            <Icon size={17} strokeWidth={1.7} aria-hidden="true" className="shrink-0 text-bd-text-secondary" />
            <span className="truncate">{title}</span>
          </button>
        );
      })}
    </section>
  );
}

function AppWorkspaceProfileControl({
  onOpenSettings,
  onLogout,
  tier,
}: {
  onOpenSettings?: () => void;
  onLogout?: () => void;
  tier: "local" | "concierge";
}) {
  const [user, setUser] = useState<UserProfile>(DEFAULT_USER);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getSession()
      .then((session) => {
        if (cancelled) return;
        setUser({
          name: session.user.name,
          initials: session.user.initials,
          email: session.user.email,
        });
      })
      .catch(() => {
        if (!cancelled) setUser(DEFAULT_USER);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (
        isProfileMenuOpen &&
        profileMenuRef.current &&
        !profileMenuRef.current.contains(target)
      ) {
        setIsProfileMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isProfileMenuOpen]);

  return (
    <div ref={profileMenuRef} className="relative">
      {isProfileMenuOpen ? (
        <ProfileMenu
          onClose={() => setIsProfileMenuOpen(false)}
          onOpenSettings={() => {
            setIsProfileMenuOpen(false);
            onOpenSettings?.();
          }}
          onLogout={onLogout ?? (() => undefined)}
        />
      ) : null}
      <button
        type="button"
        aria-label="Open profile menu"
        onClick={() => setIsProfileMenuOpen((current) => !current)}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all duration-200 hover:bg-bd-bg-hover"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bd-amber text-xs font-bold text-bd-bg-primary">
          {user.initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-bd-text-primary">
            {user.name}
          </div>
          <div className="truncate text-[11px] text-bd-text-muted">
            {tier === "concierge" ? "BrainDrive Concierge" : "BrainDrive Local"}
          </div>
        </div>
        <div className="shrink-0 text-base leading-none text-bd-text-muted">
          ...
        </div>
      </button>
    </div>
  );
}

export function WorkspaceDetail({
  appKey,
  appName,
  sessionId,
  workspaceTitle,
  item,
  resource,
  actions,
  documents,
  headingRef,
  onRecoverSession,
  onBackToChat,
  onOpenWorkspaceItem,
  onQueueChatPrompt,
  onClearExportNotice,
  onDirectActionResult,
  onDirectActionComplete,
}: {
  appKey: string;
  appName: string;
  sessionId: string;
  workspaceTitle: string;
  item: WorkspaceItem;
  resource: AppResourceDescriptor | null;
  actions: AppChatWorkspaceLaunch["workspace"]["actions"];
  documents: AppChatWorkspaceLaunch["workspace"]["documents"];
  headingRef: MutableRefObject<HTMLHeadingElement | null>;
  onRecoverSession: () => Promise<string | null>;
  onBackToChat: () => void;
  onOpenWorkspaceItem: (documentId: string) => void;
  onQueueChatPrompt: (prompt: string) => void;
  onClearExportNotice: () => void;
  onDirectActionResult: (result: unknown) => Promise<AppChatExportHandlingResult>;
  onDirectActionComplete: (message: string) => void;
}) {
  const title = item.kind === "document" ? item.document.title : item.resource.title;
  const description = item.kind === "document" ? item.document.description : item.resource.description;
  const editable = item.kind === "document" ? item.document.editable : item.resource.owner_editable;
  const bindingId = item.kind === "document" ? item.document.data_binding_id : null;
  const presentation = item.kind === "document" ? item.document.presentation ?? null : null;
  const isDocumentChrome = presentation?.chrome === "document";
  const exposedActions = actions.filter((action) => action.model_exposure === "available");
  const [documentResult, setDocumentResult] = useState<AppDocumentReadResult | null>(null);
  const [resourceResult, setResourceResult] = useState<AppResourceReadResult | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [documentStatus, setDocumentStatus] = useState<"idle" | "loading" | "ready" | "saving" | "error">("idle");
  const [resourceStatus, setResourceStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [documentNotice, setDocumentNotice] = useState<string | null>(null);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [missingResumeEssentials, setMissingResumeEssentials] = useState<MissingResumeEssentials | null>(null);
  const [sourceIsStale, setSourceIsStale] = useState(false);
  const sourceDocument = documents.find((document) => document.document_id === presentation?.read_only_explanation?.source_document_id) ?? null;
  const sourceRenderAction = sourceDocument?.presentation?.header_actions.find((action): action is Extract<AppWorkspaceDocumentHeaderAction, { type: "app_action"; delivery: "direct_action" }> => action.type === "app_action" && action.delivery === "direct_action" && actions.some((descriptor) => descriptor.action_id === action.action_id && descriptor.kind === "render")) ?? null;
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [currentRevisionHint, setCurrentRevisionHint] = useState<number | null>(null);
  const [documentRetryable, setDocumentRetryable] = useState(false);
  const boundDocument = item.kind === "document" && Boolean(item.document.data_binding_id) ? item.document : null;
  const packageResource = boundDocument ? null : resource;
  const canResetToPackageDefault = Boolean(boundDocument?.resource_id && editable);
  const sessionIdRef = useRef(sessionId);
  const previousSessionIdRef = useRef(sessionId);
  const documentStatusRef = useRef(documentStatus);
  const boundDocumentRef = useRef(boundDocument);
  const documentLoadGenerationRef = useRef(0);
  const draftStateRef = useRef({ documentId: "", content: "", baseline: "" });
  const resourceRef = useRef(packageResource);
  const resumeCreateActionRef = useRef<Extract<AppWorkspaceDocumentHeaderAction, { type: "app_action"; delivery: "direct_action" }> | null>(null);
  const retryActionRef = useRef<{
    action: Extract<AppWorkspaceDocumentHeaderAction, { type: "app_action"; delivery: "direct_action" }>;
    input?: Record<string, unknown>;
  } | null>(null);
  const documentRecord = documentResult?.record ?? null;
  const mediaType = documentRecord?.media_type ?? "text/markdown";
  const renderer = presentation?.renderer ?? (mediaType === "application/json" ? "json_editor" : "plain_text");
  const isDirty = documentStatus !== "loading" && draftContent !== draftFromRecord(documentRecord);
  const shouldShowEditor = Boolean(boundDocument && editable && (isEditing || renderer === "json_editor" || !isDocumentChrome));

  useEffect(() => {
    documentStatusRef.current = documentStatus;
  }, [documentStatus]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    const loadGeneration = documentLoadGenerationRef;
    return () => { ++loadGeneration.current; };
  }, [sessionId]);

  useEffect(() => {
    boundDocumentRef.current = boundDocument;
  }, [boundDocument]);

  useEffect(() => {
    resourceRef.current = packageResource;
  }, [packageResource]);

  const withSessionRecovery = useCallback(async <T,>(operation: (activeSessionId: string) => Promise<T>): Promise<T> => {
    try {
      return await operation(sessionIdRef.current);
    } catch (error) {
      if (error instanceof AppDocumentError && error.code === "session_closed" && error.refreshRequired) {
        const recoveredSessionId = await onRecoverSession();
        if (recoveredSessionId) {
          sessionIdRef.current = recoveredSessionId;
          return await operation(recoveredSessionId);
        }
      }
      throw error;
    }
  }, [onRecoverSession]);

  const applyDocumentResult = useCallback((result: AppDocumentReadResult, replaceDirtyDraft = false) => {
    const draft = draftStateRef.current;
    const storedContent = draftFromRecord(result.record);
    // All automatic reads share this rule, evaluated when the response arrives.
    // Opening another document, an explicit reload, or a successful save may replace the draft.
    const preserveDraft = !replaceDirtyDraft && draft.documentId === result.document_id && draft.content !== draft.baseline;
    if (!preserveDraft) {
      draft.content = storedContent;
      setDraftContent(storedContent);
    }
    draft.documentId = result.document_id;
    draft.baseline = storedContent;
    setDocumentResult(result);
  }, []);

  const loadDocument = useCallback(async (intent: "automatic" | "owner_reload" = "automatic") => {
    const generation = ++documentLoadGenerationRef.current;
    const currentDocument = boundDocumentRef.current;
    setSourceIsStale(false);
    if (!currentDocument) {
      draftStateRef.current = { documentId: "", content: "", baseline: "" };
      setDocumentResult(null);
      setDraftContent("");
      setDocumentStatus("idle");
      setDocumentError(null);
      setDocumentNotice(null);
      setCurrentRevisionHint(null);
      setDocumentRetryable(false);
      return;
    }
    setDocumentStatus("loading");
    setDocumentError(null);
    setDocumentNotice(null);
    setCurrentRevisionHint(null);
    setDocumentRetryable(false);
    try {
      const result = await withSessionRecovery((activeSessionId) => readAppChatWorkspaceDocument(appKey, activeSessionId, currentDocument.document_id));
      if (generation !== documentLoadGenerationRef.current) return;
      applyDocumentResult(result, intent === "owner_reload");
      setDocumentStatus("ready");
      if (result.record && currentDocument.role === "derived_document" && sourceDocument?.data_binding_id && sourceDocument.role !== "conversation") {
        try {
          const source = await withSessionRecovery((activeSessionId) => readAppChatWorkspaceDocument(appKey, activeSessionId, sourceDocument.document_id));
          if (generation !== documentLoadGenerationRef.current) return;
          if (source.record) {
            const lineage = result.record.derived_from;
            // Older renders have no lineage. Their save timestamps provide a compatibility fallback.
            setSourceIsStale(lineage?.document_id === sourceDocument.document_id
              ? lineage.revision_id !== source.record.revision_id
              : Date.parse(source.record.updated_at) > Date.parse(result.record.updated_at));
          }
        } catch {
          // Freshness is optional: a failed source read must not discard the loaded document.
        }
      }
    } catch (error) {
      if (generation !== documentLoadGenerationRef.current) return;
      // A failed automatic refresh must also retain the draft's stored baseline for saving.
      if (intent === "owner_reload" || draftStateRef.current.documentId !== currentDocument.document_id) setDocumentResult(null);
      setDocumentStatus("error");
      setDocumentNotice(null);
      if (error instanceof AppDocumentError) {
        setDocumentError(error.safeMessage);
        setCurrentRevisionHint(error.currentRevision);
        setDocumentRetryable(error.retryable);
      } else {
        setDocumentError("This workspace document binding is unavailable.");
        setDocumentRetryable(false);
      }
    }
  }, [appKey, applyDocumentResult, sourceDocument, withSessionRecovery]);

  const loadResource = useCallback(async () => {
    const currentResource = resourceRef.current;
    if (!currentResource) {
      setResourceResult(null);
      setResourceStatus("idle");
      setResourceError(null);
      return;
    }
    setResourceStatus("loading");
    setResourceError(null);
    try {
      const result = await readAppChatWorkspaceResource(appKey, sessionIdRef.current, currentResource.resource_id);
      setResourceResult(result);
      setResourceStatus("ready");
    } catch {
      setResourceResult(null);
      setResourceStatus("error");
      setResourceError("This app package resource could not be loaded safely.");
    }
  }, [appKey]);

  useEffect(() => {
    const loadGeneration = documentLoadGenerationRef;
    void loadDocument();
    return () => { ++loadGeneration.current; };
  }, [boundDocument?.document_id, loadDocument]);

  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) return;
    previousSessionIdRef.current = sessionId;
    // Renewal invalidates old reads, but must not reload an already loaded owner draft.
    // Retry only an interrupted document load; source freshness is checked on reopening.
    if (documentStatusRef.current === "loading") void loadDocument();
  }, [loadDocument, sessionId]);

  useEffect(() => {
    void loadResource();
  }, [loadResource, packageResource?.resource_id]);

  async function saveDocument() {
    if (!boundDocument || documentStatus === "saving") return;
    let content: unknown;
    try {
      content = contentFromDraft(draftContent, mediaType);
    } catch {
      setDocumentError("This document contains invalid JSON.");
      setDocumentNotice(null);
      setDocumentStatus("ready");
      return;
    }
    setDocumentStatus("saving");
    setDocumentError(null);
      setDocumentNotice(null);
      setCurrentRevisionHint(null);
      setDocumentRetryable(false);
    try {
      const result = await withSessionRecovery((activeSessionId) => writeAppChatWorkspaceDocument(appKey, activeSessionId, boundDocument.document_id, {
        expectedRevision: documentRecord?.revision ?? null,
        content,
        mediaType,
      }));
      applyDocumentResult(result, true);
      setDocumentStatus("ready");
      setDocumentNotice(`Saved ${title}.`);
      if (renderer !== "json_editor") {
        setIsEditing(false);
      }
    } catch (error) {
      setDocumentStatus("ready");
      setDocumentNotice(null);
      if (error instanceof AppDocumentError) {
        setDocumentError(error.safeMessage);
        setCurrentRevisionHint(error.currentRevision);
        setDocumentRetryable(error.retryable);
      } else {
        setDocumentError("The app document could not be saved safely.");
        setDocumentRetryable(false);
      }
    }
  }

  async function resetDocumentToPackageDefault() {
    if (!boundDocument?.resource_id || documentStatus === "saving") return;
    setDocumentStatus("saving");
    setDocumentError(null);
      setDocumentNotice(null);
      setCurrentRevisionHint(null);
      setDocumentRetryable(false);
    try {
      const result = await withSessionRecovery(async (activeSessionId) => {
        const packageDefault = await readAppChatWorkspaceResource(appKey, activeSessionId, boundDocument.resource_id!);
        return writeAppChatWorkspaceDocument(appKey, activeSessionId, boundDocument.document_id, {
          expectedRevision: documentRecord?.revision ?? null,
          content: contentFromDraft(packageDefault.content, packageDefault.media_type),
          mediaType: packageDefault.media_type,
        });
      });
      applyDocumentResult(result, true);
      setDocumentStatus("ready");
      setDocumentNotice(`Reset ${title} to package default.`);
      if (renderer !== "json_editor") {
        setIsEditing(false);
      }
    } catch (error) {
      setDocumentStatus("ready");
      setDocumentNotice(null);
      if (error instanceof AppDocumentError) {
        setDocumentError(error.safeMessage);
        setCurrentRevisionHint(error.currentRevision);
        setDocumentRetryable(error.retryable);
      } else {
        setDocumentError(`${title} could not be reset to the package default.`);
        setDocumentRetryable(false);
      }
    }
  }

  async function executeDirectHeaderAction(
    action: Extract<AppWorkspaceDocumentHeaderAction, { type: "app_action"; delivery: "direct_action" }>,
    actionInputOverride?: Record<string, unknown>,
  ) {
    if (runningActionId) return;
    const actionSessionId = sessionIdRef.current;
    const actionLoadGeneration = documentLoadGenerationRef.current;
    if (action.action_id === "resume.create") {
      resumeCreateActionRef.current = action;
    }
    retryActionRef.current = null;
    const operationId = createClientOperationId("app-action");
    const isExportAction = action.action_id.toLowerCase().includes("export");
    setRunningActionId(action.action_id);
    setDocumentError(null);
    setDocumentNotice(`Running ${action.label}...`);
    onClearExportNotice();
    setCurrentRevisionHint(null);
    setDocumentRetryable(false);
    try {
      const result = await withSessionRecovery((activeSessionId) => executeAppChatWorkspaceAction(appKey, activeSessionId, action.action_id, {
        actionInput: actionInputOverride ?? action.action_input ?? {},
        ownerConfirmed: true,
      }));
      const missingEssentials = extractMissingResumeEssentials(result);
      if (missingEssentials) {
        setMissingResumeEssentials(missingEssentials);
        setDocumentNotice(null);
        setDocumentError("Resume creation is paused until you choose how to handle the visible Profile gaps.");
        return;
      }
      setMissingResumeEssentials(null);
      retryActionRef.current = null;
      const exportResult = await onDirectActionResult(result);
      if (isExportAction && exportResult === "ignored") throw new Error("export_result_missing");
      if (exportResult === "cancelled") {
        onDirectActionComplete(buildDirectActionHostMessage(action, result, exportResult));
        setDocumentNotice(null);
        return;
      }
      if (exportResult === "failed") throw new Error("export_download_failed");
      onDirectActionComplete(buildDirectActionHostMessage(action, result, exportResult));
      if (boundDocument?.role === "derived_document"
        && boundDocument.document_id === boundDocumentRef.current?.document_id
        && actionSessionId === sessionIdRef.current
        && actionLoadGeneration === documentLoadGenerationRef.current
        && actions.some((descriptor) => descriptor.action_id === action.action_id && descriptor.kind === "render")) {
        await loadDocument();
      }
      setDocumentNotice(`${action.label} completed.`);
    } catch (error) {
      setDocumentNotice(null);
      if (error instanceof AppDocumentError) {
        setDocumentError(error.safeMessage);
        setCurrentRevisionHint(error.currentRevision);
        setDocumentRetryable(true);
      } else {
        setDocumentError(`${action.label} could not complete safely.`);
        setDocumentRetryable(true);
      }
      retryActionRef.current = { action, ...(actionInputOverride ? { input: actionInputOverride } : {}) };
      const report = reportOwnerFailure({
        operationId,
        surface: isExportAction ? "export" : "render",
        operation: action.action_id,
        safeMessage: `${action.label} could not complete safely.`,
        failureCode: error instanceof AppDocumentError ? error.code : "app_action_failure",
      });
      void report?.catch(() => undefined);
      onDirectActionComplete(buildDirectActionFailureHostMessage(action, error));
    } finally {
      setRunningActionId(null);
    }
  }

  function handleHeaderAction(action: AppWorkspaceDocumentHeaderAction) {
    if (action.type === "back_to_chat") {
      onBackToChat();
      return;
    }
    if (action.type === "edit_document") {
      setIsEditing(true);
      return;
    }
    if (action.delivery === "chat_prompt") {
      onQueueChatPrompt(action.prompt);
      return;
    }
    void executeDirectHeaderAction(action);
  }

  const documentStatusLabel = documentStatus === "loading"
    ? "Loading document content..."
    : documentRecord
      ? `Revision ${documentRecord.revision}`
      : "No saved content yet";
  const presentationTitle = presentation?.title ?? title;
  const presentationSubtitle = presentation?.subtitle ?? (isDocumentChrome ? description : `${appName} / ${workspaceTitle}`);
  const readOnlyExplanation = !editable ? presentation?.read_only_explanation ?? null : null;

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-bd-bg-chat text-bd-text-primary" aria-labelledby="app-workspace-document-title">
        <DocumentHeader>
          <div className="min-w-0">
            <p className="truncate text-[11px] uppercase tracking-[0.24em] text-bd-text-muted">{presentationSubtitle}</p>
            <h1 id="app-workspace-document-title" ref={headingRef} tabIndex={-1} className={cn(documentStyles.title, "outline-none focus-visible:ring-2 focus-visible:ring-bd-amber")}>
              {presentationTitle}
            </h1>
            {!isDocumentChrome ? <p className="mt-2 text-sm leading-6 text-bd-text-secondary">{description}</p> : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 max-w-[70%] sm:max-w-none">
            {presentation?.header_actions.map((action) => (
              <DocumentButton
                key={`${action.type}:${action.type === "app_action" ? action.action_id : action.label}`}
                type="button"
                variant={action.type === "app_action" ? "default" : "ghost"}
                size="sm"
                onClick={() => handleHeaderAction(action)}
                disabled={
                  runningActionId !== null ||
                  (action.type === "edit_document" && (!editable || isEditing))
                }
                className={action.type === "app_action" ? documentStyles.primary : documentStyles.secondary}
              >
                {action.type === "app_action" && runningActionId === action.action_id
                  ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
                  : <HeaderActionIcon action={action} />}
                {action.label}
              </DocumentButton>
            ))}
            {canResetToPackageDefault ? (
              <DocumentButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void resetDocumentToPackageDefault()}
                disabled={documentStatus === "loading" || documentStatus === "saving" || documentRecord === null || runningActionId !== null}
                className={documentStyles.secondary}
              >
                {documentStatus === "saving" ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                Reset to package default
              </DocumentButton>
            ) : null}
            {shouldShowEditor ? (
              <DocumentButton type="button" size="sm" onClick={() => void saveDocument()} disabled={!isDirty || documentStatus === "saving"} className={documentStyles.primary}>
                {documentStatus === "saving" ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={16} />}
                Save
              </DocumentButton>
            ) : null}
          </div>
        </DocumentHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--mobile-composer-height,0px)+1.5rem)] pt-6 sm:px-6 md:pb-6">
          <div className="mx-auto w-full max-w-[780px]">

        {sourceIsStale && sourceDocument ? (
          <aside role="status" aria-label="Source document changed" className="mt-4 rounded-md border border-bd-amber bg-bd-bg-secondary px-3 py-3 text-sm text-bd-text-primary">
            <p>{sourceDocument.title.trim() || "The source document"} changed since this document was created.{sourceRenderAction ? ` Choose ${sourceRenderAction.label} again to update it.` : " Open the source document to update it."}</p>
            <DocumentButton type="button" size="sm" className="mt-2" disabled={runningActionId !== null} onClick={() => sourceRenderAction ? void executeDirectHeaderAction(sourceRenderAction) : onOpenWorkspaceItem(sourceDocument.document_id)}>
              {sourceRenderAction?.label ?? "Open source document"}
            </DocumentButton>
          </aside>
        ) : null}

        {readOnlyExplanation ? (
          <aside className="mt-4 rounded-md border border-bd-border bg-bd-bg-secondary px-3 py-3 text-sm text-bd-text-primary" aria-label="Read-only explanation">
            <p>{readOnlyExplanation.text}</p>
            {readOnlyExplanation.source_document_id && readOnlyExplanation.source_action_label ? (
              <DocumentButton
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => onOpenWorkspaceItem(readOnlyExplanation.source_document_id!)}
              >
                {readOnlyExplanation.source_action_label}
              </DocumentButton>
            ) : null}
          </aside>
        ) : null}

        {!isDocumentChrome && !packageResource ? (
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <DescriptorFact label="State" value={editable ? "Owner editable" : "Read only"} />
            <DescriptorFact label="Role" value={item.kind === "document" ? roleLabel(item.document.role) : roleLabel(item.resource.role)} />
            {item.kind === "document" ? <DescriptorFact label="Model access" value={roleLabel(item.document.model_access)} /> : null}
            {bindingId ? <DescriptorFact label="Data binding" value={bindingId} /> : null}
          </dl>
        ) : null}

        {boundDocument ? (
          <section className={cn(isDocumentChrome ? "mt-4" : "mt-6 border-t border-bd-border pt-5")} aria-labelledby="app-workspace-bound-document-title">
            {!isDocumentChrome ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 id="app-workspace-bound-document-title" className="font-heading text-base text-bd-text-heading">App document</h3>
                  <p className="mt-1 text-sm text-bd-text-secondary">{documentStatusLabel}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <DocumentButton type="button" variant="ghost" size="sm" onClick={() => void loadDocument("owner_reload")} disabled={documentStatus === "loading" || documentStatus === "saving"} className="gap-2">
                    <RefreshCw size={15} />
                    Refresh
                  </DocumentButton>
                  {editable ? (
                    <DocumentButton type="button" size="sm" onClick={() => void saveDocument()} disabled={!isDirty || documentStatus === "saving"} className="gap-2">
                      {documentStatus === "saving" ? <LoaderCircle size={15} className="animate-spin" /> : <FileText size={15} />}
                      Save {title}
                    </DocumentButton>
                  ) : null}
                </div>
              </div>
            ) : (
              <p id="app-workspace-bound-document-title" className="sr-only">{documentStatusLabel}</p>
            )}

            {documentError ? (
            <div role="alert" className="mt-4 rounded-md border border-bd-danger-border bg-bd-danger-bg px-3 py-2 text-sm text-bd-danger">
              <p>{documentError}</p>
              {currentRevisionHint !== null ? <p className="mt-1">The current revision is {currentRevisionHint}.</p> : null}
              {documentRetryable ? (
                <DocumentButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    const retryAction = retryActionRef.current;
                    if (retryAction) {
                      void executeDirectHeaderAction(retryAction.action, retryAction.input);
                    } else {
                      void loadDocument("owner_reload");
                    }
                  }}
                  disabled={documentStatus === "loading" || documentStatus === "saving"}
                >
                  Retry
                </DocumentButton>
              ) : null}
            </div>
            ) : null}

            {documentNotice ? (
              <div role="status" aria-live="polite" className="mt-4 rounded-md border border-bd-success/35 bg-bd-success/10 px-3 py-2 text-sm text-bd-text-primary">
                {documentNotice}
              </div>
            ) : null}

            {missingResumeEssentials ? (
              <div role="region" aria-label="Missing Profile items" aria-live="polite" className="mt-4 rounded-md border border-bd-border bg-bd-bg-secondary px-3 py-3 text-sm text-bd-text-primary">
                <p>These items are missing from your Profile. Edit the Profile, return to chat, or knowingly create an honest partial resume with these limitations visible.</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {missingResumeEssentials.missing_essentials.map((item, index) => <li key={index}>{item.label}</li>)}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <DocumentButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={runningActionId !== null}
                    onClick={() => {
                      setMissingResumeEssentials(null);
                      setDocumentError(null);
                      if (boundDocument && editable) setIsEditing(true);
                      else onOpenWorkspaceItem("resume.profile");
                    }}
                  >
                    Edit the Profile
                  </DocumentButton>
                  <DocumentButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={runningActionId !== null}
                    onClick={onBackToChat}
                  >
                    Return to chat
                  </DocumentButton>
                  <DocumentButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setMissingResumeEssentials(null);
                      setDocumentError(null);
                      setDocumentNotice("Resume creation remains paused. You can return when you're ready.");
                    }}
                  >
                    Return later
                  </DocumentButton>
                  <DocumentButton
                    type="button"
                    size="sm"
                    className="gap-2"
                    disabled={runningActionId !== null}
                    onClick={() => {
                      const createAction = presentation?.header_actions.find((candidate): candidate is Extract<AppWorkspaceDocumentHeaderAction, { type: "app_action"; delivery: "direct_action" }> => candidate.type === "app_action" && candidate.delivery === "direct_action" && candidate.action_id === "resume.create") ?? resumeCreateActionRef.current;
                      if (createAction) void executeDirectHeaderAction(createAction, { ...(createAction.action_input ?? {}), missing_essential_disposition: "proceed_with_limitations" });
                    }}
                  >
                    Proceed with limitations
                  </DocumentButton>
                </div>
              </div>
            ) : null}

            {documentStatus === "loading" ? (
              <div className="mt-4 flex items-center gap-2 rounded-md border border-bd-border bg-bd-bg-secondary px-3 py-3 text-sm text-bd-text-secondary" role="status">
                <LoaderCircle size={16} className="animate-spin" />
                Loading document content...
              </div>
            ) : shouldShowEditor ? (
              <textarea
                aria-label={`${title} content`}
                value={draftContent}
                onChange={(event) => {
                  draftStateRef.current.content = event.target.value;
                  setDraftContent(event.target.value);
                  setDocumentNotice(null);
                }}
                className={cn(documentStyles.editor, "mt-4 w-full")}
                spellCheck={false}
              />
            ) : renderer === "paper_document" ? (
              <PaperDocumentPreview markdown={draftContent} />
            ) : renderer === "markdown_document" ? (
              <MarkdownDocumentView markdown={draftContent} />
            ) : (
              <pre className="mt-4 min-h-48 overflow-auto rounded-md border border-bd-border bg-bd-bg-primary px-3 py-3 text-sm leading-6 text-bd-text-primary">
                {draftContent || "No saved content yet"}
              </pre>
            )}
          </section>
        ) : null}

        {packageResource ? (
          <section className="mt-6 border-t border-bd-border pt-5" aria-labelledby="app-workspace-resource-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 id="app-workspace-resource-title" className="font-heading text-base text-bd-text-heading">Package resource</h3>
                <p className="mt-1 text-sm text-bd-text-secondary">
                  {packageResource.owner_editable ? "Editable package resource declaration" : "Read-only package resource"} · {packageResource.media_type} · digest {descriptorDigestLabel(packageResource.content_digest)}
                </p>
              </div>
              <DocumentButton type="button" variant="ghost" size="sm" onClick={() => void loadResource()} disabled={resourceStatus === "loading"} className="gap-2">
                {resourceStatus === "loading" ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                Refresh
              </DocumentButton>
            </div>

            {resourceError ? (
              <div role="alert" className="mt-4 rounded-md border border-bd-danger-border bg-bd-danger-bg px-3 py-2 text-sm text-bd-danger">
                {resourceError}
              </div>
            ) : null}

            {resourceStatus === "loading" ? (
              <div className="mt-4 flex items-center gap-2 rounded-md border border-bd-border bg-bd-bg-secondary px-3 py-3 text-sm text-bd-text-secondary" role="status">
                <LoaderCircle size={16} className="animate-spin" />
                Loading package resource...
              </div>
            ) : (
              <ResourceContentView
                mediaType={resourceResult?.media_type ?? packageResource.media_type}
                content={resourceResult?.content ?? ""}
              />
            )}
          </section>
        ) : null}

        {item.kind === "document" && !packageResource && !isDocumentChrome && exposedActions.length > 0 ? (
          <section className="mt-6 border-t border-bd-border pt-5" aria-labelledby="app-workspace-actions-title">
            <h3 id="app-workspace-actions-title" className="font-heading text-base text-bd-text-heading">Declared actions</h3>
            <ul className="mt-3 space-y-2 text-sm text-bd-text-secondary">
              {exposedActions.map((action) => (
                <li key={action.action_id} className="rounded-md border border-bd-border bg-bd-bg-secondary px-3 py-2">
                  <span className="font-medium text-bd-text-primary">{action.title}</span>
                  <span className="ml-2 text-bd-text-muted">{roleLabel(action.kind)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!packageResource && !bindingId ? (
          <div className="mt-6 rounded-md border border-bd-border bg-bd-bg-secondary px-4 py-3 text-sm text-bd-text-secondary" role="status">
            This workspace document is declared. App-owned content will appear when a later document binding supplies it.
          </div>
        ) : null}
          </div>
      </div>
    </section>
  );
}

function DescriptorFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-bd-border bg-bd-bg-secondary px-3 py-2">
      <dt className="text-xs text-bd-text-muted">{label}</dt>
      <dd className="mt-1 break-words text-bd-text-primary">{value}</dd>
    </div>
  );
}

function ResourceContentView({ mediaType, content }: { mediaType: AppResourceDescriptor["media_type"]; content: string }) {
  if (mediaType === "text/markdown") {
    return <MarkdownDocumentView markdown={content || "No package resource content available."} />;
  }
  const formatted = mediaType === "application/json" ? formatJsonResource(content) : content;
  return (
    <pre className="mt-4 max-h-[60vh] overflow-auto rounded-md border border-bd-border bg-bd-bg-primary px-3 py-3 font-mono text-sm leading-6 text-bd-text-primary">
      {formatted || "No package resource content available."}
    </pre>
  );
}

function formatJsonResource(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function HeaderActionIcon({ action }: { action: AppWorkspaceDocumentHeaderAction }) {
  if (action.type === "back_to_chat") return <ArrowLeft size={16} aria-hidden="true" />;
  if (action.type === "edit_document") return <PencilLine size={16} aria-hidden="true" />;
  if (action.action_id.toLowerCase().includes("export")) return <Download size={15} aria-hidden="true" />;
  return <Send size={15} aria-hidden="true" />;
}

function MarkdownDocumentView({ markdown }: { markdown: string }) {
  return (
    <article className="py-2">
      <div className={documentStyles.body}>
        <MarkdownContent content={markdown || "No saved content yet"} />
      </div>
    </article>
  );
}

function PaperDocumentPreview({ markdown }: { markdown: string }) {
  return (
    <article className={cn(documentStyles.body, "py-2")}>
      {renderMarkdownLines(markdown || "No saved content yet", "paper")}
    </article>
  );
}

function renderMarkdownLines(markdown: string, variant: "markdown" | "paper") {
  return markdown.split(/\r?\n/).map((rawLine, index) => {
    const line = rawLine.trim();
    const key = `${index}:${line}`;
    if (!line) {
      return <div key={key} className={variant === "paper" ? "h-3" : "h-4"} />;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const depth = heading[1].length;
      const text = heading[2];
      if (variant === "paper") {
        if (depth === 1) return <h1 key={key} className={markdownStyles.h1}>{renderInlineMarkdownText(text)}</h1>;
        if (depth > 2) return <h3 key={key} className={markdownStyles.h3}>{renderInlineMarkdownText(text)}</h3>;
        return <h2 key={key} className={markdownStyles.h2}>{renderInlineMarkdownText(text)}</h2>;
      }
      if (depth === 1) return <h1 key={key} className="mb-4 font-heading text-3xl text-bd-text-heading">{renderInlineMarkdownText(text)}</h1>;
      return <h2 key={key} className="mb-3 mt-7 font-heading text-xl text-bd-text-heading">{renderInlineMarkdownText(text)}</h2>;
    }
    if (/^(?:[-*+]|\d+[.)])\s*$/.test(line)) return null;
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (bullet) {
      if (!parsePaperInlineMarkdown(bullet[1]).some((run) => run.text.trim())) return null;
      return (
        <div key={key} className={cn("flex gap-3", variant === "paper" ? "mb-1 text-[15px] leading-7 text-bd-text-primary" : "mb-2 text-base leading-7 text-bd-text-primary")}>
          <span aria-hidden="true" className={variant === "paper" ? "text-bd-text-muted" : "text-bd-text-muted"}>•</span>
          <p className="min-w-0 flex-1 whitespace-pre-wrap">{renderInlineMarkdownText(bullet[1])}</p>
        </div>
      );
    }
    return (
      <p key={key} className={variant === "paper" ? cn(markdownStyles.paragraph, "whitespace-pre-wrap") : "mb-4 text-base leading-7 text-bd-text-primary"}>
        {renderInlineMarkdownText(line)}
      </p>
    );
  });
}

function renderInlineMarkdownText(text: string): ReactNode[] {
  return parsePaperInlineMarkdown(text).map((run, index) =>
    run.bold ? <strong key={index} className={markdownStyles.strong}>{run.text}</strong> : run.text,
  );
}

function draftFromRecord(record: AppDocumentRecord | null): string {
  if (!record) return "";
  return typeof record.content === "string" ? record.content : JSON.stringify(record.content, null, 2);
}

function buildDirectActionHostMessage(
  action: Extract<AppWorkspaceDocumentHeaderAction, { type: "app_action"; delivery: "direct_action" }>,
  result: unknown,
  exportResult: AppChatExportHandlingResult,
): string {
  if (action.action_id === "resume.create") {
    const revision = extractCreatedResumeRevision(result);
    return `Owner pressed Create resume. Your Resume${revision ? ` revision ${revision}` : ""} created.`;
  }
  if (action.action_id === "resume.export.pdf.request") {
    const label = extractExportDestinationLabel(result) ?? "resume.pdf";
    if (exportResult === "cancelled") return "Owner pressed Export PDF. The export was cancelled.";
    return isTauriRuntime()
      ? `Owner pressed Export PDF. Saved ${label}.`
      : `Owner pressed Export PDF. Downloaded ${label} through the browser.`;
  }
  return `Owner pressed ${action.label}. ${action.label} completed.`;
}

function buildDirectActionFailureHostMessage(
  action: Extract<AppWorkspaceDocumentHeaderAction, { type: "app_action"; delivery: "direct_action" }>,
  error: unknown,
): string {
  const safeReason = error instanceof AppDocumentError ? error.safeMessage : `${action.label} could not complete safely.`;
  const nextStep = action.action_id.toLowerCase().includes("export")
    ? "No successful export was recorded. Try Export PDF again after reviewing the visible error."
    : "Your saved work was not replaced. Review the visible error and try the action again.";
  return `Owner pressed ${action.label}. The action failed safely: ${safeReason} ${nextStep}`;
}

function extractMissingResumeEssentials(result: unknown): MissingResumeEssentials | null {
  if (!isRecord(result) || !isRecord(result.result)) return null;
  const actionResult = result.result;
  const persistedContent = isRecord(actionResult.record) && isRecord(actionResult.record.content)
    ? actionResult.record.content
    : null;
  const payload = persistedContent ?? actionResult;
  if (payload.status !== "missing_essentials") return null;
  const missing = payload.missing_essentials;
  if (!Array.isArray(missing) || !missing.every((item) => isRecord(item) && typeof item.label === "string")) return null;
  return { missing_essentials: missing as Array<{ label: string }> };
}

function extractCreatedResumeRevision(result: unknown): number | null {
  if (!isRecord(result)) return null;
  const actionResult = isRecord(result.result) ? result.result : null;
  const recordResult = isRecord(actionResult?.record) ? actionResult.record : null;
  const record = recordResult && isRecord(recordResult.record)
    ? recordResult.record
    : recordResult ?? (isRecord(actionResult?.definition) ? actionResult.definition : null);
  const revision = isRecord(record?.metadata) ? record.metadata.revision : record?.revision;
  return typeof revision === "number" && Number.isInteger(revision) && revision > 0 ? revision : null;
}

function extractExportDestinationLabel(result: unknown): string | null {
  if (!isRecord(result)) return null;
  const actionResult = isRecord(result.result) ? result.result : null;
  const safeDestinationLabel = actionResult?.safe_destination_label;
  const filename = actionResult?.filename;
  if (typeof safeDestinationLabel === "string" && safeDestinationLabel.trim()) return safeDestinationLabel.trim();
  if (typeof filename === "string" && filename.trim()) return filename.trim();
  return null;
}

function contentFromDraft(draft: string, mediaType: AppDocumentRecord["media_type"]): unknown {
  return mediaType === "application/json" ? JSON.parse(draft || "null") : draft;
}

export type { AppChatWorkspaceProps };
