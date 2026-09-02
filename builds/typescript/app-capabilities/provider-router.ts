import { Buffer } from "node:buffer";

import { z } from "zod";

import { TimestampSchema } from "../app-platform/contracts/common.js";
import {
  createPackageOperationReceiptDiagnostic,
  type PackageDiagnosticSink,
} from "../app-platform/contracts/diagnostics.js";
import {
  OperationIdSchema,
  RuntimeTargetSchema,
  type ProvidedOperation,
} from "../app-platform/contracts/package-components.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import type {
  CapabilityDependencyResolver,
  CapabilityDependencyResolution,
  InstalledComponentRecord,
  InstalledPackageRecord,
  InstalledPackageStore,
} from "../app-platform/lifecycle/installed-package-store.js";
import type { SidecarRuntimeBindingService } from "../app-platform/lifecycle/sidecar-supervisor.js";

export const ProviderOperationFailureCodeSchema = z.enum([
  "invalid_request",
  "not_authorized",
  "provider_unavailable",
  "provider_unhealthy",
  "provider_selection_required",
  "unsupported_target",
  "invalid_provider_response",
  "timeout",
  "cancelled",
]);

export const ProviderDiscoveryStateSchema = z.enum([
  "available",
  "unavailable",
  "disabled",
  "unhealthy",
  "unauthorized",
  "selection_required",
  "unsupported_target",
]);

const ProviderGrantProjectionSchema = z.object({
  required: z.literal(true),
  authorized: z.boolean(),
}).strict();

const ProviderFailureProjectionSchema = z.object({
  code: ProviderOperationFailureCodeSchema,
  retryable: z.boolean(),
  message: z.string().min(1).max(256),
}).strict();

export const CapabilityProviderDiscoverySchema = z.object({
  discovery_version: z.literal(1),
  operation_id: OperationIdSchema,
  operation: z.object({
    capability: z.string().min(1).max(96),
    version: z.number().int().positive().max(65_535),
    result_classification: z.literal("generic_envelope"),
  }).strict().nullable(),
  state: ProviderDiscoveryStateSchema,
  callable: z.boolean(),
  provider_count: z.number().int().nonnegative(),
  selected_provider: z.object({
    provider_class: z.literal("capability_provider"),
    package_version: z.string().min(1).max(64),
    selection: z.enum(["single_provider", "owner_or_admin_policy"]),
  }).strict().nullable(),
  health: z.object({
    state: z.enum(["healthy", "unhealthy", "unknown"]),
    checked_at: TimestampSchema.nullable(),
  }).strict().nullable(),
  grant: ProviderGrantProjectionSchema,
  failure: ProviderFailureProjectionSchema.nullable(),
  message: z.string().min(1).max(256),
}).strict().superRefine((value, context) => {
  if (value.state === "available" && !value.callable) {
    context.addIssue({ code: "custom", path: ["callable"], message: "available providers must be callable" });
  }
  if (value.state !== "available" && value.callable) {
    context.addIssue({ code: "custom", path: ["callable"], message: "unavailable providers cannot be callable" });
  }
  if (value.state === "unauthorized" && (value.provider_count !== 0 || value.selected_provider || value.health || value.operation)) {
    context.addIssue({ code: "custom", message: "unauthorized discovery must not enumerate provider details" });
  }
});

export type ProviderOperationFailureCode = z.infer<typeof ProviderOperationFailureCodeSchema>;
export type ProviderDiscoveryState = z.infer<typeof ProviderDiscoveryStateSchema>;
export type CapabilityProviderDiscovery = z.infer<typeof CapabilityProviderDiscoverySchema>;
export type RuntimeTarget = z.infer<typeof RuntimeTargetSchema>;

export type ProviderOperationFailure = {
  code: ProviderOperationFailureCode;
  retryable: boolean;
  message: string;
};

export type ProviderOperationRequestContext<TRequest> = {
  request: TRequest;
  provider: ResolvedProviderOperation;
  signal: AbortSignal;
};

export type ProviderOperationAdapter = {
  invoke(request: unknown, context: ProviderOperationAdapterContext): Promise<unknown>;
};

