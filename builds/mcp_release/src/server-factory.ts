import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AppConfig } from "./config.js";
import { registerFirstPartyTools, type RequestContextProvider } from "./first-party-tools.js";

export function createMcpServer(config: AppConfig, getContext: RequestContextProvider): McpServer {
  const name = `mcp-${config.serverKind}`;
  const server = new McpServer(
    {
      name,
      version: config.version,
    },
    { capabilities: { logging: {} } }
  );

  registerFirstPartyTools(config.serverKind, server, config, getContext);
  return server;
}
