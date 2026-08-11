import { z } from "zod";

import {
  canonicalInputDigest,
  OpaqueIdSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from "./common.js";
import {
  FactStateSchema,
  OwnerConfirmationProofSchema,
  RETENTION_MATRIX,
  RecordLifecycleStateSchema,
  RetentionClassSchema,
  SensitivitySchema,
} from "./data.js";
import { ContractErrorSchema, ContractViolation } from "./errors.js";
import { CommitOutcomeSchema, OperationStatusSchema } from "./lifecycle.js";

export const ResumeDataCapabilityNameSchema = z.enum([
  "career.context.read",
  "career.facts.read",
  "career.facts.propose",
  "career.facts.confirm",
  "resume.definitions.read",
  "resume.definitions.write",
  "resume.jobs.read",
  "resume.jobs.write",
  "resume.artifacts.register",
  "resume.export.request",
  "resume.operations.read",
]);

const FactKindSchema = z.enum([
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
]);

export const ResumeDataCapabilityContextSchema = z
  .object({
    context_version: z.literal(1),
    owner_id: OpaqueIdSchema,
    actor_id: OpaqueIdSchema,
    app_id: z.literal("ai.braindrive.resume-builder"),
    publisher_id: z.literal("ai.braindrive"),
    package_digest: Sha256DigestSchema,
    installation_id: OpaqueIdSchema,
    grant_id: OpaqueIdSchema,
    audience: z.literal("resume_data"),
    granted_capabilities: z.array(ResumeDataCapabilityNameSchema).min(1),
    record_scope_ids: z.array(OpaqueIdSchema),
    issued_at: TimestampSchema,
    expires_at: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.granted_capabilities).size !== value.granted_capabilities.length) {
      context.addIssue({ code: "custom", message: "duplicate capability grant" });
    }
    if (new Set(value.record_scope_ids).size !== value.record_scope_ids.length) {
      context.addIssue({ code: "custom", message: "duplicate record scope" });
    }
    if (Date.parse(value.expires_at) <= Date.parse(value.issued_at)) {
      context.addIssue({ code: "custom", message: "capability context expiry must follow issuance" });
    }
  });

const ContextReadPayloadSchema = z.object({ kind: z.literal("context_read"), entry_point: z.enum(["direct", "career"]) }).strict();
const RecordReadPayloadSchema = z.object({ kind: z.literal("record_read"), record_id: OpaqueIdSchema.nullable() }).strict();
const FactProposalPayloadSchema = z
  .object({
    kind: z.literal("fact_proposal"),
    fact_kind: FactKindSchema,
    value: z.string().min(1).max(16_384),
    state: z.enum(["imported", "suggested"]),
    source_revision_ids: z.array(OpaqueIdSchema).min(1),
    sensitivity: SensitivitySchema,
  })
  .strict();
const FactConfirmationPayloadSchema = z
  .object({
    kind: z.literal("fact_confirmation"),
    fact_record_id: OpaqueIdSchema,
    fact_revision_id: OpaqueIdSchema,
    expected_revision: z.number().int().positive(),
    decision: z.enum(["accept", "edit_and_accept", "reject"]),
    edited_value: z.string().min(1).max(16_384).nullable(),
    owner_confirmation: OwnerConfirmationProofSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.decision === "edit_and_accept") !== (value.edited_value !== null)) {
      context.addIssue({ code: "custom", message: "edited confirmation requires exactly one edited value" });
    }
    if (value.owner_confirmation.decision !== value.decision) {
      context.addIssue({ code: "custom", message: "confirmation proof decision mismatch" });
    }
    if (value.owner_confirmation.input_revision_id !== value.fact_revision_id) {
      context.addIssue({ code: "custom", message: "confirmation proof revision mismatch" });
    }
  });
