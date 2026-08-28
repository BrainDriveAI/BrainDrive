import { z } from "zod";

import type { GatewayEngineRequestInput, GatewayAdapter, GatewayMessageNormalizationResult } from "./gateway-base.js";
import type { StreamEvent } from "../contracts.js";

const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const appChatMetadataSchema = z
  .object({
    metadata_version: z.literal(1),
    app_id: z.string().min(3).max(128),
    installation_id: z.string().uuid(),
    package_digest: sha256DigestSchema,
    session_id: z.string().uuid(),
    view_id: z.string().uuid(),
    operation_id: z.string().uuid(),
    session_generation: z.number().int().positive(),
    presentation_id: z.string().min(3).max(128),
    workspace_id: z.string().min(3).max(128),
    context_grant_set_digest: sha256DigestSchema,
  })
  .strict();

const messageRequestSchema = z.object({
  content: z.string().min(1),
  metadata: z
    .object({
      client: z.string().min(1).optional(),
      project: z.string().min(1).optional(),
      app_chat: appChatMetadataSchema.optional(),
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
