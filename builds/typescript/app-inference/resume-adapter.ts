import { z } from "zod";

import { AppInferenceEventSchema, AppInferenceRequestSchema, AppCapabilityAuthoritySchema } from "../app-platform/contracts/spec-05-foundation.js";
import {
  InferenceErrorCodeSchema,
  InferenceOutcomeMetadataSchema,
  InferencePurposeSchema,
  type InferenceRequestSchema,
} from "../app-platform/contracts/inference.js";
import { NonEmptyStringSchema, OpaqueIdSchema, Sha256DigestSchema } from "../app-platform/contracts/common.js";
import { ResumeValidationRuleIdSchema } from "../app-platform/contracts/data.js";
import { ResumeInferenceRetryAuditDetailsSchema, assertContentFreeResumeInferenceRetryAudit, refineInferenceRecoveryDiagnostics } from "../app-platform/contracts/audit.js";
import type { CapabilityGrant } from "../app-platform/lifecycle/store.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import { CapabilityOperationCoordinator } from "../app-capabilities/operations.js";
import type { ResumeInferenceBroker } from "../resume-inference/broker.js";
import { InferenceInvocationSchema, type ImmutableInferenceSnapshotBuilder } from "../resume-inference/snapshot.js";
import { purposeJsonSchema } from "../resume-inference/results.js";

type InternalRequest = z.infer<typeof InferenceRequestSchema>;
type Authority = z.infer<typeof AppCapabilityAuthoritySchema>;
type Invocation = z.infer<typeof InferenceInvocationSchema>;
type Completion = Awaited<ReturnType<ResumeInferenceBroker["execute"]>>;
type ObservedEvidenceFailure = {
  operation_id: string;
  semantic_input_digest: string;
  strategy_revision_id: string;
  provider_profile_id: string;
  model_id: string;
};

type SnapshotBuilder = Pick<ImmutableInferenceSnapshotBuilder, "build">;
type Broker = Pick<ResumeInferenceBroker, "execute" | "cancel">;
type PersistResult = <T>(idempotencyKey: string, input: unknown, action: () => Promise<T>) => Promise<T>;

const ValidatorCodeSchema = z.enum([
  "unsupported_claim",
  "partial_support_overstated",
  "missing_provenance",
  "protected_field_changed",
  "schema_invalid",
  "lineage_invalid",
  "parse_back_mismatch",
]);
const LocalCandidateDispositionSchema = z.enum(["accepted", "rejected", "schema_rejected", "unavailable"]);

/** Strict content-minimized projection safe for the sandbox and support references. */
export const ResumeInferenceDiagnosticSchema = z.object({
  diagnostic_version: z.literal(1),
  operation_id: OpaqueIdSchema,
  purpose: InferencePurposeSchema,
  prompt_policy_id: z.string().min(1).max(128),
  prompt_policy_version: z.string().min(1).max(64),
  output_schema_id: z.string().min(1).max(128),
  output_schema_version: z.number().int().positive(),
  model_class: z.enum(["owner_active_compatible"]).nullable(),
  attempt_count: z.number().int().min(0).max(2),
  stage: InferenceOutcomeMetadataSchema.shape.stage.nullable(),
  finish_category: InferenceOutcomeMetadataSchema.shape.finish_category.nullable(),
  recovery_class: InferenceOutcomeMetadataSchema.shape.recovery_class.nullable(),
  completion_mode: InferenceOutcomeMetadataSchema.shape.completion_mode.nullable(),
  final_disposition: InferenceOutcomeMetadataSchema.shape.final_disposition.nullable(),
  retryable: z.boolean(),
  usage_available: z.boolean(),
  validator_codes: z.array(ValidatorCodeSchema).max(7),
  provider_validator_codes: z.array(ValidatorCodeSchema).max(7).optional(),
  provider_validator_rule_ids: z.array(ResumeValidationRuleIdSchema).min(1).max(20).optional(),
  local_candidate_classes: z.array(z.enum(["targeted_fact_repair", "full_general_constructor"])).min(1).max(2).optional(),
  targeted_fact_repair_validator_codes: z.array(ValidatorCodeSchema).max(7).optional(),
  targeted_fact_repair_validator_rule_ids: z.array(ResumeValidationRuleIdSchema).max(20).optional(),
  targeted_fact_repair_disposition: LocalCandidateDispositionSchema.optional(),
  full_general_constructor_validator_codes: z.array(ValidatorCodeSchema).max(7).optional(),
  full_general_constructor_validator_rule_ids: z.array(ResumeValidationRuleIdSchema).max(20).optional(),
  full_general_constructor_disposition: LocalCandidateDispositionSchema.optional(),
  original_failure_code: InferenceErrorCodeSchema.optional(),
  recovery_disposition: z.enum(["targeted_accepted", "full_constructor_accepted", "recovery_rejected"]).optional(),
}).strict().superRefine(refineInferenceRecoveryDiagnostics);

