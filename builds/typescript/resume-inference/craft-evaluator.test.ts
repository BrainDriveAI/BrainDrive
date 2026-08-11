import { describe, expect, it } from "vitest";

import {
  CRAFT_EVIDENCE_LIMITED_POLICY,
  evaluateCraftProposal,
  validateCraftEvaluationResult,
  type CraftEvaluationContext,
} from "./craft-evaluator.js";

const FACT_ID = "81000000-0000-4000-8000-000000000001";
const JOB_ID = "81000000-0000-4000-8000-000000000002";

function context(overrides: Partial<CraftEvaluationContext> = {}): CraftEvaluationContext {
  const statements = [
    { statement_id: "81000000-0000-4000-8000-000000000010", section_id: "contact", display_role: "line" as const, kind: "factual" as const, text: "owner@example.test", supporting_confirmed_fact_revision_ids: [FACT_ID] },
    { statement_id: "81000000-0000-4000-8000-000000000011", section_id: "experience", display_role: "heading" as const, kind: "factual" as const, text: "Operations Coordinator | Synthetic Org | 2022–Present", supporting_confirmed_fact_revision_ids: [JOB_ID] },
    { statement_id: "81000000-0000-4000-8000-000000000012", section_id: "experience", display_role: "bullet" as const, kind: "factual" as const, text: "Coordinated weekly service schedules across three teams.", supporting_confirmed_fact_revision_ids: [FACT_ID] },
    { statement_id: "81000000-0000-4000-8000-000000000013", section_id: "experience", display_role: "bullet" as const, kind: "factual" as const, text: "Resolved handoff delays by documenting the shared intake process.", supporting_confirmed_fact_revision_ids: [FACT_ID] },
    { statement_id: "81000000-0000-4000-8000-000000000014", section_id: "education", display_role: "line" as const, kind: "factual" as const, text: "Synthetic University", supporting_confirmed_fact_revision_ids: [FACT_ID] },
  ];
  return {
    definition_kind: "general",
    title: "Zoë Synthetic",
    statements,
    section_order: ["contact", "experience", "education"],
    selected_fact_revision_ids: [FACT_ID, JOB_ID],
    strategy: {
      history_shape: "established",
      summary_decision: "omit",
      section_order: ["contact", "experience", "education"],
      evidence_priorities: [{ fact_revision_id: FACT_ID, priority: "must_use" }],
      omissions: [],
      unresolved_gap_ids: [],
    },
    target_analysis: null,
    deterministic_truth_passed: true,
    deterministic_structure_passed: true,
    ...overrides,
  };
}

