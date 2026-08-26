import { describe, expect, it } from "vitest";

import { MCP_MODERN_PROTOCOL_VERSION } from "../../app-platform/contracts/constants.js";
import {
  preserveMcpResult,
  projectLegacyToolResult,
  projectMcpResult,
} from "../result-envelope.js";

const connectionId = "21000000-0000-4000-8000-000000000001";
const operationId = "21000000-0000-4000-8000-000000000002";

describe("Milestone 2 complete MCP envelopes and projections", () => {
  it("round-trips every supported ordered content block and correlation field", () => {
    const raw = {
      content: [
        { type: "text", text: "model summary", annotations: { audience: ["assistant" as const], priority: 0.8 } },
        { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
        { type: "audio", data: "YXVkaW8=", mimeType: "audio/wav" },
        {
          type: "resource_link",
          name: "resume-pdf",
          uri: "artifact://opaque/resume-1",
          mimeType: "application/pdf",
          size: 2048,
          _meta: { ui: { visibility: ["app"] } },
        },
        {
          type: "resource",
          resource: {
            uri: "data://opaque/resume-1",
            mimeType: "application/json",
            text: "{\"ready\":true}",
            _meta: { revision: 7 },
          },
        },
      ],
      structuredContent: { ready: true, revision: 7 },
      _meta: { cache: { ttlMs: 30_000 }, ui: { visibility: ["model", "app"] } },
      isError: false,
    };

    const complete = preserveMcpResult(raw, {
      protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
      connectionId,
      requestId: "request-rich-1",
      operationId,
      progressToken: "progress-1",
      cancellationId: "21000000-0000-4000-8000-000000000003",
      toolVisibility: ["model", "app"],
    });

    expect(complete.content).toEqual(raw.content);
    expect(complete.structuredContent).toEqual(raw.structuredContent);
    expect(complete._meta).toEqual(raw._meta);
    expect(complete.progress_token).toBe("progress-1");
    expect(complete.cancellation_id).toBe("21000000-0000-4000-8000-000000000003");
    expect(complete.projections).toEqual({
      model_visible_content_indices: [0, 1, 2, 4],
      app_visible_content_indices: [0, 1, 2, 3, 4],
      model_structured_content: true,
      app_structured_content: true,
    });
  });

  it("derives minimized model and full app projections without leaking app-only metadata", () => {
    const complete = preserveMcpResult({
      content: [
        { type: "text", text: "shared" },
        { type: "text", text: "view only", _meta: { ui: { visibility: ["app"] }, privateHint: "not-model-visible" } },
      ],
      structuredContent: { status: "ready" },
      _meta: { ui: { visibility: ["app"] }, hostCorrelation: "not-model-visible" },
      isError: false,
    }, {
      protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
      connectionId,
      requestId: 42,
      operationId,
      toolVisibility: ["model", "app"],
    });

    expect(projectMcpResult(complete, "model")).toEqual({
      consumer: "model",
      request_id: 42,
      operation_id: operationId,
      connection_id: connectionId,
      content: [{ type: "text", text: "shared" }],
      isError: false,
      error: null,
    });
    expect(projectMcpResult(complete, "app")).toMatchObject({
      consumer: "app",
      content: [
        { type: "text", text: "shared" },
        { type: "text", text: "view only" },
      ],
      structuredContent: { status: "ready" },
      _meta: { hostCorrelation: "not-model-visible" },
    });
  });

  it("preserves typed tool errors instead of flattening them", () => {
    const complete = preserveMcpResult({
      content: [{ type: "text", text: "Safe failure" }],
      structuredContent: { code: "fixture_unavailable", message: "Try again later" },
      _meta: { retryAfterMs: 500 },
      isError: true,
    }, {
      protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
      connectionId,
      requestId: "request-error-1",
      operationId,
      toolVisibility: ["app"],
    });

    expect(complete.isError).toBe(true);
    expect(complete.error).toEqual({
      category: "unavailable",
      protocol_code: null,
      safe_message: "Try again later",
      retryable: false,
    });
    expect(complete.content).toHaveLength(1);
  });

  it("property-checks deterministic round trips and rejects unsupported content", () => {
    for (let index = 0; index < 128; index += 1) {
      const raw = {
        content: [
          { type: "text" as const, text: `item-${index}` },
          { type: "resource_link" as const, name: `artifact-${index}`, uri: `artifact://opaque/${index}`, size: index },
        ],
        structuredContent: { index },
        _meta: { sequence: index },
        isError: false,
      };
      const complete = preserveMcpResult(raw, {
        protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
        connectionId,
        requestId: index,
        operationId,
        toolVisibility: index % 2 === 0 ? ["model", "app"] : ["app"],
      });
      expect(complete.content).toEqual(raw.content);
      expect(complete.structuredContent).toEqual({ index });
      expect(complete._meta).toEqual({ sequence: index });
    }

    expect(() => preserveMcpResult({ content: [{ type: "video", data: "unsupported" }] }, {
      protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
      connectionId,
      requestId: "invalid",
      operationId,
      toolVisibility: ["app"],
    })).toThrow();
  });

  it("locks the exact fixed-tool legacy projection precedence", () => {
    expect(projectLegacyToolResult({ structuredContent: { first: true }, toolResult: { second: true }, content: [{ type: "text", text: "third" }] }))
      .toEqual({ first: true });
    expect(projectLegacyToolResult({ toolResult: { legacy: true }, content: [{ type: "text", text: "ignored" }] }))
      .toEqual({ legacy: true });
    expect(projectLegacyToolResult({ content: [{ type: "text", text: "{\"parsed\":true}" }, { type: "text", text: "ignored" }] }))
      .toEqual({ parsed: true });
    expect(projectLegacyToolResult({ content: [{ type: "text", text: "plain" }] })).toEqual({ text: "plain" });
    expect(projectLegacyToolResult({ content: [{ type: "resource_link", name: "ignored", uri: "artifact://opaque/1" }] })).toEqual({});
  });
});
