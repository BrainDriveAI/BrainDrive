import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { AlertCircle, ChevronLeft, Download, FileText, LoaderCircle, Pencil, RefreshCw, Send, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";

import { getSession } from "@/api/auth-adapter";
import {
  closeAppSession,
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
import ChatPanel from "@/components/chat/ChatPanel";
import ProfileMenu from "@/components/layout/ProfileMenu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserProfile } from "@/types/ui";

type WorkspaceItem =
  | { key: string; kind: "document"; document: AppWorkspaceDocumentDescriptor }
  | { key: string; kind: "resource"; resource: AppResourceDescriptor };

type AppChatWorkspaceProps = {
  appKey: string;
  appName: string;
  launch: AppChatWorkspaceLaunch;
  onSessionClosed: () => void;
  onOpenSettings?: () => void;
  onLogout?: () => void;
  tier?: "local" | "concierge";
};

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
  onOpenSettings,
  onLogout,
  tier = "local",
}: AppChatWorkspaceProps) {
  const items = useMemo(() => buildItems(launch), [launch]);
  const [activeItemKey, setActiveItemKey] = useState(() => defaultItemKey(launch, items));
  const [sessionState, setSessionState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [queuedChatMessage, setQueuedChatMessage] = useState<{ id: string; content: string } | null>(null);
  const activeHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const navButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const closedSessionIdsRef = useRef(new Set<string>());
  const cleanupTimerRef = useRef<{ sessionId: string; timer: number } | null>(null);

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
  const messageMetadata = useMemo(() => buildAppChatMessageMetadata(launch), [launch]);
  const emptyStateIntro = useMemo(() => workspaceEmptyStateIntro(launch), [launch]);

  const closeSessionById = useCallback((sessionId: string) => {
    if (closedSessionIdsRef.current.has(sessionId)) return;
    closedSessionIdsRef.current.add(sessionId);
    void closeAppSession(appKey, sessionId);
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
    setActiveItemKey(defaultItemKey(launch, items));
  }, [items, launch]);

  useEffect(() => {
    let cancelled = false;
    setSessionState("loading");
    setSessionError(null);
    void readAppChatWorkspaceSession(appKey, launch.session.session_id)
      .then(() => {
        if (!cancelled) setSessionState("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setSessionState("unavailable");
          setSessionError("This app workspace session is no longer available.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [appKey, launch.session.session_id]);

  useEffect(() => {
    activeHeadingRef.current?.focus({ preventScroll: true });
  }, [activeItemKey]);

  function closeWorkspace() {
    if (cleanupTimerRef.current) {
      window.clearTimeout(cleanupTimerRef.current.timer);
      cleanupTimerRef.current = null;
    }
    closeSessionById(launch.session.session_id);
    onSessionClosed();
  }

  function queueWorkspaceChatPrompt(prompt: string) {
    setActiveItemKey(itemKey(items.find((item) => item.kind === "document" && item.document.role === "conversation") ?? items[0] ?? { key: "document:conversation", kind: "document", document: FALLBACK_CONVERSATION }));
    setQueuedChatMessage({
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      content: prompt,
    });
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
      activeConversationId={null}
      draftKey={`app-chat:${launch.session.app_id}:${launch.session.view_id}`}
      isEmpty
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
          actions={launch.workspace.actions}
          headingRef={activeHeadingRef}
          onBackToChat={() => setActiveItemKey(itemKey(items.find((candidate) => candidate.kind === "document" && candidate.document.role === "conversation") ?? items[0] ?? { key: "document:conversation", kind: "document", document: FALLBACK_CONVERSATION }))}
          onQueueChatPrompt={queueWorkspaceChatPrompt}
        />
      )}
      queuedMessage={queuedChatMessage}
      onOpenSettings={onOpenSettings}
    />
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-bd-bg-chat text-bd-text-primary md:flex-row" aria-label={`${appName} native app workspace`} data-testid="app-chat-workspace">
      <nav className="flex shrink-0 flex-col border-b border-bd-border bg-bd-bg-secondary px-4 py-4 md:h-full md:w-sidebar md:border-b-0 md:border-r" aria-label={`${appName} workspace navigation`}>
        <Button type="button" variant="ghost" size="sm" onClick={closeWorkspace} className="mb-7 w-fit gap-2 px-1 text-bd-text-secondary hover:bg-transparent hover:text-bd-text-heading">
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

        <div className="mt-4 flex min-h-0 flex-1 gap-2 overflow-x-auto md:flex-col md:overflow-x-visible">
          <WorkspaceNavGroup
            label={null}
            items={primaryItems}
            activeKey={activeItemKey}
            navButtonRefs={navButtonRefs}
            onSelect={setActiveItemKey}
            onMoveFocus={moveNavigationFocus}
          />
          {advancedItems.length > 0 ? (
            <div className="shrink-0 md:pt-4">
              <button
                type="button"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((current) => !current)}
                className="flex min-w-44 items-center justify-between rounded-md px-3 py-2 text-left text-xs text-bd-text-muted transition-colors duration-200 hover:bg-bd-bg-hover hover:text-bd-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber md:min-w-0"
              >
                <span>{advancedOpen ? "Hide advanced" : "Show advanced"}</span>
                <SlidersHorizontal size={15} aria-hidden="true" />
              </button>
              {advancedOpen ? (
                <WorkspaceNavGroup
                  label={null}
                  items={advancedItems}
                  activeKey={activeItemKey}
                  navButtonRefs={navButtonRefs}
                  onSelect={setActiveItemKey}
                  onMoveFocus={moveNavigationFocus}
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
      </nav>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="app-chat-workspace-pane">
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
      </div>
    </section>
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
    <section className="flex shrink-0 gap-2 md:flex-col" aria-label={label ?? "Workspace"}>
      {label ? (
        <div className="hidden items-center justify-between px-2 pb-1 pt-5 text-xs text-bd-text-muted md:flex">
          <span>{label}</span>
          <SlidersHorizontal size={15} aria-hidden="true" />
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
              "flex min-w-44 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-all duration-200 hover:bg-bd-bg-hover hover:text-bd-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber md:min-w-0",
              activeKey === item.key ? "border-l-2 border-bd-amber bg-bd-bg-tertiary pl-[10px] text-bd-text-primary" : "text-bd-text-secondary",
            )}
          >
            <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
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

function WorkspaceDetail({
  appKey,
  appName,
  sessionId,
  workspaceTitle,
  item,
  resource,
  actions,
  headingRef,
  onBackToChat,
  onQueueChatPrompt,
}: {
  appKey: string;
  appName: string;
  sessionId: string;
  workspaceTitle: string;
  item: WorkspaceItem;
  resource: AppResourceDescriptor | null;
  actions: AppChatWorkspaceLaunch["workspace"]["actions"];
  headingRef: MutableRefObject<HTMLHeadingElement | null>;
  onBackToChat: () => void;
  onQueueChatPrompt: (prompt: string) => void;
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
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [currentRevisionHint, setCurrentRevisionHint] = useState<number | null>(null);
  const boundDocument = item.kind === "document" && Boolean(item.document.data_binding_id) ? item.document : null;
  const documentRecord = documentResult?.record ?? null;
  const mediaType = documentRecord?.media_type ?? "text/markdown";
  const renderer = presentation?.renderer ?? (mediaType === "application/json" ? "json_editor" : "plain_text");
  const isDirty = documentStatus !== "loading" && draftContent !== draftFromRecord(documentRecord);
  const shouldShowEditor = Boolean(boundDocument && editable && (isEditing || renderer === "json_editor" || !isDocumentChrome));

  const loadDocument = useCallback(async () => {
    if (!boundDocument) {
      setDocumentResult(null);
      setDraftContent("");
      setDocumentStatus("idle");
      setDocumentError(null);
      setCurrentRevisionHint(null);
      return;
    }
    setDocumentStatus("loading");
    setDocumentError(null);
    setCurrentRevisionHint(null);
    try {
      const result = await readAppChatWorkspaceDocument(appKey, sessionId, boundDocument.document_id);
      setDocumentResult(result);
      setDraftContent(draftFromRecord(result.record));
      setDocumentStatus("ready");
    } catch (error) {
      setDocumentResult(null);
      setDraftContent("");
      setDocumentStatus("error");
      if (error instanceof AppDocumentError) {
        setDocumentError(error.safeMessage);
        setCurrentRevisionHint(error.currentRevision);
      } else {
        setDocumentError("This workspace document binding is unavailable.");
      }
    }
  }, [appKey, boundDocument, sessionId]);

  const loadResource = useCallback(async () => {
    if (!resource) {
      setResourceResult(null);
      setResourceStatus("idle");
      setResourceError(null);
      return;
    }
    setResourceStatus("loading");
    setResourceError(null);
    try {
      const result = await readAppChatWorkspaceResource(appKey, sessionId, resource.resource_id);
      setResourceResult(result);
      setResourceStatus("ready");
    } catch {
      setResourceResult(null);
      setResourceStatus("error");
      setResourceError("This app package resource could not be loaded safely.");
    }
  }, [appKey, resource, sessionId]);

  useEffect(() => {
    void loadDocument();
  }, [loadDocument]);

  useEffect(() => {
    void loadResource();
  }, [loadResource]);

  async function saveDocument() {
    if (!boundDocument || documentStatus === "saving") return;
    let content: unknown;
    try {
      content = contentFromDraft(draftContent, mediaType);
    } catch {
      setDocumentError("This document contains invalid JSON.");
      setDocumentStatus("ready");
      return;
    }
    setDocumentStatus("saving");
    setDocumentError(null);
    setCurrentRevisionHint(null);
    try {
      const result = await writeAppChatWorkspaceDocument(appKey, sessionId, boundDocument.document_id, {
        expectedRevision: documentRecord?.revision ?? null,
        content,
        mediaType,
      });
      setDocumentResult(result);
      setDraftContent(draftFromRecord(result.record));
      setDocumentStatus("ready");
    } catch (error) {
      setDocumentStatus("ready");
      if (error instanceof AppDocumentError) {
        setDocumentError(error.safeMessage);
        setCurrentRevisionHint(error.currentRevision);
      } else {
        setDocumentError("The app document could not be saved safely.");
      }
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
    onQueueChatPrompt(action.prompt);
  }

  const documentStatusLabel = documentStatus === "loading"
    ? "Loading document content..."
    : documentRecord
      ? `Revision ${documentRecord.revision}`
      : "No saved content yet";
  const presentationTitle = presentation?.title ?? title;
  const presentationSubtitle = presentation?.subtitle ?? (isDocumentChrome ? description : `${appName} / ${workspaceTitle}`);

  return (
    <section
      className={cn(
        "h-full overflow-y-auto pb-[calc(var(--mobile-composer-height,0px)+1.5rem)] md:pb-6",
        isDocumentChrome ? "px-4 pt-4 sm:px-6 md:px-10" : "px-4 pt-6 sm:px-6",
      )}
      aria-labelledby="app-workspace-document-title"
    >
      <div className={cn("mx-auto w-full", isDocumentChrome ? "max-w-[1120px]" : "max-w-[780px]")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.24em] text-bd-text-muted">{presentationSubtitle}</p>
            <h2 id="app-workspace-document-title" ref={headingRef} tabIndex={-1} className="mt-1 font-heading text-2xl text-bd-text-heading outline-none focus-visible:ring-2 focus-visible:ring-bd-amber">
              {presentationTitle}
            </h2>
            {!isDocumentChrome ? <p className="mt-2 text-sm leading-6 text-bd-text-secondary">{description}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {presentation?.header_actions.map((action) => (
              <Button
                key={`${action.type}:${action.type === "app_action" ? action.action_id : action.label}`}
                type="button"
                variant={action.type === "app_action" ? "default" : "ghost"}
                size="sm"
                onClick={() => handleHeaderAction(action)}
                disabled={action.type === "edit_document" && (!editable || isEditing)}
                className="gap-2"
              >
                <HeaderActionIcon action={action} />
                {action.label}
              </Button>
            ))}
            {shouldShowEditor ? (
              <Button type="button" size="sm" onClick={() => void saveDocument()} disabled={!isDirty || documentStatus === "saving"} className="gap-2">
                {documentStatus === "saving" ? <LoaderCircle size={15} className="animate-spin" /> : <FileText size={15} />}
                Save
              </Button>
            ) : null}
          </div>
        </div>

        {!isDocumentChrome && !resource ? (
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
                  <Button type="button" variant="ghost" size="sm" onClick={() => void loadDocument()} disabled={documentStatus === "loading" || documentStatus === "saving"} className="gap-2">
                    <RefreshCw size={15} />
                    Refresh
                  </Button>
                  {editable ? (
                    <Button type="button" size="sm" onClick={() => void saveDocument()} disabled={!isDirty || documentStatus === "saving"} className="gap-2">
                      {documentStatus === "saving" ? <LoaderCircle size={15} className="animate-spin" /> : <FileText size={15} />}
                      Save {title}
                    </Button>
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
                onChange={(event) => setDraftContent(event.target.value)}
                className="mt-4 min-h-72 w-full resize-y rounded-md border border-bd-border bg-bd-bg-primary px-3 py-3 font-mono text-sm leading-6 text-bd-text-primary outline-none focus-visible:ring-2 focus-visible:ring-bd-amber"
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

        {resource ? (
          <section className="mt-6 border-t border-bd-border pt-5" aria-labelledby="app-workspace-resource-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 id="app-workspace-resource-title" className="font-heading text-base text-bd-text-heading">Package resource</h3>
                <p className="mt-1 text-sm text-bd-text-secondary">
                  {resource.owner_editable ? "Editable package resource declaration" : "Read-only package resource"} · {resource.media_type} · digest {descriptorDigestLabel(resource.content_digest)}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => void loadResource()} disabled={resourceStatus === "loading"} className="gap-2">
                {resourceStatus === "loading" ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                Refresh
              </Button>
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
                mediaType={resourceResult?.media_type ?? resource.media_type}
                content={resourceResult?.content ?? ""}
              />
            )}
          </section>
        ) : null}

        {item.kind === "document" && !resource && !isDocumentChrome && exposedActions.length > 0 ? (
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

        {!resource && !bindingId ? (
          <div className="mt-6 rounded-md border border-bd-border bg-bd-bg-secondary px-4 py-3 text-sm text-bd-text-secondary" role="status">
            This workspace document is declared. App-owned content will appear when a later document binding supplies it.
          </div>
        ) : null}
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
  if (action.type === "back_to_chat") return <ChevronLeft size={15} aria-hidden="true" />;
  if (action.type === "edit_document") return <Pencil size={15} aria-hidden="true" />;
  if (action.action_id.toLowerCase().includes("export")) return <Download size={15} aria-hidden="true" />;
  return <Send size={15} aria-hidden="true" />;
}

function MarkdownDocumentView({ markdown }: { markdown: string }) {
  return (
    <article className="mt-6 max-w-[820px] text-bd-text-primary">
      {renderMarkdownLines(markdown || "No saved content yet", "markdown")}
    </article>
  );
}

function PaperDocumentPreview({ markdown }: { markdown: string }) {
  return (
    <article className="mx-auto mt-6 min-h-[900px] w-full max-w-[820px] bg-white px-10 py-12 text-[#17202a] shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:px-14 md:px-16">
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
        if (depth === 1) return <h1 key={key} className="mb-2 text-center font-serif text-3xl font-bold tracking-normal text-[#101820]">{text}</h1>;
        return <h2 key={key} className="mb-2 mt-6 border-b border-[#c8ced6] pb-1 text-sm font-bold uppercase tracking-normal text-[#101820]">{text}</h2>;
      }
      if (depth === 1) return <h1 key={key} className="mb-4 font-heading text-3xl text-bd-text-heading">{text}</h1>;
      return <h2 key={key} className="mb-3 mt-7 font-heading text-xl text-bd-text-heading">{text}</h2>;
    }
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (bullet) {
      return (
        <div key={key} className={cn("flex gap-3", variant === "paper" ? "mb-1.5 text-[13px] leading-6 text-[#17202a]" : "mb-2 text-base leading-7 text-bd-text-primary")}>
          <span aria-hidden="true" className={variant === "paper" ? "mt-0.5 text-[#596273]" : "text-bd-text-muted"}>•</span>
          <p className="min-w-0 flex-1">{bullet[1]}</p>
        </div>
      );
    }
    return (
      <p key={key} className={variant === "paper" ? "mb-2 text-[13px] leading-6 text-[#17202a]" : "mb-4 text-base leading-7 text-bd-text-primary"}>
        {line}
      </p>
    );
  });
}

function draftFromRecord(record: AppDocumentRecord | null): string {
  if (!record) return "";
  return typeof record.content === "string" ? record.content : JSON.stringify(record.content, null, 2);
}

function contentFromDraft(draft: string, mediaType: AppDocumentRecord["media_type"]): unknown {
  return mediaType === "application/json" ? JSON.parse(draft || "null") : draft;
}

export type { AppChatWorkspaceProps };
