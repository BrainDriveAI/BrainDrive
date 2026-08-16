import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import type { InferencePurpose } from "../app-platform/contracts/inference.js";
import { CRAFT_EVIDENCE_LIMITED_POLICY, PRODUCT_CRAFT_EVALUATOR, evaluateCraftProposal, extractCraftAnchorEvidence, type CraftEvaluationContext } from "./craft-evaluator.js";
import { CORRECTED_CRAFT_REPORT_SCHEMA_DIGEST, CORRECTED_CRAFT_REPORT_SCHEMA_ID, CORRECTED_PROMPT_POLICY_DIGEST } from "./quality-evaluation.js";
import {
  RESUME_DIALOGUE_PROMPT_POLICY_ID,
  RESUME_DIALOGUE_PROMPT_POLICY_VERSION,
  RESUME_EXTRACTION_PROMPT_POLICY_ID,
  RESUME_EXTRACTION_PROMPT_POLICY_VERSION,
  RESUME_PROMPT_POLICY_ID,
  RESUME_PROMPT_POLICY_VERSION,
} from "./policy.js";
import { RESUME_QUALITY_POLICY_IDENTITY, buildEvidenceAnnotations } from "./strategy.js";
import { TARGET_FIT_THRESHOLD_POLICY } from "./target-fit.js";
import { RESUME_HOST_ASSISTANCE_POLICY_DIGEST } from "./host-assistance.js";

const CONTACT_ID = "73000000-0000-4000-8000-000000000001";
const JOB_ONE_ID = "73000000-0000-4000-8000-000000000002";
const ACCOMPLISHMENT_ID = "73000000-0000-4000-8000-000000000003";
const SKILL_ID = "73000000-0000-4000-8000-000000000004";
const DEFINITION_ID = "73000000-0000-4000-8000-000000000005";
const JOB_DESCRIPTION_ID = "73000000-0000-4000-8000-000000000006";
const REQUIREMENT_ID = "73000000-0000-4000-8000-000000000007";
const JOB_EVIDENCE_ID = "73000000-0000-4000-8000-000000000008";
const REVISION_REQUEST_ID = "73000000-0000-4000-8000-000000000009";
const OPPORTUNITY_ID = "73000000-0000-4000-8000-000000000010";
const CRAFT_FACT_ID = "73000000-0000-4000-8000-000000000016";
const CRAFT_DEFINITION_ID = "73000000-0000-4000-8000-000000000017";
const CRAFT_REPORT_ID = "73000000-0000-4000-8000-000000000018";

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
  requested_opportunity_id: OPPORTUNITY_ID,
  requested_dimension: "outcomes",
  opportunity_kind: "qualitative",
  value_category: "decision_useful_outcome",
  dimensions: [
    { dimension: "responsibilities", outcome: "answered", evidence_revision_ids: [JOB_ONE_ID] },
    { dimension: "accomplishments", outcome: "answered", evidence_revision_ids: [ACCOMPLISHMENT_ID] },
    { dimension: "tools", outcome: "answered", evidence_revision_ids: [JOB_EVIDENCE_ID] },
  ],
};

const generalDefinition = {
  metadata: { revision_id: DEFINITION_ID },
  definition_kind: "general",
  title: "Jordan Lee",
  statements: [
    { statement_id: "73000000-0000-4000-8000-000000000021", section_id: "contact", kind: "factual", text: "Jordan Lee | Dayton, Ohio | jordan.lee@example.test | 555-010-0100", supporting_confirmed_fact_revision_ids: [CONTACT_ID] },
    { statement_id: "73000000-0000-4000-8000-000000000022", section_id: "summary", kind: "factual", text: "Operations Coordinator with experience coordinating schedules across multiple sites, maintaining records, and supporting office operations.", supporting_confirmed_fact_revision_ids: [JOB_ONE_ID] },
    { statement_id: "73000000-0000-4000-8000-000000000023", section_id: "experience", kind: "factual", text: "Operations Coordinator, Northstar Health, Dayton, Ohio, March 2022 - Present", supporting_confirmed_fact_revision_ids: [JOB_ONE_ID] },
    { statement_id: "73000000-0000-4000-8000-000000000024", section_id: "experience", kind: "factual", text: "Standardized the intake process and reduced incomplete forms from 18% to 6%.", supporting_confirmed_fact_revision_ids: [ACCOMPLISHMENT_ID] },
  ],
  section_order: ["contact", "summary", "experience"],
  selected_fact_revision_ids: [CONTACT_ID, JOB_ONE_ID, ACCOMPLISHMENT_ID],
};

