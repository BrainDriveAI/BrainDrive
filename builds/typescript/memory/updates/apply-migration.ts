import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import type { AppliedItemDecision, AppliedState } from "./applied-state.js";
import {
  isTerminalItemStatus,
  loadAppliedState,
  lookupItemDecision,
  persistAppliedState,
} from "./applied-state.js";
import { summarizeLineDiff, mergeTextWithLineInsertions } from "./diff-helpers.js";
import type { UpdatesManifest } from "./manifest.js";
import type { PendingMigrationPlan, PlannedFileAction, PlannedMigrationItem } from "./planner.js";
import { compareVersionTuples } from "./version.js";

export type MigrationMutationAction = "create" | "merge" | "overwrite" | "delete" | "skip";
export type MigrationApprovalDecision = "accept" | "decline";

export type MigrationItemApproval = {
  item_id: string;
  decision: MigrationApprovalDecision;
  approved_by: string;
  note?: string;
  file_actions?: Record<string, MigrationMutationAction>;
};

export type MigrationItemFilePreview = {
  action_kind: PlannedFileAction["action_kind"];
  target_path: string;
  source_path?: string;
  classification: PlannedFileAction["classification"];
  default_action: MigrationMutationAction;
  available_actions: MigrationMutationAction[];
  requires_explicit_overwrite: boolean;
  diff_summary: {
    added_lines: number;
    removed_lines: number;
    changed: boolean;
  } | null;
};

export type MigrationItemPreview = {
  item_id: string;
  version: string;
  classification: PlannedMigrationItem["classification"];
  files: MigrationItemFilePreview[];
};

export type AppliedFileMutation = {
  target_path: string;
  action: MigrationMutationAction;
  changed: boolean;
};

export type ApplyMigrationItemResult = {
  item_id: string;
  version: string;
  status: "applied" | "declined" | "failed";
  preview: MigrationItemPreview;
  snapshot_path: string | null;
  file_mutations: AppliedFileMutation[];
  error_summary: string | null;
};

export type ApplyMigrationItemOptions = {
  memory_root: string;
  starter_pack_base_root: string;
  manifest: UpdatesManifest;
  plan: PendingMigrationPlan;
  approval: MigrationItemApproval;
  now?: () => Date;
  on_before_mutations?: (context: { item_id: string }) => Promise<void> | void;
};

export type ApplyMigrationAcceptAllOptions = {
  memory_root: string;
  starter_pack_base_root: string;
  manifest: UpdatesManifest;
  plan: PendingMigrationPlan;
  approved_by: string;
  file_actions_by_item?: Record<string, Record<string, MigrationMutationAction>>;
  now?: () => Date;
};

export type ApplyMigrationAcceptAllResult = {
  results: ApplyMigrationItemResult[];
  stopped_after_failure: boolean;
  pending_item_ids: string[];
};

type PreparedFileMutation = {
  target_path: string;
  source_path?: string;
  action_kind: PlannedFileAction["action_kind"];
  selected_action: MigrationMutationAction;
};

type SnapshotRecord = {
  target_path: string;
  existed: boolean;
  content: string | null;
};

type PreChangeSnapshot = {
  schema_version: 1;
  snapshot_id: string;
  item_id: string;
  created_at: string;
  files: SnapshotRecord[];
};

export async function previewMigrationItem(options: {
  item: PlannedMigrationItem;
  starter_pack_base_root: string;
  library_root: string;
}): Promise<MigrationItemPreview> {
  const files = await Promise.all(
    options.item.file_actions.map((action) =>
      previewPlannedFileAction(action, options.starter_pack_base_root, options.library_root)
    )
  );

  return {
    item_id: options.item.id,
    version: options.item.version,
    classification: options.item.classification,
    files,
  };
}

