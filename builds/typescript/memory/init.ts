import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

import { bootstrapSkillsFromStarterPack, MemorySkillStore } from "./skills.js";
import { resolveMemoryPath, toMemoryRelativePath } from "./paths.js";

export type MemoryInitProfile = "local-dev" | "openrouter-secret-ref" | "braindrive-managed-secret-ref";

export type MemoryInitOptions = {
  profile?: MemoryInitProfile;
  seedDefaultProjects?: boolean;
  force?: boolean;
  dryRun?: boolean;
};

export type MemoryInitSummary = {
  profile: MemoryInitProfile;
  dry_run: boolean;
  starter_pack_dir: string | null;
  created: string[];
  updated: string[];
  skipped: string[];
  warnings: string[];
  seeded_projects: string[];
  seeded_skills: string[];
  skipped_skills: string[];
};

export type ProjectManifestEntry = {
  id: string;
  name: string;
  icon: string;
  conversation_id: string | null;
  default_skill_ids: string[];
};

const STARTER_PACK_ENV = "PAA_STARTER_PACK_DIR";
const STARTER_PACK_RELATIVE_PATH = "memory/starter-pack";

const ROOT_DIRECTORIES = ["conversations", "documents", "preferences", "exports", "skills"];
const ROOT_AGENT_RELATIVE_PATH = "AGENT.md";
const PREFERENCES_RELATIVE_PATH = "preferences/default.json";
const CONVERSATIONS_INDEX_RELATIVE_PATH = "conversations/index.json";
const PROJECTS_MANIFEST_RELATIVE_PATH = "documents/projects.json";
const PROJECTS_SEEDED_MARKER_RELATIVE_PATH = "preferences/projects-seeded-v1.json";

const PROJECT_TEMPLATE_FILES = ["AGENT.md", "spec.md", "plan.md"] as const;
const PROJECTS_SEED_RELATIVE_PATH = "projects/projects.seed.json";
const PROJECT_TEMPLATES_ROOT_RELATIVE_PATH = "projects/templates";

const PROTECTED_PROJECT_IDS = new Set(["braindrive-plus-one"]);

const FALLBACK_PROJECT_SEEDS: Array<{ id: string; name: string; icon: string }> = [
  { id: "braindrive-plus-one", name: "BrainDrive+1", icon: "sparkles" },
  { id: "career", name: "Career", icon: "briefcase" },
  { id: "relationships", name: "Relationships", icon: "users" },
  { id: "fitness", name: "Fitness", icon: "dumbbell" },
  { id: "finance", name: "Finance", icon: "dollar-sign" },
  { id: "new-project", name: "Your New Project", icon: "folder-plus" },
];

const FALLBACK_CONVERSATIONS_INDEX = {
  conversations: [],
};

const FALLBACK_LOCAL_DEV_PREFERENCES = {
  default_model: "llama3.1",
  approval_mode: "auto-approve",
  secret_resolution: {
    on_missing: "fail_closed",
  },
};

const FALLBACK_OPENROUTER_SECRET_REF_PREFERENCES = {
  default_model: "anthropic/claude-haiku-4.5",
  approval_mode: "auto-approve",
  active_provider_profile: "openrouter",
  provider_credentials: {
    openrouter: {
      mode: "secret_ref",
      secret_ref: "provider/openrouter/api_key",
      required: true,
    },
  },
  secret_resolution: {
    on_missing: "fail_closed",
  },
};

const FALLBACK_BRAINDRIVE_MANAGED_SECRET_REF_PREFERENCES = {
  default_model: "claude-haiku-4-5",
  approval_mode: "auto-approve",
  active_provider_profile: "braindrive-models",
  provider_credentials: {
    "braindrive-models": {
      mode: "secret_ref",
      secret_ref: "provider/ai-gateway/api_key",
      required: true,
    },
  },
  provider_base_urls: {
    "braindrive-models": process.env.BD_MANAGED_LITELLM_BASE || "http://host.docker.internal:4002/v1",
  },
  secret_resolution: {
    on_missing: "fail_closed",
  },
};

export function isProtectedProjectId(projectId: string): boolean {
  return PROTECTED_PROJECT_IDS.has(projectId.trim().toLowerCase());
}

