import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  canonicalInputDigest,
  canonicalJson,
  OpaqueIdSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from "../app-platform/contracts/common.js";
import { JobEvidenceCoverageRecordSchema, JobEvidenceValueSchema, MigrationRecordSchema, ResumeDataRecordSchema } from "../app-platform/contracts/data.js";
import { RESUME_DATA_SCHEMA_VERSION } from "../app-platform/contracts/constants.js";
import { MigrationProvenanceSchema } from "../app-platform/contracts/data-conformance.js";
import { OperationRecordSchema } from "../app-platform/contracts/lifecycle.js";
import { commitMemoryChange } from "../git.js";
import { ResumeDomainError } from "./errors.js";
import { validateResumeLineageRecords } from "./resume-lineage.js";

export type ResumeDataRecord = z.infer<typeof ResumeDataRecordSchema>;
export type OperationRecord = z.infer<typeof OperationRecordSchema>;

const RecordHeadSchema = z.object({
  record_id: OpaqueIdSchema,
  revision_id: OpaqueIdSchema,
  revision: z.number().int().positive(),
  record_type: z.string().min(1).max(128),
}).strict();

const LegacyRecordLocatorSchema = RecordHeadSchema.extend({
  relative_path: z.string().regex(/^records\/[a-z_]+\/[0-9a-f-]+\/[0-9a-f-]+\.json$/),
}).strict();
const RecordLocatorSchema = LegacyRecordLocatorSchema.extend({ content_digest: Sha256DigestSchema }).strict();
const CatalogOperationSchema = z.object({ record: OperationRecordSchema, result_revision_ids: z.array(OpaqueIdSchema) }).strict();

const CatalogFields = {
  catalog_version: z.literal(1),
  owner_id: OpaqueIdSchema,
  generation: z.number().int().nonnegative(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  heads: z.record(OpaqueIdSchema, RecordHeadSchema),
  revisions: z.record(OpaqueIdSchema, RecordLocatorSchema),
  operations: z.record(OpaqueIdSchema, CatalogOperationSchema),
  extensions: z.record(z.string(), z.unknown()),
} as const;

const CatalogBodyV1Schema = z.object({ ...CatalogFields, data_schema_version: z.literal(1) }).strict();
const CatalogBodyV2Schema = z.object({ ...CatalogFields, data_schema_version: z.literal(2) }).strict();
const CatalogBodyV3Schema = z.object({ ...CatalogFields, data_schema_version: z.literal(3) }).strict();
const CatalogBodySchema = z.object({ ...CatalogFields, data_schema_version: z.literal(RESUME_DATA_SCHEMA_VERSION) }).strict();

export const ResumeDataCatalogSchema = CatalogBodySchema.extend({ integrity_digest: Sha256DigestSchema }).strict();
const ResumeDataCatalogV1Schema = CatalogBodyV1Schema.extend({ integrity_digest: Sha256DigestSchema }).strict();
const ResumeDataCatalogV2Schema = CatalogBodyV2Schema.extend({ integrity_digest: Sha256DigestSchema }).strict();
const ResumeDataCatalogV3Schema = CatalogBodyV3Schema.extend({ integrity_digest: Sha256DigestSchema }).strict();

const UnsealedCatalogSchema = CatalogBodySchema.omit({ revisions: true }).extend({
  revisions: z.record(OpaqueIdSchema, LegacyRecordLocatorSchema),
}).strict();

const StoreManifestSchema = z.object({
  manifest_version: z.literal(1),
  data_schema_version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(RESUME_DATA_SCHEMA_VERSION)]),
  active_catalog: z.literal("catalog.json"),
  records_directory: z.literal("records"),
  transactions_directory: z.literal("transactions"),
  integrity_algorithm: z.literal("sha256"),
}).strict();

const STORE_MANIFEST = StoreManifestSchema.parse({
  manifest_version: 1,
  data_schema_version: RESUME_DATA_SCHEMA_VERSION,
  active_catalog: "catalog.json",
  records_directory: "records",
  transactions_directory: "transactions",
  integrity_algorithm: "sha256",
});

const LegacyLeaseSchema = z.object({
  lease_version: z.literal(1),
  lease_id: OpaqueIdSchema,
  owner_pid: z.number().int().positive(),
  acquired_at: TimestampSchema,
  expires_at: TimestampSchema,
}).strict();

const LeaseSchema = z.union([
  LegacyLeaseSchema,
  z.object({
    lease_version: z.literal(2),
    lease_id: OpaqueIdSchema,
    owner_pid: z.number().int().positive(),
    owner_instance_id: OpaqueIdSchema,
    owner_process_start_ticks: z.string().regex(/^\d+$/).nullable(),
    acquired_at: TimestampSchema,
    expires_at: TimestampSchema,
  }).strict(),
]);

const PROCESS_INSTANCE_ID = randomUUID();

const TransactionSchema = z.object({
  transaction_version: z.literal(1),
  transaction_id: OpaqueIdSchema,
  owner_id: OpaqueIdSchema,
  operation_id: OpaqueIdSchema,
  installation_id: OpaqueIdSchema,
  canonical_input_digest: Sha256DigestSchema,
  base_generation: z.number().int().nonnegative(),
  next_generation: z.number().int().positive(),
  state: z.enum(["staged", "promoted"]),
  record_relative_paths: z.array(z.string().regex(/^records\/[a-z_]+\/[0-9a-f-]+\/[0-9a-f-]+\.json$/)),
  staged_catalog_relative_path: z.string().regex(/^transactions\/[0-9a-f-]{36}\/catalog\.json$/),
  created_at: TimestampSchema,
  expires_at: TimestampSchema,
}).strict();

const LegacyCatalogSchema = z.object({
  catalog_version: z.literal(0),
  data_schema_version: z.literal(0),
  owner_id: OpaqueIdSchema,
  records: z.array(ResumeDataRecordSchema),
  extensions: z.record(z.string(), z.unknown()).default({}),
}).strict();

const VersionedMigrationMarkerSchema = z.object({
  marker_version: z.literal(1),
  from_schema_version: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  to_schema_version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(RESUME_DATA_SCHEMA_VERSION)]),
  snapshot_path: z.string().regex(/^recovery\/[0-9a-f-]{36}\.catalog-v[0123]\.json$/),
  staged_path: z.string().regex(/^catalog\.[0-9a-f-]{36}\.staged\.json$/),
}).strict().superRefine((value, context) => {
  if (value.to_schema_version !== value.from_schema_version + 1) context.addIssue({ code: "custom", message: "migration marker must describe one forward schema step" });
});
const LegacyMigrationMarkerSchema = z.object({
  marker_version: z.literal(1),
  snapshot_path: z.string().regex(/^recovery\/[0-9a-f-]{36}\.catalog-v0\.json$/),
  staged_path: z.string().regex(/^catalog\.[0-9a-f-]{36}\.staged\.json$/),
}).strict();
const MigrationMarkerSchema = z.union([VersionedMigrationMarkerSchema, LegacyMigrationMarkerSchema]);

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
  expectedRevisions?: Readonly<Record<string, number>>;
  isCancelled?: () => boolean;
};

export type MigrationFaultPoint =
  | "after_snapshot"
  | "after_records"
  | "after_staged_catalog"
  | "after_marker"
  | "after_catalog_switch";

export type StoreHooks = {
  afterTransactionStaged?: () => Promise<void>;
  beforeRecordPromote?: () => Promise<void>;
  afterRecordsPromoted?: () => Promise<void>;
  beforeCatalogCommit?: () => Promise<void>;
  afterCatalogCommit?: () => Promise<void>;
  migrationTransform?: (legacy: z.infer<typeof LegacyCatalogSchema>) => z.infer<typeof LegacyCatalogSchema>;
  migrationFaultPoint?: MigrationFaultPoint;
  gitCheckpoint?: (memoryRoot: string, message: string) => Promise<void>;
  onDiagnostic?: (event: string, details: Readonly<Record<string, string | number | boolean | null>>) => void;
  leaseTtlMs?: number;
  leaseWaitMs?: number;
  leaseRetryMs?: number;
};

type Lease = z.infer<typeof LeaseSchema>;
type Transaction = z.infer<typeof TransactionSchema>;

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

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? code : "CHECKPOINT_FAILED";
}

function catalogDigest(catalog: z.infer<typeof CatalogBodySchema>): `sha256:${string}` {
  return canonicalInputDigest(catalog);
}

function sealCatalog(catalog: z.infer<typeof CatalogBodySchema>): ResumeDataCatalog {
  return ResumeDataCatalogSchema.parse({ ...catalog, integrity_digest: catalogDigest(catalog) });
}

function verifyCatalog(raw: unknown): ResumeDataCatalog {
  const catalog = ResumeDataCatalogSchema.parse(raw);
  const { integrity_digest: integrityDigest, ...body } = catalog;
  if (catalogDigest(CatalogBodySchema.parse(body)) !== integrityDigest) {
    throw new ResumeDomainError("validation_failed", "Resume Builder owner-data catalog integrity check failed", 409);
  }
  return catalog;
}

