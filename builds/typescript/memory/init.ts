import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

import { bootstrapSkillsFromStarterPack, MemorySkillStore } from "./skills.js";
import { resolveMemoryPath, toMemoryRelativePath } from "./paths.js";
import { defaultFolderIndexContent } from "./folder-index.js";

export type MemoryInitProfile = "local-dev" | "openrouter-secret-ref" | "braindrive-managed-secret-ref";

export type MemoryInitOptions = {
  profile?: MemoryInitProfile;
  seedDefaultProjects?: boolean;
  seedStarterSkills?: boolean;
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
const TODO_RELATIVE_PATH = "me/todo.md";
const CONVERSATIONS_INDEX_RELATIVE_PATH = "conversations/index.json";
const PROJECTS_MANIFEST_RELATIVE_PATH = "documents/projects.json";
const PROJECTS_SEEDED_MARKER_RELATIVE_PATH = "preferences/projects-seeded-v1.json";

const PROJECT_TEMPLATE_FILES = ["AGENT.md", "index.md", "spec.md", "plan.md"] as const;
const FINANCE_PROJECT_TEMPLATE_FILES = [
  "run-interview.md",
  "run-planning.md",
  "budget/AGENT.md",
  "budget/budget.md",
  "budget/budget-rules.md",
  "budget/create.md",
  "budget/compare.md",
  "statements/README.md",
  "reports/README.md",
] as const;
const FITNESS_PROJECT_TEMPLATE_FILES = [
  "health-docs/index.md",
  "health-docs/intake-and-disclaimer.md",
  "health-docs/relevance-and-routing.md",
  "health-docs/interpretation-voice.md",
  "health-docs/conflict-and-staleness.md",
  "health-docs/update-existing-plan.md",
] as const;
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
  default_model: "claude-haiku-4-5-20251001",
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
  const seedStarterSkills = options.seedStarterSkills ?? true;
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
    TODO_RELATIVE_PATH,
    starterPackDir ? path.join(starterPackDir, "base", "me", "todo.md") : null,
    fallbackTodoSeed(),
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

  if (!seedStarterSkills) {
    summary.skipped.push("skills/bootstrap (disabled)");
  } else if (dryRun) {
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

  const baseTemplateFiles = projectId === "finance" || templateId === "finance"
    ? PROJECT_TEMPLATE_FILES.filter((templateFile) => templateFile !== "index.md")
    : PROJECT_TEMPLATE_FILES;

  for (const templateFile of baseTemplateFiles) {
    await ensureProjectTemplateFile(
      absoluteMemoryRoot,
      starterPackDir,
      templateId,
      projectId,
      projectName,
      templateFile,
      force,
      dryRun,
      summary
    );
  }

  if (projectId === "finance" || templateId === "finance") {
    await ensureDirectory(resolveMemoryPath(absoluteMemoryRoot, `documents/${projectId}/statements`), absoluteMemoryRoot, summary, dryRun);
    await ensureDirectory(resolveMemoryPath(absoluteMemoryRoot, `documents/${projectId}/reports`), absoluteMemoryRoot, summary, dryRun);
    await ensureDirectory(resolveMemoryPath(absoluteMemoryRoot, `documents/${projectId}/budget`), absoluteMemoryRoot, summary, dryRun);
    for (const templateFile of FINANCE_PROJECT_TEMPLATE_FILES) {
      await ensureProjectTemplateFile(
        absoluteMemoryRoot,
        starterPackDir,
        "finance",
        projectId,
        projectName,
        templateFile,
        force,
        dryRun,
        summary
      );
    }
  }

  if (projectId === "fitness" || templateId === "fitness") {
    for (const templateFile of FITNESS_PROJECT_TEMPLATE_FILES) {
      await ensureProjectTemplateFile(
        absoluteMemoryRoot,
        starterPackDir,
        "fitness",
        projectId,
        projectName,
        templateFile,
        force,
        dryRun,
        summary
      );
    }
  }

  return {
    template_id: templateId,
    starter_pack_dir: starterPackDir,
  };
}

async function ensureProjectTemplateFile(
  absoluteMemoryRoot: string,
  starterPackDir: string | null,
  templateId: string,
  projectId: string,
  projectName: string,
  templateFile: string,
  force: boolean,
  dryRun: boolean,
  summary: MemoryInitSummary
): Promise<void> {
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
    "When asked to create a project folder, produce AGENT.md, index.md, spec.md, and plan.md inside that folder unless the user asks for a smaller subset.",
    "Read index.md in the current project folder when it exists. It summarizes uploaded and supporting documents so you can decide what to read.",
    "For project discovery requests, prefer project_list and report projects from documents scope only.",
    "If the user asks to remember something for this chat, keep it in conversational context for this session without requiring file storage.",
    "Only ask for a safe explicit destination when the user asks to persist information into memory files.",
    "Do not claim prior-session facts unless you retrieved supporting evidence in the current interaction.",
    "Do not store secrets in normal memory files unless the user gives a safe, explicit destination and asks for it.",
    "Prefer concise, auditable outputs that match the owner's request.",
  ].join("\n");
}