export type ProviderOperationAdapterContext = {
  package_id: string;
  installation_id: string;
  package_digest: `sha256:${string}`;
  package_version: string;
  provider_component_id: string;
  operation_id: string;
  adapter_abi: "braindrive-operation-adapter-v1";
  required_sidecars: readonly string[];
  signal: AbortSignal;
  bindingForRequiredSidecar(sidecarComponentId: string): unknown;
};

export type ProviderOperationDefinition<TRequest = unknown, TResult = unknown, TFailureResult = unknown> = {
  operation_id: string;
  input_schema: z.ZodType<TRequest>;
  result_schema: z.ZodType<TResult>;
  max_input_bytes: number;
  timeout_ms: number;
  failure(request: TRequest | null, failure: ProviderOperationFailure): TFailureResult;
};

export type ProviderSelection = {
  packageId: string;
  providerComponentId: string;
};

export type ProviderSelectionPolicy = {
  selectedProvider(operationId: string): ProviderSelection | null;
};

export type CapabilityProviderRegistryOptions = {
  store: InstalledPackageStore;
  target: RuntimeTarget;
  selectionPolicy?: ProviderSelectionPolicy;
  clock?: () => Date;
};

export type CapabilityOperationRouterOptions = {
  registry: CapabilityProviderResolver;
  operations: readonly ProviderOperationDefinition[];
  adapters: Record<string, ProviderOperationAdapter>;
  selectionPolicy?: ProviderSelectionPolicy;
  bindingService?: SidecarRuntimeBindingService | null;
  diagnosticSink?: PackageDiagnosticSink | null;
  now?: () => number;
};

export type ProviderOperationCandidate = {
  packageRecord: InstalledPackageRecord;
  providerComponent: InstalledComponentRecord;
  operation: ProvidedOperation;
};

export type ResolvedProviderOperation = {
  package_id: string;
  installation_id: string;
  package_digest: `sha256:${string}`;
  package_version: string;
  provider_component_id: string;
  operation_id: string;
  required_sidecars: readonly string[];
  adapter_abi: "braindrive-operation-adapter-v1";
};

type ProviderResolution =
  | { ok: true; provider: ResolvedProviderOperation; state: "available"; providerCount: number; selection: "single_provider" | "owner_or_admin_policy"; health: "healthy" | "unknown" }
  | { ok: false; state: Exclude<ProviderDiscoveryState, "available" | "unauthorized">; providerCount: number; failure: ProviderOperationFailure; operation: ProvidedOperation | null; health: "healthy" | "unhealthy" | "unknown" | null };

export type CapabilityProviderResolver = {
  resolve(operationIdInput: unknown, selectionPolicy?: ProviderSelectionPolicy | null): Promise<ProviderResolution>;
};

type CandidateEvaluation = {
  candidate: ProviderOperationCandidate;
  state: Exclude<ProviderDiscoveryState, "unauthorized">;
  failure: ProviderOperationFailure | null;
  health: "healthy" | "unhealthy" | "unknown";
};

const MESSAGES: Record<ProviderOperationFailureCode, { retryable: boolean; message: string }> = {
  invalid_request: { retryable: false, message: "Capability operation request is invalid." },
  not_authorized: { retryable: false, message: "Capability authorization is required." },
  provider_unavailable: { retryable: true, message: "Capability provider is unavailable." },
  provider_unhealthy: { retryable: true, message: "Capability provider is unhealthy." },
  provider_selection_required: { retryable: false, message: "Owner or admin provider selection is required." },
  unsupported_target: { retryable: false, message: "Capability provider has no compatible runtime target." },
  invalid_provider_response: { retryable: true, message: "Provider response could not be normalized safely." },
  timeout: { retryable: true, message: "Capability provider timed out." },
  cancelled: { retryable: false, message: "Capability operation was cancelled." },
};

export class CapabilityProviderRegistry {
  private readonly store: InstalledPackageStore;
  private readonly target: RuntimeTarget;
  private readonly selectionPolicy: ProviderSelectionPolicy | null;
  private readonly clock: () => Date;

  constructor(options: CapabilityProviderRegistryOptions) {
    this.store = options.store;
    this.target = RuntimeTargetSchema.parse(options.target);
    this.selectionPolicy = options.selectionPolicy ?? null;
    this.clock = options.clock ?? (() => new Date());
  }

