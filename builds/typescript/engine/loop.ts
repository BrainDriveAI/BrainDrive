import type {
  ApprovalMode,
  AuthContext,
  GatewayEngineRequest,
  StreamEvent,
  ToolDefinition,
  ToolExecutionResult
} from "../contracts.js";
import type { ModelAdapter } from "../adapters/base.js";
import { auditLog } from "../logger.js";
import type { ModelCallAuditContext, PromptAuditRecorder } from "../memory/prompt-audit-store.js";
import { buildToolContext } from "../tools.js";
import { ApprovalStore } from "./approval-store.js";
import { classifyProviderError } from "./errors.js";
import { ToolExecutor } from "./tool-executor.js";

const EMPTY_COMPLETION_MAX_RETRIES = 1;

type LoopOptions = {
  memoryRoot: string;
  approvalMode?: ApprovalMode;
  safetyIterationLimit?: number;
  repeatToolCallThreshold?: number;
  toolExecutionGuard?: ToolExecutionGuard;
  promptAudit?: {
    recorder: PromptAuditRecorder;
    adapterName: string;
    providerProfile?: string;
    model?: string;
  };
};

export type ToolExecutionGuard = (
  toolName: string,
  input: Record<string, unknown>
) => ToolExecutionResult | null | undefined;

export async function* runAgentLoop(
  adapter: ModelAdapter,
  toolExecutor: ToolExecutor,
  approvalStore: ApprovalStore,
  request: GatewayEngineRequest,
  auth: AuthContext,
  options: LoopOptions
): AsyncGenerator<StreamEvent> {
  const messages = [...request.messages];
  const seenToolCallKeys = new Map<string, number>();
  const recentNonDestructiveMutationPaths: string[] = [];
  const repeatToolCallThreshold = options.repeatToolCallThreshold ?? 2;
  let iteration = 0;

  while (true) {
    if (options.safetyIterationLimit !== undefined && iteration >= options.safetyIterationLimit) {
      yield {
        type: "error",
        code: "context_overflow",
        message: "This session has gotten long. Start a new conversation to continue - all your work is saved.",
      };
      return;
    }

    iteration += 1;

    let completion;
    let streamedAssistantText = false;
    let modelCall: ModelCallAuditContext = {
      model_call_id: crypto.randomUUID(),
      model_call_index: iteration,
    };
    let responseAudited = false;
    const tools = toolExecutor.listTools(auth);
    let emptyCompletionRetries = 0;

    while (true) {
      completion = undefined;
      streamedAssistantText = false;
      responseAudited = false;
      modelCall = {
        model_call_id: crypto.randomUUID(),
        model_call_index: iteration,
      };

      try {
        await options.promptAudit?.recorder.append(
          "prompt_audit.model_request",
          {
            adapter_name: options.promptAudit.adapterName,
            provider_profile: options.promptAudit.providerProfile ?? null,
            selected_model: options.promptAudit.model ?? null,
            metadata: request.metadata,
            messages,
            tools: tools.map((tool) => serializeToolDefinitionForAudit(tool)),
          },
          modelCall
        );
        if (adapter.completeStream) {
          for await (const chunk of adapter.completeStream(
            {
              messages,
              metadata: request.metadata,
            },
            tools,
            options.promptAudit
              ? {
                  promptAudit: {
                    recorder: options.promptAudit.recorder,
                    modelCall,
                  },
                }
              : undefined
          )) {
            if (chunk.type === "text-delta") {
              if (chunk.delta.trim().length > 0) {
                streamedAssistantText = true;
              }
              yield {
                type: "text-delta",
                delta: chunk.delta,
              };
              continue;
            }

            completion = chunk.response;
          }

          if (!completion) {
            completion = {
              assistantText: "",
              toolCalls: [],
              finishReason: "completed",
            };
          }
        } else {
          completion = await adapter.complete(
            {
              messages,
              metadata: request.metadata,
            },
            tools,
            options.promptAudit
              ? {
                  promptAudit: {
                    recorder: options.promptAudit.recorder,
                    modelCall,
                  },
                }
              : undefined
          );
        }
      } catch (error) {
        await options.promptAudit?.recorder.append(
          "prompt_audit.error",
          {
            stage: "engine_model_call",
            message: error instanceof Error ? error.message : "Unknown provider error",
          },
          modelCall
        );
        auditLog("provider.error", {
          message: error instanceof Error ? error.message : "Unknown provider error",
        });
        yield classifyError(error);
        return;
      }

      if (isEmptyCompletion(completion) && (!adapter.completeStream || !streamedAssistantText)) {
        await appendModelResponseAudit(options, completion, modelCall);
        responseAudited = true;

        if (emptyCompletionRetries < EMPTY_COMPLETION_MAX_RETRIES) {
          await appendEmptyCompletionRetryAudit(
            options,
            completion,
            modelCall,
            emptyCompletionRetries + 1,
            false,
            streamedAssistantText
          );
          emptyCompletionRetries += 1;
          continue;
        }

        await appendEmptyCompletionRetryAudit(
          options,
          completion,
          modelCall,
          emptyCompletionRetries + 1,
          true,
          streamedAssistantText
        );
        yield {
          type: "error",
          code: "provider_error",
          message: "The model provider returned no usable response after retrying. Retry the request or try another model/provider if this continues.",
        };
        return;
      }

      break;
    }

    if (completion.assistantText.length > 0 || completion.toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: completion.assistantText,
        ...(completion.toolCalls.length > 0
          ? {
              tool_calls: completion.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.name,
                input: toolCall.input,
              })),
            }
          : {}),
      });
    }

    if (completion.assistantText.length > 0 && !streamedAssistantText) {
      yield {
        type: "text-delta",
        delta: completion.assistantText,
      };
    }

    if (!responseAudited) {
      await appendModelResponseAudit(options, completion, modelCall);
    }

    if (completion.toolCalls.length === 0) {
      yield {
        type: "done",
        conversation_id: request.metadata.conversation_id ?? "",
        message_id: crypto.randomUUID(),
        finish_reason: completion.finishReason,
      };
      return;
    }

    for (const toolCall of completion.toolCalls) {
      await options.promptAudit?.recorder.append("prompt_audit.tool_call", {
        tool_call_id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
      }, modelCall);
      yield {
        type: "tool-call",
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
      };

      const tool = toolExecutor.getTool(toolCall.name);
      if (!tool) {
        const unavailableOutput = {
          code: "tool_unavailable",
          message: `Tool is not available: ${toolCall.name}`,
          recoverable: true,
        };
        auditLog("tool.unavailable", {
          tool: toolCall.name,
          correlation_id: request.metadata.correlation_id,
        });
        yield {
          type: "tool-result",
          id: toolCall.id,
          status: "error",
          output: unavailableOutput,
        };
        await options.promptAudit?.recorder.append("prompt_audit.tool_result", {
          tool_call_id: toolCall.id,
          status: "error",
          output: unavailableOutput,
        }, modelCall);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            status: "error",
            output: unavailableOutput,
          }),
        });
        continue;
      }

      const toolCallKey = `${toolCall.name}:${stableToolInput(toolCall.input)}`;
      const seenCount = (seenToolCallKeys.get(toolCallKey) ?? 0) + 1;
      seenToolCallKeys.set(toolCallKey, seenCount);

      if (seenCount > repeatToolCallThreshold) {
        const loopGuardOutput = {
          code: "loop_guard",
          message: "Repeated tool call blocked",
          recoverable: true,
        };
        auditLog("tool.loop_guard", {
          tool: toolCall.name,
          count: seenCount,
          threshold: repeatToolCallThreshold,
          correlation_id: request.metadata.correlation_id,
        });

        yield {
          type: "tool-result",
          id: toolCall.id,
          status: "error",
          output: loopGuardOutput,
        };
        await options.promptAudit?.recorder.append("prompt_audit.tool_result", {
          tool_call_id: toolCall.id,
          status: "error",
          output: loopGuardOutput,
        }, modelCall);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            status: "error",
            output: loopGuardOutput,
          }),
        });
        continue;
      }

      const guardedResult = options.toolExecutionGuard?.(toolCall.name, toolCall.input);
      if (guardedResult) {
        auditLog("tool.execution_guard", {
          tool: toolCall.name,
          correlation_id: request.metadata.correlation_id,
          status: guardedResult.status,
        });

        yield* toolResultEvents(guardedResult, toolCall.id);
        await options.promptAudit?.recorder.append("prompt_audit.tool_result", {
          tool_call_id: toolCall.id,
          status: guardedResult.status,
          output: guardedResult.output,
        }, modelCall);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            status: guardedResult.status,
            output: guardedResult.output,
          }),
        });
        continue;
      }

      const mutationScopeGuard = checkMutationScopeGuard(
        tool.name,
        tool.readOnly,
        toolCall.input,
        recentNonDestructiveMutationPaths
      );
      if (mutationScopeGuard) {
        auditLog("tool.mutation_scope_guard", {
          tool: toolCall.name,
          path: mutationScopeGuard.path,
          conflicting_path: mutationScopeGuard.conflictingPath,
          correlation_id: request.metadata.correlation_id,
        });

        const guardOutput = {
          code: "mutation_scope_guard",
          message: "Destructive tool call blocked for recently mutated path",
          path: mutationScopeGuard.path,
          conflicting_path: mutationScopeGuard.conflictingPath,
          recoverable: true,
        };

        yield {
          type: "tool-result",
          id: toolCall.id,
          status: "error",
          output: guardOutput,
        };
        await options.promptAudit?.recorder.append("prompt_audit.tool_result", {
          tool_call_id: toolCall.id,
          status: "error",
          output: guardOutput,
        }, modelCall);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            status: "error",
            output: guardOutput,
          }),
        });
        continue;
      }

      if (tool.requiresApproval && options.approvalMode !== "auto-approve") {
        const requestId = crypto.randomUUID();
        yield {
          type: "approval-request",
          request_id: requestId,
          tool_name: toolCall.name,
          summary: `${toolCall.name} on ${String(toolCall.input.path ?? "requested path")}`,
        };
        auditLog("approval.request", { request_id: requestId, tool: toolCall.name });
        const decision = await approvalStore.create({
          requestId,
          toolCallId: toolCall.id,
          conversationId: request.metadata.conversation_id ?? "",
          toolName: toolCall.name,
          summary: `${toolCall.name} on ${String(toolCall.input.path ?? "requested path")}`,
          createdAt: new Date().toISOString(),
        });
        yield {
          type: "approval-result",
          request_id: requestId,
          decision,
        };
        auditLog("approval.result", { request_id: requestId, decision });
        if (decision === "denied") {
          const deniedOutput = { reason: "Denied by owner" };
          yield {
            type: "tool-result",
            id: toolCall.id,
            status: "denied",
            output: deniedOutput,
          };
          await options.promptAudit?.recorder.append("prompt_audit.tool_result", {
            tool_call_id: toolCall.id,
            status: "denied",
            output: deniedOutput,
          }, modelCall);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              status: "denied",
              output: deniedOutput,
            }),
          });
          continue;
        }
      }

      const result = await toolExecutor.execute(
        auth,
        buildToolContext(options.memoryRoot, auth, request.metadata.correlation_id),
        toolCall.name,
        toolCall.input
      );

      yield* toolResultEvents(result, toolCall.id);
      await options.promptAudit?.recorder.append("prompt_audit.tool_result", {
        tool_call_id: toolCall.id,
        status: result.status,
        output: result.output,
      }, modelCall);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify({
          status: result.status,
          output: result.output,
        }),
      });

      if (result.status === "error" && result.recoverable === false) {
        yield {
          type: "error",
          code: "tool_error",
          message: "Tool execution failed",
        };
        return;
      }

      trackNonDestructiveMutationPath(tool.name, tool.readOnly, toolCall.input, result.status, recentNonDestructiveMutationPaths);
    }
  }
}

