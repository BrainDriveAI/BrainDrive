import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { commitMemoryChange, exportMemoryArchive } from "../git.js";
import { resolveMemoryPath } from "./paths.js";

export type AlphaDraft3TransitionAction =
  | "copy"
  | "archive"
  | "owner_review"
  | "no_change";

export type AlphaDraft3TransitionItem = {
  from_path: string;
  to_path: string | null;
  action: AlphaDraft3TransitionAction;
  reason: string;
};

export type AlphaDraft3TransitionPlan = {
  schema_version: 1;
  transition_id: string;
  detected_layout: "draft3_or_later" | "pre_draft3_finance" | "unknown_or_not_seeded";
  items: AlphaDraft3TransitionItem[];
  review_paths: string[];
  generated_at: string;
};

export type AlphaDraft3TransitionResult = {
  transition_id: string;
  applied_paths: string[];
  archived_paths: string[];
  review_paths: string[];
  backup_path: string | null;
  plan_path: string;
  report_path: string;
};

const TRANSITION_ID = "draft3-memory-alpha";
const PLAN_PATH = `system/updates/plans/${TRANSITION_ID}.json`;
const REPORT_PATH = `system/updates/reports/${TRANSITION_ID}.md`;
const BACKUP_PATH = `system/updates/backups/${TRANSITION_ID}.tar.gz`;
const ARCHIVE_ROOT = `system/updates/pre-draft3-layout/${TRANSITION_ID}`;

const LEGACY_FINANCE_PATHS = [
  "documents/finance/budget.md",
  "documents/finance/rules.md",
  "documents/finance/budgeting/first-pass-budget.md",
  "documents/finance/budgeting/monthly-comparison.md",
  "documents/finance/budgeting/source-evidence.md",
  "documents/finance/budgeting/report-contract.md",
  "documents/finance/budgeting/saved-budget-rules.md",
  "documents/finance/budgeting/index.md",
  "documents/finance/index.md",
  "documents/finance/statements/README.md",
  "documents/finance/reports/README.md",
  "documents/finance/reports/latest.md",
] as const;

export async function buildAlphaDraft3TransitionPlan(memoryRoot: string): Promise<AlphaDraft3TransitionPlan> {
  const detectedLayout = detectFinanceLayout(memoryRoot);
  const items: AlphaDraft3TransitionItem[] = [];

  if (detectedLayout === "pre_draft3_finance") {
    await addCopyIfSourceExists(memoryRoot, items, {
      from: "documents/finance/budget.md",
      to: "documents/finance/budget/budget.md",
      reason: "Move saved budget state into the Draft 3 Budget app state artifact.",
    });
    await addCopyIfSourceExists(memoryRoot, items, {
      from: "documents/finance/rules.md",
      to: "documents/finance/budget/budget-rules-user.md",
      reason: "Preserve owner-approved accumulated rules in the owner rule overlay.",
    });
    await addCopyIfSourceExists(memoryRoot, items, {
      from: "documents/finance/budgeting/first-pass-budget.md",
      to: "documents/finance/budget/create-user.md",
      reason: "Preserve customized legacy create-budget procedure guidance as an owner overlay.",
    });
    await addCopyIfSourceExists(memoryRoot, items, {
      from: "documents/finance/budgeting/monthly-comparison.md",
      to: "documents/finance/budget/compare-user.md",
      reason: "Preserve customized legacy comparison procedure guidance as an owner overlay.",
    });
  }

  await addCopyIfSourceExists(memoryRoot, items, {
    from: "documents/finance/statements/README.md",
    to: "documents/finance/budget/statements/README.md",
    reason: "Move Budget source evidence folder contract under the Budget app.",
  });
  await addCopyIfSourceExists(memoryRoot, items, {
    from: "documents/finance/reports/README.md",
    to: "documents/finance/budget/reports/README.md",
    reason: "Move Budget report folder contract under the Budget app.",
  });
  await addCopyIfSourceExists(memoryRoot, items, {
    from: "documents/finance/reports/latest.md",
    to: "documents/finance/budget/reports/latest.md",
    reason: "Move latest Budget comparison output under the Budget app.",
  });

  for (const legacyPath of LEGACY_FINANCE_PATHS) {
    if (!existsSync(resolveMemoryPath(memoryRoot, legacyPath))) {
      continue;
    }
    if (items.some((item) => item.from_path === legacyPath)) {
      continue;
    }
    items.push({
      from_path: legacyPath,
      to_path: `${ARCHIVE_ROOT}/${legacyPath}`,
      action: "owner_review",
      reason: "Legacy content may be useful but does not have a deterministic Draft 3 destination.",
    });
  }

  return {
    schema_version: 1,
    transition_id: TRANSITION_ID,
    detected_layout: detectedLayout,
    items,
    review_paths: items.filter((item) => item.action === "owner_review").map((item) => item.from_path),
    generated_at: new Date().toISOString(),
  };
}

