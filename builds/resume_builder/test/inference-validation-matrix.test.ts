import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  RESUME_INFERENCE_PROGRAMS,
  adjudicateResumeInference,
  prepareResumeInference,
} from "../resources/inference-program.js";

const ids = {
  fact: "71000000-0000-4000-8000-000000000001",
  foreignFact: "71000000-0000-4000-8000-000000000002",
  jobFact: "71000000-0000-4000-8000-000000000003",
  opportunity: "71000000-0000-4000-8000-000000000004",
  foreignOpportunity: "71000000-0000-4000-8000-000000000005",
  question: "71000000-0000-4000-8000-000000000006",
  requirement: "71000000-0000-4000-8000-000000000007",
  foreignRequirement: "71000000-0000-4000-8000-000000000008",
  definition: "71000000-0000-4000-8000-000000000009",
  job: "71000000-0000-4000-8000-000000000010",
  strategy: "71000000-0000-4000-8000-000000000011",
  analysis: "71000000-0000-4000-8000-000000000012",
  request: "71000000-0000-4000-8000-000000000013",
  report: "71000000-0000-4000-8000-000000000014",
  statement: "71000000-0000-4000-8000-000000000015",
  foreignStatement: "71000000-0000-4000-8000-000000000016",
  change: "71000000-0000-4000-8000-000000000017",
  finding: "71000000-0000-4000-8000-000000000018",
  evidence: "71000000-0000-4000-8000-000000000019",
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new Error("invalid fixture value");
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function block(category: string, schemaId: string, data: unknown) {
  return { category, schema_id: schemaId, schema_version: 1, content_digest: digest(data), data };
}

const confirmedFacts = {
  facts: [
    { revision_id: ids.jobFact, fact_kind: "employment", value: "Synthetic role identity", source_revision_ids: [] },
    { revision_id: ids.fact, fact_kind: "accomplishment", value: "Synthetic confirmed evidence", source_revision_ids: [] },
  ],
};

const statement = {
  statement_id: ids.statement,
  section_id: "experience",
  kind: "factual",
  display_role: "bullet",
  text: "Synthetic confirmed evidence",
  supporting_confirmed_fact_revision_ids: [ids.fact],
};

const definition = {
  metadata: { revision_id: ids.definition },
  definition_kind: "general",
  status: "approved",
  title: "Synthetic Resume",
  statements: [statement],
  selected_fact_revision_ids: [ids.fact],
  section_order: ["experience"],
};

const job = {
  metadata: { revision_id: ids.job },
  description_text: "Requires reliable documentation.",
  content_digest: digest("Requires reliable documentation."),
};

const requirement = {
  requirement_id: ids.requirement,
  requirement_kind: "required",
  source_span: "Requires reliable documentation.",
  inferred: false,
  normalized_requirement: "Reliable documentation",
};

const evidenceRow = {
  requirement_id: ids.requirement,
  evidence_status: "supported",
  supporting_confirmed_fact_revision_ids: [ids.fact],
  explanation: "The confirmed fact directly supports this requirement.",
  clarification: null,
};

const evidenceMatrixRow = { ...evidenceRow, requirement_kind: "required" };

const strategy = {
  metadata: { revision_id: ids.strategy },
  fact_revision_ids: [ids.fact],
  section_order: ["experience"],
  evidence_priorities: [{ fact_revision_id: ids.fact, priority: "must_use" }],
  summary_decision: "omit",
  omissions: [],
};

const targetAnalysis = {
  metadata: { revision_id: ids.analysis },
  parent_general_definition_revision_id: ids.definition,
  job_revision_id: ids.job,
  strategy_revision_id: ids.strategy,
  outcome: "targeted_variant",
  analysis_state: "ready_for_targeted_draft",
  material_changes: [{ statement_id: ids.statement, action: "faithful_wording", supporting_confirmed_fact_revision_ids: [ids.fact] }],
};

const revisionRequest = {
  metadata: { revision_id: ids.request },
  source_definition_revision_id: ids.definition,
  state: "submitted",
  request_text: "Make the selected line more concise.",
  target: { scope: "statement", target_id: ids.statement },
};

const repairScope = {
  source_definition_revision_id: ids.definition,
  source_report_revision_id: ids.report,
  allowed_statement_ids: [ids.statement],
  correction_class: "specificity",
};

const craftReport = {
  metadata: { revision_id: ids.report },
  proposal_definition_revision_id: ids.definition,
  findings: [{ finding_id: ids.finding, criterion: "C1", severity: "blocking", correction_class: "specificity", statement_id: ids.statement }],
};

type LoosePurpose = Exclude<keyof typeof RESUME_INFERENCE_PROGRAMS, "general_resume_draft" | "resume_strategy">;

function inputFor(purpose: LoosePurpose, purposeBlocks: ReturnType<typeof block>[]) {
  return {
    purpose,
    data_blocks: [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", confirmedFacts), ...purposeBlocks],
    prompt_policy_id: "braindrive.resume-builder.fixed",
    prompt_policy_version: "12",
  };
}

const interviewInput = inputFor("interview_assist", [block("job_evidence_summary", "resume.job-evidence-summary.v2", {
  active_job_fact_revision_id: ids.jobFact,
  requested_opportunity_id: ids.opportunity,
  requested_dimension: "accomplishments",
  opportunity_kind: "qualitative",
  value_category: "distinct_accomplishment",
})]);

const jobInput = inputFor("job_description_analyze", [block("job_description", "resume.job-description.v1", job)]);
const evidenceInput = inputFor("requirement_evidence_match", [
  block("job_description", "resume.job-description.v1", job),
  block("job_analysis", "resume.job-analysis.v1", { requirements: [requirement] }),
]);
const tailoringInput = inputFor("tailoring_plan", [
  block("general_resume_definition", "resume.definition.v1", definition),
  block("job_description", "resume.job-description.v1", job),
  block("resume_strategy", "resume.strategy-record.v1", strategy),
  block("evidence_matrix", "resume.requirement-evidence.v1", [evidenceMatrixRow]),
  block("target_fit_policy", "resume.target-fit-policy.v1", { policy_id: "resume.target-fit.material-change", policy_version: "1" }),
]);
const targetedInput = inputFor("targeted_resume_draft", [
  block("general_resume_definition", "resume.definition.v1", definition),
  block("job_description", "resume.job-description.v1", job),
  block("resume_strategy", "resume.strategy-record.v1", strategy),
  block("target_fit_analysis", "resume.target-fit-analysis.v1", targetAnalysis),
]);
const revisionInput = inputFor("resume_revision_classify", [
  block("general_resume_definition", "resume.definition.v1", definition),
  block("revision_instruction", "resume.revision-request.v1", revisionRequest),
]);
const revisionDraftInput = inputFor("resume_revision_draft", [
  block("general_resume_definition", "resume.definition.v1", definition),
  block("revision_instruction", "resume.revision-request.v1", { ...revisionRequest, state: "generating", classification: "presentation" }),
]);
const guidanceInput = inputFor("resume_guidance", [
  block("general_resume_definition", "resume.definition.v1", definition),
  block("deterministic_findings", "resume.quality-findings.v1", { findings: [] }),
]);
const craftInput = inputFor("resume_craft_evaluate", [
  block("general_resume_definition", "resume.definition.v1", definition),
  block("resume_strategy", "resume.strategy-record.v1", strategy),
]);
const repairInput = inputFor("resume_craft_repair", [
  block("general_resume_definition", "resume.definition.v1", definition),
  block("resume_strategy", "resume.strategy-record.v1", strategy),
  block("craft_quality_report", "resume.craft-quality-report.v1", craftReport),
  block("craft_repair_scope", "resume.craft-repair-scope.v2", repairScope),
]);

const interviewCandidate = {
  questions: [{
    question_id: ids.question,
    job_fact_revision_id: ids.jobFact,
    opportunity_id: ids.opportunity,
    dimension: "accomplishments",
    opportunity_kind: "qualitative",
    value_category: "distinct_accomplishment",
    selection_method: "deterministic_value",
    prompt: "What outcome from this role would you like to document?",
    rationale: "This asks about the selected evidence opportunity only.",
  }],
};

const tailoringCandidate = {
  plan_version: 2,
  threshold_policy_id: "resume.target-fit.material-change",
  threshold_policy_version: "1",
  fit_class: "meaningfully_supported",
  outcome: "targeted_variant",
  no_change_reason: null,
  support_counts: { core: 1, transferable: 0, partial: 0, unsupported: 0 },
  changes: [{
    change_id: ids.change,
    requirement_id: ids.requirement,
    statement_id: ids.statement,
    action: "faithful_wording",
    rationale: "The confirmed fact supports a bounded wording change.",
    supporting_confirmed_fact_revision_ids: [ids.fact],
  }],
};

const targetedCandidate = {
  parent_general_definition_revision_id: ids.definition,
  job_revision_id: ids.job,
  title: definition.title,
  statements: [{ ...statement, text: "Documented synthetic confirmed evidence" }],
  changed_statement_ids: [ids.statement],
  section_order: ["experience"],
};

const classificationCandidate = {
  classification: "presentation",
  target: revisionRequest.target,
  clarification: null,
  proposed_fact_changes: [],
};

const revisionDraftCandidate = {
  source_definition_revision_id: ids.definition,
  revision_request_revision_id: ids.request,
  title: definition.title,
  statements: [{ ...statement, text: "Synthetic evidence" }],
  section_order: ["experience"],
  changed_statement_ids: [ids.statement],
};

const guidanceCandidate = {
  guidance_version: 1,
  items: [{
    category: "strong_evidence",
    evidence_revision_ids: [ids.fact],
    evidence_labels: ["Confirmed evidence"],
    message: "This statement is supported by confirmed evidence.",
  }],
  optional_questions: [],
};

const craftCandidate = {
  judgments: Array.from({ length: 7 }, () => ({ verdict: "pass", evidence_indexes: [0], findings: [] })),
};

const repairCandidate = {
  repair_version: 2,
  source_definition_revision_id: ids.definition,
  source_report_revision_id: ids.report,
  changed_statement_ids: [ids.statement],
  title: definition.title,
  statements: [{ ...statement, text: "Synthetic confirmed evidence, stated specifically" }],
  section_order: ["experience"],
};

const matrix = [
  {
    purpose: "interview_assist",
    input: interviewInput,
    valid: interviewCandidate,
    wrongType: { questions: "not-an-array" },
    invalid: { ...interviewCandidate, questions: [{ ...interviewCandidate.questions[0], opportunity_id: ids.foreignOpportunity }] },
    issue: /active-opportunity-mismatch$/,
    terminal: "fallback",
  },
  {
    purpose: "job_description_analyze",
    input: jobInput,
    valid: { requirements: [requirement] },
    wrongType: { requirements: "not-an-array" },
    invalid: { requirements: [{ ...requirement, source_span: "A source span that is not present." }] },
    issue: /source-span-invalid$/,
    terminal: "failed",
  },
  {
    purpose: "requirement_evidence_match",
    input: evidenceInput,
    valid: { evidence: [evidenceRow] },
    wrongType: { evidence: "not-an-array" },
    invalid: { evidence: [evidenceRow, { ...evidenceRow }] },
    issue: /requirement-(?:set-mismatch|duplicate)$/,
    terminal: "fallback",
  },
  {
    purpose: "tailoring_plan",
    input: tailoringInput,
    valid: tailoringCandidate,
    wrongType: { ...tailoringCandidate, plan_version: "2" },
    invalid: { ...tailoringCandidate, changes: [{ ...tailoringCandidate.changes[0], statement_id: ids.foreignStatement }] },
    issue: /change-binding-invalid$/,
    terminal: "fallback",
  },
  {
    purpose: "targeted_resume_draft",
    input: targetedInput,
    valid: targetedCandidate,
    wrongType: { ...targetedCandidate, title: 404 },
    invalid: { ...targetedCandidate, statements: [{ ...targetedCandidate.statements[0], supporting_confirmed_fact_revision_ids: [ids.foreignFact] }] },
    issue: /statement-evidence-binding-invalid$/,
    terminal: "fallback",
  },
  {
    purpose: "resume_revision_classify",
    input: revisionInput,
    valid: classificationCandidate,
    wrongType: { ...classificationCandidate, classification: 404 },
    invalid: { ...classificationCandidate, classification: "guess" },
    issue: /schema-classification-invalid$/,
    terminal: "fallback",
  },
  {
    purpose: "resume_revision_draft",
    input: revisionDraftInput,
    valid: revisionDraftCandidate,
    wrongType: { ...revisionDraftCandidate, statements: "not-an-array" },
    invalid: { ...revisionDraftCandidate, revision_request_revision_id: ids.foreignOpportunity },
    issue: /lineage-binding-invalid$/,
    terminal: "failed",
  },
  {
    purpose: "resume_guidance",
    input: guidanceInput,
    valid: guidanceCandidate,
    wrongType: { ...guidanceCandidate, items: "not-an-array" },
    invalid: { ...guidanceCandidate, items: [{ ...guidanceCandidate.items[0], evidence_revision_ids: [ids.foreignFact] }] },
    issue: /evidence-binding-invalid$/,
    terminal: "fallback",
  },
  {
    purpose: "resume_craft_evaluate",
    input: craftInput,
    valid: craftCandidate,
    wrongType: { judgments: "not-an-array" },
    invalid: { judgments: craftCandidate.judgments.slice(0, 6) },
    issue: /schema-criterion-set-mismatch$/,
    terminal: "fallback-or-failed",
  },
  {
    purpose: "resume_craft_repair",
    input: repairInput,
    valid: repairCandidate,
    wrongType: { ...repairCandidate, repair_version: "2" },
    invalid: { ...repairCandidate, changed_statement_ids: [ids.foreignStatement] },
    issue: /repair-scope-(?:invalid|mismatch)$/,
    terminal: "failed",
  },
] as const;

function adjudicate(entry: (typeof matrix)[number], attempt: 1 | 2, candidate: unknown) {
  return adjudicateResumeInference({
    program: RESUME_INFERENCE_PROGRAMS[entry.purpose],
    input: entry.input,
    attempt,
    candidate,
  });
}

describe("Resume Builder strict validation and recovery matrix", () => {
  it.each(matrix)("accepts a valid first $purpose candidate", (entry) => {
    expect(adjudicate(entry, 1, entry.valid)).toMatchObject({ decision: "accepted", issue_ids: [] });
  });

  it.each(matrix)("independently rejects unknown $purpose fields", (entry) => {
    const result = adjudicate(entry, 1, { ...entry.valid, fixture_poison: "must not cross persistence" });
    expect(result.decision).toBe("retry");
    expect(result.issue_ids.length).toBeGreaterThan(0);
    expect(result.issue_ids.every((issueId: unknown) => typeof issueId === "string" && issueId.startsWith(`${RESUME_INFERENCE_PROGRAMS[entry.purpose].id}/schema-`))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("must not cross persistence");
  });

  it.each(matrix)("independently rejects wrong $purpose field types", (entry) => {
    const result = adjudicate(entry, 1, entry.wrongType);
    expect(result.decision).toBe("retry");
    expect(result.issue_ids.length).toBeGreaterThan(0);
    expect(result.issue_ids.every((issueId: unknown) => typeof issueId === "string" && issueId.startsWith(`${RESUME_INFERENCE_PROGRAMS[entry.purpose].id}/`))).toBe(true);
  });

  it.each(matrix)("carries precise $purpose issues into exactly one corrective request", (entry) => {
    const first = adjudicate(entry, 1, entry.invalid);
    expect(first.decision).toBe("retry");
    expect(first.issue_ids.length).toBeGreaterThan(0);
    expect(first.issue_ids[0]).toMatch(entry.issue);
    expect(first.issue_ids.every((issueId: unknown) => typeof issueId === "string" && issueId.startsWith(`${RESUME_INFERENCE_PROGRAMS[entry.purpose].id}/`))).toBe(true);

    const repair = prepareResumeInference({
      program: RESUME_INFERENCE_PROGRAMS[entry.purpose],
      input: entry.input,
      attempt: 2,
      previous: { candidate: entry.invalid, issue_ids: first.issue_ids },
    });
    const payload = JSON.parse(repair.user);
    expect(repair.attempt).toBe(2);
    expect(payload.repair.issue_ids).toEqual(first.issue_ids);
    expect(payload.repair.prior_candidate).toEqual(entry.invalid);
    expect(payload.repair.instruction).toEqual(expect.any(String));
    expect(payload.repair.instruction.length).toBeGreaterThan(20);

    const terminal = adjudicate(entry, 2, entry.invalid);
    if (entry.terminal === "fallback-or-failed") {
      expect(["fallback", "failed"]).toContain(terminal.decision);
      if (terminal.decision === "fallback") {
        expect(terminal.result).toMatchObject({ evidence_context: "limited", verdict: "fail" });
        expect(terminal.result.criterion_verdicts.every((item: { verdict: string }) => item.verdict !== "pass")).toBe(true);
      }
    } else {
      expect(terminal.decision).toBe(entry.terminal);
    }
    expect(terminal.issue_ids).toEqual(first.issue_ids);

    if (entry.purpose === "interview_assist" && terminal.decision === "fallback") {
      expect(terminal.result.questions).toHaveLength(1);
      expect(terminal.result.questions[0]).toMatchObject({
        job_fact_revision_id: ids.jobFact,
        opportunity_id: ids.opportunity,
        selection_method: "deterministic_value",
      });
    }
    if (["tailoring_plan", "targeted_resume_draft"].includes(entry.purpose) && terminal.decision === "fallback") {
      expect(terminal.result).toMatchObject({ outcome: "no_meaningful_change" });
    }
    if (entry.purpose === "resume_revision_classify" && terminal.decision === "fallback") {
      expect(terminal.result).toMatchObject({ classification: "ambiguous", target: revisionRequest.target });
      expect(terminal.result.clarification).toEqual(expect.any(String));
    }
    if (entry.purpose === "requirement_evidence_match" && terminal.decision === "fallback") {
      expect(terminal.result.evidence).toHaveLength(1);
      expect(["unsupported", "clarification_needed"]).toContain(terminal.result.evidence[0].evidence_status);
    }
    if (entry.purpose === "resume_guidance" && terminal.decision === "fallback") {
      expect(terminal.result).toMatchObject({ guidance_version: 1, optional_questions: [] });
    }
  });
});

describe("Resume Builder inference holdouts and anti-overfit canary", () => {
  it("accepts a reordered large disjoint requirement matrix and rejects duplicates and foreign identities", () => {
    const holdoutRequirements = Array.from({ length: 37 }, (_, index) => ({
      requirement_id: `73000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      requirement_kind: index % 2 === 0 ? "required" : "responsibility",
      source_span: `Synthetic requirement span ${index + 1}`,
      inferred: false,
      normalized_requirement: `Synthetic normalized requirement ${index + 1}`,
    }));
    const description = holdoutRequirements.map((item) => item.source_span).join("\n");
    const facts = holdoutRequirements.map((item, index) => ({
      revision_id: `74000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      fact_kind: "accomplishment",
      value: `Synthetic holdout fact ${index + 1}`,
      source_revision_ids: [],
    }));
    const data = {
      purpose: "requirement_evidence_match",
      data_blocks: [
        block("job_analysis", "resume.job-analysis.v1", { requirements: [...holdoutRequirements].reverse() }),
        block("job_description", "resume.job-description.v1", { metadata: { revision_id: ids.job }, description_text: description }),
        block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts: [...facts].reverse() }),
      ],
      prompt_policy_id: "braindrive.resume-builder.fixed",
      prompt_policy_version: "12",
    };
    const evidence = holdoutRequirements.map((item, index) => ({
      requirement_id: item.requirement_id,
      evidence_status: "supported",
      supporting_confirmed_fact_revision_ids: [facts[index].revision_id],
      explanation: "The disjoint confirmed fact is bound explicitly.",
      clarification: null,
    }));
    const accepted = adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.requirement_evidence_match,
      input: data,
      attempt: 1,
      candidate: { evidence },
    });
    expect(accepted).toMatchObject({ decision: "accepted", issue_ids: [] });

    const duplicate = adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.requirement_evidence_match,
      input: data,
      attempt: 1,
      candidate: { evidence: [...evidence.slice(0, -1), evidence[0]] },
    });
    expect(duplicate).toMatchObject({ decision: "retry" });
    expect(duplicate.issue_ids.join(" ")).toMatch(/requirement-(?:set-mismatch|duplicate)/);

    const foreign = adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.requirement_evidence_match,
      input: data,
      attempt: 1,
      candidate: { evidence: evidence.map((item, index) => index === 0 ? { ...item, supporting_confirmed_fact_revision_ids: [ids.foreignFact] } : item) },
    });
    expect(foreign).toMatchObject({ decision: "retry" });
    expect(foreign.issue_ids.join(" ")).toMatch(/evidence-binding-invalid/);
  });

  it("keeps fixture identities, text, positive exact-count branches, and test namespaces out of production source", async () => {
    const source = await readFile(new URL("../resources/inference-program.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/71000000-0000-4000-8000|72000000-0000-4000-8000|73000000-0000-4000-8000|74000000-0000-4000-8000/);
    expect(source).not.toMatch(/Synthetic (?:confirmed|requirement|holdout|normalized|role)/);
    expect(source).not.toMatch(/(?:facts|jobs|requirements)\.length\s*===\s*[1-9]\d*/);
    expect(source).not.toMatch(/(?:fixture|test_only|known_fixture|holdout_fixture)/i);
    expect(source).not.toMatch(/(?:provider|prompt).{0,80}(?:fixture|71000000|73000000)/i);
  });
});
