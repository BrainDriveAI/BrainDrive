import { randomUUID } from "node:crypto";

import type { z } from "zod";

import {
  CompleteMcpResultSchema,
  McpContentBlockSchema,
} from "../app-platform/contracts/mcp-app.js";
import {
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSION,
} from "../app-platform/contracts/constants.js";

export type CompleteMcpResult = z.infer<typeof CompleteMcpResultSchema>;

export type RawMcpCallResult = {
  content?: unknown[];
  structuredContent?: Record<string, unknown>;
  toolResult?: unknown;
  _meta?: Record<string, unknown>;
  isError?: boolean;
};

type PreserveOptions = {
  protocolVersion: typeof MCP_MODERN_PROTOCOL_VERSION | typeof MCP_LEGACY_PROTOCOL_VERSION;
  connectionId: string;
  requestId: string | number;
  operationId?: string;
  progressToken?: string | number | null;
  cancellationId?: string | null;
};

export function preserveMcpResult(result: RawMcpCallResult, options: PreserveOptions): CompleteMcpResult {
  const content = (result.content ?? []).map((block) => McpContentBlockSchema.parse(block));
  const structuredError = result.structuredContent as { code?: unknown; message?: unknown } | undefined;
  const isError = result.isError === true;
  const protocolError = isError
    ? {
        code: typeof structuredError?.code === "number" ? structuredError.code : -32_000,
        message: typeof structuredError?.message === "string" && structuredError.message.trim()
          ? structuredError.message
          : "MCP tool returned an error result",
      }
    : null;
  const meta = result.toolResult === undefined
    ? result._meta
    : { ...(result._meta ?? {}), legacy: { toolResult: result.toolResult } };

  return CompleteMcpResultSchema.parse({
    envelope_version: 1,
    protocol_version: options.protocolVersion,
    connection_id: options.connectionId,
    request_id: options.requestId,
    operation_id: options.operationId ?? randomUUID(),
    content,
    ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
    ...(meta ? { _meta: meta } : {}),
    isError,
    progress_token: options.progressToken ?? null,
    cancellation_id: options.cancellationId ?? null,
    protocol_error: protocolError,
  });
}

/** Existing agent tools deliberately receive the historical lossy projection. */
export function projectLegacyToolResult(result: RawMcpCallResult): unknown {
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }

  if (result.toolResult !== undefined) {
    return result.toolResult;
  }

  const textBlock = result.content?.find(
    (item): item is { type: "text"; text: string } =>
      typeof item === "object" && item !== null &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string",
  );
  if (textBlock?.text) {
    try {
      const parsed = JSON.parse(textBlock.text) as unknown;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Plain text remains a supported legacy tool result.
    }
    return { text: textBlock.text };
  }

  return {};
}
