import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { AuthContext, GatewayMessage, ToolDefinition } from "../contracts.js";
import type { ModelAdapter } from "../adapters/base.js";
import { ApprovalStore } from "../engine/approval-store.js";
import { runAgentLoop } from "../engine/loop.js";
import { ToolExecutor } from "../engine/tool-executor.js";
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
  it("sends a 50k-character system prompt and large conversation messages intact to the provider within budget", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));
    try {
      const messages: GatewayMessage[] = [
        { role: "system", content: "a".repeat(25_000) + "Active app instructions" + "b".repeat(25_000) },
        { role: "user", content: "u".repeat(10_000) },
        { role: "assistant", content: "a".repeat(15_000) },
        { role: "user", content: "Continue." },
      ];
      const prepared = await prepareContextWindow({
        memoryRoot, conversationId: "conv-intact", correlationId: "corr-intact", messages, tools: [],
        settings: { contextWindowTokens: 128_000, responseHeadroomTokens: 8_000 },
      });
      let providerMessages: GatewayMessage[] = [];
      const adapter: ModelAdapter = {
        complete: async (request) => {
          providerMessages = [...request.messages];
          return { assistantText: "Done.", toolCalls: [], finishReason: "completed" };
        },
      };
      const auth: AuthContext = {
        actorId: "synthetic-owner", actorType: "owner", mode: "local",
        permissions: {
          memory_access: true, tool_access: true, system_actions: true,
          delegation: true, approval_authority: true, administration: true,
        },
      };
      const events = [];
      for await (const event of runAgentLoop(adapter, new ToolExecutor([]), new ApprovalStore(), {
        messages: prepared.messages,
        metadata: { conversation_id: "conv-intact", correlation_id: "corr-intact" },
      }, auth, { memoryRoot })) {
        events.push(event);
      }
      expect(providerMessages.map((message) => message.content.length)).toEqual(messages.map((message) => message.content.length));
      expect(providerMessages).toEqual(messages);
      expect(events.at(-1)?.type).toBe("done");
      expect(prepared.usage.budgetTokens).toBe(120_000);
      expect(prepared.usage.estimatedPromptTokensBefore).toBeGreaterThan(18_000);
      expect(prepared.usage.estimatedPromptTokensAfter).toBe(prepared.usage.estimatedPromptTokensBefore);
      expect(prepared.warning).toBeNull();
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("preserves a 10k-character document tool result within budget", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));
    try {
      const messages: GatewayMessage[] = [
        { role: "system", content: "Use the current document." },
        { role: "user", content: "Read my document." },
        { role: "assistant", content: "", tool_calls: [{ id: "read-1", name: "memory_read", input: {} }] },
        { role: "tool", tool_call_id: "read-1", content: JSON.stringify({ document: "p".repeat(10_000) }) },
        { role: "user", content: "Use that document." },
      ];
      const prepared = await prepareContextWindow({
        memoryRoot, conversationId: "conv-document", correlationId: "corr-document", messages,
        tools: [createTool("memory_read")],
        settings: { contextWindowTokens: 128_000, responseHeadroomTokens: 8_000 },
      });
      expect(prepared.messages.find((message) => message.role === "tool")?.content.length).toBe(messages[3].content.length);
      expect(prepared.messages).toEqual(messages);
      expect(prepared.warning).toBeNull();
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("reduces older conversation before system instructions when over budget", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));
    try {
      const instructions: GatewayMessage[] = [
        { role: "system", content: "s".repeat(50_000) },
        { role: "system", content: "Active app instructions must remain intact." },
      ];
      const prepared = await prepareContextWindow({
        memoryRoot, conversationId: "conv-priority", correlationId: "corr-priority",
        messages: [...instructions, { role: "user", content: "o".repeat(40_000) }, { role: "user", content: "Latest question." }],
        tools: [], settings: { contextWindowTokens: 20_000, responseHeadroomTokens: 2_000 },
      });
      expect(prepared.usage.estimatedPromptTokensBefore).toBeGreaterThan(prepared.usage.budgetTokens);
      expect(prepared.messages.slice(0, 2).map((message) => message.content.length)).toEqual(instructions.map((message) => message.content.length));
      expect(prepared.messages.slice(0, 2)).toEqual(instructions);
      expect(prepared.usage.droppedMessages).toBe(1);
      expect(prepared.usage.summaryApplied).toBe(true);
      expect(prepared.messages.at(-1)?.content).toBe("Latest question.");
      expect(prepared.usage.estimatedPromptTokensAfter).toBeLessThanOrEqual(prepared.usage.budgetTokens);
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("reports last-resort clipping without cutting system instructions or splitting a tool block", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));
    try {
      const instructions: GatewayMessage = { role: "system", content: "s".repeat(10_000) };
      const prepared = await prepareContextWindow({
        memoryRoot, conversationId: "conv-clipping", correlationId: "corr-clipping",
        messages: [instructions,
          { role: "assistant", content: "", tool_calls: [{ id: "read-1", name: "memory_read", input: {} }] },
          { role: "tool", tool_call_id: "read-1", content: "p".repeat(30_000) },
        ],
        tools: [], settings: { contextWindowTokens: 4_096, responseHeadroomTokens: 512 },
      });
      expect(prepared.messages[0].content.length).toBe(instructions.content.length);
      expect(prepared.messages[0]).toEqual(instructions);
      expect(prepared.messages.map((message) => message.role)).toEqual(["system", "assistant", "tool"]);
      expect(prepared.messages[2].content).toContain("[truncated");
      expect(prepared.usage.truncatedMessages).toBe(1);
      expect(prepared.warning?.managed).toBe(true);
      expect(prepared.warning?.message).toContain("shortened");
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("keeps instructions intact and warns when they alone exceed the budget", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));
    try {
      const instructions: GatewayMessage = { role: "system", content: "s".repeat(50_000) };
      const prepared = await prepareContextWindow({
        memoryRoot, conversationId: "conv-oversized", correlationId: "corr-oversized",
        messages: [instructions, { role: "user", content: "Continue." }], tools: [],
        settings: { contextWindowTokens: 4_096, responseHeadroomTokens: 512 },
      });
      expect(prepared.messages[0].content.length).toBe(instructions.content.length);
      expect(prepared.messages[0]).toEqual(instructions);
      expect(prepared.usage.ratioAfter).toBeGreaterThan(1);
      expect(prepared.warning?.message).toContain("exceeds");
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

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
