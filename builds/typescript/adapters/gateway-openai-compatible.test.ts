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
