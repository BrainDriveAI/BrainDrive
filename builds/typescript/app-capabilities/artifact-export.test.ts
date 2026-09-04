import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppDocumentStorageAuthority } from "../app-platform/contracts/app-storage.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import { AppArtifactStore } from "../app-platform/storage/app-artifact-store.js";
import { AppArtifactExportService } from "./artifact-export.js";

const authority = {
  authority_version: 1,
  owner_id: "31000000-0000-4000-8000-000000000001",
  actor_id: "31000000-0000-4000-8000-000000000002",
  app_id: "ai.braindrive.resume-builder",
  publisher_id: "ai.braindrive",
  installation_id: "31000000-0000-4000-8000-000000000003",
  package_digest: `sha256:${"a".repeat(64)}`,
  lifecycle_generation: 4,
  grant_id: "31000000-0000-4000-8000-000000000004",
  grant_revision: 2,
  revocation_generation: 0,
} as const;

const bytes = Buffer.from("%PDF-1.4\nsynthetic", "utf8");
const contentDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function authorityWith(overrides: Partial<AppDocumentStorageAuthority> = {}): AppDocumentStorageAuthority {
  return { ...authority, ...overrides };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-scaf-005-artifacts-"));
  roots.push(root);
  return root;
}

async function serviceAt(root: string, now?: () => Date): Promise<AppArtifactExportService> {
  const store = new AppArtifactStore(path.join(root, "memory-root"));
  await store.initialize();
  return new AppArtifactExportService({ store, ...(now ? { now } : {}) });
}

async function temporaryService(now?: () => Date): Promise<{ root: string; service: AppArtifactExportService }> {
  const root = await temporaryRoot();
  return { root, service: await serviceAt(root, now) };
}

function exportInput(overrides: Record<string, unknown> = {}) {
  return {
    request_version: 1,
    authority,
    operation_id: "31000000-0000-4000-8000-000000000005",
    idempotency_key: "generic-export-request-0001",
    source: { kind: "app_document", source_id: "resume.document" },
    content_digest: contentDigest,
    content_size_bytes: bytes.length,
    media_type: "application/pdf",
    filename: "resume.pdf",
    destination_intent: "new_download",
    overwrite_confirmed: false,
    owner_confirmed: true,
    bytes_base64: bytes.toString("base64"),
    ...overrides,
  };
}

