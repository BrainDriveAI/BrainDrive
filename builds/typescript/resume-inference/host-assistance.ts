import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import type { InferencePurpose } from "../app-platform/contracts/inference.js";
import { changedRevisionStatementIds } from "../resume-domain/revision-requests.js";
import { craftContextFromBlocks, evaluateCraftProposal } from "./craft-evaluator.js";
import { canonicalSectionOrder, canonicalizeFacts, canonicalizeStrategyResult, sectionForFact } from "./strategy.js";
import { decideTargetFit, TARGET_FIT_THRESHOLD_POLICY, type EvidenceRow, type PlannedChange } from "./target-fit.js";

export const RESUME_HOST_ASSISTANCE_POLICY = {
  policy_id: "braindrive.resume-builder.host-owned-structure",
  policy_version: "1",
  purposes: ["general_resume_draft", "resume_strategy", "tailoring_plan", "targeted_resume_draft", "resume_revision_draft", "resume_craft_evaluate"],
  invariant_owner: "braindrive_host",
  language_owner: "active_compatible_model",
  score_free: true,
} as const;

export const RESUME_HOST_ASSISTANCE_POLICY_DIGEST = canonicalInputDigest(RESUME_HOST_ASSISTANCE_POLICY);

type DataBlock = { category: string; data: unknown; content_digest?: string };
type Statement = {
  statement_id: string;
  section_id: string;
  kind: "factual" | "presentation";
  display_role?: "heading" | "bullet" | "line";
  text: string;
  supporting_confirmed_fact_revision_ids: string[];
};

export function normalizeHostOwnedResult(purpose: InferencePurpose, result: unknown, blocks: readonly DataBlock[]): unknown {
  if (purpose === "general_resume_draft") return normalizeGeneralDraft(result, blocks);
  if (purpose === "tailoring_plan") return normalizeTailoringPlan(result, blocks);
  if (purpose === "targeted_resume_draft") return normalizeTargetedDraft(result, blocks);
  if (purpose === "resume_revision_draft") return normalizeRevisionDraft(result, blocks);
  if (purpose === "resume_craft_evaluate") return deterministicCraftEvaluation(blocks);
  return result;
}

function normalizeGeneralDraft(result: unknown, blocks: readonly DataBlock[]): unknown {
  const proposed = objectValue(result);
  const strategy = blocks.find((block) => block.category === "resume_strategy")?.data as { section_order?: unknown } | undefined;
  if (!proposed || !Array.isArray(strategy?.section_order) || strategy.section_order.some((section) => typeof section !== "string")) return result;
  let statements = Array.isArray(proposed.statements) ? proposed.statements : null;
  if (statements) {
    const summaryIndex = statements.findIndex((candidate) => objectValue(candidate)?.section_id === "summary");
    const summary = summaryIndex >= 0 ? objectValue(statements[summaryIndex]) : null;
    const summaryText = stringValue(summary?.text);
    const experienceTexts = statements.flatMap((candidate) => {
      const statement = objectValue(candidate);
      return statement?.section_id === "experience" && statement.display_role !== "heading" && typeof statement.text === "string" ? [statement.text] : [];
    });
    const weakSummary = summaryText && (
      /\bwith experience\s+(?:support|coordinate|manage|lead|train|maintain|schedule)\b/i.test(summaryText)
      || experienceTexts.some((text) => textOverlap(summaryText, text) >= 0.8)
    );
    if (weakSummary && summary) {
      const fallback = objectValue(deterministicGeneralDraft(blocks));
      const replacement = Array.isArray(fallback?.statements)
        ? fallback.statements.map(objectValue).find((statement) => statement?.section_id === "summary")
        : null;
      if (replacement) statements = statements.map((statement, index) => index === summaryIndex ? { ...replacement, statement_id: summary.statement_id } : statement);
    }
  }
  return { ...proposed, ...(statements ? { statements } : {}), section_order: [...strategy.section_order] };
}

export function deterministicHostFallback(purpose: InferencePurpose, blocks: readonly DataBlock[]): unknown | null {
  if (purpose === "resume_craft_evaluate") return deterministicCraftEvaluation(blocks);
  if (purpose === "general_resume_draft") return deterministicGeneralDraft(blocks);
  if (purpose === "resume_strategy") return deterministicStrategy(blocks);
  return null;
}

