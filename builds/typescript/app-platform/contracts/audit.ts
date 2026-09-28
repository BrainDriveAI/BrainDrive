import { z } from "zod";

import { NonEmptyStringSchema, OpaqueIdSchema, SemverSchema, Sha256DigestSchema, TimestampSchema } from "./common.js";
import { RESUME_BUILDER_APP_ID, RESUME_BUILDER_PUBLISHER_ID } from "./constants.js";
import { ResumeValidationRuleIdSchema } from "./data.js";
import { CapabilityNameSchema } from "./package.js";
import { ContractErrorCodeSchema, ContractViolation } from "./errors.js";
import { LifecycleOperationStageSchema, LifecycleStateSchema } from "./lifecycle.js";
import {
  InferenceCompletionModeSchema,
  InferenceErrorCodeSchema,
  InferenceFinalDispositionSchema,
  InferenceFinishCategorySchema,
  InferencePurposeSchema,
  InferenceRecoveryClassSchema,
  InferenceStageSchema,
} from "./inference.js";

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
  "app.inference.attempt",
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
    correction_action: z.enum(["repair_statement", "add_evidence", "manual_revision", "keep_prior_or_exit"]).nullable().optional(),
    correction_transition: z.enum(["needs_correction_to_product_craft_passed", "needs_correction_preserved"]).nullable().optional(),
    recovery_reason: z.enum(["validation_rejected", "full_gate_regression", "provider_failure", "schema_failure", "persistence_failure", "cancelled"]).nullable().optional(),
    repair_result: z.enum(["completed", "rejected", "failed", "cancelled"]).nullable().optional(),
    verdict: z.enum(["pass", "fail"]).nullable().optional(),
    evidence_context: z.enum(["standard", "evidence_limited"]).nullable().optional(),
    operation_revision_id: OpaqueIdSchema.nullable().optional(),
    operation_digest: Sha256DigestSchema.nullable().optional(),
    source_definition_revision_id: OpaqueIdSchema.nullable().optional(),
    source_report_revision_id: OpaqueIdSchema.nullable().optional(),
    successor_definition_revision_id: OpaqueIdSchema.nullable().optional(),
    successor_report_revision_id: OpaqueIdSchema.nullable().optional(),
    input_digest: Sha256DigestSchema.nullable().optional(),
    output_digest: Sha256DigestSchema.nullable().optional(),
    confirmation_group_count: z.number().int().nonnegative().nullable().optional(),
    confirmation_unit_count: z.number().int().nonnegative().nullable().optional(),
    redundant_confirmation_count: z.number().int().nonnegative().nullable().optional(),
    non_fact_dialog_count: z.number().int().nonnegative().nullable().optional(),
    final_approval_count: z.number().int().nonnegative().max(1).nullable().optional(),
    interaction_budget_status: z.enum(["semantic_pass_numeric_gate_blocked", "semantic_failed"]).nullable().optional(),
    timing_class: z.enum(["automation", "human"]).nullable().optional(),
  })
  .strict();

const InferenceValidatorCodeSchema = z.enum([
  "unsupported_claim",
  "partial_support_overstated",
  "missing_provenance",
  "protected_field_changed",
  "schema_invalid",
  "lineage_invalid",
  "parse_back_mismatch",
]);

export const InferenceSchemaIssueIdSchema = z.enum([
  "title_invalid",
  "statements_invalid",
  "statement_invalid",
  "section_order_invalid",
  "omissions_invalid",
  "experience_roles_invalid",
  "experience_role_job_id_invalid",
  "experience_role_bullet_statement_ids_invalid",
  "experience_role_heading_invalid",
  "experience_role_bullet_statement_invalid",
  "experience_role_bullet_limit_exceeded",
  "experience_role_binding_invalid",
  "experience_role_top_level_leakage",
  "experience_role_job_missing",
  "experience_role_job_duplicate",
  "experience_role_job_foreign",
  "experience_role_heading_shape_invalid",
  "experience_role_heading_support_invalid",
  "experience_role_bullet_shape_invalid",
  "experience_role_bullet_support_invalid",
  "unknown_field",
  "other_schema_issue",
  "host_normalization_invalid",
]);

