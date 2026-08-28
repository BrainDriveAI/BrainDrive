import { createHash, randomUUID } from "node:crypto";

import {
  AppArtifactRecordSchema,
  AppArtifactRegistrationRequestSchema,
  AppExportFinalizeRequestSchema,
  AppExportPreparedResultSchema,
  AppExportPrepareRequestSchema,
  AppExportReceiptRecordSchema,
  AppSafeExportReceiptProjectionSchema,
  type AppArtifactRecord,
  type AppArtifactRegistrationRequest,
  type AppExportFinalizeRequest,
  type AppExportReceiptRecord,
  type AppExportPreparedResult,
  type AppSafeExportReceiptProjection,
} from "../app-platform/contracts/app-artifacts.js";
import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import { AppArtifactStore } from "../app-platform/storage/app-artifact-store.js";
import { CapabilityOperationCoordinator } from "./operations.js";

type ServiceOptions = {
  store: AppArtifactStore;
  now?: () => Date;
  audit?: (event: string, details: Record<string, unknown>) => void;
  coordinator?: CapabilityOperationCoordinator;
};

export class AppArtifactExportService {
  private readonly store: AppArtifactStore;
  private readonly now: () => Date;
  private readonly audit: (event: string, details: Record<string, unknown>) => void;
  private readonly coordinator: CapabilityOperationCoordinator;

  constructor(options: ServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.audit = options.audit ?? (() => undefined);
    this.coordinator = options.coordinator ?? new CapabilityOperationCoordinator({ now: () => this.now().getTime() });
  }

  async runExportOperation<T>(
    rawRequest: unknown,
    adapter: (context: { signal: AbortSignal; isCancelled: () => boolean }) => Promise<T>,
  ): Promise<T> {
    const request = AppExportPrepareRequestSchema.parse(rawRequest);
    return await this.coordinator.execute({
      appId: request.authority.app_id,
      installationId: request.authority.installation_id,
      connectionId: request.authority.grant_id,
      viewId: null,
      capability: "app.export.request",
      capabilityVersion: 1,
      operationId: request.operation_id,
      idempotencyKey: request.idempotency_key,
      input: {
        source: request.source,
        content_digest: request.content_digest,
        content_size_bytes: request.content_size_bytes,
        media_type: request.media_type,
        filename: request.filename,
        destination_intent: request.destination_intent,
        overwrite_confirmed: request.overwrite_confirmed,
      },
      deadlineAt: this.now().getTime() + 120_000,
    }, ({ signal, isCancelled }) => adapter({ signal, isCancelled }));
  }

  cancel(appId: string, installationId: string, idempotencyKey: string): boolean {
    return this.coordinator.cancel(appId, installationId, "app.export.request", idempotencyKey);
  }

  async registerArtifact(rawRequest: unknown): Promise<{ record: AppArtifactRecord; replayed: boolean }> {
    const request = AppArtifactRegistrationRequestSchema.parse(rawRequest);
    const inputDigest = canonicalInputDigest(request);
    const replay = await this.store.readArtifactByIdempotency(
      request.authority,
      request.operation_id,
      request.idempotency_key,
      inputDigest,
    );
    if (replay) return { record: replay, replayed: true };

    const record = AppArtifactRecordSchema.parse({
      record_version: 1,
      owner_id: request.authority.owner_id,
      actor_id: request.authority.actor_id,
      app_id: request.authority.app_id,
      publisher_id: request.authority.publisher_id,
      installation_id: request.authority.installation_id,
      package_digest: request.authority.package_digest,
      lifecycle_generation: request.authority.lifecycle_generation,
      grant_id: request.authority.grant_id,
      grant_revision: request.authority.grant_revision,
      revocation_generation: request.authority.revocation_generation,
      artifact_id: request.artifact_id ?? randomUUID(),
      artifact_revision_id: request.artifact_revision_id ?? randomUUID(),
      operation_id: request.operation_id,
      idempotency_key: request.idempotency_key,
      source: request.source,
      content_digest: request.content_digest,
      content_size_bytes: request.content_size_bytes,
      retention_class: request.retention_class,
      media_type: request.media_type,
      owner_visible_label: request.owner_visible_label,
      created_at: this.now().toISOString(),
      created_by: request.authority,
    });
    await this.store.registerArtifact(request.authority, record, inputDigest);
    this.audit("app.artifact.registered", this.artifactAudit(record));
    return { record, replayed: false };
  }

