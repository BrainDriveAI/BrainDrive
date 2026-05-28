import {
  ChevronDown,
  ChevronRight,
  DollarSign,
  FileText,
  Folder,
  Map,
  Settings,
  Target,
  type LucideIcon
} from "lucide-react";
import { useState } from "react";

import type { ProjectFile } from "@/types/ui";

import {
  categorizeProjectFiles,
  type AppSummary,
  type WorkFolderSummary
} from "./sidebar-categorize";
import { appLabel, fileLabel } from "./sidebar-labels";

type ProjectFilesGroupedProps = {
  projectFiles: ProjectFile[];
  onFileClick: (file: ProjectFile) => void;
  onSelectApp?: (app: AppSummary) => void;
  onClose?: () => void;
};

const APP_ICONS: Record<string, LucideIcon> = {
  budget: DollarSign
};

function getAppIcon(name: string): LucideIcon {
  return APP_ICONS[name.toLowerCase()] ?? Folder;
}

export default function ProjectFilesGrouped({
  projectFiles,
  onFileClick,
  onSelectApp,
  onClose
}: ProjectFilesGroupedProps) {
  const [isWorkOpen, setIsWorkOpen] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const { triad, apps, workFolders, advanced } = categorizeProjectFiles(projectFiles);

  const hasAny =
    Boolean(triad.goals || triad.plan) ||
    apps.length > 0 ||
    workFolders.length > 0 ||
    advanced.length > 0;

  if (!hasAny) {
    return <div className="px-3 py-4 text-sm text-bd-text-muted">No files yet</div>;
  }

  return (
    <div className="space-y-4 px-2">
      {(triad.goals || triad.plan || apps.length > 0) && (
        <div className="space-y-1">
          {triad.goals && (
            <TriadRow
              icon={Target}
              label="Your Goals"
              canonical={triad.goals.name}
              onClick={() => {
                onFileClick(triad.goals!);
                onClose?.();
              }}
            />
          )}
          {triad.plan && (
            <TriadRow
              icon={Map}
              label="Your Plan"
              canonical={triad.plan.name}
              onClick={() => {
                onFileClick(triad.plan!);
                onClose?.();
              }}
            />
          )}
          {apps.map((app) => (
            <AppRow
              key={app.path}
              app={app}
              onSelectApp={onSelectApp}
              onFileClick={onFileClick}
              onClose={onClose}
            />
          ))}
        </div>
      )}

      {workFolders.length > 0 && (
        <CollapsibleSection
          label="Your Files"
          isOpen={isWorkOpen}
          onToggle={() => setIsWorkOpen((current) => !current)}
        >
          {workFolders.map((folder) => (
            <WorkFolderRow
              key={folder.path}
              folder={folder}
              onFileClick={onFileClick}
              onClose={onClose}
            />
          ))}
        </CollapsibleSection>
      )}

      {advanced.length > 0 && (
        <CollapsibleSection
          label="Advanced"
          icon={Settings}
          isOpen={isAdvancedOpen}
          onToggle={() => setIsAdvancedOpen((current) => !current)}
        >
          {advanced.map((file) => (
            <button
              key={file.name}
              type="button"
              onClick={() => {
                onFileClick(file);
                onClose?.();
              }}
              title={file.name}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] text-bd-text-secondary transition-all duration-200 hover:bg-bd-bg-hover hover:text-bd-text-primary"
            >
              <FileText size={16} strokeWidth={1.5} className="shrink-0 text-bd-text-muted" />
              <span className="truncate">{fileLabel(file.name, "project")}</span>
            </button>
          ))}
        </CollapsibleSection>
      )}
    </div>
  );
}

function CollapsibleSection({
  label,
  icon: Icon,
  isOpen,
  onToggle,
  children
}: {
  label: string;
  icon?: LucideIcon;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-bd-text-muted transition-colors duration-200 hover:bg-bd-bg-hover hover:text-bd-text-secondary"
      >
        {isOpen ? (
          <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
        ) : (
          <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />
        )}
        {Icon ? <Icon size={14} strokeWidth={1.5} className="shrink-0" /> : null}
        <span className="truncate">{label}</span>
      </button>
      {isOpen && <div className="space-y-1 pt-1">{children}</div>}
    </div>
  );
}

function TriadRow({
  icon: Icon,
  label,
  canonical,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  canonical: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={canonical}
      className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all duration-200 hover:bg-bd-bg-hover"
    >
      <Icon size={16} strokeWidth={1.5} className="shrink-0 text-bd-text-secondary" />
      <span className="min-w-0 flex-1 truncate text-[14px] text-bd-text-primary">{label}</span>
      <span className="hidden shrink-0 text-[11px] text-bd-text-muted group-hover:inline">
        {canonical}
      </span>
    </button>
  );
}

function AppRow({
  app,
  onSelectApp,
  onFileClick,
  onClose
}: {
  app: AppSummary;
  onSelectApp?: (app: AppSummary) => void;
  onFileClick: (file: ProjectFile) => void;
  onClose?: () => void;
}) {
  const Icon = getAppIcon(app.name);
  const label = appLabel(app.name);

  function handleClick() {
    if (onSelectApp) {
      onSelectApp(app);
    }
    const stateFile = app.files.find((f) => f.name === `${app.path}/${app.name}.md`);
    const agentFile = app.files.find((f) => f.name === `${app.path}/AGENT.md`);
    const target = stateFile ?? agentFile;
    if (target) {
      onFileClick(target);
    }
    onClose?.();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`${app.path}/`}
      className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all duration-200 hover:bg-bd-bg-hover"
    >
      <Icon size={16} strokeWidth={1.5} className="shrink-0 text-bd-text-secondary" />
      <span className="min-w-0 flex-1 truncate text-[14px] text-bd-text-primary">{label}</span>
      <span className="hidden shrink-0 text-[11px] text-bd-text-muted group-hover:inline">
        {app.path}/
      </span>
    </button>
  );
}

function WorkFolderRow({
  folder,
  onFileClick,
  onClose
}: {
  folder: WorkFolderSummary;
  onFileClick: (file: ProjectFile) => void;
  onClose?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const folderLabel = folder.name.charAt(0).toUpperCase() + folder.name.slice(1);

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all duration-200 hover:bg-bd-bg-hover"
      >
        {isOpen ? (
          <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-bd-text-muted" />
        ) : (
          <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-bd-text-muted" />
        )}
        <Folder size={16} strokeWidth={1.5} className="shrink-0 text-bd-text-secondary" />
        <span className="min-w-0 flex-1 truncate text-[14px] text-bd-text-primary">{folderLabel}</span>
      </button>
      {isOpen && (
        <div className="space-y-1 pl-6 pt-1">
          {folder.files.map((file) => {
            const basename = file.name.slice(file.name.lastIndexOf("/") + 1);
            return (
              <button
                key={file.name}
                type="button"
                onClick={() => {
                  onFileClick(file);
                  onClose?.();
                }}
                title={file.name}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] text-bd-text-secondary transition-all duration-200 hover:bg-bd-bg-hover hover:text-bd-text-primary"
              >
                <FileText size={16} strokeWidth={1.5} className="shrink-0 text-bd-text-muted" />
                <span className="truncate">{basename}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
