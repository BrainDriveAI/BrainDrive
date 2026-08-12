import { randomUUID } from "node:crypto";

import type { ModelAdapter, StructuredCompletionRequest } from "../adapters/base.js";
import type { InferencePurpose } from "../app-platform/contracts/inference.js";
import type { ResolvedInferenceProvider } from "./compatibility.js";
import {
  buildEvidenceAnnotations,
  canonicalSectionOrder,
  canonicalizeEvidenceAnnotations,
  canonicalizeFacts,
  canonicalizeStrategyResult,
  sectionForFact,
} from "./strategy.js";
import { craftContextFromBlocks, evaluateCraftProposal } from "./craft-evaluator.js";
import { decideTargetFit, TARGET_FIT_THRESHOLD_POLICY } from "./target-fit.js";

type DataBlock = { category?: string; data?: unknown };
type ConfirmedFact = { revision_id: string; fact_kind: string; value: string };
type StructuredJob = { format: "resume_job_v1"; title: string; employer: string; location?: string; start_date?: string; end_date?: string; responsibilities?: string };
type StructuredAccomplishment = { format: "resume_accomplishment_v1"; job_fact_revision_id: string; text: string };
type StructuredJobEvidence = { value_version: 1; association: "job" | "general"; job_fact_revision_id: string | null; dimension: string; outcome: "answered" | "skipped" | "unknown" | "not_applicable" | "complete_for_now"; owner_text: string };

function parseBlocks(request: StructuredCompletionRequest): DataBlock[] {
  const match = request.user.match(/<resume-builder-data purpose="[^"]+">\n([\s\S]+)\n<\/resume-builder-data>/);
  if (!match) throw new Error("Synthetic E2E request did not contain the immutable data block envelope");
  const value = JSON.parse(match[1]!) as unknown;
  if (!Array.isArray(value)) throw new Error("Synthetic E2E request data blocks were not an array");
  return value as DataBlock[];
}

function blockData<T>(blocks: DataBlock[], category: string): T {
  const block = blocks.find((candidate) => candidate.category === category);
  if (!block) throw new Error(`Synthetic E2E request omitted ${category}`);
  return block.data as T;
}

