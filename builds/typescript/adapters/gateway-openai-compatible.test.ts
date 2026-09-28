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

  it("accepts exact app-chat metadata for native app workspaces", () => {
    const appChat = {
      metadata_version: 1,
      app_id: "ai.braindrive.resume-builder",
      installation_id: "00000000-0000-4000-8000-000000000001",
      package_digest: `sha256:${"a".repeat(64)}`,
      session_id: "00000000-0000-4000-8000-000000000002",
      view_id: "00000000-0000-4000-8000-000000000003",
      operation_id: "00000000-0000-4000-8000-000000000004",
      session_generation: 1,
      presentation_id: "just.chat",
      workspace_id: "resume.chat",
      context_grant_set_digest: `sha256:${"b".repeat(64)}`,
    };

    const result = adapter.normalizeMessageRequest(
      {
        content: "Build my resume",
        metadata: {
          client: "web",
          app_chat: appChat,
        },
      },
      undefined
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.metadata).toEqual({
        client: "web",
        app_chat: appChat,
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

  it("rejects extra fields inside app-chat metadata", () => {
    const result = adapter.normalizeMessageRequest(
      {
        content: "Build my resume",
        metadata: {
          client: "web",
          app_chat: {
            metadata_version: 1,
            app_id: "ai.braindrive.resume-builder",
            installation_id: "00000000-0000-4000-8000-000000000001",
            package_digest: `sha256:${"a".repeat(64)}`,
            session_id: "00000000-0000-4000-8000-000000000002",
            view_id: "00000000-0000-4000-8000-000000000003",
            operation_id: "00000000-0000-4000-8000-000000000004",
            session_generation: 1,
            presentation_id: "just.chat",
            workspace_id: "resume.chat",
            context_grant_set_digest: `sha256:${"b".repeat(64)}`,
            host_path: "/home/demo/private",
          },
        },
      },
      undefined
    );

    expect(result.ok).toBe(false);
  });
});
