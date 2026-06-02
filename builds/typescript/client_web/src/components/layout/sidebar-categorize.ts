import type { ProjectFile } from "@/types/ui";

import {
  canonicalFileName,
  normalizePath,
  projectRelativePath,
  sidebarFileLabel,
  appDisplayLabel,
} from "./sidebar-labels";

export type SidebarFileItem = {
  file: ProjectFile;
  label: string;
  canonicalPath: string;
  badge?: string;
  overlayPath?: string;
};

export type SidebarAppEntry = {
  path: string;
  label: string;
  stateFile: ProjectFile | null;
};

export type SidebarFolderItem = {
  path: string;
  label: string;
  files: SidebarFileItem[];
};

export type ProjectSidebarModel = {
  goals: SidebarFileItem | null;
  plan: SidebarFileItem | null;
  apps: SidebarAppEntry[];
  files: SidebarFileItem[];
  advanced: SidebarFileItem[];
};

export type AppSidebarModel = {
  app: SidebarAppEntry;
  primary: SidebarFileItem[];
  folders: SidebarFolderItem[];
  files: SidebarFileItem[];
  advanced: SidebarFileItem[];
};

const KNOWN_APP_FOLDERS = new Set(["budget"]);

export function buildProjectSidebarModel(projectId: string, files: ProjectFile[]): ProjectSidebarModel {
  const items = files.map((file) => toFileItem(file, projectId, null));
  const appPaths = findAppPaths(projectId, files);
  const appPathSet = new Set(appPaths);
  const goals = items.find((item) => item.canonicalPath === "spec.md") ?? null;
  const plan = items.find((item) => item.canonicalPath === "plan.md") ?? null;
  const apps = appPaths.map((appPath) => buildAppEntry(projectId, appPath, files));
  const advanced: SidebarFileItem[] = [];
  const visibleFiles: SidebarFileItem[] = [];

  for (const item of items) {
    if (item === goals || item === plan) {
      continue;
    }

    const topLevel = item.canonicalPath.split("/")[0] ?? item.canonicalPath;
    const isInsideApp = item.canonicalPath.includes("/") && appPathSet.has(topLevel);

    if (isProjectAdvancedFile(item.canonicalPath)) {
      advanced.push(item);
      continue;
    }

    if (isInsideApp) {
      continue;
    }

    visibleFiles.push(withFileBadge(item));
  }

  return {
    goals,
    plan,
    apps,
    files: sortItems(visibleFiles),
    advanced: sortItems(advanced),
  };
}

