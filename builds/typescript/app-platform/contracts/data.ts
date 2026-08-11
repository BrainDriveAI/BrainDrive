import { z } from "zod";

import {
  canonicalInputDigest,
  ExtensionsSchema,
  NonEmptyStringSchema,
  OpaqueIdSchema,
  RevisionMetadataSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from "./common.js";
import { RESUME_DATA_SCHEMA_VERSION } from "./constants.js";

export const FactStateSchema = z.enum(["confirmed", "imported", "suggested", "rejected"]);
export const SensitivitySchema = z.enum(["standard", "sensitive", "highly_sensitive"]);
export const RecordStatusSchema = z.enum(["draft", "proposed", "approved", "superseded", "retired"]);
export const EvidenceStatusSchema = z.enum([
  "supported",
  "partially_supported",
  "unsupported",
  "ambiguous",
  "clarification_needed",
]);
export const RequirementKindSchema = z.enum([
  "required",
  "preferred",
  "responsibility",
  "skill",
  "credential",
  "constraint",
  "inferred",
]);
export const RetentionClassSchema = z.enum([
  "durable_owner_data",
  "durable_provenance_while_referenced",
  "durable_operation_lookup",
  "rollback_recovery_window",
  "disposable_preview_cache",
  "transient_abandoned_operation",
  "external_owner_file",
  "runtime_authority",
]);
export const RecordLifecycleStateSchema = z.enum(["active", "superseded", "retired"]);

const RecordEnvelopeSchema = z
  .object({
    schema_version: z.union([z.literal(1), z.literal(2), z.literal(RESUME_DATA_SCHEMA_VERSION)]),
    record_type: NonEmptyStringSchema,
    metadata: RevisionMetadataSchema,
    owner_id: OpaqueIdSchema,
    updated_at: TimestampSchema,
    lifecycle_state: RecordLifecycleStateSchema,
    sensitivity: SensitivitySchema,
    retention_class: RetentionClassSchema,
    extensions: ExtensionsSchema,
  })
  .strict();

export const SourceRecordSchema = RecordEnvelopeSchema.extend({
  record_type: z.literal("source"),
  source_kind: z.enum(["owner_interview", "accepted_import", "career_handoff", "owner_edit"]),
  safe_label: z.string().min(1).max(256),
  content_digest: Sha256DigestSchema,
  captured_at: TimestampSchema,
  source_ref: OpaqueIdSchema,
  untrusted_content: z.literal(true),
}).strict();

export const OwnerConfirmationProofSchema = z
  .object({
    confirmation_id: OpaqueIdSchema,
    owner_id: OpaqueIdSchema,
    actor_id: OpaqueIdSchema,
    host_mediated: z.literal(true),
    decision: z.enum(["accept", "edit_and_accept", "reject"]),
    confirmed_at: TimestampSchema,
    operation_id: OpaqueIdSchema,
    input_revision_id: OpaqueIdSchema,
  })
  .strict();

export const CareerFactRecordSchema = RecordEnvelopeSchema.extend({
  record_type: z.literal("career_fact"),
  fact_kind: z.enum([
    "identity",
    "contact",
    "employment",
    "education",
    "skill",
    "credential",
    "accomplishment",
    "project",
    "preference",
    "job_evidence",
  ]),
  state: FactStateSchema,
  value: z.string().min(1).max(16_384),
  source_revision_ids: z.array(OpaqueIdSchema).min(1),
  confirmation: OwnerConfirmationProofSchema.nullable(),
  supersedes_fact_revision_id: OpaqueIdSchema.nullable(),
  review: z.object({ reviewed_at: TimestampSchema.nullable(), review_note: z.string().max(512).nullable() }).strict(),
}).strict().superRefine((value, context) => {
  if (value.state === "confirmed" && (!value.confirmation || value.confirmation.decision === "reject")) {
    context.addIssue({ code: "custom", message: "confirmed facts require host owner acceptance proof" });
  }
  if (value.state === "rejected" && value.confirmation?.decision !== "reject") {
    context.addIssue({ code: "custom", message: "rejected facts require host owner rejection proof" });
  }
  if (["imported", "suggested"].includes(value.state) && value.confirmation !== null) {
    context.addIssue({ code: "custom", message: "proposal facts cannot carry confirmation proof" });
  }
  if (value.owner_id !== value.metadata.created_by.owner_id) {
    context.addIssue({ code: "custom", message: "record owner scope does not match creator authority" });
  }
  if (value.fact_kind === "job_evidence") {
    if (value.schema_version === 1) context.addIssue({ code: "custom", path: ["schema_version"], message: "job evidence requires schema version 2 or 3" });
    try {
      const evidence = JobEvidenceValueSchema.parse(JSON.parse(value.value));
      if (value.schema_version === 3 && evidence.outcome !== "answered") {
        context.addIssue({ code: "custom", path: ["value"], message: "schema-3 career evidence may contain answered facts only" });
      }
    } catch {
      context.addIssue({ code: "custom", path: ["value"], message: "job evidence requires strict structured value" });
    }
  }
});

export const JobEvidenceDimensionSchema = z.enum([
  "identity", "responsibilities", "tools", "accomplishments", "outcomes", "scope", "progression",
]);

export const JobEvidenceValueSchema = z.object({
  value_version: z.literal(1),
  association: z.enum(["job", "general"]),
  job_fact_revision_id: OpaqueIdSchema.nullable(),
  dimension: JobEvidenceDimensionSchema,
  outcome: z.enum(["answered", "skipped", "unknown", "not_applicable", "complete_for_now"]),
  owner_text: z.string().max(16_384),
}).strict().superRefine((value, context) => {
  if ((value.association === "job") !== (value.job_fact_revision_id !== null)) {
    context.addIssue({ code: "custom", message: "job evidence association and job revision must agree" });
  }
  if ((value.outcome === "answered") !== (value.owner_text.length > 0)) {
    context.addIssue({ code: "custom", message: "only answered job evidence may contain owner text" });
  }
});

export const JobEvidenceCoverageStateSchema = z.enum([
  "unanswered", "answered", "unknown", "not_applicable", "skipped", "deferred", "conflicting",
]);

const CoverageDimensionSchema = z.object({
  state: JobEvidenceCoverageStateSchema,
  evidence_revision_ids: z.array(OpaqueIdSchema).max(32),
  recorded_at: TimestampSchema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.state === "answered") !== (value.evidence_revision_ids.length > 0)) {
    context.addIssue({ code: "custom", message: "answered coverage alone may reference factual evidence" });
  }
  if ((value.state === "unanswered") !== (value.recorded_at === null)) {
    context.addIssue({ code: "custom", message: "only unanswered coverage omits a disposition time" });
  }
});

export const JobEvidenceCoverageDimensionsSchema = z.object({
  responsibilities: CoverageDimensionSchema,
  tools: CoverageDimensionSchema,
  accomplishments: CoverageDimensionSchema,
  outcomes: CoverageDimensionSchema,
  scope: CoverageDimensionSchema,
  progression: CoverageDimensionSchema,
}).strict();