function serializeToolDefinitionForAudit(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    requiresApproval: tool.requiresApproval,
    readOnly: tool.readOnly,
    inputSchema: tool.inputSchema,
  };
}

function isEmptyCompletion(completion: {
  assistantText: string;
  toolCalls: unknown[];
}): boolean {
  return completion.assistantText.trim().length === 0 && completion.toolCalls.length === 0;
}

async function appendModelResponseAudit(
  options: LoopOptions,
  completion: {
    assistantText: string;
    toolCalls: unknown[];
    finishReason: string;
    usage?: unknown;
    cost?: unknown;
  },
  modelCall: ModelCallAuditContext
): Promise<void> {
  await options.promptAudit?.recorder.append(
    "prompt_audit.model_response",
    {
      assistant_text: completion.assistantText,
      tool_calls: completion.toolCalls,
      finish_reason: completion.finishReason,
      usage: completion.usage ?? null,
      cost: completion.cost ?? { status: "unavailable" },
    },
    modelCall
  );
}

async function appendEmptyCompletionRetryAudit(
  options: LoopOptions,
  completion: {
    finishReason: string;
    usage?: unknown;
    cost?: unknown;
  },
  modelCall: ModelCallAuditContext,
  attempt: number,
  retryExhausted: boolean,
  streamedAssistantText: boolean
): Promise<void> {
  await options.promptAudit?.recorder.append(
    "prompt_audit.empty_completion_retry",
    {
      reason: "empty_completion",
      attempt,
      max_retries: EMPTY_COMPLETION_MAX_RETRIES,
      retry_exhausted: retryExhausted,
      finish_reason: completion.finishReason,
      streamed_assistant_text: streamedAssistantText,
      usage: completion.usage ?? null,
      cost: completion.cost ?? { status: "unavailable" },
    },
    modelCall
  );
}

