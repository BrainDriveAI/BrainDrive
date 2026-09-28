import { z } from "zod";

import { OpaqueIdSchema, Sha256DigestSchema, TimestampSchema } from "./common.js";
import { RESUME_BUILDER_APP_ID } from "./constants.js";

export const AppLifecycleStorageClassSchema = z.enum([
  "host_lifecycle_state",
  "verified_package",
  "non_executable_staging",
  "disposable_app_cache",
  "durable_owner_data",
  "external_owner_export",
  "host_secret",
]);

export const AppLifecycleStoragePolicySchema = z
  .array(
    z
      .object({
        storage_class: AppLifecycleStorageClassSchema,
        root_ref: z.enum([
          "host_app_state",
          "host_app_packages",
          "host_app_staging",
          "host_app_cache",
          "owner_memory",
          "owner_exports",
          "host_vault",
        ]),
        authority: z.enum(["host_only", "host_mediated_owner_data", "owner_external", "vault_only"]),
        execution_policy: z.enum(["never", "verified_immutable_only"]),
        uninstall_policy: z.enum([
          "retain_minimal_tombstone",
          "remove_reference_and_unshared_bytes",
          "remove",
          "preserve",
          "outside_app_deletion",
        ]),
      })
      .strict(),
  )
  .length(7)
  .superRefine((value, context) => {
    if (new Set(value.map((entry) => entry.storage_class)).size !== value.length) {
      context.addIssue({ code: "custom", message: "storage classes must be unique" });
    }
    if (new Set(value.map((entry) => entry.root_ref)).size !== value.length) {
      context.addIssue({ code: "custom", message: "storage roots must remain distinct" });
    }
  });

export const APP_LIFECYCLE_STORAGE_POLICY = AppLifecycleStoragePolicySchema.parse([
  { storage_class: "host_lifecycle_state", root_ref: "host_app_state", authority: "host_only", execution_policy: "never", uninstall_policy: "retain_minimal_tombstone" },
  { storage_class: "verified_package", root_ref: "host_app_packages", authority: "host_only", execution_policy: "verified_immutable_only", uninstall_policy: "remove_reference_and_unshared_bytes" },
  { storage_class: "non_executable_staging", root_ref: "host_app_staging", authority: "host_only", execution_policy: "never", uninstall_policy: "remove" },
  { storage_class: "disposable_app_cache", root_ref: "host_app_cache", authority: "host_only", execution_policy: "never", uninstall_policy: "remove" },
  { storage_class: "durable_owner_data", root_ref: "owner_memory", authority: "host_mediated_owner_data", execution_policy: "never", uninstall_policy: "preserve" },
  { storage_class: "external_owner_export", root_ref: "owner_exports", authority: "owner_external", execution_policy: "never", uninstall_policy: "outside_app_deletion" },
  { storage_class: "host_secret", root_ref: "host_vault", authority: "vault_only", execution_policy: "never", uninstall_policy: "outside_app_deletion" },
]);

export const MixedVersionPolicySchema = z
  .object({
    policy_version: z.literal(1),
    missing_lifecycle_state: z.literal("read_as_not_installed"),
    known_same_version: z.literal("read_and_validate"),
    unknown_or_newer_contract: z.literal("fail_closed_without_execution"),
    incompatible_owner_data: z.literal("preserve_and_require_compatible_version_or_export"),
    fixed_mcp_services: z.literal("remain_available"),
    destructive_downgrade: z.literal("prohibited"),
  })
  .strict();

export const MIXED_VERSION_POLICY = MixedVersionPolicySchema.parse({
  policy_version: 1,
  missing_lifecycle_state: "read_as_not_installed",
  known_same_version: "read_and_validate",
  unknown_or_newer_contract: "fail_closed_without_execution",
  incompatible_owner_data: "preserve_and_require_compatible_version_or_export",
  fixed_mcp_services: "remain_available",
  destructive_downgrade: "prohibited",
});

const DataAdapterContextSchema = z
  .object({
    adapter_contract_version: z.literal(1),
    operation_id: OpaqueIdSchema,
    owner_id: OpaqueIdSchema,
    installation_id: OpaqueIdSchema,
    app_id: z.literal(RESUME_BUILDER_APP_ID),
    package_digest: Sha256DigestSchema,
    requested_at: TimestampSchema,
  })
  .strict();

const SchemaVersionSchema = z.number().int().positive();

export const ResumeLifecycleDataAdapterRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inspect_schema"), context: DataAdapterContextSchema }).strict(),
  z.object({ action: z.literal("discover_retained_data"), context: DataAdapterContextSchema }).strict(),
  z.object({ action: z.literal("snapshot"), context: DataAdapterContextSchema, from_schema_version: SchemaVersionSchema, to_schema_version: SchemaVersionSchema }).strict(),
  z.object({ action: z.literal("migrate"), context: DataAdapterContextSchema, snapshot_id: OpaqueIdSchema, from_schema_version: SchemaVersionSchema, to_schema_version: SchemaVersionSchema }).strict(),
  z.object({ action: z.literal("restore"), context: DataAdapterContextSchema, snapshot_id: OpaqueIdSchema }).strict(),
]);

export const ResumeLifecycleDataAdapterResultSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("inspect_schema"),
      outcome: z.enum(["missing", "compatible", "incompatible", "repair_required"]),
      observed_schema_version: SchemaVersionSchema.nullable(),
      readable: z.boolean(),
      writable: z.boolean(),
      content_digest: Sha256DigestSchema.nullable(),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.outcome === "missing" && (value.observed_schema_version !== null || value.content_digest !== null || value.readable || value.writable)) {
        context.addIssue({ code: "custom", message: "missing owner data cannot claim schema authority" });
      }
      if (value.outcome === "compatible" && (value.observed_schema_version === null || value.content_digest === null || !value.readable || !value.writable)) {
        context.addIssue({ code: "custom", message: "compatible owner data must be readable, writable, and digest-bound" });
      }
      if (["incompatible", "repair_required"].includes(value.outcome) && (value.readable || value.writable)) {
        context.addIssue({ code: "custom", message: "unsafe owner data cannot be exposed as readable or writable" });
      }
    }),
  z
    .object({
      action: z.literal("discover_retained_data"),
      present: z.boolean(),
      schema_version: SchemaVersionSchema.nullable(),
      compatible: z.boolean(),
      data_ref: OpaqueIdSchema.nullable(),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.present !== (value.schema_version !== null && value.data_ref !== null)) {
        context.addIssue({ code: "custom", message: "retained-data discovery result is ambiguous" });
      }
      if (!value.present && value.compatible) {
        context.addIssue({ code: "custom", message: "missing retained data cannot claim compatibility" });
      }
    }),
  z.object({ action: z.literal("snapshot"), snapshot_id: OpaqueIdSchema, snapshot_digest: Sha256DigestSchema, schema_version: SchemaVersionSchema }).strict(),
  z.object({ action: z.literal("migrate"), migration_id: OpaqueIdSchema, snapshot_id: OpaqueIdSchema, from_schema_version: SchemaVersionSchema, to_schema_version: SchemaVersionSchema, result_digest: Sha256DigestSchema }).strict(),
  z.object({ action: z.literal("restore"), snapshot_id: OpaqueIdSchema, restored_schema_version: SchemaVersionSchema, restored_digest: Sha256DigestSchema }).strict(),
]);

export const RESUME_LIFECYCLE_DATA_ADAPTER_METHODS = [
  "inspectSchema",
  "discoverRetainedData",
  "snapshot",
  "migrate",
  "restore",
] as const;

type DataAdapterRequest = z.infer<typeof ResumeLifecycleDataAdapterRequestSchema>;
type DataAdapterResult = z.infer<typeof ResumeLifecycleDataAdapterResultSchema>;

export interface ResumeLifecycleDataAdapter {
  inspectSchema(request: Extract<DataAdapterRequest, { action: "inspect_schema" }>): Promise<Extract<DataAdapterResult, { action: "inspect_schema" }>>;
  discoverRetainedData(request: Extract<DataAdapterRequest, { action: "discover_retained_data" }>): Promise<Extract<DataAdapterResult, { action: "discover_retained_data" }>>;
  snapshot(request: Extract<DataAdapterRequest, { action: "snapshot" }>): Promise<Extract<DataAdapterResult, { action: "snapshot" }>>;
  migrate(request: Extract<DataAdapterRequest, { action: "migrate" }>): Promise<Extract<DataAdapterResult, { action: "migrate" }>>;
  restore(request: Extract<DataAdapterRequest, { action: "restore" }>): Promise<Extract<DataAdapterResult, { action: "restore" }>>;
}
