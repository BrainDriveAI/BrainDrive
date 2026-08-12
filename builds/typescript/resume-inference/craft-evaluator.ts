import { createHash } from "node:crypto";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { extractCraftAnchorEvidence, type CraftAnchorEvidence } from "./craft-anchors.js";
import { RESUME_PROMPT_POLICY_VERSION } from "./policy.js";

export const CRAFT_EVIDENCE_LIMITED_POLICY = {
  policy_id: "braindrive.resume-builder.evidence-limited.rb7-oq1-blocked",
  policy_version: "1",
  authority_status: "accepted_implementation_blocker",
  ordinary_product_craft_passage_allowed: false,
  owner_approval_allowed: false,
  release_ready_allowed: false,
  score_free: true,
} as const;

export const LEGACY_CRAFT_EVIDENCE_LIMITED_POLICY = {
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

const PRODUCT_CRAFT_EVALUATOR_BODY = {
  scope: "product_craft_review" as const,
  contract_id: "braindrive.resume-builder.product-craft-review" as const,
  contract_version: "2" as const,
  policy_id: "braindrive.resume-builder.product-craft-evidence" as const,
  policy_version: "1" as const,
};

export const PRODUCT_CRAFT_EVALUATOR = {
  ...PRODUCT_CRAFT_EVALUATOR_BODY,
  binding_digest: canonicalInputDigest(PRODUCT_CRAFT_EVALUATOR_BODY),
} as const;

export type CraftCriterion = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "T1" | "T2" | "T3";
export type CraftCorrectionClass = "specificity" | "duty_only" | "generic_language" | "redundancy" | "density" | "organization" | "target_relevance";
export type CraftEvidenceKind = "statement" | "rendered_anchor" | "strategy" | "fact" | "coverage" | "target_analysis" | "deterministic_gate" | "explicit_absence";

export type CraftStatement = {
  statement_id: string;
  section_id: string;
  kind: "factual" | "presentation";
  display_role?: "heading" | "bullet" | "line";
  text: string;
  supporting_confirmed_fact_revision_ids: string[];
};

export type CraftEvaluationContext = {
  definition_revision_id: string;
  strategy_revision_id: string;
  definition_kind: "general" | "targeted";
  title: string;
  statements: CraftStatement[];
  section_order: string[];
  selected_fact_revision_ids: string[];
  fact_revision_ids: string[];
  coverage_revision_ids: string[];
  strategy: {
    history_shape: string;
    summary_decision: "include" | "omit";
    section_order: string[];
    evidence_priorities: Array<{ fact_revision_id: string; priority: "must_use" | "preferred" | "context" }>;
    omissions: Array<{ fact_revision_id: string; reason_code?: string }>;
    unresolved_gap_ids: string[];
  };
  target_analysis: null | {
    revision_id: string;
    outcome: "targeted_variant" | "no_meaningful_change";
    fit_class: string;
    material_changes: Array<{ statement_id: string | null; requirement_id: string; supporting_confirmed_fact_revision_ids: string[] }>;
  };
  deterministic_truth_passed: boolean;
  deterministic_structure_passed: boolean;
  deterministic_mechanical_passed: boolean;
  deterministic_gate_digest: string;
};

export type CraftEvidenceReference = {
  evidence_ref_id: string;
  kind: CraftEvidenceKind;
  polarity: "positive" | "negative" | "absence";
  statement_id: string | null;
  revision_id: string | null;
  anchor_id: string | null;
  absence_code: string | null;
  evidence_digest: string;
};

export type CraftFinding = {
  finding_id: string;
  criterion: CraftCriterion;
  severity: "guidance" | "blocking";
  correction_class: CraftCorrectionClass;
  safe_message: string;
  evidence_ref_ids: string[];
};

export type CraftEvaluationResult = {
  report_version: 2;
  evidence_context: "standard" | "limited";
  verdict: "pass" | "fail";
  criterion_verdicts: Array<{
    criterion: CraftCriterion;
    verdict: "pass" | "fail" | "not_applicable";
    evidence_refs: CraftEvidenceReference[];
    finding_ids: string[];
  }>;
  findings: CraftFinding[];
};

export type CraftEvaluationIssue = {
  code: "criterion_incomplete" | "criterion_evidence_invalid" | "criterion_applicability_invalid" | "finding_invalid" | "evaluator_disagreement" | "verdict_mismatch" | "evidence_context_mismatch";
  safe_message: string;
};

type CraftDataBlock = { category: string; data: unknown; content_digest?: string };

export const CRAFT_CRITERIA: CraftCriterion[] = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "T1", "T2", "T3"];
const DUTY_ONLY = /^(?:responsible for|duties (?:included|include)|tasked with|worked on|helped with|assisted with)\b/i;
const SELF_PRAISE = /\b(?:results-driven|detail-oriented|go-getter|rockstar|best-in-class|world-class|guru|ninja|exceptional|outstanding)\b/i;
const MECHANICAL_LANGUAGE = /\b(?:leveraged? synergies?|synergistic|dynamic (?:environment|solutions?|workflows?)|optimi[sz](?:e|ed|ing) (?:dynamic|robust|innovative)|proven track record|passionate professional|thought leader)\b/i;
const DEFENSIVE_GAP = /\b(?:unemployed|laid off|terminated|fired|career gap due to|despite (?:a|the) gap|apologi[sz])\b/i;

