import { AppWindow, Bot, FolderOpen, Settings2, Sparkles, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import { ROOT_AGENT_PROJECT_ID, isRootAgentProjectId } from "@/lib/rootAgent";
import type { Project } from "@/types/ui";

import { getProjectIcon } from "./project-icons";
import { rootProjectDisplayLabel } from "./sidebar-labels";
import { PROJECT_VIEW_LABELS, type ProjectView } from "./ProjectContentView";
import SidebarHome from "./SidebarHome";

type SidebarCollapsedProps = {
  onToggle: () => void;
  projects: Project[];
  selectedProjectId: string | null;
  isProjectView: boolean;
  activeView: ProjectView | null;
  onDeselectProject: () => void;
  onReturnToChat: () => void;
  onOpenProjectView: (view: ProjectView) => void;
  onSelectProject: (projectId: string) => void;
  accountFooter: ReactNode;
  onOpenApps: () => void;
  isAppsActive: boolean;
};

export default function SidebarCollapsed({
  onToggle,
  projects,
  selectedProjectId,
  isProjectView,
  activeView,
  onDeselectProject,
  onReturnToChat,
  onOpenProjectView,
  onSelectProject,
  accountFooter,
  onOpenApps,
  isAppsActive,
}: SidebarCollapsedProps) {
  return (
    <aside className="flex h-dvh w-[48px] flex-col items-center border-r border-bd-border bg-bd-bg-secondary pt-3 transition-all duration-200">
      {isProjectView ? <SidebarHome onGoHome={onDeselectProject} /> : <button
        type="button"
        aria-label="Go to BrainDrive home"
        onClick={() => {
          onSelectProject(ROOT_AGENT_PROJECT_ID);
          onToggle();
        }}
        className="cursor-pointer bg-transparent p-0 hover:opacity-80"
      >
        <img src="/braindrive-icon.svg" alt="BrainDrive" className="h-7 w-7" />
      </button>}

      <div className="mt-4 flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-1 pb-3">
        {isProjectView ? (
          <>
            <nav aria-label="Page navigation" className="flex flex-col gap-1">
              <button type="button" aria-label="Conversation" title="Conversation" onClick={onReturnToChat}
                aria-current={activeView === null ? "page" : undefined}
                className="flex h-10 w-10 items-center justify-center rounded-md border-l-2 border-bd-amber text-bd-amber hover:bg-bd-bg-hover aria-[current=page]:bg-bd-bg-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber">
                <Sparkles size={17} strokeWidth={1.7} aria-hidden="true" />
              </button>
              {([["files", FolderOpen], ["tools", Wrench], ["expert", Settings2]] as const).map(([view, Icon]) => (
                <button key={view} type="button" aria-label={PROJECT_VIEW_LABELS[view]} title={PROJECT_VIEW_LABELS[view]}
                  aria-current={activeView === view ? "page" : undefined} onClick={() => onOpenProjectView(view)}
                  className="flex h-10 w-10 items-center justify-center rounded-md text-bd-text-primary hover:bg-bd-bg-hover aria-[current=page]:bg-bd-bg-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber">
                  <Icon size={17} strokeWidth={1.5} aria-hidden="true" />
                </button>
              ))}
            </nav>
          </>
        ) : <>
        <button
          type="button"
          onClick={onOpenApps}
          className={[
            "flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-200 hover:bg-bd-amber/80 hover:text-bd-bg-primary",
            isAppsActive ? "bg-bd-amber text-bd-bg-primary" : "bg-bd-bg-tertiary text-bd-text-primary",
          ].join(" ")}
          title="Apps"
          aria-label="Apps"
          aria-current={isAppsActive ? "page" : undefined}
        >
          <AppWindow size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => {
            onSelectProject(ROOT_AGENT_PROJECT_ID);
            onToggle();
          }}
          className={[
            "flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 hover:bg-bd-amber/80 hover:text-bd-bg-primary",
            !isAppsActive && isRootAgentProjectId(selectedProjectId)
              ? "bg-bd-amber text-bd-bg-primary"
              : "bg-bd-bg-tertiary text-bd-text-primary"
          ].join(" ")}
          title="Your Agent"
          aria-label="Your Agent"
        >
          <Bot size={16} strokeWidth={1.8} />
        </button>
        {projects.filter((project) => !isRootAgentProjectId(project.id)).map((project) => {
          const Icon = getProjectIcon(project.icon);
          const isActive = !isAppsActive && project.id === selectedProjectId;

          return (
            <button
              type="button"
              key={project.id}
              onClick={() => {
                onSelectProject(project.id);
                onToggle();
              }}
              className={[
                "flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 hover:bg-bd-amber/80 hover:text-bd-bg-primary",
                isActive
                  ? "bg-bd-amber text-bd-bg-primary"
                  : "bg-bd-bg-tertiary text-bd-text-primary"
              ].join(" ")}
              title={rootProjectDisplayLabel(project.id, project.name)}
              aria-label={rootProjectDisplayLabel(project.id, project.name)}
            >
              <Icon size={16} strokeWidth={1.8} />
            </button>
          );
        })}
        </>}
      </div>

      {accountFooter}
    </aside>
  );
}
