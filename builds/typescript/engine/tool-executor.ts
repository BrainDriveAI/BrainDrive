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

    // Only host-built installed-app definitions carry this metadata. Select
    // fields explicitly so neither model input nor returned content can attest.
    const metadata = tool.auditMetadata;
    const provenance = metadata?.source === "installed_app_action"
      && typeof metadata.app_id === "string" && typeof metadata.action_id === "string"
      ? { source: metadata.source, app_id: metadata.app_id, action_id: metadata.action_id }
      : undefined;

    auditLog("tool.call", { tool: tool.name, correlation_id: context.correlationId });

    try {
      const output = await tool.execute(context, input);
      auditLog("tool.result", { tool: tool.name, status: "ok", correlation_id: context.correlationId });
      return { status: "ok", output, ...(provenance ? { provenance } : {}) };
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
        ...(provenance ? { provenance } : {}),
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
