import { ChevronRight, Settings } from "lucide-react";

import type { Project } from "@/types/ui";

import { getProjectIcon } from "./project-icons";

type SidebarCollapsedProps = {
  onToggle: () => void;
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onOpenSettings: () => void;
};

export default function SidebarCollapsed({
  onToggle,
  projects,
  selectedProjectId,
  onSelectProject,
  onOpenSettings
}: SidebarCollapsedProps) {
  return (
    <aside className="flex h-dvh w-[48px] flex-col items-center border-r border-bd-border bg-bd-bg-secondary py-3 transition-all duration-200">
      <img src="/braindrive-icon.svg" alt="BrainDrive" className="h-7 w-7" />

      <div className="mt-4 flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-1 pb-3">
        {projects.map((project) => {
          const Icon = getProjectIcon(project.icon);
          const isActive = project.id === selectedProjectId;

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
              title={project.name}
              aria-label={project.name}
            >
              <Icon size={16} strokeWidth={1.8} />
            </button>
          );
        })}
      </div>

      <div className="flex w-full flex-col items-center gap-1">
        <button
          type="button"
          aria-label="Open settings"
          onClick={onOpenSettings}
          className="flex h-10 w-10 items-center justify-center rounded-md text-bd-text-secondary transition-all duration-200 hover:bg-bd-bg-hover"
        >
          <Settings size={18} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="Expand sidebar"
          onClick={onToggle}
          className="flex h-10 w-10 items-center justify-center rounded-md text-bd-text-secondary transition-all duration-200 hover:bg-bd-bg-hover"
        >
          <ChevronRight size={18} strokeWidth={1.5} />
        </button>
      </div>
    </aside>
  );
}
