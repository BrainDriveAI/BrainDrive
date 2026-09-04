import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  AppArtifactRecordSchema,
  AppExportPreparedResultSchema,
  AppExportReceiptRecordSchema,
  AppSafeExportReceiptProjectionSchema,
  type AppArtifactRecord,
  type AppExportPreparedResult,
  type AppExportReceiptRecord,
  type AppSafeExportReceiptProjection,
} from "../contracts/app-artifacts.js";
import {
  AppDocumentStorageAuthoritySchema,
  type AppDocumentStorageAuthority,
} from "../contracts/app-storage.js";
import { canonicalJson, Sha256DigestSchema } from "../contracts/common.js";
import { AppPlatformError } from "../lifecycle/errors.js";

type ArtifactIdempotencyKind = "artifact" | "prepared_export" | "receipt";

const IdempotencyBaseSchema = z
  .object({
    idempotency_version: z.literal(1),
    operation_id: AppArtifactRecordSchema.shape.operation_id,
    idempotency_key: AppArtifactRecordSchema.shape.idempotency_key,
    input_digest: Sha256DigestSchema,
  })
  .strict();

const ArtifactIdempotencyRecordSchema = z.discriminatedUnion("kind", [
  IdempotencyBaseSchema.extend({
    kind: z.literal("artifact"),
    value: AppArtifactRecordSchema,
  }),
  IdempotencyBaseSchema.extend({
    kind: z.literal("prepared_export"),
    value: AppExportPreparedResultSchema,
  }),
  IdempotencyBaseSchema.extend({
    kind: z.literal("receipt"),
    value: AppSafeExportReceiptProjectionSchema,
  }),
]);

type ArtifactIdempotencyRecord = z.infer<typeof ArtifactIdempotencyRecordSchema>;

export class AppArtifactStore {
  private tail = Promise.resolve();

