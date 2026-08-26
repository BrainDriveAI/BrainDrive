import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import type { CraftCorrectionClass, CraftCriterion, CraftStatement } from "./craft-evaluator.js";

type SourceDefinition = { metadata: { revision_id: string }; title: string; statements: CraftStatement[]; section_order: string[] };
type SourceReport = {
  metadata: { revision_id: string };
  proposal_definition_revision_id: string;
  coverage_revision_ids?: string[];
  verdict: "pass" | "fail";
  criterion_verdicts?: Array<{ evidence_refs?: V2EvidenceReference[] }>;
  findings: Array<{ criterion: CraftCriterion; statement_id?: string | null; severity: "guidance" | "blocking"; correction_class: CraftCorrectionClass; evidence_ref_ids?: string[] }>;
};
type RepairResult = {
  source_definition_revision_id: string;
  source_report_revision_id: string;
  changed_statement_ids: string[];
  title: string;
  statements: CraftStatement[];
  section_order: string[];
};

type V2EvidenceReference = {
  evidence_ref_id: string;
  kind: "statement" | "rendered_anchor" | "strategy" | "fact" | "coverage" | "target_analysis" | "deterministic_gate" | "explicit_absence";
  polarity: "positive" | "negative" | "absence";
  statement_id: string | null;
  revision_id: string | null;
};
type V2Report = {
  report_version: 2;
  metadata: { revision_id: string };
  proposal_definition_revision_id: string;
  coverage_revision_ids?: string[];
  verdict: "pass" | "fail";
  criterion_verdicts: Array<{ evidence_refs: V2EvidenceReference[] }>;
  findings: Array<{
    finding_id: string;
    severity: "guidance" | "blocking";
    correction_class: CraftCorrectionClass;
    evidence_ref_ids: string[];
  }>;
};
type CoverageOpportunity = {
  opportunity_id: string;
  dimension: "responsibilities" | "accomplishments" | "outcomes" | "tools" | "scope" | "progression";
  opportunity_kind: "qualitative" | "metric";
  value_category: "distinct_accomplishment" | "decision_useful_outcome" | "scope_or_scale" | "tools_in_use" | "progression" | "core_responsibility";
  context_digest: string;
  state: "available" | "suppressed" | "resolved";
};
type CoverageRecord = {
  metadata: { record_id: string; revision_id: string; revision: number };
  job_fact_revision_id: string;
  opportunities: CoverageOpportunity[];
};

export type CraftCorrectionAction =
  | { action: "repair_statement"; source_definition_revision_id: string; source_report_revision_id: string; statement_scope_ids: string[]; correction_class: CraftCorrectionClass; attempt: 1 }
  | { action: "add_evidence"; source_definition_revision_id: string; source_report_revision_id: string; coverage_record_id: string; coverage_revision_id: string; coverage_revision: number; job_fact_revision_id: string; opportunity_id: string; dimension: CoverageOpportunity["dimension"]; opportunity_kind: CoverageOpportunity["opportunity_kind"]; value_category: CoverageOpportunity["value_category"]; context_digest: string; attempt: 1 }
  | { action: "manual_revision"; source_definition_revision_id: string; source_report_revision_id: string; finding_ids: string[]; reason: "supported_non_statement_change" }
  | { action: "keep_prior_or_exit"; source_definition_revision_id: string; source_report_revision_id: string; reason: "report_not_repairable" | "mixed_repair_authority" | "no_material_evidence_opportunity" };

const OPPORTUNITY_DIMENSION_RANK: CoverageOpportunity["dimension"][] = ["accomplishments", "outcomes", "scope", "tools", "progression", "responsibilities"];

function baseAction(report: V2Report) {
  return {
    source_definition_revision_id: report.proposal_definition_revision_id,
    source_report_revision_id: report.metadata.revision_id,
  };
}

