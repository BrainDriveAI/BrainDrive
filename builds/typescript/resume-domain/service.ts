import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  ArtifactRecordSchema,
  CareerFactRecordSchema,
  ExportReceiptRecordSchema,
  InterviewProgressRecordSchema,
  InterviewTurnAuditSchema,
  ImpactAnalysisResultSchema,
  JobDescriptionRecordSchema,
  RequirementEvidenceSchema,
  RememberedMatchResultSchema,
  ResumeDataRecordSchema,
  ResumeDefinitionRecordSchema,
  ResumeRevisionRequestRecordSchema,
  ResumeStatementSchema,
  SourceRecordSchema,
  TailoredVariantRecordSchema,
  type SensitivitySchema,
} from "../app-platform/contracts/data.js";
import { canonicalInputDigest, NonEmptyStringSchema, OpaqueIdSchema, Sha256DigestSchema, TimestampSchema } from "../app-platform/contracts/common.js";
import type { CapabilityGrant } from "../app-platform/lifecycle/store.js";
import type { InferenceDataBlockSchema } from "../app-platform/contracts/inference.js";
import { RESUME_DATA_SCHEMA_VERSION } from "../app-platform/contracts/constants.js";
import { ResumeDomainError } from "./errors.js";
import {
  changedFactLineage,
  definitionStatementsChanged,
  deriveResumeImpact,
  staleTailoredVariantIds,
  unchangedStatementIdentityIssues,
} from "./impact-analysis.js";
import { ResumeDataStore, type MutationContext, type ResumeDataRecord } from "./store.js";
import {
  CareerFactRepository,
  CareerSourceRepository,
  FactDecisionInputSchema,
  type FactDecisionInput,
  type HostOwnerDecisionEvidence,
  proposalClassificationFromFact,
  requireHostOwnerDecisionEvidence,
} from "./career-data.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "../resume-inference/policy.js";
import { validateInferenceClaims } from "../resume-inference/validators.js";
import { assertBoundQualityReport, evaluateResumeQuality } from "../resume-inference/quality-runtime.js";
import {
  ResumeArtifactRepository,
  ResumeDefinitionRepository,
  ResumeExportRepository,
  ResumeJobRepository,
  ResumeReferenceRepository,
  TailoredVariantRepository,
} from "./lineage-repositories.js";
import type { ResumeLineageGraph } from "./resume-lineage.js";
import { compareDefinitionRevisions } from "./definition-comparison.js";
import { ResumeRevisionDraftResultSchema } from "../resume-inference/results.js";
import {
  assertRevisionTarget,
  assertRevisionTransition,
  revisionDraftIssues,
} from "./revision-requests.js";

type Sensitivity = z.infer<typeof SensitivitySchema>;

export type DataAuthority = {
  grant: CapabilityGrant;
  capability: CapabilityGrant["capabilities"][number];
  operationId: string;
  idempotencyKey: string;
  isCancelled?: () => boolean;
};

const ProposalInputSchema = z.object({
  source: z.object({
    source_kind: z.enum(["owner_interview", "accepted_import", "career_handoff", "owner_edit"]),
    safe_label: z.string().min(1).max(256),
    content_digest: Sha256DigestSchema,
    captured_at: TimestampSchema,
    interview_turn: InterviewTurnAuditSchema.optional(),
  }).strict(),
  fact: z.object({
    fact_kind: z.enum(["identity", "contact", "employment", "education", "skill", "credential", "accomplishment", "project", "preference", "job_evidence"]),
    state: z.enum(["imported", "suggested"]),
    value: z.string().min(1).max(16_384),
    sensitivity: z.enum(["standard", "sensitive", "highly_sensitive"]),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.source.interview_turn && value.source.source_kind !== "owner_interview") {
    context.addIssue({ code: "custom", path: ["source", "interview_turn"], message: "Interview turns require owner-interview provenance" });
  }
});

const LinkedProposalInputSchema = z.object({
  source_revision_ids: z.array(OpaqueIdSchema).min(1).max(25),
  fact: ProposalInputSchema.shape.fact,
}).strict();

const GroupConfirmationInputSchema = z.object({
  decisions: z.array(FactDecisionInputSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (new Set(value.decisions.map((decision) => decision.fact_record_id)).size !== value.decisions.length) {
    context.addIssue({ code: "custom", message: "grouped review requires one decision per fact" });
  }
});

const DefinitionInputSchema = z.object({
  definition_kind: z.enum(["general", "targeted"]),
  status: z.enum(["draft", "proposed", "approved"]),
  title: z.string().min(1).max(256),
  statements: z.array(ResumeStatementSchema).min(1).max(500),
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
  variant: z.object({ evidence_matrix: z.array(RequirementEvidenceSchema).min(1), changed_statement_ids: z.array(OpaqueIdSchema) }).strict().nullable().default(null),
  successor_context: ResumeDefinitionRecordSchema.shape.successor_context.default(null),
}).strict();

const JobInputSchema = z.object({ job_id: OpaqueIdSchema.optional(), safe_label: z.string().min(1).max(256), description_text: z.string().min(1).max(131_072), content_digest: Sha256DigestSchema, captured_at: TimestampSchema, sensitivity: z.enum(["standard", "sensitive", "highly_sensitive"]).default("sensitive") }).strict();

const SafeDestinationLabelSchema = z.string().min(1).max(256).regex(/^[^/\\:\u0000-\u001f]+$/).refine((value) => value !== "." && value !== "..", "destination label cannot be a path segment");
const ExportReceiptInputSchema = z.object({ artifact_revision_id: OpaqueIdSchema, artifact_digest: Sha256DigestSchema, format: z.enum(["pdf", "text", "docx", "html"]), outcome: z.enum(["completed", "cancelled", "failed"]), exported_at: TimestampSchema, safe_destination_label: SafeDestinationLabelSchema }).strict();

const ArtifactInputSchema = z.object({
  definition_revision_id: OpaqueIdSchema,
  template_id: NonEmptyStringSchema,
  template_version: NonEmptyStringSchema,
  renderer_id: NonEmptyStringSchema,
  renderer_version: NonEmptyStringSchema,
  font_manifest_digest: Sha256DigestSchema,
  validation_run_id: OpaqueIdSchema,
  findings: ArtifactRecordSchema.shape.findings,
  artifact_digest: Sha256DigestSchema,
  format: z.enum(["pdf", "text", "docx", "html"]),
  accepted: z.boolean(),
}).strict();

const InterviewInputSchema = z.object({
  record_id: OpaqueIdSchema.optional(),
  expected_revision: z.number().int().positive().nullable().default(null),
  status: z.enum(["not_started", "in_progress", "paused", "review_needed", "completed"]),
  current_topic: z.string().max(128).nullable(),
  completed_topics: z.array(z.string().min(1).max(128)).max(100),
  skipped_topics: z.array(z.string().min(1).max(128)).max(100),
  draft_state: z.enum(["declared_draft", "owner_reviewed", "complete"]),
  session_id: OpaqueIdSchema.optional(),
  audit_turn: InterviewTurnAuditSchema.optional(),
  active_job_fact_revision_id: OpaqueIdSchema.nullable().default(null),
  current_question_id: z.string().min(1).max(128).nullable().default(null),
  current_field_id: z.string().min(1).max(128).nullable().default(null),
  job_dimension: z.enum(["identity", "responsibilities", "tools", "accomplishments", "outcomes", "scope", "progression"]).nullable().default(null),
  recovery_draft: InterviewProgressRecordSchema.shape.recovery_draft.default(null),
  last_submitted_turn_revision_id: OpaqueIdSchema.nullable().default(null),
  selection_method: z.enum(["deterministic_gap", "broker_ranked"]).optional(),
}).strict();

const InterviewTurnInputSchema = z.object({
  kind: z.literal("interview_turn").optional(),
  turn: InterviewTurnAuditSchema,
  sensitivity: z.enum(["standard", "sensitive", "highly_sensitive"]),
  linked_confirmed_fact_revision_id: OpaqueIdSchema.nullable(),
}).strict();

const RecoverySlotSchema = z.object({
  session_id: OpaqueIdSchema,
  job_fact_revision_id: OpaqueIdSchema.nullable(),
  question_id: z.string().min(1).max(128),
  field_id: z.string().min(1).max(128),
}).strict();

const InterviewRecoverySaveInputSchema = z.object({
  record_id: OpaqueIdSchema.optional(),
  expected_revision: z.number().int().positive().nullable(),
  session_id: OpaqueIdSchema,
  current_topic: z.string().min(1).max(128),
  completed_topics: z.array(z.string().min(1).max(128)).max(100),
  skipped_topics: z.array(z.string().min(1).max(128)).max(100),
  job_dimension: z.enum(["identity", "responsibilities", "tools", "accomplishments", "outcomes", "scope", "progression"]).nullable().default(null),
  slot: RecoverySlotSchema,
  value: z.string().max(16_384),
  value_digest: Sha256DigestSchema,
}).strict();

const InterviewRecoveryDiscardInputSchema = z.object({
  record_id: OpaqueIdSchema,
  expected_revision: z.number().int().positive(),
}).strict();

const InterviewProgressSubmitInputSchema = z.object({
  record_id: OpaqueIdSchema,
  expected_revision: z.number().int().positive(),
  status: z.enum(["in_progress", "paused", "review_needed", "completed"]),
  current_topic: z.string().max(128).nullable(),
  completed_topics: z.array(z.string().min(1).max(128)).max(100),
  skipped_topics: z.array(z.string().min(1).max(128)).max(100),
  draft_state: z.enum(["declared_draft", "owner_reviewed", "complete"]),
  session_id: OpaqueIdSchema,
  active_job_fact_revision_id: OpaqueIdSchema.nullable().optional(),
  current_question_id: z.string().min(1).max(128).nullable().optional(),
  current_field_id: z.string().min(1).max(128).nullable().optional(),
  job_dimension: z.enum(["identity", "responsibilities", "tools", "accomplishments", "outcomes", "scope", "progression"]).nullable().optional(),
  selection_method: z.enum(["deterministic_gap", "broker_ranked"]).optional(),
  submission: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("new_turn"),
      turn: InterviewTurnAuditSchema,
      sensitivity: z.enum(["standard", "sensitive", "highly_sensitive"]),
      linked_confirmed_fact_revision_id: OpaqueIdSchema.nullable(),
    }).strict(),
    z.object({
      kind: z.literal("existing_turn"),
      source_revision_id: OpaqueIdSchema,
      linked_confirmed_fact_revision_id: OpaqueIdSchema,
    }).strict(),
  ]),
}).strict();

const DefinitionApprovalInputSchema = z.object({
  kind: z.literal("approve_definition"),
  definition_record_id: OpaqueIdSchema,
  expected_revision: z.number().int().positive(),
}).strict();

