export const ROOT_AGENT_CANONICAL_ID = "your-agent";
export const ROOT_AGENT_LEGACY_IDS = ["braindrive-plus-one"] as const;
export const ROOT_AGENT_DISPLAY_NAME = "Your Agent";
export const ROOT_AGENT_ICON = "sparkles";
export const ROOT_AGENT_TEMPLATE_ID = "your-agent";

const ROOT_AGENT_ID_SET = new Set<string>([
  ROOT_AGENT_CANONICAL_ID,
  ...ROOT_AGENT_LEGACY_IDS,
]);
const ROOT_AGENT_LEGACY_ID_SET = new Set<string>(ROOT_AGENT_LEGACY_IDS);

export type RootAgentProjectSeed = {
  id: string;
  name: string;
  icon: string;
};

export function normalizeProjectId(projectId: string): string {
  return projectId.trim().toLowerCase();
}

export function isRootAgentProjectId(projectId: string): boolean {
  return ROOT_AGENT_ID_SET.has(normalizeProjectId(projectId));
}

export function isLegacyRootAgentProjectId(projectId: string): boolean {
  return ROOT_AGENT_LEGACY_ID_SET.has(normalizeProjectId(projectId));
}

export function canonicalizeRootAgentProjectId(projectId: string): string {
  const normalized = normalizeProjectId(projectId);
  return isRootAgentProjectId(normalized) ? ROOT_AGENT_CANONICAL_ID : normalized;
}

export function rootAgentTemplateIdForProjectId(projectId: string): string {
  return isRootAgentProjectId(projectId)
    ? ROOT_AGENT_TEMPLATE_ID
    : normalizeProjectId(projectId);
}

export function rootAgentProjectSeed(): RootAgentProjectSeed {
  return {
    id: ROOT_AGENT_CANONICAL_ID,
    name: ROOT_AGENT_DISPLAY_NAME,
    icon: ROOT_AGENT_ICON,
  };
}
