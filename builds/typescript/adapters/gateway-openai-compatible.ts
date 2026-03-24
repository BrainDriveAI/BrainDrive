import { z } from "zod";

import type { GatewayEngineRequestInput, GatewayAdapter, GatewayMessageNormalizationResult } from "./gateway-base.js";
import type { StreamEvent } from "../contracts.js";

const messageRequestSchema = z.object({
  content: z.string().min(1),
  metadata: z
    .object({
      client: z.string().min(1),
      project: z.string().min(1).optional(),
    })
    .strict()
    .optional(),
});

export class OpenAICompatibleGatewayAdapter implements GatewayAdapter {
  normalizeMessageRequest(payload: unknown, headerConversationId: unknown): GatewayMessageNormalizationResult {
    const parsedBody = messageRequestSchema.safeParse(payload);
    if (!parsedBody.success) {
      return {
        ok: false,
        failure: {
          reason: "invalid_request",
          issueCount: parsedBody.error.issues.length,
        },
      };
    }

    const requestedConversationId = parseConversationIdHeader(headerConversationId);
    return {
      ok: true,
      request: {
        content: parsedBody.data.content,
        ...(parsedBody.data.metadata ? { metadata: parsedBody.data.metadata } : {}),
        ...(requestedConversationId ? { requestedConversationId } : {}),
      },
    };
  }

  buildEngineRequest(input: GatewayEngineRequestInput) {
    return {
      messages: input.messages,
      metadata: {
        correlation_id: input.correlationId,
        conversation_id: input.conversationId,
        ...(input.clientMetadata ? { client_context: input.clientMetadata } : {}),
      },
    };
  }

  toClientStreamEvent(event: StreamEvent, context: { conversationId: string; messageId: string }): StreamEvent {
    if (event.type !== "done") {
      return event;
    }

    return {
      ...event,
      conversation_id: context.conversationId,
      message_id: context.messageId,
    };
  }
}

function parseConversationIdHeader(headerConversationId: unknown): string | undefined {
  if (Array.isArray(headerConversationId)) {
    return typeof headerConversationId[0] === "string" ? headerConversationId[0] : undefined;
  }

  if (typeof headerConversationId === "string") {
    return headerConversationId;
  }

  return undefined;
}