const conformanceStrategy = {
  metadata: { revision_id: "73000000-0000-4000-8000-000000000019" },
  history_shape: "chronological_standard",
  summary_decision: "include",
  section_order: ["contact", "summary", "experience"],
  evidence_priorities: [
    { fact_revision_id: CONTACT_ID, priority: "context" },
    { fact_revision_id: JOB_ONE_ID, priority: "must_use" },
    { fact_revision_id: ACCOMPLISHMENT_ID, priority: "must_use" },
    { fact_revision_id: SKILL_ID, priority: "preferred" },
    { fact_revision_id: JOB_EVIDENCE_ID, priority: "preferred" },
  ],
  omissions: [
    { fact_revision_id: SKILL_ID, reason_code: "redundant" },
    { fact_revision_id: JOB_EVIDENCE_ID, reason_code: "redundant" },
  ],
  unresolved_gap_ids: [],
};

const targetAnalysis = {
  metadata: { revision_id: "73000000-0000-4000-8000-000000000020" },
  outcome: "targeted_variant",
  analysis_state: "ready_for_targeted_draft",
  fit_class: "meaningfully_supported",
  parent_general_definition_revision_id: DEFINITION_ID,
  job_revision_id: JOB_DESCRIPTION_ID,
  material_changes: [{
    statement_id: "73000000-0000-4000-8000-000000000024",
    requirement_id: REQUIREMENT_ID,
    supporting_confirmed_fact_revision_ids: [ACCOMPLISHMENT_ID],
    action: "emphasis",
  }],
};

const craftFact = {
  revision_id: CRAFT_FACT_ID,
  fact_kind: "accomplishment",
  value: "Responsible for weekly schedules; coordinated weekly schedules across three teams.",
  source_revision_ids: ["73000000-0000-4000-8000-000000000025"],
};

const craftDefinition = {
  metadata: { revision_id: CRAFT_DEFINITION_ID },
  definition_kind: "general" as const,
  title: "Jordan Lee",
  statements: [
    { statement_id: "73000000-0000-4000-8000-000000000026", section_id: "experience", display_role: "heading" as const, kind: "factual" as const, text: "Operations Coordinator, Northstar Health, March 2022 - Present", supporting_confirmed_fact_revision_ids: [JOB_ONE_ID] },
    { statement_id: "73000000-0000-4000-8000-000000000027", section_id: "experience", display_role: "bullet" as const, kind: "factual" as const, text: "Responsible for weekly schedules.", supporting_confirmed_fact_revision_ids: [CRAFT_FACT_ID] },
  ],
  section_order: ["experience"],
  selected_fact_revision_ids: [JOB_ONE_ID, CRAFT_FACT_ID],
};

const craftStrategy = {
  ...conformanceStrategy,
  metadata: { revision_id: "73000000-0000-4000-8000-000000000028" },
  fact_revision_ids: [JOB_ONE_ID, CRAFT_FACT_ID],
  coverage_revision_ids: [],
  summary_decision: "omit",
  section_order: ["experience"],
  evidence_priorities: [{ fact_revision_id: JOB_ONE_ID, priority: "context" }, { fact_revision_id: CRAFT_FACT_ID, priority: "must_use" }],
  omissions: [],
};