export { extractCraftAnchorEvidence } from "./craft-anchors.js";

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
    metadata?: { revision_id?: string };
    definition_kind?: "general" | "targeted";
    title?: string;
    statements?: CraftStatement[];
    section_order?: string[];
    selected_fact_revision_ids?: string[];
  } | undefined;
  const strategy = blocks.find((block) => block.category === "resume_strategy")?.data as (CraftEvaluationContext["strategy"] & {
    metadata?: { revision_id?: string };
    fact_revision_ids?: string[];
    coverage_revision_ids?: string[];
  }) | undefined;
  const analysis = blocks.find((block) => block.category === "target_fit_analysis")?.data as (Omit<NonNullable<CraftEvaluationContext["target_analysis"]>, "revision_id"> & { metadata?: { revision_id?: string } }) | undefined;
  const gateBlock = blocks.find((block) => block.category === "deterministic_findings");
  const gates = gateBlock?.data as { truth_passed?: boolean; structure_passed?: boolean; mechanical_passed?: boolean } | undefined;
  if (
    !definition?.metadata?.revision_id || !definition.definition_kind || !definition.title || !definition.statements || !definition.section_order ||
    !definition.selected_fact_revision_ids || !strategy?.metadata?.revision_id || !strategy.fact_revision_ids || !strategy.coverage_revision_ids || !gates
  ) throw new Error("Craft evaluation context is incomplete");
  if (definition.definition_kind === "targeted" && !analysis?.metadata?.revision_id) throw new Error("Craft target evaluation context is incomplete");
  const context: CraftEvaluationContext = {
    definition_revision_id: definition.metadata.revision_id,
    strategy_revision_id: strategy.metadata.revision_id,
    definition_kind: definition.definition_kind,
    title: definition.title,
    statements: definition.statements,
    section_order: definition.section_order,
    selected_fact_revision_ids: definition.selected_fact_revision_ids,
    fact_revision_ids: strategy.fact_revision_ids,
    coverage_revision_ids: strategy.coverage_revision_ids,
    strategy,
    target_analysis: analysis ? { ...analysis, revision_id: analysis.metadata!.revision_id! } : null,
    deterministic_truth_passed: gates.truth_passed === true,
    deterministic_structure_passed: gates.structure_passed === true,
    deterministic_mechanical_passed: gates.mechanical_passed === true,
    deterministic_gate_digest: gateBlock?.content_digest ?? canonicalInputDigest(gates),
  };
  const suppliedAnchors = blocks.find((block) => block.category === "craft_anchor_evidence")?.data;
  if (suppliedAnchors !== undefined && canonicalInputDigest(suppliedAnchors) !== canonicalInputDigest(extractCraftAnchorEvidence(context))) {
    throw new Error("Craft anchor evidence does not match the immutable proposal and strategy");
  }
  return context;
}

