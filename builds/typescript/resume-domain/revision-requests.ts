import { canonicalInputDigest } from "../app-platform/contracts/common.js";

export type RevisionIntentClass = "presentation" | "factual" | "mixed" | "ambiguous";
export type RevisionRequestState = "submitted" | "clarification_needed" | "awaiting_confirmation" | "generating" | "proposed" | "accepted" | "edited" | "rejected" | "regenerate" | "failed";
export type RevisionTarget = { scope: "statement" | "section" | "resume"; target_id: string | null };

export type RevisionStatement = {
  statement_id: string;
  section_id: string;
  kind: "factual" | "presentation";
  display_role?: "heading" | "bullet" | "line";
  text: string;
  supporting_confirmed_fact_revision_ids: string[];
};

export function assertRevisionTarget(
  target: RevisionTarget,
  statements: readonly RevisionStatement[],
  sectionOrder: readonly string[],
): void {
  const valid = target.scope === "resume"
    ? target.target_id === null
    : target.scope === "statement"
      ? statements.some((statement) => statement.statement_id === target.target_id)
      : target.target_id !== null && sectionOrder.includes(target.target_id);
  if (!valid) throw new Error("revision_target_invalid");
}

export function expectedClassificationState(classification: RevisionIntentClass): RevisionRequestState {
  if (classification === "ambiguous") return "clarification_needed";
  if (classification === "factual" || classification === "mixed") return "awaiting_confirmation";
  return "generating";
}

export function assertRevisionTransition(input: {
  current: RevisionRequestState;
  next: RevisionRequestState;
  classification: RevisionIntentClass | null;
  hostOwnerConfirmed: boolean;
  attempt: number;
}): void {
  const { current, next, classification, hostOwnerConfirmed, attempt } = input;
  if (current === "submitted") {
    if (!classification || next !== expectedClassificationState(classification)) throw new Error("revision_transition_invalid");
    return;
  }
  if (current === "awaiting_confirmation") {
    if (next !== "generating" || !hostOwnerConfirmed) throw new Error(hostOwnerConfirmed ? "revision_transition_invalid" : "revision_confirmation_required");
    if (attempt >= 2) throw new Error("revision_attempts_exhausted");
    return;
  }
  if (current === "regenerate" || current === "failed") {
    if (next !== "generating" || attempt >= 2) throw new Error("revision_transition_invalid");
    return;
  }
  if (current === "proposed") {
    if (next === "regenerate" && attempt >= 2) throw new Error("revision_attempts_exhausted");
    if (!["accepted", "edited", "rejected", "regenerate"].includes(next) || !hostOwnerConfirmed) {
      throw new Error(hostOwnerConfirmed ? "revision_transition_invalid" : "revision_confirmation_required");
    }
    return;
  }
  if (current === "generating" && next === "failed") return;
  throw new Error("revision_transition_invalid");
}

function meaning(statement: RevisionStatement): string {
  return canonicalInputDigest({
    section_id: statement.section_id,
    kind: statement.kind,
    display_role: statement.display_role ?? null,
    text: statement.text,
    supporting_confirmed_fact_revision_ids: statement.supporting_confirmed_fact_revision_ids,
  });
}

export function changedRevisionStatementIds(
  source: readonly RevisionStatement[],
  successor: readonly RevisionStatement[],
): string[] {
  const sourceById = new Map(source.map((statement) => [statement.statement_id, statement]));
  const successorById = new Map(successor.map((statement) => [statement.statement_id, statement]));
  const sourceIndex = new Map(source.map((statement, index) => [statement.statement_id, index]));
  const successorIndex = new Map(successor.map((statement, index) => [statement.statement_id, index]));
  const changed = new Set<string>();
  for (const statement of source) {
    const next = successorById.get(statement.statement_id);
    if (!next || meaning(statement) !== meaning(next) || sourceIndex.get(statement.statement_id) !== successorIndex.get(statement.statement_id)) changed.add(statement.statement_id);
  }
  for (const statement of successor) if (!sourceById.has(statement.statement_id)) changed.add(statement.statement_id);
  return [...changed].sort();
}

export function revisionDraftIssues(input: {
  source: { title: string; statements: RevisionStatement[]; section_order: string[] };
  successor: { title: string; statements: RevisionStatement[]; section_order: string[]; changed_statement_ids: string[] };
  target: RevisionTarget;
  classification: RevisionIntentClass;
}): string[] {
  const issues: string[] = [];
  const sourceById = new Map(input.source.statements.map((statement) => [statement.statement_id, statement]));
  const successorById = new Map(input.successor.statements.map((statement) => [statement.statement_id, statement]));
  for (const statement of input.source.statements) {
    const exact = input.successor.statements.find((candidate) => meaning(candidate) === meaning(statement));
    if (exact && exact.statement_id !== statement.statement_id) issues.push("unchanged_statement_identity");
  }
  const actualChanged = changedRevisionStatementIds(input.source.statements, input.successor.statements);
  if (canonicalInputDigest(actualChanged) !== canonicalInputDigest([...new Set(input.successor.changed_statement_ids)].sort())) issues.push("changed_statement_manifest");
  if (actualChanged.length === 0 && input.source.title === input.successor.title && canonicalInputDigest(input.source.section_order) === canonicalInputDigest(input.successor.section_order)) issues.push("revision_no_change");
  if (input.target.scope === "statement" && actualChanged.some((id) => id !== input.target.target_id)) issues.push("revision_scope");
  if (input.target.scope === "section") {
    for (const id of actualChanged) {
      const section = successorById.get(id)?.section_id ?? sourceById.get(id)?.section_id;
      if (section !== input.target.target_id) issues.push("revision_scope");
    }
  }
  if (input.classification === "presentation") {
    if (sourceById.size !== successorById.size || [...sourceById.keys()].some((id) => !successorById.has(id))) issues.push("presentation_statement_set");
    for (const [id, source] of sourceById) {
      const successor = successorById.get(id);
      if (!successor) continue;
      if (
        source.kind !== successor.kind ||
        source.section_id !== successor.section_id ||
        (source.display_role ?? null) !== (successor.display_role ?? null) ||
        canonicalInputDigest(source.supporting_confirmed_fact_revision_ids) !== canonicalInputDigest(successor.supporting_confirmed_fact_revision_ids)
      ) issues.push("presentation_factual_shape");
    }
  }
  return [...new Set(issues)];
}
