import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../contracts/common.js";
import type { AppDocumentDeleteMode, AppDocumentStorageAuthority, AppStorageRetentionClass } from "../contracts/app-storage.js";
import {
  AppDocumentStorageService,
  projectAppDocumentAudit,
  projectAppDocumentDeleteAudit,
} from "../storage/app-document-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function authority(overrides: Partial<AppDocumentStorageAuthority> = {}): AppDocumentStorageAuthority {
  return {
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
    ...overrides,
  };
}

async function temporaryStore(maxContentBytes = 1024 * 1024): Promise<AppDocumentStorageService> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-scaf-002-storage-"));
  roots.push(root);
  const store = new AppDocumentStorageService(path.join(root, "memory-root"), { maxContentBytes });
  await store.initialize();
  return store;
}

function writeInput(input: {
  auth?: AppDocumentStorageAuthority;
  documentId?: string;
  bindingId?: string;
  content?: unknown;
  expectedRevision?: number | null;
  idempotencyKey?: string;
  operationId?: string;
  role?: "source_document" | "derived_document" | "recovery_document" | "action_result_document" | "app_state";
  retentionClass?: AppStorageRetentionClass;
}) {
  return {
    request_version: 1 as const,
    authority: input.auth ?? authority(),
    document_id: input.documentId ?? "resume.profile",
    document_binding_id: input.bindingId ?? "resume.profile.current",
    record_kind: "document" as const,
    role: input.role ?? "source_document",
    retention_class: input.retentionClass ?? "durable_owner_data",
    media_type: typeof input.content === "string" ? "text/markdown" as const : "application/json" as const,
    expected_revision: input.expectedRevision ?? null,
    operation_id: input.operationId ?? "20000000-0000-4000-8000-000000000005",
    idempotency_key: input.idempotencyKey ?? "resume-profile-create-0001",
    content: input.content ?? "# Profile",
  };
}

function deleteInput(input: {
  auth?: AppDocumentStorageAuthority;
  documentId?: string;
  expectedRevision: number;
  idempotencyKey?: string;
  operationId?: string;
  deleteMode?: AppDocumentDeleteMode;
}) {
  return {
    request_version: 1 as const,
    authority: input.auth ?? authority(),
    document_id: input.documentId ?? "resume.profile",
    expected_revision: input.expectedRevision,
    operation_id: input.operationId ?? "20000000-0000-4000-8000-000000000007",
    idempotency_key: input.idempotencyKey ?? "resume-profile-delete-0001",
    delete_mode: input.deleteMode ?? "tombstone",
  };
}

