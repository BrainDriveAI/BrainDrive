import type { ModelAdapter, StructuredCompletionRequest, StructuredCompletionResponse } from "../adapters/base.js";
import type { InferencePurpose } from "../app-platform/contracts/inference.js";
import type { ResolvedInferenceProvider } from "./compatibility.js";
import { structureResumeE2eProviderResult, synthesizeResumeE2eResult } from "./e2e-fixture.js";
import { ResumeInferenceError, type ResumeInferenceErrorCode } from "./errors.js";

type DataBlock = { category?: string; data?: unknown };

/** Credential-free, test-only fault vocabulary. This module is never selected by runtime composition. */
export const SPEC_09_PROVIDER_FAULTS = [
  "clean",
  "empty",
  "malformed_json",
  "prose_wrapped",
  "fenced_json",
  "schema_mismatch",
  "truncated",
  "deterministic_rejection",
  "content_filter",
  "refusal",
  "unexpected_tool_call",
  "authentication",
  "authorization",
  "quota",
  "rate_limit",
  "deadline",
  "network",
  "response_loss",
  "model_incompatible",
  "provider_schema_unsupported",
  "internal",
] as const;

export type Spec09ProviderFault = typeof SPEC_09_PROVIDER_FAULTS[number];

export type Spec09FaultFixture = {
  resolver: (purpose: InferencePurpose) => Promise<ResolvedInferenceProvider>;
  callCount: () => number;
  requests: () => readonly StructuredCompletionRequest[];
};

export function createSpec09FaultFixture(faults: readonly Spec09ProviderFault[]): Spec09FaultFixture {
  if (faults.length === 0) throw new Error("Spec 09 fault fixture requires at least one typed outcome");
  let callCount = 0;
  const captured: StructuredCompletionRequest[] = [];
  const resolver = async (purpose: InferencePurpose): Promise<ResolvedInferenceProvider> => {
    const adapter: ModelAdapter = {
      async complete() {
        throw new Error("Spec 09 fault fixture cannot enter the general agent loop");
      },
      async completeStructuredNoTools(request) {
        captured.push(request);
        const fault = faults[Math.min(callCount, faults.length - 1)]!;
        callCount += 1;
        const blocks = parseBlocks(request);
        const accepted = structureResumeE2eProviderResult(purpose, synthesizeResumeE2eResult(purpose, blocks), blocks);
        return faultResponse(fault, purpose, accepted);
      },
    };
    return {
      providerProfileId: "synthetic-spec-09-fault",
      providerId: "synthetic-spec-09-fault",
      modelId: "deterministic-fault-fixture-v1",
      modelClass: "owner_active_compatible",
      adapter,
    };
  };
  return { resolver, callCount: () => callCount, requests: () => captured };
}

function faultResponse(
  fault: Spec09ProviderFault,
  purpose: InferencePurpose,
  accepted: unknown,
): StructuredCompletionResponse {
  const response = (text: string, finishReason: string | undefined = "stop"): StructuredCompletionResponse => ({
    text,
    finishReason,
    modelId: "deterministic-fault-fixture-v1",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  });
  switch (fault) {
    case "clean": return response(JSON.stringify(accepted));
    case "empty": return response("   ");
    case "malformed_json": return response('{"synthetic":');
    case "prose_wrapped": return response(`Synthetic preface\n${JSON.stringify(accepted)}`);
    case "fenced_json": return response(`\`\`\`json\n${JSON.stringify(accepted)}\n\`\`\``);
    case "schema_mismatch": return response(JSON.stringify({ unexpected: true }));
    case "truncated": return response('{"synthetic":', "length");
    case "deterministic_rejection": return response(JSON.stringify(rejectedResult(purpose, accepted)));
    case "content_filter": return response("", "content_filter");
    case "refusal": return response("", "refusal");
    case "unexpected_tool_call": return response("", "tool_calls");
    case "authentication": throw typed("provider_authentication_failed", false);
    case "authorization": throw typed("provider_authorization_failed", false);
    case "quota": throw typed("quota_exceeded", false);
    case "rate_limit": throw typed("rate_limited", true);
    case "deadline": throw typed("deadline_exceeded", true);
    case "network": throw typed("provider_unavailable", true);
    case "response_loss": throw typed("provider_unavailable", true);
    case "model_incompatible": throw typed("model_incompatible", false);
    case "provider_schema_unsupported": throw typed("provider_schema_unsupported", false);
    case "internal": throw typed("internal_failure", true);
  }
}

