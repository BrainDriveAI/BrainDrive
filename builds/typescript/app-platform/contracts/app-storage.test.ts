import { describe, expect, it } from "vitest";

import {
  AppDocumentRoleSchema,
  AppDocumentStorageDeletionRequestSchema,
  AppDocumentStorageListResultSchema,
  AppDocumentStorageMutationRequestSchema,
  AppDocumentTombstoneRecordSchema,
  AppStorageRetentionClassSchema,
} from "./app-storage.js";

const authority = {
  authority_version: 1,
  owner_id: "20000000-0000-4000-8000-000000000001",
  actor_id: "20000000-0000-4000-8000-000000000002",
  app_id: "ai.braindrive.resume-builder",
  publisher_id: "ai.braindrive",
  installation_id: "20000000-0000-4000-8000-000000000003",
  package_digest: `sha256:${"a".repeat(64)}`,
  lifecycle_generation: 2,
  grant_id: "20000000-0000-4000-8000-000000000004",
  grant_revision: 1,
  revocation_generation: 0,
} as const;

describe("SCAF-002 app storage contracts", () => {
  it("supports the app-chat durable document roles", () => {
    expect(AppDocumentRoleSchema.options).toEqual([
      "source_document",
      "derived_document",
      "recovery_document",
      "action_result_document",
      "app_state",
    ]);
  });

  it("admits owner-data retention classes and rejects runtime/path authority classes", () => {
    expect(AppStorageRetentionClassSchema.parse("durable_owner_data")).toBe("durable_owner_data");
    expect(AppStorageRetentionClassSchema.parse("durable_operation_lookup")).toBe("durable_operation_lookup");
    expect(AppStorageRetentionClassSchema.safeParse("runtime_authority").success).toBe(false);
    expect(AppStorageRetentionClassSchema.safeParse("external_owner_file").success).toBe(false);
  });

  it("requires mutation authority to bind lifecycle, package, grant, operation, and idempotency", () => {
    const parsed = AppDocumentStorageMutationRequestSchema.parse({
      request_version: 1,
      authority,
      document_id: "resume.profile",
      document_binding_id: "resume.profile.current",
      record_kind: "document",
      role: "source_document",
      retention_class: "durable_owner_data",
      media_type: "text/markdown",
      expected_revision: null,
      operation_id: "20000000-0000-4000-8000-000000000005",
      idempotency_key: "resume-profile-create-0001",
      content: "# Profile",
    });

    expect(parsed.authority).toMatchObject({
      owner_id: authority.owner_id,
      app_id: authority.app_id,
      publisher_id: authority.publisher_id,
      installation_id: authority.installation_id,
      package_digest: authority.package_digest,
      lifecycle_generation: authority.lifecycle_generation,
      grant_id: authority.grant_id,
      grant_revision: authority.grant_revision,
    });
    expect(AppDocumentStorageMutationRequestSchema.safeParse({
      ...parsed,
      idempotency_key: "short",
    }).success).toBe(false);
  });

  it("defines revision-bound document deletion and content-free list projection contracts", () => {
    const deletion = AppDocumentStorageDeletionRequestSchema.parse({
      request_version: 1,
      authority,
      document_id: "resume.profile",
      expected_revision: 3,
      operation_id: "20000000-0000-4000-8000-000000000006",
      idempotency_key: "resume-profile-delete-0001",
    });
    expect(deletion.delete_mode).toBe("tombstone");
    expect(AppDocumentStorageDeletionRequestSchema.safeParse({
      ...deletion,
      expected_revision: null,
    }).success).toBe(false);

    const tombstone = AppDocumentTombstoneRecordSchema.parse({
      tombstone_version: 1,
      record_kind: "document",
      owner_id: authority.owner_id,
      actor_id: authority.actor_id,
      app_id: authority.app_id,
      publisher_id: authority.publisher_id,
      installation_id: authority.installation_id,
      package_digest: authority.package_digest,
      lifecycle_generation: authority.lifecycle_generation,
      grant_id: authority.grant_id,
      grant_revision: authority.grant_revision,
      revocation_generation: authority.revocation_generation,
      document_id: "resume.profile",
      document_binding_id: "resume.profile.current",
      role: "source_document",
      retention_class: "durable_owner_data",
      media_type: "text/markdown",
      revision: 4,
      revision_id: "20000000-0000-4000-8000-000000000007",
      prior_revision_id: "20000000-0000-4000-8000-000000000008",
      operation_id: deletion.operation_id,
      idempotency_key: deletion.idempotency_key,
      delete_mode: deletion.delete_mode,
      prior_content_digest: `sha256:${"b".repeat(64)}`,
      prior_content_size_bytes: 128,
      deleted_at: "2026-08-27T12:00:00.000Z",
      deleted_by: authority,
    });
    expect(tombstone).not.toHaveProperty("content");

    expect(AppDocumentStorageListResultSchema.parse({
      result_version: 1,
      owner_id: authority.owner_id,
      app_id: authority.app_id,
      publisher_id: authority.publisher_id,
      installation_id: authority.installation_id,
      records: [],
      audits: [],
    }).records).toEqual([]);
  });
});
