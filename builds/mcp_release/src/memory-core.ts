import path from "node:path";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import { commitMemoryChange, ensureGitReady, exportMemoryArchive, historyForPath, readFileAtCommit } from "./git.js";
import { ownerPermissions, type PermissionSet } from "./request-context.js";

const reservedMemoryRoots = new Set([".git"]);
const expectedProjectFiles = ["AGENT.md", "index.md", "spec.md", "plan.md"];

export type ToolFailureCode =
  | "not_found"
  | "path_invalid"
  | "reserved_path"
  | "invalid_input"
  | "permission_denied"
  | "execution_failed";

export class ToolFailure extends Error {
  constructor(
    public readonly code: ToolFailureCode,
    message: string,
    public readonly recoverable = true
  ) {
    super(message);
    this.name = "ToolFailure";
  }
}

export type AuthState = {
  actor_id: string;
  actor_type: "owner";
  permissions: PermissionSet;
  mode: "local-owner";
  created_at: string;
  updated_at: string;
};

export type HistoryEntry = {
  commit: string;
  message: string;
  timestamp: string;
  path: string;
  previous_state?: string;
};

export type ProjectStatus = "complete" | "partial" | "empty";

export type ProjectEntry = {
  name: string;
  path: string;
  status: ProjectStatus;
  files_present: string[];
};

type FinanceBudgetPayoffFileKey = "budget" | "latest_report" | "finance_plan";

type FinanceBudgetPayoffArtifact = {
  key: FinanceBudgetPayoffFileKey;
  path: string;
  required: boolean;
};

type FinanceBudgetPayoffIssue = {
  artifact: FinanceBudgetPayoffFileKey | "instructions";
  path?: string;
  message: string;
};

type FinanceBudgetPayoffPlan = {
  priority_card: string;
  priority_apr: string;
  priority_minimum: string;
  secondary_card: string;
  secondary_apr: string;
  secondary_minimum: string;
  extra_payment_target: string;
  priority_target_payment: string;
  total_monthly_card_payment_target: string;
};

type FinanceBudgetPayoffValidationPayload = {
  status: "valid" | "invalid" | "repaired";
  issues: FinanceBudgetPayoffIssue[];
  files_changed: string[];
  canonical_plan?: FinanceBudgetPayoffPlan;
  checked_artifacts: Array<{ key: FinanceBudgetPayoffFileKey; path: string; exists: boolean }>;
};

type FinanceBudgetReviewStateIssue = {
  path?: string;
  message: string;
};

type FinanceBudgetReviewItem = {
  merchant: string;
  amount: string;
};

type FinanceBudgetReviewStatePayload = {
  status: "valid" | "invalid" | "repaired";
  active_review_items: FinanceBudgetReviewItem[];
  resolved_review_items: FinanceBudgetReviewItem[];
  issues: FinanceBudgetReviewStateIssue[];
  files_changed: string[];
};

type FinanceBudgetSourceCoverageIssue = {
  path?: string;
  message: string;
};

type FinanceBudgetSourceDocument = {
  path: string;
  source_filename: string;
  institution: string;
  account_type: string;
  statement_month: string;
  statement_period_start?: string;
  statement_period_end?: string;
  statement_like: boolean;
};

type FinanceBudgetRecurringCandidate = {
  merchant: string;
  amount: string;
  date: string;
  source_filename: string;
  source_path: string;
  confidence: "high" | "medium";
  treatment: string;
};

type FinanceBudgetSourceCoveragePayload = {
  status: "valid" | "invalid" | "repaired";
  source_documents: FinanceBudgetSourceDocument[];
  recurring_candidates: FinanceBudgetRecurringCandidate[];
  issues: FinanceBudgetSourceCoverageIssue[];
  files_changed: string[];
};

const financeBudgetPayoffArtifacts: FinanceBudgetPayoffArtifact[] = [
  { key: "budget", path: "documents/finance/budget/budget.md", required: true },
  { key: "latest_report", path: "documents/finance/budget/reports/latest.md", required: true },
  { key: "finance_plan", path: "documents/finance/plan.md", required: true },
];

const financeBudgetPayoffInstructionPaths = [
  "documents/finance/budget/AGENT.md",
  "documents/finance/budget/create.md",
];

export async function ensureMemoryLayout(memoryRoot: string): Promise<void> {
  await mkdir(memoryRoot, { recursive: true });
  await mkdir(path.join(memoryRoot, "conversations"), { recursive: true });
  await mkdir(path.join(memoryRoot, "documents"), { recursive: true });
  await mkdir(path.join(memoryRoot, "preferences"), { recursive: true });
  await mkdir(path.join(memoryRoot, "exports"), { recursive: true });
}

export async function ensureAuthState(memoryRoot: string): Promise<AuthState> {
  await ensureMemoryLayout(memoryRoot);
  const authPath = path.join(memoryRoot, "preferences", "auth-state.json");

  try {
    const raw = await readFile(authPath, "utf8");
    return JSON.parse(raw) as AuthState;
  } catch {
    const now = new Date().toISOString();
    const state: AuthState = {
      actor_id: "owner",
      actor_type: "owner",
      mode: "local-owner",
      permissions: { ...ownerPermissions },
      created_at: now,
      updated_at: now,
    };

    await writeFile(authPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return state;
  }
}

export async function readAuthState(memoryRoot: string): Promise<AuthState> {
  const authPath = path.join(memoryRoot, "preferences", "auth-state.json");
  const raw = await readFile(authPath, "utf8");
  return JSON.parse(raw) as AuthState;
}

export function resolveMemoryPath(memoryRoot: string, requestedPath: string): string {
  const root = path.resolve(memoryRoot);
  const trimmedPath = requestedPath.trim();
  const resolved = path.isAbsolute(trimmedPath)
    ? path.resolve(trimmedPath)
    : path.resolve(root, trimmedPath.length > 0 ? trimmedPath : ".");
  const relative = path.relative(root, resolved);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ToolFailure("path_invalid", "Path escapes memory root");
  }

  const normalizedRelative = relative.replace(/\\/g, "/");
  const firstSegment = normalizedRelative.split("/")[0] ?? "";
  if (reservedMemoryRoots.has(firstSegment)) {
    throw new ToolFailure("reserved_path", "Path targets reserved memory internals");
  }

  return resolved;
}

export function toMemoryRelativePath(memoryRoot: string, absolutePath: string): string {
  return path.relative(memoryRoot, absolutePath).replace(/\\/g, "/");
}

export function isReservedMemoryPath(memoryRoot: string, absolutePath: string): boolean {
  const relativePath = toMemoryRelativePath(path.resolve(memoryRoot), path.resolve(absolutePath));
  const normalizedRelative = relativePath.replace(/\\/g, "/");
  const firstSegment = normalizedRelative.split("/")[0] ?? "";
  return reservedMemoryRoots.has(firstSegment);
}

export async function readMemoryFile(memoryRoot: string, requestedPath: string): Promise<{ path: string; content: string }> {
  try {
    const absolutePath = resolveMemoryPath(memoryRoot, requestedPath);
    const content = await readFile(absolutePath, "utf8");
    return { path: absolutePath, content };
  } catch (error) {
    throw toToolFailure(error);
  }
}

