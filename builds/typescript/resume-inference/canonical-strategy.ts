import { canonicalInputDigest } from "../app-platform/contracts/common.js";

export type CanonicalStrategyFact = {
  revision_id: string;
  fact_kind?: string;
  value: string;
  source_revision_ids?: string[];
};

export type CanonicalStrategyCoverage = {
  metadata?: { revision_id?: string };
  job_fact_revision_id?: string;
};

export type CanonicalEvidenceAnnotation = {
  fact_revision_id: string;
  evidence_class: string;
  job_fact_revision_id: string | null;
  required_priority: string;
};

export type CanonicalEvidenceAnnotations = {
  annotation_version: number;
  facts: CanonicalEvidenceAnnotation[];
  coverage_digest: string;
  unresolved_gap_ids: string[];
};

export const CANONICAL_RESUME_SECTION_PRECEDENCE = [
  "contact",
  "summary",
  "experience",
  "education",
  "certifications",
  "skills",
  "projects",
  "leadership",
  "volunteer",
  "links",
] as const;

const EVIDENCE_CLASS_PRECEDENCE = [
  "role_identity",
  "accomplishment",
  "answered_job_evidence",
  "contact",
  "education",
  "credential",
  "project",
  "skill",
  "presentation_preference",
  "other",
] as const;

const PRIORITY_PRECEDENCE = ["must_use", "preferred", "context"] as const;

export function canonicalizeOpaqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort(compareText);
}

export function canonicalizeFacts<T extends CanonicalStrategyFact>(facts: readonly T[]): T[] {
  const normalized = facts.map((fact) => (
    fact.source_revision_ids === undefined
      ? fact
      : { ...fact, source_revision_ids: canonicalizeOpaqueIds(fact.source_revision_ids) }
  )) as T[];
  const unique = deduplicateByIdentity(normalized, (fact) => fact.revision_id, "fact");
  const jobs = unique.filter((fact) => fact.fact_kind === "employment").sort(compareJobChronology);
  const jobOrder = new Map(jobs.map((job, index) => [job.revision_id, index]));
  return unique.sort((left, right) => compareFact(left, right, jobOrder));
}

export function canonicalizeCoverage<T extends CanonicalStrategyCoverage>(coverage: readonly T[]): T[] {
  const unique = deduplicateByIdentity(coverage, (record) => record.metadata?.revision_id ?? "", "coverage");
  return unique.sort((left, right) => (
    compareText(left.job_fact_revision_id ?? "", right.job_fact_revision_id ?? "") ||
    compareText(left.metadata?.revision_id ?? "", right.metadata?.revision_id ?? "")
  ));
}

export function canonicalizeEvidenceAnnotations<T extends CanonicalEvidenceAnnotations>(annotations: T): T {
  const normalizedFacts = annotations.facts.map((fact) => ({ ...fact }));
  const facts = deduplicateByIdentity(normalizedFacts, (fact) => fact.fact_revision_id, "evidence annotation")
    .sort((left, right) => (
      compareText(left.job_fact_revision_id ?? "~", right.job_fact_revision_id ?? "~") ||
      compareRank(left.evidence_class, right.evidence_class, EVIDENCE_CLASS_PRECEDENCE) ||
      compareRank(left.required_priority, right.required_priority, PRIORITY_PRECEDENCE) ||
      compareText(left.fact_revision_id, right.fact_revision_id)
    ));
  return {
    ...annotations,
    facts,
    unresolved_gap_ids: canonicalizeOpaqueIds(annotations.unresolved_gap_ids),
  };
}

export function sectionForFact(fact: CanonicalStrategyFact): typeof CANONICAL_RESUME_SECTION_PRECEDENCE[number] | null {
  if (fact.fact_kind === "identity") return "contact";
  if (fact.fact_kind === "contact") return fact.value.startsWith("Professional link:") ? "links" : "contact";
  if (fact.fact_kind === "employment" || fact.fact_kind === "accomplishment") return "experience";
  if (fact.fact_kind === "job_evidence") return jobAssociation(fact) === null ? "skills" : "experience";
  if (fact.fact_kind === "education") return "education";
  if (fact.fact_kind === "credential") return "certifications";
  if (fact.fact_kind === "skill") return "skills";
  if (fact.fact_kind === "project") return fact.value.startsWith("Leadership or volunteer:") ? "leadership" : "projects";
  return null;
}

