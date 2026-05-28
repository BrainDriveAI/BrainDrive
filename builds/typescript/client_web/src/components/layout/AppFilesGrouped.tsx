import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Map,
  Settings,
  Target,
  type LucideIcon
} from "lucide-react";
import { useState } from "react";

import type { ProjectFile } from "@/types/ui";

import { categorizeAppFiles, type WorkFolderSummary } from "./sidebar-categorize";
import { fileLabel } from "./sidebar-labels";

type AppFilesGroupedProps = {
  appPath: string;
  projectFiles: ProjectFile[];
  onFileClick: (file: ProjectFile) => void;
  onClose?: () => void;
};

export default function AppFilesGrouped({
  appPath,
  projectFiles,
  onFileClick,
  onClose
}: AppFilesGroupedProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isWorkOpen, setIsWorkOpen] = useState(false);
  const { triad, rules, workFolders, advanced } = categorizeAppFiles(projectFiles, appPath);

  // Rules live under Advanced now — merge the base file in (overlay already there).
  const advancedWithRules = rules
    ? [...advanced, rules.base].sort((a, b) => a.name.localeCompare(b.name))
    : advanced;

  const hasPrimary = Boolean(triad.goals || triad.plan);

  if (!hasPrimary && workFolders.length === 0 && advancedWithRules.length === 0) {
    return <div className="px-3 py-4 text-sm text-bd-text-muted">No files yet</div>;
  }

  return (
    <div className="space-y-4 px-2">
      {hasPrimary && (
        <div className="space-y-1">
          {triad.goals && (
            <Row
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
            <Row
              icon={Map}
              label="Your Plan"
              canonical={triad.plan.name}
              onClick={() => {
                onFileClick(triad.plan!);
                onClose?.();
              }}
            />
          )}
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

      {advancedWithRules.length > 0 && (
        <CollapsibleSection
          label="Advanced"
          icon={Settings}
          isOpen={isAdvancedOpen}
          onToggle={() => setIsAdvancedOpen((current) => !current)}
        >
          {advancedWithRules.map((file) => {
            const relative = file.name.startsWith(`${appPath}/`)
              ? file.name.slice(appPath.length + 1)
              : file.name;
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
                <span className="truncate">{fileLabel(relative, "app")}</span>
              </button>
            );
          })}
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

function Row({
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
