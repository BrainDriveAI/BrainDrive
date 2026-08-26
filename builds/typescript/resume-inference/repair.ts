import { randomUUID } from "node:crypto";

import type { z } from "zod";

import type { InferenceDataBlockSchema, InferencePurpose } from "../app-platform/contracts/inference.js";
import type { GeneratedStatementSchema } from "./results.js";
import type { ValidationReport } from "./validators.js";

type DataBlock = z.infer<typeof InferenceDataBlockSchema>;
type GeneratedStatement = z.infer<typeof GeneratedStatementSchema>;
type Draft = {
  statements: GeneratedStatement[];
  section_order: string[];
  [key: string]: unknown;
};
type Fact = { revision_id: string; fact_kind?: string; value: string };
type StructuredFact = Record<string, unknown> & { format?: string };

export function repairResumeDraftFromConfirmedFacts(
  purpose: InferencePurpose,
  result: unknown,
  report: ValidationReport,
  blocks: DataBlock[],
): unknown | null {
  if (purpose !== "general_resume_draft" && purpose !== "targeted_resume_draft") return null;
  if (!isDraft(result)) return null;
  const facts = confirmedFacts(blocks);
  const rejectedStatementIds = new Set(report.findings
    .filter((finding) => finding.severity === "error" && finding.statement_id !== null)
    .map((finding) => finding.statement_id!));
  const statements = result.statements.map((statement) => {
    if (!rejectedStatementIds.has(statement.statement_id)) return statement;
    const replacement = safeStatementText(statement, facts);
    return replacement ? { ...statement, text: replacement } : statement;
  });

  const strategy = blocks.find((block) => block.category === "resume_strategy")?.data as { summary_decision?: string } | undefined;
  addRequiredStructure(statements, facts, strategy?.summary_decision === "include");
  const sectionOrder = [...result.section_order];
  if (statements.some((statement) => statement.section_id === "summary") && !sectionOrder.includes("summary")) {
    const contactIndex = sectionOrder.indexOf("contact");
    sectionOrder.splice(contactIndex >= 0 ? contactIndex + 1 : 0, 0, "summary");
  }
  if (statements.some((statement) => statement.section_id === "experience") && !sectionOrder.includes("experience")) {
    const summaryIndex = sectionOrder.indexOf("summary");
    sectionOrder.splice(summaryIndex >= 0 ? summaryIndex + 1 : sectionOrder.length, 0, "experience");
  }
  return { ...result, statements, section_order: sectionOrder };
}

function isDraft(value: unknown): value is Draft {
  return Boolean(value && typeof value === "object" && Array.isArray((value as Draft).statements) && Array.isArray((value as Draft).section_order));
}

function confirmedFacts(blocks: DataBlock[]): Map<string, Fact> {
  const facts = new Map<string, Fact>();
  for (const block of blocks.filter((candidate) => candidate.category === "confirmed_fact_snapshot")) {
    const rows = (block.data as { facts?: Array<{ revision_id?: unknown; fact_kind?: unknown; value?: unknown }> } | null)?.facts ?? [];
    for (const row of rows) {
      if (typeof row.revision_id !== "string" || typeof row.value !== "string") continue;
      facts.set(row.revision_id, { revision_id: row.revision_id, ...(typeof row.fact_kind === "string" ? { fact_kind: row.fact_kind } : {}), value: row.value });
    }
  }
  return facts;
}

function safeStatementText(statement: GeneratedStatement, facts: Map<string, Fact>): string | null {
  const support = statement.supporting_confirmed_fact_revision_ids.map((id) => facts.get(id)).filter((fact): fact is Fact => Boolean(fact));
  if (support.length !== statement.supporting_confirmed_fact_revision_ids.length || support.length === 0) return null;
  if (statement.section_id === "summary") return safeSummary(support);
  const accomplishment = support.map((fact) => ({ fact, structured: structuredValue(fact.value) }))
    .find(({ structured }) => structured?.format === "resume_accomplishment_v1");
  if (accomplishment) return boundedExact(stringField(accomplishment.structured, "text") ?? accomplishment.fact.value, 320);
  const job = support.map((fact) => ({ fact, structured: structuredValue(fact.value) }))
    .find(({ structured }) => structured?.format === "resume_job_v1");
  if (job) {
    const heading = jobHeading(job.structured);
    const responsibilities = stringField(job.structured, "responsibilities");
    const looksLikeHeading = includesNormalized(statement.text, stringField(job.structured, "title"))
      && includesNormalized(statement.text, stringField(job.structured, "employer"));
    return looksLikeHeading || !responsibilities ? heading : boundedExact(responsibilities, 8_192);
  }
  return boundedExact(support.map((fact) => fact.value).join(" | "), statement.section_id === "experience" ? 320 : 8_192);
}

