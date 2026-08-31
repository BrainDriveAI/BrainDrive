import { Buffer } from "node:buffer";

import { canonicalInputDigest, OpaqueIdSchema, Sha256DigestSchema } from "../app-platform/contracts/common.js";
import { CanonicalAppIdSchema } from "../app-platform/contracts/app-registry.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import { CapabilityRegistry } from "./registry.js";

export type CapabilityDispatchContext = {
  appId: string;
  installationId: string;
  packageDigest: `sha256:${string}`;
  connectionId?: string | null;
  viewId?: string | null;
  sessionId?: string | null;
  lifecycleGeneration?: number;
  manifestRequests: readonly { name: string; version: number }[];
  requestedPurposes?: readonly { purpose_id: string; version: number }[];
  grantId?: string;
  grantRevision?: number;
  revocationGeneration?: number;
  grant: {
    app_id: string;
    installation_id: string;
    package_digest: string;
    grant_id?: string;
    grant_revision?: number;
    revocation_generation?: number;
    capabilities: readonly string[];
    revoked_at: string | null;
    expires_at: string;
  };
  operationId: string;
  idempotencyKey: string;
  deadlineAt: number;
  ownerConfirmation?: { confirmed: boolean; proofId?: string };
};

type Operation = {
  digest: string;
  operationId: string;
  idempotencyKey: string;
  promise: Promise<unknown>;
  controller: AbortController;
  completed: boolean;
};