function fallbackTodoSeed(): string {
  return [
    "# My Todos",
    "",
    '> **Format:** `- [ ] Task title #tag` — tag is optional. Priority = position (top = most important).',
    ">",
    "> **How to manage this file:**",
    "> - **Add:** New tasks go under ## Active. In a project conversation, auto-tag with that project (e.g., `#finance`).",
    "> - **Complete:** Move the line from ## Active to ## Completed and change `[ ]` to `[x]`.",
    "> - **Delete:** Remove the line entirely.",
    "> - **List:** When asked, show tasks formatted. In BrainDrive+1: all tasks. In a project: only that project's tagged tasks.",
    '> - **Proactive:** When the owner says "I need to..." or "I should..." — add the task and tell them. Don\'t ask permission.',
    '> - **Post-interview:** Do NOT create tasks during interviews or while drafting the spec/plan — that\'s brainstorming, not commitment. Once the spec and plan are written, add the immediate action items from the plan as todos.',
    "> - **Pruning:** Keep max 25 completed items. Remove oldest when over.",
    "",
    "## Active",
    "",
    "## Completed",
    "",
  ].join("\n");
}

function fallbackProjectTemplateContent(projectName: string, fileName: string): string {
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

  if (fileName === "index.md") {
    return defaultFolderIndexContent();
  }

  if (fileName === "run-interview.md") {
    return [
      "# Finance Interview — Procedure",
      "",
      "*Procedure for filling out `spec.md`.*",
      "",
      "## Preservation Rule",
      "",
      "When updating `spec.md`, update sections in place and preserve the file structure.",
      "",
    ].join("\n");
  }

  if (fileName === "run-planning.md") {
    return [
      "# Finance Planning — Procedure",
      "",
      "*Procedure for filling out `plan.md`.*",
      "",
      "## Preservation Rule",
      "",
      "When updating `plan.md`, update sections in place and preserve the file structure.",
      "",
    ].join("\n");
  }

  if (fileName === "budget/AGENT.md") {
    return [
      "# Budget — Agent Context",
      "",
      "*Orient file for the Budget app. Read first whenever the owner invokes anything budget-related.*",
      "",
      "## Preservation Rule",
      "",
      "`budget.md` is the saved monthly spending plan. Preserve it unless the owner is explicitly creating, revising, or approving changes.",
      "",
      "## Procedures",
      "",
      "| Request | Read |",
      "|---|---|",
      "| Create or revise the saved budget | `create.md` |",
      "| Compare a month against the saved budget | `compare.md` |",
      "",
    ].join("\n");
  }

  if (fileName === "budget/budget.md") {
    return [
      "# Budget",
      "",
      "*Your saved monthly spending plan.*",
      "",
      "**Status:** Not configured — set monthly context and category limits to activate.",
      "",
      "**Last updated:** —",
      "",
      "## How to Use",
      "",
      "Tell your Finance agent when you want to create a budget, refresh one, or compare it against your spending. The agent reads this folder's `AGENT.md` to know how.",
      "",
      "## Monthly Context",
      "",
      "*The target month, expected income, and any savings or debt goals for the period.*",
      "",
      "| Field | Value | Notes |",
      "|---|---:|---|",
      "| Target month |  | YYYY-MM |",
      "| Expected income |  | Optional |",
      "| Savings goal |  | Optional |",
      "| Debt payoff goal |  | Optional |",
      "",
      "## Category Limits",
      "",
      "*Starter categories — replace, remove, or add to match your actual spending.*",
      "",
      "| Category | Monthly Limit | Notes |",
      "|---|---:|---|",
      "| Groceries |  |  |",
      "| Eating Out |  |  |",
      "| Transportation |  |  |",
      "| Subscriptions |  |  |",
      "| Shopping |  |  |",
      "| Fun |  |  |",
      "",
      "## Fixed Bills",
      "",
      "*Your predictable monthly commitments — rent, insurance, subscriptions, debt minimums.*",
      "",
      "| Bill | Amount | Due Day | Notes |",
      "|---|---:|---:|---|",
      "",
      "## Owner Notes",
      "",
      "*Anything else relevant — context, reminders, things you're testing.*",
      "",
      "-",
      "",
      "## Changelog",
      "",
      "Material changes to this budget — new category, revised limit, fixed bill added or removed, monthly context updated.",
      "",
    ].join("\n");
  }

  if (fileName === "budget/budget-rules.md") {
    return [
      "# Budget Rules",
      "",
      "*Owner-approved categorization, transaction-type, and exclusion rules for the Budget app.*",
      "",
      "## Instructions",
      "",
      "Use these owner-approved rules before making new categorization decisions. Ask before adding new rules.",
      "",
      "## Merchant Category Rules",
      "",
      "| Pattern | Category | Notes |",
      "|---|---|---|",
      "",
      "## Transaction Type Rules",
      "",
      "| Pattern | Type | Notes |",
      "|---|---|---|",
      "",
      "Allowed types: `expense`, `income`, `transfer`, `refund`, `fee`.",
      "",
      "## Exclusions",
      "",
      "| Pattern | Reason | Notes |",
      "|---|---|---|",
      "",
    ].join("\n");
  }

  if (fileName === "budget/create.md") {
    return [
      "# Create or Revise the Saved Budget",
      "",
      "*Workflow for creating a first budget or revising the saved one.*",
      "",
      "*Always read `AGENT.md` first for the Preservation Rule before writing to `budget.md`.*",
      "",
      "## Inputs",
      "",
      "Read `budget.md`, `budget-rules.md`, and broader Finance files when relevant.",
      "",
      "## Done Criteria",
      "",
      "- `budget.md` is updated in place.",
      "- Status, Last updated, and Changelog are current.",
      "",
    ].join("\n");
  }

  if (fileName === "budget/compare.md") {
    return [
      "# Compare a Month Against the Saved Budget",
      "",
      "*Workflow for producing a monthly comparison report.*",
      "",
      "*Always read `AGENT.md` first for the Preservation Rule. During this workflow, `budget.md` is read-only.*",
      "",
      "## Inputs",
      "",
      "Read `budget.md`, `budget-rules.md`, `../statements/README.md`, and `../reports/README.md`.",
      "",
      "## Done Criteria",
      "",
      "- `budget.md` is unchanged.",
      "- `../reports/latest.md` is written per the report contract.",
      "",
    ].join("\n");
  }

  if (fileName === "statements/README.md") {
    return [
      "# Statements — Source Folder",
      "",
      "*Reference for the `statements/` folder. Holds owner-uploaded financial statements.*",
      "",
      "Statements are read-only. Apps read the statement types they need.",
      "",
      "## File Conventions",
      "",
      "- Don't infer statement coverage period from filename alone.",
      "- Check for duplicate or overlapping source files before counting transactions.",
      "",
    ].join("\n");
  }

  if (fileName === "reports/README.md") {
    return [
      "# Reports — Output Contract",
      "",
      "*Contract for the `reports/` folder. Read this when writing or refreshing a report.*",
      "",
      "Generated reports from Finance apps. `latest.md` is a working cache; dated reports are durable archives.",
      "",
      "## Monthly Budget Comparison Contract",
      "",
      "Monthly comparison reports should include Summary, Source Coverage, Source Evidence Ledger, Owner-Requested Items Audit, Category Breakdown, New Or Unbudgeted Items, Excluded From Expense Totals, Needs Review, Next Actions, and Final Self-Check.",
      "",
    ].join("\n");
  }

  if (fileName === "health-docs/index.md") {
    return [
      "# Health Docs Instruction Index",
      "",
      "Use this file only after Fitness orientation has routed you to health-record handling.",
      "",
      "Health records are context for Fitness. Relevant details flow into `spec.md` and `plan.md`; do not create `fitness/health-context.md`.",
      "",
      "| Situation | Read |",
      "|---|---|",
      "| First health-doc upload | `intake-and-disclaimer.md`, `relevance-and-routing.md` |",
      "| In-interview health-doc prompt | `intake-and-disclaimer.md`, `interpretation-voice.md` |",
      "| Uploaded doc may not be health/fitness relevant | `relevance-and-routing.md` |",
      "| Health context conflicts with a stated goal | `conflict-and-staleness.md`, `interpretation-voice.md` |",
      "| Old or incomplete records | `conflict-and-staleness.md` |",
      "| Owner uploads new docs after a spec/plan exists | `update-existing-plan.md`, `interpretation-voice.md` |",
      "",
    ].join("\n");
  }

  if (fileName === "health-docs/intake-and-disclaimer.md") {
    return [
      "# Health Document Intake And Disclaimer",
      "",
      "Ask for health documents only when they could materially improve the Fitness plan: weight loss, energy, longevity, injury/recovery, medication, biomarkers, or unexplained limitations.",
      "",
      "Documents are optional. If the owner declines or does not have them, continue the Fitness interview normally.",
      "",
      "Give the boundary once: you can use records as Fitness context, but you are not diagnosing, prescribing, or replacing a clinician. Do not append disclaimer footers to every response.",
      "",
    ].join("\n");
  }

  if (fileName === "health-docs/relevance-and-routing.md") {
    return [
      "# Health Document Relevance And Routing",
      "",
      "Use uploaded documents as Fitness context only when they are relevant to the owner's Fitness goals, health constraints, or plan execution.",
      "",
      "Relevant examples include labs, doctor's notes, prescription lists, PT notes, imaging summaries, and fitness-tracker exports.",
      "",
      "Do not silently ingest irrelevant docs as Fitness context. If a document belongs in another project, say what it appears to be and offer routing.",
      "",
    ].join("\n");
  }

  if (fileName === "health-docs/interpretation-voice.md") {
    return [
      "# Health Interpretation Voice",
      "",
      "Be a knowledgeable friend who speculates carefully.",
      "",
      "Allowed: practical Fitness-level interpretation, likely constraints, cautious observations, and clinician confirmation for significant changes.",
      "",
      "Not allowed: diagnosing, prescribing, medication changes, symptom triage, differential diagnosis, treatment plans, or clinical certainty.",
      "",
    ].join("\n");
  }

  if (fileName === "health-docs/conflict-and-staleness.md") {
    return [
      "# Health Conflict And Staleness Rules",
      "",
      "When health context conflicts with a stated goal, surface the tension, explain the practical implication, and ask the owner to choose or refine.",
      "",
      "Treat stale records as weak context. Do not pretend old labs or old notes are current.",
      "",
      "Turn conflicts into practical plan constraints without making every concern a blocker.",
      "",
    ].join("\n");
  }

  if (fileName === "health-docs/update-existing-plan.md") {
    return [
      "# Updating An Existing Fitness Plan With New Health Docs",
      "",
      "Use this when the owner uploads new health documents after a Fitness `spec.md` or `plan.md` already exists.",
      "",
      "Summarize what changed for Fitness planning and ask whether the owner wants to update `spec.md` and `plan.md`. Do not update silently.",
      "",
      "If no spec or plan exists, offer to use the upload as context for the Fitness interview. Do not create `health-context.md`.",
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