describe("SCAF-002 app-owned durable document storage", () => {
  it("creates, reads, and updates a document with revision CAS", async () => {
    const store = await temporaryStore();
    const created = await store.writeDocument(writeInput({ content: "# Profile" }));

    expect(created.record).toMatchObject({
      owner_id: authority().owner_id,
      app_id: authority().app_id,
      document_id: "resume.profile",
      document_binding_id: "resume.profile.current",
      revision: 1,
      content: "# Profile",
      content_digest: canonicalInputDigest("# Profile"),
    });
    expect(created.audit).toMatchObject({
      event: "app.storage.document.write",
      owner_id: authority().owner_id,
      app_id: authority().app_id,
      operation_id: created.record.operation_id,
      revision: 1,
      content_digest: created.record.content_digest,
    });

    await expect(store.readDocument(authority(), "resume.profile")).resolves.toMatchObject({
      revision: 1,
      content: "# Profile",
    });
    const updated = await store.writeDocument(writeInput({
      content: "# Updated profile",
      expectedRevision: 1,
      operationId: "20000000-0000-4000-8000-000000000006",
      idempotencyKey: "resume-profile-update-0001",
    }));
    expect(updated.record).toMatchObject({ revision: 2, prior_revision_id: created.record.revision_id, content: "# Updated profile" });
  });

  it("lists only documents in the caller's owner, app, and installation namespace", async () => {
    const store = await temporaryStore();
    await store.writeDocument(writeInput({ content: "Resume app profile" }));
    await store.writeDocument(writeInput({
      documentId: "resume.notes",
      bindingId: "resume.notes.current",
      content: "Resume app notes",
      operationId: "20000000-0000-4000-8000-000000000006",
      idempotencyKey: "resume-notes-create-0001",
    }));
    const otherApp = authority({
      app_id: "ai.braindrive.brief-builder",
      installation_id: "30000000-0000-4000-8000-000000000003",
      grant_id: "30000000-0000-4000-8000-000000000004",
      package_digest: `sha256:${"b".repeat(64)}`,
    });
    await store.writeDocument(writeInput({
      auth: otherApp,
      documentId: "brief.source",
      bindingId: "brief.source.current",
      content: "Brief app source",
      operationId: "30000000-0000-4000-8000-000000000005",
      idempotencyKey: "brief-source-create-0001",
    }));
    const otherInstallation = authority({
      installation_id: "40000000-0000-4000-8000-000000000003",
      grant_id: "40000000-0000-4000-8000-000000000004",
    });
    await store.writeDocument(writeInput({
      auth: otherInstallation,
      documentId: "resume.profile",
      bindingId: "resume.profile.current",
      content: "Other installation profile",
      operationId: "40000000-0000-4000-8000-000000000005",
      idempotencyKey: "other-install-create-0001",
    }));

    await expect(store.readDocument(authority(), "resume.profile")).resolves.toMatchObject({ content: "Resume app profile" });
    await expect(store.readDocument(otherApp, "brief.source")).resolves.toMatchObject({ content: "Brief app source" });
    await expect(store.readDocument(otherApp, "resume.profile")).resolves.toBeNull();
    await expect(store.readDocument(otherInstallation, "resume.profile")).resolves.toMatchObject({ content: "Other installation profile" });

    const listed = await store.listDocuments(authority());
    expect(listed.records.map((record) => record.document_id)).toEqual(["resume.notes", "resume.profile"]);
    expect(listed.records.map((record) => record.content)).toEqual(["Resume app notes", "Resume app profile"]);
  });

  it("rejects CAS mismatches without replacing the current document", async () => {
    const store = await temporaryStore();
    await store.writeDocument(writeInput({ content: "v1" }));
    await expect(store.writeDocument(writeInput({
      content: "stale update",
      expectedRevision: 2,
      operationId: "20000000-0000-4000-8000-000000000006",
      idempotencyKey: "resume-profile-stale-0001",
    }))).rejects.toMatchObject({ code: "revision_conflict" });
    await expect(store.readDocument(authority(), "resume.profile")).resolves.toMatchObject({ revision: 1, content: "v1" });
  });

  it("replays idempotent mutations and rejects conflicting key reuse", async () => {
    const store = await temporaryStore();
    const firstInput = writeInput({ content: { name: "Ada" }, idempotencyKey: "resume-profile-idempotent-0001" });
    const first = await store.writeDocument(firstInput);
    const replay = await store.writeDocument(firstInput);
    expect(replay).toEqual(first);
    await expect(store.writeDocument({
      ...firstInput,
      content: { name: "Grace" },
    })).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("deletes documents with tombstones, idempotency replay, and content-free audit projection", async () => {
    const store = await temporaryStore();
    const created = await store.writeDocument(writeInput({ content: { name: "Ada", private: "profile text" } }));
    const deleted = await store.deleteDocument(deleteInput({ expectedRevision: created.record.revision }));

    expect(deleted).toMatchObject({
      state: "deleted",
      delete_mode: "tombstone",
      tombstone: {
        document_id: "resume.profile",
        revision: 2,
        prior_revision_id: created.record.revision_id,
        prior_content_digest: created.record.content_digest,
      },
      audit: {
        event: "app.storage.document.delete",
        document_id: "resume.profile",
        revision: 2,
        delete_mode: "tombstone",
      },
    });
    expect(JSON.stringify(deleted.audit)).not.toContain("profile text");
    await expect(store.readDocument(authority(), "resume.profile")).resolves.toBeNull();
    expect((await store.listDocuments(authority())).records).toEqual([]);
    expect((await store.listDocumentAudits(authority())).map((audit) => audit.event)).toEqual(["app.storage.document.delete"]);
    await expect(store.deleteDocument(deleteInput({ expectedRevision: created.record.revision }))).resolves.toEqual(deleted);
    await expect(store.deleteDocument(deleteInput({
      expectedRevision: created.record.revision,
      operationId: "20000000-0000-4000-8000-000000000008",
      idempotencyKey: "resume-profile-delete-0002",
    }))).rejects.toMatchObject({ code: "revision_conflict", details: { currentRevision: 2 } });
  });

  it("permits physical content deletion only for disposable retention classes", async () => {
    const store = await temporaryStore();
    const durable = await store.writeDocument(writeInput({ content: "durable" }));
    await expect(store.deleteDocument(deleteInput({
      expectedRevision: durable.record.revision,
      deleteMode: "physical",
      idempotencyKey: "resume-profile-physical-denied",
    }))).rejects.toMatchObject({ code: "denied" });

    const cache = await store.writeDocument(writeInput({
      documentId: "resume.preview",
      bindingId: "resume.preview.cache",
      role: "app_state",
      retentionClass: "disposable_preview_cache",
      content: { html: "<p>preview</p>" },
      operationId: "20000000-0000-4000-8000-000000000009",
      idempotencyKey: "resume-preview-create-0001",
    }));
    const deleted = await store.deleteDocument(deleteInput({
      documentId: "resume.preview",
      expectedRevision: cache.record.revision,
      deleteMode: "physical",
      operationId: "20000000-0000-4000-8000-000000000010",
      idempotencyKey: "resume-preview-delete-0001",
    }));
    expect(deleted).toMatchObject({ state: "deleted", delete_mode: "physical", tombstone: { delete_mode: "physical" } });
    expect(JSON.stringify(deleted)).not.toContain("<p>preview</p>");
    await expect(store.readDocument(authority(), "resume.preview")).resolves.toBeNull();
  });

  it("denies stale authority from mutating after the host binds newer active authority", async () => {
    const store = await temporaryStore();
    const stale = authority();
    const fresh = authority({
      package_digest: `sha256:${"c".repeat(64)}`,
      lifecycle_generation: 3,
      grant_id: "50000000-0000-4000-8000-000000000004",
      grant_revision: 1,
    });
    const created = await store.writeDocument(writeInput({ auth: stale, content: "v1" }));
    await store.bindActiveAuthority(fresh);

    await expect(store.readDocument(fresh, "resume.profile")).resolves.toMatchObject({ content: "v1" });
    await expect(store.writeDocument(writeInput({
      auth: stale,
      content: "stale",
      expectedRevision: created.record.revision,
      operationId: "20000000-0000-4000-8000-000000000011",
      idempotencyKey: "resume-profile-stale-authority",
    }))).rejects.toMatchObject({ code: "denied" });
    await expect(store.deleteDocument(deleteInput({
      auth: stale,
      expectedRevision: created.record.revision,
      operationId: "20000000-0000-4000-8000-000000000012",
      idempotencyKey: "resume-profile-stale-delete",
    }))).rejects.toMatchObject({ code: "denied" });
  });

  it("keeps retained records readable and listable after package and grant authority changes", async () => {
    const store = await temporaryStore();
    const created = await store.writeDocument(writeInput({ content: "v1" }));
    const packageUpdate = authority({
      package_digest: `sha256:${"d".repeat(64)}`,
      lifecycle_generation: 4,
      grant_id: "60000000-0000-4000-8000-000000000004",
    });
    await store.bindActiveAuthority(packageUpdate);
    await expect(store.readDocument(packageUpdate, "resume.profile")).resolves.toMatchObject({ revision: 1, content: "v1" });
    expect((await store.listDocuments(packageUpdate)).records).toHaveLength(1);
    const updated = await store.writeDocument(writeInput({
      auth: packageUpdate,
      content: "v2",
      expectedRevision: created.record.revision,
      operationId: "20000000-0000-4000-8000-000000000013",
      idempotencyKey: "resume-profile-package-update",
    }));
    expect(updated.record).toMatchObject({
      revision: 2,
      package_digest: packageUpdate.package_digest,
      lifecycle_generation: packageUpdate.lifecycle_generation,
      grant_id: packageUpdate.grant_id,
    });

    const grantRefresh = authority({
      package_digest: packageUpdate.package_digest,
      lifecycle_generation: 5,
      grant_id: packageUpdate.grant_id,
      grant_revision: 2,
      revocation_generation: 0,
    });
    await store.bindActiveAuthority(grantRefresh);
    await expect(store.readDocument(grantRefresh, "resume.profile")).resolves.toMatchObject({ revision: 2, content: "v2" });
    const refreshed = await store.writeDocument(writeInput({
      auth: grantRefresh,
      content: "v3",
      expectedRevision: updated.record.revision,
      operationId: "20000000-0000-4000-8000-000000000014",
      idempotencyKey: "resume-profile-grant-refresh",
    }));
    expect(refreshed.record).toMatchObject({
      revision: 3,
      grant_revision: 2,
      lifecycle_generation: 5,
    });
  });

  it("enforces content size bounds before writing", async () => {
    const store = await temporaryStore(64);
    await expect(store.writeDocument(writeInput({
      content: "x".repeat(256),
      idempotencyKey: "resume-profile-too-large-0001",
    }))).rejects.toMatchObject({ code: "validation_failed", statusCode: 413 });
    await expect(store.readDocument(authority(), "resume.profile")).resolves.toBeNull();
  });

  it("preserves retention class and emits a content-free audit projection", async () => {
    const store = await temporaryStore();
    const result = await store.writeDocument(writeInput({
      documentId: "resume.create.result",
      bindingId: "resume.create.result.latest",
      role: "action_result_document",
      retentionClass: "durable_operation_lookup",
      content: { status: "created", markdown: "Owner resume text" },
      idempotencyKey: "resume-create-result-0001",
    }));

    const audit = projectAppDocumentAudit(result.record);
    expect(result.record.retention_class).toBe("durable_operation_lookup");
    expect(audit).toMatchObject({
      event: "app.storage.document.write",
      role: "action_result_document",
      retention_class: "durable_operation_lookup",
      content_size_bytes: result.record.content_size_bytes,
    });
    expect(JSON.stringify(audit)).not.toContain("Owner resume text");
    expect(JSON.stringify(audit)).not.toMatch(/memory-root|\/tmp\//);
  });

  it("projects delete audits without content or local path details", async () => {
    const store = await temporaryStore();
    const created = await store.writeDocument(writeInput({ content: { markdown: "Owner resume text" } }));
    const deleted = await store.deleteDocument(deleteInput({ expectedRevision: created.record.revision }));
    const audit = projectAppDocumentDeleteAudit(deleted.tombstone);
    expect(audit).toMatchObject({
      event: "app.storage.document.delete",
      role: "source_document",
      retention_class: "durable_owner_data",
      delete_mode: "tombstone",
      content_size_bytes: created.record.content_size_bytes,
    });
    expect(JSON.stringify(audit)).not.toContain("Owner resume text");
    expect(JSON.stringify(audit)).not.toMatch(/memory-root|\/tmp\//);
  });

  it("preserves existing Resume Builder owner data through explicit migration readback content", async () => {
    const store = await temporaryStore();
    const legacyProjection = {
      storage_projection_version: 1,
      compatibility_source: "resume-domain",
      projection: {
        bindingId: "resume.profile.current",
        source: "resume-domain",
        entryPoint: "career",
        confirmedFactCount: 7,
      },
    };

    await store.writeDocument(writeInput({
      documentId: "resume.profile",
      bindingId: "resume.profile.current",
      content: legacyProjection,
      idempotencyKey: "resume-profile-migration-0001",
    }));

    const reinstalledAuthority = authority({
      installation_id: authority().installation_id,
      package_digest: `sha256:${"e".repeat(64)}`,
      lifecycle_generation: 8,
      grant_id: "70000000-0000-4000-8000-000000000004",
    });
    await store.bindActiveAuthority(reinstalledAuthority);
    await expect(store.readDocument(reinstalledAuthority, "resume.profile")).resolves.toMatchObject({
      document_id: "resume.profile",
      document_binding_id: "resume.profile.current",
      role: "source_document",
      retention_class: "durable_owner_data",
      content: legacyProjection,
    });
  });
});