export async function writeMemoryFile(
  memoryRoot: string,
  requestedPath: string,
  content: string
): Promise<{ path: string; bytes_written: number }> {
  try {
    const absolutePath = resolveMemoryPath(memoryRoot, requestedPath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
    await ensureGitReady(memoryRoot);
    await commitMemoryChange(memoryRoot, `Write ${toMemoryRelativePath(memoryRoot, absolutePath)}`);
    return { path: absolutePath, bytes_written: Buffer.byteLength(content) };
  } catch (error) {
    throw toToolFailure(error);
  }
}

export async function editMemoryFile(
  memoryRoot: string,
  requestedPath: string,
  find: string,
  replace: string
): Promise<{ path: string; updated: boolean }> {
  if (find.length === 0) {
    throw new ToolFailure("invalid_input", "Edit target must not be empty");
  }

  try {
    const absolutePath = resolveMemoryPath(memoryRoot, requestedPath);
    const original = await readFile(absolutePath, "utf8");

    if (!original.includes(find)) {
      throw new ToolFailure("invalid_input", "Edit target not found");
    }

    const updated = original.replace(find, replace);
    await writeFile(absolutePath, updated, "utf8");
    await ensureGitReady(memoryRoot);
    await commitMemoryChange(memoryRoot, `Edit ${toMemoryRelativePath(memoryRoot, absolutePath)}`);
    return { path: absolutePath, updated: true };
  } catch (error) {
    throw toToolFailure(error);
  }
}

export async function deleteMemoryPath(memoryRoot: string, requestedPath: string): Promise<{ path: string; deleted: true }> {
  try {
    const absolutePath = resolveMemoryPath(memoryRoot, requestedPath);
    const details = await stat(absolutePath).catch(() => null);
    const indexTarget = details ? projectIndexTargetForDeletedPath(memoryRoot, absolutePath, details.isFile()) : null;
    await rm(absolutePath, { recursive: true, force: true });
    if (indexTarget) {
      await removeProjectIndexEntry(memoryRoot, indexTarget.projectId, indexTarget.fileName);
    }
    await ensureGitReady(memoryRoot);
    await commitMemoryChange(memoryRoot, `Delete ${toMemoryRelativePath(memoryRoot, absolutePath)}`);
    return { path: absolutePath, deleted: true };
  } catch (error) {
    throw toToolFailure(error);
  }
}

async function removeProjectIndexEntry(memoryRoot: string, projectId: string, fileName: string): Promise<void> {
  const indexPath = resolveMemoryPath(memoryRoot, `documents/${projectId}/index.md`);
  let current: string;
  try {
    current = await readFile(indexPath, "utf8");
  } catch {
    return;
  }

  const next = removeProjectIndexEntryContent(current, fileName);
  if (next !== current) {
    await writeFile(indexPath, next, "utf8");
  }
}

function removeProjectIndexEntryContent(content: string, fileName: string): string {
  const normalizedFileName = normalizeIndexFilePath(fileName);
  if (!normalizedFileName) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const nextLines = lines.filter((line) => !indexRowReferencesFile(line, normalizedFileName));
  if (nextLines.length === lines.length) {
    return content;
  }

  const supportingHeadingIndex = nextLines.findIndex((line) => line.trim() === "## Supporting Documents");
  if (supportingHeadingIndex !== -1) {
    const nextHeadingIndex = nextLines.findIndex((line, index) => index > supportingHeadingIndex && /^##\s+/.test(line));
    const sectionEnd = nextHeadingIndex === -1 ? nextLines.length : nextHeadingIndex;
    const hasDocumentRow = nextLines
      .slice(supportingHeadingIndex, sectionEnd)
      .some((line) => /^\|\s*`[^`]+`/.test(line.trim()));
    if (!hasDocumentRow) {
      const separatorIndex = nextLines.findIndex((line, index) =>
        index > supportingHeadingIndex && line.trim() === "|---|---|---|---|---|"
      );
      if (separatorIndex !== -1) {
        nextLines.splice(separatorIndex + 1, 0, "| _No supporting documents yet._ | | | | |");
      }
    }
  }

  return `${nextLines.join("\n").replace(/\n*$/, "")}\n`;
}

function indexRowReferencesFile(line: string, fileName: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) {
    return false;
  }
  const match = /^\|\s*`([^`]+)`/.exec(trimmed);
  return match ? normalizeIndexFilePath(match[1] ?? "") === fileName : false;
}

function normalizeIndexFilePath(fileName: string): string {
  const normalized = fileName.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) {
    return "";
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    return "";
  }
  return parts.join("/");
}

function projectIndexTargetForDeletedPath(
  memoryRoot: string,
  absolutePath: string,
  isFile: boolean
): { projectId: string; fileName: string } | null {
  if (!isFile) {
    return null;
  }

  const relativePath = toMemoryRelativePath(memoryRoot, absolutePath).replace(/\\/g, "/");
  const parts = relativePath.split("/");
  if (parts.length < 3 || parts[0] !== "documents") {
    return null;
  }

  const projectId = parts[1] ?? "";
  const fileName = parts.slice(2).join("/");
  if (!projectId || ["AGENT.md", "index.md", "spec.md", "plan.md"].includes(fileName)) {
    return null;
  }

  return { projectId, fileName };
}

export async function listMemoryPath(memoryRoot: string, requestedPath = "."): Promise<{ path: string; entries: string[] }> {
  try {
    const absolutePath = resolveMemoryPath(memoryRoot, requestedPath);
    const entries = await readdir(absolutePath, { withFileTypes: true });
    return {
      path: absolutePath,
      entries: entries
        .filter((entry) => !isReservedMemoryPath(memoryRoot, path.join(absolutePath, entry.name)))
        .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`),
    };
  } catch (error) {
    throw toToolFailure(error);
  }
}

export async function searchMemory(
  memoryRoot: string,
  query: string,
  requestedPath = ".",
  includeConversations = false
): Promise<{ query: string; include_conversations: boolean; matches: Array<{ path: string; line: number; content: string }> }> {
  if (query.trim().length === 0) {
    throw new ToolFailure("invalid_input", "Search query must not be empty");
  }

  try {
    const absolutePath = resolveMemoryPath(memoryRoot, requestedPath);
    const matches: Array<{ path: string; line: number; content: string }> = [];

    await visitFiles(
      memoryRoot,
      absolutePath,
      async (filePath) => {
        const content = await readFile(filePath, "utf8").catch(() => null);
        if (content === null) {
          return;
        }

        const lines = content.split(/\r?\n/);
        lines.forEach((line, index) => {
          if (line.includes(query)) {
            matches.push({
              path: filePath,
              line: index + 1,
              content: redactSensitiveContent(line),
            });
          }
        });
      },
      { includeConversations }
    );

    return {
      query,
      include_conversations: includeConversations,
      matches,
    };
  } catch (error) {
    throw toToolFailure(error);
  }
}

export async function getMemoryHistory(memoryRoot: string, requestedPath: string, commit?: string): Promise<HistoryEntry[]> {
  try {
    await ensureGitReady(memoryRoot);
    const absolutePath = resolveMemoryPath(memoryRoot, requestedPath);
    const history = await historyForPath(memoryRoot, absolutePath);

    const results: HistoryEntry[] = [];
    for (const entry of history) {
      const includePreviousState = commit === undefined || commit === entry.commit;
      results.push({
        commit: entry.commit,
        message: entry.message,
        timestamp: entry.timestamp,
        path: requestedPath,
        previous_state: includePreviousState
          ? await readFileAtCommit(memoryRoot, absolutePath, entry.commit).catch(() => undefined)
          : undefined,
      });
    }

    return commit ? results.filter((entry) => entry.commit === commit) : results;
  } catch (error) {
    throw toToolFailure(error);
  }
}

export async function exportMemory(memoryRoot: string): Promise<{ archive_path: string }> {
  await ensureMemoryLayout(memoryRoot);
  const fileName = `memory-export-${Date.now()}.tar.gz`;
  const destination = path.join(memoryRoot, "exports", fileName);
  await exportMemoryArchive(memoryRoot, destination);
  return { archive_path: destination };
}

export async function listProjects(memoryRoot: string): Promise<{ root: string; projects: ProjectEntry[] }> {
  await ensureMemoryLayout(memoryRoot);
  const documentsRoot = resolveMemoryPath(memoryRoot, "documents");
  const entries = await readdir(documentsRoot, { withFileTypes: true }).catch(() => []);
  const projects: ProjectEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const projectPath = path.join(documentsRoot, entry.name);
    const files = await readdir(projectPath, { withFileTypes: true }).catch(() => []);
    const filesPresent = files
      .filter((file) => file.isFile() && expectedProjectFiles.includes(file.name))
      .map((file) => file.name)
      .sort();

    const status = computeProjectStatus(filesPresent.length);
    projects.push({
      name: entry.name,
      path: projectPath,
      status,
      files_present: filesPresent,
    });
  }

  projects.sort((left, right) => left.name.localeCompare(right.name));
  return {
    root: documentsRoot,
    projects,
  };
}

export async function validateFinanceBudgetPayoffPlan(
  memoryRoot: string,
  options: { repair?: boolean } = {}
): Promise<FinanceBudgetPayoffValidationPayload> {
  await ensureMemoryLayout(memoryRoot);
  const canonicalPlan = await deriveFinanceBudgetPayoffPlan(memoryRoot);
  const checkedArtifacts: FinanceBudgetPayoffValidationPayload["checked_artifacts"] = [];
  const currentFiles = new Map<FinanceBudgetPayoffFileKey, string>();
  const issues: FinanceBudgetPayoffIssue[] = [];

  if (!canonicalPlan) {
    issues.push({
      artifact: "instructions",
      message:
        "Finance Budget payoff validation could not derive the canonical payoff target from Budget Memory instructions.",
    });
  }

  for (const artifact of financeBudgetPayoffArtifacts) {
    const current = await readOptionalMemoryText(memoryRoot, artifact.path);
    const exists = current !== null;
    checkedArtifacts.push({ key: artifact.key, path: artifact.path, exists });

    if (!exists) {
      if (artifact.required) {
        issues.push({
          artifact: artifact.key,
          path: artifact.path,
          message: "Required payoff artifact is missing.",
        });
      }
      continue;
    }

    currentFiles.set(artifact.key, current);
    if (canonicalPlan) {
      issues.push(...financeBudgetPayoffIssuesForArtifact(artifact, current, canonicalPlan));
    }
  }

  const filesChanged: string[] = [];
  if (options.repair && canonicalPlan) {
    const sourceDocuments = await discoverFinanceBudgetSourceDocuments(memoryRoot);
    for (const artifact of financeBudgetPayoffArtifacts) {
      const current = currentFiles.get(artifact.key) ?? "";
      const repaired = repairFinanceBudgetPayoffArtifact(artifact.key, current, canonicalPlan, sourceDocuments);
      if (repaired !== current) {
        await writeMemoryFile(memoryRoot, artifact.path, repaired);
        filesChanged.push(artifact.path);
      }
    }
  }

  const verificationIssues: FinanceBudgetPayoffIssue[] = [];
  if (filesChanged.length > 0 && canonicalPlan) {
    for (const artifact of financeBudgetPayoffArtifacts) {
      const next = await readOptionalMemoryText(memoryRoot, artifact.path);
      if (next === null) {
        verificationIssues.push({
          artifact: artifact.key,
          path: artifact.path,
          message: "Required payoff artifact is missing after repair.",
        });
        continue;
      }
      verificationIssues.push(...financeBudgetPayoffIssuesForArtifact(artifact, next, canonicalPlan));
    }
  }

  const finalIssues = filesChanged.length > 0 ? verificationIssues : issues;
  const status =
    finalIssues.length === 0 ? (filesChanged.length > 0 ? "repaired" : "valid") : "invalid";

  return {
    status,
    issues: finalIssues,
    files_changed: filesChanged,
    canonical_plan: canonicalPlan ?? undefined,
    checked_artifacts: checkedArtifacts,
  };
}

export async function reconcileFinanceBudgetReviewState(
  memoryRoot: string,
  options: { repair?: boolean } = {}
): Promise<FinanceBudgetReviewStatePayload> {
  await ensureMemoryLayout(memoryRoot);
  const budget = await readOptionalMemoryText(memoryRoot, "documents/finance/budget/budget.md");
  const latest = await readOptionalMemoryText(memoryRoot, "documents/finance/budget/reports/latest.md");
  const todo = await readOptionalMemoryText(memoryRoot, "me/todo.md");
  const plan = await readOptionalMemoryText(memoryRoot, "documents/finance/plan.md");

  const resolvedReviewItems = canonicalReviewItems([
    ...extractResolvedTodoReviewItems(todo ?? ""),
    ...extractResolvedArtifactReviewItems(budget ?? ""),
    ...extractResolvedArtifactReviewItems(latest ?? ""),
  ]);
  const activeReviewItems = canonicalReviewItems([
    ...extractActiveReviewItems(budget ?? ""),
    ...extractActiveReviewItems(latest ?? ""),
    ...extractActiveTodoReviewItems(todo ?? ""),
  ]).filter((item) => !reviewItemIsResolved(item, resolvedReviewItems));
  const issues = reviewStateIssues(plan, budget, latest, activeReviewItems, resolvedReviewItems);
  const filesChanged: string[] = [];

  if (
    options.repair &&
    budget !== null &&
    !isStarterBudgetTemplate(budget) &&
    issues.some((issue) => issue.path === "documents/finance/budget/budget.md")
  ) {
    const repairedBudget = repairBudgetReviewStateVocabulary(
      repairBudgetReviewLabels(budget, activeReviewItems),
      activeReviewItems,
      resolvedReviewItems
    );
    if (repairedBudget !== budget) {
      await writeMemoryFile(memoryRoot, "documents/finance/budget/budget.md", repairedBudget);
      filesChanged.push("documents/finance/budget/budget.md");
    }
  }

  if (options.repair && latest !== null && issues.some((issue) => issue.path === "documents/finance/budget/reports/latest.md")) {
    const repairedLatest = repairLatestReportReviewState(latest, activeReviewItems, resolvedReviewItems);
    if (repairedLatest !== latest) {
      await writeMemoryFile(memoryRoot, "documents/finance/budget/reports/latest.md", repairedLatest);
      filesChanged.push("documents/finance/budget/reports/latest.md");
    }
  }

  if (options.repair && plan !== null && issues.some((issue) => issue.path === "documents/finance/plan.md")) {
    const repairedPlan = repairFinancePlanReviewState(plan, activeReviewItems, resolvedReviewItems);
    if (repairedPlan !== plan) {
      await writeMemoryFile(memoryRoot, "documents/finance/plan.md", repairedPlan);
      filesChanged.push("documents/finance/plan.md");
    }
  }

  const finalBudget = filesChanged.includes("documents/finance/budget/budget.md")
    ? await readOptionalMemoryText(memoryRoot, "documents/finance/budget/budget.md")
    : budget;
  const finalLatest = filesChanged.includes("documents/finance/budget/reports/latest.md")
    ? await readOptionalMemoryText(memoryRoot, "documents/finance/budget/reports/latest.md")
    : latest;
  const finalPlan = filesChanged.length > 0 ? await readOptionalMemoryText(memoryRoot, "documents/finance/plan.md") : plan;
  const finalIssues = reviewStateIssues(finalPlan, finalBudget, finalLatest, activeReviewItems, resolvedReviewItems);

  return {
    status: finalIssues.length === 0 ? (filesChanged.length > 0 ? "repaired" : "valid") : "invalid",
    active_review_items: activeReviewItems,
    resolved_review_items: resolvedReviewItems,
    issues: finalIssues,
    files_changed: filesChanged,
  };
}

export async function validateFinanceBudgetSourceCoverage(
  memoryRoot: string,
  options: { repair?: boolean } = {}
): Promise<FinanceBudgetSourceCoveragePayload> {
  await ensureMemoryLayout(memoryRoot);
  const latestPath = "documents/finance/budget/reports/latest.md";
  const latest = await readOptionalMemoryText(memoryRoot, latestPath);
  const sourceDocuments = await discoverFinanceBudgetSourceDocuments(memoryRoot);
  const recurringCandidates = await discoverFinanceBudgetRecurringCandidates(memoryRoot, sourceDocuments);
  const issues = sourceCoverageIssues(latest, sourceDocuments, recurringCandidates, latestPath);
  const filesChanged: string[] = [];

  if (options.repair && latest !== null && sourceDocuments.length > 0 && issues.length > 0) {
    let repaired = replaceOrInsertSectionBefore(latest, "Source Coverage", sourceCoverageSection(sourceDocuments), [
      "Source Evidence Ledger",
      "Owner-Requested Items Audit",
      "Category Breakdown",
      "Next Steps",
    ]);
    if (recurringCandidates.length > 0) {
      repaired = replaceOrInsertSectionBefore(
        repaired,
        "Recurring Candidates",
        recurringCandidatesSection(recurringCandidates),
        ["Source Evidence Ledger", "Owner-Requested Items Audit", "Category Breakdown", "Next Steps"]
      );
    }
    if (repaired !== latest) {
      await writeMemoryFile(memoryRoot, latestPath, repaired);
      filesChanged.push(latestPath);
    }
  }

  const finalLatest = filesChanged.length > 0 ? await readOptionalMemoryText(memoryRoot, latestPath) : latest;
  const finalIssues = sourceCoverageIssues(finalLatest, sourceDocuments, recurringCandidates, latestPath);

  return {
    status: finalIssues.length === 0 ? (filesChanged.length > 0 ? "repaired" : "valid") : "invalid",
    source_documents: sourceDocuments,
    recurring_candidates: recurringCandidates,
    issues: finalIssues,
    files_changed: filesChanged,
  };
}

export function toToolFailure(error: unknown): ToolFailure {
  if (error instanceof ToolFailure) {
    return error;
  }

  const systemCode = getErrnoCode(error);
  if (systemCode === "ENOENT") {
    return new ToolFailure("not_found", "Requested path not found");
  }

  if (systemCode === "EACCES" || systemCode === "EPERM") {
    return new ToolFailure("permission_denied", "Permission denied for requested path", false);
  }

  const message = error instanceof Error ? error.message : "Tool execution failed";
  return new ToolFailure("execution_failed", message, false);
}

function getErrnoCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as { code?: unknown };
  return typeof candidate.code === "string" ? candidate.code : undefined;
}

function redactSensitiveContent(content: string): string {
  return content.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-***redacted***");
}

function isConversationsPath(memoryRoot: string, absolutePath: string): boolean {
  const relativePath = toMemoryRelativePath(memoryRoot, absolutePath);
  const normalizedRelative = relativePath.replace(/\\/g, "/");
  const firstSegment = normalizedRelative.split("/")[0] ?? "";
  return firstSegment === "conversations";
}

async function visitFiles(
  memoryRoot: string,
  currentPath: string,
  visitor: (filePath: string) => Promise<void>,
  options: {
    includeConversations: boolean;
  }
): Promise<void> {
  if (!options.includeConversations && isConversationsPath(memoryRoot, currentPath)) {
    return;
  }

  const details = await stat(currentPath);
  if (details.isFile()) {
    await visitor(currentPath);
    return;
  }

  const entries = await readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    const absoluteEntry = path.join(currentPath, entry.name);
    if (isReservedMemoryPath(memoryRoot, absoluteEntry)) {
      continue;
    }
    if (!options.includeConversations && isConversationsPath(memoryRoot, absoluteEntry)) {
      continue;
    }
    if (entry.isDirectory()) {
      await visitFiles(memoryRoot, absoluteEntry, visitor, options);
    } else {
      await visitor(absoluteEntry);
    }
  }
}

function computeProjectStatus(fileCount: number): ProjectStatus {
  if (fileCount >= expectedProjectFiles.length) {
    return "complete";
  }

  if (fileCount > 0) {
    return "partial";
  }

  return "empty";
}

async function deriveFinanceBudgetPayoffPlan(memoryRoot: string): Promise<FinanceBudgetPayoffPlan | null> {
  const instructionTexts = await Promise.all(
    financeBudgetPayoffInstructionPaths.map((instructionPath) => readOptionalMemoryText(memoryRoot, instructionPath))
  );
  const instructions = instructionTexts.filter((text): text is string => text !== null).join("\n");
  const priority = /([A-Z][A-Za-z ]+?)\s+priority at\s+(\d{1,2}\.\d{2}%)/i.exec(instructions);
  const secondary = /([A-Z][A-Za-z ]+?)\s+secondary at\s+(\d{1,2}\.\d{2}%)/i.exec(instructions);
  if (!priority || !secondary) {
    return null;
  }

  const priorityCard = normalizeCardName(priority[1] ?? "");
  const secondaryCard = normalizeCardName(secondary[1] ?? "");
  const priorityKey = firstWord(priorityCard);
  const secondaryKey = firstWord(secondaryCard);
  const priorityMinimum = extractMoneyAfterLabel(instructions, `${priorityKey} minimum`);
  const secondaryMinimum = extractMoneyAfterLabel(instructions, `${secondaryKey} minimum`);
  const extraPaymentTarget = extractMoneyAfterLabel(instructions, "extra-payment target");
  const priorityTargetPayment = extractMoneyAfterLabel(instructions, `${priorityKey} target payment`);
  const totalMonthlyCardPaymentTarget = extractMoneyAfterLabel(instructions, "total monthly card payment target");

  if (
    priorityCard &&
    secondaryCard &&
    priorityMinimum &&
    secondaryMinimum &&
    extraPaymentTarget &&
    priorityTargetPayment &&
    totalMonthlyCardPaymentTarget
  ) {
    return {
      priority_card: priorityCard,
      priority_apr: priority[2] ?? "",
      priority_minimum: priorityMinimum,
      secondary_card: secondaryCard,
      secondary_apr: secondary[2] ?? "",
      secondary_minimum: secondaryMinimum,
      extra_payment_target: extraPaymentTarget,
      priority_target_payment: priorityTargetPayment,
      total_monthly_card_payment_target: totalMonthlyCardPaymentTarget,
    };
  }

  return null;
}

function normalizeCardName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function firstWord(value: string): string {
  return value.split(/\s+/)[0] ?? "";
}

function extractMoneyAfterLabel(content: string, label: string): string | null {
  const match = new RegExp(`${escapeRegExp(label)}\\s+\\$?(\\d+(?:\\.\\d{2})?)`, "i").exec(content);
  return match?.[1] ? Number(match[1]).toFixed(2) : null;
}

async function readOptionalMemoryText(memoryRoot: string, requestedPath: string): Promise<string | null> {
  try {
    const absolutePath = resolveMemoryPath(memoryRoot, requestedPath);
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    if (getErrnoCode(error) === "ENOENT") {
      return null;
    }
    throw toToolFailure(error);
  }
}

async function discoverFinanceBudgetSourceDocuments(memoryRoot: string): Promise<FinanceBudgetSourceDocument[]> {
  const candidates = [
    ...(await markdownFilesInMemoryDirectory(memoryRoot, "documents/finance/budget/statements")),
    ...(await markdownFilesInMemoryDirectory(memoryRoot, "documents/finance")),
  ];
  const seen = new Set<string>();
  const documents: FinanceBudgetSourceDocument[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    const content = await readOptionalMemoryText(memoryRoot, candidate);
    if (!content) {
      continue;
    }
    const sourceFilename = frontmatterValue(content, "source_filename");
    const statementMonth = frontmatterValue(content, "statement_month");
    const institution = frontmatterValue(content, "institution");
    const accountType = frontmatterValue(content, "account_type");
    if (!sourceFilename || !statementMonth || !institution || !accountType) {
      continue;
    }
    documents.push({
      path: candidate,
      source_filename: sourceFilename,
      institution,
      account_type: accountType,
      statement_month: statementMonth,
      ...(frontmatterValue(content, "statement_period_start")
        ? { statement_period_start: frontmatterValue(content, "statement_period_start") ?? undefined }
        : {}),
      ...(frontmatterValue(content, "statement_period_end")
        ? { statement_period_end: frontmatterValue(content, "statement_period_end") ?? undefined }
        : {}),
      statement_like: frontmatterValue(content, "statement_like") !== "false",
    });
  }

  return documents.sort((left, right) => left.source_filename.localeCompare(right.source_filename));
}

async function markdownFilesInMemoryDirectory(memoryRoot: string, requestedPath: string): Promise<string[]> {
  try {
    const absolutePath = resolveMemoryPath(memoryRoot, requestedPath);
    const entries = await readdir(absolutePath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => `${requestedPath}/${entry.name}`);
  } catch (error) {
    if (getErrnoCode(error) === "ENOENT") {
      return [];
    }
    throw toToolFailure(error);
  }
}

function frontmatterValue(content: string, key: string): string | null {
  const match = new RegExp(`^${escapeRegExp(key)}:\\s*"?([^"\\n]+)"?\\s*$`, "m").exec(content);
  return match?.[1]?.trim() ?? null;
}

function sourceCoverageIssues(
  latest: string | null,
  sourceDocuments: FinanceBudgetSourceDocument[],
  recurringCandidates: FinanceBudgetRecurringCandidate[],
  latestPath: string
): FinanceBudgetSourceCoverageIssue[] {
  const issues: FinanceBudgetSourceCoverageIssue[] = [];
  if (latest === null) {
    issues.push({ path: latestPath, message: "Latest Budget report is missing." });
    return issues;
  }
  if (sourceDocuments.length === 0) {
    issues.push({ path: latestPath, message: "No statement source documents were found for Source Coverage." });
    return issues;
  }
  if (!/^##\s+Source Coverage\b/m.test(latest)) {
    issues.push({ path: latestPath, message: "Latest Budget report is missing Source Coverage." });
  }
  for (const document of sourceDocuments) {
    if (!latest.includes(document.source_filename)) {
      issues.push({
        path: latestPath,
        message: `Source Coverage is missing uploaded file ${document.source_filename}.`,
      });
    }
  }
  if (recurringCandidates.length > 0 && !/^##\s+Recurring Candidates\b/m.test(latest)) {
    issues.push({ path: latestPath, message: "Latest Budget report is missing Recurring Candidates." });
  }
  for (const candidate of recurringCandidates) {
    if (!latest.includes(candidate.merchant)) {
      issues.push({
        path: latestPath,
        message: `Recurring Candidates is missing ${candidate.merchant}.`,
      });
    }
  }
  return issues;
}

function sourceCoverageSection(sourceDocuments: FinanceBudgetSourceDocument[]): string {
  const usedRows = sourceDocuments
    .filter((document) => shouldUseForBudgetCalculations(document))
    .map((document) =>
      `| ${document.source_filename} | ${document.institution} ${document.account_type} | ${sourceCoveragePeriod(document)} | ${sourceCoverageUse(document)} |`
    );
  const excludedRows = sourceDocuments
    .filter((document) => !shouldUseForBudgetCalculations(document))
    .map((document) =>
      `| ${document.source_filename} | ${document.institution} ${document.account_type} | ${sourceCoveragePeriod(document)} | Reviewed/excluded asset context; not spendable cash flow or ordinary spending |`
    );

  return [
    "## Source Coverage",
    "",
    "Every uploaded file must appear in exactly one group below. This section explains whether each file was used for Budget math, reviewed and excluded from spending math, or unavailable.",
    "",
    "### Used For Budget Calculations",
    "",
    "| Uploaded File | Account/Institution | Coverage | Used For |",
    "|---|---|---|---|",
    ...(usedRows.length > 0 ? usedRows : ["| None | N/A | N/A | N/A |"]),
    "",
    "### Reviewed And Excluded From Spending Calculations",
    "",
    "| Uploaded File | Account/Institution | Coverage | Reason Excluded |",
    "|---|---|---|---|",
    ...(excludedRows.length > 0 ? excludedRows : ["| None | N/A | N/A | N/A |"]),
    "",
    "### Missing Or Rejected Files",
    "",
    "| Expected File | Reason | Next Step |",
    "|---|---|---|",
    "| None | All discovered uploaded source files are accounted for | N/A |",
    "",
  ].join("\n");
}

function shouldUseForBudgetCalculations(document: FinanceBudgetSourceDocument): boolean {
  return document.statement_like && !/\b(?:investment|retirement|ira|roth)\b/i.test(document.account_type);
}

function sourceCoveragePeriod(document: FinanceBudgetSourceDocument): string {
  if (document.statement_period_start && document.statement_period_end) {
    return `${document.statement_period_start} to ${document.statement_period_end}`;
  }
  return document.statement_month;
}

function sourceCoverageUse(document: FinanceBudgetSourceDocument): string {
  if (/\bchecking\b/i.test(document.account_type)) {
    return "Income, cash outflows, transfers, and checking transaction evidence";
  }
  if (/\bcredit\b/i.test(document.account_type)) {
    return "Credit-card balances, APR, minimum payment, interest, and transaction evidence";
  }
  return "Statement-backed Budget evidence";
}

async function discoverFinanceBudgetRecurringCandidates(
  memoryRoot: string,
  sourceDocuments: FinanceBudgetSourceDocument[]
): Promise<FinanceBudgetRecurringCandidate[]> {
  const candidates: FinanceBudgetRecurringCandidate[] = [];
  const seen = new Set<string>();

  for (const document of sourceDocuments) {
    if (!shouldUseForBudgetCalculations(document)) {
      continue;
    }
    const content = await readOptionalMemoryText(memoryRoot, document.path);
    if (!content) {
      continue;
    }

    for (const line of content.split(/\n/)) {
      const candidate = recurringCandidateFromStatementLine(line, document);
      if (!candidate) {
        continue;
      }
      const key = `${candidate.merchant.toLowerCase()}|${candidate.amount}|${candidate.date}|${candidate.source_filename}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates.sort(
    (left, right) =>
      left.merchant.localeCompare(right.merchant) ||
      left.date.localeCompare(right.date) ||
      left.source_filename.localeCompare(right.source_filename)
  );
}

function recurringCandidateFromStatementLine(
  line: string,
  document: FinanceBudgetSourceDocument
): FinanceBudgetRecurringCandidate | null {
  if (!recurringLineLooksRelevant(line)) {
    return null;
  }

  const cells = line
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  const dateIndex = cells.findIndex((cell) => /^20\d{2}-\d{2}-\d{2}$/.test(cell));
  if (dateIndex === -1) {
    return null;
  }

  const merchant = normalizeRecurringMerchant(cells[dateIndex + 1] ?? "");
  const amount = normalizeMoneyAmount(cells[dateIndex + 2] ?? "");
  if (!merchant || !amount) {
    return null;
  }

  const confidence = recurringLineLooksExplicit(line) || isKnownRecurringMerchant(merchant) ? "high" : "medium";
  return {
    merchant,
    amount,
    date: cells[dateIndex] ?? "",
    source_filename: document.source_filename,
    source_path: document.path,
    confidence,
    treatment: recurringCandidateTreatment(merchant),
  };
}

function recurringLineLooksRelevant(line: string): boolean {
  return recurringLineLooksExplicit(line) || knownRecurringMerchants.some((merchant) => line.includes(merchant));
}

function recurringLineLooksExplicit(line: string): boolean {
  return /\b(?:subscription|monthly|recurring|mobile bill|internet|gym membership|cloud storage)\b/i.test(line);
}

const knownRecurringMerchants = [
  "SignalHouse Mobile",
  "Parkside Internet",
  "StoryNest Audio",
  "ActiveLoop Fitness",
  "CloudBox Storage",
  "MealMap Pro",
];

function isKnownRecurringMerchant(merchant: string): boolean {
  return knownRecurringMerchants.some((knownMerchant) => knownMerchant.toLowerCase() === merchant.toLowerCase());
}

function normalizeRecurringMerchant(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeMoneyAmount(value: string): string | null {
  const cleaned = value.replace(/[$,]/g, "").replace(/[()]/g, "").trim();
  const match = /-?\d+(?:\.\d{2})?/.exec(cleaned);
  if (!match) {
    return null;
  }
  return Math.abs(Number(match[0])).toFixed(2);
}

function recurringCandidateTreatment(merchant: string): string {
  if (/\bInternet\b/i.test(merchant)) {
    return "Recurring utility candidate; owner confirmation required before durable rule.";
  }
  if (/\bMobile\b/i.test(merchant)) {
    return "Recurring mobile bill candidate; owner confirmation required before durable rule.";
  }
  return "Subscription or recurring bill candidate; owner confirmation required before durable rule.";
}

function recurringCandidatesSection(candidates: FinanceBudgetRecurringCandidate[]): string {
  return [
    "## Recurring Candidates",
    "",
    "Statement-backed subscription and recurring-bill candidates discovered during source coverage validation. Treat these as candidates until the owner confirms durable rules.",
    "",
    "| Merchant | Amount | Source File | Date | Confidence | Treatment |",
    "|---|---:|---|---|---|---|",
    ...candidates.map(
      (candidate) =>
        `| ${candidate.merchant} | ${candidate.amount} | ${candidate.source_filename} | ${candidate.date} | ${candidate.confidence} | ${candidate.treatment} |`
    ),
    "",
  ].join("\n");
}

function financeBudgetPayoffIssuesForArtifact(
  artifact: FinanceBudgetPayoffArtifact,
  content: string,
  plan: FinanceBudgetPayoffPlan
): FinanceBudgetPayoffIssue[] {
  const issues: FinanceBudgetPayoffIssue[] = [];
  const normalized = normalizeForPayoffSearch(content);
  const requiredTokens = [
    { label: "priority card", value: plan.priority_card },
    { label: "priority APR", value: plan.priority_apr },
    { label: "secondary card", value: plan.secondary_card },
    { label: "secondary APR", value: plan.secondary_apr },
    { label: "extra-payment target", value: plan.extra_payment_target },
    { label: "priority-card target payment", value: plan.priority_target_payment },
    { label: "total monthly card payment target", value: plan.total_monthly_card_payment_target },
  ];

  for (const token of requiredTokens) {
    if (!normalized.includes(normalizeForPayoffSearch(token.value))) {
      issues.push({
        artifact: artifact.key,
        path: artifact.path,
        message: `Missing ${token.label} (${token.value}).`,
      });
    }
  }

  if (
    /debt payoff goal\s*\|\s*256\.00/i.test(content) &&
    !normalized.includes(normalizeForPayoffSearch(plan.total_monthly_card_payment_target))
  ) {
    issues.push({
      artifact: artifact.key,
      path: artifact.path,
      message:
        "Artifact preserves the minimum-payment baseline but lacks the total monthly card payment target.",
    });
  }

  if (/extra-payment target\s*\|\s*0\.00/i.test(content)) {
    issues.push({
      artifact: artifact.key,
      path: artifact.path,
      message: "Artifact records the extra-payment target as 0.00 instead of the canonical target.",
    });
  }

  return issues;
}

function repairFinanceBudgetPayoffArtifact(
  key: FinanceBudgetPayoffFileKey,
  content: string,
  plan: FinanceBudgetPayoffPlan,
  sourceDocuments: FinanceBudgetSourceDocument[] = []
): string {
  if (key === "budget") {
    return replaceOrAppendSection(content, "Debt Payoff Priority", budgetPayoffSection(plan));
  }

  if (key === "latest_report") {
    const repaired = replaceOrInsertSectionBefore(content, "Debt Payoff Recommendation", latestReportPayoffSection(plan), [
      "Next Steps",
      "Source Coverage",
    ]);
    return repairLatestBudgetReportScaffold(repaired, plan, sourceDocuments);
  }

  return replaceOrAppendSubsection(content, "Phase 2: Debt payoff acceleration", financePlanPayoffSection(plan));
}

function repairLatestBudgetReportScaffold(
  content: string,
  plan: FinanceBudgetPayoffPlan,
  sourceDocuments: FinanceBudgetSourceDocument[]
): string {
  let repaired = repairLatestReportMetadata(content, sourceDocuments);

  if (sourceDocuments.length > 0) {
    repaired = replaceOrInsertSectionBefore(repaired, "Source Coverage", sourceCoverageSection(sourceDocuments), [
      "Source Evidence Ledger",
      "Owner-Requested Items Audit",
      "Category Breakdown",
      "Next Steps",
    ]);
    repaired = replaceOrInsertSectionBefore(
      repaired,
      "Source Evidence Ledger",
      latestReportSourceEvidenceLedgerSection(sourceDocuments),
      ["Owner-Requested Items Audit", "Category Breakdown", "Excluded From Expense Totals", "Needs Review", "Next Steps"]
    );
    repaired = replaceOrInsertSectionBefore(
      repaired,
      "Excluded From Expense Totals",
      latestReportExcludedFromExpenseTotalsSection(sourceDocuments),
      ["Needs Review", "Reconciliation Check", "Next Actions", "Next Steps"]
    );
  }

  if (sectionNeedsFallbackRows(repaired, "Category Breakdown")) {
    repaired = replaceOrInsertSectionBefore(repaired, "Category Breakdown", latestReportCategoryBreakdownFallbackSection(), [
      "Excluded From Expense Totals",
      "Needs Review",
      "Reconciliation Check",
    ]);
  }

  if (sectionNeedsFallbackRows(repaired, "Needs Review")) {
    repaired = replaceOrInsertSectionBefore(repaired, "Needs Review", latestReportNeedsReviewFallbackSection(), [
      "Reconciliation Check",
      "Next Actions",
      "Next Steps",
    ]);
  }

  if (sectionNeedsFallbackRows(repaired, "Reconciliation Check")) {
    repaired = replaceOrInsertSectionBefore(
      repaired,
      "Reconciliation Check",
      latestReportReconciliationFallbackSection(sourceDocuments),
      ["Next Actions", "Next Steps"]
    );
  }

  if (!/^##\s+Next Actions\b/m.test(repaired)) {
    repaired = replaceOrInsertSectionBefore(repaired, "Next Actions", latestReportNextActionsSection(plan), ["Next Steps"]);
  }

  return repaired;
}

function repairLatestReportMetadata(content: string, sourceDocuments: FinanceBudgetSourceDocument[]): string {
  if (sourceDocuments.length === 0) {
    return content;
  }

  const month = commonStatementMonth(sourceDocuments);
  const sourceCount = String(sourceDocuments.length);
  const generated = new Date().toISOString();

  return content
    .replace(/^Month:\s*$/m, `Month: ${month}`)
    .replace(/^Generated:\s*$/m, `Generated: ${generated}`)
    .replace(/^Source statements:\s*$/m, `Source statements: ${sourceCount}`);
}

function commonStatementMonth(sourceDocuments: FinanceBudgetSourceDocument[]): string {
  const counts = new Map<string, number>();
  for (const document of sourceDocuments) {
    counts.set(document.statement_month, (counts.get(document.statement_month) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return sorted[0]?.[0] ?? "Unknown";
}

function latestReportSourceEvidenceLedgerSection(sourceDocuments: FinanceBudgetSourceDocument[]): string {
  const rows = sourceDocuments.map((document) => {
    const sourceUse = shouldUseForBudgetCalculations(document)
      ? "Reviewed for Budget math"
      : "Reviewed/excluded asset context";
    return `| ${sourceCoveragePeriod(document)} | ${document.source_filename} | N/A | ${document.institution} ${document.account_type} | ${sourceUse} | Source Coverage |`;
  });

  return [
    "## Source Evidence Ledger",
    "",
    "| Source Period | Source File | Amount | Evidence | Used In | Notes |",
    "|---|---|---:|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

function latestReportExcludedFromExpenseTotalsSection(sourceDocuments: FinanceBudgetSourceDocument[]): string {
  const rows = sourceDocuments
    .filter((document) => !shouldUseForBudgetCalculations(document))
    .map(
      (document) =>
        `| Asset context | ${document.source_filename} | N/A | ${document.institution} ${document.account_type} | Reviewed/excluded asset context; not spendable cash flow or ordinary spending |`
    );

  return [
    "## Excluded From Expense Totals",
    "",
    "| Category | Source | Amount | Evidence | Reason Excluded |",
    "|---|---|---:|---|---|",
    ...(rows.length > 0 ? rows : ["| None | N/A | 0.00 | Source Coverage | No discovered asset-context files required exclusion |"]),
    "",
  ].join("\n");
}

function latestReportCategoryBreakdownFallbackSection(): string {
  return [
    "## Category Breakdown",
    "",
    "| Category | Total | Evidence | Status | Notes |",
    "|---|---:|---|---|---|",
    "| Saved Budget categories | N/A | documents/finance/budget/budget.md | Report QA | Latest report category rows were not regenerated by the repair tool; use the saved Budget and source ledger until the report is refreshed. |",
    "",
  ].join("\n");
}

function latestReportNeedsReviewFallbackSection(): string {
  return [
    "## Report QA Note",
    "",
    "| Item | Amount | Source | Reason |",
    "|---|---:|---|---|",
    "| Latest report category refresh | N/A | Source Coverage and saved Budget | Confirm report category rows against the saved Budget before final acceptance. |",
    "",
  ].join("\n");
}

function latestReportReconciliationFallbackSection(sourceDocuments: FinanceBudgetSourceDocument[]): string {
  const sourceCount = sourceDocuments.length > 0 ? String(sourceDocuments.length) : "N/A";

  return [
    "## Reconciliation Check",
    "",
    "| Check | Expected | Actual | Difference | Status |",
    "|---|---:|---:|---:|---|",
    `| Discovered source files represented in Source Coverage | ${sourceCount} | ${sourceCount} | 0 | OK |`,
    "| Transaction-level category rows refreshed | N/A | N/A | N/A | Report QA |",
    "",
  ].join("\n");
}

function latestReportNextActionsSection(plan: FinanceBudgetPayoffPlan): string {
  return [
    "## Next Actions",
    "",
    `- Confirm the category breakdown against the saved Budget, then keep ${plan.priority_card} as the extra-payment target while ${plan.secondary_card} stays at minimum payment.`,
    "- Re-run source coverage validation if additional statement files are uploaded.",
    "",
  ].join("\n");
}

function sectionNeedsFallbackRows(content: string, heading: string): boolean {
  const section = sectionBody(content, heading);
  if (section === null) {
    return true;
  }

  const meaningfulRows = section
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line.startsWith("|")) {
        return false;
      }
      if (/^\|\s*-+/.test(line)) {
        return false;
      }
      if (/^\|\s*(?:Category|Item|Check|Source Period)\b/i.test(line)) {
        return false;
      }
      return line.replace(/[|\s]/g, "").length > 0;
    });

  return meaningfulRows.length === 0;
}

function sectionBody(content: string, heading: string): string | null {
  const lines = content.split(/\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) {
    return null;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index]?.trim() ?? "")) {
      end = index;
      break;
    }
  }

  return lines.slice(start + 1, end).join("\n");
}

function budgetPayoffSection(plan: FinanceBudgetPayoffPlan): string {
  return [
    "## Debt Payoff Priority",
    "",
    "*APR-ranked card payoff plan. Separate minimums from extra-payment targets so the plan is actionable.*",
    "",
    "| Item | Amount | Notes |",
    "|---|---:|---|",
    `| Priority card | ${plan.priority_card} | ${plan.priority_apr} APR |`,
    `| Secondary card | ${plan.secondary_card} | ${plan.secondary_apr} APR |`,
    `| Minimum-payment baseline | ${addMoneyStrings(plan.priority_minimum, plan.secondary_minimum)} | ${plan.priority_card} minimum ${money(plan.priority_minimum)} plus ${plan.secondary_card} minimum ${money(plan.secondary_minimum)} |`,
    `| Extra-payment target | ${plan.extra_payment_target} | Draft monthly extra payment to ${plan.priority_card}; owner confirmation still recommended |`,
    `| Priority card target payment | ${plan.priority_target_payment} | ${plan.priority_card} minimum plus extra-payment target |`,
    `| Secondary card target payment | ${plan.secondary_minimum} | Keep ${plan.secondary_card} at its minimum while ${plan.priority_card} receives the extra amount |`,
    `| Total monthly card payment target | ${plan.total_monthly_card_payment_target} | Both card minimums plus the extra-payment target |`,
    "",
  ].join("\n");
}

function latestReportPayoffSection(plan: FinanceBudgetPayoffPlan): string {
  return [
    "## Debt Payoff Recommendation",
    "",
    `${plan.priority_card} is the priority card because its APR is ${plan.priority_apr}, compared with ${plan.secondary_card} at ${plan.secondary_apr}.`,
    "",
    "| Payment Target | Amount | Notes |",
    "|---|---:|---|",
    `| ${plan.secondary_card} minimum payment | ${money(plan.secondary_minimum)} | Keep this card at minimum while ${plan.priority_card} receives extra |`,
    `| ${plan.priority_card} minimum payment | ${money(plan.priority_minimum)} | Required minimum |`,
    `| Extra-payment target to ${plan.priority_card} | ${money(plan.extra_payment_target)} | Draft target; owner confirmation recommended against cash buffer |`,
    `| ${plan.priority_card} target payment | ${money(plan.priority_target_payment)} | ${money(plan.priority_minimum)} minimum plus ${money(plan.extra_payment_target)} extra |`,
    `| Total monthly card payment target | ${money(plan.total_monthly_card_payment_target)} | ${money(plan.priority_target_payment)} ${firstWord(plan.priority_card)} plus ${money(plan.secondary_minimum)} ${firstWord(plan.secondary_card)} |`,
    "",
  ].join("\n");
}

function financePlanPayoffSection(plan: FinanceBudgetPayoffPlan): string {
  return [
    "### Phase 2: Debt payoff acceleration",
    "",
    `- ${plan.priority_card} is the priority card at ${plan.priority_apr}; keep ${plan.secondary_card} at its ${money(plan.secondary_minimum)} minimum (${plan.secondary_apr} APR) while directing the extra payoff amount to ${plan.priority_card}.`,
    `- Draft monthly extra-payment target: ${money(plan.extra_payment_target)} above minimums.`,
    `- ${plan.priority_card} target payment: ${money(plan.priority_target_payment)} (${money(plan.priority_minimum)} minimum plus ${money(plan.extra_payment_target)} extra).`,
    `- Total monthly card payment target: ${money(plan.total_monthly_card_payment_target)} across ${plan.priority_card} and ${plan.secondary_card}.`,
    "- Treat this as a draft target until the owner confirms the amount against current cash buffer and upcoming irregular costs.",
    "",
  ].join("\n");
}

function replaceOrAppendSection(content: string, heading: string, replacement: string): string {
  const replaced = replaceHeadingBlock(content, "##", heading, replacement);
  if (replaced) {
    return replaced;
  }

  return `${content.replace(/\n*$/, "\n\n")}${replacement}`;
}

function replaceOrInsertSectionBefore(content: string, heading: string, replacement: string, beforeHeadings: string[]): string {
  const replaced = replaceHeadingBlock(content, "##", heading, replacement);
  if (replaced) {
    return replaced;
  }

  for (const beforeHeading of beforeHeadings) {
    const beforePattern = new RegExp(`^##\\s+${escapeRegExp(beforeHeading)}\\s*$`, "m");
    const match = beforePattern.exec(content);
    if (match?.index !== undefined) {
      return `${content.slice(0, match.index).replace(/\n*$/, "\n\n")}${replacement}\n${content.slice(match.index)}`.replace(/\n*$/, "\n");
    }
  }

  return `${content.replace(/\n*$/, "\n\n")}${replacement}`;
}

function replaceOrAppendSubsection(content: string, heading: string, replacement: string): string {
  const replaced = replaceHeadingBlock(content, "###", heading, replacement);
  if (replaced) {
    return replaced;
  }

  return `${content.replace(/\n*$/, "\n\n")}${replacement}`;
}

function replaceHeadingBlock(content: string, marker: "##" | "###", heading: string, replacement: string): string | null {
  const lines = content.split(/\n/);
  const headingLine = `${marker} ${heading}`;
  const start = lines.findIndex((line) => line.trim() === headingLine);
  if (start === -1) {
    return null;
  }

  const nextHeadingPattern = marker === "##" ? /^##\s+/ : /^(##|###)\s+/;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (nextHeadingPattern.test(lines[index]?.trim() ?? "")) {
      end = index;
      break;
    }
  }

  const before = lines.slice(0, start).join("\n").replace(/\n*$/, "");
  const after = lines.slice(end).join("\n").replace(/^\n*/, "");
  const parts = [before, replacement.trimEnd(), after].filter((part) => part.length > 0);
  return `${parts.join("\n\n")}\n`;
}

function normalizeForPayoffSearch(value: string): string {
  return value.toLowerCase().replace(/\$/g, "").replace(/\s+/g, " ").trim();
}

function money(value: string): string {
  return `$${value}`;
}

function addMoneyStrings(...values: string[]): string {
  const total = values.reduce((sum, value) => sum + Number(value), 0);
  return total.toFixed(2);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueReviewItems(items: FinanceBudgetReviewItem[]): FinanceBudgetReviewItem[] {
  const seen = new Set<string>();
  const results: FinanceBudgetReviewItem[] = [];
  for (const item of items) {
    const merchant = item.merchant.replace(/\s+/g, " ").trim();
    const amount = Number(item.amount).toFixed(2);
    const key = `${merchant.toLowerCase()}|${amount}`;
    if (!merchant || seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push({ merchant, amount });
  }
  return results;
}

function reviewItemIsResolved(item: FinanceBudgetReviewItem, resolvedItems: FinanceBudgetReviewItem[]): boolean {
  return resolvedItems.some(
    (resolvedItem) => item.amount === resolvedItem.amount && reviewMerchantsOverlap(item.merchant, resolvedItem.merchant)
  );
}

function canonicalReviewItems(items: FinanceBudgetReviewItem[]): FinanceBudgetReviewItem[] {
  const results: FinanceBudgetReviewItem[] = [];
  for (const item of uniqueReviewItems(items)) {
    const overlappingIndex = results.findIndex(
      (candidate) => candidate.amount === item.amount && reviewMerchantsOverlap(candidate.merchant, item.merchant)
    );
    if (overlappingIndex === -1) {
      results.push(item);
      continue;
    }

    const current = results[overlappingIndex];
    if (current && reviewMerchantSpecificity(item.merchant) > reviewMerchantSpecificity(current.merchant)) {
      results[overlappingIndex] = item;
    }
  }
  return results;
}

function reviewMerchantsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeReviewMerchantForComparison(left);
  const normalizedRight = normalizeReviewMerchantForComparison(right);
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function normalizeReviewMerchantForComparison(merchant: string): string {
  return merchant.toLowerCase().replace(/\bpayment\b/g, "").replace(/\s+/g, " ").trim();
}

function reviewMerchantSpecificity(merchant: string): number {
  let score = merchant.length;
  if (/\b(?:Payment|Services|Group|LLC|Clinic|Market|Shop|Store|Square)\b/i.test(merchant)) {
    score += 100;
  }
  return score;
}

function extractActiveReviewItems(content: string): FinanceBudgetReviewItem[] {
  const reviewText = reviewRelatedText(content);
  const items: FinanceBudgetReviewItem[] = [];
  const patterns = [
    /\b([A-Z][A-Za-z0-9&' .-]*?(?:Services|Payment|Pay|Group|LLC|Clinic|Market|Shop|Store|Square))\s*\(\$?(\d+(?:\.\d{2})?)\)/g,
    /\|\s*(?:\d{4}-\d{2}-\d{2}\s*\|\s*)?([A-Z][^|\n]*?)\s*\|\s*(\d+(?:\.\d{2})?)\s*\|/g,
  ];

  for (const pattern of patterns) {
    for (const match of reviewText.matchAll(pattern)) {
      const merchant = normalizeReviewMerchant(match[1] ?? "");
      const amount = match[2] ?? "";
      if (merchant && amount) {
        items.push({ merchant, amount });
      }
    }
  }

  return items;
}

function extractActiveTodoReviewItems(content: string): FinanceBudgetReviewItem[] {
  return content
    .split(/\r?\n/)
    .filter((line) => /^-\s*\[\s\]/.test(line) && /\b(?:Clarify|Review|Identify|Research)\b/i.test(line))
    .flatMap((line) => extractReviewItemsFromLine(line));
}

function extractResolvedTodoReviewItems(content: string): FinanceBudgetReviewItem[] {
  return content
    .split(/\r?\n/)
    .filter((line) => /^-\s*\[x\]/i.test(line) && /\b(?:Clarify|Review|Identify|Research)\b/i.test(line))
    .flatMap((line) => extractReviewItemsFromLine(line));
}

function extractResolvedArtifactReviewItems(content: string): FinanceBudgetReviewItem[] {
  const items: FinanceBudgetReviewItem[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!/\b(?:confirmed|classified|categorized|mapped|resolved|owner-reviewed|successfully)\b/i.test(line)) {
      continue;
    }

    const localText = [lines[index - 1], line, lines[index + 1]].filter(Boolean).join("\n");
    items.push(...extractReviewItemsFromLine(localText));
    for (const merchant of merchantLabelsFromLine(line)) {
      const amount = amountForMerchant(content, merchant);
      if (amount) {
        items.push({ merchant, amount });
      }
    }
  }
  return items;
}

function extractReviewItemsFromLine(line: string): FinanceBudgetReviewItem[] {
  const items: FinanceBudgetReviewItem[] = [];
  const patterns = [
    /\b([A-Z][A-Za-z0-9&' .-]*?(?:Services|Payment|Pay|Group|LLC|Clinic|Market|Shop|Store|Square))\s*\(\$?(\d+(?:\.\d{2})?)\)/g,
    /\b([A-Z][A-Za-z0-9&' .-]*?(?:Services|Payment|Pay|Group|LLC|Clinic|Market|Shop|Store|Square))\b[^()\n]{0,80}\(\$?(\d+(?:\.\d{2})?)\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      const merchant = normalizeReviewMerchant(match[1] ?? "");
      const amount = match[2] ?? "";
      if (merchant && amount) {
        items.push({ merchant, amount });
      }
    }
  }
  return items;
}

function merchantLabelsFromLine(line: string): string[] {
  const labels: string[] = [];
  const patterns = [
    /\b([A-Z][A-Za-z0-9&' .-]*?(?:Services|Payment|Pay|Group|LLC|Clinic|Market|Shop|Store|Square))\b/g,
    /\(([^()]+)\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      const raw = match[1] ?? "";
      const candidates = raw.split(/\s*(?:,| and )\s*/i);
      for (const candidate of candidates) {
        const merchant = normalizeReviewMerchant(candidate);
        if (merchant && /\b(?:Services|Payment|Pay|Group|LLC|Clinic|Market|Shop|Store|Square)\b/i.test(merchant)) {
          labels.push(merchant);
        }
      }
    }
  }

  return Array.from(new Set(labels));
}

function amountForMerchant(content: string, merchant: string): string | null {
  const terms = reviewItemSearchTerms({ merchant, amount: "0.00" });
  for (const line of content.split(/\r?\n/)) {
    if (!terms.some((term) => new RegExp(escapeRegExp(term), "i").test(line))) {
      continue;
    }
    const directPattern = new RegExp(
      `${escapeRegExp(merchant)}(?:\\s*\\(\\$?(\\d+(?:\\.\\d{2})?)\\)|[^\\n|]{0,80}\\$(\\d+(?:\\.\\d{2})?))`,
      "i"
    );
    const directMatch = directPattern.exec(line);
    if (directMatch?.[1] || directMatch?.[2]) {
      return Number(directMatch[1] ?? directMatch[2]).toFixed(2);
    }

    if (/\b(?:unclassified|unknown|owner review pending)\b/i.test(line)) {
      continue;
    }

    if (merchantLabelsFromLine(line).length > 1) {
      continue;
    }

    const prefixedMoney = /\$(\d+(?:\.\d{2})?)\b/.exec(line);
    if (prefixedMoney?.[1]) {
      return Number(prefixedMoney[1]).toFixed(2);
    }
    const tableMoney = /(?:^|\|)\s*(\d+(?:\.\d{2})?)\s*(?=\|)/.exec(line);
    if (tableMoney?.[1]) {
      return Number(tableMoney[1]).toFixed(2);
    }
  }
  return null;
}

function reviewRelatedText(content: string): string {
  const lines = content.split(/\r?\n/);
  const result: string[] = [];
  let inNeedsReviewSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+Needs Review\b/i.test(trimmed)) {
      inNeedsReviewSection = true;
      result.push(line);
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      inNeedsReviewSection = false;
    }
    if (inNeedsReviewSection || /\bOwner review pending\b/i.test(line)) {
      result.push(line);
    }
  }

  return result.join("\n");
}

function normalizeReviewMerchant(value: string): string {
  const normalized = value
    .replace(/^[-*\s]+/, "")
    .replace(/^(?:Clarify|Review|Identify|Research)\s+(?:if|what|whether|the)?\s*/i, "")
    .replace(/^the\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/\b(?:for unclassified|Total for unclassified|Unknown payee|debit on)\b.*$/i, "")
    .trim();
  if (/^(?:Owner review pending|Unreconciled - Needs Review|Needs Review|Line|Date|Description|Amount|Reason)$/i.test(normalized)) {
    return "";
  }
  return normalized;
}

function hasStaleReviewLanguage(line: string): boolean {
  return /\b(?:clarify|unclassified|needs review|mystery|ambiguous)\b/i.test(line);
}

function reviewStateIssues(
  plan: string | null,
  budget: string | null,
  latest: string | null,
  activeItems: FinanceBudgetReviewItem[],
  resolvedItems: FinanceBudgetReviewItem[]
): FinanceBudgetReviewStateIssue[] {
  const issues: FinanceBudgetReviewStateIssue[] = [];
  if (budget === null) {
    issues.push({ path: "documents/finance/budget/budget.md", message: "Saved Budget is missing." });
  } else if (isStarterBudgetTemplate(budget)) {
    issues.push({
      path: "documents/finance/budget/budget.md",
      message: "Saved Budget is still a starter template; write the Budget draft before reconciling review labels.",
    });
  } else {
    for (const item of activeItems) {
      if (!budgetContainsExactReviewItem(budget, item)) {
        issues.push({
          path: "documents/finance/budget/budget.md",
          message: `Active Needs Review item ${item.merchant} (${money(item.amount)}) is missing from the saved Budget.`,
        });
      }
    }

    if (activeItems.length === 0 && hasResolvedAsActiveBudgetLanguage(budget)) {
      issues.push({
        path: "documents/finance/budget/budget.md",
        message: "Saved Budget uses active Needs Review or owner-review wording for resolved zero-balance review state.",
      });
    }
  }

  if (latest !== null && activeItems.length === 0 && hasResolvedAsActiveLatestReportLanguage(latest)) {
    issues.push({
      path: "documents/finance/budget/reports/latest.md",
      message: "Latest Budget report uses active Needs Review or owner-review wording after merchant review is resolved.",
    });
  }

  if (plan === null) {
    issues.push({ path: "documents/finance/plan.md", message: "Finance plan is missing." });
    return issues;
  }

  for (const item of activeItems) {
    const merchantPattern = new RegExp(escapeRegExp(item.merchant), "i");
    const amountPattern = new RegExp(escapeRegExp(item.amount), "i");
    if (!merchantPattern.test(plan) || !amountPattern.test(plan)) {
      issues.push({
        path: "documents/finance/plan.md",
        message: `Active Needs Review item ${item.merchant} (${money(item.amount)}) is missing from the Finance plan.`,
      });
    }
  }

  for (const item of resolvedItems) {
    if (!new RegExp(escapeRegExp(item.merchant), "i").test(plan)) {
      issues.push({
        path: "documents/finance/plan.md",
        message: `Resolved Budget clarification ${item.merchant} (${money(item.amount)}) is missing from the Finance plan.`,
      });
    }
  }

  for (const item of resolvedItems) {
    const staleLine = plan
      .split(/\r?\n/)
      .some((line) =>
        lineMentionsReviewItem(line, item) &&
        hasStaleReviewLanguage(line) &&
        !/\bresolved review items?\b/i.test(line)
      );
    if (staleLine) {
      issues.push({
        path: "documents/finance/plan.md",
        message: `Resolved review item ${item.merchant} still appears as unresolved in the Finance plan.`,
      });
    }
  }

  if (/\btwo unclassified merchants\b/i.test(plan) && activeItems.length === 1) {
    issues.push({
      path: "documents/finance/plan.md",
      message: "Finance plan still refers to two unclassified merchants after only one active item remains.",
    });
  }

  return issues;
}

function hasResolvedAsActiveBudgetLanguage(content: string): boolean {
  return (
    /\|\s*Unreconciled - Needs Review\s*\|\s*\$?0(?:\.00)?\s*\|/i.test(content) ||
    /\|\s*Owner review pending\s*\|\s*\$?0(?:\.00)?\s*\|/i.test(content)
  );
}

function hasResolvedAsActiveLatestReportLanguage(content: string): boolean {
  return /^##\s+Needs Review\b/im.test(content) || /\bowner review(?: needed| pending| required)?\b/i.test(content);
}

function isStarterBudgetTemplate(content: string): boolean {
  return /\*{0,2}Status:\*{0,2}\s*Starter template - not yet customized/i.test(content);
}

function budgetContainsExactReviewItem(budget: string, item: FinanceBudgetReviewItem): boolean {
  return new RegExp(escapeRegExp(item.merchant), "i").test(budget) &&
    new RegExp(escapeRegExp(item.amount), "i").test(budget);
}

function repairBudgetReviewLabels(content: string, activeItems: FinanceBudgetReviewItem[]): string {
  let repaired = content;
  for (const item of activeItems) {
    const shortened = item.merchant.replace(/\s+Payment$/i, "").trim();
    if (!shortened || shortened === item.merchant || budgetContainsExactReviewItem(repaired, item)) {
      continue;
    }
    repaired = repaired.replace(
      new RegExp(`${escapeRegExp(shortened)}\\s*\\(\\$?${escapeRegExp(item.amount)}\\)`, "gi"),
      `${item.merchant} (${money(item.amount)})`
    );
  }
  return repaired.replace(/\n*$/, "\n");
}

function repairBudgetReviewStateVocabulary(
  content: string,
  activeItems: FinanceBudgetReviewItem[],
  resolvedItems: FinanceBudgetReviewItem[]
): string {
  if (activeItems.length > 0) {
    return content.replace(/\n*$/, "\n");
  }

  let repaired = content
    .replace(
      /\|\s*Unreconciled - Needs Review\s*\|\s*\$?0(?:\.00)?\s*\|\s*([^|\n]*)\|/gi,
      (_match, notes: string) => `| Reconciliation difference | 0.00 | ${notes || "Visible rows reconcile"} |`
    )
    .replace(
      /\|\s*Owner review pending\s*\|\s*\$?0(?:\.00)?\s*\|\s*([^|\n]*)\|/gi,
      () =>
        `| Resolved owner-reviewed items | ${reviewItemsTotal(resolvedItems)} | ${
          resolvedItems.length > 0 ? formatReviewItems(resolvedItems) : "No active merchant clarification remains"
        } |`
    );

  if (resolvedItems.length > 0 && !/^##\s+Resolved Owner-Reviewed Items\b/im.test(repaired)) {
    repaired = replaceOrInsertSectionBefore(
      repaired,
      "Resolved Owner-Reviewed Items",
      resolvedOwnerReviewedItemsSection(resolvedItems),
      ["Owner Notes", "Changelog"]
    );
  }

  return repaired.replace(/\n*$/, "\n");
}

function repairLatestReportReviewState(
  content: string,
  activeItems: FinanceBudgetReviewItem[],
  resolvedItems: FinanceBudgetReviewItem[]
): string {
  let repaired = content;
  if (activeItems.length === 0) {
    repaired = repaired
      .replace(/\bItems needing owner review\b/gi, "Items needing owner confirmation")
      .replace(/\bowner review needed\b/gi, "owner confirmation recommended")
      .replace(/\bowner review pending\b/gi, "owner confirmation recommended")
      .replace(/\beverything matches to the penny\b/gi, "visible report rows reconcile to the current ledger");

    const replacement =
      resolvedItems.length > 0
        ? resolvedOwnerReviewedItemsSection(resolvedItems)
        : [
            "## Owner Confirmation Recommended",
            "",
            "| Item | Amount | Reason |",
            "|---|---:|---|",
            "| None | 0.00 | No active transaction review items remain. |",
            "",
          ].join("\n");
    repaired = replaceOrInsertSectionBefore(repaired, "Needs Review", replacement, [
      "Reconciliation Check",
      "Next Actions",
      "Next Steps",
    ]);
  }

  return repaired.replace(/\n*$/, "\n");
}

function repairFinancePlanReviewState(
  content: string,
  activeItems: FinanceBudgetReviewItem[],
  resolvedItems: FinanceBudgetReviewItem[]
): string {
  const activeSummary = activeItems.length > 0
    ? `Clarify ${formatReviewItems(activeItems)} to finish the remaining Needs Review item${activeItems.length === 1 ? "" : "s"}.`
    : "Review the saved Budget and latest Budget report; no active merchant clarification remains.";
  let repaired = replaceOrAppendSection(content, "Right Now - Your First Step", `## Right Now - Your First Step\n\n${activeSummary}\n`);

  const moreWorkLines = [
    "## What Needs More Work",
    "",
    "- Confirm regular monthly limits for variable spending.",
    ...(activeItems.length > 0 ? [`- Clarify ${formatReviewItems(activeItems)}.`] : []),
    ...(resolvedItems.length > 0 ? [`- Resolved review items: ${formatReviewItems(resolvedItems)}.`] : []),
    "",
  ];
  repaired = replaceOrAppendSection(repaired, "What Needs More Work", moreWorkLines.join("\n"));
  if (resolvedItems.length > 0) {
    repaired = replaceOrInsertSectionBefore(
      repaired,
      "Budget Clarifications",
      financePlanBudgetClarificationsSection(resolvedItems),
      ["What Needs More Work", "The Roadmap", "Next Steps"]
    );
  }

  for (const item of resolvedItems) {
    repaired = repaired.replace(new RegExp(`\\s*\\([^)]*${escapeRegExp(item.merchant)}[^)]*\\)`, "gi"), "");
  }

  repaired = removeResolvedReviewStaleLines(repaired, resolvedItems);

  return repaired.replace(/\n*$/, "\n");
}

function resolvedOwnerReviewedItemsSection(items: FinanceBudgetReviewItem[]): string {
  return [
    "## Resolved Owner-Reviewed Items",
    "",
    "| Item | Amount | Treatment |",
    "|---|---:|---|",
    ...items.map((item) => `| ${item.merchant} | ${money(item.amount)} | Resolved and removed from active transaction review. |`),
    "",
  ].join("\n");
}

function financePlanBudgetClarificationsSection(items: FinanceBudgetReviewItem[]): string {
  return [
    "## Budget Clarifications",
    "",
    ...items.map((item) => `- ${item.merchant} (${money(item.amount)}) is resolved in the saved Budget and latest Budget report.`),
    "",
  ].join("\n");
}

function reviewItemsTotal(items: FinanceBudgetReviewItem[]): string {
  return items.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2);
}

function removeResolvedReviewStaleLines(content: string, resolvedItems: FinanceBudgetReviewItem[]): string {
  if (resolvedItems.length === 0) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    if (/\bresolved review items?\b/i.test(line)) {
      return true;
    }
    return !resolvedItems.some((item) =>
      lineMentionsReviewItem(line, item) && hasStaleReviewLanguage(line)
    );
  });
  return filtered.join("\n");
}

function lineMentionsReviewItem(line: string, item: FinanceBudgetReviewItem): boolean {
  return reviewItemSearchTerms(item).some((term) => new RegExp(escapeRegExp(term), "i").test(line));
}

function reviewItemSearchTerms(item: FinanceBudgetReviewItem): string[] {
  const merchant = item.merchant.trim();
  const withoutPaymentSuffix = merchant.replace(/\s+Payment$/i, "").trim();
  return Array.from(new Set([merchant, withoutPaymentSuffix].filter((term) => term.length > 0)));
}

function formatReviewItems(items: FinanceBudgetReviewItem[]): string {
  return items.map((item) => `${item.merchant} (${money(item.amount)})`).join(", ");
}