const DefinitionComparisonInputSchema = z.object({
  left_revision_id: OpaqueIdSchema,
  right_revision_id: OpaqueIdSchema,
  left_expected_revision: z.number().int().positive().optional(),
  right_expected_revision: z.number().int().positive().optional(),
}).strict();

const ImpactAnalysisInputSchema = z.object({
  source_definition_revision_id: OpaqueIdSchema,
  changed_fact_revision_ids: z.array(OpaqueIdSchema).max(500),
}).strict();

const RevisionRequestInputSchema = z.object({
  kind: z.literal("revision_request"),
  source_definition_revision_id: OpaqueIdSchema,
  target: ResumeRevisionRequestRecordSchema.shape.target,
  request_text: z.string().min(1).max(8_192),
}).strict();

const RevisionOutcomeInputSchema = z.object({
  kind: z.literal("revision_outcome"),
  request_record_id: OpaqueIdSchema,
  expected_revision: z.number().int().positive(),
  classification: ResumeRevisionRequestRecordSchema.shape.classification,
  state: ResumeRevisionRequestRecordSchema.shape.state,
  clarification: z.string().max(2_048).nullable(),
  resulting_definition_revision_id: OpaqueIdSchema.nullable(),
  owner_outcome: ResumeRevisionRequestRecordSchema.shape.owner_outcome,
}).strict();

const RevisionProposalInputSchema = z.object({
  kind: z.literal("revision_proposal"),
  request_record_id: OpaqueIdSchema,
  expected_revision: z.number().int().positive(),
  draft: ResumeRevisionDraftResultSchema,
  owner_outcome: z.literal("edit").nullable().default(null),
}).strict();

const DefinitionRollbackInputSchema = z.object({
  current_definition_record_id: OpaqueIdSchema,
  current_expected_revision: z.number().int().positive(),
  target_definition_revision_id: OpaqueIdSchema,
}).strict();

const RetireRecordInputSchema = z.object({ record_id: OpaqueIdSchema, expected_revision: z.number().int().positive() }).strict();

export class ResumeDomainService {
  readonly sources: CareerSourceRepository;
  readonly facts: CareerFactRepository;
  readonly definitions: ResumeDefinitionRepository;
  readonly jobs: ResumeJobRepository;
  readonly variants: TailoredVariantRepository;
  readonly artifacts: ResumeArtifactRepository;
  readonly exports: ResumeExportRepository;
  readonly references: ResumeReferenceRepository;

  constructor(public readonly store: ResumeDataStore, private readonly now = () => new Date()) {
    this.sources = new CareerSourceRepository(store);
    this.facts = new CareerFactRepository(store);
    this.definitions = new ResumeDefinitionRepository(store);
    this.jobs = new ResumeJobRepository(store);
    this.variants = new TailoredVariantRepository(store);
    this.artifacts = new ResumeArtifactRepository(store);
    this.exports = new ResumeExportRepository(store);
    this.references = new ResumeReferenceRepository(store);
  }

  async proposeFact(raw: unknown, authority: DataAuthority): Promise<{ source: z.infer<typeof SourceRecordSchema>; fact: z.infer<typeof CareerFactRecordSchema>; classification: ReturnType<typeof proposalClassificationFromFact>; reused: boolean }> {
    this.authorize(authority, "career.facts.propose");
    const input = ProposalInputSchema.parse(raw);
    const sourceId = randomUUID();
    const sourceRevisionId = randomUUID();
    const factId = randomUUID();
    const factRevisionId = randomUUID();
    const timestamp = this.now().toISOString();
    const classification = await this.facts.classify(input.fact.fact_kind, input.fact.value, authority.grant.record_scopes);
    const source = SourceRecordSchema.parse({
      ...this.envelope("source", sourceId, sourceRevisionId, 1, null, input.fact.sensitivity, "durable_provenance_while_referenced", authority, timestamp),
      source_kind: input.source.source_kind, safe_label: input.source.safe_label, content_digest: input.source.content_digest,
      captured_at: input.source.captured_at, source_ref: randomUUID(), untrusted_content: true,
      extensions: input.source.interview_turn ? { interview_turn: input.source.interview_turn } : {},
    });
    const fact = CareerFactRecordSchema.parse({
      ...this.envelope("career_fact", factId, factRevisionId, 1, null, input.fact.sensitivity, "durable_owner_data", authority, timestamp),
      fact_kind: input.fact.fact_kind, state: input.fact.state, value: input.fact.value,
      source_revision_ids: [sourceRevisionId], confirmation: null, supersedes_fact_revision_id: null,
      review: { reviewed_at: null, review_note: null },
      extensions: { proposal_classification: classification },
    });
    const result = await this.store.commit([source, fact], this.mutation(authority, input, "career_fact", null, null));
    const committedSource = SourceRecordSchema.parse(result.records.find((record) => record.record_type === "source"));
    const committedFact = CareerFactRecordSchema.parse(result.records.find((record) => record.record_type === "career_fact"));
    return { source: committedSource, fact: committedFact, classification: proposalClassificationFromFact(committedFact), reused: result.reused };
  }

  async proposeFactFromSources(raw: unknown, authority: DataAuthority): Promise<{ fact: z.infer<typeof CareerFactRecordSchema>; classification: ReturnType<typeof proposalClassificationFromFact>; reused: boolean }> {
    this.authorize(authority, "career.facts.propose");
    const input = LinkedProposalInputSchema.parse(raw);
    const sources = await this.sources.requireMany(input.source_revision_ids, authority.grant.record_scopes);
    const classification = await this.facts.classify(input.fact.fact_kind, input.fact.value, authority.grant.record_scopes);
    const timestamp = this.now().toISOString();
    const fact = CareerFactRecordSchema.parse({
      ...this.envelope(
        "career_fact",
        randomUUID(),
        randomUUID(),
        1,
        null,
        this.maxSensitivity([input.fact.sensitivity, ...sources.map((source) => source.sensitivity)]),
        "durable_owner_data",
        authority,
        timestamp,
      ),
      fact_kind: input.fact.fact_kind,
      state: input.fact.state,
      value: input.fact.value,
      source_revision_ids: input.source_revision_ids,
      confirmation: null,
      supersedes_fact_revision_id: null,
      review: { reviewed_at: null, review_note: null },
      extensions: { proposal_classification: classification },
    });
    const result = await this.store.commit([fact], this.mutation(authority, input, "career_fact", null, null));
    const committedFact = CareerFactRecordSchema.parse(result.records[0]);
    return { fact: committedFact, classification: proposalClassificationFromFact(committedFact), reused: result.reused };
  }

  async confirmFact(raw: unknown, authority: DataAuthority, evidence: HostOwnerDecisionEvidence): Promise<{ fact: z.infer<typeof CareerFactRecordSchema>; reused: boolean }> {
    this.authorize(authority, "career.facts.confirm");
    const input = FactDecisionInputSchema.parse(raw);
    const result = await this.confirmFactsInternal([input], authority, [evidence], false);
    return { fact: result.facts[0]!, reused: result.reused };
  }

  async confirmFacts(raw: unknown, authority: DataAuthority, evidence: readonly HostOwnerDecisionEvidence[]): Promise<{ facts: z.infer<typeof CareerFactRecordSchema>[]; reused: boolean }> {
    this.authorize(authority, "career.facts.confirm");
    const input = GroupConfirmationInputSchema.parse(raw);
    return this.confirmFactsInternal(input.decisions, authority, evidence, true);
  }

  async factHistory(recordId: string, authority: DataAuthority): Promise<z.infer<typeof CareerFactRecordSchema>[]> {
    this.authorize(authority, "career.facts.read");
    return this.facts.history(recordId, authority.grant.record_scopes);
  }

  async sourcesForFact(revisionId: string, authority: DataAuthority): Promise<z.infer<typeof SourceRecordSchema>[]> {
    this.authorize(authority, "career.facts.read");
    const fact = await this.facts.requireRevision(revisionId, authority.grant.record_scopes);
    return this.sources.requireMany(fact.source_revision_ids, authority.grant.record_scopes);
  }

  async writeJob(raw: unknown, authority: DataAuthority): Promise<{ job: ResumeDataRecord; reused: boolean }> {
    this.authorize(authority, "resume.jobs.write");
    const input = JobInputSchema.parse(raw);
    const observedDigest = `sha256:${createHash("sha256").update(input.description_text, "utf8").digest("hex")}`;
    if (observedDigest !== input.content_digest) throw new ResumeDomainError("validation_failed", "Job snapshot digest does not match its immutable text");
    const timestamp = this.now().toISOString();
    const job = JobDescriptionRecordSchema.parse({
      ...this.envelope("job_description", randomUUID(), randomUUID(), 1, null, input.sensitivity, "durable_provenance_while_referenced", authority, timestamp),
      job_id: input.job_id ?? randomUUID(), safe_label: input.safe_label, source_kind: "owner_paste", captured_at: input.captured_at,
      description_text: input.description_text, content_digest: input.content_digest, untrusted_content: true,
    });
    const result = await this.store.commit([job], this.mutation(authority, input, "job_description", null, null));
    return { job: result.records[0]!, reused: result.reused };
  }

