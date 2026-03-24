import type { AuditLogEvent } from "./contracts.js";

export function auditLog(event: string, details: Record<string, unknown>): void {
  const sanitizedDetails = sanitizeForAudit(details);
  const payload: AuditLogEvent = {
    timestamp: new Date().toISOString(),
    event,
    details: sanitizedDetails,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sanitizeForAudit(details: Record<string, unknown>): Record<string, unknown> {
  return sanitizeUnknown(details) as Record<string, unknown>;
}

function sanitizeUnknown(value: unknown, keyPath: string[] = []): unknown {
  if (typeof value === "string") {
    return redactSensitiveString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item, keyPath));
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

    sanitized[key] = sanitizeUnknown(nestedValue, [...keyPath, key]);
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
