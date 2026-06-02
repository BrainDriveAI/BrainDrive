import path from "node:path";
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import type { ToolContext, ToolDefinition } from "../../contracts.js";
import { commitMemoryChange } from "../../git.js";
import { auditLog } from "../../logger.js";
import { removeProjectIndexEntry } from "../../memory/folder-index.js";
import { isReservedMemoryPath, resolveMemoryPath, toMemoryRelativePath } from "../../memory/paths.js";
import { ToolExecutionFailure, toToolFailure } from "../../tool-error.js";

const SEARCH_EXCLUDED_ROOTS = new Set(["diagnostics"]);
const MAX_SEARCH_MATCHES = 50;
const MAX_SEARCH_MATCH_CONTENT_CHARS = 500;
const MAX_SEARCH_TOTAL_CONTENT_CHARS = 20_000;

async function readTool(context: ToolContext, input: Record<string, unknown>): Promise<unknown> {
  const targetPath = String(input.path ?? "");
  try {
    const absolutePath = resolveToolPath(context, targetPath);
    const content = await readFile(absolutePath, "utf8");
    return { path: absolutePath, content };
  } catch (error) {
    throw toToolFailure(error);
  }
}

async function writeTool(context: ToolContext, input: Record<string, unknown>): Promise<unknown> {
  const targetPath = String(input.path ?? "");
  const content = String(input.content ?? "");

  try {
    const absolutePath = resolveToolPath(context, targetPath);
    const previous = await readFile(absolutePath, "utf8").catch(() => null);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
    const relativePath = toMemoryRelativePath(context.memoryRoot, absolutePath);
    auditLog("memory.write", {
      action: "file.write",
      path: absolutePath,
      correlation_id: context.correlationId,
    });
    await commitMemoryChange(context.memoryRoot, `Write ${relativePath}`);
    return {
      path: absolutePath,
      relative_path: relativePath,
      operation: "write",
      changed: previous !== content,
      bytes_written: Buffer.byteLength(content),
      content_summary: summarizeWrittenContent(content),
    };
  } catch (error) {
    throw toToolFailure(error);
  }
}

async function editTool(context: ToolContext, input: Record<string, unknown>): Promise<unknown> {
  const targetPath = String(input.path ?? "");
  const find = String(input.find ?? "");
  const replace = String(input.replace ?? "");

  try {
    const absolutePath = resolveToolPath(context, targetPath);
    const original = await readFile(absolutePath, "utf8");

    if (!original.includes(find)) {
      throw new ToolExecutionFailure("invalid_input", "Edit target not found");
    }

    const updated = original.replace(find, replace);
    await writeFile(absolutePath, updated, "utf8");
    const relativePath = toMemoryRelativePath(context.memoryRoot, absolutePath);
    auditLog("memory.write", {
      action: "file.edit",
      path: absolutePath,
      correlation_id: context.correlationId,
    });
    await commitMemoryChange(context.memoryRoot, `Edit ${relativePath}`);
    return {
      path: absolutePath,
      relative_path: relativePath,
      operation: "edit",
      changed: original !== updated,
      updated: true,
      content_summary: summarizeWrittenContent(updated),
    };
  } catch (error) {
    throw toToolFailure(error);
  }
}

async function deleteTool(context: ToolContext, input: Record<string, unknown>): Promise<unknown> {
  const targetPath = String(input.path ?? "");

  try {
    const absolutePath = resolveToolPath(context, targetPath);
    await access(absolutePath);
    const details = await stat(absolutePath);
    const indexTarget = projectIndexTargetForDeletedPath(context.memoryRoot, absolutePath, details.isFile());
    await rm(absolutePath, { recursive: true });
    if (indexTarget) {
      await removeProjectIndexEntry(context.memoryRoot, indexTarget.projectId, indexTarget.fileName);
    }
    const relativePath = toMemoryRelativePath(context.memoryRoot, absolutePath);
    auditLog("memory.write", {
      action: "file.delete",
      path: absolutePath,
      correlation_id: context.correlationId,
    });
    await commitMemoryChange(context.memoryRoot, `Delete ${relativePath}`);
    return {
      path: absolutePath,
      relative_path: relativePath,
      operation: "delete",
      changed: true,
      deleted: true,
      content_summary: "Deleted memory item.",
    };
  } catch (error) {
    throw toToolFailure(error);
  }
}

