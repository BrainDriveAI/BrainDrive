import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { FrozenQualityRegressionManifestSchema } from "../app-platform/contracts/data.js";
import {
  CRAFT_EVIDENCE_LIMITED_POLICY,
  CRAFT_EVIDENCE_LIMITED_POLICY_DIGEST,
  PRODUCT_CRAFT_EVALUATOR,
  evaluateCraftProposal,
  extractCraftAnchorEvidence,
  validateCraftEvaluationResult,
  type CraftEvaluationContext,
  type CraftEvaluationResult,
} from "./craft-evaluator.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "./policy.js";
import { RESUME_QUALITY_STANDARD_DIGEST } from "./strategy.js";

const FACT_ID = "81000000-0000-4000-8000-000000000001";
const JOB_ID = "81000000-0000-4000-8000-000000000002";
const DEFINITION_ID = "81000000-0000-4000-8000-000000000003";
const STRATEGY_ID = "81000000-0000-4000-8000-000000000004";

function context(overrides: Partial<CraftEvaluationContext> = {}): CraftEvaluationContext {
  const statements = [
    { statement_id: "81000000-0000-4000-8000-000000000010", section_id: "contact", display_role: "line" as const, kind: "factual" as const, text: "owner@example.test", supporting_confirmed_fact_revision_ids: [FACT_ID] },
    { statement_id: "81000000-0000-4000-8000-000000000011", section_id: "experience", display_role: "heading" as const, kind: "factual" as const, text: "Operations Coordinator | Synthetic Org | 2022–Present", supporting_confirmed_fact_revision_ids: [JOB_ID] },
    { statement_id: "81000000-0000-4000-8000-000000000012", section_id: "experience", display_role: "bullet" as const, kind: "factual" as const, text: "Coordinated weekly service schedules across three teams.", supporting_confirmed_fact_revision_ids: [FACT_ID] },
    { statement_id: "81000000-0000-4000-8000-000000000013", section_id: "experience", display_role: "bullet" as const, kind: "factual" as const, text: "Resolved handoff delays by documenting the shared intake process.", supporting_confirmed_fact_revision_ids: [FACT_ID] },
    { statement_id: "81000000-0000-4000-8000-000000000014", section_id: "education", display_role: "line" as const, kind: "factual" as const, text: "Synthetic University", supporting_confirmed_fact_revision_ids: [FACT_ID] },
  ];
  return {
    definition_revision_id: DEFINITION_ID,
    strategy_revision_id: STRATEGY_ID,
    definition_kind: "general",
    title: "Zoë Synthetic",
    statements,
    section_order: ["contact", "experience", "education"],
    selected_fact_revision_ids: [FACT_ID, JOB_ID],
    fact_revision_ids: [FACT_ID, JOB_ID],
    coverage_revision_ids: [],
    strategy: {
      history_shape: "chronological_standard",
      summary_decision: "omit",
      section_order: ["contact", "experience", "education"],
      evidence_priorities: [{ fact_revision_id: FACT_ID, priority: "must_use" }, { fact_revision_id: JOB_ID, priority: "must_use" }],
      omissions: [],
      unresolved_gap_ids: [],
    },
    target_analysis: null,
    deterministic_truth_passed: true,
    deterministic_structure_passed: true,
    deterministic_mechanical_passed: true,
    deterministic_gate_digest: canonicalInputDigest({ truth: true, structure: true, mechanical: true }),
    ...overrides,
  };
}

function criterion(result: CraftEvaluationResult, id: string) {
  return result.criterion_verdicts.find((entry) => entry.criterion === id)!;
}

function withCriterionFailure(result: CraftEvaluationResult, id: "C1" | "C2", absenceCode: string): CraftEvaluationResult {
  const evidenceRef = {
    evidence_ref_id: crypto.randomUUID(),
    kind: "explicit_absence" as const,
    polarity: "absence" as const,
    statement_id: null,
    revision_id: null,
    anchor_id: null,
    absence_code: absenceCode,
    evidence_digest: canonicalInputDigest({ absence_code: absenceCode, definition_revision_id: DEFINITION_ID, strategy_revision_id: STRATEGY_ID }),
  };
  const findingId = crypto.randomUUID();
  return {
    ...result,
    verdict: "fail",
    criterion_verdicts: result.criterion_verdicts.map((entry) => entry.criterion === id
      ? { ...entry, verdict: "fail", evidence_refs: [evidenceRef], finding_ids: [findingId] }
      : entry),
    findings: [...result.findings, {
      finding_id: findingId,
      criterion: id,
      severity: "blocking",
      correction_class: id === "C1" ? "organization" : "duty_only",
      safe_message: id === "C1" ? "The declared skim anchors were not recoverable." : "Experience does not yet carry the screening decision.",
      evidence_ref_ids: [evidenceRef.evidence_ref_id],
    }],
  };
}