export async function initializeMemoryLayout(
  rootDir: string,
  memoryRoot: string,
  options: MemoryInitOptions = {}
): Promise<MemoryInitSummary> {
  const profile = normalizeProfile(options.profile);
  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;
  const seedDefaultProjects = options.seedDefaultProjects ?? true;
  const absoluteMemoryRoot = path.resolve(memoryRoot);
  const starterPackDir = await resolveStarterPackDir(rootDir);

  const summary: MemoryInitSummary = {
    profile,
    dry_run: dryRun,
    starter_pack_dir: starterPackDir,
    created: [],
    updated: [],
    skipped: [],
    warnings: [],
    seeded_projects: [],
    seeded_skills: [],
    skipped_skills: [],
  };

  await ensureDirectory(absoluteMemoryRoot, absoluteMemoryRoot, summary, dryRun);
  for (const directory of ROOT_DIRECTORIES) {
    await ensureDirectory(path.join(absoluteMemoryRoot, directory), absoluteMemoryRoot, summary, dryRun);
  }

  await ensureFileFromTemplate(
    absoluteMemoryRoot,
    ROOT_AGENT_RELATIVE_PATH,
    starterPackDir ? path.join(starterPackDir, "base", "AGENT.md") : null,
    fallbackRootAgentPrompt(),
    force,
    dryRun,
    summary
  );

  await ensureFileFromTemplate(
    absoluteMemoryRoot,
    PREFERENCES_RELATIVE_PATH,
    starterPackDir ? path.join(starterPackDir, "base", "preferences", `default.${profile}.json`) : null,
    fallbackPreferencesByProfile(profile),
    force,
    dryRun,
    summary
  );

  await ensureFileFromTemplate(
    absoluteMemoryRoot,
    CONVERSATIONS_INDEX_RELATIVE_PATH,
    null,
    `${JSON.stringify(FALLBACK_CONVERSATIONS_INDEX, null, 2)}\n`,
    false,
    dryRun,
    summary
  );

  await ensureProjectsManifestAndDefaults(
    rootDir,
    absoluteMemoryRoot,
    starterPackDir,
    seedDefaultProjects,
    force,
    dryRun,
    summary
  );

  if (dryRun) {
    summary.skipped.push("skills/bootstrap (dry-run)");
  } else {
    const skillStore = new MemorySkillStore(absoluteMemoryRoot);
    await skillStore.ensureLayout();
    const bootstrap = await bootstrapSkillsFromStarterPack(rootDir, absoluteMemoryRoot);
    summary.seeded_skills = bootstrap.seeded;
    summary.skipped_skills = bootstrap.skipped;
    if (!bootstrap.source_dir) {
      summary.warnings.push("Starter skills source not found; no skills were seeded");
    }
  }

  return summary;
}

export async function scaffoldProjectFiles(
  rootDir: string,
  memoryRoot: string,
  projectId: string,
  projectName: string,
  options: {
    templateId?: string;
    force?: boolean;
    dryRun?: boolean;
    summary?: MemoryInitSummary;
  } = {}
): Promise<{ template_id: string; starter_pack_dir: string | null }> {
  const absoluteMemoryRoot = path.resolve(memoryRoot);
  const summary = options.summary ?? createDetachedSummary();
  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;
  const starterPackDir = await resolveStarterPackDir(rootDir);
  const templateId = await resolveTemplateId(starterPackDir, options.templateId ?? projectId);

  await ensureDirectory(resolveMemoryPath(absoluteMemoryRoot, `documents/${projectId}`), absoluteMemoryRoot, summary, dryRun);

  for (const templateFile of PROJECT_TEMPLATE_FILES) {
    const relativePath = `documents/${projectId}/${templateFile}`;
    const templatePath = starterPackDir
      ? path.join(starterPackDir, PROJECT_TEMPLATES_ROOT_RELATIVE_PATH, templateId, templateFile)
      : null;
    const fallbackContent = fallbackProjectTemplateContent(projectName, templateFile);
    await ensureFileFromTemplate(
      absoluteMemoryRoot,
      relativePath,
      templatePath,
      fallbackContent,
      force,
      dryRun,
      summary
    );
  }

  return {
    template_id: templateId,
    starter_pack_dir: starterPackDir,
  };
}

