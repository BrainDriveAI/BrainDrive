import { describe, expect, it } from "vitest";

import type { AuthContext, GatewayEngineRequest, StreamEvent } from "../contracts.js";
import type { ModelAdapter, ModelResponse, ModelStreamChunk } from "../adapters/base.js";
import type { PromptAuditRecorder } from "../memory/prompt-audit-store.js";
import { ApprovalStore } from "./approval-store.js";
import { runAgentLoop } from "./loop.js";
import { ToolExecutor, type ToolExecutorLike } from "./tool-executor.js";

const ownerAuth: AuthContext = {
  actorId: "owner",
  actorType: "owner",
  mode: "local",
  permissions: {
    memory_access: true,
    tool_access: true,
    system_actions: true,
    delegation: true,
    approval_authority: true,
    administration: true,
  },
};

const request: GatewayEngineRequest = {
  messages: [{ role: "user", content: "Read my project setup." }],
  metadata: {
    correlation_id: "test-correlation",
    conversation_id: "conversation-1",
  },
};

describe("runAgentLoop", () => {
  it("accepts the minimal ToolExecutorLike seam without changing unguarded behavior", async () => {
    const concrete = new ToolExecutor([]);
    const executor: ToolExecutorLike = {
      listTools: (auth) => concrete.listTools(auth),
      getTool: (name) => concrete.getTool(name),
      execute: (auth, context, name, input) =>
        concrete.execute(auth, context, name, input),
    };
    const adapter = sequenceAdapter([{
      assistantText: "Normal answer through executor seam.",
      finishReason: "completed",
      toolCalls: [],
    }]);

    const events = await collectEvents(adapter, { executor });

    expect(events.map((event) => event.type)).toEqual(["text-delta", "done"]);
  });

  it("runs executor preflight before normal approval and never executes a denied mutation", async () => {
    let modelCalls = 0;
    let preflightCalls = 0;
    let executeCalls = 0;
    const tool = {
      name: "memory_write",
      description: "Write memory",
      requiresApproval: true,
      readOnly: false,
      inputSchema: { type: "object" },
      execute: async () => ({}),
    };
    const executor: ToolExecutorLike = {
      listTools: () => [tool],
      getTool: () => tool,
      preflight: async () => {
        preflightCalls += 1;
        return null;
      },
      execute: async () => {
        executeCalls += 1;
        return { status: "ok", output: {} };
      },
    };
    const adapter: ModelAdapter = {
      async complete() {
        modelCalls += 1;
        return modelCalls === 1
          ? {
              assistantText: "",
              finishReason: "tool_calls",
              toolCalls: [{
                id: "write-1",
                name: "memory_write",
                input: { path: "documents/career/spec.md", content: "candidate" },
              }],
            }
          : {
              assistantText: "The write was not approved.",
              finishReason: "completed",
              toolCalls: [],
            };
      },
    };
    const approvals = new ApprovalStore();
    const generator = runAgentLoop(
      adapter,
      executor,
      approvals,
      request,
      ownerAuth,
      { memoryRoot: "/tmp/brain", safetyIterationLimit: 3 }
    );

    expect((await generator.next()).value).toMatchObject({ type: "tool-call" });
    const approvalRequest = (await generator.next()).value;
    expect(approvalRequest).toMatchObject({ type: "approval-request" });
    expect(preflightCalls).toBe(1);
    if (!approvalRequest || approvalRequest.type !== "approval-request") {
      throw new Error("Expected approval request");
    }
    const approvalResultPromise = generator.next();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(approvals.resolve(approvalRequest.request_id, "denied")).not.toBeNull();
    expect((await approvalResultPromise).value).toMatchObject({
      type: "approval-result",
      decision: "denied",
    });

    const remaining: StreamEvent[] = [];
    for await (const event of generator) {
      remaining.push(event);
    }
    expect(remaining.map((event) => event.type)).toEqual([
      "tool-result",
      "text-delta",
      "done",
    ]);
    expect(executeCalls).toBe(0);
  });

  it("retries an empty non-streaming completion before emitting done", async () => {
    const adapter = sequenceAdapter([
      emptyCompletion(),
      {
        assistantText: "Recovered answer.",
        finishReason: "completed",
        toolCalls: [],
      },
    ]);

    const events = await collectEvents(adapter);

    expect(adapter.calls()).toBe(2);
    expect(events).toEqual([
      {
        type: "text-delta",
        delta: "Recovered answer.",
      },
      {
        type: "done",
        conversation_id: "conversation-1",
        message_id: expect.any(String),
        finish_reason: "completed",
      },
    ]);
  });

  it("emits provider_error and no done when empty non-streaming completions exhaust retry", async () => {
    const adapter = sequenceAdapter([
      emptyCompletion(),
      emptyCompletion(),
    ]);

    const events = await collectEvents(adapter);

    expect(adapter.calls()).toBe(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      code: "provider_error",
    });
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("treats whitespace-only assistant text with no tool calls as an empty completion", async () => {
    const adapter = sequenceAdapter([
      {
        assistantText: " \n\t ",
        finishReason: "completed",
        toolCalls: [],
      },
      {
        assistantText: "Recovered after whitespace.",
        finishReason: "completed",
        toolCalls: [],
      },
    ]);

    const events = await collectEvents(adapter);

    expect(adapter.calls()).toBe(2);
    expect(events).toEqual([
      {
        type: "text-delta",
        delta: "Recovered after whitespace.",
      },
      {
        type: "done",
        conversation_id: "conversation-1",
        message_id: expect.any(String),
        finish_reason: "completed",
      },
    ]);
  });

  it("retries empty no-tool completions with finishReason length", async () => {
    const adapter = sequenceAdapter([
      emptyCompletion("length"),
      {
        assistantText: "Recovered from empty length response.",
        finishReason: "completed",
        toolCalls: [],
      },
    ]);

    const events = await collectEvents(adapter);

    expect(adapter.calls()).toBe(2);
    expect(events).toEqual([
      {
        type: "text-delta",
        delta: "Recovered from empty length response.",
      },
      {
        type: "done",
        conversation_id: "conversation-1",
        message_id: expect.any(String),
        finish_reason: "completed",
      },
    ]);
  });

  it("does not retry valid assistant text", async () => {
    const adapter = sequenceAdapter([
      {
        assistantText: "Normal answer.",
        finishReason: "completed",
        toolCalls: [],
      },
    ]);

    const events = await collectEvents(adapter);

    expect(adapter.calls()).toBe(1);
    expect(events).toEqual([
      {
        type: "text-delta",
        delta: "Normal answer.",
      },
      {
        type: "done",
        conversation_id: "conversation-1",
        message_id: expect.any(String),
        finish_reason: "completed",
      },
    ]);
  });

  it("does not retry valid tool calls with empty assistant text", async () => {
    let calls = 0;
    const adapter: ModelAdapter = {
      async complete(nextRequest) {
        calls += 1;
        if (calls === 1) {
          return {
            assistantText: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "call-1",
                name: "memory_read",
                input: { path: "documents/project/spec.md" },
              },
            ],
          };
        }

        expect(nextRequest.messages.at(-1)).toMatchObject({
          role: "tool",
          tool_call_id: "call-1",
        });

        return {
          assistantText: "Read complete.",
          finishReason: "completed",
          toolCalls: [],
        };
      },
    };
    const executor = new ToolExecutor([
      {
        name: "memory_read",
        description: "Read memory",
        requiresApproval: false,
        readOnly: true,
        inputSchema: { type: "object" },
        execute: async () => ({ content: "Spec" }),
      },
    ]);

    const events = await collectEvents(adapter, { executor });

    expect(calls).toBe(2);
    expect(events).toEqual([
      {
        type: "tool-call",
        id: "call-1",
        name: "memory_read",
        input: { path: "documents/project/spec.md" },
      },
      {
        type: "tool-result",
        id: "call-1",
        status: "ok",
        output: { content: "Spec" },
      },
      {
        type: "text-delta",
        delta: "Read complete.",
      },
      {
        type: "done",
        conversation_id: "conversation-1",
        message_id: expect.any(String),
        finish_reason: "completed",
      },
    ]);
  });

  it("retries a streaming model call that yields no final response and no text", async () => {
    const adapter = streamSequenceAdapter([
      [],
      [
        {
          type: "final",
          response: {
            assistantText: "Recovered streaming answer.",
            finishReason: "completed",
            toolCalls: [],
          },
        },
      ],
    ]);

    const events = await collectEvents(adapter);

    expect(adapter.calls()).toBe(2);
    expect(events).toEqual([
      {
        type: "text-delta",
        delta: "Recovered streaming answer.",
      },
      {
        type: "done",
        conversation_id: "conversation-1",
        message_id: expect.any(String),
        finish_reason: "completed",
      },
    ]);
  });

  it("retries a streaming final empty response when no text has streamed", async () => {
    const adapter = streamSequenceAdapter([
      [
        {
          type: "final",
          response: emptyCompletion(),
        },
      ],
      [
        {
          type: "final",
          response: {
            assistantText: "Recovered final streaming answer.",
            finishReason: "completed",
            toolCalls: [],
          },
        },
      ],
    ]);

    const events = await collectEvents(adapter);

    expect(adapter.calls()).toBe(2);
    expect(events).toEqual([
      {
        type: "text-delta",
        delta: "Recovered final streaming answer.",
      },
      {
        type: "done",
        conversation_id: "conversation-1",
        message_id: expect.any(String),
        finish_reason: "completed",
      },
    ]);
  });

  it("does not silently retry after visible streamed text", async () => {
    const adapter = streamSequenceAdapter([
      [
        {
          type: "text-delta",
          delta: "Partial answer.",
        },
      ],
      [
        {
          type: "final",
          response: {
            assistantText: "This retry must not happen.",
            finishReason: "completed",
            toolCalls: [],
          },
        },
      ],
    ]);

    const events = await collectEvents(adapter);

    expect(adapter.calls()).toBe(1);
    expect(events.filter((event) => event.type === "text-delta")).toEqual([
      {
        type: "text-delta",
        delta: "Partial answer.",
      },
    ]);
  });

  it("records prompt audit evidence for empty-completion retry attempts and exhaustion", async () => {
    const auditEvents: Array<{ event: string; details: Record<string, unknown>; modelCallIndex?: number }> = [];
    const adapter = sequenceAdapter([
      emptyCompletion("length"),
      emptyCompletion("length"),
    ]);

    const events = await collectEvents(adapter, {
      promptAudit: {
        recorder: fakeRecorder(auditEvents),
        adapterName: "openai-compatible",
        providerProfile: "openrouter",
        model: "test-model",
      },
    });

    const retryEvents = auditEvents.filter((entry) => entry.event === "prompt_audit.empty_completion_retry");

    expect(events.some((event) => event.type === "done")).toBe(false);
    expect(events[0]).toMatchObject({
      type: "error",
      code: "provider_error",
    });
    expect(retryEvents).toEqual([
      expect.objectContaining({
        details: expect.objectContaining({
          reason: "empty_completion",
          attempt: 1,
          max_retries: 1,
          retry_exhausted: false,
          finish_reason: "length",
          streamed_assistant_text: false,
          usage: null,
          cost: { status: "unavailable" },
        }),
      }),
      expect.objectContaining({
        details: expect.objectContaining({
          reason: "empty_completion",
          attempt: 2,
          max_retries: 1,
          retry_exhausted: true,
          finish_reason: "length",
          streamed_assistant_text: false,
          usage: null,
          cost: { status: "unavailable" },
        }),
      }),
    ]);
  });

  it("returns unknown tool calls to the model as recoverable tool results", async () => {
    let calls = 0;
    const adapter: ModelAdapter = {
      async complete(nextRequest) {
        calls += 1;
        if (calls === 1) {
          return {
            assistantText: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "call-1",
                name: "project_read",
                input: { path: "documents/finance/AGENT.md" },
              },
            ],
          };
        }

        expect(nextRequest.messages.at(-1)).toMatchObject({
          role: "tool",
          tool_call_id: "call-1",
        });

        return {
          assistantText: "I could not use that tool, so I will continue with available tools.",
          finishReason: "completed",
          toolCalls: [],
        };
      },
    };

    const events = [];
    for await (const event of runAgentLoop(
      adapter,
      new ToolExecutor([]),
      new ApprovalStore(),
      request,
      ownerAuth,
      { memoryRoot: "/tmp/brain", safetyIterationLimit: 3 }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "tool-call",
        id: "call-1",
        name: "project_read",
        input: { path: "documents/finance/AGENT.md" },
      },
      {
        type: "tool-result",
        id: "call-1",
        status: "error",
        output: {
          code: "tool_unavailable",
          message: "Tool is not available: project_read",
          recoverable: true,
        },
      },
      {
        type: "text-delta",
        delta: "I could not use that tool, so I will continue with available tools.",
      },
      {
        type: "done",
        conversation_id: "conversation-1",
        message_id: expect.any(String),
        finish_reason: "completed",
      },
    ]);
    expect(calls).toBe(2);
  });

  it("records every model request and response during a tool loop", async () => {
    const auditEvents: Array<{ event: string; details: Record<string, unknown>; modelCallIndex?: number }> = [];
    let calls = 0;
    const adapter: ModelAdapter = {
      async complete() {
        calls += 1;
        if (calls === 1) {
          return {
            assistantText: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "call-1",
                name: "memory_read",
                input: { path: "documents/project/spec.md" },
              },
            ],
          };
        }

        return {
          assistantText: "Read it.",
          finishReason: "completed",
          toolCalls: [],
        };
      },
    };

    const executor = new ToolExecutor([
      {
        name: "memory_read",
        description: "Read memory",
        requiresApproval: false,
        readOnly: true,
        inputSchema: { type: "object" },
        execute: async () => ({ content: "Spec" }),
      },
    ]);

    for await (const _event of runAgentLoop(
      adapter,
      executor,
      new ApprovalStore(),
      request,
      ownerAuth,
      {
        memoryRoot: "/tmp/brain",
        safetyIterationLimit: 3,
        promptAudit: {
          recorder: fakeRecorder(auditEvents),
          adapterName: "openai-compatible",
          providerProfile: "openrouter",
          model: "test-model",
        },
      }
    )) {
      // Drain events.
    }

    expect(auditEvents.filter((entry) => entry.event === "prompt_audit.model_request")).toHaveLength(2);
    expect(auditEvents.filter((entry) => entry.event === "prompt_audit.model_response")).toHaveLength(2);
    expect(auditEvents.find((entry) => entry.event === "prompt_audit.tool_result")?.details).toMatchObject({
      tool_call_id: "call-1",
      status: "ok",
      output: { content: "Spec" },
    });
    expect(auditEvents.filter((entry) => entry.event === "prompt_audit.model_request").map((entry) => entry.modelCallIndex))
      .toEqual([1, 2]);
  });
});

