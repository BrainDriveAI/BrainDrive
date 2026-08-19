import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { DefinitionComparisonResultSchema } from "../app-platform/contracts/data.js";
import type { ResumeDefinition } from "./resume-lineage.js";

type Statement = ResumeDefinition["statements"][number];

function statementSnapshot(statement: Statement, index: number) {
  return {
    statement_id: statement.statement_id,
    index,
    section_id: statement.section_id,
    kind: statement.kind,
    display_role: statement.display_role ?? null,
    text: statement.text,
    supporting_confirmed_fact_revision_ids: [...statement.supporting_confirmed_fact_revision_ids],
    statement_digest: canonicalInputDigest(statement),
  };
}

function semanticDigest(statement: Statement): string {
  return canonicalInputDigest({
    section_id: statement.section_id,
    kind: statement.kind,
    display_role: statement.display_role ?? null,
    text: statement.text,
  });
}

function evidenceDigest(statement: Statement): string {
  return canonicalInputDigest([...statement.supporting_confirmed_fact_revision_ids].sort());
}

function related(left: ResumeDefinition, right: ResumeDefinition, definitions: readonly ResumeDefinition[]): boolean {
  if (left.metadata.revision_id === right.metadata.revision_id) return true;
  const byRevision = new Map(definitions.map((definition) => [definition.metadata.revision_id, definition]));
  const neighbors = new Map<string, Set<string>>();
  const connect = (from: string, to: string | null | undefined) => {
    if (!to || !byRevision.has(to)) return;
    const fromNeighbors = neighbors.get(from) ?? new Set<string>();
    fromNeighbors.add(to);
    neighbors.set(from, fromNeighbors);
    const toNeighbors = neighbors.get(to) ?? new Set<string>();
    toNeighbors.add(from);
    neighbors.set(to, toNeighbors);
  };
  for (const definition of definitions) {
    connect(definition.metadata.revision_id, definition.metadata.prior_revision_id);
    connect(definition.metadata.revision_id, definition.parent_definition_revision_id);
  }
  const seen = new Set([left.metadata.revision_id]);
  const queue = [left.metadata.revision_id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const candidate of neighbors.get(current) ?? []) {
      if (candidate === right.metadata.revision_id) return true;
      if (!seen.has(candidate)) {
        seen.add(candidate);
        queue.push(candidate);
      }
    }
  }
  return false;
}

function compatible(left: ResumeDefinition, right: ResumeDefinition): boolean {
  return left.definition_kind === right.definition_kind
    && (left.definition_kind !== "targeted" || left.job_revision_id === right.job_revision_id);
}

function countSummary(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function compareDefinitionRevisions(
  left: ResumeDefinition,
  right: ResumeDefinition,
  definitions: readonly ResumeDefinition[],
) {
  const relation = left.metadata.revision_id === right.metadata.revision_id
    ? "identical" as const
    : related(left, right, definitions)
      ? "related" as const
      : "unrelated" as const;
  const isCompatible = compatible(left, right);
  const base = {
    comparison_version: 2 as const,
    left_revision_id: left.metadata.revision_id,
    right_revision_id: right.metadata.revision_id,
    left_digest: canonicalInputDigest(left),
    right_digest: canonicalInputDigest(right),
    relation,
    compatibility: isCompatible && relation !== "unrelated" ? "compatible" as const : "incompatible" as const,
  };
  if (relation === "unrelated" || !isCompatible) {
    return DefinitionComparisonResultSchema.parse({
      ...base,
      result: "unavailable",
      unavailable_reason: relation === "unrelated" ? "unrelated" : "incompatible",
      added: [], removed: [], changed: [], moved: [], evidence_changed: [], unchanged: [], unchanged_count: 0,
      evidence_changes: { added_revision_ids: [], removed_revision_ids: [] },
      observable_summary: ["These versions cannot be compared."],
    });
  }

  const leftById = new Map(left.statements.map((statement, index) => [statement.statement_id, { statement, index }]));
  const rightById = new Map(right.statements.map((statement, index) => [statement.statement_id, { statement, index }]));
  const change = (statementId: string) => {
    const before = leftById.get(statementId);
    const after = rightById.get(statementId);
    return {
      statement_id: statementId,
      before_index: before?.index ?? null,
      after_index: after?.index ?? null,
      before_digest: before ? canonicalInputDigest(before.statement) : null,
      after_digest: after ? canonicalInputDigest(after.statement) : null,
      before: before ? statementSnapshot(before.statement, before.index) : null,
      after: after ? statementSnapshot(after.statement, after.index) : null,
    };
  };
  const addedIds = [...rightById.keys()].filter((statementId) => !leftById.has(statementId));
  const removedIds = [...leftById.keys()].filter((statementId) => !rightById.has(statementId));
  const sharedIds = [...leftById.keys()].filter((statementId) => rightById.has(statementId));
  const changedIds = sharedIds.filter((statementId) => semanticDigest(leftById.get(statementId)!.statement) !== semanticDigest(rightById.get(statementId)!.statement));
  const movedIds = sharedIds.filter((statementId) => leftById.get(statementId)!.index !== rightById.get(statementId)!.index);
  const evidenceChangedIds = sharedIds.filter((statementId) => evidenceDigest(leftById.get(statementId)!.statement) !== evidenceDigest(rightById.get(statementId)!.statement));
  const unchangedIds = sharedIds.filter((statementId) => !changedIds.includes(statementId) && !movedIds.includes(statementId) && !evidenceChangedIds.includes(statementId));
  const summaries = [
    addedIds.length ? countSummary(addedIds.length, "statement added.", "statements added.") : null,
    removedIds.length ? countSummary(removedIds.length, "statement removed.", "statements removed.") : null,
    changedIds.length ? countSummary(changedIds.length, "statement changed.", "statements changed.") : null,
    movedIds.length ? countSummary(movedIds.length, "statement moved.", "statements moved.") : null,
    evidenceChangedIds.length ? `Evidence references changed for ${evidenceChangedIds.length} statement${evidenceChangedIds.length === 1 ? "" : "s"}.` : null,
  ].filter((summary): summary is string => summary !== null);

  return DefinitionComparisonResultSchema.parse({
    ...base,
    result: "available",
    unavailable_reason: null,
    added: addedIds.map(change),
    removed: removedIds.map(change),
    changed: changedIds.map(change),
    moved: movedIds.map(change),
    evidence_changed: evidenceChangedIds.map(change),
    unchanged: unchangedIds.map(change),
    unchanged_count: unchangedIds.length,
    evidence_changes: {
      added_revision_ids: right.selected_fact_revision_ids.filter((revisionId) => !left.selected_fact_revision_ids.includes(revisionId)),
      removed_revision_ids: left.selected_fact_revision_ids.filter((revisionId) => !right.selected_fact_revision_ids.includes(revisionId)),
    },
    observable_summary: summaries.length ? summaries : ["No observable changes."],
  });
}
