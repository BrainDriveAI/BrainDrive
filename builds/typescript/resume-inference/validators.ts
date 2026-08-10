import { createHash, randomUUID } from "node:crypto";

import type { z } from "zod";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { ValidatorFindingSchema } from "../app-platform/contracts/data.js";
import type { InferenceDataBlockSchema, InferencePurpose } from "../app-platform/contracts/inference.js";
import type { GeneratedStatementSchema } from "./results.js";

type DataBlock = z.infer<typeof InferenceDataBlockSchema>;
type Finding = z.infer<typeof ValidatorFindingSchema>;
type GeneratedStatement = z.infer<typeof GeneratedStatementSchema>;

export type ValidationReport = {
  validation_run_id: string;
  validator_id: "resume-claim-gate";
  validator_version: "1";
  validator_policy_digest: `sha256:${string}`;
  input_snapshot_digest: `sha256:${string}`;
  findings_digest: `sha256:${string}`;
  findings: Finding[];
  accepted: boolean;
};

const STOP_WORDS = new Set(["and", "the", "for", "with", "from", "into", "that", "this", "were", "was", "are", "has", "have", "had", "your", "their", "our", "using", "through", "across", "over", "under", "a", "an", "to", "of", "in", "on", "at", "by", "as", "or"]);
const PROTECTED_TOKEN = /(?:\b\d+(?:[.,]\d+)?%?\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|https?:\/\/\S+)/gi;

export function validateInferenceClaims(purpose: InferencePurpose, result: unknown, dataBlocks: DataBlock[]): ValidationReport {
  const findings: Finding[] = [];
  const facts = confirmedFacts(dataBlocks);
  if (purpose === "general_resume_draft" || purpose === "targeted_resume_draft") {
    const statements = (result as { statements?: GeneratedStatement[] }).statements ?? [];
    for (const statement of statements) findings.push(...validateStatement(statement, facts));
    findings.push(...validateResumeStructure(statements, dataBlocks));
    if (purpose === "targeted_resume_draft") findings.push(...validateTargetedLineage(result, dataBlocks));
  }
  if (purpose === "job_description_analyze") findings.push(...validateJobAnalysis(result, dataBlocks));
  if (purpose === "requirement_evidence_match") findings.push(...validateEvidence(result, facts));
  if (purpose === "tailoring_plan") findings.push(...validatePlan(result, facts));
  const inputSnapshotDigest = canonicalInputDigest(dataBlocks);
  const policyDigest = canonicalInputDigest({ validator: "resume-claim-gate", version: "1", protected: "lexical-subset-v1" });
  return {
    validation_run_id: randomUUID(),
    validator_id: "resume-claim-gate",
    validator_version: "1",
    validator_policy_digest: policyDigest,
    input_snapshot_digest: inputSnapshotDigest,
    findings_digest: canonicalInputDigest(findings),
    findings,
    accepted: !findings.some((finding) => finding.severity === "error"),
  };
}

function validateResumeStructure(statements: GeneratedStatement[], blocks: DataBlock[]): Finding[] {
  const findings: Finding[] = [];
  const factRows = blocks.flatMap((block) => block.category === "confirmed_fact_snapshot"
    ? ((block.data as { facts?: Array<{ revision_id?: unknown; fact_kind?: unknown; value?: unknown }> } | null)?.facts ?? [])
    : []);
  const structured = factRows.flatMap((fact) => {
    if (typeof fact.revision_id !== "string" || typeof fact.value !== "string") return [];
    try {
      const value = JSON.parse(fact.value) as Record<string, unknown>;
      return value && typeof value === "object" ? [{ revisionId: fact.revision_id, value }] : [];
    } catch {
      return [];
    }
  });
  const jobs = structured.filter((fact) => fact.value.format === "resume_job_v1");
  if (jobs.length === 0) return findings;
  if (!statements.some((statement) => statement.section_id === "summary")) {
    findings.push(finding("schema_invalid", null, "A resume with work experience requires a supported professional summary"));
  }
  for (const job of jobs) {
    const title = typeof job.value.title === "string" ? normalize(job.value.title) : "";
    const employer = typeof job.value.employer === "string" ? normalize(job.value.employer) : "";
    const heading = statements.find((statement) => statement.section_id === "experience"
      && statement.supporting_confirmed_fact_revision_ids.includes(job.revisionId)
      && (!title || normalize(statement.text).includes(title))
      && (!employer || normalize(statement.text).includes(employer)));
    if (!heading) findings.push(finding("schema_invalid", null, "Each confirmed job requires an individual experience heading"));
  }
  for (const accomplishment of structured.filter((fact) => fact.value.format === "resume_accomplishment_v1")) {
    const candidate = statements.find((statement) => statement.section_id === "experience" && statement.supporting_confirmed_fact_revision_ids.includes(accomplishment.revisionId));
    if (!candidate) findings.push(finding("missing_provenance", null, "Each confirmed accomplishment requires its own supported experience statement"));
    else if (candidate.text.length > 320) findings.push(finding("schema_invalid", candidate.statement_id, "Accomplishment bullets must remain concise"));
  }
  return findings;
}

function confirmedFacts(blocks: DataBlock[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of blocks.filter((candidate) => candidate.category === "confirmed_fact_snapshot")) {
    const facts = (block.data as { facts?: Array<{ revision_id?: unknown; value?: unknown }> } | null)?.facts ?? [];
    for (const fact of facts) if (typeof fact.revision_id === "string" && typeof fact.value === "string") map.set(fact.revision_id, fact.value);
  }
  return map;
}