  async discover(operationIdInput: unknown, options: { authorized: boolean; selectionPolicy?: ProviderSelectionPolicy | null }): Promise<CapabilityProviderDiscovery> {
    const operationId = parseOperationId(operationIdInput);
    if (!options.authorized) {
      return CapabilityProviderDiscoverySchema.parse({
        discovery_version: 1,
        operation_id: operationId,
        operation: null,
        state: "unauthorized",
        callable: false,
        provider_count: 0,
        selected_provider: null,
        health: null,
        grant: { required: true, authorized: false },
        failure: failure("not_authorized"),
        message: "Capability authorization is required.",
      });
    }
    const resolution = await this.resolve(operationId, options.selectionPolicy ?? undefined);
    if (resolution.ok) {
      return CapabilityProviderDiscoverySchema.parse({
        discovery_version: 1,
        operation_id: operationId,
        operation: operationSummary(resolution.provider.operation_id),
        state: "available",
        callable: true,
        provider_count: resolution.providerCount,
        selected_provider: {
          provider_class: "capability_provider",
          package_version: resolution.provider.package_version,
          selection: resolution.selection,
        },
        health: { state: resolution.health, checked_at: this.clock().toISOString() },
        grant: { required: true, authorized: true },
        failure: null,
        message: "Capability provider is available.",
      });
    }
    return CapabilityProviderDiscoverySchema.parse({
      discovery_version: 1,
      operation_id: operationId,
      operation: resolution.operation ? operationSummary(resolution.operation.operation_id) : null,
      state: resolution.state,
      callable: false,
      provider_count: resolution.providerCount,
      selected_provider: null,
      health: resolution.health ? { state: resolution.health, checked_at: this.clock().toISOString() } : null,
      grant: { required: true, authorized: true },
      failure: resolution.failure,
      message: resolution.failure.message,
    });
  }

  async resolve(operationIdInput: unknown, selectionPolicy?: ProviderSelectionPolicy | null): Promise<ProviderResolution> {
    const operationId = parseOperationId(operationIdInput);
    const candidates = await this.candidatesFor(operationId);
    if (candidates.length === 0) {
      return {
        ok: false,
        state: "unavailable",
        providerCount: 0,
        operation: null,
        health: null,
        failure: failure("provider_unavailable"),
      };
    }

    const policy = selectionPolicy ?? this.selectionPolicy;
    const selected = policy?.selectedProvider(operationId) ?? null;
    if (candidates.length > 1 && !selected) {
      return {
        ok: false,
        state: "selection_required",
        providerCount: candidates.length,
        operation: candidates[0]!.candidate.operation,
        health: null,
        failure: failure("provider_selection_required"),
      };
    }

    const candidate = selected
      ? candidates.find((entry) => entry.candidate.packageRecord.package_id === selected.packageId && entry.candidate.providerComponent.component_id === selected.providerComponentId)
      : candidates[0];
    if (!candidate) {
      return {
        ok: false,
        state: "unavailable",
        providerCount: candidates.length,
        operation: candidates[0]!.candidate.operation,
        health: null,
        failure: failure("provider_unavailable"),
      };
    }
    if (candidate.state !== "available") {
      return {
        ok: false,
        state: candidate.state,
        providerCount: candidates.length,
        operation: candidate.candidate.operation,
        health: candidate.health,
        failure: candidate.failure ?? failure("provider_unavailable"),
      };
    }
    if (candidate.failure) {
      return {
        ok: false,
        state: "unavailable",
        providerCount: candidates.length,
        operation: candidate.candidate.operation,
        health: candidate.health,
        failure: candidate.failure,
      };
    }
    return {
      ok: true,
      state: "available",
      providerCount: candidates.length,
      provider: resolvedProvider(candidate.candidate),
      selection: selected ? "owner_or_admin_policy" : "single_provider",
      health: "healthy",
    };
  }

