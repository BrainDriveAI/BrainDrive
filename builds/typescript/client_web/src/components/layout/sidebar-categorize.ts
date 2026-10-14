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
  todo: SidebarFileItem | null;
  journal: SidebarFileItem | null;
  files: SidebarFileItem[];
  advanced: SidebarFileItem[];
  expert: {
    instructions: SidebarFileItem[];
    skills: SidebarFileItem[];
    templates: SidebarFileItem[];
  };
};

export function buildProjectSidebarModel(projectId: string, files: ProjectFile[]): ProjectSidebarModel {
  const items = files.map((file) => toFileItem(file, projectId));
  const goals = items.find((item) => item.canonicalPath === "spec.md") ?? null;
  const plan = items.find((item) => item.canonicalPath === "plan.md") ?? null;
  const todo = items.find((item) => item.canonicalPath === "todo.md") ?? null;
  const journal = items.find((item) => item.canonicalPath === "journal.md") ?? null;
  const instructions: SidebarFileItem[] = [];
  const skills: SidebarFileItem[] = [];
  const templates: SidebarFileItem[] = [];
  const visibleFiles: SidebarFileItem[] = [];

  for (const item of items) {
    if (item === goals || item === plan || item === todo || item === journal) {
      continue;
    }

    // Published outputs stay artifacts even when their names resemble setup files.
    if (item.file.sourceType !== "app_published") {
      if (/(^|\/)templates\//i.test(item.canonicalPath) || /-template\.md$/i.test(item.canonicalPath)) {
        templates.push(item);
        continue;
      }
      if (/(^|\/)skills\//i.test(item.canonicalPath) || item.canonicalPath === "business-idea-interview.md") {
        skills.push(item);
        continue;
      }
      if (isProjectAdvancedFile(item.canonicalPath)) {
        instructions.push(item);
        continue;
      }
    }

    visibleFiles.push(withFileBadge(item));
  }

  return {
    goals,
    plan,
    todo,
    journal,
    files: sortItems(visibleFiles),
    advanced: sortItems([...instructions, ...skills, ...templates]),
    expert: {
      instructions: sortItems(instructions),
      skills: sortItems(skills),
      templates: sortItems(templates),
    },
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
  if (item.file.sourceType === "app_published") {
    return { ...item, badge: "Published" };
  }

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
