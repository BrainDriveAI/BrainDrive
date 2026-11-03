import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServerConfig } from "./config.js";

const listMcpToolsMock = vi.hoisted(() => vi.fn());
vi.mock("./client.js", () => ({
  listMcpTools: listMcpToolsMock,
  mapMcpToolToDefinition: (server: McpServerConfig, tool: { name: string }) => ({
    name: tool.name,
    description: server.id,
  }),
}));

import { discoverMcpToolDefinitions } from "./registry.js";

function source(id: string, required: boolean): McpServerConfig {
  return {
    id,
    transport: "streamable-http",
    url: "http://127.0.0.1:8899/mcp",
    tool_name_prefix: "",
    enabled: true,
    timeout_ms: 500,
    headers_env: {},
    read_only_tools: [],
    source_kind: "user_replacement",
    trust_level: "untrusted",
    isolation: "remote",
    required,
  };
}

describe("MCP discovery availability", () => {
  beforeEach(() => listMcpToolsMock.mockReset());

  it("keeps local startup possible when an optional remote source is down", async () => {
    listMcpToolsMock
      .mockRejectedValueOnce(new Error("remote unavailable"))
      .mockResolvedValueOnce([{ name: "healthy_tool" }]);

    const tools = await discoverMcpToolDefinitions([
      source("unavailable", false),
      source("healthy", true),
    ]);

    expect(tools.map((tool) => tool.name)).toEqual(["healthy_tool"]);
  });

  it("still fails startup for a required source", async () => {
    listMcpToolsMock.mockRejectedValueOnce(new Error("required source unavailable"));

    await expect(discoverMcpToolDefinitions([source("required", true)]))
      .rejects.toThrow("required source unavailable");
  });
});
