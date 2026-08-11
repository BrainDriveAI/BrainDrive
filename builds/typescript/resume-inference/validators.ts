import { createHash, randomUUID } from "node:crypto";

import type { z } from "zod";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { JobEvidenceValueSchema, ValidatorFindingSchema } from "../app-platform/contracts/data.js";
import type { InferenceDataBlockSchema, InferencePurpose } from "../app-platform/contracts/inference.js";
import type { GeneratedStatementSchema } from "./results.js";
import { revisionDraftIssues, type RevisionIntentClass, type RevisionStatement, type RevisionTarget } from "../resume-domain/revision-requests.js";

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
  if (purpose === "interview_assist") findings.push(...validateInterviewAssist(result, dataBlocks));
  if (purpose === "general_resume_draft" || purpose === "targeted_resume_draft") {
    const statements = (result as { statements?: GeneratedStatement[] }).statements ?? [];
    for (const statement of statements) findings.push(...validateStatement(statement, facts));
    findings.push(...validateResumeStructure(statements, dataBlocks));
    if (purpose === "targeted_resume_draft") findings.push(...validateTargetedLineage(result, dataBlocks));
  }
  if (purpose === "resume_revision_classify") findings.push(...validateRevisionClassification(result, dataBlocks));
  if (purpose === "resume_revision_draft") {
    const statements = (result as { statements?: GeneratedStatement[] }).statements ?? [];
    for (const statement of statements) findings.push(...validateStatement(statement, facts));
    findings.push(...validateResumeStructure(statements, dataBlocks));
    findings.push(...validateRevisionDraft(result, dataBlocks));
  }
  if (purpose === "job_description_analyze") findings.push(...validateJobAnalysis(result, dataBlocks));
  if (purpose === "requirement_evidence_match") findings.push(...validateEvidence(result, facts));
  if (purpose === "tailoring_plan") findings.push(...validatePlan(result, facts));
  if (purpose === "resume_guidance") findings.push(...validateGuidance(result, dataBlocks));
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

const FORBIDDEN_GUIDANCE = /\b(?:ats|resume|employability|match|hiring|interview(?:-rate)?|candidate)\s*(?:score|rating|percentage|percent)|\b(?:guarantee(?:d|s)?|will get hired|will get interviews?|hireability|competence|incompetent|unqualified|hireable|unhireable)\b|\b(?:strong|weak|ideal|poor|good|bad|competitive|uncompetitive|qualified)\s+(?:candidate|fit)\b|\b(?:likelihood|probability|chance|odds)\b.{0,48}\b(?:hire|hired|interview|offer)\b|\b(?:likely|unlikely|expected)\b.{0,32}\b(?:hire|hired|interview|offer)\b/i;

function validateGuidance(result: unknown, blocks: DataBlock[]): Finding[] {
  const value = result as { items?: Array<{ category?: string; evidence_revision_ids?: string[]; evidence_labels?: string[]; message?: string }>; optional_questions?: Array<{ evidence_revision_ids?: string[]; prompt?: string }> };
  const findings: Finding[] = [];
  const allowedCategories = new Set(["confirmed_fact_snapshot", "general_resume_definition", "deterministic_findings", "job_evidence_summary"]);
  if (blocks.some((block) => !allowedCategories.has(block.category))) {
    findings.push(finding("lineage_invalid", null, "Guidance contains a data block outside its purpose-minimum contract"));
  }
  const allowedIds = new Set<string>();
  for (const revisionId of confirmedFacts(blocks).keys()) allowedIds.add(revisionId);
  for (const block of blocks) {
    const revisionId = (block.data as { metadata?: { revision_id?: unknown } } | null)?.metadata?.revision_id;
    if (typeof revisionId === "string") allowedIds.add(revisionId);
    const deterministic = (block.data as { findings?: Array<{ evidence_revision_ids?: unknown[] }> } | null)?.findings;
    for (const item of deterministic ?? []) for (const id of item.evidence_revision_ids ?? []) if (typeof id === "string") allowedIds.add(id);
  }
  for (const item of value.items ?? []) {
    if (!item.evidence_labels?.length) findings.push(finding("schema_invalid", null, "Guidance requires an owner-readable evidence label"));
    if ((item.evidence_revision_ids ?? []).some((id) => !allowedIds.has(id))) findings.push(finding("missing_provenance", null, "Guidance cites evidence outside the bounded snapshot"));
    if (item.category === "strong_evidence" && (item.evidence_revision_ids?.length ?? 0) === 0) findings.push(finding("missing_provenance", null, "Strong evidence guidance requires confirmed support"));
    if (FORBIDDEN_GUIDANCE.test(item.message ?? "")) findings.push(finding("schema_invalid", null, "Guidance cannot contain a score, prediction, guarantee, or competence judgment"));
  }
  for (const question of value.optional_questions ?? []) {
    if ((question.evidence_revision_ids ?? []).some((id) => !allowedIds.has(id))) findings.push(finding("missing_provenance", null, "An optional question cites evidence outside the bounded snapshot"));
    if (FORBIDDEN_GUIDANCE.test(question.prompt ?? "")) findings.push(finding("schema_invalid", null, "An optional question cannot contain a score, prediction, guarantee, or competence judgment"));
  }
  return findings;
}