export async function applyAlphaDraft3Transition(memoryRoot: string): Promise<AlphaDraft3TransitionResult> {
  const plan = await buildAlphaDraft3TransitionPlan(memoryRoot);
  if (plan.items.length === 0) {
    return {
      transition_id: TRANSITION_ID,
      applied_paths: [],
      archived_paths: [],
      review_paths: [],
      backup_path: null,
      plan_path: "",
      report_path: "",
    };
  }

  const planPath = resolveMemoryPath(memoryRoot, PLAN_PATH);
  await mkdir(path.dirname(planPath), { recursive: true });
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  const applicable = plan.items.filter((item) => item.action === "copy" && item.to_path);
  const backupPath = applicable.length > 0 || plan.review_paths.length > 0
    ? await createTransitionBackup(memoryRoot)
    : null;
  const appliedPaths: string[] = [];
  const archivedPaths: string[] = [];

  for (const item of applicable) {
    if (!item.to_path) {
      continue;
    }
    const sourcePath = resolveMemoryPath(memoryRoot, item.from_path);
    const targetPath = resolveMemoryPath(memoryRoot, item.to_path);
    if (existsSync(targetPath)) {
      continue;
    }
    const content = await readFile(sourcePath, "utf8");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, normalizeFileContent(content), "utf8");
    appliedPaths.push(item.to_path);
  }

  for (const legacyPath of LEGACY_FINANCE_PATHS) {
    const sourcePath = resolveMemoryPath(memoryRoot, legacyPath);
    if (!existsSync(sourcePath)) {
      continue;
    }
    const archiveRelativePath = `${ARCHIVE_ROOT}/${legacyPath}`;
    const archivePath = resolveMemoryPath(memoryRoot, archiveRelativePath);
    await mkdir(path.dirname(archivePath), { recursive: true });
    await writeFile(archivePath, await readFile(sourcePath, "utf8"), "utf8");
    await rm(sourcePath, { force: true });
    archivedPaths.push(archiveRelativePath);
  }

  const reportPath = await writeTransitionReport(memoryRoot, plan, {
    appliedPaths,
    archivedPaths,
    backupPath,
  });

  if (appliedPaths.length > 0 || archivedPaths.length > 0) {
    await commitMemoryChange(memoryRoot, "Apply Draft 3 memory transition").catch(() => undefined);
  }

  return {
    transition_id: TRANSITION_ID,
    applied_paths: appliedPaths,
    archived_paths: archivedPaths,
    review_paths: plan.review_paths,
    backup_path: backupPath,
    plan_path: PLAN_PATH,
    report_path: reportPath,
  };
}

function detectFinanceLayout(memoryRoot: string): AlphaDraft3TransitionPlan["detected_layout"] {
  if (existsSync(resolveMemoryPath(memoryRoot, "documents/finance/budget/budget.md"))) {
    return "draft3_or_later";
  }
  if (
    existsSync(resolveMemoryPath(memoryRoot, "documents/finance/budget.md")) ||
    existsSync(resolveMemoryPath(memoryRoot, "documents/finance/budgeting/index.md"))
  ) {
    return "pre_draft3_finance";
  }
  return "unknown_or_not_seeded";
}

async function addCopyIfSourceExists(
  memoryRoot: string,
  items: AlphaDraft3TransitionItem[],
  input: {
    from: string;
    to: string;
    reason: string;
  }
): Promise<void> {
  if (!existsSync(resolveMemoryPath(memoryRoot, input.from))) {
    return;
  }

  items.push({
    from_path: input.from,
    to_path: input.to,
    action: existsSync(resolveMemoryPath(memoryRoot, input.to)) ? "no_change" : "copy",
    reason: input.reason,
  });
}

async function createTransitionBackup(memoryRoot: string): Promise<string> {
  const backupPath = resolveMemoryPath(memoryRoot, BACKUP_PATH);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await exportMemoryArchive(memoryRoot, backupPath);
  return BACKUP_PATH;
}

async function writeTransitionReport(
  memoryRoot: string,
  plan: AlphaDraft3TransitionPlan,
  result: {
    appliedPaths: string[];
    archivedPaths: string[];
    backupPath: string | null;
  }
): Promise<string> {
  const reportPath = resolveMemoryPath(memoryRoot, REPORT_PATH);
  const lines = [
    "# Draft 3 Memory Transition",
    "",
    `Detected layout: ${plan.detected_layout}`,
    `Generated at: ${new Date().toISOString()}`,
    "",
    "BrainDrive updated Finance memory structure to support managed base files plus owner overlays.",
    "",
    "## Applied",
    "",
    ...(result.appliedPaths.length > 0
      ? result.appliedPaths.map((entry) => `- ${entry}`)
      : ["- No Draft 3 files needed to be created."]),
    "",
    "## Archived Legacy Paths",
    "",
    ...(result.archivedPaths.length > 0
      ? result.archivedPaths.map((entry) => `- ${entry}`)
      : ["- No legacy paths were archived."]),
    "",
    "## Owner Review",
    "",
    ...(plan.review_paths.length > 0
      ? plan.review_paths.map((entry) => `- Review legacy content from ${entry} in the transition archive.`)
      : ["- No legacy paths require owner review."]),
    "",
    "## Backup",
    "",
    result.backupPath ? `- Backup created at \`${result.backupPath}\`.` : "- No backup was needed.",
    "",
  ];
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, lines.join("\n"), "utf8");
  return REPORT_PATH;
}

function normalizeFileContent(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}
