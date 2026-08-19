import { describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { deriveCraftCorrectionAction, validateCraftRepair } from "./craft-repair.js";

const SOURCE_ID = "82000000-0000-4000-8000-000000000001";
const REPORT_ID = "82000000-0000-4000-8000-000000000002";
const FACT_ID = "82000000-0000-4000-8000-000000000003";
const CHANGED_ID = "82000000-0000-4000-8000-000000000004";
const UNCHANGED_ID = "82000000-0000-4000-8000-000000000005";

const source = {
  metadata: { revision_id: SOURCE_ID },
  title: "Synthetic Resume",
  statements: [
    { statement_id: CHANGED_ID, section_id: "experience", display_role: "bullet" as const, kind: "factual" as const, text: "Responsible for service requests.", supporting_confirmed_fact_revision_ids: [FACT_ID] },
    { statement_id: UNCHANGED_ID, section_id: "education", display_role: "line" as const, kind: "factual" as const, text: "Synthetic University", supporting_confirmed_fact_revision_ids: [FACT_ID] },
  ],
  section_order: ["experience", "education"],
};
const report = {
  metadata: { revision_id: REPORT_ID },
  proposal_definition_revision_id: SOURCE_ID,
  verdict: "fail" as const,
  findings: [{ finding_id: "82000000-0000-4000-8000-000000000006", criterion: "C2" as const, statement_id: CHANGED_ID, severity: "blocking" as const, correction_class: "duty_only" as const, safe_message: "Use a concrete supported action.", evidence_category: "statement_support" as const, evidence_revision_ids: [FACT_ID] }],
};

function repair(overrides: Record<string, unknown> = {}) {
  return {
    repair_version: 1 as const,
    source_definition_revision_id: SOURCE_ID,
    source_report_revision_id: REPORT_ID,
    changed_statement_ids: [CHANGED_ID],
    title: source.title,
    statements: [{ ...source.statements[0]!, text: "Resolved service requests using the documented intake process." }, source.statements[1]!],
    section_order: source.section_order,
    ...overrides,
  };
}

describe("bounded craft repair preservation", () => {
  it("accepts one named wording change with exact support and structure preservation", () => {
    expect(validateCraftRepair(source, report, repair())).toEqual([]);
  });

  it.each([
    ["unnamed statement drift", { statements: [repair().statements[0], { ...source.statements[1]!, text: "Changed university" }] }, "unnamed_statement_changed"],
    ["support drift", { statements: [{ ...repair().statements[0], supporting_confirmed_fact_revision_ids: [] }, source.statements[1]!] }, "support_changed"],
    ["section order drift", { section_order: ["education", "experience"] }, "section_order_changed"],
    ["added statement", { statements: [...repair().statements, { ...source.statements[1]!, statement_id: "82000000-0000-4000-8000-000000000007" }] }, "statement_set_changed"],
    ["unplanned manifest", { changed_statement_ids: [UNCHANGED_ID] }, "repair_scope_changed"],
    ["title drift", { title: "Target Optimized Resume" }, "title_changed"],
  ] as const)("rejects %s", (_label, overrides, code) => {
    expect(validateCraftRepair(source, report, repair(overrides))).toContainEqual(expect.objectContaining({ code }));
  });

  it("rejects unsupported meaning added to a presentation-only statement", () => {
    const presentationSource = { ...source, statements: [{ ...source.statements[0]!, kind: "presentation" as const, supporting_confirmed_fact_revision_ids: [], text: "Responsible for routine work" }, source.statements[1]!] };
    const widened = repair({ statements: [{ ...presentationSource.statements[0]!, text: "Coordinated international operations" }, source.statements[1]!] });
    expect(validateCraftRepair(presentationSource, report, widened)).toContainEqual(expect.objectContaining({ code: "meaning_broadened" }));
  });
});

const OTHER_FINDING_ID = "82000000-0000-4000-8000-000000000008";
const STATEMENT_REF_ID = "82000000-0000-4000-8000-000000000009";
const ABSENCE_REF_ID = "82000000-0000-4000-8000-000000000010";
const COVERAGE_REF_ID = "82000000-0000-4000-8000-000000000011";
const COVERAGE_REVISION_ID = "82000000-0000-4000-8000-000000000012";
const COVERAGE_RECORD_ID = "82000000-0000-4000-8000-000000000013";
const JOB_REVISION_ID = "82000000-0000-4000-8000-000000000014";
const OPPORTUNITY_ID = "82000000-0000-4000-8000-000000000015";
const LOWER_RANKED_OPPORTUNITY_ID = "82000000-0000-4000-8000-000000000016";

function evidenceRef(overrides: Record<string, unknown>) {
  return {
    evidence_ref_id: STATEMENT_REF_ID,
    kind: "statement" as const,
    polarity: "negative" as const,
    statement_id: CHANGED_ID,
    revision_id: null,
    anchor_id: null,
    absence_code: null,
    evidence_digest: canonicalInputDigest(overrides),
    ...overrides,
  };
}

function v2Report(overrides: Record<string, unknown> = {}) {
  return {
    report_version: 2 as const,
    metadata: { revision_id: REPORT_ID },
    proposal_definition_revision_id: SOURCE_ID,
    verdict: "fail" as const,
    criterion_verdicts: [{
      criterion: "C2" as const,
      verdict: "fail" as const,
      evidence_refs: [evidenceRef({})],
      finding_ids: [OTHER_FINDING_ID],
    }],
    findings: [{
      finding_id: OTHER_FINDING_ID,
      criterion: "C2" as const,
      severity: "blocking" as const,
      correction_class: "duty_only" as const,
      safe_message: "Use a concrete supported action.",
      evidence_ref_ids: [STATEMENT_REF_ID],
    }],
    ...overrides,
  };
}

function coverage(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { record_id: COVERAGE_RECORD_ID, revision_id: COVERAGE_REVISION_ID, revision: 2 },
    job_fact_revision_id: JOB_REVISION_ID,
    opportunities: [
      { opportunity_id: LOWER_RANKED_OPPORTUNITY_ID, dimension: "scope" as const, opportunity_kind: "metric" as const, value_category: "scope_or_scale" as const, context_digest: canonicalInputDigest("scope"), state: "available" as const, suppression_reason: null, attempt_count: 1, reopened_at: null },
      { opportunity_id: OPPORTUNITY_ID, dimension: "accomplishments" as const, opportunity_kind: "qualitative" as const, value_category: "distinct_accomplishment" as const, context_digest: canonicalInputDigest("accomplishments"), state: "available" as const, suppression_reason: null, attempt_count: 1, reopened_at: null },
    ],
    ...overrides,
  };
}

