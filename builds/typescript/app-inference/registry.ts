import type { z } from "zod";

import { CanonicalAppIdSchema, InferencePurposeIdentifierSchema } from "../app-platform/contracts/app-registry.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";

export type AppInferenceExecutorContext = {
  appId: string;
  installationId: string;
  packageDigest: `sha256:${string}`;
  operationId: string;
  idempotencyKey: string;
  deadlineAt: number;
  signal: AbortSignal;
};

export type AppInferencePurposeRegistration<I = unknown, O = unknown> = {
  appId: string;
  purposeId: string;
  version: number;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  promptPolicyId: string;
  modelCompatibilityClass: "owner_active_compatible";
  limits: { maxInputBytes: number; maxInputTokens: number; maxOutputTokens: number; maxDurationMs: number; maxAttempts: number };
  validationPolicyId: string;
  retryPolicy: "same_snapshot_only";
  cancellationPolicy: "required";
  auditProjectionId: string;
  ownerComponentId: string;
  executor: { bivarianceHack(input: I, context: AppInferenceExecutorContext): Promise<O> }["bivarianceHack"];
};

function key(appId: string, purposeId: string, version: number): string {
  return `${appId}:${purposeId}@${version}`;
}

export class AppInferencePurposeRegistry {
  readonly #entries = new Map<string, AppInferencePurposeRegistration>();

  constructor(entries: readonly AppInferencePurposeRegistration[]) {
    for (const raw of entries) {
      const appId = CanonicalAppIdSchema.safeParse(raw.appId);
      const purposeId = InferencePurposeIdentifierSchema.safeParse(raw.purposeId);
      const validLimits = raw.limits && Object.values(raw.limits).every((value) => Number.isInteger(value) && value > 0);
      const validSchemas = typeof raw.inputSchema?.safeParse === "function" && typeof raw.outputSchema?.safeParse === "function";
      const validOwnedIds = [raw.promptPolicyId, raw.validationPolicyId, raw.auditProjectionId, raw.ownerComponentId]
        .every((value) => typeof value === "string" && value.trim().length > 0 && value.length <= 128);
      if (!appId.success || !purposeId.success || !Number.isInteger(raw.version) || raw.version < 1 || raw.version > 65_535 || !validLimits || !validSchemas || !validOwnedIds || typeof raw.executor !== "function") {
        throw new AppPlatformError("descriptor_invalid", "Inference purpose registration is invalid");
      }
      const identity = key(appId.data, purposeId.data, raw.version);
      if (this.#entries.has(identity)) throw new AppPlatformError("duplicate_identity", "Inference purpose registration identity is duplicated", 409);
      this.#entries.set(identity, Object.freeze({ ...raw, appId: appId.data, purposeId: purposeId.data }));
    }
  }

  resolve(appIdInput: unknown, purposeInput: unknown, versionInput: unknown): AppInferencePurposeRegistration {
    const appId = CanonicalAppIdSchema.safeParse(appIdInput);
    const purposeId = InferencePurposeIdentifierSchema.safeParse(purposeInput);
    if (!appId.success || !purposeId.success) throw new AppPlatformError("denied", "Inference purpose is unavailable", 403);
    if (!Number.isInteger(versionInput) || (versionInput as number) < 1) throw new AppPlatformError("incompatible_schema", "Inference purpose version is unavailable", 409);
    const entry = this.#entries.get(key(appId.data, purposeId.data, versionInput as number));
    if (entry) return entry;
    const known = [...this.#entries.values()].some((candidate) => candidate.appId === appId.data && candidate.purposeId === purposeId.data);
    throw new AppPlatformError(known ? "incompatible_schema" : "denied", known ? "Inference purpose version is unavailable" : "Inference purpose is unavailable", known ? 409 : 403);
  }
}
