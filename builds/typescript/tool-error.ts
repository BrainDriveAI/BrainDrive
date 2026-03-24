export type ToolFailureCode =
  | "not_found"
  | "path_invalid"
  | "reserved_path"
  | "invalid_input"
  | "permission_denied"
  | "execution_failed";

export class ToolExecutionFailure extends Error {
  constructor(
    public readonly code: ToolFailureCode,
    message: string,
    public readonly recoverable = true
  ) {
    super(message);
    this.name = "ToolExecutionFailure";
  }
}

export function toToolFailure(error: unknown): ToolExecutionFailure {
  if (error instanceof ToolExecutionFailure) {
    return error;
  }

  const systemCode = getErrnoCode(error);
  if (systemCode === "ENOENT") {
    return new ToolExecutionFailure("not_found", "Requested path not found");
  }

  if (systemCode === "EACCES" || systemCode === "EPERM") {
    return new ToolExecutionFailure("permission_denied", "Permission denied for requested path", false);
  }

  const message = error instanceof Error ? error.message : "Tool execution failed";
  return new ToolExecutionFailure("execution_failed", message, false);
}

function getErrnoCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as { code?: unknown };
  return typeof candidate.code === "string" ? candidate.code : undefined;
}