describe("typed craft correction routing", () => {
  it("derives one statement repair with exact statement and correction-class scope", () => {
    expect(deriveCraftCorrectionAction(v2Report(), [])).toEqual({
      action: "repair_statement",
      source_definition_revision_id: SOURCE_ID,
      source_report_revision_id: REPORT_ID,
      statement_scope_ids: [CHANGED_ID],
      correction_class: "duty_only",
      attempt: 1,
    });
  });

  it("returns exactly one existing ranked material opportunity for explicit absence", () => {
    const absence = evidenceRef({ evidence_ref_id: ABSENCE_REF_ID, kind: "explicit_absence", polarity: "absence", statement_id: null, absence_code: "missing_accomplishment_evidence" });
    const coverageEvidence = evidenceRef({ evidence_ref_id: COVERAGE_REF_ID, kind: "coverage", polarity: "negative", statement_id: null, revision_id: COVERAGE_REVISION_ID });
    const action = deriveCraftCorrectionAction(v2Report({
      criterion_verdicts: [{ criterion: "C2", verdict: "fail", evidence_refs: [absence, coverageEvidence], finding_ids: [OTHER_FINDING_ID] }],
      findings: [{ ...v2Report().findings[0]!, evidence_ref_ids: [ABSENCE_REF_ID, COVERAGE_REF_ID] }],
    }), [coverage()]);

    expect(action).toEqual({
      action: "add_evidence",
      source_definition_revision_id: SOURCE_ID,
      source_report_revision_id: REPORT_ID,
      coverage_record_id: COVERAGE_RECORD_ID,
      coverage_revision_id: COVERAGE_REVISION_ID,
      coverage_revision: 2,
      job_fact_revision_id: JOB_REVISION_ID,
      opportunity_id: OPPORTUNITY_ID,
      dimension: "accomplishments",
      opportunity_kind: "qualitative",
      value_category: "distinct_accomplishment",
      context_digest: canonicalInputDigest("accomplishments"),
      attempt: 1,
    });
  });

  it("does not re-offer declined evidence and writes no substitute action", () => {
    const absence = evidenceRef({ evidence_ref_id: ABSENCE_REF_ID, kind: "explicit_absence", polarity: "absence", statement_id: null, absence_code: "missing_accomplishment_evidence" });
    const action = deriveCraftCorrectionAction(v2Report({
      criterion_verdicts: [{ criterion: "C2", verdict: "fail", evidence_refs: [absence], finding_ids: [OTHER_FINDING_ID] }],
      findings: [{ ...v2Report().findings[0]!, evidence_ref_ids: [ABSENCE_REF_ID] }],
    }), [coverage({ opportunities: [{ ...coverage().opportunities[1]!, state: "suppressed", suppression_reason: "owner_declined" }] })]);

    expect(action).toMatchObject({ action: "keep_prior_or_exit", reason: "no_material_evidence_opportunity" });
  });

  it("routes supported non-statement findings to manual revision", () => {
    const strategy = evidenceRef({ kind: "strategy", polarity: "negative", statement_id: null, revision_id: "82000000-0000-4000-8000-000000000017" });
    expect(deriveCraftCorrectionAction(v2Report({
      criterion_verdicts: [{ criterion: "C5", verdict: "fail", evidence_refs: [strategy], finding_ids: [OTHER_FINDING_ID] }],
      findings: [{ ...v2Report().findings[0]!, criterion: "C5", correction_class: "organization", evidence_ref_ids: [STATEMENT_REF_ID] }],
    }), [])).toMatchObject({ action: "manual_revision", finding_ids: [OTHER_FINDING_ID] });
  });

  it("keeps the prior version when blockers require mixed repair authorities", () => {
    const secondRef = evidenceRef({ evidence_ref_id: ABSENCE_REF_ID, statement_id: UNCHANGED_ID });
    expect(deriveCraftCorrectionAction(v2Report({
      criterion_verdicts: [{ criterion: "C2", verdict: "fail", evidence_refs: [evidenceRef({}), secondRef], finding_ids: [OTHER_FINDING_ID, "82000000-0000-4000-8000-000000000018"] }],
      findings: [
        v2Report().findings[0]!,
        { ...v2Report().findings[0]!, finding_id: "82000000-0000-4000-8000-000000000018", correction_class: "specificity", evidence_ref_ids: [ABSENCE_REF_ID] },
      ],
    }), [])).toMatchObject({ action: "keep_prior_or_exit", reason: "mixed_repair_authority" });
  });
});
