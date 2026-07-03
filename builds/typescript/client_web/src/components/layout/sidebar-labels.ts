import type { ProjectFile } from "@/types/ui";
import {
  ROOT_AGENT_DISPLAY_NAME,
  ROOT_AGENT_PROJECT_ID,
  ROOT_AGENT_SHORT_LABEL,
  isRootAgentProjectId,
} from "@/lib/rootAgent";

const PROJECT_LABELS: Record<string, string> = {
  finance: "Your Finance",
  fitness: "Your Fitness",
  career: "Your Career",
  relationships: "Your Relationships",
  [ROOT_AGENT_PROJECT_ID]: ROOT_AGENT_DISPLAY_NAME,
};

const PROJECT_SHORT_LABELS: Record<string, string> = {
  finance: "Finance",
  fitness: "Fitness",
  career: "Career",
  relationships: "Relationships",
  [ROOT_AGENT_PROJECT_ID]: ROOT_AGENT_SHORT_LABEL,
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

  if (isRootAgentProjectId(normalizedId)) {
    return ROOT_AGENT_DISPLAY_NAME;
  }

  return PROJECT_SHORT_LABELS[normalizedId] ?? PROJECT_SHORT_LABELS[normalizedName] ?? titleCase(projectName);
}

export function projectShortLabel(projectId: string, projectName: string): string {
  const normalizedId = projectId.trim().toLowerCase();
  const normalizedName = projectName.trim().toLowerCase();
  return PROJECT_SHORT_LABELS[normalizedId] ?? PROJECT_SHORT_LABELS[normalizedName] ?? stripYourPrefix(titleCase(projectName));
}

export function sidebarFileLabel(file: ProjectFile, projectId: string): string {
  const relativePath = projectRelativePath(file.path, projectId);
  const fileName = relativePath.split("/").pop() ?? file.name;
  const baseName = fileName.replace(/\.md$/i, "");

  if (relativePath === "spec.md") {
    return "Your Goals";
  }

  if (relativePath === "plan.md") {
    return "Your Plan";
  }

  if (relativePath === "journal.md") {
    return "Your Journal";
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
