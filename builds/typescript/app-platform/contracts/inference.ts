import { z } from "zod";

import {
  NonEmptyStringSchema,
  OpaqueIdSchema,
  Sha256DigestSchema,
  TimestampSchema,
  canonicalInputDigest,
} from "./common.js";
import { RESUME_INFERENCE_SCHEMA_VERSION, RESUME_BUILDER_APP_ID } from "./constants.js";
import { ContractViolation } from "./errors.js";
import {
  CraftCorrectionClassSchema,
  CraftQualityReportRecordSchema,
  JobEvidenceCoverageRecordSchema,
  ResumeStrategyRecordSchema,
  TargetFitAnalysisRecordSchema,
} from "./data.js";
import { ResumeEvidenceAnnotationsSchema, ResumeQualityPolicyIdentitySchema } from "../../resume-inference/strategy.js";
import { TARGET_FIT_THRESHOLD_POLICY } from "../../resume-inference/target-fit.js";
import { CRAFT_EVIDENCE_LIMITED_POLICY, LEGACY_CRAFT_EVIDENCE_LIMITED_POLICY } from "../../resume-inference/craft-evaluator.js";

export const InferencePurposeSchema = z.enum([
  "interview_assist",
  "general_resume_draft",
  "job_description_analyze",
  "requirement_evidence_match",
  "tailoring_plan",
  "targeted_resume_draft",
  "resume_revision_classify",
  "resume_revision_draft",
  "resume_guidance",
  "resume_strategy",
  "resume_craft_evaluate",
  "resume_craft_repair",
]);

export type InferencePurpose = z.infer<typeof InferencePurposeSchema>;

export const PURPOSE_OUTPUT_SCHEMAS = {
  interview_assist: "resume.interview-assist.v2",
  general_resume_draft: "resume.general-draft.v3",
  job_description_analyze: "resume.job-analysis.v1",
  requirement_evidence_match: "resume.requirement-evidence.v1",
  tailoring_plan: "resume.tailoring-plan.v2",
  targeted_resume_draft: "resume.targeted-draft.v1",
  resume_revision_classify: "resume.revision-classify.v1",
  resume_revision_draft: "resume.revision-draft.v1",
  resume_guidance: "resume.guidance.v1",
  resume_strategy: "resume.strategy.v1",
  resume_craft_evaluate: "resume.craft-evaluate.v2",
  resume_craft_repair: "resume.craft-repair.v1",
} as const satisfies Record<InferencePurpose, string>;

export const PURPOSE_LIMITS = {
  interview_assist: { input_bytes: 65_536, input_tokens: 16_384, output_tokens: 2_048, duration_ms: 60_000, attempts: 2, concurrency: 1 },
  general_resume_draft: { input_bytes: 262_144, input_tokens: 65_536, output_tokens: 8_192, duration_ms: 120_000, attempts: 2, concurrency: 1 },
  job_description_analyze: { input_bytes: 196_608, input_tokens: 49_152, output_tokens: 6_144, duration_ms: 90_000, attempts: 2, concurrency: 1 },
  requirement_evidence_match: { input_bytes: 262_144, input_tokens: 65_536, output_tokens: 8_192, duration_ms: 120_000, attempts: 2, concurrency: 1 },
  tailoring_plan: { input_bytes: 262_144, input_tokens: 65_536, output_tokens: 6_144, duration_ms: 90_000, attempts: 2, concurrency: 1 },
  targeted_resume_draft: { input_bytes: 327_680, input_tokens: 81_920, output_tokens: 8_192, duration_ms: 120_000, attempts: 2, concurrency: 1 },
  resume_revision_classify: { input_bytes: 65_536, input_tokens: 16_384, output_tokens: 2_048, duration_ms: 60_000, attempts: 2, concurrency: 1 },
  resume_revision_draft: { input_bytes: 327_680, input_tokens: 81_920, output_tokens: 8_192, duration_ms: 120_000, attempts: 2, concurrency: 1 },
  resume_guidance: { input_bytes: 196_608, input_tokens: 49_152, output_tokens: 4_096, duration_ms: 90_000, attempts: 2, concurrency: 1 },
  resume_strategy: { input_bytes: 262_144, input_tokens: 65_536, output_tokens: 6_144, duration_ms: 90_000, attempts: 2, concurrency: 1 },
  resume_craft_evaluate: { input_bytes: 327_680, input_tokens: 81_920, output_tokens: 8_192, duration_ms: 120_000, attempts: 2, concurrency: 1 },
  resume_craft_repair: { input_bytes: 327_680, input_tokens: 81_920, output_tokens: 8_192, duration_ms: 120_000, attempts: 2, concurrency: 1 },
} as const satisfies Record<InferencePurpose, {
  input_bytes: number;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  attempts: number;
  concurrency: number;
}>;