async function* toolResultEvents(result: ToolExecutionResult, toolCallId: string): AsyncGenerator<StreamEvent> {
  yield {
    type: "tool-result",
    id: toolCallId,
    status: result.status,
    output: result.output,
  };
}

function classifyError(error: unknown): StreamEvent {
  return classifyProviderError(error);
}

function stableToolInput(input: Record<string, unknown>): string {
  return JSON.stringify(sortObjectKeys(input));
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeys(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((accumulator, key) => {
      accumulator[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
      return accumulator;
    }, {});
}

function checkMutationScopeGuard(
  toolName: string,
  readOnly: boolean,
  input: Record<string, unknown>,
  recentNonDestructiveMutationPaths: string[]
): { path: string; conflictingPath: string } | null {
  if (readOnly || !isDestructiveToolName(toolName)) {
    return null;
  }

  const candidatePath = normalizeToolPath(input.path);
  if (!candidatePath) {
    return null;
  }

  const conflictingPath = recentNonDestructiveMutationPaths.find((recentPath) => pathsOverlap(candidatePath, recentPath));
  if (!conflictingPath) {
    return null;
  }

  return {
    path: candidatePath,
    conflictingPath,
  };
}

function trackNonDestructiveMutationPath(
  toolName: string,
  readOnly: boolean,
  input: Record<string, unknown>,
  status: ToolExecutionResult["status"],
  recentNonDestructiveMutationPaths: string[]
): void {
  if (readOnly || status !== "ok" || isDestructiveToolName(toolName)) {
    return;
  }

  const candidatePath = normalizeToolPath(input.path);
  if (!candidatePath) {
    return;
  }

  if (!recentNonDestructiveMutationPaths.includes(candidatePath)) {
    recentNonDestructiveMutationPaths.push(candidatePath);
  }
}

function normalizeToolPath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
  return normalized.length > 0 ? normalized : null;
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function isDestructiveToolName(toolName: string): boolean {
  return toolName.includes("delete") || toolName.endsWith("_remove") || toolName.endsWith("_destroy");
}