  async writeDefinition(raw: unknown, authority: DataAuthority, hostOwnerConfirmed = false): Promise<{ definition: ResumeDataRecord; variant: ResumeDataRecord | null; reused: boolean }> {
    this.authorize(authority, "resume.definitions.write");
    const input = DefinitionInputSchema.parse(raw);
    if (input.status === "approved" && !hostOwnerConfirmed) throw new ResumeDomainError("denied", "Definition approval requires a host-mediated owner action", 403);
    const supportIds = [...new Set(input.statements.flatMap((statement) => statement.supporting_confirmed_fact_revision_ids))];
    if (new Set(input.statements.map((statement) => statement.statement_id)).size !== input.statements.length) throw new ResumeDomainError("validation_failed", "Definition contains duplicate statement identities");
    const evidenceIds = input.variant ? input.variant.evidence_matrix.flatMap((evidence) => evidence.supporting_confirmed_fact_revision_ids) : [];
    const selectedFactIds = [...new Set([...supportIds, ...evidenceIds])];
    const facts = await this.confirmedFacts(selectedFactIds, authority.grant.record_scopes);
    if (input.statements.some((statement) => statement.kind === "factual" && statement.supporting_confirmed_fact_revision_ids.some((id) => !facts.has(id)))) {
      throw new ResumeDomainError("validation_failed", "Every factual statement must resolve to confirmed fact revisions");
    }
    let parent: ResumeDataRecord | null = null;
    let job: ResumeDataRecord | null = null;
    if (input.definition_kind === "targeted") {
      if (!input.parent_definition_revision_id || !input.job_revision_id || !input.variant) throw new ResumeDomainError("invalid_input", "Targeted definitions require parent, job, and evidence metadata", 400);
      parent = await this.store.readRevision(input.parent_definition_revision_id, authority.grant.record_scopes);
      job = await this.store.readRevision(input.job_revision_id, authority.grant.record_scopes);
      if (parent.record_type !== "resume_definition" || parent.definition_kind !== "general" || parent.status !== "approved" || job.record_type !== "job_description") throw new ResumeDomainError("validation_failed", "Targeted definition lineage is invalid");
    } else {
      if (input.job_revision_id || input.variant) throw new ResumeDomainError("invalid_input", "General definitions cannot carry targeted lineage", 400);
      if (input.parent_definition_revision_id) {
        parent = await this.store.readRevision(input.parent_definition_revision_id, authority.grant.record_scopes);
        if (parent.record_type !== "resume_definition" || parent.definition_kind !== "general") throw new ResumeDomainError("validation_failed", "General definition predecessor lineage is invalid");
      }
    }
    if (input.successor_context?.kind === "remembered_information") {
      if (input.definition_kind !== "general" || input.status !== "proposed" || input.variant || input.successor_context.revision_request_revision_id !== null) {
        throw new ResumeDomainError("validation_failed", "Remembered information must create a separate proposed general definition");
      }
      if (!parent || parent.record_type !== "resume_definition" || parent.status !== "approved"
        || input.parent_definition_revision_id !== input.successor_context.source_definition_revision_id) {
        throw new ResumeDomainError("validation_failed", "Remembered successor must reference its exact approved general source");
      }
      if (input.successor_context.changed_fact_revision_ids.length === 0
        || new Set(input.successor_context.changed_fact_revision_ids).size !== input.successor_context.changed_fact_revision_ids.length) {
        throw new ResumeDomainError("validation_failed", "Remembered successor requires unique confirmed fact changes");
      }
      const lineageFacts = await this.currentChangedFactLineage(input.successor_context.changed_fact_revision_ids, authority);
      const factLineage = changedFactLineage(lineageFacts);
      const variants = (await this.store.list("tailored_variant", authority.grant.record_scopes))
        .map((record) => TailoredVariantRecordSchema.parse(record));
      const expectedStaleIds = staleTailoredVariantIds(parent.metadata.revision_id, factLineage, variants);
      if (canonicalInputDigest([...input.successor_context.stale_tailored_variant_revision_ids].sort()) !== canonicalInputDigest(expectedStaleIds)) {
        throw new ResumeDomainError("validation_failed", "Remembered successor stale-variant lineage is not exact");
      }
      if (unchangedStatementIdentityIssues(parent, input.statements).length > 0) {
        throw new ResumeDomainError("validation_failed", "Unchanged predecessor statements must preserve their stable identities");
      }
      if (!definitionStatementsChanged(parent, input.statements)) {
        throw new ResumeDomainError("validation_failed", "Remembered information did not change the resume proposal");
      }
      const changedKey = canonicalInputDigest([...input.successor_context.changed_fact_revision_ids].sort());
      const existingCandidates = (await this.store.list("resume_definition", authority.grant.record_scopes))
        .map((record) => ResumeDefinitionRecordSchema.parse(record))
        .filter((definition) => definition.successor_context?.kind === "remembered_information"
          && definition.successor_context.source_definition_revision_id === parent!.metadata.revision_id
          && canonicalInputDigest([...definition.successor_context.changed_fact_revision_ids].sort()) === changedKey);
      if (existingCandidates.length > 1) throw new ResumeDomainError("conflict", "Remembered successor lineage requires owner review", 409);
      if (existingCandidates[0]) return { definition: existingCandidates[0], variant: null, reused: true };
    }
    const timestamp = this.now().toISOString();
    const definitionId = randomUUID();
    const definitionRevisionId = randomUUID();
    const sensitivity = this.maxSensitivity([
      ...[...facts.values()].map((fact) => fact.sensitivity),
      ...(parent ? [parent.sensitivity] : []),
      ...(job ? [job.sensitivity] : []),
    ]);
    const factSnapshot = [...facts.values()].map((fact) => ({ revision_id: fact.metadata.revision_id, fact_kind: fact.fact_kind, value: fact.value, source_revision_ids: fact.source_revision_ids }));
    const approvalBlocks: Array<z.infer<typeof InferenceDataBlockSchema>> = [{ category: "confirmed_fact_snapshot", content_digest: canonicalInputDigest({ facts: factSnapshot }), schema_id: "resume.confirmed-facts.v1", schema_version: 1, data: { facts: factSnapshot } }];
    if (input.definition_kind === "targeted" && parent?.record_type === "resume_definition" && job?.record_type === "job_description") {
      approvalBlocks.push(
        { category: "general_resume_definition", content_digest: canonicalInputDigest(parent), schema_id: "resume.definition.v1", schema_version: 1, data: parent },
        { category: "job_description", content_digest: canonicalInputDigest(job), schema_id: "resume.job-description.v1", schema_version: 1, data: job },
      );
    }
    const approvalReport = input.status === "approved"
      ? validateInferenceClaims(
          input.definition_kind === "targeted" ? "targeted_resume_draft" : "general_resume_draft",
          input.definition_kind === "targeted"
            ? { statements: input.statements, parent_general_definition_revision_id: input.parent_definition_revision_id, job_revision_id: input.job_revision_id }
            : { statements: input.statements },
          approvalBlocks,
        )
      : null;
    if (approvalReport && !approvalReport.accepted) throw new ResumeDomainError("validation_failed", "Definition contains unsupported or unproven claims");
    const qualityReport = evaluateResumeQuality({
      title: input.title,
      statements: input.statements,
      section_order: input.section_order,
      selected_fact_revision_ids: selectedFactIds,
      locale: input.locale,
      page_intent: input.page_intent,
      template_id: input.template_id,
      template_version: input.template_version,
    });
    if (input.status === "approved" && !qualityReport.accepted) {
      throw new ResumeDomainError("validation_failed", "Resume quality checks require corrections before approval", 400, { corrections: qualityReport.findings.map((finding) => finding.correction) });
    }
    const definition = ResumeDefinitionRecordSchema.parse({
      ...this.envelope("resume_definition", definitionId, definitionRevisionId, 1, null, sensitivity, "durable_owner_data", authority, timestamp),
      definition_kind: input.definition_kind, status: input.status, title: input.title, statements: input.statements,
      selected_fact_revision_ids: selectedFactIds, section_order: input.section_order, presentation_preferences: input.presentation_preferences,
      locale: input.locale, page_intent: input.page_intent, template_id: input.template_id, template_version: input.template_version,
      parent_definition_revision_id: input.parent_definition_revision_id, job_revision_id: input.job_revision_id,
      policy_version: input.policy_version, prompt_policy_version: input.prompt_policy_version,
      approved_at: input.status === "approved" ? timestamp : null,
      approval_evidence: approvalReport ? {
        validation_run_id: approvalReport.validation_run_id,
        validator_id: approvalReport.validator_id,
        validator_version: approvalReport.validator_version,
        validator_policy_digest: approvalReport.validator_policy_digest,
        input_snapshot_digest: approvalReport.input_snapshot_digest,
        output_digest: canonicalInputDigest(input.statements),
        findings_digest: approvalReport.findings_digest,
        prompt_policy_id: input.prompt_policy_version ? RESUME_PROMPT_POLICY_ID : "owner-authored",
        prompt_policy_version: input.prompt_policy_version ?? "owner-edit-v1",
        provider_policy_id: input.prompt_policy_version ? "owner-active-compatible-no-fallback-v1" : "no-provider-owner-edit-v1",
        quality_report_digest: qualityReport.report_digest,
        quality_input_digest: qualityReport.input_digest,
        quality_validator_id: qualityReport.validator_id,
        quality_validator_version: qualityReport.validator_version,
        validated_at: timestamp,
      } : null,
      successor_context: input.successor_context ? { ...input.successor_context, quality_report_digest: qualityReport.report_digest } : null,
    });
    let variant: z.infer<typeof TailoredVariantRecordSchema> | null = null;
    if (input.variant && parent && job) {
      variant = TailoredVariantRecordSchema.parse({
        ...this.envelope("tailored_variant", randomUUID(), randomUUID(), 1, null, sensitivity, "durable_owner_data", authority, timestamp),
        parent_general_definition_revision_id: parent.metadata.revision_id, targeted_definition_revision_id: definitionRevisionId,
        job_revision_id: job.metadata.revision_id, evidence_matrix: input.variant.evidence_matrix, changed_statement_ids: input.variant.changed_statement_ids,
      });
    }
    const records = variant ? [definition, variant] : [definition];
    const result = await this.store.commit(records, this.mutation(authority, input, "resume_definition", null, null));
    return { definition: result.records[0]!, variant: result.records[1] ?? null, reused: result.reused };
  }

