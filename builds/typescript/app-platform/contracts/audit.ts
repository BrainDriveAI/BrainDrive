import { z } from "zod";

import { OpaqueIdSchema, SemverSchema, Sha256DigestSchema, TimestampSchema } from "./common.js";
import { RESUME_BUILDER_APP_ID, RESUME_BUILDER_PUBLISHER_ID } from "./constants.js";
import { CapabilityNameSchema } from "./package.js";
import { ContractErrorCodeSchema, ContractViolation } from "./errors.js";
import { LifecycleOperationStageSchema, LifecycleStateSchema } from "./lifecycle.js";

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
  "app.resume_recovery.save",
  "app.resume_recovery.restore",
  "app.resume_recovery.discard",
  "app.resume_recovery.conflict",
  "app.resume_interview.question_selected",
  "app.resume_interview.question_outcome",
  "app.resume_remembered.match",
  "app.resume_remembered.successor",
  "app.resume_impact.analyzed",
  "app.resume_comparison.completed",
  "app.resume_revision.submitted",
  "app.resume_revision.classified",
  "app.resume_revision.proposed",
  "app.resume_revision.outcome",
  "app.inference.completed",
  "app.export.completed",
  "app.validation.completed",
  "app.migration.completed",
  "app.resume_coverage.transitioned",
  "app.resume_opportunity.updated",
  "app.resume_confirmation.grouped",
  "app.resume_strategy.completed",
  "app.resume_target_fit.completed",
  "app.resume_craft.evaluated",
  "app.resume_craft.repaired",
  "app.resume_parity.checked",
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
    connection_id: OpaqueIdSchema.nullable().optional(),
    view_id: OpaqueIdSchema.nullable().optional(),
    operation_id: OpaqueIdSchema.nullable(),
    capability: CapabilityNameSchema.nullable(),
    capability_version: z.number().int().positive().nullable().optional(),
    grant_revision: z.number().int().positive().nullable().optional(),
    revocation_generation: z.number().int().nonnegative().nullable().optional(),
    idempotency_decision: z.enum(["created", "resumed", "reused", "conflict"]).nullable().optional(),
    target_category: z.string().min(1).max(128).nullable(),
    target_id: OpaqueIdSchema.nullable(),
    input_revision: z.number().int().positive().nullable(),
    outcome: z.enum(["allowed", "denied", "committed", "cancelled", "conflict", "failed", "quarantined"]),
    error_code: z.string().min(1).max(128).nullable(),
    schema_version: z.number().int().positive().nullable(),
    duration_ms: z.number().int().nonnegative().nullable(),
    item_count: z.number().int().nonnegative().nullable(),
    job_revision_id: OpaqueIdSchema.nullable().optional(),
    job_dimension: z.enum(["responsibilities", "tools", "accomplishments", "outcomes", "scope", "progression"]).nullable().optional(),
    selection_method: z.enum(["deterministic_gap", "broker_ranked", "deterministic_value"]).nullable().optional(),
    question_outcome: z.enum(["answered", "skipped", "unknown", "not_applicable", "complete_for_now"]).nullable().optional(),
    match_method: z.enum(["explicit_revision", "exact_label", "none"]).nullable().optional(),
    result_class: z.enum(["matched", "ambiguous", "none"]).nullable().optional(),
    fact_revision_id: OpaqueIdSchema.nullable().optional(),
    definition_revision_id: OpaqueIdSchema.nullable().optional(),
    change_count: z.number().int().nonnegative().nullable().optional(),
    variant_count: z.number().int().nonnegative().nullable().optional(),
    left_definition_revision_id: OpaqueIdSchema.nullable().optional(),
    right_definition_revision_id: OpaqueIdSchema.nullable().optional(),
    left_definition_digest: Sha256DigestSchema.nullable().optional(),
    right_definition_digest: Sha256DigestSchema.nullable().optional(),
    comparison_relation: z.enum(["identical", "related", "unrelated"]).nullable().optional(),
    comparison_result: z.enum(["available", "unavailable"]).nullable().optional(),
    added_count: z.number().int().nonnegative().nullable().optional(),
    removed_count: z.number().int().nonnegative().nullable().optional(),
    changed_count: z.number().int().nonnegative().nullable().optional(),
    moved_count: z.number().int().nonnegative().nullable().optional(),
    evidence_change_count: z.number().int().nonnegative().nullable().optional(),
    revision_classification: z.enum(["presentation", "factual", "mixed", "ambiguous"]).nullable().optional(),
    revision_state: z.enum(["submitted", "clarification_needed", "awaiting_confirmation", "generating", "proposed", "accepted", "edited", "rejected", "regenerate", "failed"]).nullable().optional(),
    revision_scope: z.enum(["statement", "section", "resume"]).nullable().optional(),
    attempt: z.number().int().nonnegative().max(2).nullable().optional(),
    coverage_revision_id: OpaqueIdSchema.nullable().optional(),
    coverage_state: z.enum(["unanswered", "answered", "unknown", "not_applicable", "skipped", "deferred", "conflicting"]).nullable().optional(),
    opportunity_id: OpaqueIdSchema.nullable().optional(),
    opportunity_state: z.enum(["available", "suppressed", "resolved", "reopened"]).nullable().optional(),
    suppression_reason: z.enum(["owner_declined", "already_known", "duplicate", "low_value"]).nullable().optional(),
    strategy_revision_id: OpaqueIdSchema.nullable().optional(),
    strategy_digest: Sha256DigestSchema.nullable().optional(),
    report_revision_id: OpaqueIdSchema.nullable().optional(),
    report_digest: Sha256DigestSchema.nullable().optional(),
    parity_revision_id: OpaqueIdSchema.nullable().optional(),
    parity_digest: Sha256DigestSchema.nullable().optional(),
    fit_class: z.enum(["meaningfully_supported", "partially_supported_transferable", "lacking_supported_core_fit"]).nullable().optional(),
    used_evidence_count: z.number().int().nonnegative().nullable().optional(),
    omitted_evidence_count: z.number().int().nonnegative().nullable().optional(),
    omission_reason_categories: z.array(z.enum(["redundant", "low_relevance", "space", "older_context", "owner_direction", "structural_mismatch", "conflict"])).max(7).optional(),
    unresolved_gap_count: z.number().int().nonnegative().nullable().optional(),
    history_shape: z.enum(["chronological_standard", "early_career", "senior_selective", "career_change", "return_to_work", "concurrent_roles"]).nullable().optional(),
    finding_count: z.number().int().nonnegative().nullable().optional(),
    criterion: z.enum(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "T1", "T2", "T3"]).nullable().optional(),
    correction_class: z.enum(["specificity", "duty_only", "generic_language", "redundancy", "density", "organization", "target_relevance"]).nullable().optional(),
    repair_result: z.enum(["completed", "rejected", "failed", "cancelled"]).nullable().optional(),
    verdict: z.enum(["pass", "fail"]).nullable().optional(),
    evidence_context: z.enum(["standard", "evidence_limited"]).nullable().optional(),
    operation_revision_id: OpaqueIdSchema.nullable().optional(),
    operation_digest: Sha256DigestSchema.nullable().optional(),
    confirmation_group_count: z.number().int().nonnegative().nullable().optional(),
    confirmation_unit_count: z.number().int().nonnegative().nullable().optional(),
    redundant_confirmation_count: z.number().int().nonnegative().nullable().optional(),
    non_fact_dialog_count: z.number().int().nonnegative().nullable().optional(),
    final_approval_count: z.number().int().nonnegative().max(1).nullable().optional(),
    interaction_budget_status: z.enum(["semantic_pass_numeric_gate_blocked", "semantic_failed"]).nullable().optional(),
    timing_class: z.enum(["automation", "human"]).nullable().optional(),
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

