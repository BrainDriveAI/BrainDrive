import {
  InternetSearchCapabilityDiscoverySchema,
  InternetSearchCapabilityIdSchema,
  InternetSearchHealthProjectionSchema,
  InternetSearchLifecycleStateSchema,
  InternetSearchOperationDescriptorSchema,
  InternetSearchOperationIdSchema,
  InternetSearchProviderInternalIdSchema,
  InternetSearchProviderProfileProjectionSchema,
  type InternetSearchCapabilityDiscovery,
  type InternetSearchDiscoveryState,
  type InternetSearchHealthState,
  type InternetSearchOperationDescriptor,
  type InternetSearchOperationId,
  type InternetSearchProviderProfileProjection,
} from "./contracts/index.js";
import type { SearxngSidecarSnapshot } from "./sidecar.js";

export type InstalledInternetSearchCapabilityRegistration = {
  capability_id: "internet-search";
  capability_version: string;
  provider: {
    internal_profile_id: "searxng-local";
    projection: InternetSearchProviderProfileProjection;
  };
  operations: readonly InternetSearchOperationDescriptor[];
  enabled: boolean;
  lifecycle_state: "available" | "unavailable" | "disabled" | "starting" | "stopped";
  health: { state: InternetSearchHealthState; checked_at: string | null };
  safe_message: string;
};

export type InternetSearchCapabilityStatusProvider = {
  snapshot(): SearxngSidecarSnapshot;
  refresh?(): Promise<SearxngSidecarSnapshot>;
};

export const INTERNET_SEARCH_OPERATIONS = Object.freeze([
  { operation_id: "web.search@1", capability: "web.search", version: 1 },
  { operation_id: "web.read@1", capability: "web.read", version: 1 },
] satisfies readonly InternetSearchOperationDescriptor[]);

