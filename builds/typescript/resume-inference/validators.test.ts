import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { validateInferenceClaims } from "./validators.js";

const FACT_ID = "72000000-0000-4000-8000-000000000001";
const JOB_ID = "72000000-0000-4000-8000-000000000002";
const ACCOMPLISHMENT_ID = "72000000-0000-4000-8000-000000000003";
const OPPORTUNITY_ID = "72000000-0000-4000-8000-000000000004";
const blocks = (value: string) => {
  const data = { facts: [{ revision_id: FACT_ID, fact_kind: "accomplishment", value, source_revision_ids: [randomUUID()] }] };
  return [{ category: "confirmed_fact_snapshot" as const, content_digest: canonicalInputDigest(data), schema_id: "resume.confirmed-facts.v1", schema_version: 1 as const, data }];
};

describe("deterministic claim gate", () => {
  it("allows natural clarification while rejecting question capture, invented sources, and model-owned save claims", () => {
    const current = "Do you mean my last role or all my roles?";
    const facts = { facts: [{
      revision_id: JOB_ID,
      fact_kind: "employment",
      value: JSON.stringify({ format: "resume_job_v1", title: "Coordinator", employer: "Northwind" }),
      source_revision_ids: [randomUUID()],
    }] };
    const context = {
      dialogue_version: 1,
      messages: [{ role: "assistant", content: "Tell me about your work history." }, { role: "user", content: current }],
      current_user_message: current,
      requested_mode: "intake",
    };
    const dialogueBlocks = [
      { category: "confirmed_fact_snapshot" as const, content_digest: canonicalInputDigest(facts), schema_id: "resume.confirmed-facts.v1", schema_version: 1 as const, data: facts },
      { category: "dialogue_context" as const, content_digest: canonicalInputDigest(context), schema_id: "resume.dialogue-context.v1", schema_version: 1 as const, data: context },
    ];
    const clarification = {
      dialogue_version: 1,
      assistant_message: "Let’s start with your most recent role, then add earlier roles that strengthen the resume. What was your most recent role?",
      turn_disposition: "respond_only",
      fact_operations: [],
      suggested_action: "none",
    };
    expect(validateInferenceClaims("resume_dialogue", clarification, dialogueBlocks).accepted).toBe(true);
    expect(validateInferenceClaims("resume_dialogue", {
      ...clarification,
      turn_disposition: "capture_and_continue",
      fact_operations: [{ operation: "capture", fact_kind: "skill", value: "last role", source_quote: "last role" }],
    }, dialogueBlocks).accepted).toBe(false);
    expect(validateInferenceClaims("resume_dialogue", {
      ...clarification,
      assistant_message: "I saved and confirmed that for your resume.",
    }, dialogueBlocks).accepted).toBe(false);
    expect(validateInferenceClaims("resume_dialogue", {
      ...clarification,
      turn_disposition: "capture_and_continue",
      fact_operations: [{ operation: "capture", fact_kind: "job_evidence", text: current, source_quote: current, job_fact_revision_id: randomUUID(), dimension: "outcomes" }],
    }, dialogueBlocks).accepted).toBe(false);
  });

  it("accepts cross-turn owner-grounded employment but rejects a fabricated employer", () => {
    const current = "Northwind is the correct name and spelling. 2020 to 2024";
    const context = {
      dialogue_version: 1,
      messages: [
        { role: "assistant", content: "What was your title and employer?" },
        { role: "user", content: "I was Director of Operations at the company." },
        { role: "assistant", content: "Please confirm the company name and dates." },
        { role: "user", content: current },
      ],
      current_user_message: current,
      requested_mode: "intake",
    };
    const dialogueBlocks = [{ category: "dialogue_context" as const, content_digest: canonicalInputDigest(context), schema_id: "resume.dialogue-context.v1", schema_version: 1 as const, data: context }];
    const result = {
      dialogue_version: 1,
      assistant_message: "Thanks. What result from that role are you proudest of?",
      turn_disposition: "capture_and_continue",
      fact_operations: [{ operation: "capture", fact_kind: "employment", source_quote: current, employment: { title: "Director of Operations", employer: "Northwind", location: null, start_date: "2020", end_date: "2024", responsibilities: null } }],
      suggested_action: "none",
    };

    expect(validateInferenceClaims("resume_dialogue", result, dialogueBlocks).accepted).toBe(true);
    expect(validateInferenceClaims("resume_dialogue", {
      ...result,
      fact_operations: [{ ...result.fact_operations[0], employment: { ...result.fact_operations[0]!.employment, employer: "Contoso" } }],
    }, dialogueBlocks).accepted).toBe(false);
  });

  it("allows supported wording and blocks missing provenance, metrics, dates, and titles", () => {
    const cases = [
      ["Built product 20% in 2025 as Engineer", true],
      ["Built product 21% in 2025 as Engineer", false],
      ["Built product 20% in 2026 as Engineer", false],
      ["Built product 20% in 2025 as Director", false],
    ] as const;
    for (const [text, expected] of cases) {
      const report = validateInferenceClaims("general_resume_draft", { statements: [{ statement_id: randomUUID(), kind: "factual", text, supporting_confirmed_fact_revision_ids: [FACT_ID] }] }, blocks("Built product 20% in 2025 as Engineer"));
      expect(report.accepted).toBe(expected);
    }
    const missing = validateInferenceClaims("general_resume_draft", { statements: [{ statement_id: randomUUID(), kind: "factual", text: "Built product", supporting_confirmed_fact_revision_ids: [randomUUID()] }] }, blocks("Built product"));
    expect(missing.findings[0]?.code).toBe("missing_provenance");
  });

  it("has zero unsupported approvals across a deterministic property sample", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const supported = `Delivered release ${seed}% in 2025 as Engineer`;
      const candidate = seed % 2 === 0 ? supported : `Delivered release ${seed + 1}% in 2025 as Director`;
      const report = validateInferenceClaims("general_resume_draft", { statements: [{ statement_id: randomUUID(), kind: "factual", text: candidate, supporting_confirmed_fact_revision_ids: [FACT_ID] }] }, blocks(supported));
      expect(report.accepted).toBe(seed % 2 === 0);
    }
  });

  it("allows conservative resume grammar without allowing internal structured markers", () => {
    const source = "Coordinate schedules across 4 sites, maintain records, and standardized office processes";
    const supported = validateInferenceClaims("general_resume_draft", { statements: [{
      statement_id: randomUUID(), kind: "factual", text: "Experience coordinating schedules, records management, and standardizing office processes across multiple sites",
      supporting_confirmed_fact_revision_ids: [FACT_ID],
    }] }, blocks(source));
    expect(supported.accepted).toBe(true);

    const leaked = validateInferenceClaims("general_resume_draft", { statements: [{
      statement_id: randomUUID(), kind: "factual", text: "resume_job_v1 job_fact_revision_id",
      supporting_confirmed_fact_revision_ids: [FACT_ID],
    }] }, blocks("resume_job_v1 job_fact_revision_id"));
    expect(leaked.accepted).toBe(false);
  });

  it("allows non-claim career-direction connectors while retaining exact supported role wording", () => {
    const source = "Customer Service Lead. Resume goal: customer service supervisor or operations coordinator roles.";
    const supported = validateInferenceClaims("general_resume_draft", { statements: [{
      statement_id: randomUUID(), kind: "factual", text: "Customer Service Lead targeting customer service supervisor or operations coordinator roles.",
      supporting_confirmed_fact_revision_ids: [FACT_ID],
    }] }, blocks(source));
    expect(supported.accepted).toBe(true);

    const invented = validateInferenceClaims("general_resume_draft", { statements: [{
      statement_id: randomUUID(), kind: "factual", text: "Customer Service Director targeting customer service supervisor roles.",
      supporting_confirmed_fact_revision_ids: [FACT_ID],
    }] }, blocks(source));
    expect(invented.accepted).toBe(false);
  });

  it("allows an evidence-shaped omitted summary while requiring job headings and linked accomplishments", () => {
    const data = { facts: [
      { revision_id: JOB_ID, fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "Operations Coordinator", employer: "Northstar Health" }), source_revision_ids: [randomUUID()] },
      { revision_id: ACCOMPLISHMENT_ID, fact_kind: "accomplishment", value: JSON.stringify({ format: "resume_accomplishment_v1", job_fact_revision_id: JOB_ID, text: "Reduced incomplete forms from 18% to 6%." }), source_revision_ids: [randomUUID()] },
    ] };
    const structuredBlocks = [{ category: "confirmed_fact_snapshot" as const, content_digest: canonicalInputDigest(data), schema_id: "resume.confirmed-facts.v1", schema_version: 1 as const, data }];
    const complete = validateInferenceClaims("general_resume_draft", { statements: [
      { statement_id: randomUUID(), section_id: "summary", kind: "factual", text: "Operations Coordinator experience", supporting_confirmed_fact_revision_ids: [JOB_ID] },
      { statement_id: randomUUID(), section_id: "experience", kind: "factual", text: "Operations Coordinator | Northstar Health", supporting_confirmed_fact_revision_ids: [JOB_ID] },
      { statement_id: randomUUID(), section_id: "experience", kind: "factual", text: "Reduced incomplete forms from 18% to 6%.", supporting_confirmed_fact_revision_ids: [ACCOMPLISHMENT_ID] },
    ] }, structuredBlocks);
    expect(complete.accepted).toBe(true);

    const incomplete = validateInferenceClaims("general_resume_draft", { statements: [
      { statement_id: randomUUID(), section_id: "experience", kind: "factual", text: "Coordinated operations", supporting_confirmed_fact_revision_ids: [JOB_ID] },
    ] }, structuredBlocks);
    expect(incomplete.accepted).toBe(false);
    expect(incomplete.findings.map((item) => item.safe_message)).toEqual(expect.arrayContaining([
      expect.stringContaining("individual experience heading"),
      expect.stringContaining("confirmed accomplishment"),
    ]));
    expect(incomplete.findings.map((item) => item.safe_message).join(" ")).not.toContain("professional summary");
  });

  it("validates bounded strategy identities and makes quiet must-use omission blocking", () => {
    const data = { facts: [
      { revision_id: JOB_ID, fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "Coordinator", employer: "Northstar Health" }), source_revision_ids: [randomUUID()] },
      { revision_id: ACCOMPLISHMENT_ID, fact_kind: "accomplishment", value: JSON.stringify({ format: "resume_accomplishment_v1", job_fact_revision_id: JOB_ID, text: "Reduced incomplete forms." }), source_revision_ids: [randomUUID()] },
    ] };
    const annotations = {
      annotation_version: 1,
      facts: [
        { fact_revision_id: JOB_ID, evidence_class: "role_identity", job_fact_revision_id: JOB_ID, required_priority: "must_use" },
        { fact_revision_id: ACCOMPLISHMENT_ID, evidence_class: "accomplishment", job_fact_revision_id: JOB_ID, required_priority: "must_use" },
      ],
    };
    const strategy = {
      strategy_version: 1,
      history_shape: "chronological_standard",
      history_reason_code: "standard_chronology",
      role_emphasis: [{ job_fact_revision_id: JOB_ID, priority: "primary", reason_code: "evidence_rich", bullet_density: "compact" }],
      section_order: ["experience"],
      evidence_priorities: [
        { fact_revision_id: JOB_ID, priority: "must_use" },
        { fact_revision_id: ACCOMPLISHMENT_ID, priority: "must_use" },
      ],
      summary_decision: "omit",
      summary_reason_code: "insufficient_distinct_value",
      skills_context: [],
      omissions: [],
      unresolved_gap_ids: [],
      owner_rationale: "Lead with the supported role and its specific outcome.",
    };
    const strategyBlocks = [
      { category: "confirmed_fact_snapshot" as const, content_digest: canonicalInputDigest(data), schema_id: "resume.confirmed-facts.v1", schema_version: 1 as const, data },
      { category: "evidence_annotations" as const, content_digest: canonicalInputDigest(annotations), schema_id: "resume.evidence-annotations.v1", schema_version: 1 as const, data: annotations },
    ];
    expect(validateInferenceClaims("resume_strategy", strategy, strategyBlocks).accepted).toBe(true);
    expect(validateInferenceClaims("resume_strategy", {
      ...strategy,
      evidence_priorities: [{ fact_revision_id: JOB_ID, priority: "must_use" }],
    }, strategyBlocks).accepted).toBe(false);

    const strategyRecord = { ...strategy, metadata: { revision_id: randomUUID() } };
    const generationBlocks = [
      strategyBlocks[0],
      { category: "resume_strategy" as const, content_digest: canonicalInputDigest(strategyRecord), schema_id: "resume.strategy-record.v1", schema_version: 1 as const, data: strategyRecord },
    ];
    const heading = { statement_id: randomUUID(), section_id: "experience", kind: "factual", text: "Coordinator | Northstar Health", supporting_confirmed_fact_revision_ids: [JOB_ID] };
    const quiet = validateInferenceClaims("general_resume_draft", { statements: [heading], omissions: [] }, generationBlocks);
    expect(quiet.accepted).toBe(false);
    expect(quiet.findings.map((item) => item.safe_message).join(" ")).toContain("must-use");
    for (const reason_code of ["redundant", "low_relevance", "space", "older_context", "owner_direction", "structural_mismatch", "conflict"] as const) {
      const visible = validateInferenceClaims("general_resume_draft", {
        statements: [heading],
        omissions: [{ fact_revision_id: ACCOMPLISHMENT_ID, reason_code }],
      }, generationBlocks);
      expect(visible.accepted, reason_code).toBe(true);
    }
  });

  it("produces stable findings and digests for identical invalid input", () => {
    const statement = { statement_id: randomUUID(), kind: "factual" as const, text: "Invented 99%", supporting_confirmed_fact_revision_ids: [FACT_ID] };
    const first = validateInferenceClaims("general_resume_draft", { statements: [statement] }, blocks("Supported 20%"));
    const second = validateInferenceClaims("general_resume_draft", { statements: [statement] }, blocks("Supported 20%"));
    expect(second.findings).toEqual(first.findings);
    expect(second.findings_digest).toBe(first.findings_digest);
  });

  it("preserves partial and ambiguous evidence but rejects unknown fact identities", () => {
    for (const evidence_status of ["partially_supported", "ambiguous", "clarification_needed"] as const) {
      const report = validateInferenceClaims("requirement_evidence_match", { evidence: [{ requirement_id: randomUUID(), evidence_status, supporting_confirmed_fact_revision_ids: [FACT_ID], explanation: "Needs owner review", clarification: "Clarify scope" }] }, blocks("Relevant experience"));
      expect(report.accepted).toBe(true);
    }
    const rejected = validateInferenceClaims("requirement_evidence_match", { evidence: [{ requirement_id: randomUUID(), evidence_status: "supported", supporting_confirmed_fact_revision_ids: [randomUUID()], explanation: "Unknown", clarification: null }] }, blocks("Relevant experience"));
    expect(rejected.accepted).toBe(false);
  });

  it("keeps interview assistance on the active job and dimension without metric pressure", () => {
    const summary = {
      active_job_fact_revision_id: JOB_ID,
      active_job_revision: 2,
      requested_opportunity_id: OPPORTUNITY_ID,
      requested_dimension: "outcomes",
      opportunity_kind: "qualitative",
      value_category: "decision_useful_outcome",
      dimensions: [{ dimension: "responsibilities", outcome: "answered", evidence_revision_ids: [JOB_ID] }],
    };
    const data = { facts: [{ revision_id: JOB_ID, fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "Coordinator", employer: "Synthetic Org" }), source_revision_ids: [randomUUID()] }] };
    const assistBlocks = [
      { category: "confirmed_fact_snapshot" as const, content_digest: canonicalInputDigest(data), schema_id: "resume.confirmed-facts.v1", schema_version: 1 as const, data },
      { category: "job_evidence_summary" as const, content_digest: canonicalInputDigest(summary), schema_id: "resume.job-evidence-summary.v2", schema_version: 1 as const, data: summary },
    ];
    const result = (overrides: Record<string, unknown> = {}) => ({ questions: [{
      question_id: randomUUID(),
      job_fact_revision_id: JOB_ID,
      opportunity_id: OPPORTUNITY_ID,
      dimension: "outcomes",
      opportunity_kind: "qualitative",
      value_category: "decision_useful_outcome",
      selection_method: "deterministic_value",
      prompt: "What became better or easier because of your work? A qualitative result is enough.",
      rationale: "A supported outcome could make this role clearer.",
      ...overrides,
    }] });
    expect(validateInferenceClaims("interview_assist", result(), assistBlocks).accepted).toBe(true);
    expect(validateInferenceClaims("interview_assist", result({ job_fact_revision_id: randomUUID() }), assistBlocks).accepted).toBe(false);
    expect(validateInferenceClaims("interview_assist", result({ opportunity_id: randomUUID() }), assistBlocks).accepted).toBe(false);
    expect(validateInferenceClaims("interview_assist", result({ dimension: "tools" }), assistBlocks).accepted).toBe(false);
    expect(validateInferenceClaims("interview_assist", result({ opportunity_kind: "metric" }), assistBlocks).accepted).toBe(false);
    expect(validateInferenceClaims("interview_assist", result({ prompt: "What exact percentage did you improve? You must provide a number." }), assistBlocks).accepted).toBe(false);
  });

  it("uses answered job evidence without padding sparse roles or exposing unknowns", () => {
    const evidence = (id: string, dimension: string, outcome: string, ownerText: string) => ({
      revision_id: id,
      fact_kind: "job_evidence",
      value: JSON.stringify({ value_version: 1, association: "job", job_fact_revision_id: JOB_ID, dimension, outcome, owner_text: ownerText }),
      source_revision_ids: [randomUUID()],
    });
    const responsibilityId = "72000000-0000-4000-8000-000000000011";
    const toolId = "72000000-0000-4000-8000-000000000012";
    const outcomeId = "72000000-0000-4000-8000-000000000013";
    const unknownId = "72000000-0000-4000-8000-000000000014";
    const data = { facts: [
      { revision_id: JOB_ID, fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "Coordinator", employer: "Synthetic Org" }), source_revision_ids: [randomUUID()] },
      evidence(responsibilityId, "responsibilities", "answered", "Coordinated daily service requests."),
      evidence(toolId, "tools", "answered", "Used a scheduling system to coordinate coverage."),
      evidence(outcomeId, "outcomes", "answered", "Made handoffs clearer for the next shift."),
      evidence(unknownId, "scope", "unknown", ""),
    ] };
    const evidenceBlocks = [{ category: "confirmed_fact_snapshot" as const, content_digest: canonicalInputDigest(data), schema_id: "resume.confirmed-facts.v1", schema_version: 1 as const, data }];
    const statements = [
      { statement_id: randomUUID(), section_id: "summary", kind: "factual", text: "Coordinator", supporting_confirmed_fact_revision_ids: [JOB_ID] },
      { statement_id: randomUUID(), section_id: "experience", kind: "factual", text: "Coordinator | Synthetic Org", supporting_confirmed_fact_revision_ids: [JOB_ID] },
      { statement_id: randomUUID(), section_id: "experience", kind: "factual", text: "Coordinated daily service requests.", supporting_confirmed_fact_revision_ids: [responsibilityId] },
      { statement_id: randomUUID(), section_id: "experience", kind: "factual", text: "Used a scheduling system to coordinate coverage.", supporting_confirmed_fact_revision_ids: [toolId] },
      { statement_id: randomUUID(), section_id: "experience", kind: "factual", text: "Made handoffs clearer for the next shift.", supporting_confirmed_fact_revision_ids: [outcomeId] },
    ];
    expect(validateInferenceClaims("general_resume_draft", { statements }, evidenceBlocks).accepted).toBe(true);
    expect(validateInferenceClaims("general_resume_draft", { statements: [...statements, {
      statement_id: randomUUID(), section_id: "experience", kind: "factual", text: "Unknown scope", supporting_confirmed_fact_revision_ids: [unknownId],
    }] }, evidenceBlocks).accepted).toBe(false);
    expect(validateInferenceClaims("general_resume_draft", { statements: [...statements, ...Array.from({ length: 4 }, () => ({
      statement_id: randomUUID(), section_id: "experience", kind: "factual" as const, text: "Coordinated daily service requests.", supporting_confirmed_fact_revision_ids: [responsibilityId],
    }))] }, evidenceBlocks).accepted).toBe(false);
  });

  it("validates revision classification against the persisted scope and permits clarification only for ambiguity", () => {
    const sourceId = randomUUID();
    const requestId = randomUUID();
    const source = { metadata: { revision_id: sourceId }, statements: [], section_order: ["summary"] };
    const request = {
      metadata: { revision_id: requestId },
      source_definition_revision_id: sourceId,
      target: { scope: "resume", target_id: null },
      request_text: "Make it shorter.",
      request_digest: canonicalInputDigest("Make it shorter."),
      classification: null,
      state: "submitted",
    };
    const revisionBlocks = [
      ...blocks("Supported evidence"),
      { category: "general_resume_definition" as const, content_digest: canonicalInputDigest(source), schema_id: "resume.definition.v1", schema_version: 1 as const, data: source },
      { category: "revision_instruction" as const, content_digest: canonicalInputDigest(request), schema_id: "resume.revision-request.v1", schema_version: 1 as const, data: request },
    ];
    expect(validateInferenceClaims("resume_revision_classify", {
      classification: "presentation", target: request.target, clarification: null, proposed_fact_changes: [],
    }, revisionBlocks).accepted).toBe(true);
    expect(validateInferenceClaims("resume_revision_classify", {
      classification: "presentation", target: { scope: "section", target_id: "summary" }, clarification: null, proposed_fact_changes: [],
    }, revisionBlocks).accepted).toBe(false);
    expect(validateInferenceClaims("resume_revision_classify", {
      classification: "ambiguous", target: request.target, clarification: "Which section should change?", proposed_fact_changes: [],
    }, revisionBlocks).accepted).toBe(true);
  });

  it("rejects revision drafts with wrong lineage, unstable unchanged IDs, or unsupported factual inflation", () => {
    const sourceId = randomUUID();
    const requestId = randomUUID();
    const statementId = randomUUID();
    const source = {
      metadata: { revision_id: sourceId },
      title: "Resume",
      statements: [{ statement_id: statementId, section_id: "experience", kind: "factual", text: "Built product 20%", supporting_confirmed_fact_revision_ids: [FACT_ID] }],
      section_order: ["experience"],
    };
    const request = {
      metadata: { revision_id: requestId },
      source_definition_revision_id: sourceId,
      target: { scope: "resume", target_id: null },
      request_text: "Shorten the wording.",
      request_digest: canonicalInputDigest("Shorten the wording."),
      classification: "presentation",
      state: "generating",
    };
    const revisionBlocks = [
      ...blocks("Built product 20%"),
      { category: "general_resume_definition" as const, content_digest: canonicalInputDigest(source), schema_id: "resume.definition.v1", schema_version: 1 as const, data: source },
      { category: "revision_instruction" as const, content_digest: canonicalInputDigest(request), schema_id: "resume.revision-request.v1", schema_version: 1 as const, data: request },
    ];
    const valid = {
      source_definition_revision_id: sourceId,
      revision_request_revision_id: requestId,
      title: "Resume",
      statements: [{ ...source.statements[0], text: "Product built 20%" }],
      changed_statement_ids: [statementId],
      section_order: ["experience"],
    };
    expect(validateInferenceClaims("resume_revision_draft", valid, revisionBlocks).accepted).toBe(true);
    expect(validateInferenceClaims("resume_revision_draft", { ...valid, source_definition_revision_id: randomUUID() }, revisionBlocks).accepted).toBe(false);
    expect(validateInferenceClaims("resume_revision_draft", { ...valid, statements: [{ ...source.statements[0], statement_id: randomUUID() }], changed_statement_ids: [] }, revisionBlocks).accepted).toBe(false);
    expect(validateInferenceClaims("resume_revision_draft", { ...valid, statements: [{ ...source.statements[0], text: "Led product 99%" }] }, revisionBlocks).accepted).toBe(false);
    const unsupportedLeadership = validateInferenceClaims("resume_revision_draft", {
      ...valid,
      statements: [{ ...source.statements[0], text: "Senior leader who directed product strategy" }],
    }, revisionBlocks);
    expect(unsupportedLeadership.accepted).toBe(false);
    expect(unsupportedLeadership.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unsupported_claim" }),
    ]));
  });

  it("accepts only grounded, neutral five-category guidance with owner-readable evidence labels", () => {
    const definitionId = randomUUID();
    const definition = { metadata: { revision_id: definitionId }, status: "approved", statements: [] };
    const findings = { findings: [{ code: "missing_detail", evidence_revision_ids: [FACT_ID], safe_message: "A result could use more detail." }] };
    const guidanceBlocks = [
      ...blocks("Coordinated schedules across four sites"),
      { category: "general_resume_definition" as const, content_digest: canonicalInputDigest(definition), schema_id: "resume.definition.v1", schema_version: 1 as const, data: definition },
      { category: "deterministic_findings" as const, content_digest: canonicalInputDigest(findings), schema_id: "resume.quality-findings.v1", schema_version: 1 as const, data: findings },
    ];
    const valid = {
      guidance_version: 1,
      items: [
        { category: "strong_evidence", evidence_revision_ids: [FACT_ID], evidence_labels: ["Confirmed scheduling evidence"], message: "The resume has confirmed multi-site scheduling evidence." },
        { category: "missing_detail", evidence_revision_ids: [FACT_ID], evidence_labels: ["Scheduling result"], message: "More detail about the result could improve specificity." },
        { category: "unresolved_conflict", evidence_revision_ids: [], evidence_labels: ["No unresolved conflicts"], message: "No unresolved conflict is identified in the available evidence." },
        { category: "unsupported_requirement", evidence_revision_ids: [], evidence_labels: ["No target requirement supplied"], message: "No unsupported target requirement is currently identified." },
        { category: "intentional_omission", evidence_revision_ids: [], evidence_labels: ["Owner choices"], message: "Intentionally omitted content remains outside the resume." },
      ],
      optional_questions: [{ question_id: randomUUID(), prompt: "What became easier because of the scheduling work?", evidence_revision_ids: [FACT_ID] }],
    };
    expect(validateInferenceClaims("resume_guidance", valid, guidanceBlocks).accepted).toBe(true);
    for (const message of [
      "ATS score 95 guarantees interviews.",
      "You are a strong candidate for this role.",
      "This is likely to get an interview offer.",
      "Your chance of getting hired is high.",
    ]) expect(validateInferenceClaims("resume_guidance", { ...valid, items: [{ ...valid.items[0], message }] }, guidanceBlocks).accepted).toBe(false);
    expect(validateInferenceClaims("resume_guidance", { ...valid, items: [{ ...valid.items[0], evidence_revision_ids: [randomUUID()] }] }, guidanceBlocks).accepted).toBe(false);
  });
});
