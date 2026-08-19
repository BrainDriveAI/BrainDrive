import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import type {
  CareerFactRecordSchema,
  ResumeDefinitionRecordSchema,
  TailoredVariantRecordSchema,
} from "../app-platform/contracts/data.js";
import type { z } from "zod";

type CareerFact = z.infer<typeof CareerFactRecordSchema>;
type Definition = z.infer<typeof ResumeDefinitionRecordSchema>;
type Variant = z.infer<typeof TailoredVariantRecordSchema>;
type Statement = Definition["statements"][number];

export type DerivedResumeImpact = {
  affected_statements: Array<{ statement_id: string; change: "added" | "removed" | "corrected" | "reworded" }>;
  stale_tailored_variant_revision_ids: string[];
};

function statementMeaning(statement: Statement): string {
  return canonicalInputDigest({
    section_id: statement.section_id,
    kind: statement.kind,
    display_role: statement.display_role ?? null,
    text: statement.text,
    supporting_confirmed_fact_revision_ids: statement.supporting_confirmed_fact_revision_ids,
  });
}
export function unchangedStatementIdentityIssues(source: Definition, successorStatements: readonly Statement[]): string[] {
  const successorByMeaning = new Map<string, Statement[]>();
  for (const statement of successorStatements) {
    const digest = statementMeaning(statement);
    successorByMeaning.set(digest, [...(successorByMeaning.get(digest) ?? []), statement]);
  }
  const issues: string[] = [];
  for (const sourceStatement of source.statements) {
    const unchanged = successorByMeaning.get(statementMeaning(sourceStatement)) ?? [];
    if (unchanged.length > 0 && !unchanged.some((statement) => statement.statement_id === sourceStatement.statement_id)) {
      issues.push(sourceStatement.statement_id);
    }
  }
  return issues;
}

export function definitionStatementsChanged(source: Definition, successorStatements: readonly Statement[]): boolean {
  if (source.statements.length !== successorStatements.length) return true;
  return source.statements.some((statement, index) => statementMeaning(statement) !== statementMeaning(successorStatements[index]!));
}

export function changedFactLineage(changedFacts: readonly CareerFact[]): Set<string> {
  const lineage = new Set<string>();
  for (const fact of changedFacts) {
    lineage.add(fact.metadata.revision_id);
    if (fact.supersedes_fact_revision_id) lineage.add(fact.supersedes_fact_revision_id);
  }
  return lineage;
}

export function staleTailoredVariantIds(
  sourceRevisionId: string,
  factLineage: ReadonlySet<string>,
  variants: readonly Variant[],
): string[] {
  return variants
    .filter((variant) => variant.parent_general_definition_revision_id === sourceRevisionId
      || variant.evidence_matrix.some((item) => item.supporting_confirmed_fact_revision_ids.some((revisionId) => factLineage.has(revisionId))))
    .map((variant) => variant.metadata.revision_id)
    .sort();
}

export function deriveResumeImpact(
  source: Definition,
  successor: Definition | null,
  factLineage: ReadonlySet<string>,
  variants: readonly Variant[],
): DerivedResumeImpact {
  const staleIds = staleTailoredVariantIds(source.metadata.revision_id, factLineage, variants);
  if (!successor) {
    return {
      affected_statements: source.statements
        .filter((statement) => statement.supporting_confirmed_fact_revision_ids.some((revisionId) => factLineage.has(revisionId)))
        .map((statement) => ({ statement_id: statement.statement_id, change: "corrected" as const })),
      stale_tailored_variant_revision_ids: staleIds,
    };
  }

  const successorById = new Map(successor.statements.map((statement) => [statement.statement_id, statement]));
  const sourceIds = new Set(source.statements.map((statement) => statement.statement_id));
  const affected: DerivedResumeImpact["affected_statements"] = [];
  for (const before of source.statements) {
    const after = successorById.get(before.statement_id);
    if (!after) {
      affected.push({ statement_id: before.statement_id, change: "removed" });
      continue;
    }
    if (statementMeaning(before) === statementMeaning(after)) continue;
    const evidenceChanged = [...before.supporting_confirmed_fact_revision_ids, ...after.supporting_confirmed_fact_revision_ids]
      .some((revisionId) => factLineage.has(revisionId));
    affected.push({ statement_id: before.statement_id, change: evidenceChanged ? "corrected" : "reworded" });
  }
  for (const after of successor.statements) {
    if (!sourceIds.has(after.statement_id)) affected.push({ statement_id: after.statement_id, change: "added" });
  }
  return { affected_statements: affected, stale_tailored_variant_revision_ids: staleIds };
}
