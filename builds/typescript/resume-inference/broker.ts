import { canonicalInputDigest, encodedByteLength } from "../app-platform/contracts/common.js";
import {
  InferenceRequestSchema,
  InferenceResultSchema,
  type InferencePurpose,
} from "../app-platform/contracts/inference.js";
import type { StructuredCompletionResponse } from "../adapters/base.js";
import type { z } from "zod";
import { buildPolicyMessages, promptPolicyIdentity, type ResumeRepairContext } from "./policy.js";
import { classifyInferenceError, ResumeInferenceError } from "./errors.js";
import { parsePurposeResult, purposeJsonSchema, ResumeDialogueDraftActionSchema, ResumeDialogueFactOperationSchema } from "./results.js";
import { validateInferenceClaims, type ValidationReport } from "./validators.js";
import type { ResolvedInferenceProvider } from "./compatibility.js";
import { repairResumeDraftFromConfirmedFacts } from "./repair.js";
import { deterministicGuidanceFallback } from "./guidance.js";
import { canonicalizeStrategyResultFromBlocks } from "./strategy.js";
import { deterministicHostFallback, normalizeHostOwnedResult } from "./host-assistance.js";

type InferenceRequest = z.infer<typeof InferenceRequestSchema>;
type InferenceResult = z.infer<typeof InferenceResultSchema>;

export type BrokerCompletion = { inference: InferenceResult; validation: ValidationReport | null };
export type InferenceProviderResolver = (purpose: InferencePurpose) => Promise<ResolvedInferenceProvider>;

type ActiveRequest = { digest: string; controller: AbortController; promise: Promise<BrokerCompletion> };

export class ResumeInferenceBroker {
  private readonly active = new Map<string, ActiveRequest>();
  private readonly completed = new Map<string, { digest: string; completion: BrokerCompletion }>();

  constructor(
    private readonly resolveProvider: InferenceProviderResolver,
    private readonly audit: (event: string, details: Record<string, unknown>) => void = () => undefined,
    private readonly now = () => new Date(),
  ) {}

