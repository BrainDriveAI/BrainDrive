import { canonicalInputDigest, encodedByteLength } from "../app-platform/contracts/common.js";
import {
  InferenceRequestSchema,
  InferenceResultSchema,
  type InferencePurpose,
} from "../app-platform/contracts/inference.js";
import type { StructuredCompletionResponse } from "../adapters/base.js";
import type { z } from "zod";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION, buildPolicyMessages } from "./policy.js";
import { classifyInferenceError, ResumeInferenceError } from "./errors.js";
import { parsePurposeResult, purposeJsonSchema } from "./results.js";
import { validateInferenceClaims, type ValidationReport } from "./validators.js";
import type { ResolvedInferenceProvider } from "./compatibility.js";

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
    const digest = canonicalInputDigest(request);
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
    for (const block of request.data_blocks.filter((candidate) => ["general_resume_definition", "job_description"].includes(candidate.category))) {
      const id = (block.data as { metadata?: { revision_id?: unknown } } | null)?.metadata?.revision_id;
      if (typeof id !== "string" || !revisionIds.includes(id)) throw new ResumeInferenceError("invalid_request", "Record data block identity is absent from the immutable revision set");
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
      provider = await this.resolveProvider(request.purpose);
      if (!provider.adapter.completeStructuredNoTools) throw new ResumeInferenceError("model_incompatible", "Active provider lacks the no-tools structured adapter path");
      let result: unknown;
      let response: StructuredCompletionResponse | null = null;
      let lastSchemaError: unknown;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        attempts = attempt;
        const messages = buildPolicyMessages(request.purpose, request.data_blocks, attempt === 2);
        response = await provider.adapter.completeStructuredNoTools({
          system: messages.system,
          user: messages.user,
          schemaName: request.output_schema_id.replace(/[^a-zA-Z0-9_-]/g, "_"),
          schema: purposeJsonSchema(request.purpose),
          maxOutputTokens: request.limits.output_tokens,
          timeoutMs: Math.min(request.limits.duration_ms, Math.max(1, Date.parse(request.deadline_at) - this.now().getTime())),
          signal,
        });
        if (["length", "content_filter", "tool_calls"].includes(response.finishReason)) {
          throw new ResumeInferenceError("validation_failed", "Provider ended with an ambiguous or incomplete structured outcome");
        }
        if (Math.ceil(Buffer.byteLength(response.text, "utf8") / 4) > request.limits.output_tokens) {
          throw new ResumeInferenceError("validation_failed", "Provider output exceeded the accepted output budget");
        }
        try {
          if (response.text.trim().length === 0) throw new Error("empty structured result");
          result = parsePurposeResult(request.purpose, request.output_schema_id, JSON.parse(response.text));
          lastSchemaError = undefined;
          break;
        } catch (error) {
          lastSchemaError = error;
          if (attempt === 2) break;
        }
      }
      if (lastSchemaError !== undefined || response === null || result === undefined) {
        throw new ResumeInferenceError("schema_validation_failed", "Provider output failed the accepted schema after one structural repair");
      }
      const validation = validateInferenceClaims(request.purpose, result, request.data_blocks);
      if (!validation.accepted) {
        const failure = this.failure(request, startedAt, inputDigest, provider, attempts, "failed", new ResumeInferenceError("validation_failed", "Generated output did not pass deterministic claim validation"));
        this.audit("app.inference.completed", this.auditFields(request, { status: failure.status, attempt: attempts, error_code: failure.error?.code, model_class: provider.modelClass }));
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
      this.audit("app.inference.completed", this.auditFields(request, { status: "completed", attempt: attempts, model_class: provider.modelClass, usage_available: inference.usage.available }));
      return { inference, validation };
    } catch (error) {
      const classified = classifyInferenceError(error, signal);
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
}

function usage(response: StructuredCompletionResponse): InferenceResult["usage"] {
  const input = response.usage?.promptTokens;
  const output = response.usage?.completionTokens;
  return input === undefined && output === undefined
    ? { available: false, input_tokens: null, output_tokens: null }
    : { available: true, input_tokens: input ?? null, output_tokens: output ?? null };
}
