import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { GatewayMessage, ToolDefinition } from "../contracts.js";
import { prepareContextWindow, resolveContextWindowSettingsFromEnv } from "./context-window.js";

function createTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    requiresApproval: false,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
      },
    },
    execute: async () => ({ ok: true }),
  };
}

describe("context window manager", () => {
  it("resolves env settings safely", () => {
    const settings = resolveContextWindowSettingsFromEnv({
      BRAINDRIVE_CONTEXT_WINDOW_TOKENS: "64000",
      BRAINDRIVE_CONTEXT_RESPONSE_HEADROOM_TOKENS: "4000",
      BRAINDRIVE_CONTEXT_WARNING_THRESHOLD: "0.75",
    });

    expect(settings).toEqual({
      contextWindowTokens: 64_000,
      responseHeadroomTokens: 4_000,
      warningThreshold: 0.75,
    });

    const invalid = resolveContextWindowSettingsFromEnv({
      BRAINDRIVE_CONTEXT_WINDOW_TOKENS: "0",
      BRAINDRIVE_CONTEXT_RESPONSE_HEADROOM_TOKENS: "-1",
      BRAINDRIVE_CONTEXT_WARNING_THRESHOLD: "1.2",
    });

    expect(invalid.warningThreshold).toBe(0.8);
    expect(invalid.contextWindowTokens).toBe(128_000);
    expect(invalid.responseHeadroomTokens).toBe(8_000);
  });

  it("compacts older turns and writes a summary artifact when over budget", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));

    try {
      const messages: GatewayMessage[] = [
        {
          role: "system",
          content: "You are BrainDrive.",
        },
      ];

      for (let index = 0; index < 12; index += 1) {
        messages.push(
          {
            role: "user",
            content: `Long user turn ${index}: ${"alpha ".repeat(900)}`,
          },
          {
            role: "assistant",
            content: `Long assistant turn ${index}: ${"beta ".repeat(900)}`,
          }
        );
      }

      const prepared = await prepareContextWindow({
        memoryRoot,
        conversationId: "conv-heavy",
        correlationId: "corr-heavy",
        messages,
        tools: [createTool("memory_search"), createTool("memory_read")],
        settings: {
          contextWindowTokens: 4_096,
          responseHeadroomTokens: 512,
          warningThreshold: 0.8,
        },
      });

      expect(prepared.messages.length).toBeLessThan(messages.length);
      expect(prepared.usage.droppedUnits).toBeGreaterThan(0);
      expect(prepared.usage.summaryApplied).toBe(true);
      expect(prepared.warning?.managed).toBe(true);
      expect(prepared.warning?.message).toContain("compacted");
      expect(prepared.usage.summaryArtifactPath).toBeTruthy();

      const artifactPath = path.join(memoryRoot, prepared.usage.summaryArtifactPath!);
      const artifact = await readFile(artifactPath, "utf8");
      expect(artifact).toContain("# Context Summary Artifact");
      expect(artifact).toContain("Conversation ID: conv-heavy");
      expect(artifact).toContain("Summary Text");
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("preserves assistant tool-call blocks without splitting tool responses", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));

    try {
      const messages: GatewayMessage[] = [
        { role: "system", content: "You are BrainDrive." },
        { role: "user", content: `Older question ${"x ".repeat(1500)}` },
        { role: "assistant", content: `Older answer ${"y ".repeat(1500)}` },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "tool-1",
              name: "memory_search",
              input: { q: "finance notes" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "tool-1",
          content: JSON.stringify({ status: "ok", output: { matches: ["doc-1"] } }),
        },
        { role: "assistant", content: "I found your finance notes." },
      ];

      const prepared = await prepareContextWindow({
        memoryRoot,
        conversationId: "conv-tools",
        correlationId: "corr-tools",
        messages,
        tools: [createTool("memory_search")],
        settings: {
          contextWindowTokens: 3_000,
          responseHeadroomTokens: 500,
          warningThreshold: 0.8,
        },
      });

      const toolIndices = prepared.messages
        .map((message, index) => (message.role === "tool" ? index : -1))
        .filter((index) => index >= 0);

      for (const toolIndex of toolIndices) {
        const previousMessage = prepared.messages[toolIndex - 1];
        expect(previousMessage?.role).toBe("assistant");
        expect(previousMessage?.tool_calls?.length).toBeGreaterThan(0);
      }
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });
});