export function evaluateCraftProposal(context: CraftEvaluationContext): CraftEvaluationResult {
  const anchors = extractCraftAnchorEvidence(context);
  const evidenceByCriterion = new Map<CraftCriterion, CraftEvidenceReference[]>();
  const findings: CraftFinding[] = [];
  const addEvidence = (criterion: CraftCriterion, reference: CraftEvidenceReference) => {
    evidenceByCriterion.set(criterion, [...(evidenceByCriterion.get(criterion) ?? []), reference]);
  };
  const addFinding = (
    criterion: CraftCriterion,
    correctionClass: CraftCorrectionClass,
    safeMessage: string,
    reference: CraftEvidenceReference,
    severity: "guidance" | "blocking" = "blocking",
  ) => {
    addEvidence(criterion, reference);
    const findingId = deterministicUuid(`${criterion}:${correctionClass}:${safeMessage}:${reference.evidence_ref_id}`);
    findings.push({ finding_id: findingId, criterion, severity, correction_class: correctionClass, safe_message: safeMessage, evidence_ref_ids: [reference.evidence_ref_id] });
  };

  const experience = context.statements.filter((statement) => statement.section_id === "experience");
  const headings = experience.filter((statement) => statement.display_role === "heading");
  const bullets = experience.filter((statement) => statement.display_role !== "heading");
  const summaries = context.statements.filter((statement) => statement.section_id === "summary");
  const limited = /(?:thin|early_career|no_prior)/.test(context.strategy.history_shape);

  for (const criterion of CRAFT_CRITERIA.filter((entry) => entry.startsWith("C"))) {
    for (const reference of defaultPositiveEvidence(criterion, context, anchors)) addEvidence(criterion, reference);
  }
  if (context.definition_kind === "targeted") {
    for (const criterion of ["T1", "T2", "T3"] as const) addEvidence(criterion, evidenceReference(context, anchors, criterion, "target_analysis", "positive", { revision_id: context.target_analysis?.revision_id ?? null }));
  } else {
    for (const criterion of ["T1", "T2", "T3"] as const) addEvidence(criterion, evidenceReference(context, anchors, criterion, "explicit_absence", "absence", { absence_code: "general_resume_criterion_not_applicable" }));
  }

  if (!context.deterministic_truth_passed || !context.deterministic_structure_passed || !context.deterministic_mechanical_passed) {
    addFinding("C1", "organization", "Truth, structure, and mechanical gates must pass before craft can be accepted.", evidenceReference(context, anchors, "C1", "deterministic_gate", "negative", { absence_code: "deterministic_gate_failed" }));
  }
  if (!normalize(context.title) || /^(?:general )?resume$/i.test(normalize(context.title))) {
    addFinding("C1", "organization", "The proposal does not expose a recoverable professional identity.", evidenceReference(context, anchors, "C1", "explicit_absence", "absence", { absence_code: "professional_identity_not_recoverable" }));
  }
  if (experience.length > 0 && headings.length === 0) {
    addFinding("C1", "organization", "The proposal does not expose a recoverable experience heading.", evidenceReference(context, anchors, "C1", "explicit_absence", "absence", { absence_code: "experience_heading_not_recoverable" }));
  }
  if (experience.length > 0 && bullets.length === 0) {
    addFinding("C2", "density", "Experience has no supported decision-useful evidence beyond role identity.", evidenceReference(context, anchors, "C2", "explicit_absence", "absence", { absence_code: "experience_evidence_absent" }));
  }
  for (const statement of bullets.filter((candidate) => DUTY_ONLY.test(normalize(candidate.text)))) {
    addFinding("C2", "duty_only", "This experience statement reads as a generic duty instead of distinct supported work.", evidenceReference(context, anchors, "C2", "statement", "negative", { statement_id: statement.statement_id }));
  }
  const mustUse = context.strategy.evidence_priorities.filter((entry) => entry.priority === "must_use").map((entry) => entry.fact_revision_id);
  const used = new Set(context.statements.flatMap((statement) => statement.supporting_confirmed_fact_revision_ids));
  const omitted = new Set(context.strategy.omissions.map((entry) => entry.fact_revision_id));
  for (const factId of mustUse.filter((id) => !used.has(id) && !omitted.has(id))) {
    addFinding("C2", "organization", "A strategy-required evidence item is absent without a visible omission reason.", evidenceReference(context, anchors, "C2", "fact", "negative", { revision_id: factId }));
  }
  for (const statement of context.statements.filter((candidate) => SELF_PRAISE.test(normalize(candidate.text)))) {
    addFinding("C3", "generic_language", "Replace generic self-praise with a concrete supported action, scope, tool, or result.", evidenceReference(context, anchors, "C3", "statement", "negative", { statement_id: statement.statement_id }));
  }
  if (context.strategy.summary_decision === "include" && summaries.length === 0) {
    addFinding("C4", "organization", "The strategy requires supported positioning, but the summary is absent.", evidenceReference(context, anchors, "C4", "explicit_absence", "absence", { absence_code: "strategy_summary_absent" }));
  }
  if (context.strategy.summary_decision === "omit" && summaries.length > 0) {
    addFinding("C4", "redundancy", "The summary was not selected because it does not add distinct supported value.", evidenceReference(context, anchors, "C4", "statement", "negative", { statement_id: summaries[0]!.statement_id }));
  }
  if (canonicalInputDigest(context.section_order) !== canonicalInputDigest(context.strategy.section_order)) {
    addFinding("C5", "organization", "Section order does not match the evidence-shaped history strategy.", evidenceReference(context, anchors, "C5", "strategy", "negative", { revision_id: context.strategy_revision_id }));
  }
  for (const statement of context.statements.filter((candidate) => MECHANICAL_LANGUAGE.test(normalize(candidate.text)))) {
    addFinding("C6", "generic_language", "The wording is mechanical or AI-generic rather than direct, plain, and specific.", evidenceReference(context, anchors, "C6", "statement", "negative", { statement_id: statement.statement_id }));
  }
  const openingCounts = new Map<string, CraftStatement[]>();
  for (const statement of bullets) {
    const opening = normalize(statement.text).match(/^[\p{L}\p{N}]+/u)?.[0]?.toLocaleLowerCase("en-US");
    if (opening) openingCounts.set(opening, [...(openingCounts.get(opening) ?? []), statement]);
  }
  for (const statements of openingCounts.values()) {
    if (statements.length >= 3) addFinding("C6", "redundancy", "Three or more experience statements repeat the same opening.", evidenceReference(context, anchors, "C6", "statement", "negative", { statement_id: statements[2]!.statement_id }));
  }
  for (const statement of context.statements.filter((candidate) => DEFENSIVE_GAP.test(normalize(candidate.text)))) {
    addFinding("C7", "generic_language", "Keep employment limitations factual and neutral rather than defensive or apologetic.", evidenceReference(context, anchors, "C7", "statement", "negative", { statement_id: statement.statement_id }));
  }
  if (limited && context.strategy.unresolved_gap_ids.length > 0) {
    addFinding("C7", "specificity", "Available evidence is shaped without padding; the owner may optionally add one unresolved detail.", evidenceReference(context, anchors, "C7", "explicit_absence", "absence", { absence_code: "optional_gap_available" }), "guidance");
  }
  if (context.definition_kind === "targeted") {
    const analysis = context.target_analysis;
    if (!analysis || analysis.outcome !== "targeted_variant" || analysis.material_changes.length === 0) {
      for (const [criterion, message] of [
        ["T1", "The targeted proposal lacks a current supported relevance analysis."],
        ["T2", "Honest target-fit evidence is missing or not passing."],
        ["T3", "A separate targeted proposal requires at least one supported material change."],
      ] as const) addFinding(criterion, "target_relevance", message, evidenceReference(context, anchors, criterion, "explicit_absence", "absence", { absence_code: "target_analysis_not_passing" }));
    } else {
      const statementIds = new Set(context.statements.map((statement) => statement.statement_id));
      for (const change of analysis.material_changes) {
        if (!change.statement_id || !statementIds.has(change.statement_id) || change.supporting_confirmed_fact_revision_ids.length === 0) {
          addFinding("T1", "target_relevance", "A targeted change is not bound to one current statement and confirmed support.", evidenceReference(context, anchors, "T1", "target_analysis", "negative", { revision_id: analysis.revision_id }));
        }
      }
    }
  }

  const criterionVerdicts = CRAFT_CRITERIA.map((criterion) => {
    const criterionFindings = findings.filter((finding) => finding.criterion === criterion);
    const notApplicable = criterion.startsWith("T") && context.definition_kind === "general";
    const verdict = notApplicable ? "not_applicable" as const : criterionFindings.some((finding) => finding.severity === "blocking") ? "fail" as const : "pass" as const;
    return { criterion, verdict, evidence_refs: dedupeReferences(evidenceByCriterion.get(criterion) ?? []), finding_ids: criterionFindings.map((finding) => finding.finding_id) };
  });
  return {
    report_version: 2,
    evidence_context: limited ? "limited" : "standard",
    verdict: findings.some((finding) => finding.severity === "blocking") ? "fail" : "pass",
    criterion_verdicts: criterionVerdicts,
    findings,
  };
}