  private async candidatesFor(operationId: string): Promise<CandidateEvaluation[]> {
    const packages = await this.store.listPackages();
    const evaluations: CandidateEvaluation[] = [];
    for (const packageRecord of packages) {
      if (packageRecord.state === "uninstalled") continue;
      for (const operation of packageRecord.manifest.provided_operations.filter((entry) => entry.operation_id === operationId)) {
        const component = await this.store.readComponent(packageRecord.package_id, operation.provider_component_id);
        if (!component || component.component_kind !== "capability_provider" || component.state === "uninstalled") continue;
        evaluations.push(await this.evaluate({ packageRecord, providerComponent: component, operation }));
      }
    }
    return evaluations.sort((left, right) => providerKey(left.candidate).localeCompare(providerKey(right.candidate)));
  }

  private async evaluate(candidate: ProviderOperationCandidate): Promise<CandidateEvaluation> {
    if (candidate.packageRecord.state !== "enabled" || candidate.providerComponent.state === "disabled") {
      return { candidate, state: "disabled", failure: failure("provider_unavailable"), health: "unknown" };
    }
    if (candidate.providerComponent.state !== "enabled") {
      return { candidate, state: "unavailable", failure: failure("provider_unavailable"), health: "unknown" };
    }
    let health: CandidateEvaluation["health"] = "healthy";
    for (const sidecarId of candidate.operation.required_sidecars) {
      const sidecar = candidate.packageRecord.manifest.sidecars.find((entry) => entry.component_id === sidecarId);
      if (!sidecar) return { candidate, state: "unavailable", failure: failure("provider_unavailable"), health: "unknown" };
      if (!sidecar.targets.some((target) => target.target === this.target)) {
        return { candidate, state: "unsupported_target", failure: failure("unsupported_target"), health: "unknown" };
      }
      const sidecarComponent = await this.store.readComponent(candidate.packageRecord.package_id, sidecarId);
      if (!sidecarComponent || sidecarComponent.state === "uninstalled") {
        return { candidate, state: "unavailable", failure: failure("provider_unavailable"), health: "unknown" };
      }
      if (sidecarComponent.health === "unhealthy" || sidecarComponent.state === "failed" || sidecarComponent.state === "unavailable") {
        return { candidate, state: "unhealthy", failure: failure("provider_unhealthy"), health: "unhealthy" };
      }
      if (sidecarComponent.state !== "running" || sidecarComponent.health !== "healthy") {
        health = "unknown";
      }
    }
    if (health === "unknown") return { candidate, state: "unavailable", failure: failure("provider_unavailable"), health };
    return { candidate, state: "available", failure: null, health };
  }
}

export class CapabilityOperationRouter {
  private readonly operations: Map<string, ProviderOperationDefinition>;
  private readonly adapters: Record<string, ProviderOperationAdapter>;
  private readonly now: () => number;

  constructor(private readonly options: CapabilityOperationRouterOptions) {
    this.operations = new Map();
    for (const operation of options.operations) {
      const operationId = parseOperationId(operation.operation_id);
      if (this.operations.has(operationId)) throw new AppPlatformError("duplicate_identity", "Operation router definition is duplicated", 409);
      if (!Number.isInteger(operation.max_input_bytes) || operation.max_input_bytes <= 0 || !Number.isInteger(operation.timeout_ms) || operation.timeout_ms <= 0) {
        throw new AppPlatformError("descriptor_invalid", "Operation router limits are invalid");
      }
      this.operations.set(operationId, { ...operation, operation_id: operationId });
    }
    this.adapters = options.adapters;
    this.now = options.now ?? Date.now;
  }

