import { z } from "zod";

import { NonEmptyStringSchema, OpaqueIdSchema } from "../app-platform/contracts/common.js";
import {
  CraftCorrectionClassSchema,
  CraftEvidenceReferenceSchema,
  CraftCriterionSchema,
  EvidenceStatusSchema,
  GuidanceResultSchema,
  JobEvidenceDimensionSchema,
  RequirementKindSchema,
  ResumeHistoryShapeSchema,
  ResumeRoleBulletDensitySchema,
  ResumeStrategyOmissionReasonSchema,
  RevisionIntentClassSchema,
  TargetFitClassSchema,
} from "../app-platform/contracts/data.js";
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
    opportunity_id: OpaqueIdSchema,
    dimension: JobEvidenceDimensionSchema.exclude(["identity"]),
    opportunity_kind: z.enum(["qualitative", "metric"]),
    value_category: z.enum(["distinct_accomplishment", "decision_useful_outcome", "scope_or_scale", "tools_in_use", "progression", "core_responsibility"]),
    selection_method: z.literal("deterministic_value"),
    prompt: z.string().min(1).max(2_048),
    rationale: z.string().min(1).max(1_024),
  }).strict()).length(1),
}).strict();

export const GeneralResumeDraftResultSchema = z.object({
  title: z.string().min(1).max(256),
  statements: z.array(GeneratedStatementSchema).min(1).max(500),
  section_order: z.array(NonEmptyStringSchema).min(1).max(32),
  omissions: z.array(z.object({ fact_revision_id: OpaqueIdSchema, reason_code: ResumeStrategyOmissionReasonSchema }).strict()).max(500),
}).strict();

/** Provider-only role ownership; the host validates, flattens, and removes it before persistence. */
export const GeneralResumeDraftProviderResultSchema = GeneralResumeDraftResultSchema.pick({
  title: true,
  section_order: true,
  omissions: true,
}).extend({
  statements: z.array(GeneratedStatementSchema).max(500),
  experience_roles: z.array(z.object({
    job_fact_revision_id: OpaqueIdSchema,
    heading_statement: GeneratedStatementSchema,
    bullet_statements: z.array(GeneratedStatementSchema).max(6),
  }).strict()).max(100),
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
  plan_version: z.literal(2),
  threshold_policy_id: NonEmptyStringSchema,
  threshold_policy_version: NonEmptyStringSchema,
  fit_class: TargetFitClassSchema,
  outcome: z.enum(["targeted_variant", "no_meaningful_change"]),
  no_change_reason: z.enum(["ambiguous_evidence", "insufficient_supported_fit", "no_material_resume_change"]).nullable(),
  support_counts: z.object({ core: z.number().int().nonnegative(), transferable: z.number().int().nonnegative(), partial: z.number().int().nonnegative(), unsupported: z.number().int().nonnegative() }).strict(),
  changes: z.array(z.object({
    change_id: OpaqueIdSchema,
    requirement_id: OpaqueIdSchema,
    statement_id: OpaqueIdSchema.nullable(),
    action: z.enum(["selection", "ordering", "emphasis", "faithful_wording", "shorten"]),
    rationale: z.string().min(1).max(2_048),
    supporting_confirmed_fact_revision_ids: SupportIdsSchema.min(1),
  }).strict()).max(500),
}).strict().superRefine((value, context) => {
  if ((value.outcome === "targeted_variant") !== (value.changes.length > 0)) context.addIssue({ code: "custom", message: "tailoring outcome requires a material-change manifest" });
  if ((value.outcome === "no_meaningful_change") !== (value.no_change_reason !== null)) context.addIssue({ code: "custom", message: "no-change tailoring outcome requires one bounded reason" });
});