/** Derives one content-free correction route from exact report evidence and current coverage heads. */
export function deriveCraftCorrectionAction(report: V2Report, coverage: CoverageRecord[]): CraftCorrectionAction {
  const base = baseAction(report);
  const blockers = report.findings.filter((finding) => finding.severity === "blocking");
  if (report.verdict !== "fail" || blockers.length === 0) return { action: "keep_prior_or_exit", ...base, reason: "report_not_repairable" };

  const evidence = new Map(report.criterion_verdicts.flatMap((criterion) => criterion.evidence_refs).map((reference) => [reference.evidence_ref_id, reference]));
  const blockerEvidence = blockers.flatMap((finding) => finding.evidence_ref_ids.map((id) => evidence.get(id)).filter((reference): reference is V2EvidenceReference => Boolean(reference)));
  const hasExplicitAbsence = blockerEvidence.some((reference) => reference.kind === "explicit_absence" && reference.polarity === "absence");
  if (hasExplicitAbsence) {
    const citedCoverage = new Set([
      ...(report.coverage_revision_ids ?? []),
      ...blockerEvidence.filter((reference) => reference.kind === "coverage" && reference.revision_id !== null).map((reference) => reference.revision_id!),
    ]);
    const candidates = coverage
      .filter((record) => citedCoverage.has(record.metadata.revision_id))
      .flatMap((record) => record.opportunities.filter((opportunity) => opportunity.state === "available").map((opportunity) => ({ record, opportunity })))
      .sort((left, right) =>
        Number(left.opportunity.opportunity_kind === "metric") - Number(right.opportunity.opportunity_kind === "metric") ||
        OPPORTUNITY_DIMENSION_RANK.indexOf(left.opportunity.dimension) - OPPORTUNITY_DIMENSION_RANK.indexOf(right.opportunity.dimension) ||
        left.opportunity.opportunity_id.localeCompare(right.opportunity.opportunity_id));
    const selected = candidates[0];
    if (!selected) return { action: "keep_prior_or_exit", ...base, reason: "no_material_evidence_opportunity" };
    return {
      action: "add_evidence",
      ...base,
      coverage_record_id: selected.record.metadata.record_id,
      coverage_revision_id: selected.record.metadata.revision_id,
      coverage_revision: selected.record.metadata.revision,
      job_fact_revision_id: selected.record.job_fact_revision_id,
      opportunity_id: selected.opportunity.opportunity_id,
      dimension: selected.opportunity.dimension,
      opportunity_kind: selected.opportunity.opportunity_kind,
      value_category: selected.opportunity.value_category,
      context_digest: selected.opportunity.context_digest,
      attempt: 1,
    };
  }

  const classes = [...new Set(blockers.map((finding) => finding.correction_class))];
  const statementScopes = blockers.map((finding) => [...new Set(finding.evidence_ref_ids
    .map((id) => evidence.get(id))
    .filter((reference): reference is V2EvidenceReference => reference?.kind === "statement" && reference.polarity === "negative" && reference.statement_id !== null)
    .map((reference) => reference.statement_id!))]);
  if (statementScopes.every((scope) => scope.length > 0)) {
    if (classes.length !== 1) return { action: "keep_prior_or_exit", ...base, reason: "mixed_repair_authority" };
    return {
      action: "repair_statement",
      ...base,
      statement_scope_ids: [...new Set(statementScopes.flat())].sort(),
      correction_class: classes[0]!,
      attempt: 1,
    };
  }
  if (blockerEvidence.length > 0) {
    return { action: "manual_revision", ...base, finding_ids: blockers.map((finding) => finding.finding_id).sort(), reason: "supported_non_statement_change" };
  }
  return { action: "keep_prior_or_exit", ...base, reason: "report_not_repairable" };
}

export type CraftRepairIssue = {
  code: "repair_lineage_invalid" | "repair_scope_changed" | "statement_set_changed" | "unnamed_statement_changed" | "support_changed" | "section_order_changed" | "title_changed" | "statement_shape_changed" | "meaning_broadened" | "repair_noop";
  statement_id: string | null;
  safe_message: string;
};