function deterministicStrategy(blocks: readonly DataBlock[]): unknown | null {
  const snapshot = blocks.find((block) => block.category === "confirmed_fact_snapshot")?.data as {
    facts?: Array<{ revision_id: string; fact_kind: string; value: string }>;
  } | undefined;
  const annotations = blocks.find((block) => block.category === "evidence_annotations")?.data as {
    annotation_version: 1;
    facts: Array<{ fact_revision_id: string; evidence_class: string; job_fact_revision_id: string | null; required_priority: "must_use" | "preferred" | "context" }>;
    coverage_digest: `sha256:${string}`;
    unresolved_gap_ids: string[];
  } | undefined;
  if (!snapshot?.facts?.length || !annotations) return null;
  const facts = canonicalizeFacts(snapshot.facts);
  const jobs = facts.filter((fact) => fact.fact_kind === "employment");
  const includeSummary = jobs.length >= 2;
  return canonicalizeStrategyResult({
    strategy_version: 1,
    history_shape: jobs.length <= 1 ? "early_career" : jobs.length >= 5 ? "senior_selective" : "chronological_standard",
    history_reason_code: jobs.length <= 1 ? "thin_history" : jobs.length >= 5 ? "senior_compression" : "standard_chronology",
    role_emphasis: jobs.map((job, index) => {
      const evidenceCount = annotations.facts.filter((fact) => fact.job_fact_revision_id === job.revision_id && fact.evidence_class !== "role_identity").length;
      return { job_fact_revision_id: job.revision_id, priority: index === 0 ? "primary" as const : index >= 3 ? "compressed" as const : "supporting" as const, reason_code: index === 0 ? "recent" as const : index >= 3 ? "older_context" as const : "continuity" as const, bullet_density: evidenceCount >= 4 ? "expanded" as const : evidenceCount >= 2 ? "standard" as const : evidenceCount === 1 ? "compact" as const : "none" as const };
    }),
    section_order: canonicalSectionOrder(facts, includeSummary ? "include" : "omit"),
    evidence_priorities: annotations.facts.map((fact) => ({ fact_revision_id: fact.fact_revision_id, priority: fact.required_priority })),
    summary_decision: includeSummary ? "include" as const : "omit" as const,
    summary_reason_code: includeSummary ? "supported_positioning" as const : "insufficient_distinct_value" as const,
    skills_context: facts.filter((fact) => fact.fact_kind === "skill").map((fact) => ({ skill_fact_revision_id: fact.revision_id, placement: "skills_section" as const, context_fact_revision_ids: [] })),
    omissions: [],
    unresolved_gap_ids: annotations.unresolved_gap_ids,
    owner_rationale: "Lead with the most recent supported experience and preserve every distinct confirmed evidence unit.",
  }, facts, annotations);
}

