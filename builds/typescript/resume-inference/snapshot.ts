import { randomUUID } from "node:crypto";

import { z } from "zod";

import { canonicalInputDigest, encodedByteLength, OpaqueIdSchema } from "../app-platform/contracts/common.js";
import {
  InferenceDataBlockSchema,
  InferenceRequestSchema,
  InferencePurposeSchema,
  PURPOSE_LIMITS,
  PURPOSE_OUTPUT_SCHEMAS,
  type InferencePurpose,
} from "../app-platform/contracts/inference.js";
import { JobEvidenceDimensionSchema, JobEvidenceValueSchema, ResumeDefinitionRecordSchema, ResumeRevisionRequestRecordSchema } from "../app-platform/contracts/data.js";
import type { CapabilityGrant } from "../app-platform/lifecycle/store.js";
import type { ResumeDataRecord, ResumeDataStore } from "../resume-domain/store.js";
import { ResumeInferenceError } from "./errors.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "./policy.js";

export const InferenceInvocationSchema = z.object({
  inference_contract_version: z.literal(1),
  purpose: InferencePurposeSchema,
  request_id: OpaqueIdSchema.optional(),
  operation_id: OpaqueIdSchema,
  intent: z.enum(["quality", "balanced", "speed"]).default("balanced"),
  stream: z.boolean().default(true),
  budget: z.object({
    input_bytes: z.number().int().positive().optional(),
    input_tokens: z.number().int().positive().optional(),
    output_tokens: z.number().int().positive().optional(),
    duration_ms: z.number().int().positive().optional(),
    attempts: z.number().int().min(1).max(2).optional(),
  }).strict().optional(),
  fact_revision_ids: z.array(OpaqueIdSchema).max(500),
  record_revision_ids: z.array(OpaqueIdSchema).max(64).default([]),
  presentation_preferences: z.record(z.string(), z.string().max(2_048)).default({}),
  derived_blocks: z.array(z.object({
    category: z.enum(["job_analysis", "evidence_matrix", "owner_edit", "revision_instruction", "definition_comparison", "deterministic_findings", "job_evidence_summary"]),
    schema_id: z.string().min(1).max(512),
    data: z.unknown(),
  }).strict()).max(8).default([]),
}).strict();

export type InferenceInvocation = z.infer<typeof InferenceInvocationSchema>;

const JobEvidenceSummarySchema = z.object({
  active_job_fact_revision_id: OpaqueIdSchema,
  active_job_revision: z.number().int().positive(),
  requested_dimension: JobEvidenceDimensionSchema.exclude(["identity"]),
  dimensions: z.array(z.object({
    dimension: JobEvidenceDimensionSchema,
    outcome: z.enum(["answered", "skipped", "unknown", "not_applicable", "complete_for_now"]),
    evidence_revision_ids: z.array(OpaqueIdSchema).max(32),
  }).strict()).max(7),
}).strict();

function block(category: z.infer<typeof InferenceDataBlockSchema>["category"], schemaId: string, data: unknown) {
  return InferenceDataBlockSchema.parse({
    category,
    content_digest: canonicalInputDigest(data),
    schema_id: schemaId,
    schema_version: 1,
    data,
  });
}

export class ImmutableInferenceSnapshotBuilder {
  constructor(private readonly store: ResumeDataStore, private readonly now = () => new Date()) {}