export const InferenceLimitsSchema = z
  .object({
    input_bytes: z.number().int().positive(),
    input_tokens: z.number().int().positive(),
    output_tokens: z.number().int().positive(),
    duration_ms: z.number().int().positive(),
    attempts: z.number().int().min(1).max(2),
    concurrency: z.literal(1),
  })
  .strict();

export const InferenceDataBlockSchema = z
  .object({
    category: z.enum([
      "confirmed_fact_snapshot",
      "presentation_preferences",
      "general_resume_definition",
      "job_description",
      "job_analysis",
      "evidence_matrix",
      "owner_edit",
      "revision_instruction",
      "definition_comparison",
      "deterministic_findings",
      "job_evidence_summary",
      "coverage_summary",
      "resume_strategy",
      "target_fit_analysis",
      "craft_quality_report",
      "craft_repair_scope",
      "craft_gate_policy",
      "craft_anchor_evidence",
      "evidence_annotations",
      "quality_policy",
      "target_fit_policy",
    ]),
    content_digest: Sha256DigestSchema,
    schema_id: NonEmptyStringSchema,
    schema_version: z.number().int().positive(),
    data: z.unknown(),
  })
  .strict()
  .superRefine((value, context) => {
    const schemas: Partial<Record<typeof value.category, z.ZodType>> = {
      coverage_summary: JobEvidenceCoverageRecordSchema,
      resume_strategy: ResumeStrategyRecordSchema,
      target_fit_analysis: TargetFitAnalysisRecordSchema,
      craft_quality_report: CraftQualityReportRecordSchema,
      evidence_annotations: ResumeEvidenceAnnotationsSchema,
      quality_policy: ResumeQualityPolicyIdentitySchema,
      target_fit_policy: z.object({
        policy_id: z.literal(TARGET_FIT_THRESHOLD_POLICY.policy_id),
        policy_version: z.literal(TARGET_FIT_THRESHOLD_POLICY.policy_version),
        authority_status: z.literal("provisional_planning_default"),
        supported_core_minimum: z.literal(1),
        supported_transferable_minimum: z.literal(2),
        material_change_minimum: z.literal(1),
        score_free: z.literal(true),
      }).strict(),
      craft_repair_scope: z.union([
        z.object({
          scope_version: z.literal(1),
          source_definition_revision_id: OpaqueIdSchema,
          source_report_revision_id: OpaqueIdSchema,
          statement_scope_ids: z.array(OpaqueIdSchema).min(1).max(500),
          allowed_correction_classes: z.array(CraftCorrectionClassSchema).min(1).max(7),
          attempt: z.literal(1),
        }).strict(),
        z.object({
          scope_version: z.literal(2),
          source_definition_revision_id: OpaqueIdSchema,
          source_report_revision_id: OpaqueIdSchema,
          statement_scope_ids: z.array(OpaqueIdSchema).min(1).max(500),
          correction_class: CraftCorrectionClassSchema,
          attempt: z.literal(1),
        }).strict(),
      ]),
      craft_gate_policy: z.union([
        z.object({
          policy_id: z.literal(CRAFT_EVIDENCE_LIMITED_POLICY.policy_id),
          policy_version: z.literal(CRAFT_EVIDENCE_LIMITED_POLICY.policy_version),
          authority_status: z.literal("accepted_implementation_blocker"),
          ordinary_product_craft_passage_allowed: z.literal(false),
          owner_approval_allowed: z.literal(false),
          release_ready_allowed: z.literal(false),
          score_free: z.literal(true),
        }).strict(),
        z.object({
          policy_id: z.literal(LEGACY_CRAFT_EVIDENCE_LIMITED_POLICY.policy_id),
          policy_version: z.literal(LEGACY_CRAFT_EVIDENCE_LIMITED_POLICY.policy_version),
          authority_status: z.literal(LEGACY_CRAFT_EVIDENCE_LIMITED_POLICY.authority_status),
          required_relative_criteria: z.tuple([z.literal("C1"), z.literal("C2"), z.literal("C3")]),
          require_no_must_use_omission: z.literal(true),
          require_optional_gap_guidance: z.literal(true),
          bypass_allowed: z.literal(false),
          score_free: z.literal(true),
        }).strict(),
      ]),
      craft_anchor_evidence: z.object({
        extraction_version: z.literal(1),
        definition_revision_id: OpaqueIdSchema,
        strategy_revision_id: OpaqueIdSchema,
        anchors: z.array(z.object({
          anchor_id: OpaqueIdSchema,
          anchor_kind: z.enum(["professional_identity", "contact", "experience_heading", "experience_evidence", "education", "skill_usage", "strategy_evidence_priority"]),
          section_id: NonEmptyStringSchema.nullable(),
          statement_id: OpaqueIdSchema.nullable(),
          ordinal: z.number().int().nonnegative(),
          fact_revision_ids: z.array(OpaqueIdSchema).max(500),
          content_digest: Sha256DigestSchema,
          evidence_digest: Sha256DigestSchema,
        }).strict()).max(1_000),
        criterion_inputs: z.array(z.object({ criterion: z.enum(["C1", "C2", "C3"]), anchor_ids: z.array(OpaqueIdSchema).max(1_000) }).strict()).length(3),
        extraction_digest: Sha256DigestSchema,
      }).strict().superRefine((anchorEvidence, anchorContext) => {
        const { extraction_digest: _digest, ...body } = anchorEvidence;
        if (anchorEvidence.extraction_digest !== canonicalInputDigest(body)) anchorContext.addIssue({ code: "custom", path: ["extraction_digest"], message: "craft anchor evidence digest mismatch" });
        const ids = new Set(anchorEvidence.anchors.map((anchor) => anchor.anchor_id));
        if (ids.size !== anchorEvidence.anchors.length || anchorEvidence.criterion_inputs.some((entry) => entry.anchor_ids.some((id) => !ids.has(id)))) anchorContext.addIssue({ code: "custom", message: "craft anchor identities are invalid" });
      }),
    };
    const schema = schemas[value.category];
    if (schema && !schema.safeParse(value.data).success) context.addIssue({ code: "custom", path: ["data"], message: "data block does not match its category contract" });
  });

