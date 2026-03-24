import type { ClientMessageRequest, ConversationDetail, ConversationMessage, GatewayMessage } from "../contracts.js";
import { auditLog } from "../logger.js";
import type { ConversationRepository } from "../memory/conversation-repository.js";

type StoredToolCall = {
  name: string;
  input: Record<string, unknown>;
};

export class GatewayConversationService {
  constructor(private readonly store: ConversationRepository) {}

  hasConversation(conversationId: string): boolean {
    return this.store.getConversation(conversationId) !== null;
  }

  persistUserMessage(conversationId: string | undefined, request: ClientMessageRequest): { conversationId: string; message: ConversationMessage } {
    const message: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: request.content,
      timestamp: new Date().toISOString(),
    };

    if (!conversationId) {
      const createdId = crypto.randomUUID();
      this.store.createConversation(createdId, message);
      auditLog("memory.write", {
        action: "conversation.create",
        conversation_id: createdId,
        message_id: message.id,
      });
      return { conversationId: createdId, message };
    }

    if (!this.hasConversation(conversationId)) {
      throw new Error("Conversation not found");
    }

    this.store.appendMessage(conversationId, message);
    auditLog("memory.write", {
      action: "conversation.append.user",
      conversation_id: conversationId,
      message_id: message.id,
    });
    return { conversationId, message };
  }

  appendAssistantMessage(conversationId: string, messageId: string, content: string): void {
    const message: ConversationMessage = {
      id: messageId,
      role: "assistant",
      content,
      timestamp: new Date().toISOString(),
    };
    this.store.appendMessage(conversationId, message);
    auditLog("memory.write", {
      action: "conversation.append.assistant",
      conversation_id: conversationId,
      message_id: messageId,
    });
  }

  appendToolMessage(
    conversationId: string,
    messageId: string,
    content: string,
    toolCall?: StoredToolCall
  ): void {
    const message: ConversationMessage = {
      id: messageId,
      role: "tool",
      content: serializeToolMessage(content, toolCall),
      timestamp: new Date().toISOString(),
    };
    this.store.appendMessage(conversationId, message);
    auditLog("memory.write", {
      action: "conversation.append.tool",
      conversation_id: conversationId,
      message_id: messageId,
    });
  }

  buildConversationMessages(conversationId: string, systemPrompt: string): GatewayMessage[] {
    const detail = this.store.getConversation(conversationId);
    const messages = detail?.messages ?? [];
    const replayMessages: GatewayMessage[] = [];

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];

      if (message.role === "assistant") {
        const toolCalls = collectFollowingToolCalls(messages, index + 1);
        replayMessages.push({
          role: "assistant",
          content: message.content,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
        continue;
      }

      if (message.role === "tool") {
        const blockEnd = findToolBlockEnd(messages, index);
        const hasPriorAssistantToolCalls =
          replayMessages.length > 0 &&
          replayMessages[replayMessages.length - 1]?.role === "assistant" &&
          Boolean(replayMessages[replayMessages.length - 1]?.tool_calls?.length);

        if (!hasPriorAssistantToolCalls) {
          const inferredToolCalls = collectToolCallsFromBlock(messages, index, blockEnd);
          if (inferredToolCalls.length === 0) {
            // Legacy transcripts may not include enough metadata to replay this block safely.
            index = blockEnd - 1;
            continue;
          }

          replayMessages.push({
            role: "assistant",
            content: "",
            tool_calls: inferredToolCalls,
          });
        }

        for (let toolIndex = index; toolIndex < blockEnd; toolIndex += 1) {
          const toolMessage = messages[toolIndex];
          replayMessages.push({
            role: "tool",
            content: extractToolOutputPayload(toolMessage.content),
            tool_call_id: toolMessage.id,
          });
        }

        index = blockEnd - 1;
        continue;
      }

      replayMessages.push({
        role: message.role,
        content: message.content,
      });
    }

    return [
      { role: "system", content: systemPrompt },
      ...replayMessages,
    ];
  }

  list(limit = 50, offset = 0) {
    return this.store.listConversations(limit, offset);
  }

  detail(conversationId: string): ConversationDetail | null {
    return this.store.getConversation(conversationId);
  }

  getConversationSkills(conversationId: string): string[] | null {
    return this.store.getConversationSkills(conversationId);
  }

  setConversationSkills(conversationId: string, skillIds: string[]): boolean {
    return this.store.setConversationSkills(conversationId, skillIds);
  }
}

function collectFollowingToolCalls(messages: ConversationMessage[], startIndex: number): Array<{
  id: string;
  name: string;
  input: Record<string, unknown>;
}> {
  const calls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

  for (let index = startIndex; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "tool") {
      break;
    }

    const storedCall = parseStoredToolCall(message.content);
    if (!storedCall) {
      continue;
    }

    calls.push({
      id: message.id,
      name: storedCall.name,
      input: storedCall.input,
    });
  }

  return calls;
}

function findToolBlockEnd(messages: ConversationMessage[], startIndex: number): number {
  let index = startIndex;
  while (index < messages.length && messages[index]?.role === "tool") {
    index += 1;
  }
  return index;
}

function collectToolCallsFromBlock(
  messages: ConversationMessage[],
  startIndex: number,
  endIndex: number
): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  const calls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

  for (let index = startIndex; index < endIndex; index += 1) {
    const message = messages[index];
    const storedCall = parseStoredToolCall(message?.content ?? "");
    if (!storedCall) {
      continue;
    }

    calls.push({
      id: message.id,
      name: storedCall.name,
      input: storedCall.input,
    });
  }

  return calls;
}

function serializeToolMessage(content: string, toolCall?: StoredToolCall): string {
  if (!toolCall) {
    return content;
  }

  const parsed = tryParseJson(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return content;
  }

  return JSON.stringify({
    ...(parsed as Record<string, unknown>),
    call: {
      name: toolCall.name,
      input: toolCall.input,
    },
  });
}

function extractToolOutputPayload(content: string): string {
  const parsed = tryParseJson(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return content;
  }

  const payload = parsed as Record<string, unknown>;
  if (!("status" in payload) || !("output" in payload)) {
    return content;
  }

  return JSON.stringify({
    status: payload.status,
    output: payload.output,
  });
}

function parseStoredToolCall(content: string): StoredToolCall | null {
  const parsed = tryParseJson(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const call = (parsed as Record<string, unknown>).call;
  if (!call || typeof call !== "object" || Array.isArray(call)) {
    return null;
  }

  const name = (call as Record<string, unknown>).name;
  const input = (call as Record<string, unknown>).input;

  if (typeof name !== "string") {
    return null;
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      name,
      input: {},
    };
  }

  return {
    name,
    input: input as Record<string, unknown>,
  };
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
