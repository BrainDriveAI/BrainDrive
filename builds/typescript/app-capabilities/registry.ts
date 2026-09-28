import type { z } from "zod";

import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import { CanonicalAppIdSchema, CapabilityIdentifierSchema } from "../app-platform/contracts/app-registry.js";


export type HostCapabilityContext = {
  appId: string;
  installationId: string;
  packageDigest: `sha256:${string}`;
  connectionId: string | null;
  viewId: string | null;
  sessionId: string | null;
  lifecycleGeneration?: number;
  grantId?: string;
  grantRevision?: number;
  revocationGeneration?: number;
  operationId: string;
  idempotencyKey: string;
  deadlineAt: number;
  requestedPurposes: readonly { purpose_id: string; version: number }[];
  grant: {
    app_id: string; installation_id: string; package_digest: string; capabilities: readonly string[];
    revoked_at: string | null; expires_at: string;
  };
  signal: AbortSignal;
  isCancelled: () => boolean;
  ownerConfirmation: { confirmed: boolean; proofId?: string };
};

export type HostCapabilityRegistration<I = unknown, O = unknown> = {
  appId: string;
  name: string;
  version: number;
  audience: "app_data" | "app_export" | "app_inference";
  effect: "read" | "mutation" | "export" | "inference";
  inputSchema: z.ZodType<I>;
  resultSchema: z.ZodType<O>;
  limits: { maxInputBytes: number; maxDurationMs: number; maxCallsPerMinute: number };
  confirmation: "none" | "owner_confirmation" | "trusted_owner_confirmation";
  confirmationProjection: { title: string; actionLabel: string } | null;
  auditProjectionId: string;
  retryPolicy: "never" | "idempotent_only";
  idempotencyPolicy: "not_applicable" | "optional" | "required";
  ownerComponentId: string;
  handler: { bivarianceHack(input: I, context: HostCapabilityContext): Promise<O> }["bivarianceHack"];
};

function hostKey(appId: string, name: string, version: number): string {
  return `${appId}:${name}@${version}`;
}

/** Host-owned executable registry. Package metadata can request these keys but cannot add handlers. */
export class CapabilityRegistry {
  readonly #entries = new Map<string, HostCapabilityRegistration>();

  constructor(registrations: readonly HostCapabilityRegistration[]) {
    for (const raw of registrations) {
      const appId = CanonicalAppIdSchema.safeParse(raw.appId);
      const name = CapabilityIdentifierSchema.safeParse(raw.name);
      const validLimits = raw.limits && Object.values(raw.limits).every((value) => Number.isInteger(value) && value > 0);
      const validSchemas = typeof raw.inputSchema?.safeParse === "function" && typeof raw.resultSchema?.safeParse === "function";
      const validOwnedIds = [raw.auditProjectionId, raw.ownerComponentId].every((value) => typeof value === "string" && value.trim().length > 0 && value.length <= 128);
      if (!appId.success || !name.success || !Number.isInteger(raw.version) || raw.version < 1 || raw.version > 65_535 || !validLimits || !validSchemas || !validOwnedIds || typeof raw.handler !== "function") {
        throw new AppPlatformError("descriptor_invalid", "Capability registration is invalid");
      }
      if (raw.confirmation === "none" ? raw.confirmationProjection !== null : raw.confirmationProjection === null) {
        throw new AppPlatformError("descriptor_invalid", "Capability confirmation policy is incomplete");
      }
      if (raw.confirmationProjection && Object.values(raw.confirmationProjection).some((value) => typeof value !== "string" || value.trim().length === 0 || value.length > 256)) {
        throw new AppPlatformError("descriptor_invalid", "Capability confirmation projection is invalid");
      }
      const key = hostKey(appId.data, name.data, raw.version);
      if (this.#entries.has(key)) throw new AppPlatformError("duplicate_identity", "Capability registration identity is duplicated", 409);
      this.#entries.set(key, Object.freeze({ ...raw, appId: appId.data, name: name.data }));
    }
  }

  resolve(appIdInput: unknown, nameInput: unknown, versionInput: unknown): HostCapabilityRegistration {
    const appId = CanonicalAppIdSchema.safeParse(appIdInput);
    const name = CapabilityIdentifierSchema.safeParse(nameInput);
    if (!appId.success || !name.success) throw new AppPlatformError("denied", "Capability is unavailable", 403);
    if (!Number.isInteger(versionInput) || (versionInput as number) < 1) throw new AppPlatformError("incompatible_schema", "Capability version is unavailable", 409);
    const entry = this.#entries.get(hostKey(appId.data, name.data, versionInput as number));
    if (entry) return entry;
    const sameName = [...this.#entries.values()].some((candidate) => candidate.appId === appId.data && candidate.name === name.data);
    throw new AppPlatformError(sameName ? "incompatible_schema" : "denied", sameName ? "Capability version is unavailable" : "Capability is unavailable", sameName ? 409 : 403);
  }
}

export function assertCapabilityScope(installedScopes: readonly string[], requestedScopes: readonly string[]): void {
  const installed = new Set(installedScopes);
  if (new Set(requestedScopes).size !== requestedScopes.length || requestedScopes.some((scope) => !installed.has(scope))) {
    throw new AppPlatformError("denied", "Capability scope is unavailable", 403);
  }
}
