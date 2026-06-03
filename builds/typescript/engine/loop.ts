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

const DEFAULT_MAX_TOOL_RESULT_MODEL_CHARS = 16_000;
const EMPTY_COMPLETION_REPAIR_INSTRUCTION = [
  "Recovery mode: the previous model call ended without visible assistant text or tool calls.",
  "Answer the owner's latest request now with concise, owner-visible text.",
  "Start with a useful first-pass result from the context already available.",
  "Do not plan silently. Do not use tools in this recovery attempt.",
  "If a complete artifact would require more work, give the best partial answer and state the next step.",
].join(" ");
const EMPTY_COMPLETION_ERROR_MESSAGE = [
  "The assistant could not finish that reply, but your conversation and uploaded files are still here.",
  "Try again to continue from the saved files.",
].join("\n");
const EMPTY_COMPLETION_REPAIR_CONTEXT_KEY = "empty_completion_repair";

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
  let emptyCompletionRepairAttempted = false;

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
    const modelCall: ModelCallAuditContext = {
      model_call_id: crypto.randomUUID(),
      model_call_index: iteration,
    };
    try {
      const isEmptyCompletionRepairTurn = emptyCompletionRepairAttempted;
      const tools = isEmptyCompletionRepairTurn ? [] : toolExecutor.listTools(auth);
      const modelRequest: GatewayEngineRequest = isEmptyCompletionRepairTurn
        ? {
            ...request,
            messages,
            metadata: {
              ...request.metadata,
              client_context: {
                ...(request.metadata.client_context ?? {}),
                [EMPTY_COMPLETION_REPAIR_CONTEXT_KEY]: true,
              },
            },
          }
        : {
            ...request,
            messages,
          };
      await options.promptAudit?.recorder.append(
        "prompt_audit.model_request",
        {
          adapter_name: options.promptAudit.adapterName,
          provider_profile: options.promptAudit.providerProfile ?? null,
          selected_model: options.promptAudit.model ?? null,
          metadata: modelRequest.metadata,
          recovery_mode: isEmptyCompletionRepairTurn ? EMPTY_COMPLETION_REPAIR_CONTEXT_KEY : null,
          messages,
          tools: tools.map((tool) => serializeToolDefinitionForAudit(tool)),
        },
        modelCall
      );
      if (adapter.completeStream) {
        for await (const chunk of adapter.completeStream(
          modelRequest,
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
          modelRequest,
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

    if (isEmptyFinalModelTurn(completion, streamedAssistantText)) {
      await options.promptAudit?.recorder.append(
        "prompt_audit.empty_completion",
        {
          finish_reason: completion.finishReason,
          usage: completion.usage ?? null,
          retry_attempted: emptyCompletionRepairAttempted,
        },
        modelCall
      );
      auditLog("provider.empty_completion", {
        correlation_id: request.metadata.correlation_id,
        conversation_id: request.metadata.conversation_id,
        finish_reason: completion.finishReason,
        retry_attempted: emptyCompletionRepairAttempted,
        usage: completion.usage ?? null,
      });

      if (!emptyCompletionRepairAttempted) {
        emptyCompletionRepairAttempted = true;
        messages.push({
          role: "user",
          content: EMPTY_COMPLETION_REPAIR_INSTRUCTION,
        });
        continue;
      }

      yield {
        type: "error",
        code: "provider_error",
        message: EMPTY_COMPLETION_ERROR_MESSAGE,
      };
      return;
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
        const modelToolContent = compactToolResultForModel({
          status: "error",
          output: unavailableOutput,
        });
        await appendToolResultCompactionAudit(options.promptAudit?.recorder, toolCall.id, modelToolContent, modelCall);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: modelToolContent.content,
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
        const modelToolContent = compactToolResultForModel({
          status: "error",
          output: loopGuardOutput,
        });
        await appendToolResultCompactionAudit(options.promptAudit?.recorder, toolCall.id, modelToolContent, modelCall);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: modelToolContent.content,
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
        const modelToolContent = compactToolResultForModel({
          status: guardedResult.status,
          output: guardedResult.output,
        });
        await appendToolResultCompactionAudit(options.promptAudit?.recorder, toolCall.id, modelToolContent, modelCall);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: modelToolContent.content,
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
        const modelToolContent = compactToolResultForModel({
          status: "error",
          output: guardOutput,
        });
        await appendToolResultCompactionAudit(options.promptAudit?.recorder, toolCall.id, modelToolContent, modelCall);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: modelToolContent.content,
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
          const modelToolContent = compactToolResultForModel({
            status: "denied",
            output: deniedOutput,
          });
          await appendToolResultCompactionAudit(options.promptAudit?.recorder, toolCall.id, modelToolContent, modelCall);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: modelToolContent.content,
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
      const modelToolContent = compactToolResultForModel({
        status: result.status,
        output: result.output,
      });
      await appendToolResultCompactionAudit(options.promptAudit?.recorder, toolCall.id, modelToolContent, modelCall);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: modelToolContent.content,
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

function compactToolResultForModel(result: {
  status: ToolExecutionResult["status"];
  output: unknown;
}): { content: string; compacted: boolean; originalChars: number; modelChars: number; maxChars: number } {
  const maxChars = resolveMaxToolResultModelChars();
  const serialized = JSON.stringify(result);
  if (serialized.length <= maxChars) {
    return {
      content: serialized,
      compacted: false,
      originalChars: serialized.length,
      modelChars: serialized.length,
      maxChars,
    };
  }

  const compactedResult = {
    status: result.status,
    output: compactLargeOutput(result.output, maxChars),
  };
  const content = JSON.stringify(compactedResult);
  return {
    content,
    compacted: true,
    originalChars: serialized.length,
    modelChars: content.length,
    maxChars,
  };
}

function compactLargeOutput(output: unknown, maxChars: number): unknown {
  if (typeof output === "string") {
    return compactString(output, maxChars);
  }

  if (Array.isArray(output)) {
    return output.slice(0, 20).map((item) => compactLargeOutput(item, Math.max(500, Math.floor(maxChars / 20))));
  }

  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    const compacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === "content" && typeof value === "string") {
        compacted[key] = compactString(value, maxChars);
      } else if (Array.isArray(value)) {
        compacted[key] = value.slice(0, 20).map((item) =>
          compactLargeOutput(item, Math.max(500, Math.floor(maxChars / 20)))
        );
        if (value.length > 20) {
          compacted[`${key}_omitted`] = value.length - 20;
        }
      } else if (typeof value === "string") {
        compacted[key] = compactString(value, Math.min(maxChars, 2_000));
      } else {
        compacted[key] = value;
      }
    }
    compacted._model_context_compacted = true;
    compacted._compaction_note = "Tool result shortened before the next model call; full result remains in prompt audit and streamed tool result.";
    return compacted;
  }

  return output;
}

function compactString(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const marker = `\n...[truncated ${value.length - maxChars} chars from tool result for model context]...\n`;
  const remaining = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(remaining * 0.7);
  const tail = Math.max(0, remaining - head);
  return `${value.slice(0, head)}${marker}${value.slice(value.length - tail)}`;
}

async function appendToolResultCompactionAudit(
  recorder: PromptAuditRecorder | undefined,
  toolCallId: string,
  compaction: ReturnType<typeof compactToolResultForModel>,
  modelCall: ModelCallAuditContext
): Promise<void> {
  if (!compaction.compacted) {
    return;
  }

  await recorder?.append("prompt_audit.tool_result_compacted", {
    tool_call_id: toolCallId,
    original_chars: compaction.originalChars,
    model_chars: compaction.modelChars,
    max_chars: compaction.maxChars,
  }, modelCall);
}

function resolveMaxToolResultModelChars(): number {
  const parsed = Number.parseInt(process.env.BRAINDRIVE_MAX_TOOL_RESULT_MODEL_CHARS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_TOOL_RESULT_MODEL_CHARS;
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

function isEmptyFinalModelTurn(
  completion: { assistantText: string; toolCalls: unknown[] },
  streamedAssistantText: boolean
): boolean {
  return !streamedAssistantText &&
    completion.assistantText.trim().length === 0 &&
    completion.toolCalls.length === 0;
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
