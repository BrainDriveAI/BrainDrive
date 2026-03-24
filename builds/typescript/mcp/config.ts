import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const mcpServerSchema = z
  .object({
    id: z.string().min(1),
    transport: z.literal("streamable-http"),
    url: z.string().url(),
    tool_name_prefix: z.string().optional(),
    enabled: z.boolean().optional(),
    timeout_ms: z.number().int().positive().max(120_000).optional(),
    headers_env: z.record(z.string(), z.string().min(1)).optional(),
    read_only_tools: z.array(z.string().min(1)).optional(),
    source_kind: z.enum(["system_shipped", "user_replacement"]),
    trust_level: z.enum(["first_party", "trusted", "untrusted"]),
    isolation: z.enum(["container", "process", "remote"]),
    required: z.boolean().optional(),
  })
  .transform((value) => ({
    ...value,
    tool_name_prefix: value.tool_name_prefix ?? "",
    enabled: value.enabled ?? true,
    timeout_ms: value.timeout_ms ?? 15_000,
    headers_env: value.headers_env ?? {},
    read_only_tools: value.read_only_tools ?? [],
    required: value.required ?? true,
  }));

const mcpServersFileSchema = z.object({
  servers: z.array(mcpServerSchema),
});

export type McpServerConfig = z.infer<typeof mcpServerSchema>;

export async function loadMcpServers(rootDir: string, sourcePath: string): Promise<McpServerConfig[]> {
  const absolutePath = path.resolve(rootDir, sourcePath);
  const raw = await readFile(absolutePath, "utf8");
  const parsed = mcpServersFileSchema.parse(JSON.parse(raw));
  const enabledServers = parsed.servers.filter((server) => server.enabled);
  const seenServerIds = new Set<string>();

  for (const server of enabledServers) {
    if (seenServerIds.has(server.id)) {
      throw new Error(`Duplicate MCP server id detected: ${server.id}`);
    }
    seenServerIds.add(server.id);

    if (server.source_kind === "system_shipped" && server.trust_level !== "first_party") {
      throw new Error(`MCP server ${server.id} is system_shipped but trust_level is not first_party`);
    }
  }

  for (const server of enabledServers) {
    for (const [headerName, envName] of Object.entries(server.headers_env)) {
      const envValue = process.env[envName];
      if (!envValue || envValue.trim().length === 0) {
        throw new Error(
          `MCP server ${server.id} requires env var ${envName} for header ${headerName}, but it is not set`
        );
      }
    }
  }

  return enabledServers;
}

export function resolveServerHeaders(server: McpServerConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [headerName, envName] of Object.entries(server.headers_env)) {
    const value = process.env[envName];
    if (!value || value.trim().length === 0) {
      throw new Error(`Missing env var ${envName} required for MCP server ${server.id}`);
    }
    headers[headerName] = value;
  }
  return headers;
}