  async call(operationIdInput: unknown, rawRequest: unknown, options: { authorized: boolean; signal: AbortSignal; selectionPolicy?: ProviderSelectionPolicy | null }): Promise<unknown> {
    const operationId = parseOperationId(operationIdInput);
    const definition = this.operations.get(operationId);
    if (!definition) return failure("provider_unavailable");

    const parsed = definition.input_schema.safeParse(rawRequest);
    if (!parsed.success) return definition.failure(null, failure("invalid_request"));
    if (!options.authorized) return definition.failure(parsed.data, failure("not_authorized"));
    if (options.signal.aborted) return definition.failure(parsed.data, failure("cancelled"));
    if (Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > definition.max_input_bytes) {
      return definition.failure(parsed.data, failure("invalid_request"));
    }

    const resolved = await this.options.registry.resolve(operationId, options.selectionPolicy ?? this.options.selectionPolicy);
    if (!resolved.ok) return definition.failure(parsed.data, resolved.failure);
    const adapter = this.adapters[adapterKey(resolved.provider.package_id, resolved.provider.provider_component_id, operationId)];
    if (!adapter) {
      const providerFailure = failure("provider_unavailable");
      const result = definition.failure(parsed.data, providerFailure);
      this.recordReceipt(resolved.provider, operationId, parsed.data, result, providerFailure, resolved.selection);
      return result;
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        adapter.invoke(parsed.data, {
          package_id: resolved.provider.package_id,
          installation_id: resolved.provider.installation_id,
          package_digest: resolved.provider.package_digest,
          package_version: resolved.provider.package_version,
          provider_component_id: resolved.provider.provider_component_id,
          operation_id: operationId,
          adapter_abi: resolved.provider.adapter_abi,
          required_sidecars: resolved.provider.required_sidecars,
          signal: controller.signal,
          bindingForRequiredSidecar: (sidecarComponentId) => {
            if (!resolved.provider.required_sidecars.includes(sidecarComponentId)) {
              throw new AppPlatformError("denied", "Sidecar binding is outside the selected operation scope", 403);
            }
            if (!this.options.bindingService) {
              throw new AppPlatformError("ambiguous_runtime_state", "Sidecar binding service is unavailable");
            }
            return this.options.bindingService.bindingForProviderAdapter(
              resolved.provider.package_id,
              sidecarComponentId,
              resolved.provider.provider_component_id,
            );
          },
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new AppPlatformError("deadline_exceeded", "Capability provider timed out", 408));
          }, definition.timeout_ms);
        }),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(new AppPlatformError("operation_cancelled", "Capability operation was cancelled", 408)), { once: true });
        }),
      ]);
      const parsedResult = definition.result_schema.safeParse(result);
      if (parsedResult.success) {
        this.recordReceipt(resolved.provider, operationId, parsed.data, parsedResult.data, null, resolved.selection, "executed");
        return parsedResult.data;
      }
      const providerFailure = failure("invalid_provider_response");
      const failureResult = definition.failure(parsed.data, providerFailure);
      this.recordReceipt(resolved.provider, operationId, parsed.data, failureResult, providerFailure, resolved.selection, "executed");
      return failureResult;
    } catch {
      const providerFailure = failure(timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "provider_unavailable");
      const result = definition.failure(parsed.data, providerFailure);
      this.recordReceipt(resolved.provider, operationId, parsed.data, result, providerFailure, resolved.selection, "executed");
      return result;
    } finally {
      if (timer) clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
    }
  }

  private recordReceipt(
    provider: ResolvedProviderOperation,
    operationId: string,
    request: unknown,
    result: unknown,
    providerFailure: ProviderOperationFailure | null,
    providerSelection: "single_provider" | "owner_or_admin_policy",
    providerExecution: "not_executed" | "executed" = "not_executed",
  ): void {
    if (!this.options.diagnosticSink) return;
    const identity = receiptIdentity(request);
    if (!identity) return;
    this.options.diagnosticSink.record(createPackageOperationReceiptDiagnostic({
      packageId: provider.package_id,
      installationId: provider.installation_id,
      packageDigest: provider.package_digest,
      packageVersion: provider.package_version,
      providerComponentId: provider.provider_component_id,
      providerProfileId: "package-provider",
      providerSelection,
      providerExecution,
      operationId,
      requestId: identity.requestId,
      runId: identity.runId,
      status: providerFailure ? receiptStatusForFailure(providerFailure.code) : receiptStatusFromResult(result),
      failureCode: providerFailure?.code ?? null,
      resultCount: providerFailure ? 0 : 1,
      completedItemCount: providerFailure ? 0 : 1,
      occurredAt: new Date(this.now()).toISOString(),
      limitProfileId: "operation-router-v1",
      usage: { call_count: providerExecution === "executed" ? 1 : 0, bytes_class: null },
      durationMs: null,
      unsafeInput: request,
      unsafeProviderResult: result,
    }));
  }
}