export const CoverageOpportunitySchema = z.object({
  opportunity_id: OpaqueIdSchema,
  dimension: JobEvidenceDimensionSchema.exclude(["identity"]),
  opportunity_kind: z.enum(["qualitative", "metric"]),
  value_category: z.enum(["distinct_accomplishment", "decision_useful_outcome", "scope_or_scale", "tools_in_use", "progression", "core_responsibility"]),
  context_digest: Sha256DigestSchema,
  state: z.enum(["available", "suppressed", "resolved"]),
  suppression_reason: z.enum(["owner_declined", "already_known", "duplicate", "low_value"]).nullable(),
  attempt_count: z.number().int().min(0).max(1),
  reopened_at: TimestampSchema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.state === "suppressed") !== (value.suppression_reason !== null)) {
    context.addIssue({ code: "custom", message: "only suppressed opportunities require a reason" });
  }
});

export const JobEvidenceCoverageRecordSchema = RecordEnvelopeSchema.extend({
  schema_version: z.literal(3),
  record_type: z.literal("job_evidence_coverage"),
  coverage_version: z.literal(1),
  job_fact_revision_id: OpaqueIdSchema,
  dimensions: JobEvidenceCoverageDimensionsSchema,
  opportunities: z.array(CoverageOpportunitySchema).max(100),
  migrated_legacy_evidence_revision_ids: z.array(OpaqueIdSchema).max(500),
  coverage_digest: Sha256DigestSchema,
}).strict().superRefine((value, context) => {
  const expected = canonicalInputDigest({
    coverage_version: value.coverage_version,
    job_fact_revision_id: value.job_fact_revision_id,
    dimensions: value.dimensions,
    opportunities: value.opportunities,
    migrated_legacy_evidence_revision_ids: value.migrated_legacy_evidence_revision_ids,
  });
  if (value.coverage_digest !== expected) context.addIssue({ code: "custom", path: ["coverage_digest"], message: "coverage digest mismatch" });
});

export const ResumeStatementSchema = z
  .object({
    statement_id: OpaqueIdSchema,
    section_id: NonEmptyStringSchema.default("experience"),
    kind: z.enum(["factual", "presentation"]),
    display_role: z.enum(["heading", "bullet", "line"]).optional(),
    text: z.string().min(1).max(8_192),
    supporting_confirmed_fact_revision_ids: z.array(OpaqueIdSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "factual" && value.supporting_confirmed_fact_revision_ids.length === 0) {
      context.addIssue({ code: "custom", message: "factual statements require confirmed fact revision support" });
    }
  });

export const ResumeStrategyOmissionReasonSchema = z.enum([
  "redundant", "low_relevance", "space", "older_context", "owner_direction", "structural_mismatch", "conflict",
]);
export const ResumeRoleBulletDensitySchema = z.enum(["none", "compact", "standard", "expanded"]);
export const ResumeStrategyBindingSchema = z.object({
  binding_version: z.literal(1),
  strategy_revision_id: OpaqueIdSchema,
  fact_snapshot_digest: Sha256DigestSchema,
  fact_revision_ids: z.array(OpaqueIdSchema).max(500),
  coverage_revision_ids: z.array(OpaqueIdSchema).max(500),
  strategy_input_digest: Sha256DigestSchema,
  strategy_output_digest: Sha256DigestSchema,
  generation_input_digest: Sha256DigestSchema,
  generation_output_digest: Sha256DigestSchema,
  prompt_policy_id: NonEmptyStringSchema,
  prompt_policy_version: NonEmptyStringSchema,
  quality_standard_id: NonEmptyStringSchema,
  quality_standard_version: NonEmptyStringSchema,
  quality_standard_digest: Sha256DigestSchema,
  provider_profile_id: NonEmptyStringSchema,
  model_id: NonEmptyStringSchema,
  used_must_use_fact_revision_ids: z.array(OpaqueIdSchema).max(500),
  omissions: z.array(z.object({
    fact_revision_id: OpaqueIdSchema,
    reason_code: ResumeStrategyOmissionReasonSchema,
  }).strict()).max(500),
}).strict();