  async execute(raw: unknown, signal?: AbortSignal): Promise<BrokerCompletion> {
    const request = this.parseAndValidate(raw);
    const digest = operationInputDigest(request);
    const prior = this.completed.get(request.operation_id);
    if (prior) {
      if (prior.digest !== digest) throw new ResumeInferenceError("invalid_request", "Inference operation identity was reused with different input");
      return prior.completion;
    }
    const running = this.active.get(request.operation_id);
    if (running) {
      if (running.digest !== digest) throw new ResumeInferenceError("invalid_request", "Inference operation identity was reused with different input");
      return running.promise;
    }
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason ?? new Error("cancelled"));
    signal?.addEventListener("abort", forwardAbort, { once: true });
    const promise = this.run(request, controller.signal).finally(() => {
      signal?.removeEventListener("abort", forwardAbort);
      this.active.delete(request.operation_id);
    });
    this.active.set(request.operation_id, { digest, controller, promise });
    const completion = await promise;
    this.completed.set(request.operation_id, { digest, completion });
    if (this.completed.size > 1_000) {
      const oldest = this.completed.keys().next().value;
      if (oldest) this.completed.delete(oldest);
    }
    return completion;
  }

  cancel(operationId: string): boolean {
    const running = this.active.get(operationId);
    if (!running) return false;
    running.controller.abort(new Error("cancelled"));
    return true;
  }

  status(operationId: string): "running" | "completed" | "unknown" {
    if (this.active.has(operationId)) return "running";
    if (this.completed.has(operationId)) return "completed";
    return "unknown";
  }

  private parseAndValidate(raw: unknown): InferenceRequest {
    const parsed = InferenceRequestSchema.safeParse(raw);
    if (!parsed.success) throw new ResumeInferenceError("invalid_request", "Inference request failed the accepted contract");
    const request = parsed.data;
    const promptPolicy = promptPolicyIdentity(request.purpose);
    if (request.prompt_policy_id !== promptPolicy.id || request.prompt_policy_version !== promptPolicy.version) {
      throw new ResumeInferenceError("denied", "Inference prompt policy is not accepted");
    }
    if (encodedByteLength(request.data_blocks) > request.limits.input_bytes) {
      throw new ResumeInferenceError("invalid_request", "Inference data exceeds its byte budget");
    }
    if (Math.ceil(encodedByteLength(request.data_blocks) / 4) > request.limits.input_tokens) {
      throw new ResumeInferenceError("invalid_request", "Inference data exceeds its estimated token budget");
    }
    for (const block of request.data_blocks) {
      if (canonicalInputDigest(block.data) !== block.content_digest) throw new ResumeInferenceError("invalid_request", "Inference data block digest mismatch");
    }
    const facts = request.data_blocks.filter((block) => block.category === "confirmed_fact_snapshot").map((block) => block.data);
    if (canonicalInputDigest((facts[0] as { facts?: unknown } | undefined)?.facts ?? []) !== request.input_snapshot.fact_snapshot_digest) {
      throw new ResumeInferenceError("invalid_request", "Confirmed fact snapshot digest mismatch");
    }
    const revisionIds = request.input_snapshot.record_revision_ids;
    if (new Set(revisionIds).size !== revisionIds.length) throw new ResumeInferenceError("invalid_request", "Inference snapshot contains duplicate revision identities");
    const factRevisionIds = (((facts[0] as { facts?: Array<{ revision_id?: unknown }> } | undefined)?.facts) ?? []).map((fact) => fact.revision_id);
    if (factRevisionIds.some((id) => typeof id !== "string" || !revisionIds.includes(id))) throw new ResumeInferenceError("invalid_request", "Confirmed fact identity is absent from the immutable revision set");
    for (const block of request.data_blocks.filter((candidate) => ["general_resume_definition", "job_description", "revision_instruction"].includes(candidate.category))) {
      const id = (block.data as { metadata?: { revision_id?: unknown } } | null)?.metadata?.revision_id;
      if (typeof id !== "string" || !revisionIds.includes(id)) throw new ResumeInferenceError("invalid_request", "Record data block identity is absent from the immutable revision set");
    }
    if (request.purpose === "resume_guidance") {
      const categories = request.data_blocks.map((block) => block.category);
      const allowed = new Set(["confirmed_fact_snapshot", "general_resume_definition", "deterministic_findings", "job_evidence_summary"]);
      if (categories.some((category) => !allowed.has(category)) || categories.filter((category) => category === "confirmed_fact_snapshot").length !== 1 || categories.filter((category) => category === "general_resume_definition").length !== 1 || categories.filter((category) => category === "deterministic_findings").length !== 1) {
        throw new ResumeInferenceError("invalid_request", "Resume guidance requires only the bounded confirmed, definition, finding, and optional job-evidence blocks");
      }
    }
    if (Date.parse(request.deadline_at) <= this.now().getTime()) throw new ResumeInferenceError("deadline_exceeded", "Inference request deadline has elapsed");
    return request;
  }

  private async run(request: InferenceRequest, signal: AbortSignal): Promise<BrokerCompletion> {
    const startedAt = this.now().toISOString();
    const inputDigest = canonicalInputDigest(request.data_blocks);
    let provider: ResolvedInferenceProvider | null = null;
    let attempts = 0;
    this.audit("app.inference.started", this.auditFields(request, { status: "running", attempt: attempts }));
    try {
      throwIfAborted(signal);
      provider = await this.resolveProvider(request.purpose);
      throwIfAborted(signal);
      if (!provider.adapter.completeStructuredNoTools) throw new ResumeInferenceError("model_incompatible", "Active provider lacks the no-tools structured adapter path");
      if (request.purpose === "resume_craft_evaluate") {
        const hostResult = deterministicHostFallback(request.purpose, request.data_blocks);
        if (hostResult === null) throw new ResumeInferenceError("recoverable_internal_failure", "Host craft evaluation is unavailable");
        const result = parsePurposeResult(request.purpose, request.output_schema_id, hostResult);
        const validation = validateInferenceClaims(request.purpose, result, request.data_blocks);
        if (!validation.accepted) throw new ResumeInferenceError("validation_failed", "Host craft evaluation did not pass deterministic validation");
        const completedAt = this.now().toISOString();
        const inference = InferenceResultSchema.parse({
          inference_schema_version: 1,
          request_id: request.request_id,
          operation_id: request.operation_id,
          purpose: request.purpose,
          status: "completed",
          prompt_policy_id: request.prompt_policy_id,
          prompt_policy_version: request.prompt_policy_version,
          output_schema_id: request.output_schema_id,
          output_schema_version: 1,
          input_digest: inputDigest,
          output_digest: canonicalInputDigest(result),
          result,
          provider_profile_id: provider.providerProfileId,
          model_id: provider.modelId,
          attempt_count: 0,
          usage: { available: false, input_tokens: null, output_tokens: null },
          error: null,
          started_at: startedAt,
          completed_at: completedAt,
        });
        this.audit("app.inference.completed", this.auditFields(request, { status: "completed", attempt: 0, model_class: provider.modelClass, repair: "deterministic_craft_evaluation" }));
        return { inference, validation };
      }
      let result: unknown;
      let structuralCandidate: unknown;
      let response: StructuredCompletionResponse | null = null;
      let validation: ValidationReport | null = null;
      let repairContext: ResumeRepairContext | undefined;
      let repair: "provider_validation_repair" | "deterministic_dialogue_disposition" | "deterministic_dialogue_filter" | "deterministic_dialogue_structure_filter" | "deterministic_fact_fallback" | "deterministic_strategy_fallback" | "deterministic_guidance_fallback" | "host_owned_structure" | "deterministic_craft_evaluation" | null = null;
      for (let attempt = 1; attempt <= request.limits.attempts; attempt += 1) {
        throwIfAborted(signal);
        attempts = attempt;
        const currentRepair = repairContext;
        const messages = buildPolicyMessages(request.purpose, request.data_blocks, currentRepair);
        response = await provider.adapter.completeStructuredNoTools({
          system: messages.system,
          user: messages.user,
          schemaName: request.output_schema_id.replace(/[^a-zA-Z0-9_-]/g, "_"),
          schema: purposeJsonSchema(request.purpose),
          maxOutputTokens: request.limits.output_tokens,
          timeoutMs: Math.min(request.limits.duration_ms, Math.max(1, Date.parse(request.deadline_at) - this.now().getTime())),
          signal,
        });
        throwIfAborted(signal);
        if (response.finishReason === "length" && attempt < request.limits.attempts) {
          repairContext = { kind: "structural" };
          continue;
        }
        if (["length", "content_filter", "tool_calls"].includes(response.finishReason)) {
          throw new ResumeInferenceError("validation_failed", "Provider ended with an ambiguous or incomplete structured outcome");
        }
        if (Math.ceil(Buffer.byteLength(response.text, "utf8") / 4) > request.limits.output_tokens) {
          throw new ResumeInferenceError("validation_failed", "Provider output exceeded the accepted output budget");
        }
        try {
          if (response.text.trim().length === 0) throw new Error("empty structured result");
          structuralCandidate = JSON.parse(response.text);
          result = parsePurposeResult(request.purpose, request.output_schema_id, structuralCandidate);
          if (request.purpose === "resume_strategy") result = canonicalizeStrategyResultFromBlocks(result, request.data_blocks);
          result = normalizeHostOwnedResult(request.purpose, result, request.data_blocks);
          if (request.purpose === "resume_dialogue") {
            result = normalizeProposedDialogueDraftAction(result, request.data_blocks);
            const mediated = mediateDialogueDisposition(result, request.data_blocks);
            result = mediated.result;
            if (mediated.changed) repair = "deterministic_dialogue_disposition";
          }
          if (["tailoring_plan", "targeted_resume_draft", "resume_revision_draft"].includes(request.purpose)) repair = "host_owned_structure";
          validation = validateInferenceClaims(request.purpose, result, request.data_blocks);
          if (validation.accepted) {
            if (currentRepair?.kind === "validation" && repair === null) repair = "provider_validation_repair";
            break;
          }
          if (attempt < request.limits.attempts) {
            repairContext = {
              kind: "validation",
              priorResult: result,
              findings: validation.findings.map(({ code, statement_id, safe_message }) => ({ code, statement_id, safe_message })),
            };
          }
        } catch {
          if (request.purpose === "resume_dialogue") {
            const filtered = filterStructurallyInvalidDialogueResult(structuralCandidate, request.data_blocks);
            if (filtered !== null) {
              try {
                const parsed = parsePurposeResult(request.purpose, request.output_schema_id, filtered);
                const mediated = mediateDialogueDisposition(parsed, request.data_blocks);
                const mediatedResult = parsePurposeResult(request.purpose, request.output_schema_id, mediated.result);
                const mediatedValidation = validateInferenceClaims(request.purpose, mediatedResult, request.data_blocks);
                if (mediatedValidation.accepted) {
                  result = mediatedResult;
                  validation = mediatedValidation;
                  repair = "deterministic_dialogue_structure_filter";
                  break;
                }
              } catch {
                // An unreadable dialogue remains eligible for the one bounded provider repair.
              }
            }
          }
          if (attempt < request.limits.attempts) repairContext = { kind: "structural" };
        }
      }
      if (request.purpose === "resume_guidance" && (result === undefined || validation === null || !validation.accepted)) {
        result = deterministicGuidanceFallback(request.data_blocks);
        validation = validateInferenceClaims(request.purpose, result, request.data_blocks);
        repair = "deterministic_guidance_fallback";
      }
      if (request.purpose === "general_resume_draft" && (result === undefined || validation === null)) {
        const fallback = deterministicHostFallback(request.purpose, request.data_blocks);
        if (fallback !== null) {
          result = parsePurposeResult(request.purpose, request.output_schema_id, fallback);
          validation = validateInferenceClaims(request.purpose, result, request.data_blocks);
          repair = "deterministic_fact_fallback";
        }
      }
      if (request.purpose === "resume_strategy" && (result === undefined || validation === null || !validation.accepted)) {
        const fallback = deterministicHostFallback(request.purpose, request.data_blocks);
        if (fallback !== null) {
          result = parsePurposeResult(request.purpose, request.output_schema_id, fallback);
          validation = validateInferenceClaims(request.purpose, result, request.data_blocks);
          repair = "deterministic_strategy_fallback";
        }
      }
      if (request.purpose === "resume_dialogue" && (result === undefined || validation === null)) {
        const filtered = filterStructurallyInvalidDialogueResult(structuralCandidate, request.data_blocks);
        if (filtered !== null) {
          result = parsePurposeResult(request.purpose, request.output_schema_id, filtered);
          validation = validateInferenceClaims(request.purpose, result, request.data_blocks);
          repair = "deterministic_dialogue_structure_filter";
        }
      }
      if (response === null || result === undefined || validation === null) {
        throw new ResumeInferenceError("schema_validation_failed", "Provider output failed the accepted schema after one structural repair");
      }
      throwIfAborted(signal);
      if (!validation.accepted && request.purpose === "resume_dialogue") {
        const filtered = filterInvalidDialogueFactOperations(result, request.data_blocks);
        if (filtered !== null) {
          const filteredResult = parsePurposeResult(request.purpose, request.output_schema_id, filtered);
          const filteredValidation = validateInferenceClaims(request.purpose, filteredResult, request.data_blocks);
          if (filteredValidation.accepted) {
            result = filteredResult;
            validation = filteredValidation;
            repair = "deterministic_dialogue_filter";
          }
        }
      }
      if (!validation.accepted) {
        try {
          const repaired = repairResumeDraftFromConfirmedFacts(request.purpose, result, validation, request.data_blocks);
          if (repaired !== null) {
            const repairedResult = parsePurposeResult(request.purpose, request.output_schema_id, repaired);
            const repairedValidation = validateInferenceClaims(request.purpose, repairedResult, request.data_blocks);
            if (repairedValidation.accepted) {
              result = repairedResult;
              validation = repairedValidation;
              repair = "deterministic_fact_fallback";
            }
          }
        } catch {
          // The original deterministic rejection remains authoritative when the bounded fallback cannot produce a valid result.
        }
      }
      if (!validation.accepted && request.purpose === "general_resume_draft" && resultCitesOnlySnapshotFacts(result, request.data_blocks)) {
        const fallback = deterministicHostFallback(request.purpose, request.data_blocks);
        if (fallback !== null) {
          const fallbackResult = parsePurposeResult(request.purpose, request.output_schema_id, fallback);
          const fallbackValidation = validateInferenceClaims(request.purpose, fallbackResult, request.data_blocks);
          if (fallbackValidation.accepted) {
            result = fallbackResult;
            validation = fallbackValidation;
            repair = "deterministic_fact_fallback";
          }
        }
      }
      if (!validation.accepted) {
        const failure = this.failure(request, startedAt, inputDigest, provider, attempts, "failed", new ResumeInferenceError("validation_failed", "Generated output did not pass deterministic claim validation"));
        this.audit("app.inference.completed", this.auditFields(request, {
          status: failure.status,
          attempt: attempts,
          error_code: failure.error?.code,
          model_class: provider.modelClass,
          validator_findings: validation.findings.map(({ code, statement_id, safe_message }) => ({ code, statement_id, safe_message })),
        }));
        return { inference: failure, validation };
      }
      const completedAt = this.now().toISOString();
      const inference = InferenceResultSchema.parse({
        inference_schema_version: 1,
        request_id: request.request_id,
        operation_id: request.operation_id,
        purpose: request.purpose,
        status: "completed",
        prompt_policy_id: request.prompt_policy_id,
        prompt_policy_version: request.prompt_policy_version,
        output_schema_id: request.output_schema_id,
        output_schema_version: 1,
        input_digest: inputDigest,
        output_digest: canonicalInputDigest(result),
        result,
        provider_profile_id: provider.providerProfileId,
        model_id: provider.modelId,
        attempt_count: attempts,
        usage: usage(response),
        error: null,
        started_at: startedAt,
        completed_at: completedAt,
      });
      this.audit("app.inference.completed", this.auditFields(request, { status: "completed", attempt: attempts, model_class: provider.modelClass, usage_available: inference.usage.available, ...this.safeResultDiagnostics(request, result), ...(repair ? { repair } : {}) }));
      return { inference, validation };
    } catch (error) {
      const classified = classifyInferenceError(error, signal);
      if (request.purpose === "resume_guidance" && !["cancelled", "denied"].includes(classified.code)) {
        const result = deterministicGuidanceFallback(request.data_blocks);
        const validation = validateInferenceClaims(request.purpose, result, request.data_blocks);
        if (validation.accepted) {
          const completedAt = this.now().toISOString();
          const inference = InferenceResultSchema.parse({
            inference_schema_version: 1, request_id: request.request_id, operation_id: request.operation_id, purpose: request.purpose,
            status: "completed", prompt_policy_id: request.prompt_policy_id, prompt_policy_version: request.prompt_policy_version,
            output_schema_id: request.output_schema_id, output_schema_version: 1, input_digest: inputDigest,
            output_digest: canonicalInputDigest(result), result, provider_profile_id: null, model_id: null, attempt_count: attempts,
            usage: { available: false, input_tokens: null, output_tokens: null }, error: null, started_at: startedAt, completed_at: completedAt,
          });
          this.audit("app.inference.completed", this.auditFields(request, { status: "completed", attempt: attempts, repair: "deterministic_guidance_fallback", error_code: classified.code }));
          return { inference, validation };
        }
      }
      const status = classified.code === "cancelled" ? "cancelled" : classified.code === "deadline_exceeded" ? "deadline_exceeded" : classified.code === "model_incompatible" ? "rejected_incompatible" : "failed";
      const inference = this.failure(request, startedAt, inputDigest, provider, attempts, status, classified);
      this.audit("app.inference.completed", this.auditFields(request, { status, attempt: attempts, error_code: classified.code, ...(provider ? { model_class: provider.modelClass } : {}) }));
      return { inference, validation: null };
    }
  }

  private failure(request: InferenceRequest, startedAt: string, inputDigest: `sha256:${string}`, provider: ResolvedInferenceProvider | null, attempts: number, status: "failed" | "cancelled" | "deadline_exceeded" | "rejected_incompatible", error: ResumeInferenceError): InferenceResult {
    return InferenceResultSchema.parse({
      inference_schema_version: 1, request_id: request.request_id, operation_id: request.operation_id, purpose: request.purpose,
      status, prompt_policy_id: request.prompt_policy_id, prompt_policy_version: request.prompt_policy_version,
      output_schema_id: request.output_schema_id, output_schema_version: 1, input_digest: inputDigest,
      output_digest: null, result: null, provider_profile_id: provider?.providerProfileId ?? null, model_id: provider?.modelId ?? null,
      attempt_count: attempts, usage: { available: false, input_tokens: null, output_tokens: null },
      error: { code: error.code, safe_message: error.message, retryable: error.retryable }, started_at: startedAt, completed_at: this.now().toISOString(),
    });
  }

  private auditFields(request: InferenceRequest, extra: Record<string, unknown>): Record<string, unknown> {
    return {
      operation_id: request.operation_id,
      request_id: request.request_id,
      purpose: request.purpose,
      output_schema_id: request.output_schema_id,
      prompt_policy_id: request.prompt_policy_id,
      prompt_policy_version: request.prompt_policy_version,
      ...extra,
    };
  }

  private safeResultDiagnostics(request: InferenceRequest, result: unknown): Record<string, unknown> {
    if (request.purpose === "resume_strategy") {
      const strategy = result as { history_shape?: unknown; evidence_priorities?: Array<{ priority?: unknown }>; omissions?: Array<{ reason_code?: unknown }>; unresolved_gap_ids?: unknown[] };
      return {
        history_shape: strategy.history_shape ?? null,
        used_evidence_count: (strategy.evidence_priorities ?? []).filter((entry) => entry.priority === "must_use").length,
        omitted_evidence_count: strategy.omissions?.length ?? 0,
        omission_reason_categories: [...new Set((strategy.omissions ?? []).map((entry) => entry.reason_code).filter((reason): reason is string => typeof reason === "string"))].sort(),
        unresolved_gap_count: strategy.unresolved_gap_ids?.length ?? 0,
      };
    }
    if (request.purpose === "general_resume_draft") {
      const draft = result as { statements?: Array<{ supporting_confirmed_fact_revision_ids?: string[] }>; omissions?: Array<{ reason_code?: unknown }> };
      const strategy = request.data_blocks.find((block) => block.category === "resume_strategy")?.data as { evidence_priorities?: Array<{ fact_revision_id?: string; priority?: string }> } | undefined;
      const used = new Set((draft.statements ?? []).flatMap((statement) => statement.supporting_confirmed_fact_revision_ids ?? []));
      return {
        used_evidence_count: (strategy?.evidence_priorities ?? []).filter((entry) => entry.priority === "must_use" && typeof entry.fact_revision_id === "string" && used.has(entry.fact_revision_id)).length,
        omitted_evidence_count: draft.omissions?.length ?? 0,
        omission_reason_categories: [...new Set((draft.omissions ?? []).map((entry) => entry.reason_code).filter((reason): reason is string => typeof reason === "string"))].sort(),
      };
    }
    return {};
  }
}