export function dependencyResolverFromCapabilityProviderRegistry(registry: CapabilityProviderRegistry): CapabilityDependencyResolver {
  return {
    resolveDependency: async (operationId): Promise<CapabilityDependencyResolution> => {
      const discovery = await registry.discover(operationId, { authorized: true });
      return {
        operation_id: discovery.operation_id,
        state: dependencyStateForDiscovery(discovery),
        callable: discovery.callable,
        provider_count: discovery.provider_count,
        failure_code: discovery.callable ? null : dependencyFailureCode(discovery.failure?.code ?? null),
        safe_message: discovery.message,
        checked_at: discovery.health?.checked_at ?? null,
      };
    },
  };
}

function dependencyStateForDiscovery(discovery: CapabilityProviderDiscovery): CapabilityDependencyResolution["state"] {
  if (discovery.callable) return "available";
  if (discovery.state === "unavailable" && discovery.provider_count === 0) return "missing";
  if (discovery.state === "unauthorized") return "unauthorized";
  if (discovery.state === "selection_required") return "selection_required";
  if (discovery.state === "unsupported_target") return "unsupported_target";
  if (discovery.state === "unhealthy") return "unhealthy";
  if (discovery.state === "disabled") return "disabled";
  return "unavailable";
}

export function adapterKey(packageId: string, providerComponentId: string, operationId: string): string {
  return `${packageId}:${providerComponentId}:${operationId}`;
}

function resolvedProvider(candidate: ProviderOperationCandidate): ResolvedProviderOperation {
  return {
    package_id: candidate.packageRecord.package_id,
    installation_id: candidate.packageRecord.installation_id,
    package_digest: candidate.packageRecord.package_digest as `sha256:${string}`,
    package_version: candidate.packageRecord.package_version,
    provider_component_id: candidate.providerComponent.component_id,
    operation_id: candidate.operation.operation_id,
    required_sidecars: [...candidate.operation.required_sidecars],
    adapter_abi: candidate.operation.adapter.abi,
  };
}

function providerKey(candidate: ProviderOperationCandidate): string {
  return adapterKey(candidate.packageRecord.package_id, candidate.providerComponent.component_id, candidate.operation.operation_id);
}

function parseOperationId(value: unknown): string {
  return OperationIdSchema.parse(value);
}

function operationSummary(operationId: string): CapabilityProviderDiscovery["operation"] {
  const [capability, rawVersion] = operationId.split("@");
  return {
    capability: capability ?? operationId,
    version: Number(rawVersion ?? 1),
    result_classification: "generic_envelope",
  };
}

function failure(code: ProviderOperationFailureCode): ProviderOperationFailure {
  const defaults = MESSAGES[code];
  return { code, retryable: defaults.retryable, message: defaults.message };
}

function receiptIdentity(request: unknown): { requestId: string; runId: string } | null {
  if (!request || typeof request !== "object") return null;
  const candidate = request as Record<string, unknown>;
  const requestId = z.string().uuid().safeParse(candidate.request_id);
  const runId = z.string().uuid().safeParse(candidate.run_id);
  return requestId.success && runId.success ? { requestId: requestId.data, runId: runId.data } : null;
}

function receiptStatusForFailure(code: ProviderOperationFailureCode): "failure" | "unavailable" | "cancelled" {
  if (code === "cancelled") return "cancelled";
  if (code === "provider_unavailable" || code === "provider_unhealthy" || code === "provider_selection_required" || code === "unsupported_target") return "unavailable";
  return "failure";
}

function receiptStatusFromResult(result: unknown): "success" | "partial" | "failure" | "unavailable" | "cancelled" {
  if (!result || typeof result !== "object") return "success";
  const status = (result as { status?: unknown }).status;
  return status === "success" || status === "partial" || status === "failure" || status === "unavailable" || status === "cancelled"
    ? status
    : "success";
}

function dependencyFailureCode(code: ProviderOperationFailureCode | null): CapabilityDependencyResolution["failure_code"] {
  if (code === "provider_unavailable" || code === "provider_unhealthy" || code === "provider_selection_required" || code === "unsupported_target" || code === "not_authorized" || code === "invalid_request") return code;
  return "unknown";
}
