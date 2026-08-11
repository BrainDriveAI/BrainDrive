import { createHash } from "node:crypto";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { RESUME_PROMPT_POLICY_VERSION } from "./policy.js";

export const CRAFT_EVIDENCE_LIMITED_POLICY = {
  policy_id: "braindrive.resume-builder.craft-evidence-limited.provisional-rb7-oq1",
  policy_version: "1",
  authority_status: "provisional_planning_default",
  required_relative_criteria: ["C1", "C2", "C3"],
  require_no_must_use_omission: true,
  require_optional_gap_guidance: true,
  bypass_allowed: false,
  score_free: true,
} as const;

export const CRAFT_EVIDENCE_LIMITED_POLICY_DIGEST = canonicalInputDigest(CRAFT_EVIDENCE_LIMITED_POLICY);

export type CraftCriterion = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "T1" | "T2" | "T3";
export type CraftCorrectionClass = "specificity" | "duty_only" | "generic_language" | "redundancy" | "density" | "organization" | "target_relevance";
export type CraftEvidenceCategory = "statement_support" | "must_use_evidence" | "strategy" | "target_analysis" | "deterministic_gate" | "optional_gap" | "explicit_absence";

export type CraftStatement = {
  statement_id: string;
  section_id: string;
  kind: "factual" | "presentation";
  display_role?: "heading" | "bullet" | "line";
  text: string;
  supporting_confirmed_fact_revision_ids: string[];
};

export type CraftEvaluationContext = {
  definition_kind: "general" | "targeted";
  title: string;
  statements: CraftStatement[];
  section_order: string[];
  selected_fact_revision_ids: string[];
  strategy: {
    history_shape: string;
    summary_decision: "include" | "omit";
    section_order: string[];
    evidence_priorities: Array<{ fact_revision_id: string; priority: "must_use" | "preferred" | "context" }>;
    omissions: Array<{ fact_revision_id: string; reason_code?: string }>;
    unresolved_gap_ids: string[];
  };
  target_analysis: null | {
    outcome: "targeted_variant" | "no_meaningful_change";
    fit_class: string;
    material_changes: Array<{ statement_id: string | null; requirement_id: string; supporting_confirmed_fact_revision_ids: string[] }>;
  };
  deterministic_truth_passed: boolean;
  deterministic_structure_passed: boolean;
};

export type CraftFinding = {
  finding_id: string;
  criterion: CraftCriterion;
  statement_id: string | null;
  severity: "guidance" | "blocking";
  correction_class: CraftCorrectionClass;
  safe_message: string;
  evidence_category: CraftEvidenceCategory;
  evidence_revision_ids: string[];
};

export type CraftEvaluationResult = {
  report_version: 1;
  evidence_context: "standard" | "limited";
  verdict: "pass" | "fail";
  criterion_verdicts: Array<{ criterion: CraftCriterion; verdict: "pass" | "fail" | "not_applicable"; finding_ids: string[] }>;
  findings: CraftFinding[];
};

export type CraftEvaluationIssue = { code: "criterion_incomplete" | "finding_invalid" | "evaluator_disagreement" | "verdict_mismatch"; safe_message: string };

type CraftDataBlock = { category: string; data: unknown };

const CRITERIA: CraftCriterion[] = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "T1", "T2", "T3"];
const DUTY_ONLY = /^(?:responsible for|duties (?:included|include)|tasked with|worked on|helped with|assisted with)\b/i;
const SELF_PRAISE = /\b(?:results-driven|detail-oriented|go-getter|rockstar|best-in-class|world-class|guru|ninja|exceptional|outstanding)\b/i;
const MECHANICAL_LANGUAGE = /\b(?:leveraged? synergies?|synergistic|dynamic (?:environment|solutions?|workflows?)|optimi[sz](?:e|ed|ing) (?:dynamic|robust|innovative)|proven track record|passionate professional|thought leader)\b/i;
const DEFENSIVE_GAP = /\b(?:unemployed|laid off|terminated|fired|career gap due to|despite (?:a|the) gap|apologi[sz])\b/i;

