import { Bot, ChevronDown, ChevronLeft, ChevronRight, FileText, Folder, MoreHorizontal, Pencil, Plus, Trash2, Wallet, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getSession } from "@/api/auth-adapter";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Project, ProjectFile, UserProfile } from "@/types/ui";
import { ACCEPTED_FILE_INPUT } from "@/utils/file-utils";

import ProfileMenu from "./ProfileMenu";
import {
  buildAppSidebarModel,
  buildProjectSidebarModel,
  defaultAppFile,
  type SidebarFileItem,
  type SidebarFolderItem,
} from "./sidebar-categorize";
import { appShortLabel, projectDisplayLabel, projectShortLabel, rootProjectDisplayLabel } from "./sidebar-labels";
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
  activeAppPath?: string | null;
  projectFiles: ProjectFile[];
  isLoadingProjects: boolean;
  isLoadingFiles: boolean;
  onSelectProject: (projectId: string) => void;
  onDeselectProject: () => void;
  onSelectAppPath?: (appPath: string | null) => void;
  onReturnToChat: () => void;
  onFileClick: (file: ProjectFile) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onAddProject?: (name: string) => Promise<void>;
  onRemoveProject?: (id: string) => Promise<void>;
  onRenameProject?: (id: string, name: string) => Promise<void>;
  onUploadDocument?: (file: File) => Promise<unknown>;
  uploadStatus?: string | null;
  uploadError?: string | null;
  tier?: "local" | "concierge";
  onClose?: () => void;
};

