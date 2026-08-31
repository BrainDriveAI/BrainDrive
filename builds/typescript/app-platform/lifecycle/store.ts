import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";
import { AppRetentionClassSchema } from "../contracts/app-registry.js";
import { canonicalInputDigest, canonicalJson } from "../contracts/common.js";
import { LifecycleOperationSchema, LifecycleRecordSchema } from "../contracts/lifecycle.js";
import { CapabilityGrantSchema, PackageTrustSchema } from "../contracts/package.js";
import { RuntimeIdentitySchema } from "../contracts/supervisor.js";
import { AppPlatformError } from "./errors.js";
import type { RuntimePackageManifest } from "./package-verifier.js";
import { parseStoredRuntimePackageManifest } from "./runtime-manifest.js";

export type LifecycleRecord = z.infer<typeof LifecycleRecordSchema>;
export type LifecycleOperation = z.infer<typeof LifecycleOperationSchema>;
export type CapabilityGrant = z.infer<typeof CapabilityGrantSchema>;
export type RuntimeIdentity = z.infer<typeof RuntimeIdentitySchema>;

export type StoredPackage = {
  store_version: 1;
  package_digest: `sha256:${string}`;
  package_version: string;
  package_root: string;
  package_reference_id?: string;
  entrypoint: string;
  manifest: RuntimePackageManifest;
  trust: z.infer<typeof PackageTrustSchema>;
};

const UninstallJournalSchema = z.object({
  journal_version: z.literal(1),
  operation_id: z.string().uuid(),
  installation_id: z.string().uuid(),
  grant_id: z.string().uuid().nullable(),
  package_digests: z.array(z.string().regex(/^sha256:[a-f0-9]{64}$/)).max(2),
  package_roots: z.array(z.string().min(1).nullable()).max(2),
  stage: z.enum(["authority_removed", "references_cleared", "bytes_removed", "committed"]),
  owner_data_preserved: z.literal(true),
  removed_classes: z.array(z.enum(["runtime_registration", "capability_grant", "package_reference", "package_bytes", "disposable_cache"])),
  retained_classes: z.array(AppRetentionClassSchema),
  updated_at: z.string().datetime(),
}).strict();

export type UninstallJournal = z.infer<typeof UninstallJournalSchema>;

type StoreHooks = { beforeRename?: (targetPath: string) => Promise<void> };

const DataDeletionRecordBaseSchema = z.object({
  tombstone_version: z.literal(1),
  operation_id: z.string().uuid(),
  app_id: z.string().min(3).max(128),
  owner_id: z.string().uuid(),
  adapter_binding_id: z.string().min(3).max(128),
  data_contract_version: z.number().int().positive(),
  started_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

const DataDeletionTombstoneSchema = z.discriminatedUnion("status", [
  DataDeletionRecordBaseSchema.extend({
    status: z.literal("prepared"),
    deleted: z.literal(false),
    deleted_namespace_digest: z.null(),
    deleted_at: z.null(),
  }).strict(),
  DataDeletionRecordBaseSchema.extend({
    status: z.literal("committed"),
    deleted: z.literal(true),
    deleted_namespace_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    deleted_at: z.string().datetime(),
  }).strict(),
]);

export type DataDeletionTombstone = z.infer<typeof DataDeletionTombstoneSchema>;

const DataRetentionActionTombstoneSchema = z
  .object({
    tombstone_version: z.literal(1),
    operation_id: z.string().uuid(),
    app_id: z.string().min(3).max(128),
    owner_id: z.string().uuid(),
    adapter_binding_id: z.string().min(3).max(128),
    data_contract_version: z.number().int().positive(),
    action: z.enum(["export", "archive"]),
    status: z.enum(["prepared", "committed"]),
    retained: z.literal(true),
    result_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
    started_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    completed_at: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "prepared" && (value.result_digest !== null || value.completed_at !== null)) {
      context.addIssue({ code: "custom", message: "prepared retained-data action cannot claim a committed result" });
    }
    if (value.status === "committed" && (value.result_digest === null || value.completed_at === null)) {
      context.addIssue({ code: "custom", message: "committed retained-data action requires digest-bound evidence" });
    }
  });

export type DataRetentionActionTombstone = z.infer<typeof DataRetentionActionTombstoneSchema>;

type StoreOptions = StoreHooks & { appId?: string };
const StoreAppIdSchema = z.string().min(3).max(128).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/);

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

