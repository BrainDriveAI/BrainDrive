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
    schema_version: z.union([z.literal(1), z.literal(RESUME_DATA_SCHEMA_VERSION)]),
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
    if (value.schema_version !== 2) context.addIssue({ code: "custom", path: ["schema_version"], message: "job evidence requires schema version 2" });
    try {
      JobEvidenceValueSchema.parse(JSON.parse(value.value));
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
}).strict();

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
  if (value.schema_version === 2 && value.successor_context === undefined) {
    context.addIssue({ code: "custom", message: "schema-2 definitions require explicit successor context" });
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
}).strict();

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
  if (value.schema_version === 2 && [
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
  schema_version: z.literal(2),
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
  package_runtime: "runtime_authority",
  preview_bytes: "disposable_preview_cache",
  abandoned_operation: "transient_abandoned_operation",
  owner_export: "external_owner_file",
} as const satisfies Record<string, z.infer<typeof RetentionClassSchema>>;
