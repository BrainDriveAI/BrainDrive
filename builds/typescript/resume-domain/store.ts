import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { canonicalInputDigest, canonicalJson, OpaqueIdSchema, TimestampSchema } from "../app-platform/contracts/common.js";
import { MigrationRecordSchema, ResumeDataRecordSchema } from "../app-platform/contracts/data.js";
import { OperationRecordSchema } from "../app-platform/contracts/lifecycle.js";
import { commitMemoryChange } from "../git.js";
import { ResumeDomainError } from "./errors.js";

export type ResumeDataRecord = z.infer<typeof ResumeDataRecordSchema>;
export type OperationRecord = z.infer<typeof OperationRecordSchema>;

const RecordHeadSchema = z.object({
  record_id: OpaqueIdSchema,
  revision_id: OpaqueIdSchema,
  revision: z.number().int().positive(),
  record_type: z.string().min(1).max(128),
}).strict();

const RecordLocatorSchema = RecordHeadSchema.extend({ relative_path: z.string().regex(/^records\/[a-z_]+\/[0-9a-f-]+\/[0-9a-f-]+\.json$/) }).strict();
const CatalogOperationSchema = z.object({ record: OperationRecordSchema, result_revision_ids: z.array(OpaqueIdSchema) }).strict();

export const ResumeDataCatalogSchema = z.object({
  catalog_version: z.literal(1),
  data_schema_version: z.literal(1),
  owner_id: OpaqueIdSchema,
  generation: z.number().int().nonnegative(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  heads: z.record(OpaqueIdSchema, RecordHeadSchema),
  revisions: z.record(OpaqueIdSchema, RecordLocatorSchema),
  operations: z.record(OpaqueIdSchema, CatalogOperationSchema),
  extensions: z.record(z.string(), z.unknown()),
}).strict();

const LegacyCatalogSchema = z.object({
  catalog_version: z.literal(0),
  data_schema_version: z.literal(0),
  owner_id: OpaqueIdSchema,
  records: z.array(ResumeDataRecordSchema),
  extensions: z.record(z.string(), z.unknown()).default({}),
}).strict();

const MigrationMarkerSchema = z.object({
  marker_version: z.literal(1),
  snapshot_path: z.string().regex(/^recovery\/[0-9a-f-]{36}\.catalog-v0\.json$/),
  staged_path: z.string().regex(/^catalog\.[0-9a-f-]{36}\.staged\.json$/),
}).strict();

export type ResumeDataCatalog = z.infer<typeof ResumeDataCatalogSchema>;

export type MutationContext = {
  operationId: string;
  idempotencyKey: string;
  canonicalInput: unknown;
  ownerId: string;
  actorId: string;
  installationId: string;
  capability: string;
  targetCategory: string;
  targetId: string | null;
  expectedRevision: number | null;
  isCancelled?: () => boolean;
};

type StoreHooks = {
  beforeCatalogCommit?: () => Promise<void>;
  afterCatalogCommit?: () => Promise<void>;
  migrationTransform?: (legacy: z.infer<typeof LegacyCatalogSchema>) => z.infer<typeof LegacyCatalogSchema>;
};

export class ResumeDataStore {
  private tail = Promise.resolve();
  private readonly catalogPath: string;
  private readonly migrationMarkerPath: string;

  constructor(
    public readonly memoryRoot: string,
    public readonly namespaceRoot = path.join(memoryRoot, "apps", "resume-builder"),
    private readonly hooks: StoreHooks = {},
    private readonly writeHistory = true,
  ) {
    this.catalogPath = path.join(namespaceRoot, "catalog.json");
    this.migrationMarkerPath = path.join(namespaceRoot, "migration-transaction.json");
  }

  async initialize(ownerId: string): Promise<void> {
    await mkdir(path.join(this.namespaceRoot, "records"), { recursive: true });
    await mkdir(path.join(this.namespaceRoot, "recovery"), { recursive: true });
    await this.reconcileMigration();
    try {
      const raw = JSON.parse(await readFile(this.catalogPath, "utf8")) as { data_schema_version?: number };
      if (raw.data_schema_version === 0) {
        await this.migrateLegacy(raw, ownerId);
        return;
      }
      if (raw.data_schema_version !== 1) throw new ResumeDomainError("incompatible_schema", "Retained Resume Builder data requires a compatible app version", 409);
      const catalog = ResumeDataCatalogSchema.parse(raw);
      if (catalog.owner_id !== ownerId) throw new ResumeDomainError("denied", "Retained owner data belongs to a different owner", 403);
      await this.validateReferencedRecords(catalog);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        if (error instanceof ResumeDomainError) throw error;
        if (error instanceof z.ZodError) throw new ResumeDomainError("validation_failed", "Resume Builder owner-data catalog is invalid", 409);
        throw error;
      }
      const now = new Date().toISOString();
      await this.writeAtomic(this.catalogPath, ResumeDataCatalogSchema.parse({
        catalog_version: 1, data_schema_version: 1, owner_id: ownerId, generation: 0,
        created_at: now, updated_at: now, heads: {}, revisions: {}, operations: {}, extensions: {},
      }));
      await this.commitHistory("Initialize Resume Builder owner data");
    }
  }

  async catalog(): Promise<ResumeDataCatalog> {
    try { return ResumeDataCatalogSchema.parse(JSON.parse(await readFile(this.catalogPath, "utf8"))); }
    catch (error) {
      if (error instanceof z.ZodError) throw new ResumeDomainError("validation_failed", "Resume Builder owner-data catalog is invalid");
      throw error;
    }
  }

  async readHead(recordId: string, recordScopes: readonly string[] = []): Promise<ResumeDataRecord> {
    if (!OpaqueIdSchema.safeParse(recordId).success || (recordScopes.length > 0 && !recordScopes.includes(recordId))) {
      throw new ResumeDomainError("not_found_within_scope", "Record was not found within the granted scope", 404);
    }
    const catalog = await this.catalog();
    const head = catalog.heads[recordId];
    if (!head) throw new ResumeDomainError("not_found_within_scope", "Record was not found within the granted scope", 404);
    return this.readRevisionFromCatalog(catalog, head.revision_id);
  }

  async readRevision(revisionId: string, recordScopes: readonly string[] = []): Promise<ResumeDataRecord> {
    const catalog = await this.catalog();
    const locator = catalog.revisions[revisionId];
    if (!locator || (recordScopes.length > 0 && !recordScopes.includes(locator.record_id))) {
      throw new ResumeDomainError("not_found_within_scope", "Record was not found within the granted scope", 404);
    }
    return this.readRevisionFromCatalog(catalog, revisionId);
  }

  async list(recordType: ResumeDataRecord["record_type"], recordScopes: readonly string[] = []): Promise<ResumeDataRecord[]> {
    const catalog = await this.catalog();
    const heads = Object.values(catalog.heads)
      .filter((head) => head.record_type === recordType && (recordScopes.length === 0 || recordScopes.includes(head.record_id)))
      .sort((left, right) => left.record_id.localeCompare(right.record_id));
    return Promise.all(heads.map((head) => this.readRevisionFromCatalog(catalog, head.revision_id)));
  }

  async operation(operationId: string, installationId: string): Promise<{ record: OperationRecord; results: ResumeDataRecord[] }> {
    const catalog = await this.catalog();
    const entry = catalog.operations[operationId];
    if (!entry || entry.record.installation_id !== installationId) {
      throw new ResumeDomainError("not_found_within_scope", "Operation was not found within the granted scope", 404);
    }
    return { record: entry.record, results: await Promise.all(entry.result_revision_ids.map((id) => this.readRevisionFromCatalog(catalog, id))) };
  }

  async commit(records: ResumeDataRecord[], context: MutationContext): Promise<{ operation: OperationRecord; records: ResumeDataRecord[]; reused: boolean }> {
    return this.serial(async () => {
      const catalog = await this.catalog();
      const inputDigest = canonicalInputDigest(context.canonicalInput);
      const existing = catalog.operations[context.operationId];
      if (existing) {
        if (existing.record.installation_id !== context.installationId || existing.record.idempotency_key !== context.idempotencyKey || existing.record.canonical_input_digest !== inputDigest || existing.record.capability !== context.capability) {
          throw new ResumeDomainError("idempotency_conflict", "Operation identity was reused with different canonical input");
        }
        const results = await Promise.all(existing.result_revision_ids.map((id) => this.readRevisionFromCatalog(catalog, id)));
        if (existing.record.status === "cancelled_before_commit") throw new ResumeDomainError("cancelled", "Operation was cancelled before commit");
        return { operation: { ...existing.record, commit_outcome: "committed_response_recovered" }, records: results, reused: true };
      }
      this.validateMutation(records, catalog, context);
      const now = new Date().toISOString();
      if (context.isCancelled?.()) {
        const operation = this.operationRecord(context, inputDigest, now, "cancelled_before_commit", "not_committed", null);
        const next = ResumeDataCatalogSchema.parse({ ...catalog, generation: catalog.generation + 1, updated_at: now, operations: { ...catalog.operations, [context.operationId]: { record: operation, result_revision_ids: [] } } });
        await this.writeAtomic(this.catalogPath, next);
        await this.commitHistory(`Record cancelled Resume Builder ${context.targetCategory} operation`);
        throw new ResumeDomainError("cancelled", "Operation was cancelled before commit");
      }
      const locators: Array<z.infer<typeof RecordLocatorSchema>> = [];
      for (const record of records) {
        const relativePath = this.recordRelativePath(record);
        await this.writeAtomic(path.join(this.namespaceRoot, relativePath), record);
        locators.push({ record_id: record.metadata.record_id, revision_id: record.metadata.revision_id, revision: record.metadata.revision, record_type: record.record_type, relative_path: relativePath });
      }
      await this.hooks.beforeCatalogCommit?.();
      if (context.isCancelled?.()) {
        await this.removeUncommitted(locators);
        const cancelled = this.operationRecord(context, inputDigest, now, "cancelled_before_commit", "not_committed", null);
        const next = ResumeDataCatalogSchema.parse({ ...catalog, generation: catalog.generation + 1, updated_at: now, operations: { ...catalog.operations, [context.operationId]: { record: cancelled, result_revision_ids: [] } } });
        await this.writeAtomic(this.catalogPath, next);
        await this.commitHistory(`Record cancelled Resume Builder ${context.targetCategory} operation`);
        throw new ResumeDomainError("cancelled", "Operation was cancelled before commit");
      }
      const resultRef = records[records.length - 1]?.metadata.revision_id ?? null;
      const operation = this.operationRecord(context, inputDigest, now, "committed", "committed", resultRef);
      const heads = { ...catalog.heads };
      const revisions = { ...catalog.revisions };
      for (const locator of locators) {
        heads[locator.record_id] = { record_id: locator.record_id, revision_id: locator.revision_id, revision: locator.revision, record_type: locator.record_type };
        revisions[locator.revision_id] = locator;
      }
      const next = ResumeDataCatalogSchema.parse({ ...catalog, generation: catalog.generation + 1, updated_at: now, heads, revisions, operations: { ...catalog.operations, [context.operationId]: { record: operation, result_revision_ids: records.map((record) => record.metadata.revision_id) } } });
      await this.writeAtomic(this.catalogPath, next);
      await this.commitHistory(`Commit Resume Builder ${context.targetCategory} operation`);
      await this.hooks.afterCatalogCommit?.();
      return { operation, records, reused: false };
    });
  }

  private validateMutation(records: ResumeDataRecord[], catalog: ResumeDataCatalog, context: MutationContext): void {
    if (records.length === 0) throw new ResumeDomainError("invalid_input", "A durable mutation requires at least one record", 400);
    if (!OpaqueIdSchema.safeParse(context.operationId).success) throw new ResumeDomainError("invalid_input", "Operation identity is invalid", 400);
    const ids = new Set<string>();
    const revisionIds = new Set<string>();
    for (const candidate of records) {
      const record = ResumeDataRecordSchema.parse(candidate);
      if (record.owner_id !== context.ownerId || record.metadata.created_by.owner_id !== context.ownerId || record.metadata.created_by.actor_id !== context.actorId || record.metadata.created_by.installation_id !== context.installationId) {
        throw new ResumeDomainError("denied", "Record attribution does not match capability authority", 403);
      }
      if (ids.has(record.metadata.record_id) || revisionIds.has(record.metadata.revision_id) || catalog.revisions[record.metadata.revision_id]) throw new ResumeDomainError("conflict", "Duplicate record or revision identity");
      ids.add(record.metadata.record_id);
      revisionIds.add(record.metadata.revision_id);
      const current = catalog.heads[record.metadata.record_id];
      if (current) {
        if (context.targetId !== record.metadata.record_id || context.expectedRevision !== current.revision || record.metadata.revision !== current.revision + 1 || record.metadata.prior_revision_id !== current.revision_id) {
          throw new ResumeDomainError("conflict", "Expected record revision does not match the current revision");
        }
      } else if (record.metadata.revision !== 1 || record.metadata.prior_revision_id !== null) {
        throw new ResumeDomainError("conflict", "New records must begin at revision one");
      }
    }
    if (context.targetId) {
      const current = catalog.heads[context.targetId];
      if (!current || context.expectedRevision !== current.revision) throw new ResumeDomainError("conflict", "Expected record revision does not match the current revision");
    } else if (context.expectedRevision !== null) {
      throw new ResumeDomainError("conflict", "Create operations cannot carry an expected revision");
    }
  }

  private operationRecord(context: MutationContext, inputDigest: `sha256:${string}`, now: string, status: "committed" | "cancelled_before_commit", outcome: "committed" | "not_committed", resultRef: string | null): OperationRecord {
    return OperationRecordSchema.parse({ operation_schema_version: 1, operation_id: context.operationId, idempotency_key: context.idempotencyKey, canonical_input_digest: inputDigest, owner_id: context.ownerId, actor_id: context.actorId, app_id: "ai.braindrive.resume-builder", installation_id: context.installationId, capability: context.capability, target_category: context.targetCategory, target_id: context.targetId, expected_revision: context.expectedRevision, status, commit_outcome: outcome, last_cancellable_status: "running", started_at: now, completed_at: now, result_ref: resultRef, error_code: null });
  }

  private async readRevisionFromCatalog(catalog: ResumeDataCatalog, revisionId: string): Promise<ResumeDataRecord> {
    const locator = catalog.revisions[revisionId];
    if (!locator) throw new ResumeDomainError("not_found_within_scope", "Record was not found within the granted scope", 404);
    try {
      const record = ResumeDataRecordSchema.parse(JSON.parse(await readFile(path.join(this.namespaceRoot, locator.relative_path), "utf8")));
      if (record.metadata.revision_id !== revisionId || record.metadata.record_id !== locator.record_id) throw new Error("locator mismatch");
      return record;
    } catch {
      throw new ResumeDomainError("validation_failed", "A referenced Resume Builder record is corrupt or missing");
    }
  }

  private async validateReferencedRecords(catalog: ResumeDataCatalog): Promise<void> {
    await Promise.all(Object.keys(catalog.revisions).map((revisionId) => this.readRevisionFromCatalog(catalog, revisionId)));
  }

  private recordRelativePath(record: ResumeDataRecord): string {
    return path.posix.join("records", record.record_type, record.metadata.record_id, `${record.metadata.revision_id}.json`);
  }

  private async migrateLegacy(raw: unknown, ownerId: string): Promise<void> {
    let legacy = LegacyCatalogSchema.parse(raw);
    if (legacy.owner_id !== ownerId) throw new ResumeDomainError("denied", "Retained owner data belongs to a different owner", 403);
    const snapshotId = randomUUID();
    const snapshotPath = path.join(this.namespaceRoot, "recovery", `${snapshotId}.catalog-v0.json`);
    await this.writeAtomic(snapshotPath, raw);
    const now = new Date().toISOString();
    const heads: ResumeDataCatalog["heads"] = {};
    const revisions: ResumeDataCatalog["revisions"] = {};
    try {
      legacy = LegacyCatalogSchema.parse(this.hooks.migrationTransform?.(legacy) ?? legacy);
      for (const record of legacy.records) {
        const relativePath = this.recordRelativePath(record);
        await this.writeAtomic(path.join(this.namespaceRoot, relativePath), record);
        const locator = RecordLocatorSchema.parse({ record_id: record.metadata.record_id, revision_id: record.metadata.revision_id, revision: record.metadata.revision, record_type: record.record_type, relative_path: relativePath });
        revisions[locator.revision_id] = locator;
        const current = heads[locator.record_id];
        if (!current || current.revision < locator.revision) heads[locator.record_id] = { record_id: locator.record_id, revision_id: locator.revision_id, revision: locator.revision, record_type: locator.record_type };
      }
      const migrationId = randomUUID();
      const migrationRevisionId = randomUUID();
      const stagedBase = { catalog_version: 1, data_schema_version: 1, owner_id: ownerId, generation: 1, created_at: now, updated_at: now, heads, revisions, operations: {}, extensions: legacy.extensions } as const;
      const migration = MigrationRecordSchema.parse({
        schema_version: 1, record_type: "migration",
        metadata: { record_id: migrationId, revision_id: migrationRevisionId, revision: 1, created_at: now, created_by: { owner_id: ownerId, actor_id: ownerId, app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive", package_digest: `sha256:${"0".repeat(64)}`, installation_id: "00000000-0000-4000-8000-000000000000" }, prior_revision_id: null, extensions: {} },
        owner_id: ownerId, updated_at: now, lifecycle_state: "active", sensitivity: "standard", retention_class: "rollback_recovery_window", extensions: {},
        migration_id: migrationId, from_schema_version: 0, to_schema_version: 1, status: "committed",
        source_catalog_digest: canonicalInputDigest(raw), result_catalog_digest: canonicalInputDigest(stagedBase), recovery_snapshot_id: snapshotId,
        started_at: now, completed_at: now,
      });
      const migrationRelativePath = this.recordRelativePath(migration);
      await this.writeAtomic(path.join(this.namespaceRoot, migrationRelativePath), migration);
      const migrationLocator = RecordLocatorSchema.parse({ record_id: migrationId, revision_id: migrationRevisionId, revision: 1, record_type: "migration", relative_path: migrationRelativePath });
      heads[migrationId] = { record_id: migrationId, revision_id: migrationRevisionId, revision: 1, record_type: "migration" };
      revisions[migrationRevisionId] = migrationLocator;
      const stagedPath = path.join(this.namespaceRoot, `catalog.${snapshotId}.staged.json`);
      const staged = ResumeDataCatalogSchema.parse({ catalog_version: 1, data_schema_version: 1, owner_id: ownerId, generation: 1, created_at: now, updated_at: now, heads, revisions, operations: {}, extensions: legacy.extensions });
      await this.writeAtomic(stagedPath, staged);
      await this.writeAtomic(this.migrationMarkerPath, { marker_version: 1, snapshot_path: path.relative(this.namespaceRoot, snapshotPath), staged_path: path.relative(this.namespaceRoot, stagedPath) });
      await rename(stagedPath, this.catalogPath);
      await rm(this.migrationMarkerPath, { force: true });
      await this.commitHistory("Migrate Resume Builder owner data schema 0 to 1");
    } catch (error) {
      await this.copyAtomic(snapshotPath, this.catalogPath);
      await rm(this.migrationMarkerPath, { force: true });
      throw new ResumeDomainError("recoverable_internal_failure", `Resume Builder data migration rolled back: ${error instanceof Error ? error.name : "failure"}`, 500);
    }
  }

  private async reconcileMigration(): Promise<void> {
    try {
      const marker = MigrationMarkerSchema.parse(JSON.parse(await readFile(this.migrationMarkerPath, "utf8")));
      const stagedPath = path.join(this.namespaceRoot, marker.staged_path);
      try {
        const staged = ResumeDataCatalogSchema.parse(JSON.parse(await readFile(stagedPath, "utf8")));
        await this.validateReferencedRecords(staged);
        await rename(stagedPath, this.catalogPath);
      } catch {
        await this.copyAtomic(path.join(this.namespaceRoot, marker.snapshot_path), this.catalogPath);
      }
      await rm(this.migrationMarkerPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ResumeDomainError("recoverable_internal_failure", "Resume Builder migration recovery metadata is invalid", 500);
    }
  }

  private async removeUncommitted(locators: Array<z.infer<typeof RecordLocatorSchema>>): Promise<void> {
    await Promise.all(locators.map((locator) => rm(path.join(this.namespaceRoot, locator.relative_path), { force: true })));
  }

  private async copyAtomic(source: string, target: string): Promise<void> {
    await this.writeAtomic(target, JSON.parse(await readFile(source, "utf8")));
  }

  private async commitHistory(message: string): Promise<void> {
    if (this.writeHistory) await commitMemoryChange(this.memoryRoot, message);
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async writeAtomic(targetPath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try { await handle.writeFile(`${canonicalJson(value)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
    try {
      await rename(temporaryPath, targetPath);
      const directory = await open(path.dirname(targetPath), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) { await rm(temporaryPath, { force: true }); throw error; }
  }
}
