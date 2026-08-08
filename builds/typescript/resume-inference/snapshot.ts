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
import type { CapabilityGrant } from "../app-platform/lifecycle/store.js";
import type { ResumeDataRecord, ResumeDataStore } from "../resume-domain/store.js";
import { ResumeInferenceError } from "./errors.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "./policy.js";

export const InferenceInvocationSchema = z.object({
  purpose: InferencePurposeSchema,
  request_id: OpaqueIdSchema.optional(),
  operation_id: OpaqueIdSchema,
  fact_revision_ids: z.array(OpaqueIdSchema).max(500),
  record_revision_ids: z.array(OpaqueIdSchema).max(64).default([]),
  presentation_preferences: z.record(z.string(), z.string().max(2_048)).default({}),
  derived_blocks: z.array(z.object({
    category: z.enum(["job_analysis", "evidence_matrix", "owner_edit"]),
    schema_id: z.string().min(1).max(512),
    data: z.unknown(),
  }).strict()).max(8).default([]),
}).strict();

export type InferenceInvocation = z.infer<typeof InferenceInvocationSchema>;

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
    const input = InferenceInvocationSchema.parse(raw);
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
    const dataBlocks: Array<z.infer<typeof InferenceDataBlockSchema>> = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts })];
    if (Object.keys(input.presentation_preferences).length > 0) {
      dataBlocks.push(block("presentation_preferences", "resume.presentation-preferences.v1", input.presentation_preferences));
    }
    for (const record of related) dataBlocks.push(this.recordBlock(record));
    for (const derived of input.derived_blocks) dataBlocks.push(block(derived.category, derived.schema_id, derived.data));
    const ceiling = PURPOSE_LIMITS[input.purpose];
    if (encodedByteLength(dataBlocks) > ceiling.input_bytes) {
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
        minimum_context_tokens: ceiling.input_tokens,
        model_tools: false,
      },
      limits: ceiling,
      requested_at: requestedAt.toISOString(),
      deadline_at: new Date(requestedAt.getTime() + ceiling.duration_ms).toISOString(),
    });
    return request;
  }

  private authorize(grant: CapabilityGrant): void {
    if (!grant.capabilities.includes("app.inference.request") || grant.revoked_at || Date.parse(grant.expires_at) <= Date.now()) {
      throw new ResumeInferenceError("denied", "Inference capability is not authorized");
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
      default:
        throw new ResumeInferenceError("invalid_request", "Record type is not allowed in an inference snapshot");
    }
  }
}

export function snapshotPurpose(raw: unknown): InferencePurpose {
  return InferenceInvocationSchema.shape.purpose.parse((raw as { purpose?: unknown } | null)?.purpose);
}
