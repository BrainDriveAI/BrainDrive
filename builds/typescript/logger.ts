import path from "node:path";
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";

import type { AuditLogEvent } from "./contracts.js";

const DEFAULT_AUDIT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_AUDIT_RETENTION_DAYS = 14;
const MAX_AUDIT_RETENTION_DAYS = 3650;
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const AUDIT_FILE_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.jsonl$/;

type AuditFileSinkOptions = {
  maxFileBytes?: number;
  retentionDays?: number;
};

type AuditFileSinkState = {
  auditDir: string;
  maxFileBytes: number;
  retentionDays: number;
  nextSweepAtMs: number;
};

let auditFileSinkState: AuditFileSinkState | null = null;

export function configureAuditFileSink(memoryRoot: string, options: AuditFileSinkOptions = {}): void {
  const maxFileBytes = normalizePositiveInt(options.maxFileBytes, DEFAULT_AUDIT_MAX_FILE_BYTES);
  const retentionDays = clampInt(
    normalizePositiveInt(options.retentionDays, DEFAULT_AUDIT_RETENTION_DAYS),
    1,
    MAX_AUDIT_RETENTION_DAYS
  );
  const auditDir = path.resolve(memoryRoot, "diagnostics", "audit");

  try {
    mkdirSync(auditDir, { recursive: true });
    auditFileSinkState = {
      auditDir,
      maxFileBytes,
      retentionDays,
      nextSweepAtMs: 0,
    };
    runRetentionSweep(Date.now());
  } catch (error) {
    auditFileSinkState = null;
    process.stderr.write(`[audit] file sink disabled: ${toErrorMessage(error)}\n`);
  }
}

export function disableAuditFileSink(): void {
  auditFileSinkState = null;
}

export function auditLog(event: string, details: Record<string, unknown>): void {
  const sanitizedDetails = sanitizeForAudit(details);
  const payload: AuditLogEvent = {
    timestamp: new Date().toISOString(),
    event,
    details: sanitizedDetails,
  };

  const line = `${JSON.stringify(payload)}\n`;
  process.stdout.write(line);
  appendAuditFileLine(line, payload.timestamp);
}

function appendAuditFileLine(line: string, isoTimestamp: string): void {
  const sink = auditFileSinkState;
  if (!sink) {
    return;
  }

  try {
    const nowMs = Date.now();
    if (nowMs >= sink.nextSweepAtMs) {
      runRetentionSweep(nowMs);
    }

    const dateSegment = normalizeDateSegment(isoTimestamp);
    const byteLength = Buffer.byteLength(line, "utf8");
    writeAuditLineWithRotation(sink, line, dateSegment, byteLength);
  } catch (error) {
    process.stderr.write(`[audit] failed to persist audit log: ${toErrorMessage(error)}\n`);
  }
}

function writeAuditLineWithRotation(
  sink: AuditFileSinkState,
  line: string,
  dateSegment: string,
  byteLength: number
): void {
  try {
    const targetFilePath = resolveWritableAuditFilePath(sink, dateSegment, byteLength);
    appendFileSync(targetFilePath, line, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
    mkdirSync(sink.auditDir, { recursive: true });
    const targetFilePath = resolveWritableAuditFilePath(sink, dateSegment, byteLength);
    appendFileSync(targetFilePath, line, "utf8");
  }
}

function runRetentionSweep(nowMs: number): void {
  const sink = auditFileSinkState;
  if (!sink) {
    return;
  }

  const cutoff = beginningOfUtcDay(new Date(nowMs));
  cutoff.setUTCDate(cutoff.getUTCDate() - sink.retentionDays + 1);

  const entries = readdirSync(sink.auditDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const parsedDate = parseAuditFileDate(entry.name);
    if (!parsedDate) {
      continue;
    }

    if (parsedDate.getTime() < cutoff.getTime()) {
      unlinkSync(path.join(sink.auditDir, entry.name));
    }
  }

  sink.nextSweepAtMs = nowMs + RETENTION_SWEEP_INTERVAL_MS;
}

function parseAuditFileDate(fileName: string): Date | null {
  const match = AUDIT_FILE_NAME_PATTERN.exec(fileName);
  if (!match) {
    return null;
  }

  const dateValue = match[1];
  const parsed = new Date(`${dateValue}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function resolveWritableAuditFilePath(
  sink: AuditFileSinkState,
  dateSegment: string,
  incomingBytes: number
): string {
  for (let segment = 0; segment < 10000; segment += 1) {
    const fileName = segment === 0 ? `${dateSegment}.jsonl` : `${dateSegment}.${segment}.jsonl`;
    const filePath = path.join(sink.auditDir, fileName);
    const existingSize = getExistingFileSize(filePath);
    if (existingSize === 0 && incomingBytes > sink.maxFileBytes) {
      return filePath;
    }
    if (existingSize + incomingBytes <= sink.maxFileBytes) {
      return filePath;
    }
  }

  throw new Error(`Unable to rotate audit logs for ${dateSegment}; segment limit reached`);
}

function getExistingFileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

function beginningOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function normalizeDateSegment(isoTimestamp: string): string {
  if (isoTimestamp.length >= 10) {
    return isoTimestamp.slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "unknown error";
}

function sanitizeForAudit(details: Record<string, unknown>): Record<string, unknown> {
  return sanitizeUnknown(details) as Record<string, unknown>;
}

function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item));
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

    sanitized[key] = sanitizeUnknown(nestedValue);
  }
  return sanitized;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (normalized.endsWith("_ref") || normalized.endsWith("_id")) {
    return false;
  }

  if (
    normalized === "authorization" ||
    normalized === "api_key" ||
    normalized === "token" ||
    normalized === "password" ||
    normalized === "secret" ||
    normalized === "secret_value" ||
    normalized === "key_b64" ||
    normalized === "ciphertext" ||
    normalized === "nonce" ||
    normalized === "tag" ||
    normalized === "private_key"
  ) {
    return true;
  }

  return (
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
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, "[REDACTED]");
}
