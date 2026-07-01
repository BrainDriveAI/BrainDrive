import type { Project } from "@/types/ui";

export const ROOT_AGENT_PROJECT_ID = "your-agent";
export const ROOT_AGENT_LEGACY_PROJECT_IDS = ["braindrive-plus-one"] as const;
export const ROOT_AGENT_DISPLAY_NAME = "Your Agent";
export const ROOT_AGENT_SHORT_LABEL = "Agent";
export const ROOT_AGENT_ICON = "sparkles";

const ROOT_AGENT_PROJECT_ID_SET = new Set<string>([
  ROOT_AGENT_PROJECT_ID,
  ...ROOT_AGENT_LEGACY_PROJECT_IDS,
]);

export function normalizeProjectId(projectId: string): string {
  return projectId.trim().toLowerCase();
}

export function isRootAgentProjectId(projectId: string | null | undefined): boolean {
  return typeof projectId === "string" && ROOT_AGENT_PROJECT_ID_SET.has(normalizeProjectId(projectId));
}

export function canonicalizeRootAgentProjectId(projectId: string): string {
  const normalized = normalizeProjectId(projectId);
  return isRootAgentProjectId(normalized) ? ROOT_AGENT_PROJECT_ID : normalized;
}

export function normalizeRootAgentProject(project: Project): Project {
  if (!isRootAgentProjectId(project.id)) {
    return project;
  }

  return {
    ...project,
    id: ROOT_AGENT_PROJECT_ID,
    name: ROOT_AGENT_DISPLAY_NAME,
    icon: ROOT_AGENT_ICON,
  };
}

export function normalizeRootAgentProjects(projects: Project[]): Project[] {
  const normalizedProjects = projects.map(normalizeRootAgentProject);
  const rootAgentProjects = normalizedProjects.filter((project) => project.id === ROOT_AGENT_PROJECT_ID);
  if (rootAgentProjects.length <= 1) {
    return normalizedProjects;
  }

  const primaryRootAgent = rootAgentProjects.find((project) => project.conversationId) ?? rootAgentProjects[0]!;
  return [
    primaryRootAgent,
    ...normalizedProjects.filter((project) => project.id !== ROOT_AGENT_PROJECT_ID),
  ];
}
