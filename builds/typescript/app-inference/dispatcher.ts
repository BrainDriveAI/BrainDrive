import { Buffer } from "node:buffer";

import { canonicalInputDigest, OpaqueIdSchema, Sha256DigestSchema } from "../app-platform/contracts/common.js";
import { CanonicalAppIdSchema, InferencePurposeRequestSchema } from "../app-platform/contracts/app-registry.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import { AppInferencePurposeRegistry } from "./registry.js";

export type AppInferenceDispatchContext = {
  appId: string;
  installationId: string;
  packageDigest: `sha256:${string}`;
  requestedPurposes: readonly { purpose_id: string; version: number }[];
  grant: {
    app_id: string;
    installation_id: string;
    package_digest: string;
    capabilities: readonly string[];
    revoked_at: string | null;
    expires_at: string;
  };
  operationId: string;
  idempotencyKey: string;
  deadlineAt: number;
  signal?: AbortSignal;
};

type Active = {
  digest: string;
  operationId: string;
  idempotencyKey: string;
  promise: Promise<unknown>;
  controller: AbortController;
  completed: boolean;
};

export class AppInferenceDispatcher {
  readonly #operations = new Map<string, Active>();
  readonly #idempotencyIdentities = new Map<string, Active>();

  constructor(
    private readonly registry: AppInferencePurposeRegistry,
    private readonly now: () => number = Date.now,
    private readonly audit: (event: string, details: Record<string, unknown>) => void = () => undefined,
  ) {}

  authorize(raw: unknown, context: AppInferenceDispatchContext): ReturnType<AppInferencePurposeRegistry["resolve"]> {
    const request = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    const purpose = InferencePurposeRequestSchema.safeParse({ purpose_id: request.purpose_id, version: request.version });
    if (!purpose.success) throw new AppPlatformError("invalid_input", "Inference request is invalid", 400);
    if (!CanonicalAppIdSchema.safeParse(context.appId).success || !OpaqueIdSchema.safeParse(context.installationId).success || !Sha256DigestSchema.safeParse(context.packageDigest).success || !OpaqueIdSchema.safeParse(context.operationId).success) {
      throw new AppPlatformError("denied", "Inference authority is invalid", 403);
    }
    const registration = this.registry.resolve(context.appId, purpose.data.purpose_id, purpose.data.version);
    if (
      context.grant.app_id !== context.appId || context.grant.installation_id !== context.installationId ||
      context.grant.package_digest !== context.packageDigest || context.grant.revoked_at !== null ||
      Date.parse(context.grant.expires_at) <= this.now() || !context.grant.capabilities.includes("app.inference.request") ||
      !context.requestedPurposes.some((candidate) => candidate.purpose_id === purpose.data.purpose_id && candidate.version === purpose.data.version)
    ) {
      throw new AppPlatformError("denied", "Inference purpose is not requested and granted", 403);
    }
    if (context.deadlineAt <= this.now() || context.deadlineAt - this.now() > registration.limits.maxDurationMs) {
      throw new AppPlatformError("cancelled", "Inference deadline is invalid", 408);
    }
    return registration;
  }

  async execute(raw: unknown, context: AppInferenceDispatchContext): Promise<unknown> {
    const request = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    const registration = this.authorize(raw, context);
    const input = registration.inputSchema.safeParse(request.input);
    if (!input.success) throw new AppPlatformError("invalid_input", "Inference input is invalid", 400);
    if (Buffer.byteLength(JSON.stringify(input.data), "utf8") > registration.limits.maxInputBytes) {
      throw new AppPlatformError("invalid_input", "Inference input exceeds the accepted byte limit", 413);
    }
    const operationKey = `${context.appId}:${context.installationId}:${context.operationId}`;
    const idempotencyKey = `${context.appId}:${context.installationId}:${context.idempotencyKey}`;
    const digest = canonicalInputDigest({
      purpose: { purpose_id: registration.purposeId, version: registration.version },
      operation_id: context.operationId,
      idempotency_key: context.idempotencyKey,
      input: input.data,
    });
    const byOperation = this.#operations.get(operationKey);
    const byIdempotency = this.#idempotencyIdentities.get(idempotencyKey);
    if (byOperation || byIdempotency) {
      if (
        !byOperation || !byIdempotency || byOperation !== byIdempotency || byOperation.digest !== digest ||
        byOperation.operationId !== context.operationId || byOperation.idempotencyKey !== context.idempotencyKey
      ) {
        throw new AppPlatformError("idempotency_conflict", "Inference operation identity was already used", 409);
      }
      return byOperation.promise;
    }
    const controller = new AbortController();
    if (context.signal?.aborted) throw new AppPlatformError("cancelled", "Inference operation was cancelled", 408);
    const forwardAbort = () => controller.abort(context.signal?.reason);
    context.signal?.addEventListener("abort", forwardAbort, { once: true });
    const active: Active = {
      digest,
      operationId: context.operationId,
      idempotencyKey: context.idempotencyKey,
      controller,
      completed: false,
      promise: Promise.resolve(undefined),
    };
    const timeoutMs = Math.min(registration.limits.maxDurationMs, context.deadlineAt - this.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.emitAudit(registration, context, "allowed", null);
    active.promise = Promise.race([
      registration.executor(input.data, { ...context, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(new AppPlatformError("cancelled", "Inference operation was cancelled", 408)), { once: true });
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new AppPlatformError("cancelled", "Inference deadline expired", 408)); }, timeoutMs);
      }),
    ]).then((result) => {
      const parsed = registration.outputSchema.safeParse(result);
      if (!parsed.success) throw new AppPlatformError("validation_failed", "Inference output failed independent validation", 409);
      active.completed = true;
      this.emitAudit(registration, context, "completed", null);
      return parsed.data;
    }).catch((error) => {
      active.completed = true;
      this.emitAudit(registration, context, "failed", error instanceof AppPlatformError ? error.code : "recoverable_internal_failure");
      throw error;
    }).finally(() => { if (timer) clearTimeout(timer); context.signal?.removeEventListener("abort", forwardAbort); });
    this.#operations.set(operationKey, active);
    this.#idempotencyIdentities.set(idempotencyKey, active);
    return active.promise;
  }

  cancel(appId: string, installationId: string, operationId: string, idempotencyKey: string): boolean {
    const active = this.#operations.get(`${appId}:${installationId}:${operationId}`);
    if (!active || active.idempotencyKey !== idempotencyKey || active.completed) return false;
    active.controller.abort();
    return true;
  }

  private emitAudit(registration: ReturnType<AppInferencePurposeRegistry["resolve"]>, context: AppInferenceDispatchContext, outcome: "allowed" | "completed" | "failed", errorCode: string | null): void {
    try {
      this.audit("app.inference.dispatch", {
        app_id: context.appId, installation_id: context.installationId, package_digest: context.packageDigest,
        operation_id: context.operationId, purpose_id: registration.purposeId, purpose_version: registration.version,
        audit_projection_id: registration.auditProjectionId, decision: "host_policy_and_grant", outcome, error_code: errorCode,
      });
    } catch { /* Diagnostics cannot widen or interrupt inference authority. */ }
  }
}