function filterStructurallyInvalidDialogueResult(
  result: unknown,
  dataBlocks: InferenceRequest["data_blocks"],
): unknown | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const dialogue = result as Record<string, unknown>;
  const assistantMessage = typeof dialogue.assistant_message === "string" ? dialogue.assistant_message.trim() : "";
  if (assistantMessage.length === 0 || assistantMessage.length > 4_096) return null;
  const operations = Array.isArray(dialogue.fact_operations)
    ? dialogue.fact_operations.slice(0, 8).flatMap((operation) => {
      const parsed = ResumeDialogueFactOperationSchema.safeParse(operation);
      if (parsed.success) return [parsed.data];
      const rebound = rebindDialogueOperationToGroundedEmployment(operation, dataBlocks);
      return rebound === null ? [] : [rebound];
    })
    : [];
  const parsedDraftAction = ResumeDialogueDraftActionSchema.safeParse(dialogue.draft_action);
  const draftAction = parsedDraftAction.success ? parsedDraftAction.data : null;
  return {
    dialogue_version: 1,
    assistant_message: assistantMessage,
    turn_disposition: draftAction ? "offer_draft" : operations.length > 0 ? "capture_and_continue" : "respond_only",
    fact_operations: operations,
    suggested_action: draftAction ? "create_draft" : "none",
    draft_action: draftAction,
  };
}

