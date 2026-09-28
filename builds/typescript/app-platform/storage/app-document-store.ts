import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";
import {
  AppDocumentAuditProjectionSchema,
  AppDocumentRecordSchema,
  AppDocumentStorageDeletionRequestSchema,
  AppDocumentStorageDeletionResultSchema,
  AppDocumentStorageAuthoritySchema,
  AppDocumentStorageListResultSchema,
  AppDocumentStorageMutationRequestSchema,
  AppDocumentStorageMutationResultSchema,
  AppDocumentTombstoneRecordSchema,
  type AppDocumentAuditProjection,
  type AppDocumentRecord,
  type AppDocumentStorageDeletionRequest,
  type AppDocumentStorageDeletionResult,
  type AppDocumentStorageAuthority,
  type AppDocumentStorageListResult,
  type AppDocumentStorageMutationRequest,
  type AppDocumentStorageMutationResult,
  type AppDocumentTombstoneRecord,
} from "../contracts/app-storage.js";
import { canonicalInputDigest, canonicalJson } from "../contracts/common.js";
import { AppPlatformError } from "../lifecycle/errors.js";

const DEFAULT_MAX_CONTENT_BYTES = 1_048_576;
const PHYSICAL_DELETE_RETENTION_CLASSES = new Set(["disposable_preview_cache", "transient_abandoned_operation"]);

const IdempotencyInputDigestSchema = AppDocumentRecordSchema.shape.content_digest;
const WriteIdempotencyRecordSchema = z.object({
  idempotency_version: z.literal(1),
  mutation_kind: z.literal("write"),
  input_digest: IdempotencyInputDigestSchema,
  result: AppDocumentStorageMutationResultSchema,
}).strict();
const DeleteIdempotencyRecordSchema = z.object({
  idempotency_version: z.literal(1),
  mutation_kind: z.literal("delete"),
  input_digest: IdempotencyInputDigestSchema,
  result: AppDocumentStorageDeletionResultSchema,
}).strict();
const IdempotencyRecordSchema = z.discriminatedUnion("mutation_kind", [WriteIdempotencyRecordSchema, DeleteIdempotencyRecordSchema]);
const LegacyWriteIdempotencyRecordSchema = AppDocumentStorageMutationResultSchema.extend({
  idempotency_version: z.literal(1),
  input_digest: AppDocumentRecordSchema.shape.content_digest,
}).omit({ result_version: true });
const ActiveAuthorityBindingSchema = AppDocumentStorageAuthoritySchema.extend({
  binding_version: z.literal(1),
  bound_at: AppDocumentRecordSchema.shape.updated_at,
}).strict();

type IdempotencyRecord = typeof IdempotencyRecordSchema["_output"];
type WriteIdempotencyRecord = typeof WriteIdempotencyRecordSchema["_output"];
type DeleteIdempotencyRecord = typeof DeleteIdempotencyRecordSchema["_output"];
type ActiveAuthorityBinding = typeof ActiveAuthorityBindingSchema["_output"];
type DocumentSlot =
  | { kind: "missing"; revision: null }
  | { kind: "record"; revision: number; record: AppDocumentRecord }
  | { kind: "tombstone"; revision: number; tombstone: AppDocumentTombstoneRecord };

type StoreOptions = {
  maxContentBytes?: number;
  now?: () => Date;
};

export class AppDocumentStorageService {
  private tail = Promise.resolve();

