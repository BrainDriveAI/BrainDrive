import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  ArtifactRecordSchema,
  CareerFactRecordSchema,
  ExportReceiptRecordSchema,
  InterviewProgressRecordSchema,
  JobDescriptionRecordSchema,
  RequirementEvidenceSchema,
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
import { RESUME_PROMPT_POLICY_ID } from "../resume-inference/policy.js";
import { validateInferenceClaims } from "../resume-inference/validators.js";

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

const ConfirmationInputSchema = z.object({
  fact_record_id: OpaqueIdSchema,
  expected_revision: z.number().int().positive(),
  decision: z.enum(["accept", "edit_and_accept", "reject"]),
  edited_value: z.string().min(1).max(16_384).nullable(),
  review_note: z.string().max(512).nullable().default(null),
}).strict().superRefine((value, context) => {
  if ((value.decision === "edit_and_accept") !== (value.edited_value !== null)) context.addIssue({ code: "custom", message: "edited value must match edit-and-accept decision" });
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

const ExportReceiptInputSchema = z.object({ artifact_revision_id: OpaqueIdSchema, artifact_digest: Sha256DigestSchema, format: z.enum(["pdf", "docx", "html"]), outcome: z.enum(["completed", "cancelled", "failed"]), exported_at: TimestampSchema, safe_destination_label: z.string().min(1).max(256).regex(/^[^/\\]+$/) }).strict();

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

export class ResumeDomainService {
  constructor(public readonly store: ResumeDataStore, private readonly now = () => new Date()) {}

  async proposeFact(raw: unknown, authority: DataAuthority): Promise<{ source: ResumeDataRecord; fact: ResumeDataRecord; reused: boolean }> {
    this.authorize(authority, "career.facts.propose");
    const input = ProposalInputSchema.parse(raw);
    const sourceId = randomUUID();
    const sourceRevisionId = randomUUID();
    const factId = randomUUID();
    const factRevisionId = randomUUID();
    const timestamp = this.now().toISOString();
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
    });
    const result = await this.store.commit([source, fact], this.mutation(authority, input, "career_fact", null, null));
    return { source: result.records[0]!, fact: result.records[1]!, reused: result.reused };
  }

  async confirmFact(raw: unknown, authority: DataAuthority, hostOwnerConfirmed: boolean): Promise<{ fact: ResumeDataRecord; reused: boolean }> {
    this.authorize(authority, "career.facts.confirm");
    if (!hostOwnerConfirmed) throw new ResumeDomainError("denied", "Fact confirmation requires a host-mediated owner action", 403);
    const input = ConfirmationInputSchema.parse(raw);
    const current = await this.store.readHead(input.fact_record_id, authority.grant.record_scopes);
    if (current.record_type !== "career_fact") throw new ResumeDomainError("not_found_within_scope", "Record was not found within the granted scope", 404);
    if (current.metadata.revision !== input.expected_revision) throw new ResumeDomainError("conflict", "Expected fact revision is stale");
    const timestamp = this.now().toISOString();
    const next = CareerFactRecordSchema.parse({
      ...this.envelope("career_fact", current.metadata.record_id, randomUUID(), current.metadata.revision + 1, current.metadata.revision_id, current.sensitivity, "durable_owner_data", authority, timestamp),
      fact_kind: current.fact_kind,
      state: input.decision === "reject" ? "rejected" : "confirmed",
      value: input.edited_value ?? current.value,
      source_revision_ids: current.source_revision_ids,
      confirmation: { confirmation_id: randomUUID(), owner_id: authority.grant.owner_id, actor_id: authority.grant.actor_id, host_mediated: true, decision: input.decision, confirmed_at: timestamp, operation_id: authority.operationId, input_revision_id: current.metadata.revision_id },
      supersedes_fact_revision_id: current.metadata.revision_id,
      review: { reviewed_at: timestamp, review_note: input.review_note },
    });
    const result = await this.store.commit([next], this.mutation(authority, input, "career_fact", current.metadata.record_id, input.expected_revision));
    return { fact: result.records[0]!, reused: result.reused };
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
      if (parent.record_type !== "resume_definition" || parent.definition_kind !== "general" || job.record_type !== "job_description") throw new ResumeDomainError("validation_failed", "Targeted definition lineage is invalid");
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
    const approvalReport = input.status === "approved"
      ? validateInferenceClaims("general_resume_draft", { statements: input.statements }, [{ category: "confirmed_fact_snapshot", content_digest: canonicalInputDigest({ facts: factSnapshot }), schema_id: "resume.confirmed-facts.v1", schema_version: 1, data: { facts: factSnapshot } }])
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

  async approveDefinition(raw: unknown, authority: DataAuthority, hostOwnerConfirmed: boolean): Promise<{ definition: ResumeDataRecord; reused: boolean }> {
    this.authorize(authority, "resume.definitions.write");
    if (!hostOwnerConfirmed) throw new ResumeDomainError("denied", "Definition approval requires a host-mediated owner action", 403);
    const input = DefinitionApprovalInputSchema.parse(raw);
    const current = await this.store.readHead(input.definition_record_id, authority.grant.record_scopes);
    if (current.record_type !== "resume_definition") throw new ResumeDomainError("not_found_within_scope", "Definition was not found within the granted scope", 404);
    if (current.metadata.revision !== input.expected_revision) throw new ResumeDomainError("conflict", "Expected definition revision is stale");
    if (current.status === "approved") throw new ResumeDomainError("conflict", "Definition is already approved");
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
      if (parent.record_type !== "resume_definition" || parent.definition_kind !== "general" || job.record_type !== "job_description") {
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
    const result = await this.store.commit([next], this.mutation(authority, input, "resume_definition", current.metadata.record_id, input.expected_revision));
    return { definition: result.records[0]!, reused: result.reused };
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
    if (artifact.record_type !== "artifact" || artifact.artifact_digest !== input.artifact_digest || artifact.format !== input.format) throw new ResumeDomainError("validation_failed", "Export receipt does not match registered artifact lineage");
    const timestamp = this.now().toISOString();
    const receipt = ExportReceiptRecordSchema.parse({
      ...this.envelope("export_receipt", randomUUID(), randomUUID(), 1, null, artifact.sensitivity, "durable_owner_data", authority, timestamp),
      operation_id: authority.operationId, ...input,
    });
    const result = await this.store.commit([receipt], this.mutation(authority, input, "export_receipt", null, null));
    return { receipt: result.records[0]!, reused: result.reused };
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

  private authorize(authority: DataAuthority, expected: DataAuthority["capability"]): void {
    if (authority.capability !== expected || !authority.grant.capabilities.includes(expected) || authority.grant.revoked_at || Date.parse(authority.grant.expires_at) <= Date.now()) {
      throw new ResumeDomainError("denied", "Capability operation is not authorized", 403);
    }
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