export function craftDefinitionDigest(context: Pick<CraftEvaluationContext, "definition_kind" | "title" | "statements" | "section_order" | "selected_fact_revision_ids">): `sha256:${string}` {
  return canonicalInputDigest({
    definition_kind: context.definition_kind,
    title: context.title,
    statements: context.statements,
    section_order: context.section_order,
    selected_fact_revision_ids: context.selected_fact_revision_ids,
  });
}

export function craftContextFromBlocks(blocks: CraftDataBlock[]): CraftEvaluationContext {
  const definition = blocks.find((block) => block.category === "general_resume_definition")?.data as {
    definition_kind?: "general" | "targeted";
    title?: string;
    statements?: CraftStatement[];
    section_order?: string[];
    selected_fact_revision_ids?: string[];
  } | undefined;
  const strategy = blocks.find((block) => block.category === "resume_strategy")?.data as CraftEvaluationContext["strategy"] | undefined;
  const analysis = blocks.find((block) => block.category === "target_fit_analysis")?.data as CraftEvaluationContext["target_analysis"] | undefined;
  const gates = blocks.find((block) => block.category === "deterministic_findings")?.data as {
    truth_passed?: boolean;
    structure_passed?: boolean;
  } | undefined;
  if (!definition?.definition_kind || !definition.title || !definition.statements || !definition.section_order || !definition.selected_fact_revision_ids || !strategy || !gates) {
    throw new Error("Craft evaluation context is incomplete");
  }
  return {
    definition_kind: definition.definition_kind,
    title: definition.title,
    statements: definition.statements,
    section_order: definition.section_order,
    selected_fact_revision_ids: definition.selected_fact_revision_ids,
    strategy,
    target_analysis: analysis ?? null,
    deterministic_truth_passed: gates.truth_passed === true,
    deterministic_structure_passed: gates.structure_passed === true,
  };
}

