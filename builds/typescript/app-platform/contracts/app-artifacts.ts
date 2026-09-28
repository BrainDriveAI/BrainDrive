import { z } from "zod";

import {
  OpaqueIdSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from "./common.js";
import {
  AppDocumentStorageAuthoritySchema,
  AppStorageRetentionClassSchema,
} from "./app-storage.js";

export const AppArtifactSafeMediaTypeSchema = z.enum([
  "application/pdf",
  "text/plain",
]);

export const AppExportDestinationIntentSchema = z.enum([
  "new_download",
  "replace_existing",
]);

const SafeOwnerLabelSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^/\\\u0000-\u001f\u007f]+$/)
  .refine((value) => !/^\.+$/.test(value) && !value.includes(".."), "owner-visible labels must not contain path traversal");

const AppArtifactSourceSchema = z
  .object({
    kind: z.enum(["app_document", "app_operation", "runtime_output"]),
    source_id: z.string().min(1).max(256).regex(/^[a-zA-Z0-9_.:@-]+$/),
  })
  .strict();

export const AppArtifactRegistrationRequestSchema = z
  .object({
    request_version: z.literal(1),
    authority: AppDocumentStorageAuthoritySchema,
    operation_id: OpaqueIdSchema,
    idempotency_key: z.string().min(16).max(256),
    source: AppArtifactSourceSchema,
    content_digest: Sha256DigestSchema,
    content_size_bytes: z.number().int().positive().max(2_097_152),
    retention_class: AppStorageRetentionClassSchema,
    media_type: AppArtifactSafeMediaTypeSchema,
    owner_visible_label: SafeOwnerLabelSchema,
    artifact_id: OpaqueIdSchema.optional(),
    artifact_revision_id: OpaqueIdSchema.optional(),
  })
  .strict();

export const AppArtifactRecordSchema = z
  .object({
    record_version: z.literal(1),
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
    artifact_id: OpaqueIdSchema,
    artifact_revision_id: OpaqueIdSchema,
    operation_id: OpaqueIdSchema,
    idempotency_key: z.string().min(16).max(256),
    source: AppArtifactSourceSchema,
    content_digest: Sha256DigestSchema,
    content_size_bytes: z.number().int().positive().max(2_097_152),
    retention_class: AppStorageRetentionClassSchema,
    media_type: AppArtifactSafeMediaTypeSchema,
    owner_visible_label: SafeOwnerLabelSchema,
    created_at: TimestampSchema,
    created_by: AppDocumentStorageAuthoritySchema,
  })
  .strict();

export const AppExportPrepareRequestSchema = z
  .object({
    request_version: z.literal(1),
    authority: AppDocumentStorageAuthoritySchema,
    operation_id: OpaqueIdSchema,
    idempotency_key: z.string().min(16).max(256),
    source: AppArtifactSourceSchema,
    content_digest: Sha256DigestSchema,
    content_size_bytes: z.number().int().positive().max(2_097_152),
    retention_class: AppStorageRetentionClassSchema.default("durable_owner_data"),
    media_type: AppArtifactSafeMediaTypeSchema,
    filename: SafeOwnerLabelSchema,
    destination_intent: AppExportDestinationIntentSchema,
    overwrite_confirmed: z.boolean(),
    owner_confirmed: z.boolean(),
    bytes_base64: z.string().min(1).max(2_796_204).regex(/^[A-Za-z0-9+/]*={0,2}$/),
    artifact_id: OpaqueIdSchema.optional(),
    artifact_revision_id: OpaqueIdSchema.optional(),
    is_cancelled: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.destination_intent === "replace_existing" && !value.overwrite_confirmed) {
      context.addIssue({ code: "custom", path: ["overwrite_confirmed"], message: "replacement requires explicit overwrite confirmation" });
    }
    if (value.media_type === "application/pdf" && !value.filename.toLowerCase().endsWith(".pdf")) {
      context.addIssue({ code: "custom", path: ["filename"], message: "PDF exports require a .pdf filename" });
    }
    if (value.media_type === "text/plain" && !value.filename.toLowerCase().endsWith(".txt")) {
      context.addIssue({ code: "custom", path: ["filename"], message: "Text exports require a .txt filename" });
    }
  });

export const AppExportPreparedResultSchema = z
  .object({
    result_version: z.literal(1),
    status: z.literal("prepared"),
    artifact: AppArtifactRecordSchema,
    filename: SafeOwnerLabelSchema,
    media_type: AppArtifactSafeMediaTypeSchema,
    bytes_base64: z.string().min(1),
    safe_destination_label: SafeOwnerLabelSchema,
    replayed: z.boolean(),
  })
  .strict();

export const AppExportFinalizeRequestSchema = z
  .object({
    request_version: z.literal(1),
    authority: AppDocumentStorageAuthoritySchema,
    operation_id: OpaqueIdSchema,
    idempotency_key: z.string().min(16).max(256),
    artifact_revision_id: OpaqueIdSchema,
    content_digest: Sha256DigestSchema,
    media_type: AppArtifactSafeMediaTypeSchema,
    outcome: z.enum(["completed", "cancelled", "failed"]),
    safe_destination_label: SafeOwnerLabelSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.media_type === "application/pdf" && !value.safe_destination_label.toLowerCase().endsWith(".pdf")) {
      context.addIssue({ code: "custom", path: ["safe_destination_label"], message: "PDF receipts require a .pdf label" });
    }
    if (value.media_type === "text/plain" && !value.safe_destination_label.toLowerCase().endsWith(".txt")) {
      context.addIssue({ code: "custom", path: ["safe_destination_label"], message: "Text receipts require a .txt label" });
    }
  });

export const AppExportReceiptRecordSchema = z
  .object({
    record_version: z.literal(1),
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
    receipt_revision_id: OpaqueIdSchema,
    artifact_revision_id: OpaqueIdSchema,
    operation_id: OpaqueIdSchema,
    idempotency_key: z.string().min(16).max(256),
    content_digest: Sha256DigestSchema,
    media_type: AppArtifactSafeMediaTypeSchema,
    outcome: z.enum(["completed", "cancelled", "failed"]),
    safe_destination_label: SafeOwnerLabelSchema,
    exported_at: TimestampSchema,
    created_by: AppDocumentStorageAuthoritySchema,
  })
  .strict();

export const AppSafeExportReceiptProjectionSchema = z
  .object({
    projection_version: z.literal(1),
    status: z.literal("completed"),
    receipt_revision_id: OpaqueIdSchema,
    artifact_revision_id: OpaqueIdSchema,
    content_digest: Sha256DigestSchema,
    media_type: AppArtifactSafeMediaTypeSchema,
    outcome: z.enum(["completed", "cancelled", "failed"]),
    safe_destination_label: SafeOwnerLabelSchema,
    replayed: z.boolean(),
  })
  .strict();

export type AppArtifactSafeMediaType = z.infer<typeof AppArtifactSafeMediaTypeSchema>;
export type AppArtifactRegistrationRequest = z.infer<typeof AppArtifactRegistrationRequestSchema>;
export type AppArtifactRecord = z.infer<typeof AppArtifactRecordSchema>;
export type AppExportPrepareRequest = z.infer<typeof AppExportPrepareRequestSchema>;
export type AppExportPreparedResult = z.infer<typeof AppExportPreparedResultSchema>;
export type AppExportFinalizeRequest = z.infer<typeof AppExportFinalizeRequestSchema>;
export type AppExportReceiptRecord = z.infer<typeof AppExportReceiptRecordSchema>;
export type AppSafeExportReceiptProjection = z.infer<typeof AppSafeExportReceiptProjectionSchema>;