const EvidenceFailureActionSchema = z.union([
  z.object({ id: z.literal("try_again"), label: z.literal("Try again") }).strict(),
  z.object({ id: z.literal("review_confirmed_evidence"), label: z.literal("Review confirmed evidence") }).strict(),
  z.object({ id: z.literal("not_now"), label: z.literal("Not now") }).strict(),
]);

export const EvidenceFailureRecoveryContractSchema = z.object({
  recovery_contract_version: z.literal(1),
  kind: z.literal("evidence_failure"),
  actions: z.tuple([
    EvidenceFailureActionSchema.refine((value) => value.id === "try_again"),
    EvidenceFailureActionSchema.refine((value) => value.id === "review_confirmed_evidence"),
    EvidenceFailureActionSchema.refine((value) => value.id === "not_now"),
  ]),
  retry_disclosure: z.literal("Try again uses your currently selected provider and may consume credits."),
  semantic_input_digest: Sha256DigestSchema,
  strategy_revision_id: OpaqueIdSchema,
  provider_profile_id: NonEmptyStringSchema,
  model_id: NonEmptyStringSchema,
  repeated_equivalent_failure: z.boolean(),
  emphasized_action: z.enum(["try_again", "review_confirmed_evidence"]),
}).strict().superRefine((value, context) => {
  const expected = value.repeated_equivalent_failure ? "review_confirmed_evidence" : "try_again";
  if (value.emphasized_action !== expected) {
    context.addIssue({ code: "custom", path: ["emphasized_action"], message: "evidence action emphasis must match repeat equivalence" });
  }
});

export const ResumeInferenceRetryLineageProjectionSchema = z.object({
  retry_lineage_version: z.literal(1),
  reason: z.literal("owner_initiated_retry"),
  prior_operation_id: OpaqueIdSchema,
  operation_id: OpaqueIdSchema,
  semantic_input_digest: Sha256DigestSchema,
  strategy_revision_id: OpaqueIdSchema,
  provider_profile_id: NonEmptyStringSchema,
  model_id: NonEmptyStringSchema,
  equivalent: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.prior_operation_id === value.operation_id) {
    context.addIssue({ code: "custom", path: ["operation_id"], message: "owner retry operation must be fresh" });
  }
});

export type ResumeInferenceRecoveryAction = "open_model_settings" | "review_provider_account" | "retry" | "evidence_failure" | "continue" | "none";

export type AppInferenceExecutionContext = {
  authority: Authority;
  grant: CapabilityGrant;
  operationId: string;
  idempotencyKey: string;
  deadlineAt: number;
  isCancelled?: () => boolean;
};