export function evaluateCraftProposal(context: CraftEvaluationContext): CraftEvaluationResult {
  const findings: CraftFinding[] = [];
  const add = (criterion: CraftCriterion, statementId: string | null, severity: "guidance" | "blocking", correctionClass: CraftCorrectionClass, safeMessage: string, evidenceCategory: CraftEvidenceCategory, evidenceRevisionIds: string[] = []) => {
    const identity = `${criterion}:${statementId ?? "absence"}:${correctionClass}:${evidenceCategory}:${safeMessage}`;
    findings.push({ finding_id: deterministicUuid(identity), criterion, statement_id: statementId, severity, correction_class: correctionClass, safe_message: safeMessage, evidence_category: evidenceCategory, evidence_revision_ids: [...new Set(evidenceRevisionIds)].sort() });
  };
  const limited = /(?:thin|early_career|no_prior)/.test(context.strategy.history_shape);
  const experience = context.statements.filter((statement) => statement.section_id === "experience");
  const headings = experience.filter((statement) => statement.display_role === "heading");
  const bullets = experience.filter((statement) => (statement.display_role ?? "bullet") === "bullet");
  const summaries = context.statements.filter((statement) => statement.section_id === "summary");

  if (!context.deterministic_truth_passed || !context.deterministic_structure_passed) {
    add("C1", null, "blocking", "organization", "Truth and structure must pass before craft can be accepted.", "deterministic_gate");
  }
  if (!context.title.trim() || headings.length === 0) add("C1", null, "blocking", "organization", "The proposal does not expose a recoverable professional identity and experience heading.", "explicit_absence");

  for (const statement of bullets.filter((candidate) => DUTY_ONLY.test(normalize(candidate.text)))) {
    add("C2", statement.statement_id, "blocking", "duty_only", "This experience statement reads as a generic duty instead of distinct supported work.", "statement_support", statement.supporting_confirmed_fact_revision_ids);
  }
  const mustUse = context.strategy.evidence_priorities.filter((entry) => entry.priority === "must_use").map((entry) => entry.fact_revision_id);
  const used = new Set(context.statements.flatMap((statement) => statement.supporting_confirmed_fact_revision_ids));
  const omitted = new Set(context.strategy.omissions.map((entry) => entry.fact_revision_id));
  for (const factId of mustUse.filter((id) => !used.has(id) && !omitted.has(id))) {
    add("C2", null, "blocking", "organization", "A strategy-required evidence item is absent without a visible omission reason.", "must_use_evidence", [factId]);
  }

  for (const statement of context.statements.filter((candidate) => SELF_PRAISE.test(normalize(candidate.text)))) {
    add("C3", statement.statement_id, "blocking", "generic_language", "Replace generic self-praise with a concrete supported action, scope, tool, or result.", "statement_support", statement.supporting_confirmed_fact_revision_ids);
  }

  if (context.strategy.summary_decision === "include" && summaries.length === 0) add("C4", null, "blocking", "organization", "The strategy requires supported positioning, but the summary is absent.", "strategy");
  if (context.strategy.summary_decision === "omit" && summaries.length > 0) add("C4", summaries[0]!.statement_id, "blocking", "redundancy", "The summary was not selected because it does not add distinct supported value.", "strategy", summaries[0]!.supporting_confirmed_fact_revision_ids);

  if (canonicalInputDigest(context.section_order) !== canonicalInputDigest(context.strategy.section_order)) add("C5", null, "blocking", "organization", "Section order does not match the evidence-shaped history strategy.", "strategy");

  for (const statement of context.statements.filter((candidate) => MECHANICAL_LANGUAGE.test(normalize(candidate.text)))) {
    add("C6", statement.statement_id, "blocking", "generic_language", "The wording is mechanical or AI-generic rather than direct, plain, and specific.", "statement_support", statement.supporting_confirmed_fact_revision_ids);
  }
  const openingCounts = new Map<string, string[]>();
  for (const statement of bullets) {
    const opening = normalize(statement.text).match(/^[\p{L}\p{N}]+/u)?.[0]?.toLocaleLowerCase("en-US");
    if (opening) openingCounts.set(opening, [...(openingCounts.get(opening) ?? []), statement.statement_id]);
  }
  for (const ids of openingCounts.values()) if (ids.length >= 3) add("C6", ids[2]!, "blocking", "redundancy", "Three or more experience statements repeat the same opening.", "statement_support");

  for (const statement of context.statements.filter((candidate) => DEFENSIVE_GAP.test(normalize(candidate.text)))) {
    add("C7", statement.statement_id, "blocking", "generic_language", "Keep employment limitations factual and neutral rather than defensive or apologetic.", "statement_support", statement.supporting_confirmed_fact_revision_ids);
  }
  if (limited && context.strategy.unresolved_gap_ids.length > 0) add("C7", null, "guidance", "specificity", "Available evidence is shaped without padding; the owner may optionally add one unresolved detail.", "optional_gap", context.strategy.unresolved_gap_ids);

  if (context.definition_kind === "targeted") {
    const analysis = context.target_analysis;
    if (!analysis || analysis.outcome !== "targeted_variant" || analysis.material_changes.length === 0) {
      add("T1", null, "blocking", "target_relevance", "The targeted proposal lacks a current supported relevance analysis.", "target_analysis");
      add("T2", null, "blocking", "target_relevance", "Honest target-fit evidence is missing or not passing.", "target_analysis");
      add("T3", null, "blocking", "target_relevance", "A separate targeted proposal requires at least one supported material change.", "target_analysis");
    } else {
      const statementIds = new Set(context.statements.map((statement) => statement.statement_id));
      for (const change of analysis.material_changes) {
        if (!change.statement_id || !statementIds.has(change.statement_id) || change.supporting_confirmed_fact_revision_ids.length === 0) {
          add("T1", change.statement_id, "blocking", "target_relevance", "A targeted change is not bound to one current statement and confirmed support.", "target_analysis", change.supporting_confirmed_fact_revision_ids);
        }
      }
    }
  }

  const criterionVerdicts = CRITERIA.map((criterion) => {
    const criterionFindings = findings.filter((finding) => finding.criterion === criterion);
    const notApplicable = criterion === "C4" && context.strategy.summary_decision === "omit" && summaries.length === 0
      || criterion.startsWith("T") && context.definition_kind === "general";
    return {
      criterion,
      verdict: notApplicable ? "not_applicable" as const : criterionFindings.some((finding) => finding.severity === "blocking") ? "fail" as const : "pass" as const,
      finding_ids: criterionFindings.map((finding) => finding.finding_id),
    };
  });
  return {
    report_version: 1,
    evidence_context: limited ? "limited" : "standard",
    verdict: findings.some((finding) => finding.severity === "blocking") ? "fail" : "pass",
    criterion_verdicts: criterionVerdicts,
    findings,
  };
}