export function validateCraftEvaluationResult(result: CraftEvaluationResult, context: CraftEvaluationContext): CraftEvaluationIssue[] {
  const issues: CraftEvaluationIssue[] = [];
  const anchors = extractCraftAnchorEvidence(context);
  const criteria = result.criterion_verdicts?.map((entry) => entry.criterion) ?? [];
  if (criteria.length !== CRAFT_CRITERIA.length || new Set(criteria).size !== CRAFT_CRITERIA.length || CRAFT_CRITERIA.some((criterion) => !criteria.includes(criterion))) {
    issues.push(issue("criterion_incomplete", "Craft evaluation must adjudicate every C1-C7 and T1-T3 criterion exactly once."));
  }
  const allEvidence = result.criterion_verdicts?.flatMap((entry) => entry.evidence_refs ?? []) ?? [];
  const evidenceIds = new Set(allEvidence.map((reference) => reference.evidence_ref_id));
  if (evidenceIds.size !== allEvidence.length) issues.push(issue("criterion_evidence_invalid", "Craft evidence reference identities must be unique."));
  for (const entry of result.criterion_verdicts ?? []) {
    const refs = entry.evidence_refs ?? [];
    if (refs.length === 0 || (entry.verdict === "pass" && !refs.some((reference) => reference.polarity === "positive")) ||
      (entry.verdict === "fail" && !refs.some((reference) => reference.polarity === "negative" || reference.polarity === "absence")) ||
      (entry.verdict === "not_applicable" && !refs.some((reference) => reference.kind === "explicit_absence" && reference.polarity === "absence"))) {
      issues.push(issue("criterion_evidence_invalid", "Every craft verdict requires evidence with matching polarity."));
    }
    if (entry.criterion.startsWith("C") && entry.verdict === "not_applicable" || entry.criterion.startsWith("T") && ((context.definition_kind === "general") !== (entry.verdict === "not_applicable"))) {
      issues.push(issue("criterion_applicability_invalid", "Craft criterion applicability does not match the proposal kind."));
    }
    for (const reference of refs) {
      if (evidenceDigestForReference(reference, context, anchors) !== reference.evidence_digest) {
        issues.push(issue("criterion_evidence_invalid", "Craft evidence is foreign, stale, or does not match its exact bound identity."));
      }
    }
  }
  const findingIds = new Set((result.findings ?? []).map((finding) => finding.finding_id));
  if (findingIds.size !== (result.findings ?? []).length) issues.push(issue("finding_invalid", "Craft finding identities must be unique."));
  for (const entry of result.criterion_verdicts ?? []) {
    const criterionFindings = (result.findings ?? []).filter((finding) => entry.finding_ids.includes(finding.finding_id));
    if (entry.finding_ids.some((id) => !findingIds.has(id)) || criterionFindings.some((finding) => finding.criterion !== entry.criterion) ||
      criterionFindings.some((finding) => finding.evidence_ref_ids.some((id) => !refsFor(entry).has(id))) ||
      ((entry.verdict === "fail") !== criterionFindings.some((finding) => finding.severity === "blocking"))) {
      issues.push(issue("finding_invalid", "Craft findings, criterion verdicts, and evidence references must agree."));
    }
  }
  const expected = evaluateCraftProposal(context);
  for (const required of expected.findings.filter((finding) => finding.severity === "blocking")) {
    const represented = (result.findings ?? []).some((finding) => finding.severity === "blocking" && finding.criterion === required.criterion && finding.correction_class === required.correction_class);
    const verdict = result.criterion_verdicts?.find((entry) => entry.criterion === required.criterion)?.verdict;
    if (!represented || verdict !== "fail") issues.push(issue("evaluator_disagreement", "The evaluator contradicted an independently extracted mandatory craft failure."));
  }
  const reportFails = (result.findings ?? []).some((finding) => finding.severity === "blocking") || (result.criterion_verdicts ?? []).some((entry) => entry.verdict === "fail");
  if ((result.verdict === "fail") !== reportFails) issues.push(issue("verdict_mismatch", "The craft verdict does not match its mandatory criterion findings."));
  if (result.evidence_context !== expected.evidence_context) issues.push(issue("evidence_context_mismatch", "The evaluator changed the independently derived evidence-context class."));
  return uniqueIssues(issues);
}

