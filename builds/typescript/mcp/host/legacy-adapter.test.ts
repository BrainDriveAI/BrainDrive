import { describe, expect, it } from "vitest";

import type { McpServerConfig } from "../config.js";
import { mapLegacyMcpToolToDefinition, normalizeLegacyCallResult, BOUNDED_LEGACY_MCP_PROFILE } from "./legacy-adapter.js";

const server: McpServerConfig = {
  id: "memory",
  transport: "streamable-http",
  url: "http://127.0.0.1:8911/mcp",
  tool_name_prefix: "memory_",
  enabled: true,
  timeout_ms: 15_000,
  headers_env: {},
  read_only_tools: ["read_file"],
  source_kind: "system_shipped",
  trust_level: "first_party",
  isolation: "process",
  required: true,
};

describe("bounded legacy fixed-tool adapter", () => {
  it("pins the legacy profile without Apps authority", () => {
    expect(BOUNDED_LEGACY_MCP_PROFILE).toEqual({
      era: "bounded_legacy_stateful",
      protocolVersion: "2025-11-25",
      methods: ["tools/list", "tools/call"],
      apps: false,
    });
  });

  it("preserves fixed tool naming, descriptions, schemas, and approval classification", () => {
    const read = mapLegacyMcpToolToDefinition(server, {
      name: "read_file",
      description: "Read one file",
      inputSchema: { type: "object", required: ["path"] },
    });
    expect(read).toMatchObject({
      name: "memory_read_file",
      description: "[mcp:memory] Read one file",
      requiresApproval: false,
      readOnly: true,
      inputSchema: { type: "object", required: ["path"] },
    });

    const write = mapLegacyMcpToolToDefinition(server, {
      name: "write_file",
      inputSchema: { type: "object" },
    });
    expect(write).toMatchObject({
      name: "memory_write_file",
      description: "[mcp:memory] write_file",
      requiresApproval: true,
      readOnly: false,
    });
  });

  it("preserves the exact fixed call projection and typed legacy error behavior", () => {
    expect(normalizeLegacyCallResult({ structuredContent: { exact: true }, content: [{ type: "text", text: "ignored" }] }))
      .toEqual({ exact: true });
    expect(normalizeLegacyCallResult({ toolResult: { old: true }, content: [{ type: "text", text: "ignored" }] }))
      .toEqual({ old: true });
    expect(() => normalizeLegacyCallResult({
      isError: true,
      structuredContent: { code: "permission_denied", message: "Denied by fixture", recoverable: false },
      content: [{ type: "text", text: "not projected" }],
    })).toThrowError(expect.objectContaining({
      code: "permission_denied",
      message: "Denied by fixture",
      recoverable: false,
    }));
  });
});