const DefinitionWritePayloadSchema = z.object({ kind: z.literal("definition_write"), candidate_digest: Sha256DigestSchema }).strict();
const WorkspaceReadPayloadSchema = z.object({ kind: z.literal("workspace_read") }).strict();
const RememberedMatchPayloadSchema = z.object({ kind: z.literal("remembered_match"), explicit_job_fact_revision_id: OpaqueIdSchema.nullable(), description: z.string().max(512) }).strict();
const CompareDefinitionsPayloadSchema = z.object({ kind: z.literal("compare_definitions"), left_revision_id: OpaqueIdSchema, right_revision_id: OpaqueIdSchema }).strict();
const ImpactAnalysisPayloadSchema = z.object({ kind: z.literal("impact_analysis"), source_definition_revision_id: OpaqueIdSchema, changed_fact_revision_ids: z.array(OpaqueIdSchema).max(500) }).strict();
const InterviewProgressWritePayloadSchema = z.object({ kind: z.literal("interview_progress_write"), candidate_digest: Sha256DigestSchema }).strict();
const InterviewTurnWritePayloadSchema = z.object({ kind: z.literal("interview_turn_write"), candidate_digest: Sha256DigestSchema }).strict();
const RevisionRequestWritePayloadSchema = z.object({ kind: z.literal("revision_request_write"), candidate_digest: Sha256DigestSchema }).strict();
const RevisionOutcomeWritePayloadSchema = z.object({ kind: z.literal("revision_outcome_write"), request_revision_id: OpaqueIdSchema, candidate_digest: Sha256DigestSchema }).strict();
const RevisionProposalWritePayloadSchema = z.object({ kind: z.literal("revision_proposal_write"), request_revision_id: OpaqueIdSchema, candidate_digest: Sha256DigestSchema }).strict();
const JobWritePayloadSchema = z.object({ kind: z.literal("job_write"), candidate_digest: Sha256DigestSchema }).strict();
const ArtifactRegisterPayloadSchema = z.object({ kind: z.literal("artifact_register"), artifact_digest: Sha256DigestSchema }).strict();
const ExportRequestPayloadSchema = z.object({ kind: z.literal("export_request"), artifact_revision_id: OpaqueIdSchema }).strict();
const OperationReadPayloadSchema = z.object({ kind: z.literal("operation_read"), queried_operation_id: OpaqueIdSchema }).strict();

export const ResumeDataCapabilityPayloadSchema = z.discriminatedUnion("kind", [
  ContextReadPayloadSchema,
  RecordReadPayloadSchema,
  FactProposalPayloadSchema,
  FactConfirmationPayloadSchema,
  DefinitionWritePayloadSchema,
  WorkspaceReadPayloadSchema,
  RememberedMatchPayloadSchema,
  CompareDefinitionsPayloadSchema,
  ImpactAnalysisPayloadSchema,
  InterviewProgressWritePayloadSchema,
  InterviewTurnWritePayloadSchema,
  RevisionRequestWritePayloadSchema,
  RevisionOutcomeWritePayloadSchema,
  RevisionProposalWritePayloadSchema,
  JobWritePayloadSchema,
  ArtifactRegisterPayloadSchema,
  ExportRequestPayloadSchema,
  OperationReadPayloadSchema,
]);

const CAPABILITY_PAYLOAD_KINDS: Readonly<Record<z.infer<typeof ResumeDataCapabilityNameSchema>, readonly z.infer<typeof ResumeDataCapabilityPayloadSchema>["kind"][]>> = {
  "career.context.read": ["context_read"],
  "career.facts.read": ["record_read"],
  "career.facts.propose": ["fact_proposal"],
  "career.facts.confirm": ["fact_confirmation"],
  "resume.definitions.read": ["record_read", "workspace_read", "remembered_match", "compare_definitions", "impact_analysis"],
  "resume.definitions.write": ["definition_write", "interview_progress_write", "interview_turn_write", "revision_request_write", "revision_outcome_write", "revision_proposal_write"],
  "resume.jobs.read": ["record_read"],
  "resume.jobs.write": ["job_write"],
  "resume.artifacts.register": ["artifact_register"],
  "resume.export.request": ["export_request"],
  "resume.operations.read": ["operation_read"],
};