export function buildProtectedInferenceRequest(rawInvocation: unknown, request: InternalRequest, authority: Authority) {
  const invocation = InferenceInvocationSchema.parse(rawInvocation);
  const { concurrency: _concurrency, ...budget } = request.limits;
  return AppInferenceRequestSchema.parse({
    inference_contract_version: invocation.inference_contract_version,
    request_id: request.request_id,
    operation_id: request.operation_id,
    authority,
    intent: invocation.intent,
    messages: [{ role: "user", content: `Execute the accepted ${request.purpose} purpose policy against the immutable host snapshot.` }],
    context: request.data_blocks.map((entry) => ({ schema_id: entry.schema_id, content_digest: entry.content_digest, data: entry.data })),
    output_schema: purposeJsonSchema(request.purpose),
    stream: invocation.stream,
    tools: false,
    allow_provider_fallback: false,
    budget,
    requested_at: request.requested_at,
    deadline_at: request.deadline_at,
  });
}

export class ResumeAppInferenceAdapter {
  private readonly snapshotBuilder: SnapshotBuilder;
  private readonly broker: Broker;
  private readonly operations: CapabilityOperationCoordinator;
  private readonly persistResult?: PersistResult;
  private readonly audit: (event: string, details: Record<string, unknown>) => void;
  private readonly observedEvidenceFailures = new Map<string, ObservedEvidenceFailure>();

  constructor(input: { snapshotBuilder: SnapshotBuilder; broker: Broker; operations?: CapabilityOperationCoordinator; persistResult?: PersistResult; audit?: (event: string, details: Record<string, unknown>) => void }) {
    this.snapshotBuilder = input.snapshotBuilder;
    this.broker = input.broker;
    this.operations = input.operations ?? new CapabilityOperationCoordinator();
    this.persistResult = input.persistResult;
    this.audit = input.audit ?? (() => undefined);
  }

  async execute(raw: unknown, context: AppInferenceExecutionContext): Promise<unknown> {
    const parsed = InferenceInvocationSchema.safeParse(raw);
    if (!parsed.success) throw new AppPlatformError("invalid_input", "Inference invocation failed the versioned app contract", 400);
    const invocation = parsed.data;
    this.assertBinding(invocation, context);
    return this.operations.execute({
      appId: context.authority.app_id,
      installationId: context.authority.installation_id,
      connectionId: context.authority.connection_id,
      viewId: context.authority.view_id,
      capability: "app.inference.request",
      capabilityVersion: 1,
      operationId: context.operationId,
      idempotencyKey: context.idempotencyKey,
      input: invocation,
      deadlineAt: context.deadlineAt,
      isCancelled: context.isCancelled,
    }, async ({ signal }) => {
      const run = async () => {
        const request = await this.snapshotBuilder.build(invocation, context.grant);
        buildProtectedInferenceRequest(invocation, request, context.authority);
        const observedPriorEvidenceFailure = invocation.retry_lineage
          ? this.observedEvidenceFailures.get(invocation.retry_lineage.prior_operation_id) ?? null
          : null;
        const completion = await this.broker.execute(request, signal);
        const projected = projectResumeInferenceCompletion(completion, { invocation, observedPriorEvidenceFailure });
        return projected;
      };
      const projected = await (this.persistResult
        ? this.persistResult(`m5-inference-${context.operationId}`, { capability: "app.inference.request", input: invocation }, run)
        : run());
      this.rememberProjectedEvidenceFailure(invocation, projected);
      this.emitRetryAudit(invocation, projected);
      return projected;
    });
  }

  cancel(appId: string, installationId: string, operationId: string, idempotencyKey: string): boolean {
    const coordinated = this.operations.cancel(appId, installationId, "app.inference.request", idempotencyKey);
    const provider = this.broker.cancel(operationId);
    return coordinated || provider;
  }