describe("SCAF-005 app artifact export service", () => {
  it("registers artifacts with scoped metadata and never projects bytes or paths in receipts", async () => {
    const { service } = await temporaryService(() => new Date("2026-08-27T12:00:00.000Z"));
    const prepared = await service.prepareExport(exportInput());
    expect(prepared).toMatchObject({
      result_version: 1,
      status: "prepared",
      filename: "resume.pdf",
      media_type: "application/pdf",
      artifact: {
        app_id: authority.app_id,
        installation_id: authority.installation_id,
        package_digest: authority.package_digest,
        operation_id: "31000000-0000-4000-8000-000000000005",
        content_digest: contentDigest,
        retention_class: "durable_owner_data",
        media_type: "application/pdf",
        owner_visible_label: "resume.pdf",
      },
    });
    expect(Buffer.from(prepared.bytes_base64, "base64")).toEqual(bytes);

    const receipt = await service.finalizeExport({
      request_version: 1,
      authority,
      operation_id: "31000000-0000-4000-8000-000000000006",
      idempotency_key: "generic-export-finalize-0001",
      artifact_revision_id: prepared.artifact.artifact_revision_id,
      content_digest: prepared.artifact.content_digest,
      media_type: prepared.artifact.media_type,
      safe_destination_label: "chosen-resume.pdf",
      outcome: "completed",
    });
    expect(receipt).toMatchObject({
      status: "completed",
      artifact_revision_id: prepared.artifact.artifact_revision_id,
      safe_destination_label: "chosen-resume.pdf",
      outcome: "completed",
      replayed: false,
    });
    expect(JSON.stringify(receipt)).not.toMatch(/(?:bytes_base64|%PDF|\/tmp\/|\/home\/|[A-Za-z]:\\)/);
  });

  it("denies raw destination labels and requires owner confirmation before preparing exports", async () => {
    const { service } = await temporaryService();
    await expect(service.prepareExport(exportInput({ filename: "/tmp/resume.pdf" }))).rejects.toBeDefined();
    await expect(service.prepareExport(exportInput({ owner_confirmed: false }))).rejects.toMatchObject({
      code: "denied",
      statusCode: 403,
      details: { confirmation: { title: "Export app artifact?", actionLabel: "Export" } },
    });
  });

  it("requires overwrite confirmation only for replace-existing intent", async () => {
    const { service } = await temporaryService();
    await expect(service.prepareExport(exportInput({
      operation_id: "31000000-0000-4000-8000-000000000007",
      idempotency_key: "generic-export-overwrite-0001",
      destination_intent: "replace_existing",
      overwrite_confirmed: false,
    }))).rejects.toBeDefined();
    await expect(service.prepareExport(exportInput({
      operation_id: "31000000-0000-4000-8000-000000000007",
      idempotency_key: "generic-export-overwrite-0001",
      destination_intent: "replace_existing",
      overwrite_confirmed: true,
    }))).resolves.toMatchObject({ status: "prepared", safe_destination_label: "resume.pdf" });
  });

  it("cancels before artifact registration and leaves no receipt to replay", async () => {
    const { service } = await temporaryService();
    await expect(service.prepareExport(exportInput({
      is_cancelled: true,
      operation_id: "31000000-0000-4000-8000-000000000008",
      idempotency_key: "generic-export-cancelled-0001",
    }))).rejects.toMatchObject({ code: "cancelled" });
    await expect(service.artifactCountForTest(authority)).resolves.toBe(0);
    await expect(service.receiptCountForTest(authority)).resolves.toBe(0);
  });

  it("replays equivalent idempotent export and receipt requests and conflicts on changed input", async () => {
    const { service } = await temporaryService();
    const first = await service.prepareExport(exportInput());
    const replayed = await service.prepareExport(exportInput());
    expect(replayed.artifact.artifact_revision_id).toBe(first.artifact.artifact_revision_id);
    expect(replayed.replayed).toBe(true);

    await expect(service.prepareExport(exportInput({ filename: "different.pdf" }))).rejects.toMatchObject({
      code: "idempotency_conflict",
    });

    const finalize = {
      request_version: 1,
      authority,
      operation_id: "31000000-0000-4000-8000-000000000009",
      idempotency_key: "generic-export-receipt-replay",
      artifact_revision_id: first.artifact.artifact_revision_id,
      content_digest: first.artifact.content_digest,
      media_type: first.artifact.media_type,
      safe_destination_label: "chosen-resume.pdf",
      outcome: "completed" as const,
    };
    const receipt = await service.finalizeExport(finalize);
    const receiptReplay = await service.finalizeExport(finalize);
    expect(receiptReplay.receipt_revision_id).toBe(receipt.receipt_revision_id);
    expect(receiptReplay.replayed).toBe(true);
    await expect(service.finalizeExport({ ...finalize, safe_destination_label: "changed-resume.pdf" }))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("allows cancellation of an active app-scoped export operation", async () => {
    vi.useFakeTimers();
    const { service } = await temporaryService();
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const pending = service.runExportOperation(exportInput({
      operation_id: "31000000-0000-4000-8000-000000000010",
      idempotency_key: "generic-export-active-cancel",
    }), async ({ isCancelled }) => {
      markStarted();
      await new Promise<void>((resolve) => { release = resolve; });
      if (isCancelled()) throw new AppPlatformError("cancelled", "Synthetic cancellation", 408);
      return service.prepareExport(exportInput({
        operation_id: "31000000-0000-4000-8000-000000000010",
        idempotency_key: "generic-export-active-cancel",
      }));
    });

    await started;
    expect(service.cancel(authority.app_id, authority.installation_id, "generic-export-active-cancel")).toBe(true);
    release();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });

  it("finalizes a registered artifact after service and store recreation", async () => {
    const { root, service } = await temporaryService(() => new Date("2026-08-27T12:00:00.000Z"));
    const registration = {
      request_version: 1,
      authority,
      operation_id: "31000000-0000-4000-8000-000000000011",
      idempotency_key: "generic-artifact-direct-0001",
      source: { kind: "runtime_output", source_id: "resume.rendered" },
      content_digest: contentDigest,
      content_size_bytes: bytes.length,
      retention_class: "durable_owner_data",
      media_type: "application/pdf",
      owner_visible_label: "resume.pdf",
    };
    const registered = await service.registerArtifact(registration);

    const restarted = await serviceAt(root, () => new Date("2026-08-27T12:01:00.000Z"));
    const replayed = await restarted.registerArtifact(registration);
    expect(replayed).toMatchObject({
      record: { artifact_revision_id: registered.record.artifact_revision_id },
      replayed: true,
    });
    await expect(restarted.finalizeExport({
      request_version: 1,
      authority,
      operation_id: "31000000-0000-4000-8000-000000000012",
      idempotency_key: "generic-finalize-after-restart",
      artifact_revision_id: registered.record.artifact_revision_id,
      content_digest: contentDigest,
      media_type: "application/pdf",
      safe_destination_label: "resume.pdf",
      outcome: "completed",
    })).resolves.toMatchObject({
      artifact_revision_id: registered.record.artifact_revision_id,
      replayed: false,
    });
  });

  it("replays prepared exports after service and store recreation", async () => {
    const { root, service } = await temporaryService();
    const first = await service.prepareExport(exportInput({
      operation_id: "31000000-0000-4000-8000-000000000013",
      idempotency_key: "generic-export-restart-replay",
    }));

    const restarted = await serviceAt(root);
    const replay = await restarted.prepareExport(exportInput({
      operation_id: "31000000-0000-4000-8000-000000000013",
      idempotency_key: "generic-export-restart-replay",
    }));
    expect(replay.artifact.artifact_revision_id).toBe(first.artifact.artifact_revision_id);
    expect(replay.bytes_base64).toBe(first.bytes_base64);
    expect(replay.replayed).toBe(true);
  });

  it("replays finalized receipts and preserves idempotency conflicts after restart", async () => {
    const { root, service } = await temporaryService();
    const prepared = await service.prepareExport(exportInput({
      operation_id: "31000000-0000-4000-8000-000000000014",
      idempotency_key: "generic-export-before-receipt",
    }));
    const finalize = {
      request_version: 1 as const,
      authority,
      operation_id: "31000000-0000-4000-8000-000000000015",
      idempotency_key: "generic-receipt-restart-replay",
      artifact_revision_id: prepared.artifact.artifact_revision_id,
      content_digest: prepared.artifact.content_digest,
      media_type: prepared.artifact.media_type,
      safe_destination_label: "resume.pdf",
      outcome: "completed" as const,
    };
    const receipt = await service.finalizeExport(finalize);

    const restarted = await serviceAt(root);
    const replay = await restarted.finalizeExport(finalize);
    expect(replay).toMatchObject({
      receipt_revision_id: receipt.receipt_revision_id,
      safe_destination_label: receipt.safe_destination_label,
      replayed: true,
    });
    await expect(restarted.finalizeExport({ ...finalize, safe_destination_label: "different.pdf" }))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("returns the latest receipt for the active authority after package updates", async () => {
    let now = new Date("2026-08-27T12:00:00.000Z");
    const { service } = await temporaryService(() => now);
    const oldAuthority = authorityWith({
      package_digest: `sha256:${"9".repeat(64)}`,
      lifecycle_generation: authority.lifecycle_generation - 1,
      grant_id: "31000000-0000-4000-8000-000000000099",
      grant_revision: authority.grant_revision - 1,
    });
    const oldPrepared = await service.prepareExport(exportInput({
      authority: oldAuthority,
      operation_id: "31000000-0000-4000-8000-000000000021",
      idempotency_key: "generic-export-old-authority",
    }));
    await service.finalizeExport({
      request_version: 1,
      authority: oldAuthority,
      operation_id: "31000000-0000-4000-8000-000000000022",
      idempotency_key: "generic-finalize-old-authority",
      artifact_revision_id: oldPrepared.artifact.artifact_revision_id,
      content_digest: oldPrepared.artifact.content_digest,
      media_type: oldPrepared.artifact.media_type,
      safe_destination_label: "old-resume.pdf",
      outcome: "completed",
    });

    now = new Date("2026-08-27T12:01:00.000Z");
    const prepared = await service.prepareExport(exportInput({
      operation_id: "31000000-0000-4000-8000-000000000023",
      idempotency_key: "generic-export-current-authority",
    }));
    const receipt = await service.finalizeExport({
      request_version: 1,
      authority,
      operation_id: "31000000-0000-4000-8000-000000000024",
      idempotency_key: "generic-finalize-current-authority",
      artifact_revision_id: prepared.artifact.artifact_revision_id,
      content_digest: prepared.artifact.content_digest,
      media_type: prepared.artifact.media_type,
      safe_destination_label: "current-resume.pdf",
      outcome: "completed",
    });

    await expect(service.latestReceipt(authority)).resolves.toMatchObject({
      receipt_revision_id: receipt.receipt_revision_id,
      safe_destination_label: "current-resume.pdf",
    });
  });

  it("keeps artifact records scoped by owner, app, and installation after restart", async () => {
    const { root, service } = await temporaryService();
    const prepared = await service.prepareExport(exportInput({
      operation_id: "31000000-0000-4000-8000-000000000016",
      idempotency_key: "generic-export-scope-source",
    }));
    const restarted = await serviceAt(root);

    await expect(restarted.readArtifact(authority, prepared.artifact.artifact_revision_id))
      .resolves.toMatchObject({ artifact_revision_id: prepared.artifact.artifact_revision_id });
    await expect(restarted.readArtifact(authorityWith({
      owner_id: "32000000-0000-4000-8000-000000000001",
    }), prepared.artifact.artifact_revision_id)).resolves.toBeNull();
    await expect(restarted.readArtifact(authorityWith({
      app_id: "ai.braindrive.brief-builder",
    }), prepared.artifact.artifact_revision_id)).resolves.toBeNull();
    await expect(restarted.readArtifact(authorityWith({
      installation_id: "32000000-0000-4000-8000-000000000003",
    }), prepared.artifact.artifact_revision_id)).resolves.toBeNull();
  });

  it("rejects changed prepared-export idempotency input after restart before creating new artifacts", async () => {
    const { root, service } = await temporaryService();
    await service.prepareExport(exportInput({
      operation_id: "31000000-0000-4000-8000-000000000017",
      idempotency_key: "generic-export-conflict-after-restart",
    }));

    const restarted = await serviceAt(root);
    await expect(restarted.prepareExport(exportInput({
      operation_id: "31000000-0000-4000-8000-000000000017",
      idempotency_key: "generic-export-conflict-after-restart",
      filename: "changed.pdf",
    }))).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(restarted.artifactCountForTest(authority)).resolves.toBe(1);
  });

  it("records failed export receipts without deleting artifact records", async () => {
    const { root, service } = await temporaryService();
    const prepared = await service.prepareExport(exportInput({
      operation_id: "31000000-0000-4000-8000-000000000020",
      idempotency_key: "generic-export-failed-source",
    }));

    const restarted = await serviceAt(root);
    await expect(restarted.finalizeExport({
      request_version: 1,
      authority,
      operation_id: "31000000-0000-4000-8000-000000000021",
      idempotency_key: "generic-finalize-failed-export",
      artifact_revision_id: prepared.artifact.artifact_revision_id,
      content_digest: prepared.artifact.content_digest,
      media_type: prepared.artifact.media_type,
      safe_destination_label: "resume.pdf",
      outcome: "failed",
    })).resolves.toMatchObject({ outcome: "failed", replayed: false });
    await expect(restarted.readArtifact(authority, prepared.artifact.artifact_revision_id))
      .resolves.toMatchObject({ artifact_revision_id: prepared.artifact.artifact_revision_id });
    await expect(restarted.artifactCountForTest(authority)).resolves.toBe(1);
  });

  it("validates digest and media bytes before persisting records", async () => {
    const { service } = await temporaryService();
    await expect(service.prepareExport(exportInput({
      operation_id: "31000000-0000-4000-8000-000000000018",
      idempotency_key: "generic-export-invalid-digest",
      content_digest: `sha256:${"b".repeat(64)}`,
    }))).rejects.toMatchObject({ code: "validation_failed" });

    const notPdf = Buffer.from("not a pdf", "utf8");
    const notPdfDigest = `sha256:${createHash("sha256").update(notPdf).digest("hex")}` as const;
    await expect(service.prepareExport(exportInput({
      operation_id: "31000000-0000-4000-8000-000000000019",
      idempotency_key: "generic-export-invalid-media",
      content_digest: notPdfDigest,
      content_size_bytes: notPdf.length,
      bytes_base64: notPdf.toString("base64"),
    }))).rejects.toMatchObject({ code: "validation_failed" });

    await expect(service.artifactCountForTest(authority)).resolves.toBe(0);
    await expect(service.receiptCountForTest(authority)).resolves.toBe(0);
  });
});