  async prepareExport(rawRequest: unknown): Promise<AppExportPreparedResult> {
    const request = AppExportPrepareRequestSchema.parse(rawRequest);
    if (!request.owner_confirmed) {
      throw new AppPlatformError("denied", "Host owner confirmation is required before export preparation", 403, {
        confirmation: { title: "Export app artifact?", actionLabel: "Export" },
      });
    }
    if (request.is_cancelled) throw new AppPlatformError("cancelled", "Export was cancelled before artifact registration", 408);
    const bytes = Buffer.from(request.bytes_base64, "base64");
    if (bytes.length !== request.content_size_bytes || digest(bytes) !== request.content_digest) {
      throw new AppPlatformError("validation_failed", "Export content digest does not match the declared artifact metadata", 409);
    }
    if (request.media_type === "text/plain") {
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new AppPlatformError("validation_failed", "Text exports must be strict UTF-8", 409); }
      if (bytes.includes(0)) throw new AppPlatformError("validation_failed", "Text exports must not include NUL bytes", 409);
    }
    if (request.media_type === "application/pdf" && bytes.subarray(0, 8).toString("latin1") !== "%PDF-1.4") {
      throw new AppPlatformError("validation_failed", "PDF exports must use the approved renderer output format", 409);
    }

    const inputDigest = canonicalInputDigest(request);
    const replay = await this.store.readPreparedExportByIdempotency(
      request.authority,
      request.operation_id,
      request.idempotency_key,
      inputDigest,
    );
    if (replay) return AppExportPreparedResultSchema.parse({ ...replay, replayed: true });