function revisionContext(blocks: DataBlock[]): {
  source: { metadata?: { revision_id?: string }; title?: string; statements?: RevisionStatement[]; section_order?: string[] } | null;
  request: { metadata?: { revision_id?: string }; source_definition_revision_id?: string; target?: RevisionTarget; request_text?: string; request_digest?: string; classification?: RevisionIntentClass | null; state?: string } | null;
} {
  return {
    source: (blocks.find((block) => block.category === "general_resume_definition")?.data as ReturnType<typeof revisionContext>["source"]) ?? null,
    request: (blocks.find((block) => block.category === "revision_instruction")?.data as ReturnType<typeof revisionContext>["request"]) ?? null,
  };
}

function validateRevisionClassification(result: unknown, blocks: DataBlock[]): Finding[] {
  const { source, request } = revisionContext(blocks);
  const value = result as { classification?: RevisionIntentClass; target?: RevisionTarget; clarification?: string | null; proposed_fact_changes?: unknown[] };
  const findings: Finding[] = [];
  if (!source?.metadata?.revision_id || !request?.metadata?.revision_id || request.source_definition_revision_id !== source.metadata.revision_id || request.state !== "submitted") {
    findings.push(finding("lineage_invalid", null, "Revision classification is not bound to one submitted request and immutable source"));
    return findings;
  }
  if (!request.request_text || request.request_digest !== canonicalInputDigest(request.request_text)) {
    findings.push(finding("lineage_invalid", null, "Revision request content does not match its durable digest"));
  }
  if (canonicalInputDigest(value.target) !== canonicalInputDigest(request.target)) {
    findings.push(finding("lineage_invalid", null, "Revision classification changed the owner-selected scope"));
  }
  if ((value.classification === "ambiguous") !== (typeof value.clarification === "string" && value.clarification.length > 0)) {
    findings.push(finding("schema_invalid", null, "Only an ambiguous revision may request clarification"));
  }
  if (value.classification === "presentation" && (value.proposed_fact_changes?.length ?? 0) > 0) {
    findings.push(finding("unsupported_claim", null, "A presentation revision cannot propose factual changes"));
  }
  return findings;
}