export function assertBoundCraftApproval(definition: Pick<CraftEvaluationContext, "definition_kind" | "title" | "statements" | "section_order" | "selected_fact_revision_ids"> & {
  prompt_policy_version: string | null;
  approval_evidence?: null | { persuasive_quality?: { contract_version: number; [key: string]: unknown } };
}): void {
  if (definition.prompt_policy_version !== RESUME_PROMPT_POLICY_VERSION) return;
  const evidence = definition.approval_evidence?.persuasive_quality;
  const evaluator = evidence?.evaluator as typeof PRODUCT_CRAFT_EVALUATOR | undefined;
  if (
    evidence?.contract_version !== 2 || evidence.quality_state !== "owner_approved" || evidence.craft_definition_digest !== craftDefinitionDigest(definition) ||
    canonicalInputDigest(evaluator) !== canonicalInputDigest(PRODUCT_CRAFT_EVALUATOR) ||
    evidence.evidence_limited_policy_id !== CRAFT_EVIDENCE_LIMITED_POLICY.policy_id ||
    evidence.evidence_limited_policy_version !== CRAFT_EVIDENCE_LIMITED_POLICY.policy_version ||
    evidence.evidence_limited_authority_status !== CRAFT_EVIDENCE_LIMITED_POLICY.authority_status
  ) throw new Error("Craft quality report is missing, stale, or failing");
}

