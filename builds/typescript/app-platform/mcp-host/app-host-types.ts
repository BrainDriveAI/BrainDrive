import type { z } from "zod";

import type { McpAppResourceSchema } from "../contracts/mcp-app.js";

type AppResource = z.infer<typeof McpAppResourceSchema>;

export type AppLaunch = {
  launch_version: 1;
  session_id: string;
  installation_id: string;
  view_id: string;
  operation_id: string;
  bridge_generation: number;
  resumed: boolean;
  bridge_token_id: string;
  server_id: string;
  expires_at: string;
  protocol: { core: string; apps_extension: string; server_name: string; server_version: string };
  resource: AppResource;
  allowed_tools: string[];
  allowed_capabilities: string[];
  entry_point: "direct" | "career";
};