export async function applyMigrationItem(
  options: ApplyMigrationItemOptions
): Promise<ApplyMigrationItemResult> {
  const now = options.now ?? (() => new Date());
  const plannedItem = findPlannedItem(options.plan, options.approval.item_id);
  const preview = await previewMigrationItem({
    item: plannedItem,
    starter_pack_base_root: options.starter_pack_base_root,
    library_root: options.memory_root,
  });

  const appliedState = await loadAppliedState(options.memory_root);
  const existingDecision = lookupItemDecision(appliedState, plannedItem.id);

  if (existingDecision?.status === "applied" && options.approval.decision === "accept") {
    return {
      item_id: plannedItem.id,
      version: plannedItem.version,
      status: "applied",
      preview,
      snapshot_path: existingDecision.snapshot_path ?? null,
      file_mutations: [],
      error_summary: existingDecision.error_summary ?? null,
    };
  }

  if (options.approval.decision === "decline") {
    const declinedAt = now().toISOString();
    const nextState = cloneAppliedState(appliedState);
    nextState.items[plannedItem.id] = {
      status: "declined",
      decided_at: declinedAt,
      ...(options.approval.note ? { note: options.approval.note } : {}),
    };
    maybeAdvanceLastApplied(nextState, options.manifest, options.plan.target_version);
    await persistAppliedState(options.memory_root, nextState);

    return {
      item_id: plannedItem.id,
      version: plannedItem.version,
      status: "declined",
      preview,
      snapshot_path: null,
      file_mutations: [],
      error_summary: null,
    };
  }

  const preparedMutations = prepareFileMutations(preview, options.approval.file_actions ?? {});
  const trackedPaths = dedupeStrings(
    preparedMutations
      .filter((mutation) => mutation.selected_action !== "skip")
      .map((mutation) => mutation.target_path)
  );

  const startedAt = now().toISOString();
  const inProgressState = cloneAppliedState(appliedState);
  inProgressState.items[plannedItem.id] = {
    status: "in_progress",
    decided_at: startedAt,
    note: `approved_by:${options.approval.approved_by}`,
  };
  await persistAppliedState(options.memory_root, inProgressState);
  if (options.on_before_mutations) {
    await options.on_before_mutations({ item_id: plannedItem.id });
  }

  let snapshotPath: string | null = null;
  try {
    snapshotPath = await createPreChangeSnapshot(options.memory_root, plannedItem.id, trackedPaths, now);

    const fileMutations = await applyPreparedMutations(
      preparedMutations,
      options.starter_pack_base_root,
      options.memory_root
    );

    const appliedAt = now().toISOString();
    const appliedStateNext = await loadAppliedState(options.memory_root);
    appliedStateNext.items[plannedItem.id] = {
      status: "applied",
      decided_at: appliedAt,
      ...(options.approval.note ? { note: options.approval.note } : {}),
      ...(snapshotPath ? { snapshot_path: toMemoryRelativePath(options.memory_root, snapshotPath) } : {}),
    };
    maybeAdvanceLastApplied(appliedStateNext, options.manifest, options.plan.target_version);
    await persistAppliedState(options.memory_root, appliedStateNext);

    return {
      item_id: plannedItem.id,
      version: plannedItem.version,
      status: "applied",
      preview,
      snapshot_path: snapshotPath ? toMemoryRelativePath(options.memory_root, snapshotPath) : null,
      file_mutations: fileMutations,
      error_summary: null,
    };
  } catch (error) {
    if (snapshotPath) {
      await restoreFromSnapshot(snapshotPath, options.memory_root);
    }

    const failedAt = now().toISOString();
    const safeErrorSummary = toSafeErrorSummary(error, options.memory_root);
    const failedState = await loadAppliedState(options.memory_root);
    failedState.items[plannedItem.id] = {
      status: "failed",
      decided_at: failedAt,
      note: options.approval.note,
      error_summary: safeErrorSummary,
      ...(snapshotPath ? { snapshot_path: toMemoryRelativePath(options.memory_root, snapshotPath) } : {}),
    };
    maybeAdvanceLastApplied(failedState, options.manifest, options.plan.target_version);
    await persistAppliedState(options.memory_root, failedState);

    return {
      item_id: plannedItem.id,
      version: plannedItem.version,
      status: "failed",
      preview,
      snapshot_path: snapshotPath ? toMemoryRelativePath(options.memory_root, snapshotPath) : null,
      file_mutations: [],
      error_summary: safeErrorSummary,
    };
  }
}