  private assertBinding(invocation: Invocation, context: AppInferenceExecutionContext): void {
    const authority = AppCapabilityAuthoritySchema.safeParse(context.authority);
    const grant = context.grant;
    if (
      !authority.success || invocation.operation_id !== context.operationId ||
      authority.data.operation_id !== context.operationId || authority.data.idempotency_key !== context.idempotencyKey ||
      authority.data.audience !== "app_inference" || authority.data.capabilities.length !== 1 || authority.data.capabilities[0] !== "app.inference.request" ||
      authority.data.grant_id !== grant.grant_id || authority.data.grant_revision !== grant.grant_revision ||
      authority.data.revocation_generation !== grant.revocation_generation || authority.data.owner_id !== grant.owner_id ||
      authority.data.actor_id !== grant.actor_id || authority.data.app_id !== grant.app_id || authority.data.publisher_id !== grant.publisher_id ||
      authority.data.package_digest !== grant.package_digest || authority.data.installation_id !== grant.installation_id ||
      grant.revoked_at !== null || Date.parse(grant.expires_at) <= Date.now() || !grant.capabilities.includes("app.inference.request")
    ) throw new AppPlatformError("denied", "Inference authority binding is invalid", 403);
  }

  private rememberProjectedEvidenceFailure(invocation: Invocation, projected: unknown): void {
    if (!projected || typeof projected !== "object") return;
    const value = projected as Record<string, unknown>;
    const error = value.error && typeof value.error === "object" ? value.error as Record<string, unknown> : null;
    const binding = invocation.semantic_binding;
    const contract = EvidenceFailureRecoveryContractSchema.safeParse(error?.recovery_contract);
    if (error?.code !== "evidence_validation_failed" || error.recovery !== "evidence_failure" || !binding || !contract.success
      || value.operation_id !== invocation.operation_id
      || value.input_digest !== contract.data.semantic_input_digest
      || value.provider_profile_id !== binding.provider_profile_id
      || value.model_id !== binding.model_id
      || contract.data.strategy_revision_id !== binding.strategy_revision_id
      || contract.data.provider_profile_id !== binding.provider_profile_id
      || contract.data.model_id !== binding.model_id) return;
    this.observedEvidenceFailures.set(invocation.operation_id, {
      operation_id: invocation.operation_id,
      semantic_input_digest: contract.data.semantic_input_digest,
      strategy_revision_id: binding.strategy_revision_id,
      provider_profile_id: binding.provider_profile_id,
      model_id: binding.model_id,
    });
    while (this.observedEvidenceFailures.size > 64) {
      const oldest = this.observedEvidenceFailures.keys().next().value;
      if (!oldest) break;
      this.observedEvidenceFailures.delete(oldest);
    }
  }

  private emitRetryAudit(invocation: Invocation, projected: unknown): void {
    if (!invocation.retry_lineage || !invocation.semantic_binding || !projected || typeof projected !== "object") return;
    const value = projected as Record<string, unknown>;
    const lineage = ResumeInferenceRetryLineageProjectionSchema.safeParse(value.retry_lineage);
    if (!lineage.success
      || lineage.data.prior_operation_id !== invocation.retry_lineage.prior_operation_id
      || lineage.data.operation_id !== invocation.operation_id
      || lineage.data.strategy_revision_id !== invocation.semantic_binding.strategy_revision_id
      || lineage.data.provider_profile_id !== invocation.semantic_binding.provider_profile_id
      || lineage.data.model_id !== invocation.semantic_binding.model_id) return;
    const details = ResumeInferenceRetryAuditDetailsSchema.parse({
      diagnostic_version: 1,
      retry_relation_version: 1,
      retry_reason: lineage.data.reason,
      retry_prior_operation_id: lineage.data.prior_operation_id,
      retry_new_operation_id: lineage.data.operation_id,
      retry_semantic_input_digest: lineage.data.semantic_input_digest,
      retry_strategy_revision_id: lineage.data.strategy_revision_id,
      retry_provider_profile_id: lineage.data.provider_profile_id,
      retry_model_id: lineage.data.model_id,
      retry_equivalent: lineage.data.equivalent,
    });
    try {
      assertContentFreeResumeInferenceRetryAudit(details);
      this.audit("app.inference.owner_retry", details);
    } catch { /* Diagnostics cannot widen or interrupt inference authority. */ }
  }
}

