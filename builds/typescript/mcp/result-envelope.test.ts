import { describe, expect, it } from "vitest";

import { MCP_MODERN_PROTOCOL_VERSION } from "../app-platform/contracts/constants.js";
import { preserveMcpResult, projectLegacyToolResult } from "./result-envelope.js";

const connectionId = "20000000-0000-4000-8000-000000000001";
const operationId = "20000000-0000-4000-8000-000000000002";

describe("complete MCP result preservation", () => {
  it("preserves every content item, annotations, resources, metadata, progress, and structured content", () => {
    const raw = {
      content: [
        { type: "text", text: "first", annotations: { audience: ["user" as const], priority: 0.7 }, _meta: { visible: true } },
        { type: "resource_link", name: "app", uri: "ui://resume-builder/main", mimeType: "text/html;profile=mcp-app", size: 120, _meta: { cache: "immutable" } },
        { type: "resource", resource: { uri: "ui://resume-builder/state", mimeType: "application/json", text: "{\"ready\":true}", _meta: { revision: 1 } } },
      ],
      structuredContent: { ready: true },
      _meta: { "io.modelcontextprotocol/ui": { resourceUri: "ui://resume-builder/main" } },
      isError: false,
    };

    const complete = preserveMcpResult(raw, {
      protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
      connectionId,
      operationId,
      requestId: "request-1",
      progressToken: "progress-1",
      cancellationId: "20000000-0000-4000-8000-000000000003",
    });

    expect(complete.content).toEqual(raw.content);
    expect(complete.structuredContent).toEqual({ ready: true });
    expect(complete._meta).toEqual(raw._meta);
    expect(complete.progress_token).toBe("progress-1");
  });

  it("keeps the ordinary fixed-tool projection behavior isolated", () => {
    expect(projectLegacyToolResult({ structuredContent: { first: true }, toolResult: { second: true }, content: [{ type: "text", text: "third" }] }))
      .toEqual({ first: true });
    expect(projectLegacyToolResult({ toolResult: { legacy: true } })).toEqual({ legacy: true });
    expect(projectLegacyToolResult({ content: [{ type: "text", text: "{\"parsed\":true}" }, { type: "text", text: "ignored" }] }))
      .toEqual({ parsed: true });
  });

  it("rejects unsupported content instead of silently dropping it", () => {
    expect(() => preserveMcpResult({ content: [{ type: "video", data: "unsafe" }] }, {
      protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
      connectionId,
      operationId,
      requestId: 1,
    })).toThrow();
  });
});
