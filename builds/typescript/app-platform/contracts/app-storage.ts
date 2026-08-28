import { z } from "zod";

import {
  OpaqueIdSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from "./common.js";

const canonicalDottedIdentifier = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;

export const AppStorageRecordKindSchema = z.enum(["document", "state"]);

export const AppDocumentRoleSchema = z.enum([
  "source_document",
  "derived_document",
  "recovery_document",
  "action_result_document",
  "app_state",
]);

export const AppStorageRetentionClassSchema = z.enum([
  "durable_owner_data",
  "durable_provenance_while_referenced",
  "durable_operation_lookup",
  "rollback_recovery_window",
  "disposable_preview_cache",
  "transient_abandoned_operation",
]);

export const AppDocumentMediaTypeSchema = z.enum([
  "application/json",
  "text/markdown",
  "text/plain",
]);

export const AppDocumentDeleteModeSchema = z.enum(["tombstone", "physical"]);

export const AppDocumentStorageAuthoritySchema = z
  .object({
    authority_version: z.literal(1),
    owner_id: OpaqueIdSchema,
    actor_id: OpaqueIdSchema,
    app_id: z.string().min(3).max(128).regex(canonicalDottedIdentifier),
    publisher_id: z.string().min(3).max(96).regex(/^[a-z0-9]+(?:\.[a-z0-9]+)+$/),
    installation_id: OpaqueIdSchema,
    package_digest: Sha256DigestSchema,
    lifecycle_generation: z.number().int().nonnegative(),
    grant_id: OpaqueIdSchema,
    grant_revision: z.number().int().positive(),
    revocation_generation: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.app_id.startsWith(`${value.publisher_id}.`)) {
      context.addIssue({ code: "custom", path: ["app_id"], message: "app identity must be subordinate to publisher identity" });
    }
  });

export const AppDocumentStorageMutationRequestSchema = z
  .object({
    request_version: z.literal(1),
    authority: AppDocumentStorageAuthoritySchema,
    document_id: z.string().min(1).max(128).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
    document_binding_id: z.string().min(1).max(128).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
    record_kind: AppStorageRecordKindSchema,
    role: AppDocumentRoleSchema,
    retention_class: AppStorageRetentionClassSchema,
    media_type: AppDocumentMediaTypeSchema,
    expected_revision: z.number().int().positive().nullable(),
    operation_id: OpaqueIdSchema,
    idempotency_key: z.string().min(16).max(256),
    content: z.unknown(),
  })
  .strict();

export const AppDocumentStorageDeletionRequestSchema = z
  .object({
    request_version: z.literal(1),
    authority: AppDocumentStorageAuthoritySchema,
    document_id: AppDocumentStorageMutationRequestSchema.shape.document_id,
    expected_revision: z.number().int().positive(),
    operation_id: OpaqueIdSchema,
    idempotency_key: z.string().min(16).max(256),
    delete_mode: AppDocumentDeleteModeSchema.default("tombstone"),
  })
  .strict();

export const AppDocumentRecordSchema = z
  .object({
    record_version: z.literal(1),
    record_kind: AppStorageRecordKindSchema,
    owner_id: OpaqueIdSchema,
    actor_id: OpaqueIdSchema,
    app_id: AppDocumentStorageAuthoritySchema.shape.app_id,
    publisher_id: AppDocumentStorageAuthoritySchema.shape.publisher_id,
    installation_id: OpaqueIdSchema,
    package_digest: Sha256DigestSchema,
    lifecycle_generation: z.number().int().nonnegative(),
    grant_id: OpaqueIdSchema,
    grant_revision: z.number().int().positive(),
    revocation_generation: z.number().int().nonnegative(),
    document_id: AppDocumentStorageMutationRequestSchema.shape.document_id,
    document_binding_id: AppDocumentStorageMutationRequestSchema.shape.document_binding_id,
    role: AppDocumentRoleSchema,
    retention_class: AppStorageRetentionClassSchema,
    media_type: AppDocumentMediaTypeSchema,
    revision: z.number().int().positive(),
    revision_id: OpaqueIdSchema,
    prior_revision_id: OpaqueIdSchema.nullable(),
    operation_id: OpaqueIdSchema,
    idempotency_key: z.string().min(16).max(256),
    content_digest: Sha256DigestSchema,
    content_size_bytes: z.number().int().nonnegative().max(1_048_576),
    content: z.unknown(),
    created_at: TimestampSchema,
    created_by: AppDocumentStorageAuthoritySchema,
    updated_at: TimestampSchema,
    updated_by: AppDocumentStorageAuthoritySchema,
  })
  .strict();

