import { z } from "zod";

import { OpaqueIdSchema, TimestampSchema } from "./common.js";

export const ContractErrorCodeSchema = z.enum([
  "invalid_input",
  "not_found_within_scope",
  "denied",
  "conflict",
  "idempotency_conflict",
  "incompatible_schema",
  "incompatible_version",
  "invalid_state_transition",
  "duplicate_identity",
  "unknown_purpose",
  "malformed_envelope",
  "envelope_too_large",
  "widened_grant",
  "forbidden_field",
  "package_source_untrusted",
  "package_descriptor_invalid",
  "package_archive_invalid",
  "package_digest_mismatch",
  "package_signature_invalid",
  "package_file_mismatch",
  "signing_key_untrusted",
  "source_index_rollback",
  "revocation_metadata_invalid",
  "revocation_rollback",
  "package_revoked",
  "supervisor_descriptor_invalid",
  "runtime_conflict",
  "readiness_failed",
  "runtime_unhealthy",
  "stop_unacknowledged",
  "ambiguous_runtime_state",
  "restart_exhausted",
  "cancelled",
  "deadline_exceeded",
  "provider_unavailable",
  "model_incompatible",
  "schema_validation_failed",
  "validation_failed",
  "resource_exhausted",
  "recoverable_internal_failure",
]);

export const ContractErrorSchema = z
  .object({
    error_version: z.literal(1),
    code: ContractErrorCodeSchema,
    safe_message: z.string().min(1).max(512),
    retryable: z.boolean(),
    correlation_id: OpaqueIdSchema,
    occurred_at: TimestampSchema,
    details: z
      .object({
        category: z.string().min(1).max(128),
        expected_version: z.string().max(64).optional(),
        observed_version: z.string().max(64).optional(),
        current_revision: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export class ContractViolation extends Error {
  readonly code: z.infer<typeof ContractErrorCodeSchema>;

  constructor(code: z.infer<typeof ContractErrorCodeSchema>, message: string) {
    super(message);
    this.name = "ContractViolation";
    this.code = code;
  }
}
