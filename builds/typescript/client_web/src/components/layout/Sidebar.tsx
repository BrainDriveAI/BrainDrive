import { AppWindow, Bot, FolderOpen, MoreHorizontal, Pencil, Plus, Settings2, Sparkles, Trash2, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getSession } from "@/api/auth-adapter";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ROOT_AGENT_PROJECT_ID, isRootAgentProjectId } from "@/lib/rootAgent";
import type { Project, ProjectFile, UserProfile } from "@/types/ui";

import ProfileMenu from "./ProfileMenu";
import type { ProjectView } from "./ProjectContentView";
import { rootProjectDisplayLabel } from "./sidebar-labels";
import { getProjectIcon } from "./project-icons";
import SidebarCollapsed from "./SidebarCollapsed";
import SidebarToggle from "./SidebarToggle";
import SidebarHome from "./SidebarHome";

const DEFAULT_USER: UserProfile = {
  name: "Local Owner",
  initials: "LO",
  email: "owner@local.braindrive"
};

type SidebarProps = {
  isCollapsed: boolean;
  onToggle: () => void;
  projects: Project[];
  selectedProjectId: string | null;
  selectedProject: Project | null;
  projectFiles: ProjectFile[];
  activeFilePath?: string | null;
  activeView?: ProjectView | null;
  onOpenProjectView: (view: ProjectView) => void;
  isLoadingProjects: boolean;
  isLoadingFiles: boolean;
  onSelectProject: (projectId: string) => void;
  onDeselectProject: () => void;
  onReturnToChat: () => void;
  onFileClick: (file: ProjectFile) => void;
  onOpenSettings: () => void;
  onOpenApps: () => void;
  isAppsActive: boolean;
  onLogout: () => void;
  onAddProject?: (name: string) => Promise<void>;
  onRemoveProject?: (id: string) => Promise<void>;
  onRenameProject?: (id: string, name: string) => Promise<void>;
  tier?: "local" | "concierge";
  onClose?: () => void;
};