function validateRevisionDraft(result: unknown, blocks: DataBlock[]): Finding[] {
  const { source, request } = revisionContext(blocks);
  const value = result as {
    source_definition_revision_id?: string;
    revision_request_revision_id?: string;
    title?: string;
    statements?: RevisionStatement[];
    changed_statement_ids?: string[];
    section_order?: string[];
  };
  const findings: Finding[] = [];
  if (
    !source?.metadata?.revision_id || !request?.metadata?.revision_id ||
    request.source_definition_revision_id !== source.metadata.revision_id || request.state !== "generating" ||
    !request.classification || request.classification === "ambiguous" ||
    value.source_definition_revision_id !== source.metadata.revision_id || value.revision_request_revision_id !== request.metadata.revision_id
  ) {
    findings.push(finding("lineage_invalid", null, "Revision draft lineage does not match the authorized request and source"));
    return findings;
  }
  if (!source.title || !source.statements || !source.section_order || !value.title || !value.statements || !value.section_order || !value.changed_statement_ids || !request.target) {
    findings.push(finding("schema_invalid", null, "Revision draft is incomplete"));
    return findings;
  }
  for (const issue of revisionDraftIssues({
    source: { title: source.title, statements: source.statements, section_order: source.section_order },
    successor: { title: value.title, statements: value.statements, section_order: value.section_order, changed_statement_ids: value.changed_statement_ids },
    target: request.target,
    classification: request.classification,
  })) {
    findings.push(finding(issue === "revision_scope" || issue === "unchanged_statement_identity" ? "lineage_invalid" : "schema_invalid", null, "Revision draft does not preserve the selected scope, stable identities, or exact change manifest"));
  }
  return findings;
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
  const jobEvidence = structured.flatMap((fact) => {
    if (fact.value.value_version !== 1 || typeof fact.value.association !== "string") return [];
    const parsed = JobEvidenceValueSchema.safeParse(fact.value);
    return parsed.success ? [{ revisionId: fact.revisionId, value: parsed.data }] : [];
  });
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
  for (const evidence of jobEvidence) {
    const uses = statements.filter((statement) => statement.supporting_confirmed_fact_revision_ids.includes(evidence.revisionId));
    if (evidence.value.outcome !== "answered" && uses.length > 0) {
      findings.push(finding("unsupported_claim", uses[0]?.statement_id ?? null, "Skipped, unknown, not-applicable, and deferred job evidence cannot support resume wording"));
    }
  }
  for (const job of jobs) {
    const evidenceIds = new Set(jobEvidence.filter((evidence) => evidence.value.association === "job" && evidence.value.job_fact_revision_id === job.revisionId && evidence.value.outcome === "answered").map((evidence) => evidence.revisionId));
    const bullets = statements.filter((statement) => statement.section_id === "experience" && statement.supporting_confirmed_fact_revision_ids.some((revisionId) => evidenceIds.has(revisionId)));
    if (bullets.length > 6) findings.push(finding("schema_invalid", null, "A role cannot be padded beyond six evidence-supported bullets"));
    if (new Set(bullets.map((statement) => normalize(statement.text))).size !== bullets.length) {
      findings.push(finding("schema_invalid", null, "A role cannot repeat evidence wording to increase bullet density"));
    }
    const answeredDimensions = new Set(jobEvidence.filter((evidence) => evidence.value.job_fact_revision_id === job.revisionId && evidence.value.outcome === "answered").map((evidence) => evidence.value.dimension));
    if (answeredDimensions.size >= 3 && bullets.length < 3) findings.push(finding("schema_invalid", null, "A substantive role requires separate concise statements for its confirmed evidence"));
  }
  return findings;
}

function validateInterviewAssist(result: unknown, blocks: DataBlock[]): Finding[] {
  const summary = blocks.find((block) => block.category === "job_evidence_summary")?.data as {
    active_job_fact_revision_id?: string;
    requested_dimension?: string;
  } | undefined;
  const questions = (result as { questions?: Array<{ question_id?: string; job_fact_revision_id?: string; dimension?: string; prompt?: string }> }).questions ?? [];
  if (!summary || questions.length !== 1) return [finding("schema_invalid", null, "Interview assistance requires one active-job question")];
  const question = questions[0]!;
  const findings: Finding[] = [];
  if (question.job_fact_revision_id !== summary.active_job_fact_revision_id) findings.push(finding("lineage_invalid", question.question_id ?? null, "Interview assistance must stay on the active job"));
  if (question.dimension !== summary.requested_dimension) findings.push(finding("lineage_invalid", question.question_id ?? null, "Interview assistance must stay on the selected evidence dimension"));
  if (/\b(?:must|need to|required to)\b[^.?!]{0,60}\b(?:number|metric|percentage|percent|how many)\b|\bexact (?:number|percentage|metric)\b/i.test(question.prompt ?? "")) {
    findings.push(finding("unsupported_claim", question.question_id ?? null, "Interview assistance cannot pressure the owner to provide a metric"));
  }
  if (/\b(?:list every|all duties|complete checklist|old job description)\b/i.test(question.prompt ?? "")) {
    findings.push(finding("unsupported_claim", question.question_id ?? null, "Interview assistance cannot request a blank-slate occupational checklist"));
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