function structuredFact<T extends StructuredJob | StructuredAccomplishment | StructuredJobEvidence>(fact: ConfirmedFact): T | null {
  try {
    const parsed = JSON.parse(fact.value) as T;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function statement(sectionId: string, text: string, supportingIds: string[]) {
  return { statement_id: randomUUID(), section_id: sectionId, kind: "factual", text, supporting_confirmed_fact_revision_ids: supportingIds };
}

export function synthesizeResumeE2eResult(purpose: InferencePurpose, blocks: DataBlock[]): unknown {
  const facts = canonicalizeFacts(blockData<{ facts: ConfirmedFact[] }>(blocks, "confirmed_fact_snapshot").facts);
  const firstFact = facts[0];
  switch (purpose) {
    case "interview_assist":
      {
        const summary = blockData<{ active_job_fact_revision_id: string; requested_opportunity_id: string; requested_dimension: string; opportunity_kind: "qualitative" | "metric"; value_category: "distinct_accomplishment" | "decision_useful_outcome" | "scope_or_scale" | "tools_in_use" | "progression" | "core_responsibility" }>(blocks, "job_evidence_summary");
        const prompts: Record<string, string> = {
          responsibilities: "What work did you handle most often in this role?",
          accomplishments: "What is one thing you improved, solved, or handled especially well in this role?",
          outcomes: "What became better or easier because of your work? A qualitative result is enough.",
          tools: "Which tools or technologies did you actually use in this role, and what did you use them for?",
          scope: "What truthful detail would help explain the scope of this role? Exact numbers are optional.",
          progression: "Did your responsibilities change or grow in this role? It is fine if they did not.",
        };
        return { questions: [{ question_id: randomUUID(), job_fact_revision_id: summary.active_job_fact_revision_id, opportunity_id: summary.requested_opportunity_id, dimension: summary.requested_dimension, opportunity_kind: summary.opportunity_kind, value_category: summary.value_category, selection_method: "deterministic_value", prompt: prompts[summary.requested_dimension] ?? "What useful confirmed detail would you like to add for this role?", rationale: "Phrase the host-selected evidence opportunity without changing its identity." }] };
      }
    case "general_resume_draft":
      {
      const resumeFacts = facts.filter((fact) => fact.fact_kind !== "preference");
      const strategy = blocks.find((block) => block.category === "resume_strategy")?.data as { summary_decision?: string; section_order?: string[]; omissions?: Array<{ fact_revision_id?: string }> } | undefined;
      const plannedOmissions = new Set((strategy?.omissions ?? []).flatMap((item) => typeof item.fact_revision_id === "string" ? [item.fact_revision_id] : []));
      const statements: ReturnType<typeof statement>[] = [];
      for (const fact of resumeFacts) {
        if (plannedOmissions.has(fact.revision_id)) continue;
        const job = fact.fact_kind === "employment" ? structuredFact<StructuredJob>(fact) : null;
        const accomplishment = fact.fact_kind === "accomplishment" ? structuredFact<StructuredAccomplishment>(fact) : null;
        const jobEvidence = fact.fact_kind === "job_evidence" ? structuredFact<StructuredJobEvidence>(fact) : null;
        if (job?.format === "resume_job_v1") {
          const heading = [job.title, job.employer, job.location, [job.start_date, job.end_date].filter(Boolean).join(" - ")].filter(Boolean).join(" | ");
          statements.push(statement("experience", heading, [fact.revision_id]));
          if (job.responsibilities) statements.push(statement("experience", job.responsibilities, [fact.revision_id]));
        } else if (accomplishment?.format === "resume_accomplishment_v1") {
          statements.push(statement("experience", accomplishment.text, [fact.revision_id]));
        } else if (jobEvidence?.value_version === 1) {
          if (jobEvidence.outcome !== "answered") continue;
          statements.push(statement(jobEvidence.association === "general" ? "skills" : "experience", jobEvidence.owner_text, [fact.revision_id]));
        } else {
          statements.push(statement(sectionForFact(fact) ?? "experience", fact.value, [fact.revision_id]));
        }
      }
      const firstJobFact = facts.find((fact) => fact.fact_kind === "employment");
      const firstJob = firstJobFact ? structuredFact<StructuredJob>(firstJobFact) : null;
      if (strategy?.summary_decision === "include" && firstJobFact && firstJob?.format === "resume_job_v1") {
        const summaryText = firstJob.responsibilities
          ? `${firstJob.title} with experience ${firstJob.responsibilities.charAt(0).toLowerCase()}${firstJob.responsibilities.slice(1)}`
          : `${firstJob.title} with experience at ${firstJob.employer}.`;
        const contactIndex = statements.findIndex((candidate) => candidate.section_id === "contact");
        statements.splice(contactIndex < 0 ? 0 : contactIndex + 1, 0, statement("summary", summaryText, [firstJobFact.revision_id]));
      }
      const contact = facts.find((fact) => fact.fact_kind === "contact" && !fact.value.startsWith("Professional link:"));
      return {
        title: contact?.value.split("|")[0]?.trim() || "Resume",
        statements,
        section_order: strategy?.section_order ?? canonicalSectionOrder(resumeFacts, strategy?.summary_decision === "include" ? "include" : "omit", [...plannedOmissions]),
        omissions: strategy?.omissions ?? [],
      };
      }
    case "job_description_analyze": {
      const job = blockData<{ description_text: string }>(blocks, "job_description");
      const sourceSpan = job.description_text.slice(0, 4_096);
      return { requirements: [{ requirement_id: randomUUID(), requirement_kind: "required", source_span: sourceSpan, inferred: false, normalized_requirement: sourceSpan }] };
    }
    case "requirement_evidence_match": {
      const analysis = blockData<{ requirements: Array<{ requirement_id: string }> }>(blocks, "job_analysis");
      return { evidence: analysis.requirements.map((requirement) => ({ requirement_id: requirement.requirement_id, evidence_status: firstFact ? "supported" : "clarification_needed", supporting_confirmed_fact_revision_ids: firstFact ? [firstFact.revision_id] : [], explanation: firstFact ? "A confirmed owner fact is available for this requirement." : "No confirmed owner fact supports this requirement.", clarification: firstFact ? null : "Add a confirmed fact or leave this requirement unsupported." })) };
    }
    case "tailoring_plan": {
      const definition = blockData<{ statements: Array<{ statement_id: string }> }>(blocks, "general_resume_definition");
      const evidence = blockData<Array<{ requirement_id: string; requirement_kind: "required" | "preferred" | "responsibility" | "skill" | "credential" | "constraint" | "inferred"; evidence_status: "supported" | "partially_supported" | "unsupported" | "ambiguous" | "clarification_needed"; supporting_confirmed_fact_revision_ids: string[] }>>(blocks, "evidence_matrix");
      const supported = evidence.find((row) => row.evidence_status === "supported");
      const changes = supported && definition.statements[0]
        ? [{ change_id: randomUUID(), requirement_id: supported.requirement_id, statement_id: definition.statements[0].statement_id, action: "emphasis" as const, rationale: "Emphasize supported owner evidence.", supporting_confirmed_fact_revision_ids: supported.supporting_confirmed_fact_revision_ids }]
        : [];
      const decision = decideTargetFit(evidence, changes);
      return { plan_version: 2, threshold_policy_id: TARGET_FIT_THRESHOLD_POLICY.policy_id, threshold_policy_version: TARGET_FIT_THRESHOLD_POLICY.policy_version, fit_class: decision.fit_class, outcome: decision.outcome, no_change_reason: decision.no_change_reason, support_counts: decision.support_counts, changes: decision.material_changes.map((change) => ({ ...change, rationale: "Emphasize supported owner evidence." })) };
    }
    case "targeted_resume_draft": {
      const definition = blockData<{ metadata: { revision_id: string }; title: string; statements: Array<Record<string, unknown>>; section_order: string[] }>(blocks, "general_resume_definition");
      const job = blockData<{ metadata: { revision_id: string } }>(blocks, "job_description");
      const analysis = blockData<{ material_changes: Array<{ statement_id: string | null }> }>(blocks, "target_fit_analysis");
      const changedStatementIds = [...new Set(analysis.material_changes.flatMap((change) => change.statement_id ? [change.statement_id] : []))];
      const statements = definition.statements.map((generatedStatement) => changedStatementIds.includes(String(generatedStatement.statement_id))
        ? { ...generatedStatement, text: emphasizedFixtureText(String(generatedStatement.text)) }
        : generatedStatement);
      return { parent_general_definition_revision_id: definition.metadata.revision_id, job_revision_id: job.metadata.revision_id, title: definition.title, statements, changed_statement_ids: changedStatementIds, section_order: definition.section_order };
    }
    case "resume_revision_classify": {
      const request = blockData<{ target: { scope: "statement" | "section" | "resume"; target_id: string | null }; request_text: string }>(blocks, "revision_instruction");
      const factual = /\b(?:manager|leader|led|title|date|metric|percent|certif|degree|add a fact|change the fact)\b/i.test(request.request_text);
      const presentation = /\b(?:shorten|reorder|format|wording|concise|tone|remove repetition|move)\b/i.test(request.request_text);
      const ambiguous = /^(?:make it better|improve it|fix it|revise it)[.!]?$/i.test(request.request_text.trim()) || (!factual && !presentation);
      const classification = ambiguous ? "ambiguous" : factual && presentation ? "mixed" : factual ? "factual" : "presentation";
      return {
        classification,
        target: request.target,
        clarification: classification === "ambiguous" ? "Which statement or section should change, and what should be different?" : null,
        proposed_fact_changes: classification === "factual" || classification === "mixed"
          ? [{ fact_revision_id: null, change_kind: "add", owner_visible_summary: "Confirm the factual meaning in this request before a proposal is generated." }]
          : [],
      };
    }
    case "resume_revision_draft": {
      const definition = blockData<{ metadata: { revision_id: string }; title: string; statements: Array<{ statement_id: string; text: string } & Record<string, unknown>>; section_order: string[] }>(blocks, "general_resume_definition");
      const request = blockData<{ metadata: { revision_id: string }; target: { scope: "statement" | "section" | "resume"; target_id: string | null } }>(blocks, "revision_instruction");
      const candidate = definition.statements.find((item) => request.target.scope === "resume" || item.statement_id === request.target.target_id || item.section_id === request.target.target_id) ?? definition.statements[0];
      if (!candidate) throw new Error("Synthetic revision fixture requires one source statement");
      const statements = definition.statements.map((item) => item.statement_id === candidate.statement_id
        ? { ...item, text: item.text.endsWith(".") ? item.text.slice(0, -1) : `${item.text}.` }
        : item);
      return {
        source_definition_revision_id: definition.metadata.revision_id,
        revision_request_revision_id: request.metadata.revision_id,
        title: definition.title,
        statements,
        changed_statement_ids: [candidate.statement_id],
        section_order: definition.section_order,
      };
    }
    case "resume_guidance":
      return { guidance_version: 1, items: firstFact ? [{ category: "strong_evidence", evidence_revision_ids: [firstFact.revision_id], evidence_labels: ["Confirmed evidence"], message: "This confirmed evidence is specific and ready for review." }] : [], optional_questions: [] };
    case "resume_strategy": {
      const suppliedAnnotations = blocks.find((block) => block.category === "evidence_annotations")?.data as ReturnType<typeof buildEvidenceAnnotations> | undefined;
      const annotations = suppliedAnnotations ? canonicalizeEvidenceAnnotations(suppliedAnnotations) : buildEvidenceAnnotations(facts, []);
      const jobs = facts.filter((fact) => fact.fact_kind === "employment");
      const includeSummary = jobs.length >= 2;
      const result = {
        strategy_version: 1,
        history_shape: jobs.length <= 1 ? "early_career" : jobs.length >= 5 ? "senior_selective" : "chronological_standard",
        history_reason_code: jobs.length <= 1 ? "thin_history" : jobs.length >= 5 ? "senior_compression" : "standard_chronology",
        role_emphasis: jobs.map((job, index) => {
          const evidenceCount = annotations.facts.filter((fact) => fact.job_fact_revision_id === job.revision_id && fact.evidence_class !== "role_identity").length;
          return { job_fact_revision_id: job.revision_id, priority: index === 0 ? "primary" : index >= 3 ? "compressed" : "supporting", reason_code: index === 0 ? "recent" : index >= 3 ? "older_context" : "continuity", bullet_density: evidenceCount >= 4 ? "expanded" : evidenceCount >= 2 ? "standard" : "compact" };
        }),
        section_order: canonicalSectionOrder(facts, includeSummary ? "include" : "omit"),
        evidence_priorities: annotations.facts.map((fact) => ({ fact_revision_id: fact.fact_revision_id, priority: fact.required_priority })),
        summary_decision: includeSummary ? "include" as const : "omit" as const,
        summary_reason_code: includeSummary ? "supported_positioning" : "insufficient_distinct_value",
        skills_context: facts.filter((fact) => fact.fact_kind === "skill").map((fact) => ({ skill_fact_revision_id: fact.revision_id, placement: "skills_section", context_fact_revision_ids: [] })),
        omissions: [],
        unresolved_gap_ids: annotations.unresolved_gap_ids,
        owner_rationale: "Lead with the most recent supported experience and preserve every distinct confirmed evidence unit.",
      };
      return canonicalizeStrategyResult(result, facts, annotations);
    }
    case "resume_craft_evaluate":
      return evaluateCraftProposal(craftContextFromBlocks(blocks.map((entry) => ({ category: entry.category ?? "", data: entry.data }))));
    case "resume_craft_repair": {
      const definition = blockData<{ metadata: { revision_id: string }; title: string; statements: Array<{ statement_id: string } & Record<string, unknown>>; section_order: string[] }>(blocks, "general_resume_definition");
      const report = blockData<{ metadata: { revision_id: string }; findings?: Array<{ severity?: string; statement_id?: string | null }> }>(blocks, "craft_quality_report");
      const namedId = report.findings?.find((finding) => finding.severity === "blocking" && finding.statement_id)?.statement_id;
      const changed = definition.statements.find((item) => item.statement_id === namedId) ?? definition.statements[0];
      if (!changed) throw new Error("Synthetic craft repair fixture requires one source statement");
      const statements = definition.statements.map((item) => item.statement_id === changed.statement_id
        ? { ...item, text: String(item.text).replace(/^(?:Responsible for|Duties included|Tasked with)\s+/i, "") }
        : item);
      return { repair_version: 1, source_definition_revision_id: definition.metadata.revision_id, source_report_revision_id: report.metadata.revision_id, changed_statement_ids: [changed.statement_id], title: definition.title, statements, section_order: definition.section_order };
    }
  }
}

function emphasizedFixtureText(value: string): string {
  const trimmed = value.trim().replace(/[.]$/, "");
  const clauses = trimmed.split(/\s+and\s+/i);
  if (clauses.length === 2) {
    const second = clauses[1]!;
    return `${second.charAt(0).toUpperCase()}${second.slice(1)}; ${clauses[0]!.charAt(0).toLowerCase()}${clauses[0]!.slice(1)}.`;
  }
  return `${trimmed}.`;
}

export function createResumeE2eFixtureProviderResolver(): (purpose: InferencePurpose) => Promise<ResolvedInferenceProvider> {
  return async (purpose) => {
    const adapter: ModelAdapter = {
      async complete() { throw new Error("Synthetic Resume Builder provider cannot enter the agent loop"); },
      async completeStructuredNoTools(request) {
        const result = synthesizeResumeE2eResult(purpose, parseBlocks(request));
        return { text: JSON.stringify(result), finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      },
    };
    return { providerProfileId: "synthetic-resume-e2e", providerId: "synthetic-resume-e2e", modelId: "deterministic-fixture-v1", modelClass: "owner_active_compatible", adapter };
  };
}
