import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { canonicalInputDigest, canonicalJson, Sha256DigestSchema, TimestampSchema } from "../contracts/common.js";
import { PackageComponentManifestSchema, PackageIdSchema, type PackageComponentManifest } from "../contracts/package-components.js";
import { AppPlatformError } from "./errors.js";
import {
  InstalledPackageStore,
  type ComponentHealthState,
  type InstallPackageInput,
  type InstalledPackageRecord,
} from "./installed-package-store.js";
import type { SidecarLifecycleSnapshot, SidecarOperationAuthority } from "./sidecar-supervisor.js";

type PackageSource = InstallPackageInput["source"];

export type SidecarSupervisorPort = {
  bindingService: { cleanup(packageId: string, componentId: string): void };
  start(input: { packageId: string; componentId: string; authority: { kind: "host" } }): Promise<SidecarLifecycleSnapshot>;
  awaitReadiness(input: { packageId: string; componentId: string; authority: { kind: "host" } }): Promise<SidecarLifecycleSnapshot>;
  health(input: { packageId: string; componentId: string; authority: { kind: "host" } }): Promise<SidecarLifecycleSnapshot>;
  restart(input: { packageId: string; componentId: string; authority: { kind: "host" } }): Promise<SidecarLifecycleSnapshot>;
  stop(input: { packageId: string; componentId: string; authority: { kind: "host" } }): Promise<SidecarLifecycleSnapshot>;
  uninstall(input: { packageId: string; componentId: string; authority: { kind: "host" } }): Promise<SidecarLifecycleSnapshot>;
  cleanup?(input: { packageId: string; componentId: string; authority: { kind: "host" } }): Promise<void>;
};

const SidecarAuthorityRuntimeIdentitySchema = z.object({
  runtime_id: z.string().min(1).max(128),
  binding_generation: z.number().int().positive(),
}).strict();

export const SidecarAuthorityStateSchema = z.enum([
  "enabled",
  "running",
  "disabled",
  "unavailable",
  "unhealthy",
  "unsupported",
  "blocked",
  "uninstalled",
  "shutdown",
]);
export type SidecarAuthorityState = z.infer<typeof SidecarAuthorityStateSchema>;

export const SidecarAuthorityRecordSchema = z.object({
  sidecar_authority_version: z.literal(1),
  package_id: PackageIdSchema,
  component_id: z.string().min(3).max(128),
  installation_id: z.string().uuid(),
  package_digest: Sha256DigestSchema,
  package_generation: z.number().int().nonnegative(),
  lifecycle_generation: z.number().int().nonnegative(),
  state: SidecarAuthorityStateSchema,
  health: z.enum(["unknown", "healthy", "unhealthy"]),
  runtime: SidecarAuthorityRuntimeIdentitySchema.nullable(),
  last_known_good_package_digest: Sha256DigestSchema.nullable(),
  authority_revoked_at: TimestampSchema.nullable(),
  cleanup_due_at: TimestampSchema.nullable(),
  updated_at: TimestampSchema,
}).strict();

export const SidecarLifecycleOperationRecordSchema = z.object({
  sidecar_lifecycle_operation_version: z.literal(1),
  operation_id: z.string().uuid(),
  operation_key_digest: Sha256DigestSchema,
  canonical_input_digest: Sha256DigestSchema,
  package_id: PackageIdSchema.nullable(),
  component_id: z.string().min(3).max(128).nullable(),
  kind: z.enum(["install", "enable", "start", "disable", "restart", "update", "rollback", "uninstall", "shutdown", "reconcile"]),
  status: z.enum(["running", "committed", "failed"]),
  prior_generation: z.number().int().nonnegative().nullable(),
  result_generation: z.number().int().nonnegative().nullable(),
  completed_stages: z.array(z.enum([
    "requested",
    "installing_package",
    "candidate_check",
    "revoking_authority",
    "stopping",
    "starting",
    "awaiting_readiness",
    "switching_active_pointer",
    "updating_package",
    "recording_authority",
    "uninstalling",
    "shutdown",
    "cleanup",
    "completed",
  ])).max(18),
  error_code: z.string().min(1).max(128).nullable(),
  started_at: TimestampSchema,
  updated_at: TimestampSchema,
  completed_at: TimestampSchema.nullable(),
}).strict();

const StoredPackageReferenceSchema = z.object({
  package_reference_version: z.literal(1),
  package_id: PackageIdSchema,
  package_digest: Sha256DigestSchema,
  component_id: z.string().min(3).max(128),
  source_classification: z.enum(["repository_fixture", "local_package"]),
  recorded_at: TimestampSchema,
}).strict();

