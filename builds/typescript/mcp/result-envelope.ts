import { randomUUID } from "node:crypto";

import type { z } from "zod";

import {
  McpContentBlockSchema,
} from "../app-platform/contracts/mcp-app.js";
import { Spec05CompleteResultSchema } from "../app-platform/contracts/spec-05-foundation.js";
import {
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSION,
} from "../app-platform/contracts/constants.js";

export type CompleteMcpResult = z.infer<typeof Spec05CompleteResultSchema>;
export type McpResultConsumer = "model" | "app";
export type McpToolVisibility = McpResultConsumer;

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
  toolVisibility?: McpToolVisibility[];
};

export function preserveMcpResult(result: RawMcpCallResult, options: PreserveOptions): CompleteMcpResult {
  const content = (result.content ?? []).map((block) => McpContentBlockSchema.parse(block));
  const structuredError = result.structuredContent as { code?: unknown; message?: unknown; recoverable?: unknown } | undefined;
  const isError = result.isError === true;
  const error = isError
    ? {
        category: errorCategory(structuredError?.code),
        protocol_code: typeof structuredError?.code === "number" ? structuredError.code : null,
        safe_message: typeof structuredError?.message === "string" && structuredError.message.trim()
          ? structuredError.message
          : "MCP tool returned an error result",
        retryable: typeof structuredError?.recoverable === "boolean" ? structuredError.recoverable : false,
      }
    : null;
  const meta = result.toolResult === undefined
    ? result._meta
    : { ...(result._meta ?? {}), legacy: { toolResult: result.toolResult } };
  const toolVisibility = normalizeVisibility(options.toolVisibility);
  const modelVisibleContentIndices: number[] = [];
  const appVisibleContentIndices: number[] = [];
  content.forEach((block, index) => {
    const visibility = visibilityFromMeta(block._meta, toolVisibility);
    if (visibility.includes("model")) modelVisibleContentIndices.push(index);
    if (visibility.includes("app")) appVisibleContentIndices.push(index);
  });
  const structuredVisibility = visibilityFromMeta(result._meta, toolVisibility);

  return Spec05CompleteResultSchema.parse({
    envelope_version: 1,
    result_type: "complete",
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
    error,
    projections: {
      model_visible_content_indices: modelVisibleContentIndices,
      app_visible_content_indices: appVisibleContentIndices,
      model_structured_content: result.structuredContent !== undefined && structuredVisibility.includes("model"),
      app_structured_content: result.structuredContent !== undefined && structuredVisibility.includes("app"),
    },
  });
}

export type McpResultProjection = {
  consumer: McpResultConsumer;
  request_id: CompleteMcpResult["request_id"];
  operation_id: string;
  connection_id: string;
  content: CompleteMcpResult["content"];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError: boolean;
  error: CompleteMcpResult["error"];
  progress_token?: string | number | null;
  cancellation_id?: string | null;
};

export function projectMcpResult(result: CompleteMcpResult, consumer: McpResultConsumer): McpResultProjection {
  const indices = consumer === "model"
    ? result.projections.model_visible_content_indices
    : result.projections.app_visible_content_indices;
  const includeStructured = consumer === "model"
    ? result.projections.model_structured_content
    : result.projections.app_structured_content;
  return {
    consumer,
    request_id: result.request_id,
    operation_id: result.operation_id,
    connection_id: result.connection_id,
    content: indices.map((index) => result.content[index]!),
    ...(includeStructured && result.structuredContent !== undefined
      ? { structuredContent: result.structuredContent }
      : {}),
    ...(consumer === "app" && result._meta !== undefined ? { _meta: result._meta } : {}),
    isError: result.isError,
    error: result.error,
    ...(consumer === "app"
      ? { progress_token: result.progress_token, cancellation_id: result.cancellation_id }
      : {}),
  };
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

function normalizeVisibility(value: McpToolVisibility[] | undefined): McpToolVisibility[] {
  const visibility = value ?? ["model", "app"];
  return [...new Set(visibility)].filter((item): item is McpToolVisibility => item === "model" || item === "app");
}

function visibilityFromMeta(
  meta: Record<string, unknown> | undefined,
  fallback: McpToolVisibility[],
): McpToolVisibility[] {
  const ui = meta?.ui;
  if (!ui || typeof ui !== "object") return fallback;
  const raw = (ui as { visibility?: unknown }).visibility;
  if (!Array.isArray(raw)) return fallback;
  const parsed = raw.filter((item): item is McpToolVisibility => item === "model" || item === "app");
  return parsed.length > 0 ? [...new Set(parsed)] : fallback;
}

function errorCategory(code: unknown): CompleteMcpResult["error"] extends infer ErrorValue
  ? ErrorValue extends { category: infer Category } ? Category : never
  : never {
  if (typeof code === "string") {
    if (code.includes("cancel")) return "cancelled";
    if (code.includes("timeout")) return "timeout";
    if (code.includes("unavailable")) return "unavailable";
    if (code.includes("not_found")) return "not_found";
    if (code.includes("permission") || code.includes("unauthorized")) return "unauthorized";
    if (code.includes("forbidden") || code.includes("denied")) return "forbidden";
    if (code.includes("conflict")) return "conflict";
  }
  return "internal";
}
