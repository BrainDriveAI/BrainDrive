import {
  AppRouteKeySchema,
  AppOperationBindingSchema,
  CanonicalAppIdSchema,
  FirstPartyAppRegistrationSchema,
  ResolvedAppDescriptorSchema,
  VerifiedFirstPartyPackageSchema,
  type FirstPartyAppRegistration,
  type ResolvedAppDescriptor,
} from "./contracts/app-registry.js";
import { canonicalInputDigest } from "./contracts/common.js";
import { ContractViolation } from "./contracts/errors.js";

function collisionKey(value: unknown): string | null {
  return typeof value === "string" ? value.normalize("NFKC").toLowerCase() : null;
}

function assertNoIdentityCollisions(registrations: readonly unknown[], field: "app_id" | "route_key"): void {
  const identities = new Map<string, string>();
  for (const candidate of registrations) {
    if (!candidate || typeof candidate !== "object") continue;
    const raw = (candidate as Record<string, unknown>)[field];
    const canonical = collisionKey(raw);
    if (canonical === null) continue;
    if (identities.has(canonical)) {
      throw new ContractViolation("duplicate_identity", `First-party app registry contains a colliding ${field}`);
    }
    identities.set(canonical, String(raw));
  }
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function key(name: string, version: number): string {
  return `${name}@${version}`;
}

export class FirstPartyAppRegistry {
  readonly #byAppId = new Map<string, FirstPartyAppRegistration>();
  readonly #byRouteKey = new Map<string, FirstPartyAppRegistration>();
  readonly #registrations: readonly FirstPartyAppRegistration[];

  constructor(rawRegistrations: readonly unknown[]) {
    assertNoIdentityCollisions(rawRegistrations, "app_id");
    assertNoIdentityCollisions(rawRegistrations, "route_key");
    let registrations: FirstPartyAppRegistration[];
    try {
      registrations = rawRegistrations.map((candidate) => deepFreeze(FirstPartyAppRegistrationSchema.parse(candidate)));
    } catch {
      throw new ContractViolation("descriptor_invalid", "First-party app registration violates the strict host contract");
    }
    registrations.sort((left, right) => left.app_id < right.app_id ? -1 : left.app_id > right.app_id ? 1 : 0);
    for (const registration of registrations) {
      this.#byAppId.set(registration.app_id, registration);
      this.#byRouteKey.set(registration.route_key, registration);
    }
    this.#registrations = deepFreeze(registrations);
  }

  listRegistrations(): readonly FirstPartyAppRegistration[] {
    return this.#registrations;
  }

  resolveAppId(rawAppId: unknown): FirstPartyAppRegistration {
    const parsed = CanonicalAppIdSchema.safeParse(rawAppId);
    const registration = parsed.success ? this.#byAppId.get(parsed.data) : undefined;
    if (!registration) throw new ContractViolation("registration_missing", "First-party app registration is unavailable");
    return registration;
  }

  resolveRouteKey(rawRouteKey: unknown): FirstPartyAppRegistration {
    const parsed = AppRouteKeySchema.safeParse(rawRouteKey);
    const registration = parsed.success ? this.#byRouteKey.get(parsed.data) : undefined;
    if (!registration) throw new ContractViolation("registration_missing", "First-party app route registration is unavailable");
    return registration;
  }

  resolveVerifiedApp(rawRouteKey: unknown, rawPackage: unknown, rawOperationBinding: unknown = null): ResolvedAppDescriptor {
    const registration = this.resolveRouteKey(rawRouteKey);
    const parsed = VerifiedFirstPartyPackageSchema.safeParse(rawPackage);
    if (!parsed.success) {
      throw new ContractViolation("descriptor_invalid", "Verified package descriptor violates the strict registration contract");
    }
    const verified = parsed.data;
    const operationBinding = rawOperationBinding === null ? null : AppOperationBindingSchema.safeParse(rawOperationBinding);
    if (operationBinding !== null && !operationBinding.success) {
      throw new ContractViolation("descriptor_invalid", "Operation binding violates the strict registration contract");
    }
    const manifest = verified.descriptor.manifest;
    if (
      verified.source_entry.source_id !== registration.package_source_id ||
      manifest.app_id !== registration.app_id ||
      manifest.publisher_id !== registration.publisher_id ||
      !manifest.primary_resource.uri.startsWith(`ui://${registration.route_key}/`)
    ) {
      throw new ContractViolation("identity_mismatch", "Verified package identity does not match the selected host registration");
    }

    const capabilityBindings = new Map(
      registration.capability_registrations.map((item) => [key(item.key.name, item.key.version), item]),
    );
    const purposeBindings = new Map(
      registration.inference_purpose_registrations.map((item) => [key(item.key.purpose_id, item.key.version), item]),
    );
    const capabilities = manifest.requested_capabilities.map((request) => capabilityBindings.get(key(request.name, request.version)));
    const inferencePurposes = manifest.requested_inference_purposes.map((request) => purposeBindings.get(key(request.purpose_id, request.version)));
    if (
      capabilities.some((binding) => binding === undefined) ||
      inferencePurposes.some((binding) => binding === undefined) ||
      registration.data_adapter_registration.data_contract_version !== manifest.compatibility.data_contract_version
    ) {
      throw new ContractViolation("registration_missing", "Package request has no exact reviewed host registration");
    }

    const body = {
      resolved_descriptor_version: 1 as const,
      app_id: registration.app_id,
      publisher_id: registration.publisher_id,
      route_key: registration.route_key,
      package: {
        source_id: registration.package_source_id,
        package_version: manifest.package_version,
        descriptor_digest: verified.descriptor.descriptor_digest,
        manifest_digest: verified.descriptor.manifest_digest,
        package_digest: verified.descriptor.archive_digest,
      },
      catalog: manifest.catalog,
      runtime_profile_id: registration.runtime_profile_id,
      lifecycle_binding_id: registration.lifecycle_binding_id,
      operation_binding: operationBinding === null ? null : operationBinding.data,
      resources: { primary: manifest.primary_resource },
      compatibility: manifest.compatibility,
      requested_authority: {
        capabilities: manifest.requested_capabilities,
        inference_purposes: manifest.requested_inference_purposes,
        data_contract_version: manifest.compatibility.data_contract_version,
      },
      reviewed_authority: {
        capabilities: capabilities as FirstPartyAppRegistration["capability_registrations"],
        inference_purposes: inferencePurposes as FirstPartyAppRegistration["inference_purpose_registrations"],
        data_adapter: registration.data_adapter_registration,
      },
    };
    return deepFreeze(ResolvedAppDescriptorSchema.parse({ ...body, descriptor_digest: canonicalInputDigest(body) }));
  }
}
