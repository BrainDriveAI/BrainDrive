import { z } from "zod";

import { OpaqueIdSchema, Sha256DigestSchema, TimestampSchema } from "./common.js";
import { CapabilityNameSchema } from "./package.js";
import { ContractViolation } from "./errors.js";

export const AuditEventNameSchema = z.enum([
  "app.package.source_checked",
  "app.package.verified",
  "app.revocation.refreshed",
  "app.revocation.enforced",
  "app.lifecycle.transition_requested",
  "app.lifecycle.transition_completed",
  "app.lifecycle.reconciled",
  "app.grant.changed",
  "app.token.revoked",
  "app.runtime.started",
  "app.runtime.readiness_completed",
  "app.runtime.health_changed",
  "app.runtime.stopped",
  "app.runtime.reconciled",
  "app.mcp.negotiation_completed",
  "app.mcp.resource_loaded",
  "app.mcp.session_opened",
  "app.mcp.bridge_decision",
  "app.update.checkpoint_completed",
  "app.cleanup.completed",
  "app.capability.completed",
  "app.inference.completed",
  "app.export.completed",
  "app.validation.completed",
  "app.migration.completed",
]);

export const AuditEventSchema = z
  .object({
    event_version: z.literal(1),
    event_id: OpaqueIdSchema,
    event_name: AuditEventNameSchema,
    occurred_at: TimestampSchema,
    correlation_id: OpaqueIdSchema,
    actor_id: OpaqueIdSchema,
    owner_id: OpaqueIdSchema,
    app_id: z.string().min(1).max(512),
    publisher_id: z.string().min(1).max(512),
    package_digest: Sha256DigestSchema.nullable(),
    installation_id: OpaqueIdSchema.nullable(),
    operation_id: OpaqueIdSchema.nullable(),
    capability: CapabilityNameSchema.nullable(),
    target_category: z.string().min(1).max(128).nullable(),
    target_id: OpaqueIdSchema.nullable(),
    input_revision: z.number().int().positive().nullable(),
    outcome: z.enum(["allowed", "denied", "committed", "cancelled", "conflict", "failed", "quarantined"]),
    error_code: z.string().min(1).max(128).nullable(),
    schema_version: z.number().int().positive().nullable(),
    duration_ms: z.number().int().nonnegative().nullable(),
    item_count: z.number().int().nonnegative().nullable(),
  })
  .strict();

const FORBIDDEN_KEY_PATTERN = /(^|_)(content|body|text|html|prompt|completion|resume|job_description|source_document|raw_path|path|destination|authorization|credential|api_key|token|secret|permission)(_|$)/i;
const RAW_PATH_PATTERN = /(?:^|\s)(?:[A-Za-z]:\\|\/(?:home|Users|var|tmp|etc)\/)/;
const CREDENTIAL_PATTERN = /(?:bearer\s+[A-Za-z0-9._~-]+|sk-[A-Za-z0-9_-]{12,})/i;

export function assertContentFreeAudit(value: unknown): asserts value is z.infer<typeof AuditEventSchema> {
  const visit = (candidate: unknown, key = ""): void => {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      throw new ContractViolation("forbidden_field", `Audit field ${key} is prohibited`);
    }
    if (typeof candidate === "string" && (RAW_PATH_PATTERN.test(candidate) || CREDENTIAL_PATTERN.test(candidate))) {
      throw new ContractViolation("forbidden_field", "Audit content contains a prohibited path or credential pattern");
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((item) => visit(item, key));
      return;
    }
    if (candidate && typeof candidate === "object") {
      for (const [childKey, childValue] of Object.entries(candidate)) {
        visit(childValue, childKey);
      }
    }
  };

  visit(value);
  const parsed = AuditEventSchema.safeParse(value);
  if (!parsed.success) {
    throw new ContractViolation("invalid_input", "Audit event failed the content-free schema");
  }
}