export function projectResumeInferenceCompletion(completion: Completion, context: { invocation?: unknown; observedPriorEvidenceFailure?: ObservedEvidenceFailure | null } = {}): unknown {
  const inference = completion.inference;
  const outcome = inference.outcome;
  const validation = projectValidation(completion.validation);
  const diagnostic = ResumeInferenceDiagnosticSchema.parse({
    diagnostic_version: 1,
    operation_id: inference.operation_id,
    purpose: inference.purpose,
    prompt_policy_id: inference.prompt_policy_id,
    prompt_policy_version: inference.prompt_policy_version,
    output_schema_id: inference.output_schema_id,
    output_schema_version: inference.output_schema_version,
    model_class: inference.provider_profile_id ? "owner_active_compatible" : null,
    attempt_count: inference.attempt_count,
    stage: outcome?.stage ?? null,
    finish_category: outcome?.finish_category ?? null,
    recovery_class: outcome?.recovery_class ?? null,
    completion_mode: outcome?.completion_mode ?? null,
    final_disposition: outcome?.final_disposition ?? null,
    retryable: inference.error?.retryable ?? false,
    usage_available: inference.usage.available,
    validator_codes: validation?.finding_codes ?? [],
    ...(completion.recovery_diagnostics ?? {}),
  });
  const invocation = context.invocation ? InferenceInvocationSchema.parse(context.invocation) : null;
  const binding = invocation?.semantic_binding ?? null;
  const retry = invocation?.retry_lineage ?? null;
  const observedPrior = context.observedPriorEvidenceFailure ?? null;
  const retryEquivalent = Boolean(retry && binding && observedPrior
    && observedPrior.operation_id === retry.prior_operation_id
    && observedPrior.semantic_input_digest === retry.prior_input_digest
    && observedPrior.strategy_revision_id === retry.strategy_revision_id
    && observedPrior.provider_profile_id === retry.provider_profile_id
    && observedPrior.model_id === retry.model_id
    && retry.prior_input_digest === inference.input_digest
    && retry.strategy_revision_id === binding.strategy_revision_id
    && retry.provider_profile_id === inference.provider_profile_id
    && retry.model_id === inference.model_id
    && retry.provider_profile_id === binding.provider_profile_id
    && retry.model_id === binding.model_id);
  const retryLineage = retry && binding ? ResumeInferenceRetryLineageProjectionSchema.parse({
    retry_lineage_version: 1,
    reason: retry.reason,
    prior_operation_id: retry.prior_operation_id,
    operation_id: inference.operation_id,
    semantic_input_digest: inference.input_digest,
    strategy_revision_id: binding.strategy_revision_id,
    provider_profile_id: inference.provider_profile_id ?? binding.provider_profile_id,
    model_id: inference.model_id ?? binding.model_id,
    equivalent: retryEquivalent,
  }) : null;
  const evidenceRecovery = inference.error?.code === "evidence_validation_failed" && binding
    && inference.provider_profile_id === binding.provider_profile_id
    && inference.model_id === binding.model_id
    ? EvidenceFailureRecoveryContractSchema.parse({
        recovery_contract_version: 1,
        kind: "evidence_failure",
        actions: [
          { id: "try_again", label: "Try again" },
          { id: "review_confirmed_evidence", label: "Review confirmed evidence" },
          { id: "not_now", label: "Not now" },
        ],
        retry_disclosure: "Try again uses your currently selected provider and may consume credits.",
        semantic_input_digest: inference.input_digest,
        strategy_revision_id: binding.strategy_revision_id,
        provider_profile_id: inference.provider_profile_id ?? binding.provider_profile_id,
        model_id: inference.model_id ?? binding.model_id,
        repeated_equivalent_failure: retryEquivalent,
        emphasized_action: retryEquivalent ? "review_confirmed_evidence" : "try_again",
      })
    : null;
  const progress = AppInferenceEventSchema.parse({
    inference_contract_version: 1,
    request_id: inference.request_id,
    operation_id: inference.operation_id,
    sequence: 0,
    event: "progress",
    delta: "provider_request_completed",
  });
  const terminal = inference.status === "completed"
    ? AppInferenceEventSchema.parse({
        inference_contract_version: 1,
        request_id: inference.request_id,
        operation_id: inference.operation_id,
        sequence: 1,
        event: "completed",
        structured_output: inference.result,
        output_digest: inference.output_digest,
        usage: { input_tokens: inference.usage.input_tokens, output_tokens: inference.usage.output_tokens },
        ...(outcome ? { outcome } : {}),
      })
    : AppInferenceEventSchema.parse({
        inference_contract_version: 1,
        request_id: inference.request_id,
        operation_id: inference.operation_id,
        sequence: 1,
        event: "failed",
        error: projectEventError(inference.error),
        ...(outcome ? { outcome } : {}),
      });
  return {
    inference_contract_version: 1,
    request_id: inference.request_id,
    operation_id: inference.operation_id,
    purpose: inference.purpose,
    status: inference.status,
    output_schema_id: inference.output_schema_id,
    output_schema_version: inference.output_schema_version,
    prompt_policy_id: inference.prompt_policy_id,
    prompt_policy_version: inference.prompt_policy_version,
    input_digest: inference.input_digest,
    output_digest: inference.output_digest,
    model_class: inference.provider_profile_id ? "owner_active_compatible" : null,
    provider_profile_id: inference.provider_profile_id,
    model_id: inference.model_id,
    attempt_count: inference.attempt_count,
    usage: inference.usage,
    error: inference.error ? {
      ...projectEventError(inference.error),
      recovery: inference.error.code === "evidence_validation_failed"
        ? (evidenceRecovery ? "evidence_failure" : "none")
        : recoveryFor(inference.error.code),
      ...(evidenceRecovery ? { recovery_contract: evidenceRecovery } : {}),
    } : null,
    outcome,
    diagnostic,
    recovery_notice: inference.purpose === "general_resume_draft" && outcome?.completion_mode === "deterministic_fallback"
      ? "BrainDrive recovered a basic fact-backed draft. Review it before approval."
      : null,
    result: inference.result,
    validation,
    retry_lineage: retryLineage,
    events: [progress, terminal],
  };
}

