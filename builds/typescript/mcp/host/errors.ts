export type McpHostErrorCode =
  | "protocol_incompatible"
  | "extension_incompatible"
  | "negotiation_failed"
  | "connection_unavailable"
  | "connection_closed"
  | "connection_stale"
  | "reconnect_exhausted"
  | "request_timeout"
  | "request_cancelled"
  | "duplicate_request"
  | "late_response"
  | "ambiguous_tool_outcome"
  | "catalog_invalid"
  | "envelope_malformed"
  | "envelope_oversized"
  | "visibility_denied"
  | "cross_server_denied"
  | "tool_not_found"
  | "resource_not_found"
  | "resource_uri_invalid"
  | "resource_mime_invalid"
  | "resource_oversized"
  | "resource_redirect_denied"
  | "resource_integrity_mismatch"
  | "resource_cache_mismatch";

export class McpHostError extends Error {
  constructor(
    public readonly code: McpHostErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "McpHostError";
  }
}

export function asMcpHostError(error: unknown, fallback: McpHostErrorCode, message: string): McpHostError {
  if (error instanceof McpHostError) return error;
  if (isAbortError(error)) return new McpHostError("request_cancelled", "MCP request was cancelled", false, error);
  if (isTimeoutError(error)) return new McpHostError("request_timeout", "MCP request exceeded its deadline", true, error);
  return new McpHostError(fallback, message, fallback === "connection_unavailable", error);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message === "This operation was aborted");
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || /timed?\s*out|timeout/i.test(error.message);
}