function defaultPositiveEvidence(criterion: CraftCriterion, context: CraftEvaluationContext, anchors: CraftAnchorEvidence): CraftEvidenceReference[] {
  if (criterion === "C1") {
    const ids = anchors.criterion_inputs.find((entry) => entry.criterion === "C1")?.anchor_ids ?? [];
    return ids.slice(0, 8).map((anchorId) => evidenceReference(context, anchors, criterion, "rendered_anchor", "positive", { anchor_id: anchorId }));
  }
  if (criterion === "C2") {
    const experience = context.statements.filter((statement) => statement.section_id === "experience" && statement.display_role !== "heading");
    return [
      ...experience.slice(0, 8).map((statement) => evidenceReference(context, anchors, criterion, "statement", "positive", { statement_id: statement.statement_id })),
      evidenceReference(context, anchors, criterion, "strategy", "positive", { revision_id: context.strategy_revision_id }),
    ];
  }
  if (criterion === "C3" || criterion === "C6" || criterion === "C7") {
    const statement = context.statements.find((entry) => entry.section_id === "experience" && entry.display_role !== "heading") ?? context.statements[0];
    return statement ? [evidenceReference(context, anchors, criterion, "statement", "positive", { statement_id: statement.statement_id })] : [evidenceReference(context, anchors, criterion, "deterministic_gate", "positive", { absence_code: "deterministic_gate_passed" })];
  }
  return [evidenceReference(context, anchors, criterion, "strategy", "positive", { revision_id: context.strategy_revision_id })];
}