export const DefinitionApprovalEvidenceSchema = z.object({
  validation_run_id: OpaqueIdSchema,
  validator_id: NonEmptyStringSchema,
  validator_version: NonEmptyStringSchema,
  validator_policy_digest: Sha256DigestSchema,
  input_snapshot_digest: Sha256DigestSchema,
  output_digest: Sha256DigestSchema,
  findings_digest: Sha256DigestSchema,
  prompt_policy_id: NonEmptyStringSchema,
  prompt_policy_version: NonEmptyStringSchema,
  provider_policy_id: NonEmptyStringSchema,
  quality_report_digest: Sha256DigestSchema,
  quality_input_digest: Sha256DigestSchema,
  quality_validator_id: NonEmptyStringSchema,
  quality_validator_version: NonEmptyStringSchema,
  validated_at: TimestampSchema,
  persuasive_quality: z.object({
    contract_version: z.literal(1),
    status: z.enum(["legacy_mechanical_only", "current"]),
    coverage_revision_ids: z.array(OpaqueIdSchema).max(500),
    strategy_revision_id: OpaqueIdSchema.nullable(),
    craft_report_revision_id: OpaqueIdSchema.nullable(),
    craft_report_digest: Sha256DigestSchema.nullable(),
    craft_definition_digest: Sha256DigestSchema.nullable(),
    target_analysis_revision_id: OpaqueIdSchema.nullable(),
    successor_continuity_digest: Sha256DigestSchema.nullable(),
    evidence_limited_policy_id: NonEmptyStringSchema,
    evidence_limited_policy_version: NonEmptyStringSchema,
    evidence_limited_authority_status: z.literal("provisional_planning_default"),
    parity_policy_id: NonEmptyStringSchema,
    parity_policy_version: NonEmptyStringSchema,
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.persuasive_quality?.status === "current" && (
    value.persuasive_quality.strategy_revision_id === null ||
    value.persuasive_quality.craft_report_revision_id === null ||
    value.persuasive_quality.craft_report_digest === null ||
    value.persuasive_quality.craft_definition_digest === null ||
    value.persuasive_quality.successor_continuity_digest === null
  )) {
    context.addIssue({ code: "custom", path: ["persuasive_quality"], message: "current persuasive approval requires exact strategy, craft, and continuity evidence" });
  }
});

export const ResumeDefinitionRecordSchema = RecordEnvelopeSchema.extend({
  record_type: z.literal("resume_definition"),
  definition_kind: z.enum(["general", "targeted"]),
  status: RecordStatusSchema,
  title: z.string().min(1).max(256),
  statements: z.array(ResumeStatementSchema).min(1).max(500),
  selected_fact_revision_ids: z.array(OpaqueIdSchema),
  section_order: z.array(NonEmptyStringSchema).min(1).max(32),
  presentation_preferences: z.record(z.string(), z.string().max(2_048)),
  locale: z.string().min(2).max(35),
  page_intent: z.enum(["one_page", "two_pages", "concise", "detailed"]),
  template_id: NonEmptyStringSchema,
  template_version: NonEmptyStringSchema,
  parent_definition_revision_id: OpaqueIdSchema.nullable(),
  job_revision_id: OpaqueIdSchema.nullable(),
  policy_version: NonEmptyStringSchema,
  prompt_policy_version: NonEmptyStringSchema.nullable(),
  strategy_binding: ResumeStrategyBindingSchema.nullable().default(null),
  approved_at: TimestampSchema.nullable(),
  approval_evidence: DefinitionApprovalEvidenceSchema.nullable().default(null),
  successor_context: z.object({
    successor_version: z.literal(1),
    kind: z.enum(["remembered_information", "natural_language_revision", "regeneration", "rollback"]),
    source_definition_revision_id: OpaqueIdSchema,
    revision_request_revision_id: OpaqueIdSchema.nullable(),
    changed_fact_revision_ids: z.array(OpaqueIdSchema).max(500),
    stale_tailored_variant_revision_ids: z.array(OpaqueIdSchema).max(500),
    quality_report_digest: Sha256DigestSchema.nullable(),
  }).strict().nullable().optional(),
}).strict().superRefine((value, context) => {
  const isTargeted = value.definition_kind === "targeted";
  if (isTargeted && (value.parent_definition_revision_id === null || value.job_revision_id === null)) {
    context.addIssue({ code: "custom", message: "targeted definitions require exactly one general parent and job revision" });
  }
  if (!isTargeted && value.job_revision_id !== null) {
    context.addIssue({ code: "custom", message: "general definitions cannot carry a job revision" });
  }
  if (new Set(value.selected_fact_revision_ids).size !== value.selected_fact_revision_ids.length) {
    context.addIssue({ code: "custom", message: "duplicate_identity" });
  }
  if (value.statements.some((statement) => !value.section_order.includes(statement.section_id))) {
    context.addIssue({ code: "custom", message: "statement section is absent from section order" });
  }
  if ((value.status === "approved") !== (value.approved_at !== null)) {
    context.addIssue({ code: "custom", message: "approved definitions require an approval timestamp" });
  }
  if ((value.status === "approved") !== (value.approval_evidence !== null)) {
    context.addIssue({ code: "custom", message: "approved definitions require deterministic validation evidence" });
  }
  if ([2, 3].includes(value.schema_version) && value.successor_context === undefined) {
    context.addIssue({ code: "custom", message: "schema-2 and schema-3 definitions require explicit successor context" });
  }
  if (value.schema_version === 1 && value.successor_context !== undefined) {
    context.addIssue({ code: "custom", message: "schema-1 definitions cannot carry schema-2 successor context" });
  }
});

export const JobDescriptionRecordSchema = RecordEnvelopeSchema.extend({
  record_type: z.literal("job_description"),
  job_id: OpaqueIdSchema,
  safe_label: z.string().min(1).max(256),
  source_kind: z.literal("owner_paste"),
  captured_at: TimestampSchema,
  description_text: z.string().min(1).max(131_072),
  content_digest: Sha256DigestSchema,
  untrusted_content: z.literal(true),
}).strict();

export const RequirementEvidenceSchema = z
  .object({
    requirement_id: OpaqueIdSchema,
    requirement_kind: RequirementKindSchema,
    evidence_status: EvidenceStatusSchema,
    source_span: z.string().min(1).max(4_096).nullable(),
    inferred: z.boolean(),
    supporting_confirmed_fact_revision_ids: z.array(OpaqueIdSchema),
    clarification: z.string().max(4_096).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.inferred !== (value.requirement_kind === "inferred")) {
      context.addIssue({ code: "custom", message: "inferred flag must match requirement kind" });
    }
    if (!value.inferred && value.source_span === null) {
      context.addIssue({ code: "custom", message: "stated requirements require a source span" });
    }
    if (value.evidence_status === "supported" && value.supporting_confirmed_fact_revision_ids.length === 0) {
      context.addIssue({ code: "custom", message: "supported evidence requires confirmed fact revisions" });
    }
    if (value.evidence_status === "unsupported" && value.supporting_confirmed_fact_revision_ids.length !== 0) {
      context.addIssue({ code: "custom", message: "unsupported evidence cannot claim supporting facts" });
    }
  });

export const TailoredVariantRecordSchema = RecordEnvelopeSchema.extend({
  record_type: z.literal("tailored_variant"),
  parent_general_definition_revision_id: OpaqueIdSchema,
  targeted_definition_revision_id: OpaqueIdSchema,
  job_revision_id: OpaqueIdSchema,
  evidence_matrix: z.array(RequirementEvidenceSchema).min(1),
  changed_statement_ids: z.array(OpaqueIdSchema),
  target_fit_analysis_revision_id: OpaqueIdSchema.optional(),
}).strict();

export const ResumeHistoryShapeSchema = z.enum([
  "chronological_standard", "early_career", "senior_selective", "career_change", "return_to_work", "concurrent_roles",
]);
export const ResumeStrategyRecordSchema = RecordEnvelopeSchema.extend({
  schema_version: z.literal(3),
  record_type: z.literal("resume_strategy"),
  strategy_version: z.literal(1),
  fact_snapshot_digest: Sha256DigestSchema,
  fact_revision_ids: z.array(OpaqueIdSchema).max(500),
  coverage_revision_ids: z.array(OpaqueIdSchema).max(500),
  target_revision_id: OpaqueIdSchema.nullable(),
  history_shape: ResumeHistoryShapeSchema,
  role_emphasis: z.array(z.object({
    job_fact_revision_id: OpaqueIdSchema,
    priority: z.enum(["primary", "supporting", "compressed"]),
    reason_code: z.enum(["recent", "relevant", "evidence_rich", "continuity", "older_context"]),
    bullet_density: ResumeRoleBulletDensitySchema,
  }).strict()).max(100),
  history_reason_code: z.enum(["standard_chronology", "thin_history", "senior_compression", "career_transition", "employment_gap", "overlap_or_promotion"]),
  section_order: z.array(NonEmptyStringSchema).min(1).max(32),
  evidence_priorities: z.array(z.object({
    fact_revision_id: OpaqueIdSchema,
    priority: z.enum(["must_use", "preferred", "context"]),
  }).strict()).max(500),
  summary_decision: z.enum(["include", "omit"]),
  summary_reason_code: z.enum(["supported_positioning", "insufficient_distinct_value", "redundant_with_experience"]),
  skills_context: z.array(z.object({
    skill_fact_revision_id: OpaqueIdSchema,
    placement: z.enum(["role", "project", "skills_section"]),
    context_fact_revision_ids: z.array(OpaqueIdSchema).max(16),
  }).strict()).max(100),
  omissions: z.array(z.object({
    fact_revision_id: OpaqueIdSchema,
    reason_code: ResumeStrategyOmissionReasonSchema,
  }).strict()).max(500),
  unresolved_gap_ids: z.array(OpaqueIdSchema).max(100),
  owner_rationale: z.string().min(1).max(1_024),
  prompt_policy_id: NonEmptyStringSchema,
  prompt_policy_version: NonEmptyStringSchema,
  quality_standard_id: NonEmptyStringSchema,
  quality_standard_version: NonEmptyStringSchema,
  quality_standard_digest: Sha256DigestSchema,
  provider_profile_id: NonEmptyStringSchema,
  model_id: NonEmptyStringSchema,
  input_digest: Sha256DigestSchema,
  output_digest: Sha256DigestSchema,
}).strict();