export function validateCraftEvaluationResult(result: CraftEvaluationResult, context: CraftEvaluationContext): CraftEvaluationIssue[] {
  const issues: CraftEvaluationIssue[] = [];
  const criteria = result.criterion_verdicts.map((entry) => entry.criterion);
  if (criteria.length !== CRITERIA.length || new Set(criteria).size !== CRITERIA.length || CRITERIA.some((criterion) => !criteria.includes(criterion))) {
    issues.push({ code: "criterion_incomplete", safe_message: "Craft evaluation must adjudicate every C1-C7 and T1-T3 criterion exactly once." });
  }
  const statementIds = new Set(context.statements.map((statement) => statement.statement_id));
  const findingIds = new Set(result.findings.map((finding) => finding.finding_id));
  if (findingIds.size !== result.findings.length || result.findings.some((finding) => finding.statement_id !== null && !statementIds.has(finding.statement_id))) {
    issues.push({ code: "finding_invalid", safe_message: "Craft findings must use unique identities and exact proposal statement identities or explicit absence." });
  }
  if (result.criterion_verdicts.some((entry) => entry.finding_ids.some((id) => !findingIds.has(id)))) {
    issues.push({ code: "finding_invalid", safe_message: "Criterion verdicts cite a finding outside the report." });
  }
  const expected = evaluateCraftProposal(context);
  for (const required of expected.findings.filter((finding) => finding.severity === "blocking")) {
    const represented = result.findings.some((finding) => finding.severity === "blocking" && finding.criterion === required.criterion && finding.statement_id === required.statement_id && finding.correction_class === required.correction_class);
    const verdict = result.criterion_verdicts.find((entry) => entry.criterion === required.criterion)?.verdict;
    if (!represented || verdict !== "fail") issues.push({ code: "evaluator_disagreement", safe_message: "The evaluator contradicted an independently extracted mandatory craft failure." });
  }
  const reportFails = result.findings.some((finding) => finding.severity === "blocking") || result.criterion_verdicts.some((entry) => entry.verdict === "fail");
  if ((result.verdict === "fail") !== reportFails) issues.push({ code: "verdict_mismatch", safe_message: "The craft verdict does not match its mandatory criterion findings." });
  if (result.evidence_context !== expected.evidence_context) issues.push({ code: "evaluator_disagreement", safe_message: "The evaluator changed the independently derived evidence-context class." });
  return issues;
}

export function assertBoundCraftApproval(definition: Pick<CraftEvaluationContext, "definition_kind" | "title" | "statements" | "section_order" | "selected_fact_revision_ids"> & {
  prompt_policy_version: string | null;
  approval_evidence?: null | {
    persuasive_quality?: {
      status: "legacy_mechanical_only" | "current";
      craft_report_revision_id: string | null;
      craft_report_digest: string | null;
      craft_definition_digest: string | null;
      strategy_revision_id: string | null;
      successor_continuity_digest: string | null;
      evidence_limited_policy_id: string;
      evidence_limited_policy_version: string;
      evidence_limited_authority_status: string;
    };
  };
}): void {
  if (definition.prompt_policy_version !== RESUME_PROMPT_POLICY_VERSION) return;
  const evidence = definition.approval_evidence?.persuasive_quality;
  if (
    !evidence || evidence.status !== "current" || !evidence.craft_report_revision_id || !evidence.craft_report_digest || !evidence.strategy_revision_id || !evidence.successor_continuity_digest ||
    evidence.craft_definition_digest !== craftDefinitionDigest(definition) || evidence.evidence_limited_policy_id !== CRAFT_EVIDENCE_LIMITED_POLICY.policy_id ||
    evidence.evidence_limited_policy_version !== CRAFT_EVIDENCE_LIMITED_POLICY.policy_version || evidence.evidence_limited_authority_status !== CRAFT_EVIDENCE_LIMITED_POLICY.authority_status
  ) throw new Error("Craft quality report is missing, stale, or failing");
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
