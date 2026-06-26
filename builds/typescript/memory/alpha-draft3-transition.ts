import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

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
const ACTIVE_BUDGET_ROOT = "documents/finance/budget";
const RETIRED_BUDGET_ARCHIVE_ROOT = "documents/finance/archive/retired-budget";
const RETIRED_BUDGET_README = `${RETIRED_BUDGET_ARCHIVE_ROOT}/README.md`;

const PRE_DRAFT_BUDGET_ARCHIVE_PATHS = [
  {
    from: "documents/finance/budget.md",
    to: `${RETIRED_BUDGET_ARCHIVE_ROOT}/pre-draft/budget.md`,
  },
  {
    from: "documents/finance/rules.md",
    to: `${RETIRED_BUDGET_ARCHIVE_ROOT}/pre-draft/rules.md`,
  },
  {
    from: "documents/finance/budgeting/first-pass-budget.md",
    to: `${RETIRED_BUDGET_ARCHIVE_ROOT}/pre-draft/budgeting/first-pass-budget.md`,
  },
  {
    from: "documents/finance/budgeting/monthly-comparison.md",
    to: `${RETIRED_BUDGET_ARCHIVE_ROOT}/pre-draft/budgeting/monthly-comparison.md`,
  },
  {
    from: "documents/finance/budgeting/source-evidence.md",
    to: `${RETIRED_BUDGET_ARCHIVE_ROOT}/pre-draft/budgeting/source-evidence.md`,
  },
  {
    from: "documents/finance/budgeting/report-contract.md",
    to: `${RETIRED_BUDGET_ARCHIVE_ROOT}/pre-draft/budgeting/report-contract.md`,
  },
  {
    from: "documents/finance/budgeting/saved-budget-rules.md",
    to: `${RETIRED_BUDGET_ARCHIVE_ROOT}/pre-draft/budgeting/saved-budget-rules.md`,
  },
  {
    from: "documents/finance/budgeting/index.md",
    to: `${RETIRED_BUDGET_ARCHIVE_ROOT}/pre-draft/budgeting/index.md`,
  },
  {
    from: "documents/finance/statements/README.md",
    to: `${RETIRED_BUDGET_ARCHIVE_ROOT}/pre-draft/statements/README.md`,
  },
  {
    from: "documents/finance/reports/README.md",
    to: `${RETIRED_BUDGET_ARCHIVE_ROOT}/pre-draft/reports/README.md`,
  },
  {
    from: "documents/finance/reports/latest.md",
    to: `${RETIRED_BUDGET_ARCHIVE_ROOT}/pre-draft/reports/latest.md`,
  },
] as const;