function evidenceReference(
  context: CraftEvaluationContext,
  anchors: CraftAnchorEvidence,
  criterion: CraftCriterion,
  kind: CraftEvidenceKind,
  polarity: CraftEvidenceReference["polarity"],
  identity: Partial<Pick<CraftEvidenceReference, "statement_id" | "revision_id" | "anchor_id" | "absence_code">>,
): CraftEvidenceReference {
  const referenceWithoutDigest = {
    evidence_ref_id: deterministicUuid(`${criterion}:${kind}:${polarity}:${identity.statement_id ?? identity.revision_id ?? identity.anchor_id ?? identity.absence_code ?? "context"}`),
    kind,
    polarity,
    statement_id: identity.statement_id ?? null,
    revision_id: identity.revision_id ?? null,
    anchor_id: identity.anchor_id ?? null,
    absence_code: identity.absence_code ?? null,
  };
  return { ...referenceWithoutDigest, evidence_digest: evidenceDigestForReference(referenceWithoutDigest, context, anchors)! };
}

function evidenceDigestForReference(reference: Omit<CraftEvidenceReference, "evidence_digest"> | CraftEvidenceReference, context: CraftEvaluationContext, anchors: CraftAnchorEvidence): string | null {
  if (reference.kind === "statement") {
    const statement = context.statements.find((entry) => entry.statement_id === reference.statement_id);
    return statement ? canonicalInputDigest({ kind: "statement", definition_revision_id: context.definition_revision_id, statement }) : null;
  }
  if (reference.kind === "rendered_anchor") return anchors.anchors.find((anchor) => anchor.anchor_id === reference.anchor_id)?.evidence_digest ?? null;
  if (reference.kind === "strategy" && reference.revision_id === context.strategy_revision_id) return canonicalInputDigest({ kind: "strategy", revision_id: context.strategy_revision_id, strategy: context.strategy });
  if (reference.kind === "fact" && reference.revision_id && context.fact_revision_ids.includes(reference.revision_id)) return canonicalInputDigest({ kind: "fact", revision_id: reference.revision_id, definition_revision_id: context.definition_revision_id, strategy_revision_id: context.strategy_revision_id, absence_code: reference.absence_code });
  if (reference.kind === "coverage" && reference.revision_id && context.coverage_revision_ids.includes(reference.revision_id)) return canonicalInputDigest({ kind: "coverage", revision_id: reference.revision_id, definition_revision_id: context.definition_revision_id, strategy_revision_id: context.strategy_revision_id });
  if (reference.kind === "target_analysis" && reference.revision_id && reference.revision_id === context.target_analysis?.revision_id) return canonicalInputDigest({ kind: "target_analysis", revision_id: reference.revision_id, target_analysis: context.target_analysis });
  if (reference.kind === "deterministic_gate") return context.deterministic_gate_digest;
  if (reference.kind === "explicit_absence" && reference.absence_code) return canonicalInputDigest({ absence_code: reference.absence_code, definition_revision_id: context.definition_revision_id, strategy_revision_id: context.strategy_revision_id });
  return null;
}

function refsFor(entry: CraftEvaluationResult["criterion_verdicts"][number]): Set<string> {
  return new Set(entry.evidence_refs.map((reference) => reference.evidence_ref_id));
}

function dedupeReferences(references: CraftEvidenceReference[]): CraftEvidenceReference[] {
  return [...new Map(references.map((reference) => [reference.evidence_ref_id, reference])).values()];
}

function issue(code: CraftEvaluationIssue["code"], safeMessage: string): CraftEvaluationIssue {
  return { code, safe_message: safeMessage };
}

function uniqueIssues(issues: CraftEvaluationIssue[]): CraftEvaluationIssue[] {
  return [...new Map(issues.map((entry) => [`${entry.code}:${entry.safe_message}`, entry])).values()];
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
