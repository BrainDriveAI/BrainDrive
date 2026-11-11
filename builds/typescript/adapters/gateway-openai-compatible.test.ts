import { describe, expect, it } from "vitest";

import { OpenAICompatibleGatewayAdapter } from "./gateway-openai-compatible.js";

describe("OpenAICompatibleGatewayAdapter.normalizeMessageRequest", () => {
  const adapter = new OpenAICompatibleGatewayAdapter();

  it("accepts project-only metadata", () => {
    const result = adapter.normalizeMessageRequest(
      {
        content: "Interview me about this project",
        metadata: {
          project: "project-123",
        },
      },
      undefined
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.metadata).toEqual({
        project: "project-123",
      });
    }
  });

  it("accepts the typed web interface context and preserves it for the agent", () => {
    const metadata = {
      client: "web",
      project: "finance",
      interface_context: {
        location: "page",
        screen: "document",
        page: { id: "finance", name: "Your Finance" },
        document: { name: "Plan.md", path: "finance/Plan.md", state: "editing" },
      },
    };

    const result = adapter.normalizeMessageRequest({ content: "Review this page", metadata }, undefined);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.metadata).toEqual(metadata);
  });

  it("rejects unknown fields inside the typed interface context", () => {
    const result = adapter.normalizeMessageRequest(
      {
        content: "hello",
        metadata: {
          interface_context: {
            location: "your-agent",
            screen: "conversation",
            unexpected: true,
          },
        },
      },
      undefined
    );

    expect(result.ok).toBe(false);
  });

  it("rejects unknown metadata fields", () => {
    const result = adapter.normalizeMessageRequest(
      {
        content: "hello",
        metadata: {
          project: "project-123",
          foo: "bar",
        },
      },
      undefined
    );

    expect(result.ok).toBe(false);
  });
});
