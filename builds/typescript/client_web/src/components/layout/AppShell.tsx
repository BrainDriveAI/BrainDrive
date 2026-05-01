import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CheckCircle2, Menu, X } from "lucide-react";
import { createPortal } from "react-dom";

import { getMemoryUpdateReport, getMemoryUpdateStatus, getOnboardingStatus } from "@/api/gateway-adapter";
import ChatPanel from "@/components/chat/ChatPanel";
import DocumentView from "@/components/document/DocumentView";
import SettingsModal from "@/components/settings/SettingsModal";
import { useProjects } from "@/hooks/useProjects";
import type { ProjectFile } from "@/types/ui";

import Sidebar from "./Sidebar";

type AppShellProps = {
  children?: ReactNode;
  deploymentMode?: "local" | "managed";
  installMode?: "dev" | "local" | "prod" | "unknown";
  installLocation?: "local" | "managed" | "unknown";
  appVersion?: string;
  onLogout?: () => void;
};

export default function AppShell({
  children,
  deploymentMode = "local",
  installMode = "unknown",
  installLocation = "unknown",
  appVersion = "unknown",
  onLogout,
}: AppShellProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeFile, setActiveFile] = useState<ProjectFile | null>(null);
  const [memoryUpdateNotice, setMemoryUpdateNotice] = useState<{
    migrationId: string;
    report: string;
    hasDeferred: boolean;
  } | null>(null);
  const [isMemoryUpdateReportOpen, setIsMemoryUpdateReportOpen] = useState(false);
  const [mobileHeaderHeight, setMobileHeaderHeight] = useState(0);
  const stableAppHeightRef = useRef(0);
  const mobileHeaderRef = useRef<HTMLDivElement | null>(null);
  const {
    projects,
    selectedProjectId,
    selectedProject,
    projectFiles,
    isLoadingProjects,
    isLoadingFiles,
    activeConversationId,
    selectProject,
    deselectProject,
    refreshProjects,
    addProject,
    removeProject,
    renameProject
  } = useProjects();

  const messageMetadata =
    selectedProjectId !== null ? { client: "web", project: selectedProjectId } : { client: "web" };

  // Send heartbeat to gateway every 5 minutes in managed mode so the idle
  // monitor knows the user is still active and won't stop the container.
  useEffect(() => {
    if (deploymentMode !== "managed") return;

    const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 minutes

    function sendHeartbeat() {
      fetch("/api/gateway/containers/heartbeat", { method: "POST" }).catch(() => {});
    }

    // Send immediately on mount, then every 5 minutes
    sendHeartbeat();
    const id = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
    return () => clearInterval(id);
  }, [deploymentMode]);

  // Auto-open settings if BrainDrive Models is active but has no API key
  useEffect(() => {
    if (deploymentMode !== "local") return;
    let cancelled = false;
    void getOnboardingStatus().then((status) => {
      if (cancelled) return;
      const activeId = status.active_provider_profile ?? status.default_provider_profile;
      const activeProvider = status.providers.find((p) => p.profile_id === activeId);
      const needsSetup = Boolean(
        status.onboarding_required ||
        (activeProvider &&
          activeProvider.provider_id.toLowerCase() !== "ollama" &&
          activeProvider.credential_mode === "unset")
      );
      if (needsSetup) {
        setIsSettingsOpen(true);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [deploymentMode]);

  useEffect(() => {
    setActiveFile(null);
  }, [selectedProjectId]);

  useEffect(() => {
    let cancelled = false;
    void getMemoryUpdateStatus()
      .then(async (status) => {
        if (!status.report_path || cancelled) {
          return;
        }
        const storageKey = `braindrive.memoryUpdateReportSeen.${status.migration_id}`;
        if (window.localStorage.getItem(storageKey) === "1") {
          return;
        }
        const report = await getMemoryUpdateReport(status.migration_id);
        if (cancelled) {
          return;
        }
        setMemoryUpdateNotice({
          migrationId: status.migration_id,
          report,
          hasDeferred: status.deferred_paths.length > 0,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mobileHeaderRef.current) {
      return;
    }

    const element = mobileHeaderRef.current;

    function reportHeight() {
      setMobileHeaderHeight(Math.ceil(element.getBoundingClientRect().height));
    }

    reportHeight();

    const observer = new ResizeObserver(reportHeight);
    observer.observe(element);

    return () => {
      observer.disconnect();
      setMobileHeaderHeight(0);
    };
  }, []);

  useEffect(() => {
    function hasFocusedTextInput() {
      const activeElement = document.activeElement;

      if (!(activeElement instanceof HTMLElement)) {
        return false;
      }

      return (
        activeElement instanceof HTMLTextAreaElement ||
        (activeElement instanceof HTMLInputElement &&
          !["checkbox", "radio", "file", "button", "submit"].includes(activeElement.type))
      );
    }

    function syncAppHeight() {
      const layoutHeight = window.innerHeight;
      const viewport = window.visualViewport;
      const visibleHeight = viewport
        ? Math.max(0, viewport.height + viewport.offsetTop)
        : layoutHeight;
      const keyboardInset = Math.max(0, layoutHeight - visibleHeight);
      const keyboardOpen = hasFocusedTextInput() && keyboardInset > 120;

      if (!keyboardOpen) {
        stableAppHeightRef.current = layoutHeight;
      }

      const nextAppHeight = stableAppHeightRef.current || layoutHeight;

      document.documentElement.style.setProperty("--app-height", `${nextAppHeight}px`);
      document.documentElement.style.setProperty(
        "--keyboard-inset",
        `${keyboardOpen ? keyboardInset : 0}px`
      );
    }

    syncAppHeight();
    window.addEventListener("resize", syncAppHeight);
    window.visualViewport?.addEventListener("resize", syncAppHeight);
    window.visualViewport?.addEventListener("scroll", syncAppHeight);
    window.addEventListener("focusin", syncAppHeight);
    window.addEventListener("focusout", syncAppHeight);

    return () => {
      window.removeEventListener("resize", syncAppHeight);
      window.visualViewport?.removeEventListener("resize", syncAppHeight);
      window.visualViewport?.removeEventListener("scroll", syncAppHeight);
      window.removeEventListener("focusin", syncAppHeight);
      window.removeEventListener("focusout", syncAppHeight);
    };
  }, []);

  function handleFileClick(file: ProjectFile) {
    setActiveFile(file);
  }

  function handleReturnToChat() {
    setActiveFile(null);
  }

  function dismissMemoryUpdateNotice() {
    if (memoryUpdateNotice) {
      window.localStorage.setItem(`braindrive.memoryUpdateReportSeen.${memoryUpdateNotice.migrationId}`, "1");
    }
    setMemoryUpdateNotice(null);
    setIsMemoryUpdateReportOpen(false);
  }

  const documentContent = activeFile && selectedProject ? (
    <DocumentView
      projectId={selectedProject.id}
      projectName={selectedProject.name}
      file={activeFile}
      onBack={handleReturnToChat}
    />
  ) : undefined;

  const appShellVars = {
    "--mobile-header-height": `${mobileHeaderHeight}px`
  } as CSSProperties;

  const mobileHeader = typeof document === "undefined"
    ? null
    : createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-0 z-30 md:hidden">
          <div
            ref={mobileHeaderRef}
            className="pointer-events-auto flex items-center gap-3 border-b border-bd-border bg-bd-bg-primary/95 px-4 py-3 backdrop-blur-sm"
            style={{
              paddingTop: "max(0.75rem, var(--safe-area-top))",
              paddingLeft: "max(1rem, var(--safe-area-left))",
              paddingRight: "max(1rem, var(--safe-area-right))"
            }}
          >
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={() => {
                setIsMobileSidebarOpen(true);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-md text-bd-text-secondary transition-all duration-200 hover:bg-bd-bg-hover"
            >
              <Menu size={18} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label="Go to BrainDrive home"
              onClick={() => selectProject("braindrive-plus-one")}
              className="cursor-pointer bg-transparent p-0"
            >
              <img src="/braindrive-logo.svg" alt="BrainDrive" className="h-5 w-auto" />
            </button>
          </div>
        </div>,
        document.body
      );

  return (
    <div
      className="flex overflow-hidden bg-bd-bg-chat text-bd-text-primary"
      style={{ height: "var(--app-height)", maxHeight: "var(--app-height)" }}
    >
      <div className="hidden md:flex md:shrink-0">
        <Sidebar
          isCollapsed={isCollapsed}
          onToggle={() => {
            setIsCollapsed((current) => !current);
          }}
          projects={projects}
          selectedProjectId={selectedProjectId}
          selectedProject={selectedProject}
          projectFiles={projectFiles}
          isLoadingProjects={isLoadingProjects}
          isLoadingFiles={isLoadingFiles}
          onSelectProject={selectProject}
          onDeselectProject={deselectProject}
          onReturnToChat={handleReturnToChat}
          onFileClick={handleFileClick}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onLogout={() => onLogout?.()}
          tier={deploymentMode === "managed" ? "hosted" : "local"}
          onAddProject={addProject}
          onRemoveProject={removeProject}
          onRenameProject={renameProject}
        />
      </div>

      {isMobileSidebarOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close sidebar backdrop"
            onClick={() => {
              setIsMobileSidebarOpen(false);
            }}
            className="absolute inset-0 bg-black/50"
          />
          <div className="absolute left-0 top-0 h-full w-[300px] transform transition-transform duration-300">
            <Sidebar
              isCollapsed={false}
              onToggle={() => {}}
              projects={projects}
              selectedProjectId={selectedProjectId}
              selectedProject={selectedProject}
              projectFiles={projectFiles}
              isLoadingProjects={isLoadingProjects}
              isLoadingFiles={isLoadingFiles}
              onSelectProject={selectProject}
              onDeselectProject={deselectProject}
              onReturnToChat={handleReturnToChat}
              onFileClick={handleFileClick}
              onOpenSettings={() => {
                setIsMobileSidebarOpen(false);
                setIsSettingsOpen(true);
              }}
              onLogout={() => onLogout?.()}
              tier={deploymentMode === "managed" ? "hosted" : "local"}
              onAddProject={addProject}
              onRemoveProject={removeProject}
              onClose={() => {
                setIsMobileSidebarOpen(false);
              }}
            />
          </div>
        </div>
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bd-bg-primary" style={appShellVars}>
        {memoryUpdateNotice ? (
          <div className="border-b border-bd-border bg-bd-bg-secondary px-4 py-3 md:px-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" strokeWidth={1.8} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-bd-text-primary">BrainDrive is up to date.</p>
                <p className="mt-0.5 text-xs leading-5 text-bd-text-secondary">
                  {memoryUpdateNotice.hasDeferred
                    ? "Safe memory updates were applied. One item was left unchanged because it has custom content."
                    : "Memory instructions were updated so the latest features work correctly."}
                </p>
                <button
                  type="button"
                  onClick={() => setIsMemoryUpdateReportOpen((current) => !current)}
                  className="mt-2 text-xs font-medium text-bd-amber hover:text-bd-amber-hover"
                >
                  {isMemoryUpdateReportOpen ? "Hide details" : "View details"}
                </button>
                {isMemoryUpdateReportOpen ? (
                  <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-bd-border bg-bd-bg-primary p-3 text-xs leading-5 text-bd-text-secondary">
                    {memoryUpdateNotice.report}
                  </pre>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss memory update notice"
                onClick={dismissMemoryUpdateNotice}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-bd-text-muted hover:bg-bd-bg-hover hover:text-bd-text-primary"
              >
                <X size={15} strokeWidth={1.7} />
              </button>
            </div>
          </div>
        ) : null}
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden pt-[var(--mobile-header-height)] md:pt-0"
        >
          {children ?? (
            <ChatPanel
              activeConversationId={activeConversationId}
              activeProjectId={selectedProjectId}
              draftKey={selectedProjectId}
              isEmpty={activeConversationId === null}
              onConversationComplete={() => {
                refreshProjects();
              }}
              messageMetadata={messageMetadata}
              contentOverride={documentContent}
              onSendMessage={handleReturnToChat}
              onOpenSettings={() => setIsSettingsOpen(true)}
            />
          )}
        </div>
      </main>

      {isSettingsOpen && (
        <SettingsModal
          mode={deploymentMode}
          installMode={installMode}
          installLocation={installLocation}
          appVersion={appVersion}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
      {mobileHeader}
    </div>
  );
}