function mediateDialogueDisposition(
  result: unknown,
  dataBlocks: InferenceRequest["data_blocks"],
): { result: unknown; changed: boolean } {
  if (!result || typeof result !== "object" || Array.isArray(result)) return { result, changed: false };
  const dialogue = result as {
    assistant_message?: unknown;
    fact_operations?: unknown;
    draft_action?: unknown;
  };
  const operations = Array.isArray(dialogue.fact_operations) ? dialogue.fact_operations : [];
  const normalizedDraftAction = normalizeDialogueDraftAction(dialogue.draft_action, dataBlocks);
  const provisionalMessage = safeDialogueAssistantMessage(
    typeof dialogue.assistant_message === "string" ? dialogue.assistant_message : "",
    dataBlocks,
    normalizedDraftAction !== null,
    0,
  );
  const acceptedModelOperations = operations.flatMap((operation) => {
    const validateOperation = (candidate: unknown) => validateInferenceClaims(
      "resume_dialogue",
      {
        ...dialogue,
        assistant_message: provisionalMessage,
        fact_operations: [candidate],
        draft_action: null,
        suggested_action: "none",
        turn_disposition: "capture_and_continue",
      },
      dataBlocks,
    ).accepted;
    if (validateOperation(operation)) return [operation];
    const rebound = rebindDialogueOperationToGroundedEmployment(operation, dataBlocks);
    return rebound !== null && validateOperation(rebound) ? [rebound] : [];
  });
  const groundedHostEvidence = acceptedModelOperations.some((operation) => {
    const candidate = operation as { fact_kind?: unknown; job_fact_revision_id?: unknown };
    return ["job_evidence", "accomplishment"].includes(String(candidate.fact_kind)) && typeof candidate.job_fact_revision_id === "string";
  })
    ? null
    : groundedOwnerEvidenceOperation(dataBlocks);
  const acceptedOperations = groundedHostEvidence === null
    ? acceptedModelOperations
    : [...acceptedModelOperations, groundedHostEvidence];
  const acceptedDraftAction = normalizedDraftAction !== null && validateInferenceClaims(
    "resume_dialogue",
    {
      ...dialogue,
      assistant_message: provisionalMessage,
      fact_operations: [],
      draft_action: normalizedDraftAction,
      suggested_action: "create_draft",
      turn_disposition: "offer_draft",
    },
    dataBlocks,
  ).accepted
    ? normalizedDraftAction
    : null;
  const assistantMessage = safeDialogueAssistantMessage(
    typeof dialogue.assistant_message === "string" ? dialogue.assistant_message : "",
    dataBlocks,
    acceptedDraftAction !== null,
    acceptedOperations.length,
  );
  const mediated = {
    ...dialogue,
    assistant_message: assistantMessage,
    fact_operations: acceptedOperations,
    draft_action: acceptedDraftAction,
    suggested_action: acceptedDraftAction ? "create_draft" : "none",
    turn_disposition: acceptedDraftAction
      ? "offer_draft"
      : acceptedOperations.length > 0
        ? "capture_and_continue"
        : "respond_only",
  };
  return {
    result: mediated,
    changed: canonicalInputDigest(mediated) !== canonicalInputDigest(result),
  };
}

