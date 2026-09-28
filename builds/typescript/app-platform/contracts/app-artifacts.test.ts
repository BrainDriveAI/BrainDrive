import { describe, expect, it } from "vitest";

import {
  AppArtifactRecordSchema,
  AppArtifactRegistrationRequestSchema,
  AppExportFinalizeRequestSchema,
  AppExportPrepareRequestSchema,
  AppSafeExportReceiptProjectionSchema,
} from "./app-artifacts.js";

const authority = {
  authority_version: 1,
  owner_id: "30000000-0000-4000-8000-000000000001",
  actor_id: "30000000-0000-4000-8000-000000000002",
  app_id: "ai.braindrive.resume-builder",
  publisher_id: "ai.braindrive",
  installation_id: "30000000-0000-4000-8000-000000000003",
  package_digest: `sha256:${"a".repeat(64)}`,
  lifecycle_generation: 2,
  grant_id: "30000000-0000-4000-8000-000000000004",
  grant_revision: 1,
  revocation_generation: 0,
} as const;

describe("SCAF-005 generic app artifact and export contracts", () => {
  it("requires artifact records to bind app, package, operation, digest, retention, media type, and safe owner label", () => {
    const parsed = AppArtifactRegistrationRequestSchema.parse({
      request_version: 1,
      authority,
      operation_id: "30000000-0000-4000-8000-000000000005",
      idempotency_key: "artifact-register-0001",
      source: { kind: "app_document", source_id: "resume.document" },
      content_digest: `sha256:${"b".repeat(64)}`,
      content_size_bytes: 12,
      retention_class: "durable_owner_data",
      media_type: "application/pdf",
      owner_visible_label: "resume.pdf",
    });

    expect(parsed).toMatchObject({
      authority: {
        app_id: "ai.braindrive.resume-builder",
        installation_id: authority.installation_id,
        package_digest: authority.package_digest,
      },
      operation_id: "30000000-0000-4000-8000-000000000005",
      content_digest: `sha256:${"b".repeat(64)}`,
      retention_class: "durable_owner_data",
      media_type: "application/pdf",
      owner_visible_label: "resume.pdf",
    });

    const record = AppArtifactRecordSchema.parse({
      record_version: 1,
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
      artifact_id: "30000000-0000-4000-8000-000000000006",
      artifact_revision_id: "30000000-0000-4000-8000-000000000007",
      operation_id: parsed.operation_id,
      idempotency_key: parsed.idempotency_key,
      source: parsed.source,
      content_digest: parsed.content_digest,
      content_size_bytes: parsed.content_size_bytes,
      retention_class: parsed.retention_class,
      media_type: parsed.media_type,
      owner_visible_label: parsed.owner_visible_label,
      created_at: "2026-08-27T12:00:00.000Z",
      created_by: authority,
    });
    expect(record).toMatchObject({ app_id: authority.app_id, owner_visible_label: "resume.pdf" });
  });

  it("rejects raw destinations, unsafe labels, unsafe media types, and unconfirmed overwrite requests", () => {
    const base = {
      request_version: 1,
      authority,
      operation_id: "30000000-0000-4000-8000-000000000008",
      idempotency_key: "artifact-export-0001",
      source: { kind: "app_document", source_id: "resume.document" },
      content_digest: `sha256:${"c".repeat(64)}`,
      content_size_bytes: 14,
      media_type: "text/plain",
      filename: "resume.txt",
      destination_intent: "new_download",
      overwrite_confirmed: false,
      owner_confirmed: true,
      bytes_base64: Buffer.from("Owner Resume\n", "utf8").toString("base64"),
    } as const;

    expect(AppExportPrepareRequestSchema.safeParse(base).success).toBe(true);
    expect(AppExportPrepareRequestSchema.safeParse({ ...base, filename: "/home/owner/resume.txt" }).success).toBe(false);
    expect(AppExportPrepareRequestSchema.safeParse({ ...base, media_type: "application/octet-stream" }).success).toBe(false);
    expect(AppExportPrepareRequestSchema.safeParse({ ...base, destination_path: "/tmp/resume.txt" }).success).toBe(false);
    expect(AppExportPrepareRequestSchema.safeParse({ ...base, destination_intent: "replace_existing" }).success).toBe(false);
    expect(AppExportPrepareRequestSchema.safeParse({ ...base, destination_intent: "replace_existing", overwrite_confirmed: true }).success).toBe(true);
  });

  it("keeps finalize receipts replayable and content-safe", () => {
    const finalize = AppExportFinalizeRequestSchema.parse({
      request_version: 1,
      authority,
      operation_id: "30000000-0000-4000-8000-000000000009",
      idempotency_key: "artifact-finalize-0001",
      artifact_revision_id: "30000000-0000-4000-8000-000000000010",
      content_digest: `sha256:${"d".repeat(64)}`,
      media_type: "application/pdf",
      outcome: "completed",
      safe_destination_label: "chosen-resume.pdf",
    });

    const projection = AppSafeExportReceiptProjectionSchema.parse({
      projection_version: 1,
      status: "completed",
      receipt_revision_id: "30000000-0000-4000-8000-000000000011",
      artifact_revision_id: finalize.artifact_revision_id,
      content_digest: finalize.content_digest,
      media_type: finalize.media_type,
      outcome: finalize.outcome,
      safe_destination_label: finalize.safe_destination_label,
      replayed: false,
    });
    expect(projection).toMatchObject({ outcome: "completed", safe_destination_label: "chosen-resume.pdf" });
    expect(JSON.stringify(projection)).not.toMatch(/(?:bytes_base64|content_body|owner_text|\/home\/|[A-Za-z]:\\)/);
    expect(AppExportFinalizeRequestSchema.safeParse({ ...finalize, safe_destination_label: "../resume.pdf" }).success).toBe(false);
  });
});