export function initialLifecycleRecord(timestamp = new Date().toISOString(), appId = "ai.braindrive.resume-builder"): LifecycleRecord {
  return LifecycleRecordSchema.parse({
    lifecycle_schema_version: 1,
    app_id: appId,
    installation_id: null,
    state: "not_installed",
    generation: 0,
    active_package_digest: null,
    last_known_good_package_digest: null,
    grant_id: null,
    pending_operation_id: null,
    successful_use_checkpoint: null,
    updated_at: timestamp,
  });
}

export class AppLifecycleStore {
  private tail = Promise.resolve();
  private mutationTail = Promise.resolve();
  private readonly inFlight = new Map<string, { inputDigest: string; promise: Promise<unknown> }>();
  private readonly lifecyclePath: string;
  private readonly operationsRoot: string;
  private readonly grantsRoot: string;
  private readonly packagesRoot: string;
  private readonly idempotencyRoot: string;
  private readonly tombstonesRoot: string;

  readonly appId: string;

  constructor(public readonly root: string, private readonly hooks: StoreOptions = {}) {
    this.appId = StoreAppIdSchema.parse(hooks.appId ?? "ai.braindrive.resume-builder");
    this.lifecyclePath = path.join(root, "registry", "lifecycle.json");
    this.operationsRoot = path.join(root, "registry", "operations");
    this.grantsRoot = path.join(root, "registry", "grants");
    this.packagesRoot = path.join(root, "registry", "packages");
    this.idempotencyRoot = path.join(root, "registry", "idempotency");
    this.tombstonesRoot = path.join(root, "registry", "tombstones");
  }

  async initialize(): Promise<void> {
    await Promise.all([this.operationsRoot, this.grantsRoot, this.packagesRoot, this.idempotencyRoot, this.tombstonesRoot].map((directory) => mkdir(directory, { recursive: true })));
    try {
      const record = LifecycleRecordSchema.parse(JSON.parse(await readFile(this.lifecyclePath, "utf8")));
      if (record.app_id !== this.appId) throw new AppPlatformError("store_corrupt", "Lifecycle record belongs to a different registered app");
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.writeAtomic(this.lifecyclePath, initialLifecycleRecord(new Date().toISOString(), this.appId), false);
    }
  }

  readLifecycle = async (): Promise<LifecycleRecord> => {
    const record = LifecycleRecordSchema.parse(JSON.parse(await readFile(this.lifecyclePath, "utf8")));
    if (record.app_id !== this.appId) throw new AppPlatformError("store_corrupt", "Lifecycle record belongs to a different registered app");
    return record;
  };

  async compareAndSwapLifecycle(expectedGeneration: number, next: LifecycleRecord): Promise<LifecycleRecord> {
    return this.serial(async () => {
      const current = await this.readLifecycle();
      if (current.generation !== expectedGeneration || next.generation !== expectedGeneration + 1) {
        throw new AppPlatformError("revision_conflict", "Lifecycle generation compare-and-swap failed");
      }
      const parsed = LifecycleRecordSchema.parse(next);
      if (parsed.app_id !== this.appId) throw new AppPlatformError("denied", "Lifecycle update targets a different registered app", 403);
      await this.writeAtomic(this.lifecyclePath, parsed);
      return parsed;
    });
  }

  async saveOperation(operation: LifecycleOperation): Promise<void> {
    const parsed = LifecycleOperationSchema.parse(operation);
    await this.writeAtomic(path.join(this.operationsRoot, `${parsed.operation_id}.json`), parsed);
  }

