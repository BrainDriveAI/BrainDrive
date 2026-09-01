import { z } from "zod";

import { SemverSchema, TimestampSchema } from "../../app-platform/contracts/common.js";

export const InternetSearchOperationIdSchema = z.enum(["web.search@1", "web.read@1"]);
export const InternetSearchCapabilityIdSchema = z.literal("internet-search");
export const InternetSearchProviderInternalIdSchema = z.literal("searxng-local");
export const InternetSearchPublicProviderProfileIdSchema = z.literal("local-owner-managed");

export const InternetSearchDiscoveryStateSchema = z.enum([
  "available",
  "unavailable",
  "disabled",
  "unhealthy",
  "unauthorized",
]);

export const InternetSearchLifecycleStateSchema = z.enum([
  "available",
  "unavailable",
  "disabled",
  "starting",
  "stopped",
]);

export const InternetSearchHealthStateSchema = z.enum(["healthy", "unhealthy", "unknown"]);

const unsafeProjectionPattern =
  /(?:https?:|localhost|127\.|0\.0\.0\.0|\bport\b|credential|secret|vault|\/(?:home|tmp|etc|var|Users)\/)/i;

export function assertSafeDiscoveryProjection(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (unsafeProjectionPattern.test(serialized)) {
    throw new Error("Internet Search discovery projection contains unsafe provider details");
  }
}

const SafeDiscoveryTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !unsafeProjectionPattern.test(value), "discovery text must not expose provider internals");

export const InternetSearchOperationDescriptorSchema = z
  .object({
    operation_id: InternetSearchOperationIdSchema,
    capability: z.enum(["web.search", "web.read"]),
    version: z.literal(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.operation_id === "web.search@1" && value.capability !== "web.search") {
      context.addIssue({ code: "custom", message: "operation capability mismatch", path: ["capability"] });
    }
    if (value.operation_id === "web.read@1" && value.capability !== "web.read") {
      context.addIssue({ code: "custom", message: "operation capability mismatch", path: ["capability"] });
    }
  });

export const InternetSearchProviderProfileProjectionSchema = z
  .object({
    profile_id: InternetSearchPublicProviderProfileIdSchema,
    display_name: SafeDiscoveryTextSchema.max(80),
    management: z.enum(["owner_managed_local", "braindrive_managed"]),
    billing: z.enum(["none", "braindrive_credits"]),
    disclosure: z
      .object({
        last_reviewed_at: TimestampSchema.nullable(),
        summary: SafeDiscoveryTextSchema.max(256),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    try {
      assertSafeDiscoveryProjection(value);
    } catch {
      context.addIssue({ code: "custom", message: "provider projection contains unsafe details" });
    }
  });

export const InternetSearchCapabilitySummarySchema = z
  .object({
    capability_id: InternetSearchCapabilityIdSchema,
    version: SemverSchema,
    operations: z.array(InternetSearchOperationDescriptorSchema).min(1).max(2),
  })
  .strict();

export const InternetSearchHealthProjectionSchema = z
  .object({
    state: InternetSearchHealthStateSchema,
    checked_at: TimestampSchema.nullable(),
  })
  .strict();

export const InternetSearchGrantProjectionSchema = z
  .object({
    required: z.literal(true),
    authorized: z.boolean(),
  })
  .strict();

export const InternetSearchCapabilityDiscoverySchema = z
  .object({
    discovery_version: z.literal(1),
    operation_id: InternetSearchOperationIdSchema,
    state: InternetSearchDiscoveryStateSchema,
    callable: z.boolean(),
    capability: InternetSearchCapabilitySummarySchema.nullable(),
    provider_profile: InternetSearchProviderProfileProjectionSchema.nullable(),
    health: InternetSearchHealthProjectionSchema.nullable(),
    grant: InternetSearchGrantProjectionSchema,
    message: SafeDiscoveryTextSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === "available" && !value.callable) {
      context.addIssue({ code: "custom", message: "available discovery must be callable", path: ["callable"] });
    }
    if (value.state !== "available" && value.callable) {
      context.addIssue({ code: "custom", message: "unavailable discovery cannot be callable", path: ["callable"] });
    }
    if (value.state === "unauthorized" && (value.capability || value.provider_profile || value.health)) {
      context.addIssue({ code: "custom", message: "unauthorized discovery must not enumerate capability details" });
    }
    try {
      assertSafeDiscoveryProjection(value);
    } catch {
      context.addIssue({ code: "custom", message: "discovery projection contains unsafe provider details" });
    }
  });

export type InternetSearchOperationId = z.infer<typeof InternetSearchOperationIdSchema>;
export type InternetSearchDiscoveryState = z.infer<typeof InternetSearchDiscoveryStateSchema>;
export type InternetSearchLifecycleState = z.infer<typeof InternetSearchLifecycleStateSchema>;
export type InternetSearchHealthState = z.infer<typeof InternetSearchHealthStateSchema>;
export type InternetSearchOperationDescriptor = z.infer<typeof InternetSearchOperationDescriptorSchema>;
export type InternetSearchProviderProfileProjection = z.infer<typeof InternetSearchProviderProfileProjectionSchema>;
export type InternetSearchCapabilityDiscovery = z.infer<typeof InternetSearchCapabilityDiscoverySchema>;