function verifyCatalogV1(raw: unknown): z.infer<typeof ResumeDataCatalogV1Schema> {
  const catalog = ResumeDataCatalogV1Schema.parse(raw);
  const { integrity_digest: integrityDigest, ...body } = catalog;
  if (canonicalInputDigest(CatalogBodyV1Schema.parse(body)) !== integrityDigest) {
    throw new ResumeDomainError("validation_failed", "Resume Builder owner-data catalog integrity check failed", 409);
  }
  return catalog;
}

function sealCatalogV1(catalog: z.infer<typeof CatalogBodyV1Schema>): z.infer<typeof ResumeDataCatalogV1Schema> {
  return ResumeDataCatalogV1Schema.parse({ ...catalog, integrity_digest: canonicalInputDigest(catalog) });
}

function verifyCatalogV2(raw: unknown): z.infer<typeof ResumeDataCatalogV2Schema> {
  const catalog = ResumeDataCatalogV2Schema.parse(raw);
  const { integrity_digest: integrityDigest, ...body } = catalog;
  if (canonicalInputDigest(CatalogBodyV2Schema.parse(body)) !== integrityDigest) {
    throw new ResumeDomainError("validation_failed", "Resume Builder owner-data catalog integrity check failed", 409);
  }
  return catalog;
}

function sealCatalogV2(catalog: z.infer<typeof CatalogBodyV2Schema>): z.infer<typeof ResumeDataCatalogV2Schema> {
  return ResumeDataCatalogV2Schema.parse({ ...catalog, integrity_digest: canonicalInputDigest(catalog) });
}

function verifyCatalogV3(raw: unknown): z.infer<typeof ResumeDataCatalogV3Schema> {
  const catalog = ResumeDataCatalogV3Schema.parse(raw);
  const { integrity_digest: integrityDigest, ...body } = catalog;
  if (canonicalInputDigest(CatalogBodyV3Schema.parse(body)) !== integrityDigest) {
    throw new ResumeDomainError("validation_failed", "Resume Builder owner-data catalog integrity check failed", 409);
  }
  return catalog;
}

function sealCatalogV3(catalog: z.infer<typeof CatalogBodyV3Schema>): z.infer<typeof ResumeDataCatalogV3Schema> {
  return ResumeDataCatalogV3Schema.parse({ ...catalog, integrity_digest: canonicalInputDigest(catalog) });
}

function deterministicOpaqueId(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
}

export class ResumeDataStore {
  private tail = Promise.resolve();
  private readonly catalogPath: string;
  private readonly manifestPath: string;
  private readonly migrationMarkerPath: string;
  private readonly transactionsRoot: string;
  private readonly leasePath: string;

  constructor(
    public readonly memoryRoot: string,
    public readonly namespaceRoot = path.join(memoryRoot, "apps", "resume-builder"),
    private readonly hooks: StoreHooks = {},
    private readonly writeHistory = true,
  ) {
    this.catalogPath = path.join(namespaceRoot, "catalog.json");
    this.manifestPath = path.join(namespaceRoot, "manifest.json");
    this.migrationMarkerPath = path.join(namespaceRoot, "migration-transaction.json");
    this.transactionsRoot = path.join(namespaceRoot, "transactions");
    this.leasePath = path.join(namespaceRoot, ".store.lock");
  }

  async initialize(ownerId: string): Promise<void> {
    try {
      let checkpointMessage: string | null = null;
      await mkdir(path.join(this.namespaceRoot, "records"), { recursive: true });
      await mkdir(path.join(this.namespaceRoot, "recovery"), { recursive: true });
      await mkdir(this.transactionsRoot, { recursive: true });
      await this.serial(() => this.withLease(async (lease) => {
      await this.reconcileMigration();
      let catalog: ResumeDataCatalog;
      try {
        let raw = JSON.parse(await readFile(this.catalogPath, "utf8")) as { data_schema_version?: number };
        if (raw.data_schema_version === 0) {
          await this.migrateLegacy(raw, ownerId);
          raw = JSON.parse(await readFile(this.catalogPath, "utf8")) as { data_schema_version?: number };
          checkpointMessage = "Migrate Resume Builder owner data schema 0 to 1 to 2 to 3 to 4";
        }
        if (raw.data_schema_version === 1) {
          await this.migrateSchemaOneToTwo(raw, ownerId);
          raw = JSON.parse(await readFile(this.catalogPath, "utf8")) as { data_schema_version?: number };
          checkpointMessage ??= "Migrate Resume Builder owner data schema 1 to 2 to 3 to 4";
        }
        if (raw.data_schema_version === 2) {
          await this.migrateSchemaTwoToThree(raw, ownerId);
          raw = JSON.parse(await readFile(this.catalogPath, "utf8")) as { data_schema_version?: number };
          checkpointMessage ??= "Migrate Resume Builder owner data schema 2 to 3 to 4";
        }
        if (raw.data_schema_version === 3) {
          await this.migrateSchemaThreeToFour(raw, ownerId);
          raw = JSON.parse(await readFile(this.catalogPath, "utf8")) as { data_schema_version?: number };
          checkpointMessage ??= "Migrate Resume Builder owner data schema 3 to 4";
        }
        if (raw.data_schema_version === RESUME_DATA_SCHEMA_VERSION) {
          const opened = await this.openOrUpgradeCatalog(raw);
          catalog = opened.catalog;
          checkpointMessage ??= opened.checkpointMessage;
        } else {
          throw new ResumeDomainError("incompatible_schema", "Retained Resume Builder data requires a compatible app version", 409);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          if (error instanceof ResumeDomainError) throw error;
          if (error instanceof z.ZodError || error instanceof SyntaxError) {
            throw new ResumeDomainError("validation_failed", "Resume Builder owner-data catalog is invalid", 409);
          }
          throw error;
        }
        const now = new Date().toISOString();
        catalog = sealCatalog(CatalogBodySchema.parse({
          catalog_version: 1,
          data_schema_version: RESUME_DATA_SCHEMA_VERSION,
          owner_id: ownerId,
          generation: 0,
          created_at: now,
          updated_at: now,
          heads: {},
          revisions: {},
          operations: {},
          extensions: {},
        }));
        await this.writeAtomic(this.catalogPath, catalog);
        await this.writeAtomic(this.manifestPath, STORE_MANIFEST);
        checkpointMessage = "Initialize Resume Builder owner data";
      }
      if (catalog.owner_id !== ownerId) {
        throw new ResumeDomainError("denied", "Retained owner data belongs to a different owner", 403);
      }
      if (await this.reconcileTransactions(catalog)) {
        checkpointMessage ??= "Reconcile committed Resume Builder owner-data operation";
      }
      catalog = await this.readVerifiedCatalog();
      await this.validateReferencedRecords(catalog);
      await this.validateCatalogSemantics(catalog);
      await this.removeOrphanRevisions(catalog);
      await this.assertLeaseOwner(lease);
      }));
      if (checkpointMessage) await this.commitHistory(checkpointMessage);
    } catch (error) {
      throw this.normalizePublicError(error, "Resume Builder owner-data initialization failed");
    }
  }