export const AppDocumentTombstoneRecordSchema = z
  .object({
    tombstone_version: z.literal(1),
    record_kind: AppStorageRecordKindSchema,
    owner_id: OpaqueIdSchema,
    actor_id: OpaqueIdSchema,
    app_id: AppDocumentStorageAuthoritySchema.shape.app_id,
    publisher_id: AppDocumentStorageAuthoritySchema.shape.publisher_id,
    installation_id: OpaqueIdSchema,
    package_digest: Sha256DigestSchema,
    lifecycle_generation: z.number().int().nonnegative(),
    grant_id: OpaqueIdSchema,
    grant_revision: z.number().int().positive(),
    revocation_generation: z.number().int().nonnegative(),
    document_id: AppDocumentStorageMutationRequestSchema.shape.document_id,
    document_binding_id: AppDocumentStorageMutationRequestSchema.shape.document_binding_id,
    role: AppDocumentRoleSchema,
    retention_class: AppStorageRetentionClassSchema,
    media_type: AppDocumentMediaTypeSchema,
    revision: z.number().int().positive(),
    revision_id: OpaqueIdSchema,
    prior_revision_id: OpaqueIdSchema,
    operation_id: OpaqueIdSchema,
    idempotency_key: z.string().min(16).max(256),
    delete_mode: AppDocumentDeleteModeSchema,
    prior_content_digest: Sha256DigestSchema,
    prior_content_size_bytes: z.number().int().nonnegative().max(1_048_576),
    deleted_at: TimestampSchema,
    deleted_by: AppDocumentStorageAuthoritySchema,
  })
  .strict();

export const AppDocumentAuditProjectionSchema = z
  .object({
    audit_projection_version: z.literal(1),
    event: z.enum(["app.storage.document.write", "app.storage.document.delete"]),
    owner_id: OpaqueIdSchema,
    actor_id: OpaqueIdSchema,
    app_id: AppDocumentStorageAuthoritySchema.shape.app_id,
    publisher_id: AppDocumentStorageAuthoritySchema.shape.publisher_id,
    installation_id: OpaqueIdSchema,
    package_digest: Sha256DigestSchema,
    lifecycle_generation: z.number().int().nonnegative(),
    grant_id: OpaqueIdSchema,
    grant_revision: z.number().int().positive(),
    revocation_generation: z.number().int().nonnegative(),
    document_id: AppDocumentStorageMutationRequestSchema.shape.document_id,
    document_binding_id: AppDocumentStorageMutationRequestSchema.shape.document_binding_id,
    record_kind: AppStorageRecordKindSchema,
    role: AppDocumentRoleSchema,
    retention_class: AppStorageRetentionClassSchema,
    revision: z.number().int().positive(),
    revision_id: OpaqueIdSchema,
    prior_revision_id: OpaqueIdSchema.nullable(),
    operation_id: OpaqueIdSchema,
    idempotency_key_digest: Sha256DigestSchema,
    content_digest: Sha256DigestSchema,
    content_size_bytes: z.number().int().nonnegative().max(1_048_576),
    delete_mode: AppDocumentDeleteModeSchema.nullable(),
    deleted_at: TimestampSchema.nullable(),
    updated_at: TimestampSchema,
  })
  .strict();

export const AppDocumentStorageMutationResultSchema = z
  .object({
    result_version: z.literal(1),
    record: AppDocumentRecordSchema,
    audit: AppDocumentAuditProjectionSchema,
  })
  .strict();

export const AppDocumentStorageDeletionResultSchema = z
  .object({
    result_version: z.literal(1),
    state: z.literal("deleted"),
    delete_mode: AppDocumentDeleteModeSchema,
    tombstone: AppDocumentTombstoneRecordSchema,
    audit: AppDocumentAuditProjectionSchema,
  })
  .strict();

export const AppDocumentStorageListResultSchema = z
  .object({
    result_version: z.literal(1),
    owner_id: OpaqueIdSchema,
    app_id: AppDocumentStorageAuthoritySchema.shape.app_id,
    publisher_id: AppDocumentStorageAuthoritySchema.shape.publisher_id,
    installation_id: OpaqueIdSchema,
    records: z.array(AppDocumentRecordSchema),
    audits: z.array(AppDocumentAuditProjectionSchema),
  })
  .strict();

export type AppStorageRecordKind = z.infer<typeof AppStorageRecordKindSchema>;
export type AppDocumentRole = z.infer<typeof AppDocumentRoleSchema>;
export type AppStorageRetentionClass = z.infer<typeof AppStorageRetentionClassSchema>;
export type AppDocumentMediaType = z.infer<typeof AppDocumentMediaTypeSchema>;
export type AppDocumentDeleteMode = z.infer<typeof AppDocumentDeleteModeSchema>;
export type AppDocumentStorageAuthority = z.infer<typeof AppDocumentStorageAuthoritySchema>;
export type AppDocumentStorageMutationRequest = z.infer<typeof AppDocumentStorageMutationRequestSchema>;
export type AppDocumentStorageDeletionRequest = z.infer<typeof AppDocumentStorageDeletionRequestSchema>;
export type AppDocumentRecord = z.infer<typeof AppDocumentRecordSchema>;
export type AppDocumentTombstoneRecord = z.infer<typeof AppDocumentTombstoneRecordSchema>;
export type AppDocumentAuditProjection = z.infer<typeof AppDocumentAuditProjectionSchema>;
export type AppDocumentStorageMutationResult = z.infer<typeof AppDocumentStorageMutationResultSchema>;
export type AppDocumentStorageDeletionResult = z.infer<typeof AppDocumentStorageDeletionResultSchema>;
export type AppDocumentStorageListResult = z.infer<typeof AppDocumentStorageListResultSchema>;
