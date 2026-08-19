import type { z } from "zod";

import { ResumeDataCapabilityNameSchema } from "../app-platform/contracts/data-conformance.js";
import { CapabilityNameSchema } from "../app-platform/contracts/package.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";

export type AppDataCapability = z.infer<typeof ResumeDataCapabilityNameSchema>;
export type ResumeAppCapabilityName = z.infer<typeof CapabilityNameSchema>;
export type AppCapabilityDescriptor = {
  name: ResumeAppCapabilityName; version: 1; audience: "app_data" | "app_export" | "app_inference";
  effect: "read" | "mutation" | "export" | "inference"; maxInputBytes: 262_144; maxDurationMs: 120_000;
  maxCallsPerMinute: 60; inputSchemaId: string; resultSchemaId: string;
  confirmation: "none" | "owner_confirmation" | "trusted_owner_confirmation"; auditProjectionId: string;
  retryPolicy: "idempotent_only"; idempotencyPolicy: "optional" | "required";
  ownerComponentId: "resume-domain" | "resume-inference" | "resume-export";
};

const descriptor = (name: ResumeAppCapabilityName, audience: AppCapabilityDescriptor["audience"], effect: AppCapabilityDescriptor["effect"]): AppCapabilityDescriptor => Object.freeze({
  name, version: 1, audience, effect, maxInputBytes: 262_144, maxDurationMs: 120_000, maxCallsPerMinute: 60,
  inputSchemaId: `${name}.input.v1`, resultSchemaId: `${name}.result.v1`,
  confirmation: name === "resume.export.request" ? "trusted_owner_confirmation" : name === "career.facts.confirm" || effect === "mutation" ? "owner_confirmation" : "none",
  auditProjectionId: `${name}.audit.v1`, retryPolicy: "idempotent_only", idempotencyPolicy: effect === "read" ? "optional" : "required",
  ownerComponentId: audience === "app_inference" ? "resume-inference" : audience === "app_export" ? "resume-export" : "resume-domain",
});

export const RESUME_CAPABILITY_REGISTRATIONS: readonly AppCapabilityDescriptor[] = Object.freeze([
  descriptor("career.context.read", "app_data", "read"), descriptor("career.facts.read", "app_data", "read"),
  descriptor("career.facts.propose", "app_data", "mutation"), descriptor("career.facts.confirm", "app_data", "mutation"),
  descriptor("resume.definitions.read", "app_data", "read"), descriptor("resume.definitions.write", "app_data", "mutation"),
  descriptor("resume.jobs.read", "app_data", "read"), descriptor("resume.jobs.write", "app_data", "mutation"),
  descriptor("resume.artifacts.register", "app_data", "mutation"), descriptor("resume.export.request", "app_export", "export"),
  descriptor("resume.operations.read", "app_data", "read"), descriptor("app.inference.request", "app_inference", "inference"),
]);

/** @deprecated Resume-only compatibility name. */
export const APP_CAPABILITY_REGISTRY = RESUME_CAPABILITY_REGISTRATIONS;
const byName = new Map(RESUME_CAPABILITY_REGISTRATIONS.map((entry) => [entry.name, entry]));
export function resolveResumeCapability(rawName: unknown, rawVersion: unknown): AppCapabilityDescriptor {
  const name = CapabilityNameSchema.safeParse(rawName);
  if (!name.success) throw new AppPlatformError("denied", "Capability is unavailable", 403);
  const entry = byName.get(name.data);
  if (!entry) throw new AppPlatformError("denied", "Capability is unavailable", 403);
  if (rawVersion !== entry.version) throw new AppPlatformError("incompatible_schema", "Capability version is unavailable", 409);
  return entry;
}
/** @deprecated Resume-only compatibility resolver. */
export const resolveAppCapability = resolveResumeCapability;