export function canonicalSectionOrder(
  facts: readonly CanonicalStrategyFact[],
  summaryDecision: "include" | "omit",
  omittedFactRevisionIds: readonly string[] = [],
): string[] {
  const omitted = new Set(omittedFactRevisionIds);
  const present = new Set(facts.filter((fact) => !omitted.has(fact.revision_id)).map(sectionForFact).filter((section): section is NonNullable<ReturnType<typeof sectionForFact>> => section !== null));
  if (summaryDecision === "include") present.add("summary");
  const sections = CANONICAL_RESUME_SECTION_PRECEDENCE.filter((section) => present.has(section));
  return sections.length > 0 ? sections : ["experience"];
}

export function canonicalizeSectionOrder(
  sections: readonly string[],
  summaryDecision: "include" | "omit",
): string[] {
  const present = new Set(sections.filter((section) => CANONICAL_RESUME_SECTION_PRECEDENCE.includes(section as typeof CANONICAL_RESUME_SECTION_PRECEDENCE[number])));
  if (summaryDecision === "include") present.add("summary");
  else present.delete("summary");
  const ordered = CANONICAL_RESUME_SECTION_PRECEDENCE.filter((section) => present.has(section));
  return ordered.length > 0 ? ordered : ["experience"];
}

type StrategyResult = {
  role_emphasis: Array<{ job_fact_revision_id: string; [key: string]: unknown }>;
  section_order: string[];
  evidence_priorities: Array<{ fact_revision_id: string; [key: string]: unknown }>;
  summary_decision: "include" | "omit";
  skills_context: Array<{ skill_fact_revision_id: string; context_fact_revision_ids: string[]; [key: string]: unknown }>;
  omissions: Array<{ fact_revision_id: string; [key: string]: unknown }>;
  unresolved_gap_ids: string[];
  [key: string]: unknown;
};

export function canonicalizeStrategyResult<T extends StrategyResult>(
  strategy: T,
  facts: readonly CanonicalStrategyFact[],
  annotations: CanonicalEvidenceAnnotations,
): T {
  const canonicalFacts = canonicalizeFacts(facts);
  const canonicalAnnotations = canonicalizeEvidenceAnnotations(annotations);
  const jobOrder = new Map(canonicalFacts.filter((fact) => fact.fact_kind === "employment").map((fact, index) => [fact.revision_id, index]));
  const annotationOrder = new Map(canonicalAnnotations.facts.map((annotation, index) => [annotation.fact_revision_id, index]));
  const roleEmphasis = deduplicateByIdentity(strategy.role_emphasis, (role) => role.job_fact_revision_id, "role emphasis")
    .sort((left, right) => compareIndexedIdentity(left.job_fact_revision_id, right.job_fact_revision_id, jobOrder));
  const evidencePriorities = deduplicateByIdentity(strategy.evidence_priorities, (entry) => entry.fact_revision_id, "evidence priority")
    .sort((left, right) => compareIndexedIdentity(left.fact_revision_id, right.fact_revision_id, annotationOrder));
  const skillsContext = deduplicateByIdentity(
    strategy.skills_context.map((entry) => ({ ...entry, context_fact_revision_ids: canonicalizeOpaqueIds(entry.context_fact_revision_ids) })),
    (entry) => entry.skill_fact_revision_id,
    "skill context",
  ).sort((left, right) => compareText(left.skill_fact_revision_id, right.skill_fact_revision_id));
  const omissions = deduplicateByIdentity(strategy.omissions, (entry) => entry.fact_revision_id, "omission")
    .sort((left, right) => compareText(left.fact_revision_id, right.fact_revision_id));
  return {
    ...strategy,
    role_emphasis: roleEmphasis,
    section_order: canonicalSectionOrder(canonicalFacts, strategy.summary_decision, omissions.map((entry) => entry.fact_revision_id)),
    evidence_priorities: evidencePriorities,
    skills_context: skillsContext,
    omissions,
    unresolved_gap_ids: canonicalizeOpaqueIds(strategy.unresolved_gap_ids),
  };
}

function deduplicateByIdentity<T>(values: readonly T[], identity: (value: T) => string, label: string): T[] {
  const byIdentity = new Map<string, { digest: string; value: T }>();
  for (const value of values) {
    const key = identity(value);
    if (!key) throw new TypeError(`${label} identity is required`);
    const digest = canonicalInputDigest(value);
    const existing = byIdentity.get(key);
    if (existing && existing.digest !== digest) throw new TypeError(`Conflicting ${label} identity: ${key}`);
    if (!existing) byIdentity.set(key, { digest, value });
  }
  return [...byIdentity.values()].map((entry) => entry.value);
}