export function buildAppSidebarModel(projectId: string, appPath: string, files: ProjectFile[]): AppSidebarModel {
  const normalizedAppPath = normalizePath(appPath);
  const app = buildAppEntry(projectId, normalizedAppPath, files);
  const appPrefix = `${normalizedAppPath}/`;
  const appRootName = normalizedAppPath.split("/").pop() ?? normalizedAppPath;
  const appRelativePaths = new Set(
    files
      .map((file) => projectRelativePath(file.path, projectId))
      .filter((relativePath) => relativePath.startsWith(appPrefix))
      .map((relativePath) => relativePath.slice(appPrefix.length))
  );
  const primary: SidebarFileItem[] = [];
  const folders = new Map<string, SidebarFileItem[]>();
  const visibleFiles: SidebarFileItem[] = [];
  const advanced: SidebarFileItem[] = [];

  for (const file of files) {
    const relativePath = projectRelativePath(file.path, projectId);
    if (!relativePath.startsWith(appPrefix)) {
      continue;
    }

    const appRelativePath = relativePath.slice(appPrefix.length);
    const item = toFileItem(file, projectId, normalizedAppPath);
    const [childFolder] = appRelativePath.split("/");

    if (isOverlayBackedByManagedBase(appRelativePath, appRelativePaths)) {
      continue;
    }

    if (
      appRelativePath === `${appRootName}.md` ||
      appRelativePath === "spec.md" ||
      appRelativePath === "plan.md"
    ) {
      primary.push(item);
      continue;
    }

    if (childFolder && appRelativePath.includes("/") && isAppFileFolder(childFolder)) {
      const folderFiles = folders.get(childFolder) ?? [];
      folderFiles.push(withFileBadge(item));
      folders.set(childFolder, folderFiles);
      continue;
    }

    if (isAppAdvancedFile(appRelativePath, appRootName)) {
      advanced.push(withAppAdvancedLabel(item, appRelativePath, appRootName));
      continue;
    }

    visibleFiles.push(withFileBadge(item));
  }

  return {
    app,
    primary: sortItems(primary),
    folders: [...folders.entries()]
      .map(([folderPath, folderFiles]) => ({
        path: `${normalizedAppPath}/${folderPath}`,
        label: appFolderLabel(normalizedAppPath, folderPath, folderFiles.length),
        files: sortItems(folderFiles),
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    files: sortItems(visibleFiles),
    advanced: sortItems(advanced),
  };
}

export function defaultAppFile(projectId: string, appPath: string, files: ProjectFile[]): ProjectFile | null {
  return buildAppEntry(projectId, appPath, files).stateFile;
}

function findAppPaths(projectId: string, files: ProjectFile[]): string[] {
  const folders = new Map<string, { hasAgent: boolean; hasState: boolean; known: boolean }>();

  for (const file of files) {
    const relativePath = projectRelativePath(file.path, projectId);
    const [folder, fileName] = relativePath.split("/");
    if (!folder || !fileName) {
      continue;
    }

    const current = folders.get(folder) ?? { hasAgent: false, hasState: false, known: false };
    current.hasAgent ||= fileName === "AGENT.md";
    current.hasState ||= fileName === `${folder}.md`;
    current.known ||= KNOWN_APP_FOLDERS.has(folder);
    folders.set(folder, current);
  }

  return [...folders.entries()]
    .filter(([, meta]) => meta.hasAgent || meta.hasState || meta.known)
    .map(([folder]) => folder)
    .sort((left, right) => appDisplayLabel(left).localeCompare(appDisplayLabel(right)));
}

function buildAppEntry(projectId: string, appPath: string, files: ProjectFile[]): SidebarAppEntry {
  const normalizedAppPath = normalizePath(appPath);
  const appRootName = normalizedAppPath.split("/").pop() ?? normalizedAppPath;
  const appFiles = files
    .filter((file) => projectRelativePath(file.path, projectId).startsWith(`${normalizedAppPath}/`))
    .sort((left, right) => projectRelativePath(left.path, projectId).localeCompare(projectRelativePath(right.path, projectId)));
  const stateFile =
    appFiles.find((file) => projectRelativePath(file.path, projectId) === `${normalizedAppPath}/${appRootName}.md`) ??
    appFiles.find((file) => projectRelativePath(file.path, projectId) === `${normalizedAppPath}/AGENT.md`) ??
    appFiles[0] ??
    null;

  return {
    path: normalizedAppPath,
    label: appDisplayLabel(normalizedAppPath),
    stateFile,
  };
}

function toFileItem(file: ProjectFile, projectId: string, appPath: string | null): SidebarFileItem {
  const canonicalPath = projectRelativePath(file.path, projectId);
  const overlayPath = overlayPathForManagedFile(file.path);
  return {
    file,
    label: sidebarFileLabel(file, projectId, appPath),
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

  if (relativePath.includes("/")) {
    return false;
  }

  return isManagedInstructionFile(fileName) || /-user\.md$/i.test(fileName);
}

function isAppAdvancedFile(appRelativePath: string, appRootName: string): boolean {
  const fileName = appRelativePath.split("/").pop() ?? appRelativePath;

  if (appRelativePath.includes("/")) {
    return fileName === "README.md" || fileName === "README-user.md";
  }

  if (fileName === `${appRootName}.md` || fileName === "spec.md" || fileName === "plan.md") {
    return false;
  }

  return isManagedInstructionFile(fileName) || /-user\.md$/i.test(fileName);
}

function isAppFileFolder(folderName: string): boolean {
  return folderName === "reports" || folderName === "statements" || folderName === "sources" || folderName === "files";
}

function appFolderLabel(appPath: string, folderName: string, fileCount: number): string {
  if (appPath === "budget" && folderName === "statements") {
    return `Budget statements (${fileCount})`;
  }
  if (appPath === "budget" && folderName === "reports") {
    return `Budget reports (${fileCount})`;
  }
  return `${titleCase(folderName)} (${fileCount})`;
}

function withAppAdvancedLabel(item: SidebarFileItem, appRelativePath: string, appRootName: string): SidebarFileItem {
  const fileName = appRelativePath.split("/").pop() ?? appRelativePath;
  if (fileName === "AGENT.md") {
    return { ...item, label: "AGENT.md" };
  }
  if (fileName === `${appRootName}-rules.md`) {
    return { ...item, label: "Your Rules" };
  }
  if (/^(create|compare|generate-report)\.md$/i.test(fileName)) {
    return { ...item, label: fileName };
  }
  return item;
}

function isOverlayBackedByManagedBase(appRelativePath: string, appRelativePaths: Set<string>): boolean {
  if (!/-user\.md$/i.test(appRelativePath)) {
    return false;
  }
  return appRelativePaths.has(appRelativePath.replace(/-user\.md$/i, ".md"));
}

function isManagedInstructionFile(fileName: string): boolean {
  if (fileName === "AGENT.md" || fileName === "README.md") {
    return true;
  }
  if (/-rules\.md$/i.test(fileName)) {
    return true;
  }
  return /^(create|compare|run-interview|run-planning|generate-report)\.md$/i.test(fileName);
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

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}
