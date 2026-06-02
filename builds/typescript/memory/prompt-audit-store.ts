import path from "node:path";
import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";

import type { Preferences, PromptAuditDetail, PromptAuditPreference } from "../contracts.js";
import { auditLog } from "../logger.js";

const DEFAULT_PROMPT_AUDIT: PromptAuditPreference = {
  enabled: false,
  detail: "standard",
  retention_days: 14,
  max_file_bytes: 5 * 1024 * 1024,
  include_provider_payload: true,
  include_provider_response: true,
  include_source_snapshots: true,
};

const MAX_RETENTION_DAYS = 3650;
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const AUDIT_FILE_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.jsonl$/;

export type ModelCallAuditContext = {
  model_call_id: string;
  model_call_index: number;
};

export type PromptAuditEventName =
  | "prompt_audit.trace_started"
  | "prompt_audit.assembly"
  | "prompt_audit.model_request"
  | "prompt_audit.provider_request_preflight"
  | "prompt_audit.provider_request_blocked"
  | "prompt_audit.provider_request"
  | "prompt_audit.provider_response"
  | "prompt_audit.provider_lifecycle"
  | "prompt_audit.model_response"
  | "prompt_audit.tool_call"
  | "prompt_audit.tool_result"
  | "prompt_audit.tool_result_compacted"
  | "prompt_audit.response_guardrail"
  | "prompt_audit.trace_completed"
  | "prompt_audit.error";

export type PromptAuditRecorder = {
  readonly traceId: string;
  readonly conversationId: string;
  readonly correlationId: string;
  readonly detail: PromptAuditDetail;
  readonly preferences: PromptAuditPreference;
  append(
    event: PromptAuditEventName,
    details?: Record<string, unknown>,
    modelCall?: ModelCallAuditContext
  ): Promise<void>;
};

type PromptAuditStoreOptions = {
  now?: () => Date;
};

export function resolvePromptAuditPreference(preferences: Preferences): PromptAuditPreference {
  const configured = preferences.prompt_audit;
  return {
    ...DEFAULT_PROMPT_AUDIT,
    ...(configured ?? {}),
    retention_days: clampInt(configured?.retention_days ?? DEFAULT_PROMPT_AUDIT.retention_days, 1, MAX_RETENTION_DAYS),
    max_file_bytes: normalizePositiveInt(configured?.max_file_bytes, DEFAULT_PROMPT_AUDIT.max_file_bytes),
  };
}

export function createPromptAuditRecorder(input: {
  memoryRoot: string;
  preferences: Preferences;
  traceId: string;
  conversationId: string;
  correlationId: string;
}): PromptAuditRecorder | null {
  const promptAudit = resolvePromptAuditPreference(input.preferences);
  if (!promptAudit.enabled) {
    return null;
  }

  return new PromptAuditStore(input.memoryRoot, promptAudit).createRecorder({
    traceId: input.traceId,
    conversationId: input.conversationId,
    correlationId: input.correlationId,
  });
}

export class PromptAuditStore {
  private readonly auditDir: string;
  private nextSweepAtMs = 0;

  constructor(
    memoryRoot: string,
    private readonly preferences: PromptAuditPreference,
    private readonly options: PromptAuditStoreOptions = {}
  ) {
    this.auditDir = path.resolve(memoryRoot, "diagnostics", "prompt-audit");
  }

  createRecorder(input: {
    traceId: string;
    conversationId: string;
    correlationId: string;
  }): PromptAuditRecorder {
    return {
      traceId: input.traceId,
      conversationId: input.conversationId,
      correlationId: input.correlationId,
      detail: this.preferences.detail,
      preferences: this.preferences,
      append: async (event, details = {}, modelCall) => {
        await this.append({
          schema_version: 1,
          timestamp: this.now().toISOString(),
          event,
          trace_id: input.traceId,
          conversation_id: input.conversationId,
          correlation_id: input.correlationId,
          ...(modelCall ?? {}),
          ...details,
        });
      },
    };
  }

