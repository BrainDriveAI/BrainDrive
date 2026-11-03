import type { ToolDefinition } from "../contracts.js";
import { auditLog } from "../logger.js";
import type { McpServerConfig } from "./config.js";
import { listMcpTools, mapMcpToolToDefinition } from "./client.js";

export async function discoverMcpToolDefinitions(servers: McpServerConfig[]): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];
  for (const server of servers) {
    try {
      const listedTools = await listMcpTools(server);
      tools.push(...listedTools.map((tool) => mapMcpToolToDefinition(server, tool)));
    } catch (error) {
      auditLog("mcp.server.unavailable", {
        server_id: server.id,
        required: server.required,
        message: error instanceof Error ? error.message : String(error),
      });
      if (server.required) throw error;
    }
  }
  return tools;
}