export const InferenceRequestSchema = z
  .object({
    inference_schema_version: z.literal(RESUME_INFERENCE_SCHEMA_VERSION),
    request_id: OpaqueIdSchema,
    owner_id: OpaqueIdSchema,
    actor_id: OpaqueIdSchema,
    app_id: z.literal(RESUME_BUILDER_APP_ID),
    installation_id: OpaqueIdSchema,
    operation_id: OpaqueIdSchema,
    grant_id: OpaqueIdSchema,
    purpose: InferencePurposeSchema,
    input_snapshot: z
      .object({
        fact_snapshot_revision: z.number().int().positive(),
        fact_snapshot_digest: Sha256DigestSchema,
        record_revision_ids: z.array(OpaqueIdSchema),
      })
      .strict(),
    data_blocks: z.array(InferenceDataBlockSchema).min(1).max(16),
    prompt_policy_id: NonEmptyStringSchema,
    prompt_policy_version: NonEmptyStringSchema,
    output_schema_id: NonEmptyStringSchema,
    output_schema_version: z.literal(1),
    capability_requirements: z
      .object({
        text_generation: z.literal(true),
        complete_structured_json: z.literal(true),
        minimum_context_tokens: z.number().int().positive(),
        model_tools: z.literal(false),
      })
      .strict(),
    limits: InferenceLimitsSchema,
    requested_at: TimestampSchema,
    deadline_at: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.output_schema_id !== PURPOSE_OUTPUT_SCHEMAS[value.purpose]) {
      context.addIssue({ code: "custom", message: "purpose/output schema mismatch" });
    }
    const ceiling = PURPOSE_LIMITS[value.purpose];
    for (const key of Object.keys(ceiling) as Array<keyof typeof ceiling>) {
      if (value.limits[key] > ceiling[key]) {
        context.addIssue({ code: "custom", message: `limit ${key} exceeds purpose policy` });
      }
    }
    if (Date.parse(value.deadline_at) <= Date.parse(value.requested_at)) {
      context.addIssue({ code: "custom", message: "deadline must follow request time" });
    }
  });