function rebindDialogueOperationToGroundedEmployment(
  operation: unknown,
  dataBlocks: InferenceRequest["data_blocks"],
): unknown | null {
  const parsedOperation = ResumeDialogueFactOperationSchema.safeParse(operation);
  let candidate: Record<string, unknown>;
  if (parsedOperation.success) {
    if (!["job_evidence", "accomplishment"].includes(parsedOperation.data.fact_kind)) return null;
    candidate = parsedOperation.data;
  } else {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) return null;
    const raw = operation as Record<string, unknown>;
    if (raw.operation !== "capture" || !["job_evidence", "accomplishment"].includes(String(raw.fact_kind))) return null;
    if (typeof raw.source_quote !== "string" || typeof raw.text !== "string") return null;
    candidate = raw.fact_kind === "job_evidence"
      ? { operation: "capture", fact_kind: "job_evidence", source_quote: raw.source_quote, text: raw.text, job_fact_revision_id: raw.job_fact_revision_id, dimension: raw.dimension }
      : { operation: "capture", fact_kind: "accomplishment", source_quote: raw.source_quote, text: raw.text, job_fact_revision_id: raw.job_fact_revision_id };
  }
  const context = dataBlocks.find((block) => block.category === "dialogue_context")?.data as {
    current_user_message?: unknown;
  } | undefined;
  if (typeof context?.current_user_message !== "string") return null;
  const revisionId = groundedEmploymentRevisionId(context.current_user_message, dataBlocks);
  if (revisionId === null) return null;
  const rebound = ResumeDialogueFactOperationSchema.safeParse({ ...candidate, job_fact_revision_id: revisionId });
  return rebound.success ? rebound.data : null;
}

