import type { AuthContext, ToolContext, ToolDefinition, ToolExecutionResult } from "../contracts.js";
import { authorizeToolUse, canUseTool } from "../auth/authorize.js";
import { auditLog } from "../logger.js";
import { toToolFailure } from "../tool-error.js";

export class ToolExecutor {
  private readonly registry = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[]) {
    tools.forEach((tool) => {
      this.registry.set(tool.name, tool);
    });
  }

  listTools(auth: AuthContext): ToolDefinition[] {
    return Array.from(this.registry.values()).filter((tool) => canUseTool(auth, tool));
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.registry.get(name);
  }

  async execute(
    auth: AuthContext,
    context: ToolContext,
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    const tool = this.registry.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    authorizeToolUse(auth, tool);

    auditLog("tool.call", { tool: tool.name, correlation_id: context.correlationId });

    try {
      const output = await tool.execute(context, input);
      auditLog("tool.result", { tool: tool.name, status: "ok", correlation_id: context.correlationId });
      return { status: "ok", output };
    } catch (error) {
      const failure = toToolFailure(error);
      auditLog("tool.result", {
        tool: tool.name,
        status: "error",
        correlation_id: context.correlationId,
        message: failure.message,
        code: failure.code,
        recoverable: failure.recoverable,
      });
      return {
        status: "error",
        output: {
          code: failure.code,
          message: failure.message,
          recoverable: failure.recoverable,
        },
        recoverable: failure.recoverable,
      };
    }
  }
}
