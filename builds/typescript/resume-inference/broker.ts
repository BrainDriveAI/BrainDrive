import { canonicalInputDigest, encodedByteLength } from "../app-platform/contracts/common.js";
import { InferenceAttemptAuditDetailsSchema, InferenceSchemaIssueIdSchema, InferenceTerminalAuditDetailsSchema } from "../app-platform/contracts/audit.js";
import {
  type InferenceCompletionModeSchema,
  type InferenceFinishCategorySchema,
  type InferenceOutcomeMetadataSchema,
  InferenceRequestSchema,
  InferenceResultSchema,
  type InferencePurpose,
  type InferenceRecoveryClassSchema,
} from "../app-platform/contracts/inference.js";
import type { StructuredCompletionResponse } from "../adapters/base.js";
import { ZodError, type z } from "zod";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION, buildPolicyMessages, type ResumeRepairContext } from "./policy.js";
import { classifyInferenceError, ResumeInferenceError } from "./errors.js";
import { parseProviderPurposeResult, parsePurposeResult, purposeJsonSchema } from "./results.js";
import { validateInferenceClaims, type ResumeValidationRuleId, type ValidationReport } from "./validators.js";
import type { ResolvedInferenceProvider } from "./compatibility.js";
import { repairResumeDraftFromConfirmedFacts } from "./repair.js";
import { deterministicGuidanceFallback } from "./guidance.js";
import { canonicalizeStrategyResultFromBlocks } from "./strategy.js";
import { HostNormalizationSchemaError, deterministicHostFallback, normalizeHostOwnedResult } from "./host-assistance.js";
import {
  decideInferenceOutcome,
  normalizeFinishCategory,
  type InferenceFailureStage,
  type PolicyFailure,
} from "./failure-policy.js";

type InferenceRequest = z.infer<typeof InferenceRequestSchema>;
type InferenceResult = z.infer<typeof InferenceResultSchema>;
type InferenceOutcome = z.infer<typeof InferenceOutcomeMetadataSchema>;
type FinishCategory = z.infer<typeof InferenceFinishCategorySchema>;
type RecoveryClass = z.infer<typeof InferenceRecoveryClassSchema>;
type CompletionMode = z.infer<typeof InferenceCompletionModeSchema>;

export type BrokerCompletion = {
  inference: InferenceResult;
  validation: ValidationReport | null;
  recovery_diagnostics?: RecoveryDiagnostics;
};
export type InferenceProviderResolver = (purpose: InferencePurpose) => Promise<ResolvedInferenceProvider>;

