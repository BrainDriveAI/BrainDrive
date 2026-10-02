import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ConversationDetail, ConversationMessage, ConversationRecord } from "../contracts.js";
import type { ConversationListResult, ConversationRepository } from "../memory/conversation-repository.js";
import type { AuthContext, ToolDefinition } from "../contracts.js";
import type { ModelAdapter } from "../adapters/base.js";
import { ApprovalStore } from "../engine/approval-store.js";
import { runAgentLoop } from "../engine/loop.js";
import { ToolExecutor } from "../engine/tool-executor.js";
import { MarkdownConversationStore } from "../memory/conversation-store-markdown.js";
import { prepareContextWindow } from "./context-window.js";
import { GatewayConversationService } from "./conversations.js";

class MemoryConversationRepository implements ConversationRepository {
  private readonly records = new Map<string, ConversationDetail & { active_skill_ids: string[] }>();

  createConversation(id: string, initialMessage: ConversationMessage): string {
    this.records.set(id, {
      id,
      title: initialMessage.content,
      created_at: initialMessage.timestamp,
      updated_at: initialMessage.timestamp,
      messages: [initialMessage],
      active_skill_ids: [],
    });
    return id;
  }

  appendMessage(conversationId: string, message: ConversationMessage): void {
    const current = this.records.get(conversationId);
    if (!current) throw new Error("Conversation not found");
    current.messages.push(message);
    current.updated_at = message.timestamp;
  }

  listConversations(limit = 50, offset = 0): ConversationListResult {
    const conversations: ConversationRecord[] = [...this.records.values()].map((record) => ({
      id: record.id,
      title: record.title,
      created_at: record.created_at,
      updated_at: record.updated_at,
      message_count: record.messages.length,
    }));
    return { conversations: conversations.slice(offset, offset + limit), total: conversations.length, limit, offset };
  }

  getConversation(conversationId: string): ConversationDetail | null {
    const current = this.records.get(conversationId);
    if (!current) return null;
    return {
      id: current.id,
      title: current.title,
      created_at: current.created_at,
      updated_at: current.updated_at,
      messages: [...current.messages],
    };
  }

  deleteConversation(conversationId: string): boolean {
    return this.records.delete(conversationId);
  }

  removeAssistantMessagesAfterUser(conversationId: string, userMessageId: string): boolean {
    const current = this.records.get(conversationId);
    if (!current) return false;

    const userIndex = current.messages.findIndex(
      (message) => message.id === userMessageId && message.role === "user",
    );
    if (userIndex < 0) return false;

    const messages = current.messages.filter(
      (message, index) => !(index > userIndex && message.role === "assistant"),
    );
    if (messages.length === current.messages.length) return false;

    current.messages = messages;
    current.updated_at = new Date().toISOString();
    return true;
  }

  getConversationSkills(conversationId: string): string[] | null {
    const current = this.records.get(conversationId);
    return current ? [...current.active_skill_ids] : null;
  }

  setConversationSkills(conversationId: string, skillIds: string[]): boolean {
    const current = this.records.get(conversationId);
    if (!current) return false;
    current.active_skill_ids = [...skillIds];
    return true;
  }
}

