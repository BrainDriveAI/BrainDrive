import type { AuthContext, AuthService, ToolContext, ToolDefinition, ToolExecutionResult } from "../contracts.js";
import { authorizeToolUse, canUseTool } from "../auth/authorize.js";
import { evaluateAuthorization } from "../auth/policy.js";
import { auditLog, auditLogRequired } from "../logger.js";
import { toToolFailure } from "../tool-error.js";

export class ToolExecutor {
  private readonly registry = new Map<string, ToolDefinition>();
  private readonly authService?: AuthService;
  private readonly requireDurableAudit: boolean;

  constructor(tools: ToolDefinition[], options: { authService?: AuthService; requireDurableAudit?: boolean } = {}) {
    this.authService = options.authService;
    this.requireDurableAudit = options.requireDurableAudit ?? false;
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

    if (!context.paaAuthContext) {
      return { status: "error", output: { code: "auth_unavailable", message: "not permitted" }, recoverable: false };
    }

    const decision = this.authService
      ? await this.authService.authorize({
          actor: context.paaAuthContext.actor,
          resource: "tool",
          action: "execute",
          resource_id: name,
          correlation_id: context.correlationId,
        })
      : evaluateAuthorization({
          actor: context.paaAuthContext.actor,
          resource: "tool",
          action: "execute",
          resource_id: name,
          correlation_id: context.correlationId,
        });
    if (!decision.allowed) {
      auditLog("tool.denied", { tool: tool.name, reason: decision.reason, correlation_id: context.correlationId });
      return { status: "denied", output: { code: "not_permitted", message: "not permitted" }, recoverable: false };
    }

    // Legacy permission checks remain a compatibility guard, never the policy authority.
    authorizeToolUse(auth, tool);

    if (this.requireDurableAudit) {
      auditLogRequired("tool.call", {
        actor_id: context.paaAuthContext.actor.id,
        resource: "tool",
        action: "execute",
        tool: tool.name,
        correlation_id: context.correlationId,
      });
    } else {
      auditLog("tool.call", { tool: tool.name, correlation_id: context.correlationId });
    }

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