export const TargetFitClassSchema = z.enum([
  "meaningfully_supported", "partially_supported_transferable", "lacking_supported_core_fit",
]);
export const MaterialResumeChangeSchema = z.object({
  change_id: OpaqueIdSchema,
  requirement_id: OpaqueIdSchema,
  statement_id: OpaqueIdSchema.nullable(),
  action: z.enum(["selection", "ordering", "emphasis", "faithful_wording", "shorten"]),
  supporting_confirmed_fact_revision_ids: z.array(OpaqueIdSchema).min(1).max(32),
}).strict();
export const TargetFitAnalysisRecordSchema = RecordEnvelopeSchema.extend({
  schema_version: z.literal(3),
  record_type: z.literal("target_fit_analysis"),
  analysis_version: z.literal(1),
  parent_general_definition_revision_id: OpaqueIdSchema,
  job_revision_id: OpaqueIdSchema,
  target_content_digest: Sha256DigestSchema,
  strategy_revision_id: OpaqueIdSchema,
  strategy_digest: Sha256DigestSchema,
  fact_snapshot_digest: Sha256DigestSchema,
  fact_revision_ids: z.array(OpaqueIdSchema).max(500),
  evidence_matrix_digest: Sha256DigestSchema,
  fit_class: TargetFitClassSchema,
  support_counts: z.object({ core: z.number().int().nonnegative(), transferable: z.number().int().nonnegative(), partial: z.number().int().nonnegative(), unsupported: z.number().int().nonnegative() }).strict(),
  material_changes: z.array(MaterialResumeChangeSchema).max(500),
  threshold_policy_id: NonEmptyStringSchema,
  threshold_policy_version: NonEmptyStringSchema,
  prompt_policy_id: NonEmptyStringSchema,
  prompt_policy_version: NonEmptyStringSchema,
  provider_profile_id: NonEmptyStringSchema,
  model_id: NonEmptyStringSchema,
  input_digest: Sha256DigestSchema,
  output_digest: Sha256DigestSchema,
  outcome: z.enum(["targeted_variant", "no_meaningful_change"]),
  analysis_state: z.enum(["ready_for_targeted_draft", "completed"]),
  no_change_reason: z.enum(["ambiguous_evidence", "insufficient_supported_fit", "no_material_resume_change"]).nullable(),
  owner_next_actions: z.array(z.enum(["use_general_resume", "answer_optional_evidence_questions", "try_different_target"])).max(3),
  targeted_definition_revision_id: OpaqueIdSchema.nullable(),
  analysis_digest: Sha256DigestSchema,
}).strict().superRefine((value, context) => {
  const ready = value.outcome === "targeted_variant" && value.analysis_state === "ready_for_targeted_draft";
  const targeted = value.outcome === "targeted_variant" && value.analysis_state === "completed";
  const noChange = value.outcome === "no_meaningful_change" && value.analysis_state === "completed";
  if (!ready && !targeted && !noChange) context.addIssue({ code: "custom", message: "target-fit outcome and lifecycle state must agree" });
  if ((ready && value.targeted_definition_revision_id !== null) || (targeted && value.targeted_definition_revision_id === null)) {
    context.addIssue({ code: "custom", message: "targeted analysis child lineage does not match its lifecycle state" });
  }
  if ((value.outcome === "targeted_variant") !== (value.material_changes.length > 0)) {
    context.addIssue({ code: "custom", message: "target-fit outcome requires an exact material-change manifest" });
  }
  if (noChange !== (value.no_change_reason !== null && value.owner_next_actions.length > 0 && value.targeted_definition_revision_id === null)) {
    context.addIssue({ code: "custom", message: "no-change analysis requires a reason, owner next actions, and no child" });
  }
  const digest = canonicalInputDigest({
    analysis_version: value.analysis_version,
    parent_general_definition_revision_id: value.parent_general_definition_revision_id,
    job_revision_id: value.job_revision_id,
    target_content_digest: value.target_content_digest,
    strategy_revision_id: value.strategy_revision_id,
    strategy_digest: value.strategy_digest,
    fact_snapshot_digest: value.fact_snapshot_digest,
    fact_revision_ids: value.fact_revision_ids,
    evidence_matrix_digest: value.evidence_matrix_digest,
    fit_class: value.fit_class,
    support_counts: value.support_counts,
    material_changes: value.material_changes,
    threshold_policy_id: value.threshold_policy_id,
    threshold_policy_version: value.threshold_policy_version,
    prompt_policy_id: value.prompt_policy_id,
    prompt_policy_version: value.prompt_policy_version,
    provider_profile_id: value.provider_profile_id,
    model_id: value.model_id,
    input_digest: value.input_digest,
    output_digest: value.output_digest,
    outcome: value.outcome,
    analysis_state: value.analysis_state,
    no_change_reason: value.no_change_reason,
    owner_next_actions: value.owner_next_actions,
    targeted_definition_revision_id: value.targeted_definition_revision_id,
  });
  if (value.analysis_digest !== digest) context.addIssue({ code: "custom", path: ["analysis_digest"], message: "target-fit analysis digest mismatch" });
});