export const LifecycleDiagnosticEventSchema = z
  .object({
    diagnostic_version: z.literal(1),
    event_name: z.enum([
      "app.lifecycle.operation",
      "app.lifecycle.transition",
      "app.package.verify",
      "app.grant.decision",
      "app.runtime.action",
      "app.update.checkpoint",
      "app.revocation.refresh",
      "app.cleanup.result",
    ]),
    occurred_at: TimestampSchema,
    correlation_id: OpaqueIdSchema,
    operation_id: OpaqueIdSchema.nullable(),
    owner_id: OpaqueIdSchema.nullable(),
    actor_id: OpaqueIdSchema.nullable(),
    app_id: z.literal(RESUME_BUILDER_APP_ID),
    publisher_id: z.literal(RESUME_BUILDER_PUBLISHER_ID),
    installation_id: OpaqueIdSchema.nullable(),
    grant_id: OpaqueIdSchema.nullable(),
    runtime_id: OpaqueIdSchema.nullable(),
    registration_id: OpaqueIdSchema.nullable(),
    package_version: SemverSchema.nullable(),
    package_digest: Sha256DigestSchema.nullable(),
    prior_state: LifecycleStateSchema.nullable(),
    target_state: LifecycleStateSchema.nullable(),
    result_state: LifecycleStateSchema.nullable(),
    generation: z.number().int().nonnegative().nullable(),
    step: LifecycleOperationStageSchema.nullable(),
    attempt: z.number().int().positive(),
    source_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,127}$/).nullable(),
    trust_policy_version: z.literal(1),
    revocation_policy_version: z.literal(1),
    revocation_sequence: z.number().int().positive().nullable(),
    capability_diff: z.enum(["no_change", "narrowed", "widened"]).nullable(),
    data_schema_compatibility: z.enum(["not_checked", "compatible", "incompatible", "migration_required", "repair_required"]).nullable(),
    snapshot_id: OpaqueIdSchema.nullable(),
    external_status: z.enum(["not_attempted", "verified", "ready", "unhealthy", "stopped", "ambiguous", "unavailable"]).nullable(),
    outcome: z.enum(["accepted", "reused", "rejected", "completed", "rolled_back", "quarantined", "failed"]),
    error_class: z.enum(["validation", "trust", "compatibility", "conflict", "persistence", "runtime", "recovery"]).nullable(),
    error_code: ContractErrorCodeSchema.nullable(),
    retryable: z.boolean(),
    recovery: z.enum(["none", "retry", "refresh_metadata", "review_grant", "update_host", "restore_prior", "repair_or_export", "contact_operator"]),
    elapsed_ms: z.number().int().nonnegative(),
    item_count: z.number().int().nonnegative(),
    byte_count: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasErrorCode = value.error_code !== null;
    const hasErrorClass = value.error_class !== null;
    if (hasErrorCode !== hasErrorClass || (value.outcome === "failed") !== hasErrorCode) {
      context.addIssue({ code: "custom", message: "diagnostic failure classification is ambiguous" });
    }
  });

export function assertLifecycleDiagnostic(value: unknown): asserts value is z.infer<typeof LifecycleDiagnosticEventSchema> {
  const parsed = LifecycleDiagnosticEventSchema.safeParse(value);
  if (!parsed.success) {
    throw new ContractViolation("forbidden_field", "Lifecycle diagnostic contains a non-allowlisted or invalid field");
  }
}
