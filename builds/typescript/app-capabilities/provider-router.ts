import { Buffer } from "node:buffer";

import { z } from "zod";

import { canonicalInputDigest, TimestampSchema } from "../app-platform/contracts/common.js";
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
import type {
  ExpectedSidecarRuntimeIdentity,
  SidecarRuntimeBindingService,
} from "../app-platform/lifecycle/sidecar-supervisor.js";

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
  "idempotency_conflict",
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
  package_generation: number;
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
  sidecarAuthority?: ProviderSidecarAuthority | null;
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
  package_generation: number;
  required_sidecars: readonly string[];
  adapter_abi: "braindrive-operation-adapter-v1";
};

export type ProviderSidecarAuthority = {
  resolveRequiredSidecar(input: {
    provider: ResolvedProviderOperation;
    sidecarComponentId: string;
  }): Promise<ExpectedSidecarRuntimeIdentity>;
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
  idempotency_conflict: { retryable: false, message: "Capability operation idempotency key was reused with different input." },
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

export class StoreBackedProviderSidecarAuthority implements ProviderSidecarAuthority {
  constructor(private readonly options: {
    store: InstalledPackageStore;
    target: RuntimeTarget;
    bindingService: SidecarRuntimeBindingService;
  }) {}

  async resolveRequiredSidecar(input: { provider: ResolvedProviderOperation; sidecarComponentId: string }): Promise<ExpectedSidecarRuntimeIdentity> {
    const packageRecord = await this.options.store.readPackage(input.provider.package_id);
    if (!packageRecord) throw new AppPlatformError("ambiguous_runtime_state", "Selected provider package is unavailable");
    if (
      packageRecord.installation_id !== input.provider.installation_id
      || packageRecord.package_digest !== input.provider.package_digest
      || packageRecord.generation !== input.provider.package_generation
    ) {
      throw new AppPlatformError("ambiguous_runtime_state", "Selected provider package identity is stale");
    }
    if (packageRecord.state !== "enabled") throw new AppPlatformError("provider_unavailable", "Selected provider package is unavailable");

    const operation = packageRecord.manifest.provided_operations.find((candidate) => (
      candidate.operation_id === input.provider.operation_id
      && candidate.provider_component_id === input.provider.provider_component_id
    ));
    if (!operation || !operation.required_sidecars.includes(input.sidecarComponentId)) {
      throw new AppPlatformError("denied", "Sidecar binding is outside the selected operation scope", 403);
    }

    const sidecar = packageRecord.manifest.sidecars.find((candidate) => candidate.component_id === input.sidecarComponentId);
    if (!sidecar || sidecar.owner_component_id !== input.provider.provider_component_id) {
      throw new AppPlatformError("denied", "Sidecar binding is outside the selected provider scope", 403);
    }
    const target = sidecar.targets.find((candidate) => candidate.target === this.options.target);
    if (!target) throw new AppPlatformError("host_incompatible", "Selected sidecar target is unsupported");

    const component = await this.options.store.readComponent(input.provider.package_id, input.sidecarComponentId);
    if (!component || component.component_kind !== "sidecar" || component.state === "uninstalled" || component.state === "stopped") {
      throw new AppPlatformError("provider_unavailable", "Selected sidecar is unavailable");
    }
    if (component.state === "failed" || component.state === "unavailable" || component.health === "unhealthy") {
      throw new AppPlatformError("readiness_failed", "Selected sidecar is unhealthy");
    }
    if (component.state !== "running" || component.health !== "healthy") {
      throw new AppPlatformError("provider_unavailable", "Selected sidecar is not ready");
    }

    const binding = this.options.bindingService.safeProjection(input.provider.package_id, input.sidecarComponentId);
    if (!binding) throw new AppPlatformError("ambiguous_runtime_state", "Selected sidecar binding is unavailable");
    if (
      binding.installation_id !== input.provider.installation_id
      || binding.owner_component_id !== input.provider.provider_component_id
      || binding.audience !== "provider_adapter_only"
      || binding.target !== this.options.target
      || binding.public_bind
    ) {
      throw new AppPlatformError("ambiguous_runtime_state", "Selected sidecar binding identity is stale");
    }

    return {
      runtimeId: binding.runtime_id,
      bindingGeneration: binding.binding_generation,
    };
  }
}

export class CapabilityOperationRouter {
  private readonly operations: Map<string, ProviderOperationDefinition>;
  private readonly adapters: Record<string, ProviderOperationAdapter>;
  private readonly now: () => number;
  private readonly idempotency = new Map<string, { inputDigest: `sha256:${string}`; result: unknown }>();

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

  async call(operationIdInput: unknown, rawRequest: unknown, options: { authorized: boolean; signal: AbortSignal; selectionPolicy?: ProviderSelectionPolicy | null; idempotencyKey?: string | null }): Promise<unknown> {
    const operationId = parseOperationId(operationIdInput);
    const definition = this.operations.get(operationId);
    if (!definition) return failure("provider_unavailable");

    const parsed = definition.input_schema.safeParse(rawRequest);
    if (!parsed.success) return definition.failure(null, failure("invalid_request"));
    const replayKey = idempotencyKey(operationId, options.idempotencyKey);
    const replayDigest = replayKey ? canonicalInputDigest({ operation_id: operationId, request: parsed.data }) : null;
    if (replayKey && replayDigest) {
      const replay = this.idempotency.get(replayKey);
      if (replay) {
        if (replay.inputDigest !== replayDigest) return definition.failure(parsed.data, failure("idempotency_conflict"));
        return cloneResult(replay.result);
      }
    }
    if (!options.authorized) return definition.failure(parsed.data, failure("not_authorized"));
    if (options.signal.aborted) return definition.failure(parsed.data, failure("cancelled"));
    if (Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > definition.max_input_bytes) {
      return definition.failure(parsed.data, failure("invalid_request"));
    }

    const resolved = await this.options.registry.resolve(operationId, options.selectionPolicy ?? this.options.selectionPolicy);
    if (!resolved.ok) return definition.failure(parsed.data, resolved.failure);
    const sidecarIdentities = await this.resolveRequiredSidecars(resolved.provider, operationId, parsed.data, definition, resolved.selection);
    if (!sidecarIdentities.ok) {
      if (replayKey && replayDigest) this.idempotency.set(replayKey, { inputDigest: replayDigest, result: cloneResult(sidecarIdentities.result) });
      return sidecarIdentities.result;
    }
    const adapter = this.adapters[adapterKey(resolved.provider.package_id, resolved.provider.provider_component_id, operationId)];
    if (!adapter) {
      const providerFailure = failure("provider_unavailable");
      const result = definition.failure(parsed.data, providerFailure);
      this.recordReceipt(resolved.provider, operationId, parsed.data, result, providerFailure, resolved.selection);
      if (replayKey && replayDigest) this.idempotency.set(replayKey, { inputDigest: replayDigest, result: cloneResult(result) });
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
          package_generation: resolved.provider.package_generation,
          adapter_abi: resolved.provider.adapter_abi,
          required_sidecars: resolved.provider.required_sidecars,
          signal: controller.signal,
          bindingForRequiredSidecar: (sidecarComponentId) => {
            if (!resolved.provider.required_sidecars.includes(sidecarComponentId)) {
              throw new AppPlatformError("denied", "Sidecar binding is outside the selected operation scope", 403);
            }
            const expected = sidecarIdentities.identities.get(sidecarComponentId);
            if (!expected) throw new AppPlatformError("ambiguous_runtime_state", "Sidecar binding authority is unavailable");
            if (!this.options.bindingService) {
              throw new AppPlatformError("ambiguous_runtime_state", "Sidecar binding service is unavailable");
            }
            return this.options.bindingService.bindingForProviderAdapter(
              resolved.provider.package_id,
              sidecarComponentId,
              resolved.provider.provider_component_id,
              expected,
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
        if (replayKey && replayDigest) this.idempotency.set(replayKey, { inputDigest: replayDigest, result: cloneResult(parsedResult.data) });
        return parsedResult.data;
      }
      const providerFailure = failure("invalid_provider_response");
      const failureResult = definition.failure(parsed.data, providerFailure);
      this.recordReceipt(resolved.provider, operationId, parsed.data, failureResult, providerFailure, resolved.selection, "executed");
      if (replayKey && replayDigest) this.idempotency.set(replayKey, { inputDigest: replayDigest, result: cloneResult(failureResult) });
      return failureResult;
    } catch {
      const providerFailure = failure(timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "provider_unavailable");
      const result = definition.failure(parsed.data, providerFailure);
      this.recordReceipt(resolved.provider, operationId, parsed.data, result, providerFailure, resolved.selection, "executed");
      if (replayKey && replayDigest) this.idempotency.set(replayKey, { inputDigest: replayDigest, result: cloneResult(result) });
      return result;
    } finally {
      if (timer) clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
    }
  }

  private async resolveRequiredSidecars(
    provider: ResolvedProviderOperation,
    operationId: string,
    request: unknown,
    definition: ProviderOperationDefinition,
    providerSelection: "single_provider" | "owner_or_admin_policy",
  ): Promise<{ ok: true; identities: Map<string, ExpectedSidecarRuntimeIdentity> } | { ok: false; result: unknown }> {
    const identities = new Map<string, ExpectedSidecarRuntimeIdentity>();
    if (provider.required_sidecars.length === 0) return { ok: true, identities };
    if (!this.options.sidecarAuthority || !this.options.bindingService) {
      const providerFailure = failure("provider_unavailable");
      const result = definition.failure(request, providerFailure);
      this.recordReceipt(provider, operationId, request, result, providerFailure, providerSelection, "not_executed");
      return { ok: false, result };
    }
    try {
      for (const sidecarComponentId of provider.required_sidecars) {
        const expected = await this.options.sidecarAuthority.resolveRequiredSidecar({ provider, sidecarComponentId });
        this.options.bindingService.bindingForProviderAdapter(provider.package_id, sidecarComponentId, provider.provider_component_id, expected);
        identities.set(sidecarComponentId, expected);
      }
      return { ok: true, identities };
    } catch (error) {
      const providerFailure = failureForAuthorityError(error);
      const result = definition.failure(request, providerFailure);
      this.recordReceipt(provider, operationId, request, result, providerFailure, providerSelection, "not_executed");
      return { ok: false, result };
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
    package_generation: candidate.packageRecord.generation,
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

function failureForAuthorityError(error: unknown): ProviderOperationFailure {
  if (!(error instanceof AppPlatformError)) return failure("provider_unavailable");
  if (error.code === "readiness_failed" || error.code === "lifecycle_failed") return failure("provider_unhealthy");
  if (error.code === "host_incompatible") return failure("unsupported_target");
  if (error.code === "grant_missing" || error.code === "grant_revoked") return failure("not_authorized");
  if (error.code === "denied") return failure("provider_unavailable");
  return failure("provider_unavailable");
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

function idempotencyKey(operationId: string, key: string | null | undefined): string | null {
  const value = key?.trim();
  if (!value) return null;
  if (value.length < 16 || value.length > 256) return null;
  return `${operationId}:${value}`;
}

function cloneResult(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}
