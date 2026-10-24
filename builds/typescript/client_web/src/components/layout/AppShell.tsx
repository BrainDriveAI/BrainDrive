import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { createPortal } from "react-dom";

import { getOnboardingStatus } from "@/api/gateway-adapter";
import ChatPanel from "@/components/chat/ChatPanel";
import DocumentView from "@/components/document/DocumentView";
import SettingsModal from "@/components/settings/SettingsModal";
import { useProjects } from "@/hooks/useProjects";
import { ROOT_AGENT_PROJECT_ID, isRootAgentProjectId } from "@/lib/rootAgent";
import type { ProjectFile } from "@/types/ui";

import Sidebar from "./Sidebar";
import DeletePage from "./DeletePage";
import PageHostMessages from "./PageHostMessages";
import { expertPreviewEnabled, isRetiredPage, mockAddPage, noteFirstMessage, offerStart, startInstallStep, submitPluginFile, usePageSetup } from "@/api/experts";
import ProjectContentView, { PROJECT_VIEW_LABELS, type ProjectView } from "./ProjectContentView";

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
  const [deletingPage, setDeletingPage] = useState<{ id: string; name: string } | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeView, setActiveView] = useState<ProjectView | null>(null);
  const [activeFile, setActiveFile] = useState<ProjectFile | null>(null);
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
    filesError,
    activeConversationId,
    selectProject,
    deselectProject,
    refreshProjects,
    refreshSelectedProjectFiles,
    addProject,
    removeProject,
    renameProject
  } = useProjects();

  const visibleProjects = expertPreviewEnabled ? projects.filter((project) => !isRetiredPage(project)) : projects;
  const pageSetup = usePageSetup(expertPreviewEnabled && selectedProject && !isRootAgentProjectId(selectedProject.id) ? selectedProject : null);

  async function handleAddPage() {
    setIsMobileSidebarOpen(false);
    try {
      const page = await mockAddPage();
      refreshProjects();
      selectProject(page.id);
    } catch {
      // The page was not created; the sidebar is unchanged.
    }
  }

  function handleAddPlugin() {
    if (!selectedProject) return;
    startInstallStep(selectedProject.id, "plugin");
    handleReturnToChat();
  }

  function handleStartExpert() {
    if (!selectedProject) return;
    offerStart(selectedProject.id);
    handleReturnToChat();
  }

  function handleSendMessage() {
    handleReturnToChat();
    if (expertPreviewEnabled && selectedProject && !isRootAgentProjectId(selectedProject.id)) {
      noteFirstMessage(selectedProject.id, selectedProject.name);
    }
  }

  const messageMetadata =
    selectedProjectId !== null
      ? {
          client: "web",
          project: selectedProjectId,
        }
      : { client: "web" };
  const chatDraftKey = selectedProjectId ?? null;

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
    setActiveView(null);
  }, [selectedProjectId]);

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
    setActiveView((current) => current ?? "files");
  }

  function handleReturnToChat() {
    setActiveFile(null);
    setActiveView(null);
  }

  function handleOpenProjectView(view: ProjectView) {
    setActiveFile(null);
    setActiveView(view);
  }

  function handleConversationComplete() {
    refreshProjects();

    if (!selectedProjectId || isRootAgentProjectId(selectedProjectId)) {
      return;
    }

    void (async () => {
      try {
        const nextFiles = await refreshSelectedProjectFiles();
        setActiveFile((current) => {
          if (!current) {
            return current;
          }

          return nextFiles.find((file) => file.path === current.path) ?? null;
        });
      } catch {
        // Keep the chat result visible if a background file refresh fails.
      }
    })();
  }

  const displayedFile = activeFile;
  const isCollectionFile = activeFile && (activeView === "files" || activeView === "plugins");
  const documentContent = displayedFile && selectedProject ? (
    <DocumentView
      key={`${selectedProject.id}:${displayedFile.path}`}
      projectId={selectedProject.id}
      projectName={selectedProject.name}
      showProjectName={isRootAgentProjectId(selectedProject.id)}
      file={displayedFile}
      onBack={isCollectionFile ? () => setActiveFile(null) : handleReturnToChat}
      backLabel={isCollectionFile ? `Back to ${PROJECT_VIEW_LABELS[activeView!]}` : undefined}
    />
  ) : activeView && selectedProject ? (
    <ProjectContentView
      key={`${selectedProject.id}:${activeView}`}
      view={activeView}
      project={selectedProject}
      files={projectFiles}
      isLoading={isLoadingFiles}
      hasFilesError={Boolean(filesError)}
      onOpenFile={handleFileClick}
      onBack={handleReturnToChat}
      setup={pageSetup}
      onAddPlugin={expertPreviewEnabled ? handleAddPlugin : undefined}
      onStartExpert={expertPreviewEnabled ? handleStartExpert : undefined}
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
              onClick={() => selectProject(ROOT_AGENT_PROJECT_ID)}
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
          projects={visibleProjects}
          selectedProjectId={selectedProjectId}
          selectedProject={selectedProject}
          projectFiles={projectFiles}
          activeFilePath={displayedFile?.path ?? null}
          activeView={activeView}
          onOpenProjectView={handleOpenProjectView}
          isLoadingProjects={isLoadingProjects}
          isLoadingFiles={isLoadingFiles}
          onSelectProject={selectProject}
          onDeselectProject={deselectProject}
          onReturnToChat={handleReturnToChat}
          onFileClick={handleFileClick}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onLogout={() => onLogout?.()}
          tier={deploymentMode === "managed" ? "concierge" : "local"}
          onAddProject={addProject}
          onAddPage={expertPreviewEnabled ? () => { void handleAddPage(); } : undefined}
          onDeletePage={expertPreviewEnabled ? (id) => { const project = projects.find((item) => item.id === id); if (project) setDeletingPage(project); } : undefined}
          onRemoveProject={expertPreviewEnabled ? async (id) => { const project = projects.find((item) => item.id === id); if (project) setDeletingPage(project); } : removeProject}
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
              projects={visibleProjects}
              selectedProjectId={selectedProjectId}
              selectedProject={selectedProject}
              projectFiles={projectFiles}
              activeFilePath={displayedFile?.path ?? null}
              activeView={activeView}
              onOpenProjectView={handleOpenProjectView}
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
              tier={deploymentMode === "managed" ? "concierge" : "local"}
              onAddProject={addProject}
              onAddPage={expertPreviewEnabled ? () => { void handleAddPage(); } : undefined}
              onDeletePage={expertPreviewEnabled ? (id) => { const project = projects.find((item) => item.id === id); if (project) setDeletingPage(project); } : undefined}
              onRemoveProject={expertPreviewEnabled ? async (id) => { const project = projects.find((item) => item.id === id); if (project) setDeletingPage(project); } : removeProject}
              onRenameProject={renameProject}
              onClose={() => {
                setIsMobileSidebarOpen(false);
              }}
            />
          </div>
        </div>
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bd-bg-primary" style={appShellVars}>
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden pt-[var(--mobile-header-height)] md:pt-0"
        >
          {selectedProject && !isRootAgentProjectId(selectedProject.id) ? (
            <div className="shrink-0 px-4 pb-2 pt-3 sm:px-8 md:px-4 md:pb-3 md:pt-5">
              <p aria-label="Expert title" className="font-heading text-sm font-semibold text-bd-text-heading">{selectedProject.name}</p>
            </div>
          ) : null}
          {children ?? (
            <ChatPanel
              activeConversationId={activeConversationId}
              activeProjectId={selectedProjectId}
              draftKey={chatDraftKey}
              isEmpty={activeConversationId === null}
              onConversationComplete={handleConversationComplete}
              messageMetadata={messageMetadata}
              contentOverride={documentContent}
              onSendMessage={handleSendMessage}
              hostEvents={pageSetup && pageSetup.events.length > 0 && selectedProject ? (
                <PageHostMessages
                  project={selectedProject}
                  setup={pageSetup}
                  takenNames={projects.filter((project) => project.id !== selectedProject.id).map((project) => project.name)}
                  renamePage={renameProject}
                />
              ) : undefined}
              fileDrop={expertPreviewEnabled && selectedProject && !isRootAgentProjectId(selectedProject.id) ? {
                installStep: pageSetup?.installStep != null,
                onInstallFile: (file) => { void submitPluginFile(selectedProject.id, file.name); }
              } : undefined}
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
      {expertPreviewEnabled && deletingPage ? <DeletePage project={deletingPage} onClose={() => setDeletingPage(null)} onDeletePage={removeProject} onDeleted={() => { refreshProjects(); void refreshSelectedProjectFiles(); setDeletingPage(null); }} /> : null}
      {mobileHeader}
    </div>
  );
}