  async catalog(): Promise<ResumeDataCatalog> {
    try {
      StoreManifestSchema.parse(JSON.parse(await readFile(this.manifestPath, "utf8")));
      const catalog = await this.readVerifiedCatalog();
      await this.validateCatalogSemantics(catalog);
      return catalog;
    } catch (error) {
      if (error instanceof ResumeDomainError) throw error;
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        throw new ResumeDomainError("validation_failed", "Resume Builder owner-data catalog is invalid", 409);
      }
      throw this.normalizePublicError(error, "Resume Builder owner-data catalog could not be read");
    }
  }

  async integrityScan(): Promise<{
    status: "verified";
    generation: number;
    revision_count: number;
    operation_count: number;
    orphan_revision_count: number;
    staged_transaction_count: number;
  }> {
    try {
      const catalog = await this.catalog();
      await this.validateReferencedRecords(catalog);
      const orphanRevisionCount = (await this.listRevisionFiles()).filter((relativePath) =>
        !Object.values(catalog.revisions).some((locator) => locator.relative_path === relativePath)
      ).length;
      const stagedTransactionCount = (await readdir(this.transactionsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).length;
      return {
        status: "verified",
        generation: catalog.generation,
        revision_count: Object.keys(catalog.revisions).length,
        operation_count: Object.keys(catalog.operations).length,
        orphan_revision_count: orphanRevisionCount,
        staged_transaction_count: stagedTransactionCount,
      };
    } catch (error) {
      throw this.normalizePublicError(error, "Resume Builder owner-data integrity scan failed");
    }
  }

  async cleanupTransientState(ownerId: string): Promise<{ transient_items_removed: number }> {
    const before = await readdir(this.transactionsRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    await this.initialize(ownerId);
    const after = await readdir(this.transactionsRoot, { withFileTypes: true });
    let removedStagedCatalogs = 0;
    for (const entry of await readdir(this.namespaceRoot, { withFileTypes: true })) {
      if (entry.isFile() && /^catalog\.[0-9a-f-]{36}\.staged\.json$/.test(entry.name)) {
        await rm(path.join(this.namespaceRoot, entry.name), { force: true });
        removedStagedCatalogs += 1;
      }
    }
    return { transient_items_removed: Math.max(0, before.length - after.length) + removedStagedCatalogs };
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

  async allRevisions(recordScopes: readonly string[] = []): Promise<ResumeDataRecord[]> {
    const catalog = await this.catalog();
    const locators = Object.values(catalog.revisions)
      .filter((locator) => recordScopes.length === 0 || recordScopes.includes(locator.record_id))
      .sort((left, right) => left.revision_id.localeCompare(right.revision_id));
    return Promise.all(locators.map((locator) => this.readRevisionFromCatalog(catalog, locator.revision_id)));
  }

  async operation(
    operationId: string,
    installationId: string,
    access?: {
      ownerId: string;
      actorId: string;
      grantedCapabilities: readonly string[];
      recordScopes: readonly string[];
    },
  ): Promise<{ record: OperationRecord; results: ResumeDataRecord[] }> {
    const catalog = await this.catalog();
    const entry = catalog.operations[operationId];
    const resultsInScope = entry?.result_revision_ids.every((revisionId) => {
      const locator = catalog.revisions[revisionId];
      return locator && (!access || access.recordScopes.length === 0 || access.recordScopes.includes(locator.record_id));
    }) ?? false;
    if (
      !entry ||
      entry.record.installation_id !== installationId ||
      (access && (
        entry.record.owner_id !== access.ownerId ||
        entry.record.actor_id !== access.actorId ||
        !access.grantedCapabilities.includes(entry.record.capability) ||
        !resultsInScope
      ))
    ) {
      throw new ResumeDomainError("not_found_within_scope", "Operation was not found within the granted scope", 404);
    }
    return { record: entry.record, results: await Promise.all(entry.result_revision_ids.map((id) => this.readRevisionFromCatalog(catalog, id))) };
  }

  async commit(records: ResumeDataRecord[], context: MutationContext): Promise<{ operation: OperationRecord; records: ResumeDataRecord[]; reused: boolean }> {
    try {
      let shouldCheckpoint = false;
      const result: { operation: OperationRecord; records: ResumeDataRecord[]; reused: boolean } = await this.serial(() => this.withLease(async (lease) => {
      let catalog = await this.catalog();
      shouldCheckpoint = await this.reconcileTransactions(catalog);
      catalog = await this.catalog();
      const inputDigest = canonicalInputDigest(context.canonicalInput);
      const existing = catalog.operations[context.operationId];
      if (existing) {
        if (
          existing.record.installation_id !== context.installationId ||
          existing.record.owner_id !== context.ownerId ||
          existing.record.actor_id !== context.actorId ||
          existing.record.idempotency_key !== context.idempotencyKey ||
          existing.record.canonical_input_digest !== inputDigest ||
          existing.record.capability !== context.capability
        ) {
          throw new ResumeDomainError("idempotency_conflict", "Operation identity was reused with different canonical input");
        }
        const results = await Promise.all(existing.result_revision_ids.map((id) => this.readRevisionFromCatalog(catalog, id)));
        return { operation: { ...existing.record, commit_outcome: "committed_response_recovered" }, records: results, reused: true };
      }
      this.validateMutation(records, catalog, context);
      if (context.isCancelled?.()) throw new ResumeDomainError("cancelled", "Operation was cancelled before commit");

      const now = new Date().toISOString();
      const locators = records.map((record) => RecordLocatorSchema.parse({
        record_id: record.metadata.record_id,
        revision_id: record.metadata.revision_id,
        revision: record.metadata.revision,
        record_type: record.record_type,
        relative_path: this.recordRelativePath(record),
        content_digest: canonicalInputDigest(record),
      }));
      const resultRef = records[records.length - 1]?.metadata.revision_id ?? null;
      const operation = this.operationRecord(context, inputDigest, now, "committed", "committed", resultRef);
      const heads = { ...catalog.heads };
      const revisions = { ...catalog.revisions };
      for (const locator of locators) {
        heads[locator.record_id] = {
          record_id: locator.record_id,
          revision_id: locator.revision_id,
          revision: locator.revision,
          record_type: locator.record_type,
        };
        revisions[locator.revision_id] = locator;
      }
      const { integrity_digest: _priorIntegrityDigest, ...catalogBody } = catalog;
      const next = sealCatalog(CatalogBodySchema.parse({
        ...catalogBody,
        generation: catalog.generation + 1,
        updated_at: now,
        heads,
        revisions,
        operations: {
          ...catalog.operations,
          [context.operationId]: { record: operation, result_revision_ids: records.map((record) => record.metadata.revision_id) },
        },
      }));

      const transactionId = randomUUID();
      const transactionRoot = path.join(this.transactionsRoot, transactionId);
      const stagedCatalogPath = path.join(transactionRoot, "catalog.json");
      for (const [index, record] of records.entries()) {
        await this.writeAtomic(path.join(transactionRoot, locators[index]!.relative_path), record);
      }
      await this.writeAtomic(stagedCatalogPath, next);
      let transaction = TransactionSchema.parse({
        transaction_version: 1,
        transaction_id: transactionId,
        owner_id: context.ownerId,
        operation_id: context.operationId,
        installation_id: context.installationId,
        canonical_input_digest: inputDigest,
        base_generation: catalog.generation,
        next_generation: next.generation,
        state: "staged",
        record_relative_paths: locators.map((locator) => locator.relative_path),
        staged_catalog_relative_path: path.posix.join("transactions", transactionId, "catalog.json"),
        created_at: now,
        expires_at: new Date(Date.now() + this.leaseTtlMs()).toISOString(),
      });
      await this.writeAtomic(path.join(transactionRoot, "transaction.json"), transaction);
      await this.validateStagedTransaction(transaction, next);
      await this.hooks.afterTransactionStaged?.();
      if (context.isCancelled?.()) {
        await rm(transactionRoot, { recursive: true, force: true });
        throw new ResumeDomainError("cancelled", "Operation was cancelled before commit");
      }

      await this.renewLease(lease);
      for (const locator of locators) {
        await this.hooks.beforeRecordPromote?.();
        await this.promoteImmutable(path.join(transactionRoot, locator.relative_path), path.join(this.namespaceRoot, locator.relative_path), locator.content_digest);
      }
      transaction = TransactionSchema.parse({ ...transaction, state: "promoted" });
      await this.writeAtomic(path.join(transactionRoot, "transaction.json"), transaction);
      await this.hooks.afterRecordsPromoted?.();
      await this.hooks.beforeCatalogCommit?.();
      if (context.isCancelled?.()) {
        await this.removeTransactionArtifacts(transaction, catalog);
        throw new ResumeDomainError("cancelled", "Operation was cancelled before commit");
      }

      await this.validateReferencedRecords(next);
      await this.validateCatalogSemantics(next);
      await this.renewLease(lease);
      await this.assertLeaseOwner(lease);
      await this.writeAtomic(this.catalogPath, next);
      await this.hooks.afterCatalogCommit?.();
      await rm(transactionRoot, { recursive: true, force: true });
      shouldCheckpoint = true;
      return { operation, records, reused: false };
      }));
      if (shouldCheckpoint) await this.commitHistory(`Commit Resume Builder ${context.targetCategory} operation`);
      return result;
    } catch (error) {
      throw this.normalizePublicError(error, "Resume Builder owner-data operation failed");
    }
  }

  private validateMutation(records: ResumeDataRecord[], catalog: ResumeDataCatalog, context: MutationContext): void {
    if (records.length === 0) throw new ResumeDomainError("invalid_input", "A durable mutation requires at least one record", 400);
    if (!OpaqueIdSchema.safeParse(context.operationId).success) throw new ResumeDomainError("invalid_input", "Operation identity is invalid", 400);
    if (context.ownerId !== catalog.owner_id) throw new ResumeDomainError("denied", "Operation authority does not match the retained owner", 403);
    const ids = new Set<string>();
    const revisionIds = new Set<string>();
    for (const candidate of records) {
      const record = ResumeDataRecordSchema.parse(candidate);
      if (
        record.owner_id !== context.ownerId ||
        record.metadata.created_by.owner_id !== context.ownerId ||
        record.metadata.created_by.actor_id !== context.actorId ||
        record.metadata.created_by.installation_id !== context.installationId
      ) {
        throw new ResumeDomainError("denied", "Record attribution does not match capability authority", 403);
      }
      if (ids.has(record.metadata.record_id) || revisionIds.has(record.metadata.revision_id) || catalog.revisions[record.metadata.revision_id]) {
        throw new ResumeDomainError("conflict", "Duplicate record or revision identity");
      }
      ids.add(record.metadata.record_id);
      revisionIds.add(record.metadata.revision_id);
      const current = catalog.heads[record.metadata.record_id];
      if (current) {
        const groupedExpected = context.expectedRevisions?.[record.metadata.record_id];
        const expected = groupedExpected ?? (context.targetId === record.metadata.record_id ? context.expectedRevision : null);
        if (
          expected !== current.revision ||
          record.metadata.revision !== current.revision + 1 ||
          record.metadata.prior_revision_id !== current.revision_id
        ) {
          throw new ResumeDomainError("conflict", "Expected record revision does not match the current revision", 409, { currentRevision: current.revision });
        }
      } else if (record.metadata.revision !== 1 || record.metadata.prior_revision_id !== null) {
        throw new ResumeDomainError("conflict", "New records must begin at revision one");
      }
    }
    if (context.expectedRevisions) {
      const expectedIds = Object.keys(context.expectedRevisions);
      if (
        context.targetId !== null ||
        context.expectedRevision !== null ||
        expectedIds.some((recordId) => !ids.has(recordId) || !Number.isSafeInteger(context.expectedRevisions?.[recordId]) || context.expectedRevisions![recordId]! <= 0)
      ) {
        throw new ResumeDomainError("conflict", "Grouped expected revisions do not match the candidate records");
      }
    } else if (context.targetId) {
      const current = catalog.heads[context.targetId];
      if (!current || context.expectedRevision !== current.revision) {
        throw new ResumeDomainError("conflict", "Expected record revision does not match the current revision", 409, current ? { currentRevision: current.revision } : {});
      }
    } else if (context.expectedRevision !== null) {
      throw new ResumeDomainError("conflict", "Create operations cannot carry an expected revision");
    }
  }

  private operationRecord(
    context: MutationContext,
    inputDigest: `sha256:${string}`,
    now: string,
    status: "committed" | "cancelled_before_commit",
    outcome: "committed" | "not_committed",
    resultRef: string | null,
  ): OperationRecord {
    return OperationRecordSchema.parse({
      operation_schema_version: 1,
      operation_id: context.operationId,
      idempotency_key: context.idempotencyKey,
      canonical_input_digest: inputDigest,
      owner_id: context.ownerId,
      actor_id: context.actorId,
      app_id: "ai.braindrive.resume-builder",
      installation_id: context.installationId,
      capability: context.capability,
      target_category: context.targetCategory,
      target_id: context.targetId,
      expected_revision: context.expectedRevision,
      status,
      commit_outcome: outcome,
      last_cancellable_status: "running",
      started_at: now,
      completed_at: now,
      result_ref: resultRef,
      error_code: null,
    });
  }

  private async readRevisionFromCatalog(catalog: ResumeDataCatalog, revisionId: string): Promise<ResumeDataRecord> {
    const locator = catalog.revisions[revisionId];
    if (!locator) throw new ResumeDomainError("not_found_within_scope", "Record was not found within the granted scope", 404);
    try {
      const record = ResumeDataRecordSchema.parse(JSON.parse(await readFile(path.join(this.namespaceRoot, locator.relative_path), "utf8")));
      if (
        record.metadata.revision_id !== revisionId ||
        record.metadata.record_id !== locator.record_id ||
        record.metadata.revision !== locator.revision ||
        record.record_type !== locator.record_type ||
        canonicalInputDigest(record) !== locator.content_digest
      ) {
        throw new Error("record integrity mismatch");
      }
      return record;
    } catch {
      throw new ResumeDomainError("validation_failed", "A referenced Resume Builder record is corrupt or missing", 409);
    }
  }

  private async validateReferencedRecords(catalog: ResumeDataCatalog): Promise<void> {
    await Promise.all(Object.keys(catalog.revisions).map((revisionId) => this.readRevisionFromCatalog(catalog, revisionId)));
  }

  private async validateCatalogSemantics(catalog: ResumeDataCatalog): Promise<void> {
    for (const [recordId, head] of Object.entries(catalog.heads)) {
      const locator = catalog.revisions[head.revision_id];
      if (
        recordId !== head.record_id ||
        !locator ||
        locator.record_id !== head.record_id ||
        locator.revision !== head.revision ||
        locator.record_type !== head.record_type
      ) {
        throw new ResumeDomainError("validation_failed", "Resume Builder owner-data catalog references are invalid", 409);
      }
    }
    for (const [revisionId, locator] of Object.entries(catalog.revisions)) {
      if (revisionId !== locator.revision_id) {
        throw new ResumeDomainError("validation_failed", "Resume Builder owner-data catalog references are invalid", 409);
      }
    }
    for (const [operationId, entry] of Object.entries(catalog.operations)) {
      if (
        operationId !== entry.record.operation_id ||
        entry.result_revision_ids.some((revisionId) => !catalog.revisions[revisionId]) ||
        (entry.record.result_ref !== null && !entry.result_revision_ids.includes(entry.record.result_ref))
      ) {
        throw new ResumeDomainError("validation_failed", "Resume Builder operation journal references are invalid", 409);
      }
    }
    const records = await Promise.all(Object.keys(catalog.revisions).map((revisionId) => this.readRevisionFromCatalog(catalog, revisionId)));
    validateResumeLineageRecords(records);
  }

  private recordRelativePath(record: ResumeDataRecord): string {
    return path.posix.join("records", record.record_type, record.metadata.record_id, `${record.metadata.revision_id}.json`);
  }

  private async openOrUpgradeCatalog(raw: unknown): Promise<{ catalog: ResumeDataCatalog; checkpointMessage: string | null }> {
    try {
      StoreManifestSchema.parse(JSON.parse(await readFile(this.manifestPath, "utf8")));
      return { catalog: verifyCatalog(raw), checkpointMessage: null };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (ResumeDataCatalogSchema.safeParse(raw).success) {
        const sealed = verifyCatalog(raw);
        await this.writeAtomic(this.manifestPath, STORE_MANIFEST);
        return { catalog: sealed, checkpointMessage: "Complete Resume Builder owner-data manifest initialization" };
      }
      const unsealed = UnsealedCatalogSchema.parse(raw);
      const revisions: ResumeDataCatalog["revisions"] = {};
      for (const [revisionId, locator] of Object.entries(unsealed.revisions)) {
        const record = ResumeDataRecordSchema.parse(JSON.parse(await readFile(path.join(this.namespaceRoot, locator.relative_path), "utf8")));
        if (record.metadata.revision_id !== revisionId || record.metadata.record_id !== locator.record_id) {
          throw new ResumeDomainError("validation_failed", "A referenced Resume Builder record is corrupt or missing", 409);
        }
        revisions[revisionId] = RecordLocatorSchema.parse({ ...locator, content_digest: canonicalInputDigest(record) });
      }
      const upgraded = sealCatalog(CatalogBodySchema.parse({ ...unsealed, revisions }));
      await this.validateCatalogSemantics(upgraded);
      await this.writeAtomic(this.catalogPath, upgraded);
      await this.writeAtomic(this.manifestPath, STORE_MANIFEST);
      return { catalog: upgraded, checkpointMessage: "Add Resume Builder owner-data integrity metadata" };
    }
  }

  private async readVerifiedCatalog(): Promise<ResumeDataCatalog> {
    return verifyCatalog(JSON.parse(await readFile(this.catalogPath, "utf8")));
  }

  private async validateStagedTransaction(transaction: Transaction, catalog: ResumeDataCatalog): Promise<void> {
    if (catalog.generation !== transaction.next_generation || catalog.owner_id !== transaction.owner_id) {
      throw new ResumeDomainError("recoverable_internal_failure", "Resume Builder staged transaction metadata is inconsistent", 500);
    }
    for (const relativePath of transaction.record_relative_paths) {
      const locator = Object.values(catalog.revisions).find((candidate) => candidate.relative_path === relativePath);
      if (!locator) throw new ResumeDomainError("recoverable_internal_failure", "Resume Builder staged transaction is incomplete", 500);
      const record = ResumeDataRecordSchema.parse(JSON.parse(await readFile(path.join(this.namespaceRoot, "transactions", transaction.transaction_id, relativePath), "utf8")));
      if (canonicalInputDigest(record) !== locator.content_digest) {
        throw new ResumeDomainError("validation_failed", "Resume Builder staged revision integrity check failed", 409);
      }
    }
  }

  private async promoteImmutable(source: string, target: string, expectedDigest: string): Promise<void> {
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await copyFile(source, target, constants.COPYFILE_EXCL);
      const handle = await open(target, "r+");
      try { await handle.sync(); } finally { await handle.close(); }
      await syncDirectoryEntry(path.dirname(target));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const existing = ResumeDataRecordSchema.parse(JSON.parse(await readFile(target, "utf8")));
        if (canonicalInputDigest(existing) === expectedDigest) return;
      } catch {
        // The typed conflict below is intentionally content-free.
      }
      throw new ResumeDomainError("validation_failed", "An immutable Resume Builder revision identity already exists with different content", 409);
    }
  }

  private async reconcileTransactions(catalog: ResumeDataCatalog): Promise<boolean> {
    const entries = await readdir(this.transactionsRoot, { withFileTypes: true });
    let committedRecovery = false;
    for (const entry of entries) {
      if (!entry.isDirectory() || !OpaqueIdSchema.safeParse(entry.name).success) {
        await rm(path.join(this.transactionsRoot, entry.name), { recursive: true, force: true });
        continue;
      }
      const transactionRoot = path.join(this.transactionsRoot, entry.name);
      try {
        const transaction = TransactionSchema.parse(JSON.parse(await readFile(path.join(transactionRoot, "transaction.json"), "utf8")));
        const committed = catalog.operations[transaction.operation_id];
        if (
          committed &&
          committed.record.installation_id === transaction.installation_id &&
          committed.record.canonical_input_digest === transaction.canonical_input_digest &&
          catalog.generation >= transaction.next_generation
        ) {
          committedRecovery = true;
          await rm(transactionRoot, { recursive: true, force: true });
          continue;
        }
        await this.removeTransactionArtifacts(transaction, catalog);
      } catch {
        await rm(transactionRoot, { recursive: true, force: true });
      }
    }
    await this.removeOrphanRevisions(catalog);
    return committedRecovery;
  }

  private async removeTransactionArtifacts(transaction: Transaction, catalog: ResumeDataCatalog): Promise<void> {
    const activePaths = new Set(Object.values(catalog.revisions).map((locator) => locator.relative_path));
    for (const relativePath of transaction.record_relative_paths) {
      if (!activePaths.has(relativePath)) await rm(path.join(this.namespaceRoot, relativePath), { force: true });
    }
    await rm(path.join(this.transactionsRoot, transaction.transaction_id), { recursive: true, force: true });
  }

  private async listRevisionFiles(): Promise<string[]> {
    const recordsRoot = path.join(this.namespaceRoot, "records");
    const results: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && entry.name.endsWith(".json")) results.push(path.relative(this.namespaceRoot, absolute).split(path.sep).join("/"));
      }
    };
    await visit(recordsRoot);
    return results;
  }

  private async removeOrphanRevisions(catalog: ResumeDataCatalog): Promise<void> {
    const activePaths = new Set(Object.values(catalog.revisions).map((locator) => locator.relative_path));
    for (const relativePath of await this.listRevisionFiles()) {
      if (!activePaths.has(relativePath)) await rm(path.join(this.namespaceRoot, relativePath), { force: true });
    }
  }

  private async migrateLegacy(raw: unknown, ownerId: string): Promise<void> {
    let legacy = LegacyCatalogSchema.parse(raw);
    if (legacy.owner_id !== ownerId) throw new ResumeDomainError("denied", "Retained owner data belongs to a different owner", 403);
    const snapshotId = randomUUID();
    const snapshotPath = path.join(this.namespaceRoot, "recovery", `${snapshotId}.catalog-v0.json`);
    const stagedPath = path.join(this.namespaceRoot, `catalog.${snapshotId}.staged.json`);
    await this.copyAtomic(this.catalogPath, snapshotPath);
    const now = new Date().toISOString();
    const heads: ResumeDataCatalog["heads"] = {};
    const revisions: ResumeDataCatalog["revisions"] = {};
    try {
      await this.migrationFault("after_snapshot");
      legacy = LegacyCatalogSchema.parse(this.hooks.migrationTransform?.(legacy) ?? legacy);
      for (const record of legacy.records) {
        const relativePath = this.recordRelativePath(record);
        await this.writeAtomic(path.join(this.namespaceRoot, relativePath), record);
        const locator = RecordLocatorSchema.parse({
          record_id: record.metadata.record_id,
          revision_id: record.metadata.revision_id,
          revision: record.metadata.revision,
          record_type: record.record_type,
          relative_path: relativePath,
          content_digest: canonicalInputDigest(record),
        });
        revisions[locator.revision_id] = locator;
        const current = heads[locator.record_id];
        if (!current || current.revision < locator.revision) {
          heads[locator.record_id] = {
            record_id: locator.record_id,
            revision_id: locator.revision_id,
            revision: locator.revision,
            record_type: locator.record_type,
          };
        }
      }
      await this.migrationFault("after_records");
      const migrationId = randomUUID();
      const migrationRevisionId = randomUUID();
      const stagedBase = {
        catalog_version: 1,
        data_schema_version: 1,
        owner_id: ownerId,
        generation: 1,
        created_at: now,
        updated_at: now,
        heads,
        revisions,
        operations: {},
        extensions: legacy.extensions,
      } as const;
      const sourceCatalogDigest = canonicalInputDigest(raw);
      const resultCatalogDigest = canonicalInputDigest(stagedBase);
      const migrationProvenance = MigrationProvenanceSchema.parse({
        provenance_version: 1,
        migration_id: migrationId,
        transformer_id: "resume-data.schema-0-to-1",
        transformer_version: "1",
        transformer_digest: canonicalInputDigest({ transformer_id: "resume-data.schema-0-to-1", transformer_version: "1", steps: ["catalog-v0-to-v1", "validate-record-graph", "seal-catalog"] }),
        from_schema_version: 0,
        to_schema_version: 1,
        source_catalog_digest: sourceCatalogDigest,
        result_catalog_digest: resultCatalogDigest,
        recovery_snapshot_id: snapshotId,
        method: "deterministic_no_ai",
        validated_at: now,
      });
      const migration = MigrationRecordSchema.parse({
        schema_version: 1,
        record_type: "migration",
        metadata: {
          record_id: migrationId,
          revision_id: migrationRevisionId,
          revision: 1,
          created_at: now,
          created_by: {
            owner_id: ownerId,
            actor_id: ownerId,
            app_id: "ai.braindrive.resume-builder",
            publisher_id: "ai.braindrive",
            package_digest: `sha256:${"0".repeat(64)}`,
            installation_id: "00000000-0000-4000-8000-000000000000",
          },
          prior_revision_id: null,
          extensions: {},
        },
        owner_id: ownerId,
        updated_at: now,
        lifecycle_state: "active",
        sensitivity: "standard",
        retention_class: "rollback_recovery_window",
        extensions: { migration_provenance: migrationProvenance },
        migration_id: migrationId,
        from_schema_version: 0,
        to_schema_version: 1,
        status: "committed",
        source_catalog_digest: sourceCatalogDigest,
        result_catalog_digest: resultCatalogDigest,
        recovery_snapshot_id: snapshotId,
        started_at: now,
        completed_at: now,
      });
      const migrationRelativePath = this.recordRelativePath(migration);
      await this.writeAtomic(path.join(this.namespaceRoot, migrationRelativePath), migration);
      const migrationLocator = RecordLocatorSchema.parse({
        record_id: migrationId,
        revision_id: migrationRevisionId,
        revision: 1,
        record_type: "migration",
        relative_path: migrationRelativePath,
        content_digest: canonicalInputDigest(migration),
      });
      heads[migrationId] = { record_id: migrationId, revision_id: migrationRevisionId, revision: 1, record_type: "migration" };
      revisions[migrationRevisionId] = migrationLocator;
      const staged = sealCatalogV1(CatalogBodyV1Schema.parse({
        catalog_version: 1,
        data_schema_version: 1,
        owner_id: ownerId,
        generation: 1,
        created_at: now,
        updated_at: now,
        heads,
        revisions,
        operations: {},
        extensions: legacy.extensions,
      }));
      await this.writeAtomic(stagedPath, staged);
      await this.migrationFault("after_staged_catalog");
      await this.writeAtomic(this.migrationMarkerPath, {
        marker_version: 1,
        from_schema_version: 0,
        to_schema_version: 1,
        snapshot_path: path.relative(this.namespaceRoot, snapshotPath),
        staged_path: path.relative(this.namespaceRoot, stagedPath),
      });
      await this.migrationFault("after_marker");
      await rename(stagedPath, this.catalogPath);
      await this.writeAtomic(this.manifestPath, { ...STORE_MANIFEST, data_schema_version: 1 });
      await this.migrationFault("after_catalog_switch");
      await rm(this.migrationMarkerPath, { force: true });
    } catch (error) {
      await this.copyAtomic(snapshotPath, this.catalogPath);
      await rm(this.manifestPath, { force: true });
      await rm(this.migrationMarkerPath, { force: true });
      await rm(stagedPath, { force: true });
      throw new ResumeDomainError("recoverable_internal_failure", `Resume Builder data migration rolled back: ${error instanceof Error ? error.name : "failure"}`, 500);
    }
  }

  private async migrateSchemaOneToTwo(raw: unknown, ownerId: string): Promise<void> {
    const source = verifyCatalogV1(raw);
    if (source.owner_id !== ownerId) throw new ResumeDomainError("denied", "Retained owner data belongs to a different owner", 403);
    await this.validateReferencedRecords(source as unknown as ResumeDataCatalog);
    const snapshotId = randomUUID();
    const snapshotPath = path.join(this.namespaceRoot, "recovery", `${snapshotId}.catalog-v1.json`);
    const stagedPath = path.join(this.namespaceRoot, `catalog.${snapshotId}.staged.json`);
    await this.copyAtomic(this.catalogPath, snapshotPath);
    const now = new Date().toISOString();
    try {
      await this.migrationFault("after_snapshot");
      const migrationId = randomUUID();
      const migrationRevisionId = randomUUID();
      const sourceCatalogDigest = canonicalInputDigest(source);
      const transformedBase = CatalogBodyV2Schema.parse({
        catalog_version: 1,
        data_schema_version: 2,
        owner_id: ownerId,
        generation: source.generation + 1,
        created_at: source.created_at,
        updated_at: now,
        heads: source.heads,
        revisions: source.revisions,
        operations: source.operations,
        extensions: source.extensions,
      });
      const resultCatalogDigest = canonicalInputDigest(transformedBase);
      const migrationProvenance = MigrationProvenanceSchema.parse({
        provenance_version: 1,
        migration_id: migrationId,
        transformer_id: "resume-data.schema-1-to-2",
        transformer_version: "1",
        transformer_digest: canonicalInputDigest({
          transformer_id: "resume-data.schema-1-to-2",
          transformer_version: "1",
          steps: ["retain-schema-1-record-bytes", "add-schema-2-contract-head", "validate-record-graph", "seal-catalog"],
        }),
        from_schema_version: 1,
        to_schema_version: 2,
        source_catalog_digest: sourceCatalogDigest,
        result_catalog_digest: resultCatalogDigest,
        recovery_snapshot_id: snapshotId,
        method: "deterministic_no_ai",
        validated_at: now,
      });
      const migration = MigrationRecordSchema.parse({
        schema_version: 2,
        record_type: "migration",
        metadata: {
          record_id: migrationId,
          revision_id: migrationRevisionId,
          revision: 1,
          created_at: now,
          created_by: {
            owner_id: ownerId,
            actor_id: ownerId,
            app_id: "ai.braindrive.resume-builder",
            publisher_id: "ai.braindrive",
            package_digest: `sha256:${"0".repeat(64)}`,
            installation_id: "00000000-0000-4000-8000-000000000000",
          },
          prior_revision_id: null,
          extensions: {},
        },
        owner_id: ownerId,
        updated_at: now,
        lifecycle_state: "active",
        sensitivity: "standard",
        retention_class: "rollback_recovery_window",
        extensions: { migration_provenance: migrationProvenance },
        migration_id: migrationId,
        from_schema_version: 1,
        to_schema_version: 2,
        status: "committed",
        source_catalog_digest: sourceCatalogDigest,
        result_catalog_digest: resultCatalogDigest,
        recovery_snapshot_id: snapshotId,
        started_at: now,
        completed_at: now,
      });
      const migrationRelativePath = this.recordRelativePath(migration);
      await this.writeAtomic(path.join(this.namespaceRoot, migrationRelativePath), migration);
      await this.migrationFault("after_records");
      const heads = { ...source.heads, [migrationId]: { record_id: migrationId, revision_id: migrationRevisionId, revision: 1, record_type: "migration" } };
      const revisions = { ...source.revisions, [migrationRevisionId]: RecordLocatorSchema.parse({
        record_id: migrationId,
        revision_id: migrationRevisionId,
        revision: 1,
        record_type: "migration",
        relative_path: migrationRelativePath,
        content_digest: canonicalInputDigest(migration),
      }) };
      const staged = sealCatalogV2(CatalogBodyV2Schema.parse({
        catalog_version: 1,
        data_schema_version: 2,
        owner_id: ownerId,
        generation: source.generation + 1,
        created_at: source.created_at,
        updated_at: now,
        heads,
        revisions,
        operations: source.operations,
        extensions: source.extensions,
      }));
      await this.writeAtomic(stagedPath, staged);
      await this.migrationFault("after_staged_catalog");
      await this.writeAtomic(this.migrationMarkerPath, {
        marker_version: 1,
        from_schema_version: 1,
        to_schema_version: 2,
        snapshot_path: path.relative(this.namespaceRoot, snapshotPath),
        staged_path: path.relative(this.namespaceRoot, stagedPath),
      });
      await this.migrationFault("after_marker");
      await rename(stagedPath, this.catalogPath);
      await this.writeAtomic(this.manifestPath, { ...STORE_MANIFEST, data_schema_version: 2 });
      await this.migrationFault("after_catalog_switch");
      await rm(this.migrationMarkerPath, { force: true });
    } catch (error) {
      await this.copyAtomic(snapshotPath, this.catalogPath);
      await rm(this.manifestPath, { force: true });
      await rm(this.migrationMarkerPath, { force: true });
      await rm(stagedPath, { force: true });
      throw new ResumeDomainError("recoverable_internal_failure", `Resume Builder data migration rolled back: ${error instanceof Error ? error.name : "failure"}`, 500);
    }
  }

  private async migrateSchemaTwoToThree(raw: unknown, ownerId: string): Promise<void> {
    const source = verifyCatalogV2(raw);
    if (source.owner_id !== ownerId) throw new ResumeDomainError("denied", "Retained owner data belongs to a different owner", 403);
    await this.validateReferencedRecords(source as unknown as ResumeDataCatalog);
    const snapshotId = randomUUID();
    const snapshotPath = path.join(this.namespaceRoot, "recovery", `${snapshotId}.catalog-v2.json`);
    const stagedPath = path.join(this.namespaceRoot, `catalog.${snapshotId}.staged.json`);
    await this.copyAtomic(this.catalogPath, snapshotPath);
    const now = new Date().toISOString();
    try {
      await this.migrationFault("after_snapshot");
      const sourceRecords = new Map<string, ResumeDataRecord>();
      for (const [revisionId, locator] of Object.entries(source.revisions)) {
        const record = ResumeDataRecordSchema.parse(JSON.parse(await readFile(path.join(this.namespaceRoot, locator.relative_path), "utf8")));
        if (record.metadata.revision_id !== revisionId || canonicalInputDigest(record) !== locator.content_digest) {
          throw new ResumeDomainError("validation_failed", "Resume Builder migration source revision integrity failed", 409);
        }
        sourceRecords.set(revisionId, record);
      }

      const activeJobs = Object.values(source.heads)
        .map((head) => sourceRecords.get(head.revision_id))
        .filter((record): record is Extract<ResumeDataRecord, { record_type: "career_fact" }> =>
          record?.record_type === "career_fact" && record.fact_kind === "employment" && record.state === "confirmed" && record.lifecycle_state === "active"
        )
        .sort((left, right) => left.metadata.revision_id.localeCompare(right.metadata.revision_id));
      const newestEvidence = new Map<string, Extract<ResumeDataRecord, { record_type: "career_fact" }>>();
      for (const record of sourceRecords.values()) {
        if (record.record_type !== "career_fact" || record.schema_version !== 2 || record.fact_kind !== "job_evidence" || record.state !== "confirmed") continue;
        const evidence = JobEvidenceValueSchema.parse(JSON.parse(record.value));
        if (evidence.association !== "job" || evidence.job_fact_revision_id === null || evidence.dimension === "identity") continue;
        const key = `${evidence.job_fact_revision_id}:${evidence.dimension}`;
        const prior = newestEvidence.get(key);
        if (!prior || record.updated_at > prior.updated_at || (record.updated_at === prior.updated_at && record.metadata.revision_id > prior.metadata.revision_id)) newestEvidence.set(key, record);
      }

      const heads: ResumeDataCatalog["heads"] = { ...source.heads };
      const revisions: ResumeDataCatalog["revisions"] = { ...source.revisions };
      const dimensions = ["responsibilities", "tools", "accomplishments", "outcomes", "scope", "progression"] as const;
      for (const job of activeJobs) {
        const dispositionEntries = dimensions.map((dimension) => {
          const record = newestEvidence.get(`${job.metadata.revision_id}:${dimension}`);
          if (!record) return [dimension, { state: "unanswered", evidence_revision_ids: [], recorded_at: null }] as const;
          const evidence = JobEvidenceValueSchema.parse(JSON.parse(record.value));
          const state = evidence.outcome === "complete_for_now" ? "deferred" : evidence.outcome;
          return [dimension, {
            state,
            evidence_revision_ids: evidence.outcome === "answered" ? [record.metadata.revision_id] : [],
            recorded_at: record.updated_at,
          }] as const;
        });
        const coverageDimensions = Object.fromEntries(dispositionEntries);
        const migratedIds = dispositionEntries
          .map(([dimension]) => newestEvidence.get(`${job.metadata.revision_id}:${dimension}`)?.metadata.revision_id)
          .filter((revisionId): revisionId is string => revisionId !== undefined);
        const recordId = deterministicOpaqueId(`resume-builder:schema-3:coverage:${ownerId}:${job.metadata.record_id}`);
        const revisionId = deterministicOpaqueId(`resume-builder:schema-3:coverage-revision:${canonicalInputDigest(source)}:${job.metadata.revision_id}`);
        const coverageBody = {
          coverage_version: 1 as const,
          job_fact_revision_id: job.metadata.revision_id,
          dimensions: coverageDimensions,
          opportunities: [],
          migrated_legacy_evidence_revision_ids: migratedIds,
        };
        const coverage = JobEvidenceCoverageRecordSchema.parse({
          schema_version: 3,
          record_type: "job_evidence_coverage",
          metadata: {
            record_id: recordId, revision_id: revisionId, revision: 1, created_at: source.updated_at,
            created_by: {
              owner_id: ownerId, actor_id: ownerId, app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive",
              package_digest: `sha256:${"0".repeat(64)}`, installation_id: "00000000-0000-4000-8000-000000000000",
            },
            prior_revision_id: null, extensions: {},
          },
          owner_id: ownerId, updated_at: source.updated_at, lifecycle_state: "active", sensitivity: job.sensitivity,
          retention_class: "durable_owner_data", extensions: {}, ...coverageBody,
          coverage_digest: canonicalInputDigest(coverageBody),
        });
        const relativePath = this.recordRelativePath(coverage);
        await this.writeAtomic(path.join(this.namespaceRoot, relativePath), coverage);
        heads[recordId] = { record_id: recordId, revision_id: revisionId, revision: 1, record_type: "job_evidence_coverage" };
        revisions[revisionId] = RecordLocatorSchema.parse({
          record_id: recordId, revision_id: revisionId, revision: 1, record_type: "job_evidence_coverage",
          relative_path: relativePath, content_digest: canonicalInputDigest(coverage),
        });
      }

      const migrationId = randomUUID();
      const migrationRevisionId = randomUUID();
      const sourceCatalogDigest = canonicalInputDigest(source);
      const transformedBase = CatalogBodyV3Schema.parse({
        catalog_version: 1, data_schema_version: 3, owner_id: ownerId, generation: source.generation + 1,
        created_at: source.created_at, updated_at: now, heads, revisions, operations: source.operations, extensions: source.extensions,
      });
      const resultCatalogDigest = canonicalInputDigest(transformedBase);
      const migrationProvenance = MigrationProvenanceSchema.parse({
        provenance_version: 1, migration_id: migrationId, transformer_id: "resume-data.schema-2-to-3", transformer_version: "1",
        transformer_digest: canonicalInputDigest({ transformer_id: "resume-data.schema-2-to-3", transformer_version: "1", steps: ["retain-schema-2-record-bytes", "project-job-evidence-coverage", "exclude-non-fact-snapshot-support", "validate-record-graph", "seal-catalog"] }),
        from_schema_version: 2, to_schema_version: 3, source_catalog_digest: sourceCatalogDigest,
        result_catalog_digest: resultCatalogDigest, recovery_snapshot_id: snapshotId, method: "deterministic_no_ai", validated_at: now,
      });
      const migration = MigrationRecordSchema.parse({
        schema_version: 3, record_type: "migration",
        metadata: {
          record_id: migrationId, revision_id: migrationRevisionId, revision: 1, created_at: now,
          created_by: { owner_id: ownerId, actor_id: ownerId, app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive", package_digest: `sha256:${"0".repeat(64)}`, installation_id: "00000000-0000-4000-8000-000000000000" },
          prior_revision_id: null, extensions: {},
        },
        owner_id: ownerId, updated_at: now, lifecycle_state: "active", sensitivity: "standard", retention_class: "rollback_recovery_window",
        extensions: { migration_provenance: migrationProvenance }, migration_id: migrationId, from_schema_version: 2, to_schema_version: 3,
        status: "committed", source_catalog_digest: sourceCatalogDigest, result_catalog_digest: resultCatalogDigest,
        recovery_snapshot_id: snapshotId, started_at: now, completed_at: now,
      });
      const migrationRelativePath = this.recordRelativePath(migration);
      await this.writeAtomic(path.join(this.namespaceRoot, migrationRelativePath), migration);
      heads[migrationId] = { record_id: migrationId, revision_id: migrationRevisionId, revision: 1, record_type: "migration" };
      revisions[migrationRevisionId] = RecordLocatorSchema.parse({
        record_id: migrationId, revision_id: migrationRevisionId, revision: 1, record_type: "migration",
        relative_path: migrationRelativePath, content_digest: canonicalInputDigest(migration),
      });
      await this.migrationFault("after_records");
      const staged = sealCatalogV3(CatalogBodyV3Schema.parse({ ...transformedBase, heads, revisions }));
      await this.writeAtomic(stagedPath, staged);
      await this.migrationFault("after_staged_catalog");
      await this.writeAtomic(this.migrationMarkerPath, {
        marker_version: 1, from_schema_version: 2, to_schema_version: 3,
        snapshot_path: path.relative(this.namespaceRoot, snapshotPath), staged_path: path.relative(this.namespaceRoot, stagedPath),
      });
      await this.migrationFault("after_marker");
      await rename(stagedPath, this.catalogPath);
      await this.writeAtomic(this.manifestPath, { ...STORE_MANIFEST, data_schema_version: 3 });
      await this.migrationFault("after_catalog_switch");
      await rm(this.migrationMarkerPath, { force: true });
    } catch (error) {
      await this.copyAtomic(snapshotPath, this.catalogPath);
      await rm(this.manifestPath, { force: true });
      await rm(this.migrationMarkerPath, { force: true });
      await rm(stagedPath, { force: true });
      throw new ResumeDomainError("recoverable_internal_failure", `Resume Builder data migration rolled back: ${error instanceof Error ? error.name : "failure"}`, 500);
    }
  }

  private async migrateSchemaThreeToFour(raw: unknown, ownerId: string): Promise<void> {
    const source = verifyCatalogV3(raw);
    if (source.owner_id !== ownerId) throw new ResumeDomainError("denied", "Retained owner data belongs to a different owner", 403);
    await this.validateReferencedRecords(source as unknown as ResumeDataCatalog);
    const sourceCatalogDigest = canonicalInputDigest(source);
    const snapshotId = deterministicOpaqueId(`resume-builder:schema-4:snapshot:${sourceCatalogDigest}`);
    const snapshotPath = path.join(this.namespaceRoot, "recovery", `${snapshotId}.catalog-v3.json`);
    const stagedPath = path.join(this.namespaceRoot, `catalog.${snapshotId}.staged.json`);
    await this.copyAtomic(this.catalogPath, snapshotPath);
    const now = source.updated_at;
    try {
      await this.migrationFault("after_snapshot");
      const migrationId = deterministicOpaqueId(`resume-builder:schema-4:migration:${sourceCatalogDigest}`);
      const migrationRevisionId = deterministicOpaqueId(`resume-builder:schema-4:migration-revision:${sourceCatalogDigest}`);
      const transformedBase = CatalogBodySchema.parse({
        catalog_version: 1,
        data_schema_version: RESUME_DATA_SCHEMA_VERSION,
        owner_id: ownerId,
        generation: source.generation + 1,
        created_at: source.created_at,
        updated_at: now,
        heads: source.heads,
        revisions: source.revisions,
        operations: source.operations,
        extensions: source.extensions,
      });
      const resultCatalogDigest = canonicalInputDigest(transformedBase);
      const migrationProvenance = MigrationProvenanceSchema.parse({
        provenance_version: 1,
        migration_id: migrationId,
        transformer_id: "resume-data.schema-3-to-4",
        transformer_version: "1",
        transformer_digest: canonicalInputDigest({
          transformer_id: "resume-data.schema-3-to-4",
          transformer_version: "1",
          steps: ["retain-schema-3-record-bytes", "retain-catalog-extensions", "advance-catalog-contract-version", "validate-record-graph", "seal-catalog"],
        }),
        from_schema_version: 3,
        to_schema_version: 4,
        source_catalog_digest: sourceCatalogDigest,
        result_catalog_digest: resultCatalogDigest,
        recovery_snapshot_id: snapshotId,
        method: "deterministic_no_ai",
        validated_at: now,
      });
      const migration = MigrationRecordSchema.parse({
        schema_version: 4,
        record_type: "migration",
        metadata: {
          record_id: migrationId,
          revision_id: migrationRevisionId,
          revision: 1,
          created_at: now,
          created_by: {
            owner_id: ownerId,
            actor_id: ownerId,
            app_id: "ai.braindrive.resume-builder",
            publisher_id: "ai.braindrive",
            package_digest: `sha256:${"0".repeat(64)}`,
            installation_id: "00000000-0000-4000-8000-000000000000",
          },
          prior_revision_id: null,
          extensions: {},
        },
        owner_id: ownerId,
        updated_at: now,
        lifecycle_state: "active",
        sensitivity: "standard",
        retention_class: "rollback_recovery_window",
        extensions: { migration_provenance: migrationProvenance },
        migration_id: migrationId,
        from_schema_version: 3,
        to_schema_version: 4,
        status: "committed",
        source_catalog_digest: sourceCatalogDigest,
        result_catalog_digest: resultCatalogDigest,
        recovery_snapshot_id: snapshotId,
        started_at: now,
        completed_at: now,
      });
      const migrationRelativePath = this.recordRelativePath(migration);
      await this.writeAtomic(path.join(this.namespaceRoot, migrationRelativePath), migration);
      await this.migrationFault("after_records");
      const heads = {
        ...source.heads,
        [migrationId]: { record_id: migrationId, revision_id: migrationRevisionId, revision: 1, record_type: "migration" },
      };
      const revisions = {
        ...source.revisions,
        [migrationRevisionId]: RecordLocatorSchema.parse({
          record_id: migrationId,
          revision_id: migrationRevisionId,
          revision: 1,
          record_type: "migration",
          relative_path: migrationRelativePath,
          content_digest: canonicalInputDigest(migration),
        }),
      };
      const staged = sealCatalog(CatalogBodySchema.parse({ ...transformedBase, heads, revisions }));
      await this.writeAtomic(stagedPath, staged);
      await this.migrationFault("after_staged_catalog");
      await this.writeAtomic(this.migrationMarkerPath, {
        marker_version: 1,
        from_schema_version: 3,
        to_schema_version: 4,
        snapshot_path: path.relative(this.namespaceRoot, snapshotPath),
        staged_path: path.relative(this.namespaceRoot, stagedPath),
      });
      await this.migrationFault("after_marker");
      await rename(stagedPath, this.catalogPath);
      await this.writeAtomic(this.manifestPath, STORE_MANIFEST);
      await this.migrationFault("after_catalog_switch");
      await rm(this.migrationMarkerPath, { force: true });
    } catch (error) {
      await this.copyAtomic(snapshotPath, this.catalogPath);
      await rm(this.manifestPath, { force: true });
      await rm(this.migrationMarkerPath, { force: true });
      await rm(stagedPath, { force: true });
      throw new ResumeDomainError("recoverable_internal_failure", `Resume Builder data migration rolled back: ${error instanceof Error ? error.name : "failure"}`, 500);
    }
  }

  private async reconcileMigration(): Promise<void> {
    try {
      const marker = MigrationMarkerSchema.parse(JSON.parse(await readFile(this.migrationMarkerPath, "utf8")));
      const stagedPath = path.join(this.namespaceRoot, marker.staged_path);
      try {
        const stagedRaw = JSON.parse(await readFile(stagedPath, "utf8"));
        const toSchemaVersion = "to_schema_version" in marker
          ? marker.to_schema_version
          : z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(RESUME_DATA_SCHEMA_VERSION)]).parse((stagedRaw as { data_schema_version?: unknown }).data_schema_version);
        const staged = toSchemaVersion === 1
          ? verifyCatalogV1(stagedRaw)
          : toSchemaVersion === 2
            ? verifyCatalogV2(stagedRaw)
            : toSchemaVersion === 3
              ? verifyCatalogV3(stagedRaw)
              : verifyCatalog(stagedRaw);
        await this.validateReferencedRecords(staged as unknown as ResumeDataCatalog);
        await rename(stagedPath, this.catalogPath);
        await this.writeAtomic(this.manifestPath, { ...STORE_MANIFEST, data_schema_version: toSchemaVersion });
      } catch {
        await this.copyAtomic(path.join(this.namespaceRoot, marker.snapshot_path), this.catalogPath);
        await rm(this.manifestPath, { force: true });
      }
      await rm(this.migrationMarkerPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new ResumeDomainError("recoverable_internal_failure", "Resume Builder migration recovery metadata is invalid", 500);
      }
    }
  }

  private leaseTtlMs(): number {
    return Math.max(1_000, this.hooks.leaseTtlMs ?? 120_000);
  }

  private async migrationFault(point: MigrationFaultPoint): Promise<void> {
    if (this.hooks.migrationFaultPoint === point) {
      throw new Error(`Injected migration fault: ${point}`);
    }
  }

  private async withLease<T>(action: (lease: Lease) => Promise<T>): Promise<T> {
    const lease = await this.acquireLease();
    try { return await action(lease); }
    finally { await this.releaseLease(lease); }
  }

  private async acquireLease(): Promise<Lease> {
    const waitMs = Math.max(0, this.hooks.leaseWaitMs ?? 10_000);
    const retryMs = Math.max(1, this.hooks.leaseRetryMs ?? 25);
    const deadline = Date.now() + waitMs;
    while (true) {
      const now = Date.now();
      const lease = LeaseSchema.parse({
        lease_version: 2,
        lease_id: randomUUID(),
        owner_pid: process.pid,
        owner_instance_id: PROCESS_INSTANCE_ID,
        owner_process_start_ticks: await this.processStartTicks(process.pid),
        acquired_at: new Date(now).toISOString(),
        expires_at: new Date(now + this.leaseTtlMs()).toISOString(),
      });
      let handle: Awaited<ReturnType<typeof open>> | null = null;
      try {
        handle = await open(this.leasePath, "wx", 0o600);
        await handle.writeFile(`${canonicalJson(lease)}\n`, "utf8");
        await handle.sync();
        await handle.close();
        handle = null;
        await syncDirectoryEntry(this.namespaceRoot);
        return lease;
      } catch (error) {
        await handle?.close();
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const current = LeaseSchema.parse(JSON.parse(await readFile(this.leasePath, "utf8")));
          if (Date.parse(current.expires_at) <= Date.now() || !await this.isLeaseOwnerAlive(current)) {
            const stalePath = path.join(this.namespaceRoot, `.store.lock.stale.${randomUUID()}`);
            try {
              await rename(this.leasePath, stalePath);
              await rm(stalePath, { force: true });
              continue;
            } catch (staleError) {
              if ((staleError as NodeJS.ErrnoException).code !== "ENOENT") throw staleError;
            }
          }
        } catch (leaseError) {
          if ((leaseError as NodeJS.ErrnoException).code === "ENOENT") continue;
        }
        if (Date.now() >= deadline) {
          throw new ResumeDomainError("recoverable_internal_failure", "Resume Builder owner-data store is busy", 503);
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(retryMs, Math.max(1, deadline - Date.now()))));
      }
    }
  }

  private async renewLease(lease: Lease): Promise<void> {
    await this.assertLeaseOwner(lease);
    const renewed = LeaseSchema.parse({ ...lease, expires_at: new Date(Date.now() + this.leaseTtlMs()).toISOString() });
    const handle = await open(this.leasePath, "r+");
    try {
      const current = LeaseSchema.parse(JSON.parse(await handle.readFile("utf8")));
      if (current.lease_id !== lease.lease_id || Date.parse(current.expires_at) <= Date.now()) throw new Error("lease lost");
      const bytes = Buffer.from(`${canonicalJson(renewed)}\n`, "utf8");
      await handle.truncate(0);
      await handle.write(bytes, 0, bytes.length, 0);
      await handle.sync();
      lease.expires_at = renewed.expires_at;
    } catch {
      throw new ResumeDomainError("recoverable_internal_failure", "Resume Builder owner-data lease was lost before commit", 503);
    } finally {
      await handle.close();
    }
  }

  private async assertLeaseOwner(lease: Lease): Promise<void> {
    try {
      const current = LeaseSchema.parse(JSON.parse(await readFile(this.leasePath, "utf8")));
      if (current.lease_id !== lease.lease_id || Date.parse(current.expires_at) <= Date.now()) throw new Error("lease lost");
    } catch {
      throw new ResumeDomainError("recoverable_internal_failure", "Resume Builder owner-data lease was lost before commit", 503);
    }
  }

  private async releaseLease(lease: Lease): Promise<void> {
    try {
      const current = LeaseSchema.parse(JSON.parse(await readFile(this.leasePath, "utf8")));
      if (current.lease_id === lease.lease_id) await rm(this.leasePath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof z.ZodError) && !(error instanceof SyntaxError)) throw error;
    }
  }

  private async isLeaseOwnerAlive(lease: Lease): Promise<boolean> {
    if (lease.lease_version === 2) {
      if (lease.owner_pid === process.pid) return lease.owner_instance_id === PROCESS_INSTANCE_ID;
      if (lease.owner_process_start_ticks !== null) {
        const currentStartTicks = await this.processStartTicks(lease.owner_pid);
        if (currentStartTicks !== null) return currentStartTicks === lease.owner_process_start_ticks;
      }
    } else if (lease.owner_pid === process.pid) return true;
    try {
      process.kill(lease.owner_pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  }

  private async processStartTicks(processId: number): Promise<string | null> {
    if (process.platform !== "linux") return null;
    try {
      const stat = await readFile(`/proc/${processId}/stat`, "utf8");
      const commandEnd = stat.lastIndexOf(")");
      if (commandEnd < 0) return null;
      const fieldsAfterCommand = stat.slice(commandEnd + 2).trim().split(/\s+/);
      return /^\d+$/.test(fieldsAfterCommand[19] ?? "") ? fieldsAfterCommand[19]! : null;
    } catch {
      return null;
    }
  }

  private normalizePublicError(error: unknown, message: string): ResumeDomainError {
    if (error instanceof ResumeDomainError) return error;
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return new ResumeDomainError("validation_failed", "Resume Builder owner-data is invalid", 409);
    }
    return new ResumeDomainError("recoverable_internal_failure", message, 500);
  }

  private async copyAtomic(source: string, target: string): Promise<void> {
    await mkdir(path.dirname(target), { recursive: true });
    const temporaryPath = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await copyFile(source, temporaryPath, constants.COPYFILE_EXCL);
      const handle = await open(temporaryPath, "r+");
      try { await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporaryPath, target);
      await syncDirectoryEntry(path.dirname(target));
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private async commitHistory(message: string): Promise<void> {
    if (!this.writeHistory && !this.hooks.gitCheckpoint) return;
    try {
      await (this.hooks.gitCheckpoint ?? commitMemoryChange)(this.memoryRoot, message);
    } catch (error) {
      this.hooks.onDiagnostic?.("resume_data_git_checkpoint_failed", { error_code: errorCode(error) });
    }
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); }
    finally { release(); }
  }

  private async writeAtomic(targetPath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, targetPath);
      await syncDirectoryEntry(path.dirname(targetPath));
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
