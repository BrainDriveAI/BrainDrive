import path from "node:path";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import type { ToolContext, ToolDefinition } from "../../contracts.js";
import { commitMemoryChange } from "../../git.js";
import { auditLog } from "../../logger.js";
import { isReservedMemoryPath, resolveMemoryPath, toMemoryRelativePath } from "../../memory/paths.js";
import { ToolExecutionFailure, toToolFailure } from "../../tool-error.js";

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
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
    auditLog("memory.write", {
      action: "file.write",
      path: absolutePath,
      correlation_id: context.correlationId,
    });
    await commitMemoryChange(context.memoryRoot, `Write ${toMemoryRelativePath(context.memoryRoot, absolutePath)}`);
    return { path: absolutePath, bytes_written: Buffer.byteLength(content) };
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

    // Detect ambiguous find: if `find` matches more than once, force the caller to disambiguate
    // by adding more surrounding context. Avoids silent partial replacement that String#replace
    // would otherwise do (replaces only the first occurrence). See L17 in master plan.
    if (original.indexOf(find) !== original.lastIndexOf(find)) {
      throw new ToolExecutionFailure(
        "invalid_input",
        "Edit `find` matches multiple locations — make it unique by adding surrounding context (e.g., a preceding header or neighboring line)"
      );
    }

    const updated = original.replace(find, replace);
    await writeFile(absolutePath, updated, "utf8");
    auditLog("memory.write", {
      action: "file.edit",
      path: absolutePath,
      correlation_id: context.correlationId,
    });
    await commitMemoryChange(context.memoryRoot, `Edit ${toMemoryRelativePath(context.memoryRoot, absolutePath)}`);
    return { path: absolutePath, updated: true };
  } catch (error) {
    throw toToolFailure(error);
  }
}

async function deleteTool(context: ToolContext, input: Record<string, unknown>): Promise<unknown> {
  const targetPath = String(input.path ?? "");

  try {
    const absolutePath = resolveToolPath(context, targetPath);
    await rm(absolutePath, { recursive: true, force: true });
    auditLog("memory.write", {
      action: "file.delete",
      path: absolutePath,
      correlation_id: context.correlationId,
    });
    await commitMemoryChange(context.memoryRoot, `Delete ${toMemoryRelativePath(context.memoryRoot, absolutePath)}`);
    return { path: absolutePath, deleted: true };
  } catch (error) {
    throw toToolFailure(error);
  }
}

async function listTool(context: ToolContext, input: Record<string, unknown>): Promise<unknown> {
  const targetPath = String(input.path ?? ".");
  try {
    const absolutePath = resolveToolPath(context, targetPath);
    const entries = await readdir(absolutePath, { withFileTypes: true });
    return {
      path: absolutePath,
      entries: entries
        .filter((entry) => !isReservedMemoryPath(context.memoryRoot, path.join(absolutePath, entry.name)))
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

    return { query, include_conversations: includeConversations, matches };
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