export async function applyMigrationAcceptAll(
  options: ApplyMigrationAcceptAllOptions
): Promise<ApplyMigrationAcceptAllResult> {
  const results: ApplyMigrationItemResult[] = [];

  for (const item of options.plan.items) {
    const result = await applyMigrationItem({
      memory_root: options.memory_root,
      starter_pack_base_root: options.starter_pack_base_root,
      manifest: options.manifest,
      plan: options.plan,
      approval: {
        item_id: item.id,
        decision: "accept",
        approved_by: options.approved_by,
        file_actions: options.file_actions_by_item?.[item.id],
      },
      now: options.now,
    });

    results.push(result);
    if (result.status === "failed") {
      const processed = new Set(results.map((entry) => entry.item_id));
      return {
        results,
        stopped_after_failure: true,
        pending_item_ids: options.plan.items
          .map((entry) => entry.id)
          .filter((id) => !processed.has(id)),
      };
    }
  }

  return {
    results,
    stopped_after_failure: false,
    pending_item_ids: [],
  };
}

export async function applyMigration(
  options: ApplyMigrationAcceptAllOptions
): Promise<ApplyMigrationAcceptAllResult> {
  return applyMigrationAcceptAll(options);
}

function findPlannedItem(plan: PendingMigrationPlan, itemId: string): PlannedMigrationItem {
  const match = plan.items.find((item) => item.id === itemId);
  if (!match) {
    throw new Error(`Migration item was not found in plan: ${itemId}`);
  }
  return match;
}

async function previewPlannedFileAction(
  action: PlannedFileAction,
  starterPackBaseRoot: string,
  libraryRoot: string
): Promise<MigrationItemFilePreview> {
  if (action.action_kind === "delete") {
    const targetPath = resolvePathInsideRoot(libraryRoot, action.target_path);
    const exists = await pathExists(targetPath);

    return {
      action_kind: action.action_kind,
      target_path: action.target_path,
      classification: action.classification,
      default_action: exists ? "delete" : "skip",
      available_actions: exists ? ["delete", "skip"] : ["skip"],
      requires_explicit_overwrite: false,
      diff_summary: null,
    };
  }

  const sourcePathRelative = action.source_path;
  if (!sourcePathRelative) {
    return {
      action_kind: action.action_kind,
      target_path: action.target_path,
      classification: action.classification,
      default_action: "skip",
      available_actions: ["skip"],
      requires_explicit_overwrite: false,
      diff_summary: null,
    };
  }

  const sourcePath = resolvePathInsideRoot(starterPackBaseRoot, sourcePathRelative);
  const targetPath = resolvePathInsideRoot(libraryRoot, action.target_path);
  const sourceContent = await readFileIfExists(sourcePath);
  const targetContent = await readFileIfExists(targetPath);

  if (sourceContent === null) {
    return {
      action_kind: action.action_kind,
      target_path: action.target_path,
      source_path: sourcePathRelative,
      classification: action.classification,
      default_action: "create",
      available_actions: ["create", "skip"],
      requires_explicit_overwrite: false,
      diff_summary: null,
    };
  }

  if (targetContent === null) {
    return {
      action_kind: action.action_kind,
      target_path: action.target_path,
      source_path: sourcePathRelative,
      classification: action.classification,
      default_action: "create",
      available_actions: ["create", "skip"],
      requires_explicit_overwrite: false,
      diff_summary: {
        added_lines: summarizeLineDiff(sourceContent, "").added_lines,
        removed_lines: 0,
        changed: true,
      },
    };
  }

  if (targetContent === sourceContent) {
    return {
      action_kind: action.action_kind,
      target_path: action.target_path,
      source_path: sourcePathRelative,
      classification: action.classification,
      default_action: "skip",
      available_actions: ["skip", "overwrite"],
      requires_explicit_overwrite: false,
      diff_summary: summarizeLineDiff(sourceContent, targetContent),
    };
  }

  return {
    action_kind: action.action_kind,
    target_path: action.target_path,
    source_path: sourcePathRelative,
    classification: action.classification,
    default_action: "merge",
    available_actions: ["merge", "overwrite", "skip"],
    requires_explicit_overwrite: true,
    diff_summary: summarizeLineDiff(sourceContent, targetContent),
  };
}

