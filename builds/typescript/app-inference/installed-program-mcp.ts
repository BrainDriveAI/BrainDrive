import { randomUUID } from "node:crypto";

import { projectMcpResult } from "../mcp/result-envelope.js";
import type { ModernMcpAppsClient, ModernMcpSession } from "../app-platform/mcp-host/modern-client.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import type { InstalledAppInferenceProgramClient } from "./installed-program.js";

type InternalClient = Pick<ModernMcpAppsClient, "callTool">;

async function call(client: InternalClient, session: ModernMcpSession, tool: string, input: Record<string, unknown>): Promise<unknown> {
  const complete = await client.callTool(session, tool, input, randomUUID(), "model");
  const projected = projectMcpResult(complete, "model");
  if (projected.isError || !projected.structuredContent) {
    throw new AppPlatformError("validation_failed", "Installed app inference program returned no structured result", 409);
  }
  return projected.structuredContent;
}

export function createInstalledAppInferenceProgramClient(client: InternalClient, session: ModernMcpSession): InstalledAppInferenceProgramClient {
  return {
    prepare: (input) => call(client, session, "app.inference.prepare", input as unknown as Record<string, unknown>),
    adjudicate: (input) => call(client, session, "app.inference.adjudicate", input as unknown as Record<string, unknown>),
  };
}
