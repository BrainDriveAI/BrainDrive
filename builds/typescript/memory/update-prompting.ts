import { createHash } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import type { ModelAdapter } from "../adapters/base.js";
import { auditLog } from "../logger.js";
import { commitMemoryChange, exportMemoryArchive } from "../git.js";
import { resolveMemoryPath } from "./paths.js";
import { MemorySkillStore, slugifySkillName } from "./skills.js";

export type StarterPackManifestFileKind =
  | "agent_prompt"
  | "user_memory_template"
  | "starter_skill";

export type StarterPackMergePolicy =
  | "llm_merge"
  | "create_if_missing_else_llm_merge"
  | "create_if_missing_else_defer";

export type StarterPackManifestFile = {
  path: string;
  source_path: string;
  kind: StarterPackManifestFileKind;
  merge_policy: StarterPackMergePolicy;
  sha256: string;
};

export type StarterPackManifest = {
  schema_version: 1;
  memory_pack_version: string;
  app_version: string;
  generated_at: string;
  source: string;
  files: StarterPackManifestFile[];
};

export type MemoryUpdateState = {
  schema_version: 1;
  memory_pack_version: string;
  last_checked_app_version: string;
  last_completed_migration_id: string | null;
  pending_migration_id: string | null;
  last_reported_at: string | null;
  updated_at: string;
};

export type MemoryUpdateMigrationStatus =
  | "pending"
  | "planned"
  | "partially_applied"
  | "applied"
  | "deferred"
  | "failed";

export type MemoryUpdateMigrationLogItem = {
  migration_id: string;
  from_memory_pack_version: string;
  to_memory_pack_version: string;
  status: MemoryUpdateMigrationStatus;
  applied_paths: string[];
  deferred_paths: string[];
  report_path: string | null;
  applied_at: string | null;
  backup_path: string | null;
  error?: string;
};

export type MemoryUpdateMigrationLog = {
  schema_version: 1;
  items: MemoryUpdateMigrationLogItem[];
};

export type MemoryUpdateStatus = {
  current_app_version: string;
  memory_pack_version: string;
  target_memory_pack_version: string;
  pending: boolean;
  migration_id: string;
  report_path: string | null;
  applied_paths: string[];
  deferred_paths: string[];
};

export type MemoryUpdatePlanAction = "create" | "merge" | "replace" | "no_change" | "defer";
export type MemoryUpdateRisk = "low" | "medium" | "high";

export type MemoryUpdatePlanItem = {
  path: string;
  action: MemoryUpdatePlanAction;
  confidence: "low" | "medium" | "high";
  owner_summary: string;
  risk: MemoryUpdateRisk;
  auto_apply: boolean;
  replacement_content?: string;
  rationale?: string;
};

export type MemoryUpdatePlan = {
  schema_version: 1;
  migration_id: string;
  from_memory_pack_version: string;
  to_memory_pack_version: string;
  summary: string;
  items: MemoryUpdatePlanItem[];
  auto_apply: boolean;
  owner_report: string;
  generated_at: string;
};

export type MemoryUpdateApplyResult = {
  migration_id: string;
  status: MemoryUpdateMigrationStatus;
  applied_paths: string[];
  deferred_paths: string[];
  report_path: string;
  backup_path: string | null;
};

type MemoryUpdateCandidate = {
  manifestFile: StarterPackManifestFile;
  sourceContent: string;
  currentContent: string | null;
  currentSha256: string | null;
  exists: boolean;
};

type MemoryUpdatePaths = {
  updatesDir: string;
  statePath: string;
  migrationsPath: string;
  manifestPath: string;
  plansDir: string;
  reportsDir: string;
  backupsDir: string;
};

const STARTER_PACK_ENV = "PAA_STARTER_PACK_DIR";
const STARTER_PACK_RELATIVE_PATH = "memory/starter-pack";
const STATE_RELATIVE_PATH = "system/updates/memory-state.json";
const MIGRATIONS_RELATIVE_PATH = "system/updates/memory-migrations.json";
const MANIFEST_RELATIVE_PATH = "system/updates/starter-pack-manifest.json";
const PLAN_RELATIVE_DIR = "system/updates/plans";
const REPORT_RELATIVE_DIR = "system/updates/reports";
const BACKUP_RELATIVE_DIR = "system/updates/backups";
const UNKNOWN_MEMORY_PACK_VERSION = "unknown";

