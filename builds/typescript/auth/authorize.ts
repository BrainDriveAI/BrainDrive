import type { AuthContext, ToolDefinition } from "../contracts.js";

export function authorize(auth: AuthContext, permission: keyof AuthContext["permissions"]): void {
  if (!auth.permissions[permission]) {
    throw new Error(`Unauthorized for ${permission}`);
  }
}

export function authorizeToolUse(auth: AuthContext, tool: ToolDefinition): void {
  if (!canUseTool(auth, tool)) {
    throw new Error(`Unauthorized for tool ${tool.name}`);
  }
}

export function authorizeApprovalDecision(auth: AuthContext): void {
  authorize(auth, "approval_authority");
}

export function canUseTool(auth: AuthContext, tool: ToolDefinition): boolean {
  if (!auth.permissions.tool_access) {
    return false;
  }

  if (tool.name.startsWith("memory_") && !auth.permissions.memory_access) {
    return false;
  }

  if (tool.name.startsWith("project_") && !auth.permissions.memory_access) {
    return false;
  }

  if (tool.name.startsWith("auth_") && !auth.permissions.administration) {
    return false;
  }

  return true;
}