    const artifact = await this.registerArtifact({
      request_version: 1,
      authority: request.authority,
      operation_id: request.operation_id,
      idempotency_key: `${request.idempotency_key}:artifact`,
      source: request.source,
      content_digest: request.content_digest,
      content_size_bytes: request.content_size_bytes,
      retention_class: request.retention_class,
      media_type: request.media_type,
      owner_visible_label: request.filename,
      ...(request.artifact_id ? { artifact_id: request.artifact_id } : {}),
      ...(request.artifact_revision_id ? { artifact_revision_id: request.artifact_revision_id } : {}),
    } satisfies AppArtifactRegistrationRequest);
    const prepared = AppExportPreparedResultSchema.parse({
      result_version: 1,
      status: "prepared",
      artifact: artifact.record,
      filename: request.filename,
      media_type: request.media_type,
      bytes_base64: request.bytes_base64,
      safe_destination_label: request.filename,
      replayed: false,
    });
    await this.store.writePreparedExport(request.authority, request.operation_id, request.idempotency_key, inputDigest, prepared);
    this.audit("app.export.prepared", {
      ...this.artifactAudit(prepared.artifact),
      filename: prepared.filename,
      safe_destination_label: prepared.safe_destination_label,
      outcome: "prepared",
    });
    return prepared;
  }

  async finalizeExport(rawRequest: unknown): Promise<AppSafeExportReceiptProjection> {
    const request = AppExportFinalizeRequestSchema.parse(rawRequest);
    const inputDigest = canonicalInputDigest(request);
    const replay = await this.store.readReceiptByIdempotency(
      request.authority,
      request.operation_id,
      request.idempotency_key,
      inputDigest,
    );
    if (replay) return AppSafeExportReceiptProjectionSchema.parse({ ...replay, replayed: true });

    const artifact = await this.store.getArtifactByRevision(request.authority, request.artifact_revision_id);
    if (!artifact || !this.sameAuthority(artifact, request) || artifact.content_digest !== request.content_digest || artifact.media_type !== request.media_type) {
      throw new AppPlatformError("not_found_within_scope", "Prepared app artifact was not found", 404);
    }
    const receipt = AppExportReceiptRecordSchema.parse({
      record_version: 1,
      owner_id: request.authority.owner_id,
      actor_id: request.authority.actor_id,
      app_id: request.authority.app_id,
      publisher_id: request.authority.publisher_id,
      installation_id: request.authority.installation_id,
      package_digest: request.authority.package_digest,
      lifecycle_generation: request.authority.lifecycle_generation,
      grant_id: request.authority.grant_id,
      grant_revision: request.authority.grant_revision,
      revocation_generation: request.authority.revocation_generation,
      receipt_revision_id: randomUUID(),
      artifact_revision_id: request.artifact_revision_id,
      operation_id: request.operation_id,
      idempotency_key: request.idempotency_key,
      content_digest: request.content_digest,
      media_type: request.media_type,
      outcome: request.outcome,
      safe_destination_label: request.safe_destination_label,
      exported_at: this.now().toISOString(),
      created_by: request.authority,
    });
    const projection = this.projectReceipt(receipt, false);
    await this.store.writeReceipt(request.authority, receipt, projection, inputDigest);
    this.audit("app.export.receipt_recorded", {
      app_id: receipt.app_id,
      installation_id: receipt.installation_id,
      package_digest: receipt.package_digest,
      operation_id: receipt.operation_id,
      artifact_revision_id: receipt.artifact_revision_id,
      receipt_revision_id: receipt.receipt_revision_id,
      content_digest: receipt.content_digest,
      media_type: receipt.media_type,
      outcome: receipt.outcome,
      safe_destination_label: receipt.safe_destination_label,
    });
    return projection;
  }

  readArtifact(authority: AppExportFinalizeRequest["authority"], artifactRevisionId: string): Promise<AppArtifactRecord | null> {
    return this.store.getArtifactByRevision(authority, artifactRevisionId);
  }

  artifactCountForTest(authority: AppExportFinalizeRequest["authority"]): Promise<number> {
    return this.store.artifactCountForTest(authority);
  }

  receiptCountForTest(authority: AppExportFinalizeRequest["authority"]): Promise<number> {
    return this.store.receiptCountForTest(authority);
  }

  private artifactAudit(record: AppArtifactRecord): Record<string, unknown> {
    return {
      app_id: record.app_id,
      installation_id: record.installation_id,
      package_digest: record.package_digest,
      operation_id: record.operation_id,
      artifact_revision_id: record.artifact_revision_id,
      content_digest: record.content_digest,
      content_size_bytes: record.content_size_bytes,
      retention_class: record.retention_class,
      media_type: record.media_type,
      owner_visible_label: record.owner_visible_label,
    };
  }

  private sameAuthority(artifact: AppArtifactRecord, request: AppExportFinalizeRequest): boolean {
    return artifact.owner_id === request.authority.owner_id
      && artifact.actor_id === request.authority.actor_id
      && artifact.app_id === request.authority.app_id
      && artifact.publisher_id === request.authority.publisher_id
      && artifact.installation_id === request.authority.installation_id
      && artifact.package_digest === request.authority.package_digest
      && artifact.lifecycle_generation === request.authority.lifecycle_generation
      && artifact.grant_id === request.authority.grant_id
      && artifact.grant_revision === request.authority.grant_revision
      && artifact.revocation_generation === request.authority.revocation_generation;
  }

  private projectReceipt(receipt: AppExportReceiptRecord, replayed: boolean): AppSafeExportReceiptProjection {
    return AppSafeExportReceiptProjectionSchema.parse({
      projection_version: 1,
      status: "completed",
      receipt_revision_id: receipt.receipt_revision_id,
      artifact_revision_id: receipt.artifact_revision_id,
      content_digest: receipt.content_digest,
      media_type: receipt.media_type,
      outcome: receipt.outcome,
      safe_destination_label: receipt.safe_destination_label,
      replayed,
    });
  }
}

function digest(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