  async approveDefinition(raw: unknown, authority: DataAuthority, hostOwnerConfirmed: boolean): Promise<{ definition: ResumeDataRecord; variant: ResumeDataRecord | null; reused: boolean }> {
    this.authorize(authority, "resume.definitions.write");
    if (!hostOwnerConfirmed) throw new ResumeDomainError("denied", "Definition approval requires a host-mediated owner action", 403);
    const input = DefinitionApprovalInputSchema.parse(raw);
    const current = await this.store.readHead(input.definition_record_id, authority.grant.record_scopes);
    if (current.record_type !== "resume_definition") throw new ResumeDomainError("not_found_within_scope", "Definition was not found within the granted scope", 404);
    if (current.metadata.revision !== input.expected_revision) throw new ResumeDomainError("conflict", "Expected definition revision is stale", 409, { currentRevision: current.metadata.revision });
    if (current.status === "approved") throw new ResumeDomainError("conflict", "Definition is already approved", 409, { currentRevision: current.metadata.revision });
    const factRecords = await this.confirmedFacts(current.selected_fact_revision_ids, authority.grant.record_scopes);
    const facts = [...factRecords.values()].map((fact) => ({ revision_id: fact.metadata.revision_id, fact_kind: fact.fact_kind, value: fact.value, source_revision_ids: fact.source_revision_ids }));
    const dataBlocks: Array<z.infer<typeof InferenceDataBlockSchema>> = [{ category: "confirmed_fact_snapshot", content_digest: canonicalInputDigest({ facts }), schema_id: "resume.confirmed-facts.v1", schema_version: 1, data: { facts } }];
    let validationPurpose: "general_resume_draft" | "targeted_resume_draft" = "general_resume_draft";
    let validationResult: Record<string, unknown> = { statements: current.statements };
    if (current.definition_kind === "targeted") {
      if (!current.parent_definition_revision_id || !current.job_revision_id) throw new ResumeDomainError("validation_failed", "Targeted definition lineage is incomplete");
      const [parent, job] = await Promise.all([
        this.store.readRevision(current.parent_definition_revision_id, authority.grant.record_scopes),
        this.store.readRevision(current.job_revision_id, authority.grant.record_scopes),
      ]);
      if (parent.record_type !== "resume_definition" || parent.definition_kind !== "general" || parent.status !== "approved" || job.record_type !== "job_description") {
        throw new ResumeDomainError("validation_failed", "Targeted definition lineage is invalid");
      }
      dataBlocks.push(
        { category: "general_resume_definition", content_digest: canonicalInputDigest(parent), schema_id: "resume.definition.v1", schema_version: 1, data: parent },
        { category: "job_description", content_digest: canonicalInputDigest(job), schema_id: "resume.job-description.v1", schema_version: 1, data: job },
      );
      validationPurpose = "targeted_resume_draft";
      validationResult = {
        statements: current.statements,
        parent_general_definition_revision_id: current.parent_definition_revision_id,
        job_revision_id: current.job_revision_id,
      };
    }
    const report = validateInferenceClaims(validationPurpose, validationResult, dataBlocks);
    if (!report.accepted) throw new ResumeDomainError("validation_failed", "Definition contains unsupported or unproven claims");
    const qualityReport = evaluateResumeQuality(current);
    if (!qualityReport.accepted) {
      throw new ResumeDomainError("validation_failed", "Resume quality checks require corrections before approval", 400, { corrections: qualityReport.findings.map((finding) => finding.correction) });
    }
    const timestamp = this.now().toISOString();
    const next = ResumeDefinitionRecordSchema.parse({
      ...current,
      metadata: {
        ...current.metadata,
        revision_id: randomUUID(),
        revision: current.metadata.revision + 1,
        created_at: timestamp,
        prior_revision_id: current.metadata.revision_id,
      },
      updated_at: timestamp,
      status: "approved",
      approved_at: timestamp,
      approval_evidence: {
        validation_run_id: report.validation_run_id,
        validator_id: report.validator_id,
        validator_version: report.validator_version,
        validator_policy_digest: report.validator_policy_digest,
        input_snapshot_digest: report.input_snapshot_digest,
        output_digest: canonicalInputDigest(current.statements),
        findings_digest: report.findings_digest,
        prompt_policy_id: current.prompt_policy_version ? RESUME_PROMPT_POLICY_ID : "owner-authored",
        prompt_policy_version: current.prompt_policy_version ?? "owner-edit-v1",
        provider_policy_id: current.prompt_policy_version ? "owner-active-compatible-no-fallback-v1" : "no-provider-owner-edit-v1",
        quality_report_digest: qualityReport.report_digest,
        quality_input_digest: qualityReport.input_digest,
        quality_validator_id: qualityReport.validator_id,
        quality_validator_version: qualityReport.validator_version,
        validated_at: timestamp,
      },
    });
    let variant: z.infer<typeof TailoredVariantRecordSchema> | null = null;
    if (current.definition_kind === "targeted") {
      const priorVariant = await this.variants.forTargetedDefinition(current.metadata.revision_id, authority.grant.record_scopes);
      variant = TailoredVariantRecordSchema.parse({
        ...this.envelope("tailored_variant", randomUUID(), randomUUID(), 1, null, current.sensitivity, "durable_owner_data", authority, timestamp),
        parent_general_definition_revision_id: priorVariant.parent_general_definition_revision_id,
        targeted_definition_revision_id: next.metadata.revision_id,
        job_revision_id: priorVariant.job_revision_id,
        evidence_matrix: priorVariant.evidence_matrix,
        changed_statement_ids: priorVariant.changed_statement_ids,
      });
    }
    const result = await this.store.commit(variant ? [next, variant] : [next], this.mutation(authority, input, "resume_definition", current.metadata.record_id, input.expected_revision));
    return { definition: result.records[0]!, variant: result.records[1] ?? null, reused: result.reused };
  }

  async registerArtifact(raw: unknown, authority: DataAuthority): Promise<{ artifact: ResumeDataRecord; reused: boolean }> {
    this.authorize(authority, "resume.artifacts.register");
    const input = ArtifactInputSchema.parse(raw);
    const definition = await this.store.readRevision(input.definition_revision_id, authority.grant.record_scopes);
    if (definition.record_type !== "resume_definition") throw new ResumeDomainError("validation_failed", "Artifact definition lineage is invalid");
    if (input.accepted && definition.status !== "approved") throw new ResumeDomainError("validation_failed", "Accepted artifacts require an approved definition");
    if (input.accepted) {
      try { assertBoundQualityReport(definition); }
      catch { throw new ResumeDomainError("validation_failed", "Accepted artifacts require a current passing resume quality report"); }
    }
    if (input.accepted && (
      !definition.approval_evidence ||
      input.validation_run_id !== definition.approval_evidence.validation_run_id ||
      canonicalInputDigest(input.findings) !== definition.approval_evidence.findings_digest ||
      input.template_id !== definition.template_id ||
      input.template_version !== definition.template_version
    )) throw new ResumeDomainError("validation_failed", "Accepted artifact lineage does not match the approved definition validation");
    const timestamp = this.now().toISOString();
    const artifact = ArtifactRecordSchema.parse({
      ...this.envelope("artifact", randomUUID(), randomUUID(), 1, null, definition.sensitivity, "durable_owner_data", authority, timestamp),
      ...input,
    });
    const result = await this.store.commit([artifact], this.mutation(authority, input, "artifact", null, null));
    return { artifact: result.records[0]!, reused: result.reused };
  }

  async recordExportReceipt(raw: unknown, authority: DataAuthority): Promise<{ receipt: ResumeDataRecord; reused: boolean }> {
    this.authorize(authority, "resume.export.request");
    const input = ExportReceiptInputSchema.parse(raw);
    const artifact = await this.store.readRevision(input.artifact_revision_id, authority.grant.record_scopes);
    if (artifact.record_type !== "artifact" || !artifact.accepted || artifact.artifact_digest !== input.artifact_digest || artifact.format !== input.format) throw new ResumeDomainError("validation_failed", "Export receipt does not match registered artifact lineage");
    const timestamp = this.now().toISOString();
    const receipt = ExportReceiptRecordSchema.parse({
      ...this.envelope("export_receipt", randomUUID(), randomUUID(), 1, null, artifact.sensitivity, "durable_owner_data", authority, timestamp),
      operation_id: authority.operationId, ...input,
    });
    const result = await this.store.commit([receipt], this.mutation(authority, input, "export_receipt", null, null));
    return { receipt: result.records[0]!, reused: result.reused };
  }

  async referenceGraph(authority: DataAuthority): Promise<ResumeLineageGraph> {
    this.authorize(authority, "resume.definitions.read");
    return this.references.graph(authority.grant.record_scopes);
  }

  async compareDefinitions(raw: unknown, authority: DataAuthority) {
    this.authorize(authority, "resume.definitions.read");
    const input = DefinitionComparisonInputSchema.parse(raw);
    const [left, right] = await Promise.all([
      this.definitions.requireRevision(input.left_revision_id, authority.grant.record_scopes),
      this.definitions.requireRevision(input.right_revision_id, authority.grant.record_scopes),
    ]);
    if (
      (input.left_expected_revision !== undefined && input.left_expected_revision !== left.metadata.revision) ||
      (input.right_expected_revision !== undefined && input.right_expected_revision !== right.metadata.revision)
    ) throw new ResumeDomainError("conflict", "Definition comparison revision is stale", 409, { currentRevision: Math.max(left.metadata.revision, right.metadata.revision) });
    const definitions = (await this.store.allRevisions(authority.grant.record_scopes))
      .filter((record) => record.record_type === "resume_definition")
      .map((record) => ResumeDefinitionRecordSchema.parse(record));
    return compareDefinitionRevisions(left, right, definitions);
  }

  async matchRememberedJob(raw: unknown, authority: DataAuthority) {
    this.authorize(authority, "resume.definitions.read");
    const input = z.object({
      explicit_job_fact_revision_id: OpaqueIdSchema.nullable(),
      description: z.string().max(512),
    }).strict().parse(raw);
    return RememberedMatchResultSchema.parse(await this.facts.matchRememberedEmployment(input, authority.grant.record_scopes));
  }

  async analyzeImpact(raw: unknown, authority: DataAuthority) {
    this.authorize(authority, "resume.definitions.read");
    const input = ImpactAnalysisInputSchema.parse(raw);
    const definition = await this.definitions.requireRevision(input.source_definition_revision_id, authority.grant.record_scopes);
    if (new Set(input.changed_fact_revision_ids).size !== input.changed_fact_revision_ids.length) {
      throw new ResumeDomainError("invalid_input", "Impact analysis requires unique changed fact revisions", 400);
    }
    const lineageFacts = await this.currentChangedFactLineage(input.changed_fact_revision_ids, authority);
    const factLineage = changedFactLineage(lineageFacts);
    const variants = (await this.store.list("tailored_variant", authority.grant.record_scopes)).map((record) => TailoredVariantRecordSchema.parse(record));
    const changedKey = canonicalInputDigest([...input.changed_fact_revision_ids].sort());
    const successorCandidates = (await this.store.list("resume_definition", authority.grant.record_scopes))
      .map((record) => ResumeDefinitionRecordSchema.parse(record))
      .filter((candidate) => candidate.successor_context?.kind === "remembered_information"
        && candidate.successor_context.source_definition_revision_id === definition.metadata.revision_id
        && canonicalInputDigest([...candidate.successor_context.changed_fact_revision_ids].sort()) === changedKey);
    if (successorCandidates.length > 1) throw new ResumeDomainError("conflict", "Remembered impact lineage requires owner review", 409);
    const successor = successorCandidates[0] ?? null;
    const impact = deriveResumeImpact(definition, successor, factLineage, variants);
    return ImpactAnalysisResultSchema.parse({
      impact_version: 1,
      source_definition_revision_id: definition.metadata.revision_id,
      changed_fact_revision_ids: input.changed_fact_revision_ids,
      affected_statements: impact.affected_statements,
      stale_tailored_variants: impact.stale_tailored_variant_revision_ids.map((variantRevisionId) => ({ variant_revision_id: variantRevisionId, status: "based_on_older_evidence", rebuild: "explicit_owner_action" })),
    });
  }

  async submitRevisionRequest(raw: unknown, authority: DataAuthority) {
    this.authorize(authority, "resume.definitions.write");
    const input = RevisionRequestInputSchema.parse(raw);
    const source = await this.definitions.requireRevision(input.source_definition_revision_id, authority.grant.record_scopes);
    try {
      assertRevisionTarget(input.target, source.statements, source.section_order);
    } catch {
      throw new ResumeDomainError("validation_failed", "Revision target does not exist in the selected immutable source");
    }
    const timestamp = this.now().toISOString();
    const request = ResumeRevisionRequestRecordSchema.parse({
      ...this.envelope("resume_revision_request", randomUUID(), randomUUID(), 1, null, source.sensitivity, "durable_owner_data", authority, timestamp),
      source_definition_revision_id: source.metadata.revision_id,
      target: input.target,
      request_text: input.request_text,
      request_digest: canonicalInputDigest(input.request_text),
      classification: null,
      state: "submitted",
      clarification: null,
      attempt: 0,
      resulting_definition_revision_id: null,
      owner_outcome: null,
      submitted_at: timestamp,
      completed_at: null,
    });
    const result = await this.store.commit([request], this.mutation(authority, input, "resume_revision_request", null, null));
    return { request: ResumeRevisionRequestRecordSchema.parse(result.records[0]), reused: result.reused };
  }