export const CraftCriterionSchema = z.enum(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "T1", "T2", "T3"]);
export const CraftCorrectionClassSchema = z.enum(["specificity", "duty_only", "generic_language", "redundancy", "density", "organization", "target_relevance"]);
export const CraftEvidenceCategorySchema = z.enum(["statement_support", "must_use_evidence", "strategy", "target_analysis", "deterministic_gate", "optional_gap", "explicit_absence"]);
export const CraftQualityReportRecordSchema = RecordEnvelopeSchema.extend({
  schema_version: z.literal(3),
  record_type: z.literal("craft_quality_report"),
  report_version: z.literal(1),
  proposal_definition_revision_id: OpaqueIdSchema,
  strategy_revision_id: OpaqueIdSchema,
  target_analysis_revision_id: OpaqueIdSchema.nullable(),
  definition_digest: Sha256DigestSchema,
  strategy_digest: Sha256DigestSchema,
  fact_snapshot_digest: Sha256DigestSchema,
  fact_revision_ids: z.array(OpaqueIdSchema).max(500),
  coverage_revision_ids: z.array(OpaqueIdSchema).max(500),
  quality_standard_id: NonEmptyStringSchema,
  quality_standard_version: NonEmptyStringSchema,
  quality_standard_digest: Sha256DigestSchema,
  evidence_limited_policy_id: NonEmptyStringSchema,
  evidence_limited_policy_version: NonEmptyStringSchema,
  evidence_limited_authority_status: z.literal("provisional_planning_default"),
  truth_validation_digest: Sha256DigestSchema,
  structure_validation_digest: Sha256DigestSchema,
  criterion_verdicts: z.array(z.object({ criterion: CraftCriterionSchema, verdict: z.enum(["pass", "fail", "not_applicable"]), finding_ids: z.array(OpaqueIdSchema).max(500) }).strict()).length(10),
  findings: z.array(z.object({
    finding_id: OpaqueIdSchema, criterion: CraftCriterionSchema, statement_id: OpaqueIdSchema.nullable(),
    severity: z.enum(["guidance", "blocking"]), correction_class: CraftCorrectionClassSchema,
    safe_message: z.string().min(1).max(512), evidence_category: CraftEvidenceCategorySchema,
    evidence_revision_ids: z.array(OpaqueIdSchema).max(500),
  }).strict()).max(500),
  evidence_context: z.enum(["standard", "limited"]),
  verdict: z.enum(["pass", "fail"]),
  prompt_policy_id: NonEmptyStringSchema,
  prompt_policy_version: NonEmptyStringSchema,
  provider_profile_id: NonEmptyStringSchema,
  model_id: NonEmptyStringSchema,
  input_digest: Sha256DigestSchema,
  output_digest: Sha256DigestSchema,
  evaluated_at: TimestampSchema,
  report_digest: Sha256DigestSchema,
}).strict().superRefine((value, context) => {
  const criteria = value.criterion_verdicts.map((entry) => entry.criterion);
  const expected = CraftCriterionSchema.options;
  if (new Set(criteria).size !== expected.length || expected.some((criterion) => !criteria.includes(criterion))) {
    context.addIssue({ code: "custom", path: ["criterion_verdicts"], message: "craft report requires every criterion exactly once" });
  }
  const findingIds = new Set(value.findings.map((finding) => finding.finding_id));
  if (findingIds.size !== value.findings.length || value.criterion_verdicts.some((entry) => entry.finding_ids.some((id) => !findingIds.has(id)))) {
    context.addIssue({ code: "custom", path: ["findings"], message: "craft finding identities must be unique and internally referenced" });
  }
  const failed = value.criterion_verdicts.some((entry) => entry.verdict === "fail") || value.findings.some((finding) => finding.severity === "blocking");
  if ((value.verdict === "fail") !== failed) context.addIssue({ code: "custom", path: ["verdict"], message: "craft verdict must match mandatory findings" });
  const { metadata: _metadata, record_type: _recordType, schema_version: _schemaVersion, owner_id: _ownerId, updated_at: _updatedAt, lifecycle_state: _lifecycleState, sensitivity: _sensitivity, retention_class: _retentionClass, extensions: _extensions, report_digest: _reportDigest, ...body } = value;
  if (value.report_digest !== canonicalInputDigest(body)) context.addIssue({ code: "custom", path: ["report_digest"], message: "craft report digest mismatch" });
});

export const CraftRepairOperationRecordSchema = RecordEnvelopeSchema.extend({
  schema_version: z.literal(3),
  record_type: z.literal("craft_repair_operation"),
  repair_version: z.literal(1),
  attempt: z.literal(1),
  source_definition_revision_id: OpaqueIdSchema,
  source_report_revision_id: OpaqueIdSchema,
  source_definition_digest: Sha256DigestSchema,
  source_report_digest: Sha256DigestSchema,
  strategy_revision_id: OpaqueIdSchema,
  target_analysis_revision_id: OpaqueIdSchema.nullable(),
  fact_snapshot_digest: Sha256DigestSchema,
  statement_scope_ids: z.array(OpaqueIdSchema).min(1).max(500),
  allowed_correction_classes: z.array(CraftCorrectionClassSchema).min(1).max(7),
  prompt_policy_id: NonEmptyStringSchema,
  prompt_policy_version: NonEmptyStringSchema,
  provider_profile_id: NonEmptyStringSchema,
  model_id: NonEmptyStringSchema,
  input_digest: Sha256DigestSchema,
  result: z.enum(["completed", "rejected", "failed", "cancelled"]),
  successor_definition_revision_id: OpaqueIdSchema.nullable(),
  successor_report_revision_id: OpaqueIdSchema.nullable(),
  output_digest: Sha256DigestSchema.nullable(),
  unchanged_statement_count: z.number().int().nonnegative().max(500),
  error_class: z.enum(["provider", "schema", "validation", "regression", "cancelled"]).nullable(),
  completed_at: TimestampSchema,
  operation_digest: Sha256DigestSchema,
}).strict().superRefine((value, context) => {
  const completed = value.result === "completed";
  if (completed !== (value.successor_definition_revision_id !== null && value.successor_report_revision_id !== null && value.output_digest !== null && value.error_class === null)) {
    context.addIssue({ code: "custom", message: "repair result and terminal lineage must agree" });
  }
  if (!completed && value.error_class === null) context.addIssue({ code: "custom", message: "unsuccessful repair requires a safe error class" });
  const { metadata: _metadata, record_type: _recordType, schema_version: _schemaVersion, owner_id: _ownerId, updated_at: _updatedAt, lifecycle_state: _lifecycleState, sensitivity: _sensitivity, retention_class: _retentionClass, extensions: _extensions, operation_digest: _operationDigest, ...body } = value;
  if (value.operation_digest !== canonicalInputDigest(body)) context.addIssue({ code: "custom", path: ["operation_digest"], message: "craft repair operation digest mismatch" });
});

export const ArtifactParityReportRecordSchema = RecordEnvelopeSchema.extend({
  schema_version: z.literal(3),
  record_type: z.literal("artifact_parity_report"),
  parity_version: z.literal(1),
  approved_definition_revision_id: OpaqueIdSchema,
  parity_policy_id: NonEmptyStringSchema,
  parity_policy_version: NonEmptyStringSchema,
  representations: z.array(z.object({
    kind: z.enum(["approved_definition", "preview", "clean_text", "pdf_extraction", "career_projection"]),
    revision_id: OpaqueIdSchema,
    logical_manifest_digest: Sha256DigestSchema,
    entry_count: z.number().int().nonnegative().max(1_000),
  }).strict()).length(5),
  mismatch_categories: z.array(z.enum(["identity", "association", "field_recovery", "count", "order", "normalized_digest"])).max(6),
  disposition: z.enum(["pass", "block_preview", "block_export", "block_career_projection"]),
  report_digest: Sha256DigestSchema,
  checked_at: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (new Set(value.representations.map((item) => item.kind)).size !== 5) context.addIssue({ code: "custom", message: "parity report requires every representation exactly once" });
  if ((value.disposition === "pass") !== (value.mismatch_categories.length === 0)) context.addIssue({ code: "custom", message: "parity disposition and mismatches must agree" });
  const { metadata: _metadata, record_type: _recordType, schema_version: _schemaVersion, owner_id: _ownerId, updated_at: _updatedAt, lifecycle_state: _lifecycleState, sensitivity: _sensitivity, retention_class: _retentionClass, extensions: _extensions, report_digest: _reportDigest, ...body } = value;
  if (value.report_digest !== canonicalInputDigest(body)) context.addIssue({ code: "custom", path: ["report_digest"], message: "artifact parity report digest mismatch" });
});

