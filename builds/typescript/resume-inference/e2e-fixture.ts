import { randomUUID } from "node:crypto";

import type { ModelAdapter, StructuredCompletionRequest } from "../adapters/base.js";
import type { InferencePurpose } from "../app-platform/contracts/inference.js";
import type { ResolvedInferenceProvider } from "./compatibility.js";

type DataBlock = { category?: string; data?: unknown };

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

export function synthesizeResumeE2eResult(purpose: InferencePurpose, blocks: DataBlock[]): unknown {
  const facts = blockData<{ facts: Array<{ revision_id: string; value: string }> }>(blocks, "confirmed_fact_snapshot").facts;
  const firstFact = facts[0];
  switch (purpose) {
    case "interview_assist":
      return { questions: [{ question_id: randomUUID(), topic: "experience", prompt: "What confirmed experience should be included?", rationale: "Collect owner-provided support." }] };
    case "general_resume_draft":
      return {
        title: "General Resume",
        statements: facts.map((fact) => ({ statement_id: randomUUID(), section_id: "experience", kind: "factual", text: fact.value, supporting_confirmed_fact_revision_ids: [fact.revision_id] })),
        section_order: ["experience"],
      };
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
      const definition = blockData<{ metadata: { revision_id: string }; title: string; statements: unknown[]; section_order: string[] }>(blocks, "general_resume_definition");
      const job = blockData<{ metadata: { revision_id: string } }>(blocks, "job_description");
      return { parent_general_definition_revision_id: definition.metadata.revision_id, job_revision_id: job.metadata.revision_id, title: `${definition.title} - Targeted`, statements: definition.statements, changed_statement_ids: [], section_order: definition.section_order };
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