const INFERENCE_RECOVERY_DIAGNOSTIC_KEYS = [
  "provider_validator_codes",
  "provider_validator_rule_ids",
  "local_candidate_classes",
  "targeted_fact_repair_validator_codes",
  "targeted_fact_repair_validator_rule_ids",
  "targeted_fact_repair_disposition",
  "full_general_constructor_validator_codes",
  "full_general_constructor_validator_rule_ids",
  "full_general_constructor_disposition",
  "original_failure_code",
  "recovery_disposition",
] as const;

/** Shared cross-field authority for terminal audit and app-safe recovery projections. */
export function refineInferenceRecoveryDiagnostics(value: Record<string, unknown>, context: z.RefinementCtx): void {
  if (!INFERENCE_RECOVERY_DIAGNOSTIC_KEYS.some((key) => value[key] !== undefined)) return;
  const issue = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });
  for (const key of [
    "provider_validator_codes",
    "provider_validator_rule_ids",
    "local_candidate_classes",
    "targeted_fact_repair_validator_codes",
    "targeted_fact_repair_validator_rule_ids",
    "targeted_fact_repair_disposition",
    "original_failure_code",
    "recovery_disposition",
  ] as const) {
    if (value[key] === undefined) issue(key, "ordered General recovery diagnostics require the complete base field set");
  }
  const providerCodes = value.provider_validator_codes;
  if (Array.isArray(providerCodes) && providerCodes.length === 0) {
    issue("provider_validator_codes", "General evidence recovery requires at least one provider validator code");
  }
  const providerRuleIds = value.provider_validator_rule_ids;
  if (Array.isArray(providerRuleIds) && providerRuleIds.length === 0) {
    issue("provider_validator_rule_ids", "General evidence recovery requires at least one granular provider rule ID");
  }
  if (value.original_failure_code !== "evidence_validation_failed") {
    issue("original_failure_code", "ordered General recovery requires the evidence validation failure category");
  }
  if (value.purpose !== "general_resume_draft") {
    issue("purpose", "ordered evidence recovery is limited to General Resume generation");
  }
  if (value.attempt_count !== 2) {
    issue("attempt_count", "ordered evidence recovery requires the fixed two-attempt provider ceiling to be exhausted");
  }
  if (value.retryable !== false) {
    issue("retryable", "ordered evidence recovery is not automatically retryable");
  }

  const classes = Array.isArray(value.local_candidate_classes) ? value.local_candidate_classes : [];
  const hasFull = classes.includes("full_general_constructor");
  const fullCodesPresent = value.full_general_constructor_validator_codes !== undefined;
  const fullRuleIdsPresent = value.full_general_constructor_validator_rule_ids !== undefined;
  const fullDispositionPresent = value.full_general_constructor_disposition !== undefined;
  if (hasFull !== fullCodesPresent) issue("full_general_constructor_validator_codes", "full-constructor codes must be present if and only if the candidate ran");
  if (hasFull !== fullRuleIdsPresent) issue("full_general_constructor_validator_rule_ids", "full-constructor rule IDs must be present if and only if the candidate ran");
  if (hasFull !== fullDispositionPresent) issue("full_general_constructor_disposition", "full-constructor disposition must be present if and only if the candidate ran");

  const completedRecovery = () => {
    if (value.final_disposition !== "completed") issue("final_disposition", "accepted local recovery must complete");
    if (value.stage !== "completed") issue("stage", "accepted local recovery must end at completed");
    if (value.completion_mode !== "deterministic_fallback") issue("completion_mode", "accepted local recovery must be deterministic fallback");
    if (value.recovery_class !== "deterministic_fallback") issue("recovery_class", "accepted local recovery must use deterministic fallback recovery");
    if ("error_code" in value && value.error_code !== null) issue("error_code", "accepted local recovery cannot retain an error code");
  };

  if (value.recovery_disposition === "targeted_accepted") {
    if (classes.length !== 1 || classes[0] !== "targeted_fact_repair") issue("local_candidate_classes", "targeted acceptance requires only the targeted candidate");
    if (value.targeted_fact_repair_disposition !== "accepted") issue("targeted_fact_repair_disposition", "targeted acceptance requires an accepted targeted candidate");
    completedRecovery();
  } else if (value.recovery_disposition === "full_constructor_accepted") {
    if (classes.length !== 2 || classes[0] !== "targeted_fact_repair" || classes[1] !== "full_general_constructor") {
      issue("local_candidate_classes", "full-constructor acceptance requires ordered targeted then full candidates");
    }
    if (value.targeted_fact_repair_disposition === "accepted") issue("targeted_fact_repair_disposition", "full construction cannot follow an accepted targeted candidate");
    if (value.full_general_constructor_disposition !== "accepted") issue("full_general_constructor_disposition", "full-constructor acceptance requires an accepted full candidate");
    completedRecovery();
  } else if (value.recovery_disposition === "recovery_rejected") {
    if (classes.length !== 2 || classes[0] !== "targeted_fact_repair" || classes[1] !== "full_general_constructor") {
      issue("local_candidate_classes", "rejected recovery requires ordered targeted then full candidates");
    }
    if (value.targeted_fact_repair_disposition === "accepted") issue("targeted_fact_repair_disposition", "rejected recovery cannot contain an accepted targeted candidate");
    if (value.full_general_constructor_disposition === "accepted") issue("full_general_constructor_disposition", "rejected recovery cannot contain an accepted full candidate");
    if (value.final_disposition !== "failed") issue("final_disposition", "rejected recovery must fail");
    if (value.stage !== "recovery") issue("stage", "rejected recovery must end at the recovery stage");
    if (value.completion_mode !== "none") issue("completion_mode", "rejected recovery cannot have a completion mode");
    if (value.recovery_class !== "deterministic_fallback") issue("recovery_class", "rejected recovery must retain the deterministic fallback class");
    if ("error_code" in value && value.error_code !== "evidence_validation_failed") issue("error_code", "rejected recovery must retain the evidence validation error");
  }
}