function createDetachedSummary(): MemoryInitSummary {
  return {
    profile: "local-dev",
    dry_run: false,
    starter_pack_dir: null,
    created: [],
    updated: [],
    skipped: [],
    warnings: [],
    seeded_projects: [],
    seeded_skills: [],
    skipped_skills: [],
  };
}

async function ensureProjectsManifestAndDefaults(
  rootDir: string,
  memoryRoot: string,
  starterPackDir: string | null,
  seedDefaultProjects: boolean,
  force: boolean,
  dryRun: boolean,
  summary: MemoryInitSummary
): Promise<void> {
  const manifestAbsolutePath = resolveMemoryPath(memoryRoot, PROJECTS_MANIFEST_RELATIVE_PATH);
  const markerAbsolutePath = resolveMemoryPath(memoryRoot, PROJECTS_SEEDED_MARKER_RELATIVE_PATH);
  const manifestExisted = await pathExists(manifestAbsolutePath);
  let projects = manifestExisted ? await readProjectManifest(manifestAbsolutePath, summary) : [];

  if (!manifestExisted) {
    if (dryRun) {
      summary.created.push(PROJECTS_MANIFEST_RELATIVE_PATH);
    } else {
      await writeFile(manifestAbsolutePath, "[]\n", "utf8");
      summary.created.push(PROJECTS_MANIFEST_RELATIVE_PATH);
    }
  }

  const markerExists = await pathExists(markerAbsolutePath);
  const shouldAttemptSeed = seedDefaultProjects && (!markerExists || force);
  let manifestChanged = false;

  if (shouldAttemptSeed) {
    const defaultProjects = await loadDefaultProjectsSeed(starterPackDir, summary);
    if (projects.length === 0 || force) {
      const byId = new Map(projects.map((project) => [project.id, project]));
      for (const project of defaultProjects) {
        if (byId.has(project.id)) {
          continue;
        }

        const entry: ProjectManifestEntry = {
          id: project.id,
          name: project.name,
          icon: project.icon,
          conversation_id: null,
          default_skill_ids: [],
        };
        projects.push(entry);
        byId.set(project.id, entry);
        summary.seeded_projects.push(project.id);
        manifestChanged = true;

        await scaffoldProjectFiles(rootDir, memoryRoot, project.id, project.name, {
          templateId: project.id,
          force: false,
          dryRun,
          summary,
        });
      }
    }

    if (!markerExists) {
      const markerPayload = {
        seeded_at: new Date().toISOString(),
        seeded_count: summary.seeded_projects.length,
      };
      if (dryRun) {
        summary.created.push(PROJECTS_SEEDED_MARKER_RELATIVE_PATH);
      } else {
        await writeFile(markerAbsolutePath, `${JSON.stringify(markerPayload, null, 2)}\n`, "utf8");
        summary.created.push(PROJECTS_SEEDED_MARKER_RELATIVE_PATH);
      }
    }
  }

  if (manifestChanged || !manifestExisted) {
    const normalized = sortProjects(projects);
    if (dryRun) {
      if (!manifestExisted) {
        summary.skipped.push(`${PROJECTS_MANIFEST_RELATIVE_PATH} (dry-run write skipped)`);
      } else {
        summary.updated.push(PROJECTS_MANIFEST_RELATIVE_PATH);
      }
      return;
    }

    await writeFile(manifestAbsolutePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    if (manifestExisted) {
      summary.updated.push(PROJECTS_MANIFEST_RELATIVE_PATH);
    }
  } else {
    summary.skipped.push(PROJECTS_MANIFEST_RELATIVE_PATH);
  }
}

async function ensureDirectory(
  absolutePath: string,
  memoryRoot: string,
  summary: MemoryInitSummary,
  dryRun: boolean
): Promise<void> {
  if (await pathExists(absolutePath)) {
    summary.skipped.push(toMemoryPathForSummary(memoryRoot, absolutePath));
    return;
  }

  if (dryRun) {
    summary.created.push(toMemoryPathForSummary(memoryRoot, absolutePath));
    return;
  }

  await mkdir(absolutePath, { recursive: true });
  summary.created.push(toMemoryPathForSummary(memoryRoot, absolutePath));
}

async function ensureFileFromTemplate(
  memoryRoot: string,
  relativePath: string,
  templatePath: string | null,
  fallbackContent: string,
  force: boolean,
  dryRun: boolean,
  summary: MemoryInitSummary
): Promise<void> {
  const absolutePath = resolveMemoryPath(memoryRoot, relativePath);
  const exists = await pathExists(absolutePath);

  if (exists && !force) {
    summary.skipped.push(relativePath);
    return;
  }

  const template = await readTemplateContent(templatePath);
  if (!template && templatePath) {
    summary.warnings.push(`Missing template: ${templatePath}`);
  }
  const content = normalizeFileContent(template ?? fallbackContent);

  if (dryRun) {
    if (exists) {
      summary.updated.push(relativePath);
    } else {
      summary.created.push(relativePath);
    }
    return;
  }

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
  if (exists) {
    summary.updated.push(relativePath);
  } else {
    summary.created.push(relativePath);
  }
}

async function readTemplateContent(templatePath: string | null): Promise<string | null> {
  if (!templatePath) {
    return null;
  }

  try {
    return await readFile(templatePath, "utf8");
  } catch {
    return null;
  }
}

function normalizeFileContent(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

async function resolveStarterPackDir(rootDir: string): Promise<string | null> {
  const envOverride = process.env[STARTER_PACK_ENV]?.trim();
  const candidates = [
    envOverride,
    path.resolve(rootDir, STARTER_PACK_RELATIVE_PATH),
  ].filter((value): value is string => Boolean(value && value.length > 0));

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function resolveTemplateId(starterPackDir: string | null, requestedTemplateId: string): Promise<string> {
  if (!starterPackDir) {
    return "new-project";
  }

  const directPath = path.join(starterPackDir, PROJECT_TEMPLATES_ROOT_RELATIVE_PATH, requestedTemplateId);
  if (await pathExists(directPath)) {
    return requestedTemplateId;
  }

  return "new-project";
}

async function loadDefaultProjectsSeed(
  starterPackDir: string | null,
  summary: MemoryInitSummary
): Promise<Array<{ id: string; name: string; icon: string }>> {
  if (!starterPackDir) {
    return FALLBACK_PROJECT_SEEDS;
  }

  const seedPath = path.join(starterPackDir, PROJECTS_SEED_RELATIVE_PATH);
  try {
    const raw = await readFile(seedPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      summary.warnings.push(`Invalid projects seed format: ${seedPath}`);
      return FALLBACK_PROJECT_SEEDS;
    }

    const normalized = parsed
      .map(parseProjectSeedEntry)
      .filter((entry): entry is { id: string; name: string; icon: string } => entry !== null);
    if (normalized.length === 0) {
      summary.warnings.push(`Projects seed has no valid entries: ${seedPath}`);
      return FALLBACK_PROJECT_SEEDS;
    }
    return normalized;
  } catch {
    summary.warnings.push(`Projects seed not found or unreadable: ${seedPath}`);
    return FALLBACK_PROJECT_SEEDS;
  }
}

function parseProjectSeedEntry(value: unknown): { id: string; name: string; icon: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  const icon = typeof entry.icon === "string" ? entry.icon.trim() : "";
  if (!id || !name || !icon) {
    return null;
  }
  return {
    id: id.toLowerCase(),
    name,
    icon,
  };
}

async function readProjectManifest(manifestPath: string, summary: MemoryInitSummary): Promise<ProjectManifestEntry[]> {
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      summary.warnings.push(`Project manifest is not an array: ${manifestPath}`);
      return [];
    }
    return parsed
      .map(parseProjectManifestEntry)
      .filter((entry): entry is ProjectManifestEntry => entry !== null);
  } catch {
    summary.warnings.push(`Project manifest unreadable: ${manifestPath}`);
    return [];
  }
}

function parseProjectManifestEntry(value: unknown): ProjectManifestEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const icon = typeof record.icon === "string" ? record.icon.trim() : "";
  const conversationId = record.conversation_id;
  const defaultSkillIds = record.default_skill_ids;

  if (!id || !name || !icon) {
    return null;
  }

  if (conversationId !== null && conversationId !== undefined && typeof conversationId !== "string") {
    return null;
  }

  if (defaultSkillIds !== undefined && !Array.isArray(defaultSkillIds)) {
    return null;
  }

  return {
    id: id.toLowerCase(),
    name,
    icon,
    conversation_id: typeof conversationId === "string" ? conversationId : null,
    default_skill_ids: Array.isArray(defaultSkillIds)
      ? dedupeStrings(defaultSkillIds.filter((entry): entry is string => typeof entry === "string"))
      : [],
  };
}