  constructor(private readonly root: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  async registerArtifact(
    authority: AppDocumentStorageAuthority,
    record: AppArtifactRecord,
    inputDigest: `sha256:${string}`,
  ): Promise<void> {
    const parsedAuthority = AppDocumentStorageAuthoritySchema.parse(authority);
    const parsedRecord = AppArtifactRecordSchema.parse(record);
    assertArtifactAuthority(parsedRecord, parsedAuthority);
    await this.serial(async () => {
      const replay = await this.readArtifactByIdempotency(parsedAuthority, parsedRecord.operation_id, parsedRecord.idempotency_key, inputDigest);
      if (replay) return;
      const existing = await this.getArtifactByRevision(parsedAuthority, parsedRecord.artifact_revision_id);
      if (existing) {
        if (canonicalJson(existing) === canonicalJson(parsedRecord)) return;
        throw new AppPlatformError("conflict", "App artifact revision identity already exists", 409);
      }
      await this.writeAtomic(this.artifactPath(parsedAuthority, parsedRecord.artifact_revision_id), parsedRecord);
      await this.writeIdempotency(parsedAuthority, {
        idempotency_version: 1,
        kind: "artifact",
        operation_id: parsedRecord.operation_id,
        idempotency_key: parsedRecord.idempotency_key,
        input_digest: inputDigest,
        value: parsedRecord,
      });
    });
  }

  async getArtifactByRevision(authority: AppDocumentStorageAuthority, artifactRevisionId: string): Promise<AppArtifactRecord | null> {
    const parsedAuthority = AppDocumentStorageAuthoritySchema.parse(authority);
    try {
      const record = AppArtifactRecordSchema.parse(JSON.parse(await readFile(this.artifactPath(parsedAuthority, artifactRevisionId), "utf8")));
      assertArtifactAuthority(record, parsedAuthority);
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async readArtifactByIdempotency(
    authority: AppDocumentStorageAuthority,
    operationId: string,
    idempotencyKey: string,
    inputDigest: `sha256:${string}`,
  ): Promise<AppArtifactRecord | null> {
    const record = await this.readIdempotency(AppDocumentStorageAuthoritySchema.parse(authority), "artifact", operationId, idempotencyKey, inputDigest);
    if (!record) return null;
    const value = AppArtifactRecordSchema.parse(record.value);
    assertArtifactAuthority(value, authority);
    return value;
  }

  async writePreparedExport(
    authority: AppDocumentStorageAuthority,
    operationId: string,
    idempotencyKey: string,
    inputDigest: `sha256:${string}`,
    prepared: AppExportPreparedResult,
  ): Promise<void> {
    const parsedAuthority = AppDocumentStorageAuthoritySchema.parse(authority);
    const parsedPrepared = AppExportPreparedResultSchema.parse(prepared);
    assertArtifactAuthority(parsedPrepared.artifact, parsedAuthority);
    await this.serial(async () => {
      const replay = await this.readPreparedExportByIdempotency(parsedAuthority, operationId, idempotencyKey, inputDigest);
      if (replay) return;
      await this.writeIdempotency(parsedAuthority, {
        idempotency_version: 1,
        kind: "prepared_export",
        operation_id: operationId,
        idempotency_key: idempotencyKey,
        input_digest: inputDigest,
        value: parsedPrepared,
      });
    });
  }

  async readPreparedExportByIdempotency(
    authority: AppDocumentStorageAuthority,
    operationId: string,
    idempotencyKey: string,
    inputDigest: `sha256:${string}`,
  ): Promise<AppExportPreparedResult | null> {
    const record = await this.readIdempotency(AppDocumentStorageAuthoritySchema.parse(authority), "prepared_export", operationId, idempotencyKey, inputDigest);
    if (!record) return null;
    const value = AppExportPreparedResultSchema.parse(record.value);
    assertArtifactAuthority(value.artifact, authority);
    return value;
  }

  async writeReceipt(
    authority: AppDocumentStorageAuthority,
    receipt: AppExportReceiptRecord,
    projection: AppSafeExportReceiptProjection,
    inputDigest: `sha256:${string}`,
  ): Promise<void> {
    const parsedAuthority = AppDocumentStorageAuthoritySchema.parse(authority);
    const parsedReceipt = AppExportReceiptRecordSchema.parse(receipt);
    const parsedProjection = AppSafeExportReceiptProjectionSchema.parse(projection);
    assertReceiptAuthority(parsedReceipt, parsedAuthority);
    await this.serial(async () => {
      const replay = await this.readReceiptByIdempotency(parsedAuthority, parsedReceipt.operation_id, parsedReceipt.idempotency_key, inputDigest);
      if (replay) return;
      await this.writeAtomic(this.receiptPath(parsedAuthority, parsedReceipt.receipt_revision_id), parsedReceipt);
      await this.writeIdempotency(parsedAuthority, {
        idempotency_version: 1,
        kind: "receipt",
        operation_id: parsedReceipt.operation_id,
        idempotency_key: parsedReceipt.idempotency_key,
        input_digest: inputDigest,
        value: parsedProjection,
      });
    });
  }

  async readReceiptByIdempotency(
    authority: AppDocumentStorageAuthority,
    operationId: string,
    idempotencyKey: string,
    inputDigest: `sha256:${string}`,
  ): Promise<AppSafeExportReceiptProjection | null> {
    const record = await this.readIdempotency(AppDocumentStorageAuthoritySchema.parse(authority), "receipt", operationId, idempotencyKey, inputDigest);
    if (!record) return null;
    return AppSafeExportReceiptProjectionSchema.parse(record.value);
  }

  async latestReceipt(authority: AppDocumentStorageAuthority): Promise<AppExportReceiptRecord | null> {
    const parsedAuthority = AppDocumentStorageAuthoritySchema.parse(authority);
    const root = this.receiptsRoot(parsedAuthority);
    let names: string[];
    try {
      names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    let latest: AppExportReceiptRecord | null = null;
    for (const name of names) {
      const record = AppExportReceiptRecordSchema.parse(JSON.parse(await readFile(path.join(root, name), "utf8")));
      if (!receiptMatchesAuthority(record, parsedAuthority)) continue;
      if (!latest || record.exported_at.localeCompare(latest.exported_at) > 0) {
        latest = record;
      }
    }
    return latest;
  }

  async listArtifactAudits(authority: AppDocumentStorageAuthority): Promise<Array<Record<string, unknown>>> {
    const parsedAuthority = AppDocumentStorageAuthoritySchema.parse(authority);
    const root = this.artifactsRoot(parsedAuthority);
    let names: string[];
    try {
      names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const audits: Array<Record<string, unknown>> = [];
    for (const name of names) {
      const record = AppArtifactRecordSchema.parse(JSON.parse(await readFile(path.join(root, name), "utf8")));
      assertArtifactAuthority(record, parsedAuthority);
      audits.push({
        event: "app.artifact.registered",
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
      });
    }
    return audits;
  }

  async artifactCountForTest(authority: AppDocumentStorageAuthority): Promise<number> {
    return (await this.listArtifactAudits(authority)).length;
  }

  async receiptCountForTest(authority: AppDocumentStorageAuthority): Promise<number> {
    const parsedAuthority = AppDocumentStorageAuthoritySchema.parse(authority);
    const root = this.receiptsRoot(parsedAuthority);
    try {
      return (await readdir(root)).filter((name) => name.endsWith(".json")).length;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
  }

  private async readIdempotency(
    authority: AppDocumentStorageAuthority,
    kind: ArtifactIdempotencyKind,
    operationId: string,
    idempotencyKey: string,
    inputDigest: `sha256:${string}`,
  ): Promise<ArtifactIdempotencyRecord | null> {
    const idempotency = await this.readIdempotencyFile(this.idempotencyKeyPath(authority, kind, idempotencyKey));
    const operation = await this.readIdempotencyFile(this.operationKeyPath(authority, kind, operationId));
    const existing = idempotency ?? operation;
    if (!existing) return null;
    if (idempotency && operation && canonicalJson(idempotency) !== canonicalJson(operation)) {
      throw new AppPlatformError("store_corrupt", "App artifact idempotency indexes disagree", 500);
    }
    if (
      existing.kind !== kind ||
      existing.operation_id !== operationId ||
      existing.idempotency_key !== idempotencyKey ||
      existing.input_digest !== inputDigest
    ) {
      throw new AppPlatformError("idempotency_conflict", "App artifact/export operation identity was already used", 409);
    }
    return existing;
  }

  private async readIdempotencyFile(filePath: string): Promise<ArtifactIdempotencyRecord | null> {
    try {
      return ArtifactIdempotencyRecordSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async writeIdempotency(authority: AppDocumentStorageAuthority, record: ArtifactIdempotencyRecord): Promise<void> {
    await this.writeAtomic(this.idempotencyKeyPath(authority, record.kind, record.idempotency_key), record);
    await this.writeAtomic(this.operationKeyPath(authority, record.kind, record.operation_id), record);
  }

  private artifactPath(authority: AppDocumentStorageAuthority, artifactRevisionId: string): string {
    return path.join(this.artifactsRoot(authority), `${hashSegment(artifactRevisionId)}.json`);
  }

  private receiptPath(authority: AppDocumentStorageAuthority, receiptRevisionId: string): string {
    return path.join(this.receiptsRoot(authority), `${hashSegment(receiptRevisionId)}.json`);
  }

  private artifactsRoot(authority: AppDocumentStorageAuthority): string {
    return path.join(this.namespaceRoot(authority), "artifacts", "revisions");
  }

  private receiptsRoot(authority: AppDocumentStorageAuthority): string {
    return path.join(this.namespaceRoot(authority), "artifacts", "receipts");
  }

  private idempotencyKeyPath(authority: AppDocumentStorageAuthority, kind: ArtifactIdempotencyKind, idempotencyKey: string): string {
    return path.join(this.namespaceRoot(authority), "artifacts", "idempotency", kind, "keys", `${hashSegment(idempotencyKey)}.json`);
  }

  private operationKeyPath(authority: AppDocumentStorageAuthority, kind: ArtifactIdempotencyKind, operationId: string): string {
    return path.join(this.namespaceRoot(authority), "artifacts", "idempotency", kind, "operations", `${hashSegment(operationId)}.json`);
  }

  private namespaceRoot(authority: AppDocumentStorageAuthority): string {
    return path.join(
      this.root,
      "app-storage",
      "owners",
      hashSegment(authority.owner_id),
      "apps",
      authority.app_id,
      "installations",
      authority.installation_id,
    );
  }

  private async writeAtomic(targetPath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(tempPath, targetPath);
      await syncDirectoryEntry(path.dirname(targetPath));
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
}

function assertArtifactAuthority(record: AppArtifactRecord, authority: AppDocumentStorageAuthority): void {
  if (
    record.owner_id !== authority.owner_id ||
    record.actor_id !== authority.actor_id ||
    record.app_id !== authority.app_id ||
    record.publisher_id !== authority.publisher_id ||
    record.installation_id !== authority.installation_id ||
    record.package_digest !== authority.package_digest ||
    record.lifecycle_generation !== authority.lifecycle_generation ||
    record.grant_id !== authority.grant_id ||
    record.grant_revision !== authority.grant_revision ||
    record.revocation_generation !== authority.revocation_generation
  ) {
    throw new AppPlatformError("denied", "App artifact authority does not match the active storage binding", 403);
  }
}

function assertReceiptAuthority(record: AppExportReceiptRecord, authority: AppDocumentStorageAuthority): void {
  if (!receiptMatchesAuthority(record, authority)) {
    throw new AppPlatformError("denied", "App export receipt authority does not match the active storage binding", 403);
  }
}

function receiptMatchesAuthority(record: AppExportReceiptRecord, authority: AppDocumentStorageAuthority): boolean {
  return (
    record.owner_id !== authority.owner_id ||
    record.actor_id !== authority.actor_id ||
    record.app_id !== authority.app_id ||
    record.publisher_id !== authority.publisher_id ||
    record.installation_id !== authority.installation_id ||
    record.package_digest !== authority.package_digest ||
    record.lifecycle_generation !== authority.lifecycle_generation ||
    record.grant_id !== authority.grant_id ||
    record.grant_revision !== authority.grant_revision ||
    record.revocation_generation !== authority.revocation_generation
  ) === false;
}

function hashSegment(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function syncDirectoryEntry(directoryPath: string): Promise<void> {
  const directory = await open(directoryPath, "r");
  try {
    await directory.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EINVAL" || code === "ENOTSUP")) return;
    throw error;
  } finally {
    await directory.close();
  }
}
