import { canonicalInputDigest, OpaqueIdSchema } from "../app-platform/contracts/common.js";
import { CanonicalAppIdSchema } from "../app-platform/contracts/app-registry.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";

export type CapabilityOperationRequest = {
  appId: string;
  installationId: string;
  connectionId: string;
  viewId: string | null;
  capability: string;
  capabilityVersion: number;
  operationId: string;
  idempotencyKey: string;
  input: unknown;
  deadlineAt: number;
  isCancelled?: () => boolean;
};

type OperationRecord = {
  inputDigest: string;
  operationId: string;
  idempotencyKey: string;
  promise: Promise<unknown>;
  abortController: AbortController;
  completedAt: number | null;
};

export class CapabilityOperationCoordinator {
  private readonly operations = new Map<string, OperationRecord>();
  private readonly operationIdentities = new Map<string, OperationRecord>();
  private readonly requestTimes = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  async execute<T>(request: CapabilityOperationRequest, adapter: (context: { signal: AbortSignal; isCancelled: () => boolean; idempotencyDecision: "created" }) => Promise<T>): Promise<T> {
    this.validateRequest(request, 262_144, 120_000);
    const inputDigest = canonicalInputDigest({
      capability: request.capability,
      operation_id: request.operationId,
      idempotency_key: request.idempotencyKey,
      input: request.input,
    });
    const idempotencyKey = `${request.appId}:${request.installationId}:${request.capability}:${request.idempotencyKey}`;
    const operationKey = `${request.appId}:${request.installationId}:${request.capability}:${request.operationId}`;
    const byIdempotency = this.operations.get(idempotencyKey);
    const byOperation = this.operationIdentities.get(operationKey);
    if (byIdempotency || byOperation) {
      if (
        !byIdempotency || !byOperation || byIdempotency !== byOperation ||
        byIdempotency.inputDigest !== inputDigest || byIdempotency.operationId !== request.operationId ||
        byIdempotency.idempotencyKey !== request.idempotencyKey
      ) {
        throw new AppPlatformError("idempotency_conflict", "Operation identity was already used", 409);
      }
      const result = await byIdempotency.promise as T;
      return byIdempotency.completedAt === null ? result : this.reusedProjection(result);
    }
    this.enforceRate(request);

    const abortController = new AbortController();
    const record: OperationRecord = {
      inputDigest,
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      promise: Promise.resolve(undefined),
      abortController,
      completedAt: null,
    };
    const action = this.invokeAdapter(request, adapter, abortController).then((result) => {
      record.completedAt = this.now();
      return result;
    }).catch((error) => {
      this.operations.delete(idempotencyKey);
      this.operationIdentities.delete(operationKey);
      throw error;
    });
    record.promise = action;
    this.operations.set(idempotencyKey, record);
    this.operationIdentities.set(operationKey, record);
    this.prune();
    return action;
  }

  cancel(appId: string, installationId: string, capability: string, idempotencyKey: string): boolean {
    const record = this.operations.get(`${appId}:${installationId}:${capability}:${idempotencyKey}`);
    if (!record || record.completedAt !== null) return false;
    record.abortController.abort();
    return true;
  }

  private async invokeAdapter<T>(
    request: CapabilityOperationRequest,
    adapter: (context: { signal: AbortSignal; isCancelled: () => boolean; idempotencyDecision: "created" }) => Promise<T>,
    abortController: AbortController,
  ): Promise<T> {
    const isCancelled = () => abortController.signal.aborted || request.isCancelled?.() === true;
    if (isCancelled()) throw new AppPlatformError("cancelled", "Operation was cancelled before execution", 409);
    const remaining = request.deadlineAt - this.now();
    if (remaining <= 0) throw new AppPlatformError("cancelled", "Operation deadline expired before execution", 408);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        abortController.abort();
        reject(new AppPlatformError("cancelled", "Operation deadline expired", 408));
      }, remaining);
    });
    try {
      return await Promise.race([adapter({ signal: abortController.signal, isCancelled, idempotencyDecision: "created" }), deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private validateRequest(request: CapabilityOperationRequest, maxInputBytes: number, maxDurationMs: number): void {
    if (
      !CanonicalAppIdSchema.safeParse(request.appId).success ||
      !OpaqueIdSchema.safeParse(request.installationId).success ||
      !OpaqueIdSchema.safeParse(request.connectionId).success ||
      (request.viewId !== null && !OpaqueIdSchema.safeParse(request.viewId).success) ||
      !OpaqueIdSchema.safeParse(request.operationId).success ||
      request.idempotencyKey.length < 16 || request.idempotencyKey.length > 256
    ) throw new AppPlatformError("invalid_input", "Capability operation identity is invalid", 400);
    let bytes: number;
    try { bytes = Buffer.byteLength(JSON.stringify(request.input) ?? "", "utf8"); }
    catch { throw new AppPlatformError("invalid_input", "Capability input could not be encoded", 400); }
    if (bytes > maxInputBytes) throw new AppPlatformError("invalid_input", "Capability input exceeds the accepted byte limit", 413);
    const remaining = request.deadlineAt - this.now();
    if (remaining > maxDurationMs) throw new AppPlatformError("invalid_input", "Capability deadline exceeds the accepted limit", 400);
    if (remaining <= 0 || request.isCancelled?.() === true) throw new AppPlatformError("cancelled", "Capability operation is no longer active", 408);
  }

  private enforceRate(request: CapabilityOperationRequest): void {
    const now = this.now();
    const key = `${request.appId}:${request.installationId}:${request.connectionId}:${request.viewId ?? "server"}`;
    const recent = (this.requestTimes.get(key) ?? []).filter((timestamp) => now - timestamp < 10_000);
    if (recent.length >= 100) throw new AppPlatformError("denied", "Capability request rate exceeded", 429);
    recent.push(now);
    this.requestTimes.set(key, recent);
  }

  private prune(): void {
    const now = this.now();
    for (const [key, record] of this.operations) {
      if (record.completedAt !== null && now - record.completedAt > 15 * 60_000) {
        this.operations.delete(key);
        for (const [operationKey, candidate] of this.operationIdentities) {
          if (candidate === record) this.operationIdentities.delete(operationKey);
        }
      }
    }
  }

  private reusedProjection<T>(result: T): T {
    if (result && typeof result === "object" && !Array.isArray(result) && typeof (result as { reused?: unknown }).reused === "boolean") {
      return { ...(result as Record<string, unknown>), reused: true } as T;
    }
    return result;
  }
}
