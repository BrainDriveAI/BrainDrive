import type { z } from "zod";

import { ResumeDataCapabilityNameSchema } from "../app-platform/contracts/data-conformance.js";
import { CapabilityNameSchema } from "../app-platform/contracts/package.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";

export type AppDataCapability = z.infer<typeof ResumeDataCapabilityNameSchema>;
export type AppCapabilityName = z.infer<typeof CapabilityNameSchema>;
export type AppCapabilityDescriptor = {
  name: AppCapabilityName;
  version: 1;
  audience: "app_data" | "app_export" | "app_inference";
  effect: "read" | "mutation" | "export" | "inference";
  maxInputBytes: 262_144;
  maxDurationMs: 120_000;
};

const descriptor = (
  name: AppCapabilityName,
  audience: AppCapabilityDescriptor["audience"],
  effect: AppCapabilityDescriptor["effect"],
): AppCapabilityDescriptor => ({ name, version: 1, audience, effect, maxInputBytes: 262_144, maxDurationMs: 120_000 });

export const APP_CAPABILITY_REGISTRY: readonly AppCapabilityDescriptor[] = Object.freeze([
  descriptor("career.context.read", "app_data", "read"),
  descriptor("career.facts.read", "app_data", "read"),
  descriptor("career.facts.propose", "app_data", "mutation"),
  descriptor("career.facts.confirm", "app_data", "mutation"),
  descriptor("resume.definitions.read", "app_data", "read"),
  descriptor("resume.definitions.write", "app_data", "mutation"),
  descriptor("resume.jobs.read", "app_data", "read"),
  descriptor("resume.jobs.write", "app_data", "mutation"),
  descriptor("resume.artifacts.register", "app_data", "mutation"),
  descriptor("resume.export.request", "app_export", "export"),
  descriptor("resume.operations.read", "app_data", "read"),
  descriptor("app.inference.request", "app_inference", "inference"),
]);

const byName = new Map(APP_CAPABILITY_REGISTRY.map((entry) => [entry.name, entry]));

export function resolveAppCapability(rawName: unknown, rawVersion: unknown): AppCapabilityDescriptor {
  const name = CapabilityNameSchema.safeParse(rawName);
  if (!name.success) throw new AppPlatformError("denied", "Capability is unavailable", 403);
  const entry = byName.get(name.data);
  if (!entry) throw new AppPlatformError("denied", "Capability is unavailable", 403);
  if (rawVersion !== entry.version) throw new AppPlatformError("incompatible_schema", "Capability version is unavailable", 409);
  return entry;
}

export function assertCapabilityScope(installedScopes: readonly string[], requestedScopes: readonly string[]): void {
  const installed = new Set(installedScopes);
  if (new Set(requestedScopes).size !== requestedScopes.length || requestedScopes.some((scope) => !installed.has(scope))) {
    throw new AppPlatformError("denied", "Capability scope is unavailable", 403);
  }
}
