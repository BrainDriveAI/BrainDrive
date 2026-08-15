import { createHash, randomUUID } from "node:crypto";

import type { z } from "zod";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { JobEvidenceValueSchema, ValidatorFindingSchema } from "../app-platform/contracts/data.js";
import type { InferenceDataBlockSchema, InferencePurpose } from "../app-platform/contracts/inference.js";
import { craftContextFromBlocks, validateCraftEvaluationResult, type CraftEvaluationResult } from "./craft-evaluator.js";
import { validateCraftRepair } from "./craft-repair.js";
import type { GeneratedStatementSchema } from "./results.js";
import { decideTargetFit, TARGET_FIT_THRESHOLD_POLICY } from "./target-fit.js";
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

const STOP_WORDS = new Set(["and", "the", "for", "with", "from", "into", "that", "this", "were", "was", "are", "has", "have", "had", "your", "their", "our", "using", "through", "across", "over", "under", "target", "targeting", "pursue", "pursuing", "seek", "seeking", "a", "an", "to", "of", "in", "on", "at", "by", "as", "or"]);
const PROTECTED_TOKEN = /(?:\b\d+(?:[.,]\d+)?%?\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|https?:\/\/\S+)/gi;

export function validateInferenceClaims(purpose: InferencePurpose, result: unknown, dataBlocks: DataBlock[]): ValidationReport {
  const findings: Finding[] = [];
  const facts = confirmedFacts(dataBlocks);
  if (purpose === "resume_dialogue") findings.push(...validateResumeDialogue(result, dataBlocks, facts));
  if (purpose === "interview_assist") findings.push(...validateInterviewAssist(result, dataBlocks));
  if (purpose === "resume_strategy") findings.push(...validateStrategy(result, dataBlocks));
  if (purpose === "general_resume_draft" || purpose === "targeted_resume_draft") {
    const noTargetChange = purpose === "targeted_resume_draft" && (result as { outcome?: unknown }).outcome === "no_meaningful_change";
    const statements = (result as { statements?: GeneratedStatement[] }).statements ?? [];
    if (!noTargetChange) {
      for (const statement of statements) findings.push(...validateStatement(statement, facts));
      findings.push(...validateResumeStructure(statements, dataBlocks, (result as { omissions?: Array<{ fact_revision_id?: string }> }).omissions ?? []));
    }
    if (purpose === "general_resume_draft") findings.push(...validateGeneralStrategyUse(result, dataBlocks));
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
  if (purpose === "tailoring_plan") findings.push(...validatePlan(result, facts, dataBlocks));
  if (purpose === "resume_guidance") findings.push(...validateGuidance(result, dataBlocks));
  if (purpose === "resume_craft_evaluate") findings.push(...validateCraftEvaluation(result, dataBlocks));
  if (purpose === "resume_craft_repair") findings.push(...validateCraftRepairResult(result, dataBlocks, facts));
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

function validateResumeDialogue(result: unknown, dataBlocks: DataBlock[], facts: Map<string, string>): Finding[] {
  const findings: Finding[] = [];
  const value = result as {
    assistant_message?: string;
    fact_operations?: Array<{
      fact_kind?: string;
      source_quote?: string;
      job_fact_revision_id?: string | null;
      employment?: { title?: unknown; employer?: unknown; location?: unknown; start_date?: unknown; end_date?: unknown; responsibilities?: unknown };
    }>;
  };
  const context = dataBlocks.find((block) => block.category === "dialogue_context")?.data as {
    current_user_message?: string | null;
    messages?: Array<{ role?: string; content?: string }>;
  } | undefined;
  const current = context?.current_user_message ?? null;
  const operations = value.fact_operations ?? [];
  if (current === null && operations.length > 0) {
    findings.push(finding("missing_provenance", null, "An opening dialogue turn cannot propose owner facts"));
    return findings;
  }
  const normalizedCurrent = normalize(current ?? "");
  const ownerMessages = (context?.messages ?? []).flatMap((message) => message.role === "user" && typeof message.content === "string" ? [normalize(message.content)] : []);
  const pureQuestion = /^(?:do|does|did|should|would|could|can|what|which|who|why|how|when|where|is|are|am|was|were)\b/.test(normalizedCurrent) && normalizedCurrent.endsWith("?");
  if (pureQuestion && operations.length > 0) {
    findings.push(finding("unsupported_claim", null, "A clarification question cannot be treated as a factual answer"));
  }
  for (const operation of operations) {
    const quote = typeof operation.source_quote === "string" ? normalize(operation.source_quote) : "";
    if (!quote || !normalizedCurrent.includes(quote)) {
      findings.push(finding("missing_provenance", null, "Every dialogue fact operation requires an exact quote from the current owner message"));
    }
    if (operation.fact_kind === "employment") {
      const employment = operation.employment;
      const requiredFields = [employment?.title, employment?.employer];
      const optionalFields = [employment?.location, employment?.start_date, employment?.end_date, employment?.responsibilities].filter((field) => field !== null && field !== undefined);
      for (const field of [...requiredFields, ...optionalFields]) {
        const normalizedField = typeof field === "string" ? normalize(field) : "";
        if (!normalizedField || !ownerMessages.some((message) => message.includes(normalizedField))) {
          findings.push(finding("missing_provenance", null, "Every employment field must preserve exact owner-stated wording from the visible conversation"));
        }
      }
      const correctedEmployer = /^(.+?)\s+is\s+the\s+correct\s+(?:company\s+)?name(?:\s+and\s+spelling)?\b/.exec(normalizedCurrent)?.[1]?.trim();
      if (correctedEmployer && normalize(String(employment?.employer ?? "")) !== correctedEmployer) {
        findings.push(finding("unsupported_claim", null, "An explicit employer correction must be used exactly"));
      }
      const dateRange = /\b(?:from\s+)?((?:19|20)\d{2})\s+(?:to|through|[-–—])\s+(present|current|(?:19|20)\d{2})\b/.exec(normalizedCurrent);
      if (dateRange && (normalize(String(employment?.start_date ?? "")) !== dateRange[1] || normalize(String(employment?.end_date ?? "")) !== dateRange[2])) {
        findings.push(finding("unsupported_claim", null, "Explicit owner-stated employment dates must be preserved exactly"));
      }
    }
    if (operation.job_fact_revision_id) {
      const jobValue = facts.get(operation.job_fact_revision_id);
      if (!jobValue) findings.push(finding("lineage_invalid", null, "Role-specific dialogue evidence must reference one confirmed employment fact"));
      else {
        try {
          const parsed = JSON.parse(jobValue) as { format?: unknown };
          if (parsed.format !== "resume_job_v1") findings.push(finding("lineage_invalid", null, "Role-specific dialogue evidence must reference structured confirmed employment"));
        } catch {
          findings.push(finding("lineage_invalid", null, "Role-specific dialogue evidence must reference structured confirmed employment"));
        }
      }
    }
  }
  if (/\b(?:i|we|braindrive)\s+(?:have\s+)?(?:saved|confirmed|approved)\b/i.test(value.assistant_message ?? "")) {
    findings.push(finding("schema_invalid", null, "Dialogue may not claim that model-proposed facts or owner actions were committed"));
  }
  return findings;
}

export function evaluateDefinitionDeterministicGates(definition: { statements: GeneratedStatement[] }, dataBlocks: DataBlock[]): {
  truth_passed: boolean;
  truth_validation_digest: `sha256:${string}`;
  structure_passed: boolean;
  structure_validation_digest: `sha256:${string}`;
} {
  const facts = confirmedFacts(dataBlocks);
  const truthFindings = definition.statements.flatMap((statement) => validateStatement(statement, facts));
  const structureFindings = validateResumeStructure(definition.statements, dataBlocks);
  return {
    truth_passed: truthFindings.length === 0,
    truth_validation_digest: canonicalInputDigest(truthFindings),
    structure_passed: structureFindings.length === 0,
    structure_validation_digest: canonicalInputDigest(structureFindings),
  };
}

function validateCraftEvaluation(result: unknown, blocks: DataBlock[]): Finding[] {
  try {
    const context = craftContextFromBlocks(blocks);
    return validateCraftEvaluationResult(result as CraftEvaluationResult, context).map((issue) => finding(
      issue.code === "evaluator_disagreement" ? "lineage_invalid" : "schema_invalid",
      null,
      issue.safe_message,
    ));
  } catch {
    return [finding("lineage_invalid", null, "Craft evaluation is not bound to one complete proposal, strategy, and deterministic gate context")];
  }
}

function validateCraftRepairResult(result: unknown, blocks: DataBlock[], facts: Map<string, string>): Finding[] {
  const source = blocks.find((block) => block.category === "general_resume_definition")?.data as Parameters<typeof validateCraftRepair>[0] | undefined;
  const report = blocks.find((block) => block.category === "craft_quality_report")?.data as Parameters<typeof validateCraftRepair>[1] | undefined;
  if (!source || !report) return [finding("lineage_invalid", null, "Craft repair requires one immutable proposal and failing craft report")];
  const repair = result as Parameters<typeof validateCraftRepair>[2];
  const findings = validateCraftRepair(source, report, repair).map((issue) => finding("lineage_invalid", issue.statement_id, issue.safe_message));
  for (const statement of repair.statements ?? []) findings.push(...validateStatement(statement, facts));
  findings.push(...validateResumeStructure(repair.statements ?? [], blocks));
  return findings;
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

function validateResumeStructure(statements: GeneratedStatement[], blocks: DataBlock[], omissions: Array<{ fact_revision_id?: string }> = []): Finding[] {
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
    if (omissions.some((omission) => omission.fact_revision_id === accomplishment.revisionId)) continue;
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

function validateStrategy(result: unknown, blocks: DataBlock[]): Finding[] {
  const value = result as {
    history_shape?: string;
    history_reason_code?: string;
    role_emphasis?: Array<{ job_fact_revision_id?: string; bullet_density?: string }>;
    section_order?: string[];
    evidence_priorities?: Array<{ fact_revision_id?: string; priority?: string }>;
    summary_decision?: string;
    summary_reason_code?: string;
    skills_context?: Array<{ skill_fact_revision_id?: string; context_fact_revision_ids?: string[] }>;
    omissions?: Array<{ fact_revision_id?: string; reason_code?: string }>;
    unresolved_gap_ids?: string[];
  };
  const findings: Finding[] = [];
  const facts = confirmedFacts(blocks);
  const factRows = blocks.flatMap((candidate) => candidate.category === "confirmed_fact_snapshot"
    ? ((candidate.data as { facts?: Array<{ revision_id?: string; fact_kind?: string }> }).facts ?? []) : []);
  const annotations = blocks.find((candidate) => candidate.category === "evidence_annotations")?.data as {
    facts?: Array<{ fact_revision_id?: string; evidence_class?: string; job_fact_revision_id?: string | null; required_priority?: string }>;
    unresolved_gap_ids?: string[];
  } | undefined;
  if (!annotations || blocks.filter((candidate) => candidate.category === "evidence_annotations").length !== 1) {
    findings.push(finding("lineage_invalid", null, "Resume strategy requires one deterministic evidence annotation block"));
    return findings;
  }
  if (facts.size === 0) findings.push(finding("missing_provenance", null, "Resume strategy requires at least one confirmed owner fact"));
  const priorities = value.evidence_priorities ?? [];
  const priorityIds = priorities.map((entry) => entry.fact_revision_id).filter((id): id is string => typeof id === "string");
  if (new Set(priorityIds).size !== priorityIds.length || priorityIds.some((id) => !facts.has(id))) {
    findings.push(finding("lineage_invalid", null, "Strategy evidence priorities must be unique confirmed snapshot identities"));
  }
  const omissions = value.omissions ?? [];
  const omittedIds = omissions.map((entry) => entry.fact_revision_id).filter((id): id is string => typeof id === "string");
  if (new Set(omittedIds).size !== omittedIds.length || omittedIds.some((id) => !facts.has(id))) {
    findings.push(finding("lineage_invalid", null, "Strategy omissions must be unique confirmed snapshot identities"));
  }
  const required = (annotations.facts ?? []).filter((entry) => entry.required_priority === "must_use").map((entry) => entry.fact_revision_id).filter((id): id is string => typeof id === "string");
  for (const revisionId of required) {
    if (!priorities.some((entry) => entry.fact_revision_id === revisionId && entry.priority === "must_use")) {
      findings.push(finding("missing_provenance", null, "Strategy must retain every deterministically required evidence identity as must-use"));
    }
  }
  const jobs = factRows.filter((fact) => fact.fact_kind === "employment").map((fact) => fact.revision_id).filter((id): id is string => typeof id === "string");
  const emphasized = (value.role_emphasis ?? []).map((entry) => entry.job_fact_revision_id).filter((id): id is string => typeof id === "string");
  if (new Set(emphasized).size !== emphasized.length || jobs.some((id) => !emphasized.includes(id)) || emphasized.some((id) => !jobs.includes(id))) {
    findings.push(finding("lineage_invalid", null, "Strategy role emphasis must cover each confirmed employment identity exactly once"));
  }
  for (const role of value.role_emphasis ?? []) {
    const evidenceCount = (annotations.facts ?? []).filter((entry) => entry.job_fact_revision_id === role.job_fact_revision_id && entry.evidence_class !== "role_identity").length;
    if (role.bullet_density === "expanded" && evidenceCount < 4) findings.push(finding("schema_invalid", null, "Expanded role density requires several distinct confirmed evidence units"));
    if (role.bullet_density === "standard" && evidenceCount < 2) findings.push(finding("schema_invalid", null, "Standard role density requires multiple distinct confirmed evidence units"));
    if (role.bullet_density === "none" && evidenceCount > 0) findings.push(finding("schema_invalid", null, "A role with distinct confirmed evidence cannot use heading-only density"));
  }
  if (jobs.length > 0 && !(value.section_order ?? []).includes("experience")) {
    findings.push(finding("schema_invalid", null, "Strategy section order must preserve confirmed work history"));
  }
  if ((value.summary_decision === "include") !== (value.summary_reason_code === "supported_positioning")) {
    findings.push(finding("schema_invalid", null, "Strategy summary inclusion requires a supported positioning reason"));
  }
  for (const skill of value.skills_context ?? []) {
    const row = factRows.find((fact) => fact.revision_id === skill.skill_fact_revision_id);
    if (row?.fact_kind !== "skill" || (skill.context_fact_revision_ids ?? []).some((id) => !facts.has(id))) {
      findings.push(finding("lineage_invalid", null, "Strategy skills context must cite confirmed skill and context identities"));
    }
  }
  const allowedGaps = new Set(annotations.unresolved_gap_ids ?? []);
  if ((value.unresolved_gap_ids ?? []).some((id) => !allowedGaps.has(id))) {
    findings.push(finding("lineage_invalid", null, "Strategy unresolved gaps must come from explicit current coverage"));
  }
  return findings;
}

function validateGeneralStrategyUse(result: unknown, blocks: DataBlock[]): Finding[] {
  const value = result as { statements?: GeneratedStatement[]; section_order?: string[]; omissions?: Array<{ fact_revision_id?: string; reason_code?: string }> };
  const strategies = blocks.filter((candidate) => candidate.category === "resume_strategy");
  if (strategies.length === 0) return [];
  if (strategies.length !== 1) return [finding("lineage_invalid", null, "General generation requires one exact validated resume strategy")];
  const strategy = strategies[0]!.data as {
    section_order?: string[];
    evidence_priorities?: Array<{ fact_revision_id?: string; priority?: string }>;
    summary_decision?: string;
    omissions?: Array<{ fact_revision_id?: string; reason_code?: string }>;
  };
  const findings: Finding[] = [];
  const used = new Set((value.statements ?? []).flatMap((statement) => statement.supporting_confirmed_fact_revision_ids));
  const omissions = [...(strategy.omissions ?? []), ...(value.omissions ?? [])];
  const omissionMap = new Map<string, unknown>();
  for (const entry of omissions) {
    if (typeof entry.fact_revision_id !== "string") continue;
    const existing = omissionMap.get(entry.fact_revision_id);
    if (existing !== undefined && existing !== entry.reason_code) findings.push(finding("schema_invalid", null, "One omission identity cannot carry conflicting visible reasons"));
    omissionMap.set(entry.fact_revision_id, entry.reason_code);
  }
  const omissionIds = [...omissionMap.keys()];
  const facts = confirmedFacts(blocks);
  if (omissionIds.some((id) => !facts.has(id))) findings.push(finding("lineage_invalid", null, "Draft omissions must reference the exact confirmed snapshot"));
  for (const entry of strategy.evidence_priorities ?? []) {
    if (entry.priority === "must_use" && typeof entry.fact_revision_id === "string" && !used.has(entry.fact_revision_id) && !omissionIds.includes(entry.fact_revision_id)) {
      findings.push(finding("missing_provenance", null, "Every must-use strategy item must appear with claim lineage or a visible allowed omission reason"));
    }
  }
  const hasSummary = (value.statements ?? []).some((statement) => statement.section_id === "summary");
  if (strategy.summary_decision === "omit" && hasSummary) findings.push(finding("schema_invalid", null, "Draft added a summary that the evidence-shaped strategy omitted"));
  if (strategy.summary_decision === "include" && !hasSummary) findings.push(finding("schema_invalid", null, "Draft quietly omitted the supported strategy summary"));
  if (value.section_order && strategy.section_order && canonicalInputDigest(value.section_order) !== canonicalInputDigest(strategy.section_order)) {
    findings.push(finding("lineage_invalid", null, "Draft section order does not match the exact strategy"));
  }
  const orderedSections = new Set(value.section_order ?? []);
  if (value.section_order && (value.statements ?? []).some((statement) => !orderedSections.has(statement.section_id ?? "experience"))) {
    findings.push(finding("schema_invalid", null, "Every draft statement section must appear in the section order"));
  }
  return findings;
}

function validateInterviewAssist(result: unknown, blocks: DataBlock[]): Finding[] {
  const summary = blocks.find((block) => block.category === "job_evidence_summary")?.data as {
    active_job_fact_revision_id?: string;
    requested_opportunity_id?: string;
    requested_dimension?: string;
    opportunity_kind?: string;
    value_category?: string;
  } | undefined;
  const questions = (result as { questions?: Array<{ question_id?: string; job_fact_revision_id?: string; opportunity_id?: string; dimension?: string; opportunity_kind?: string; value_category?: string; selection_method?: string; prompt?: string }> }).questions ?? [];
  if (!summary || questions.length !== 1) return [finding("schema_invalid", null, "Interview assistance requires one active-job question")];
  const question = questions[0]!;
  const findings: Finding[] = [];
  if (question.job_fact_revision_id !== summary.active_job_fact_revision_id) findings.push(finding("lineage_invalid", question.question_id ?? null, "Interview assistance must stay on the active job"));
  if (question.opportunity_id !== summary.requested_opportunity_id) findings.push(finding("lineage_invalid", question.question_id ?? null, "Interview assistance must preserve the selected opportunity identity"));
  if (question.dimension !== summary.requested_dimension) findings.push(finding("lineage_invalid", question.question_id ?? null, "Interview assistance must stay on the selected evidence dimension"));
  if (question.opportunity_kind !== summary.opportunity_kind || question.value_category !== summary.value_category || question.selection_method !== "deterministic_value") {
    findings.push(finding("lineage_invalid", question.question_id ?? null, "Interview assistance must preserve the deterministic opportunity classification"));
  }
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

function validatePlan(result: unknown, facts: Map<string, string>, blocks: DataBlock[]): Finding[] {
  const value = result as {
    threshold_policy_id?: string; threshold_policy_version?: string; fit_class?: string; outcome?: string; no_change_reason?: string | null;
    support_counts?: unknown; changes?: Array<{ change_id: string; requirement_id: string; statement_id: string | null; action: "selection" | "ordering" | "emphasis" | "faithful_wording" | "shorten"; rationale?: string; supporting_confirmed_fact_revision_ids: string[] }>;
  };
  const findings = (value.changes ?? [])
    .filter((change) => change.supporting_confirmed_fact_revision_ids.some((id) => !facts.has(id)))
    .map((change) => finding("missing_provenance", change.change_id, "Tailoring plan cites a fact outside the confirmed snapshot"));
  const matrix = blocks.find((candidate) => candidate.category === "evidence_matrix")?.data;
  const parent = blocks.find((candidate) => candidate.category === "general_resume_definition")?.data as { statements?: Array<{ statement_id?: string }> } | undefined;
  const policy = blocks.find((candidate) => candidate.category === "target_fit_policy")?.data;
  if (!Array.isArray(matrix) || canonicalInputDigest(policy) !== canonicalInputDigest(TARGET_FIT_THRESHOLD_POLICY)) {
    findings.push(finding("lineage_invalid", null, "Tailoring requires one exact versioned target-fit policy and evidence matrix"));
    return findings;
  }
  const decision = decideTargetFit(matrix, value.changes ?? []);
  if (
    value.threshold_policy_id !== TARGET_FIT_THRESHOLD_POLICY.policy_id || value.threshold_policy_version !== TARGET_FIT_THRESHOLD_POLICY.policy_version ||
    value.fit_class !== decision.fit_class || value.outcome !== decision.outcome || value.no_change_reason !== decision.no_change_reason ||
    canonicalInputDigest(value.support_counts) !== canonicalInputDigest(decision.support_counts) ||
    canonicalInputDigest((value.changes ?? []).map(({ rationale: _rationale, ...change }) => change)) !== canonicalInputDigest(decision.material_changes)
  ) findings.push(finding("schema_invalid", null, "Tailoring result does not match the deterministic score-free fit and material-change gate"));
  const statementIds = new Set((parent?.statements ?? []).flatMap((statement) => typeof statement.statement_id === "string" ? [statement.statement_id] : []));
  if ((value.changes ?? []).some((change) => !change.statement_id || !statementIds.has(change.statement_id))) {
    findings.push(finding("lineage_invalid", null, "Tailoring changes must name statements in the approved general resume"));
  }
  return findings;
}

function validateTargetedLineage(result: unknown, blocks: DataBlock[]): Finding[] {
  const value = result as { outcome?: string; no_change_reason?: string; parent_general_definition_revision_id?: string; job_revision_id?: string; title?: string; statements?: GeneratedStatement[]; changed_statement_ids?: string[]; section_order?: string[] };
  const definition = blocks.find((block) => block.category === "general_resume_definition")?.data as { metadata?: { revision_id?: string }; title?: string; statements?: GeneratedStatement[]; section_order?: string[] } | undefined;
  const job = blocks.find((block) => block.category === "job_description")?.data as { metadata?: { revision_id?: string } } | undefined;
  const analysis = blocks.find((block) => block.category === "target_fit_analysis")?.data as { outcome?: string; analysis_state?: string; parent_general_definition_revision_id?: string; job_revision_id?: string; material_changes?: Array<{ statement_id?: string | null; action?: string }> } | undefined;
  const findings: Finding[] = [];
  if (!analysis) {
    return value.parent_general_definition_revision_id === definition?.metadata?.revision_id && value.job_revision_id === job?.metadata?.revision_id
      ? []
      : [finding("lineage_invalid", null, "Targeted draft lineage does not match the immutable input snapshot")];
  }
  if (value.outcome === "no_meaningful_change") {
    return value.no_change_reason === "no_material_resume_change"
      && value.parent_general_definition_revision_id === definition?.metadata?.revision_id
      && value.job_revision_id === job?.metadata?.revision_id
      && analysis.outcome === "targeted_variant" && analysis.analysis_state === "ready_for_targeted_draft"
      ? []
      : [finding("lineage_invalid", null, "Targeted no-change result does not match one current pending target analysis")];
  }
  if (
    value.parent_general_definition_revision_id !== definition?.metadata?.revision_id || value.job_revision_id !== job?.metadata?.revision_id ||
    analysis?.outcome !== "targeted_variant" || analysis.analysis_state !== "ready_for_targeted_draft" ||
    analysis.parent_general_definition_revision_id !== definition?.metadata?.revision_id || analysis.job_revision_id !== job?.metadata?.revision_id
  ) {
    findings.push(finding("lineage_invalid", null, "Targeted draft lineage does not match one persisted passing target analysis"));
    return findings;
  }
  const plannedIds = [...new Set((analysis.material_changes ?? []).flatMap((change) => change.statement_id ? [change.statement_id] : []))].sort();
  const actionById = new Map((analysis.material_changes ?? []).flatMap((change) => change.statement_id ? [[change.statement_id, change.action]] : []));
  const actualIds = [...new Set(value.changed_statement_ids ?? [])].sort();
  if (canonicalInputDigest(plannedIds) !== canonicalInputDigest(actualIds)) findings.push(finding("lineage_invalid", null, "Targeted draft change manifest differs from the supported plan"));
  const source = new Map((definition?.statements ?? []).map((statement) => [statement.statement_id, statement]));
  const next = new Map((value.statements ?? []).map((statement) => [statement.statement_id, statement]));
  if (source.size !== next.size || [...source.keys()].some((id) => !next.has(id))) findings.push(finding("lineage_invalid", null, "Targeted drafting cannot add or remove statements outside the supported plan"));
  let observableChanges = 0;
  for (const [statementId, sourceStatement] of source) {
    const nextStatement = next.get(statementId);
    if (!nextStatement) continue;
    const planned = plannedIds.includes(statementId);
    const action = actionById.get(statementId);
    const sourceWithoutText = { ...sourceStatement, text: "" };
    const nextWithoutText = { ...nextStatement, text: "" };
    const nonTextChanged = canonicalInputDigest(sourceWithoutText) !== canonicalInputDigest(nextWithoutText);
    const usefulTextChange = hasUsefulTextDifference(sourceStatement.text, nextStatement.text);
    const sourceIndex = (definition?.statements ?? []).findIndex((statement) => statement.statement_id === statementId);
    const nextIndex = (value.statements ?? []).findIndex((statement) => statement.statement_id === statementId);
    const usefulOrderingChange = action === "ordering" && sourceIndex >= 0 && nextIndex >= 0 && nextIndex < sourceIndex;
    if (!planned && (usefulTextChange || nonTextChanged)) {
      findings.push(finding("lineage_invalid", statementId, "Targeted draft changed an unplanned statement"));
    } else if (planned && action === "ordering" && (!usefulOrderingChange || usefulTextChange || nonTextChanged)) {
      findings.push(finding("lineage_invalid", statementId, "A planned ordering change must visibly move the supported statement earlier without rewriting it"));
    } else if (planned && action !== "ordering" && (!usefulTextChange || nonTextChanged)) {
      findings.push(finding("lineage_invalid", statementId, "A planned wording change must create an observable difference beyond punctuation, case, or whitespace"));
    } else if (planned && (usefulOrderingChange || usefulTextChange)) {
      observableChanges += 1;
    }
  }
  if (observableChanges !== plannedIds.length) findings.push(finding("schema_invalid", null, "A targeted draft requires every planned change to produce one observable, useful presentation difference"));
  if (value.title !== definition?.title) findings.push(finding("lineage_invalid", null, "Targeted drafting cannot inject target wording into the resume title"));
  const orderingPlanned = (analysis.material_changes ?? []).some((change) => change.action === "ordering");
  if (!orderingPlanned && canonicalInputDigest(value.section_order) !== canonicalInputDigest(definition?.section_order)) findings.push(finding("lineage_invalid", null, "Targeted section order changed without a supported ordering plan"));
  return findings;
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

function hasUsefulTextDifference(left: string, right: string): boolean {
  const words = (value: string) => value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}%]+/gu)?.join(" ") ?? "";
  return words(left) !== words(right);
}

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
