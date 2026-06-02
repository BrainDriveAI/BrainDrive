import { afterEach, describe, expect, it, vi } from "vitest";

import type { GatewayEngineRequest, ToolDefinition } from "../contracts.js";
import type { PromptAuditRecorder } from "../memory/prompt-audit-store.js";
import { OpenAICompatibleAdapter } from "./openai-compatible.js";

const request: GatewayEngineRequest = {
  messages: [
    { role: "system", content: "System prompt" },
    { role: "user", content: "Hello" },
  ],
  metadata: {
    correlation_id: "correlation-1",
    conversation_id: "conversation-1",
  },
};

const tools: ToolDefinition[] = [
  {
    name: "memory_read",
    description: "Read memory",
    requiresApproval: false,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
    },
    execute: async () => "ok",
  },
];

describe("OpenAICompatibleAdapter prompt audit", () => {
  afterEach(() => {
    delete process.env.BRAINDRIVE_PROVIDER_REQUEST_TIMEOUT_MS;
    delete process.env.BRAINDRIVE_PROVIDER_STREAM_IDLE_TIMEOUT_MS;
    delete process.env.BRAINDRIVE_PROVIDER_CONTEXT_WINDOW_TOKENS;
    delete process.env.BRAINDRIVE_PROVIDER_RESPONSE_HEADROOM_TOKENS;
    vi.restoreAllMocks();
  });

  it("captures the exact non-streaming provider body passed to fetch", async () => {
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    let sentBody: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            model: "test-model",
            choices: [{ finish_reason: "stop", message: { content: "Hi" } }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 2,
              total_tokens: 12,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const adapter = new OpenAICompatibleAdapter({
      base_url: "https://provider.example/v1",
      model: "test-model",
      api_key_env: "TEST_API_KEY",
      provider_id: "test-provider",
    }, { apiKey: "sk-testsecret123456789" });

    const response = await adapter.complete(request, tools, {
      promptAudit: {
        recorder: fakeRecorder(events),
        modelCall: {
          model_call_id: "model-call-1",
          model_call_index: 1,
        },
      },
    });

    const providerRequest = events.find((entry) => entry.event === "prompt_audit.provider_request");
    expect(providerRequest?.details.provider_request_body).toEqual(sentBody);
    expect(providerRequest?.details.url_origin).toBe("https://provider.example");
    expect(providerRequest?.details.url_path).toBe("/v1/chat/completions");
    expect(response.usage).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12 });
    expect(response.cost).toEqual({ status: "unavailable" });
  });

  it("captures the exact streaming provider body passed to fetch", async () => {
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    let sentBody: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentBody = JSON.parse(String(init?.body));
        return new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
              controller.enqueue(encoder.encode('data: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\n'));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } }
        );
      })
    );

    const adapter = new OpenAICompatibleAdapter({
      base_url: "https://provider.example/v1",
      model: "test-model",
      api_key_env: "TEST_API_KEY",
    });

    const chunks = [];
    for await (const chunk of adapter.completeStream!(request, tools, {
      promptAudit: {
        recorder: fakeRecorder(events),
        modelCall: {
          model_call_id: "model-call-1",
          model_call_index: 1,
        },
      },
    })) {
      chunks.push(chunk);
    }

    const providerRequest = events.find((entry) => entry.event === "prompt_audit.provider_request");
    const providerResponse = events.find((entry) => entry.event === "prompt_audit.provider_response");
    expect(providerRequest?.details.provider_request_body).toEqual(sentBody);
    expect(providerResponse?.details.reconstructed_response).toMatchObject({
      assistantText: "Hi",
      finishReason: "stop",
    });
    expect(chunks.at(-1)).toMatchObject({
      type: "final",
      response: {
        assistantText: "Hi",
        finishReason: "stop",
      },
    });
  });

  it("aborts a streaming provider response that goes idle", async () => {
    process.env.BRAINDRIVE_PROVIDER_REQUEST_TIMEOUT_MS = "1000";
    process.env.BRAINDRIVE_PROVIDER_STREAM_IDLE_TIMEOUT_MS = "10";
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          new ReadableStream({
            start() {
              // Leave the stream open without chunks to exercise idle timeout handling.
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } }
        )
      )
    );

    const adapter = new OpenAICompatibleAdapter({
      base_url: "https://provider.example/v1",
      model: "test-model",
      api_key_env: "TEST_API_KEY",
    });

    await expect(collectStream(adapter.completeStream!(request, tools, {
      promptAudit: {
        recorder: fakeRecorder(events),
        modelCall: {
          model_call_id: "model-call-1",
          model_call_index: 1,
        },
      },
    }))).rejects.toThrow("Provider stream idle timeout after 10ms");

    expect(events).toContainEqual(expect.objectContaining({
      event: "prompt_audit.provider_lifecycle",
      details: expect.objectContaining({
        stage: "timeout",
        timeout_type: "stream_idle",
        stream_idle_timeout_ms: 10,
      }),
    }));
  });

  it("blocks oversized provider payloads before fetch", async () => {
    process.env.BRAINDRIVE_PROVIDER_CONTEXT_WINDOW_TOKENS = "100";
    process.env.BRAINDRIVE_PROVIDER_RESPONSE_HEADROOM_TOKENS = "10";
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenAICompatibleAdapter({
      base_url: "https://provider.example/v1",
      model: "test-model",
      api_key_env: "TEST_API_KEY",
    });

    await expect(adapter.complete({
      ...request,
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "A".repeat(1_000) },
      ],
    }, tools, {
      promptAudit: {
        recorder: fakeRecorder(events),
        modelCall: {
          model_call_id: "model-call-1",
          model_call_index: 1,
        },
      },
    })).rejects.toThrow("Provider context overflow preflight");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({
      event: "prompt_audit.provider_request_preflight",
      details: expect.objectContaining({
        blocked: true,
        context_window_tokens: 100,
        prompt_budget_tokens: 90,
      }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      event: "prompt_audit.provider_request_blocked",
      details: expect.objectContaining({
        reason: "context_overflow_preflight",
      }),
    }));
    expect(events.some((entry) => entry.event === "prompt_audit.provider_request")).toBe(false);
  });
});

async function collectStream<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const chunks: T[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

function fakeRecorder(events: Array<{ event: string; details: Record<string, unknown> }>): PromptAuditRecorder {
  return {
    traceId: "trace-1",
    conversationId: "conversation-1",
    correlationId: "correlation-1",
    detail: "standard",
    preferences: {
      enabled: true,
      detail: "standard",
      retention_days: 14,
      max_file_bytes: 5 * 1024 * 1024,
      include_provider_payload: true,
      include_provider_response: true,
      include_source_snapshots: true,
    },
    append: async (event, details = {}) => {
      events.push({ event, details });
    },
  };
}
