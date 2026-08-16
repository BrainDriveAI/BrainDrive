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

export type CapabilityOperationDisposition = {
  appId: string;
  installationId: string;
  operationId: string;
  capability: string;
  inputDigest: `sha256:${string}`;
  idempotencyDisposition: "created" | "coalesced" | "replayed" | "conflict";
  finalDisposition: "pending" | "completed" | "conflict" | "cancelled" | "failed";
  conflictClass: "none" | "idempotency_input_mismatch" | "cas_revision_mismatch";
  errorCode: string | null;
  elapsedMs: number;
};

export type CapabilityOperationLifecycleTerminal = {
  state: "completed" | "conflict" | "cancelled" | "failed";
  errorCode: string | null;
  settledAt: number;
};

export type CapabilityOperationLifecycleInspection = {
  operationId: string;
  inputDigest: `sha256:${string}`;
  state: "pending" | CapabilityOperationLifecycleTerminal["state"];
  errorCode: string | null;
  settled: Promise<CapabilityOperationLifecycleTerminal>;
};

type OperationRecord = {
  inputDigest: `sha256:${string}`;
  operationId: string;
  idempotencyKey: string;
  promise: Promise<unknown>;
  callerDeadline: Promise<never>;
  settled: Promise<CapabilityOperationLifecycleTerminal>;
  state: CapabilityOperationLifecycleInspection["state"];
  errorCode: string | null;
  abortController: AbortController;
  startedAt: number;
  completedAt: number | null;
};

export class CapabilityOperationCoordinator {
  private readonly operations = new Map<string, OperationRecord>();
  private readonly operationIdentities = new Map<string, OperationRecord>();
  private readonly requestTimes = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly onDisposition: (event: CapabilityOperationDisposition) => void;

  constructor(options: { now?: () => number; onDisposition?: (event: CapabilityOperationDisposition) => void } = {}) {
    this.now = options.now ?? Date.now;
    this.onDisposition = options.onDisposition ?? (() => undefined);
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
        this.emitDisposition(request, byIdempotency?.inputDigest ?? byOperation?.inputDigest ?? inputDigest, "conflict", "conflict", "idempotency_input_mismatch", "idempotency_conflict", 0);
        throw new AppPlatformError("idempotency_conflict", "Operation identity was already used", 409);
      }
      const idempotencyDisposition = byIdempotency.completedAt === null ? "coalesced" : "replayed";
      if (idempotencyDisposition === "coalesced") {
        this.emitDisposition(request, inputDigest, idempotencyDisposition, "pending", "none", null, this.now() - byIdempotency.startedAt);
        void byIdempotency.settled.then((terminal) => {
          this.emitTerminalDisposition(request, inputDigest, idempotencyDisposition, terminal, byIdempotency.startedAt);
        });
      }
      if (idempotencyDisposition === "replayed") {
        const result = await byIdempotency.promise as T;
        this.emitDisposition(request, inputDigest, idempotencyDisposition, "completed", "none", null, this.now() - byIdempotency.startedAt);
        return this.reusedProjection(result);
      }
      return await Promise.race([byIdempotency.promise as Promise<T>, byIdempotency.callerDeadline]);
    }
    this.enforceRate(request);

    const abortController = new AbortController();
    const record: OperationRecord = {
      inputDigest,
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      promise: Promise.resolve(undefined),
      callerDeadline: new Promise<never>(() => undefined),
      settled: Promise.resolve({ state: "failed", errorCode: "internal_failure", settledAt: this.now() }),
      state: "pending",
      errorCode: null,
      abortController,
      startedAt: this.now(),
      completedAt: null,
    };
    this.emitDisposition(request, inputDigest, "created", "pending", "none", null, 0);
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    record.callerDeadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        abortController.abort();
        reject(new AppPlatformError("cancelled", "Operation deadline expired", 408));
      }, Math.max(0, request.deadlineAt - this.now()));
    });
    const action = this.invokeAdapter(request, adapter, abortController);
    record.promise = action;
    record.settled = action.then(
      () => {
        if (deadlineTimer) clearTimeout(deadlineTimer);
        record.completedAt = this.now();
        record.state = "completed";
        const terminal = { state: "completed", errorCode: null, settledAt: record.completedAt } as const;
        this.emitTerminalDisposition(request, inputDigest, "created", terminal, record.startedAt);
        return terminal;
      },
      (error: unknown) => {
        if (deadlineTimer) clearTimeout(deadlineTimer);
        record.completedAt = this.now();
        const terminal = this.terminalFromError(error, record.completedAt);
        record.state = terminal.state;
        record.errorCode = terminal.errorCode;
        this.emitTerminalDisposition(request, inputDigest, "created", terminal, record.startedAt);
        this.operations.delete(idempotencyKey);
        this.operationIdentities.delete(operationKey);
        return terminal;
      },
    );
    this.operations.set(idempotencyKey, record);
    this.operationIdentities.set(operationKey, record);
    this.prune();
    return await Promise.race([action, record.callerDeadline]);
  }

  inspectLifecycle(input: { appId: string; installationId: string; capability: string; operationId: string }): CapabilityOperationLifecycleInspection | null {
    const record = this.operationIdentities.get(`${input.appId}:${input.installationId}:${input.capability}:${input.operationId}`);
    if (!record) return null;
    return {
      operationId: record.operationId,
      inputDigest: record.inputDigest,
      state: record.state,
      errorCode: record.errorCode,
      settled: record.settled,
    };
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
    return await Promise.resolve().then(() => adapter({
      signal: abortController.signal,
      isCancelled,
      idempotencyDecision: "created",
    }));
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

  private terminalFromError(error: unknown, settledAt: number): CapabilityOperationLifecycleTerminal {
    const errorCode = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "internal_failure";
    const state = errorCode === "idempotency_conflict" || errorCode === "conflict"
      ? "conflict"
      : errorCode === "cancelled"
        ? "cancelled"
        : "failed";
    return { state, errorCode, settledAt };
  }

  private emitTerminalDisposition(
    request: CapabilityOperationRequest,
    inputDigest: `sha256:${string}`,
    idempotencyDisposition: CapabilityOperationDisposition["idempotencyDisposition"],
    terminal: CapabilityOperationLifecycleTerminal,
    startedAt: number,
  ): void {
    this.emitDisposition(
      request,
      inputDigest,
      terminal.state === "conflict" ? "conflict" : idempotencyDisposition,
      terminal.state,
      terminal.errorCode === "idempotency_conflict" ? "idempotency_input_mismatch" : terminal.errorCode === "conflict" ? "cas_revision_mismatch" : "none",
      terminal.errorCode,
      terminal.settledAt - startedAt,
    );
  }

  private emitDisposition(
    request: CapabilityOperationRequest,
    inputDigest: `sha256:${string}`,
    idempotencyDisposition: CapabilityOperationDisposition["idempotencyDisposition"],
    finalDisposition: CapabilityOperationDisposition["finalDisposition"],
    conflictClass: CapabilityOperationDisposition["conflictClass"],
    errorCode: string | null,
    elapsedMs: number,
  ): void {
    try {
      this.onDisposition({
        appId: request.appId,
        installationId: request.installationId,
        operationId: request.operationId,
        capability: request.capability,
        inputDigest,
        idempotencyDisposition,
        finalDisposition,
        conflictClass,
        errorCode,
        elapsedMs: Math.max(0, Math.floor(elapsedMs)),
      });
    } catch {
      // Diagnostic observers cannot alter operation truth or replay identity.
    }
  }
}
