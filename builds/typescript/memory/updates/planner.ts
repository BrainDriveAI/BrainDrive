import path from "node:path";
import { readFile, stat } from "node:fs/promises";

import type { AppliedState } from "./applied-state.js";
import { lookupItemDecision } from "./applied-state.js";
import type { ManifestFileAction, ManifestMigrationItem, UpdatesManifest } from "./manifest.js";
import { compareVersionTuples } from "./version.js";

export type FileActionClassification = "clean" | "conflicting" | "removed";
export type PendingItemClassification = FileActionClassification | "dependency-blocked";

export type PlannedFileAction = {
  action_kind: ManifestFileAction["kind"];
  target_path: string;
  source_path?: string;
  classification: FileActionClassification;
};

export type PlannedMigrationItem = {
  id: string;
  version: string;
  summary: string;
  source_file_paths: string[];
  classification: PendingItemClassification;
  blocking_dependencies: string[];
  file_actions: PlannedFileAction[];
};

export type PendingMigrationPlan = {
  current_version: string;
  target_version: string;
  items: PlannedMigrationItem[];
};

export type PendingMigrationPlanOptions = {
  current_version: string;
  target_version?: string;
  starter_pack_base_root: string;
  library_root: string;
  applied_state: AppliedState;
};

type BaseItemClassification = {
  item: ManifestMigrationItem;
  classification: FileActionClassification;
  file_actions: PlannedFileAction[];
};

export function selectPendingMigrationItems(
  manifest: UpdatesManifest,
  options: {
    current_version: string;
    target_version?: string;
    applied_state: AppliedState;
  }
): ManifestMigrationItem[] {
  const targetVersion = resolveTargetVersion(manifest, options.current_version, options.target_version);

  const selected: ManifestMigrationItem[] = [];
  for (const section of manifest.versions) {
    const afterCurrent = compareVersionsStrict(section.version, options.current_version);
    const beforeOrEqualTarget = compareVersionsStrict(section.version, targetVersion);

    if (afterCurrent !== 1 || beforeOrEqualTarget === 1) {
      continue;
    }

    for (const item of section.items) {
      const decision = lookupItemDecision(options.applied_state, item.id);
      if (decision?.status === "applied" || decision?.status === "declined") {
        continue;
      }
      selected.push(item);
    }
  }

  return selected;
}

export async function planPendingMigrations(
  manifest: UpdatesManifest,
  options: PendingMigrationPlanOptions
): Promise<PendingMigrationPlan> {
  const targetVersion = resolveTargetVersion(manifest, options.current_version, options.target_version);
  const pendingItems = selectPendingMigrationItems(manifest, {
    current_version: options.current_version,
    target_version: targetVersion,
    applied_state: options.applied_state,
  });

  const baseClassifications = await Promise.all(
    pendingItems.map((item) =>
      classifyItemAgainstLibrary(item, options.starter_pack_base_root, options.library_root)
    )
  );

  const byId = new Map(baseClassifications.map((entry) => [entry.item.id, entry]));
  const readinessMemo = new Map<string, boolean>();

  const items: PlannedMigrationItem[] = baseClassifications.map((entry) => {
    const blockingDependencies = entry.classification === "conflicting"
      ? []
      : resolveBlockingDependencies(entry.item, byId, options.applied_state, readinessMemo);

    const classification: PendingItemClassification =
      entry.classification === "conflicting"
        ? "conflicting"
        : blockingDependencies.length > 0
          ? "dependency-blocked"
          : entry.classification;

    return {
      id: entry.item.id,
      version: entry.item.version,
      summary: entry.item.summary,
      source_file_paths: entry.item.source_file_paths,
      classification,
      blocking_dependencies: blockingDependencies,
      file_actions: entry.file_actions,
    };
  });

  return {
    current_version: options.current_version,
    target_version: targetVersion,
    items,
  };
}

