import type { GatewayEngineRequest, GatewayMessage, StreamEvent } from "../contracts.js";

export type NormalizedClientMessageRequest = {
  content: string;
  metadata?: Record<string, unknown>;
  requestedConversationId?: string;
};

export type GatewayValidationFailure = {
  reason: "invalid_request";
  issueCount: number;
};

export type GatewayMessageNormalizationResult =
  | {
      ok: true;
      request: NormalizedClientMessageRequest;
    }
  | {
      ok: false;
      failure: GatewayValidationFailure;
    };

export type GatewayEngineRequestInput = {
  conversationId: string;
  correlationId: string;
  messages: GatewayMessage[];
  clientMetadata?: Record<string, unknown>;
};

export interface GatewayAdapter {
  normalizeMessageRequest(payload: unknown, headerConversationId: unknown): GatewayMessageNormalizationResult;
  buildEngineRequest(input: GatewayEngineRequestInput): GatewayEngineRequest;
  toClientStreamEvent(event: StreamEvent, context: { conversationId: string; messageId: string }): StreamEvent;
}