export type SidecarAuthorityRecord = z.infer<typeof SidecarAuthorityRecordSchema>;
export type SidecarLifecycleOperationRecord = z.infer<typeof SidecarLifecycleOperationRecordSchema>;
type StoredPackageReference = z.infer<typeof StoredPackageReferenceSchema>;
type OperationStage = SidecarLifecycleOperationRecord["completed_stages"][number];

export type SidecarLifecycleResponse = {
  record: SidecarAuthorityRecord;
  operation: SidecarLifecycleOperationRecord;
};

export type HostSidecarLifecycleServiceOptions = {
  packageStore: InstalledPackageStore;
  authorityStore: SidecarLifecycleAuthorityStore;
  supervisor: SidecarSupervisorPort;
  rollbackResolver?: SidecarRollbackPackageResolver;
  clock?: () => Date;
  ids?: { next(): string };
  cleanupRetentionMs?: number;
  audit?: (event: string, details: Record<string, unknown>) => void;
};

export type SidecarRollbackPackageResolver = {
  resolvePackage(input: {
    packageId: string;
    packageDigest: `sha256:${string}`;
    componentId: string;
  }): Promise<{ manifest: PackageComponentManifest; source: PackageSource } | null>;
};

type InstallInput = {
  authority: SidecarOperationAuthority;
  manifest: PackageComponentManifest;
  packageDigest: `sha256:${string}`;
  componentId: string;
  idempotencyKey: string;
  operationId?: string;
  source: PackageSource;
};

type PackageActionInput = {
  authority: SidecarOperationAuthority;
  packageId: string;
  componentId: string;
  idempotencyKey: string;
  operationId?: string;
  expectedGeneration?: number;
};

type UpdateInput = InstallInput & {
  packageId: string;
  expectedGeneration?: number;
};

type ShutdownInput = {
  authority: SidecarOperationAuthority;
  idempotencyKey: string;
  operationId?: string;
};

export class SidecarLifecycleAuthorityStore {
  private readonly authorityRoot: string;
  private readonly operationsRoot: string;
  private readonly packagesRoot: string;

  constructor(public readonly root: string, private readonly clock: () => Date = () => new Date()) {
    this.authorityRoot = path.join(root, "host-sidecar-state", "runtime-authority");
    this.operationsRoot = path.join(root, "host-sidecar-state", "operations");
    this.packagesRoot = path.join(root, "host-sidecar-state", "package-references");
  }

