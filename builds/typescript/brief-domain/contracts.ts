import { z } from "zod";

import { OpaqueIdSchema, Sha256DigestSchema, TimestampSchema } from "../app-platform/contracts/common.js";

export const BRIEF_DATA_SCHEMA_VERSION = 1 as const;

const BoundedTextSchema = z.string().trim().min(1).max(32_768);
const BriefStatementSchema = z.object({
  statement_id: OpaqueIdSchema,
  text: z.string().trim().min(1).max(1_024),
  support: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("source_quote"), quote: z.string().trim().min(1).max(2_048) }).strict(),
    z.object({ kind: z.literal("owner_context"), context: z.string().trim().min(1).max(2_048) }).strict(),
  ]),
}).strict();

export const BriefSourceRevisionSchema = z.object({
  source_revision_id: OpaqueIdSchema,
  revision: z.number().int().positive(),
  text: BoundedTextSchema,
  content_digest: Sha256DigestSchema,
  created_at: TimestampSchema,
}).strict();

export const BriefDraftRevisionSchema = z.object({
  draft_revision_id: OpaqueIdSchema,
  source_revision_id: OpaqueIdSchema,
  revision: z.number().int().positive(),
  title: z.string().trim().min(1).max(160),
  statements: z.array(BriefStatementSchema).min(1).max(12),
  content_digest: Sha256DigestSchema,
  generated_by: z.enum(["brief.generate@1", "owner_edit"]),
  created_at: TimestampSchema,
}).strict();

export const ApprovedBriefRevisionSchema = z.object({
  approved_revision_id: OpaqueIdSchema,
  source_revision_id: OpaqueIdSchema,
  draft_revision_id: OpaqueIdSchema,
  revision: z.number().int().positive(),
  predecessor_revision_id: OpaqueIdSchema.nullable(),
  title: z.string().trim().min(1).max(160),
  statements: z.array(BriefStatementSchema).min(1).max(12),
  content_digest: Sha256DigestSchema,
  owner_confirmation_proof_id: OpaqueIdSchema,
  approved_at: TimestampSchema,
}).strict();

const BriefOperationSchema = z.object({
  idempotency_key: z.string().min(16).max(256),
  input_digest: Sha256DigestSchema,
  result_kind: z.enum(["source", "draft", "approved"]),
  result_revision_id: OpaqueIdSchema,
}).strict();

const BriefCatalogBodySchema = z.object({
  catalog_version: z.literal(1),
  data_schema_version: z.literal(BRIEF_DATA_SCHEMA_VERSION),
  app_id: z.literal("ai.braindrive.brief-builder"),
  owner_id: OpaqueIdSchema,
  revision: z.number().int().nonnegative(),
  sources: z.array(BriefSourceRevisionSchema).max(256),
  drafts: z.array(BriefDraftRevisionSchema).max(256),
  approved: z.array(ApprovedBriefRevisionSchema).max(256),
  operations: z.array(BriefOperationSchema).max(1_024),
}).strict();

export const BriefCatalogSchema = BriefCatalogBodySchema.extend({ integrity_digest: Sha256DigestSchema }).strict();

export const SaveBriefSourceInputSchema = z.object({
  source_revision_id: OpaqueIdSchema.optional(),
  text: BoundedTextSchema,
  expected_catalog_revision: z.number().int().nonnegative(),
  idempotency_key: z.string().min(16).max(256),
}).strict();

export const SaveBriefDraftInputSchema = z.object({
  source_revision_id: OpaqueIdSchema,
  title: z.string().trim().min(1).max(160),
  statements: z.array(BriefStatementSchema).min(1).max(12),
  generated_by: z.enum(["brief.generate@1", "owner_edit"]),
  expected_catalog_revision: z.number().int().nonnegative(),
  idempotency_key: z.string().min(16).max(256),
}).strict();

export const ApproveBriefInputSchema = z.object({
  draft_revision_id: OpaqueIdSchema,
  expected_catalog_revision: z.number().int().nonnegative(),
  idempotency_key: z.string().min(16).max(256),
  host_owner_confirmed: z.literal(true),
  owner_confirmation_proof_id: OpaqueIdSchema,
}).strict();

export type BriefCatalog = z.infer<typeof BriefCatalogSchema>;
export type BriefSourceRevision = z.infer<typeof BriefSourceRevisionSchema>;
export type BriefDraftRevision = z.infer<typeof BriefDraftRevisionSchema>;
export type ApprovedBriefRevision = z.infer<typeof ApprovedBriefRevisionSchema>;
export type BriefStatement = z.infer<typeof BriefStatementSchema>;