export async function buildAlphaDraft3TransitionPlan(memoryRoot: string): Promise<AlphaDraft3TransitionPlan> {
  const detectedLayout = detectFinanceLayout(memoryRoot);
  const items: AlphaDraft3TransitionItem[] = [];

  const activeBudgetFiles = await collectRelativeFiles(memoryRoot, ACTIVE_BUDGET_ROOT);
  for (const activeBudgetFile of activeBudgetFiles) {
    items.push({
      from_path: activeBudgetFile,
      to_path: retiredBudgetTargetForActivePath(activeBudgetFile),
      action: "archive",
      reason: "Archive retired Finance Budget app content as historical owner data.",
    });
  }

  for (const legacyPath of PRE_DRAFT_BUDGET_ARCHIVE_PATHS) {
    await addArchiveIfSourceExists(memoryRoot, items, {
      ...legacyPath,
      reason: "Archive retired pre-Draft-3 Budgetting content as historical owner data.",
    });
  }

  return {
    schema_version: 1,
    transition_id: TRANSITION_ID,
    detected_layout: detectedLayout,
    items,
    review_paths: items
      .filter((item) => item.action === "archive" && item.to_path)
      .map((item) => item.to_path as string),
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

  const archiveItems = plan.items.filter((item) => item.action === "archive" && item.to_path);
  const backupPath = plan.review_paths.length > 0
    ? await createTransitionBackup(memoryRoot)
    : null;
  const appliedPaths: string[] = [];
  const archivedPaths: string[] = [];

  for (const item of archiveItems) {
    if (!item.to_path) {
      continue;
    }
    const sourcePath = resolveMemoryPath(memoryRoot, item.from_path);
    if (!existsSync(sourcePath)) {
      continue;
    }
    const content = await readFile(sourcePath);
    const archiveRelativePath = await resolveArchiveTarget(memoryRoot, item.to_path, content, item.from_path);
    const archivePath = resolveMemoryPath(memoryRoot, archiveRelativePath);
    if (!existsSync(archivePath)) {
      await mkdir(path.dirname(archivePath), { recursive: true });
      await writeFile(archivePath, content);
    }
    await rm(sourcePath, { force: true });
    archivedPaths.push(archiveRelativePath);
  }

  if (archiveItems.length > 0) {
    await rm(resolveMemoryPath(memoryRoot, ACTIVE_BUDGET_ROOT), { recursive: true, force: true });
    if (!existsSync(resolveMemoryPath(memoryRoot, RETIRED_BUDGET_README))) {
      await mkdir(path.dirname(resolveMemoryPath(memoryRoot, RETIRED_BUDGET_README)), { recursive: true });
      await writeFile(resolveMemoryPath(memoryRoot, RETIRED_BUDGET_README), retiredBudgetReadme(), "utf8");
      archivedPaths.push(RETIRED_BUDGET_README);
    }
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

async function addArchiveIfSourceExists(
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

  if (items.some((item) => item.from_path === input.from)) {
    return;
  }

  items.push({
    from_path: input.from,
    to_path: input.to,
    action: "archive",
    reason: input.reason,
  });
}

async function collectRelativeFiles(memoryRoot: string, relativeRoot: string): Promise<string[]> {
  const absoluteRoot = resolveMemoryPath(memoryRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) {
    return [];
  }

  const files: string[] = [];
  const visit = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(absoluteDirectory, entry.name);
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath.replace(/\\/g, "/"));
      }
    }
  };

  await visit(absoluteRoot, relativeRoot);
  return files;
}

function retiredBudgetTargetForActivePath(relativePath: string): string {
  const activeRelativePath = relativePath.slice(`${ACTIVE_BUDGET_ROOT}/`.length);
  const archiveRelativePath = activeRelativePath === "README.md" ? "original-README.md" : activeRelativePath;
  return `${RETIRED_BUDGET_ARCHIVE_ROOT}/${archiveRelativePath}`;
}

async function resolveArchiveTarget(
  memoryRoot: string,
  preferredTarget: string,
  content: Buffer,
  sourcePath: string
): Promise<string> {
  const targetPath = resolveMemoryPath(memoryRoot, preferredTarget);
  if (!existsSync(targetPath)) {
    return preferredTarget;
  }

  const existing = await readFile(targetPath);
  if (existing.equals(content)) {
    return preferredTarget;
  }

  return `${RETIRED_BUDGET_ARCHIVE_ROOT}/conflicts/${sourcePath}`;
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
    "BrainDrive archived retired Finance Budgetting files so they remain available as historical owner data without recreating the active Budget app.",
    "",
    "## Active Draft 3 Files Created",
    "",
    ...(result.appliedPaths.length > 0
      ? result.appliedPaths.map((entry) => `- ${entry}`)
      : ["- No active Budget app paths were created."]),
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
      ? plan.review_paths.map((entry) => `- Review archived historical Budgetting content at ${entry}.`)
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

function retiredBudgetReadme(): string {
  return [
    "# Retired Budgetting Archive",
    "",
    "Budgetting was retired as a built-in Finance execution app.",
    "",
    "Files in this folder are historical owner data preserved from earlier BrainDrive versions. They are not active Finance app templates, managed base files, generated reports, or default Finance chat context.",
    "",
  ].join("\n");
}
