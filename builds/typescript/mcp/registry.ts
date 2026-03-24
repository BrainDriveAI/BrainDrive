import type { ToolDefinition } from "../contracts.js";
import type { McpServerConfig } from "./config.js";
import { listMcpTools, mapMcpToolToDefinition } from "./client.js";

export async function discoverMcpToolDefinitions(servers: McpServerConfig[]): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];
  for (const server of servers) {
    const listedTools = await listMcpTools(server);
    tools.push(...listedTools.map((tool) => mapMcpToolToDefinition(server, tool)));
  }
  return tools;
}