export const ValidatorFindingSchema = z
  .object({
    finding_id: OpaqueIdSchema,
    validator_id: NonEmptyStringSchema,
    validator_version: NonEmptyStringSchema,
    severity: z.enum(["info", "warning", "error"]),
    code: z.enum([
      "unsupported_claim",
      "partial_support_overstated",
      "missing_provenance",
      "protected_field_changed",
      "schema_invalid",
      "lineage_invalid",
      "parse_back_mismatch",
    ]),
    statement_id: OpaqueIdSchema.nullable(),
    safe_message: z.string().min(1).max(512),
  })
  .strict();

export const ArtifactRecordSchema = RecordEnvelopeSchema.extend({
  record_type: z.literal("artifact"),
  definition_revision_id: OpaqueIdSchema,
  template_id: NonEmptyStringSchema,
  template_version: NonEmptyStringSchema,
  renderer_id: NonEmptyStringSchema,
  renderer_version: NonEmptyStringSchema,
  font_manifest_digest: Sha256DigestSchema,
  validation_run_id: OpaqueIdSchema,
  findings: z.array(ValidatorFindingSchema),
  artifact_digest: Sha256DigestSchema,
  format: z.enum(["pdf", "text", "docx", "html"]),
  accepted: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.accepted && value.findings.some((finding) => finding.severity === "error")) {
    context.addIssue({ code: "custom", message: "artifacts with validation errors cannot be accepted" });
  }
});

export const ExportReceiptRecordSchema = RecordEnvelopeSchema.extend({
  record_type: z.literal("export_receipt"),
  operation_id: OpaqueIdSchema,
  artifact_revision_id: OpaqueIdSchema,
  artifact_digest: Sha256DigestSchema,
  format: z.enum(["pdf", "text", "docx", "html"]),
  outcome: z.enum(["completed", "cancelled", "failed"]),
  exported_at: TimestampSchema,
  safe_destination_label: z.string().min(1).max(256).regex(/^[^/\\]+$/),
}).strict();

export const MigrationRecordSchema = RecordEnvelopeSchema.extend({
  record_type: z.literal("migration"),
  migration_id: OpaqueIdSchema,
  from_schema_version: z.number().int().nonnegative(),
  to_schema_version: z.number().int().positive(),
  status: z.enum(["staged", "validated", "committed", "rolled_back", "failed_recoverable"]),
  source_catalog_digest: Sha256DigestSchema,
  result_catalog_digest: Sha256DigestSchema.nullable(),
  recovery_snapshot_id: OpaqueIdSchema,
  started_at: TimestampSchema,
  completed_at: TimestampSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.to_schema_version <= value.from_schema_version) {
    context.addIssue({ code: "custom", message: "migration must move to a newer schema version" });
  }
});

export const CareerReturnSummarySchema = z
  .object({
    summary_version: z.literal(1),
    status: z.enum(["not_started", "in_progress", "review_needed", "completed", "blocked"]),
    outcome_summary: z.string().min(1).max(1_024),
    approved_reference: z.object({
      kind: z.enum(["general_resume", "tailored_variant"]),
      record_id: OpaqueIdSchema,
      revision_id: OpaqueIdSchema,
      safe_label: z.string().min(1).max(256),
    }).strict().nullable(),
    stable_fact_proposals: z.array(z.object({
      fact_record_id: OpaqueIdSchema,
      fact_revision_id: OpaqueIdSchema,
      safe_summary: z.string().min(1).max(512),
      proposed_placement: z.literal("owner_profile"),
    }).strict()).max(25),
    next_career_action: z.string().max(512).nullable(),
    updated_at: TimestampSchema,
  })
  .strict();

export const CareerContextProjectionSchema = z.object({
  context_version: z.literal(1),
  entry_point: z.enum(["direct", "career"]),
  sources: z.array(z.object({
    source_ref: OpaqueIdSchema,
    source_kind: z.enum(["owner_profile", "career_spec", "career_plan"]),
    status: z.enum(["present", "missing"]),
    content: z.string().max(16_384).nullable(),
    content_digest: Sha256DigestSchema.nullable(),
    last_modified_at: TimestampSchema.nullable(),
  }).strict()).length(3),
  generated_at: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (new Set(value.sources.map((source) => source.source_kind)).size !== 3) {
    context.addIssue({ code: "custom", message: "context projection requires each accepted source exactly once" });
  }
  for (const source of value.sources) {
    const present = source.status === "present";
    if (present !== (source.content !== null && source.content_digest !== null && source.last_modified_at !== null)) {
      context.addIssue({ code: "custom", message: "context source status and content metadata disagree" });
    }
  }
});

export const InterviewTurnAuditSchema = z.object({
  transcript_version: z.literal(1),
  turn_id: OpaqueIdSchema,
  session_id: OpaqueIdSchema,
  prompt_version: z.string().min(1).max(128),
  topic: z.string().min(1).max(128),
  question: z.string().min(1).max(8_192),
  answer: z.string().min(1).max(16_384).nullable(),
  follow_up: z.object({
    question: z.string().min(1).max(8_192),
    answer: z.string().min(1).max(8_192).nullable(),
    outcome: z.enum(["answered", "continued_without_answer"]),
  }).strict().nullable(),
  action: z.enum(["answered", "skipped"]),
  occurred_at: TimestampSchema,
}).strict().superRefine((value, context) => {
  if ((value.action === "answered") !== (value.answer !== null)) {
    context.addIssue({ code: "custom", message: "answered interview turns require an answer and skipped turns cannot contain one" });
  }
  if (value.action === "skipped" && value.follow_up !== null) {
    context.addIssue({ code: "custom", message: "skipped interview turns cannot contain a follow-up" });
  }
  if (value.follow_up?.outcome === "answered" && value.follow_up.answer === null) {
    context.addIssue({ code: "custom", message: "answered follow-ups require an answer" });
  }
  if (value.follow_up?.outcome === "continued_without_answer" && value.follow_up.answer !== null) {
    context.addIssue({ code: "custom", message: "unanswered follow-ups cannot contain an answer" });
  }
});