export async function getMemoryUpdateStatus(
  rootDir: string,
  memoryRoot: string,
  appVersion: string
): Promise<MemoryUpdateStatus> {
  const manifest = await generateStarterPackManifest(rootDir, appVersion);
  const state = await ensureMemoryUpdateState(memoryRoot, manifest, rootDir);
  const migrations = await readMigrations(memoryRoot);
  const latest = findLatestMigration(migrations, migrationIdFor(manifest.memory_pack_version));
  const pending = await isMemoryUpdatePending(rootDir, memoryRoot, manifest, state, latest);

  return {
    current_app_version: appVersion,
    memory_pack_version: state.memory_pack_version,
    target_memory_pack_version: manifest.memory_pack_version,
    pending,
    migration_id: migrationIdFor(manifest.memory_pack_version),
    report_path: latest?.report_path ?? null,
    applied_paths: latest?.applied_paths ?? [],
    deferred_paths: latest?.deferred_paths ?? [],
  };
}

export async function generateMemoryUpdatePlan(
  rootDir: string,
  memoryRoot: string,
  appVersion: string,
  options: {
    adapter?: ModelAdapter;
    changelogPath?: string;
  } = {}
): Promise<MemoryUpdatePlan> {
  const manifest = await writeCurrentStarterPackManifest(rootDir, memoryRoot, appVersion);
  const state = await ensureMemoryUpdateState(memoryRoot, manifest, rootDir);
  const candidates = await buildCandidates(rootDir, memoryRoot, manifest);
  const migrationId = migrationIdFor(manifest.memory_pack_version);
  const changelogExcerpt = await readChangelogExcerpt(options.changelogPath ?? path.join(rootDir, "CHANGELOG.md"));

  let plan: MemoryUpdatePlan | null = null;
  if (options.adapter) {
    plan = await generateLlmPlan(options.adapter, {
      migrationId,
      fromMemoryPackVersion: state.memory_pack_version,
      targetMemoryPackVersion: manifest.memory_pack_version,
      changelogExcerpt,
      candidates,
    });
  }

  if (!plan) {
    plan = generateDeterministicPlan({
      migrationId,
      fromMemoryPackVersion: state.memory_pack_version,
      targetMemoryPackVersion: manifest.memory_pack_version,
      candidates,
    });
  }

  const normalized = normalizePlan(plan, candidates, state.memory_pack_version, manifest.memory_pack_version);
  await writeJson(resolveUpdatePaths(memoryRoot).plansDir, `${migrationId}.json`, normalized);
  await appendMigrationLog(memoryRoot, {
    migration_id: migrationId,
    from_memory_pack_version: state.memory_pack_version,
    to_memory_pack_version: manifest.memory_pack_version,
    status: "planned",
    applied_paths: [],
    deferred_paths: normalized.items
      .filter((item) => item.action === "defer")
      .map((item) => item.path),
    report_path: null,
    applied_at: null,
    backup_path: null,
  });
  await writeMemoryUpdateState(memoryRoot, {
    ...state,
    last_checked_app_version: appVersion,
    pending_migration_id: migrationId,
    updated_at: new Date().toISOString(),
  });

  auditLog("memory_update.plan", {
    migration_id: migrationId,
    item_count: normalized.items.length,
    auto_apply: normalized.auto_apply,
  });
  return normalized;
}

