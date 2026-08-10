import type { z } from "zod";

import { AppInferenceEventSchema, AppInferenceRequestSchema, AppCapabilityAuthoritySchema } from "../app-platform/contracts/spec-05-foundation.js";
import type { InferenceRequestSchema } from "../app-platform/contracts/inference.js";
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

type SnapshotBuilder = Pick<ImmutableInferenceSnapshotBuilder, "build">;
type Broker = Pick<ResumeInferenceBroker, "execute" | "cancel">;
type PersistResult = <T>(idempotencyKey: string, input: unknown, action: () => Promise<T>) => Promise<T>;

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

export class AppInferenceCapability {
  private readonly snapshotBuilder: SnapshotBuilder;
  private readonly broker: Broker;
  private readonly operations: CapabilityOperationCoordinator;
  private readonly persistResult?: PersistResult;

  constructor(input: { snapshotBuilder: SnapshotBuilder; broker: Broker; operations?: CapabilityOperationCoordinator; persistResult?: PersistResult }) {
    this.snapshotBuilder = input.snapshotBuilder;
    this.broker = input.broker;
    this.operations = input.operations ?? new CapabilityOperationCoordinator();
    this.persistResult = input.persistResult;
  }

  async execute(raw: unknown, context: AppInferenceExecutionContext): Promise<unknown> {
    const parsed = InferenceInvocationSchema.safeParse(raw);
    if (!parsed.success) throw new AppPlatformError("invalid_input", "Inference invocation failed the versioned app contract", 400);
    const invocation = parsed.data;
    this.assertBinding(invocation, context);
    return this.operations.execute({
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
        return projectCompletion(await this.broker.execute(request, signal));
      };
      return this.persistResult
        ? this.persistResult(`m5-inference-${context.operationId}`, { capability: "app.inference.request", input: invocation }, run)
        : run();
    });
  }

  cancel(installationId: string, operationId: string, idempotencyKey: string): boolean {
    const coordinated = this.operations.cancel(installationId, "app.inference.request", idempotencyKey);
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
}

function projectCompletion(completion: Completion): unknown {
  const inference = completion.inference;
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
      })
    : AppInferenceEventSchema.parse({
        inference_contract_version: 1,
        request_id: inference.request_id,
        operation_id: inference.operation_id,
        sequence: 1,
        event: "failed",
        error: projectEventError(inference.error),
      });
  return {
    inference_contract_version: 1,
    request_id: inference.request_id,
    operation_id: inference.operation_id,
    purpose: inference.purpose,
    status: inference.status,
    output_schema_id: inference.output_schema_id,
    output_schema_version: inference.output_schema_version,
    output_digest: inference.output_digest,
    model_class: inference.provider_profile_id ? "owner_active_compatible" : null,
    attempt_count: inference.attempt_count,
    usage: inference.usage,
    error: inference.error ? { ...projectEventError(inference.error), recovery: recoveryFor(inference.error.code) } : null,
    result: inference.result,
    validation: completion.validation,
    events: [progress, terminal],
  };
}

function projectEventError(error: Completion["inference"]["error"]) {
  if (!error) return { code: "recoverable_internal_failure" as const, safe_message: "The model request failed without a committed result", retryable: true };
  const code = error.code === "validation_failed" ? "schema_validation_failed" : error.code;
  return { code, safe_message: error.safe_message, retryable: error.retryable };
}

function recoveryFor(code: NonNullable<Completion["inference"]["error"]>["code"]): "open_model_settings" | "review_provider_account" | "retry" | "none" {
  if (["model_incompatible", "provider_unavailable", "denied"].includes(code)) return "open_model_settings";
  if (code === "quota_exceeded") return "review_provider_account";
  if (["rate_limited", "deadline_exceeded", "recoverable_internal_failure"].includes(code)) return "retry";
  return "none";
}