export const ResumeDataCapabilityRequestSchema = z
  .object({
    request_version: z.literal(1),
    request_id: OpaqueIdSchema,
    correlation_id: OpaqueIdSchema,
    operation_id: OpaqueIdSchema,
    idempotency_key: z.string().min(16).max(256),
    canonical_input_digest: Sha256DigestSchema,
    capability: ResumeDataCapabilityNameSchema,
    context: ResumeDataCapabilityContextSchema,
    payload: ResumeDataCapabilityPayloadSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.context.granted_capabilities.includes(value.capability)) {
      context.addIssue({ code: "custom", message: "requested capability is outside the grant" });
    }
    if (!CAPABILITY_PAYLOAD_KINDS[value.capability].includes(value.payload.kind)) {
      context.addIssue({ code: "custom", message: "capability payload kind mismatch" });
    }
    if (value.canonical_input_digest !== canonicalInputDigest({ capability: value.capability, payload: value.payload })) {
      context.addIssue({ code: "custom", message: "canonical capability input digest mismatch" });
    }
    if (value.payload.kind === "fact_confirmation") {
      if (value.payload.owner_confirmation.operation_id !== value.operation_id) {
        context.addIssue({ code: "custom", message: "confirmation proof operation mismatch" });
      }
      if (
        value.payload.owner_confirmation.owner_id !== value.context.owner_id ||
        value.payload.owner_confirmation.actor_id !== value.context.actor_id
      ) {
        context.addIssue({ code: "custom", message: "confirmation proof authority mismatch" });
      }
    }
  });

export const OwnerSafeResumeDataStateSchema = z
  .object({
    state_version: z.literal(1),
    state: z.enum(["ready", "review_needed", "conflict", "cancelled", "incompatible", "recoverable_failure"]),
    safe_message: z.string().min(1).max(512),
    retryable: z.boolean(),
    refresh_required: z.boolean(),
    current_revision: z.number().int().positive().nullable(),
    proposal_preserved: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.state === "conflict") !== value.refresh_required) {
      context.addIssue({ code: "custom", message: "only conflict state requires refresh" });
    }
    if (value.state === "conflict" && (!value.proposal_preserved || value.current_revision === null)) {
      context.addIssue({ code: "custom", message: "conflict must preserve the proposal and expose a current logical revision" });
    }
  });

export const ResumeDataCapabilityResultSchema = z
  .object({
    result_version: z.literal(1),
    request_id: OpaqueIdSchema,
    operation_id: OpaqueIdSchema,
    capability: ResumeDataCapabilityNameSchema,
    status: z.enum(["completed", "cancelled", "failed"]),
    commit_outcome: CommitOutcomeSchema,
    record_ids: z.array(OpaqueIdSchema),
    revision_ids: z.array(OpaqueIdSchema),
    owner_state: OwnerSafeResumeDataStateSchema,
    error: ContractErrorSchema.nullable(),
    completed_at: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.status === "failed") !== (value.error !== null)) {
      context.addIssue({ code: "custom", message: "failed capability result requires exactly one typed error" });
    }
    if (value.status === "cancelled" && value.commit_outcome !== "not_committed") {
      context.addIssue({ code: "custom", message: "cancelled result cannot conceal a committed outcome" });
    }
  });

export const MigrationCompatibilityPolicySchema = z
  .object({
    policy_version: z.literal(1),
    active_schema_version: z.literal(2),
    readable_schema_versions: z.tuple([z.literal(1), z.literal(2)]),
    writable_schema_versions: z.tuple([z.literal(2)]),
    prior_release_policy: z.literal("read_immediately_prior_when_released"),
    writes_require_active_version: z.literal(true),
    unsafe_downgrade: z.literal("block_preserve_data_offer_export_or_upgrade"),
    migration_method: z.literal("deterministic_transactional_no_ai"),
  })
  .strict();

export const MigrationProvenanceSchema = z
  .object({
    provenance_version: z.literal(1),
    migration_id: OpaqueIdSchema,
    transformer_id: z.string().min(1).max(128),
    transformer_version: z.string().min(1).max(64),
    transformer_digest: Sha256DigestSchema,
    from_schema_version: z.number().int().nonnegative(),
    to_schema_version: z.number().int().positive(),
    source_catalog_digest: Sha256DigestSchema,
    result_catalog_digest: Sha256DigestSchema,
    recovery_snapshot_id: OpaqueIdSchema,
    method: z.literal("deterministic_no_ai"),
    validated_at: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.to_schema_version <= value.from_schema_version) {
      context.addIssue({ code: "custom", message: "migration provenance must describe a forward migration" });
    }
  });

export const MIGRATION_COMPATIBILITY_POLICY = {
  policy_version: 1,
  active_schema_version: 2,
  readable_schema_versions: [1, 2],
  writable_schema_versions: [2],
  prior_release_policy: "read_immediately_prior_when_released",
  writes_require_active_version: true,
  unsafe_downgrade: "block_preserve_data_offer_export_or_upgrade",
  migration_method: "deterministic_transactional_no_ai",
} as const;

