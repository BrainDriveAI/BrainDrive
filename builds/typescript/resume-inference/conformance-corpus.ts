import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import type { InferencePurpose } from "../app-platform/contracts/inference.js";

const CONTACT_ID = "73000000-0000-4000-8000-000000000001";
const JOB_ONE_ID = "73000000-0000-4000-8000-000000000002";
const ACCOMPLISHMENT_ID = "73000000-0000-4000-8000-000000000003";
const SKILL_ID = "73000000-0000-4000-8000-000000000004";
const DEFINITION_ID = "73000000-0000-4000-8000-000000000005";
const JOB_DESCRIPTION_ID = "73000000-0000-4000-8000-000000000006";
const REQUIREMENT_ID = "73000000-0000-4000-8000-000000000007";

const facts = [
  { revision_id: CONTACT_ID, fact_kind: "contact", value: "Jordan Lee | Dayton, Ohio | jordan.lee@example.test | 555-010-0100", source_revision_ids: ["73000000-0000-4000-8000-000000000011"] },
  { revision_id: JOB_ONE_ID, fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "Operations Coordinator", employer: "Northstar Health", location: "Dayton, Ohio", start_date: "March 2022", end_date: "Present", responsibilities: "Coordinate schedules for 25 staff across 4 sites, maintain records, and support office operations." }), source_revision_ids: ["73000000-0000-4000-8000-000000000012"] },
  { revision_id: ACCOMPLISHMENT_ID, fact_kind: "accomplishment", value: JSON.stringify({ format: "resume_accomplishment_v1", job_fact_revision_id: JOB_ONE_ID, text: "Standardized the intake process and reduced incomplete forms from 18% to 6%." }), source_revision_ids: ["73000000-0000-4000-8000-000000000013"] },
  { revision_id: SKILL_ID, fact_kind: "skill", value: "Staff scheduling, Microsoft Excel, records management, employee training", source_revision_ids: ["73000000-0000-4000-8000-000000000014"] },
];

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

type ConformanceBlockCategory = "confirmed_fact_snapshot" | "job_description" | "general_resume_definition" | "job_analysis" | "evidence_matrix";

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
  const blocks = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts })];
  if (["job_description_analyze", "targeted_resume_draft"].includes(purpose)) blocks.push(block("job_description", "resume.job-description.v1", jobDescription));
  if (["tailoring_plan", "targeted_resume_draft"].includes(purpose)) blocks.push(block("general_resume_definition", "resume.definition.v1", generalDefinition));
  if (purpose === "requirement_evidence_match") blocks.push(block("job_analysis", "resume.job-analysis.v1", jobAnalysis));
  if (["tailoring_plan", "targeted_resume_draft"].includes(purpose)) blocks.push(block("evidence_matrix", "resume.requirement-evidence.v1", evidenceMatrix));
  return blocks;
}