  async readOperation(operationId: string): Promise<LifecycleOperation | null> {
    try { return LifecycleOperationSchema.parse(JSON.parse(await readFile(path.join(this.operationsRoot, `${operationId}.json`), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  async listOperations(): Promise<LifecycleOperation[]> {
    const names = (await readdir(this.operationsRoot)).filter((name) => name.endsWith(".json")).sort();
    return Promise.all(names.map(async (name) => LifecycleOperationSchema.parse(JSON.parse(await readFile(path.join(this.operationsRoot, name), "utf8")))));
  }

  async saveGrant(grant: CapabilityGrant): Promise<void> {
    const parsed = CapabilityGrantSchema.parse(grant);
    await this.writeAtomic(path.join(this.grantsRoot, `${parsed.grant_id}.json`), parsed);
  }

  async readGrant(grantId: string): Promise<CapabilityGrant | null> {
    try { return CapabilityGrantSchema.parse(JSON.parse(await readFile(path.join(this.grantsRoot, `${grantId}.json`), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  async revokeGrant(grantId: string, at = new Date().toISOString()): Promise<CapabilityGrant | null> {
    const grant = await this.readGrant(grantId);
    if (!grant) return null;
    const revoked = CapabilityGrantSchema.parse({ ...grant, grant_revision: grant.grant_revision + 1, revocation_generation: grant.revocation_generation + 1, revoked_at: grant.revoked_at ?? at });
    await this.saveGrant(revoked);
    return revoked;
  }

  async bumpGrantRevocationGeneration(grantId: string): Promise<CapabilityGrant | null> {
    const grant = await this.readGrant(grantId);
    if (!grant) return null;
    const next = CapabilityGrantSchema.parse({ ...grant, grant_revision: grant.grant_revision + 1, revocation_generation: grant.revocation_generation + 1 });
    await this.saveGrant(next);
    return next;
  }

  async removeGrant(grantId: string): Promise<void> { await rm(path.join(this.grantsRoot, `${grantId}.json`), { force: true }); }

  async savePackage(stored: StoredPackage): Promise<void> {
    const manifest = parseStoredRuntimePackageManifest(stored.manifest);
    PackageTrustSchema.parse(stored.trust);
    await this.writeAtomic(path.join(this.packagesRoot, `${stored.package_digest.slice(7)}.json`), { ...stored, manifest });
  }

  async readPackage(packageDigest: string): Promise<StoredPackage | null> {
    try {
      const value = JSON.parse(await readFile(path.join(this.packagesRoot, `${packageDigest.slice(7)}.json`), "utf8")) as StoredPackage;
      if (value.store_version !== 1 || value.package_digest !== packageDigest) throw new AppPlatformError("store_corrupt", "Stored package metadata is invalid");
      const manifest = parseStoredRuntimePackageManifest(value.manifest);
      PackageTrustSchema.parse(value.trust);
      return { ...value, manifest };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  async removePackage(packageDigest: string): Promise<void> { await rm(path.join(this.packagesRoot, `${packageDigest.slice(7)}.json`), { force: true }); }

  async listPackages(): Promise<StoredPackage[]> {
    const names = (await readdir(this.packagesRoot)).filter((name) => name.endsWith(".json")).sort();
    return Promise.all(names.map(async (name) => {
      const value = JSON.parse(await readFile(path.join(this.packagesRoot, name), "utf8")) as StoredPackage;
      return (await this.readPackage(value.package_digest))!;
    }));
  }

  async saveUninstallJournal(journal: UninstallJournal): Promise<void> {
    const parsed = UninstallJournalSchema.parse(journal);
    await this.writeAtomic(path.join(this.tombstonesRoot, `${parsed.operation_id}.json`), parsed);
  }

  async readUninstallJournal(operationId: string): Promise<UninstallJournal | null> {
    try {
      return UninstallJournalSchema.parse(JSON.parse(await readFile(path.join(this.tombstonesRoot, `${operationId}.json`), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async saveDataDeletionTombstone(tombstone: DataDeletionTombstone): Promise<void> {
    const parsed = DataDeletionTombstoneSchema.parse(tombstone);
    if (parsed.app_id !== this.appId) throw new AppPlatformError("denied", "Data deletion tombstone targets a different registered app", 403);
    await this.writeAtomic(path.join(this.tombstonesRoot, `data-${parsed.operation_id}.json`), parsed);
  }

  async readDataDeletionTombstone(operationId: string): Promise<DataDeletionTombstone | null> {
    try {
      const parsed = DataDeletionTombstoneSchema.parse(JSON.parse(await readFile(path.join(this.tombstonesRoot, `data-${operationId}.json`), "utf8")));
      if (parsed.app_id !== this.appId) throw new AppPlatformError("store_corrupt", "Data deletion tombstone belongs to a different registered app");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async saveDataRetentionActionTombstone(tombstone: DataRetentionActionTombstone): Promise<void> {
    const parsed = DataRetentionActionTombstoneSchema.parse(tombstone);
    if (parsed.app_id !== this.appId) throw new AppPlatformError("denied", "Data retention tombstone targets a different registered app", 403);
    await this.writeAtomic(path.join(this.tombstonesRoot, `data-${parsed.action}-${parsed.operation_id}.json`), parsed);
  }

  async readDataRetentionActionTombstone(action: "export" | "archive", operationId: string): Promise<DataRetentionActionTombstone | null> {
    try {
      const parsed = DataRetentionActionTombstoneSchema.parse(JSON.parse(await readFile(path.join(this.tombstonesRoot, `data-${action}-${operationId}.json`), "utf8")));
      if (parsed.app_id !== this.appId) throw new AppPlatformError("store_corrupt", "Data retention tombstone belongs to a different registered app");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async runLifecycleMutation<T>(action: () => Promise<T>): Promise<T> {
    return this.mutationSerial(async () => {
      const pending = await this.pendingDataDeletionOperations();
      if (pending.length > 0) {
        throw new AppPlatformError("recoverable_internal_failure", "Retained-data deletion recovery must finish before lifecycle mutation");
      }
      return action();
    });
  }

  async runDataDeletionMutation<T>(operationId: string, action: () => Promise<T>): Promise<T> {
    return this.mutationSerial(async () => {
      const pending = await this.pendingDataDeletionOperations();
      if (pending.some((record) => record.operation_id !== operationId)) {
        throw new AppPlatformError("recoverable_internal_failure", "A prior retained-data deletion requires recovery");
      }
      return action();
    });
  }

  async runIdempotent<T>(idempotencyKey: string, input: unknown, action: () => Promise<T>): Promise<T> {
    if (idempotencyKey.length < 16 || idempotencyKey.length > 256) throw new AppPlatformError("idempotency_key_invalid", "Idempotency key length is invalid", 400);
    const keyHash = createHash("sha256").update(`${this.appId}\0${idempotencyKey}`).digest("hex");
    const recordPath = path.join(this.idempotencyRoot, `${keyHash}.json`);
    const inputDigest = canonicalInputDigest({ app_id: this.appId, input });
    try {
      const existing = JSON.parse(await readFile(recordPath, "utf8")) as { idempotency_version: 1; input_digest: string; result: T };
      if (existing.input_digest !== inputDigest) throw new AppPlatformError("idempotency_conflict", "Idempotency key was reused with different canonical input");
      return existing.result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const running = this.inFlight.get(keyHash);
    if (running) {
      if (running.inputDigest !== inputDigest) throw new AppPlatformError("idempotency_conflict", "Idempotency key is already running with different canonical input");
      return running.promise as Promise<T>;
    }
    const promise = (async () => {
      const result = await action();
      await this.serial(async () => this.writeAtomic(recordPath, { idempotency_version: 1, operation_id: randomUUID(), input_digest: inputDigest, result }));
      return result;
    })();
    this.inFlight.set(keyHash, { inputDigest, promise });
    try { return await promise; } finally { this.inFlight.delete(keyHash); }
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async mutationSerial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async pendingDataDeletionOperations(): Promise<DataDeletionTombstone[]> {
    const names = (await readdir(this.tombstonesRoot))
      .filter((name) => /^data-[0-9a-f-]{36}\.json$/i.test(name))
      .sort();
    const records = await Promise.all(names.map(async (name) => {
      const parsed = DataDeletionTombstoneSchema.parse(JSON.parse(await readFile(path.join(this.tombstonesRoot, name), "utf8")));
      if (parsed.app_id !== this.appId) throw new AppPlatformError("store_corrupt", "Data deletion tombstone belongs to a different registered app");
      return parsed;
    }));
    return records.filter((record) => record.status === "prepared");
  }

  private async writeAtomic(targetPath: string, value: unknown, runHook = true): Promise<void> {
    await mkdir(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(tempPath, "wx", 0o600);
    try { await handle.writeFile(`${canonicalJson(value)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
    try {
      if (runHook) await this.hooks.beforeRename?.(targetPath);
      await rename(tempPath, targetPath);
      await syncDirectoryEntry(path.dirname(targetPath));
    } catch (error) { await rm(tempPath, { force: true }); throw error; }
  }
}
