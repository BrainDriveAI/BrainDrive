import type { AdapterConfig, GatewayEngineRequest, ToolDefinition } from "../contracts.js";
import type { AdapterRuntimeSecrets } from "./index.js";
import type { ModelAdapter, ModelResponse, ModelStreamChunk, ProviderModel } from "./base.js";

type OpenAIMessage = {
  role: string;
  content?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  name?: string;
};

type OpenAICompletionResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | Array<{ type: string; text?: string }> | null;
      tool_calls?: Array<{
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  error?: {
    message?: string;
    code?: string | number;
    metadata?: {
      provider_name?: string;
      raw?: string;
    };
  };
};

type OpenAIModelsResponse = {
  data?: unknown[];
  error?: {
    message?: string;
    code?: string | number;
    metadata?: {
      provider_name?: string;
      raw?: string;
    };
  };
};

type OpenAIStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type: string; text?: string }>;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
    code?: string | number;
    metadata?: {
      provider_name?: string;
      raw?: string;
    };
  };
};

type OpenAIMessageContent =
  | string
  | Array<{ type: string; text?: string }>
  | null
  | undefined;

type ProviderErrorPayload = {
  error?: {
    message?: string;
    code?: string | number;
    metadata?: {
      provider_name?: string;
      raw?: string;
    };
  };
};

export class OpenAICompatibleAdapter implements ModelAdapter {
  constructor(
    private readonly config: AdapterConfig,
    private readonly runtimeSecrets?: AdapterRuntimeSecrets
  ) {}

  async listModels(): Promise<ProviderModel[]> {
    const apiKey = this.runtimeSecrets?.apiKey ?? process.env[this.config.api_key_env] ?? "";
    const response = await fetch(`${this.config.base_url}/models`, {
      method: "GET",
      headers: {
        ...(apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {}),
      },
    });

    const payload = await parseProviderModelsPayload(response);
    if (!response.ok) {
      throw new Error(formatProviderFailure(response.status, payload));
    }

    const models = (payload.data ?? [])
      .map((entry) => normalizeProviderModel(entry))
      .filter((entry): entry is ProviderModel => entry !== null)
      .sort((left, right) => left.id.localeCompare(right.id));

    return models;
  }