export default function Sidebar({
  isCollapsed,
  onToggle,
  projects,
  selectedProjectId,
  selectedProject,
  activeAppPath = null,
  projectFiles,
  isLoadingProjects,
  isLoadingFiles,
  onSelectProject,
  onDeselectProject,
  onSelectAppPath,
  onReturnToChat,
  onFileClick,
  onOpenSettings,
  onLogout,
  onAddProject,
  onRemoveProject,
  onRenameProject,
  onUploadDocument,
  uploadStatus,
  uploadError,
  tier = "local",
  onClose
}: SidebarProps) {
  const [user, setUser] = useState<UserProfile>(DEFAULT_USER);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [menuOpenForProject, setMenuOpenForProject] = useState<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [showAdvancedFiles, setShowAdvancedFiles] = useState(false);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [renameValue, setRenameValue] = useState("");
  const newProjectInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
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
  const projectModel = selectedProject ? buildProjectSidebarModel(selectedProject.id, projectFiles) : null;
  const appModel = selectedProject && activeAppPath
    ? buildAppSidebarModel(selectedProject.id, activeAppPath, projectFiles)
    : null;
  const selectedProjectLabel = selectedProject
    ? projectDisplayLabel(selectedProject.id, selectedProject.name)
    : "";
  const selectedProjectShortLabel = selectedProject
    ? projectShortLabel(selectedProject.id, selectedProject.name)
    : "";

  function toggleFolder(folderPath: string) {
    setOpenFolders((current) => {
      const next = new Set(current);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }

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
              aria-label={activeAppPath ? "Back to project" : "Back to project list"}
              onClick={() => {
                if (activeAppPath) {
                  onSelectAppPath?.(null);
                  onReturnToChat();
                  return;
                }
                onDeselectProject();
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-bd-text-secondary transition-colors duration-200 hover:bg-bd-bg-hover hover:text-bd-text-primary"
            >
              <ChevronLeft size={16} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeAppPath) {
                  onSelectAppPath?.(null);
                }
                onReturnToChat();
                onClose?.();
              }}
              className="min-w-0 truncate text-left text-sm text-bd-text-secondary transition-colors duration-200 hover:text-bd-text-primary"
            >
              {activeAppPath ? selectedProjectShortLabel : selectedProjectLabel}
            </button>
            {activeAppPath ? (
              <>
                <ChevronRight size={13} strokeWidth={1.7} className="shrink-0 text-bd-text-muted" />
                <button
                  type="button"
                  onClick={() => {
                    const appFile = defaultAppFile(selectedProject.id, activeAppPath, projectFiles);
                    if (appFile) {
                      onFileClick(appFile);
                    } else {
                      onReturnToChat();
                    }
                    onClose?.();
                  }}
                  className="min-w-0 truncate text-left text-sm font-medium text-bd-text-primary transition-colors duration-200 hover:text-bd-amber"
                >
                  {appShortLabel(activeAppPath)}
                </button>
              </>
            ) : null}
            {onUploadDocument && !activeAppPath ? (
              <>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept={ACCEPTED_FILE_INPUT}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) {
                      return;
                    }
                    void onUploadDocument(file).catch(() => {});
                  }}
                />
                <button
                  type="button"
                  aria-label={`Upload document to ${selectedProjectLabel}`}
                  disabled={Boolean(uploadStatus)}
                  onClick={() => {
                    uploadInputRef.current?.click();
                  }}
                  className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-bd-text-secondary transition-colors duration-200 hover:bg-bd-bg-hover hover:text-bd-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  title="Upload document"
                >
                  <Plus size={16} strokeWidth={1.5} />
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <ScrollArea className="min-h-0 flex-1 px-2 pb-4">
          {isProjectView ? (
            <div className="space-y-1 px-2">
              {uploadStatus ? (
                <div className="px-3 py-2 text-xs text-bd-text-muted">{uploadStatus}</div>
              ) : null}
              {uploadError ? (
                <div className="px-3 py-2 text-xs leading-5 text-red-400">{uploadError}</div>
              ) : null}
              {isLoadingFiles ? (
                <div className="px-3 py-4 text-sm text-bd-text-muted">Loading files...</div>
              ) : projectFiles.length === 0 ? (
                <div className="px-3 py-4 text-sm text-bd-text-muted">No files yet</div>
              ) : (
                <>
                  {appModel ? (
                    <>
                      <SidebarFileSection
                        label="Your Files"
                        items={appModel.files}
                        onFileClick={onFileClick}
                        onClose={onClose}
                      />
                      <SidebarFolderSection
                        label={appModel.files.length > 0 ? undefined : "Your Files"}
                        folders={appModel.folders}
                        openFolders={openFolders}
                        onToggleFolder={toggleFolder}
                        onFileClick={onFileClick}
                        onClose={onClose}
                      />
                      <SidebarFileSection
                        label="Advanced"
                        items={appModel.advanced}
                        onFileClick={onFileClick}
                        onClose={onClose}
                      />
                    </>
                  ) : projectModel ? (
                    <>
                      <SidebarFileSection
                        label="Plan"
                        items={[projectModel.goals, projectModel.plan].filter(Boolean) as SidebarFileItem[]}
                        onFileClick={onFileClick}
                        onClose={onClose}
                      />
                      {projectModel.apps.length > 0 ? (
                        <div className="pb-2">
                          <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-normal text-bd-text-muted">
                            Apps
                          </div>
                          <div className="space-y-1">
                            {projectModel.apps.map((app) => (
                              <button
                                key={app.path}
                                type="button"
                                onClick={() => {
                                  onSelectAppPath?.(app.path);
                                  if (app.stateFile) {
                                    onFileClick(app.stateFile);
                                  } else {
                                    onReturnToChat();
                                  }
                                  onClose?.();
                                }}
                                className="flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-[14px] text-bd-text-primary transition-colors duration-200 hover:bg-bd-bg-hover"
                              >
                                <Wallet size={16} strokeWidth={1.5} className="shrink-0 text-bd-text-muted" />
                                <span className="truncate">{app.label}</span>
                                <ChevronRight size={14} strokeWidth={1.5} className="ml-auto shrink-0 text-bd-text-muted" />
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <SidebarFileSection
                        label="Your Files"
                        items={projectModel.files}
                        onFileClick={onFileClick}
                        onClose={onClose}
                      />
                      <AdvancedSectionToggle
                        count={projectModel.advanced.length}
                        isOpen={showAdvancedFiles}
                        onToggle={() => setShowAdvancedFiles((value) => !value)}
                      />
                      {showAdvancedFiles ? (
                        <SidebarFileSection
                          label="Advanced"
                          items={projectModel.advanced}
                          onFileClick={onFileClick}
                          onClose={onClose}
                        />
                      ) : null}
                    </>
                  ) : null}
                </>
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
                  <Bot size={17} strokeWidth={1.5} className="shrink-0 text-bd-text-secondary" />
                  <span className="truncate text-[14px] text-bd-text-primary">Your Agent</span>
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
      </div>

      <div className="mt-auto">
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
                {tier === "concierge" ? "BrainDrive Concierge" : "BrainDrive Local"}
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

function SidebarFileSection({
  label,
  items,
  onFileClick,
  onClose,
}: {
  label: string;
  items: SidebarFileItem[];
  onFileClick: (file: ProjectFile) => void;
  onClose?: () => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="pb-2">
      <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-normal text-bd-text-muted">
        {label}
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <SidebarFileButton
            key={item.file.path}
            item={item}
            onFileClick={onFileClick}
            onClose={onClose}
          />
        ))}
      </div>
    </div>
  );
}

function SidebarFolderSection({
  label,
  folders,
  openFolders,
  onToggleFolder,
  onFileClick,
  onClose,
}: {
  label?: string;
  folders: SidebarFolderItem[];
  openFolders: Set<string>;
  onToggleFolder: (folderPath: string) => void;
  onFileClick: (file: ProjectFile) => void;
  onClose?: () => void;
}) {
  if (folders.length === 0) {
    return null;
  }

  return (
    <div className="pb-2">
      {label ? (
        <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-normal text-bd-text-muted">
          {label}
        </div>
      ) : null}
      <div className="space-y-1">
        {folders.map((folder) => {
          const isOpen = openFolders.has(folder.path);
          return (
            <div key={folder.path}>
              <button
                type="button"
                onClick={() => onToggleFolder(folder.path)}
                className="flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-[14px] text-bd-text-primary transition-colors duration-200 hover:bg-bd-bg-hover"
              >
                {isOpen ? (
                  <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-bd-text-muted" />
                ) : (
                  <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-bd-text-muted" />
                )}
                <Folder size={16} strokeWidth={1.5} className="shrink-0 text-bd-text-muted" />
                <span className="truncate">{folder.label}</span>
              </button>
              {isOpen ? (
                <div className="ml-6 mt-1 space-y-1">
                  {folder.files.map((item) => (
                    <SidebarFileButton
                      key={item.file.path}
                      item={item}
                      onFileClick={onFileClick}
                      onClose={onClose}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SidebarFileButton({
  item,
  onFileClick,
  onClose,
}: {
  item: SidebarFileItem;
  onFileClick: (file: ProjectFile) => void;
  onClose?: () => void;
}) {
  return (
    <div className="group/file flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          onFileClick(item.file);
          onClose?.();
        }}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2 text-left text-[14px] text-bd-text-primary transition-colors duration-200 hover:bg-bd-bg-hover"
        title={item.canonicalPath}
      >
        <FileText size={16} strokeWidth={1.5} className="shrink-0 text-bd-text-muted" />
        <span className="truncate">{item.label}</span>
        {item.badge ? (
          <span className="ml-auto shrink-0 rounded border border-bd-border px-1.5 py-0.5 text-[10px] text-bd-text-muted">
            {item.badge}
          </span>
        ) : null}
      </button>
      {item.overlayPath ? (
        <button
          type="button"
          aria-label={`Customize ${item.label}`}
          title={`Customize ${item.label}`}
          onClick={() => {
            onFileClick({
              name: item.overlayPath?.split("/").pop() ?? item.overlayPath ?? "",
              path: item.overlayPath ?? "",
            });
            onClose?.();
          }}
          className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-bd-text-muted transition-colors duration-200 hover:bg-bd-bg-hover hover:text-bd-text-primary group-hover/file:flex focus:flex"
        >
          <Pencil size={14} strokeWidth={1.5} />
        </button>
      ) : null}
    </div>
  );
}

function AdvancedSectionToggle({
  count,
  isOpen,
  onToggle,
}: {
  count: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  if (count === 0) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className="mb-2 flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs text-bd-text-muted transition-colors duration-200 hover:bg-bd-bg-hover hover:text-bd-text-primary"
    >
      <span>{isOpen ? "Hide advanced" : "Show advanced"}</span>
      <span>{count}</span>
    </button>
  );
}