function validateStatement(statement: GeneratedStatement, facts: Map<string, string>): Finding[] {
  const findings: Finding[] = [];
  const support = statement.supporting_confirmed_fact_revision_ids.map((id) => facts.get(id)).filter((value): value is string => Boolean(value));
  if (support.length !== statement.supporting_confirmed_fact_revision_ids.length || (statement.kind === "factual" && support.length === 0)) {
    findings.push(finding("missing_provenance", statement.statement_id, "Statement support does not resolve to confirmed fact revisions"));
    return findings;
  }
  const source = normalize(support.join(" "));
  if (/resume_(?:job|accomplishment)_v1|job_fact_revision_id|[{}]/i.test(statement.text)) {
    findings.push(finding("unsupported_claim", statement.statement_id, "Internal structured fact markers cannot appear in resume text"));
  }
  const protectedValues = statement.text.match(PROTECTED_TOKEN) ?? [];
  if (protectedValues.some((value) => !source.includes(normalize(value)))) {
    findings.push(finding("protected_field_changed", statement.statement_id, "A protected metric, date, or URL is absent from supporting facts"));
  }
  const sourceTokens = new Set(significantTokens(source).map(claimTokenRoot));
  const unsupported = significantTokens(statement.text).filter((token) => {
    const root = claimTokenRoot(token);
    if (sourceTokens.has(root)) return false;
    if (root === "experienc" && support.length > 0) return false;
    if (root === "multipl" && /\bacross\s+(?:[2-9]|\d{2,})\s+\w+s\b/.test(source)) return false;
    return true;
  });
  if (statement.kind === "factual" && unsupported.length > 0) {
    findings.push(finding("unsupported_claim", statement.statement_id, "Factual wording exceeds its confirmed supporting facts"));
  }
  return findings;
}

function validateJobAnalysis(result: unknown, blocks: DataBlock[]): Finding[] {
  const jobText = blocks.find((block) => block.category === "job_description")?.data;
  const text = typeof jobText === "object" && jobText && "description_text" in jobText ? String(jobText.description_text) : "";
  return ((result as { requirements?: Array<{ requirement_id: string; inferred: boolean; source_span: string | null }> }).requirements ?? [])
    .filter((requirement) => !requirement.inferred && (!requirement.source_span || !text.includes(requirement.source_span)))
    .map((requirement) => finding("missing_provenance", requirement.requirement_id, "A stated requirement does not match an exact job source span"));
}

function validateEvidence(result: unknown, facts: Map<string, string>): Finding[] {
  return ((result as { evidence?: Array<{ requirement_id: string; evidence_status: string; supporting_confirmed_fact_revision_ids: string[] }> }).evidence ?? []).flatMap((entry) => {
    const missing = entry.supporting_confirmed_fact_revision_ids.some((id) => !facts.has(id));
    if (missing) return [finding("missing_provenance", entry.requirement_id, "Evidence cites a fact outside the confirmed snapshot")];
    if (entry.evidence_status === "supported" && entry.supporting_confirmed_fact_revision_ids.length === 0) return [finding("unsupported_claim", entry.requirement_id, "Supported evidence requires confirmed facts")];
    return [];
  });
}

function validatePlan(result: unknown, facts: Map<string, string>): Finding[] {
  return ((result as { changes?: Array<{ change_id: string; supporting_confirmed_fact_revision_ids: string[] }> }).changes ?? [])
    .filter((change) => change.supporting_confirmed_fact_revision_ids.some((id) => !facts.has(id)))
    .map((change) => finding("missing_provenance", change.change_id, "Tailoring plan cites a fact outside the confirmed snapshot"));
}

function validateTargetedLineage(result: unknown, blocks: DataBlock[]): Finding[] {
  const value = result as { parent_general_definition_revision_id?: string; job_revision_id?: string };
  const definition = blocks.find((block) => block.category === "general_resume_definition")?.data as { metadata?: { revision_id?: string } } | undefined;
  const job = blocks.find((block) => block.category === "job_description")?.data as { metadata?: { revision_id?: string } } | undefined;
  return value.parent_general_definition_revision_id === definition?.metadata?.revision_id && value.job_revision_id === job?.metadata?.revision_id
    ? []
    : [finding("lineage_invalid", null, "Targeted draft lineage does not match the immutable input snapshot")];
}

function significantTokens(text: string): string[] {
  return [...new Set(normalize(text).split(/[^a-z0-9%]+/).filter((token) => token.length >= 3 && !STOP_WORDS.has(token)))];
}

function claimTokenRoot(token: string): string {
  let value = token;
  if (value.endsWith("ies") && value.length > 5) value = `${value.slice(0, -3)}y`;
  else if (value.endsWith("ing") && value.length > 6) value = value.slice(0, -3);
  else if (value.endsWith("ed") && value.length > 5) value = value.slice(0, -2);
  else if (value.endsWith("es") && value.length > 5) value = value.slice(0, -2);
  else if (value.endsWith("s") && value.length > 4) value = value.slice(0, -1);
  if (value.endsWith("e") && value.length > 5) value = value.slice(0, -1);
  if (/^(?:maintain|manag)/.test(value)) return "manage";
  return value;
}

function normalize(value: string): string { return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim(); }

function finding(code: Finding["code"], statementId: string | null, safeMessage: string): Finding {
  return ValidatorFindingSchema.parse({
    finding_id: deterministicUuid(`${code}:${statementId ?? "record"}:${safeMessage}`), validator_id: "resume-claim-gate", validator_version: "1", severity: "error",
    code, statement_id: statementId, safe_message: safeMessage,
  });
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
