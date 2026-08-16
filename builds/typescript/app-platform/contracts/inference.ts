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
  "resume_dialogue",
  "resume_transcript_extract",
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
  resume_dialogue: "resume.dialogue-turn.v2",
  resume_transcript_extract: "resume.transcript-extraction.v1",
  interview_assist: "resume.interview-assist.v2",
  general_resume_draft: "resume.general-draft.v1",
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
  resume_dialogue: { input_bytes: 131_072, input_tokens: 32_768, output_tokens: 4_096, duration_ms: 90_000, attempts: 2, concurrency: 1 },
  resume_transcript_extract: { input_bytes: 262_144, input_tokens: 65_536, output_tokens: 8_192, duration_ms: 120_000, attempts: 2, concurrency: 1 },
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
      "dialogue_context",
      "transcript_snapshot",
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

export const InferenceErrorSchema = z
  .object({
    code: z.enum([
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
    ]),
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
  });

export const ModelCompatibilityEntrySchema = z
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
    if (value.output_schema_id !== PURPOSE_OUTPUT_SCHEMAS[value.purpose]) {
      context.addIssue({ code: "custom", message: "purpose/output schema mismatch" });
    }
    if (value.compatible && (!value.zero_unsupported_claim_gate || value.schema_success_rate < 1)) {
      context.addIssue({ code: "custom", message: "compatibility requires the accepted conformance threshold" });
    }
  });

export function parseInferencePurpose(value: unknown): InferencePurpose {
  const parsed = InferencePurposeSchema.safeParse(value);
  if (!parsed.success) {
    throw new ContractViolation("unknown_purpose", "Inference purpose is not in the accepted MVP allowlist");
  }
  return parsed.data;
}
