import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import type { InferencePurpose } from "../app-platform/contracts/inference.js";

const CONTACT_ID = "73000000-0000-4000-8000-000000000001";
const JOB_ONE_ID = "73000000-0000-4000-8000-000000000002";
const ACCOMPLISHMENT_ID = "73000000-0000-4000-8000-000000000003";
const SKILL_ID = "73000000-0000-4000-8000-000000000004";
const DEFINITION_ID = "73000000-0000-4000-8000-000000000005";
const JOB_DESCRIPTION_ID = "73000000-0000-4000-8000-000000000006";
const REQUIREMENT_ID = "73000000-0000-4000-8000-000000000007";
const JOB_EVIDENCE_ID = "73000000-0000-4000-8000-000000000008";
const REVISION_REQUEST_ID = "73000000-0000-4000-8000-000000000009";

const facts = [
  { revision_id: CONTACT_ID, fact_kind: "contact", value: "Jordan Lee | Dayton, Ohio | jordan.lee@example.test | 555-010-0100", source_revision_ids: ["73000000-0000-4000-8000-000000000011"] },
  { revision_id: JOB_ONE_ID, fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "Operations Coordinator", employer: "Northstar Health", location: "Dayton, Ohio", start_date: "March 2022", end_date: "Present", responsibilities: "Coordinate schedules for 25 staff across 4 sites, maintain records, and support office operations." }), source_revision_ids: ["73000000-0000-4000-8000-000000000012"] },
  { revision_id: ACCOMPLISHMENT_ID, fact_kind: "accomplishment", value: JSON.stringify({ format: "resume_accomplishment_v1", job_fact_revision_id: JOB_ONE_ID, text: "Standardized the intake process and reduced incomplete forms from 18% to 6%." }), source_revision_ids: ["73000000-0000-4000-8000-000000000013"] },
  { revision_id: SKILL_ID, fact_kind: "skill", value: "Staff scheduling, Microsoft Excel, records management, employee training", source_revision_ids: ["73000000-0000-4000-8000-000000000014"] },
];

const jobEvidenceFact = {
  revision_id: JOB_EVIDENCE_ID,
  fact_kind: "job_evidence",
  value: JSON.stringify({ value_version: 1, association: "job", job_fact_revision_id: JOB_ONE_ID, dimension: "tools", outcome: "answered", owner_text: "Used Microsoft Excel to maintain scheduling and intake records." }),
  source_revision_ids: ["73000000-0000-4000-8000-000000000015"],
};

const jobEvidenceSummary = {
  active_job_fact_revision_id: JOB_ONE_ID,
  active_job_revision: 1,
  requested_dimension: "outcomes",
  dimensions: [
    { dimension: "responsibilities", outcome: "answered", evidence_revision_ids: [JOB_ONE_ID] },
    { dimension: "accomplishments", outcome: "answered", evidence_revision_ids: [ACCOMPLISHMENT_ID] },
    { dimension: "tools", outcome: "answered", evidence_revision_ids: [JOB_EVIDENCE_ID] },
  ],
};

const generalDefinition = {
  metadata: { revision_id: DEFINITION_ID },
  title: "Jordan Lee",
  statements: [
    { statement_id: "73000000-0000-4000-8000-000000000021", section_id: "contact", kind: "factual", text: "Jordan Lee | Dayton, Ohio | jordan.lee@example.test | 555-010-0100", supporting_confirmed_fact_revision_ids: [CONTACT_ID] },
    { statement_id: "73000000-0000-4000-8000-000000000022", section_id: "summary", kind: "factual", text: "Operations Coordinator with experience coordinating schedules across multiple sites, maintaining records, and supporting office operations.", supporting_confirmed_fact_revision_ids: [JOB_ONE_ID] },
    { statement_id: "73000000-0000-4000-8000-000000000023", section_id: "experience", kind: "factual", text: "Operations Coordinator, Northstar Health, Dayton, Ohio, March 2022 - Present", supporting_confirmed_fact_revision_ids: [JOB_ONE_ID] },
    { statement_id: "73000000-0000-4000-8000-000000000024", section_id: "experience", kind: "factual", text: "Standardized the intake process and reduced incomplete forms from 18% to 6%.", supporting_confirmed_fact_revision_ids: [ACCOMPLISHMENT_ID] },
  ],
  section_order: ["contact", "summary", "experience"],
};

