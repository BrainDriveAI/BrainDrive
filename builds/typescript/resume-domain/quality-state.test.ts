import { describe, expect, it } from "vitest";

import { CRAFT_EVIDENCE_LIMITED_POLICY, evaluateCraftProposal, type CraftEvaluationContext } from "../resume-inference/craft-evaluator.js";
import {
  adjudicateResumeQualityState,
  projectResumeOwnerReview,
  resumeQualityStateLabel,
  type ResumeQualityAdjudicationInput,
} from "./quality-state.js";

const id = (suffix: number) => `82000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

function report(evidenceContext: "standard" | "limited" = "standard") {
  const context: CraftEvaluationContext = {
    definition_revision_id: id(1), strategy_revision_id: id(2), definition_kind: "general", title: "Synthetic Owner",
    statements: [
      { statement_id: id(3), section_id: "contact", display_role: "line", kind: "factual", text: "owner@example.test", supporting_confirmed_fact_revision_ids: [id(4)] },
      { statement_id: id(5), section_id: "experience", display_role: "heading", kind: "factual", text: "Coordinator | Synthetic Org | 2022–Present", supporting_confirmed_fact_revision_ids: [id(6)] },
      { statement_id: id(7), section_id: "experience", display_role: "bullet", kind: "factual", text: "Coordinated weekly service schedules across three teams.", supporting_confirmed_fact_revision_ids: [id(4)] },
    ],
    section_order: ["contact", "experience"], selected_fact_revision_ids: [id(4), id(6)], fact_revision_ids: [id(4), id(6)], coverage_revision_ids: [],
    strategy: { history_shape: evidenceContext === "limited" ? "early_career" : "chronological_standard", summary_decision: "omit", section_order: ["contact", "experience"], evidence_priorities: [{ fact_revision_id: id(4), priority: "must_use" }, { fact_revision_id: id(6), priority: "must_use" }], omissions: [], unresolved_gap_ids: evidenceContext === "limited" ? [id(8)] : [] },
    target_analysis: null, deterministic_truth_passed: true, deterministic_structure_passed: true, deterministic_mechanical_passed: true,
    deterministic_gate_digest: `sha256:${"a".repeat(64)}`,
  };
  return evaluateCraftProposal(context);
}

function input(overrides: Partial<ResumeQualityAdjudicationInput> = {}): ResumeQualityAdjudicationInput {
  return {
    definition_status: "proposed",
    approval_contract_version: null,
    deterministic_truth_passed: true,
    deterministic_structure_passed: true,
    deterministic_mechanical_passed: true,
    review_disposition: "available",
    bindings_current: true,
    report: report(),
    evidence_limited_policy: CRAFT_EVIDENCE_LIMITED_POLICY,
    ...overrides,
  };
}

describe("resume quality-state adjudication", () => {
  it("distinguishes not-run, incomplete, correction, product-pass, owner-approved, and historical states", () => {
    expect(adjudicateResumeQualityState(input({ review_disposition: "not_run", report: null }))).toBe("review_not_run");
    for (const review_disposition of ["unavailable", "malformed", "incompatible", "disputed"] as const) {
      expect(adjudicateResumeQualityState(input({ review_disposition, report: null })), review_disposition).toBe("review_incomplete");
    }
    expect(adjudicateResumeQualityState(input({ bindings_current: false }))).toBe("review_incomplete");
    expect(adjudicateResumeQualityState(input({ deterministic_truth_passed: false }))).toBe("needs_correction");
    const failed = structuredClone(report());
    failed.verdict = "fail";
    failed.criterion_verdicts[0]!.verdict = "fail";
    expect(adjudicateResumeQualityState(input({ report: failed }))).toBe("needs_correction");
    expect(adjudicateResumeQualityState(input())).toBe("product_craft_passed");
    expect(adjudicateResumeQualityState(input({ definition_status: "approved", approval_contract_version: 2 }))).toBe("owner_approved");
    expect(adjudicateResumeQualityState(input({ definition_status: "approved", approval_contract_version: 1, report: null, review_disposition: "not_run" }))).toBe("pre_correction_review");
  });

  it("persists accepted evidence-limited state and fails closed without accepted authority", () => {
    const limited = report("limited");
    expect(adjudicateResumeQualityState(input({ report: limited }))).toBe("evidence_limited");
    expect(adjudicateResumeQualityState(input({
      report: limited,
      evidence_limited_policy: { ...CRAFT_EVIDENCE_LIMITED_POLICY, authority_status: "missing_authority" },
    }))).toBe("review_incomplete");
    expect(adjudicateResumeQualityState(input({ report: limited, evidence_limited_policy: null }))).toBe("review_incomplete");
  });

  it("fails closed on missing report and malformed criterion accounting", () => {
    expect(adjudicateResumeQualityState(input({ report: null }))).toBe("review_incomplete");
    const malformed = structuredClone(report());
    malformed.criterion_verdicts.pop();
    expect(adjudicateResumeQualityState(input({ report: malformed }))).toBe("review_incomplete");
  });

  it("projects every durable state to narrow score-free copy and policy-safe actions", () => {
    const cases = [
      ["review_not_run", "Review not run", ["run_review", "manual_revision", "keep_prior_approved", "exit"]],
      ["review_incomplete", "Product craft review incomplete", ["run_review", "manual_revision", "keep_prior_approved", "exit"]],
      ["needs_correction", "Needs correction", ["bounded_repair", "manual_revision", "keep_prior_approved", "exit"]],
      ["evidence_limited", "More evidence could strengthen this resume", ["add_evidence", "manual_revision", "keep_prior_approved", "exit"]],
      ["product_craft_passed", "Product craft review passed", ["approve_definition", "manual_revision", "keep_prior_approved", "exit"]],
      ["owner_approved", "Owner approved", ["continue", "exit"]],
      ["pre_correction_review", "Previously approved — corrected review not run", ["manual_revision", "keep_prior_approved", "exit"]],
    ] as const;

    for (const [state, label, actions] of cases) {
      const correctionAction = state === "needs_correction"
        ? { action: "repair_statement" as const }
        : state === "evidence_limited"
          ? { action: "add_evidence" as const }
          : null;
      expect(projectResumeOwnerReview(state, correctionAction)).toMatchObject({ quality_state: state, status_label: label, actions });
      expect(resumeQualityStateLabel(state)).toBe(label);
    }

    expect(JSON.stringify(cases)).not.toMatch(/independent review passed|score/i);
  });

  it("keeps correction routes semantically distinct without creating approval authority", () => {
    expect(projectResumeOwnerReview("needs_correction", { action: "repair_statement" }).actions[0]).toBe("bounded_repair");
    expect(projectResumeOwnerReview("needs_correction", { action: "add_evidence" }).actions[0]).toBe("add_evidence");
    expect(projectResumeOwnerReview("needs_correction", { action: "manual_revision" }).actions[0]).toBe("manual_revision");
    expect(projectResumeOwnerReview("needs_correction", { action: "keep_prior_or_exit" }).actions).toEqual(["keep_prior_approved", "exit"]);
    expect(projectResumeOwnerReview("evidence_limited", { action: "add_evidence" }).actions).not.toContain("approve_definition");
    expect(projectResumeOwnerReview("review_incomplete", null).actions).not.toContain("approve_definition");
  });
});
