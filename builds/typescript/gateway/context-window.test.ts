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
  const profileReadMetadata = {
    source: "installed_app_action",
    app_id: "ai.braindrive.resume-builder",
    action_id: "resume.profile.read",
  };

  it.each([
    { label: "11k Profile read", size: 11_000, cap: 24_000, name: "app_action_resume_profile_read", metadata: profileReadMetadata, paired: true },
    { label: "30k Profile read", size: 30_000, cap: 24_000, name: "app_action_resume_profile_read", metadata: profileReadMetadata, paired: true },
    { label: "unrelated tool with identical text", size: 11_000, cap: 4_000, name: "memory_read", metadata: undefined, paired: true },
    { label: "spoofed tool name", size: 11_000, cap: 4_000, name: "app_action_resume_profile_read", metadata: undefined, paired: true },
    { label: "same action from another app", size: 11_000, cap: 4_000, name: "app_action_resume_profile_read", metadata: { ...profileReadMetadata, app_id: "ai.example.other-app" }, paired: true },
    { label: "another Resume Builder action", size: 11_000, cap: 4_000, name: "app_action_resume_state_read", metadata: { ...profileReadMetadata, action_id: "resume.state.read" }, paired: true },
    { label: "non-app tool source", size: 11_000, cap: 4_000, name: "app_action_resume_profile_read", metadata: { ...profileReadMetadata, source: "mcp" }, paired: true },
    { label: "unmatched result ID", size: 11_000, cap: 4_000, name: "app_action_resume_profile_read", metadata: profileReadMetadata, paired: false },
  ])("bounds $label by registered action identity", async ({ size, cap, name, metadata, paired }) => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));
    try {
      // Identical Profile-like text cannot confer the exception on another tool.
      const content = "resume.profile.read ai.braindrive.resume-builder\n".padEnd(size, "p");
      const tool = { ...createTool(name), auditMetadata: metadata };
      const prepared = await prepareContextWindow({
        memoryRoot, conversationId: "conv-profile", correlationId: "corr-profile",
        tools: [tool],
        messages: [
          { role: "system", content: "Host instructions." },
          { role: "assistant", content: "", tool_calls: [{ id: "profile-read", name, input: {} }] },
          { role: "tool", tool_call_id: paired ? "profile-read" : "other-read", content },
        ],
        settings: { contextWindowTokens: 128_000, responseHeadroomTokens: 8_000 },
      });
      const result = prepared.messages[2];
      expect(result.content.length).toBe(Math.min(size, cap));
      if (size <= cap) {
        expect(result.content).toBe(content);
      } else {
        const marker = `\n...[truncated ${size - cap} chars for context budget]...\n`;
        const head = Math.ceil((cap - marker.length) * 0.65);
        const tail = cap - marker.length - head;
        expect(result.content).toBe(content.slice(0, head) + marker + content.slice(-tail));
      }
      expect(prepared.usage.droppedUnits).toBe(0);
      expect(prepared.warning).toBeNull();
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("sends 50k-character system instructions intact to the provider within budget", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));
    try {
      const messages: GatewayMessage[] = [
        { role: "system", content: "a".repeat(25_000) + "Active app instructions" + "b".repeat(25_000) },
        { role: "user", content: "Continue with the active app." },
        { role: "assistant", content: "Ready." },
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
      expect(prepared.usage.estimatedPromptTokensBefore).toBeGreaterThan(50_000);
      expect(prepared.usage.estimatedPromptTokensBefore).toBeLessThanOrEqual(120_000);
      expect(prepared.usage.estimatedPromptTokensAfter).toBe(prepared.usage.estimatedPromptTokensBefore);
      expect(prepared.warning).toBeNull();
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("retains the base user, assistant, and tool caps even with large system instructions", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));
    try {
      const messages: GatewayMessage[] = [
        { role: "system", content: "s".repeat(50_000) },
        { role: "user", content: "1".repeat(399_000) },
        { role: "assistant", content: "a".repeat(15_000), tool_calls: [{ id: "read-1", name: "memory_read", input: {} }] },
        { role: "tool", tool_call_id: "read-1", content: "文".repeat(450_000) },
      ];
      const prepared = await prepareContextWindow({
        memoryRoot, conversationId: "conv-caps", correlationId: "corr-caps", messages, tools: [],
        settings: { contextWindowTokens: 128_000, responseHeadroomTokens: 8_000 },
      });
      expect(prepared.messages.map((message) => message.content.length)).toEqual([50_000, 8_000, 12_000, 4_000]);
      for (let index = 1; index < messages.length; index += 1) {
        const cap = [0, 8_000, 12_000, 4_000][index];
        const marker = `\n...[truncated ${messages[index].content.length - cap} chars for context budget]...\n`;
        const head = Math.ceil((cap - marker.length) * 0.65);
        const tail = cap - marker.length - head;
        expect(prepared.messages[index]).toEqual({ ...messages[index], content:
          messages[index].content.slice(0, head) + marker + messages[index].content.slice(-tail) });
      }
      expect(prepared.usage.droppedUnits).toBe(0);
      expect(prepared.warning).toBeNull();
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("uses the base newest-first selection and backfilling order with bounded tool blocks", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));
    try {
      const prepared = await prepareContextWindow({
        memoryRoot, conversationId: "conv-order", correlationId: "corr-order", tools: [],
        messages: [
          { role: "system", content: "Host instructions." },
          { role: "user", content: "Older small question." },
          { role: "assistant", content: "Older small answer." },
          { role: "user", content: "u".repeat(8_000) },
          { role: "assistant", content: "", tool_calls: [{ id: "read-1", name: "memory_read", input: {} }] },
          { role: "tool", tool_call_id: "read-1", content: "p".repeat(450_000) },
          { role: "user", content: "Latest question." },
        ],
        settings: { contextWindowTokens: 3_000, responseHeadroomTokens: 500 },
      });
      // Base skips the expensive user unit, then backfills the older small units.
      expect(prepared.messages.map((message) => message.role)).toEqual([
        "system", "system", "user", "assistant", "assistant", "tool", "user",
      ]);
      expect(prepared.messages.slice(2, 4).map((message) => message.content)).toEqual([
        "Older small question.", "Older small answer.",
      ]);
      expect(prepared.messages[5].content.length).toBe(4_000);
      expect(prepared.messages.at(-1)?.content).toBe("Latest question.");
      expect(prepared.usage.droppedUnits).toBe(1);
      expect(prepared.usage.droppedMessages).toBe(1);
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("keeps explicitly identified host and app instruction layers whole within budget", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));
    try {
      const instructions: GatewayMessage[] = [
        { role: "system", content: "s".repeat(25_000) },
        { role: "system", content: "a".repeat(25_000) },
      ];
      const prepared = await prepareContextWindow({
        memoryRoot, conversationId: "conv-layers", correlationId: "corr-layers",
        messages: [...instructions, { role: "user", content: "Latest question." }],
        systemInstructionCount: 2, tools: [],
        settings: { contextWindowTokens: 128_000, responseHeadroomTokens: 8_000 },
      });
      expect(prepared.messages.slice(0, 2)).toEqual(instructions);
      expect(prepared.warning).toBeNull();
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it.each(["qz ".repeat(80_000), "1".repeat(399_000), "文é🙂".repeat(40_000)])(
    "bounds ASCII, numeric, and multilingual instructions by UTF-8 bytes and warns on safe fallback %#",
    async (content) => {
      const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));
      try {
        const prepared = await prepareContextWindow({
          memoryRoot, conversationId: "conv-oversized", correlationId: "corr-oversized",
          messages: [{ role: "system", content }, { role: "user", content: "Continue." }], tools: [],
          settings: { contextWindowTokens: 128_000, responseHeadroomTokens: 8_000 },
        });
        expect(prepared.usage.estimatedPromptTokensBefore).toBeGreaterThanOrEqual(Buffer.byteLength(content, "utf8"));
        expect(prepared.usage.estimatedPromptTokensBefore).toBeGreaterThan(120_000);
        expect(prepared.messages[0].content.length).toBe(24_000);
        expect(prepared.messages[0].content).toContain("[truncated");
        expect(prepared.usage.estimatedPromptTokensAfter).toBeLessThanOrEqual(120_000);
        expect(prepared.warning?.managed).toBe(true);
        expect(prepared.warning?.message).toContain("System instructions");
        expect(prepared.warning?.message).toContain("shortened");
      } finally {
        await rm(memoryRoot, { recursive: true, force: true });
      }
    }
  );

  it("uses the base aggressive fallback when system instructions alone exceed a small budget", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));
    try {
      const prepared = await prepareContextWindow({
        memoryRoot, conversationId: "conv-small", correlationId: "corr-small", tools: [],
        messages: [{ role: "system", content: "s".repeat(50_000) }, { role: "user", content: "Continue." }],
        settings: { contextWindowTokens: 4_096, responseHeadroomTokens: 512 },
      });
      expect(prepared.messages[0].content.length).toBe(2_400);
      expect(prepared.usage.estimatedPromptTokensAfter).toBeLessThanOrEqual(3_584);
      expect(prepared.warning?.message).toContain("System instructions");
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("does not protect a generated summary from base last-resort shortening", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));
    try {
      const prepared = await prepareContextWindow({
        memoryRoot, conversationId: "conv-summary", correlationId: "corr-summary", tools: [],
        messages: [
          { role: "system", content: "s".repeat(3_000) },
          { role: "assistant", content: "", tool_calls: [{ id: "old-call", name: "tool".repeat(1_500), input: {} }] },
          { role: "tool", tool_call_id: "old-call", content: "Old tool result." },
          { role: "user", content: "Latest question." },
        ],
        settings: { contextWindowTokens: 4_096, responseHeadroomTokens: 512 },
      });
      const summary = prepared.messages[1];
      expect(summary.role).toBe("system");
      expect(summary.content).toContain("Earlier conversation summary");
      expect(summary.content.length).toBe(2_000);
      expect(summary.content).toContain("[truncated");
      expect(prepared.messages.at(-1)?.content).toBe("Latest question.");
      expect(prepared.usage.estimatedPromptTokensAfter).toBeLessThanOrEqual(3_584);
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("treats replayed system summaries as ordinary context rather than instruction layers", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-context-window-"));
    try {
      const summary = { role: "system", content: "Earlier conversation summary: " + "x".repeat(50_000) } as const;
      const prepared = await prepareContextWindow({
        memoryRoot, conversationId: "conv-replay-summary", correlationId: "corr-replay-summary", tools: [],
        messages: [{ role: "system", content: "Host instructions." }, summary, { role: "user", content: "Latest question." }],
        settings: { contextWindowTokens: 4_096, responseHeadroomTokens: 512 },
      });
      expect(prepared.messages).not.toContainEqual(summary);
      expect(prepared.usage.droppedMessages).toBe(1);
      expect(prepared.messages.at(-1)?.content).toBe("Latest question.");
      expect(prepared.usage.estimatedPromptTokensAfter).toBeLessThanOrEqual(3_584);
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
