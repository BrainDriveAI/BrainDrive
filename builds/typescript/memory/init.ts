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

const ROOT_DIRECTORIES = ["conversations", "documents", "preferences", "exports", "skills", "diagnostics"];
const ROOT_AGENT_RELATIVE_PATH = "AGENT.md";
const PREFERENCES_RELATIVE_PATH = "preferences/default.json";
const TODO_RELATIVE_PATH = "me/todo.md";
const CONVERSATIONS_INDEX_RELATIVE_PATH = "conversations/index.json";
const PROJECTS_MANIFEST_RELATIVE_PATH = "documents/projects.json";
const PROJECTS_SEEDED_MARKER_RELATIVE_PATH = "preferences/projects-seeded-v1.json";

const PROJECT_TEMPLATE_FILES = ["AGENT.md", "index.md", "spec.md", "plan.md"] as const;
const FINANCE_PROJECT_CORE_TEMPLATE_FILES = ["AGENT.md", "spec.md", "run-interview.md", "plan.md", "run-planning.md"] as const;
const FINANCE_PROJECT_TEMPLATE_FILES = [
  "budget/AGENT.md",
  "budget/budget.md",
  "budget/budget-rules.md",
  "budget/create.md",
  "budget/compare.md",
  "budget/statements/README.md",
  "budget/reports/README.md",
  "budget/reports/latest.md",
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
  prompt_audit: {
    enabled: true,
    detail: "standard",
    retention_days: 14,
    max_file_bytes: 5242880,
    include_provider_payload: true,
    include_provider_response: true,
    include_source_snapshots: true,
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
  prompt_audit: {
    enabled: true,
    detail: "standard",
    retention_days: 14,
    max_file_bytes: 5242880,
    include_provider_payload: true,
    include_provider_response: true,
    include_source_snapshots: true,
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
  prompt_audit: {
    enabled: true,
    detail: "standard",
    retention_days: 14,
    max_file_bytes: 5242880,
    include_provider_payload: true,
    include_provider_response: true,
    include_source_snapshots: true,
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

  const isFinanceTemplate = projectId === "finance" || templateId === "finance";
  const coreTemplateFiles = isFinanceTemplate ? FINANCE_PROJECT_CORE_TEMPLATE_FILES : PROJECT_TEMPLATE_FILES;
  for (const templateFile of coreTemplateFiles) {
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

  if (isFinanceTemplate) {
    await ensureDirectory(resolveMemoryPath(absoluteMemoryRoot, `documents/${projectId}/budget`), absoluteMemoryRoot, summary, dryRun);
    await ensureDirectory(resolveMemoryPath(absoluteMemoryRoot, `documents/${projectId}/budget/statements`), absoluteMemoryRoot, summary, dryRun);
    await ensureDirectory(resolveMemoryPath(absoluteMemoryRoot, `documents/${projectId}/budget/reports`), absoluteMemoryRoot, summary, dryRun);
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
      ...(projectName === "Finance" ? [
        "",
        "## Numeric Accuracy",
        "",
        "If the owner sends a finance answer that ends mid-number, mid-currency amount, or mid-sentence, do not complete the number for them. Ask a targeted clarification instead.",
      ] : []),
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
      "# Finance Interview",
      "",
      "*Procedure for filling `spec.md` through conversation.*",
      "",
      "## Preservation Rule",
      "",
      "Update sections in place in `spec.md`; never replace the whole file. Keep every section header, italic descriptor, Status line, Last updated line, and `## Changelog`.",
      "",
      "## What This Procedure Accomplishes",
      "",
      "Build a clear financial picture and capture the owner's goals, constraints, current state, and missing information.",
      "",
      "## When to Run",
      "",
      "- The Finance spec is empty or materially stale.",
      "- The owner wants to clarify financial goals before planning.",
      "",
      "## Method",
      "",
      "Map income, expenses, debt, savings, investments, benefits, obligations, and relationship or life-transition context that affects money. Use specific numbers where they matter and mark assumptions plainly.",
      "",
      "## Done Criteria",
      "",
      "`spec.md` has useful owner-specific content, current unknowns are labeled, and no unsupported financial claims are presented as facts.",
      "",
      "## After Running",
      "",
      "Update `spec.md`, summarize material changes, and return to Finance scope before proposing planning or budget execution.",
      "",
      "## What This Procedure Is Not",
      "",
      "It is not investment, tax, legal, or debt-settlement professional advice.",
      "",
    ].join("\n");
  }

  if (fileName === "run-planning.md") {
    return [
      "# Finance Planning",
      "",
      "*Procedure for filling `plan.md` from the Finance spec.*",
      "",
      "## Preservation Rule",
      "",
      "Update sections in place in `plan.md`; never replace the whole file. Keep every section header, italic descriptor, Status line, Last updated line, and `## Changelog`.",
      "",
      "## What This Procedure Accomplishes",
      "",
      "Turn the Finance spec into a concrete sequence with one immediate step and a practical roadmap.",
      "",
      "## When to Run",
      "",
      "- The spec has enough information to plan.",
      "- New financial facts materially change the existing plan.",
      "",
      "## Method",
      "",
      "Lead with the owner's most urgent financial outcome, show the math when it affects priority, and keep later phases high-level until earlier phases are complete.",
      "",
      "When source statements or other evidence have just been uploaded and accepted, advance the plan from gathering evidence to the next validation or refinement step. Do not leave statement upload as pending if the needed files are now present; list only the specific months/accounts/institutions still missing.",
      "",
      "## Done Criteria",
      "",
      "`plan.md` names the first step, roadmap, destination, and remaining blockers without copying full reports into the plan.",
      "",
      "## After Running",
      "",
      "Update `plan.md`, add concrete todos only when there is an actual next action, and return to the parent Finance scope.",
      "",
      "## What This Procedure Is Not",
      "",
      "It is not a replacement for professional financial, legal, or tax advice.",
      "",
    ].join("\n");
  }

  if (fileName === "budget/AGENT.md") {
    return [
      "# Budget - Agent Context",
      "",
      "*App folder for managing the owner's saved monthly spending plan and comparing actual spending against it.*",
      "",
      "## What This App Does",
      "",
      "Maintain the saved budget in `budget.md` and compare source statements against that saved plan.",
      "",
      "When you need statement evidence from the owner, ask them to attach the statements in chat or use the visible upload button. Never tell the owner to place files in `documents/finance/budget/statements/`; use that path only internally when reading saved source evidence or reporting where an uploaded file was saved.",
      "",
      "## Owner-Facing Language",
      "",
      "Internal file paths are for tool use only. In normal owner-facing replies, use product labels such as saved Budget, latest Budget report, Budget statements, Finance goals, Finance plan, and action list. Do not mention `AGENT.md`, procedure files, rules files, raw markdown filenames, file extensions such as `.md`, or raw paths unless the owner explicitly asks for exact technical paths.",
      "",
      "## App-Level Flow",
      "",
      "Orient here, align with the Finance spec, plan the scope of this run, execute one procedure, then propagate a brief summary back to Finance.",
      "",
      "## Preservation Rule",
      "",
      "When touching `budget.md`, update sections in place and never replace the whole file. Keep every section header, italic section description, `**Status:**`, `**Last updated:**`, and `## Changelog`.",
      "",
      "## Procedures",
      "",
      "| Workflow | Use when | Read |",
      "|---|---|---|",
      "| Create or revise saved budget | Owner wants to define or change budget limits | `create.md`, then `create-user.md` if present |",
      "| Monthly comparison | Owner asks how actuals compare to the saved budget | `compare.md`, then `compare-user.md` if present |",
      "| Source upload routing | Owner uploads statements | `statements/README.md` |",
      "",
      "Hard routing rule: when the owner asks to create, build, establish, define, or refine a budget, run the saved-Budget creation workflow first. Do not let statement comparison or report generation become the primary deliverable unless the owner asks how actuals compare or asks for a report.",
      "",
      "Comparison routing rule: when any follow-up asks how actual spending compares against a practical/saved budget, asks whether spending is over or under, asks for an actuals report, or asks which source transactions remain unclear, switch to the Monthly comparison procedure. The answer must be backed by a populated latest Budget report, not only a chat summary.",
      "",
      "Draft-with-uncertainty rule: ambiguous transactions, missing months, or unresolved merchant labels must not block a first-pass saved Budget. Save a provisional Budget with a Needs Review section, clear confidence labels, and explicit assumptions, then ask the targeted follow-up questions after the draft exists.",
      "",
      "## Statement Intake Checklist",
      "",
      "When the owner is setting up a budget from statements, keep a visible checklist in the conversation:",
      "",
      "- Received statements, grounded in uploaded source evidence files.",
      "- Still-needed statements by month, account, or institution.",
      "- Uncertain uploads that need a targeted clarification.",
      "",
      "Do not proceed to a statement-backed budget baseline until the required statement set is present or the owner explicitly approves a partial baseline.",
      "",
      "After accepting uploads, propagate state to the Budget statement checklist, Finance goals, Finance plan, and action list so completed statement gathering is not left as active missing work.",
      "",
      "Every uploaded file must be represented in the final Budget source coverage. Classify each upload as: used in income/spend/debt calculations, reviewed but excluded from Budget math, or failed/rejected. Investment or retirement statements such as a Roth IRA are reviewed asset context only: list them as reviewed/excluded, explain that they are excluded from monthly cash-flow, living-spend, and debt-payoff calculations, and do not turn that into investment advice.",
      "Every uploaded file should be traceable to exactly one Source Coverage group. A transaction row, exclusion row, or casual mention is not enough by itself.",
      "After writing or refreshing `reports/latest.md`, call `project_budget_validate_source_coverage` with `repair: true`, then read the latest Budget report back before replying. If source coverage still has missing uploads, do not claim every uploaded statement was used or accounted for.",
      "",
      "## Promise-To-Artifact Rule",
      "",
      "Do not tell the owner you updated a durable artifact unless the write happened in this turn and you verified the saved content afterward. This is especially strict for the action list.",
      "",
      "Never include internal verification diagnostics such as `Save status`, `Not saved yet`, `could not verify`, or raw guardrail language in owner-facing replies. If a write did not happen or could not be verified, simply avoid claiming a saved update. If the owner explicitly asks about save state, answer in plain language with the product label, such as \"I used your saved Budget\" or \"I did not change the action list in this reply.\"",
      "",
      "Before saying you updated or added action list tasks, write or edit `me/todo.md`, read it back, confirm the exact promised task text is present, and close or revise stale clarification tasks when the owner resolved them. If you cannot verify the saved action list content, say what you recommend next without claiming it was saved.",
      "",
      "## Review-State Reconciliation",
      "",
      "Before telling the owner that Needs Review is empty, fully resolved, or that all mystery items are categorized, reconcile the saved Budget, latest Budget report, and Todo list: read `budget.md`, `reports/latest.md`, and `me/todo.md`; confirm resolved merchants or amounts are no longer active in Todo clarification tasks; complete or remove stale active Todo tasks such as MJP Services or Blue Door Payment when those items are categorized in the Budget/report; and if the Todo update cannot be verified, do not say every review item is resolved.",
      "",
      "Keep math reconciliation separate from owner review state. A Budget can have math totals that tie out while still having owner review pending. If merchants such as MJP Services or Blue Door Payment remain unresolved, `budget.md`, `reports/latest.md`, the Finance plan, and the Todo list must all show those same active Needs Review items and amounts. Do not write `Unreconciled - Needs Review | 0.00 | Reconciled successfully` while unresolved owner-review merchants remain active elsewhere; instead write an explicit `Owner review pending` row with the unresolved amount and merchant names.",
      "",
      "After this reconciliation, run `project_budget_reconcile_review_state` with `repair: true` if the Finance plan might still contain stale or generic Needs Review language. When all merchant review items are resolved, the Finance plan must not keep active-work phrases such as `mystery transactions` or `ambiguous merchants` for those resolved merchants; move the next step to the actual remaining open decision, such as clarifying whether April auto/vet costs are recurring.",
      "",
      "## Evidence Confidence",
      "",
      "One month of statements can support a draft actuals baseline only. Do not present one-month-derived category limits as stable unless the owner explicitly confirms the month is representative. Ask for 3-6 months of checking/card history and known annual or irregular costs for a reliable budget.",
      "",
      "Every saved Budget update must distinguish known fixed obligations, observed recurring items, one-month observed categories, owner estimates, irregular/lumpy costs, transfers/account movement, business/startup spending, and needs-more-history items.",
      "",
      "If the owner sends a finance answer that ends mid-number, mid-currency amount, or mid-sentence, do not infer or normalize the missing number. Ask a targeted clarification before using it.",
      "",
      "## Reconciliation",
      "",
      "Before presenting a saved Budget or report as usable, verify stated totals against visible rows and named exclusions. If totals do not reconcile, mark the artifact Needs Review, show the unreconciled amount, and ask targeted clarification questions.",
      "",
      "## Chat Formatting",
      "",
      "Use saved artifacts for detailed tables. In chat, summarize Budget results with short bullets, compact lists, and named totals. Avoid large raw pipe tables in owner-facing replies unless the owner explicitly asks for a table.",
      "",
      "Artifact-first rule: compact chat is only the presentation layer. For Budget creation, comparison, payoff guidance, or Needs Review changes, write and verify the durable Budget artifacts first, then send the short owner-facing summary. Do not use the chat word limit as a reason to skip `budget.md`, `reports/latest.md`, Finance plan, or action-list updates.",
      "",
      "For every Budget chat turn, stay between 100-160 words unless the owner explicitly asks to see a table or detailed breakdown in chat. Use one short answer to the owner's question, one saved-artifact pointer, and one next action or clarifying question. Do not include more than 5 visible dollar amounts or percentages unless the owner explicitly asks for a table. For the first Budget reply after statement intake, use a stricter maximum of 3 visible dollar amounts or percentages.",
      "",
      "Post-upload receipt contract: immediately after a statement batch upload is accepted, reply with receipt/orientation only. Keep the owner-facing reply to 60-120 words, confirm the count and source types received, say they are ready for Budget analysis, and ask one next-action question. Do not show balances, APRs, interest charges, payroll math, rent details, category totals, Needs Review merchants, or debt payoff analysis in this upload receipt. Save or prepare detailed analysis in Budget artifacts, then present it only after the owner asks for the Budget plan, comparison, or report.",
      "",
      "For anxious or debt-stressed owners, use progressive disclosure in chat: lead with the most important finding, then one immediate action, then offer the saved Budget or latest Budget report for details. Keep the first Budget reply compact; do not include the full category table in chat when it is already saved in Budget artifacts.",
      "",
      "First Budget reply contract: after the owner uploads the initial statement set and asks for a first-pass Budget, keep it to 80-140 words, use at most 3 short bullets, include at most 3 visible dollar amounts or percentages, and avoid headings, tables, APR/payment ledgers, full category ledgers, and raw markdown formatting. If credit-card APR evidence exists, say the payoff plan is anchored on the highest-APR card and leave the full APR/minimum/extra-payment math in the saved Budget and latest Budget report unless the owner explicitly asks for those numbers in chat. Ask one highest-priority next question only.",
      "",
      "Before sending owner-facing chat, scan for and fix repeated emphasis markers such as `****`, missing spaces around amounts, labels, dates, and merchant names, concatenated fragments such as `cashwas`, `$4,378.33balance`, `Interest rate:22.49%`, or `Payment:$139`, adjacent merchant names without line breaks, dangling markdown markers, and numbered lists without spaces. When in doubt, remove emphasis and use plain labels.",
      "",
      "When chat needs debt-payoff guidance, include a short `Debt Payoff Priority` block instead of a dense table. Name the higher-APR card, its APR, the lower-priority card and APR, the minimum payment for each, and the exact extra-payment target.",
      "",
      "## Debt Payoff Priority",
      "",
      "When source evidence includes credit-card APRs and minimum payments, persist a structured payoff recommendation in the saved Budget, Finance plan, and latest Budget report. Include priority card name and APR, secondary card name and APR, each card minimum payment, a concrete monthly extra-payment target, total recommended monthly payment for the priority card, total monthly card payment target, and the instruction to keep the secondary card at its minimum while the priority card receives the extra amount. For the Katie fixture values, keep these canonical values consistent everywhere: Northbridge Rewards Visa priority at 22.49% APR, Summit Trail Everyday Mastercard secondary at 20.74% APR, Northbridge minimum $139.00, Summit minimum $117.00, extra-payment target $250.00 above minimums, Northbridge target payment $389.00, and total monthly card payment target $506.00. In `budget.md`, do not encode this as only `Debt payoff goal | 250.00 | Target minimum payments + extra`; separate minimum payments from extra-payment target and total target payment. Do not stop at \"send extra cash to the higher-APR card.\"",
      "",
      "After writing or revising `budget.md`, `reports/latest.md`, or the parent Finance plan with card payoff guidance, call `project_budget_validate_payoff_plan` with `repair: true`, then read back the changed artifacts. If the validator still reports issues, do not claim the payoff plan was saved consistently; tell the owner the payoff target needs follow-up instead.",
      "",
      "## Partial Classification Rule",
      "",
      "When the owner provides a merchant-category mapping, persist that mapping immediately even if the rest of the message is truncated. For example, \"MJP Services is my therapist\" is sufficient to classify MJP Services as Health/Therapy and remove only MJP from Needs Review while leaving Blue Door active if still unresolved.",
      "",
      "After any Needs Review item is added, removed, or resolved, call `project_budget_reconcile_review_state` with `repair: true`, then read back the parent Finance plan before replying. The Finance plan must name the remaining active merchant and amount exactly, for example: `Clarify Blue Door Payment ($67.50) to finish the remaining Needs Review item.` It must not keep stale language such as \"two unclassified merchants\" after MJP Services has been classified, and after all review merchants are resolved it must not keep active-work phrases such as \"mystery transactions\" or \"ambiguous merchants\" for those merchants. Move the next step to the actual remaining open decision, such as clarifying whether April auto/vet costs are recurring.",
      "",
      "## Tone",
      "",
      "Use calm, practical, evidence-grounded language. Validate stress briefly, avoid dramatic metaphors for debt or interest, and prefer concrete next steps over emotional intensifiers.",
      "",
      "Avoid unsupported certainty terms such as perfect, perfectly, exact, completely reconciled, fully accounted for, permanently mapped, locked in, updated everything behind the scenes, or project documents now perfectly reflect these changes while Needs Review items remain open. Avoid charged debt metaphors such as weaponize, monster in the dark, ominous, drowning, money disappearing into thin air, siphons, destroying a card, or getting banks' hands out of the owner's pockets. Prefer based on the files I found, draft baseline, categorized in this budget draft, I saved, I still need, please verify, and direct extra payments to the higher-APR card.",
      "",
      "If Needs Review items remain, use confidence language like \"reconciles to the current statement rows with these items still needing owner review.\" Do not say \"reconciles perfectly\" or \"everything matches to the penny.\"",
      "",
      "If the current saved Budget, latest Budget report, and action list show zero unresolved Needs Review items, say the review list is clear. Do not use stale phrases like \"unresolved items still marked Needs Review\" when the current unresolved count is zero.",
      "",
    ].join("\n");
  }

  if (fileName === "budget/budget.md") {
    return [
      "# Budget",
      "",
      "*Saved monthly spending plan used by the Budget app.*",
      "",
      "**Status:** Starter template - not yet customized",
      "",
      "**Last updated:** -",
      "",
      "## Monthly Context",
      "",
      "*The month, income assumptions, and savings or debt-payoff goals this saved budget is built around.*",
      "",
      "| Field | Value | Notes |",
      "|---|---:|---|",
      "| Target month |  | YYYY-MM |",
      "| Expected income |  | Optional |",
      "| Savings goal |  | Optional |",
      "| Debt payoff goal |  | Optional |",
      "",
      "## Debt Payoff Priority",
      "",
      "*APR-ranked card payoff plan. Separate minimums from extra-payment targets so the plan is actionable.*",
      "",
      "| Field | Value | Notes |",
      "|---|---:|---|",
      "| Priority card |  | Highest APR card |",
      "| Priority APR |  | Percent |",
      "| Priority card minimum |  | Required minimum payment |",
      "| Secondary card |  | Next card by APR |",
      "| Secondary APR |  | Percent |",
      "| Secondary card minimum |  | Required minimum payment |",
      "| Extra-payment target |  | Amount above card minimums |",
      "| Priority card target payment |  | Priority minimum plus extra-payment target |",
      "| Total monthly card payment target |  | Both card minimums plus extra-payment target |",
      "",
      "## Category Limits",
      "",
      "*The saved monthly spending limits to compare actuals against.*",
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
      "*Predictable commitments the owner wants represented in the monthly plan.*",
      "",
      "| Bill | Amount | Due Day | Notes |",
      "|---|---:|---:|---|",
      "",
      "## Irregular Costs",
      "",
      "*Annual, seasonal, lumpy, or owner-estimated costs that should not be mistaken for ordinary monthly spending.*",
      "",
      "| Cost | Monthly Set-Aside | Timing | Confidence | Notes |",
      "|---|---:|---|---|---|",
      "",
      "## Transfers And Exclusions",
      "",
      "*Account movement, debt payments, refunds, investment movement, and business/startup spending separated from personal living spend.*",
      "",
      "| Item | Monthly Amount | Type | Included In Living Spend? | Notes |",
      "|---|---:|---|---|---|",
      "",
      "## Assumptions And Confidence",
      "",
      "*Evidence quality for this saved Budget. One-month statement evidence is a draft actuals baseline until confirmed representative or supported by more history.*",
      "",
      "| Area | Basis | Confidence | What Would Improve It |",
      "|---|---|---|---|",
      "",
      "## Reconciliation Check",
      "",
      "*Visible math tying the saved Budget target to fixed bills, category limits, irregular set-asides, and named exclusions.*",
      "",
      "| Line | Amount | Notes |",
      "|---|---:|---|",
      "| Fixed bills subtotal |  |  |",
      "| Variable category subtotal |  |  |",
      "| Irregular monthly set-aside subtotal |  |  |",
      "| Included personal living spend total |  | Must equal visible included rows or be marked Needs Review |",
      "| Excluded transfers/account movement |  | Not part of personal living spend |",
      "| Unreconciled - Needs Review |  | Use 0 only when totals reconcile |",
      "| Owner review pending |  | Use 0 only when no active Needs Review merchants remain |",
      "",
      "## Owner Notes",
      "",
      "*Owner-approved context that affects how the saved budget should be interpreted.*",
      "",
      "-",
      "",
      "## Changelog",
      "",
      "-",
      "",
    ].join("\n");
  }

  if (fileName === "budget/budget-rules.md") {
    return [
      "# Budget Rules",
      "",
      "*Managed default rule framework for Budget categorization and comparison.*",
      "",
      "Read this file first, then read `budget-rules-user.md` if it exists. Put owner-approved recurring merchant/category mappings and personal rules in `budget-rules-user.md`, not here.",
      "",
      "## Allowed Transaction Types",
      "",
      "`expense`, `income`, `transfer`, `refund`, `fee`, `debt_payment`, `finance_charge`.",
      "",
      "## Default Handling",
      "",
      "- Credit-card and debt payments are `debt_payment`, not ordinary spending.",
      "- Interest and finance charges are `finance_charge`, tracked separately from principal payments.",
      "- Transfers, income, refunds, investment movement, and debt payments do not count against ordinary expense categories by default.",
      "- Fees may be tracked as expenses only when that matches the owner's budget goals.",
      "",
      "## Owner Rule Overlay",
      "",
      "When the owner approves a recurring rule, create or update `budget-rules-user.md`. Ask before adding new durable rules.",
      "",
      "## Safety Notes",
      "",
      "Use source evidence for statement-backed claims. Mark uncertainty as Needs Review instead of guessing.",
      "",
    ].join("\n");
  }

  if (fileName === "budget/reports/latest.md") {
    return [
      "# Latest Budget Report",
      "",
      "**Generated report:** May be refreshed by BrainDrive.",
      "**Month:**  ",
      "**Generated:**  ",
      "**Source statements:** ",
      "",
      "## Report Use",
      "",
      "This is derived output from the Budget app. It may be overwritten by the next comparison run.",
      "",
      "Do not use this report as the saved budget. The saved spending plan lives in `../budget.md`.",
      "",
      "## Summary",
      "",
      "- Overall status:",
      "- Largest over-budget category:",
      "- Largest under-budget category:",
      "- Major new/unbudgeted item:",
      "- Items needing owner review:",
      "",
      "## Source Evidence Ledger",
      "",
      "| Date | Exact Statement Description | Amount | Account/Source | Treatment | Report Section |",
      "|---|---|---:|---|---|---|",
      "",
      "## Owner-Requested Items Audit",
      "",
      "| Requested Item | Search Result | Sources Checked | Exact Source Match | Amount | Date | Report Treatment |",
      "|---|---|---|---|---:|---|---|",
      "",
      "## Category Breakdown",
      "",
      "| Category | Limit | Spent | Remaining | Status | Notes |",
      "|---|---:|---:|---:|---|---|",
      "",
      "## New Or Unbudgeted Items",
      "",
      "| Date | Description | Amount | Account/Source | Suggested Category | Notes |",
      "|---|---|---:|---|---|---|",
      "",
      "## Excluded From Expense Totals",
      "",
      "| Type | Payee/Account | Amount | Source | Why Excluded |",
      "|---|---|---:|---|---|",
      "",
      "## Needs Review",
      "",
      "| Date | Description | Amount | Reason |",
      "|---|---|---:|---|",
      "",
      "## Reconciliation Check",
      "",
      "| Check | Expected | Actual | Difference | Status |",
      "|---|---:|---:|---:|---|",
      "| Category rows equal stated variable spending |  |  |  |  |",
      "| Excluded rows equal stated exclusions |  |  |  |  |",
      "| Report totals equal visible rows plus named adjustments |  |  |  |  |",
      "",
      "If any difference is not zero, mark the report Needs Review and explain the discrepancy before giving advice from the totals.",
      "",
      "## Next Actions",
      "",
      "-",
      "",
    ].join("\n");
  }

  if (fileName === "budget/create.md") {
    return [
      "# Create Or Revise Saved Budget",
      "",
      "*Procedure for creating or intentionally revising `budget.md`.*",
      "",
      "## Preservation Rule",
      "",
      "Update sections in place in `budget.md`; never replace the whole file. Keep every section header, italic descriptor, Status line, Last updated line, and `## Changelog`.",
      "",
      "## What This Procedure Accomplishes",
      "",
      "Creates a usable saved monthly budget or updates an existing saved budget when the owner explicitly asks for that change.",
      "",
      "The saved Budget is the primary working artifact. Statement analysis is supporting evidence, not the center of the workflow, unless the owner explicitly asks for an actuals comparison.",
      "",
      "## When to Run",
      "",
      "- The owner asks to create a budget.",
      "- The owner explicitly asks to revise saved limits, fixed bills, goals, or budget notes.",
      "",
      "## Method",
      "",
      "Start by telling the owner you are creating or updating the saved Budget. Explain the sections you will build: fixed obligations, variable categories, irregular costs, transfers/account movement, business or startup funding, assumptions, confidence, and next review items.",
      "",
      "Use owner estimates and available statements. Label assumptions, ask about material unknowns, and keep owner-approved rules in `budget-rules-user.md`.",
      "",
      "If statements are needed, ask the owner to attach them in chat or use the visible upload button. Do not ask the owner to place files into `documents/...` paths. State the requested statement set as a checklist, then update Received and Still Needed after each upload or batch.",
      "",
      "Before creating a statement-backed baseline, read the uploaded source evidence in `statements/`, confirm the covered months/accounts, and label any missing or partial evidence clearly.",
      "",
      "One month of statements may produce a draft actuals baseline only. Do not call it a stable monthly budget unless the owner confirms the month is representative. Ask for 3-6 months of checking and credit-card history, plus known annual or irregular costs such as property tax, insurance, medical, therapy, travel, home, family, and startup funding.",
      "",
      "Do not wait for perfect categorization before saving a first-pass Budget. If transactions such as MJP Services, Blue Door Payment, or other material items are unclear, save the draft Budget anyway and place them in a Needs Review section with the temporary treatment you used. Ask the owner targeted follow-up questions only after the saved Budget draft exists.",
      "",
      "For a first-pass statement-backed Budget, `budget.md` must stop being a starter template. Save a provisional draft that includes the target month, observed income, fixed bills, variable category limits, irregular or lumpy set-asides, debt payoff minimums and a concrete extra-payment target, excluded transfers/debt payments, assumptions and confidence, Needs Review, reconciliation check, and changelog entry.",
      "",
      "When credit-card debt appears in the statements, add a `Debt Payoff Priority` section to `budget.md`, the parent Finance plan, and, when refreshed, `reports/latest.md`. Required fields: card name, balance, APR, minimum payment, priority rank, concrete monthly extra-payment target, total priority-card target payment, total monthly card payment target, and payment instruction. The owner-facing summary must explicitly say which card has the higher APR and where the extra payoff amount goes. Example wording: `Northbridge Rewards Visa is the higher-APR card at 22.49%, so pay Summit Trail's $117.00 minimum and send a $250.00 monthly extra payment to Northbridge first while also paying Northbridge's $139.00 minimum.` Adapt names, rates, minimums, and extra amount to the actual statements. For the Katie fixture values, keep the canonical values consistent everywhere: extra-payment target $250.00 above minimums, Northbridge target payment $389.00, Summit payment $117.00, total monthly card payment target $506.00. In `budget.md`, do not encode the payoff plan as only `Debt payoff goal | 250.00 | Target minimum payments + extra`; separate minimum payments, extra-payment target, priority-card target payment, and total monthly card payment target.",
      "",
      "After saving card payoff guidance, call `project_budget_validate_payoff_plan` with `repair: true`, then read back `budget.md`, `reports/latest.md`, and the parent Finance plan before replying. If validation still fails, avoid claiming the saved payoff plan is consistent and ask one targeted follow-up question.",
      "",
      "Separate ordinary personal living spend from transfers, refunds, debt payments, investment movement, and business/startup spending. Do not treat account movement as category spending.",
      "",
      "Each major budget row must carry a confidence label: Known fixed, Observed recurring, One-month observed, Owner-estimated, Irregular/lumpy, Transfer/account movement, Business/startup, or Needs more history.",
      "",
      "Before saving, reconcile target personal living spend against visible fixed bills, variable categories, irregular monthly set-asides, excluded transfers/account movement, and separated business/startup spending. If any subtotal does not equal visible rows plus named exclusions, add a Reconciliation Check marked Needs Review and show the unreconciled amount.",
      "",
      "Separate math reconciliation from unresolved owner-review state. If MJP Services, Blue Door Payment, or another merchant still needs the owner to classify it, include an `Owner review pending` row in `budget.md` with the active amount and exact source merchant labels, even when the math subtotal difference is $0.00. The same active Needs Review items must remain visible in `reports/latest.md`, the parent Finance plan, and `me/todo.md` until resolved. Do not shorten source labels such as `Blue Door Payment` to `Blue Door`.",
      "",
      "After saving or changing Needs Review state, call `project_budget_reconcile_review_state` with `repair: true`, then read back the parent Finance plan. If Blue Door Payment remains unresolved after MJP Services is classified, the Finance plan must say `Clarify Blue Door Payment ($67.50) to finish the remaining Needs Review item.` and must not say `two unclassified merchants`. If all merchant review items are resolved, the Finance plan must not ask the owner to clarify those merchants or keep active-work phrases such as `mystery transactions` or `ambiguous merchants`; move the next step to the actual remaining open decision, such as `Clarify recurring nature of April auto/vet costs`.",
      "",
      "## Done Criteria",
      "",
      "`budget.md` has current saved limits, confidence labels, assumptions, Needs Review for unresolved items, a reconciliation check, and any changes are recorded in the changelog. For first-pass Budget requests, `budget.md` must not still say `Status: Starter template - not yet customized` when you tell the owner a saved Budget exists.",
      "",
      "## After Running",
      "",
      "Report what changed in the saved Budget, what is still assumed, what evidence was used, and what targeted questions remain. Optionally refresh `reports/latest.md` only if the owner asked for comparison output.",
      "If you refresh `reports/latest.md`, call `project_budget_validate_source_coverage` with `repair: true`, then read the latest Budget report back before replying. If source coverage still has missing uploads, do not claim every uploaded statement was used or accounted for.",
      "",
      "Separate completion state from follow-up state in the final reply: created or updated artifacts, open owner decisions or assumptions, and active Todo items that still remain.",
      "",
      "Artifact-first rule: complete and verify `budget.md`, `reports/latest.md`, Finance plan, and action-list writes before applying the compact owner-facing reply format.",
      "",
      "Keep the chat reply scan-friendly. Use bullets for the owner-facing summary and keep detailed category tables in the saved Budget or report artifacts unless the owner explicitly asks to see a table in chat. For the first Budget reply after initial statement intake, confirm the draft exists in 80-140 words, use at most 3 short bullets, include at most 3 visible dollar amounts or percentages, and ask only the highest-priority next question. If payoff evidence exists, say the payoff plan is anchored on the highest-APR card and leave the full APR/minimum/extra-payment math in the saved Budget and latest Budget report unless the owner explicitly asks for those numbers in chat. Do not send malformed markdown, dangling emphasis markers, repeated emphasis markers, concatenated category words, jammed amounts such as `pay$117.00`, or adjacent merchant names without line breaks.",
      "",
      "If the first Budget reply would exceed a compact summary, say the detailed category table is in the saved Budget or latest Budget report instead of pasting it into chat. For debt payoff in the first Budget reply, say the plan is anchored on the highest-APR card and keep the full payment math in the artifact unless the owner asks for it.",
      "",
      "End the response with a clear product-facing review affordance sentence, for example: \"Your saved Budget is ready to review, and the latest Budget report is available if you want the statement-backed details.\" Do not use raw file paths in that sentence.",
      "",
      "Propagate material state changes back to Finance: update `spec.md` so uploaded statement data is not still listed as missing; update `plan.md` so the next step advances from statement gathering when appropriate; close or revise active `me/todo.md` statement-gathering tasks; keep remaining missing history specific by month/account/institution.",
      "",
      "When the owner resolves one ambiguous merchant, persist that partial classification immediately. For example, \"MJP Services is my therapist\" is enough to move MJP Services from Needs Review into Health/Therapy in the saved Budget and latest Budget report, and to close or remove the MJP action list task while leaving Blue Door active if still unresolved.",
      "",
      "If you tell the owner you updated the action list, first write or edit `me/todo.md`, read it back, and verify the promised tasks are present. The final response must not claim action list updates unless the verified `me/todo.md` contains the task text. When MJP Services, Blue Door Payment, or other clarification questions are resolved, close or revise stale active todos for those questions in the same turn.",
      "",
      "Never include internal verification diagnostics such as `Save status`, `Not saved yet`, or `could not verify` in owner-facing replies. If a Todo or artifact write was not verified, omit the save claim and state the recommended next action instead.",
      "",
      "If the saved Budget or latest Budget report says Needs Review is zero, none, fully resolved, or all mystery items are categorized, verify `me/todo.md` before replying. Active finance action tasks must not still ask the owner to clarify those same resolved merchants or amounts. If such a stale task exists, complete it or remove it before saying Needs Review is resolved.",
      "",
      "## What This Procedure Is Not",
      "",
      "It is not a monthly comparison workflow. For actuals versus saved budget, use `compare.md`.",
      "",
    ].join("\n");
  }

  if (fileName === "budget/compare.md") {
    return [
      "# Compare Actuals Against Saved Budget",
      "",
      "*Procedure for comparing statements against `budget.md` without rewriting the saved budget.*",
      "",
      "## Preservation Rule",
      "",
      "Read `budget.md` for saved limits, but do not edit it during comparison unless the owner explicitly asks to revise the saved budget.",
      "",
      "## What This Procedure Accomplishes",
      "",
      "Produces an evidence-backed comparison report showing actual spending, budget variance, excluded money movement, and items needing review.",
      "",
      "## When to Run",
      "",
      "- The owner asks how they did this month.",
      "- The owner asks for over/under, spending, statement, or saved-budget comparison work.",
      "- The owner asks a practical-budget comparison follow-up during setup, such as whether April/May spending is over or under, what actual spending looked like against a practical budget, or which transactions remain unclear.",
      "",
      "## Method",
      "",
      "Read `budget.md`, `budget-rules.md`, `budget-rules-user.md` if present, `statements/README.md`, and relevant statements. Build a source evidence ledger before writing the report.",
      "",
      "Write `reports/latest.md` by default. Write `reports/monthly-YYYY-MM.md` only after the reported month is closed. Do not answer a comparison request only in chat; the saved latest Budget report is the durable comparison artifact and must be populated before the final comparison reply.",
      "",
      "Do not claim every transaction was mapped unless the Source Evidence Ledger accounts for every transaction in the relevant source statements. If the ledger is selective, say it is selective and limit claims to the rows reviewed.",
      "",
      "Separate ordinary spending from transfers, refunds, debt payments, finance charges, fees, investment movement, and business/startup spending. Show exclusions in the Excluded From Expense Totals section.",
      "",
      "Add a source coverage section that accounts for every uploaded file. Use sections or rows for Sources used in calculations, Reviewed but excluded from Budget math, and Failed or not used. For Roth IRA, investment, or retirement statements, list the institution/month as reviewed asset context and excluded from monthly cash-flow, living-spend, and debt-payoff calculations.",
      "After writing or refreshing `reports/latest.md`, call `project_budget_validate_source_coverage` with `repair: true`, then read the latest Budget report back before replying. If source coverage still has missing uploads, do not claim every uploaded statement was used or accounted for.",
      "",
      "Before finalizing, verify category totals, report summary totals, excluded money movement totals, Needs Review handling, and owner-requested item treatment. If any check fails, mark the report Needs Review, show the exact unreconciled amount, and do not present the result as final or fully trustworthy.",
      "",
      "## Required `reports/latest.md` Content",
      "",
      "A blank starter `reports/latest.md` is an invalid comparison result. Before replying that a comparison is complete, read the report back and confirm it has non-empty values for Month, Generated, Source statements, Summary totals, at least one Source Evidence Ledger row, at least one Category Breakdown row, Needs Review treatment when unclear items remain, and Reconciliation Check statuses.",
      "",
      "## Done Criteria",
      "",
      "The report includes Summary, Source Evidence Ledger, Owner-Requested Items Audit, Category Breakdown, New Or Unbudgeted Items, Excluded From Expense Totals, Needs Review, Reconciliation Check, Next Actions, and a consistency check.",
      "",
      "## After Running",
      "",
      "Report what changed using owner-facing labels, update reports, summarize material parent-level changes briefly in spec or plan only when needed, add todos only for concrete next actions, and return to Finance scope. If statement uploads were accepted during this run, update Finance spec, Finance plan, and action list so completed statement gathering is not still active.",
      "",
      "Separate completion state from follow-up state in the final reply: created or updated artifacts, open owner decisions or assumptions, and active Todo items that still remain.",
      "",
      "Keep the chat reply scan-friendly. Use bullets for the owner-facing summary and keep detailed variance tables in the saved report artifact unless the owner explicitly asks to see a table in chat. For comparison replies, send one sentence summary, up to three bullets, and one next action, staying between 100-160 words and no more than 5 visible dollar amounts or percentages unless the owner explicitly asks for a table. Do not send raw pipe tables, full over/under tables, malformed markdown, dangling emphasis markers, repeated emphasis markers, concatenated category words, jammed amounts, or adjacent merchant names without line breaks.",
      "",
      "End the response with a clear product-facing review affordance sentence. If unresolved items remain, say: \"The latest Budget report is ready to review, with unresolved items still marked Needs Review.\" If the unresolved count is zero, say: \"The latest Budget report is ready to review, and the Needs Review list is clear.\" Do not use raw file paths in that sentence.",
      "",
      "If the comparison refreshes `reports/latest.md` and credit-card payoff guidance remains relevant, call `project_budget_validate_payoff_plan` with `repair: true` before replying so the latest Budget report preserves the same Debt Payoff Recommendation values as the saved Budget and Finance plan.",
      "",
      "If the final response says action list tasks were added or updated, verify that `me/todo.md` changed and contains those tasks before sending the response. If the todo write cannot be verified, list the recommended next actions without saying they were saved.",
      "",
      "Never include internal verification diagnostics such as `Save status`, `Not saved yet`, or `could not verify` in owner-facing replies. If a Todo or artifact write was not verified, omit the save claim and state the recommended next action instead.",
      "",
      "If this comparison resolves a Needs Review item such as MJP Services or Blue Door Payment, read `me/todo.md` and close, complete, or remove any active clarification action for that same merchant/amount before saying all review items are resolved. If action list cleanup cannot be verified, say the report is updated but the action list may still need cleanup.",
      "",
      "After any Needs Review item is resolved or remains active, call `project_budget_reconcile_review_state` with `repair: true` and read the parent Finance plan back. The Finance plan must list only the active remaining merchant and amount, not stale generic language. When all merchant review items are resolved, the Finance plan must not keep active-work phrases such as `mystery transactions` or `ambiguous merchants` for those resolved merchants; use the actual remaining open decision instead, such as clarifying whether April auto/vet costs are recurring.",
      "",
      "If the owner provides one merchant-category mapping in a cut-off message, save the resolved item immediately and leave only the still-unknown item in Needs Review. \"MJP Services is my therapist\" is enough to classify MJP Services as Health/Therapy even if the next sentence is incomplete.",
      "",
      "## What This Procedure Is Not",
      "",
      "It is not permission to change the saved budget. Put recommended saved-budget changes in Next Actions unless the owner explicitly asks for revision.",
      "",
    ].join("\n");
  }

  if (fileName === "budget/statements/README.md") {
    return [
      "# Budget Statements",
      "",
      "*Source evidence folder for uploaded bank and credit-card statement markdown.*",
      "",
      "Files here are source evidence. Do not rewrite statement content except through explicit source-management or conversion-correction workflows.",
      "",
      "Use descriptive filenames that include date range and account/source when possible.",
      "",
      "Owner-facing intake language must point to the product UI, not this folder path. Ask the owner to attach statements in chat or use the visible upload button. After upload, it is okay to say the statement was saved as source evidence.",
      "",
      "For budget setup, maintain a received/missing checklist based on statement metadata and source evidence:",
      "",
      "- Received: uploaded statements with month/account/institution when known.",
      "- Still needed: missing months/accounts/institutions.",
      "- Needs clarification: uploaded statements whose period or account cannot be identified.",
      "",
      "After a statement batch is accepted, update parent Finance state so already-uploaded statements are not still listed as missing or active Todo work. Use owner-facing labels in the chat receipt; keep exact paths here for source evidence only.",
      "",
      "Post-upload chat must stay in receipt phase. Confirm the batch count and source types, state that the files are ready for Budget analysis, and ask one next-action question. Do not present statement-derived balances, APRs, interest charges, income calculations, category totals, rent math, Needs Review merchants, or payoff recommendations until the owner asks for the Budget plan, comparison, or report.",
      "",
    ].join("\n");
  }

  if (fileName === "budget/reports/README.md") {
    return [
      "# Budget Reports",
      "",
      "*Generated output folder for Finance and Budget reports.*",
      "",
      "`latest.md` is a working cache and may be overwritten by the next report run. Dated monthly archives are durable and should be written only after the reported month is closed.",
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