describe("independent Resume Quality craft evaluator", () => {
  it("evaluates every C1-C7 criterion without a numeric score and marks T1-T3 not applicable", () => {
    const result = evaluateCraftProposal(context());
    expect(result.verdict).toBe("pass");
    expect(result.criterion_verdicts.map((item) => item.criterion)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "T1", "T2", "T3"]);
    expect(result.criterion_verdicts.filter((item) => item.criterion.startsWith("T")).every((item) => item.verdict === "not_applicable")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/score|rating|percentage/i);
  });

  it.each([
    ["Responsible for customer requests.", "C2", "duty_only"],
    ["Results-driven rockstar delivering world-class excellence.", "C3", "generic_language"],
    ["Leveraged synergistic solutions to optimize dynamic workflows.", "C6", "generic_language"],
  ] as const)("names the exact weak statement for %s", (text, criterion, correctionClass) => {
    const base = context();
    const statement = { ...base.statements[2]!, text };
    const result = evaluateCraftProposal({ ...base, statements: base.statements.map((item, index) => index === 2 ? statement : item) });
    expect(result.verdict).toBe("fail");
    expect(result.findings).toContainEqual(expect.objectContaining({ criterion, statement_id: statement.statement_id, correction_class: correctionClass, severity: "blocking" }));
  });

  it("reports explicit absence when must-use evidence is omitted", () => {
    const base = context();
    const result = evaluateCraftProposal({ ...base, statements: base.statements.map((statement) => ({ ...statement, supporting_confirmed_fact_revision_ids: statement.supporting_confirmed_fact_revision_ids.filter((id) => id !== FACT_ID) })) });
    expect(result.findings).toContainEqual(expect.objectContaining({ criterion: "C2", statement_id: null, correction_class: "organization", evidence_category: "must_use_evidence", evidence_revision_ids: [FACT_ID] }));
  });

  it("applies the provisional evidence-limited rule without padding or bypass", () => {
    const base = context();
    const limited = evaluateCraftProposal({
      ...base,
      statements: [base.statements[1]!, base.statements[2]!],
      section_order: ["experience"],
      strategy: { ...base.strategy, history_shape: "thin", section_order: ["experience"], unresolved_gap_ids: ["81000000-0000-4000-8000-000000000020"] },
    });
    expect(CRAFT_EVIDENCE_LIMITED_POLICY.authority_status).toBe("provisional_planning_default");
    expect(limited).toMatchObject({ evidence_context: "limited", verdict: "pass" });
    expect(limited.findings).toContainEqual(expect.objectContaining({ criterion: "C7", severity: "guidance", statement_id: null, evidence_category: "optional_gap" }));
  });

  it("fails closed when truth or structure has already failed", () => {
    const result = evaluateCraftProposal(context({ deterministic_truth_passed: false }));
    expect(result.verdict).toBe("fail");
    expect(result.findings).toContainEqual(expect.objectContaining({ criterion: "C1", evidence_category: "deterministic_gate", severity: "blocking" }));
  });

  it("enforces summary strategy, evidence-shaped ordering, and neutral gap language", () => {
    const base = context();
    const summaryRequired = evaluateCraftProposal({ ...base, strategy: { ...base.strategy, summary_decision: "include" } });
    expect(summaryRequired.findings).toContainEqual(expect.objectContaining({ criterion: "C4", statement_id: null, correction_class: "organization" }));

    const wrongOrder = evaluateCraftProposal({ ...base, section_order: ["experience", "contact", "education"] });
    expect(wrongOrder.findings).toContainEqual(expect.objectContaining({ criterion: "C5", statement_id: null, correction_class: "organization" }));

    const defensive = { ...base.statements[2]!, text: "Despite the gap, resolved handoff delays." };
    const gapLanguage = evaluateCraftProposal({ ...base, statements: base.statements.map((statement, index) => index === 2 ? defensive : statement) });
    expect(gapLanguage.findings).toContainEqual(expect.objectContaining({ criterion: "C7", statement_id: defensive.statement_id, severity: "blocking" }));
  });

  it("fails every targeted criterion when current supported target analysis is absent", () => {
    const result = evaluateCraftProposal(context({ definition_kind: "targeted", target_analysis: null }));
    expect(result.criterion_verdicts.filter((item) => item.criterion.startsWith("T"))).toEqual([
      expect.objectContaining({ criterion: "T1", verdict: "fail" }),
      expect.objectContaining({ criterion: "T2", verdict: "fail" }),
      expect.objectContaining({ criterion: "T3", verdict: "fail" }),
    ]);
  });

  it("requires tailored T1-T3 evidence and rejects evaluator disagreement", () => {
    const base = context({
      definition_kind: "targeted",
      target_analysis: { outcome: "targeted_variant", fit_class: "meaningfully_supported", material_changes: [{ statement_id: "81000000-0000-4000-8000-000000000012", requirement_id: "81000000-0000-4000-8000-000000000030", supporting_confirmed_fact_revision_ids: [FACT_ID] }] },
    });
    const expected = evaluateCraftProposal(base);
    expect(expected.criterion_verdicts.filter((item) => item.criterion.startsWith("T")).every((item) => item.verdict === "pass")).toBe(true);
    const dishonest = { ...expected, verdict: "pass" as const, criterion_verdicts: expected.criterion_verdicts.map((item) => item.criterion === "C2" ? { ...item, verdict: "pass" as const, finding_ids: [] } : item), findings: [] };
    const weak = { ...base, statements: base.statements.map((item, index) => index === 2 ? { ...item, text: "Responsible for customer requests." } : item) };
    expect(validateCraftEvaluationResult(dishonest, weak)).toContainEqual(expect.objectContaining({ code: "evaluator_disagreement" }));
  });
});
