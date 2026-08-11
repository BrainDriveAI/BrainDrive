import { z } from "zod";

import { NonEmptyStringSchema, OpaqueIdSchema } from "../app-platform/contracts/common.js";
import { EvidenceStatusSchema, GuidanceResultSchema, JobEvidenceDimensionSchema, RequirementKindSchema, RevisionIntentClassSchema } from "../app-platform/contracts/data.js";
import { type InferencePurpose, PURPOSE_OUTPUT_SCHEMAS } from "../app-platform/contracts/inference.js";

const SupportIdsSchema = z.array(OpaqueIdSchema).max(32);

export const GeneratedStatementSchema = z.object({
  statement_id: OpaqueIdSchema,
  section_id: NonEmptyStringSchema.default("experience"),
  kind: z.enum(["factual", "presentation"]),
  display_role: z.enum(["heading", "bullet", "line"]).optional(),
  text: z.string().min(1).max(8_192),
  supporting_confirmed_fact_revision_ids: SupportIdsSchema,
}).strict().superRefine((value, context) => {
  if (value.kind === "factual" && value.supporting_confirmed_fact_revision_ids.length === 0) {
    context.addIssue({ code: "custom", message: "factual statements require confirmed support" });
  }
});

export const InterviewAssistResultSchema = z.object({
  questions: z.array(z.object({
    question_id: OpaqueIdSchema,
    job_fact_revision_id: OpaqueIdSchema,
    dimension: JobEvidenceDimensionSchema.exclude(["identity"]),
    selection_method: z.literal("broker_ranked"),
    prompt: z.string().min(1).max(2_048),
    rationale: z.string().min(1).max(1_024),
  }).strict()).length(1),
}).strict();

export const GeneralResumeDraftResultSchema = z.object({
  title: z.string().min(1).max(256),
  statements: z.array(GeneratedStatementSchema).min(1).max(500),
  section_order: z.array(NonEmptyStringSchema).min(1).max(32),
}).strict();

export const JobDescriptionAnalyzeResultSchema = z.object({
  requirements: z.array(z.object({
    requirement_id: OpaqueIdSchema,
    requirement_kind: RequirementKindSchema,
    source_span: z.string().min(1).max(4_096).nullable(),
    inferred: z.boolean(),
    normalized_requirement: z.string().min(1).max(4_096),
  }).strict().superRefine((value, context) => {
    if (value.inferred !== (value.requirement_kind === "inferred")) context.addIssue({ code: "custom", message: "inferred flag mismatch" });
    if (!value.inferred && value.source_span === null) context.addIssue({ code: "custom", message: "stated requirement needs a source span" });
  })).min(1).max(250),
}).strict();

export const RequirementEvidenceMatchResultSchema = z.object({
  evidence: z.array(z.object({
    requirement_id: OpaqueIdSchema,
    evidence_status: EvidenceStatusSchema,
    supporting_confirmed_fact_revision_ids: SupportIdsSchema,
    explanation: z.string().min(1).max(4_096),
    clarification: z.string().max(4_096).nullable(),
  }).strict().superRefine((value, context) => {
    if (value.evidence_status === "supported" && value.supporting_confirmed_fact_revision_ids.length === 0) context.addIssue({ code: "custom", message: "supported evidence needs confirmed facts" });
    if (value.evidence_status === "unsupported" && value.supporting_confirmed_fact_revision_ids.length > 0) context.addIssue({ code: "custom", message: "unsupported evidence cannot cite facts" });
  })).min(1).max(250),
}).strict();

export const TailoringPlanResultSchema = z.object({
  changes: z.array(z.object({
    change_id: OpaqueIdSchema,
    statement_id: OpaqueIdSchema.nullable(),
    action: z.enum(["retain", "reorder", "rewrite", "omit", "clarify"]),
    rationale: z.string().min(1).max(2_048),
    supporting_confirmed_fact_revision_ids: SupportIdsSchema,
  }).strict()).min(1).max(500),
}).strict();

export const TargetedResumeDraftResultSchema = z.object({
  parent_general_definition_revision_id: OpaqueIdSchema,
  job_revision_id: OpaqueIdSchema,
  title: z.string().min(1).max(256),
  statements: z.array(GeneratedStatementSchema).min(1).max(500),
  changed_statement_ids: z.array(OpaqueIdSchema).max(500),
  section_order: z.array(NonEmptyStringSchema).min(1).max(32),
}).strict();

export const ResumeRevisionClassifyResultSchema = z.object({
  classification: RevisionIntentClassSchema,
  target: z.object({ scope: z.enum(["statement", "section", "resume"]), target_id: z.string().min(1).max(256).nullable() }).strict(),
  clarification: z.string().min(1).max(2_048).nullable(),
  proposed_fact_changes: z.array(z.object({
    fact_revision_id: OpaqueIdSchema.nullable(),
    change_kind: z.enum(["add", "correct", "remove"]),
    owner_visible_summary: z.string().min(1).max(1_024),
  }).strict()).max(25),
}).strict().superRefine((value, context) => {
  if ((value.classification === "ambiguous") !== (value.clarification !== null)) context.addIssue({ code: "custom", message: "only ambiguous revisions require clarification" });
  if (value.classification === "presentation" && value.proposed_fact_changes.length > 0) context.addIssue({ code: "custom", message: "presentation revisions cannot propose fact changes" });
});

export const ResumeRevisionDraftResultSchema = z.object({
  source_definition_revision_id: OpaqueIdSchema,
  revision_request_revision_id: OpaqueIdSchema,
  title: z.string().min(1).max(256),
  statements: z.array(GeneratedStatementSchema).min(1).max(500),
  section_order: z.array(NonEmptyStringSchema).min(1).max(32),
  changed_statement_ids: z.array(OpaqueIdSchema).max(500),
}).strict();

export const ResumeGuidanceResultSchema = GuidanceResultSchema;

export const PURPOSE_RESULT_SCHEMAS = {
  interview_assist: InterviewAssistResultSchema,
  general_resume_draft: GeneralResumeDraftResultSchema,
  job_description_analyze: JobDescriptionAnalyzeResultSchema,
  requirement_evidence_match: RequirementEvidenceMatchResultSchema,
  tailoring_plan: TailoringPlanResultSchema,
  targeted_resume_draft: TargetedResumeDraftResultSchema,
  resume_revision_classify: ResumeRevisionClassifyResultSchema,
  resume_revision_draft: ResumeRevisionDraftResultSchema,
  resume_guidance: ResumeGuidanceResultSchema,
} as const satisfies Record<InferencePurpose, z.ZodType>;

export function parsePurposeResult(purpose: InferencePurpose, schemaId: string, value: unknown): unknown {
  if (schemaId !== PURPOSE_OUTPUT_SCHEMAS[purpose]) throw new Error("purpose/output schema mismatch");
  return PURPOSE_RESULT_SCHEMAS[purpose].parse(value);
}

export function purposeJsonSchema(purpose: InferencePurpose): Record<string, unknown> {
  return z.toJSONSchema(PURPOSE_RESULT_SCHEMAS[purpose], { target: "draft-7" }) as Record<string, unknown>;
}