export const InterviewProgressRecordSchema = RecordEnvelopeSchema.extend({
  record_type: z.literal("interview_progress"),
  status: z.enum(["not_started", "in_progress", "paused", "review_needed", "completed"]),
  current_topic: z.string().max(128).nullable(),
  completed_topics: z.array(z.string().min(1).max(128)).max(100),
  skipped_topics: z.array(z.string().min(1).max(128)).max(100),
  draft_state: z.enum(["declared_draft", "owner_reviewed", "complete"]),
  active_job_fact_revision_id: OpaqueIdSchema.nullable().optional(),
  current_question_id: z.string().min(1).max(128).nullable().optional(),
  current_field_id: z.string().min(1).max(128).nullable().optional(),
  job_dimension: JobEvidenceDimensionSchema.nullable().optional(),
  recovery_draft: z.object({
    slot: z.object({
      session_id: OpaqueIdSchema,
      job_fact_revision_id: OpaqueIdSchema.nullable(),
      question_id: z.string().min(1).max(128),
      field_id: z.string().min(1).max(128),
    }).strict(),
    value: z.string().max(16_384),
    value_digest: Sha256DigestSchema,
    saved_at: TimestampSchema,
    acknowledged_revision: z.number().int().positive(),
  }).strict().nullable().optional(),
  last_submitted_turn_revision_id: OpaqueIdSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.owner_id !== value.metadata.created_by.owner_id) {
    context.addIssue({ code: "custom", message: "record owner scope does not match creator authority" });
  }
  if (value.recovery_draft) {
    if (value.recovery_draft.value_digest !== canonicalInputDigest(value.recovery_draft.value)) {
      context.addIssue({ code: "custom", path: ["recovery_draft", "value_digest"], message: "recovery draft digest mismatch" });
    }
    if (
      value.recovery_draft.slot.job_fact_revision_id !== value.active_job_fact_revision_id ||
      value.recovery_draft.slot.question_id !== value.current_question_id ||
      value.recovery_draft.slot.field_id !== value.current_field_id
    ) {
      context.addIssue({ code: "custom", path: ["recovery_draft", "slot"], message: "recovery draft slot must match active progress" });
    }
    if (value.recovery_draft.acknowledged_revision !== value.metadata.revision) {
      context.addIssue({ code: "custom", path: ["recovery_draft", "acknowledged_revision"], message: "recovery acknowledgement must name the durable progress revision" });
    }
  }
  if ([2, 3].includes(value.schema_version) && [
    "active_job_fact_revision_id", "current_question_id", "current_field_id", "job_dimension", "recovery_draft", "last_submitted_turn_revision_id",
  ].some((key) => !(key in value))) {
    context.addIssue({ code: "custom", message: "schema-2 progress requires explicit recovery fields" });
  }
  if (value.schema_version === 1 && [
    "active_job_fact_revision_id", "current_question_id", "current_field_id", "job_dimension", "recovery_draft", "last_submitted_turn_revision_id",
  ].some((key) => key in value)) {
    context.addIssue({ code: "custom", message: "schema-1 progress cannot carry schema-2 recovery fields" });
  }
});

export const RevisionIntentClassSchema = z.enum(["presentation", "factual", "mixed", "ambiguous"]);

export const ResumeRevisionRequestRecordSchema = RecordEnvelopeSchema.extend({
  schema_version: z.union([z.literal(2), z.literal(3)]),
  record_type: z.literal("resume_revision_request"),
  source_definition_revision_id: OpaqueIdSchema,
  target: z.object({
    scope: z.enum(["statement", "section", "resume"]),
    target_id: z.string().min(1).max(256).nullable(),
  }).strict(),
  request_text: z.string().min(1).max(8_192),
  request_digest: Sha256DigestSchema,
  classification: RevisionIntentClassSchema.nullable(),
  state: z.enum(["submitted", "clarification_needed", "awaiting_confirmation", "generating", "proposed", "accepted", "edited", "rejected", "regenerate", "failed"]),
  clarification: z.string().max(2_048).nullable(),
  attempt: z.number().int().min(0).max(2),
  resulting_definition_revision_id: OpaqueIdSchema.nullable(),
  owner_outcome: z.enum(["accept", "edit", "reject", "regenerate"]).nullable(),
  submitted_at: TimestampSchema,
  completed_at: TimestampSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.owner_id !== value.metadata.created_by.owner_id) context.addIssue({ code: "custom", message: "record owner scope does not match creator authority" });
  if (value.request_digest !== canonicalInputDigest(value.request_text)) context.addIssue({ code: "custom", path: ["request_digest"], message: "revision request digest mismatch" });
  if ((value.target.scope === "resume") !== (value.target.target_id === null)) context.addIssue({ code: "custom", path: ["target"], message: "resume scope has no target ID and narrower scopes require one" });
  if (value.state === "clarification_needed" && !value.clarification) context.addIssue({ code: "custom", path: ["clarification"], message: "clarification-needed state requires a question" });
  if (value.state === "clarification_needed" && value.classification !== "ambiguous") context.addIssue({ code: "custom", path: ["classification"], message: "clarification-needed state requires ambiguous classification" });
  if (["proposed", "accepted", "edited", "rejected", "regenerate"].includes(value.state) && !value.resulting_definition_revision_id) context.addIssue({ code: "custom", path: ["resulting_definition_revision_id"], message: "post-generation revision state requires a resulting definition" });
  const expectedOutcome = value.state === "accepted" ? "accept" : value.state === "edited" ? "edit" : value.state === "rejected" ? "reject" : value.state === "regenerate" ? "regenerate" : null;
  if (value.owner_outcome !== expectedOutcome) context.addIssue({ code: "custom", path: ["owner_outcome"], message: "revision state and owner outcome must agree" });
  const complete = ["accepted", "edited", "rejected", "failed"].includes(value.state);
  if (complete !== (value.completed_at !== null)) context.addIssue({ code: "custom", path: ["completed_at"], message: "terminal revision state and completion time must agree" });
});

const ComparisonStatementSchema = z.object({
  statement_id: OpaqueIdSchema,
  index: z.number().int().nonnegative(),
  section_id: NonEmptyStringSchema,
  kind: z.enum(["factual", "presentation"]),
  display_role: z.enum(["heading", "bullet", "line"]).nullable(),
  text: z.string().min(1).max(8_192),
  supporting_confirmed_fact_revision_ids: z.array(OpaqueIdSchema).max(500),
  statement_digest: Sha256DigestSchema,
}).strict();

const StatementChangeSchema = z.object({
  statement_id: OpaqueIdSchema,
  before_index: z.number().int().nonnegative().nullable(),
  after_index: z.number().int().nonnegative().nullable(),
  before_digest: Sha256DigestSchema.nullable(),
  after_digest: Sha256DigestSchema.nullable(),
  before: ComparisonStatementSchema.nullable(),
  after: ComparisonStatementSchema.nullable(),
}).strict();

