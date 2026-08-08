import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { z } from "zod";
import { canonicalInputDigest, canonicalJson } from "../contracts/common.js";
import { LifecycleOperationSchema, LifecycleRecordSchema } from "../contracts/lifecycle.js";
import { CapabilityGrantSchema, PackageManifestSchema, PackageTrustSchema } from "../contracts/package.js";
import { RuntimeIdentitySchema } from "../contracts/supervisor.js";
import { AppPlatformError } from "./errors.js";

export type LifecycleRecord = z.infer<typeof LifecycleRecordSchema>;
export type LifecycleOperation = z.infer<typeof LifecycleOperationSchema>;
export type CapabilityGrant = z.infer<typeof CapabilityGrantSchema>;
export type RuntimeIdentity = z.infer<typeof RuntimeIdentitySchema>;

export type StoredPackage = {
  store_version: 1;
  package_digest: `sha256:${string}`;
  package_version: string;
  package_root: string;
  entrypoint: string;
  manifest: z.infer<typeof PackageManifestSchema>;
  trust: z.infer<typeof PackageTrustSchema>;
};

type StoreHooks = { beforeRename?: (targetPath: string) => Promise<void> };

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

export function initialLifecycleRecord(timestamp = new Date().toISOString()): LifecycleRecord {
  return LifecycleRecordSchema.parse({
    lifecycle_schema_version: 1,
    app_id: "ai.braindrive.resume-builder",
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
  private readonly inFlight = new Map<string, { inputDigest: string; promise: Promise<unknown> }>();
  private readonly lifecyclePath: string;
  private readonly operationsRoot: string;
  private readonly grantsRoot: string;
  private readonly packagesRoot: string;
  private readonly idempotencyRoot: string;

  constructor(public readonly root: string, private readonly hooks: StoreHooks = {}) {
    this.lifecyclePath = path.join(root, "registry", "lifecycle.json");
    this.operationsRoot = path.join(root, "registry", "operations");
    this.grantsRoot = path.join(root, "registry", "grants");
    this.packagesRoot = path.join(root, "registry", "packages");
    this.idempotencyRoot = path.join(root, "registry", "idempotency");
  }

  async initialize(): Promise<void> {
    await Promise.all([this.operationsRoot, this.grantsRoot, this.packagesRoot, this.idempotencyRoot].map((directory) => mkdir(directory, { recursive: true })));
    try { LifecycleRecordSchema.parse(JSON.parse(await readFile(this.lifecyclePath, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.writeAtomic(this.lifecyclePath, initialLifecycleRecord(), false);
    }
  }

  readLifecycle = async (): Promise<LifecycleRecord> => LifecycleRecordSchema.parse(JSON.parse(await readFile(this.lifecyclePath, "utf8")));

  async compareAndSwapLifecycle(expectedGeneration: number, next: LifecycleRecord): Promise<LifecycleRecord> {
    return this.serial(async () => {
      const current = await this.readLifecycle();
      if (current.generation !== expectedGeneration || next.generation !== expectedGeneration + 1) {
        throw new AppPlatformError("revision_conflict", "Lifecycle generation compare-and-swap failed");
      }
      const parsed = LifecycleRecordSchema.parse(next);
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
    PackageManifestSchema.parse(stored.manifest);
    PackageTrustSchema.parse(stored.trust);
    await this.writeAtomic(path.join(this.packagesRoot, `${stored.package_digest.slice(7)}.json`), stored);
  }

  async readPackage(packageDigest: string): Promise<StoredPackage | null> {
    try {
      const value = JSON.parse(await readFile(path.join(this.packagesRoot, `${packageDigest.slice(7)}.json`), "utf8")) as StoredPackage;
      if (value.store_version !== 1 || value.package_digest !== packageDigest) throw new AppPlatformError("store_corrupt", "Stored package metadata is invalid");
      PackageManifestSchema.parse(value.manifest); PackageTrustSchema.parse(value.trust);
      return value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  async removePackage(packageDigest: string): Promise<void> { await rm(path.join(this.packagesRoot, `${packageDigest.slice(7)}.json`), { force: true }); }

  async runIdempotent<T>(idempotencyKey: string, input: unknown, action: () => Promise<T>): Promise<T> {
    if (idempotencyKey.length < 16 || idempotencyKey.length > 256) throw new AppPlatformError("idempotency_key_invalid", "Idempotency key length is invalid", 400);
    const keyHash = createHash("sha256").update(idempotencyKey).digest("hex");
    const recordPath = path.join(this.idempotencyRoot, `${keyHash}.json`);
    const inputDigest = canonicalInputDigest(input);
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