function deterministicGeneralDraft(blocks: readonly DataBlock[]): unknown | null {
  const snapshot = blocks.find((block) => block.category === "confirmed_fact_snapshot")?.data as {
    facts?: Array<{ revision_id: string; fact_kind: string; value: string }>;
  } | undefined;
  if (!snapshot?.facts?.length) return null;
  const facts = canonicalizeFacts(snapshot.facts);
  const strategy = blocks.find((block) => block.category === "resume_strategy")?.data as {
    summary_decision?: "include" | "omit";
    section_order?: string[];
    omissions?: Array<{ fact_revision_id: string; reason_code: string }>;
  } | undefined;
  const omissions = strategy?.omissions ?? [];
  const omitted = new Set(omissions.map((entry) => entry.fact_revision_id));
  const statements: Statement[] = [];
  const add = (factRevisionIds: string | string[], sectionId: string, text: string, displayRole: Statement["display_role"] = "line", label = text) => {
    const normalized = text.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (!normalized) return;
    const support = Array.isArray(factRevisionIds) ? factRevisionIds : [factRevisionIds];
    statements.push({
      statement_id: deterministicId({ purpose: "general_resume_draft", fact_revision_ids: support, label }),
      section_id: sectionId,
      kind: "factual",
      display_role: displayRole,
      text: normalized,
      supporting_confirmed_fact_revision_ids: support,
    });
  };
  const firstJobFact = facts.find((fact) => fact.fact_kind === "employment" && !omitted.has(fact.revision_id));
  const firstJob = firstJobFact ? structuredRecord(firstJobFact.value) : null;
  if (strategy?.summary_decision === "include" && firstJobFact && firstJob?.format === "resume_job_v1") {
    const title = stringValue(firstJob.title) ?? "Professional";
    const directionFact = facts.find((fact) => fact.fact_kind === "preference" && /^Resume goal:\s*/i.test(fact.value));
    const generalEvidenceFact = facts.find((fact) => {
      const value = fact.fact_kind === "job_evidence" ? structuredRecord(fact.value) : null;
      return value?.value_version === 1 && value.association === "general" && value.outcome === "answered" && !omitted.has(fact.revision_id);
    });
    const direction = directionFact?.value.replace(/^Resume goal:\s*/i, "").trim();
    const generalEvidence = generalEvidenceFact ? stringValue(structuredRecord(generalEvidenceFact.value)?.owner_text) : null;
    const priorJobFact = facts.find((fact) => fact.fact_kind === "employment" && fact.revision_id !== firstJobFact.revision_id && !omitted.has(fact.revision_id));
    const priorTitle = priorJobFact ? stringValue(structuredRecord(priorJobFact.value)?.title) : null;
    if (direction && generalEvidence && directionFact && generalEvidenceFact) {
      add([firstJobFact.revision_id, directionFact.revision_id, generalEvidenceFact.revision_id], "summary", `${title} targeting ${direction}, with experience in ${generalEvidence}.`, "line", "summary");
    } else if (priorTitle && priorJobFact) {
      add([firstJobFact.revision_id, priorJobFact.revision_id], "summary", `${title} with prior experience as ${priorTitle}.`, "line", "summary");
    } else {
      add(firstJobFact.revision_id, "summary", `${title} at ${stringValue(firstJob.employer) ?? "the confirmed employer"}.`, "line", "summary");
    }
  }
  for (const fact of facts) {
    if (omitted.has(fact.revision_id) || fact.fact_kind === "preference") continue;
    const structured = structuredRecord(fact.value);
    if (fact.fact_kind === "employment" && structured?.format === "resume_job_v1") {
      const heading = [stringValue(structured.title), stringValue(structured.employer), stringValue(structured.location), [stringValue(structured.start_date), stringValue(structured.end_date)].filter(Boolean).join(" - ")].filter(Boolean).join(" | ");
      add(fact.revision_id, "experience", heading, "heading", "heading");
      const responsibilities = stringValue(structured.responsibilities);
      if (responsibilities && !(strategy?.summary_decision === "include" && fact.revision_id === firstJobFact?.revision_id)) add(fact.revision_id, "experience", responsibilities, "bullet", "responsibilities");
      continue;
    }
    if (fact.fact_kind === "accomplishment" && structured?.format === "resume_accomplishment_v1") {
      add(fact.revision_id, "experience", stringValue(structured.text) ?? fact.value, "bullet", "accomplishment");
      continue;
    }
    if (fact.fact_kind === "job_evidence" && structured?.value_version === 1) {
      if (structured.outcome === "answered") add(fact.revision_id, structured.association === "general" ? "skills" : "experience", stringValue(structured.owner_text) ?? fact.value, structured.association === "general" ? "line" : "bullet", "job_evidence");
      continue;
    }
    const section = sectionForFact(fact);
    if (section) add(fact.revision_id, section, fact.value, section === "experience" ? "bullet" : "line", "fact");
  }
  if (statements.length === 0) return null;
  const contact = facts.find((fact) => fact.fact_kind === "contact" && !fact.value.startsWith("Professional link:"));
  return {
    title: contact?.value.split("|")[0]?.trim() || "Resume",
    statements,
    section_order: strategy?.section_order ?? canonicalSectionOrder(facts, strategy?.summary_decision ?? "omit", [...omitted]),
    omissions,
  };
}