const jobDescription = {
  metadata: { revision_id: JOB_DESCRIPTION_ID },
  description_text: "Coordinate staff schedules across multiple locations. Improve office processes and maintain accurate records.",
};

const jobAnalysis = { requirements: [{ requirement_id: REQUIREMENT_ID, requirement_kind: "responsibility", source_span: "Coordinate staff schedules across multiple locations.", inferred: false, normalized_requirement: "Coordinate staff schedules across multiple locations" }] };
const evidenceMatrix = [{ requirement_id: REQUIREMENT_ID, requirement_kind: "responsibility", evidence_status: "supported", source_span: "Coordinate staff schedules across multiple locations.", inferred: false, supporting_confirmed_fact_revision_ids: [JOB_ONE_ID], clarification: null }];

function revisionRequest(state: "submitted" | "generating") {
  const requestText = "Shorten the summary without changing facts.";
  return {
    metadata: { revision_id: REVISION_REQUEST_ID },
    source_definition_revision_id: DEFINITION_ID,
    target: { scope: "statement", target_id: "73000000-0000-4000-8000-000000000022" },
    request_text: requestText,
    request_digest: canonicalInputDigest(requestText),
    classification: state === "generating" ? "presentation" : null,
    state,
  };
}

type ConformanceBlockCategory = "confirmed_fact_snapshot" | "job_description" | "general_resume_definition" | "job_analysis" | "evidence_matrix" | "job_evidence_summary" | "revision_instruction";

function block(category: ConformanceBlockCategory, schemaId: string, data: unknown) {
  return { category, content_digest: canonicalInputDigest(data), schema_id: schemaId, schema_version: 1 as const, data };
}

export const RESUME_MODEL_CONFORMANCE_CORPUS_VERSION = 1 as const;
export const RESUME_MODEL_CONFORMANCE_CORPUS_DIGEST = canonicalInputDigest({
  corpus_version: RESUME_MODEL_CONFORMANCE_CORPUS_VERSION,
  facts,
  generalDefinition,
  jobDescription,
  jobAnalysis,
  evidenceMatrix,
});

export function conformanceBlocks(purpose: InferencePurpose) {
  const changedM3Purpose = ["interview_assist", "general_resume_draft", "targeted_resume_draft"].includes(purpose);
  const purposeFacts = purpose === "interview_assist"
    ? [facts[1], facts[2], jobEvidenceFact]
    : changedM3Purpose
      ? [...facts, jobEvidenceFact]
      : facts;
  const blocks = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts: purposeFacts })];
  if (purpose === "interview_assist") blocks.push(block("job_evidence_summary", "resume.job-evidence-summary.v1", jobEvidenceSummary));
  if (["job_description_analyze", "targeted_resume_draft"].includes(purpose)) blocks.push(block("job_description", "resume.job-description.v1", jobDescription));
  if (["tailoring_plan", "targeted_resume_draft"].includes(purpose)) blocks.push(block("general_resume_definition", "resume.definition.v1", generalDefinition));
  if (purpose === "requirement_evidence_match") blocks.push(block("job_analysis", "resume.job-analysis.v1", jobAnalysis));
  if (["tailoring_plan", "targeted_resume_draft"].includes(purpose)) blocks.push(block("evidence_matrix", "resume.requirement-evidence.v1", evidenceMatrix));
  if (["resume_revision_classify", "resume_revision_draft"].includes(purpose)) {
    blocks.push(block("general_resume_definition", "resume.definition.v1", generalDefinition));
    blocks.push(block("revision_instruction", "resume.revision-request.v1", revisionRequest(purpose === "resume_revision_draft" ? "generating" : "submitted")));
  }
  return blocks;
}

export function conformanceCorpusDigest(purpose: InferencePurpose): string {
  if (["job_description_analyze", "requirement_evidence_match", "tailoring_plan"].includes(purpose)) {
    return RESUME_MODEL_CONFORMANCE_CORPUS_DIGEST;
  }
  return canonicalInputDigest({ corpus_version: RESUME_MODEL_CONFORMANCE_CORPUS_VERSION, purpose, blocks: conformanceBlocks(purpose) });
}
