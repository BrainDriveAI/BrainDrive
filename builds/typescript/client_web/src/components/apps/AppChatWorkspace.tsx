import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { AlertCircle, ChevronLeft, FileText, LoaderCircle, RefreshCw, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";

import { getSession } from "@/api/auth-adapter";
import {
  closeAppSession,
  readAppChatWorkspaceSession,
  type AppChatWorkspaceLaunch,
  type AppResourceDescriptor,
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
  onReload?: () => Promise<void>;
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

const RESUME_BUILDER_APP_ID = "ai.braindrive.resume-builder";

const RESUME_BUILDER_EMPTY_STATE = {
  heading: "Let's build your resume",
  description: "Tell me the role you want, paste an existing resume, or describe your experience. I'll help shape it into a focused resume profile and draft.",
  cta: "Start my resume",
  ctaMessage: "I want to build my resume.",
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
  onReload,
  onOpenSettings,
  onLogout,
  tier = "local",
}: AppChatWorkspaceProps) {
  const items = useMemo(() => buildItems(launch), [launch]);
  const [activeItemKey, setActiveItemKey] = useState(() => defaultItemKey(launch, items));
  const [sessionState, setSessionState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);
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

  async function reloadWorkspace() {
    if (!onReload || isReloading) return;
    setIsReloading(true);
    setSessionError(null);
    try {
      await onReload();
    } catch {
      setSessionError("This app workspace could not reconnect. Try again or return to Apps.");
    } finally {
      setIsReloading(false);
    }
  }

  function moveNavigationFocus(event: KeyboardEvent<HTMLButtonElement>, currentKey: string) {
    const keys = items.map(itemKey);
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
      emptyStateIntro={launch.session.app_id === RESUME_BUILDER_APP_ID ? RESUME_BUILDER_EMPTY_STATE : undefined}
      contentOverride={isConversation ? undefined : (
        <WorkspaceDetail
          appName={appName}
          workspaceTitle={launch.workspace.title}
          item={activeItem}
          resource={activeResource}
          actions={launch.workspace.actions}
          headingRef={activeHeadingRef}
        />
      )}
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

        <p className="px-1 text-[13px] uppercase tracking-[0.24em] text-bd-text-muted">{appName}</p>
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
            <WorkspaceNavGroup
              label="Show advanced"
              items={advancedItems}
              activeKey={activeItemKey}
              navButtonRefs={navButtonRefs}
              onSelect={setActiveItemKey}
              onMoveFocus={moveNavigationFocus}
            />
          ) : null}
        </div>

        <div className="mt-auto space-y-2 pt-4">
          {onReload ? (
            <Button type="button" variant="ghost" size="sm" aria-label="Reload app workspace" onClick={() => void reloadWorkspace()} disabled={isReloading} className="w-fit gap-2 px-1 text-bd-text-secondary hover:bg-transparent hover:text-bd-text-heading">
              {isReloading ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Reload
            </Button>
          ) : null}
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
        <div className="hidden items-center justify-between px-2 pb-1 pt-5 text-sm text-bd-text-muted md:flex">
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
              "flex min-w-44 items-center gap-3 rounded-md px-3 py-2.5 text-left text-base transition-colors hover:bg-bd-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber md:min-w-0",
              activeKey === item.key ? "bg-bd-bg-tertiary text-bd-text-heading" : "text-bd-text-secondary",
            )}
          >
            <Icon size={18} aria-hidden="true" />
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
  appName,
  workspaceTitle,
  item,
  resource,
  actions,
  headingRef,
}: {
  appName: string;
  workspaceTitle: string;
  item: WorkspaceItem;
  resource: AppResourceDescriptor | null;
  actions: AppChatWorkspaceLaunch["workspace"]["actions"];
  headingRef: MutableRefObject<HTMLHeadingElement | null>;
}) {
  const title = item.kind === "document" ? item.document.title : item.resource.title;
  const description = item.kind === "document" ? item.document.description : item.resource.description;
  const editable = item.kind === "document" ? item.document.editable : item.resource.owner_editable;
  const bindingId = item.kind === "document" ? item.document.data_binding_id : null;
  const exposedActions = actions.filter((action) => action.model_exposure === "available");

  return (
    <section className="h-full overflow-y-auto px-4 pb-[calc(var(--mobile-composer-height,0px)+1.5rem)] pt-6 sm:px-6 md:pb-6" aria-labelledby="app-workspace-document-title">
      <div className="mx-auto w-full max-w-[780px]">
        <p className="text-[11px] uppercase text-bd-text-muted">{appName} / {workspaceTitle}</p>
        <h2 id="app-workspace-document-title" ref={headingRef} tabIndex={-1} className="mt-1 font-heading text-2xl text-bd-text-heading outline-none focus-visible:ring-2 focus-visible:ring-bd-amber">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-bd-text-secondary">{description}</p>

        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <DescriptorFact label="State" value={editable ? "Owner editable" : "Read only"} />
          <DescriptorFact label="Role" value={item.kind === "document" ? roleLabel(item.document.role) : roleLabel(item.resource.role)} />
          {item.kind === "document" ? <DescriptorFact label="Model access" value={roleLabel(item.document.model_access)} /> : null}
          {bindingId ? <DescriptorFact label="Data binding" value={bindingId} /> : null}
        </dl>

        {resource ? (
          <section className="mt-6 border-t border-bd-border pt-5" aria-labelledby="app-workspace-resource-title">
            <h3 id="app-workspace-resource-title" className="font-heading text-base text-bd-text-heading">Package resource</h3>
            <p className="mt-1 text-sm text-bd-text-secondary">{resource.description}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <DescriptorFact label="Resource" value={resource.title} />
              <DescriptorFact label="Media type" value={resource.media_type} />
              <DescriptorFact label="Prompt inclusion" value={roleLabel(resource.prompt_inclusion)} />
              <DescriptorFact label="Digest" value={descriptorDigestLabel(resource.content_digest)} />
            </dl>
          </section>
        ) : null}

        {exposedActions.length > 0 ? (
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

export type { AppChatWorkspaceProps };