function typed(code: ResumeInferenceErrorCode, retryable: boolean): ResumeInferenceError {
  return new ResumeInferenceError(code, `Synthetic ${code.replaceAll("_", " ")}`, retryable);
}

function parseBlocks(request: StructuredCompletionRequest): DataBlock[] {
  const match = request.user.match(/<resume-builder-data purpose="[^"]+">\n([\s\S]+)\n<\/resume-builder-data>/);
  if (!match) throw new Error("Spec 09 fault request omitted the immutable block envelope");
  const blocks = JSON.parse(match[1]!) as unknown;
  if (!Array.isArray(blocks)) throw new Error("Spec 09 fault request blocks were not an array");
  return blocks as DataBlock[];
}

const FOREIGN_ID = "99000000-0000-4000-8000-000000000099";

function rejectedResult(purpose: InferencePurpose, accepted: unknown): unknown {
  const value = structuredClone(accepted) as Record<string, unknown>;
  switch (purpose) {
    case "interview_assist": {
      const questions = value.questions as Array<Record<string, unknown>>;
      questions[0] = { ...questions[0], job_fact_revision_id: FOREIGN_ID };
      return value;
    }
    case "general_resume_draft": {
      const statements = value.statements as Array<Record<string, unknown>>;
      statements[0] = { ...statements[0], supporting_confirmed_fact_revision_ids: [FOREIGN_ID] };
      return value;
    }
    case "job_description_analyze": {
      const requirements = value.requirements as Array<Record<string, unknown>>;
      requirements[0] = { ...requirements[0], source_span: "Text absent from the immutable job description." };
      return value;
    }
    case "requirement_evidence_match": {
      const evidence = value.evidence as Array<Record<string, unknown>>;
      evidence[0] = { ...evidence[0], supporting_confirmed_fact_revision_ids: [FOREIGN_ID] };
      return value;
    }
    case "tailoring_plan": {
      const changes = value.changes as Array<Record<string, unknown>>;
      if (changes.length === 0) value.support_counts = { core: 99, transferable: 0, partial: 0, unsupported: 0 };
      else changes[0] = { ...changes[0], supporting_confirmed_fact_revision_ids: [FOREIGN_ID] };
      return value;
    }
    case "targeted_resume_draft":
      return { ...value, parent_general_definition_revision_id: FOREIGN_ID };
    case "resume_revision_classify":
      return { ...value, target: { scope: "statement", target_id: FOREIGN_ID } };
    case "resume_revision_draft":
      return { ...value, source_definition_revision_id: FOREIGN_ID };
    case "resume_guidance": {
      const items = value.items as Array<Record<string, unknown>>;
      if (items.length === 0) value.items = [{ category: "strong_evidence", evidence_revision_ids: [FOREIGN_ID], evidence_labels: ["Confirmed evidence"], message: "Review this evidence." }];
      else items[0] = { ...items[0], evidence_revision_ids: [FOREIGN_ID] };
      return value;
    }
    case "resume_strategy": {
      const priorities = value.evidence_priorities as Array<Record<string, unknown>>;
      priorities[0] = { ...priorities[0], fact_revision_id: FOREIGN_ID };
      return value;
    }
    case "resume_craft_evaluate":
      return value;
    case "resume_craft_repair":
      return { ...value, source_definition_revision_id: FOREIGN_ID };
  }
}