export class CapabilityDispatcher {
  readonly #operations = new Map<string, Operation>();
  readonly #operationIdentities = new Map<string, Operation>();
  readonly #rates = new Map<string, number[]>();

  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly now: () => number = Date.now,
    private readonly audit: (event: string, details: Record<string, unknown>) => void = () => undefined,
  ) {}

  async execute(name: unknown, version: unknown, rawInput: unknown, context: CapabilityDispatchContext): Promise<unknown> {
    if (!CanonicalAppIdSchema.safeParse(context.appId).success || !OpaqueIdSchema.safeParse(context.installationId).success || !Sha256DigestSchema.safeParse(context.packageDigest).success || !OpaqueIdSchema.safeParse(context.operationId).success) {
      throw new AppPlatformError("denied", "Capability authority is invalid", 403);
    }
    const registration = this.registry.resolve(context.appId, name, version);
    const grant = context.grant;
    if (
      grant.app_id !== context.appId || grant.installation_id !== context.installationId || grant.package_digest !== context.packageDigest ||
      (context.grantId !== undefined && grant.grant_id !== context.grantId) ||
      (context.grantRevision !== undefined && grant.grant_revision !== context.grantRevision) ||
      (context.revocationGeneration !== undefined && grant.revocation_generation !== context.revocationGeneration) ||
      grant.revoked_at !== null || Date.parse(grant.expires_at) <= this.now() || !grant.capabilities.includes(registration.name) ||
      !context.manifestRequests.some((request) => request.name === registration.name && request.version === registration.version)
    ) throw new AppPlatformError("denied", "Capability is not requested and granted", 403);
    if (registration.confirmation !== "none" && context.ownerConfirmation?.confirmed !== true) {
      throw new AppPlatformError("denied", "This action requires host owner confirmation", 403, { confirmation: registration.confirmationProjection });
    }
    const input = registration.inputSchema.safeParse(rawInput);
    if (!input.success) throw new AppPlatformError("invalid_input", "Capability input is invalid", 400);
    if (Buffer.byteLength(JSON.stringify(input.data), "utf8") > registration.limits.maxInputBytes) throw new AppPlatformError("invalid_input", "Capability input exceeds the accepted byte limit", 413);
    const remaining = context.deadlineAt - this.now();
    if (remaining <= 0 || remaining > registration.limits.maxDurationMs) throw new AppPlatformError("cancelled", "Capability deadline is invalid", 408);
    const idempotencyKey = `${context.appId}:${context.installationId}:${registration.name}:${context.idempotencyKey}`;
    const operationKey = `${context.appId}:${context.installationId}:${registration.name}:${context.operationId}`;
    const digest = canonicalInputDigest({
      name: registration.name,
      version: registration.version,
      operation_id: context.operationId,
      idempotency_key: context.idempotencyKey,
      input: input.data,
    });
    const byIdempotency = this.#operations.get(idempotencyKey);
    const byOperation = this.#operationIdentities.get(operationKey);
    if (byIdempotency || byOperation) {
      if (
        !byIdempotency || !byOperation || byIdempotency !== byOperation ||
        byIdempotency.digest !== digest || byIdempotency.operationId !== context.operationId ||
        byIdempotency.idempotencyKey !== context.idempotencyKey
      ) {
        throw new AppPlatformError("idempotency_conflict", "Operation identity was already used", 409);
      }
      return byIdempotency.promise;
    }
    const rateKey = `${context.appId}:${context.installationId}:${registration.name}`;
    const recent = (this.#rates.get(rateKey) ?? []).filter((value) => this.now() - value < 60_000);
    if (recent.length >= registration.limits.maxCallsPerMinute) throw new AppPlatformError("denied", "Capability request rate exceeded", 429);
    recent.push(this.now()); this.#rates.set(rateKey, recent);
    const controller = new AbortController();
    const operation: Operation = {
      digest,
      operationId: context.operationId,
      idempotencyKey: context.idempotencyKey,
      controller,
      completed: false,
      promise: Promise.resolve(undefined),
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.emitAudit(registration, context, "allowed", null);
    operation.promise = Promise.race([
      registration.handler(input.data, {
        appId: context.appId, installationId: context.installationId, packageDigest: context.packageDigest,
        connectionId: context.connectionId ?? null, viewId: context.viewId ?? null, sessionId: context.sessionId ?? null,
        lifecycleGeneration: context.lifecycleGeneration, grantId: context.grantId, grantRevision: context.grantRevision,
        revocationGeneration: context.revocationGeneration, operationId: context.operationId, idempotencyKey: context.idempotencyKey, signal: controller.signal,
        deadlineAt: context.deadlineAt, requestedPurposes: context.requestedPurposes ?? [], grant,
        isCancelled: () => controller.signal.aborted, ownerConfirmation: context.ownerConfirmation ?? { confirmed: false },
      }),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(new AppPlatformError("cancelled", "Capability operation was cancelled", 408)), { once: true });
      }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new AppPlatformError("cancelled", "Capability deadline expired", 408)); }, remaining); }),
    ]).then((result) => {
      const parsed = registration.resultSchema.safeParse(result);
      if (!parsed.success) throw new AppPlatformError("validation_failed", "Capability result is invalid", 409);
      operation.completed = true;
      this.emitAudit(registration, context, "completed", null);
      return parsed.data;
    }).catch((error) => {
      operation.completed = true;
      this.emitAudit(registration, context, "failed", error instanceof AppPlatformError ? error.code : "recoverable_internal_failure");
      throw error;
    }).finally(() => { if (timer) clearTimeout(timer); });
    this.#operations.set(idempotencyKey, operation);
    this.#operationIdentities.set(operationKey, operation);
    return operation.promise;
  }

  cancel(appId: string, installationId: string, capability: string, idempotencyKey: string): boolean {
    const operation = this.#operations.get(`${appId}:${installationId}:${capability}:${idempotencyKey}`);
    if (!operation || operation.completed) return false;
    operation.controller.abort();
    return true;
  }

  private emitAudit(registration: ReturnType<CapabilityRegistry["resolve"]>, context: CapabilityDispatchContext, outcome: "allowed" | "completed" | "failed", errorCode: string | null): void {
    try {
      this.audit("app.capability.dispatch", {
        app_id: context.appId, installation_id: context.installationId, package_digest: context.packageDigest,
        operation_id: context.operationId, capability: registration.name, capability_version: registration.version,
        audit_projection_id: registration.auditProjectionId, decision: "host_registration_and_grant", outcome, error_code: errorCode,
      });
    } catch { /* Diagnostics cannot widen or interrupt capability authority. */ }
  }
}