function summarizeWrittenContent(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.find((line) => line.startsWith("#"));
  const taskLines = lines.filter((line) => /^- \[[ xX]\]/.test(line));
  const taskCount = taskLines.length;
  const taskPreview = taskLines.slice(0, 5).map((line) => line.replace(/\s+/g, " ")).join(" | ");
  const summaryParts = [
    heading ? `heading: ${heading.replace(/^#+\s*/, "")}` : null,
    taskCount > 0 ? `${taskCount} checkbox task${taskCount === 1 ? "" : "s"}` : null,
    taskPreview ? `task preview: ${taskPreview}` : null,
    `${Buffer.byteLength(content)} bytes`,
  ].filter(Boolean);
  return summaryParts.join("; ");
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
  if (!projectId || isCoreProjectFile(fileName)) {
    return null;
  }

  return { projectId, fileName };
}

function isCoreProjectFile(fileName: string): boolean {
  return ["AGENT.md", "index.md", "spec.md", "plan.md"].includes(fileName);
}

async function listTool(context: ToolContext, input: Record<string, unknown>): Promise<unknown> {
  const targetPath = String(input.path ?? ".");
  try {
    const absolutePath = resolveToolPath(context, targetPath);
    const entries = await readdir(absolutePath, { withFileTypes: true });
    return {
      path: absolutePath,
      entries: entries
        .filter((entry) => !isHiddenFromModelBrowsing(context.memoryRoot, path.join(absolutePath, entry.name)))
        .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`),
    };
  } catch (error) {
    throw toToolFailure(error);
  }
}

async function searchTool(context: ToolContext, input: Record<string, unknown>): Promise<unknown> {
  const query = String(input.query ?? "");
  const targetPath = String(input.path ?? ".");
  const includeConversations = input.include_conversations === true;

  if (query.length === 0) {
    throw new ToolExecutionFailure("invalid_input", "Search query must not be empty");
  }

  try {
    const absolutePath = resolveToolPath(context, targetPath);
    const matches: Array<{ path: string; line: number; content: string }> = [];
    let omittedMatches = 0;
    let totalContentChars = 0;

    await visitFiles(
      context.memoryRoot,
      absolutePath,
      async (filePath) => {
        const content = await readFile(filePath, "utf8").catch(() => null);
        if (content === null) {
          return;
        }

        const lines = content.split(/\r?\n/);
        lines.forEach((line, index) => {
          if (line.includes(query)) {
            if (matches.length >= MAX_SEARCH_MATCHES || totalContentChars >= MAX_SEARCH_TOTAL_CONTENT_CHARS) {
              omittedMatches += 1;
              return;
            }

            const remainingChars = MAX_SEARCH_TOTAL_CONTENT_CHARS - totalContentChars;
            const renderedContent = renderSearchMatchContent(line, query, Math.min(MAX_SEARCH_MATCH_CONTENT_CHARS, remainingChars));
            totalContentChars += renderedContent.length;
            matches.push({
              path: filePath,
              line: index + 1,
              content: renderedContent,
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
      omitted_matches: omittedMatches,
      limits: {
        max_matches: MAX_SEARCH_MATCHES,
        max_match_content_chars: MAX_SEARCH_MATCH_CONTENT_CHARS,
        max_total_content_chars: MAX_SEARCH_TOTAL_CONTENT_CHARS,
      },
    };
  } catch (error) {
    throw toToolFailure(error);
  }
}

function resolveToolPath(context: ToolContext, requestedPath: string): string {
  try {
    return resolveMemoryPath(context.memoryRoot, requestedPath);
  } catch (error) {
    throw mapPathResolutionFailure(error);
  }
}

function mapPathResolutionFailure(error: unknown): ToolExecutionFailure {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("Path escapes memory root")) {
    return new ToolExecutionFailure("path_invalid", "Path escapes memory root");
  }

  if (message.includes("Path targets reserved memory internals")) {
    return new ToolExecutionFailure("reserved_path", "Path targets reserved memory internals");
  }

  return toToolFailure(error);
}

function redactSensitiveContent(content: string): string {
  return content.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-***redacted***");
}

function renderSearchMatchContent(content: string, query: string, maxChars: number): string {
  const redacted = redactSensitiveContent(content);
  if (redacted.length <= maxChars) {
    return redacted;
  }

  const queryIndex = redacted.indexOf(query);
  const markerOverhead = " [...]".length + "[...] ".length;
  const excerptLength = Math.max(query.length, maxChars - markerOverhead);
  const start = queryIndex >= 0
    ? Math.max(0, queryIndex - Math.floor((excerptLength - query.length) / 2))
    : 0;
  const end = Math.min(redacted.length, start + excerptLength);
  const adjustedStart = Math.max(0, end - excerptLength);
  const prefix = adjustedStart > 0 ? "[...] " : "";
  const suffix = end < redacted.length ? " [...]" : "";

  return `${prefix}${redacted.slice(adjustedStart, end)}${suffix}`;
}

function isConversationsPath(memoryRoot: string, absolutePath: string): boolean {
  const relativePath = toMemoryRelativePath(memoryRoot, absolutePath);
  const normalizedRelative = relativePath.replace(/\\/g, "/");
  const firstSegment = normalizedRelative.split("/")[0] ?? "";
  return firstSegment === "conversations";
}

function isHiddenFromModelBrowsing(memoryRoot: string, absolutePath: string): boolean {
  if (isReservedMemoryPath(memoryRoot, absolutePath)) {
    return true;
  }

  const relativePath = toMemoryRelativePath(memoryRoot, absolutePath);
  const normalizedRelative = relativePath.replace(/\\/g, "/");
  const firstSegment = normalizedRelative.split("/")[0] ?? "";
  return SEARCH_EXCLUDED_ROOTS.has(firstSegment);
}

async function visitFiles(
  memoryRoot: string,
  currentPath: string,
  visitor: (filePath: string) => Promise<void>,
  options: {
    includeConversations: boolean;
  }
): Promise<void> {
  if (isHiddenFromModelBrowsing(memoryRoot, currentPath)) {
    return;
  }

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
    if (isHiddenFromModelBrowsing(memoryRoot, absoluteEntry)) {
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

export function fileOpsTools(): ToolDefinition[] {
  return [
    {
      name: "memory_read",
      description: "Read a file inside memory root",
      requiresApproval: false,
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      },
      execute: readTool,
    },
    {
      name: "memory_write",
      description: "Write a file inside memory root",
      requiresApproval: true,
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"]
      },
      execute: writeTool,
    },
    {
      name: "memory_edit",
      description: "Edit a file inside memory root",
      requiresApproval: true,
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          find: { type: "string" },
          replace: { type: "string" }
        },
        required: ["path", "find", "replace"]
      },
      execute: editTool,
    },
    {
      name: "memory_delete",
      description: "Delete a file or folder inside memory root",
      requiresApproval: true,
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      },
      execute: deleteTool,
    },
    {
      name: "memory_list",
      description: "List files inside memory root",
      requiresApproval: false,
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" }
        }
      },
      execute: listTool,
    },
    {
      name: "memory_search",
      description: "Search file contents inside memory root",
      requiresApproval: false,
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          query: { type: "string" },
          include_conversations: { type: "boolean" }
        },
        required: ["query"]
      },
      execute: searchTool,
    },
  ];
}
