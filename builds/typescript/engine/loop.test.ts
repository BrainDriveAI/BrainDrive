import { describe, expect, it } from "vitest";

import type { AuthContext, GatewayEngineRequest } from "../contracts.js";
import type { ModelAdapter } from "../adapters/base.js";
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
});