export const InferenceStatusSchema = z.enum([
  "accepted",
  "running",
  "completed",
  "cancelled",
  "deadline_exceeded",
  "rejected_incompatible",
  "failed",
]);

/** Content-free stage vocabulary for terminal inference outcomes. */
export const InferenceStageSchema = z.enum([
  "request_validation",
  "compatibility_preflight",
  "provider_resolution",
  "provider_request",
  "finish_reason",
  "structured_parse",
  "output_schema_validation",
  "deterministic_validation",
  "recovery",
  "persistence",
  "cancellation",
  "completed",
  "internal",
]);

/** Provider finish reasons normalized before any parse or validation decision. */
export const InferenceFinishCategorySchema = z.enum([
  "stop",
  "length",
  "content_filter",
  "refusal",
  "tool_calls",
  "unknown",
  "missing",
]);

export const InferenceRecoveryClassSchema = z.enum([
  "none",
  "provider_structural_repair",
  "provider_validation_repair",
  "deterministic_fallback",
  "host_owned_zero_call",
]);

export const InferenceCompletionModeSchema = z.enum([
  "none",
  "primary",
  "provider_repair",
  "deterministic_fallback",
  "host_owned",
]);

export const InferenceFinalDispositionSchema = z.enum([
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Optional on version-1 envelopes so persisted pre-Spec-09 terminal records
 * remain readable. When present, every field is closed and content-free.
 */
export const InferenceOutcomeMetadataSchema = z
  .object({
    stage: InferenceStageSchema,
    finish_category: InferenceFinishCategorySchema,
    attempt_count: z.number().int().min(0).max(2),
    retryable: z.boolean(),
    recovery_class: InferenceRecoveryClassSchema,
    completion_mode: InferenceCompletionModeSchema,
    final_disposition: InferenceFinalDispositionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const completed = value.final_disposition === "completed";
    if (completed !== (value.completion_mode !== "none")) {
      context.addIssue({ code: "custom", message: "completion mode must match final disposition" });
    }
    if (completed && value.retryable) {
      context.addIssue({ code: "custom", message: "completed inference cannot be retryable" });
    }
    const expectedRecovery: Partial<Record<typeof value.completion_mode, ReadonlySet<typeof value.recovery_class>>> = {
      primary: new Set(["none"]),
      provider_repair: new Set(["provider_structural_repair", "provider_validation_repair"]),
      deterministic_fallback: new Set(["deterministic_fallback"]),
      host_owned: new Set(["host_owned_zero_call"]),
    };
    const allowed = expectedRecovery[value.completion_mode];
    if (allowed && !allowed.has(value.recovery_class)) {
      context.addIssue({ code: "custom", message: "recovery class does not match completion mode" });
    }
  });

export const InferenceErrorCodeSchema = z.enum([
  // Retained version-1 values remain readable for persisted results/events.
  "invalid_request",
  "denied",
  "model_incompatible",
  "provider_unavailable",
  "quota_exceeded",
  "rate_limited",
  "deadline_exceeded",
  "cancelled",
  "schema_validation_failed",
  "validation_failed",
  "recoverable_internal_failure",
  // Spec 09 exact semantic values for new terminal outcomes.
  "malformed_structured_output",
  "incomplete_output",
  "evidence_validation_failed",
  "provider_schema_unsupported",
  "provider_authentication_failed",
  "provider_authorization_failed",
  "content_filtered",
  "provider_refused",
  "unexpected_tool_call",
  "internal_failure",
]);

export const InferenceErrorSchema = z
  .object({
    code: InferenceErrorCodeSchema,
    safe_message: z.string().min(1).max(512),
    retryable: z.boolean(),
  })
  .strict();

export const InferenceResultSchema = z
  .object({
    inference_schema_version: z.literal(RESUME_INFERENCE_SCHEMA_VERSION),
    request_id: OpaqueIdSchema,
    operation_id: OpaqueIdSchema,
    purpose: InferencePurposeSchema,
    status: InferenceStatusSchema,
    prompt_policy_id: NonEmptyStringSchema,
    prompt_policy_version: NonEmptyStringSchema,
    output_schema_id: NonEmptyStringSchema,
    output_schema_version: z.literal(1),
    input_digest: Sha256DigestSchema,
    output_digest: Sha256DigestSchema.nullable(),
    result: z.unknown().nullable(),
    provider_profile_id: NonEmptyStringSchema.nullable(),
    model_id: NonEmptyStringSchema.nullable(),
    attempt_count: z.number().int().min(0).max(2),
    usage: z
      .object({
        available: z.boolean(),
        input_tokens: z.number().int().nonnegative().nullable(),
        output_tokens: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    error: InferenceErrorSchema.nullable(),
    outcome: InferenceOutcomeMetadataSchema.optional(),
    started_at: TimestampSchema,
    completed_at: TimestampSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.output_schema_id !== PURPOSE_OUTPUT_SCHEMAS[value.purpose]) {
      context.addIssue({ code: "custom", message: "purpose/output schema mismatch" });
    }
    if (value.status === "completed") {
      if (value.result === null || value.output_digest === null || value.error !== null || value.completed_at === null) {
        context.addIssue({ code: "custom", message: "completed inference requires validated result and digest" });
      }
    } else if (["cancelled", "deadline_exceeded", "rejected_incompatible", "failed"].includes(value.status)) {
      if (value.result !== null || value.error === null || value.completed_at === null) {
        context.addIssue({ code: "custom", message: "terminal failure cannot contain a result" });
      }
    }
    if (value.outcome) {
      const expectedDisposition = value.status === "completed"
        ? "completed"
        : value.status === "cancelled"
          ? "cancelled"
          : ["deadline_exceeded", "rejected_incompatible", "failed"].includes(value.status)
            ? "failed"
            : null;
      if (value.outcome.final_disposition !== expectedDisposition) {
        context.addIssue({ code: "custom", path: ["outcome", "final_disposition"], message: "outcome disposition must match inference status" });
      }
      if (value.outcome.attempt_count !== value.attempt_count) {
        context.addIssue({ code: "custom", path: ["outcome", "attempt_count"], message: "outcome attempt count must match inference result" });
      }
      if (value.error && value.outcome.retryable !== value.error.retryable) {
        context.addIssue({ code: "custom", path: ["outcome", "retryable"], message: "outcome retryability must match inference error" });
      }
    }
  });

export const LegacyModelCompatibilityEntrySchema = z
  .object({
    registry_version: z.literal(1),
    provider_profile_id: NonEmptyStringSchema,
    model_id: NonEmptyStringSchema,
    purpose: InferencePurposeSchema,
    output_schema_id: NonEmptyStringSchema,
    prompt_policy_id: NonEmptyStringSchema,
    prompt_policy_version: NonEmptyStringSchema,
    compatible: z.boolean(),
    fixture_corpus_digest: Sha256DigestSchema,
    tested_at: TimestampSchema,
    zero_unsupported_claim_gate: z.boolean(),
    schema_success_rate: z.number().min(0).max(1),
    latency_p95_ms: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    const recognizedHistoricalGeneralSchema = value.purpose === "general_resume_draft"
      && ["resume.general-draft.v1", "resume.general-draft.v2"].includes(value.output_schema_id);
    if (value.output_schema_id !== PURPOSE_OUTPUT_SCHEMAS[value.purpose] && !recognizedHistoricalGeneralSchema) {
      context.addIssue({ code: "custom", message: "purpose/output schema mismatch" });
    }
    if (value.compatible && (!value.zero_unsupported_claim_gate || value.schema_success_rate < 1)) {
      context.addIssue({ code: "custom", message: "compatibility requires the accepted conformance threshold" });
    }
  });

export const ModelCompatibilityEvidenceClassSchema = z.enum([
  "authorized_live_provider",
  "host_owned_zero_call",
  "credential_free_synthetic",
]);

export const ModelCompatibilityRunSchema = z
  .object({
    fixture_id: z.string().min(1).max(96).regex(/^[a-z0-9][a-z0-9_-]*$/),
    fixture_digest: Sha256DigestSchema,
    operation_id: OpaqueIdSchema,
    attempt_count: z.number().int().min(0).max(2),
    provider_call_count: z.number().int().min(0).max(2),
    observed_model_id: NonEmptyStringSchema.nullable(),
    finish_category: InferenceFinishCategorySchema,
    recovery_class: InferenceRecoveryClassSchema,
    completion_mode: InferenceCompletionModeSchema,
    final_disposition: InferenceFinalDispositionSchema,
    error_code: InferenceErrorCodeSchema.nullable(),
    schema_valid: z.boolean(),
    evidence_valid: z.boolean(),
    provider_success: z.boolean(),
    latency_ms: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    const completed = value.final_disposition === "completed";
    if (completed !== (value.error_code === null)) {
      context.addIssue({ code: "custom", message: "completed run and error code disagree" });
    }
    if (completed !== (value.completion_mode !== "none")) {
      context.addIssue({ code: "custom", message: "completion mode and disposition disagree" });
    }
    if (completed && (!value.schema_valid || !value.evidence_valid)) {
      context.addIssue({ code: "custom", message: "completed run requires schema and evidence validity" });
    }
    const providerSuccess = completed && ["primary", "provider_repair"].includes(value.completion_mode);
    if (value.provider_success !== providerSuccess) {
      context.addIssue({ code: "custom", message: "provider success must exclude fallback and host-owned completion" });
    }
    if (value.completion_mode === "host_owned" && value.provider_call_count !== 0) {
      context.addIssue({ code: "custom", message: "host-owned completion must make zero provider calls" });
    }
    if (value.provider_call_count !== value.attempt_count) {
      context.addIssue({ code: "custom", message: "provider call count must match the bounded attempt count" });
    }
  });

export const ModelCompatibilityEntryV2Schema = z
  .object({
    registry_version: z.literal(2),
    provider_profile_id: NonEmptyStringSchema,
    model_id: NonEmptyStringSchema,
    observed_model_id: NonEmptyStringSchema.nullable(),
    effective_config_fingerprint: Sha256DigestSchema,
    purpose: InferencePurposeSchema,
    output_schema_id: NonEmptyStringSchema,
    output_schema_version: z.literal(1),
    prompt_policy_id: NonEmptyStringSchema,
    prompt_policy_version: NonEmptyStringSchema,
    fixture_corpus_digest: Sha256DigestSchema,
    fixture_count: z.number().int().positive(),
    runs_per_fixture: z.literal(3),
    operation_count: z.number().int().positive(),
    evidence_class: ModelCompatibilityEvidenceClassSchema,
    outcomes: z.object({
      primary_success: z.number().int().nonnegative(),
      structural_repair_success: z.number().int().nonnegative(),
      validation_repair_success: z.number().int().nonnegative(),
      deterministic_fallback_success: z.number().int().nonnegative(),
      host_owned_success: z.number().int().nonnegative(),
      safe_failure: z.number().int().nonnegative(),
      schema_valid: z.number().int().nonnegative(),
      evidence_valid: z.number().int().nonnegative(),
      provider_success: z.number().int().nonnegative(),
      zero_provider_call: z.number().int().nonnegative(),
    }).strict(),
    all_required_runs_valid: z.boolean(),
    compatible: z.boolean(),
    zero_unsupported_claim_gate: z.boolean(),
    latency_p95_ms: z.number().int().nonnegative(),
    tested_at: TimestampSchema,
    expires_at: TimestampSchema,
    runs: z.array(ModelCompatibilityRunSchema).min(3).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.output_schema_id !== PURPOSE_OUTPUT_SCHEMAS[value.purpose]) {
      context.addIssue({ code: "custom", message: "purpose/output schema mismatch" });
    }
    const expectedExpiry = Date.parse(value.tested_at) + 90 * 24 * 60 * 60 * 1_000;
    if (Date.parse(value.expires_at) !== expectedExpiry) {
      context.addIssue({ code: "custom", path: ["expires_at"], message: "compatibility evidence must expire exactly 90 days after testing" });
    }
    if (value.operation_count !== value.runs.length) {
      context.addIssue({ code: "custom", message: "operation count must retain every run" });
    }
    const operationIds = new Set(value.runs.map((run) => run.operation_id));
    if (operationIds.size !== value.runs.length) {
      context.addIssue({ code: "custom", message: "compatibility runs require unique logical operation IDs" });
    }
    const fixtureCounts = new Map<string, number>();
    for (const run of value.runs) fixtureCounts.set(run.fixture_id, (fixtureCounts.get(run.fixture_id) ?? 0) + 1);
    if (fixtureCounts.size !== value.fixture_count || [...fixtureCounts.values()].some((count) => count !== value.runs_per_fixture)) {
      context.addIssue({ code: "custom", message: "every retained fixture requires exactly three runs" });
    }
    const observedIds = new Set(value.runs.flatMap((run) => run.observed_model_id === null ? [] : [run.observed_model_id]));
    const runsWithoutObservedIdentity = value.runs.filter((run) => run.observed_model_id === null).length;
    const soleObservedId = observedIds.size === 1 ? [...observedIds][0]! : null;
    const observedIdentityBindingValid = observedIds.size === 0
      ? value.observed_model_id === null
      : observedIds.size === 1
        ? value.observed_model_id === soleObservedId
        : value.observed_model_id === null;
    if (!observedIdentityBindingValid) {
      context.addIssue({ code: "custom", path: ["observed_model_id"], message: "top-level observed model identity must exactly summarize retained runs" });
    }
    const observedIdentityConsistent = observedIds.size === 0
      || (observedIds.size === 1 && runsWithoutObservedIdentity === 0);
    const sortedLatencies = value.runs.map((run) => run.latency_ms).sort((left, right) => left - right);
    const retainedLatencyP95 = sortedLatencies[Math.max(0, Math.ceil(sortedLatencies.length * 0.95) - 1)]!;
    if (value.latency_p95_ms !== retainedLatencyP95) {
      context.addIssue({ code: "custom", path: ["latency_p95_ms"], message: "latency p95 must equal the percentile recomputed from retained runs" });
    }
    const tally = {
      primary_success: value.runs.filter((run) => run.completion_mode === "primary").length,
      structural_repair_success: value.runs.filter((run) => run.completion_mode === "provider_repair" && run.recovery_class === "provider_structural_repair").length,
      validation_repair_success: value.runs.filter((run) => run.completion_mode === "provider_repair" && run.recovery_class === "provider_validation_repair").length,
      deterministic_fallback_success: value.runs.filter((run) => run.completion_mode === "deterministic_fallback").length,
      host_owned_success: value.runs.filter((run) => run.completion_mode === "host_owned").length,
      safe_failure: value.runs.filter((run) => run.final_disposition !== "completed").length,
      schema_valid: value.runs.filter((run) => run.schema_valid).length,
      evidence_valid: value.runs.filter((run) => run.evidence_valid).length,
      provider_success: value.runs.filter((run) => run.provider_success).length,
      zero_provider_call: value.runs.filter((run) => run.provider_call_count === 0).length,
    };
    if (JSON.stringify(value.outcomes) !== JSON.stringify(tally)) {
      context.addIssue({ code: "custom", message: "decomposed outcome counts must match retained runs" });
    }
    const allValid = value.runs.every((run) => run.final_disposition === "completed" && run.schema_valid && run.evidence_valid);
    if (value.all_required_runs_valid !== allValid) {
      context.addIssue({ code: "custom", message: "all-run validity must match retained outcomes" });
    }
    const craft = value.purpose === "resume_craft_evaluate";
    const evidenceClassValid = craft
      ? value.evidence_class === "host_owned_zero_call" && tally.zero_provider_call === value.runs.length && tally.host_owned_success === value.runs.length
      : value.evidence_class === "authorized_live_provider";
    const compatible = allValid
      && value.zero_unsupported_claim_gate
      && evidenceClassValid
      && observedIdentityConsistent
      && retainedLatencyP95 <= PURPOSE_LIMITS[value.purpose].duration_ms;
    if (value.compatible !== compatible) {
      context.addIssue({ code: "custom", message: "compatibility must match evidence class and zero-tolerance gates" });
    }
  });

export const ModelCompatibilityEntrySchema = z.discriminatedUnion("registry_version", [
  LegacyModelCompatibilityEntrySchema,
  ModelCompatibilityEntryV2Schema,
]);

export function parseInferencePurpose(value: unknown): InferencePurpose {
  const parsed = InferencePurposeSchema.safeParse(value);
  if (!parsed.success) {
    throw new ContractViolation("unknown_purpose", "Inference purpose is not in the accepted MVP allowlist");
  }
  return parsed.data;
}
