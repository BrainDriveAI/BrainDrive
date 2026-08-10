import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  ArtifactRecordSchema,
  CareerFactRecordSchema,
  ExportReceiptRecordSchema,
  InterviewProgressRecordSchema,
  JobDescriptionRecordSchema,
  RequirementEvidenceSchema,
  ResumeDataRecordSchema,
  ResumeDefinitionRecordSchema,
  ResumeStatementSchema,
  SourceRecordSchema,
  TailoredVariantRecordSchema,
  type SensitivitySchema,
} from "../app-platform/contracts/data.js";
import { canonicalInputDigest, NonEmptyStringSchema, OpaqueIdSchema, Sha256DigestSchema, TimestampSchema } from "../app-platform/contracts/common.js";
import type { CapabilityGrant } from "../app-platform/lifecycle/store.js";
import type { InferenceDataBlockSchema } from "../app-platform/contracts/inference.js";
import { ResumeDomainError } from "./errors.js";
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
import { RESUME_PROMPT_POLICY_ID } from "../resume-inference/policy.js";
import { validateInferenceClaims } from "../resume-inference/validators.js";
import {
  ResumeArtifactRepository,
  ResumeDefinitionRepository,
  ResumeExportRepository,
  ResumeJobRepository,
  ResumeReferenceRepository,
  TailoredVariantRepository,
} from "./lineage-repositories.js";
import { changedStatementIds, type ResumeLineageGraph } from "./resume-lineage.js";

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
  }).strict(),
  fact: z.object({
    fact_kind: z.enum(["identity", "contact", "employment", "education", "skill", "credential", "accomplishment", "project", "preference"]),
    state: z.enum(["imported", "suggested"]),
    value: z.string().min(1).max(16_384),
    sensitivity: z.enum(["standard", "sensitive", "highly_sensitive"]),
  }).strict(),
}).strict();

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
}).strict();

const JobInputSchema = z.object({ job_id: OpaqueIdSchema.optional(), safe_label: z.string().min(1).max(256), description_text: z.string().min(1).max(131_072), content_digest: Sha256DigestSchema, captured_at: TimestampSchema, sensitivity: z.enum(["standard", "sensitive", "highly_sensitive"]).default("sensitive") }).strict();

const SafeDestinationLabelSchema = z.string().min(1).max(256).regex(/^[^/\\:\u0000-\u001f]+$/).refine((value) => value !== "." && value !== "..", "destination label cannot be a path segment");
const ExportReceiptInputSchema = z.object({ artifact_revision_id: OpaqueIdSchema, artifact_digest: Sha256DigestSchema, format: z.enum(["pdf", "docx", "html"]), outcome: z.enum(["completed", "cancelled", "failed"]), exported_at: TimestampSchema, safe_destination_label: SafeDestinationLabelSchema }).strict();

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
  format: z.enum(["pdf", "docx", "html"]),
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
        validated_at: timestamp,
      } : null,
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
    const changed = changedStatementIds(left.statements, right.statements);
    const leftIds = new Set(left.statements.map((statement) => statement.statement_id));
    const rightIds = new Set(right.statements.map((statement) => statement.statement_id));
    return {
      comparison_version: 1 as const,
      left_revision_id: left.metadata.revision_id,
      right_revision_id: right.metadata.revision_id,
      left_digest: canonicalInputDigest(left),
      right_digest: canonicalInputDigest(right),
      added_statement_ids: [...rightIds].filter((statementId) => !leftIds.has(statementId)),
      removed_statement_ids: [...leftIds].filter((statementId) => !rightIds.has(statementId)),
      changed_statement_ids: changed.filter((statementId) => leftIds.has(statementId) && rightIds.has(statementId)),
      selected_fact_changes: {
        added_revision_ids: right.selected_fact_revision_ids.filter((revisionId) => !left.selected_fact_revision_ids.includes(revisionId)),
        removed_revision_ids: left.selected_fact_revision_ids.filter((revisionId) => !right.selected_fact_revision_ids.includes(revisionId)),
      },
      same_parent: left.parent_definition_revision_id === right.parent_definition_revision_id,
      same_job: left.job_revision_id === right.job_revision_id,
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
    const base = this.envelope("resume_definition", randomUUID(), randomUUID(), 1, null, target.sensitivity, "durable_owner_data", authority, timestamp);
    const definition = ResumeDefinitionRecordSchema.parse({
      ...target,
      ...base,
      metadata: { ...base.metadata, extensions: target.metadata.extensions },
      extensions: target.extensions,
      parent_definition_revision_id: target.definition_kind === "general" ? target.metadata.revision_id : target.parent_definition_revision_id,
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

  async saveInterviewProgress(raw: unknown, authority: DataAuthority): Promise<{ progress: ResumeDataRecord; reused: boolean }> {
    this.authorize(authority, "resume.definitions.write");
    const input = InterviewInputSchema.parse(raw);
    const current = input.record_id ? await this.store.readHead(input.record_id, authority.grant.record_scopes) : null;
    if (current && current.record_type !== "interview_progress") throw new ResumeDomainError("not_found_within_scope", "Record was not found within the granted scope", 404);
    const timestamp = this.now().toISOString();
    const progress = InterviewProgressRecordSchema.parse({
      ...this.envelope("interview_progress", current?.metadata.record_id ?? randomUUID(), randomUUID(), current ? current.metadata.revision + 1 : 1, current?.metadata.revision_id ?? null, "sensitive", "durable_owner_data", authority, timestamp),
      status: input.status, current_topic: input.current_topic, completed_topics: input.completed_topics, skipped_topics: input.skipped_topics, draft_state: input.draft_state,
    });
    const result = await this.store.commit([progress], this.mutation(authority, input, "interview_progress", current?.metadata.record_id ?? null, current ? input.expected_revision : null));
    return { progress: result.records[0]!, reused: result.reused };
  }

  async readRecords(recordType: ResumeDataRecord["record_type"], authority: DataAuthority): Promise<ResumeDataRecord[]> {
    return this.store.list(recordType, authority.grant.record_scopes);
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
      schema_version: 1, record_type: recordType,
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

  private maxSensitivity(values: Sensitivity[]): Sensitivity {
    const rank: Record<Sensitivity, number> = { standard: 0, sensitive: 1, highly_sensitive: 2 };
    return values.reduce<Sensitivity>((current, value) => rank[value] > rank[current] ? value : current, "standard");
  }
}
