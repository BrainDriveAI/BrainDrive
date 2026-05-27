/**
 * Categorise a flat list of project files into the sidebar's display groups.
 *
 * Project scope (categorizeProjectFiles):
 *   - Triad files at project root: AGENT.md → agent, spec.md → goals, plan.md → plan
 *   - App folder: any top-level subfolder containing an AGENT.md → peer Your X item
 *   - Work folder: any top-level subfolder without an AGENT.md → Your Work group
 *   - Advanced: everything else (run-*.md, *-user.md at root, index.md, README.md)
 *
 * App scope (categorizeAppFiles):
 *   - Triad files at app root: AGENT.md → agent; spec.md / plan.md only when present
 *   - State artifact: <appname>.md → peer Your <Capability>
 *   - Rules: <appname>-rules.md → Your Rules (overlay <appname>-rules-user.md goes to Advanced)
 *   - Advanced: managed instructions (create.md, compare.md), AGENT-user.md, all *-user.md overlays
 */

import type { ProjectFile } from "@/types/ui";

export interface CategorizedProjectFiles {
  triad: TriadFiles;
  apps: AppSummary[];
  workFolders: WorkFolderSummary[];
  advanced: ProjectFile[];
}

export interface TriadFiles {
  agent?: ProjectFile;
  goals?: ProjectFile;
  plan?: ProjectFile;
}

export interface AppSummary {
  /** Folder name (e.g., "budget"). */
  name: string;
  /** Folder path within the project (e.g., "budget"). */
  path: string;
  /** All files under this folder. */
  files: ProjectFile[];
}

export interface WorkFolderSummary {
  name: string;
  path: string;
  files: ProjectFile[];
}

export function categorizeProjectFiles(files: ProjectFile[]): CategorizedProjectFiles {
  const triad: TriadFiles = {};
  const advanced: ProjectFile[] = [];
  const subfolderFiles = new Map<string, ProjectFile[]>();

  for (const file of files) {
    const relative = file.name;
    const topSlash = relative.indexOf("/");

    if (topSlash === -1) {
      if (relative === "AGENT.md") {
        triad.agent = file;
      } else if (relative === "spec.md") {
        triad.goals = file;
      } else if (relative === "plan.md") {
        triad.plan = file;
      } else {
        advanced.push(file);
      }
      continue;
    }

    const folder = relative.slice(0, topSlash);
    const existing = subfolderFiles.get(folder);
    if (existing) {
      existing.push(file);
    } else {
      subfolderFiles.set(folder, [file]);
    }
  }

  const apps: AppSummary[] = [];
  const workFolders: WorkFolderSummary[] = [];

  for (const [folder, folderFiles] of subfolderFiles) {
    const hasAgent = folderFiles.some((f) => f.name === `${folder}/AGENT.md`);
    const summary = { name: folder, path: folder, files: folderFiles };
    if (hasAgent) {
      apps.push(summary);
    } else {
      workFolders.push(summary);
    }
  }

  apps.sort((a, b) => a.name.localeCompare(b.name));
  workFolders.sort((a, b) => a.name.localeCompare(b.name));
  advanced.sort((a, b) => a.name.localeCompare(b.name));

  return { triad, apps, workFolders, advanced };
}

export interface CategorizedAppFiles {
  triad: TriadFiles;
  state?: ProjectFile;
  rules?: {
    base: ProjectFile;
    overlay?: ProjectFile;
  };
  advanced: ProjectFile[];
}

/**
 * Categorise files for a single app scope (e.g., `budget/`).
 * `appPath` is the project-relative folder name (no trailing slash).
 * Files outside that folder are ignored.
 */
export function categorizeAppFiles(
  files: ProjectFile[],
  appPath: string
): CategorizedAppFiles {
  const prefix = `${appPath}/`;
  const triad: TriadFiles = {};
  const advanced: ProjectFile[] = [];
  let state: ProjectFile | undefined;
  let rulesBase: ProjectFile | undefined;
  let rulesOverlay: ProjectFile | undefined;

  for (const file of files) {
    if (!file.name.startsWith(prefix)) {
      continue;
    }
    const relative = file.name.slice(prefix.length);
    if (relative.includes("/")) {
      advanced.push(file);
      continue;
    }

    if (relative === "AGENT.md") {
      triad.agent = file;
    } else if (relative === "spec.md") {
      triad.goals = file;
    } else if (relative === "plan.md") {
      triad.plan = file;
    } else if (relative === `${appPath}.md`) {
      state = file;
    } else if (relative === `${appPath}-rules.md`) {
      rulesBase = file;
    } else if (relative === `${appPath}-rules-user.md`) {
      rulesOverlay = file;
      advanced.push(file);
    } else {
      advanced.push(file);
    }
  }

  advanced.sort((a, b) => a.name.localeCompare(b.name));

  const rules = rulesBase ? { base: rulesBase, overlay: rulesOverlay } : undefined;

  return { triad, state, rules, advanced };
}