type ActiveRequest = { digest: string; controller: AbortController; promise: Promise<BrokerCompletion> };
type LocalCandidateClass = "targeted_fact_repair" | "full_general_constructor";
type AttemptDurationClass = "under_1s" | "under_5s" | "under_30s" | "under_2m" | "over_2m" | "unavailable";
type StructuralFailureClass = "empty_output" | "invalid_json" | "purpose_schema_mismatch" | "host_normalization_mismatch";
type SchemaIssueId = z.infer<typeof InferenceSchemaIssueIdSchema>;
type LocalCandidateResult = {
  candidate_class: LocalCandidateClass;
  validator_codes: Array<ValidationReport["findings"][number]["code"]>;
  validator_rule_ids: ResumeValidationRuleId[];
  validation_disposition: "accepted" | "rejected" | "schema_rejected" | "unavailable";
};
export type RecoveryDiagnostics = {
  provider_validator_codes: Array<ValidationReport["findings"][number]["code"]>;
  provider_validator_rule_ids: ResumeValidationRuleId[];
  local_candidate_classes: LocalCandidateClass[];
  targeted_fact_repair_validator_codes: Array<ValidationReport["findings"][number]["code"]>;
  targeted_fact_repair_validator_rule_ids: ResumeValidationRuleId[];
  targeted_fact_repair_disposition: LocalCandidateResult["validation_disposition"];
  full_general_constructor_validator_codes?: Array<ValidationReport["findings"][number]["code"]>;
  full_general_constructor_validator_rule_ids?: ResumeValidationRuleId[];
  full_general_constructor_disposition?: LocalCandidateResult["validation_disposition"];
  original_failure_code: PolicyFailure["code"];
  recovery_disposition: "targeted_accepted" | "full_constructor_accepted" | "recovery_rejected";
};
type FallbackResult = {
  completion: { result: unknown; validation: ValidationReport } | null;
  diagnostics?: RecoveryDiagnostics;
};

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
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener("abort", forwardAbort, { once: true });
    const deadlineTimer = setTimeout(
      () => controller.abort(new Error("timeout")),
      Math.max(0, Date.parse(request.deadline_at) - this.now().getTime()),
    );
    deadlineTimer.unref?.();
    const promise = this.run(request, controller.signal).finally(() => {
      clearTimeout(deadlineTimer);
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
    if (request.prompt_policy_id !== RESUME_PROMPT_POLICY_ID || request.prompt_policy_version !== RESUME_PROMPT_POLICY_VERSION) {
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
    let stage: InferenceFailureStage = "provider_resolution";
    let finishCategory: FinishCategory = "missing";
    let recoveryClass: RecoveryClass = "none";
    let response: StructuredCompletionResponse | null = null;
    let validation: ValidationReport | null = null;
    let attemptStartedAtMs: number | null = null;
    const auditAttempt = (
      attempt: number,
      attemptStage: InferenceFailureStage,
      attemptFinishCategory: FinishCategory,
      attemptOutcome: "accepted" | "retry" | "fallback" | "failed",
      validatorRuleIds: ResumeValidationRuleId[] = [],
      structuralFailureClass?: StructuralFailureClass,
      schemaIssueIds: SchemaIssueId[] = [],
    ): void => this.auditAttempt(
      request,
      attempt,
      attemptStage,
      attemptFinishCategory,
      attemptOutcome,
      durationClass(attemptStartedAtMs === null ? null : this.now().getTime() - attemptStartedAtMs),
      validatorRuleIds,
      structuralFailureClass,
      schemaIssueIds,
    );
    this.audit("app.inference.started", this.auditFields(request, { status: "running", attempt: attempts }));
    try {
      throwIfStopped(request, signal, this.now());
      provider = await awaitWithAbort(this.resolveProvider(request.purpose), signal);
      throwIfStopped(request, signal, this.now());
      stage = "compatibility_preflight";
      if (!provider.adapter.completeStructuredNoTools) throw new ResumeInferenceError("model_incompatible", "Active provider lacks the no-tools structured adapter path");
      if (request.purpose === "resume_craft_evaluate") {
        const hostResult = deterministicHostFallback(request.purpose, request.data_blocks);
        if (hostResult === null) throw new ResumeInferenceError("internal_failure", "Host craft evaluation is unavailable", true);
        const result = parsePurposeResult(request.purpose, request.output_schema_id, hostResult);
        validation = validateInferenceClaims(request.purpose, result, request.data_blocks);
        if (!validation.accepted) throw new ResumeInferenceError("evidence_validation_failed", "Host craft evaluation did not pass deterministic validation");
        throwIfStopped(request, signal, this.now());
        return this.completeSuccess(
          request, startedAt, inputDigest, provider, 0, result, validation, null,
          { stage: "completed", finishCategory: "missing", recoveryClass: "host_owned_zero_call", completionMode: "host_owned" },
          "deterministic_craft_evaluation",
        );
      }
      let result: unknown;
      let repairContext: ResumeRepairContext | undefined;
      let repair: "provider_structural_repair" | "provider_validation_repair" | "deterministic_fact_fallback" | "deterministic_strategy_fallback" | "deterministic_guidance_fallback" | "host_owned_structure" | null = null;
      let fallbackFailure: PolicyFailure | null = null;
      for (let attempt = 1; attempt <= request.limits.attempts; attempt += 1) {
        throwIfStopped(request, signal, this.now());
        attempts = attempt;
        attemptStartedAtMs = this.now().getTime();
        const currentRepair = repairContext;
        const messages = buildPolicyMessages(request.purpose, request.data_blocks, currentRepair);
        stage = "provider_request";
        response = await awaitWithAbort(provider.adapter.completeStructuredNoTools({
          system: messages.system,
          user: messages.user,
          schemaName: request.output_schema_id.replace(/[^a-zA-Z0-9_-]/g, "_"),
          schema: purposeJsonSchema(request.purpose),
          maxOutputTokens: request.limits.output_tokens,
          timeoutMs: Math.min(request.limits.duration_ms, Math.max(1, Date.parse(request.deadline_at) - this.now().getTime())),
          signal,
        }), signal);
        throwIfStopped(request, signal, this.now());
        if (provider.expectedObservedModelId && response.modelId && provider.expectedObservedModelId !== response.modelId) {
          throw new ResumeInferenceError("model_incompatible", "The provider returned a different model identity than the accepted compatibility evidence");
        }
        finishCategory = normalizeFinishCategory(response.finishReason);
        stage = "finish_reason";
        const finishDecision = decideInferenceOutcome({
          event: "finish", purpose: request.purpose, attempt, maxAttempts: request.limits.attempts, finishCategory,
        });
        if (finishDecision.action === "retry") {
          auditAttempt(attempt, "finish_reason", finishCategory, "retry");
          repairContext = { kind: "structural" };
          recoveryClass = finishDecision.recoveryClass;
          repair = "provider_structural_repair";
          continue;
        }
        if (finishDecision.action === "fallback") {
          auditAttempt(attempt, "finish_reason", finishCategory, "fallback");
          fallbackFailure = finishDecision.failure;
          break;
        }
        if (finishDecision.action === "fail") {
          auditAttempt(attempt, "finish_reason", finishCategory, "failed");
          return this.failed(request, startedAt, inputDigest, provider, attempts, finishDecision.failure, validation, recoveryClass);
        }
        if (Math.ceil(Buffer.byteLength(response.text, "utf8") / 4) > request.limits.output_tokens) {
          const decision = decideInferenceOutcome({
            event: "incomplete_output", purpose: request.purpose, attempt, maxAttempts: request.limits.attempts, finishCategory,
          });
          if (decision.action === "retry") {
            auditAttempt(attempt, "finish_reason", finishCategory, "retry");
            repairContext = { kind: "structural" };
            recoveryClass = decision.recoveryClass;
            repair = "provider_structural_repair";
            continue;
          }
          if (decision.action === "fallback") {
            auditAttempt(attempt, "finish_reason", finishCategory, "fallback");
            fallbackFailure = decision.failure;
            break;
          }
          if (decision.action === "fail") {
            auditAttempt(attempt, "finish_reason", finishCategory, "failed");
            return this.failed(request, startedAt, inputDigest, provider, attempts, decision.failure, validation, recoveryClass);
          }
        }

        let structuralStage: "structured_parse" | "output_schema_validation" | null = null;
        let structuralFailureClass: StructuralFailureClass | null = null;
        let schemaIssueIds: SchemaIssueId[] = [];
        let parsedJson: unknown;
        if (response.text.trim().length === 0) {
          structuralStage = "structured_parse";
          structuralFailureClass = "empty_output";
        } else {
          try {
            parsedJson = JSON.parse(response.text);
          } catch {
            structuralStage = "structured_parse";
            structuralFailureClass = "invalid_json";
          }
        }
        if (structuralStage === null) {
          let parsedResult: unknown;
          try {
            parsedResult = parseProviderPurposeResult(request.purpose, request.output_schema_id, parsedJson);
          } catch (error) {
            structuralStage = "output_schema_validation";
            structuralFailureClass = "purpose_schema_mismatch";
            schemaIssueIds = classifySchemaIssueIds(error);
          }
          if (structuralStage === null) {
            try {
              if (request.purpose === "resume_strategy") parsedResult = canonicalizeStrategyResultFromBlocks(parsedResult, request.data_blocks);
              parsedResult = normalizeHostOwnedResult(request.purpose, parsedResult, request.data_blocks);
              result = parsePurposeResult(request.purpose, request.output_schema_id, parsedResult);
            } catch (error) {
              structuralStage = "output_schema_validation";
              structuralFailureClass = "host_normalization_mismatch";
              schemaIssueIds = error instanceof HostNormalizationSchemaError
                ? [...error.schemaIssueIds]
                : ["host_normalization_invalid"];
            }
          }
        }
        if (structuralStage !== null) {
          stage = structuralStage;
          const decision = decideInferenceOutcome({
            event: "structural_failure", purpose: request.purpose, attempt, maxAttempts: request.limits.attempts,
            stage: structuralStage, finishCategory,
          });
          if (decision.action === "retry") {
            auditAttempt(attempt, structuralStage, finishCategory, "retry", [], structuralFailureClass ?? undefined, schemaIssueIds);
            repairContext = { kind: "structural", ...(schemaIssueIds.length > 0 ? { schemaIssueIds } : {}) };
            recoveryClass = decision.recoveryClass;
            repair = "provider_structural_repair";
            continue;
          }
          if (decision.action === "fallback") {
            auditAttempt(attempt, structuralStage, finishCategory, "fallback", [], structuralFailureClass ?? undefined, schemaIssueIds);
            fallbackFailure = decision.failure;
            break;
          }
          if (decision.action === "fail") {
            auditAttempt(attempt, structuralStage, finishCategory, "failed", [], structuralFailureClass ?? undefined, schemaIssueIds);
            return this.failed(request, startedAt, inputDigest, provider, attempts, decision.failure, validation, recoveryClass);
          }
          throw new ResumeInferenceError("internal_failure", "Structural failure reached an invalid policy state", true);
        }

        stage = "deterministic_validation";
        validation = validateInferenceClaims(request.purpose, result, request.data_blocks);
        const validatorRuleIds = safeValidatorRuleIds(validation);
        if (validation.accepted) {
          auditAttempt(attempt, "deterministic_validation", finishCategory, "accepted");
          if (currentRepair?.kind === "structural") {
            recoveryClass = "provider_structural_repair";
            repair = "provider_structural_repair";
          } else if (currentRepair?.kind === "validation") {
            recoveryClass = "provider_validation_repair";
            repair = "provider_validation_repair";
          }
          break;
        }
        const validationDecision = decideInferenceOutcome({
          event: "validation_failure", purpose: request.purpose, attempt, maxAttempts: request.limits.attempts, finishCategory,
        });
        if (validationDecision.action === "retry") {
          auditAttempt(attempt, "deterministic_validation", finishCategory, "retry", validatorRuleIds);
          repairContext = {
            kind: "validation",
            priorResult: result,
            findings: validation.findings.map(({ code, rule_id, statement_id, safe_message }) => ({
              code,
              ...(rule_id ? { rule_id } : {}),
              statement_id,
              safe_message,
            })),
          };
          recoveryClass = validationDecision.recoveryClass;
          repair = "provider_validation_repair";
          continue;
        }
        if (validationDecision.action === "fallback") {
          auditAttempt(attempt, "deterministic_validation", finishCategory, "fallback", validatorRuleIds);
          fallbackFailure = validationDecision.failure;
          break;
        }
        if (validationDecision.action === "fail") {
          auditAttempt(attempt, "deterministic_validation", finishCategory, "failed", validatorRuleIds);
          return this.failed(request, startedAt, inputDigest, provider, attempts, validationDecision.failure, validation, recoveryClass);
        }
      }

      if (fallbackFailure) {
        const fallback = this.tryDeterministicFallback(request, result, validation, fallbackFailure.code);
        if (fallback.completion) {
          throwIfStopped(request, signal, this.now());
          const fallbackRepair = deterministicFallbackRepair(request.purpose);
          return this.completeSuccess(
            request, startedAt, inputDigest, provider, attempts, fallback.completion.result, fallback.completion.validation, response,
            { stage: "completed", finishCategory, recoveryClass: "deterministic_fallback", completionMode: "deterministic_fallback" },
            fallbackRepair,
            fallback.diagnostics,
          );
        }
        return this.failed(request, startedAt, inputDigest, provider, attempts, { ...fallbackFailure, stage: "recovery" }, validation, "deterministic_fallback", fallback.diagnostics);
      }

      if (result === undefined || validation === null || !validation.accepted || response === null) {
        return this.failed(request, startedAt, inputDigest, provider, attempts, {
          code: "internal_failure", safeMessage: "The structured operation ended without a validated result", retryable: true,
          stage: "internal", finishCategory,
        }, validation, recoveryClass);
      }
      throwIfStopped(request, signal, this.now());
      if (["tailoring_plan", "targeted_resume_draft", "resume_revision_draft"].includes(request.purpose) && repair === null) repair = "host_owned_structure";
      const completionMode: CompletionMode = recoveryClass === "provider_structural_repair" || recoveryClass === "provider_validation_repair"
        ? "provider_repair"
        : "primary";
      return this.completeSuccess(
        request, startedAt, inputDigest, provider, attempts, result, validation, response,
        { stage: "completed", finishCategory, recoveryClass, completionMode },
        repair,
      );
    } catch (error) {
      const classified = classifyInferenceError(error, signal);
      if (classified.code === "cancelled") stage = "cancellation";
      if (["model_incompatible", "provider_schema_unsupported"].includes(classified.code)) stage = "compatibility_preflight";
      const decision = decideInferenceOutcome({
        event: "operational_failure",
        purpose: request.purpose,
        attempt: attempts,
        maxAttempts: request.limits.attempts,
        stage: ["compatibility_preflight", "provider_resolution", "provider_request", "cancellation", "internal"].includes(stage)
          ? stage as "compatibility_preflight" | "provider_resolution" | "provider_request" | "cancellation" | "internal"
          : "internal",
        finishCategory,
        code: classified.code,
        safeMessage: classified.message,
        retryable: classified.retryable,
      });
      if (attempts > 0) {
        const attemptStage = ["compatibility_preflight", "provider_resolution", "provider_request", "cancellation", "internal"].includes(stage)
          ? stage
          : "internal";
        auditAttempt(attempts, attemptStage, finishCategory, decision.action === "fallback" ? "fallback" : "failed");
      }
      if (decision.action === "fallback") {
        if (signal.aborted) return this.failed(request, startedAt, inputDigest, provider, attempts, decision.failure, validation, recoveryClass);
        const fallback = this.tryDeterministicFallback(request, undefined, null, decision.failure.code);
        if (fallback.completion) {
          const fallbackRepair = deterministicFallbackRepair(request.purpose);
          return this.completeSuccess(
            request, startedAt, inputDigest, provider, attempts, fallback.completion.result, fallback.completion.validation, response,
            { stage: "completed", finishCategory, recoveryClass: "deterministic_fallback", completionMode: "deterministic_fallback" },
            fallbackRepair,
            fallback.diagnostics,
          );
        }
        return this.failed(request, startedAt, inputDigest, provider, attempts, { ...decision.failure, stage: "recovery" }, null, "deterministic_fallback", fallback.diagnostics);
      }
      const failure = decision.action === "fail"
        ? decision.failure
        : { code: "internal_failure" as const, safeMessage: "Inference policy returned an invalid operational decision", retryable: true, stage: "internal" as const, finishCategory };
      return this.failed(request, startedAt, inputDigest, provider, attempts, failure, validation, recoveryClass);
    }
  }

  private tryDeterministicFallback(
    request: InferenceRequest,
    priorResult: unknown,
    priorValidation: ValidationReport | null,
    failureCode: PolicyFailure["code"],
  ): FallbackResult {
    if (request.purpose === "general_resume_draft" && failureCode === "evidence_validation_failed" && priorResult !== undefined && priorValidation !== null) {
      const localCandidateResults: LocalCandidateResult[] = [];
      const targeted = repairResumeDraftFromConfirmedFacts(request.purpose, priorResult, priorValidation, request.data_blocks);
      const targetedEvaluation = this.evaluateLocalCandidate(request, "targeted_fact_repair", targeted);
      localCandidateResults.push(targetedEvaluation.evidence);
      if (targetedEvaluation.completion) {
        return {
          completion: targetedEvaluation.completion,
          diagnostics: recoveryDiagnostics(priorValidation, localCandidateResults, failureCode, "targeted_accepted"),
        };
      }
      const full = deterministicHostFallback(request.purpose, request.data_blocks);
      const fullEvaluation = this.evaluateLocalCandidate(request, "full_general_constructor", full);
      localCandidateResults.push(fullEvaluation.evidence);
      return {
        completion: fullEvaluation.completion,
        diagnostics: recoveryDiagnostics(
          priorValidation,
          localCandidateResults,
          failureCode,
          fullEvaluation.completion ? "full_constructor_accepted" : "recovery_rejected",
        ),
      };
    }
    let fallback: unknown | null = null;
    if (request.purpose === "resume_guidance") fallback = deterministicGuidanceFallback(request.data_blocks);
    else if (["interview_assist", "general_resume_draft", "resume_strategy"].includes(request.purpose)) {
      fallback = deterministicHostFallback(request.purpose, request.data_blocks);
    }
    return { completion: this.evaluateFallbackCandidate(request, fallback) };
  }

  private evaluateLocalCandidate(
    request: InferenceRequest,
    candidateClass: LocalCandidateClass,
    candidate: unknown | null,
  ): { completion: { result: unknown; validation: ValidationReport } | null; evidence: LocalCandidateResult } {
    if (candidate === null) {
      return { completion: null, evidence: { candidate_class: candidateClass, validator_codes: [], validator_rule_ids: [], validation_disposition: "unavailable" } };
    }
    try {
      let result = parsePurposeResult(request.purpose, request.output_schema_id, candidate);
      result = normalizeHostOwnedResult(request.purpose, result, request.data_blocks);
      result = parsePurposeResult(request.purpose, request.output_schema_id, result);
      const validation = validateInferenceClaims(request.purpose, result, request.data_blocks);
      const validatorCodes = safeValidatorCodes(validation);
      const validatorRuleIds = safeValidatorRuleIds(validation);
      return validation.accepted
        ? { completion: { result, validation }, evidence: { candidate_class: candidateClass, validator_codes: validatorCodes, validator_rule_ids: validatorRuleIds, validation_disposition: "accepted" } }
        : { completion: null, evidence: { candidate_class: candidateClass, validator_codes: validatorCodes, validator_rule_ids: validatorRuleIds, validation_disposition: "rejected" } };
    } catch {
      return { completion: null, evidence: { candidate_class: candidateClass, validator_codes: ["schema_invalid"], validator_rule_ids: ["candidate_schema_parse_failed"], validation_disposition: "schema_rejected" } };
    }
  }

  private evaluateFallbackCandidate(
    request: InferenceRequest,
    fallback: unknown | null,
  ): { result: unknown; validation: ValidationReport } | null {
    if (fallback === null) return null;
    try {
      let result = parsePurposeResult(request.purpose, request.output_schema_id, fallback);
      if (request.purpose === "resume_strategy") result = canonicalizeStrategyResultFromBlocks(result, request.data_blocks);
      result = normalizeHostOwnedResult(request.purpose, result, request.data_blocks);
      result = parsePurposeResult(request.purpose, request.output_schema_id, result);
      const validation = validateInferenceClaims(request.purpose, result, request.data_blocks);
      return validation.accepted ? { result, validation } : null;
    } catch {
      return null;
    }
  }

  private completeSuccess(
    request: InferenceRequest,
    startedAt: string,
    inputDigest: `sha256:${string}`,
    provider: ResolvedInferenceProvider | null,
    attempts: number,
    result: unknown,
    validation: ValidationReport,
    response: StructuredCompletionResponse | null,
    outcome: { stage: "completed"; finishCategory: FinishCategory; recoveryClass: RecoveryClass; completionMode: CompletionMode },
    repair: string | null,
    recoveryDiagnostics?: RecoveryDiagnostics,
  ): BrokerCompletion {
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
      provider_profile_id: provider?.providerProfileId ?? null,
      model_id: provider?.modelId ?? null,
      attempt_count: attempts,
      usage: response ? usage(response) : { available: false, input_tokens: null, output_tokens: null },
      error: null,
      outcome: outcomeMetadata(attempts, false, outcome.stage, outcome.finishCategory, outcome.recoveryClass, outcome.completionMode, "completed"),
      started_at: startedAt,
      completed_at: this.now().toISOString(),
    });
    this.audit("app.inference.completed", this.terminalAuditFields(
      request,
      inference,
      validation,
      provider?.modelClass ?? null,
      { ...this.safeResultDiagnostics(request, result), ...(repair ? { repair } : {}), ...recoveryDiagnostics },
    ));
    return { inference, validation, ...(recoveryDiagnostics ? { recovery_diagnostics: recoveryDiagnostics } : {}) };
  }

  private failed(
    request: InferenceRequest,
    startedAt: string,
    inputDigest: `sha256:${string}`,
    provider: ResolvedInferenceProvider | null,
    attempts: number,
    policyFailure: PolicyFailure,
    validation: ValidationReport | null,
    recoveryClass: RecoveryClass,
    recoveryDiagnostics?: RecoveryDiagnostics,
  ): BrokerCompletion {
    const error = new ResumeInferenceError(policyFailure.code, policyFailure.safeMessage, policyFailure.retryable);
    const status = error.code === "cancelled"
      ? "cancelled"
      : error.code === "deadline_exceeded"
        ? "deadline_exceeded"
        : ["model_incompatible", "provider_schema_unsupported"].includes(error.code)
          ? "rejected_incompatible"
          : "failed";
    const inference = this.failure(
      request, startedAt, inputDigest, provider, attempts, status, error,
      outcomeMetadata(
        attempts, error.retryable, policyFailure.stage, policyFailure.finishCategory, recoveryClass, "none",
        status === "cancelled" ? "cancelled" : "failed",
      ),
    );
    this.audit("app.inference.completed", this.terminalAuditFields(
      request,
      inference,
      validation,
      provider?.modelClass ?? null,
      recoveryDiagnostics,
    ));
    return { inference, validation, ...(recoveryDiagnostics ? { recovery_diagnostics: recoveryDiagnostics } : {}) };
  }

  private failure(request: InferenceRequest, startedAt: string, inputDigest: `sha256:${string}`, provider: ResolvedInferenceProvider | null, attempts: number, status: "failed" | "cancelled" | "deadline_exceeded" | "rejected_incompatible", error: ResumeInferenceError, outcome: InferenceOutcome): InferenceResult {
    return InferenceResultSchema.parse({
      inference_schema_version: 1, request_id: request.request_id, operation_id: request.operation_id, purpose: request.purpose,
      status, prompt_policy_id: request.prompt_policy_id, prompt_policy_version: request.prompt_policy_version,
      output_schema_id: request.output_schema_id, output_schema_version: 1, input_digest: inputDigest,
      output_digest: null, result: null, provider_profile_id: provider?.providerProfileId ?? null, model_id: provider?.modelId ?? null,
      attempt_count: attempts, usage: { available: false, input_tokens: null, output_tokens: null },
      error: { code: error.code, safe_message: error.message, retryable: error.retryable }, outcome,
      started_at: startedAt, completed_at: this.now().toISOString(),
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

  private terminalAuditFields(
    request: InferenceRequest,
    inference: InferenceResult,
    validation: ValidationReport | null,
    modelClass: "owner_active_compatible" | null,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const outcome = inference.outcome;
    if (!outcome) throw new ResumeInferenceError("internal_failure", "Inference terminal outcome metadata is unavailable");
    const elapsed = inference.completed_at === null
      ? null
      : Math.max(0, Date.parse(inference.completed_at) - Date.parse(inference.started_at));
    return InferenceTerminalAuditDetailsSchema.parse({
      diagnostic_version: 1,
      app_id: request.app_id,
      operation_id: request.operation_id,
      request_id: request.request_id,
      purpose: request.purpose,
      prompt_policy_id: request.prompt_policy_id,
      prompt_policy_version: request.prompt_policy_version,
      output_schema_id: request.output_schema_id,
      output_schema_version: request.output_schema_version,
      model_class: modelClass,
      attempt_count: inference.attempt_count,
      stage: outcome.stage,
      finish_category: outcome.finish_category,
      error_code: inference.error?.code ?? null,
      retryable: outcome.retryable,
      recovery_class: outcome.recovery_class,
      completion_mode: outcome.completion_mode,
      final_disposition: outcome.final_disposition,
      usage_available: inference.usage.available,
      duration_class: durationClass(elapsed),
      validator_codes: [...new Set((validation?.findings ?? []).map((finding) => finding.code))].sort(),
      ...extra,
    });
  }

  private auditAttempt(
    request: InferenceRequest,
    attempt: number,
    stage: InferenceFailureStage,
    finishCategory: FinishCategory,
    attemptOutcome: "accepted" | "retry" | "fallback" | "failed",
    attemptDurationClass: AttemptDurationClass,
    validatorRuleIds: ResumeValidationRuleId[] = [],
    structuralFailureClass?: StructuralFailureClass,
    schemaIssueIds: SchemaIssueId[] = [],
  ): void {
    this.audit("app.inference.attempt", InferenceAttemptAuditDetailsSchema.parse({
      diagnostic_version: 1,
      app_id: request.app_id,
      operation_id: request.operation_id,
      request_id: request.request_id,
      purpose: request.purpose,
      attempt,
      stage,
      finish_category: finishCategory,
      attempt_outcome: attemptOutcome,
      duration_class: attemptDurationClass,
      ...(structuralFailureClass ? { structural_failure_class: structuralFailureClass } : {}),
      ...(schemaIssueIds.length > 0 ? { schema_issue_ids: schemaIssueIds } : {}),
      ...(validatorRuleIds.length > 0 ? { validator_rule_ids: validatorRuleIds } : {}),
    }));
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

function safeValidatorCodes(validation: ValidationReport): Array<ValidationReport["findings"][number]["code"]> {
  return [...new Set(validation.findings.map((finding) => finding.code))].sort();
}

function safeValidatorRuleIds(validation: ValidationReport): ResumeValidationRuleId[] {
  return [...new Set(validation.findings.flatMap((finding) => finding.rule_id ? [finding.rule_id] : []))].sort();
}

function classifySchemaIssueIds(error: unknown): SchemaIssueId[] {
  if (!(error instanceof ZodError)) return ["other_schema_issue"];
  const ids: SchemaIssueId[] = [];
  const add = (id: SchemaIssueId) => { if (!ids.includes(id)) ids.push(id); };
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") add("unknown_field");
    const root = issue.path[0];
    if (root === "title") add("title_invalid");
    else if (root === "statements") add(issue.path.length > 1 ? "statement_invalid" : "statements_invalid");
    else if (root === "section_order") add("section_order_invalid");
    else if (root === "omissions") add("omissions_invalid");
    else if (root === "experience_roles") {
      if (issue.path.includes("bullet_statements")) {
        add(issue.code === "too_big" ? "experience_role_bullet_limit_exceeded" : "experience_role_bullet_statement_invalid");
      } else if (issue.path.includes("heading_statement")) add("experience_role_heading_invalid");
      else if (issue.path.includes("job_fact_revision_id")) add("experience_role_job_id_invalid");
      else add("experience_roles_invalid");
    }
    else if (issue.code !== "unrecognized_keys") add("other_schema_issue");
  }
  return ids.length > 0 ? ids : ["other_schema_issue"];
}

function recoveryDiagnostics(
  providerValidation: ValidationReport,
  localCandidateResults: LocalCandidateResult[],
  originalFailureCode: PolicyFailure["code"],
  recoveryDisposition: RecoveryDiagnostics["recovery_disposition"],
): RecoveryDiagnostics {
  const targeted = localCandidateResults.find((candidate) => candidate.candidate_class === "targeted_fact_repair");
  if (!targeted) throw new ResumeInferenceError("internal_failure", "Targeted General recovery evidence is unavailable");
  const full = localCandidateResults.find((candidate) => candidate.candidate_class === "full_general_constructor");
  return {
    provider_validator_codes: safeValidatorCodes(providerValidation),
    provider_validator_rule_ids: safeValidatorRuleIds(providerValidation),
    local_candidate_classes: localCandidateResults.map((candidate) => candidate.candidate_class),
    targeted_fact_repair_validator_codes: targeted.validator_codes,
    targeted_fact_repair_validator_rule_ids: targeted.validator_rule_ids,
    targeted_fact_repair_disposition: targeted.validation_disposition,
    ...(full ? {
      full_general_constructor_validator_codes: full.validator_codes,
      full_general_constructor_validator_rule_ids: full.validator_rule_ids,
      full_general_constructor_disposition: full.validation_disposition,
    } : {}),
    original_failure_code: originalFailureCode,
    recovery_disposition: recoveryDisposition,
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

function throwIfStopped(request: InferenceRequest, signal: AbortSignal, now: Date): void {
  if (signal.aborted) throw signal.reason ?? new Error("cancelled");
  if (Date.parse(request.deadline_at) <= now.getTime()) {
    throw new ResumeInferenceError("deadline_exceeded", "The model request exceeded its deadline");
  }
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("cancelled"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function outcomeMetadata(
  attemptCount: number,
  retryable: boolean,
  stage: InferenceFailureStage,
  finishCategory: FinishCategory,
  recoveryClass: RecoveryClass,
  completionMode: CompletionMode,
  finalDisposition: InferenceOutcome["final_disposition"],
): InferenceOutcome {
  return {
    stage,
    finish_category: finishCategory,
    attempt_count: attemptCount,
    retryable,
    recovery_class: recoveryClass,
    completion_mode: completionMode,
    final_disposition: finalDisposition,
  };
}

function usage(response: StructuredCompletionResponse): InferenceResult["usage"] {
  const input = response.usage?.promptTokens;
  const output = response.usage?.completionTokens;
  return input === undefined && output === undefined
    ? { available: false, input_tokens: null, output_tokens: null }
    : { available: true, input_tokens: input ?? null, output_tokens: output ?? null };
}

function durationClass(elapsedMs: number | null): "under_1s" | "under_5s" | "under_30s" | "under_2m" | "over_2m" | "unavailable" {
  if (elapsedMs === null || !Number.isFinite(elapsedMs)) return "unavailable";
  if (elapsedMs < 1_000) return "under_1s";
  if (elapsedMs < 5_000) return "under_5s";
  if (elapsedMs < 30_000) return "under_30s";
  if (elapsedMs < 120_000) return "under_2m";
  return "over_2m";
}

function deterministicFallbackRepair(purpose: InferencePurpose): string {
  if (purpose === "interview_assist") return "deterministic_interview_presentation";
  if (purpose === "resume_guidance") return "deterministic_guidance_fallback";
  if (purpose === "resume_strategy") return "deterministic_strategy_fallback";
  return "deterministic_fact_fallback";
}
