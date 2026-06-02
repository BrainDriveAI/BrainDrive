import type { AdapterConfig, GatewayEngineRequest, ToolDefinition } from "../contracts.js";
import type { AdapterRuntimeSecrets } from "./index.js";
import type {
  CostMetadata,
  ModelAdapter,
  ModelAdapterCallOptions,
  ModelResponse,
  ModelStreamChunk,
  ProviderModel,
  TokenUsage
} from "./base.js";

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
  id?: string;
  model?: string;
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
  usage?: OpenAIUsage;
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
  id?: string;
  model?: string;
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
  usage?: OpenAIUsage;
};

type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
  cost?: number;
  total_cost?: number;
  currency?: string;
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

const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 180_000;
const DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS = 60_000;

type ProviderTimeoutState = {
  controller: AbortController;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  timedOut: "request_total" | "stream_idle" | null;
  timer: ReturnType<typeof setTimeout>;
};

type StreamReadResult = { done: boolean; value?: Uint8Array };

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

  async complete(
    request: GatewayEngineRequest,
    tools: ToolDefinition[],
    options?: ModelAdapterCallOptions
  ): Promise<ModelResponse> {
    const apiKey = this.runtimeSecrets?.apiKey ?? process.env[this.config.api_key_env] ?? "";
    const url = `${this.config.base_url}/chat/completions`;
    const headers = {
      "content-type": "application/json",
      ...(apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {}),
    };
    const body = buildChatCompletionBody(this.config.model, request, tools, false);
    await options?.promptAudit?.recorder.append(
      "prompt_audit.provider_request",
      {
        provider: this.config.provider_id ?? "openai-compatible",
        model: this.config.model,
        stream: false,
        tool_choice: body.tool_choice ?? null,
        ...providerUrlParts(url),
        http_method: "POST",
        headers,
        ...(options.promptAudit.recorder.preferences.include_provider_payload
          ? { provider_request_body: body }
          : { provider_request_body: "[OMITTED_BY_PREFERENCE]" }),
      },
      options.promptAudit.modelCall
    );

    const timeoutState = createProviderTimeoutState();
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: timeoutState.controller.signal,
      });
    } catch (error) {
      throw normalizeProviderTimeoutError(error, timeoutState);
    } finally {
      clearTimeout(timeoutState.timer);
    }

    const payload = await parseProviderPayload(response);
    await options?.promptAudit?.recorder.append(
      "prompt_audit.provider_response",
      {
        provider: this.config.provider_id ?? "openai-compatible",
        model: payload.model ?? this.config.model,
        status_code: response.status,
        content_type: response.headers.get("content-type") ?? "",
        finish_reason: payload.choices?.[0]?.finish_reason ?? null,
        usage: normalizeUsage(payload.usage),
        cost: normalizeCost(payload.usage),
        ...(options.promptAudit.recorder.preferences.include_provider_response
          ? { provider_response_body: payload }
          : { provider_response_body: "[OMITTED_BY_PREFERENCE]" }),
      },
      options.promptAudit.modelCall
    );
    if (!response.ok) {
      throw new Error(formatProviderFailure(response.status, payload));
    }

    return toModelResponse(payload);
  }

  async *completeStream(
    request: GatewayEngineRequest,
    tools: ToolDefinition[],
    options?: ModelAdapterCallOptions
  ): AsyncIterable<ModelStreamChunk> {
    const apiKey = this.runtimeSecrets?.apiKey ?? process.env[this.config.api_key_env] ?? "";
    const url = `${this.config.base_url}/chat/completions`;
    const headers = {
      "content-type": "application/json",
      ...(apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {}),
    };
    const body = buildChatCompletionBody(this.config.model, request, tools, true);
    await options?.promptAudit?.recorder.append(
      "prompt_audit.provider_request",
      {
        provider: this.config.provider_id ?? "openai-compatible",
        model: this.config.model,
        stream: true,
        tool_choice: body.tool_choice ?? null,
        ...providerUrlParts(url),
        http_method: "POST",
        headers,
        ...(options.promptAudit.recorder.preferences.include_provider_payload
          ? { provider_request_body: body }
          : { provider_request_body: "[OMITTED_BY_PREFERENCE]" }),
      },
      options.promptAudit.modelCall
    );

    const timeoutState = createProviderTimeoutState();
    await appendProviderLifecycle(options, "request_started", timeoutState);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: timeoutState.controller.signal,
      });
    } catch (error) {
      await appendProviderLifecycle(options, "timeout", timeoutState);
      throw normalizeProviderTimeoutError(error, timeoutState);
    }

    const contentType = response.headers.get("content-type") ?? "";
    await appendProviderLifecycle(options, "response_headers", timeoutState, {
      status_code: response.status,
      content_type: contentType,
    });
    if (!response.ok) {
      clearTimeout(timeoutState.timer);
      const payload = await parseProviderPayload(response);
      await options?.promptAudit?.recorder.append(
        "prompt_audit.provider_response",
        {
          provider: this.config.provider_id ?? "openai-compatible",
          model: payload.model ?? this.config.model,
          status_code: response.status,
          content_type: contentType,
          finish_reason: payload.choices?.[0]?.finish_reason ?? null,
          usage: normalizeUsage(payload.usage),
          cost: normalizeCost(payload.usage),
          ...(options.promptAudit.recorder.preferences.include_provider_response
            ? { provider_response_body: payload }
            : { provider_response_body: "[OMITTED_BY_PREFERENCE]" }),
        },
        options.promptAudit.modelCall
      );
      throw new Error(formatProviderFailure(response.status, payload));
    }

    if (!contentType.includes("text/event-stream")) {
      clearTimeout(timeoutState.timer);
      const payload = await parseProviderPayload(response);
      const fallback = toModelResponse(payload);
      await options?.promptAudit?.recorder.append(
        "prompt_audit.provider_response",
        {
          provider: this.config.provider_id ?? "openai-compatible",
          model: payload.model ?? this.config.model,
          status_code: response.status,
          content_type: contentType,
          finish_reason: fallback.finishReason,
          usage: fallback.usage ?? null,
          cost: fallback.cost ?? { status: "unavailable" },
          reconstructed_response: fallback,
          ...(options.promptAudit.recorder.preferences.include_provider_response
            ? { provider_response_body: payload }
            : { provider_response_body: "[OMITTED_BY_PREFERENCE]" }),
        },
        options.promptAudit.modelCall
      );
      yield {
        type: "final",
        response: fallback,
      };
      return;
    }

    let assistantText = "";
    let finishReason = "completed";
    let usage: TokenUsage | undefined;
    let cost: CostMetadata | undefined;
    let providerModel: string | undefined;
    const rawStreamChunks: string[] = [];
    const toolCallBuilders = new Map<number, { id: string; name: string; args: string }>();

    let sawFirstStreamChunk = false;
    try {
      for await (const data of parseProviderSSE(response, timeoutState)) {
        if (!sawFirstStreamChunk) {
          sawFirstStreamChunk = true;
          await appendProviderLifecycle(options, "first_stream_chunk", timeoutState);
        }
      if (data === "[DONE]") {
        break;
      }

      if (options?.promptAudit?.recorder.detail === "verbose") {
        rawStreamChunks.push(data);
      }

      let chunk: OpenAIStreamChunk;
      try {
        chunk = JSON.parse(data) as OpenAIStreamChunk;
      } catch {
        continue;
      }

      if (chunk.error?.message) {
        await options?.promptAudit?.recorder.append(
          "prompt_audit.provider_response",
          {
            provider: this.config.provider_id ?? "openai-compatible",
            model: chunk.model ?? this.config.model,
            status_code: response.status,
            content_type: contentType,
            provider_error: chunk.error,
            ...(rawStreamChunks.length > 0 ? { raw_stream_chunks: rawStreamChunks } : {}),
          },
          options.promptAudit.modelCall
        );
        throw new Error(formatProviderFailure(502, { error: chunk.error }));
      }

      if (chunk.model) {
        providerModel = chunk.model;
      }
      if (chunk.usage) {
        usage = normalizeUsage(chunk.usage);
        cost = normalizeCost(chunk.usage);
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
    } catch (error) {
      if (timeoutState.timedOut) {
        await appendProviderLifecycle(options, "timeout", timeoutState);
      }
      throw normalizeProviderTimeoutError(error, timeoutState);
    } finally {
      clearTimeout(timeoutState.timer);
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
        ...(usage ? { usage } : {}),
        cost: cost ?? { status: "unavailable" },
      },
    };
    await options?.promptAudit?.recorder.append(
      "prompt_audit.provider_response",
      {
        provider: this.config.provider_id ?? "openai-compatible",
        model: providerModel ?? this.config.model,
        status_code: response.status,
        content_type: contentType,
        finish_reason: finishReason,
        usage: usage ?? null,
        cost: cost ?? { status: "unavailable" },
        reconstructed_response: {
          assistantText,
          toolCalls: [...toolCallBuilders.entries()]
            .sort((left, right) => left[0] - right[0])
            .map(([, toolCall]) => ({
              id: toolCall.id,
              name: toolCall.name.length > 0 ? toolCall.name : "unknown_tool",
              input: parseToolArguments(toolCall.args),
            })),
          finishReason,
          ...(usage ? { usage } : {}),
          cost: cost ?? { status: "unavailable" },
        },
        ...(rawStreamChunks.length > 0 ? { raw_stream_chunks: rawStreamChunks } : {}),
      },
      options?.promptAudit?.modelCall
    );
    await appendProviderLifecycle(options, "stream_completed", timeoutState, {
      finish_reason: finishReason,
      saw_first_stream_chunk: sawFirstStreamChunk,
    });
  }
}