async function collectEvents(
  adapter: ModelAdapter,
  options: {
    executor?: ToolExecutorLike;
    promptAudit?: {
      recorder: PromptAuditRecorder;
      adapterName: string;
      providerProfile?: string;
      model?: string;
    };
  } = {}
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of runAgentLoop(
    adapter,
    options.executor ?? new ToolExecutor([]),
    new ApprovalStore(),
    request,
    ownerAuth,
    {
      memoryRoot: "/tmp/brain",
      safetyIterationLimit: 3,
      ...(options.promptAudit ? { promptAudit: options.promptAudit } : {}),
    }
  )) {
    events.push(event);
  }
  return events;
}

function emptyCompletion(finishReason = "completed"): ModelResponse {
  return {
    assistantText: "",
    finishReason,
    toolCalls: [],
  };
}

function sequenceAdapter(responses: ModelResponse[]): ModelAdapter & { calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    async complete() {
      const response = responses[calls];
      calls += 1;
      if (!response) {
        throw new Error(`Unexpected model call ${calls}`);
      }
      return response;
    },
  };
}

function streamSequenceAdapter(
  attempts: ModelStreamChunk[][]
): ModelAdapter & { calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    async complete() {
      throw new Error("complete should not be called for streaming test adapter");
    },
    async *completeStream() {
      const chunks = attempts[calls];
      calls += 1;
      if (!chunks) {
        throw new Error(`Unexpected streaming model call ${calls}`);
      }
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function fakeRecorder(
  events: Array<{ event: string; details: Record<string, unknown>; modelCallIndex?: number }>
): PromptAuditRecorder {
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
    append: async (event, details = {}, modelCall) => {
      events.push({ event, details, modelCallIndex: modelCall?.model_call_index });
    },
  };
}