function compareFact(left: CanonicalStrategyFact, right: CanonicalStrategyFact, jobOrder: Map<string, number>): number {
  const leftAssociation = jobAssociation(left);
  const rightAssociation = jobAssociation(right);
  const leftWork = left.fact_kind === "employment" || left.fact_kind === "accomplishment" || leftAssociation !== null;
  const rightWork = right.fact_kind === "employment" || right.fact_kind === "accomplishment" || rightAssociation !== null;
  const leftClass = factClassRank(left, leftWork);
  const rightClass = factClassRank(right, rightWork);
  if (leftClass !== rightClass) return leftClass - rightClass;
  if (leftWork && rightWork) {
    const association = compareIndexedIdentity(leftAssociation ?? left.revision_id, rightAssociation ?? right.revision_id, jobOrder);
    if (association !== 0) return association;
    const withinRole = workFactRank(left) - workFactRank(right);
    if (withinRole !== 0) return withinRole;
  }
  return compareText(left.revision_id, right.revision_id);
}

function factClassRank(fact: CanonicalStrategyFact, associatedWork: boolean): number {
  if (fact.fact_kind === "identity") return 0;
  if (fact.fact_kind === "contact") return 1;
  if (associatedWork) return 2;
  if (fact.fact_kind === "education") return 3;
  if (fact.fact_kind === "credential") return 4;
  if (fact.fact_kind === "skill" || fact.fact_kind === "job_evidence") return 5;
  if (fact.fact_kind === "project") return 6;
  if (fact.fact_kind === "preference") return 7;
  return 8;
}

function workFactRank(fact: CanonicalStrategyFact): number {
  if (fact.fact_kind === "employment") return 0;
  if (fact.fact_kind === "accomplishment") return 1;
  if (fact.fact_kind === "job_evidence") return 2;
  return 3;
}

function jobAssociation(fact: CanonicalStrategyFact): string | null {
  if (fact.fact_kind === "employment") return fact.revision_id;
  if (fact.fact_kind !== "accomplishment" && fact.fact_kind !== "job_evidence") return null;
  const parsed = parseJson(fact.value);
  if (!parsed || typeof parsed !== "object") return null;
  const association = (parsed as { association?: unknown }).association;
  const jobRevisionId = (parsed as { job_fact_revision_id?: unknown }).job_fact_revision_id;
  if (fact.fact_kind === "job_evidence" && association === "general") return null;
  return typeof jobRevisionId === "string" ? jobRevisionId : null;
}

function compareJobChronology(left: CanonicalStrategyFact, right: CanonicalStrategyFact): number {
  const leftDates = jobDates(left.value);
  const rightDates = jobDates(right.value);
  return rightDates.end - leftDates.end || rightDates.start - leftDates.start || compareText(left.revision_id, right.revision_id);
}

function jobDates(value: string): { start: number; end: number } {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object") return { start: Number.MIN_SAFE_INTEGER, end: Number.MIN_SAFE_INTEGER };
  const row = parsed as { start_date?: unknown; end_date?: unknown };
  return { start: dateRank(row.start_date), end: dateRank(row.end_date) };
}

function dateRank(value: unknown): number {
  if (typeof value !== "string") return Number.MIN_SAFE_INTEGER;
  const normalized = value.trim().toLowerCase();
  if (/^(?:present|current|now|ongoing)$/.test(normalized)) return Number.MAX_SAFE_INTEGER;
  const year = normalized.match(/(?:19|20)\d{2}/)?.[0];
  if (!year) return Number.MIN_SAFE_INTEGER;
  const numericMonth = normalized.match(/(?:19|20)\d{2}[-/]([01]?\d)/)?.[1];
  const namedMonth = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    .findIndex((month) => new RegExp(`\\b${month}[a-z]*\\b`).test(normalized));
  const month = numericMonth ? Math.min(12, Math.max(1, Number(numericMonth))) : namedMonth + 1;
  return Number(year) * 12 + month;
}

function compareIndexedIdentity(left: string, right: string, order: Map<string, number>): number {
  const leftRank = order.get(left) ?? Number.MAX_SAFE_INTEGER;
  const rightRank = order.get(right) ?? Number.MAX_SAFE_INTEGER;
  return leftRank - rightRank || compareText(left, right);
}

function compareRank(left: string, right: string, precedence: readonly string[]): number {
  const leftRank = precedence.indexOf(left);
  const rightRank = precedence.indexOf(right);
  return (leftRank < 0 ? precedence.length : leftRank) - (rightRank < 0 ? precedence.length : rightRank) || compareText(left, right);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}