function addRequiredStructure(statements: GeneratedStatement[], facts: Map<string, Fact>, includeSummary: boolean): void {
  const structuredFacts = [...facts.values()].map((fact) => ({ fact, structured: structuredValue(fact.value) }));
  const jobs = structuredFacts.filter(({ structured }) => structured?.format === "resume_job_v1");
  if (includeSummary && jobs.length > 0 && !statements.some((statement) => statement.section_id === "summary")) {
    const first = jobs[0]!;
    statements.unshift(newStatement("summary", safeSummary([first.fact]), first.fact.revision_id));
  }
  for (const { fact, structured } of jobs) {
    const title = stringField(structured, "title");
    const employer = stringField(structured, "employer");
    const hasHeading = statements.some((statement) => statement.section_id === "experience"
      && statement.supporting_confirmed_fact_revision_ids.includes(fact.revision_id)
      && includesNormalized(statement.text, title)
      && includesNormalized(statement.text, employer));
    if (!hasHeading) {
      const firstRelated = statements.findIndex((statement) => statement.section_id === "experience" && statement.supporting_confirmed_fact_revision_ids.includes(fact.revision_id));
      statements.splice(firstRelated < 0 ? statements.length : firstRelated, 0, newStatement("experience", jobHeading(structured), fact.revision_id));
    }
  }
  for (const { fact, structured } of structuredFacts.filter(({ structured }) => structured?.format === "resume_accomplishment_v1")) {
    const hasStatement = statements.some((statement) => statement.section_id === "experience" && statement.supporting_confirmed_fact_revision_ids.includes(fact.revision_id));
    if (hasStatement) continue;
    const text = boundedExact(stringField(structured, "text") ?? fact.value, 320);
    const jobId = stringField(structured, "job_fact_revision_id");
    let insertAt = statements.length;
    if (jobId) {
      const related = statements.map((statement, index) => ({ statement, index }))
        .filter(({ statement }) => statement.section_id === "experience" && statement.supporting_confirmed_fact_revision_ids.includes(jobId));
      if (related.length > 0) insertAt = related.at(-1)!.index + 1;
    }
    statements.splice(insertAt, 0, newStatement("experience", text, fact.revision_id));
  }
}

function safeSummary(facts: Fact[]): string {
  const job = facts.map((fact) => ({ fact, structured: structuredValue(fact.value) }))
    .find(({ structured }) => structured?.format === "resume_job_v1");
  if (job) {
    const title = stringField(job.structured, "title") ?? "";
    const responsibilities = stringField(job.structured, "responsibilities");
    if (responsibilities) return boundedExact(`${title} with experience ${lowerFirst(responsibilities)}`.trim(), 320);
    const employer = stringField(job.structured, "employer");
    return boundedExact(`${title} with experience${employer ? ` at ${employer}` : ""}`.trim(), 320);
  }
  return boundedExact(`Experience: ${facts.map((fact) => fact.value).join(" | ")}`, 320);
}

function newStatement(sectionId: string, text: string, factRevisionId: string): GeneratedStatement {
  return { statement_id: randomUUID(), section_id: sectionId, kind: "factual", text, supporting_confirmed_fact_revision_ids: [factRevisionId] };
}

function jobHeading(value: StructuredFact | null): string {
  if (!value) return "Work experience";
  const dates = [stringField(value, "start_date"), stringField(value, "end_date")].filter(Boolean).join(" - ");
  return [stringField(value, "title"), stringField(value, "employer"), stringField(value, "location"), dates].filter(Boolean).join(", ");
}

function structuredValue(value: string): StructuredFact | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as StructuredFact : null;
  } catch {
    return null;
  }
}

function stringField(value: StructuredFact | null, key: string): string | null {
  const field = value?.[key];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

function includesNormalized(value: string, expected: string | null): boolean {
  return !expected || normalize(value).includes(normalize(expected));
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

function lowerFirst(value: string): string {
  return value ? `${value.charAt(0).toLocaleLowerCase("en-US")}${value.slice(1)}` : value;
}

function boundedExact(value: string, limit: number): string {
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  const candidate = normalized.slice(0, limit + 1);
  const boundary = candidate.lastIndexOf(" ");
  return candidate.slice(0, boundary > 0 ? boundary : limit).trim();
}