function prepareFileMutations(
  preview: MigrationItemPreview,
  explicitActions: Record<string, MigrationMutationAction>
): PreparedFileMutation[] {
  return preview.files.map((file) => {
    const selectedAction = explicitActions[file.target_path] ?? file.default_action;
    if (!file.available_actions.includes(selectedAction)) {
      throw new Error(
        `Invalid approved action \"${selectedAction}\" for ${file.target_path}; allowed: ${file.available_actions.join(", ")}`
      );
    }

    return {
      target_path: file.target_path,
      source_path: file.source_path,
      action_kind: file.action_kind,
      selected_action: selectedAction,
    };
  });
}

async function applyPreparedMutations(
  prepared: PreparedFileMutation[],
  starterPackBaseRoot: string,
  libraryRoot: string
): Promise<AppliedFileMutation[]> {
  const results: AppliedFileMutation[] = [];

  for (const mutation of prepared) {
    if (mutation.selected_action === "skip") {
      results.push({
        target_path: mutation.target_path,
        action: mutation.selected_action,
        changed: false,
      });
      continue;
    }

    if (mutation.selected_action === "delete") {
      const targetPath = resolvePathInsideRoot(libraryRoot, mutation.target_path);
      const existed = await pathExists(targetPath);
      if (existed) {
        await rm(targetPath, { force: true });
      }
      results.push({
        target_path: mutation.target_path,
        action: mutation.selected_action,
        changed: existed,
      });
      continue;
    }

    if (!mutation.source_path) {
      throw new Error(`Missing source path for write action: ${mutation.target_path}`);
    }

    const sourcePath = resolvePathInsideRoot(starterPackBaseRoot, mutation.source_path);
    const targetPath = resolvePathInsideRoot(libraryRoot, mutation.target_path);
    const sourceContent = await readFile(sourcePath, "utf8");

    if (mutation.selected_action === "create") {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, sourceContent, "utf8");
      results.push({
        target_path: mutation.target_path,
        action: mutation.selected_action,
        changed: true,
      });
      continue;
    }

    if (mutation.selected_action === "overwrite") {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, sourceContent, "utf8");
      results.push({
        target_path: mutation.target_path,
        action: mutation.selected_action,
        changed: true,
      });
      continue;
    }

    if (mutation.selected_action === "merge") {
      const targetContent = await readFileIfExists(targetPath);
      if (targetContent === null) {
        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(targetPath, sourceContent, "utf8");
        results.push({
          target_path: mutation.target_path,
          action: "create",
          changed: true,
        });
        continue;
      }

      const merged = mergeTextWithLineInsertions(sourceContent, targetContent);
      if (merged.changed) {
        await writeFile(targetPath, merged.content, "utf8");
      }
      results.push({
        target_path: mutation.target_path,
        action: mutation.selected_action,
        changed: merged.changed,
      });
      continue;
    }

    throw new Error(`Unsupported mutation action: ${mutation.selected_action}`);
  }

  return results;
}