export const ResumeStrategyResultSchema = z.object({
  strategy_version: z.literal(1),
  history_shape: ResumeHistoryShapeSchema,
  history_reason_code: z.enum(["standard_chronology", "thin_history", "senior_compression", "career_transition", "employment_gap", "overlap_or_promotion"]),
  role_emphasis: z.array(z.object({
    job_fact_revision_id: OpaqueIdSchema,
    priority: z.enum(["primary", "supporting", "compressed"]),
    reason_code: z.enum(["recent", "relevant", "evidence_rich", "continuity", "older_context"]),
    bullet_density: ResumeRoleBulletDensitySchema,
  }).strict()).max(100),
  section_order: z.array(NonEmptyStringSchema).min(1).max(32),
  evidence_priorities: z.array(z.object({ fact_revision_id: OpaqueIdSchema, priority: z.enum(["must_use", "preferred", "context"]) }).strict()).max(500),
  summary_decision: z.enum(["include", "omit"]),
  summary_reason_code: z.enum(["supported_positioning", "insufficient_distinct_value", "redundant_with_experience"]),
  skills_context: z.array(z.object({
    skill_fact_revision_id: OpaqueIdSchema,
    placement: z.enum(["role", "project", "skills_section"]),
    context_fact_revision_ids: z.array(OpaqueIdSchema).max(16),
  }).strict()).max(100),
  omissions: z.array(z.object({ fact_revision_id: OpaqueIdSchema, reason_code: ResumeStrategyOmissionReasonSchema }).strict()).max(500),
  unresolved_gap_ids: z.array(OpaqueIdSchema).max(100),
  owner_rationale: z.string().min(1).max(1_024),
}).strict();

export const ResumeCraftEvaluateResultSchema = z.object({
  report_version: z.literal(2),
  evidence_context: z.enum(["standard", "limited"]),
  verdict: z.enum(["pass", "fail"]),
  criterion_verdicts: z.array(z.object({
    criterion: CraftCriterionSchema,
    verdict: z.enum(["pass", "fail", "not_applicable"]),
    evidence_refs: z.array(CraftEvidenceReferenceSchema).min(1).max(500),
    finding_ids: z.array(OpaqueIdSchema).max(500),
  }).strict()).length(10),
  findings: z.array(z.object({
    finding_id: OpaqueIdSchema,
    criterion: CraftCriterionSchema,
    severity: z.enum(["guidance", "blocking"]),
    correction_class: CraftCorrectionClassSchema,
    safe_message: z.string().min(1).max(512),
    evidence_ref_ids: z.array(OpaqueIdSchema).min(1).max(500),
  }).strict()).max(500),
}).strict().superRefine((value, context) => {
  const criteria = value.criterion_verdicts.map((entry) => entry.criterion);
  if (new Set(criteria).size !== CraftCriterionSchema.options.length || CraftCriterionSchema.options.some((criterion) => !criteria.includes(criterion))) context.addIssue({ code: "custom", path: ["criterion_verdicts"], message: "every craft criterion is required exactly once" });
  const allEvidence = value.criterion_verdicts.flatMap((entry) => entry.evidence_refs);
  const evidenceIds = new Set(allEvidence.map((entry) => entry.evidence_ref_id));
  if (evidenceIds.size !== allEvidence.length) context.addIssue({ code: "custom", path: ["criterion_verdicts"], message: "craft evidence identities must be unique" });
  for (const entry of value.criterion_verdicts) {
    if (entry.verdict === "pass" && !entry.evidence_refs.some((reference) => reference.polarity === "positive")) context.addIssue({ code: "custom", message: "passing craft criteria require positive evidence" });
    if (entry.verdict === "fail" && !entry.evidence_refs.some((reference) => reference.polarity === "negative" || reference.polarity === "absence")) context.addIssue({ code: "custom", message: "failing craft criteria require negative evidence or absence" });
    if (entry.verdict === "not_applicable" && !entry.evidence_refs.some((reference) => reference.kind === "explicit_absence" && reference.polarity === "absence")) context.addIssue({ code: "custom", message: "not-applicable craft criteria require explicit absence evidence" });
    if (entry.criterion.startsWith("C") && entry.verdict === "not_applicable") context.addIssue({ code: "custom", message: "general craft criteria are always applicable" });
  }
  const findingIds = new Set(value.findings.map((finding) => finding.finding_id));
  if (findingIds.size !== value.findings.length || value.criterion_verdicts.some((entry) => entry.finding_ids.some((id) => !findingIds.has(id)))) context.addIssue({ code: "custom", path: ["findings"], message: "craft finding references are invalid" });
  if (value.findings.some((finding) => finding.evidence_ref_ids.some((id) => !evidenceIds.has(id)))) context.addIssue({ code: "custom", path: ["findings"], message: "craft findings require report evidence" });
  const failed = value.criterion_verdicts.some((entry) => entry.verdict === "fail") || value.findings.some((finding) => finding.severity === "blocking");
  if ((value.verdict === "fail") !== failed) context.addIssue({ code: "custom", path: ["verdict"], message: "craft verdict and mandatory findings disagree" });
});