export const DefinitionComparisonResultSchema = z.object({
  comparison_version: z.literal(2),
  left_revision_id: OpaqueIdSchema,
  right_revision_id: OpaqueIdSchema,
  left_digest: Sha256DigestSchema,
  right_digest: Sha256DigestSchema,
  result: z.enum(["available", "unavailable"]),
  compatibility: z.enum(["compatible", "incompatible"]),
  relation: z.enum(["identical", "related", "unrelated"]),
  unavailable_reason: z.enum(["unrelated", "incompatible"]).nullable(),
  added: z.array(StatementChangeSchema).max(500),
  removed: z.array(StatementChangeSchema).max(500),
  changed: z.array(StatementChangeSchema).max(500),
  moved: z.array(StatementChangeSchema).max(500),
  evidence_changed: z.array(StatementChangeSchema).max(500),
  unchanged: z.array(StatementChangeSchema).max(500),
  unchanged_count: z.number().int().nonnegative().max(500),
  evidence_changes: z.object({ added_revision_ids: z.array(OpaqueIdSchema).max(500), removed_revision_ids: z.array(OpaqueIdSchema).max(500) }).strict(),
  observable_summary: z.array(z.string().min(1).max(512)).max(100),
}).strict();

export const ImpactAnalysisResultSchema = z.object({
  impact_version: z.literal(1),
  source_definition_revision_id: OpaqueIdSchema,
  changed_fact_revision_ids: z.array(OpaqueIdSchema).max(500),
  affected_statements: z.array(z.object({ statement_id: OpaqueIdSchema, change: z.enum(["added", "removed", "corrected", "reworded"]) }).strict()).max(500),
  stale_tailored_variants: z.array(z.object({ variant_revision_id: OpaqueIdSchema, status: z.literal("based_on_older_evidence"), rebuild: z.literal("explicit_owner_action") }).strict()).max(500),
}).strict();

export const RememberedMatchResultSchema = z.object({
  match_version: z.literal(1),
  method: z.enum(["explicit_revision", "exact_label", "none"]),
  result_class: z.enum(["matched", "ambiguous", "none"]),
  matches: z.array(z.object({ fact_revision_id: OpaqueIdSchema, safe_label: z.string().min(1).max(256) }).strict()).max(100),
}).strict();

export const GuidanceCategorySchema = z.enum(["strong_evidence", "missing_detail", "unresolved_conflict", "unsupported_requirement", "intentional_omission"]);
export const GuidanceResultSchema = z.object({
  guidance_version: z.literal(1),
  items: z.array(z.object({ category: GuidanceCategorySchema, evidence_revision_ids: z.array(OpaqueIdSchema).max(32), evidence_labels: z.array(z.string().min(1).max(256)).min(1).max(8), message: z.string().min(1).max(1_024) }).strict()).max(50),
  optional_questions: z.array(z.object({ question_id: OpaqueIdSchema, prompt: z.string().min(1).max(1_024), evidence_revision_ids: z.array(OpaqueIdSchema).max(32) }).strict()).max(3),
}).strict();

export const ResumeDataRecordSchema = z.discriminatedUnion("record_type", [
  SourceRecordSchema,
  CareerFactRecordSchema,
  ResumeDefinitionRecordSchema,
  JobDescriptionRecordSchema,
  TailoredVariantRecordSchema,
  ArtifactRecordSchema,
  ExportReceiptRecordSchema,
  MigrationRecordSchema,
  InterviewProgressRecordSchema,
  ResumeRevisionRequestRecordSchema,
  JobEvidenceCoverageRecordSchema,
  ResumeStrategyRecordSchema,
  TargetFitAnalysisRecordSchema,
  CraftQualityReportRecordSchema,
  CraftRepairOperationRecordSchema,
  ArtifactParityReportRecordSchema,
]);

const LINEAGE_RECORD_TYPES = [
  "source",
  "career_fact",
  "resume_definition",
  "job_description",
  "tailored_variant",
  "artifact",
  "export_receipt",
  "migration",
  "interview_progress",
  "resume_revision_request",
  "job_evidence_coverage",
  "resume_strategy",
  "target_fit_analysis",
  "craft_quality_report",
  "craft_repair_operation",
  "artifact_parity_report",
] as const;

export const LineageGraphSchema = z
  .object({
    graph_version: z.literal(1),
    nodes: z.array(
      z
        .object({
          revision_id: OpaqueIdSchema,
          record_type: z.enum(LINEAGE_RECORD_TYPES),
          fact_state: FactStateSchema.nullable(),
          sensitivity: SensitivitySchema,
        })
        .strict(),
    ),
    edges: z.array(
      z
        .object({
          from_revision_id: OpaqueIdSchema,
          to_revision_id: OpaqueIdSchema,
          relation: z.enum(["derived_from", "supported_by", "parent", "job_snapshot", "rendered_from", "exported_from", "revision_source", "resulted_in"]),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, context) => {
    const nodeIds = value.nodes.map((node) => node.revision_id);
    if (new Set(nodeIds).size !== nodeIds.length) {
      context.addIssue({ code: "custom", message: "duplicate_identity" });
      return;
    }
    const nodes = new Map(value.nodes.map((node) => [node.revision_id, node]));
    const sensitivityRank = { standard: 0, sensitive: 1, highly_sensitive: 2 } as const;
    for (const edge of value.edges) {
      const from = nodes.get(edge.from_revision_id);
      const to = nodes.get(edge.to_revision_id);
      if (!from || !to) {
        context.addIssue({ code: "custom", message: "lineage reference does not resolve" });
        continue;
      }
      if (edge.relation === "supported_by" && (to.record_type !== "career_fact" || to.fact_state !== "confirmed")) {
        context.addIssue({ code: "custom", message: "resume support must resolve to a confirmed fact revision" });
      }
      if (edge.relation === "derived_from" && sensitivityRank[from.sensitivity] < sensitivityRank[to.sensitivity]) {
        context.addIssue({ code: "custom", message: "derivative sensitivity cannot be lower than its source" });
      }
    }

    const parentEdges = value.edges.filter((edge) => edge.relation === "parent");
    const parents = new Map(parentEdges.map((edge) => [edge.from_revision_id, edge.to_revision_id]));
    for (const start of parents.keys()) {
      const seen = new Set<string>();
      let current: string | undefined = start;
      while (current) {
        if (seen.has(current)) {
          context.addIssue({ code: "custom", message: "parent lineage cannot contain a cycle" });
          break;
        }
        seen.add(current);
        current = parents.get(current);
      }
    }
  });

export const RETENTION_MATRIX = {
  source: "durable_provenance_while_referenced",
  career_fact: "durable_owner_data",
  resume_definition: "durable_owner_data",
  job_description: "durable_provenance_while_referenced",
  tailored_variant: "durable_owner_data",
  artifact: "durable_owner_data",
  export_receipt: "durable_owner_data",
  migration: "rollback_recovery_window",
  interview_progress: "durable_owner_data",
  resume_revision_request: "durable_owner_data",
  job_evidence_coverage: "durable_owner_data",
  resume_strategy: "durable_owner_data",
  target_fit_analysis: "durable_owner_data",
  craft_quality_report: "durable_owner_data",
  craft_repair_operation: "durable_owner_data",
  artifact_parity_report: "durable_owner_data",
  package_runtime: "runtime_authority",
  preview_bytes: "disposable_preview_cache",
  abandoned_operation: "transient_abandoned_operation",
  owner_export: "external_owner_file",
} as const satisfies Record<string, z.infer<typeof RetentionClassSchema>>;