describe("GatewayConversationService host messages", () => {
  it.each(["app_action_resume_profile_read", "resume_profile_read"])(
    "binds replayed %s results to execution provenance across persistence",
    async (name) => {
      const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-provenance-"));
      try {
        const provenance = {
          source: "installed_app_action",
          app_id: "ai.braindrive.resume-builder",
          action_id: "resume.profile.read",
        };
        const auth: AuthContext = {
          actorId: "owner", actorType: "owner", mode: "local-owner",
          permissions: { memory_access: true, tool_access: true, system_actions: true,
            delegation: true, approval_authority: true, administration: true },
        };
        const genuine: ToolDefinition = {
          name, description: "Profile read", readOnly: true, requiresApproval: false,
          inputSchema: { type: "object" }, auditMetadata: provenance,
          execute: async () => ({ content: "p".repeat(30_000) }),
        };
        // Neither model input nor unrelated tool output can set provenance.
        const spoof: ToolDefinition = {
          ...genuine, auditMetadata: undefined,
          execute: async () => ({ provenance, content: "p".repeat(11_000) }),
        };
        const conversations = new GatewayConversationService(new MarkdownConversationStore(memoryRoot));
        const { conversationId } = conversations.persistUserMessage(undefined, { content: "Read." });
        for (const [index, tool] of [spoof, genuine].entries()) {
          const id = `read-${index}`;
          const input = { provenance };
          let turn = 0;
          const adapter: ModelAdapter = {
            complete: async () => turn++ === 0
              ? { assistantText: "", finishReason: "tool_calls", toolCalls: [{ id, name, input }] }
              : { assistantText: "Done.", finishReason: "stop", toolCalls: [] },
          };
          for await (const event of runAgentLoop(adapter, new ToolExecutor([tool]), new ApprovalStore(), {
            messages: [{ role: "user", content: "Read." }],
            metadata: { correlation_id: id, conversation_id: conversationId },
          }, auth, { memoryRoot })) {
            if (event.type !== "tool-result") continue;
            expect(event.provenance).toEqual(index === 0 ? undefined : provenance);
            conversations.appendToolMessage(conversationId, event.id,
              JSON.stringify({ status: event.status, output: event.output }),
              { name, input }, event.provenance);
          }
          conversations.persistUserMessage(conversationId, { content: "Continue." });
        }
        // Reload from disk, with a genuine current definition bearing the same
        // name as both historical calls. Also prove registry removal is irrelevant.
        const replay = new GatewayConversationService(new MarkdownConversationStore(memoryRoot))
          .buildConversationMessages(conversationId, "Host instructions.");
        expect(replay.filter((message) => message.role === "tool").map((message) => message.provenance))
          .toEqual([undefined, provenance]);
        for (const tools of [[genuine], []]) {
          const prepared = await prepareContextWindow({ memoryRoot, conversationId, correlationId: "replay", messages: replay, tools });
          expect(prepared.messages.filter((message) => message.role === "tool").map((message) => message.content.length))
            .toEqual([4_000, 24_000]);
        }
      } finally {
        await rm(memoryRoot, { recursive: true, force: true });
      }
    },
  );

  it("creates a durable host-message conversation when no chat turn exists yet", () => {
    const conversations = new GatewayConversationService(new MemoryConversationRepository());
    const { conversationId, message } = conversations.createHostConversation("Owner pressed Create resume. Your Resume revision 2 created.");

    expect(conversations.detail(conversationId)?.messages).toEqual([message]);
    expect(conversations.buildConversationMessages(conversationId, "system prompt")).toEqual([
      { role: "system", content: "system prompt" },
      { role: "assistant", content: "BrainDrive host update: Owner pressed Create resume. Your Resume revision 2 created." },
    ]);
  });

  it("replays durable host messages into the next model turn", () => {
    const conversations = new GatewayConversationService(new MemoryConversationRepository());
    const { conversationId } = conversations.persistUserMessage(undefined, {
      content: "Please build my resume.",
    });

    conversations.appendHostMessage(conversationId, "Owner pressed Export PDF. Downloaded resume.pdf through the browser.");

    expect(conversations.detail(conversationId)?.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "BrainDrive host update: Owner pressed Export PDF. Downloaded resume.pdf through the browser.",
    });
    expect(conversations.buildConversationMessages(conversationId, "system prompt")).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "Please build my resume." },
      { role: "assistant", content: "BrainDrive host update: Owner pressed Export PDF. Downloaded resume.pdf through the browser." },
    ]);
  });

  it("can build a turn context without later waiting owner messages", () => {
    const repository = new MemoryConversationRepository();
    const conversations = new GatewayConversationService(repository);
    const first = conversations.persistUserMessage(undefined, { content: "First queued turn" });
    const second = conversations.persistUserMessage(first.conversationId, { content: "Second queued turn" });

    expect(conversations.buildConversationMessages(first.conversationId, "system prompt", first.message.id)).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "First queued turn" },
    ]);
    expect(conversations.buildConversationMessages(first.conversationId, "system prompt", second.message.id).at(-1)).toEqual({
      role: "user",
      content: "Second queued turn",
    });
  });

  it("serializes model turns per conversation while allowing other conversations through", async () => {
    const conversations = new GatewayConversationService(new MemoryConversationRepository());
    const releaseFirst = await conversations.acquireTurn("conversation-1");
    let secondAcquired = false;
    const second = conversations.acquireTurn("conversation-1").then((release) => {
      secondAcquired = true;
      return release;
    });

    await Promise.resolve();
    expect(secondAcquired).toBe(false);
    releaseFirst();
    const releaseSecond = await second;
    expect(secondAcquired).toBe(true);
    releaseSecond();
  });

  it("deletes conversations through the repository contract", () => {
    const repository = new MemoryConversationRepository();
    const conversations = new GatewayConversationService(repository);
    const { conversationId } = conversations.persistUserMessage(undefined, { content: "Delete this conversation" });

    expect(repository.deleteConversation(conversationId)).toBe(true);
    expect(repository.getConversation(conversationId)).toBeNull();
    expect(repository.deleteConversation(conversationId)).toBe(false);
  });

  it("removes assistant messages after the selected user message", () => {
    const repository = new MemoryConversationRepository();
    const conversations = new GatewayConversationService(repository);
    const first = conversations.persistUserMessage(undefined, { content: "First message" });
    repository.appendMessage(first.conversationId, {
      id: "assistant-1",
      role: "assistant",
      content: "First response",
      timestamp: "2026-09-28T12:00:01.000Z",
    });
    const second = conversations.persistUserMessage(first.conversationId, { content: "Retry this message" });
    repository.appendMessage(first.conversationId, {
      id: "assistant-2",
      role: "assistant",
      content: "Retry response",
      timestamp: "2026-09-28T12:00:03.000Z",
    });

    expect(repository.removeAssistantMessagesAfterUser(first.conversationId, second.message.id)).toBe(true);
    expect(repository.getConversation(first.conversationId)?.messages.map((message) => message.id)).toEqual([
      first.message.id,
      "assistant-1",
      second.message.id,
    ]);
    expect(repository.removeAssistantMessagesAfterUser(first.conversationId, second.message.id)).toBe(false);
    expect(repository.removeAssistantMessagesAfterUser(first.conversationId, "missing-user")).toBe(false);
  });
});
