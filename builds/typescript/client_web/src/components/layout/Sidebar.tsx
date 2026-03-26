import { ChevronLeft, FileText, MoreHorizontal, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getSession } from "@/api/auth-adapter";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { Project, ProjectFile, UserProfile } from "@/types/ui";

import ProfileMenu from "./ProfileMenu";
import { getProjectIcon } from "./project-icons";
import SidebarCollapsed from "./SidebarCollapsed";

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
  isLoadingProjects: boolean;
  isLoadingFiles: boolean;
  onSelectProject: (projectId: string) => void;
  onDeselectProject: () => void;
  onReturnToChat: () => void;
  onFileClick: (file: ProjectFile) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onAddProject?: (name: string) => Promise<void>;
  onRemoveProject?: (id: string) => Promise<void>;
  onRenameProject?: (id: string, name: string) => Promise<void>;
  tier?: "local" | "hosted" | "concierge";
  onClose?: () => void;
};

export default function Sidebar({
  isCollapsed,
  onToggle,
  projects,
  selectedProjectId,
  selectedProject,
  projectFiles,
  isLoadingProjects,
  isLoadingFiles,
  onSelectProject,
  onDeselectProject,
  onReturnToChat,
  onFileClick,
  onOpenSettings,
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

  if (isCollapsed) {
    return (
      <SidebarCollapsed
        onToggle={onToggle}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={(projectId) => {
          onSelectProject(projectId);
        }}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  const isBdPlusOne = selectedProjectId === "braindrive-plus-one";
  const isProjectView = selectedProject !== null && !isBdPlusOne;

  return (
    <aside className="flex h-dvh w-[300px] flex-col border-r border-bd-border bg-bd-bg-secondary transition-all duration-200 md:w-sidebar">
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <button
          type="button"
          aria-label="Go to BrainDrive home"
          onClick={() => onSelectProject("braindrive-plus-one")}
          className="cursor-pointer bg-transparent p-0 hover:opacity-80"
        >
          <img src="/braindrive-logo.svg" alt="BrainDrive" className="h-7 w-auto" />
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Collapse sidebar"
            onClick={onToggle}
            className="hidden text-bd-text-muted transition-colors duration-200 hover:text-bd-text-secondary md:inline-flex"
          >
            <ChevronLeft size={18} strokeWidth={1.5} />
          </button>
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
        {isProjectView ? (
          <div className="flex items-center gap-2 px-4 pb-3 pt-2">
            <button
              type="button"
              aria-label="Back to project list"
              onClick={onDeselectProject}
              className="flex h-7 w-7 items-center justify-center rounded-md text-bd-text-secondary transition-colors duration-200 hover:bg-bd-bg-hover hover:text-bd-text-primary"
            >
              <ChevronLeft size={16} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={() => {
                onReturnToChat();
                onClose?.();
              }}
              className="min-w-0 truncate text-left text-sm text-bd-text-secondary transition-colors duration-200 hover:text-bd-text-primary"
            >
              {selectedProject.name}
            </button>
          </div>
        ) : null}

        <ScrollArea className="min-h-0 flex-1 px-2 pb-4">
          {isProjectView ? (
            <div className="space-y-1 px-2">
              {isLoadingFiles ? (
                <div className="px-3 py-4 text-sm text-bd-text-muted">Loading files...</div>
              ) : projectFiles.length === 0 ? (
                <div className="px-3 py-4 text-sm text-bd-text-muted">No files yet</div>
              ) : (
                projectFiles.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => {
                      onFileClick(file);
                      onClose?.();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] text-bd-text-primary transition-all duration-200 hover:bg-bd-bg-hover"
                  >
                    <FileText size={16} strokeWidth={1.5} className="shrink-0 text-bd-text-muted" />
                    <span className="truncate">{file.name}</span>
                  </button>
                ))
              )}
            </div>
          ) : isLoadingProjects ? (
            <div className="flex min-h-full items-center justify-center px-6 text-center text-sm text-bd-text-muted">
              Loading projects...
            </div>
          ) : (
            <div className="space-y-1 px-2">
              <div
                className={[
                  "group relative flex w-full items-center gap-3 rounded-xl py-2 pl-4 pr-3 text-left transition-all duration-200 hover:bg-bd-bg-hover",
                  isBdPlusOne &&
                    "border-l-2 border-bd-amber bg-bd-bg-tertiary pl-[14px]"
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectProject("braindrive-plus-one");
                    onClose?.();
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <Sparkles size={17} strokeWidth={1.5} className="shrink-0 text-bd-text-secondary" />
                  <span className="truncate text-[14px] text-bd-text-primary">BrainDrive+1</span>
                </button>
              </div>

              {projects.filter((p) => p.id !== "braindrive-plus-one").map((project) => {
                const Icon = getProjectIcon(project.icon);
                const isActive = project.id === selectedProjectId;
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
                      <span className="truncate text-[14px] text-bd-text-primary">{project.name}</span>
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
                  <span className="text-[14px]">Add project</span>
                </button>
              ) : null}
            </div>
          )}
        </ScrollArea>
      </div>

      <div className="mt-auto">
        <Separator className="bg-bd-border" />
        <div ref={profileMenuRef} className="relative px-2 pb-2 pt-2">
          {isProfileMenuOpen ? (
            <ProfileMenu
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
          <button
            type="button"
            aria-label="Open profile menu"
            onClick={() => {
              setIsProfileMenuOpen((current) => !current);
            }}
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
                {tier === "concierge" ? "BrainDrive Concierge" : tier === "hosted" ? "BrainDrive Hosted" : "BrainDrive Local"}
              </div>
            </div>
            <div className="shrink-0 text-base leading-none text-bd-text-muted">
              ...
            </div>
          </button>
        </div>
      </div>
    </aside>
  );
}