export const INTERNET_SEARCH_LOCAL_V1_REGISTRATION = Object.freeze({
  capability_id: "internet-search",
  capability_version: "0.1.0",
  provider: {
    internal_profile_id: "searxng-local",
    projection: {
      profile_id: "local-owner-managed",
      display_name: "Local Internet Search",
      management: "owner_managed_local",
      billing: "none",
      disclosure: {
        last_reviewed_at: "2026-09-01T00:00:00.000Z",
        summary: "Use is mediated by the local owner-managed Internet Search profile.",
      },
    },
  },
  operations: INTERNET_SEARCH_OPERATIONS,
  enabled: true,
  lifecycle_state: "unavailable",
  health: { state: "unknown", checked_at: null },
  safe_message: "Internet Search is installed but not ready.",
} satisfies InstalledInternetSearchCapabilityRegistration);

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export class InternetSearchCapabilityRegistry {
  readonly #registrations: readonly InstalledInternetSearchCapabilityRegistration[];
  readonly #byOperation = new Map<InternetSearchOperationId, InstalledInternetSearchCapabilityRegistration>();
  readonly #statusProvider: InternetSearchCapabilityStatusProvider | null;

  constructor(
    registrations: readonly InstalledInternetSearchCapabilityRegistration[] = [INTERNET_SEARCH_LOCAL_V1_REGISTRATION],
    options: { statusProvider?: InternetSearchCapabilityStatusProvider | null } = {},
  ) {
    this.#statusProvider = options.statusProvider ?? null;
    const normalized: InstalledInternetSearchCapabilityRegistration[] = [];
    for (const registration of registrations) {
      this.validateRegistration(registration);
      const frozen = deepFreeze({ ...registration, operations: [...registration.operations] });
      normalized.push(frozen);
      for (const operation of frozen.operations) {
        if (this.#byOperation.has(operation.operation_id)) {
          throw new Error("Internet Search operation authority is duplicated");
        }
        this.#byOperation.set(operation.operation_id, frozen);
      }
    }
    this.#registrations = deepFreeze(normalized);
  }

  listRegistrations(): readonly InstalledInternetSearchCapabilityRegistration[] {
    return this.#registrations
      .map((registration) => this.applyStatus(registration))
      .filter((registration): registration is InstalledInternetSearchCapabilityRegistration => Boolean(registration));
  }

  async refresh(): Promise<void> {
    await this.#statusProvider?.refresh?.();
  }

  discover(operationIdInput: unknown, options: { authorized: boolean }): InternetSearchCapabilityDiscovery {
    const parsedOperation = InternetSearchOperationIdSchema.safeParse(operationIdInput);
    if (!parsedOperation.success) {
      throw new Error("Invalid Internet Search operation id");
    }
    const operationId = parsedOperation.data;
    if (!options.authorized) return unauthorizedProjection(operationId);

    const baseRegistration = this.#byOperation.get(operationId);
    const registration = baseRegistration ? this.applyStatus(baseRegistration) : null;
    if (!registration) {
      return InternetSearchCapabilityDiscoverySchema.parse({
        discovery_version: 1,
        operation_id: operationId,
        state: "unavailable",
        callable: false,
        capability: null,
        provider_profile: null,
        health: null,
        grant: { required: true, authorized: true },
        message: "Internet Search is not installed.",
      });
    }

    const state = discoveryState(registration);
    return InternetSearchCapabilityDiscoverySchema.parse({
      discovery_version: 1,
      operation_id: operationId,
      state,
      callable: state === "available",
      capability: {
        capability_id: registration.capability_id,
        version: registration.capability_version,
        operations: registration.operations,
      },
      provider_profile: registration.provider.projection,
      health: registration.health,
      grant: { required: true, authorized: true },
      message: messageForState(state, registration),
    });
  }

  private validateRegistration(registration: InstalledInternetSearchCapabilityRegistration): void {
    InternetSearchCapabilityIdSchema.parse(registration.capability_id);
    InternetSearchProviderInternalIdSchema.parse(registration.provider.internal_profile_id);
    InternetSearchProviderProfileProjectionSchema.parse(registration.provider.projection);
    InternetSearchLifecycleStateSchema.parse(registration.lifecycle_state);
    InternetSearchHealthProjectionSchema.parse(registration.health);
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(registration.capability_version)) {
      throw new Error("Internet Search capability version is invalid");
    }
    if (registration.operations.length === 0) {
      throw new Error("Internet Search registration must declare operations");
    }
    for (const operation of registration.operations) {
      InternetSearchOperationDescriptorSchema.parse(operation);
    }
    if (typeof registration.enabled !== "boolean" || typeof registration.safe_message !== "string" || registration.safe_message.trim().length === 0) {
      throw new Error("Internet Search registration is invalid");
    }
  }

  private applyStatus(registration: InstalledInternetSearchCapabilityRegistration): InstalledInternetSearchCapabilityRegistration | null {
    const status = this.#statusProvider?.snapshot();
    if (!status) return registration;
    if (!status.installed) return null;
    return {
      ...registration,
      enabled: status.enabled,
      lifecycle_state: status.lifecycle_state,
      health: status.health,
      safe_message: status.safe_message,
    };
  }
}

export function createDefaultInternetSearchCapabilityRegistry(options: { statusProvider?: InternetSearchCapabilityStatusProvider | null } = {}): InternetSearchCapabilityRegistry {
  return new InternetSearchCapabilityRegistry([INTERNET_SEARCH_LOCAL_V1_REGISTRATION], options);
}

function unauthorizedProjection(operationId: InternetSearchOperationId): InternetSearchCapabilityDiscovery {
  return InternetSearchCapabilityDiscoverySchema.parse({
    discovery_version: 1,
    operation_id: operationId,
    state: "unauthorized",
    callable: false,
    capability: null,
    provider_profile: null,
    health: null,
    grant: { required: true, authorized: false },
    message: "Capability authorization is required.",
  });
}

function discoveryState(registration: InstalledInternetSearchCapabilityRegistration): InternetSearchDiscoveryState {
  if (!registration.enabled || registration.lifecycle_state === "disabled") return "disabled";
  if (registration.health.state === "unhealthy") return "unhealthy";
  if (registration.lifecycle_state !== "available" || registration.health.state !== "healthy") return "unavailable";
  return "available";
}

function messageForState(
  state: InternetSearchDiscoveryState,
  registration: InstalledInternetSearchCapabilityRegistration,
): string {
  if (state === "disabled") return "Internet Search is disabled.";
  if (state === "unhealthy") return registration.safe_message || "Internet Search needs attention.";
  if (state === "unavailable") return registration.safe_message || "Internet Search is unavailable.";
  return registration.safe_message || "Internet Search is available.";
}