  async initialize(): Promise<void> {
    await Promise.all([this.authorityRoot, this.operationsRoot, this.packagesRoot].map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })));
  }

  async saveAuthority(record: SidecarAuthorityRecord): Promise<SidecarAuthorityRecord> {
    const parsed = SidecarAuthorityRecordSchema.parse(record);
    await this.initialize();
    await writeAtomic(this.authorityPath(parsed.package_id, parsed.component_id), parsed);
    return parsed;
  }

  async readAuthority(packageId: string, componentId: string): Promise<SidecarAuthorityRecord | null> {
    PackageIdSchema.parse(packageId);
    try {
      return SidecarAuthorityRecordSchema.parse(JSON.parse(await readFile(this.authorityPath(packageId, componentId), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async listAuthorities(): Promise<SidecarAuthorityRecord[]> {
    await this.initialize();
    const names = (await readdir(this.authorityRoot)).filter((name) => name.endsWith(".json")).sort();
    return await Promise.all(names.map(async (name) => SidecarAuthorityRecordSchema.parse(JSON.parse(await readFile(path.join(this.authorityRoot, name), "utf8")))));
  }

  async removeAuthority(packageId: string, componentId: string): Promise<void> {
    PackageIdSchema.parse(packageId);
    await rm(this.authorityPath(packageId, componentId), { force: true });
  }

  async saveOperation(operation: SidecarLifecycleOperationRecord): Promise<SidecarLifecycleOperationRecord> {
    const parsed = SidecarLifecycleOperationRecordSchema.parse(operation);
    await this.initialize();
    await writeAtomic(this.operationPath(parsed.operation_key_digest), parsed);
    return parsed;
  }

  async readOperationByKey(idempotencyKey: string): Promise<SidecarLifecycleOperationRecord | null> {
    try {
      return SidecarLifecycleOperationRecordSchema.parse(JSON.parse(await readFile(this.operationPath(operationKeyDigest(idempotencyKey)), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async listRunningOperations(packageId: string, componentId: string): Promise<SidecarLifecycleOperationRecord[]> {
    await this.initialize();
    const names = (await readdir(this.operationsRoot)).filter((name) => name.endsWith(".json"));
    const operations = await Promise.all(names.map(async (name) => SidecarLifecycleOperationRecordSchema.parse(JSON.parse(await readFile(path.join(this.operationsRoot, name), "utf8")))));
    return operations.filter((operation) => operation.status === "running" && operation.package_id === packageId && operation.component_id === componentId);
  }

  async savePackageReference(input: { manifest: PackageComponentManifest; packageDigest: `sha256:${string}`; componentId: string; source: PackageSource }): Promise<StoredPackageReference> {
    const record = StoredPackageReferenceSchema.parse({
      package_reference_version: 1,
      package_id: input.manifest.package_id,
      package_digest: input.packageDigest,
      component_id: input.componentId,
      source_classification: input.source.kind,
      recorded_at: this.clock().toISOString(),
    });
    await this.initialize();
    await writeAtomic(this.packageReferencePath(input.packageDigest), record);
    return record;
  }

  async readPackageReference(packageDigest: string): Promise<StoredPackageReference> {
    return StoredPackageReferenceSchema.parse(JSON.parse(await readFile(this.packageReferencePath(packageDigest), "utf8")));
  }

  private authorityPath(packageId: string, componentId: string): string {
    return path.join(this.authorityRoot, `${safeFile(packageId)}--${safeFile(componentId)}.json`);
  }

  private operationPath(keyDigest: string): string {
    Sha256DigestSchema.parse(keyDigest);
    return path.join(this.operationsRoot, `${keyDigest.slice("sha256:".length)}.json`);
  }

  private packageReferencePath(packageDigest: string): string {
    Sha256DigestSchema.parse(packageDigest);
    return path.join(this.packagesRoot, `${packageDigest.slice("sha256:".length)}.json`);
  }
}

export class HostSidecarLifecycleService {
  private readonly clock: () => Date;
  private readonly ids: { next(): string };
  private readonly cleanupRetentionMs: number;
  private readonly audit: NonNullable<HostSidecarLifecycleServiceOptions["audit"]>;
  candidateReadiness: (input: UpdateInput) => Promise<void> = async () => undefined;

  constructor(private readonly options: HostSidecarLifecycleServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.ids = options.ids ?? { next: () => randomUUID() };
    this.cleanupRetentionMs = Math.max(0, options.cleanupRetentionMs ?? 86_400_000);
    this.audit = options.audit ?? (() => undefined);
  }

  async initialize(): Promise<void> {
    await Promise.all([this.options.packageStore.initialize(), this.options.authorityStore.initialize()]);
  }

  async install(input: InstallInput): Promise<SidecarLifecycleResponse> {
    this.assertHost(input.authority);
    const packageId = input.manifest.package_id;
    return await this.run("install", input.idempotencyKey, packageId, input.componentId, stableInstallInput(input), async (operation) => {
      this.assertManifestSidecar(input.manifest, input.componentId);
      operation = await this.stage(operation, "installing_package");
      const installed = await this.options.packageStore.installPackage({
        manifest: input.manifest,
        packageDigest: input.packageDigest,
        source: input.source,
      });
      await this.options.authorityStore.savePackageReference(input);
      const record = await this.options.authorityStore.saveAuthority(this.authorityRecord(installed, input.componentId, "enabled", "unknown", null, null, 1));
      operation = await this.complete(operation, record);
      return { record, operation };
    }, input.operationId);
  }

  async enable(input: PackageActionInput): Promise<SidecarLifecycleResponse> {
    this.assertHost(input.authority);
    return await this.mutateExisting("enable", input, async (operation, prior) => {
      await this.options.packageStore.enablePackage(input.packageId);
      const packageRecord = await this.options.packageStore.requirePackage(input.packageId);
      const record = await this.options.authorityStore.saveAuthority(this.nextAuthority(prior, packageRecord, "enabled", "unknown", null, null));
      operation = await this.complete(operation, record);
      return { record, operation };
    });
  }

  async start(input: PackageActionInput): Promise<SidecarLifecycleResponse> {
    this.assertHost(input.authority);
    return await this.mutateExisting("start", input, async (operation, prior) => {
      operation = await this.stage(operation, "starting");
      await this.options.supervisor.start({ packageId: input.packageId, componentId: input.componentId, authority: { kind: "host" } });
      operation = await this.stage(operation, "awaiting_readiness");
      const ready = await this.options.supervisor.awaitReadiness({ packageId: input.packageId, componentId: input.componentId, authority: { kind: "host" } });
      const packageRecord = await this.options.packageStore.requirePackage(input.packageId);
      const record = await this.options.authorityStore.saveAuthority(this.nextAuthority(prior, packageRecord, stateFromSnapshot(ready), healthFromSnapshot(ready), runtimeIdentity(ready), null));
      operation = await this.complete(operation, record);
      return { record, operation };
    });
  }

  async disable(input: PackageActionInput): Promise<SidecarLifecycleResponse> {
    this.assertHost(input.authority);
    return await this.mutateExisting("disable", input, async (operation, prior) => {
      operation = await this.revokeAndStop(operation, input, prior);
      await this.options.packageStore.disablePackage(input.packageId);
      const packageRecord = await this.options.packageStore.requirePackage(input.packageId);
      const record = await this.options.authorityStore.saveAuthority(this.nextAuthority(prior, packageRecord, "disabled", "unknown", null, prior.last_known_good_package_digest));
      operation = await this.complete(operation, record);
      return { record, operation };
    });
  }

  async restart(input: PackageActionInput): Promise<SidecarLifecycleResponse> {
    this.assertHost(input.authority);
    return await this.mutateExisting("restart", input, async (operation, prior) => {
      operation = await this.stage(operation, "revoking_authority");
      this.options.supervisor.bindingService.cleanup(input.packageId, input.componentId);
      operation = await this.stage(operation, "starting");
      await this.options.supervisor.restart({ packageId: input.packageId, componentId: input.componentId, authority: { kind: "host" } });
      operation = await this.stage(operation, "awaiting_readiness");
      const ready = await this.options.supervisor.awaitReadiness({ packageId: input.packageId, componentId: input.componentId, authority: { kind: "host" } });
      const packageRecord = await this.options.packageStore.requirePackage(input.packageId);
      const record = await this.options.authorityStore.saveAuthority(this.nextAuthority(prior, packageRecord, stateFromSnapshot(ready), healthFromSnapshot(ready), runtimeIdentity(ready), prior.last_known_good_package_digest));
      operation = await this.complete(operation, record);
      return { record, operation };
    });
  }

  async update(input: UpdateInput): Promise<SidecarLifecycleResponse> {
    this.assertHost(input.authority);
    return await this.mutateExisting("update", input, async (operation, prior) => {
      if (input.packageId !== input.manifest.package_id) throw new AppPlatformError("package_identity_mismatch", "Sidecar package update changed package identity");
      this.assertManifestSidecar(input.manifest, input.componentId);
      let candidateChecked = false;
      try {
        operation = await this.stage(operation, "candidate_check");
        await this.candidateReadiness(input);
        candidateChecked = true;
        await this.options.authorityStore.savePackageReference(input);
        if (prior.state === "running") operation = await this.revokeAndStop(operation, input, prior);
        operation = await this.stage(operation, "updating_package");
        await this.options.packageStore.updatePackage(input.packageId, {
          manifest: input.manifest,
          packageDigest: input.packageDigest,
          source: input.source,
        });
        operation = await this.stage(operation, "starting");
        const packageRecord = await this.options.packageStore.requirePackage(input.packageId);
        let nextState: SidecarAuthorityState = prior.state === "disabled" ? "disabled" : "enabled";
        let nextHealth: SidecarAuthorityRecord["health"] = "unknown";
        let runtime = null;
        if (prior.state === "running") {
          await this.options.supervisor.start({ packageId: input.packageId, componentId: input.componentId, authority: { kind: "host" } });
          operation = await this.stage(operation, "awaiting_readiness");
          const ready = await this.options.supervisor.awaitReadiness({ packageId: input.packageId, componentId: input.componentId, authority: { kind: "host" } });
          nextState = stateFromSnapshot(ready);
          nextHealth = healthFromSnapshot(ready);
          runtime = runtimeIdentity(ready);
        }
        const record = await this.options.authorityStore.saveAuthority(this.nextAuthority(prior, packageRecord, nextState, nextHealth, runtime, prior.package_digest));
        operation = await this.complete(operation, record);
        return { record, operation };
      } catch (error) {
        if (candidateChecked && prior.state === "running") {
          await this.options.supervisor.start({ packageId: input.packageId, componentId: input.componentId, authority: { kind: "host" } }).catch(() => undefined);
          await this.options.supervisor.awaitReadiness({ packageId: input.packageId, componentId: input.componentId, authority: { kind: "host" } }).catch(() => undefined);
        }
        await this.options.authorityStore.saveAuthority(prior);
        await this.fail(operation, safeCode(error));
        throw error;
      }
    });
  }

  async rollback(input: PackageActionInput): Promise<SidecarLifecycleResponse> {
    this.assertHost(input.authority);
    return await this.mutateExisting("rollback", input, async (operation, prior) => {
      if (!prior.last_known_good_package_digest) throw new AppPlatformError("rollback_unavailable", "No last-known-good sidecar package is retained");
      const target = await this.options.authorityStore.readPackageReference(prior.last_known_good_package_digest);
      if (target.package_id !== input.packageId || target.component_id !== input.componentId) {
        throw new AppPlatformError("rollback_unavailable", "Last-known-good sidecar package is outside this authority scope");
      }
      const resolved = await this.options.rollbackResolver?.resolvePackage({
        packageId: input.packageId,
        packageDigest: target.package_digest as `sha256:${string}`,
        componentId: input.componentId,
      });
      if (!resolved) throw new AppPlatformError("rollback_unavailable", "Last-known-good sidecar package authority is unavailable");
      this.assertManifestSidecar(resolved.manifest, input.componentId);
      if (prior.state === "running") operation = await this.revokeAndStop(operation, input, prior);
      operation = await this.stage(operation, "updating_package");
      await this.options.packageStore.updatePackage(input.packageId, {
        manifest: resolved.manifest,
        packageDigest: target.package_digest as `sha256:${string}`,
        source: resolved.source,
      });
      const packageRecord = await this.options.packageStore.requirePackage(input.packageId);
      let nextState: SidecarAuthorityState = prior.state === "running" ? "running" : "enabled";
      let nextHealth: SidecarAuthorityRecord["health"] = "unknown";
      let runtime = null;
      if (prior.state === "running") {
        operation = await this.stage(operation, "starting");
        await this.options.supervisor.start({ packageId: input.packageId, componentId: input.componentId, authority: { kind: "host" } });
        operation = await this.stage(operation, "awaiting_readiness");
        const ready = await this.options.supervisor.awaitReadiness({ packageId: input.packageId, componentId: input.componentId, authority: { kind: "host" } });
        nextState = stateFromSnapshot(ready);
        nextHealth = healthFromSnapshot(ready);
        runtime = runtimeIdentity(ready);
      }
      const record = await this.options.authorityStore.saveAuthority(this.nextAuthority(prior, packageRecord, nextState, nextHealth, runtime, prior.package_digest));
      operation = await this.complete(operation, record);
      return { record, operation };
    });
  }

  async uninstall(input: PackageActionInput): Promise<SidecarLifecycleResponse> {
    this.assertHost(input.authority);
    return await this.mutateExisting("uninstall", input, async (operation, prior) => {
      operation = await this.revokeAndStop(operation, input, prior);
      operation = await this.stage(operation, "uninstalling");
      await this.options.supervisor.uninstall({ packageId: input.packageId, componentId: input.componentId, authority: { kind: "host" } }).catch(() => undefined);
      await this.options.supervisor.cleanup?.({ packageId: input.packageId, componentId: input.componentId, authority: { kind: "host" } }).catch(() => undefined);
      await this.options.packageStore.uninstallPackage(input.packageId, operation.operation_id as `${string}-${string}-${string}-${string}-${string}`);
      const record = await this.options.authorityStore.saveAuthority({
        ...prior,
        lifecycle_generation: prior.lifecycle_generation + 1,
        package_generation: prior.package_generation + 1,
        state: "uninstalled",
        health: "unknown",
        runtime: null,
        authority_revoked_at: this.now(),
        cleanup_due_at: new Date(this.clock().getTime() + this.cleanupRetentionMs).toISOString(),
        updated_at: this.now(),
      });
      operation = await this.complete(operation, record);
      return { record, operation };
    });
  }

  async shutdown(input: ShutdownInput): Promise<{ operation: SidecarLifecycleOperationRecord; records: SidecarAuthorityRecord[] }> {
    this.assertHost(input.authority);
    return await this.run("shutdown", input.idempotencyKey, null, null, { kind: "shutdown" }, async (operation) => {
      const updated: SidecarAuthorityRecord[] = [];
      for (const prior of await this.options.authorityStore.listAuthorities()) {
        if (prior.runtime || prior.state === "running") {
          this.options.supervisor.bindingService.cleanup(prior.package_id, prior.component_id);
          await this.options.supervisor.stop({ packageId: prior.package_id, componentId: prior.component_id, authority: { kind: "host" } }).catch(() => undefined);
          const record = await this.options.authorityStore.saveAuthority({
            ...prior,
            lifecycle_generation: prior.lifecycle_generation + 1,
            state: "shutdown",
            health: "unknown",
            runtime: null,
            authority_revoked_at: this.now(),
            updated_at: this.now(),
          });
          await this.options.packageStore.setSidecarRuntimeState(prior.package_id, prior.component_id, "stopped", "unknown").catch(() => undefined);
          updated.push(record);
        }
      }
      operation = await this.complete(operation, updated[0] ?? null);
      return { operation, records: updated };
    }, input.operationId);
  }

  async reconcileOfflineRestart(input: PackageActionInput): Promise<SidecarLifecycleResponse> {
    this.assertHost(input.authority);
    return await this.mutateExisting("reconcile", input, async (operation, prior) => {
      if (prior.state !== "running" && prior.state !== "shutdown") throw new AppPlatformError("invalid_state_transition", "Sidecar is not intended to be running");
      operation = await this.stage(operation, "starting");
      await this.options.supervisor.start({ packageId: input.packageId, componentId: input.componentId, authority: { kind: "host" } });
      operation = await this.stage(operation, "awaiting_readiness");
      const ready = await this.options.supervisor.awaitReadiness({ packageId: input.packageId, componentId: input.componentId, authority: { kind: "host" } });
      const packageRecord = await this.options.packageStore.requirePackage(input.packageId);
      const record = await this.options.authorityStore.saveAuthority(this.nextAuthority(prior, packageRecord, stateFromSnapshot(ready), healthFromSnapshot(ready), runtimeIdentity(ready), prior.last_known_good_package_digest));
      operation = await this.complete(operation, record);
      return { record, operation };
    });
  }

  async cleanupExpired(): Promise<number> {
    let removed = 0;
    const now = this.clock().getTime();
    for (const record of await this.options.authorityStore.listAuthorities()) {
      if (record.state !== "uninstalled" || !record.cleanup_due_at || Date.parse(record.cleanup_due_at) > now) continue;
      await this.options.authorityStore.removeAuthority(record.package_id, record.component_id);
      removed += 1;
    }
    return removed;
  }

  async ownerProjection(packageId: string, componentId: string): Promise<Record<string, unknown>> {
    const record = await this.options.authorityStore.readAuthority(packageId, componentId);
    if (!record) throw new AppPlatformError("not_found_within_scope", "Sidecar lifecycle authority is unavailable", 404);
    return safeProjection(record);
  }

  private async mutateExisting<T extends SidecarLifecycleResponse>(
    kind: SidecarLifecycleOperationRecord["kind"],
    input: PackageActionInput,
    mutation: (operation: SidecarLifecycleOperationRecord, prior: SidecarAuthorityRecord) => Promise<T>,
  ): Promise<T> {
    const stableInput = stableActionInput(kind, input);
    const inputDigest = canonicalInputDigest(stableInput);
    const existing = await this.options.authorityStore.readOperationByKey(input.idempotencyKey);
    if (existing) {
      if (existing.canonical_input_digest !== inputDigest) throw new AppPlatformError("idempotency_conflict", "Sidecar lifecycle operation was retried with changed input");
      if (existing.status === "committed") {
        const record = await this.requireAuthority(input.packageId, input.componentId);
        return { record, operation: existing } as T;
      }
      throw new AppPlatformError("runtime_conflict", "A sidecar lifecycle operation is already active");
    }
    const prior = await this.requireAuthority(input.packageId, input.componentId);
    this.assertGeneration(prior, input.expectedGeneration);
    return await this.run(kind, input.idempotencyKey, input.packageId, input.componentId, stableInput, async (operation) => {
      return await mutation(operation, prior);
    }, input.operationId, prior.lifecycle_generation);
  }

  private async run<T>(
    kind: SidecarLifecycleOperationRecord["kind"],
    idempotencyKey: string,
    packageId: string | null,
    componentId: string | null,
    stableInput: unknown,
    mutation: (operation: SidecarLifecycleOperationRecord) => Promise<T>,
    operationId = this.ids.next(),
    priorGeneration: number | null = null,
  ): Promise<T> {
    const inputDigest = canonicalInputDigest(stableInput);
    const existing = await this.options.authorityStore.readOperationByKey(idempotencyKey);
    if (existing) {
      if (existing.canonical_input_digest !== inputDigest) throw new AppPlatformError("idempotency_conflict", "Sidecar lifecycle operation was retried with changed input");
      if (existing.status === "committed") {
        if (packageId && componentId) {
          const record = await this.options.authorityStore.readAuthority(packageId, componentId);
          if (record) return { record, operation: existing } as T;
        }
        return { operation: existing, records: [] } as T;
      }
      throw new AppPlatformError("runtime_conflict", "A sidecar lifecycle operation is already active");
    }
    if (packageId && componentId && (await this.options.authorityStore.listRunningOperations(packageId, componentId)).length > 0) {
      throw new AppPlatformError("runtime_conflict", "A sidecar lifecycle operation is already active");
    }
    let operation = SidecarLifecycleOperationRecordSchema.parse({
      sidecar_lifecycle_operation_version: 1,
      operation_id: operationId,
      operation_key_digest: operationKeyDigest(idempotencyKey),
      canonical_input_digest: inputDigest,
      package_id: packageId,
      component_id: componentId,
      kind,
      status: "running",
      prior_generation: priorGeneration,
      result_generation: null,
      completed_stages: ["requested"],
      error_code: null,
      started_at: this.now(),
      updated_at: this.now(),
      completed_at: null,
    });
    operation = await this.options.authorityStore.saveOperation(operation);
    try {
      return await mutation(operation);
    } catch (error) {
      await this.fail(operation, safeCode(error));
      throw error;
    }
  }

  private async revokeAndStop(operation: SidecarLifecycleOperationRecord, input: { packageId: string; componentId: string }, prior: SidecarAuthorityRecord): Promise<SidecarLifecycleOperationRecord> {
    if (!prior.runtime && prior.state !== "running") return operation;
    operation = await this.stage(operation, "revoking_authority");
    this.options.supervisor.bindingService.cleanup(input.packageId, input.componentId);
    await this.options.authorityStore.saveAuthority({ ...prior, runtime: null, authority_revoked_at: this.now(), updated_at: this.now() });
    operation = await this.stage(operation, "stopping");
    await this.options.supervisor.stop({ packageId: input.packageId, componentId: input.componentId, authority: { kind: "host" } }).catch(() => undefined);
    return operation;
  }

  private async stage(operation: SidecarLifecycleOperationRecord, stage: OperationStage): Promise<SidecarLifecycleOperationRecord> {
    if (operation.completed_stages.includes(stage)) return operation;
    return await this.options.authorityStore.saveOperation(SidecarLifecycleOperationRecordSchema.parse({ ...operation, completed_stages: [...operation.completed_stages, stage], updated_at: this.now() }));
  }

  private async complete(operation: SidecarLifecycleOperationRecord, record: SidecarAuthorityRecord | null): Promise<SidecarLifecycleOperationRecord> {
    const completedStages = operation.completed_stages.includes("completed") ? operation.completed_stages : [...operation.completed_stages, "completed" as const];
    const completed = SidecarLifecycleOperationRecordSchema.parse({
      ...operation,
      status: "committed",
      result_generation: record?.lifecycle_generation ?? null,
      completed_stages: completedStages,
      updated_at: this.now(),
      completed_at: this.now(),
    });
    this.audit("sidecar.lifecycle.operation", {
      package_id: completed.package_id,
      component_id: completed.component_id,
      kind: completed.kind,
      status: completed.status,
      error_code: null,
    });
    return await this.options.authorityStore.saveOperation(completed);
  }

  private async fail(operation: SidecarLifecycleOperationRecord, errorCode: string): Promise<void> {
    await this.options.authorityStore.saveOperation(SidecarLifecycleOperationRecordSchema.parse({
      ...operation,
      status: "failed",
      error_code: errorCode,
      updated_at: this.now(),
      completed_at: this.now(),
    })).catch(() => undefined);
  }

  private authorityRecord(
    packageRecord: InstalledPackageRecord,
    componentId: string,
    state: SidecarAuthorityState,
    health: SidecarAuthorityRecord["health"],
    runtime: SidecarAuthorityRecord["runtime"],
    lastKnownGood: string | null,
    lifecycleGeneration: number,
  ): SidecarAuthorityRecord {
    return SidecarAuthorityRecordSchema.parse({
      sidecar_authority_version: 1,
      package_id: packageRecord.package_id,
      component_id: componentId,
      installation_id: packageRecord.installation_id,
      package_digest: packageRecord.package_digest,
      package_generation: packageRecord.generation,
      lifecycle_generation: lifecycleGeneration,
      state,
      health,
      runtime,
      last_known_good_package_digest: lastKnownGood,
      authority_revoked_at: runtime ? null : this.now(),
      cleanup_due_at: null,
      updated_at: this.now(),
    });
  }

  private nextAuthority(
    prior: SidecarAuthorityRecord,
    packageRecord: InstalledPackageRecord,
    state: SidecarAuthorityState,
    health: SidecarAuthorityRecord["health"],
    runtime: SidecarAuthorityRecord["runtime"],
    lastKnownGood: string | null,
  ): SidecarAuthorityRecord {
    return this.authorityRecord(packageRecord, prior.component_id, state, health, runtime, lastKnownGood, prior.lifecycle_generation + 1);
  }

  private async requireAuthority(packageId: string, componentId: string): Promise<SidecarAuthorityRecord> {
    const record = await this.options.authorityStore.readAuthority(packageId, componentId);
    if (!record) throw new AppPlatformError("not_found_within_scope", "Sidecar lifecycle authority is unavailable", 404);
    return record;
  }

  private assertGeneration(record: SidecarAuthorityRecord, expectedGeneration?: number): void {
    if (expectedGeneration === undefined) return;
    if (record.lifecycle_generation !== expectedGeneration) throw new AppPlatformError("conflict", "Sidecar lifecycle generation is stale");
  }

  private assertManifestSidecar(manifest: PackageComponentManifest, componentId: string): void {
    PackageComponentManifestSchema.parse(manifest);
    if (!manifest.sidecars.some((sidecar) => sidecar.component_id === componentId)) {
      throw new AppPlatformError("not_found_within_scope", "Package does not declare the requested sidecar", 404);
    }
  }

  private assertHost(authority: SidecarOperationAuthority): void {
    if (authority.kind === "host") return;
    throw new AppPlatformError("denied", "Only Host authority may operate package sidecars", 403);
  }

  private now(): string {
    return this.clock().toISOString();
  }
}

export function safeSidecarOperation(operation: SidecarLifecycleOperationRecord): Record<string, unknown> {
  return {
    operation_id: operation.operation_id,
    kind: operation.kind,
    status: operation.status,
    completed_stages: operation.completed_stages,
    error_code: operation.error_code,
    started_at: operation.started_at,
    updated_at: operation.updated_at,
    completed_at: operation.completed_at,
  };
}

export function safeProjection(record: SidecarAuthorityRecord): Record<string, unknown> {
  return {
    projection_version: 1,
    package_id: record.package_id,
    component_id: record.component_id,
    installation_id: record.installation_id,
    package_digest: record.package_digest,
    package_generation: record.package_generation,
    lifecycle_generation: record.lifecycle_generation,
    state: record.state,
    health: record.health,
    runtime: record.runtime ? {
      runtime_id: record.runtime.runtime_id,
      binding_generation: record.runtime.binding_generation,
      endpoint_class: "private_authority_redacted",
    } : null,
    last_known_good_package_digest: record.last_known_good_package_digest,
    authority_revoked: record.authority_revoked_at !== null,
    cleanup_due_at: record.cleanup_due_at,
    safe_message: safeMessage(record),
    updated_at: record.updated_at,
  };
}

function stableInstallInput(input: InstallInput): unknown {
  return {
    kind: "install",
    package_id: input.manifest.package_id,
    package_digest: input.packageDigest,
    component_id: input.componentId,
  };
}

function stableActionInput(kind: SidecarLifecycleOperationRecord["kind"], input: PackageActionInput): unknown {
  return {
    kind,
    package_id: input.packageId,
    component_id: input.componentId,
    expected_generation: input.expectedGeneration ?? null,
    package_digest: "packageDigest" in input ? input.packageDigest : null,
  };
}

function runtimeIdentity(snapshot: SidecarLifecycleSnapshot): SidecarAuthorityRecord["runtime"] {
  if (!snapshot.binding) return null;
  return {
    runtime_id: snapshot.binding.runtime_id,
    binding_generation: snapshot.binding.binding_generation,
  };
}

function stateFromSnapshot(snapshot: SidecarLifecycleSnapshot): SidecarAuthorityState {
  if (snapshot.state === "running") return snapshot.health === "healthy" ? "running" : "unhealthy";
  if (snapshot.state === "unavailable") return "unavailable";
  if (snapshot.state === "failed") return "unhealthy";
  if (snapshot.state === "uninstalled") return "uninstalled";
  return "enabled";
}

function healthFromSnapshot(snapshot: SidecarLifecycleSnapshot): ComponentHealthState & ("unknown" | "healthy" | "unhealthy") {
  return snapshot.health;
}

function safeMessage(record: SidecarAuthorityRecord): string {
  if (record.state === "running" && record.health === "healthy") return "Sidecar is running.";
  if (record.state === "disabled") return "Sidecar is disabled.";
  if (record.state === "uninstalled") return "Sidecar runtime state has been removed.";
  if (record.state === "shutdown") return "Sidecar authority is revoked after shutdown.";
  if (record.state === "unsupported") return "Sidecar target is unsupported on this host.";
  if (record.state === "blocked") return "Sidecar is blocked by host policy.";
  if (record.state === "unavailable" || record.state === "unhealthy") return "Sidecar needs attention.";
  return "Sidecar is enabled.";
}

function safeCode(error: unknown): string {
  const raw = error instanceof AppPlatformError ? error.code : error instanceof Error ? error.message : "lifecycle_failed";
  return /^[a-z0-9_]{1,64}$/.test(raw) ? raw : "lifecycle_failed";
}

function operationKeyDigest(idempotencyKey: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(idempotencyKey).digest("hex")}`;
}

function safeFile(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function writeAtomic(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