const craftContext: CraftEvaluationContext = {
  definition_revision_id: CRAFT_DEFINITION_ID,
  strategy_revision_id: craftStrategy.metadata.revision_id,
  definition_kind: craftDefinition.definition_kind,
  title: craftDefinition.title,
  statements: craftDefinition.statements,
  section_order: craftDefinition.section_order,
  selected_fact_revision_ids: craftDefinition.selected_fact_revision_ids,
  fact_revision_ids: [JOB_ONE_ID, CRAFT_FACT_ID],
  coverage_revision_ids: [],
  strategy: {
    history_shape: craftStrategy.history_shape,
    summary_decision: "omit",
    section_order: craftStrategy.section_order,
    evidence_priorities: [{ fact_revision_id: JOB_ONE_ID, priority: "context" }, { fact_revision_id: CRAFT_FACT_ID, priority: "must_use" }],
    omissions: [],
    unresolved_gap_ids: [],
  },
  target_analysis: null,
  deterministic_truth_passed: true,
  deterministic_structure_passed: true,
  deterministic_mechanical_passed: true,
  deterministic_gate_digest: canonicalInputDigest({ truth_passed: true, structure_passed: true, mechanical_passed: true, mechanical_report_digest: canonicalInputDigest(craftDefinition) }),
};
const craftEvaluation = evaluateCraftProposal(craftContext);
const craftReport = {
  metadata: { revision_id: CRAFT_REPORT_ID },
  proposal_definition_revision_id: CRAFT_DEFINITION_ID,
  ...craftEvaluation,
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

type ConformanceBlockCategory = "confirmed_fact_snapshot" | "dialogue_context" | "transcript_snapshot" | "job_description" | "general_resume_definition" | "job_analysis" | "evidence_matrix" | "job_evidence_summary" | "revision_instruction" | "evidence_annotations" | "quality_policy" | "resume_strategy" | "target_fit_policy" | "target_fit_analysis" | "deterministic_findings" | "craft_anchor_evidence" | "craft_gate_policy" | "craft_quality_report" | "craft_repair_scope";

function block(category: ConformanceBlockCategory, schemaId: string, data: unknown) {
  return { category, content_digest: canonicalInputDigest(data), schema_id: schemaId, schema_version: 1 as const, data };
}

export const RESUME_MODEL_CONFORMANCE_BINDING = {
  binding_version: 2 as const,
  evidence_scope: "controlled_provider_conformance" as const,
  quality_standard_revision: 3 as const,
  quality_standard_digest: RESUME_QUALITY_POLICY_IDENTITY.quality_standard_digest,
  prompt_policy_id: RESUME_PROMPT_POLICY_ID,
  prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
  prompt_policy_digest: CORRECTED_PROMPT_POLICY_DIGEST,
  evaluator_contract_digest: PRODUCT_CRAFT_EVALUATOR.binding_digest,
  host_assistance_policy_digest: RESUME_HOST_ASSISTANCE_POLICY_DIGEST,
  craft_report_schema_id: CORRECTED_CRAFT_REPORT_SCHEMA_ID,
  craft_report_schema_digest: CORRECTED_CRAFT_REPORT_SCHEMA_DIGEST,
} as const;

export const RESUME_MODEL_CONFORMANCE_CORPUS_VERSION = 2 as const;
export const RESUME_MODEL_CONFORMANCE_CORPUS_DIGEST = canonicalInputDigest({
  corpus_version: RESUME_MODEL_CONFORMANCE_CORPUS_VERSION,
  binding: RESUME_MODEL_CONFORMANCE_BINDING,
  facts,
  generalDefinition,
  jobDescription,
  jobAnalysis,
  evidenceMatrix,
});

export function conformanceBlocks(purpose: InferencePurpose) {
  if (purpose === "resume_craft_evaluate" || purpose === "resume_craft_repair") {
    const craftFacts = [facts[1], craftFact];
    const blocks = [
      block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts: craftFacts }),
      block("general_resume_definition", "resume.definition.v1", craftDefinition),
      block("resume_strategy", "resume.strategy-record.v1", craftStrategy),
      block("deterministic_findings", "resume.craft-deterministic-gates.v1", { truth_passed: true, structure_passed: true, mechanical_passed: true, mechanical_report_digest: canonicalInputDigest(craftDefinition) }),
      block("craft_anchor_evidence", "resume.craft-anchor-evidence.v1", extractCraftAnchorEvidence(craftContext)),
      block("craft_gate_policy", "resume.craft-gate-policy.v1", CRAFT_EVIDENCE_LIMITED_POLICY),
    ];
    if (purpose === "resume_craft_repair") {
      blocks.push(block("craft_quality_report", "resume.craft-quality-report.v1", craftReport));
      blocks.push(block("craft_repair_scope", "resume.craft-repair-scope.v1", {
        scope_version: 1,
        source_definition_revision_id: CRAFT_DEFINITION_ID,
        source_report_revision_id: CRAFT_REPORT_ID,
        statement_scope_ids: ["73000000-0000-4000-8000-000000000027"],
        allowed_correction_classes: ["duty_only"],
        attempt: 1,
      }));
    }
    return blocks;
  }
  const changedM3Purpose = ["interview_assist", "general_resume_draft", "targeted_resume_draft"].includes(purpose);
  const purposeFacts = purpose === "resume_dialogue"
    ? []
    : purpose === "interview_assist"
    ? [facts[1], facts[2], jobEvidenceFact]
    : changedM3Purpose
      ? [...facts, jobEvidenceFact]
      : facts;
  const blocks = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts: purposeFacts })];
  if (purpose === "resume_dialogue") {
    blocks.push(block("dialogue_context", "resume.dialogue-context.v2", {
      dialogue_version: 2,
      messages: [
        { message_id: "73000000-0000-4000-8000-000000000041", role: "assistant", content: "Tell me about a role that matters for the resume you want.", source_revision_id: null },
        { message_id: "73000000-0000-4000-8000-000000000042", role: "user", content: "I was Operations Coordinator at Northstar Health from March 2022 to Present, coordinating schedules for 25 staff across 4 sites.", source_revision_id: null },
        { message_id: "73000000-0000-4000-8000-000000000043", role: "assistant", content: "What outcome from that work should stand out?", source_revision_id: null },
        { message_id: "73000000-0000-4000-8000-000000000044", role: "user", content: "I standardized intake and reduced incomplete forms from 18 percent to 6 percent.", source_revision_id: null },
        { message_id: "73000000-0000-4000-8000-000000000045", role: "assistant", content: "What would you like to do next?", source_revision_id: null },
        { message_id: "73000000-0000-4000-8000-000000000046", role: "user", content: "That is everything. Create my general resume draft now.", source_revision_id: null },
      ],
      current_message_id: "73000000-0000-4000-8000-000000000046",
      current_user_message: "That is everything. Create my general resume draft now.",
      resume_state: { facts: [], definitions: [] },
      tool_results: [],
    }));
  }
  if (purpose === "resume_transcript_extract") {
    blocks.push(block("transcript_snapshot", "resume.transcript-snapshot.v1", {
      transcript_version: 1,
      turns: [
        {
          source_revision_id: "73000000-0000-4000-8000-000000000031",
          occurred_at: "2026-08-15T12:00:00.000Z",
          assistant: "Tell me about your most recent role.",
          owner: "I was Operations Coordinator at Northstar Health from March 2022 to Present.",
          follow_up: "What result are you proudest of?",
        },
        {
          source_revision_id: "73000000-0000-4000-8000-000000000032",
          occurred_at: "2026-08-15T12:01:00.000Z",
          assistant: "What result are you proudest of?",
          owner: "At Northstar Health I standardized the intake process and reduced incomplete forms from 18% to 6%.",
          follow_up: "Would you like me to prepare a draft?",
        },
      ],
    }));
  }
  if (purpose === "resume_strategy") {
    blocks.push(block("evidence_annotations", "resume.evidence-annotations.v1", buildEvidenceAnnotations(purposeFacts, [])));
    blocks.push(block("quality_policy", "resume.quality-policy-identity.v1", RESUME_QUALITY_POLICY_IDENTITY));
  }
  if (purpose === "general_resume_draft") {
    blocks.push(block("resume_strategy", "resume.strategy-record.v1", conformanceStrategy));
    blocks.push(block("quality_policy", "resume.quality-policy-identity.v1", RESUME_QUALITY_POLICY_IDENTITY));
  }
  if (purpose === "interview_assist") blocks.push(block("job_evidence_summary", "resume.job-evidence-summary.v2", jobEvidenceSummary));
  if (["job_description_analyze", "targeted_resume_draft"].includes(purpose)) blocks.push(block("job_description", "resume.job-description.v1", jobDescription));
  if (["tailoring_plan", "targeted_resume_draft"].includes(purpose)) blocks.push(block("general_resume_definition", "resume.definition.v1", generalDefinition));
  if (purpose === "requirement_evidence_match") blocks.push(block("job_analysis", "resume.job-analysis.v1", jobAnalysis));
  if (["tailoring_plan", "targeted_resume_draft"].includes(purpose)) blocks.push(block("evidence_matrix", "resume.requirement-evidence.v1", evidenceMatrix));
  if (purpose === "tailoring_plan") blocks.push(block("target_fit_policy", "resume.target-fit-policy.v1", TARGET_FIT_THRESHOLD_POLICY));
  if (purpose === "targeted_resume_draft") {
    blocks.push(block("resume_strategy", "resume.strategy-record.v1", conformanceStrategy));
    blocks.push(block("target_fit_analysis", "resume.target-fit-analysis.v1", targetAnalysis));
  }
  if (["resume_revision_classify", "resume_revision_draft"].includes(purpose)) {
    blocks.push(block("general_resume_definition", "resume.definition.v1", generalDefinition));
    blocks.push(block("revision_instruction", "resume.revision-request.v1", revisionRequest(purpose === "resume_revision_draft" ? "generating" : "submitted")));
  }
  return blocks;
}

export function conformanceCorpusDigest(purpose: InferencePurpose): string {
  const binding = purpose === "resume_dialogue"
    ? { ...RESUME_MODEL_CONFORMANCE_BINDING, prompt_policy_id: RESUME_DIALOGUE_PROMPT_POLICY_ID, prompt_policy_version: RESUME_DIALOGUE_PROMPT_POLICY_VERSION }
    : purpose === "resume_transcript_extract"
      ? { ...RESUME_MODEL_CONFORMANCE_BINDING, prompt_policy_id: RESUME_EXTRACTION_PROMPT_POLICY_ID, prompt_policy_version: RESUME_EXTRACTION_PROMPT_POLICY_VERSION }
    : RESUME_MODEL_CONFORMANCE_BINDING;
  return canonicalInputDigest({ corpus_version: RESUME_MODEL_CONFORMANCE_CORPUS_VERSION, binding, purpose, blocks: conformanceBlocks(purpose) });
}