function sortProjects(projects: ProjectManifestEntry[]): ProjectManifestEntry[] {
  return [...projects];
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function toMemoryPathForSummary(memoryRoot: string, absolutePath: string): string {
  if (path.resolve(memoryRoot) === path.resolve(absolutePath)) {
    return ".";
  }
  return toMemoryRelativePath(path.resolve(memoryRoot), path.resolve(absolutePath));
}

function normalizeProfile(profile: MemoryInitProfile | undefined): MemoryInitProfile {
  if (profile === "openrouter-secret-ref" || profile === "braindrive-managed-secret-ref") {
    return profile;
  }
  return "local-dev";
}

function fallbackPreferencesByProfile(profile: MemoryInitProfile): string {
  let value;
  if (profile === "braindrive-managed-secret-ref") {
    value = FALLBACK_BRAINDRIVE_MANAGED_SECRET_REF_PREFERENCES;
  } else if (profile === "openrouter-secret-ref") {
    value = FALLBACK_OPENROUTER_SECRET_REF_PREFERENCES;
  } else {
    value = FALLBACK_LOCAL_DEV_PREFERENCES;
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fallbackRootAgentPrompt(): string {
  return [
    "You are PAA MVP, a terminal-first planning agent.",
    "The owner interacts through chat only.",
    "Use the available tools to create folders and owned documents inside the memory root.",
    "For explicit user commands to read/list/write/edit/delete files, execute the matching tool directly rather than asking for an extra confirmation message.",
    "For mutating actions, perform only the explicitly requested changes and avoid extra cleanup or deletion steps unless the user requested them.",
    "When writes are needed, request approval through the contract-visible approval flow before any mutating tool executes.",
    "When asked to create a project folder, produce AGENT.md, spec.md, and plan.md inside that folder unless the user asks for a smaller subset.",
    "For project discovery requests, prefer project_list and report projects from documents scope only.",
    "If the user asks to remember something for this chat, keep it in conversational context for this session without requiring file storage.",
    "Only ask for a safe explicit destination when the user asks to persist information into memory files.",
    "Do not claim prior-session facts unless you retrieved supporting evidence in the current interaction.",
    "Do not store secrets in normal memory files unless the user gives a safe, explicit destination and asks for it.",
    "Prefer concise, auditable outputs that match the owner's request.",
  ].join("\n");
}

function fallbackProjectTemplateContent(projectName: string, fileName: (typeof PROJECT_TEMPLATE_FILES)[number]): string {
  if (fileName === "AGENT.md") {
    return [
      `# ${projectName} - Agent Context`,
      "",
      "You are the project partner for this project.",
      "",
      "## First Session",
      "",
      "1. Clarify the owner's desired outcome.",
      "2. Clarify current reality and constraints.",
      "3. Produce a practical spec and plan with one immediate action.",
      "",
      "## Rules",
      "",
      "1. Keep guidance concrete and specific.",
      "2. Update project files as context improves.",
      "",
    ].join("\n");
  }

  if (fileName === "spec.md") {
    return [
      `# ${projectName} Spec`,
      "",
      "## Desired Outcome",
      "",
      "- Define what success looks like.",
      "",
      "## Current State",
      "",
      "- Record what is true now.",
      "",
      "## Gaps",
      "",
      "- Capture what is missing or unclear.",
      "",
    ].join("\n");
  }

  return [
    `# ${projectName} Plan`,
    "",
    "## Today",
    "",
    "1. Complete one high-leverage action.",
    "",
    "## This Week",
    "",
    "1. Build momentum with practical follow-on steps.",
    "",
  ].join("\n");
}