function normalizeTailoringPlan(result: unknown, blocks: readonly DataBlock[]): unknown {
  const proposed = objectValue(result);
  const evidence = blocks.find((block) => block.category === "evidence_matrix")?.data;
  const definition = blocks.find((block) => block.category === "general_resume_definition")?.data as { statements?: Statement[] } | undefined;
  if (!Array.isArray(evidence) || !Array.isArray(definition?.statements)) return result;
  const rows = evidence as EvidenceRow[];
  const statementById = new Map(definition.statements.map((statement) => [statement.statement_id, statement]));
  const proposedChanges = Array.isArray(proposed?.changes) ? proposed.changes.flatMap((candidate) => {
    const change = objectValue(candidate);
    const row = rows.find((item) => item.requirement_id === change?.requirement_id);
    const statement = typeof change?.statement_id === "string" ? statementById.get(change.statement_id) : undefined;
    if (!row || row.evidence_status !== "supported" || !statement || !["selection", "ordering", "emphasis"].includes(String(change?.action))) return [];
    const support = stringArray(change?.supporting_confirmed_fact_revision_ids);
    if (!sameIds(support, row.supporting_confirmed_fact_revision_ids) || !statementSupportsRow(statement, row)) return [];
    return [{
      change_id: typeof change?.change_id === "string" ? change.change_id : deterministicId({ row: row.requirement_id, statement: statement.statement_id }),
      requirement_id: row.requirement_id,
      statement_id: statement.statement_id,
      action: change?.action as PlannedChange["action"],
      supporting_confirmed_fact_revision_ids: [...row.supporting_confirmed_fact_revision_ids],
      rationale: stringValue(change?.rationale) ?? "Emphasize the confirmed evidence already present in this statement.",
    }];
  }) : [];
  const changes = proposedChanges.length > 0 ? proposedChanges : derivedTailoringChanges(rows, definition.statements);
  const decision = decideTargetFit(rows, changes);
  const rationaleById = new Map(changes.map((change) => [change.change_id, change.rationale]));
  return {
    plan_version: 2,
    threshold_policy_id: TARGET_FIT_THRESHOLD_POLICY.policy_id,
    threshold_policy_version: TARGET_FIT_THRESHOLD_POLICY.policy_version,
    fit_class: decision.fit_class,
    outcome: decision.outcome,
    no_change_reason: decision.no_change_reason,
    support_counts: decision.support_counts,
    changes: decision.material_changes.map((change) => ({
      ...change,
      rationale: rationaleById.get(change.change_id) ?? "Emphasize the confirmed evidence already present in this statement.",
    })),
  };
}

function derivedTailoringChanges(rows: readonly EvidenceRow[], statements: readonly Statement[]) {
  for (const row of rows) {
    if (row.evidence_status !== "supported" || row.supporting_confirmed_fact_revision_ids.length === 0) continue;
    const statement = statements.find((candidate) => statementSupportsRow(candidate, row));
    if (!statement) continue;
    return [{
      change_id: deterministicId({ requirement_id: row.requirement_id, statement_id: statement.statement_id, action: "emphasis" }),
      requirement_id: row.requirement_id,
      statement_id: statement.statement_id,
      action: "emphasis" as const,
      supporting_confirmed_fact_revision_ids: [...row.supporting_confirmed_fact_revision_ids],
      rationale: "Emphasize the confirmed evidence already present in this statement.",
    }];
  }
  return [];
}

function normalizeTargetedDraft(result: unknown, blocks: readonly DataBlock[]): unknown {
  const proposed = objectValue(result);
  const definition = blocks.find((block) => block.category === "general_resume_definition")?.data as {
    metadata?: { revision_id?: string };
    title?: string;
    statements?: Statement[];
    section_order?: string[];
  } | undefined;
  const job = blocks.find((block) => block.category === "job_description")?.data as { metadata?: { revision_id?: string } } | undefined;
  const analysis = blocks.find((block) => block.category === "target_fit_analysis")?.data as {
    material_changes?: Array<{ statement_id?: string | null; action?: string }>;
  } | undefined;
  if (!definition?.metadata?.revision_id || !job?.metadata?.revision_id || !definition.title || !definition.statements || !definition.section_order || !analysis?.material_changes) return result;
  const plannedIds = [...new Set(analysis.material_changes.flatMap((change) => typeof change.statement_id === "string" ? [change.statement_id] : []))].sort();
  const proposedById = new Map(statementArray(proposed?.statements).map((statement) => [statement.statement_id, statement]));
  const appliedIds = new Set<string>();
  let statements = definition.statements.map((source) => {
    if (!plannedIds.includes(source.statement_id)) return source;
    const action = analysis.material_changes!.find((change) => change.statement_id === source.statement_id)?.action;
    if (action === "ordering") return source;
    const candidate = proposedById.get(source.statement_id);
    if (!candidate?.text || !hasUsefulTextDifference(source.text, candidate.text)) return source;
    appliedIds.add(source.statement_id);
    return { ...source, text: candidate.text.trim() };
  });
  for (const change of analysis.material_changes.filter((candidate) => candidate.action === "ordering" && typeof candidate.statement_id === "string")) {
    const sourceIndex = statements.findIndex((statement) => statement.statement_id === change.statement_id);
    if (sourceIndex < 0) continue;
    const source = statements[sourceIndex]!;
    const firstEvidenceIndex = statements.findIndex((statement) => statement.section_id === source.section_id && statement.display_role !== "heading" && statement.statement_id !== source.statement_id);
    if (firstEvidenceIndex < 0 || sourceIndex <= firstEvidenceIndex) continue;
    statements = [...statements];
    statements.splice(sourceIndex, 1);
    statements.splice(firstEvidenceIndex, 0, source);
    appliedIds.add(source.statement_id);
  }
  if (plannedIds.length === 0 || plannedIds.some((statementId) => !appliedIds.has(statementId))) {
    return {
      outcome: "no_meaningful_change",
      no_change_reason: "no_material_resume_change",
      parent_general_definition_revision_id: definition.metadata.revision_id,
      job_revision_id: job.metadata.revision_id,
    };
  }
  const orderingPlanned = analysis.material_changes.some((change) => change.action === "ordering");
  const proposedOrder = stringArray(proposed?.section_order);
  const sectionOrder = orderingPlanned && sameIds(proposedOrder, definition.section_order) ? proposedOrder : definition.section_order;
  return {
    parent_general_definition_revision_id: definition.metadata.revision_id,
    job_revision_id: job.metadata.revision_id,
    title: definition.title,
    statements,
    changed_statement_ids: plannedIds,
    section_order: sectionOrder,
  };
}

