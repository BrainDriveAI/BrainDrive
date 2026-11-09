import { afterEach, describe, expect, it, vi } from "vitest";

import type { GatewayEngineRequest, ToolDefinition } from "../contracts.js";
import type { PromptAuditRecorder } from "../memory/prompt-audit-store.js";
import { OpenAICompatibleAdapter } from "./openai-compatible.js";

const request: GatewayEngineRequest = {
  messages: [
    { role: "system", content: "System prompt" },
    { role: "user", content: "Hello" },
  ],
  auth_context: {
    actor: {
      id: "owner",
      type: "owner",
      status: "active",
      created: "2026-11-04T00:00:00.000Z",
    },
    authentication_id: "test-authentication",
    authenticated_at: "2026-11-04T00:00:00.000Z",
    correlation_id: "correlation-1",
  },
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
    }, { apiKey: "test-key" });

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

  it("retries a transient interrupted stream without exposing duplicate partial text", async () => {
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(
            new ReadableStream({
              start(controller) {
                const encoder = new TextEncoder();
                controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'));
                controller.error(new Error("terminated"));
              },
            }),
            { status: 200, headers: { "content-type": "text/event-stream" } }
          );
        }

        return new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Recovered"}}]}\n\n'));
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
      provider_id: "test-provider",
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

    expect(calls).toBe(2);
    expect(chunks).toEqual([
      { type: "text-delta", delta: "Recovered" },
      {
        type: "final",
        response: expect.objectContaining({
          assistantText: "Recovered",
          finishReason: "stop",
        }),
      },
    ]);
    expect(events.find((entry) => entry.event === "prompt_audit.stream_retry")?.details).toMatchObject({
      reason: "terminated",
      attempt: 1,
      buffered_text_discarded: true,
    });
  });
});

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