  async append(record: Record<string, unknown>): Promise<void> {
    if (!this.preferences.enabled) {
      return;
    }

    try {
      await mkdir(this.auditDir, { recursive: true });
      const nowMs = this.now().getTime();
      if (nowMs >= this.nextSweepAtMs) {
        await this.runRetentionSweep(nowMs);
      }

      const sanitized = applyDetailPolicy(
        sanitizePromptAuditValue(record) as Record<string, unknown>,
        this.preferences.detail
      );
      const line = `${JSON.stringify(sanitized)}\n`;
      const dateSegment = normalizeDateSegment(String(sanitized.timestamp ?? this.now().toISOString()));
      const target = await this.resolveWritableFile(dateSegment, Buffer.byteLength(line, "utf8"));
      await appendFile(target, line, "utf8");
    } catch (error) {
      auditLog("prompt_audit.persist_failed", {
        message: error instanceof Error ? error.message : "Unknown prompt audit persistence error",
      });
    }
  }

  private async runRetentionSweep(nowMs: number): Promise<void> {
    const cutoff = beginningOfUtcDay(new Date(nowMs));
    cutoff.setUTCDate(cutoff.getUTCDate() - this.preferences.retention_days + 1);

    const entries = await readdir(this.auditDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const parsedDate = parseAuditFileDate(entry.name);
      if (parsedDate && parsedDate.getTime() < cutoff.getTime()) {
        await unlink(path.join(this.auditDir, entry.name)).catch(() => {});
      }
    }

    this.nextSweepAtMs = nowMs + RETENTION_SWEEP_INTERVAL_MS;
  }

  private async resolveWritableFile(dateSegment: string, incomingBytes: number): Promise<string> {
    for (let segment = 0; segment < 10000; segment += 1) {
      const fileName = segment === 0 ? `${dateSegment}.jsonl` : `${dateSegment}.${segment}.jsonl`;
      const filePath = path.join(this.auditDir, fileName);
      const existingSize = await getExistingFileSize(filePath);
      if (existingSize === 0 && incomingBytes > this.preferences.max_file_bytes) {
        return filePath;
      }
      if (existingSize + incomingBytes <= this.preferences.max_file_bytes) {
        return filePath;
      }
    }

    throw new Error(`Unable to rotate prompt audit logs for ${dateSegment}; segment limit reached`);
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

export function sanitizePromptAuditValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizePromptAuditValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key) && nestedValue !== undefined && nestedValue !== null) {
      sanitized[key] = "[REDACTED]";
      continue;
    }
    sanitized[key] = sanitizePromptAuditValue(nestedValue);
  }
  return sanitized;
}

function applyDetailPolicy(record: Record<string, unknown>, detail: PromptAuditDetail): Record<string, unknown> {
  if (detail !== "minimal") {
    return record;
  }

  return scrubVerboseContent(record) as Record<string, unknown>;
}

function scrubVerboseContent(value: unknown, parentKey = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => scrubVerboseContent(item, parentKey));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const contentKeys = new Set([
    "content",
    "messages",
    "tools",
    "engine_request",
    "final_system_prompt",
    "provider_request_body",
    "provider_response_body",
    "raw_stream_chunks",
    "assistant_text",
    "bootstrap_prompt",
    "generated_context",
  ]);

  const scrubbed: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (contentKeys.has(key) || contentKeys.has(parentKey)) {
      scrubbed[key] = "[OMITTED_BY_MINIMAL_PROMPT_AUDIT]";
      continue;
    }
    scrubbed[key] = scrubVerboseContent(nestedValue, key);
  }
  return scrubbed;
}

function parseAuditFileDate(fileName: string): Date | null {
  const match = AUDIT_FILE_NAME_PATTERN.exec(fileName);
  if (!match) {
    return null;
  }

  const parsed = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function getExistingFileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

function beginningOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function normalizeDateSegment(isoTimestamp: string): string {
  return isoTimestamp.length >= 10 ? isoTimestamp.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (normalized.endsWith("_ref") || normalized.endsWith("_id")) {
    return false;
  }

  return (
    normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "set-cookie" ||
    normalized === "api_key" ||
    normalized === "token" ||
    normalized === "password" ||
    normalized === "secret" ||
    normalized === "secret_value" ||
    normalized === "key_b64" ||
    normalized === "ciphertext" ||
    normalized === "nonce" ||
    normalized === "tag" ||
    normalized === "private_key" ||
    normalized.endsWith("_api_key") ||
    normalized.endsWith("_token") ||
    normalized.endsWith("_password") ||
    normalized.endsWith("_private_key")
  );
}

function redactSensitiveString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/([?&](?:api[_-]?key|token|password|secret)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, "[REDACTED]");
}
