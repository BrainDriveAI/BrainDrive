import type { ToolDefinition } from "../contracts.js";
import type { McpServerConfig } from "./config.js";
import { listLegacyMcpTools, mapLegacyMcpToolToDefinition } from "./host/legacy-adapter.js";

export async function discoverMcpToolDefinitions(servers: McpServerConfig[]): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];
  for (const server of servers) {
    const listedTools = await listLegacyMcpTools(server);
    tools.push(...listedTools.map((tool) => mapLegacyMcpToolToDefinition(server, tool)));
  }
  return tools;
}
