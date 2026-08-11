import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import type { CraftCorrectionClass, CraftCriterion, CraftStatement } from "./craft-evaluator.js";

type SourceDefinition = { metadata: { revision_id: string }; title: string; statements: CraftStatement[]; section_order: string[] };
type SourceReport = {
  metadata: { revision_id: string };
  proposal_definition_revision_id: string;
  verdict: "pass" | "fail";
  findings: Array<{ criterion: CraftCriterion; statement_id: string | null; severity: "guidance" | "blocking"; correction_class: CraftCorrectionClass }>;
};
type RepairResult = {
  source_definition_revision_id: string;
  source_report_revision_id: string;
  changed_statement_ids: string[];
  title: string;
  statements: CraftStatement[];
  section_order: string[];
};

export type CraftRepairIssue = {
  code: "repair_lineage_invalid" | "repair_scope_changed" | "statement_set_changed" | "unnamed_statement_changed" | "support_changed" | "section_order_changed" | "title_changed" | "statement_shape_changed" | "repair_noop";
  statement_id: string | null;
  safe_message: string;
};

export function validateCraftRepair(source: SourceDefinition, report: SourceReport, repair: RepairResult): CraftRepairIssue[] {
  const issues: CraftRepairIssue[] = [];
  const add = (code: CraftRepairIssue["code"], statementId: string | null, safeMessage: string) => issues.push({ code, statement_id: statementId, safe_message: safeMessage });
  if (report.verdict !== "fail" || report.proposal_definition_revision_id !== source.metadata.revision_id || repair.source_definition_revision_id !== source.metadata.revision_id || repair.source_report_revision_id !== report.metadata.revision_id) {
    add("repair_lineage_invalid", null, "Craft repair is not bound to one failing report and immutable proposal.");
  }
  const allowed = [...new Set(report.findings.filter((finding) => finding.severity === "blocking" && finding.statement_id !== null).map((finding) => finding.statement_id!))].sort();
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
  }
  return issues;
}