async function createPreChangeSnapshot(
  memoryRoot: string,
  itemId: string,
  targetPaths: string[],
  now: () => Date
): Promise<string> {
  const snapshotRoot = path.join(memoryRoot, "system", "updates", "snapshots");
  await mkdir(snapshotRoot, { recursive: true });

  const snapshotId = `${sanitizeForFilename(itemId)}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const snapshotPath = path.join(snapshotRoot, `${snapshotId}.json`);
  const files: SnapshotRecord[] = [];

  for (const targetPath of targetPaths) {
    const absoluteTargetPath = resolvePathInsideRoot(memoryRoot, targetPath);
    const existingContent = await readFileIfExists(absoluteTargetPath);
    files.push({
      target_path: targetPath,
      existed: existingContent !== null,
      content: existingContent,
    });
  }

  const snapshot: PreChangeSnapshot = {
    schema_version: 1,
    snapshot_id: snapshotId,
    item_id: itemId,
    created_at: now().toISOString(),
    files,
  };

  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return snapshotPath;
}

async function restoreFromSnapshot(snapshotPath: string, memoryRoot: string): Promise<void> {
  const raw = await readFile(snapshotPath, "utf8");
  const parsed = JSON.parse(raw) as PreChangeSnapshot;

  for (const file of parsed.files) {
    const absolutePath = resolvePathInsideRoot(memoryRoot, file.target_path);
    if (file.existed) {
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, file.content ?? "", "utf8");
      continue;
    }

    await rm(absolutePath, { force: true });
  }
}

function maybeAdvanceLastApplied(state: AppliedState, manifest: UpdatesManifest, targetVersion: string): void {
  if (!canAdvanceLastApplied(state, manifest, targetVersion)) {
    return;
  }

  const current = state.last_applied;
  if (!current) {
    state.last_applied = targetVersion;
    return;
  }

  const comparison = compareVersionTuples(targetVersion, current);
  if (comparison === null || comparison === -1) {
    return;
  }

  state.last_applied = targetVersion;
}

function canAdvanceLastApplied(state: AppliedState, manifest: UpdatesManifest, targetVersion: string): boolean {
  for (const section of manifest.versions) {
    const comparison = compareVersionTuples(section.version, targetVersion);
    if (comparison === null) {
      return false;
    }
    if (comparison === 1) {
      continue;
    }

    for (const item of section.items) {
      const decision = lookupItemDecision(state, item.id);
      if (!decision) {
        return false;
      }
      if (decision.status === "failed" || decision.status === "in_progress") {
        return false;
      }
      if (!isTerminalItemStatus(decision.status)) {
        return false;
      }
    }
  }

  return true;
}

function cloneAppliedState(state: AppliedState): AppliedState {
  return {
    last_applied: state.last_applied,
    items: { ...state.items },
    runs: [...state.runs],
  };
}

function toSafeErrorSummary(error: unknown, memoryRoot: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw
    .replaceAll(memoryRoot, "<memory_root>")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= 240) {
    return normalized;
  }

  return `${normalized.slice(0, 237)}...`;
}

function sanitizeForFilename(value: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return normalized.length > 0 ? normalized : "migration-item";
}

function toMemoryRelativePath(memoryRoot: string, absolutePath: string): string {
  const normalizedRoot = path.resolve(memoryRoot);
  const normalizedPath = path.resolve(absolutePath);
  const relative = path.relative(normalizedRoot, normalizedPath);
  return relative.split(path.sep).join("/");
}

function resolvePathInsideRoot(root: string, relativePath: string): string {
  const absoluteRoot = path.resolve(root);
  const platformRelativePath = relativePath.split("/").join(path.sep);
  const resolved = path.resolve(absoluteRoot, platformRelativePath);
  const relative = path.relative(absoluteRoot, resolved);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path escapes root: ${relativePath}`);
  }

  return resolved;
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
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

export function hasFailedItemDecision(state: AppliedState, itemId: string): boolean {
  return lookupItemDecision(state, itemId)?.status === "failed";
}

export function isItemTerminal(state: AppliedState, itemId: string): boolean {
  const decision: AppliedItemDecision | null = lookupItemDecision(state, itemId);
  return decision ? isTerminalItemStatus(decision.status) : false;
}
