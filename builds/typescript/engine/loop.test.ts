import { afterEach, describe, expect, it } from "vitest";

import type { AuthContext, GatewayEngineRequest, GatewayMessage } from "../contracts.js";
import type { ModelAdapter } from "../adapters/base.js";
import type { PromptAuditRecorder } from "../memory/prompt-audit-store.js";
import { ApprovalStore } from "./approval-store.js";
import { runAgentLoop } from "./loop.js";
import { ToolExecutor } from "./tool-executor.js";

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
  afterEach(() => {
    delete process.env.BRAINDRIVE_MAX_TOOL_RESULT_MODEL_CHARS;
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

  it("compacts large tool results before the next model request", async () => {
    process.env.BRAINDRIVE_MAX_TOOL_RESULT_MODEL_CHARS = "500";
    const auditEvents: Array<{ event: string; details: Record<string, unknown>; modelCallIndex?: number }> = [];
    let calls = 0;
    let secondRequestMessages: GatewayMessage[] = [];
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
                input: { path: "documents/large.md" },
              },
            ],
          };
        }

        secondRequestMessages = nextRequest.messages;
        return {
          assistantText: "I read the compacted result.",
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
        execute: async () => ({ content: "A".repeat(5_000), path: "documents/large.md" }),
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

    const toolMessage = secondRequestMessages.find((message) => message.role === "tool");
    expect(toolMessage?.content.length).toBeLessThan(1_000);
    expect(toolMessage?.content).toContain("_model_context_compacted");
    expect(toolMessage?.content).toContain("truncated");
    expect(auditEvents).toContainEqual(expect.objectContaining({
      event: "prompt_audit.tool_result_compacted",
      details: expect.objectContaining({
        tool_call_id: "call-1",
        max_chars: 500,
      }),
    }));
  });
});

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