export const InferenceAttemptAuditDetailsSchema = z.object({
  diagnostic_version: z.literal(1),
  app_id: z.literal(RESUME_BUILDER_APP_ID),
  operation_id: OpaqueIdSchema,
  request_id: OpaqueIdSchema,
  purpose: InferencePurposeSchema,
  attempt: z.number().int().min(1).max(2),
  stage: InferenceStageSchema,
  finish_category: InferenceFinishCategorySchema,
  attempt_outcome: z.enum(["accepted", "retry", "fallback", "failed"]),
  duration_class: z.enum(["under_1s", "under_5s", "under_30s", "under_2m", "over_2m", "unavailable"]).optional(),
  structural_failure_class: z.enum(["empty_output", "invalid_json", "purpose_schema_mismatch", "host_normalization_mismatch"]).optional(),
  schema_issue_ids: z.array(InferenceSchemaIssueIdSchema).min(1).max(10).optional(),
  validator_rule_ids: z.array(ResumeValidationRuleIdSchema).min(1).max(20).optional(),
}).strict().superRefine((value, context) => {
  if (value.validator_rule_ids !== undefined && value.stage !== "deterministic_validation") {
    context.addIssue({ code: "custom", path: ["validator_rule_ids"], message: "validator rule IDs are limited to deterministic-validation attempts" });
  }
  if (value.structural_failure_class !== undefined && !["structured_parse", "output_schema_validation"].includes(value.stage)) {
    context.addIssue({ code: "custom", path: ["structural_failure_class"], message: "structural failure class requires a structural attempt stage" });
  }
  if (value.stage === "structured_parse" && !["empty_output", "invalid_json"].includes(value.structural_failure_class ?? "")) {
    context.addIssue({ code: "custom", path: ["structural_failure_class"], message: "structured parse requires an exact parse failure class" });
  }
  if (value.stage === "output_schema_validation" && !["purpose_schema_mismatch", "host_normalization_mismatch"].includes(value.structural_failure_class ?? "")) {
    context.addIssue({ code: "custom", path: ["structural_failure_class"], message: "output schema validation requires an exact schema failure class" });
  }
  if (value.stage === "output_schema_validation" && value.schema_issue_ids === undefined) {
    context.addIssue({ code: "custom", path: ["schema_issue_ids"], message: "output schema validation requires content-free schema issue IDs" });
  }
  if (value.stage !== "output_schema_validation" && value.schema_issue_ids !== undefined) {
    context.addIssue({ code: "custom", path: ["schema_issue_ids"], message: "schema issue IDs are limited to output schema validation" });
  }
});

export function assertContentFreeInferenceAttemptAudit(
  value: unknown,
): asserts value is z.infer<typeof InferenceAttemptAuditDetailsSchema> {
  assertNoProhibitedDiagnosticContent(value);
  if (!InferenceAttemptAuditDetailsSchema.safeParse(value).success) {
    throw new ContractViolation("invalid_input", "Inference attempt audit failed the content-free schema");
  }
}