async function classifyItemAgainstLibrary(
  item: ManifestMigrationItem,
  starterPackBaseRoot: string,
  libraryRoot: string
): Promise<BaseItemClassification> {
  const actionResults = await Promise.all(
    item.file_actions.map((action) => classifyAction(action, starterPackBaseRoot, libraryRoot))
  );

  let classification: FileActionClassification = "clean";
  if (actionResults.some((result) => result.classification === "conflicting")) {
    classification = "conflicting";
  } else if (actionResults.every((result) => result.classification === "removed")) {
    classification = "removed";
  }

  return {
    item,
    classification,
    file_actions: actionResults,
  };
}

async function classifyAction(
  action: ManifestFileAction,
  starterPackBaseRoot: string,
  libraryRoot: string
): Promise<PlannedFileAction> {
  if (action.kind === "write") {
    const sourcePath = resolvePathInsideRoot(starterPackBaseRoot, action.source_path);
    const targetPath = resolvePathInsideRoot(libraryRoot, action.target_path);
    const sourceContent = await readFileIfExists(sourcePath);

    if (sourceContent === null) {
      return {
        action_kind: action.kind,
        source_path: action.source_path,
        target_path: action.target_path,
        classification: "removed",
      };
    }

    const targetContent = await readFileIfExists(targetPath);
    const classification: FileActionClassification =
      targetContent === null || targetContent === sourceContent ? "clean" : "conflicting";

    return {
      action_kind: action.kind,
      source_path: action.source_path,
      target_path: action.target_path,
      classification,
    };
  }

  const deleteTargetPath = resolvePathInsideRoot(libraryRoot, action.target_path);
  const targetExists = await pathExists(deleteTargetPath);

  return {
    action_kind: action.kind,
    target_path: action.target_path,
    classification: targetExists ? "clean" : "removed",
  };
}

function resolveBlockingDependencies(
  item: ManifestMigrationItem,
  pendingById: Map<string, BaseItemClassification>,
  appliedState: AppliedState,
  readinessMemo: Map<string, boolean>
): string[] {
  const blockers: string[] = [];

  for (const dependencyId of item.depends_on) {
    const ready = isDependencyReady(dependencyId, pendingById, appliedState, readinessMemo, new Set([item.id]));
    if (!ready) {
      blockers.push(dependencyId);
    }
  }

  return dedupeStrings(blockers);
}

function isDependencyReady(
  dependencyId: string,
  pendingById: Map<string, BaseItemClassification>,
  appliedState: AppliedState,
  readinessMemo: Map<string, boolean>,
  recursionStack: Set<string>
): boolean {
  const existingDecision = lookupItemDecision(appliedState, dependencyId);
  if (existingDecision?.status === "applied") {
    return true;
  }
  if (existingDecision?.status === "declined") {
    return false;
  }

  const memoized = readinessMemo.get(dependencyId);
  if (memoized !== undefined) {
    return memoized;
  }

  if (recursionStack.has(dependencyId)) {
    return false;
  }

  const dependencyItem = pendingById.get(dependencyId);
  if (!dependencyItem || dependencyItem.classification !== "clean") {
    readinessMemo.set(dependencyId, false);
    return false;
  }

  recursionStack.add(dependencyId);
  for (const transitiveDependencyId of dependencyItem.item.depends_on) {
    if (!isDependencyReady(transitiveDependencyId, pendingById, appliedState, readinessMemo, recursionStack)) {
      recursionStack.delete(dependencyId);
      readinessMemo.set(dependencyId, false);
      return false;
    }
  }
  recursionStack.delete(dependencyId);

  readinessMemo.set(dependencyId, true);
  return true;
}

function resolveTargetVersion(manifest: UpdatesManifest, currentVersion: string, targetVersion?: string): string {
  if (targetVersion) {
    compareVersionsStrict(targetVersion, currentVersion);
    return targetVersion;
  }

  if (manifest.versions.length === 0) {
    return currentVersion;
  }

  let latest = manifest.versions[0]?.version ?? currentVersion;
  for (const section of manifest.versions) {
    if (compareVersionsStrict(section.version, latest) === 1) {
      latest = section.version;
    }
  }
  return latest;
}

function compareVersionsStrict(left: string, right: string): -1 | 0 | 1 {
  const result = compareVersionTuples(left, right);
  if (result === null) {
    throw new Error(`Unable to compare versions: ${left} and ${right}`);
  }
  return result;
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
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}
