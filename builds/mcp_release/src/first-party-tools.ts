import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AppConfig } from "./config.js";
import {
  ToolFailure,
  deleteMemoryPath,
  editMemoryFile,
  ensureAuthState,
  ensureMemoryLayout,
  exportMemory,
  getMemoryHistory,
  listMemoryPath,
  listProjects,
  readAuthState,
  readMemoryFile,
  searchMemory,
  toToolFailure,
  writeMemoryFile,
} from "./memory-core.js";
import type { RequestContext } from "./request-context.js";
import { textResult } from "./tool-common.js";

export type RequestContextProvider = () => RequestContext;

type StructuredResponse = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

export async function prepareFirstPartyState(config: AppConfig): Promise<void> {
  await ensureMemoryLayout(config.memoryRoot);
  await ensureAuthState(config.memoryRoot);
}

export function registerFirstPartyTools(
  kind: AppConfig["serverKind"],
  server: McpServer,
  config: AppConfig,
  getContext: RequestContextProvider
): void {
  if (kind === "memory") {
    registerMemoryTools(server, config);
    return;
  }

  if (kind === "auth") {
    registerAuthTools(server, config, getContext);
    return;
  }

  registerProjectTools(server, config);
}

function registerMemoryTools(server: McpServer, config: AppConfig): void {
  server.registerTool(
    "memory_read",
    {
      title: "Memory Read",
      description: "Read a file inside memory root",
      inputSchema: {
        path: z.string().min(1),
      },
    },
    async (args) => {
      try {
        const payload = await readMemoryFile(config.memoryRoot, args.path);
        return success(payload);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "memory_write",
    {
      title: "Memory Write",
      description: "Write a file inside memory root",
      inputSchema: {
        path: z.string().min(1),
        content: z.string(),
      },
    },
    async (args) => {
      try {
        const payload = await writeMemoryFile(config.memoryRoot, args.path, args.content);
        return success(payload);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "memory_edit",
    {
      title: "Memory Edit",
      description: "Edit a file inside memory root",
      inputSchema: {
        path: z.string().min(1),
        find: z.string(),
        replace: z.string(),
      },
    },
    async (args) => {
      try {
        const payload = await editMemoryFile(config.memoryRoot, args.path, args.find, args.replace);
        return success(payload);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "memory_delete",
    {
      title: "Memory Delete",
      description: "Delete a file or folder inside memory root",
      inputSchema: {
        path: z.string().min(1),
      },
    },
    async (args) => {
      try {
        const payload = await deleteMemoryPath(config.memoryRoot, args.path);
        return success(payload);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "memory_list",
    {
      title: "Memory List",
      description: "List files inside memory root",
      inputSchema: {
        path: z.string().default("."),
      },
    },
    async (args) => {
      try {
        const payload = await listMemoryPath(config.memoryRoot, args.path);
        return success(payload);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "memory_search",
    {
      title: "Memory Search",
      description: "Search file contents inside memory root",
      inputSchema: {
        path: z.string().default("."),
        query: z.string().min(1),
        include_conversations: z.boolean().default(false),
      },
    },
    async (args) => {
      try {
        const payload = await searchMemory(config.memoryRoot, args.query, args.path, args.include_conversations);
        return success(payload);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "memory_history",
    {
      title: "Memory History",
      description: "Return git-backed history and prior states for a file",
      inputSchema: {
        path: z.string().min(1),
        commit: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const payload = await getMemoryHistory(config.memoryRoot, args.path, args.commit);
        return success({ entries: payload });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "memory_export",
    {
      title: "Memory Export",
      description: "Export owner data as an archive",
      inputSchema: {},
    },
    async () => {
      try {
        const payload = await exportMemory(config.memoryRoot);
        return success(payload);
      } catch (error) {
        return failure(error);
      }
    }
  );
}

function registerAuthTools(server: McpServer, config: AppConfig, getContext: RequestContextProvider): void {
  server.registerTool(
    "auth_whoami",
    {
      title: "Auth WhoAmI",
      description: "Return the current authenticated actor",
      inputSchema: {},
    },
    async () => {
      const context = getContext();
      return success({
        actor_id: context.actorId,
        actor_type: context.actorType,
        mode: context.authMode,
      });
    }
  );

  server.registerTool(
    "auth_check",
    {
      title: "Auth Check",
      description: "Return permission data for the current actor",
      inputSchema: {},
    },
    async () => {
      const context = getContext();
      return success({
        allowed: true,
        permissions: context.permissions,
      });
    }
  );

  server.registerTool(
    "auth_export",
    {
      title: "Auth Export",
      description: "Return exportable non-secret auth state",
      inputSchema: {},
    },
    async () => {
      try {
        await ensureAuthState(config.memoryRoot);
        const payload = await readAuthState(config.memoryRoot);
        return success(payload as unknown as Record<string, unknown>);
      } catch (error) {
        return failure(error);
      }
    }
  );
}

function registerProjectTools(server: McpServer, config: AppConfig): void {
  server.registerTool(
    "project_list",
    {
      title: "Project List",
      description: "List projects under documents with project completeness status",
      inputSchema: {},
    },
    async () => {
      try {
        const payload = await listProjects(config.memoryRoot);
        return success(payload as unknown as Record<string, unknown>);
      } catch (error) {
        return failure(error);
      }
    }
  );
}

function success(payload: Record<string, unknown>): StructuredResponse {
  return {
    content: textResult(payload),
    structuredContent: payload,
  };
}

function failure(error: unknown): StructuredResponse {
  const toolFailure = error instanceof ToolFailure ? error : toToolFailure(error);
  const payload = {
    code: toolFailure.code,
    message: toolFailure.message,
    recoverable: toolFailure.recoverable,
  };

  return {
    isError: true,
    content: textResult(payload),
    structuredContent: payload,
  };
}