function groundedOwnerEvidenceOperation(dataBlocks: InferenceRequest["data_blocks"]): unknown | null {
  const context = dataBlocks.find((block) => block.category === "dialogue_context")?.data as {
    current_user_message?: unknown;
  } | undefined;
  if (typeof context?.current_user_message !== "string") return null;
  const ownerText = context.current_user_message.trim();
  const normalized = normalizeDialogueAssociationText(ownerText);
  const isQuestion = /^(?:do|does|did|should|would|could|can|what|which|who|why|how|when|where|is|are|am|was|were)\b/.test(normalized)
    && normalized.endsWith("?");
  const containsConcreteEvidence = /\b(?!(?:19|20)\d{2}\b)\d+(?:[.,]\d+)?\s*(?:%|percent|people|employees|members|reports|users|customers|clients|partners|million|billion|thousand|k|m|b)?\b/i.test(ownerText)
    || /\b(?:grew|increased|reduced|decreased|improved|expanded|generated|saved|delivered|launched|built|created|led|managed|hired|scaled|won|earned|recognized|awarded|partnered)\b/i.test(ownerText);
  if (isQuestion || !containsConcreteEvidence) return null;
  const revisionId = groundedEmploymentRevisionId(ownerText, dataBlocks);
  if (revisionId === null) return null;
  const operation = ResumeDialogueFactOperationSchema.safeParse({
    operation: "capture",
    fact_kind: "job_evidence",
    source_quote: ownerText,
    text: ownerText,
    job_fact_revision_id: revisionId,
    dimension: "outcomes",
  });
  if (!operation.success) return null;
  const validation = validateInferenceClaims("resume_dialogue", {
    dialogue_version: 1,
    assistant_message: "I heard that. What would you like to cover next about your experience?",
    turn_disposition: "capture_and_continue",
    fact_operations: [operation.data],
    suggested_action: "none",
    draft_action: null,
  }, dataBlocks);
  return validation.accepted ? operation.data : null;
}

