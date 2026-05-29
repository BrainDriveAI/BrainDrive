import type { GatewayEngineRequest, ToolCallRequest, ToolDefinition } from "../contracts.js";
import type { ModelCallAuditContext, PromptAuditRecorder } from "../memory/prompt-audit-store.js";

export type TokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedPromptTokens?: number;
  reasoningTokens?: number;
};

export type CostMetadata = {
  amount?: number;
  currency?: string;
  pricingSource?: string;
  pricingTimestamp?: string;
  status: "provider_reported" | "computed" | "unavailable" | "estimated";
};

export type ModelResponse = {
  assistantText: string;
  toolCalls: ToolCallRequest[];
  finishReason: string;
  usage?: TokenUsage;
  cost?: CostMetadata;
};

export type ModelAdapterCallOptions = {
  promptAudit?: {
    recorder: PromptAuditRecorder;
    modelCall: ModelCallAuditContext;
  };
};

export type ModelStreamChunk =
  | {
      type: "text-delta";
      delta: string;
    }
  | {
      type: "final";
      response: ModelResponse;
    };

export type ProviderModel = {
  id: string;
  name?: string;
  provider?: string;
  description?: string;
  context_length?: number;
  is_free?: boolean;
  tags?: string[];
};

export interface ModelAdapter {
  complete(
    request: GatewayEngineRequest,
    tools: ToolDefinition[],
    options?: ModelAdapterCallOptions
  ): Promise<ModelResponse>;
  completeStream?(
    request: GatewayEngineRequest,
    tools: ToolDefinition[],
    options?: ModelAdapterCallOptions
  ): AsyncIterable<ModelStreamChunk>;
  listModels?(): Promise<ProviderModel[]>;
}