function projectEventError(error: Completion["inference"]["error"]) {
  if (!error) return { code: "recoverable_internal_failure" as const, safe_message: "The model request failed without a committed result", retryable: true };
  return { code: InferenceErrorCodeSchema.parse(error.code), safe_message: error.safe_message, retryable: error.retryable };
}

export function recoveryFor(code: NonNullable<Completion["inference"]["error"]>["code"]): ResumeInferenceRecoveryAction {
  if (["model_incompatible", "provider_schema_unsupported", "provider_authentication_failed", "provider_authorization_failed", "unexpected_tool_call", "denied"].includes(code)) return "open_model_settings";
  if (code === "quota_exceeded") return "review_provider_account";
  if (code === "evidence_validation_failed") return "evidence_failure";
  if (code === "cancelled") return "continue";
  if ([
    "provider_unavailable",
    "rate_limited",
    "deadline_exceeded",
    "schema_validation_failed",
    "malformed_structured_output",
    "incomplete_output",
    "recoverable_internal_failure",
    "internal_failure",
  ].includes(code)) return "retry";
  return "none";
}

function projectValidation(validation: Completion["validation"]): { accepted: boolean; finding_count: number; finding_codes: string[] } | null {
  if (!validation) return null;
  const findingCodes = [...new Set(validation.findings.map((finding) => ValidatorCodeSchema.parse(finding.code)))].sort();
  return { accepted: validation.accepted, finding_count: validation.findings.length, finding_codes: findingCodes };
}