function groundedEmploymentRevisionId(
  ownerText: string,
  dataBlocks: InferenceRequest["data_blocks"],
): string | null {
  const ownerMessage = normalizeDialogueAssociationText(ownerText);
  const snapshot = dataBlocks.find((block) => block.category === "confirmed_fact_snapshot")?.data as {
    facts?: Array<{ revision_id?: unknown; fact_kind?: unknown; value?: unknown }>;
  } | undefined;
  const candidates = (snapshot?.facts ?? []).flatMap((fact) => {
    if (fact.fact_kind !== "employment" || typeof fact.revision_id !== "string" || typeof fact.value !== "string") return [];
    try {
      const value = JSON.parse(fact.value) as { format?: unknown; title?: unknown; employer?: unknown };
      if (value.format !== "resume_job_v1" || typeof value.title !== "string" || typeof value.employer !== "string") return [];
      const title = normalizeDialogueAssociationText(value.title);
      const employer = normalizeDialogueAssociationText(value.employer);
      if ((!title || !ownerMessage.includes(title)) && (!employer || !ownerMessage.includes(employer))) return [];
      return [{ revisionId: fact.revision_id }];
    } catch {
      return [];
    }
  });
  return candidates.length === 1 ? candidates[0]!.revisionId : null;
}

function normalizeDialogueAssociationText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

function safeDialogueAssistantMessage(
  value: string,
  dataBlocks: InferenceRequest["data_blocks"],
  hasDraftAction: boolean,
  acceptedOperationCount: number,
): string {
  const segments = value.trim().match(/[^.!?]+[.!?]?/g) ?? [];
  const safeSegments = segments.filter((segment) => validateInferenceClaims(
    "resume_dialogue",
    {
      dialogue_version: 1,
      assistant_message: segment.trim(),
      turn_disposition: "respond_only",
      fact_operations: [],
      suggested_action: "none",
      draft_action: null,
    },
    dataBlocks,
  ).accepted);
  const safeMessage = safeSegments.map((segment) => segment.trim()).filter(Boolean).join(" ");
  if (safeMessage) return safeMessage;
  const context = dataBlocks.find((block) => block.category === "dialogue_context")?.data as {
    current_user_message?: string | null;
  } | undefined;
  if (context?.current_user_message === null || context?.current_user_message === undefined) {
    return "Welcome — I’ll help you build a resume through a real conversation. What kind of work would you like this resume to support?";
  }
  if (hasDraftAction) return "I understand that you want a draft. I can ask BrainDrive to start a fact-backed draft now.";
  if (acceptedOperationCount > 0) return "I heard that. What would you like me to understand next about your experience?";
  return "I’m with you. What would you like to cover next about your experience?";
}