  async recordRevisionOutcome(raw: unknown, authority: DataAuthority, hostOwnerConfirmed = false) {
    this.authorize(authority, "resume.definitions.write");
    const input = RevisionOutcomeInputSchema.parse(raw);
    const current = await this.store.readHead(input.request_record_id, authority.grant.record_scopes);
    if (current.record_type !== "resume_revision_request") throw new ResumeDomainError("not_found_within_scope", "Revision request was not found within scope", 404);
    if (current.metadata.revision !== input.expected_revision) throw new ResumeDomainError("conflict", "Revision request revision is stale", 409, { currentRevision: current.metadata.revision });
    if (current.classification !== null && input.classification !== current.classification) {
      throw new ResumeDomainError("validation_failed", "Revision classification cannot change after it is recorded");
    }
    if (["accepted", "edited", "rejected", "regenerate"].includes(input.state) && input.resulting_definition_revision_id !== current.resulting_definition_revision_id) {
      throw new ResumeDomainError("validation_failed", "Revision outcome must retain the exact proposed definition identity");
    }
    try {
      assertRevisionTransition({
        current: current.state,
        next: input.state,
        classification: input.classification,
        hostOwnerConfirmed,
        attempt: current.attempt,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "revision_transition_invalid";
      if (code === "revision_confirmation_required") throw new ResumeDomainError("denied", "Revision transition requires a host-mediated owner confirmation", 403);
      if (code === "revision_attempts_exhausted") throw new ResumeDomainError("conflict", "Revision generation attempts are exhausted", 409);
      throw new ResumeDomainError("conflict", "Revision request transition is not allowed", 409);
    }
    if (input.resulting_definition_revision_id) await this.definitions.requireRevision(input.resulting_definition_revision_id, authority.grant.record_scopes);
    const timestamp = this.now().toISOString();
    const request = ResumeRevisionRequestRecordSchema.parse({
      ...current,
      metadata: { ...current.metadata, revision_id: randomUUID(), revision: current.metadata.revision + 1, prior_revision_id: current.metadata.revision_id, created_at: timestamp },
      updated_at: timestamp,
      classification: input.classification,
      state: input.state,
      clarification: input.clarification,
      attempt: current.attempt + (input.state === "generating" ? 1 : 0),
      resulting_definition_revision_id: input.resulting_definition_revision_id,
      owner_outcome: input.owner_outcome,
      completed_at: ["accepted", "edited", "rejected", "failed"].includes(input.state) ? timestamp : null,
    });
    const result = await this.store.commit([request], this.mutation(authority, input, "resume_revision_request", current.metadata.record_id, input.expected_revision));
    return { request: ResumeRevisionRequestRecordSchema.parse(result.records[0]), reused: result.reused };
  }

  async createRevisionProposal(raw: unknown, authority: DataAuthority, hostOwnerConfirmed = false) {
    this.authorize(authority, "resume.definitions.write");
    const input = RevisionProposalInputSchema.parse(raw);
    const current = ResumeRevisionRequestRecordSchema.parse(await this.store.readHead(input.request_record_id, authority.grant.record_scopes));
    if (current.metadata.revision !== input.expected_revision) throw new ResumeDomainError("conflict", "Revision request revision is stale", 409, { currentRevision: current.metadata.revision });
    const editing = input.owner_outcome === "edit";
    if ((editing && (current.state !== "proposed" || !hostOwnerConfirmed)) || (!editing && current.state !== "generating") || current.classification === null || current.classification === "ambiguous") {
      throw new ResumeDomainError("conflict", "Revision request is not ready to create a proposal", 409);
    }
    let instruction = current;
    if (editing) {
      if (!current.resulting_definition_revision_id) throw new ResumeDomainError("validation_failed", "Revision edit is missing its current proposal");
      const priorProposal = await this.definitions.requireRevision(current.resulting_definition_revision_id, authority.grant.record_scopes);
      const instructionId = priorProposal.successor_context?.revision_request_revision_id;
      if (!instructionId) throw new ResumeDomainError("validation_failed", "Revision edit is missing its immutable instruction lineage");
      instruction = ResumeRevisionRequestRecordSchema.parse(await this.store.readRevision(instructionId, authority.grant.record_scopes));
      if (instruction.metadata.record_id !== current.metadata.record_id || instruction.state !== "generating") throw new ResumeDomainError("validation_failed", "Revision edit instruction lineage is invalid");
    }
    const source = await this.definitions.requireRevision(current.source_definition_revision_id, authority.grant.record_scopes);
    if (source.status !== "approved") throw new ResumeDomainError("validation_failed", "Revision proposals require an approved immutable source");
    if (
      input.draft.source_definition_revision_id !== source.metadata.revision_id ||
      input.draft.revision_request_revision_id !== instruction.metadata.revision_id
    ) throw new ResumeDomainError("validation_failed", "Revision draft lineage does not match the current request");
    if (new Set(input.draft.statements.map((statement) => statement.statement_id)).size !== input.draft.statements.length) {
      throw new ResumeDomainError("validation_failed", "Revision proposal contains duplicate statement identities");
    }
    if (revisionDraftIssues({
      source: { title: source.title, statements: source.statements, section_order: source.section_order },
      successor: input.draft,
      target: current.target,
      classification: current.classification,
    }).length > 0) throw new ResumeDomainError("validation_failed", "Revision proposal changed scope, lineage, or stable statement identities");

    const selectedFactIds = [...new Set(input.draft.statements.flatMap((statement) => statement.supporting_confirmed_fact_revision_ids))];
    const facts = await this.confirmedFacts(selectedFactIds, authority.grant.record_scopes);
    const factSnapshot = [...facts.values()].map((fact) => ({ revision_id: fact.metadata.revision_id, fact_kind: fact.fact_kind, value: fact.value, source_revision_ids: fact.source_revision_ids }));
    const blocks: Array<z.infer<typeof InferenceDataBlockSchema>> = [
      { category: "confirmed_fact_snapshot", content_digest: canonicalInputDigest({ facts: factSnapshot }), schema_id: "resume.confirmed-facts.v1", schema_version: 1, data: { facts: factSnapshot } },
      { category: "general_resume_definition", content_digest: canonicalInputDigest(source), schema_id: "resume.definition.v1", schema_version: 1, data: source },
      { category: "revision_instruction", content_digest: canonicalInputDigest(instruction), schema_id: "resume.revision-request.v1", schema_version: 1, data: instruction },
    ];
    const validation = validateInferenceClaims("resume_revision_draft", input.draft, blocks);
    if (!validation.accepted) throw new ResumeDomainError("validation_failed", "Revision proposal did not pass deterministic truth, lineage, and continuity validation");
    const revisionQuality = evaluateResumeQuality({
      title: input.draft.title,
      statements: input.draft.statements,
      section_order: input.draft.section_order,
      selected_fact_revision_ids: selectedFactIds,
      locale: source.locale,
      page_intent: source.page_intent,
      template_id: source.template_id,
      template_version: source.template_version,
    });
    if (!revisionQuality.accepted) throw new ResumeDomainError("validation_failed", "Revision proposal did not pass deterministic resume quality checks", 400, { corrections: revisionQuality.findings.map((finding) => finding.correction) });

    const timestamp = this.now().toISOString();
    const definitionRevisionId = randomUUID();
    const definition = ResumeDefinitionRecordSchema.parse({
      ...this.envelope("resume_definition", randomUUID(), definitionRevisionId, 1, null, this.maxSensitivity([source.sensitivity, current.sensitivity, ...[...facts.values()].map((fact) => fact.sensitivity)]), "durable_owner_data", authority, timestamp),
      definition_kind: source.definition_kind,
      status: "proposed",
      title: input.draft.title,
      statements: input.draft.statements,
      selected_fact_revision_ids: selectedFactIds,
      section_order: input.draft.section_order,
      presentation_preferences: source.presentation_preferences,
      locale: source.locale,
      page_intent: source.page_intent,
      template_id: source.template_id,
      template_version: source.template_version,
      parent_definition_revision_id: source.definition_kind === "general" ? source.metadata.revision_id : source.parent_definition_revision_id,
      job_revision_id: source.job_revision_id,
      policy_version: source.policy_version,
      prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
      approved_at: null,
      approval_evidence: null,
      successor_context: {
        successor_version: 1,
        kind: "natural_language_revision",
        source_definition_revision_id: source.metadata.revision_id,
        revision_request_revision_id: instruction.metadata.revision_id,
        changed_fact_revision_ids: [],
        stale_tailored_variant_revision_ids: [],
        quality_report_digest: revisionQuality.report_digest,
      },
    });
    let variant: z.infer<typeof TailoredVariantRecordSchema> | null = null;
    if (source.definition_kind === "targeted") {
      const priorVariant = await this.variants.forTargetedDefinition(source.metadata.revision_id, authority.grant.record_scopes);
      variant = TailoredVariantRecordSchema.parse({
        ...this.envelope("tailored_variant", randomUUID(), randomUUID(), 1, null, definition.sensitivity, "durable_owner_data", authority, timestamp),
        parent_general_definition_revision_id: priorVariant.parent_general_definition_revision_id,
        targeted_definition_revision_id: definition.metadata.revision_id,
        job_revision_id: priorVariant.job_revision_id,
        evidence_matrix: priorVariant.evidence_matrix,
        changed_statement_ids: input.draft.changed_statement_ids,
      });
    }
    const request = ResumeRevisionRequestRecordSchema.parse({
      ...current,
      metadata: { ...current.metadata, revision_id: randomUUID(), revision: current.metadata.revision + 1, prior_revision_id: current.metadata.revision_id, created_at: timestamp },
      updated_at: timestamp,
      state: editing ? "edited" : "proposed",
      resulting_definition_revision_id: definition.metadata.revision_id,
      owner_outcome: editing ? "edit" : null,
      completed_at: editing ? timestamp : null,
    });
    const records = variant ? [definition, variant, request] : [definition, request];
    const result = await this.store.commit(records, this.mutation(authority, input, "resume_revision_request", current.metadata.record_id, input.expected_revision));
    return {
      definition: ResumeDefinitionRecordSchema.parse(result.records[0]),
      variant: variant ? TailoredVariantRecordSchema.parse(result.records[1]) : null,
      request: ResumeRevisionRequestRecordSchema.parse(result.records[variant ? 2 : 1]),
      validation,
      reused: result.reused,
    };
  }

  async selectDefinition(revisionId: string, authority: DataAuthority) {
    this.authorize(authority, "resume.definitions.read");
    const definition = await this.definitions.requireRevision(OpaqueIdSchema.parse(revisionId), authority.grant.record_scopes);
    await this.references.graph(authority.grant.record_scopes);
    return definition;
  }

  async rollbackDefinition(raw: unknown, authority: DataAuthority, hostOwnerConfirmed: boolean): Promise<{ definition: ResumeDataRecord; variant: ResumeDataRecord | null; reused: boolean }> {
    this.authorize(authority, "resume.definitions.write");
    const input = DefinitionRollbackInputSchema.parse(raw);
    const [current, target] = await Promise.all([
      this.definitions.requireHead(input.current_definition_record_id, authority.grant.record_scopes),
      this.definitions.requireRevision(input.target_definition_revision_id, authority.grant.record_scopes),
    ]);
    if (current.metadata.revision !== input.current_expected_revision) throw new ResumeDomainError("conflict", "Expected definition revision is stale", 409, { currentRevision: current.metadata.revision });
    if (current.metadata.revision_id === target.metadata.revision_id || current.definition_kind !== target.definition_kind) {
      throw new ResumeDomainError("conflict", "Rollback target is not a coherent prior definition", 409);
    }
    if (target.status === "approved" && !hostOwnerConfirmed) throw new ResumeDomainError("denied", "Approved rollback requires a host-mediated owner action", 403);
    const timestamp = this.now().toISOString();
    const rollbackQuality = evaluateResumeQuality(target);
    if (!rollbackQuality.accepted) throw new ResumeDomainError("validation_failed", "Rollback target no longer passes deterministic resume quality checks", 400, { corrections: rollbackQuality.findings.map((finding) => finding.correction) });
    const base = this.envelope("resume_definition", randomUUID(), randomUUID(), 1, null, target.sensitivity, "durable_owner_data", authority, timestamp);
    const definition = ResumeDefinitionRecordSchema.parse({
      ...target,
      ...base,
      metadata: { ...base.metadata, extensions: target.metadata.extensions },
      extensions: target.extensions,
      parent_definition_revision_id: target.definition_kind === "general" ? target.metadata.revision_id : target.parent_definition_revision_id,
      successor_context: {
        successor_version: 1,
        kind: "rollback",
        source_definition_revision_id: target.metadata.revision_id,
        revision_request_revision_id: null,
        changed_fact_revision_ids: [],
        stale_tailored_variant_revision_ids: [],
        quality_report_digest: rollbackQuality.report_digest,
      },
    });
    let variant: z.infer<typeof TailoredVariantRecordSchema> | null = null;
    if (target.definition_kind === "targeted") {
      const targetVariant = await this.variants.forTargetedDefinition(target.metadata.revision_id, authority.grant.record_scopes);
      variant = TailoredVariantRecordSchema.parse({
        ...this.envelope("tailored_variant", randomUUID(), randomUUID(), 1, null, targetVariant.sensitivity, "durable_owner_data", authority, timestamp),
        parent_general_definition_revision_id: targetVariant.parent_general_definition_revision_id,
        targeted_definition_revision_id: definition.metadata.revision_id,
        job_revision_id: targetVariant.job_revision_id,
        evidence_matrix: targetVariant.evidence_matrix,
        changed_statement_ids: targetVariant.changed_statement_ids,
        extensions: targetVariant.extensions,
      });
    }
    const result = await this.store.commit(
      variant ? [definition, variant] : [definition],
      this.mutation(authority, input, "resume_definition_rollback", current.metadata.record_id, input.current_expected_revision),
    );
    return { definition: result.records[0]!, variant: result.records[1] ?? null, reused: result.reused };
  }

  async retireRecord(raw: unknown, authority: DataAuthority): Promise<{ record: ResumeDataRecord; reused: boolean }> {
    const input = RetireRecordInputSchema.parse(raw);
    const current = await this.store.readHead(input.record_id, authority.grant.record_scopes);
    this.authorizeRecordMutation(current.record_type, authority);
    if (current.metadata.revision !== input.expected_revision || current.lifecycle_state !== "active") {
      throw new ResumeDomainError("conflict", "Expected active record revision is stale", 409, { currentRevision: current.metadata.revision });
    }
    await this.references.assertNoInboundReferences(current.metadata.revision_id, authority.grant.record_scopes);
    const timestamp = this.now().toISOString();
    const candidate = ResumeDataRecordSchema.parse({
      ...current,
      metadata: {
        ...current.metadata,
        revision_id: randomUUID(),
        revision: current.metadata.revision + 1,
        created_at: timestamp,
        created_by: { ...current.metadata.created_by, actor_id: authority.grant.actor_id, installation_id: authority.grant.installation_id, package_digest: authority.grant.package_digest },
        prior_revision_id: current.metadata.revision_id,
      },
      updated_at: timestamp,
      lifecycle_state: "retired",
      ...(current.record_type === "resume_definition" ? { status: "retired", approved_at: null, approval_evidence: null } : {}),
    });
    const result = await this.store.commit([candidate], this.mutation(authority, input, current.record_type, current.metadata.record_id, input.expected_revision));
    return { record: result.records[0]!, reused: result.reused };
  }

  async assertRecordDeletable(revisionId: string, authority: DataAuthority): Promise<void> {
    if (!authority.grant.capabilities.includes(authority.capability) || authority.grant.revoked_at || Date.parse(authority.grant.expires_at) <= Date.now()) {
      throw new ResumeDomainError("denied", "Capability operation is not authorized", 403);
    }
    const record = await this.store.readRevision(OpaqueIdSchema.parse(revisionId), authority.grant.record_scopes);
    await this.references.assertNoInboundReferences(record.metadata.revision_id, authority.grant.record_scopes);
    throw new ResumeDomainError("conflict", "Durable owner records cannot be destructively deleted", 409);
  }

  async saveInterviewRecovery(raw: unknown, authority: DataAuthority): Promise<{
    progress: z.infer<typeof InterviewProgressRecordSchema>;
    reused: boolean;
    acknowledgement: { revision_id: string; revision: number; saved_at: string; value_digest: string };
  }> {
    this.authorize(authority, "resume.definitions.write");
    const input = InterviewRecoverySaveInputSchema.parse(raw);
    if (input.value_digest !== canonicalInputDigest(input.value)) {
      throw new ResumeDomainError("validation_failed", "Recovery draft digest does not match its exact value");
    }
    if (input.slot.session_id !== input.session_id) {
      throw new ResumeDomainError("validation_failed", "Recovery slot and interview session identities do not match");
    }
    const current = input.record_id ? await this.requireInterviewProgress(input.record_id, authority) : null;
    const retainedSession = OpaqueIdSchema.safeParse(current?.extensions.interview_session_id);
    if (retainedSession.success && retainedSession.data !== input.session_id) {
      throw new ResumeDomainError("validation_failed", "Recovery slot cannot change the durable interview session");
    }
    await this.requireEmploymentSlot(input.slot.job_fact_revision_id, authority);
    const timestamp = this.now().toISOString();
    const revision = current ? current.metadata.revision + 1 : 1;
    const progress = InterviewProgressRecordSchema.parse({
      ...this.envelope(
        "interview_progress",
        current?.metadata.record_id ?? randomUUID(),
        randomUUID(),
        revision,
        current?.metadata.revision_id ?? null,
        "sensitive",
        "durable_owner_data",
        authority,
        timestamp,
      ),
      status: "in_progress",
      current_topic: input.current_topic,
      completed_topics: input.completed_topics,
      skipped_topics: input.skipped_topics,
      draft_state: "declared_draft",
      active_job_fact_revision_id: input.slot.job_fact_revision_id,
      current_question_id: input.slot.question_id,
      current_field_id: input.slot.field_id,
      job_dimension: input.job_dimension,
      recovery_draft: {
        slot: input.slot,
        value: input.value,
        value_digest: input.value_digest,
        saved_at: timestamp,
        acknowledged_revision: revision,
      },
      last_submitted_turn_revision_id: current?.last_submitted_turn_revision_id ?? null,
      extensions: { ...current?.extensions, interview_session_id: input.session_id },
    });
    const result = await this.store.commit(
      [progress],
      this.mutation(authority, input, "interview_recovery", current?.metadata.record_id ?? null, current ? input.expected_revision : null),
    );
    const committed = InterviewProgressRecordSchema.parse(result.records[0]);
    const acknowledgement = committed.recovery_draft;
    if (!acknowledgement) throw new ResumeDomainError("recoverable_internal_failure", "Committed recovery acknowledgement was unavailable", 500);
    return {
      progress: committed,
      reused: result.reused,
      acknowledgement: {
        revision_id: committed.metadata.revision_id,
        revision: committed.metadata.revision,
        saved_at: acknowledgement.saved_at,
        value_digest: acknowledgement.value_digest,
      },
    };
  }

  async discardInterviewRecovery(raw: unknown, authority: DataAuthority): Promise<{
    progress: z.infer<typeof InterviewProgressRecordSchema>;
    reused: boolean;
  }> {
    this.authorize(authority, "resume.definitions.write");
    const input = InterviewRecoveryDiscardInputSchema.parse(raw);
    const current = await this.requireInterviewProgress(input.record_id, authority);
    const timestamp = this.now().toISOString();
    const progress = InterviewProgressRecordSchema.parse({
      ...this.envelope("interview_progress", current.metadata.record_id, randomUUID(), current.metadata.revision + 1, current.metadata.revision_id, current.sensitivity, current.retention_class, authority, timestamp),
      status: current.status,
      current_topic: current.current_topic,
      completed_topics: current.completed_topics,
      skipped_topics: current.skipped_topics,
      draft_state: current.draft_state,
      active_job_fact_revision_id: current.active_job_fact_revision_id,
      current_question_id: current.current_question_id,
      current_field_id: current.current_field_id,
      job_dimension: current.job_dimension,
      recovery_draft: null,
      last_submitted_turn_revision_id: current.last_submitted_turn_revision_id,
      extensions: current.extensions,
    });
    const result = await this.store.commit([progress], this.mutation(authority, input, "interview_recovery", current.metadata.record_id, input.expected_revision));
    return { progress: InterviewProgressRecordSchema.parse(result.records[0]), reused: result.reused };
  }

  async submitInterviewProgress(raw: unknown, authority: DataAuthority): Promise<{
    progress: z.infer<typeof InterviewProgressRecordSchema>;
    turn: z.infer<typeof SourceRecordSchema>;
    reused: boolean;
  }> {
    this.authorize(authority, "resume.definitions.write");
    const input = InterviewProgressSubmitInputSchema.parse(raw);
    const recovered = await this.recoveredOperation(authority, input);
    if (recovered) {
      const recoveredTurn = recovered.find((record) => record.record_type === "source")
        ?? (input.submission.kind === "existing_turn"
          ? await this.store.readRevision(input.submission.source_revision_id, authority.grant.record_scopes)
          : undefined);
      return {
        progress: InterviewProgressRecordSchema.parse(recovered.find((record) => record.record_type === "interview_progress")),
        turn: SourceRecordSchema.parse(recoveredTurn),
        reused: true,
      };
    }
    const current = await this.requireInterviewProgress(input.record_id, authority);
    if (!current.recovery_draft || current.recovery_draft.slot.session_id !== input.session_id) {
      throw new ResumeDomainError("validation_failed", "Interview submission requires the acknowledged recovery slot for this session");
    }
    const nextActiveJobRevisionId = input.active_job_fact_revision_id === undefined
      ? current.active_job_fact_revision_id ?? null
      : input.active_job_fact_revision_id;
    await this.requireEmploymentSlot(nextActiveJobRevisionId, authority);
    let turn: z.infer<typeof SourceRecordSchema>;
    let newTurn: z.infer<typeof SourceRecordSchema> | null = null;
    const timestamp = this.now().toISOString();
    if (input.submission.kind === "existing_turn") {
      turn = SourceRecordSchema.parse(await this.store.readRevision(input.submission.source_revision_id, authority.grant.record_scopes));
      const auditTurn = InterviewTurnAuditSchema.safeParse(turn.extensions.interview_turn);
      const linked = await this.requireConfirmedFact(input.submission.linked_confirmed_fact_revision_id, authority);
      if (
        !auditTurn.success ||
        auditTurn.data.session_id !== input.session_id ||
        !this.turnContainsRecovery(auditTurn.data, current.recovery_draft.slot.field_id, current.recovery_draft.value) ||
        !linked.source_revision_ids.includes(turn.metadata.revision_id)
      ) {
        throw new ResumeDomainError("validation_failed", "Submitted interview provenance does not match the acknowledged recovery slot");
      }
    } else {
      if (input.submission.turn.session_id !== input.session_id || !this.turnContainsRecovery(input.submission.turn, current.recovery_draft.slot.field_id, current.recovery_draft.value)) {
        throw new ResumeDomainError("validation_failed", "Submitted interview turn does not match the acknowledged recovery value");
      }
      let sensitivity: Sensitivity = input.submission.sensitivity;
      if (input.submission.linked_confirmed_fact_revision_id) {
        const linked = await this.requireConfirmedFact(input.submission.linked_confirmed_fact_revision_id, authority);
        sensitivity = this.maxSensitivity([sensitivity, linked.sensitivity]);
      }
      newTurn = SourceRecordSchema.parse({
        ...this.envelope("source", input.submission.turn.turn_id, randomUUID(), 1, null, sensitivity, "durable_owner_data", authority, timestamp),
        source_kind: "owner_interview",
        safe_label: "Resume interview turn",
        content_digest: canonicalInputDigest(input.submission.turn),
        captured_at: input.submission.turn.occurred_at,
        source_ref: randomUUID(),
        untrusted_content: true,
        extensions: {
          interview_turn: input.submission.turn,
          linked_confirmed_fact_revision_id: input.submission.linked_confirmed_fact_revision_id,
        },
      });
      turn = newTurn;
    }
    const progress = InterviewProgressRecordSchema.parse({
      ...this.envelope("interview_progress", current.metadata.record_id, randomUUID(), current.metadata.revision + 1, current.metadata.revision_id, current.sensitivity, current.retention_class, authority, timestamp),
      status: input.status,
      current_topic: input.current_topic,
      completed_topics: input.completed_topics,
      skipped_topics: input.skipped_topics,
      draft_state: input.draft_state,
      active_job_fact_revision_id: nextActiveJobRevisionId,
      current_question_id: input.current_question_id === undefined ? current.current_question_id : input.current_question_id,
      current_field_id: input.current_field_id === undefined ? current.current_field_id : input.current_field_id,
      job_dimension: input.job_dimension === undefined ? current.job_dimension : input.job_dimension,
      recovery_draft: null,
      last_submitted_turn_revision_id: turn.metadata.revision_id,
      extensions: current.extensions,
    });
    const result = await this.store.commit(
      newTurn ? [progress, newTurn] : [progress],
      this.mutation(authority, input, "interview_progress_submit", current.metadata.record_id, input.expected_revision),
    );
    return {
      progress: InterviewProgressRecordSchema.parse(result.records.find((record) => record.record_type === "interview_progress")),
      turn: SourceRecordSchema.parse(result.records.find((record) => record.record_type === "source") ?? turn),
      reused: result.reused,
    };
  }

  async saveInterviewProgress(raw: unknown, authority: DataAuthority): Promise<{ progress: ResumeDataRecord; reused: boolean }> {
    this.authorize(authority, "resume.definitions.write");
    const input = InterviewInputSchema.parse(raw);
    const current = input.record_id ? await this.store.readHead(input.record_id, authority.grant.record_scopes) : null;
    if (current && current.record_type !== "interview_progress") throw new ResumeDomainError("not_found_within_scope", "Record was not found within the granted scope", 404);
    const timestamp = this.now().toISOString();
    const rawProgress = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const preservesRecovery = Boolean(current?.record_type === "interview_progress" && current.recovery_draft && !("recovery_draft" in rawProgress));
    const recoveryDraft = preservesRecovery && current?.record_type === "interview_progress" && current.recovery_draft
      ? { ...current.recovery_draft, saved_at: timestamp, acknowledged_revision: current.metadata.revision + 1 }
      : input.recovery_draft;
    const retainedSession = OpaqueIdSchema.safeParse(current?.extensions.interview_session_id);
    const sessionId = input.session_id ?? input.audit_turn?.session_id ?? (retainedSession.success ? retainedSession.data : randomUUID());
    if ((retainedSession.success && retainedSession.data !== sessionId) || (input.audit_turn && input.audit_turn.session_id !== sessionId)) {
      throw new ResumeDomainError("validation_failed", "Interview progress and audit turn session identities do not match");
    }
    await this.requireEmploymentSlot(input.active_job_fact_revision_id, authority);
    const progress = InterviewProgressRecordSchema.parse({
      ...this.envelope("interview_progress", current?.metadata.record_id ?? randomUUID(), randomUUID(), current ? current.metadata.revision + 1 : 1, current?.metadata.revision_id ?? null, "sensitive", "durable_owner_data", authority, timestamp),
      status: input.status, current_topic: input.current_topic, completed_topics: input.completed_topics, skipped_topics: input.skipped_topics, draft_state: input.draft_state,
      active_job_fact_revision_id: preservesRecovery && current?.record_type === "interview_progress" ? current.active_job_fact_revision_id : input.active_job_fact_revision_id,
      current_question_id: preservesRecovery && current?.record_type === "interview_progress" ? current.current_question_id : input.current_question_id,
      current_field_id: preservesRecovery && current?.record_type === "interview_progress" ? current.current_field_id : input.current_field_id,
      job_dimension: preservesRecovery && current?.record_type === "interview_progress" ? current.job_dimension : input.job_dimension,
      recovery_draft: recoveryDraft,
      last_submitted_turn_revision_id: "last_submitted_turn_revision_id" in rawProgress
        ? input.last_submitted_turn_revision_id
        : current?.record_type === "interview_progress"
          ? current.last_submitted_turn_revision_id
          : null,
      extensions: { ...current?.extensions, interview_session_id: sessionId },
    });
    const auditTurn = input.audit_turn ? SourceRecordSchema.parse({
      ...this.envelope("source", input.audit_turn.turn_id, randomUUID(), 1, null, "standard", "durable_owner_data", authority, timestamp),
      source_kind: "owner_interview",
      safe_label: "Resume interview turn",
      content_digest: canonicalInputDigest(input.audit_turn),
      captured_at: input.audit_turn.occurred_at,
      source_ref: randomUUID(),
      untrusted_content: true,
      extensions: { interview_turn: input.audit_turn, linked_confirmed_fact_revision_id: null },
    }) : null;
    const result = await this.store.commit(auditTurn ? [progress, auditTurn] : [progress], this.mutation(authority, input, "interview_progress", current?.metadata.record_id ?? null, current ? input.expected_revision : null));
    return { progress: result.records[0]!, reused: result.reused };
  }

  async recordInterviewTurn(raw: unknown, authority: DataAuthority): Promise<{ turn: z.infer<typeof SourceRecordSchema>; reused: boolean }> {
    this.authorize(authority, "resume.definitions.write");
    const input = InterviewTurnInputSchema.parse(raw);
    let sensitivity = input.sensitivity;
    if (input.linked_confirmed_fact_revision_id) {
      const linked = await this.store.readRevision(input.linked_confirmed_fact_revision_id, authority.grant.record_scopes);
      if (linked.record_type !== "career_fact" || linked.state !== "confirmed") {
        throw new ResumeDomainError("validation_failed", "Interview turn link must resolve to a confirmed career fact");
      }
      sensitivity = this.maxSensitivity([sensitivity, linked.sensitivity]);
    }
    const timestamp = this.now().toISOString();
    const turn = SourceRecordSchema.parse({
      ...this.envelope("source", input.turn.turn_id, randomUUID(), 1, null, sensitivity, "durable_owner_data", authority, timestamp),
      source_kind: "owner_interview",
      safe_label: "Resume interview turn",
      content_digest: canonicalInputDigest(input.turn),
      captured_at: input.turn.occurred_at,
      source_ref: randomUUID(),
      untrusted_content: true,
      extensions: {
        interview_turn: input.turn,
        linked_confirmed_fact_revision_id: input.linked_confirmed_fact_revision_id,
      },
    });
    const result = await this.store.commit([turn], this.mutation(authority, input, "interview_turn", null, null));
    return { turn: SourceRecordSchema.parse(result.records[0]), reused: result.reused };
  }

  async readRecords(recordType: ResumeDataRecord["record_type"], authority: DataAuthority): Promise<ResumeDataRecord[]> {
    return this.store.list(recordType, authority.grant.record_scopes);
  }

  private async currentChangedFactLineage(
    changedRevisionIds: readonly string[],
    authority: DataAuthority,
  ): Promise<z.infer<typeof CareerFactRecordSchema>[]> {
    const lineage = new Map<string, z.infer<typeof CareerFactRecordSchema>>();
    for (const revisionId of changedRevisionIds) {
      const changed = await this.store.readRevision(revisionId, authority.grant.record_scopes);
      if (changed.record_type !== "career_fact" || changed.state !== "confirmed" || changed.owner_id !== authority.grant.owner_id) {
        throw new ResumeDomainError("not_found_within_scope", "Changed fact was not found within scope", 404);
      }
      const head = await this.store.readHead(changed.metadata.record_id, authority.grant.record_scopes);
      if (head.metadata.revision_id !== changed.metadata.revision_id) {
        throw new ResumeDomainError("conflict", "Changed fact revision is no longer current", 409, { currentRevision: head.metadata.revision });
      }
      let cursor: z.infer<typeof CareerFactRecordSchema> | null = CareerFactRecordSchema.parse(changed);
      while (cursor && !lineage.has(cursor.metadata.revision_id)) {
        lineage.set(cursor.metadata.revision_id, cursor);
        if (!cursor.supersedes_fact_revision_id) break;
        const prior: ResumeDataRecord = await this.store.readRevision(cursor.supersedes_fact_revision_id, authority.grant.record_scopes);
        if (prior.record_type !== "career_fact" || prior.metadata.record_id !== changed.metadata.record_id) {
          throw new ResumeDomainError("validation_failed", "Changed fact supersession lineage is invalid");
        }
        cursor = CareerFactRecordSchema.parse(prior);
      }
    }
    return [...lineage.values()];
  }

  private async confirmFactsInternal(
    decisions: readonly FactDecisionInput[],
    authority: DataAuthority,
    evidence: readonly HostOwnerDecisionEvidence[],
    grouped: boolean,
  ): Promise<{ facts: z.infer<typeof CareerFactRecordSchema>[]; reused: boolean }> {
    if (decisions.length !== evidence.length) {
      throw new ResumeDomainError("denied", "Every fact decision requires separate authenticated host-owner evidence", 403);
    }
    const proofs = decisions.map((input, index) => requireHostOwnerDecisionEvidence(evidence[index], {
      ownerId: authority.grant.owner_id,
      actorId: authority.grant.actor_id,
      operationId: authority.operationId,
      inputRevisionId: input.fact_revision_id,
      decision: input.decision,
    }));
    const inputRecords = await Promise.all(decisions.map((input) => this.facts.requireRevision(input.fact_revision_id, authority.grant.record_scopes)));
    const timestamp = this.now().toISOString();
    const nextRecords = await Promise.all(inputRecords.map(async (current, index) => {
      const input = decisions[index]!;
      if (current.metadata.record_id !== input.fact_record_id || current.metadata.revision !== input.expected_revision) {
        throw new ResumeDomainError("conflict", "Expected fact revision is stale", 409, { currentRevision: current.metadata.revision });
      }
      if (current.state === "rejected") {
        throw new ResumeDomainError("conflict", "Rejected facts cannot transition again", 409);
      }
      if (current.state === "confirmed") {
        if (input.decision === "accept" || (input.decision === "edit_and_accept" && input.edited_value === current.value)) {
          throw new ResumeDomainError("conflict", "Confirmed facts require a material owner correction or removal", 409);
        }
      }
      const sourceRecords = await this.sources.requireMany(current.source_revision_ids, authority.grant.record_scopes);
      const nextSensitivity = this.maxSensitivity([current.sensitivity, ...sourceRecords.map((source) => source.sensitivity)]);
      const base = this.envelope(
        "career_fact",
        current.metadata.record_id,
        randomUUID(),
        current.metadata.revision + 1,
        current.metadata.revision_id,
        nextSensitivity,
        "durable_owner_data",
        authority,
        timestamp,
      );
      return CareerFactRecordSchema.parse({
        ...base,
        metadata: { ...base.metadata, extensions: current.metadata.extensions },
        extensions: current.extensions,
        fact_kind: current.fact_kind,
        state: input.decision === "reject" ? "rejected" : "confirmed",
        value: input.edited_value ?? current.value,
        source_revision_ids: current.source_revision_ids,
        confirmation: proofs[index],
        supersedes_fact_revision_id: current.metadata.revision_id,
        review: { reviewed_at: timestamp, review_note: input.review_note },
      });
    }));
    const expectedRevisions = Object.fromEntries(decisions.map((input) => [input.fact_record_id, input.expected_revision]));
    const canonicalInput = {
      decisions,
      owner_confirmations: proofs.map((proof) => ({
        owner_id: proof.owner_id,
        actor_id: proof.actor_id,
        host_mediated: proof.host_mediated,
        decision: proof.decision,
        operation_id: proof.operation_id,
        input_revision_id: proof.input_revision_id,
      })),
    };
    const mutation = this.mutation(
      authority,
      canonicalInput,
      grouped ? "career_fact_group" : "career_fact",
      grouped ? null : decisions[0]!.fact_record_id,
      grouped ? null : decisions[0]!.expected_revision,
    );
    if (grouped) mutation.expectedRevisions = expectedRevisions;
    const result = await this.store.commit(nextRecords, mutation);
    return {
      facts: result.records.map((record) => CareerFactRecordSchema.parse(record)),
      reused: result.reused,
    };
  }

  private authorize(authority: DataAuthority, expected: DataAuthority["capability"]): void {
    if (authority.capability !== expected || !authority.grant.capabilities.includes(expected) || authority.grant.revoked_at || Date.parse(authority.grant.expires_at) <= Date.now()) {
      throw new ResumeDomainError("denied", "Capability operation is not authorized", 403);
    }
  }

  private authorizeRecordMutation(recordType: ResumeDataRecord["record_type"], authority: DataAuthority): void {
    const capabilityByType: Partial<Record<ResumeDataRecord["record_type"], DataAuthority["capability"]>> = {
      resume_definition: "resume.definitions.write",
      tailored_variant: "resume.definitions.write",
      job_description: "resume.jobs.write",
      artifact: "resume.artifacts.register",
      export_receipt: "resume.export.request",
    };
    const expected = capabilityByType[recordType];
    if (!expected) throw new ResumeDomainError("denied", "Record retirement is outside this milestone authority", 403);
    this.authorize(authority, expected);
  }

  private envelope(recordType: ResumeDataRecord["record_type"], recordId: string, revisionId: string, revision: number, priorRevisionId: string | null, sensitivity: Sensitivity, retentionClass: string, authority: DataAuthority, timestamp: string) {
    return {
      schema_version: RESUME_DATA_SCHEMA_VERSION, record_type: recordType,
      metadata: { record_id: recordId, revision_id: revisionId, revision, created_at: timestamp, created_by: { owner_id: authority.grant.owner_id, actor_id: authority.grant.actor_id, app_id: authority.grant.app_id, publisher_id: authority.grant.publisher_id, package_digest: authority.grant.package_digest, installation_id: authority.grant.installation_id }, prior_revision_id: priorRevisionId, extensions: {} },
      owner_id: authority.grant.owner_id, updated_at: timestamp, lifecycle_state: "active", sensitivity, retention_class: retentionClass, extensions: {},
    };
  }

  private mutation(authority: DataAuthority, canonicalInput: unknown, targetCategory: string, targetId: string | null, expectedRevision: number | null): MutationContext {
    return { operationId: authority.operationId, idempotencyKey: authority.idempotencyKey, canonicalInput, ownerId: authority.grant.owner_id, actorId: authority.grant.actor_id, installationId: authority.grant.installation_id, capability: authority.capability, targetCategory, targetId, expectedRevision, isCancelled: authority.isCancelled };
  }

  private async confirmedFacts(revisionIds: string[], scopes: readonly string[]): Promise<Map<string, z.infer<typeof CareerFactRecordSchema>>> {
    const facts = new Map<string, z.infer<typeof CareerFactRecordSchema>>();
    for (const revisionId of revisionIds) {
      const record = await this.store.readRevision(revisionId, scopes);
      if (record.record_type !== "career_fact" || record.state !== "confirmed") throw new ResumeDomainError("validation_failed", "Resume support must resolve to confirmed fact revisions");
      facts.set(revisionId, record);
    }
    return facts;
  }

  private async requireInterviewProgress(recordId: string, authority: DataAuthority): Promise<z.infer<typeof InterviewProgressRecordSchema>> {
    const record = await this.store.readHead(recordId, authority.grant.record_scopes);
    if (record.record_type !== "interview_progress") {
      throw new ResumeDomainError("not_found_within_scope", "Record was not found within the granted scope", 404);
    }
    return InterviewProgressRecordSchema.parse(record);
  }

  private async requireConfirmedFact(revisionId: string, authority: DataAuthority): Promise<z.infer<typeof CareerFactRecordSchema>> {
    const record = await this.store.readRevision(revisionId, authority.grant.record_scopes);
    if (record.record_type !== "career_fact" || record.state !== "confirmed" || record.owner_id !== authority.grant.owner_id) {
      throw new ResumeDomainError("validation_failed", "Interview submission link must resolve to a confirmed same-owner career fact");
    }
    return record;
  }

  private async requireEmploymentSlot(revisionId: string | null, authority: DataAuthority): Promise<void> {
    if (!revisionId) return;
    const record = await this.requireConfirmedFact(revisionId, authority);
    if (record.fact_kind !== "employment") {
      throw new ResumeDomainError("validation_failed", "Interview job slot must resolve to a confirmed employment fact");
    }
  }

  private async recoveredOperation(authority: DataAuthority, canonicalInput: unknown): Promise<ResumeDataRecord[] | null> {
    try {
      const prior = await this.store.operation(authority.operationId, authority.grant.installation_id);
      if (
        prior.record.owner_id !== authority.grant.owner_id ||
        prior.record.actor_id !== authority.grant.actor_id ||
        prior.record.capability !== authority.capability ||
        prior.record.idempotency_key !== authority.idempotencyKey ||
        prior.record.canonical_input_digest !== canonicalInputDigest(canonicalInput)
      ) {
        throw new ResumeDomainError("idempotency_conflict", "Operation identity was reused with different canonical input");
      }
      return prior.results;
    } catch (error) {
      if (error instanceof ResumeDomainError && error.code === "not_found_within_scope") return null;
      throw error;
    }
  }

  private turnContainsRecovery(turn: z.infer<typeof InterviewTurnAuditSchema>, fieldId: string, value: string): boolean {
    if (turn.answer === value || turn.follow_up?.answer === value) return true;
    if (!turn.answer) return false;
    try {
      const structured = JSON.parse(turn.answer) as Record<string, unknown>;
      const fieldKey: Record<string, string> = {
        "job-title": "title",
        employer: "employer",
        "job-location": "location",
        "job-start": "start_date",
        "job-end": "end_date",
        responsibilities: "responsibilities",
      };
      const key = fieldKey[fieldId];
      return Boolean(key) && structured[key] === value;
    } catch {
      return false;
    }
  }

  private maxSensitivity(values: Sensitivity[]): Sensitivity {
    const rank: Record<Sensitivity, number> = { standard: 0, sensitive: 1, highly_sensitive: 2 };
    return values.reduce<Sensitivity>((current, value) => rank[value] > rank[current] ? value : current, "standard");
  }
}