  async complete(request: GatewayEngineRequest, tools: ToolDefinition[]): Promise<ModelResponse> {
    const apiKey = this.runtimeSecrets?.apiKey ?? process.env[this.config.api_key_env] ?? "";
    const response = await fetch(`${this.config.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.config.model,
        stream: false,
        messages: request.messages.map<OpenAIMessage>((message) => ({
          role: message.role,
          content: message.content,
          ...(message.role === "tool" && message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
          ...(message.role === "assistant" && message.tool_calls
            ? {
                tool_calls: message.tool_calls.map((toolCall) => ({
                  id: toolCall.id,
                  type: "function",
                  function: {
                    name: toolCall.name,
                    arguments: JSON.stringify(toolCall.input),
                  },
                })),
              }
            : {}),
        })),
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
        tool_choice: tools.length > 0 ? "auto" : undefined,
      }),
    });

    const payload = await parseProviderPayload(response);
    if (!response.ok) {
      throw new Error(formatProviderFailure(response.status, payload));
    }

    const choice = payload.choices?.[0];
    if (!choice?.message) {
      return {
        assistantText: "",
        toolCalls: [],
        finishReason: choice?.finish_reason ?? "completed",
      };
    }

    const assistantText = normalizeAssistantText(choice.message.content);
    const toolCalls = (choice.message.tool_calls ?? []).map((call) => ({
      id: call.id ?? crypto.randomUUID(),
      name: call.function?.name ?? "unknown_tool",
      input: parseToolArguments(call.function?.arguments),
    }));

    return {
      assistantText,
      toolCalls,
      finishReason: choice.finish_reason ?? (toolCalls.length > 0 ? "tool_calls" : "completed"),
    };
  }

  async *completeStream(
    request: GatewayEngineRequest,
    tools: ToolDefinition[]
  ): AsyncIterable<ModelStreamChunk> {
    const apiKey = this.runtimeSecrets?.apiKey ?? process.env[this.config.api_key_env] ?? "";
    const response = await fetch(`${this.config.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.config.model,
        stream: true,
        messages: request.messages.map<OpenAIMessage>((message) => ({
          role: message.role,
          content: message.content,
          ...(message.role === "tool" && message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
          ...(message.role === "assistant" && message.tool_calls
            ? {
                tool_calls: message.tool_calls.map((toolCall) => ({
                  id: toolCall.id,
                  type: "function",
                  function: {
                    name: toolCall.name,
                    arguments: JSON.stringify(toolCall.input),
                  },
                })),
              }
            : {}),
        })),
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
        tool_choice: tools.length > 0 ? "auto" : undefined,
      }),
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      const payload = await parseProviderPayload(response);
      throw new Error(formatProviderFailure(response.status, payload));
    }

    if (!contentType.includes("text/event-stream")) {
      const payload = await parseProviderPayload(response);
      const fallback = toModelResponse(payload);
      yield {
        type: "final",
        response: fallback,
      };
      return;
    }

    let assistantText = "";
    let finishReason = "completed";
    const toolCallBuilders = new Map<number, { id: string; name: string; args: string }>();

    for await (const data of parseProviderSSE(response)) {
      if (data === "[DONE]") {
        break;
      }

      let chunk: OpenAIStreamChunk;
      try {
        chunk = JSON.parse(data) as OpenAIStreamChunk;
      } catch {
        continue;
      }

      if (chunk.error?.message) {
        throw new Error(formatProviderFailure(502, { error: chunk.error }));
      }

      for (const choice of chunk.choices ?? []) {
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        const delta = choice.delta;
        if (!delta) {
          continue;
        }

        const textDelta = normalizeAssistantText(delta.content);
        if (textDelta.length > 0) {
          assistantText += textDelta;
          yield {
            type: "text-delta",
            delta: textDelta,
          };
        }

        for (const toolCallDelta of delta.tool_calls ?? []) {
          const index = typeof toolCallDelta.index === "number" ? toolCallDelta.index : 0;
          const current = toolCallBuilders.get(index) ?? {
            id: toolCallDelta.id ?? crypto.randomUUID(),
            name: "",
            args: "",
          };

          if (toolCallDelta.id) {
            current.id = toolCallDelta.id;
          }
          if (toolCallDelta.function?.name) {
            current.name = toolCallDelta.function.name;
          }
          if (toolCallDelta.function?.arguments) {
            current.args += toolCallDelta.function.arguments;
          }

          toolCallBuilders.set(index, current);
        }
      }
    }

    yield {
      type: "final",
      response: {
        assistantText,
        toolCalls: [...toolCallBuilders.entries()]
          .sort((left, right) => left[0] - right[0])
          .map(([, toolCall]) => ({
            id: toolCall.id,
            name: toolCall.name.length > 0 ? toolCall.name : "unknown_tool",
            input: parseToolArguments(toolCall.args),
          })),
        finishReason,
      },
    };
  }
}

async function parseProviderPayload(response: Response): Promise<OpenAICompletionResponse> {
  const rawBody = await response.text();
  if (rawBody.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(rawBody) as OpenAICompletionResponse;
  } catch {
    return {
      error: {
        message: rawBody,
      },
    };
  }
}

async function parseProviderModelsPayload(response: Response): Promise<OpenAIModelsResponse> {
  const rawBody = await response.text();
  if (rawBody.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(rawBody) as OpenAIModelsResponse;
  } catch {
    return {
      error: {
        message: rawBody,
      },
    };
  }
}

function formatProviderFailure(status: number, payload: ProviderErrorPayload): string {
  const message = payload.error?.message ?? `Provider request failed (status ${status})`;
  const segments = [message];

  if (payload.error?.code !== undefined) {
    segments.push(`code=${String(payload.error.code)}`);
  }

  if (payload.error?.metadata?.provider_name) {
    segments.push(`provider=${payload.error.metadata.provider_name}`);
  }

  if (payload.error?.metadata?.raw) {
    segments.push(`raw=${truncate(payload.error.metadata.raw, 320)}`);
  }

  return segments.join(" | ");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function normalizeAssistantText(content: OpenAIMessageContent): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
  }

  return "";
}