  async build(raw: unknown, grant: CapabilityGrant): Promise<z.infer<typeof InferenceRequestSchema>> {
    const parsed = InferenceInvocationSchema.safeParse(raw);
    if (!parsed.success) throw new ResumeInferenceError("invalid_request", "Inference invocation failed the versioned app contract");
    const input = parsed.data;
    this.authorize(grant);
    const factRecords = await Promise.all(input.fact_revision_ids.map((id) => this.store.readRevision(id, grant.record_scopes)));
    for (const record of factRecords) {
      if (record.record_type !== "career_fact" || record.state !== "confirmed") {
        throw new ResumeInferenceError("validation_failed", "Inference snapshots may contain only confirmed fact revisions");
      }
    }
    const related = await Promise.all(input.record_revision_ids.map((id) => this.store.readRevision(id, grant.record_scopes)));
    const records = [...factRecords, ...related];
    if (new Set(records.map((record) => record.metadata.revision_id)).size !== records.length) {
      throw new ResumeInferenceError("invalid_request", "Inference snapshot contains duplicate revision identities");
    }
    const facts = factRecords.map((record) => ({
      revision_id: record.metadata.revision_id,
      fact_kind: record.record_type === "career_fact" ? record.fact_kind : "preference",
      value: record.record_type === "career_fact" ? record.value : "",
      source_revision_ids: record.record_type === "career_fact" ? record.source_revision_ids : [],
    }));
    if (input.purpose === "interview_assist") this.validateInterviewAssist(input, factRecords);
    this.validateRevisionPurpose(input.purpose, related);
    this.validateGuidancePurpose(input, related);
    const dataBlocks: Array<z.infer<typeof InferenceDataBlockSchema>> = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts })];
    if (Object.keys(input.presentation_preferences).length > 0) {
      dataBlocks.push(block("presentation_preferences", "resume.presentation-preferences.v1", input.presentation_preferences));
    }
    for (const record of related) dataBlocks.push(this.recordBlock(record));
    for (const derived of input.derived_blocks) dataBlocks.push(block(derived.category, derived.schema_id, derived.data));
    const ceiling = PURPOSE_LIMITS[input.purpose];
    const limits = {
      input_bytes: Math.min(ceiling.input_bytes, input.budget?.input_bytes ?? ceiling.input_bytes),
      input_tokens: Math.min(ceiling.input_tokens, input.budget?.input_tokens ?? ceiling.input_tokens),
      output_tokens: Math.min(ceiling.output_tokens, input.budget?.output_tokens ?? ceiling.output_tokens),
      duration_ms: Math.min(ceiling.duration_ms, input.budget?.duration_ms ?? ceiling.duration_ms),
      attempts: Math.min(ceiling.attempts, input.budget?.attempts ?? ceiling.attempts),
      concurrency: 1 as const,
    };
    if (encodedByteLength(dataBlocks) > limits.input_bytes) {
      throw new ResumeInferenceError("invalid_request", "Inference snapshot exceeds the purpose byte budget");
    }
    const requestedAt = this.now();
    const request = InferenceRequestSchema.parse({
      inference_schema_version: 1,
      request_id: input.request_id ?? randomUUID(),
      owner_id: grant.owner_id,
      actor_id: grant.actor_id,
      app_id: grant.app_id,
      installation_id: grant.installation_id,
      operation_id: input.operation_id,
      grant_id: grant.grant_id,
      purpose: input.purpose,
      input_snapshot: {
        fact_snapshot_revision: Math.max(1, ...(factRecords.map((record) => record.metadata.revision))),
        fact_snapshot_digest: canonicalInputDigest(facts),
        record_revision_ids: records.map((record) => record.metadata.revision_id),
      },
      data_blocks: dataBlocks,
      prompt_policy_id: RESUME_PROMPT_POLICY_ID,
      prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
      output_schema_id: PURPOSE_OUTPUT_SCHEMAS[input.purpose],
      output_schema_version: 1,
      capability_requirements: {
        text_generation: true,
        complete_structured_json: true,
        minimum_context_tokens: limits.input_tokens,
        model_tools: false,
      },
      limits,
      requested_at: requestedAt.toISOString(),
      deadline_at: new Date(requestedAt.getTime() + limits.duration_ms).toISOString(),
    });
    return request;
  }

  private authorize(grant: CapabilityGrant): void {
    if (!grant.capabilities.includes("app.inference.request") || grant.revoked_at || Date.parse(grant.expires_at) <= Date.now()) {
      throw new ResumeInferenceError("denied", "Inference capability is not authorized");
    }
  }

  private validateInterviewAssist(input: InferenceInvocation, factRecords: ResumeDataRecord[]): void {
    const candidates = input.derived_blocks.filter((candidate) => candidate.category === "job_evidence_summary");
    if (candidates.length !== 1 || candidates[0]?.schema_id !== "resume.job-evidence-summary.v1") {
      throw new ResumeInferenceError("invalid_request", "Interview assistance requires one active-job evidence summary");
    }
    const summary = JobEvidenceSummarySchema.parse(candidates[0].data);
    const byRevision = new Map(factRecords.map((record) => [record.metadata.revision_id, record]));
    const activeJob = byRevision.get(summary.active_job_fact_revision_id);
    if (
      activeJob?.record_type !== "career_fact" || activeJob.fact_kind !== "employment" || activeJob.state !== "confirmed" ||
      activeJob.metadata.revision !== summary.active_job_revision
    ) {
      throw new ResumeInferenceError("validation_failed", "Interview assistance active job does not match the confirmed snapshot");
    }
    for (const dimension of summary.dimensions) {
      for (const revisionId of dimension.evidence_revision_ids) {
        const record = byRevision.get(revisionId);
        if (!record || record.record_type !== "career_fact" || record.state !== "confirmed") {
          throw new ResumeInferenceError("validation_failed", "Interview evidence summary cites an unavailable confirmed revision");
        }
        if (record.fact_kind === "job_evidence") {
          const evidence = JobEvidenceValueSchema.parse(JSON.parse(record.value));
          if (evidence.association !== "job" || evidence.job_fact_revision_id !== summary.active_job_fact_revision_id || evidence.dimension !== dimension.dimension || evidence.outcome !== dimension.outcome) {
            throw new ResumeInferenceError("validation_failed", "Interview evidence summary does not match the active job evidence");
          }
        } else if (record.metadata.revision_id !== summary.active_job_fact_revision_id || dimension.dimension !== "responsibilities") {
          throw new ResumeInferenceError("validation_failed", "Interview evidence summary contains a cross-job or mismatched revision");
        }
      }
    }
  }

  private recordBlock(record: ResumeDataRecord): z.infer<typeof InferenceDataBlockSchema> {
    switch (record.record_type) {
      case "resume_definition":
        return block("general_resume_definition", "resume.definition.v1", record);
      case "job_description":
        return block("job_description", "resume.job-description.v1", record);
      case "tailored_variant":
        return block("evidence_matrix", "resume.requirement-evidence.v1", record.evidence_matrix);
      case "resume_revision_request":
        return block("revision_instruction", "resume.revision-request.v1", record);
      default:
        throw new ResumeInferenceError("invalid_request", "Record type is not allowed in an inference snapshot");
    }
  }

  private validateRevisionPurpose(purpose: InferencePurpose, related: ResumeDataRecord[]): void {
    if (purpose !== "resume_revision_classify" && purpose !== "resume_revision_draft") {
      if (related.some((record) => record.record_type === "resume_revision_request")) {
        throw new ResumeInferenceError("invalid_request", "Revision instructions are allowed only for revision purposes");
      }
      return;
    }
    const definitions = related.filter((record) => record.record_type === "resume_definition").map((record) => ResumeDefinitionRecordSchema.parse(record));
    const requests = related.filter((record) => record.record_type === "resume_revision_request").map((record) => ResumeRevisionRequestRecordSchema.parse(record));
    if (definitions.length !== 1 || requests.length !== 1 || related.length !== 2) {
      throw new ResumeInferenceError("invalid_request", "Revision inference requires one immutable source and one persisted request");
    }
    const source = definitions[0]!;
    const request = requests[0]!;
    if (request.source_definition_revision_id !== source.metadata.revision_id) {
      throw new ResumeInferenceError("validation_failed", "Revision request source does not match the immutable definition");
    }
    if (purpose === "resume_revision_classify" && request.state !== "submitted") {
      throw new ResumeInferenceError("validation_failed", "Revision classification requires a newly submitted request");
    }
    if (purpose === "resume_revision_draft" && (request.state !== "generating" || request.classification === null || request.classification === "ambiguous")) {
      throw new ResumeInferenceError("validation_failed", "Revision drafting requires an authorized non-ambiguous generating request");
    }
  }

  private validateGuidancePurpose(input: InferenceInvocation, related: ResumeDataRecord[]): void {
    if (input.purpose !== "resume_guidance") return;
    const definitions = related.filter((record) => record.record_type === "resume_definition");
    if (definitions.length !== 1 || related.length !== 1) {
      throw new ResumeInferenceError("invalid_request", "Resume guidance requires exactly one selected resume definition");
    }
    const findings = input.derived_blocks.filter((candidate) => candidate.category === "deterministic_findings");
    if (findings.length !== 1 || findings[0]?.schema_id !== "resume.quality-findings.v1") {
      throw new ResumeInferenceError("invalid_request", "Resume guidance requires one deterministic findings block");
    }
    if (input.derived_blocks.some((candidate) => !["deterministic_findings", "job_evidence_summary"].includes(candidate.category))) {
      throw new ResumeInferenceError("invalid_request", "Resume guidance contains a block outside its purpose-minimum contract");
    }
  }
}

export function snapshotPurpose(raw: unknown): InferencePurpose {
  return InferenceInvocationSchema.shape.purpose.parse((raw as { purpose?: unknown } | null)?.purpose);
}
