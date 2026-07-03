import type { ProjectFile } from "@/types/ui";

import {
  canonicalFileName,
  normalizePath,
  projectRelativePath,
  sidebarFileLabel,
} from "./sidebar-labels";

export type SidebarFileItem = {
  file: ProjectFile;
  label: string;
  canonicalPath: string;
  badge?: string;
  overlayPath?: string;
};

export type ProjectSidebarModel = {
  goals: SidebarFileItem | null;
  plan: SidebarFileItem | null;
  journal: SidebarFileItem | null;
  files: SidebarFileItem[];
  advanced: SidebarFileItem[];
};

export function buildProjectSidebarModel(projectId: string, files: ProjectFile[]): ProjectSidebarModel {
  const items = files.map((file) => toFileItem(file, projectId));
  const goals = items.find((item) => item.canonicalPath === "spec.md") ?? null;
  const plan = items.find((item) => item.canonicalPath === "plan.md") ?? null;
  const journal = items.find((item) => item.canonicalPath === "journal.md") ?? null;
  const advanced: SidebarFileItem[] = [];
  const visibleFiles: SidebarFileItem[] = [];

  for (const item of items) {
    if (item === goals || item === plan || item === journal) {
      continue;
    }

    if (isProjectAdvancedFile(item.canonicalPath)) {
      advanced.push(item);
      continue;
    }

    visibleFiles.push(withFileBadge(item));
  }

  return {
    goals,
    plan,
    journal,
    files: sortItems(visibleFiles),
    advanced: sortItems(advanced),
  };
}

function toFileItem(file: ProjectFile, projectId: string): SidebarFileItem {
  const canonicalPath = projectRelativePath(file.path, projectId);
  const overlayPath = overlayPathForManagedFile(file.path);
  return {
    file,
    label: sidebarFileLabel(file, projectId),
    canonicalPath,
    ...(overlayPath ? { overlayPath } : {}),
  };
}

function withFileBadge(item: SidebarFileItem): SidebarFileItem {
  if (/(^|\/)reports\//i.test(item.canonicalPath)) {
    return { ...item, badge: canonicalFileName(item.file) === "latest.md" ? "Generated" : "Report" };
  }

  if (/(^|\/)(statements|health-docs)\//i.test(item.canonicalPath)) {
    return { ...item, badge: "Source" };
  }

  return item;
}

function sortItems(items: SidebarFileItem[]): SidebarFileItem[] {
  return [...items].sort((left, right) => left.canonicalPath.localeCompare(right.canonicalPath));
}

function isProjectAdvancedFile(relativePath: string): boolean {
  const fileName = relativePath.split("/").pop() ?? relativePath;

  if (/^journal\/(?:AGENT|journal)\.md$/i.test(relativePath)) {
    return true;
  }

  if (relativePath.includes("/")) {
    return fileName === "README.md" || fileName === "README-user.md" || isManagedInstructionFile(fileName) || /-user\.md$/i.test(fileName);
  }

  return isManagedInstructionFile(fileName) || /-user\.md$/i.test(fileName);
}

function isManagedInstructionFile(fileName: string): boolean {
  if (fileName === "AGENT.md" || fileName === "README.md") {
    return true;
  }
  if (/-rules\.md$/i.test(fileName)) {
    return true;
  }
  return /^(create|compare|run-interview|run-planning|run-journal|generate-report)\.md$/i.test(fileName);
}

function overlayPathForManagedFile(pathValue: string): string | undefined {
  const normalized = normalizePath(pathValue);
  const fileName = normalized.split("/").pop() ?? "";

  if (!normalized.toLowerCase().endsWith(".md") || /-user\.md$/i.test(fileName)) {
    return undefined;
  }

  if (!isManagedInstructionFile(fileName)) {
    return undefined;
  }

  return normalized.replace(/\.md$/i, "-user.md");
}