export const RetentionMatrixSchema = z
  .object({
    matrix_version: z.literal(1),
    records: z.record(z.string(), RetentionClassSchema),
    default_uninstall: z.literal("retain_durable_owner_data_remove_runtime_authority"),
    referenced_records_deletable: z.literal(false),
    external_owner_files_managed: z.literal(false),
  })
  .strict();

export const RESUME_DATA_RETENTION_MATRIX = {
  matrix_version: 1,
  records: RETENTION_MATRIX,
  default_uninstall: "retain_durable_owner_data_remove_runtime_authority",
  referenced_records_deletable: false,
  external_owner_files_managed: false,
} as const;

const FACT_TRANSITIONS: Readonly<Record<z.infer<typeof FactStateSchema>, readonly z.infer<typeof FactStateSchema>[]>> = {
  imported: ["confirmed", "rejected"],
  suggested: ["confirmed", "rejected"],
  confirmed: ["confirmed"],
  rejected: [],
};

const RECORD_LIFECYCLE_TRANSITIONS: Readonly<Record<z.infer<typeof RecordLifecycleStateSchema>, readonly z.infer<typeof RecordLifecycleStateSchema>[]>> = {
  active: ["superseded", "retired"],
  superseded: ["retired"],
  retired: [],
};

const OPERATION_TRANSITIONS: Readonly<Record<z.infer<typeof OperationStatusSchema>, readonly z.infer<typeof OperationStatusSchema>[]>> = {
  accepted: ["running", "cancelled_before_commit", "failed"],
  running: ["cancel_requested", "committed", "cancelled_before_commit", "failed"],
  cancel_requested: ["committed", "cancelled_before_commit", "failed"],
  committed: [],
  cancelled_before_commit: [],
  failed: [],
};

export function assertFactStateTransition(
  from: z.infer<typeof FactStateSchema>,
  to: z.infer<typeof FactStateSchema>,
  options: { hostOwnerConfirmed: boolean; createsSuccessor: boolean },
): void {
  if (!FACT_TRANSITIONS[from].includes(to)) {
    throw new ContractViolation("invalid_state_transition", `Fact transition ${from} -> ${to} is not allowed`);
  }
  if (!options.hostOwnerConfirmed) {
    throw new ContractViolation("denied", "Fact decisions require host-mediated owner confirmation");
  }
  if (!options.createsSuccessor) {
    throw new ContractViolation("invalid_state_transition", "Fact decisions must create an immutable successor revision");
  }
}

export function assertRecordLifecycleTransition(
  from: z.infer<typeof RecordLifecycleStateSchema>,
  to: z.infer<typeof RecordLifecycleStateSchema>,
): void {
  if (!RECORD_LIFECYCLE_TRANSITIONS[from].includes(to)) {
    throw new ContractViolation("invalid_state_transition", `Record lifecycle transition ${from} -> ${to} is not allowed`);
  }
}

export function assertOperationTransition(
  from: z.infer<typeof OperationStatusSchema>,
  to: z.infer<typeof OperationStatusSchema>,
): void {
  if (!OPERATION_TRANSITIONS[from].includes(to)) {
    throw new ContractViolation("invalid_state_transition", `Operation transition ${from} -> ${to} is not allowed`);
  }
}

export function assertExpectedRevision(expected: number, current: number): void {
  if (expected !== current) {
    throw new ContractViolation("conflict", "Expected logical revision is stale");
  }
}

export function deriveSensitivity(
  supporting: readonly z.infer<typeof SensitivitySchema>[],
): z.infer<typeof SensitivitySchema> {
  if (supporting.length === 0) throw new ContractViolation("invalid_input", "Sensitivity derivation requires supporting records");
  const rank = { standard: 0, sensitive: 1, highly_sensitive: 2 } as const;
  return supporting.reduce((current, candidate) => rank[candidate] > rank[current] ? candidate : current);
}

export function nonEnumeratingOwnerError(
  code: "denied" | "not_found_within_scope",
  correlationId: string,
  occurredAt: string,
): z.infer<typeof ContractErrorSchema> {
  return ContractErrorSchema.parse({
    error_version: 1,
    code: "denied",
    safe_message: "The requested data is not available to this app.",
    retryable: false,
    correlation_id: correlationId,
    occurred_at: occurredAt,
    details: { category: "access_unavailable" },
  });
}