/**
 * Exact terminal detail shape accepted by the ordinary JSONL audit sink. It is
 * deliberately separate from the owner-data AuditEventSchema because the
 * gateway logger supplies the outer timestamp/event envelope.
 */
export const InferenceTerminalAuditDetailsSchema = z.object({
  diagnostic_version: z.literal(1),
  app_id: z.literal(RESUME_BUILDER_APP_ID),
  operation_id: OpaqueIdSchema,
  request_id: OpaqueIdSchema,
  purpose: InferencePurposeSchema,
  prompt_policy_id: z.string().min(1).max(128),
  prompt_policy_version: z.string().min(1).max(64),
  output_schema_id: z.string().min(1).max(128),
  output_schema_version: z.number().int().positive(),
  model_class: z.enum(["owner_active_compatible"]).nullable(),
  attempt_count: z.number().int().min(0).max(2),
  stage: InferenceStageSchema,
  finish_category: InferenceFinishCategorySchema,
  error_code: InferenceErrorCodeSchema.nullable(),
  retryable: z.boolean(),
  recovery_class: InferenceRecoveryClassSchema,
  completion_mode: InferenceCompletionModeSchema,
  final_disposition: InferenceFinalDispositionSchema,
  usage_available: z.boolean(),
  duration_class: z.enum(["under_1s", "under_5s", "under_30s", "under_2m", "over_2m", "unavailable"]),
  validator_codes: z.array(InferenceValidatorCodeSchema).max(7),
  provider_validator_codes: z.array(InferenceValidatorCodeSchema).max(7).optional(),
  provider_validator_rule_ids: z.array(ResumeValidationRuleIdSchema).min(1).max(20).optional(),
  local_candidate_classes: z.array(z.enum(["targeted_fact_repair", "full_general_constructor"])).min(1).max(2).optional(),
  targeted_fact_repair_validator_codes: z.array(InferenceValidatorCodeSchema).max(7).optional(),
  targeted_fact_repair_validator_rule_ids: z.array(ResumeValidationRuleIdSchema).max(20).optional(),
  targeted_fact_repair_disposition: z.enum(["accepted", "rejected", "schema_rejected", "unavailable"]).optional(),
  full_general_constructor_validator_codes: z.array(InferenceValidatorCodeSchema).max(7).optional(),
  full_general_constructor_validator_rule_ids: z.array(ResumeValidationRuleIdSchema).max(20).optional(),
  full_general_constructor_disposition: z.enum(["accepted", "rejected", "schema_rejected", "unavailable"]).optional(),
  original_failure_code: InferenceErrorCodeSchema.optional(),
  recovery_disposition: z.enum(["targeted_accepted", "full_constructor_accepted", "recovery_rejected"]).optional(),
  repair: z.enum([
    "provider_structural_repair",
    "provider_validation_repair",
    "deterministic_fact_fallback",
    "deterministic_strategy_fallback",
    "deterministic_guidance_fallback",
    "deterministic_interview_presentation",
    "deterministic_craft_evaluation",
    "host_owned_structure",
  ]).nullable().optional(),
  history_shape: z.enum(["chronological_standard", "early_career", "senior_selective", "career_change", "return_to_work", "concurrent_roles"]).nullable().optional(),
  used_evidence_count: z.number().int().nonnegative().nullable().optional(),
  omitted_evidence_count: z.number().int().nonnegative().nullable().optional(),
  omission_reason_categories: z.array(z.enum(["redundant", "low_relevance", "space", "older_context", "owner_direction", "structural_mismatch", "conflict"])).max(7).optional(),
  unresolved_gap_count: z.number().int().nonnegative().nullable().optional(),
}).strict().superRefine(refineInferenceRecoveryDiagnostics);

export function assertContentFreeInferenceTerminalAudit(
  value: unknown,
): asserts value is z.infer<typeof InferenceTerminalAuditDetailsSchema> {
  assertNoProhibitedDiagnosticContent(value);
  if (!InferenceTerminalAuditDetailsSchema.safeParse(value).success) {
    throw new ContractViolation("invalid_input", "Inference terminal audit failed the content-free schema");
  }
}