const CraftRepairResultBodySchema = z.object({
  source_definition_revision_id: OpaqueIdSchema,
  source_report_revision_id: OpaqueIdSchema,
  changed_statement_ids: z.array(OpaqueIdSchema).min(1).max(500),
  title: z.string().min(1).max(256),
  statements: z.array(GeneratedStatementSchema).min(1).max(500),
  section_order: z.array(NonEmptyStringSchema).min(1).max(32),
}).strict();

export const ResumeCraftRepairResultSchema = z.union([
  CraftRepairResultBodySchema.extend({ repair_version: z.literal(1) }).strict(),
  CraftRepairResultBodySchema.extend({ repair_version: z.literal(2) }).strict(),
]);

const TargetedResumeVariantResultSchema = z.object({
  parent_general_definition_revision_id: OpaqueIdSchema,
  job_revision_id: OpaqueIdSchema,
  title: z.string().min(1).max(256),
  statements: z.array(GeneratedStatementSchema).min(1).max(500),
  changed_statement_ids: z.array(OpaqueIdSchema).max(500),
  section_order: z.array(NonEmptyStringSchema).min(1).max(32),
}).strict();

const TargetedResumeNoChangeResultSchema = z.object({
  outcome: z.literal("no_meaningful_change"),
  no_change_reason: z.literal("no_material_resume_change"),
  parent_general_definition_revision_id: OpaqueIdSchema,
  job_revision_id: OpaqueIdSchema,
}).strict();

export const TargetedResumeDraftResultSchema = z.union([
  TargetedResumeVariantResultSchema,
  TargetedResumeNoChangeResultSchema,
]);

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
  resume_strategy: ResumeStrategyResultSchema,
  resume_craft_evaluate: ResumeCraftEvaluateResultSchema,
  resume_craft_repair: ResumeCraftRepairResultSchema,
} as const satisfies Record<InferencePurpose, z.ZodType>;

export function parsePurposeResult(purpose: InferencePurpose, schemaId: string, value: unknown): unknown {
  if (schemaId !== PURPOSE_OUTPUT_SCHEMAS[purpose]) throw new Error("purpose/output schema mismatch");
  return PURPOSE_RESULT_SCHEMAS[purpose].parse(value);
}

export function parseProviderPurposeResult(purpose: InferencePurpose, schemaId: string, value: unknown): unknown {
  if (schemaId !== PURPOSE_OUTPUT_SCHEMAS[purpose]) throw new Error("purpose/output schema mismatch");
  return purpose === "general_resume_draft"
    ? GeneralResumeDraftProviderResultSchema.parse(value)
    : PURPOSE_RESULT_SCHEMAS[purpose].parse(value);
}

export function purposeJsonSchema(purpose: InferencePurpose): Record<string, unknown> {
  const schema = purpose === "general_resume_draft" ? GeneralResumeDraftProviderResultSchema : PURPOSE_RESULT_SCHEMAS[purpose];
  return z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
}