function buildChatCompletionBody(
  model: string,
  request: GatewayEngineRequest,
  tools: ToolDefinition[],
  stream: boolean
): {
  model: string;
  stream: boolean;
  messages: OpenAIMessage[];
  tools: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  tool_choice?: "auto";
} {
  return {
    model,
    stream,
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
    ...(tools.length > 0 ? { tool_choice: "auto" as const } : {}),
  };
}

function createProviderTimeoutState(): ProviderTimeoutState {
  const requestTimeoutMs = resolveTimeoutMs(
    "BRAINDRIVE_PROVIDER_REQUEST_TIMEOUT_MS",
    DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS
  );
  const streamIdleTimeoutMs = resolveTimeoutMs(
    "BRAINDRIVE_PROVIDER_STREAM_IDLE_TIMEOUT_MS",
    DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS
  );
  const controller = new AbortController();
  const state: ProviderTimeoutState = {
    controller,
    requestTimeoutMs,
    streamIdleTimeoutMs,
    timedOut: null,
    timer: setTimeout(() => {
      state.timedOut = "request_total";
      controller.abort(new Error(`Provider request timed out after ${requestTimeoutMs}ms`));
    }, requestTimeoutMs),
  };
  return state;
}

function resolveTimeoutMs(envName: string, fallback: number): number {
  const parsed = Number(process.env[envName]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function appendProviderLifecycle(
  options: ModelAdapterCallOptions | undefined,
  stage: "request_started" | "response_headers" | "first_stream_chunk" | "stream_completed" | "timeout",
  timeoutState: ProviderTimeoutState,
  details: Record<string, unknown> = {}
): Promise<void> {
  await options?.promptAudit?.recorder.append(
    "prompt_audit.provider_lifecycle",
    {
      stage,
      request_timeout_ms: timeoutState.requestTimeoutMs,
      stream_idle_timeout_ms: timeoutState.streamIdleTimeoutMs,
      timeout_type: timeoutState.timedOut,
      ...details,
    },
    options.promptAudit.modelCall
  );
}

function normalizeProviderTimeoutError(error: unknown, timeoutState: ProviderTimeoutState): Error {
  if (timeoutState.timedOut === "request_total") {
    return new Error(`Provider request timed out after ${timeoutState.requestTimeoutMs}ms`);
  }
  if (timeoutState.timedOut === "stream_idle") {
    return new Error(`Provider stream idle timeout after ${timeoutState.streamIdleTimeoutMs}ms`);
  }
  return error instanceof Error ? error : new Error(String(error));
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

function providerUrlParts(url: string): { url_origin: string; url_path: string } {
  try {
    const parsed = new URL(url);
    return {
      url_origin: parsed.origin,
      url_path: parsed.pathname,
    };
  } catch {
    return {
      url_origin: "unknown",
      url_path: "unknown",
    };
  }
}

function normalizeUsage(usage: OpenAIUsage | undefined): TokenUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    ...(typeof usage.prompt_tokens === "number" ? { promptTokens: usage.prompt_tokens } : {}),
    ...(typeof usage.completion_tokens === "number" ? { completionTokens: usage.completion_tokens } : {}),
    ...(typeof usage.total_tokens === "number" ? { totalTokens: usage.total_tokens } : {}),
    ...(typeof usage.prompt_tokens_details?.cached_tokens === "number"
      ? { cachedPromptTokens: usage.prompt_tokens_details.cached_tokens }
      : {}),
    ...(typeof usage.completion_tokens_details?.reasoning_tokens === "number"
      ? { reasoningTokens: usage.completion_tokens_details.reasoning_tokens }
      : {}),
  };
}

function normalizeCost(usage: OpenAIUsage | undefined): CostMetadata {
  const providerReportedCost =
    typeof usage?.cost === "number"
      ? usage.cost
      : typeof usage?.total_cost === "number"
        ? usage.total_cost
        : undefined;

  if (providerReportedCost !== undefined) {
    return {
      amount: providerReportedCost,
      currency: typeof usage?.currency === "string" ? usage.currency : "USD",
      status: "provider_reported",
    };
  }

  return {
    status: "unavailable",
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
      ...(normalizeUsage(payload.usage) ? { usage: normalizeUsage(payload.usage) } : {}),
      cost: normalizeCost(payload.usage),
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
    ...(normalizeUsage(payload.usage) ? { usage: normalizeUsage(payload.usage) } : {}),
    cost: normalizeCost(payload.usage),
  };
}

async function* parseProviderSSE(response: Response, timeoutState: ProviderTimeoutState): AsyncIterable<string> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await readStreamChunkWithIdleTimeout(reader, timeoutState);
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

async function readStreamChunkWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutState: ProviderTimeoutState
): Promise<StreamReadResult> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<StreamReadResult>((_, reject) => {
        timeout = setTimeout(() => {
          timeoutState.timedOut = "stream_idle";
          timeoutState.controller.abort(new Error(`Provider stream idle timeout after ${timeoutState.streamIdleTimeoutMs}ms`));
          reject(new Error(`Provider stream idle timeout after ${timeoutState.streamIdleTimeoutMs}ms`));
        }, timeoutState.streamIdleTimeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
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