describe("evidence-cited product craft evaluator", () => {
  it("extracts implementation-independent C1/C2/C3 anchors without a score or semantic-pass claim", () => {
    const extracted = extractCraftAnchorEvidence(context());
    expect(extracted).toMatchObject({ extraction_version: 1, definition_revision_id: DEFINITION_ID, strategy_revision_id: STRATEGY_ID });
    expect(extracted.anchors).toEqual(expect.arrayContaining([
      expect.objectContaining({ anchor_kind: "professional_identity" }),
      expect.objectContaining({ anchor_kind: "experience_heading" }),
      expect.objectContaining({ anchor_kind: "experience_evidence" }),
      expect.objectContaining({ anchor_kind: "education" }),
    ]));
    expect(extracted.criterion_inputs.map((entry) => entry.criterion)).toEqual(["C1", "C2", "C3"]);
    expect(JSON.stringify(extracted)).not.toMatch(/score|rating|percentage|human_pass/i);
  });

  it("passes a clean control only with exact positive evidence for every applicable criterion", () => {
    const result = evaluateCraftProposal(context());
    expect(result).toMatchObject({ report_version: 2, verdict: "pass", evidence_context: "standard" });
    expect(result.criterion_verdicts.map((item) => item.criterion)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "T1", "T2", "T3"]);
    for (const entry of result.criterion_verdicts) {
      expect(entry.evidence_refs.length, entry.criterion).toBeGreaterThan(0);
      if (entry.verdict === "pass") expect(entry.evidence_refs.some((reference) => reference.polarity === "positive"), entry.criterion).toBe(true);
      if (entry.verdict === "not_applicable") expect(entry.evidence_refs).toEqual([expect.objectContaining({ kind: "explicit_absence", polarity: "absence" })]);
    }
    expect(criterion(result, "C4").verdict).toBe("pass");
    expect(criterion(result, "C1").evidence_refs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "rendered_anchor" })]));
    expect(JSON.stringify(result)).not.toMatch(/score|rating|percentage/i);
  });

  it("reproduces the frozen C1/C2 non-pass and C3 pass without fixture-specific product branching", async () => {
    const manifest = FrozenQualityRegressionManifestSchema.parse(JSON.parse(await readFile(new URL("./fixtures/quality/qgc-frozen-regression-v1.json", import.meta.url), "utf8")));
    const frozen = withCriterionFailure(withCriterionFailure(evaluateCraftProposal(context()), "C1", "skim_anchors_not_recoverable"), "C2", "experience_decision_evidence_insufficient");
    expect({ C1: criterion(frozen, "C1").verdict, C2: criterion(frozen, "C2").verdict, C3: criterion(frozen, "C3").verdict }).toEqual({
      C1: manifest.expected.C1,
      C2: manifest.expected.C2,
      C3: manifest.expected.C3,
    });
    expect(frozen.verdict).toBe("fail");
    expect(validateCraftEvaluationResult(frozen, context())).toEqual([]);
    expect(manifest.expected.passing_label_allowed).toBe(false);
    expect(manifest.policies).toMatchObject({
      quality_standard: { policy_digest: RESUME_QUALITY_STANDARD_DIGEST },
      evaluator_contract: { policy_id: PRODUCT_CRAFT_EVALUATOR.contract_id, policy_version: PRODUCT_CRAFT_EVALUATOR.contract_version, policy_digest: PRODUCT_CRAFT_EVALUATOR.binding_digest },
      evidence_limited: { policy_id: CRAFT_EVIDENCE_LIMITED_POLICY.policy_id, policy_version: CRAFT_EVIDENCE_LIMITED_POLICY.policy_version, policy_digest: CRAFT_EVIDENCE_LIMITED_POLICY_DIGEST },
      prompt: { policy_id: RESUME_PROMPT_POLICY_ID, policy_version: RESUME_PROMPT_POLICY_VERSION, policy_digest: canonicalInputDigest({ policy_id: RESUME_PROMPT_POLICY_ID, policy_version: RESUME_PROMPT_POLICY_VERSION }) },
    });
  });

  it.each([
    ["Responsible for customer requests.", "C2", "duty_only"],
    ["Results-driven rockstar delivering world-class excellence.", "C3", "generic_language"],
    ["Leveraged synergistic solutions to optimize dynamic workflows.", "C6", "generic_language"],
  ] as const)("keeps deterministic mandatory failure authoritative for %s", (text, expectedCriterion, correctionClass) => {
    const base = context();
    const statements = base.statements.map((item, index) => index === 2 ? { ...item, text } : item);
    const weak = { ...base, statements };
    const result = evaluateCraftProposal(weak);
    expect(result.verdict).toBe("fail");
    expect(result.findings).toContainEqual(expect.objectContaining({ criterion: expectedCriterion, correction_class: correctionClass, severity: "blocking" }));

    const dishonest = evaluateCraftProposal(base);
    expect(validateCraftEvaluationResult(dishonest, weak)).toContainEqual(expect.objectContaining({ code: "evaluator_disagreement" }));
  });

  it("rejects a summary that repeats experience and uses an ungrammatical bare verb", () => {
    const base = context();
    const summary = {
      statement_id: "81000000-0000-4000-8000-000000000015",
      section_id: "summary",
      display_role: "line" as const,
      kind: "factual" as const,
      text: "Operations Coordinator with experience coordinate weekly service schedules across three teams.",
      supporting_confirmed_fact_revision_ids: [FACT_ID],
    };
    const weak = {
      ...base,
      statements: [base.statements[0]!, summary, ...base.statements.slice(1)],
      section_order: ["contact", "summary", "experience", "education"],
      strategy: {
        ...base.strategy,
        summary_decision: "include" as const,
        section_order: ["contact", "summary", "experience", "education"],
      },
    };

    const result = evaluateCraftProposal(weak);
    expect(result.verdict).toBe("fail");
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterion: "C4", correction_class: "redundancy", severity: "blocking" }),
      expect.objectContaining({ criterion: "C6", correction_class: "generic_language", severity: "blocking" }),
    ]));
  });

  it("rejects a title-only summary that adds no useful positioning", () => {
    const base = context();
    const summary = {
      statement_id: "81000000-0000-4000-8000-000000000017",
      section_id: "summary",
      display_role: "line" as const,
      kind: "factual" as const,
      text: "Operations Coordinator.",
      supporting_confirmed_fact_revision_ids: [JOB_ID],
    };
    const result = evaluateCraftProposal({
      ...base,
      statements: [base.statements[0]!, summary, ...base.statements.slice(1)],
      section_order: ["contact", "summary", "experience", "education"],
      strategy: { ...base.strategy, summary_decision: "include", section_order: ["contact", "summary", "experience", "education"] },
    });

    expect(result.verdict).toBe("fail");
    expect(result.findings).toContainEqual(expect.objectContaining({ criterion: "C4", correction_class: "generic_language", severity: "blocking" }));
  });

  it("rejects experience bullets that restate the same evidence in different sentence shapes", () => {
    const base = context();
    const repeated = {
      ...base.statements[3]!,
      statement_id: "81000000-0000-4000-8000-000000000016",
      text: "Documented the shared intake process to resolve handoff delays.",
    };
    const result = evaluateCraftProposal({ ...base, statements: [...base.statements.slice(0, 4), repeated, ...base.statements.slice(4)] });

    expect(result.verdict).toBe("fail");
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterion: "C2", correction_class: "redundancy", severity: "blocking" }),
      expect.objectContaining({ criterion: "C6", correction_class: "redundancy", severity: "blocking" }),
    ]));
  });

  it("rejects missing, duplicate, foreign, stale, and context-changed evidence", () => {
    const base = context();
    const valid = evaluateCraftProposal(base);
    expect(validateCraftEvaluationResult(valid, base)).toEqual([]);

    const missing = structuredClone(valid);
    criterion(missing, "C1").evidence_refs = [];
    expect(validateCraftEvaluationResult(missing, base)).toContainEqual(expect.objectContaining({ code: "criterion_evidence_invalid" }));

    const duplicate = structuredClone(valid);
    criterion(duplicate, "C2").evidence_refs[0]!.evidence_ref_id = criterion(duplicate, "C1").evidence_refs[0]!.evidence_ref_id;
    expect(validateCraftEvaluationResult(duplicate, base)).toContainEqual(expect.objectContaining({ code: "criterion_evidence_invalid" }));

    const foreign = structuredClone(valid);
    const statementReference = foreign.criterion_verdicts.flatMap((entry) => entry.evidence_refs).find((entry) => entry.kind === "statement")!;
    statementReference.statement_id = crypto.randomUUID();
    expect(validateCraftEvaluationResult(foreign, base)).toContainEqual(expect.objectContaining({ code: "criterion_evidence_invalid" }));

    const stale = structuredClone(valid);
    stale.criterion_verdicts[0]!.evidence_refs[0]!.evidence_digest = `sha256:${"0".repeat(64)}`;
    expect(validateCraftEvaluationResult(stale, base)).toContainEqual(expect.objectContaining({ code: "criterion_evidence_invalid" }));

    expect(validateCraftEvaluationResult(valid, { ...base, title: "Changed identity" })).toContainEqual(expect.objectContaining({ code: "criterion_evidence_invalid" }));
  });

  it("enforces general and targeted applicability plus finding/verdict agreement", () => {
    const general = evaluateCraftProposal(context());
    expect(general.criterion_verdicts.filter((entry) => entry.criterion.startsWith("T")).every((entry) => entry.verdict === "not_applicable")).toBe(true);
    const invalidGeneral = structuredClone(general);
    criterion(invalidGeneral, "C4").verdict = "not_applicable";
    expect(validateCraftEvaluationResult(invalidGeneral, context())).toContainEqual(expect.objectContaining({ code: "criterion_applicability_invalid" }));

    const targetedContext = context({
      definition_kind: "targeted",
      target_analysis: {
        revision_id: "81000000-0000-4000-8000-000000000020",
        outcome: "targeted_variant",
        fit_class: "meaningfully_supported",
        material_changes: [{ statement_id: "81000000-0000-4000-8000-000000000012", requirement_id: "81000000-0000-4000-8000-000000000021", supporting_confirmed_fact_revision_ids: [FACT_ID] }],
      },
    });
    const targeted = evaluateCraftProposal(targetedContext);
    expect(targeted.criterion_verdicts.filter((entry) => entry.criterion.startsWith("T")).every((entry) => entry.verdict === "pass")).toBe(true);
    const invalidTargeted = structuredClone(targeted);
    criterion(invalidTargeted, "T1").verdict = "not_applicable";
    expect(validateCraftEvaluationResult(invalidTargeted, targetedContext)).toContainEqual(expect.objectContaining({ code: "criterion_applicability_invalid" }));

    const mismatch = { ...targeted, verdict: "pass" as const, criterion_verdicts: targeted.criterion_verdicts.map((entry) => entry.criterion === "C2" ? { ...entry, verdict: "fail" as const } : entry) };
    expect(validateCraftEvaluationResult(mismatch, targetedContext)).toContainEqual(expect.objectContaining({ code: "verdict_mismatch" }));
  });

  it("applies the accepted evidence-limited decision without granting passage", () => {
    expect(CRAFT_EVIDENCE_LIMITED_POLICY).toMatchObject({
      policy_id: "braindrive.resume-builder.evidence-limited.rb7-oq1-blocked",
      authority_status: "accepted_implementation_blocker",
      ordinary_product_craft_passage_allowed: false,
      owner_approval_allowed: false,
      release_ready_allowed: false,
    });
    expect(PRODUCT_CRAFT_EVALUATOR).toMatchObject({ scope: "product_craft_review", contract_version: "2", policy_version: "1" });
    const limited = evaluateCraftProposal(context({ strategy: { ...context().strategy, history_shape: "early_career", unresolved_gap_ids: ["81000000-0000-4000-8000-000000000030"] } }));
    expect(limited.evidence_context).toBe("limited");
  });
});