export default function Sidebar({
  isCollapsed,
  onToggle,
  projects,
  selectedProjectId,
  selectedProject,
  activeFilePath,
  activeView,
  onOpenProjectView,
  isLoadingProjects,
  onSelectProject,
  onDeselectProject,
  onReturnToChat,
  onOpenSettings,
  onOpenApps,
  isAppsActive,
  onLogout,
  onAddProject,
  onRemoveProject,
  onRenameProject,
  tier = "local",
  onClose
}: SidebarProps) {
  const [user, setUser] = useState<UserProfile>(DEFAULT_USER);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [menuOpenForProject, setMenuOpenForProject] = useState<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const newProjectInputRef = useRef<HTMLInputElement | null>(null);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const profileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const previousCollapsed = useRef(isCollapsed);

  useEffect(() => {
    if (previousCollapsed.current !== isCollapsed) {
      toggleRef.current?.focus();
      previousCollapsed.current = isCollapsed;
    }
  }, [isCollapsed]);

  useEffect(() => {
    let cancelled = false;

    void getSession()
      .then((session) => {
        if (cancelled) {
          return;
        }

        const nextUser = {
          name: session.user.name,
          initials: session.user.initials,
          email: session.user.email
        };

        if (
          nextUser.name !== DEFAULT_USER.name ||
          nextUser.initials !== DEFAULT_USER.initials ||
          nextUser.email !== DEFAULT_USER.email
        ) {
          setUser(nextUser);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(DEFAULT_USER);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isProfileMenuOpen && event.key === "Escape") {
        event.preventDefault();
        setIsProfileMenuOpen(false);
        profileTriggerRef.current?.focus();
      }
    }

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
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProfileMenuOpen]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement;

      if (
        menuOpenForProject &&
        projectMenuRef.current &&
        !projectMenuRef.current.contains(target)
      ) {
        setMenuOpenForProject(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [menuOpenForProject]);

  const isRootAgentSelected = !isAppsActive && isRootAgentProjectId(selectedProjectId);
  const isProjectView = !isAppsActive && selectedProject !== null && !isRootAgentSelected;
  const currentView = activeView ?? (activeFilePath ? "files" : null);
  const isConversationActive = currentView === null;

  const instanceLabel = tier === "concierge" ? "BrainDrive Concierge" : "BrainDrive Local";
  const accountAvatar = (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bd-amber text-xs font-bold text-bd-bg-primary">
      {user.initials}
    </span>
  );
  const sidebarToggle = (
    <SidebarToggle
      isCollapsed={isCollapsed}
      onToggle={() => {
        setIsProfileMenuOpen(false);
        onToggle();
      }}
      buttonRef={toggleRef}
    />
  );
  const sidebarToggleControl = (
    <div className={isCollapsed ? "absolute right-[1.5px] top-0 z-10" : "absolute right-4 top-4 z-10 hidden md:block"}>
      {sidebarToggle}
    </div>
  );
  const accountFooter = (
    <div ref={profileMenuRef} className={isCollapsed ? "relative h-[120px] w-[47px] shrink-0" : "relative h-[76px]"}>
      {isProfileMenuOpen ? (
        <ProfileMenu
          side={isCollapsed ? "right" : "top"}
          onClose={() => {
            setIsProfileMenuOpen(false);
          }}
          onOpenSettings={() => {
            setIsProfileMenuOpen(false);
            onOpenSettings();
          }}
          onLogout={onLogout}
        />
      ) : null}
      {isCollapsed ? sidebarToggleControl : null}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={profileTriggerRef}
              type="button"
              aria-label="Open profile menu"
              aria-expanded={isProfileMenuOpen}
              onClick={() => { setIsProfileMenuOpen((current) => !current); }}
              className={`flex h-full w-full text-left text-bd-text-secondary transition-colors hover:bg-bd-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bd-amber ${isCollapsed ? "items-end justify-center pb-4" : "items-center gap-2 pl-5 pr-4"}`}
            >
              {isCollapsed ? (
                <span className="flex h-11 w-11 items-center justify-center">
                  {accountAvatar}<span className="sr-only">{user.name} · {instanceLabel}</span>
                </span>
              ) : (
                <>
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    {accountAvatar}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-bd-text-primary">{user.name}</span>
                      <span className="block truncate text-[11px] text-bd-text-muted">{instanceLabel}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="flex h-11 w-11 items-center justify-center"><MoreHorizontal size={18} strokeWidth={1.5} aria-hidden="true" /></span>
                    <span className="hidden h-11 w-11 md:block" aria-hidden="true" />
                  </span>
                </>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side={isCollapsed ? "right" : "top"} sideOffset={8}>
            {isCollapsed ? `Open profile menu · ${user.name} · ${instanceLabel}` : "Open profile menu"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {!isCollapsed ? sidebarToggleControl : null}
    </div>
  );

  if (isCollapsed) {
    return (
      <SidebarCollapsed
        onToggle={onToggle}
        projects={projects}
        selectedProjectId={selectedProjectId}
        isProjectView={isProjectView}
        activeView={currentView}
        onDeselectProject={onDeselectProject}
        onReturnToChat={onReturnToChat}
        onOpenProjectView={onOpenProjectView}
        onSelectProject={(projectId) => {
          onSelectProject(projectId);
        }}
        accountFooter={accountFooter}
        onOpenApps={onOpenApps}
        isAppsActive={isAppsActive}
      />
    );
  }

  return (
    <aside className="flex h-dvh w-[300px] flex-col border-r border-bd-border bg-bd-bg-secondary transition-all duration-200 md:w-sidebar">
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <button
          type="button"
          aria-label="Go to BrainDrive home"
          onClick={() => { onSelectProject(ROOT_AGENT_PROJECT_ID); onClose?.(); }}
          className="cursor-pointer bg-transparent p-0 hover:opacity-80"
        >
          <img src="/braindrive-logo.svg" alt="BrainDrive" className="h-7 w-auto" />
        </button>
        <div className="flex items-center gap-2">
          {isProjectView ? <SidebarHome onGoHome={() => { onDeselectProject(); onClose?.(); }} /> : null}
          {onClose ? (
            <button
              type="button"
              aria-label="Close sidebar"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-md text-bd-text-secondary transition-all duration-200 hover:bg-bd-bg-hover md:hidden"
            >
              <X size={18} strokeWidth={1.5} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {!isProjectView ? <div className="px-4 pb-2 pt-1">
          <button
            type="button"
            aria-current={isAppsActive ? "page" : undefined}
            onClick={() => { onOpenApps(); onClose?.(); }}
            className={[
              "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] transition-all duration-200 hover:bg-bd-bg-hover",
              isAppsActive ? "border-l-2 border-bd-amber bg-bd-bg-tertiary pl-[10px] text-bd-text-primary" : "text-bd-text-secondary",
            ].join(" ")}
          >
            <AppWindow size={17} strokeWidth={1.5} aria-hidden="true" />
            <span>Apps</span>
          </button>
        </div> : null}
          {isProjectView ? (
            <nav aria-label="Page navigation" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
              <div className="shrink-0 space-y-1">
              <button
                type="button"
                aria-current={isConversationActive ? "page" : undefined}
                onClick={() => { onReturnToChat(); onClose?.(); }}
                className={[
                  "flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] transition-all duration-200 hover:bg-bd-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber",
                  "border-l-2 border-bd-amber pl-[10px] text-bd-amber",
                  isConversationActive ? "bg-bd-bg-tertiary" : "",
                ].join(" ")}
              >
                <Sparkles size={17} strokeWidth={1.7} aria-hidden="true" className="shrink-0 text-bd-amber" />
                <span className="truncate text-bd-text-heading">Conversation</span>
              </button>
              <button
                type="button"
                aria-current={currentView === "files" ? "page" : undefined}
                onClick={() => { onOpenProjectView("files"); onClose?.(); }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[14px] text-bd-text-primary transition-colors hover:bg-bd-bg-hover aria-[current=page]:bg-bd-bg-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber"
              >
                <FolderOpen size={17} strokeWidth={1.5} aria-hidden="true" />
                <span className="text-bd-text-nav">Your Files</span>
              </button>
              {([
                ["tools", "Tools", Wrench], ["expert", "Behavior", Settings2],
              ] as const).map(([view, label, Icon]) => (
                <button
                  key={view}
                  type="button"
                  aria-current={currentView === view ? "page" : undefined}
                  onClick={() => { onOpenProjectView(view); onClose?.(); }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[14px] text-bd-text-primary transition-colors hover:bg-bd-bg-hover aria-[current=page]:bg-bd-bg-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber"
                >
                  <Icon size={17} strokeWidth={1.5} aria-hidden="true" />
                  <span className="text-bd-text-nav">{label}</span>
                </button>
              ))}
              </div>
            </nav>
          ) : (
        <ScrollArea className="min-h-0 flex-1 px-2 pb-4">
          {isLoadingProjects ? (
            <div className="flex min-h-full items-center justify-center px-6 text-center text-sm text-bd-text-muted">
              Loading projects...
            </div>
          ) : (
            <div className="space-y-1 px-2">
              <div
                className={[
                  "group relative flex w-full items-center gap-3 rounded-xl py-2 pl-4 pr-3 text-left transition-all duration-200 hover:bg-bd-bg-hover",
                  isRootAgentSelected &&
                    "border-l-2 border-bd-amber bg-bd-bg-tertiary pl-[14px]"
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectProject(ROOT_AGENT_PROJECT_ID);
                    onClose?.();
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <Bot size={17} strokeWidth={1.5} className="shrink-0 text-bd-text-secondary" />
                  <span className="truncate text-[14px] text-bd-text-primary">Your Agent</span>
                </button>
              </div>

              {projects.filter((project) => !isRootAgentProjectId(project.id)).map((project) => {
                const Icon = getProjectIcon(project.icon);
                  const isActive = !isAppsActive && project.id === selectedProjectId;
                const isMenuOpen = menuOpenForProject === project.id;
                const isRenaming = renamingProjectId === project.id;

                if (isRenaming) {
                  return (
                    <div
                      key={project.id}
                      className="flex items-center gap-3 rounded-xl py-2 pl-4 pr-3"
                    >
                      <Icon size={17} strokeWidth={1.5} className="shrink-0 text-bd-text-secondary" />
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && renameValue.trim()) {
                            void onRenameProject?.(project.id, renameValue.trim()).then(() => {
                              setRenamingProjectId(null);
                              setRenameValue("");
                            });
                          }

                          if (e.key === "Escape") {
                            setRenamingProjectId(null);
                            setRenameValue("");
                          }
                        }}
                        onBlur={() => {
                          setRenamingProjectId(null);
                          setRenameValue("");
                        }}
                        className="min-w-0 flex-1 border-none bg-transparent text-[14px] text-bd-text-primary placeholder:text-bd-text-muted outline-none"
                        autoFocus
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={project.id}
                    className={[
                      "group relative flex w-full items-center gap-3 rounded-xl py-2 pl-4 pr-3 text-left transition-all duration-200 hover:bg-bd-bg-hover",
                      isActive &&
                        "border-l-2 border-bd-amber bg-bd-bg-tertiary pl-[14px]"
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectProject(project.id);
                        onClose?.();
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <Icon size={17} strokeWidth={1.5} className="shrink-0 text-bd-text-secondary" />
                      <span className="truncate text-[14px] text-bd-text-primary">
                        {rootProjectDisplayLabel(project.id, project.name)}
                      </span>
                    </button>
                    {(onRemoveProject || onRenameProject) ? (
                      <div ref={isMenuOpen ? projectMenuRef : undefined} className="relative">
                        <button
                          type="button"
                          aria-label={`Options for ${project.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenForProject(isMenuOpen ? null : project.id);
                          }}
                          className="hidden shrink-0 rounded p-0.5 text-bd-text-muted transition-colors duration-200 hover:text-bd-text-primary group-hover:inline-flex"
                        >
                          <MoreHorizontal size={16} strokeWidth={1.5} />
                        </button>
                        {isMenuOpen ? (
                          <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-bd-border bg-bd-bg-secondary py-1 shadow-lg">
                            {onRenameProject ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuOpenForProject(null);
                                  setRenamingProjectId(project.id);
                                  setRenameValue(project.name);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-bd-text-primary transition-colors duration-150 hover:bg-bd-bg-hover"
                              >
                                <Pencil size={14} strokeWidth={1.5} />
                                Rename
                              </button>
                            ) : null}
                            {onRemoveProject ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuOpenForProject(null);
                                  void onRemoveProject(project.id);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-red-400 transition-colors duration-150 hover:bg-bd-bg-hover"
                              >
                                <Trash2 size={14} strokeWidth={1.5} />
                                Remove
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {isAddingProject ? (
                <div className="flex items-center gap-2 rounded-xl py-2 pl-4 pr-3">
                  <Plus size={17} strokeWidth={1.5} className="shrink-0 text-bd-text-secondary" />
                  <input
                    ref={newProjectInputRef}
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newProjectName.trim()) {
                        void onAddProject?.(newProjectName.trim()).then(() => {
                          setNewProjectName("");
                          setIsAddingProject(false);
                        });
                      }

                      if (e.key === "Escape") {
                        setNewProjectName("");
                        setIsAddingProject(false);
                      }
                    }}
                    onBlur={() => {
                      setNewProjectName("");
                      setIsAddingProject(false);
                    }}
                    placeholder="Project name..."
                    className="min-w-0 flex-1 border-none bg-transparent text-[14px] text-bd-text-primary placeholder:text-bd-text-muted outline-none"
                    autoFocus
                  />
                </div>
              ) : onAddProject ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingProject(true);
                  }}
                    className="flex w-full items-center gap-3 rounded-xl py-2 pl-4 pr-3 text-left text-bd-text-muted transition-all duration-200 hover:bg-bd-bg-hover hover:text-bd-text-secondary"
                  >
                  <Plus size={17} strokeWidth={1.5} className="shrink-0" />
                  <span className="text-[14px]">Create project</span>
                </button>
              ) : null}
            </div>
          )}
        </ScrollArea>
          )}
      </div>

      <div className="mt-auto">
        {accountFooter}
      </div>
    </aside>
  );
}