export function validateCraftRepair(source: SourceDefinition, report: SourceReport, repair: RepairResult): CraftRepairIssue[] {
  const issues: CraftRepairIssue[] = [];
  const add = (code: CraftRepairIssue["code"], statementId: string | null, safeMessage: string) => issues.push({ code, statement_id: statementId, safe_message: safeMessage });
  if (report.verdict !== "fail" || report.proposal_definition_revision_id !== source.metadata.revision_id || repair.source_definition_revision_id !== source.metadata.revision_id || repair.source_report_revision_id !== report.metadata.revision_id) {
    add("repair_lineage_invalid", null, "Craft repair is not bound to one failing report and immutable proposal.");
  }
  const evidence = new Map((report.criterion_verdicts ?? []).flatMap((criterion) => criterion.evidence_refs ?? []).map((reference) => [reference.evidence_ref_id, reference]));
  const allowed = [...new Set(report.findings.filter((finding) => finding.severity === "blocking").flatMap((finding) => {
    if (finding.statement_id !== undefined && finding.statement_id !== null) return [finding.statement_id];
    return (finding.evidence_ref_ids ?? []).map((id) => evidence.get(id)).filter((reference): reference is V2EvidenceReference => reference?.kind === "statement" && reference.polarity === "negative" && reference.statement_id !== null).map((reference) => reference.statement_id!);
  }))].sort();
  const changed = [...new Set(repair.changed_statement_ids)].sort();
  if (canonicalInputDigest(allowed) !== canonicalInputDigest(changed) || changed.length !== repair.changed_statement_ids.length) add("repair_scope_changed", null, "Craft repair changed the named statement scope.");
  if (repair.title !== source.title) add("title_changed", null, "Craft repair cannot change the proposal title.");
  if (canonicalInputDigest(repair.section_order) !== canonicalInputDigest(source.section_order)) add("section_order_changed", null, "Craft repair cannot change section ordering outside its statement scope.");
  const sourceById = new Map(source.statements.map((statement) => [statement.statement_id, statement]));
  const repairedById = new Map(repair.statements.map((statement) => [statement.statement_id, statement]));
  if (sourceById.size !== repairedById.size || source.statements.length !== repair.statements.length || [...sourceById.keys()].some((id) => !repairedById.has(id)) || repair.statements.some((statement, index) => statement.statement_id !== source.statements[index]?.statement_id)) {
    add("statement_set_changed", null, "Craft repair cannot add, remove, duplicate, or reorder statements.");
  }
  for (const [statementId, sourceStatement] of sourceById) {
    const repairedStatement = repairedById.get(statementId);
    if (!repairedStatement) continue;
    if (canonicalInputDigest(repairedStatement.supporting_confirmed_fact_revision_ids) !== canonicalInputDigest(sourceStatement.supporting_confirmed_fact_revision_ids)) add("support_changed", statementId, "Craft repair cannot change statement support identities.");
    if (repairedStatement.section_id !== sourceStatement.section_id || repairedStatement.kind !== sourceStatement.kind || repairedStatement.display_role !== sourceStatement.display_role) add("statement_shape_changed", statementId, "Craft repair cannot change statement section, role, or factual class.");
    const changedStatement = canonicalInputDigest(repairedStatement) !== canonicalInputDigest(sourceStatement);
    if (!allowed.includes(statementId) && changedStatement) add("unnamed_statement_changed", statementId, "Craft repair changed a statement outside the authorized scope.");
    if (allowed.includes(statementId) && !changedStatement) add("repair_noop", statementId, "Every named repair statement must contain one reviewable wording change.");
    if (allowed.includes(statementId) && changedStatement && sourceStatement.kind === "presentation" && broadensPresentationMeaning(sourceStatement.text, repairedStatement.text)) {
      add("meaning_broadened", statementId, "Craft repair cannot add unsupported meaning to a presentation-only statement.");
    }
  }
  return issues;
}

const PRESENTATION_REPAIR_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "the", "to", "using", "with",
  "analyzed", "coordinated", "created", "delivered", "developed", "facilitated", "handled", "implemented", "improved", "led", "maintained", "managed", "monitored", "operated", "organized", "prepared", "processed", "produced", "resolved", "reviewed", "supported",
]);

function broadensPresentationMeaning(source: string, repaired: string): boolean {
  const sourceWords = new Set(source.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []);
  const repairedWords = repaired.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [];
  return repairedWords.some((word) => !sourceWords.has(word) && !PRESENTATION_REPAIR_WORDS.has(word));
}