export async function applyMemoryUpdatePlan(
  rootDir: string,
  memoryRoot: string,
  appVersion: string,
  options: {
    plan?: MemoryUpdatePlan;
  } = {}
): Promise<MemoryUpdateApplyResult> {
  const manifest = await writeCurrentStarterPackManifest(rootDir, memoryRoot, appVersion);
  const state = await ensureMemoryUpdateState(memoryRoot, manifest, rootDir);
  const migrationId = migrationIdFor(manifest.memory_pack_version);
  const plan = options.plan ?? (await readPlan(memoryRoot, migrationId));
  if (!plan) {
    throw new Error(`Memory update plan not found: ${migrationId}`);
  }

  const candidates = await buildCandidates(rootDir, memoryRoot, manifest);
  const candidateByPath = new Map(candidates.map((candidate) => [candidate.manifestFile.path, candidate]));
  const applicableItems = plan.items.filter((item) => isAutoApplicable(item, candidateByPath));
  const deferredPaths = plan.items
    .filter((item) => item.action === "defer" || !isAutoApplicable(item, candidateByPath))
    .map((item) => item.path);

  const backupPath = applicableItems.length > 0 ? await createMemoryUpdateBackup(memoryRoot, migrationId) : null;
  const appliedPaths: string[] = [];

  try {
    for (const item of applicableItems) {
      const candidate = candidateByPath.get(item.path);
      if (!candidate) {
        continue;
      }
      await assertCandidateUnchanged(memoryRoot, candidate);
      const content = normalizeFileContent(item.replacement_content ?? candidate.sourceContent);
      await applyPlanItem(memoryRoot, candidate, item, content);
      if (item.action !== "no_change") {
        appliedPaths.push(item.path);
      }
    }

    const status: MemoryUpdateMigrationStatus =
      deferredPaths.length > 0 && appliedPaths.length > 0
        ? "partially_applied"
        : deferredPaths.length > 0
          ? "deferred"
          : "applied";
    const reportPath = await writeUpdateReport(memoryRoot, plan, {
      status,
      appliedPaths,
      deferredPaths,
      backupPath,
    });

    await appendMigrationLog(memoryRoot, {
      migration_id: migrationId,
      from_memory_pack_version: state.memory_pack_version,
      to_memory_pack_version: manifest.memory_pack_version,
      status,
      applied_paths: appliedPaths,
      deferred_paths: deferredPaths,
      report_path: reportPath,
      applied_at: new Date().toISOString(),
      backup_path: backupPath,
    });
    await writeMemoryUpdateState(memoryRoot, {
      schema_version: 1,
      memory_pack_version: manifest.memory_pack_version,
      last_checked_app_version: appVersion,
      last_completed_migration_id: migrationId,
      pending_migration_id: null,
      last_reported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await commitMemoryChange(memoryRoot, `Apply memory update ${migrationId}`).catch((error) => {
      auditLog("memory_update.git_commit_failed", {
        migration_id: migrationId,
        message: error instanceof Error ? error.message : String(error),
      });
    });

    auditLog("memory_update.apply", {
      migration_id: migrationId,
      status,
      applied_count: appliedPaths.length,
      deferred_count: deferredPaths.length,
      report_path: reportPath,
    });

    return {
      migration_id: migrationId,
      status,
      applied_paths: appliedPaths,
      deferred_paths: deferredPaths,
      report_path: reportPath,
      backup_path: backupPath,
    };
  } catch (error) {
    await appendMigrationLog(memoryRoot, {
      migration_id: migrationId,
      from_memory_pack_version: state.memory_pack_version,
      to_memory_pack_version: manifest.memory_pack_version,
      status: "failed",
      applied_paths: appliedPaths,
      deferred_paths: deferredPaths,
      report_path: null,
      applied_at: null,
      backup_path: backupPath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function runAutomaticMemoryUpdate(
  rootDir: string,
  memoryRoot: string,
  appVersion: string,
  options: {
    adapter?: ModelAdapter;
  } = {}
): Promise<MemoryUpdateApplyResult | null> {
  const status = await getMemoryUpdateStatus(rootDir, memoryRoot, appVersion);
  if (!status.pending) {
    return null;
  }
  const migrations = await readMigrations(memoryRoot);
  const latest = findLatestMigration(migrations, status.migration_id);
  if (
    latest &&
    (latest.status === "deferred" || latest.status === "partially_applied") &&
    status.memory_pack_version === status.target_memory_pack_version
  ) {
    return null;
  }
  const plan = await generateMemoryUpdatePlan(rootDir, memoryRoot, appVersion, {
    adapter: options.adapter,
  });
  return applyMemoryUpdatePlan(rootDir, memoryRoot, appVersion, { plan });
}

export async function readMemoryUpdateReport(
  memoryRoot: string,
  migrationId: string
): Promise<string | null> {
  const safeId = normalizeMigrationId(migrationId);
  if (!safeId) {
    return null;
  }
  const reportPath = resolveMemoryPath(memoryRoot, `${REPORT_RELATIVE_DIR}/${safeId}.md`);
  try {
    return await readFile(reportPath, "utf8");
  } catch {
    return null;
  }
}

export async function writeCurrentStarterPackManifest(
  rootDir: string,
  memoryRoot: string,
  appVersion: string
): Promise<StarterPackManifest> {
  const manifest = await generateStarterPackManifest(rootDir, appVersion);
  const paths = resolveUpdatePaths(memoryRoot);
  await mkdir(paths.updatesDir, { recursive: true });
  await writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function generateStarterPackManifest(
  rootDir: string,
  appVersion: string
): Promise<StarterPackManifest> {
  const starterPackDir = await resolveStarterPackDir(rootDir);
  const files: StarterPackManifestFile[] = [];

  if (starterPackDir) {
    await addManifestFile(files, starterPackDir, {
      path: "AGENT.md",
      sourcePath: "base/AGENT.md",
      kind: "agent_prompt",
      mergePolicy: "llm_merge",
    });
    await addManifestFile(files, starterPackDir, {
      path: "me/todo.md",
      sourcePath: "base/me/todo.md",
      kind: "user_memory_template",
      mergePolicy: "create_if_missing_else_llm_merge",
    });

    const skillsDir = path.join(starterPackDir, "skills");
    if (existsSync(skillsDir)) {
      const entries = await readdir(skillsDir, { withFileTypes: true });
      for (const entry of entries
        .filter((item) => item.isFile() && item.name.toLowerCase().endsWith(".md"))
        .sort((left, right) => left.name.localeCompare(right.name))) {
        const skillId = slugifySkillName(path.parse(entry.name).name);
        if (!skillId) {
          continue;
        }
        await addManifestFile(files, starterPackDir, {
          path: `skills/${skillId}/SKILL.md`,
          sourcePath: `skills/${entry.name}`,
          kind: "starter_skill",
          mergePolicy: "create_if_missing_else_defer",
        });
      }
    }
  }

  return {
    schema_version: 1,
    memory_pack_version: normalizeVersion(appVersion) ?? appVersion,
    app_version: appVersion,
    generated_at: new Date().toISOString(),
    source: starterPackDir ?? "",
    files,
  };
}

async function ensureMemoryUpdateState(
  memoryRoot: string,
  manifest: StarterPackManifest,
  rootDir: string
): Promise<MemoryUpdateState> {
  const current = await readMemoryUpdateState(memoryRoot);
  if (current) {
    return current;
  }

  const candidates = await buildCandidates(rootDir, memoryRoot, manifest);
  const hasDrift = candidates.some((candidate) => candidate.currentSha256 !== candidate.manifestFile.sha256);
  const now = new Date().toISOString();
  const initialState: MemoryUpdateState = {
    schema_version: 1,
    memory_pack_version: hasDrift ? UNKNOWN_MEMORY_PACK_VERSION : manifest.memory_pack_version,
    last_checked_app_version: manifest.app_version,
    last_completed_migration_id: hasDrift ? null : migrationIdFor(manifest.memory_pack_version),
    pending_migration_id: hasDrift ? migrationIdFor(manifest.memory_pack_version) : null,
    last_reported_at: null,
    updated_at: now,
  };
  await writeMemoryUpdateState(memoryRoot, initialState);
  return initialState;
}

async function isMemoryUpdatePending(
  rootDir: string,
  memoryRoot: string,
  manifest: StarterPackManifest,
  state: MemoryUpdateState,
  latest: MemoryUpdateMigrationLogItem | null = null
): Promise<boolean> {
  const migrationId = migrationIdFor(manifest.memory_pack_version);
  if (latest && isHandledMigrationForVersion(latest, state, manifest)) {
    return false;
  }
  if (state.pending_migration_id === migrationId) {
    return true;
  }
  const versionComparison = compareVersions(manifest.memory_pack_version, state.memory_pack_version);
  if (versionComparison === null || versionComparison > 0) {
    return true;
  }
  const candidates = await buildCandidates(rootDir, memoryRoot, manifest);
  return candidates.some((candidate) => candidate.currentSha256 !== candidate.manifestFile.sha256);
}

function isHandledMigrationForVersion(
  migration: MemoryUpdateMigrationLogItem,
  state: MemoryUpdateState,
  manifest: StarterPackManifest
): boolean {
  return (
    (migration.status === "applied" || migration.status === "partially_applied" || migration.status === "deferred") &&
    state.memory_pack_version === manifest.memory_pack_version &&
    migration.to_memory_pack_version === manifest.memory_pack_version
  );
}

async function buildCandidates(
  rootDir: string,
  memoryRoot: string,
  manifest: StarterPackManifest
): Promise<MemoryUpdateCandidate[]> {
  const starterPackDir = await resolveStarterPackDir(rootDir);
  if (!starterPackDir) {
    return [];
  }

  const candidates: MemoryUpdateCandidate[] = [];
  for (const manifestFile of manifest.files) {
    const sourcePath = path.join(starterPackDir, manifestFile.source_path);
    const sourceContent = normalizeFileContent(await readFile(sourcePath, "utf8"));
    const targetPath = resolveMemoryPath(memoryRoot, manifestFile.path);
    let currentContent: string | null = null;
    let currentSha256: string | null = null;
    let exists = false;
    try {
      currentContent = await readFile(targetPath, "utf8");
      currentSha256 = sha256(normalizeFileContent(currentContent));
      exists = true;
    } catch {
      // Missing files are expected for users created before newer starter-pack content.
    }
    candidates.push({
      manifestFile,
      sourceContent,
      currentContent,
      currentSha256,
      exists,
    });
  }
  return candidates;
}

async function generateLlmPlan(
  adapter: ModelAdapter,
  input: {
    migrationId: string;
    fromMemoryPackVersion: string;
    targetMemoryPackVersion: string;
    changelogExcerpt: string;
    candidates: MemoryUpdateCandidate[];
  }
): Promise<MemoryUpdatePlan | null> {
  try {
    const response = await adapter.complete(
      {
        metadata: {
          correlation_id: input.migrationId,
          trigger: "memory_update_plan",
        },
        messages: [
          {
            role: "system",
            content: [
              "You are BrainDrive's memory update assistant.",
              "Merge starter-pack improvements into existing owner memory while preserving owner customizations.",
              "Never remove owner-specific facts, goals, plans, todos, preferences, or personal context.",
              "Return only valid JSON matching the requested schema.",
              "Mark uncertain, destructive, or ambiguous changes as action=defer.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                output_schema: {
                  schema_version: 1,
                  migration_id: input.migrationId,
                  from_memory_pack_version: input.fromMemoryPackVersion,
                  to_memory_pack_version: input.targetMemoryPackVersion,
                  summary: "string",
                  auto_apply: true,
                  owner_report: "string",
                  items: [
                    {
                      path: "string",
                      action: "create|merge|replace|no_change|defer",
                      confidence: "low|medium|high",
                      owner_summary: "string",
                      risk: "low|medium|high",
                      auto_apply: true,
                      replacement_content: "required for create/merge/replace",
                      rationale: "string",
                    },
                  ],
                },
                changelog_excerpt: input.changelogExcerpt,
                files: input.candidates.map((candidate) => ({
                  path: candidate.manifestFile.path,
                  kind: candidate.manifestFile.kind,
                  merge_policy: candidate.manifestFile.merge_policy,
                  exists: candidate.exists,
                  current_sha256: candidate.currentSha256,
                  target_sha256: candidate.manifestFile.sha256,
                  current_content: candidate.currentContent,
                  target_content: candidate.sourceContent,
                  diff: buildSimpleDiff(candidate.currentContent, candidate.sourceContent),
                })),
              },
              null,
              2
            ),
          },
        ],
      },
      []
    );
    const jsonText = extractJsonObject(response.assistantText);
    if (!jsonText) {
      return null;
    }
    const parsed = JSON.parse(jsonText) as MemoryUpdatePlan;
    return parsed;
  } catch (error) {
    auditLog("memory_update.llm_plan_failed", {
      migration_id: input.migrationId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function generateDeterministicPlan(input: {
  migrationId: string;
  fromMemoryPackVersion: string;
  targetMemoryPackVersion: string;
  candidates: MemoryUpdateCandidate[];
}): MemoryUpdatePlan {
  const items: MemoryUpdatePlanItem[] = input.candidates.map((candidate) => {
    if (candidate.currentSha256 === candidate.manifestFile.sha256) {
      return {
        path: candidate.manifestFile.path,
        action: "no_change",
        confidence: "high",
        owner_summary: `${candidate.manifestFile.path} is already current.`,
        risk: "low",
        auto_apply: true,
      };
    }
    if (!candidate.exists) {
      return {
        path: candidate.manifestFile.path,
        action: "create",
        confidence: "high",
        owner_summary: `Added ${candidate.manifestFile.path} from the latest starter pack.`,
        risk: "low",
        auto_apply: true,
        replacement_content: candidate.sourceContent,
      };
    }
    return {
      path: candidate.manifestFile.path,
      action: "defer",
      confidence: "medium",
      owner_summary: `${candidate.manifestFile.path} has custom content and was left unchanged.`,
      risk: "high",
      auto_apply: false,
      rationale: "No LLM merge was available for an existing customized file.",
    };
  });

  return {
    schema_version: 1,
    migration_id: input.migrationId,
    from_memory_pack_version: input.fromMemoryPackVersion,
    to_memory_pack_version: input.targetMemoryPackVersion,
    summary: "BrainDrive checked memory files against the latest starter pack.",
    items,
    auto_apply: true,
    owner_report: "BrainDrive checked your memory instructions for the latest version.",
    generated_at: new Date().toISOString(),
  };
}

function normalizePlan(
  plan: MemoryUpdatePlan,
  candidates: MemoryUpdateCandidate[],
  fromMemoryPackVersion: string,
  targetMemoryPackVersion: string
): MemoryUpdatePlan {
  const migrationId = normalizeMigrationId(plan.migration_id) ?? migrationIdFor(targetMemoryPackVersion);
  const candidateByPath = new Map(candidates.map((candidate) => [candidate.manifestFile.path, candidate]));
  const normalizedItems: MemoryUpdatePlanItem[] = [];
  for (const item of Array.isArray(plan.items) ? plan.items : []) {
    const candidate = candidateByPath.get(item.path);
    if (!candidate) {
      continue;
    }
    const action = normalizeAction(item.action);
    const risk = normalizeRisk(item.risk);
    const hasContent = typeof item.replacement_content === "string" && item.replacement_content.length > 0;
    const isNoChange = action === "no_change";
    const autoApply =
      isNoChange ||
      ((action === "create" || action === "merge" || action === "replace") &&
        hasContent &&
        (risk === "low" || risk === "medium"));

    normalizedItems.push({
      path: candidate.manifestFile.path,
      action: autoApply ? action : isNoChange ? "no_change" : "defer",
      confidence: normalizeConfidence(item.confidence),
      owner_summary: normalizeNonEmptyString(item.owner_summary, `${candidate.manifestFile.path} checked.`),
      risk: autoApply || isNoChange ? risk : "high",
      auto_apply: autoApply,
      ...(hasContent ? { replacement_content: normalizeFileContent(item.replacement_content ?? "") } : {}),
      ...(typeof item.rationale === "string" ? { rationale: item.rationale } : {}),
    });
  }

  for (const candidate of candidates) {
    if (normalizedItems.some((item) => item.path === candidate.manifestFile.path)) {
      continue;
    }
    normalizedItems.push(generateDeterministicPlan({
      migrationId,
      fromMemoryPackVersion,
      targetMemoryPackVersion,
      candidates: [candidate],
    }).items[0]);
  }

  return {
    schema_version: 1,
    migration_id: migrationId,
    from_memory_pack_version: fromMemoryPackVersion,
    to_memory_pack_version: targetMemoryPackVersion,
    summary: normalizeNonEmptyString(plan.summary, "BrainDrive checked memory files against the latest starter pack."),
    items: normalizedItems.sort((left, right) => left.path.localeCompare(right.path)),
    auto_apply: true,
    owner_report: normalizeNonEmptyString(plan.owner_report, "BrainDrive checked your memory instructions for the latest version."),
    generated_at: new Date().toISOString(),
  };
}

function isAutoApplicable(item: MemoryUpdatePlanItem, candidateByPath: Map<string, MemoryUpdateCandidate>): boolean {
  const candidate = candidateByPath.get(item.path);
  if (!candidate) {
    return false;
  }
  if (item.action === "no_change") {
    return true;
  }
  if (!item.auto_apply || item.risk === "high") {
    return false;
  }
  if (!["create", "merge", "replace"].includes(item.action)) {
    return false;
  }
  return typeof item.replacement_content === "string" && item.replacement_content.length > 0;
}

async function applyPlanItem(
  memoryRoot: string,
  candidate: MemoryUpdateCandidate,
  item: MemoryUpdatePlanItem,
  content: string
): Promise<void> {
  if (item.action === "no_change") {
    return;
  }

  if (candidate.manifestFile.kind === "starter_skill") {
    await applySkillUpdate(memoryRoot, candidate, item, content);
    return;
  }

  const targetPath = resolveMemoryPath(memoryRoot, candidate.manifestFile.path);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
}

async function applySkillUpdate(
  memoryRoot: string,
  candidate: MemoryUpdateCandidate,
  item: MemoryUpdatePlanItem,
  content: string
): Promise<void> {
  const [, skillId] = candidate.manifestFile.path.split("/");
  if (!skillId) {
    throw new Error(`Invalid skill update path: ${candidate.manifestFile.path}`);
  }
  const store = new MemorySkillStore(memoryRoot);
  await store.ensureLayout();
  const existing = await store.get(skillId);
  if (!existing) {
    const name = extractFirstMarkdownHeading(content) ?? humanizeSkillName(skillId);
    await store.create({
      id: skillId,
      name,
      description: `Starter skill seeded from ${candidate.manifestFile.source_path}`,
      content,
      tags: ["starter"],
      seeded_from: candidate.manifestFile.source_path,
    });
    return;
  }
  if (item.action === "merge" || item.action === "replace") {
    await store.update(skillId, { content });
  }
}

async function assertCandidateUnchanged(memoryRoot: string, candidate: MemoryUpdateCandidate): Promise<void> {
  if (!candidate.exists) {
    const targetPath = resolveMemoryPath(memoryRoot, candidate.manifestFile.path);
    if (existsSync(targetPath)) {
      const current = await readFile(targetPath, "utf8");
      const currentSha = sha256(normalizeFileContent(current));
      if (currentSha !== candidate.manifestFile.sha256) {
        throw new Error(`Memory file changed before update apply: ${candidate.manifestFile.path}`);
      }
    }
    return;
  }
  const targetPath = resolveMemoryPath(memoryRoot, candidate.manifestFile.path);
  const current = await readFile(targetPath, "utf8");
  const currentSha = sha256(normalizeFileContent(current));
  if (currentSha !== candidate.currentSha256) {
    throw new Error(`Memory file changed before update apply: ${candidate.manifestFile.path}`);
  }
}

async function createMemoryUpdateBackup(memoryRoot: string, migrationId: string): Promise<string> {
  const backupPath = resolveMemoryPath(memoryRoot, `${BACKUP_RELATIVE_DIR}/${migrationId}.tar.gz`);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await exportMemoryArchive(memoryRoot, backupPath);
  return `${BACKUP_RELATIVE_DIR}/${migrationId}.tar.gz`;
}

async function writeUpdateReport(
  memoryRoot: string,
  plan: MemoryUpdatePlan,
  result: {
    status: MemoryUpdateMigrationStatus;
    appliedPaths: string[];
    deferredPaths: string[];
    backupPath: string | null;
  }
): Promise<string> {
  const reportRelativePath = `${REPORT_RELATIVE_DIR}/${plan.migration_id}.md`;
  const reportPath = resolveMemoryPath(memoryRoot, reportRelativePath);
  const appliedItems = plan.items.filter((item) => result.appliedPaths.includes(item.path));
  const deferredItems = plan.items.filter((item) => result.deferredPaths.includes(item.path));
  const lines = [
    `# BrainDrive Memory Update ${plan.to_memory_pack_version}`,
    "",
    `Status: ${result.status}`,
    `Updated at: ${new Date().toISOString()}`,
    "",
    buildReportSummary(appliedItems.length, deferredItems.length),
    "",
    "## Updated",
    "",
    ...(appliedItems.length > 0
      ? appliedItems.map((item) => `- ${item.owner_summary} (${item.path})`)
      : ["- No file changes were needed."]),
    "",
    "## Left Unchanged",
    "",
    ...(deferredItems.length > 0
      ? deferredItems.map((item) => `- ${item.owner_summary} (${item.path})`)
      : ["- No update items were deferred."]),
    "",
    "## Backup",
    "",
    result.backupPath ? `- Backup created at \`${result.backupPath}\`.` : "- No backup was needed because no files changed.",
    "",
  ];
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, lines.join("\n"), "utf8");
  return reportRelativePath;
}

function buildReportSummary(appliedCount: number, deferredCount: number): string {
  if (appliedCount === 0 && deferredCount === 0) {
    return "Your BrainDrive memory pack was checked for updates. No memory changes were needed, and your existing projects and personal memory remain unchanged.";
  }
  if (appliedCount > 0 && deferredCount === 0) {
    return `Your BrainDrive memory pack was updated with ${formatCount(appliedCount, "item")}. Your existing projects and personal memory remain unchanged.`;
  }
  if (appliedCount === 0) {
    return `Your BrainDrive memory pack was checked. ${formatCount(deferredCount, "item")} left unchanged for safety, and no automatic memory changes were made.`;
  }
  return `Your BrainDrive memory pack was updated with ${formatCount(appliedCount, "item")}. ${formatCount(deferredCount, "item")} left unchanged for safety.`;
}

function formatCount(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

async function readPlan(memoryRoot: string, migrationId: string): Promise<MemoryUpdatePlan | null> {
  const safeId = normalizeMigrationId(migrationId);
  if (!safeId) {
    return null;
  }
  try {
    const raw = await readFile(resolveMemoryPath(memoryRoot, `${PLAN_RELATIVE_DIR}/${safeId}.json`), "utf8");
    return JSON.parse(raw) as MemoryUpdatePlan;
  } catch {
    return null;
  }
}

async function readMemoryUpdateState(memoryRoot: string): Promise<MemoryUpdateState | null> {
  try {
    const raw = await readFile(resolveMemoryPath(memoryRoot, STATE_RELATIVE_PATH), "utf8");
    const parsed = JSON.parse(raw) as Partial<MemoryUpdateState>;
    if (parsed.schema_version === 1 && typeof parsed.memory_pack_version === "string") {
      return {
        schema_version: 1,
        memory_pack_version: parsed.memory_pack_version,
        last_checked_app_version: parsed.last_checked_app_version ?? "",
        last_completed_migration_id: parsed.last_completed_migration_id ?? null,
        pending_migration_id: parsed.pending_migration_id ?? null,
        last_reported_at: parsed.last_reported_at ?? null,
        updated_at: parsed.updated_at ?? new Date().toISOString(),
      };
    }
  } catch {
    // Missing state is normal before this subsystem has initialized.
  }
  return null;
}

async function writeMemoryUpdateState(memoryRoot: string, state: MemoryUpdateState): Promise<void> {
  const targetPath = resolveMemoryPath(memoryRoot, STATE_RELATIVE_PATH);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function readMigrations(memoryRoot: string): Promise<MemoryUpdateMigrationLog> {
  try {
    const raw = await readFile(resolveMemoryPath(memoryRoot, MIGRATIONS_RELATIVE_PATH), "utf8");
    const parsed = JSON.parse(raw) as Partial<MemoryUpdateMigrationLog>;
    if (parsed.schema_version === 1 && Array.isArray(parsed.items)) {
      return {
        schema_version: 1,
        items: parsed.items.filter(isMigrationLogItem),
      };
    }
  } catch {
    // Missing log is normal.
  }
  return { schema_version: 1, items: [] };
}

async function appendMigrationLog(memoryRoot: string, item: MemoryUpdateMigrationLogItem): Promise<void> {
  const log = await readMigrations(memoryRoot);
  const nextItems = [
    ...log.items.filter((entry) => !(entry.migration_id === item.migration_id && entry.status === item.status)),
    item,
  ];
  const targetPath = resolveMemoryPath(memoryRoot, MIGRATIONS_RELATIVE_PATH);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify({ schema_version: 1, items: nextItems }, null, 2)}\n`, "utf8");
}

async function readChangelogExcerpt(changelogPath: string): Promise<string> {
  try {
    const raw = await readFile(changelogPath, "utf8");
    return raw.slice(0, 8000);
  } catch {
    return "";
  }
}

async function addManifestFile(
  files: StarterPackManifestFile[],
  starterPackDir: string,
  input: {
    path: string;
    sourcePath: string;
    kind: StarterPackManifestFileKind;
    mergePolicy: StarterPackMergePolicy;
  }
): Promise<void> {
  try {
    const content = normalizeFileContent(await readFile(path.join(starterPackDir, input.sourcePath), "utf8"));
    files.push({
      path: input.path,
      source_path: input.sourcePath,
      kind: input.kind,
      merge_policy: input.mergePolicy,
      sha256: sha256(content),
    });
  } catch {
    // Starter-pack content can be absent in development fixtures.
  }
}

async function writeJson(directory: string, fileName: string, payload: unknown): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, fileName), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveUpdatePaths(memoryRoot: string): MemoryUpdatePaths {
  return {
    updatesDir: resolveMemoryPath(memoryRoot, "system/updates"),
    statePath: resolveMemoryPath(memoryRoot, STATE_RELATIVE_PATH),
    migrationsPath: resolveMemoryPath(memoryRoot, MIGRATIONS_RELATIVE_PATH),
    manifestPath: resolveMemoryPath(memoryRoot, MANIFEST_RELATIVE_PATH),
    plansDir: resolveMemoryPath(memoryRoot, PLAN_RELATIVE_DIR),
    reportsDir: resolveMemoryPath(memoryRoot, REPORT_RELATIVE_DIR),
    backupsDir: resolveMemoryPath(memoryRoot, BACKUP_RELATIVE_DIR),
  };
}

async function resolveStarterPackDir(rootDir: string): Promise<string | null> {
  const envOverride = process.env[STARTER_PACK_ENV]?.trim();
  const candidates = [
    envOverride,
    path.resolve(rootDir, STARTER_PACK_RELATIVE_PATH),
    path.resolve(rootDir, "builds", "typescript", STARTER_PACK_RELATIVE_PATH),
  ].filter((value): value is string => Boolean(value && value.length > 0));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function findLatestMigration(
  log: MemoryUpdateMigrationLog,
  migrationId: string
): MemoryUpdateMigrationLogItem | null {
  const matches = log.items.filter((item) => item.migration_id === migrationId);
  return matches[matches.length - 1] ?? null;
}

function migrationIdFor(version: unknown): string {
  const rawVersion = typeof version === "string" && version.trim().length > 0 ? version.trim() : UNKNOWN_MEMORY_PACK_VERSION;
  const normalized = normalizeVersion(rawVersion) ?? rawVersion.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
  return `starter-pack-${normalized}`;
}

function normalizeMigrationId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9.-]{0,127}$/i.test(normalized)) {
    return null;
  }
  return normalized;
}

function compareVersions(left: string, right: string): number | null {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  if (!leftParts || !rightParts) {
    return null;
  }
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }
  return 0;
}

function parseVersionParts(value: string): number[] | null {
  const normalized = normalizeVersion(value);
  if (!normalized) {
    return null;
  }
  return normalized.split(".").map((part) => Number(part));
}

function normalizeVersion(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/^v/i, "");
  if (!/^\d+(?:\.\d+){1,3}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeAction(value: unknown): MemoryUpdatePlanAction {
  return value === "create" || value === "merge" || value === "replace" || value === "no_change" || value === "defer"
    ? value
    : "defer";
}

function normalizeRisk(value: unknown): MemoryUpdateRisk {
  return value === "low" || value === "medium" || value === "high" ? value : "high";
}

function normalizeConfidence(value: unknown): "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function normalizeNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeFileContent(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function extractJsonObject(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const candidate = fenced[1].trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      return candidate;
    }
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return null;
}

function buildSimpleDiff(currentContent: string | null, targetContent: string): string {
  if (currentContent === null) {
    return `+${targetContent.split("\n").join("\n+")}`;
  }
  if (normalizeFileContent(currentContent) === normalizeFileContent(targetContent)) {
    return "";
  }
  return [
    "--- current",
    "+++ target",
    ...normalizeFileContent(currentContent).split("\n").slice(0, 120).map((line) => `-${line}`),
    ...normalizeFileContent(targetContent).split("\n").slice(0, 120).map((line) => `+${line}`),
  ].join("\n");
}

function isMigrationLogItem(value: unknown): value is MemoryUpdateMigrationLogItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return typeof item.migration_id === "string" && typeof item.status === "string";
}

function extractFirstMarkdownHeading(content: string): string | null {
  for (const line of content.split("\n")) {
    const match = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function humanizeSkillName(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}
