import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { ToolContext, ToolDefinition } from "../contracts.js";
import { auditLog } from "../logger.js";
import { ToolExecutionFailure } from "../tool-error.js";
import type { McpServerConfig } from "./config.js";
import { resolveServerHeaders } from "./config.js";

type McpListTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type McpCallToolResult = {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  toolResult?: unknown;
  isError?: boolean;
};

export async function listMcpTools(server: McpServerConfig): Promise<McpListTool[]> {
  const headers = resolveServerHeaders(server);
  auditLog("mcp.server.connect", { server_id: server.id, operation: "list_tools" });
  const { client, transport } = await connect(server, headers);

  try {
    const listed = await withTimeout(
      client.listTools(),
      server.timeout_ms,
      `Timed out listing tools from MCP server ${server.id}`
    );
    auditLog("mcp.server.list", { server_id: server.id, tool_count: listed.tools.length });
    return listed.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema:
        (tool.inputSchema as Record<string, unknown> | undefined) ?? {
          type: "object",
          properties: {},
        },
    }));
  } finally {
    await closeSafely(client, transport);
  }
}

export function mapMcpToolToDefinition(server: McpServerConfig, tool: McpListTool): ToolDefinition {
  const localToolName = `${server.tool_name_prefix ?? ""}${tool.name}`;
  const readOnly = server.read_only_tools.includes(tool.name);

  return {
    name: localToolName,
    description: tool.description
      ? `[mcp:${server.id}] ${tool.description}`
      : `[mcp:${server.id}] ${tool.name}`,
    requiresApproval: !readOnly,
    readOnly,
    inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    execute: async (context, input) => {
      auditLog("mcp.tool.call", {
        server_id: server.id,
        tool: tool.name,
      });

      const headers = {
        ...resolveServerHeaders(server),
        ...contextHeaders(context),
      };
      auditLog("mcp.server.connect", { server_id: server.id, operation: "call_tool", tool: tool.name });
      const { client, transport } = await connect(server, headers);
      try {
        const response = await withTimeout(
          client.callTool({
            name: tool.name,
            arguments: input,
          }),
          server.timeout_ms,
          `Timed out calling MCP tool ${tool.name} on server ${server.id}`
        );

        const normalized = normalizeCallResult(response as McpCallToolResult);
        auditLog("mcp.tool.result", {
          server_id: server.id,
          tool: tool.name,
          status: "ok",
        });
        return normalized;
      } catch (error) {
        auditLog("mcp.tool.error", {
          server_id: server.id,
          tool: tool.name,
          message: error instanceof Error ? error.message : "Unknown MCP call error",
        });

        throw error;
      } finally {
        await closeSafely(client, transport);
      }
    },
  };
}

function normalizeCallResult(result: McpCallToolResult): unknown {
  if (result.isError) {
    const errorPayload = extractErrorPayload(result);
    throw new ToolExecutionFailure(errorPayload.code, errorPayload.message, errorPayload.recoverable);
  }

  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }

  if (result.toolResult !== undefined) {
    return result.toolResult;
  }

  const text = result.content?.find((item) => item.type === "text")?.text;
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // non-json text output is allowed
    }
    return { text };
  }

  return {};
}

async function connect(
  server: McpServerConfig,
  headers: Record<string, string>
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: {
      headers,
    },
  });

  const client = new Client({
    name: "paa-mcp-client",
    version: "0.1.0",
  });

  try {
    await withTimeout(
      client.connect(transport),
      server.timeout_ms,
      `Timed out connecting to MCP server ${server.id}`
    );
    return { client, transport };
  } catch (error) {
    await closeSafely(client, transport);
    const message = error instanceof Error ? error.message : "Unknown connection error";
    throw new ToolExecutionFailure("execution_failed", `MCP connection failed for ${server.id}: ${message}`, true);
  }
}

async function closeSafely(client: Client, transport: StreamableHTTPClientTransport): Promise<void> {
  try {
    await client.close();
  } catch {
    // best-effort
  }
  try {
    await transport.close();
  } catch {
    // best-effort
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new ToolExecutionFailure("execution_failed", timeoutMessage, true));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function contextHeaders(context: ToolContext): Record<string, string> {
  return {
    "x-paa-correlation-id": context.correlationId,
    "x-paa-actor-id": context.auth.actorId,
    "x-paa-actor-type": context.auth.actorType,
    "x-paa-auth-mode": context.auth.mode,
    "x-paa-actor-permissions": JSON.stringify(context.auth.permissions),
  };
}

function extractErrorPayload(result: McpCallToolResult): {
  code: "not_found" | "path_invalid" | "reserved_path" | "invalid_input" | "permission_denied" | "execution_failed";
  message: string;
  recoverable: boolean;
} {
  const structured = result.structuredContent;
  if (structured && typeof structured === "object") {
    const code = toFailureCode((structured as { code?: unknown }).code);
    const message = toFailureMessage((structured as { message?: unknown }).message);
    const recoverable = toFailureRecoverable((structured as { recoverable?: unknown }).recoverable);
    return { code, message, recoverable };
  }

  return {
    code: "execution_failed",
    message: "MCP tool returned an error result",
    recoverable: true,
  };
}

function toFailureCode(
  code: unknown
): "not_found" | "path_invalid" | "reserved_path" | "invalid_input" | "permission_denied" | "execution_failed" {
  if (
    code === "not_found" ||
    code === "path_invalid" ||
    code === "reserved_path" ||
    code === "invalid_input" ||
    code === "permission_denied" ||
    code === "execution_failed"
  ) {
    return code;
  }
  return "execution_failed";
}

function toFailureMessage(message: unknown): string {
  if (typeof message === "string" && message.trim().length > 0) {
    return message;
  }
  return "MCP tool returned an error result";
}

function toFailureRecoverable(recoverable: unknown): boolean {
  if (typeof recoverable === "boolean") {
    return recoverable;
  }
  return true;
}