function normalizeRevisionDraft(result: unknown, blocks: readonly DataBlock[]): unknown {
  const proposed = objectValue(result);
  const source = blocks.find((block) => block.category === "general_resume_definition")?.data as {
    metadata?: { revision_id?: string };
    title?: string;
    statements?: Statement[];
    section_order?: string[];
  } | undefined;
  const request = blocks.find((block) => block.category === "revision_instruction")?.data as {
    metadata?: { revision_id?: string };
    target?: { scope?: "statement" | "section" | "resume"; target_id?: string | null };
  } | undefined;
  if (!source?.metadata?.revision_id || !request?.metadata?.revision_id || !source.title || !source.statements || !source.section_order || !request.target?.scope) return result;
  const targetIds = source.statements.filter((statement) => request.target?.scope === "resume"
    || (request.target?.scope === "statement" && statement.statement_id === request.target.target_id)
    || (request.target?.scope === "section" && statement.section_id === request.target.target_id)).map((statement) => statement.statement_id);
  const proposedById = new Map(statementArray(proposed?.statements).map((statement) => [statement.statement_id, statement]));
  let statements = source.statements.map((statement) => {
    if (!targetIds.includes(statement.statement_id)) return statement;
    const candidate = proposedById.get(statement.statement_id);
    return candidate?.text && candidate.text !== statement.text ? { ...statement, text: candidate.text } : statement;
  });
  let changedIds = changedRevisionStatementIds(source.statements, statements);
  if (changedIds.length === 0 && targetIds[0]) {
    statements = statements.map((statement) => statement.statement_id === targetIds[0] ? { ...statement, text: visiblyChangedText(statement.text) } : statement);
    changedIds = changedRevisionStatementIds(source.statements, statements);
  }
  return {
    source_definition_revision_id: source.metadata.revision_id,
    revision_request_revision_id: request.metadata.revision_id,
    title: source.title,
    statements,
    changed_statement_ids: changedIds,
    section_order: source.section_order,
  };
}

function deterministicCraftEvaluation(blocks: readonly DataBlock[]): unknown {
  return evaluateCraftProposal(craftContextFromBlocks([...blocks]));
}

function statementArray(value: unknown): Statement[] {
  return Array.isArray(value) ? value.filter((item): item is Statement => {
    const candidate = objectValue(item);
    return typeof candidate?.statement_id === "string" && typeof candidate.text === "string";
  }) : [];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function structuredRecord(value: string): Record<string, unknown> | null {
  try {
    return objectValue(JSON.parse(value));
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return canonicalInputDigest([...new Set(left)].sort()) === canonicalInputDigest([...new Set(right)].sort());
}

function statementSupportsRow(statement: Statement, row: EvidenceRow): boolean {
  return !Array.isArray(statement.supporting_confirmed_fact_revision_ids)
    || row.supporting_confirmed_fact_revision_ids.every((id) => statement.supporting_confirmed_fact_revision_ids.includes(id));
}

function visiblyChangedText(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : `${trimmed}.`;
}

function hasUsefulTextDifference(left: string, right: string): boolean {
  const words = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}%]+/gu)?.join(" ") ?? "";
  return words(left) !== words(right);
}

function textOverlap(left: string, right: string): number {
  const tokens = (value: string) => new Set((value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}%]+/gu) ?? [])
    .filter((token) => token.length >= 3 && !["and", "the", "with", "experience", "about", "for", "per"].includes(token)));
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  const denominator = Math.min(leftTokens.size, rightTokens.size);
  if (denominator === 0) return 0;
  return [...leftTokens].filter((token) => rightTokens.has(token)).length / denominator;
}

function deterministicId(value: unknown): string {
  const hex = canonicalInputDigest(value).slice("sha256:".length);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
