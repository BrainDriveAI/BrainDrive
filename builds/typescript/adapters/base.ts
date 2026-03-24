import type { GatewayEngineRequest, ToolCallRequest, ToolDefinition } from "../contracts.js";

export type ModelResponse = {
  assistantText: string;
  toolCalls: ToolCallRequest[];
  finishReason: string;
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
  complete(request: GatewayEngineRequest, tools: ToolDefinition[]): Promise<ModelResponse>;
  completeStream?(
    request: GatewayEngineRequest,
    tools: ToolDefinition[]
  ): AsyncIterable<ModelStreamChunk>;
  listModels?(): Promise<ProviderModel[]>;
}
