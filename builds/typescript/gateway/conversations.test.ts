import { describe, expect, it } from "vitest";

import type { ConversationDetail, ConversationMessage, ConversationRecord } from "../contracts.js";
import type { ConversationListResult, ConversationRepository } from "../memory/conversation-repository.js";
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
});
