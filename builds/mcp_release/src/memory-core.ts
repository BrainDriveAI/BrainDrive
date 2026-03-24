import path from "node:path";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import { commitMemoryChange, ensureGitReady, exportMemoryArchive, historyForPath, readFileAtCommit } from "./git.js";
import { ownerPermissions, type PermissionSet } from "./request-context.js";

const reservedMemoryRoots = new Set([".git"]);
const expectedProjectFiles = ["AGENT.md", "spec.md", "plan.md"];

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
    await rm(absolutePath, { recursive: true, force: true });
    await ensureGitReady(memoryRoot);
    await commitMemoryChange(memoryRoot, `Delete ${toMemoryRelativePath(memoryRoot, absolutePath)}`);
    return { path: absolutePath, deleted: true };
  } catch (error) {
    throw toToolFailure(error);
  }
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
