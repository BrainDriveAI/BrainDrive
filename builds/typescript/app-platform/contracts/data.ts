import { z } from "zod";

import {
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
    schema_version: z.literal(RESUME_DATA_SCHEMA_VERSION),
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
  format: z.enum(["pdf", "docx", "html"]),
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
  format: z.enum(["pdf", "docx", "html"]),
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

export const InterviewProgressRecordSchema = RecordEnvelopeSchema.extend({
  record_type: z.literal("interview_progress"),
  status: z.enum(["not_started", "in_progress", "paused", "review_needed", "completed"]),
  current_topic: z.string().max(128).nullable(),
  completed_topics: z.array(z.string().min(1).max(128)).max(100),
  skipped_topics: z.array(z.string().min(1).max(128)).max(100),
  draft_state: z.enum(["declared_draft", "owner_reviewed", "complete"]),
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
          relation: z.enum(["derived_from", "supported_by", "parent", "job_snapshot", "rendered_from", "exported_from"]),
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
  package_runtime: "runtime_authority",
  preview_bytes: "disposable_preview_cache",
  abandoned_operation: "transient_abandoned_operation",
  owner_export: "external_owner_file",
} as const satisfies Record<string, z.infer<typeof RetentionClassSchema>>;
