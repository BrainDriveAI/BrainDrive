import type { ProjectFile } from "@/types/ui";

const PROJECT_LABELS: Record<string, string> = {
  finance: "Your Finances",
  fitness: "Your Fitness",
  career: "Your Career",
  relationships: "Your Relationships",
  "braindrive-plus-one": "Your Agent",
};

const PROJECT_SHORT_LABELS: Record<string, string> = {
  finance: "Finances",
  fitness: "Fitness",
  career: "Career",
  relationships: "Relationships",
  "braindrive-plus-one": "Agent",
};

export function projectDisplayLabel(projectId: string, projectName: string): string {
  const normalizedId = projectId.trim().toLowerCase();
  const normalizedName = projectName.trim().toLowerCase();
  const baseLabel =
    PROJECT_LABELS[normalizedId] ??
    PROJECT_LABELS[normalizedName] ??
    titleCase(projectName);

  return ensureYourPrefix(baseLabel);
}

export function rootProjectDisplayLabel(projectId: string, projectName: string): string {
  const normalizedId = projectId.trim().toLowerCase();
  const normalizedName = projectName.trim().toLowerCase();

  if (normalizedId === "braindrive-plus-one") {
    return "Your Agent";
  }

  return PROJECT_SHORT_LABELS[normalizedId] ?? PROJECT_SHORT_LABELS[normalizedName] ?? titleCase(projectName);
}

export function projectShortLabel(projectId: string, projectName: string): string {
  const normalizedId = projectId.trim().toLowerCase();
  const normalizedName = projectName.trim().toLowerCase();
  return PROJECT_SHORT_LABELS[normalizedId] ?? PROJECT_SHORT_LABELS[normalizedName] ?? stripYourPrefix(titleCase(projectName));
}

export function appDisplayLabel(appPath: string): string {
  return `Your ${appShortLabel(appPath)}`;
}

export function appShortLabel(appPath: string): string {
  return titleCase(lastPathSegment(appPath));
}

export function sidebarFileLabel(file: ProjectFile, projectId: string, appPath?: string | null): string {
  const relativePath = projectRelativePath(file.path, projectId);
  const fileName = relativePath.split("/").pop() ?? file.name;
  const baseName = fileName.replace(/\.md$/i, "");

  if (file.ownerLabel && file.ownerLabel.trim().length > 0) {
    return file.ownerLabel.trim();
  }

  if (!appPath && relativePath === "spec.md") {
    return "Your Goals";
  }

  if (!appPath && relativePath === "plan.md") {
    return "Your Plan";
  }

  if (!appPath && relativePath === "index.md") {
    return projectId === "finance" ? "Finance Overview" : "Project Overview";
  }

  if (appPath) {
    const normalizedAppPath = normalizePath(appPath);
    const appRootName = lastPathSegment(normalizedAppPath);
    const appRelative = stripPrefix(relativePath, `${normalizedAppPath}/`) ?? relativePath;

    if (appRelative === `${appRootName}.md`) {
      return appDisplayLabel(normalizedAppPath);
    }

    if (appRelative === "spec.md") {
      return "Your Goals";
    }

    if (appRelative === "plan.md") {
      return "Your Plan";
    }

    if (appRelative === `${appRootName}-rules.md`) {
      return "Your Rules";
    }

    if (appRelative === `${appRootName}-rules-user.md`) {
      return "Your Custom Rules";
    }
  }

  if (fileName === "AGENT.md") {
    return "Agent Instructions";
  }

  if (fileName === "AGENT-user.md") {
    return "Your Agent Customization";
  }

  if (fileName === "README.md") {
    return "Folder Guide";
  }

  if (fileName === "README-user.md") {
    return "Your Folder Guide";
  }

  if (/roth\s*ira/i.test(baseName) || /rothira/i.test(baseName)) {
    const month = statementMonthFromText(baseName);
    return `Roth IRA Statement${month ? ` - ${month}` : ""}`;
  }

  if (/-user\.md$/i.test(fileName)) {
    return `Your ${titleCase(baseName.replace(/-user$/i, ""))}`;
  }

  if (/-rules\.md$/i.test(fileName)) {
    return "Rules";
  }

  if (/^run-/i.test(baseName)) {
    return titleCase(baseName.replace(/^run-/i, ""));
  }

  return titleCase(baseName);
}

function statementMonthFromText(value: string): string | null {
  const match = /\b(20\d{2})[-_ ]?(0[1-9]|1[0-2])\b/.exec(value);
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

export function canonicalFileName(file: ProjectFile): string {
  const pathValue = normalizePath(file.path);
  return pathValue.split("/").pop() ?? file.name;
}

export function projectRelativePath(filePath: string, projectId: string): string {
  const normalized = normalizePath(filePath);
  const documentsPrefix = `documents/${projectId}/`;
  const projectPrefix = `${projectId}/`;

  if (normalized.startsWith(documentsPrefix)) {
    return normalized.slice(documentsPrefix.length);
  }

  if (normalized.startsWith(projectPrefix)) {
    return normalized.slice(projectPrefix.length);
  }

  return normalized;
}

export function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function stripPrefix(value: string, prefix: string): string | null {
  return value.startsWith(prefix) ? value.slice(prefix.length) : null;
}

function lastPathSegment(value: string): string {
  const normalized = normalizePath(value);
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
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

function ensureYourPrefix(value: string): string {
  const label = value.trim();
  if (/^your\s+/i.test(label)) {
    return label;
  }
  return `Your ${label}`;
}

function stripYourPrefix(value: string): string {
  return value.replace(/^your\s+/i, "").trim();
}
