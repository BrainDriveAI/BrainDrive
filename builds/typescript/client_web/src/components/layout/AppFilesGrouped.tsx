import {
  Bot,
  ChevronDown,
  ChevronRight,
  DollarSign,
  FileText,
  Folder,
  Map,
  Ruler,
  Settings,
  Target,
  type LucideIcon
} from "lucide-react";
import { useState } from "react";

import type { ProjectFile } from "@/types/ui";

import { categorizeAppFiles } from "./sidebar-categorize";
import { appLabel, fileLabel } from "./sidebar-labels";

type AppFilesGroupedProps = {
  appPath: string;
  projectFiles: ProjectFile[];
  onFileClick: (file: ProjectFile) => void;
  onClose?: () => void;
};

const APP_ICONS: Record<string, LucideIcon> = {
  budget: DollarSign
};

function getAppIcon(name: string): LucideIcon {
  return APP_ICONS[name.toLowerCase()] ?? Folder;
}

export default function AppFilesGrouped({
  appPath,
  projectFiles,
  onFileClick,
  onClose
}: AppFilesGroupedProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const { triad, state, rules, advanced } = categorizeAppFiles(projectFiles, appPath);

  const AppIcon = getAppIcon(appPath);

  const hasPrimary = Boolean(triad.agent || state || rules || triad.goals || triad.plan);

  if (!hasPrimary && advanced.length === 0) {
    return <div className="px-3 py-4 text-sm text-bd-text-muted">No files yet</div>;
  }

  return (
    <div className="space-y-4 px-2">
      {hasPrimary && (
        <div className="space-y-1">
          {triad.agent && (
            <Row
              icon={Bot}
              label="Your Agent"
              canonical={triad.agent.name}
              onClick={() => {
                onFileClick(triad.agent!);
                onClose?.();
              }}
            />
          )}
          {state && (
            <Row
              icon={AppIcon}
              label={appLabel(appPath)}
              canonical={state.name}
              onClick={() => {
                onFileClick(state);
                onClose?.();
              }}
            />
          )}
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
          {rules && (
            <Row
              icon={Ruler}
              label="Your Rules"
              canonical={
                rules.overlay
                  ? `${rules.base.name} (+ overlay)`
                  : rules.base.name
              }
              onClick={() => {
                onFileClick(rules.base);
                onClose?.();
              }}
            />
          )}
        </div>
      )}

      {advanced.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setIsAdvancedOpen((current) => !current)}
            aria-expanded={isAdvancedOpen}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-bd-text-muted transition-colors duration-200 hover:bg-bd-bg-hover hover:text-bd-text-secondary"
          >
            {isAdvancedOpen ? (
              <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
            ) : (
              <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />
            )}
            <Settings size={14} strokeWidth={1.5} className="shrink-0" />
            <span className="truncate">Advanced</span>
          </button>
          {isAdvancedOpen && (
            <div className="space-y-1 pt-1">
              {advanced.map((file) => {
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
            </div>
          )}
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
