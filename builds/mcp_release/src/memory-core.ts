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
    for (const artifact of financeBudgetPayoffArtifacts) {
      const current = currentFiles.get(artifact.key) ?? "";
      const repaired = repairFinanceBudgetPayoffArtifact(artifact.key, current, canonicalPlan);
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
  plan: FinanceBudgetPayoffPlan
): string {
  if (key === "budget") {
    return replaceOrAppendSection(content, "Debt Payoff Priority", budgetPayoffSection(plan));
  }

  if (key === "latest_report") {
    return replaceOrInsertSectionBefore(content, "Debt Payoff Recommendation", latestReportPayoffSection(plan), [
      "Next Steps",
      "Source Coverage",
    ]);
  }

  return replaceOrAppendSubsection(content, "Phase 2: Debt payoff acceleration", financePlanPayoffSection(plan));
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
    `${plan.priority_card} is the higher-APR card at ${plan.priority_apr}, so the draft payoff target is to keep ${plan.secondary_card} (${plan.secondary_apr} APR) at its ${money(plan.secondary_minimum)} minimum and pay ${money(plan.priority_target_payment)} to ${plan.priority_card} each month. That includes a ${money(plan.extra_payment_target)} extra-payment target toward ${plan.priority_card} and makes the total monthly card payment target ${money(plan.total_monthly_card_payment_target)}. Review this draft target with the owner before treating it as final.`,
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
