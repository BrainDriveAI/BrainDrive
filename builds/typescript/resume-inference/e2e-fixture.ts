import { randomUUID } from "node:crypto";

import type { ModelAdapter, StructuredCompletionRequest } from "../adapters/base.js";
import type { InferencePurpose } from "../app-platform/contracts/inference.js";
import type { ResolvedInferenceProvider } from "./compatibility.js";

type DataBlock = { category?: string; data?: unknown };
type ConfirmedFact = { revision_id: string; fact_kind?: string; value: string };
type StructuredJob = { format: "resume_job_v1"; title: string; employer: string; location?: string; start_date?: string; end_date?: string; responsibilities?: string };
type StructuredAccomplishment = { format: "resume_accomplishment_v1"; job_fact_revision_id: string; text: string };

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

function structuredFact<T extends StructuredJob | StructuredAccomplishment>(fact: ConfirmedFact): T | null {
  try {
    const parsed = JSON.parse(fact.value) as T;
    return parsed && typeof parsed === "object" && typeof parsed.format === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function statement(sectionId: string, text: string, supportingIds: string[]) {
  return { statement_id: randomUUID(), section_id: sectionId, kind: "factual", text, supporting_confirmed_fact_revision_ids: supportingIds };
}

export function synthesizeResumeE2eResult(purpose: InferencePurpose, blocks: DataBlock[]): unknown {
  const facts = blockData<{ facts: ConfirmedFact[] }>(blocks, "confirmed_fact_snapshot").facts;
  const firstFact = facts[0];
  switch (purpose) {
    case "interview_assist":
      return { questions: [{ question_id: randomUUID(), topic: "experience", prompt: "What confirmed experience should be included?", rationale: "Collect owner-provided support." }] };
    case "general_resume_draft":
      {
      const sectionFor = (fact: ConfirmedFact) => {
        if (fact.fact_kind === "contact") return fact.value.startsWith("Professional link:") ? "links" : "contact";
        if (fact.fact_kind === "employment" || fact.fact_kind === "accomplishment") return "experience";
        if (fact.fact_kind === "education") return "education";
        if (fact.fact_kind === "credential") return "certifications";
        if (fact.fact_kind === "skill") return "skills";
        if (fact.fact_kind === "project") return fact.value.startsWith("Leadership or volunteer:") ? "leadership" : "projects";
        return "experience";
      };
      const resumeFacts = facts.filter((fact) => fact.fact_kind !== "preference");
      const statements: ReturnType<typeof statement>[] = [];
      for (const fact of resumeFacts) {
        const job = fact.fact_kind === "employment" ? structuredFact<StructuredJob>(fact) : null;
        const accomplishment = fact.fact_kind === "accomplishment" ? structuredFact<StructuredAccomplishment>(fact) : null;
        if (job?.format === "resume_job_v1") {
          const heading = [job.title, job.employer, job.location, [job.start_date, job.end_date].filter(Boolean).join(" - ")].filter(Boolean).join(" | ");
          statements.push(statement("experience", heading, [fact.revision_id]));
          if (job.responsibilities) statements.push(statement("experience", job.responsibilities, [fact.revision_id]));
        } else if (accomplishment?.format === "resume_accomplishment_v1") {
          statements.push(statement("experience", accomplishment.text, [fact.revision_id]));
        } else {
          statements.push(statement(sectionFor(fact), fact.value, [fact.revision_id]));
        }
      }
      const firstJobFact = facts.find((fact) => fact.fact_kind === "employment");
      const firstJob = firstJobFact ? structuredFact<StructuredJob>(firstJobFact) : null;
      if (firstJobFact && firstJob?.format === "resume_job_v1") {
        const summaryText = firstJob.responsibilities
          ? `${firstJob.title} with experience ${firstJob.responsibilities.charAt(0).toLowerCase()}${firstJob.responsibilities.slice(1)}`
          : `${firstJob.title} with experience at ${firstJob.employer}.`;
        const contactIndex = statements.findIndex((candidate) => candidate.section_id === "contact");
        statements.splice(contactIndex < 0 ? 0 : contactIndex + 1, 0, statement("summary", summaryText, [firstJobFact.revision_id]));
      }
      const acceptedOrder = ["contact", "summary", "experience", "education", "certifications", "skills", "projects", "leadership", "volunteer", "links"];
      const sections = new Set(statements.map((statement) => statement.section_id));
      const contact = facts.find((fact) => fact.fact_kind === "contact" && !fact.value.startsWith("Professional link:"));
      return {
        title: contact?.value.split("|")[0]?.trim() || "Resume",
        statements,
        section_order: acceptedOrder.filter((section) => sections.has(section)),
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
      return { changes: [{ change_id: randomUUID(), statement_id: definition.statements[0]?.statement_id ?? null, action: "retain", rationale: "Retain supported owner wording.", supporting_confirmed_fact_revision_ids: firstFact ? [firstFact.revision_id] : [] }] };
    }
    case "targeted_resume_draft": {
      const definition = blockData<{ metadata: { revision_id: string }; title: string; statements: Array<Record<string, unknown>>; section_order: string[] }>(blocks, "general_resume_definition");
      const job = blockData<{ metadata: { revision_id: string } }>(blocks, "job_description");
      const statements = definition.statements.map(({ display_role: _displayRole, ...generatedStatement }) => generatedStatement);
      return { parent_general_definition_revision_id: definition.metadata.revision_id, job_revision_id: job.metadata.revision_id, title: `${definition.title} - Targeted`, statements, changed_statement_ids: [], section_order: definition.section_order };
    }
  }
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