function parseToolArguments(argumentsPayload?: string): Record<string, unknown> {
  if (!argumentsPayload) {
    return {};
  }

  try {
    const parsed = JSON.parse(argumentsPayload);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function normalizeProviderModel(entry: unknown): ProviderModel | null {
  if (!isRecord(entry)) {
    return null;
  }

  const id = asString(entry.id);
  if (!id) {
    return null;
  }

  const name = asString(entry.name);
  const ownedBy = asString(entry.owned_by);
  const providerFromId = id.includes("/") ? id.split("/")[0] : undefined;
  const provider = ownedBy ?? providerFromId;
  const description = asString(entry.description);
  const contextLength = resolveContextLength(entry);
  const isFree = resolveIsFreeModel(id, entry);
  const tags = Array.from(
    new Set([
      ...extractStringTags(entry.tags),
      ...(isFree ? ["free"] : []),
    ])
  );

  return {
    id,
    ...(name ? { name } : {}),
    ...(provider ? { provider } : {}),
    ...(description ? { description } : {}),
    ...(typeof contextLength === "number" ? { context_length: contextLength } : {}),
    ...(isFree ? { is_free: true } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function resolveContextLength(entry: Record<string, unknown>): number | undefined {
  const direct = asNumber(entry.context_length);
  if (direct !== undefined) {
    return direct;
  }

  const topProvider = entry.top_provider;
  if (isRecord(topProvider)) {
    return asNumber(topProvider.context_length);
  }

  return undefined;
}

function resolveIsFreeModel(id: string, entry: Record<string, unknown>): boolean {
  const lowerId = id.toLowerCase();
  if (lowerId.includes(":free") || lowerId.includes("/free")) {
    return true;
  }

  if (typeof entry.is_free === "boolean") {
    return entry.is_free;
  }

  const pricing = entry.pricing;
  if (!isRecord(pricing)) {
    return false;
  }

  const numericValues = Object.values(pricing)
    .map((value) => asNumber(value))
    .filter((value): value is number => value !== undefined);

  if (numericValues.length === 0) {
    return false;
  }

  return numericValues.every((value) => value <= 0);
}

function extractStringTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toModelResponse(payload: OpenAICompletionResponse): ModelResponse {
  const choice = payload.choices?.[0];
  if (!choice?.message) {
    return {
      assistantText: "",
      toolCalls: [],
      finishReason: choice?.finish_reason ?? "completed",
    };
  }

  const assistantText = normalizeAssistantText(choice.message.content);
  const toolCalls = (choice.message.tool_calls ?? []).map((call) => ({
    id: call.id ?? crypto.randomUUID(),
    name: call.function?.name ?? "unknown_tool",
    input: parseToolArguments(call.function?.arguments),
  }));

  return {
    assistantText,
    toolCalls,
    finishReason: choice.finish_reason ?? (toolCalls.length > 0 ? "tool_calls" : "completed"),
  };
}

async function* parseProviderSSE(response: Response): AsyncIterable<string> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      while (true) {
        const boundary = findSSEFrameBoundary(buffer);
        if (!boundary) {
          break;
        }

        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const payload = extractSSEDataPayload(frame);
        if (payload !== null) {
          yield payload;
        }
      }

      if (done) {
        break;
      }
    }

    const trailing = extractSSEDataPayload(buffer);
    if (trailing !== null) {
      yield trailing;
    }
  } finally {
    reader.releaseLock();
  }
}

function findSSEFrameBoundary(buffer: string): { index: number; length: number } | null {
  const candidates = [
    { index: buffer.indexOf("\r\n\r\n"), length: 4 },
    { index: buffer.indexOf("\n\n"), length: 2 },
    { index: buffer.indexOf("\r\r"), length: 2 },
  ].filter((candidate) => candidate.index >= 0);

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((earliest, candidate) =>
    candidate.index < earliest.index ? candidate : earliest
  );
}

function extractSSEDataPayload(frame: string): string | null {
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n|\r/g)) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }

    if (!line.startsWith("data:")) {
      continue;
    }

    let value = line.slice("data:".length);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    dataLines.push(value);
  }

  if (dataLines.length === 0) {
    return null;
  }

  return dataLines.join("\n");
}