function filterInvalidDialogueFactOperations(result: unknown, dataBlocks: InferenceRequest["data_blocks"]): unknown | null {
  const dialogue = result as {
    fact_operations?: unknown[];
    suggested_action?: string;
    turn_disposition?: string;
    draft_action?: unknown;
  };
  const operations = Array.isArray(dialogue.fact_operations) ? dialogue.fact_operations : [];
  const acceptedOperations = operations.filter((operation) => validateInferenceClaims(
    "resume_dialogue",
    { ...dialogue, fact_operations: [operation], draft_action: null, suggested_action: "none" },
    dataBlocks,
  ).accepted);
  const normalizedDraftAction = normalizeDialogueDraftAction(dialogue.draft_action, dataBlocks);
  const factOperationsChanged = acceptedOperations.length !== operations.length;
  const draftActionChanged = normalizedDraftAction !== null
    && canonicalInputDigest(normalizedDraftAction) !== canonicalInputDigest(dialogue.draft_action);
  if (!factOperationsChanged && !draftActionChanged) return null;
  return {
    ...dialogue,
    fact_operations: acceptedOperations,
    ...(draftActionChanged ? { draft_action: normalizedDraftAction } : {}),
    turn_disposition: acceptedOperations.length === 0 && dialogue.suggested_action !== "create_draft"
      ? "respond_only"
      : dialogue.turn_disposition,
  };
}

function normalizeProposedDialogueDraftAction(result: unknown, dataBlocks: InferenceRequest["data_blocks"]): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const dialogue = result as { draft_action?: unknown };
  const normalizedDraftAction = normalizeDialogueDraftAction(dialogue.draft_action, dataBlocks);
  return normalizedDraftAction === null ? result : { ...dialogue, draft_action: normalizedDraftAction };
}

function resultCitesOnlySnapshotFacts(result: unknown, dataBlocks: InferenceRequest["data_blocks"]): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const snapshot = dataBlocks.find((block) => block.category === "confirmed_fact_snapshot")?.data as { facts?: Array<{ revision_id?: unknown }> } | undefined;
  const allowed = new Set((snapshot?.facts ?? []).flatMap((fact) => typeof fact.revision_id === "string" ? [fact.revision_id] : []));
  const statements = (result as { statements?: unknown }).statements;
  if (!Array.isArray(statements)) return false;
  return statements.every((statement) => {
    if (!statement || typeof statement !== "object" || Array.isArray(statement)) return false;
    const support = (statement as { supporting_confirmed_fact_revision_ids?: unknown }).supporting_confirmed_fact_revision_ids;
    return Array.isArray(support) && support.every((revisionId) => typeof revisionId === "string" && allowed.has(revisionId));
  });
}

function normalizeDialogueDraftAction(
  value: unknown,
  dataBlocks: InferenceRequest["data_blocks"],
): { action: "create_general_draft"; intent: "explicit_request" | "accepted_offer"; source_quote: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const action = value as { action?: unknown; intent?: unknown; source_quote?: unknown };
  if (action.action !== "create_general_draft") return null;
  const context = dataBlocks.find((block) => block.category === "dialogue_context")?.data as {
    current_user_message?: unknown;
    messages?: Array<{ role?: unknown; content?: unknown }>;
  } | undefined;
  const ownerMessage = typeof context?.current_user_message === "string" ? context.current_user_message : "";
  const messages = context?.messages ?? [];
  let precedingAssistantMessage = "";
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && typeof message.content === "string") {
      precedingAssistantMessage = message.content;
      break;
    }
  }
  const explicitRequest = /\b(?:create|generate|write|start|make|show|build|put together)\b[^.!?]{0,100}\b(?:draft|resume)\b|\b(?:draft|resume)\b[^.!?]{0,100}\b(?:create|generate|write|start|make|show|build|put together)\b/i.test(ownerMessage);
  const acceptedOffer = /^(?:no[,\s]*(?:that(?:'s| is) (?:everything|all)|nothing else)|that(?:'s| is) (?:everything|all)|yes|go ahead|please do|sounds good|i(?:'m| am) ready)(?:\s+i think)?[.!]?$/i.test(ownerMessage.trim())
    && /\b(?:draft|resume|start|generate|put (?:it|one) together|anything else|anything more)\b/i.test(precedingAssistantMessage);
  if (!explicitRequest && !acceptedOffer) return null;
  return {
    action: "create_general_draft",
    intent: explicitRequest ? "explicit_request" : "accepted_offer",
    source_quote: ownerMessage,
  };
}

function operationInputDigest(request: InferenceRequest): `sha256:${string}` {
  return canonicalInputDigest({
    owner_id: request.owner_id,
    actor_id: request.actor_id,
    app_id: request.app_id,
    installation_id: request.installation_id,
    operation_id: request.operation_id,
    grant_id: request.grant_id,
    purpose: request.purpose,
    input_snapshot: request.input_snapshot,
    data_blocks: request.data_blocks,
    prompt_policy_id: request.prompt_policy_id,
    prompt_policy_version: request.prompt_policy_version,
    output_schema_id: request.output_schema_id,
    output_schema_version: request.output_schema_version,
    capability_requirements: request.capability_requirements,
    limits: request.limits,
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error("cancelled");
}

function usage(response: StructuredCompletionResponse): InferenceResult["usage"] {
  const input = response.usage?.promptTokens;
  const output = response.usage?.completionTokens;
  return input === undefined && output === undefined
    ? { available: false, input_tokens: null, output_tokens: null }
    : { available: true, input_tokens: input ?? null, output_tokens: output ?? null };
}