/** Strict content-free ordinary-audit relation for an explicit owner retry. */
export const ResumeInferenceRetryAuditDetailsSchema = z.object({
  diagnostic_version: z.literal(1),
  retry_relation_version: z.literal(1),
  retry_reason: z.literal("owner_initiated_retry"),
  retry_prior_operation_id: OpaqueIdSchema,
  retry_new_operation_id: OpaqueIdSchema,
  retry_semantic_input_digest: Sha256DigestSchema,
  retry_strategy_revision_id: OpaqueIdSchema,
  retry_provider_profile_id: NonEmptyStringSchema,
  retry_model_id: NonEmptyStringSchema,
  retry_equivalent: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.retry_prior_operation_id === value.retry_new_operation_id) {
    context.addIssue({ code: "custom", path: ["retry_new_operation_id"], message: "owner retry operation must be fresh" });
  }
});

export function assertContentFreeResumeInferenceRetryAudit(
  value: unknown,
): asserts value is z.infer<typeof ResumeInferenceRetryAuditDetailsSchema> {
  assertNoProhibitedDiagnosticContent(value);
  if (!ResumeInferenceRetryAuditDetailsSchema.safeParse(value).success) {
    throw new ContractViolation("invalid_input", "Resume inference retry audit failed the content-free schema");
  }
}

export const ResumeRecoveryReconciliationAuditDetailsSchema = z.object({
  diagnostic_version: z.literal(1),
  app_id: z.literal(RESUME_BUILDER_APP_ID),
  operation_id: OpaqueIdSchema,
  semantic_digest: Sha256DigestSchema,
  expected_revision: z.number().int().nonnegative().nullable(),
  initial_wait_class: z.enum(["not_observed", "completed_before_initial_wait", "ambiguous_after_initial_wait"]),
  reconciliation_count: z.number().int().nonnegative(),
  reconciliation_class: z.enum(["none", "operation_read", "workspace_read", "operation_then_workspace"]),
  acknowledgement_timing_class: z.enum(["pending", "before_initial_wait", "observed_window", "early_reconciliation", "late_reconciliation", "host_deadline", "unavailable"]),
  idempotency_disposition: z.enum(["created", "coalesced", "replayed", "conflict"]),
  final_disposition: z.enum(["pending", "committed", "conflict", "cancelled", "failed", "not_saved"]),
  conflict_class: z.enum(["none", "idempotency_input_mismatch", "cas_revision_mismatch", "durable_binding_mismatch", "durable_value_mismatch"]),
  error_code: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/).nullable(),
}).strict();

export function assertContentFreeResumeRecoveryReconciliationAudit(
  value: unknown,
): asserts value is z.infer<typeof ResumeRecoveryReconciliationAuditDetailsSchema> {
  assertNoProhibitedDiagnosticContent(value);
  if (!ResumeRecoveryReconciliationAuditDetailsSchema.safeParse(value).success) {
    throw new ContractViolation("invalid_input", "Resume recovery reconciliation audit failed the content-free schema");
  }
}

const FORBIDDEN_KEY_PATTERN = /(^|_)(content|body|text|html|prompt|completion|resume|job_description|source_document|raw_path|path|destination|authorization|credential|api_key|token|secret|permission)(_|$)/i;
const RAW_PATH_PATTERN = /(?:^|\s)(?:[A-Za-z]:\\|\/(?:home|Users|var|tmp|etc)\/)/;
const CREDENTIAL_PATTERN = /(?:bearer\s+[A-Za-z0-9._~-]+|sk-[A-Za-z0-9_-]{12,})/i;

export function assertContentFreeAudit(value: unknown): asserts value is z.infer<typeof AuditEventSchema> {
  assertNoProhibitedDiagnosticContent(value);
  const parsed = AuditEventSchema.safeParse(value);
  if (!parsed.success) {
    throw new ContractViolation("invalid_input", "Audit event failed the content-free schema");
  }
}

function assertNoProhibitedDiagnosticContent(value: unknown): void {
  const visit = (candidate: unknown, key = ""): void => {
    const safePolicyIdentity = key === "prompt_policy_id" || key === "prompt_policy_version" || key === "completion_mode";
    if (!safePolicyIdentity && FORBIDDEN_KEY_PATTERN.test(key)) {
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
      for (const [childKey, childValue] of Object.entries(candidate)) visit(childValue, childKey);
    }
  };
  visit(value);
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