  constructor(
    private readonly root: string,
    private readonly options: StoreOptions = {},
  ) {
    if (!Number.isInteger(this.maxContentBytes) || this.maxContentBytes <= 0 || this.maxContentBytes > DEFAULT_MAX_CONTENT_BYTES) {
      throw new AppPlatformError("invalid_input", "App document content size bound is invalid", 400);
    }
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  async readDocument(authority: AppDocumentStorageAuthority, documentId: string): Promise<AppDocumentRecord | null> {
    const parsedAuthority = AppDocumentStorageAuthoritySchema.parse(authority);
    const slot = await this.readCurrentSlot(parsedAuthority, documentId);
    return slot.kind === "record" ? slot.record : null;
  }

  async listDocuments(authority: AppDocumentStorageAuthority): Promise<AppDocumentStorageListResult> {
    const parsedAuthority = AppDocumentStorageAuthoritySchema.parse(authority);
    return AppDocumentStorageListResultSchema.parse({
      result_version: 1,
      owner_id: parsedAuthority.owner_id,
      app_id: parsedAuthority.app_id,
      publisher_id: parsedAuthority.publisher_id,
      installation_id: parsedAuthority.installation_id,
      records: await this.listCurrentRecords(parsedAuthority),
      audits: await this.listDocumentAudits(parsedAuthority),
    });
  }

  async bindActiveAuthority(authority: AppDocumentStorageAuthority): Promise<void> {
    const parsedAuthority = AppDocumentStorageAuthoritySchema.parse(authority);
    await this.writeAtomic(this.activeAuthorityPath(parsedAuthority), ActiveAuthorityBindingSchema.parse({
      ...parsedAuthority,
      binding_version: 1,
      bound_at: this.now().toISOString(),
    }));
  }

  async deleteDocument(rawRequest: AppDocumentStorageDeletionRequest): Promise<AppDocumentStorageDeletionResult> {
    const request = AppDocumentStorageDeletionRequestSchema.parse(rawRequest);
    const inputDigest = canonicalInputDigest({
      request_version: request.request_version,
      authority: request.authority,
      document_id: request.document_id,
      expected_revision: request.expected_revision,
      operation_id: request.operation_id,
      idempotency_key: request.idempotency_key,
      delete_mode: request.delete_mode,
    });
    return this.serial(async () => {
      const replay = await this.readDeleteIdempotency(request.authority, request.idempotency_key);
      if (replay) {
        if (replay.input_digest !== inputDigest) {
          throw new AppPlatformError("idempotency_conflict", "App document idempotency key was reused with different canonical input", 409);
        }
        return replay.result;
      }

      await this.assertActiveMutationAuthority(request.authority);
      const current = await this.readCurrentSlot(request.authority, request.document_id);
      if (current.kind !== "record" || current.revision !== request.expected_revision) {
        throw new AppPlatformError("revision_conflict", "App document deletion compare-and-swap failed", 409, { currentRevision: current.revision ?? undefined });
      }
      if (request.delete_mode === "physical" && !PHYSICAL_DELETE_RETENTION_CLASSES.has(current.record.retention_class)) {
        throw new AppPlatformError("denied", "App document retention class requires a tombstone deletion", 403);
      }
      const now = this.now().toISOString();
      const tombstone = AppDocumentTombstoneRecordSchema.parse({
        tombstone_version: 1,
        record_kind: current.record.record_kind,
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
        document_id: current.record.document_id,
        document_binding_id: current.record.document_binding_id,
        role: current.record.role,
        retention_class: current.record.retention_class,
        media_type: current.record.media_type,
        revision: current.record.revision + 1,
        revision_id: randomUUID(),
        prior_revision_id: current.record.revision_id,
        operation_id: request.operation_id,
        idempotency_key: request.idempotency_key,
        delete_mode: request.delete_mode,
        prior_content_digest: current.record.content_digest,
        prior_content_size_bytes: current.record.content_size_bytes,
        deleted_at: now,
        deleted_by: request.authority,
      });
      const result = AppDocumentStorageDeletionResultSchema.parse({
        result_version: 1,
        state: "deleted",
        delete_mode: request.delete_mode,
        tombstone,
        audit: projectAppDocumentDeleteAudit(tombstone),
      });
      await this.writeAtomic(this.tombstonePath(request.authority, request.document_id), tombstone);
      await rm(this.documentPath(request.authority, request.document_id), { force: true });
      await this.writeAtomic(this.idempotencyPath(request.authority, request.idempotency_key), {
        idempotency_version: 1,
        mutation_kind: "delete",
        input_digest: inputDigest,
        result,
      } satisfies DeleteIdempotencyRecord);
      return result;
    });
  }

  private async readRecord(authority: AppDocumentStorageAuthority, documentId: string): Promise<AppDocumentRecord | null> {
    const parsedAuthority = AppDocumentStorageAuthoritySchema.parse(authority);
    try {
      const record = AppDocumentRecordSchema.parse(JSON.parse(await readFile(this.documentPath(parsedAuthority, documentId), "utf8")));
      assertRecordNamespace(record, parsedAuthority);
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async readTombstone(authority: AppDocumentStorageAuthority, documentId: string): Promise<AppDocumentTombstoneRecord | null> {
    try {
      const tombstone = AppDocumentTombstoneRecordSchema.parse(JSON.parse(await readFile(this.tombstonePath(authority, documentId), "utf8")));
      assertTombstoneNamespace(tombstone, authority);
      return tombstone;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async readCurrentSlot(authority: AppDocumentStorageAuthority, documentId: string): Promise<DocumentSlot> {
    const parsedAuthority = AppDocumentStorageAuthoritySchema.parse(authority);
    const [record, tombstone] = await Promise.all([
      this.readRecord(parsedAuthority, documentId),
      this.readTombstone(parsedAuthority, documentId),
    ]);
    if (record && (!tombstone || record.revision > tombstone.revision)) return { kind: "record", revision: record.revision, record };
    if (tombstone) return { kind: "tombstone", revision: tombstone.revision, tombstone };
    return { kind: "missing", revision: null };
  }

  async writeDocument(rawRequest: AppDocumentStorageMutationRequest): Promise<AppDocumentStorageMutationResult> {
    const request = AppDocumentStorageMutationRequestSchema.parse(rawRequest);
    const content = normalizeJsonContent(request.content);
    const contentSizeBytes = Buffer.byteLength(canonicalJson(content), "utf8");
    if (contentSizeBytes > this.maxContentBytes) {
      throw new AppPlatformError("validation_failed", "App document content exceeds the storage size limit", 413);
    }
    const inputDigest = canonicalInputDigest({
      request_version: request.request_version,
      authority: request.authority,
      document_id: request.document_id,
      document_binding_id: request.document_binding_id,
      record_kind: request.record_kind,
      role: request.role,
      retention_class: request.retention_class,
      media_type: request.media_type,
      expected_revision: request.expected_revision,
      operation_id: request.operation_id,
      idempotency_key: request.idempotency_key,
      content_digest: canonicalInputDigest(content),
      content_size_bytes: contentSizeBytes,
    });
    return this.serial(async () => {
      const replay = await this.readWriteIdempotency(request.authority, request.idempotency_key);
      if (replay) {
        if (replay.input_digest !== inputDigest) {
          throw new AppPlatformError("idempotency_conflict", "App document idempotency key was reused with different canonical input", 409);
        }
        return replay.result;
      }

      await this.assertActiveMutationAuthority(request.authority);
      const current = await this.readCurrentSlot(request.authority, request.document_id);
      if (request.expected_revision === null) {
        if (current.kind !== "missing") throw new AppPlatformError("revision_conflict", "App document already exists", 409, { currentRevision: current.revision });
      } else if (current.kind === "missing" || current.revision !== request.expected_revision) {
        throw new AppPlatformError("revision_conflict", "App document revision compare-and-swap failed", 409, { currentRevision: current.revision ?? undefined });
      }

      const now = this.now().toISOString();
      const priorRevisionId = current.kind === "missing" ? null : current.kind === "record" ? current.record.revision_id : current.tombstone.revision_id;
      const record = AppDocumentRecordSchema.parse({
        record_version: 1,
        record_kind: request.record_kind,
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
        document_id: request.document_id,
        document_binding_id: request.document_binding_id,
        role: request.role,
        retention_class: request.retention_class,
        media_type: request.media_type,
        revision: current.kind === "missing" ? 1 : current.revision + 1,
        revision_id: randomUUID(),
        prior_revision_id: priorRevisionId,
        operation_id: request.operation_id,
        idempotency_key: request.idempotency_key,
        content_digest: canonicalInputDigest(content),
        content_size_bytes: contentSizeBytes,
        content,
        created_at: current.kind === "record" ? current.record.created_at : now,
        created_by: current.kind === "record" ? current.record.created_by : request.authority,
        updated_at: now,
        updated_by: request.authority,
      });
      const result = AppDocumentStorageMutationResultSchema.parse({
        result_version: 1,
        record,
        audit: projectAppDocumentAudit(record),
      });
      await this.writeAtomic(this.documentPath(request.authority, request.document_id), record);
      await this.writeAtomic(this.idempotencyPath(request.authority, request.idempotency_key), {
        idempotency_version: 1,
        mutation_kind: "write",
        input_digest: inputDigest,
        result,
      } satisfies WriteIdempotencyRecord);
      return result;
    });
  }

  async listDocumentAudits(authority: AppDocumentStorageAuthority): Promise<AppDocumentAuditProjection[]> {
    const parsedAuthority = AppDocumentStorageAuthoritySchema.parse(authority);
    const [records, tombstones] = await Promise.all([
      this.listAllRecords(parsedAuthority),
      this.listAllTombstones(parsedAuthority),
    ]);
    return [
      ...records.map((record) => projectAppDocumentAudit(record)),
      ...tombstones.map((tombstone) => projectAppDocumentDeleteAudit(tombstone)),
    ].sort(compareAuditProjections);
  }

  private async listCurrentRecords(authority: AppDocumentStorageAuthority): Promise<AppDocumentRecord[]> {
    const [records, tombstones] = await Promise.all([
      this.listAllRecords(authority),
      this.listAllTombstones(authority),
    ]);
    const latestTombstone = new Map(tombstones.map((tombstone) => [tombstone.document_id, tombstone]));
    return records
      .filter((record) => {
        const tombstone = latestTombstone.get(record.document_id);
        return !tombstone || record.revision > tombstone.revision;
      })
      .sort((left, right) => left.document_id.localeCompare(right.document_id));
  }

  private async listAllRecords(authority: AppDocumentStorageAuthority): Promise<AppDocumentRecord[]> {
    const parsedAuthority = AppDocumentStorageAuthoritySchema.parse(authority);
    const root = this.documentsRoot(parsedAuthority);
    let names: string[];
    try {
      names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: AppDocumentRecord[] = [];
    for (const name of names) {
      const record = AppDocumentRecordSchema.parse(JSON.parse(await readFile(path.join(root, name), "utf8")));
      assertRecordNamespace(record, parsedAuthority);
      records.push(record);
    }
    return records;
  }

  private async listAllTombstones(authority: AppDocumentStorageAuthority): Promise<AppDocumentTombstoneRecord[]> {
    const parsedAuthority = AppDocumentStorageAuthoritySchema.parse(authority);
    const root = this.tombstonesRoot(parsedAuthority);
    let names: string[];
    try {
      names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const tombstones: AppDocumentTombstoneRecord[] = [];
    for (const name of names) {
      const tombstone = AppDocumentTombstoneRecordSchema.parse(JSON.parse(await readFile(path.join(root, name), "utf8")));
      assertTombstoneNamespace(tombstone, parsedAuthority);
      tombstones.push(tombstone);
    }
    return tombstones;
  }

  private async readWriteIdempotency(authority: AppDocumentStorageAuthority, idempotencyKey: string): Promise<WriteIdempotencyRecord | null> {
    const record = await this.readIdempotency(authority, idempotencyKey);
    if (!record) return null;
    if (record.mutation_kind !== "write") {
      throw new AppPlatformError("idempotency_conflict", "App document idempotency key was reused by a different mutation kind", 409);
    }
    return record;
  }

  private async readDeleteIdempotency(authority: AppDocumentStorageAuthority, idempotencyKey: string): Promise<DeleteIdempotencyRecord | null> {
    const record = await this.readIdempotency(authority, idempotencyKey);
    if (!record) return null;
    if (record.mutation_kind !== "delete") {
      throw new AppPlatformError("idempotency_conflict", "App document idempotency key was reused by a different mutation kind", 409);
    }
    return record;
  }

  private async readIdempotency(authority: AppDocumentStorageAuthority, idempotencyKey: string): Promise<IdempotencyRecord | null> {
    try {
      const raw = JSON.parse(await readFile(this.idempotencyPath(authority, idempotencyKey), "utf8")) as unknown;
      const parsed = IdempotencyRecordSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
      const legacy = LegacyWriteIdempotencyRecordSchema.safeParse(raw);
      if (legacy.success) {
        return WriteIdempotencyRecordSchema.parse({
          idempotency_version: 1,
          mutation_kind: "write",
          input_digest: legacy.data.input_digest,
          result: { result_version: 1, record: legacy.data.record, audit: legacy.data.audit },
        });
      }
      throw parsed.error;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async assertActiveMutationAuthority(authority: AppDocumentStorageAuthority): Promise<void> {
    const active = await this.readActiveAuthority(authority);
    if (!active) return;
    if (!authoritiesEqual(active, authority)) {
      throw new AppPlatformError("denied", "App document mutation authority does not match the active storage binding", 403);
    }
  }

  private async readActiveAuthority(authority: AppDocumentStorageAuthority): Promise<ActiveAuthorityBinding | null> {
    try {
      return ActiveAuthorityBindingSchema.parse(JSON.parse(await readFile(this.activeAuthorityPath(authority), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private documentPath(authority: AppDocumentStorageAuthority, documentId: string): string {
    return path.join(this.documentsRoot(authority), `${hashSegment(documentId)}.json`);
  }

  private documentsRoot(authority: AppDocumentStorageAuthority): string {
    return path.join(this.namespaceRoot(authority), "documents");
  }

  private tombstonePath(authority: AppDocumentStorageAuthority, documentId: string): string {
    return path.join(this.tombstonesRoot(authority), `${hashSegment(documentId)}.json`);
  }

  private tombstonesRoot(authority: AppDocumentStorageAuthority): string {
    return path.join(this.namespaceRoot(authority), "tombstones");
  }

  private activeAuthorityPath(authority: AppDocumentStorageAuthority): string {
    return path.join(this.namespaceRoot(authority), "authority", "current.json");
  }

  private idempotencyPath(authority: AppDocumentStorageAuthority, idempotencyKey: string): string {
    return path.join(this.namespaceRoot(authority), "idempotency", `${hashSegment(idempotencyKey)}.json`);
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

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private get maxContentBytes(): number {
    return this.options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;
  }
}

export function projectAppDocumentAudit(record: AppDocumentRecord): AppDocumentAuditProjection {
  return AppDocumentAuditProjectionSchema.parse({
    audit_projection_version: 1,
    event: "app.storage.document.write",
    owner_id: record.owner_id,
    actor_id: record.actor_id,
    app_id: record.app_id,
    publisher_id: record.publisher_id,
    installation_id: record.installation_id,
    package_digest: record.package_digest,
    lifecycle_generation: record.lifecycle_generation,
    grant_id: record.grant_id,
    grant_revision: record.grant_revision,
    revocation_generation: record.revocation_generation,
    document_id: record.document_id,
    document_binding_id: record.document_binding_id,
    record_kind: record.record_kind,
    role: record.role,
    retention_class: record.retention_class,
    revision: record.revision,
    revision_id: record.revision_id,
    prior_revision_id: record.prior_revision_id,
    operation_id: record.operation_id,
    idempotency_key_digest: canonicalInputDigest(record.idempotency_key),
    content_digest: record.content_digest,
    content_size_bytes: record.content_size_bytes,
    delete_mode: null,
    deleted_at: null,
    updated_at: record.updated_at,
  });
}

export function projectAppDocumentDeleteAudit(tombstone: AppDocumentTombstoneRecord): AppDocumentAuditProjection {
  return AppDocumentAuditProjectionSchema.parse({
    audit_projection_version: 1,
    event: "app.storage.document.delete",
    owner_id: tombstone.owner_id,
    actor_id: tombstone.actor_id,
    app_id: tombstone.app_id,
    publisher_id: tombstone.publisher_id,
    installation_id: tombstone.installation_id,
    package_digest: tombstone.package_digest,
    lifecycle_generation: tombstone.lifecycle_generation,
    grant_id: tombstone.grant_id,
    grant_revision: tombstone.grant_revision,
    revocation_generation: tombstone.revocation_generation,
    document_id: tombstone.document_id,
    document_binding_id: tombstone.document_binding_id,
    record_kind: tombstone.record_kind,
    role: tombstone.role,
    retention_class: tombstone.retention_class,
    revision: tombstone.revision,
    revision_id: tombstone.revision_id,
    prior_revision_id: tombstone.prior_revision_id,
    operation_id: tombstone.operation_id,
    idempotency_key_digest: canonicalInputDigest(tombstone.idempotency_key),
    content_digest: tombstone.prior_content_digest,
    content_size_bytes: tombstone.prior_content_size_bytes,
    delete_mode: tombstone.delete_mode,
    deleted_at: tombstone.deleted_at,
    updated_at: tombstone.deleted_at,
  });
}

function assertRecordNamespace(record: AppDocumentRecord, authority: AppDocumentStorageAuthority): void {
  if (
    record.owner_id !== authority.owner_id ||
    record.app_id !== authority.app_id ||
    record.publisher_id !== authority.publisher_id ||
    record.installation_id !== authority.installation_id
  ) {
    throw new AppPlatformError("denied", "App document is outside the selected storage namespace", 403);
  }
}

function assertTombstoneNamespace(tombstone: AppDocumentTombstoneRecord, authority: AppDocumentStorageAuthority): void {
  if (
    tombstone.owner_id !== authority.owner_id ||
    tombstone.app_id !== authority.app_id ||
    tombstone.publisher_id !== authority.publisher_id ||
    tombstone.installation_id !== authority.installation_id
  ) {
    throw new AppPlatformError("denied", "App document tombstone is outside the selected storage namespace", 403);
  }
}

function authoritiesEqual(left: AppDocumentStorageAuthority, right: AppDocumentStorageAuthority): boolean {
  return left.owner_id === right.owner_id &&
    left.actor_id === right.actor_id &&
    left.app_id === right.app_id &&
    left.publisher_id === right.publisher_id &&
    left.installation_id === right.installation_id &&
    left.package_digest === right.package_digest &&
    left.lifecycle_generation === right.lifecycle_generation &&
    left.grant_id === right.grant_id &&
    left.grant_revision === right.grant_revision &&
    left.revocation_generation === right.revocation_generation;
}

function compareAuditProjections(left: AppDocumentAuditProjection, right: AppDocumentAuditProjection): number {
  return left.document_id.localeCompare(right.document_id) ||
    left.revision - right.revision ||
    left.updated_at.localeCompare(right.updated_at);
}

function normalizeJsonContent(value: unknown): unknown {
  try {
    canonicalJson(value);
    return value;
  } catch {
    throw new AppPlatformError("invalid_input", "App document content must be JSON-compatible", 400);
  }
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
