import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import { ZodError, type z } from "zod";
import { canonicalInputDigest } from "../contracts/common.js";
import { LifecycleOperationSchema, LifecycleRecordSchema, type LifecycleState } from "../contracts/lifecycle.js";
import type { AppRetentionClass } from "../contracts/app-registry.js";
import { CapabilityDiffSchema, CapabilityGrantSchema } from "../contracts/package.js";
import { RuntimeDescriptorSchema } from "../contracts/supervisor.js";
import { CapabilityTokenBroker } from "./capability-token.js";
import { AppPlatformError, asAppPlatformError } from "./errors.js";
import type { FixtureRepository } from "./fixture-repository.js";
import { deleteRetainedAppData, runRetainedAppDataOwnerAction, type AppDataLifecycleAdapter, type OwnerDataLifecycle } from "./owner-data.js";
import { manifestCapabilities, manifestDataCompatibility, PackageVerifier, type RuntimePackageManifest, type VerifiedPackage } from "./package-verifier.js";
import type { AppSupervisor, RuntimeIdentity, RuntimeLaunchDescriptor, StopReason } from "./process-supervisor.js";
import { AppLifecycleStore, type CapabilityGrant, type LifecycleOperation, type LifecycleRecord, type StoredPackage, type UninstallJournal } from "./store.js";
import { ImmutablePackageStore, type PromotableVerifiedPackage } from "./verified-package-store.js";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000002";

export type LifecycleDependencies = {
  appIdentity?: { appId: string; publisherId: string };
  store: AppLifecycleStore;
  verifier: PackageVerifier;
  repository: FixtureRepository;
  supervisor: AppSupervisor;
  tokenBroker: CapabilityTokenBroker;
  runtimeRoot: string;
  immutablePackages?: ImmutablePackageStore;
  ownerDataRoot: string;
  ownerDataLifecycle?: OwnerDataLifecycle;
  dataAdapter?: AppDataLifecycleAdapter;
  isMemoryMigrationInProgress?: () => boolean;
  runtimeTarget?: {
    target: "docker_linux_x64" | "desktop_windows_x64" | "desktop_macos_universal";
    runtimeKind: "container" | "packaged_node";
    transport: "container_internal" | "loopback";
  };
  audit?: (event: string, details: Record<string, unknown>) => void;
  ownerActorId?: string;
  beforeUninstallDelete?: (targetClass: "package_bytes" | "disposable_cache", targetPath: string) => Promise<void>;
};

export type LifecycleResponse = { record: LifecycleRecord; operation: LifecycleOperation; grant: CapabilityGrant | null };

type MutationBinding = {
  operationId?: string;
  ownerActorId?: string;
  installationId?: string | null;
  expectedGeneration?: number;
};
type InstallInput = MutationBinding & { version: string; idempotencyKey: string; approveCapabilities: boolean };
type SimpleInput = MutationBinding & { idempotencyKey: string };

export class AppLifecycleService {
  private readonly audit: NonNullable<LifecycleDependencies["audit"]>;
  readonly ownerActorId: string;
  readonly ownerId = OWNER_ID;
  readonly appId: string;
  readonly publisherId: string;

  constructor(public readonly dependencies: LifecycleDependencies) {
    this.audit = dependencies.audit ?? (() => undefined);
    this.ownerActorId = dependencies.ownerActorId ?? "owner";
    this.appId = dependencies.appIdentity?.appId ?? "ai.braindrive.resume-builder";
    this.publisherId = dependencies.appIdentity?.publisherId ?? "ai.braindrive";
    if (dependencies.store.appId !== this.appId) throw new AppPlatformError("descriptor_invalid", "Lifecycle store does not match the selected registered app");
  }

  async initialize(): Promise<void> {
    await this.dependencies.store.initialize();
    await this.dependencies.immutablePackages?.initialize();
    try {
      await this.migrateReferencedPackagesToImmutableStore();
      await this.reconcile();
    } catch (error) {
      if (!(await this.failClosedUnavailableStoredPackage(error))) throw error;
      await this.reconcile();
    }
  }

  status = (): Promise<LifecycleRecord> => this.dependencies.store.readLifecycle();

  async install(input: InstallInput): Promise<LifecycleResponse> {
    return this.installOrReinstall(input, "install");
  }

  async reinstall(input: InstallInput): Promise<LifecycleResponse> {
    return this.installOrReinstall(input, "reinstall");
  }

  private async installOrReinstall(input: InstallInput, kind: "install" | "reinstall"): Promise<LifecycleResponse> {
    return this.runLifecycleMutation(input.idempotencyKey, { kind, version: input.version, approve_capabilities: input.approveCapabilities, operation_id: input.operationId ?? null, expected_generation: input.expectedGeneration ?? null }, async () => {
      this.assertMemoryTransferIdle();
      const prior = await this.dependencies.store.readLifecycle();
      this.assertBinding(prior, input, true);
      await this.assertOperationIdentityAvailable(input.operationId, input.idempotencyKey);
      if (prior.state !== "not_installed") throw new AppPlatformError("invalid_state_transition", `Install is not allowed from ${prior.state}`);
      const installationId = randomUUID();
      let operation = this.newOperation(kind, prior, installationId, input.idempotencyKey, { version: input.version }, "active", "staged", input.operationId);
      await this.dependencies.store.saveOperation(operation);
      let verified: VerifiedPackage | null = null;
      let grant: CapabilityGrant | null = null;
      let runtime: RuntimeIdentity | null = null;
      try {
        operation = await this.stage(operation, "verifying_source");
        const packageRoot = path.join(this.dependencies.runtimeRoot, "staging", operation.operation_id);
        verified = await this.dependencies.verifier.verifyAndExtract(this.dependencies.repository, input.version, packageRoot, "candidate_install_or_update", { appId: this.appId, publisherId: this.publisherId });
        verified = await this.promoteVerifiedPackage(verified);
        operation = await this.stage(operation, "verifying_package");
        await this.ensureNotCancelled(operation);
        if (!input.approveCapabilities) throw new AppPlatformError("grant_approval_required", "Owner approval is required for the initial capability grant", 409);
        grant = this.createGrant(installationId, verified);
        await this.prepareOwnerData(grant, verified, kind);
        await this.dependencies.store.saveGrant(grant);
        await this.dependencies.store.savePackage(this.storedPackage(verified));
        operation = await this.stage(operation, "granting");
        const staged = LifecycleRecordSchema.parse({ ...prior, installation_id: installationId, state: "staged", generation: prior.generation + 1, active_package_digest: verified.packageDigest, grant_id: grant.grant_id, pending_operation_id: operation.operation_id, updated_at: new Date().toISOString() });
        await this.dependencies.store.compareAndSwapLifecycle(prior.generation, staged);
        operation = await this.stage(operation, "starting");
        const started = await this.dependencies.supervisor.start(this.runtimeDescriptor(staged, verified, grant));
        runtime = started.runtime;
        operation = await this.stage(operation, "awaiting_readiness");
        await this.dependencies.supervisor.awaitReadiness(runtime!);
        await this.ensureNotCancelled(operation);
        operation = await this.stage(operation, "switching_active_pointer");
        const active = LifecycleRecordSchema.parse({ ...staged, state: "active", generation: staged.generation + 1, pending_operation_id: null, successful_use_checkpoint: { checkpoint_version: 1, package_digest: verified.packageDigest, status: "pending", started_at: new Date().toISOString(), completed_at: null, evidence_operation_id: null }, updated_at: new Date().toISOString() });
        await this.dependencies.store.compareAndSwapLifecycle(staged.generation, active);
        operation = await this.complete(operation, active, "committed", false);
        this.emit("app.lifecycle.install.committed", prior, active, operation);
        return { record: active, operation, grant };
      } catch (error) {
        const failure = asAppPlatformError(error);
        if (runtime) await this.dependencies.supervisor.stop(runtime, "reconcile").catch(() => undefined);
        if (grant) { this.dependencies.tokenBroker.revokeInstallation(installationId); await this.dependencies.store.revokeGrant(grant.grant_id).catch(() => undefined); }
        const current = await this.dependencies.store.readLifecycle();
        if (current.state === "staged" && current.pending_operation_id === operation.operation_id) {
          const restored = LifecycleRecordSchema.parse({ ...prior, generation: current.generation + 1, updated_at: new Date().toISOString() });
          await this.dependencies.store.compareAndSwapLifecycle(current.generation, restored);
        }
        if (verified) await this.releaseVerifiedPackage(verified);
        await this.fail(operation, failure.code, prior.state === "not_installed" ? "remove_staging_and_restore_prior" : "none");
        this.emit("app.lifecycle.install.failed", prior, prior, operation, failure.code);
        throw failure;
      }
    });
  }

  async disable(input: SimpleInput): Promise<LifecycleResponse> {
    return this.runLifecycleMutation(input.idempotencyKey, { kind: "disable", operation_id: input.operationId ?? null, installation_id: input.installationId ?? null, expected_generation: input.expectedGeneration ?? null }, async () => {
      const prior = await this.requireState(["active"]);
      this.assertBinding(prior, input);
      await this.assertOperationIdentityAvailable(input.operationId, input.idempotencyKey);
      let operation = this.newOperation("disable", prior, prior.installation_id!, input.idempotencyKey, {}, "disabled", "disabled", input.operationId);
      await this.dependencies.store.saveOperation(operation);
      operation = await this.stage(operation, "revoking_tokens");
      this.dependencies.tokenBroker.revokeInstallation(prior.installation_id!);
      const grant = prior.grant_id ? await this.dependencies.store.bumpGrantRevocationGeneration(prior.grant_id) : null;
      operation = await this.stage(operation, "stopping");
      await this.stopInstallation(prior.installation_id!, "disable");
      const disabled = LifecycleRecordSchema.parse({ ...prior, state: "disabled", generation: prior.generation + 1, pending_operation_id: null, updated_at: new Date().toISOString() });
      await this.dependencies.store.compareAndSwapLifecycle(prior.generation, disabled);
      operation = await this.complete(operation, disabled, "committed", true);
      this.emit("app.lifecycle.disable.committed", prior, disabled, operation);
      return { record: disabled, operation, grant };
    });
  }

  async enable(input: SimpleInput): Promise<LifecycleResponse> {
    return this.runLifecycleMutation(input.idempotencyKey, { kind: "enable", operation_id: input.operationId ?? null, installation_id: input.installationId ?? null, expected_generation: input.expectedGeneration ?? null }, async () => {
      this.assertMemoryTransferIdle();
      const prior = await this.requireState(["disabled"]);
      this.assertBinding(prior, input);
      await this.assertOperationIdentityAvailable(input.operationId, input.idempotencyKey);
      let operation = this.newOperation("enable", prior, prior.installation_id!, input.idempotencyKey, {}, "active", "active", input.operationId);
      await this.dependencies.store.saveOperation(operation);
      const stored = await this.requireStoredPackage(prior.active_package_digest!);
      const grant = await this.requireGrant(prior.grant_id!);
      operation = await this.stage(operation, "verifying_package");
      const verified = await this.verifyStoredPackage(stored);
      try {
        await this.prepareOwnerData(grant, verified, "enable");
      } catch (error) {
        const failure = asAppPlatformError(error);
        await this.fail(operation, failure.code, "none");
        throw failure;
      }
      this.dependencies.tokenBroker.permitInstallation(prior.installation_id!);
      operation = await this.stage(operation, "starting");
      const started = await this.dependencies.supervisor.start(this.runtimeDescriptor(prior, verified, grant));
      operation = await this.stage(operation, "awaiting_readiness");
      await this.dependencies.supervisor.awaitReadiness(started.runtime!);
      const active = LifecycleRecordSchema.parse({ ...prior, state: "active", generation: prior.generation + 1, updated_at: new Date().toISOString() });
      await this.dependencies.store.compareAndSwapLifecycle(prior.generation, active);
      operation = await this.complete(operation, active, "committed", false);
      this.emit("app.lifecycle.enable.committed", prior, active, operation);
      return { record: active, operation, grant };
    });
  }

  async update(input: InstallInput): Promise<LifecycleResponse> {
    return this.runLifecycleMutation(input.idempotencyKey, { kind: "update", version: input.version, approve_capabilities: input.approveCapabilities, operation_id: input.operationId ?? null, installation_id: input.installationId ?? null, expected_generation: input.expectedGeneration ?? null }, async () => {
      this.assertMemoryTransferIdle();
      const prior = await this.requireState(["active", "disabled", "failed_recoverable"]);
      this.assertBinding(prior, input);
      await this.assertOperationIdentityAvailable(input.operationId, input.idempotencyKey);
      const targetState = prior.state === "disabled" ? "disabled" : "active";
      let operation = this.newOperation("update", prior, prior.installation_id!, input.idempotencyKey, { version: input.version }, targetState, "updating", input.operationId);
      await this.dependencies.store.saveOperation(operation);
      let candidate: VerifiedPackage | null = null;
      let candidateGrant: CapabilityGrant | null = null;
      try {
        const candidateRoot = path.join(this.dependencies.runtimeRoot, "staging", operation.operation_id);
        operation = await this.stage(operation, "verifying_package");
        candidate = await this.dependencies.verifier.verifyAndExtract(this.dependencies.repository, input.version, candidateRoot, "candidate_install_or_update", { appId: this.appId, publisherId: this.publisherId });
        const priorPackage = await this.requireStoredPackage(prior.active_package_digest!);
        if (comparePackageVersion(candidate.manifest.package_version, priorPackage.package_version) <= 0) {
          throw new AppPlatformError("conflict", "Update version must be newer than the active version", 409);
        }
        candidate = await this.promoteVerifiedPackage(candidate);
        const priorGrant = await this.requireGrant(prior.grant_id!);
        const diff = capabilityDiff(priorGrant.capabilities, manifestCapabilities(candidate.manifest));
        if (diff.decision === "owner_approval_required" && !input.approveCapabilities) throw new AppPlatformError("grant_widening_approval_required", "Update requests additional capabilities");
        candidateGrant = this.createGrant(prior.installation_id!, candidate);
        await this.prepareOwnerData(candidateGrant, candidate, "update");
        await this.dependencies.store.saveGrant(candidateGrant);
        await this.dependencies.store.savePackage(this.storedPackage(candidate));
        const updating = LifecycleRecordSchema.parse({ ...prior, state: "updating", generation: prior.generation + 1, pending_operation_id: operation.operation_id, updated_at: new Date().toISOString() });
        await this.dependencies.store.compareAndSwapLifecycle(prior.generation, updating);
        await this.ensureNotCancelled(operation);
        if (prior.state !== "disabled") {
          operation = await this.stage(operation, "revoking_tokens");
          this.dependencies.tokenBroker.revokeInstallation(prior.installation_id!);
          await this.stopInstallation(prior.installation_id!, "update");
          operation = await this.stage(operation, "starting");
          const started = await this.dependencies.supervisor.start(this.runtimeDescriptor(updating, candidate, candidateGrant));
          operation = await this.stage(operation, "awaiting_readiness");
          await this.dependencies.supervisor.awaitReadiness(started.runtime!);
        }
        await this.ensureNotCancelled(operation);
        operation = await this.stage(operation, "switching_active_pointer");
        const next = LifecycleRecordSchema.parse({ ...updating, state: targetState, generation: updating.generation + 1, active_package_digest: candidate.packageDigest, last_known_good_package_digest: prior.active_package_digest, grant_id: candidateGrant.grant_id, pending_operation_id: null, successful_use_checkpoint: { checkpoint_version: 1, package_digest: candidate.packageDigest, status: "pending", started_at: new Date().toISOString(), completed_at: null, evidence_operation_id: null }, updated_at: new Date().toISOString() });
        await this.dependencies.store.compareAndSwapLifecycle(updating.generation, next);
        this.dependencies.tokenBroker.permitInstallation(prior.installation_id!);
        await this.dependencies.store.revokeGrant(prior.grant_id!);
        operation = await this.complete(operation, next, "committed", targetState === "disabled");
        this.emit("app.lifecycle.update.committed", prior, next, operation);
        return { record: next, operation, grant: candidateGrant };
      } catch (error) {
        const failure = asAppPlatformError(error);
        const current = await this.dependencies.store.readLifecycle();
        if (current.state === "updating" && current.pending_operation_id === operation.operation_id) {
          if (candidate) await this.stopInstallation(prior.installation_id!, "reconcile").catch(() => undefined);
          if (prior.state === "active") await this.restartPrior(prior);
          const restored = LifecycleRecordSchema.parse({ ...prior, generation: current.generation + 1, updated_at: new Date().toISOString() });
          await this.dependencies.store.compareAndSwapLifecycle(current.generation, restored);
          if (prior.state !== "failed_recoverable") this.dependencies.tokenBroker.permitInstallation(prior.installation_id!);
        }
        if (candidateGrant) await this.dependencies.store.revokeGrant(candidateGrant.grant_id).catch(() => undefined);
        if (candidate) await this.releaseVerifiedPackage(candidate);
        await this.fail(operation, failure.code, "stop_candidate_and_restore_prior");
        this.emit("app.lifecycle.update.failed", prior, prior, operation, failure.code);
        throw failure;
      }
    });
  }

  async rollback(input: SimpleInput): Promise<LifecycleResponse> {
    return this.runLifecycleMutation(input.idempotencyKey, { kind: "rollback", operation_id: input.operationId ?? null, installation_id: input.installationId ?? null, expected_generation: input.expectedGeneration ?? null }, async () => {
      this.assertMemoryTransferIdle();
      const prior = await this.requireState(["active", "disabled"]);
      this.assertBinding(prior, input);
      await this.assertOperationIdentityAvailable(input.operationId, input.idempotencyKey);
      if (!prior.last_known_good_package_digest) throw new AppPlatformError("rollback_unavailable", "No last-known-good package is retained");
      let operation = this.newOperation("rollback", prior, prior.installation_id!, input.idempotencyKey, {}, prior.state, "rollback_pending", input.operationId);
      await this.dependencies.store.saveOperation(operation);
      const stored = await this.requireStoredPackage(prior.last_known_good_package_digest);
      const verified = await this.verifyStoredPackage(stored);
      const grant = this.createGrant(prior.installation_id!, verified);
      try {
        await this.prepareOwnerData(grant, verified, "rollback");
      } catch (error) {
        const failure = asAppPlatformError(error);
        await this.fail(operation, failure.code, "none");
        throw failure;
      }
      await this.dependencies.store.saveGrant(grant);
      const pending = LifecycleRecordSchema.parse({ ...prior, state: "rollback_pending", generation: prior.generation + 1, pending_operation_id: operation.operation_id, updated_at: new Date().toISOString() });
      await this.dependencies.store.compareAndSwapLifecycle(prior.generation, pending);
      if (prior.state === "active") {
        this.dependencies.tokenBroker.revokeInstallation(prior.installation_id!);
        await this.stopInstallation(prior.installation_id!, "rollback");
        const started = await this.dependencies.supervisor.start(this.runtimeDescriptor(pending, verified, grant));
        await this.dependencies.supervisor.awaitReadiness(started.runtime!);
      }
      operation = await this.stage(operation, "switching_active_pointer");
      const next = LifecycleRecordSchema.parse({ ...pending, state: prior.state, generation: pending.generation + 1, active_package_digest: prior.last_known_good_package_digest, last_known_good_package_digest: prior.active_package_digest, grant_id: grant.grant_id, pending_operation_id: null, successful_use_checkpoint: { checkpoint_version: 1, package_digest: prior.last_known_good_package_digest, status: "pending", started_at: new Date().toISOString(), completed_at: null, evidence_operation_id: null }, updated_at: new Date().toISOString() });
      await this.dependencies.store.compareAndSwapLifecycle(pending.generation, next);
      this.dependencies.tokenBroker.permitInstallation(prior.installation_id!);
      await this.dependencies.store.revokeGrant(prior.grant_id!);
      operation = await this.complete(operation, next, "committed", prior.state === "disabled");
      this.emit("app.lifecycle.rollback.committed", prior, next, operation);
      return { record: next, operation, grant };
    });
  }

  async uninstall(input: SimpleInput): Promise<LifecycleResponse> {
    return this.runLifecycleMutation(input.idempotencyKey, { kind: "uninstall", operation_id: input.operationId ?? null, installation_id: input.installationId ?? null, expected_generation: input.expectedGeneration ?? null }, async () => {
      this.assertMemoryTransferIdle();
      const prior = await this.dependencies.store.readLifecycle();
      if (prior.state === "not_installed") {
        const existing = (await this.dependencies.store.listOperations()).reverse().find((candidate) => candidate.kind === "uninstall" && candidate.status === "committed");
        if (!existing || (input.installationId && existing.installation_id !== input.installationId)) throw new AppPlatformError("invalid_state_transition", "The selected app is not installed");
        return { record: prior, operation: existing, grant: null };
      }
      if (prior.state === "uninstalling" && prior.pending_operation_id) {
        const pending = await this.dependencies.store.readOperation(prior.pending_operation_id);
        if (!pending || pending.kind !== "uninstall") throw new AppPlatformError("store_corrupt", "Uninstall recovery operation is missing");
        this.assertBinding(prior, input, false, pending.installation_id);
        return this.finishUninstall(prior, pending);
      }
      if (!["active", "disabled", "quarantined", "failed_recoverable"].includes(prior.state)) throw new AppPlatformError("invalid_state_transition", `Operation is not allowed from ${prior.state}`);
      this.assertBinding(prior, input);
      await this.assertOperationIdentityAvailable(input.operationId, input.idempotencyKey);
      const operation = this.newOperation("uninstall", prior, prior.installation_id!, input.idempotencyKey, {}, "not_installed", "uninstalling", input.operationId);
      await this.dependencies.store.saveOperation(operation);
      const uninstalling = LifecycleRecordSchema.parse({ ...prior, state: "uninstalling", generation: prior.generation + 1, pending_operation_id: operation.operation_id, updated_at: new Date().toISOString() });
      await this.dependencies.store.compareAndSwapLifecycle(prior.generation, uninstalling);
      return this.finishUninstall(uninstalling, operation);
    });
  }

  async deleteRetainedData(input: {
    operationId: string;
    idempotencyKey: string;
    ownerActorId: string;
    confirmAppId: string;
    trustedOwnerConfirmation: boolean;
  }) {
    const adapter = this.dependencies.dataAdapter;
    if (!adapter) throw new AppPlatformError("invalid_state_transition", "The selected app has no reviewed retained-data deletion adapter");
    return deleteRetainedAppData({
      store: this.dependencies.store,
      adapter,
      appId: this.appId,
      ownerId: this.ownerId,
      ownerActorId: this.ownerActorId,
      expectedDataRoot: this.dependencies.ownerDataRoot,
      request: input,
    });
  }

  async exportRetainedData(input: {
    operationId: string;
    idempotencyKey: string;
    ownerActorId: string;
    confirmAppId: string;
    trustedOwnerConfirmation: boolean;
  }) {
    return this.retainedDataOwnerAction("export", input);
  }

  async archiveRetainedData(input: {
    operationId: string;
    idempotencyKey: string;
    ownerActorId: string;
    confirmAppId: string;
    trustedOwnerConfirmation: boolean;
  }) {
    return this.retainedDataOwnerAction("archive", input);
  }

  private async retainedDataOwnerAction(action: "export" | "archive", input: {
    operationId: string;
    idempotencyKey: string;
    ownerActorId: string;
    confirmAppId: string;
    trustedOwnerConfirmation: boolean;
  }) {
    const adapter = this.dependencies.dataAdapter;
    if (!adapter) throw new AppPlatformError("invalid_state_transition", `The selected app has no reviewed retained-data ${action} adapter`);
    return runRetainedAppDataOwnerAction({
      store: this.dependencies.store,
      adapter,
      appId: this.appId,
      ownerId: this.ownerId,
      ownerActorId: this.ownerActorId,
      expectedDataRoot: this.dependencies.ownerDataRoot,
      action,
      request: input,
    });
  }

  async recover(input: SimpleInput): Promise<LifecycleResponse> {
    return this.runLifecycleMutation(input.idempotencyKey, { kind: "recover", operation_id: input.operationId ?? null, installation_id: input.installationId ?? null, expected_generation: input.expectedGeneration ?? null }, async () => {
      this.assertMemoryTransferIdle();
      const prior = await this.requireState(["failed_recoverable"]);
      this.assertBinding(prior, input);
      await this.assertOperationIdentityAvailable(input.operationId, input.idempotencyKey);
      if (!prior.active_package_digest || !prior.grant_id || !prior.installation_id) throw new AppPlatformError("invalid_state_transition", "Recovery requires retained verified package authority");
      let operation = this.newOperation("recover", prior, prior.installation_id, input.idempotencyKey, {}, "active", "active", input.operationId);
      await this.dependencies.store.saveOperation(operation);
      let replacementGrant: CapabilityGrant | null = null;
      try {
        operation = await this.stage(operation, "verifying_package");
        const stored = await this.requireStoredPackage(prior.active_package_digest);
        const verified = await this.verifyStoredPackage(stored);
        const priorGrant = await this.requireGrant(prior.grant_id);
        const grant = priorGrant.revoked_at ? this.createGrant(prior.installation_id, verified) : priorGrant;
        if (priorGrant.revoked_at) {
          replacementGrant = grant;
          await this.dependencies.store.saveGrant(grant);
        }
        await this.prepareOwnerData(grant, verified, "enable");
        operation = await this.stage(operation, "starting");
        const started = await this.dependencies.supervisor.start(this.runtimeDescriptor(prior, verified, grant));
        operation = await this.stage(operation, "awaiting_readiness");
        await this.dependencies.supervisor.awaitReadiness(started.runtime!);
        this.dependencies.tokenBroker.permitInstallation(prior.installation_id);
        const active = LifecycleRecordSchema.parse({ ...prior, grant_id: grant.grant_id, state: "active", generation: prior.generation + 1, pending_operation_id: null, successful_use_checkpoint: { checkpoint_version: 1, package_digest: verified.packageDigest, status: "pending", started_at: new Date().toISOString(), completed_at: null, evidence_operation_id: null }, updated_at: new Date().toISOString() });
        await this.dependencies.store.compareAndSwapLifecycle(prior.generation, active);
        operation = await this.complete(operation, active, "committed", false);
        this.emit("app.lifecycle.recover.committed", prior, active, operation);
        return { record: active, operation, grant: await this.requireGrant(active.grant_id!) };
      } catch (error) {
        const failure = asAppPlatformError(error);
        if (replacementGrant) await this.dependencies.store.revokeGrant(replacementGrant.grant_id).catch(() => undefined);
        await this.fail(operation, failure.code, "reconcile_committed_pointer");
        throw failure;
      }
    });
  }

  async enforceRevocations(): Promise<LifecycleRecord> {
    const prior = await this.dependencies.store.readLifecycle();
    if (!["active", "disabled"].includes(prior.state)) return prior;
    const stored = await this.requireStoredPackage(prior.active_package_digest!);
    try {
      await this.verifyStoredPackage(stored);
      return prior;
    } catch (error) {
      if (!(error instanceof AppPlatformError) || error.code !== "package_revoked") throw error;
    }
    let operation = this.newOperation("quarantine", prior, prior.installation_id!, `revocation-${randomUUID()}`, { package_digest: prior.active_package_digest }, "quarantined", "quarantined");
    await this.dependencies.store.saveOperation(operation);
    operation = await this.stage(operation, "revoking_tokens");
    this.dependencies.tokenBroker.revokeInstallation(prior.installation_id!);
    if (prior.grant_id) await this.dependencies.store.revokeGrant(prior.grant_id);
    await this.stopInstallation(prior.installation_id!, "revocation");
    const quarantined = LifecycleRecordSchema.parse({ ...prior, state: "quarantined", generation: prior.generation + 1, pending_operation_id: null, updated_at: new Date().toISOString() });
    await this.dependencies.store.compareAndSwapLifecycle(prior.generation, quarantined);
    operation = await this.complete(operation, quarantined, "committed", true);
    this.emit("revocation_enforced", prior, quarantined, operation, "package_revoked");
    return quarantined;
  }

  async cancel(operationId: string): Promise<LifecycleOperation> {
    const operation = await this.dependencies.store.readOperation(operationId);
    if (!operation) throw new AppPlatformError("operation_not_found", "Lifecycle operation was not found", 404);
    if (operation.status === "committed") {
      const recovered = LifecycleOperationSchema.parse({ ...operation, commit_outcome: "committed_response_recovered", updated_at: new Date().toISOString() });
      await this.dependencies.store.saveOperation(recovered);
      return recovered;
    }
    if (["failed", "cancelled_before_commit"].includes(operation.status)) return operation;
    const cancelled = LifecycleOperationSchema.parse({ ...operation, status: "cancel_requested", updated_at: new Date().toISOString() });
    await this.dependencies.store.saveOperation(cancelled);
    return cancelled;
  }

  async issueSession(input: { audience: "app_data" | "app_inference" | "app_export" | "app_bridge"; capabilities: CapabilityGrant["capabilities"]; operationId: string; idempotencyKey?: string; viewId?: string; connectionId?: string }): Promise<ReturnType<CapabilityTokenBroker["issue"]>> {
    const record = await this.requireState(["active"]);
    const grant = await this.requireGrant(record.grant_id!);
    return this.dependencies.tokenBroker.issue({ grant, audience: input.audience, capabilities: input.capabilities, connectionId: input.connectionId ?? randomUUID(), operationId: input.operationId, idempotencyKey: input.idempotencyKey ?? `capability-${input.operationId}`, tokenGeneration: Math.max(1, record.generation), viewId: input.viewId, ttlMs: 5 * 60_000 });
  }

  async ownerDescriptor(): Promise<{ record: LifecycleRecord; grant: CapabilityGrant | null; packageVersion: string | null; storedPackage: StoredPackage | null }> {
    let record = await this.dependencies.store.readLifecycle();
    let grant = record.grant_id ? await this.dependencies.store.readGrant(record.grant_id) : null;
    let stored: StoredPackage | null = null;
    if (record.active_package_digest) {
      try {
        stored = await this.dependencies.store.readPackage(record.active_package_digest);
      } catch (error) {
        const errorCode = storedPackageAvailabilityErrorCode(error);
        if (!errorCode) throw error;
        if (await this.failClosedUnavailableStoredPackage(error, record)) {
          record = await this.dependencies.store.readLifecycle();
          grant = record.grant_id ? await this.dependencies.store.readGrant(record.grant_id) : null;
        }
        this.audit("app.lifecycle.stored_package_descriptor_unavailable", {
          app_id: this.appId,
          installation_id: record.installation_id,
          package_digest: record.active_package_digest,
          lifecycle_state: record.state,
          error_code: errorCode,
        });
      }
    }
    return { record, grant, packageVersion: stored?.package_version ?? null, storedPackage: stored };
  }

  private async failClosedUnavailableStoredPackage(error: unknown, knownRecord?: LifecycleRecord): Promise<boolean> {
    const errorCode = storedPackageAvailabilityErrorCode(error);
    if (!errorCode) return false;
    const prior = knownRecord ?? await this.dependencies.store.readLifecycle();
    if (!prior.installation_id || !["active", "disabled", "failed_recoverable"].includes(prior.state)) return false;

    this.dependencies.tokenBroker.revokeInstallation(prior.installation_id);
    if (prior.grant_id) await this.dependencies.store.revokeGrant(prior.grant_id).catch(() => undefined);
    await this.stopInstallation(prior.installation_id, "reconcile").catch(() => undefined);

    if (prior.state === "failed_recoverable") {
      this.audit("app.lifecycle.stored_package_recovery_preserved", {
        app_id: this.appId,
        installation_id: prior.installation_id,
        package_digest: prior.active_package_digest,
        error_code: errorCode,
      });
      return true;
    }

    let operation = this.newOperation("reconcile", prior, prior.installation_id, `stored-package-recovery-${randomUUID()}`, { stored_package_unavailable: true, error_code: errorCode }, "failed_recoverable", "failed_recoverable");
    await this.dependencies.store.saveOperation(operation);
    operation = await this.stage(operation, "removing_runtime_authority");
    const now = new Date().toISOString();
    const checkpoint = prior.successful_use_checkpoint?.status === "pending"
      ? { ...prior.successful_use_checkpoint, status: "failed" as const, completed_at: now, evidence_operation_id: null }
      : prior.successful_use_checkpoint;
    const next = LifecycleRecordSchema.parse({ ...prior, state: "failed_recoverable", generation: prior.generation + 1, pending_operation_id: null, successful_use_checkpoint: checkpoint, updated_at: now });
    await this.dependencies.store.compareAndSwapLifecycle(prior.generation, next);
    operation = await this.complete(operation, next, "committed", true);
    this.emit("app.lifecycle.reconcile.failed_recoverable", prior, next, operation, errorCode);
    return true;
  }

  private async reconcile(): Promise<void> {
    let record = await this.dependencies.store.readLifecycle();
    if (record.state === "uninstalling" && record.pending_operation_id) {
      const operation = await this.dependencies.store.readOperation(record.pending_operation_id);
      if (!operation || operation.kind !== "uninstall") throw new AppPlatformError("store_corrupt", "Pending uninstall operation is unavailable");
      const resumed = await this.finishUninstall(record, operation);
      record = resumed.record;
    } else if (["staged", "updating", "rollback_pending"].includes(record.state)) {
      const operation = record.pending_operation_id ? await this.dependencies.store.readOperation(record.pending_operation_id) : null;
      const priorState = operation?.prior_state ?? "failed_recoverable";
      const safeState: LifecycleState = record.state === "staged" ? "not_installed" : priorState === "active" ? "active" : priorState === "disabled" ? "disabled" : "failed_recoverable";
      const next = safeState === "not_installed"
        ? LifecycleRecordSchema.parse({ lifecycle_schema_version: 1, app_id: this.appId, installation_id: null, state: "not_installed", generation: record.generation + 1, active_package_digest: null, last_known_good_package_digest: null, grant_id: null, pending_operation_id: null, successful_use_checkpoint: null, updated_at: new Date().toISOString() })
        : LifecycleRecordSchema.parse({ ...record, state: safeState, generation: record.generation + 1, pending_operation_id: null, updated_at: new Date().toISOString() });
      await this.dependencies.store.compareAndSwapLifecycle(record.generation, next);
      record = next;
    }
    if (record.state === "active") {
      if (this.dependencies.supervisor.inspect(record.installation_id!).length === 0) await this.restartPrior(record);
    } else if (record.installation_id) {
      await this.stopInstallation(record.installation_id, "reconcile");
      this.dependencies.tokenBroker.revokeInstallation(record.installation_id);
    }
  }

  private async restartPrior(record: LifecycleRecord): Promise<LifecycleRecord> {
    const stored = await this.requireStoredPackage(record.active_package_digest!);
    let grant = await this.requireGrant(record.grant_id!);
    const verified = await this.verifyStoredPackage(stored);
    if (grant.revoked_at) {
      grant = this.createGrant(record.installation_id!, verified);
      await this.dependencies.store.saveGrant(grant);
      const latest = await this.dependencies.store.readLifecycle();
      if (latest.state === record.state && latest.generation === record.generation && latest.grant_id === record.grant_id) {
        const repaired = LifecycleRecordSchema.parse({ ...latest, grant_id: grant.grant_id, generation: latest.generation + 1, updated_at: new Date().toISOString() });
        await this.dependencies.store.compareAndSwapLifecycle(latest.generation, repaired);
        record = repaired;
      }
    }
    await this.prepareOwnerData(grant, verified, "enable");
    const started = await this.dependencies.supervisor.start(this.runtimeDescriptor(record, verified, grant));
    await this.dependencies.supervisor.awaitReadiness(started.runtime!);
    this.dependencies.tokenBroker.permitInstallation(record.installation_id!);
    return record;
  }

  private async stopInstallation(installationId: string, reason: StopReason): Promise<void> {
    for (const runtime of this.dependencies.supervisor.inspect(installationId)) await this.dependencies.supervisor.stop(runtime, reason);
  }

  private async finishUninstall(record: LifecycleRecord, initialOperation: LifecycleOperation): Promise<LifecycleResponse> {
    const installationId = record.installation_id ?? initialOperation.installation_id;
    let operation = initialOperation;
    let journal = await this.dependencies.store.readUninstallJournal(operation.operation_id);

    if (!journal || journal.stage === "authority_removed") {
      operation = await this.stage(operation, "stopping");
      await this.stopInstallation(installationId, "uninstall");
      this.dependencies.tokenBroker.revokeInstallation(installationId);

      operation = await this.stage(operation, "revoking_tokens");
      if (record.grant_id) await this.dependencies.store.revokeGrant(record.grant_id);
      await this.dependencies.ownerDataLifecycle?.cleanupDefaultUninstall();

      if (!journal) {
        const digests = [record.active_package_digest, record.last_known_good_package_digest].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
        const packages = await Promise.all(digests.map((digest) => this.dependencies.store.readPackage(digest)));
        journal = {
          journal_version: 1,
          operation_id: operation.operation_id,
          installation_id: installationId,
          grant_id: record.grant_id,
          package_digests: digests,
          package_roots: packages.map((stored) => stored?.package_root ?? null),
          stage: "authority_removed",
          owner_data_preserved: true,
          removed_classes: ["runtime_registration", "capability_grant"],
          retained_classes: uninstallRetainedClasses(packages.map((stored) => stored?.manifest ?? null)),
          updated_at: new Date().toISOString(),
        };
        await this.dependencies.store.saveUninstallJournal(journal);
      }
    }

    let current = await this.dependencies.store.readLifecycle();
    if (journal.stage === "authority_removed") {
      operation = await this.stage(operation, "clearing_references");
      const cleared = LifecycleRecordSchema.parse({ ...current, installation_id: installationId, state: "uninstalling", generation: current.generation + 1, active_package_digest: null, last_known_good_package_digest: null, grant_id: null, successful_use_checkpoint: null, pending_operation_id: operation.operation_id, updated_at: new Date().toISOString() });
      await this.dependencies.store.compareAndSwapLifecycle(current.generation, cleared);
      current = cleared;
      journal = { ...journal, stage: "references_cleared", removed_classes: [...new Set([...journal.removed_classes, "package_reference"])] as UninstallJournal["removed_classes"], updated_at: new Date().toISOString() };
      await this.dependencies.store.saveUninstallJournal(journal);
    }

    if (journal.stage === "references_cleared") {
      operation = await this.stage(operation, "removing_package_bytes");
      const allPackages = await this.dependencies.store.listPackages();
      for (let index = 0; index < journal.package_digests.length; index += 1) {
        const packageDigest = journal.package_digests[index];
        const packageRoot = journal.package_roots[index] ?? null;
        const stored = allPackages.find((candidate) => candidate.package_digest === packageDigest) ?? null;
        if (this.dependencies.immutablePackages && stored?.package_reference_id) {
          await this.dependencies.immutablePackages.release(packageDigest, stored.package_reference_id);
          await this.dependencies.immutablePackages.removeIfUnreferenced(packageDigest);
        } else {
          const shared = packageRoot !== null && allPackages.some((candidate) => candidate.package_digest !== packageDigest && path.resolve(candidate.package_root) === path.resolve(packageRoot));
          if (packageRoot !== null && !shared) await this.removeValidatedRuntimeRoot(packageRoot, "package_bytes");
        }
        await this.dependencies.store.removePackage(packageDigest);
      }
      if (journal.grant_id) await this.dependencies.store.removeGrant(journal.grant_id);

      operation = await this.stage(operation, "removing_disposable_cache");
      for (const disposable of [path.join(this.dependencies.runtimeRoot, "cache", installationId), path.join(this.dependencies.runtimeRoot, "instances", installationId)]) {
        await this.removeValidatedRuntimeRoot(disposable, "disposable_cache");
      }
      journal = { ...journal, package_roots: [], stage: "bytes_removed", removed_classes: [...new Set([...journal.removed_classes, "package_bytes", "disposable_cache"])] as UninstallJournal["removed_classes"], updated_at: new Date().toISOString() };
      await this.dependencies.store.saveUninstallJournal(journal);
    }

    current = await this.dependencies.store.readLifecycle();
    if (current.state !== "not_installed") {
      operation = await this.stage(operation, "recording_tombstone");
      const removed = LifecycleRecordSchema.parse({ lifecycle_schema_version: 1, app_id: this.appId, installation_id: null, state: "not_installed", generation: current.generation + 1, active_package_digest: null, last_known_good_package_digest: null, grant_id: null, pending_operation_id: null, successful_use_checkpoint: null, updated_at: new Date().toISOString() });
      await this.dependencies.store.compareAndSwapLifecycle(current.generation, removed);
      operation = await this.complete(operation, removed, "committed", true);
      journal = { ...journal, package_roots: [], stage: "committed", updated_at: new Date().toISOString() };
      await this.dependencies.store.saveUninstallJournal(journal);
      this.audit("app.lifecycle.uninstall_summary", { owner_id: operation.owner_id, actor_id: operation.actor_id, app_id: removed.app_id, installation_id: installationId, operation_id: operation.operation_id, prior_state: operation.prior_state, result_state: removed.state, removed_classes: journal.removed_classes, removed_item_count: journal.removed_classes.length, retained_classes: journal.retained_classes, owner_data_preserved: true, outcome: "committed" });
      this.emit("app.lifecycle.uninstall.committed", record, removed, operation);
      return { record: removed, operation, grant: null };
    }
    return { record: current, operation, grant: null };
  }

  private async removeValidatedRuntimeRoot(targetPath: string, targetClass: "package_bytes" | "disposable_cache"): Promise<void> {
    const root = path.resolve(this.dependencies.runtimeRoot);
    const target = path.resolve(targetPath);
    if (target === root || !target.startsWith(`${root}${path.sep}`)) throw new AppPlatformError("denied", "Lifecycle cleanup target is outside the app runtime root", 403);
    await this.dependencies.beforeUninstallDelete?.(targetClass, target);
    await rm(target, { recursive: true, force: true });
  }

  private assertMemoryTransferIdle(): void {
    if (this.dependencies.isMemoryMigrationInProgress?.()) {
      throw new AppPlatformError("invalid_state_transition", "Memory transfer must finish before changing the selected app lifecycle state", 409);
    }
  }

  private assertBinding(record: LifecycleRecord, input: MutationBinding, installing = false, installationOverride?: string): void {
    if (input.ownerActorId !== undefined && input.ownerActorId !== this.ownerActorId) {
      throw new AppPlatformError("denied", "Lifecycle operation is not authorized for this owner", 403);
    }
    if (input.expectedGeneration !== undefined && input.expectedGeneration !== record.generation) {
      throw new AppPlatformError("conflict", "Lifecycle state changed; refresh before retrying", 409);
    }
    const authoritativeInstallation = installationOverride ?? record.installation_id;
    if (installing) {
      if (input.installationId !== undefined && input.installationId !== null) throw new AppPlatformError("denied", "Install cannot target an existing installation", 403);
      return;
    }
    if (input.installationId !== undefined && input.installationId !== authoritativeInstallation) {
      throw new AppPlatformError("denied", "Lifecycle operation targets a different installation", 403);
    }
  }

  private async assertOperationIdentityAvailable(operationId: string | undefined, idempotencyKey: string): Promise<void> {
    if (!operationId) return;
    const existing = await this.dependencies.store.readOperation(operationId);
    if (existing && existing.idempotency_key !== idempotencyKey) throw new AppPlatformError("idempotency_conflict", "Operation identity was already used with different input", 409);
  }

  private async prepareOwnerData(
    grant: CapabilityGrant,
    verified: VerifiedPackage,
    reason: "install" | "enable" | "update" | "rollback" | "reinstall",
  ): Promise<void> {
    if (!this.dependencies.ownerDataLifecycle) return;
    try {
      await this.dependencies.ownerDataLifecycle.prepareActivation({
        ownerId: grant.owner_id,
        installationId: grant.installation_id,
        packageDigest: verified.packageDigest,
        compatibility: manifestDataCompatibility(verified.manifest),
        reason,
      });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === "incompatible_schema") {
        throw new AppPlatformError("incompatible_schema", "Retained app data requires a compatible app version", 409);
      }
      if (code === "denied") throw new AppPlatformError("denied", "Retained app data belongs to a different owner", 403);
      if (code === "validation_failed") throw new AppPlatformError("validation_failed", "Retained app data failed integrity validation", 409);
      if (code === "recoverable_internal_failure") {
        throw new AppPlatformError("recoverable_internal_failure", "Retained app data could not be prepared safely", 500);
      }
      throw error;
    }
  }

  private promotablePackage(verified: VerifiedPackage): PromotableVerifiedPackage {
    const artifact = verified.manifest.platform_artifacts.find((candidate) => candidate.target === verified.target);
    if (!artifact) throw new AppPlatformError("host_incompatible", "Verified package target is missing its entrypoint");
    return {
      manifest: verified.manifest,
      packageDigest: verified.packageDigest,
      descriptorDigest: verified.trust.descriptor_digest as `sha256:${string}`,
      stageRoot: verified.packageRoot,
      entrypoint: artifact.entrypoint,
      target: verified.target,
    };
  }

  private async promoteVerifiedPackage(verified: VerifiedPackage, referenceId: string = randomUUID()): Promise<VerifiedPackage> {
    const packages = this.dependencies.immutablePackages;
    if (!packages) return verified;
    const promoted = await packages.promote(this.promotablePackage(verified));
    await packages.acquire(verified.packageDigest, referenceId);
    return {
      ...verified,
      packageRoot: promoted.contentRoot,
      entrypoint: path.join(promoted.contentRoot, ...promoted.entrypoint.split("/")),
      packageReferenceId: referenceId,
    };
  }

  private async verifyStoredPackage(stored: StoredPackage): Promise<VerifiedPackage> {
    const packages = this.dependencies.immutablePackages;
    if (!packages) {
      return this.dependencies.verifier.verifyAndExtract(
        this.dependencies.repository,
        stored.package_version,
        stored.package_root,
        "verified_local_recheck",
        { appId: this.appId, publisherId: this.publisherId },
      );
    }
    if (!stored.package_reference_id) throw new AppPlatformError("package_cache_missing", "Immutable package reference is missing");
    const stageRoot = path.join(this.dependencies.runtimeRoot, "staging", `recheck-${randomUUID()}`);
    const verified = await this.dependencies.verifier.verifyAndExtract(
      this.dependencies.repository,
      stored.package_version,
      stageRoot,
      "verified_local_recheck",
      { appId: this.appId, publisherId: this.publisherId },
    );
    try {
      if (verified.packageDigest !== stored.package_digest) {
        throw new AppPlatformError("package_archive_digest_mismatch", "Stored package identity differs from signed source authority");
      }
      const authoritative = await packages.assertStoredIntegrity(this.promotablePackage(verified));
      await packages.resolveReferencedRuntime(stored.package_digest, stored.package_reference_id);
      if (path.resolve(authoritative.contentRoot) !== path.resolve(stored.package_root)) {
        throw new AppPlatformError("package_cache_missing", "Stored package root differs from immutable authority");
      }
      return {
        ...verified,
        packageRoot: authoritative.contentRoot,
        entrypoint: path.join(authoritative.contentRoot, ...authoritative.entrypoint.split("/")),
        packageReferenceId: stored.package_reference_id,
      };
    } finally {
      await rm(stageRoot, { recursive: true, force: true });
    }
  }

  private async releaseVerifiedPackage(verified: VerifiedPackage): Promise<void> {
    const packages = this.dependencies.immutablePackages;
    if (!packages || !verified.packageReferenceId) {
      await rm(verified.packageRoot, { recursive: true, force: true });
      return;
    }
    await packages.release(verified.packageDigest, verified.packageReferenceId);
    await packages.removeIfUnreferenced(verified.packageDigest);
    const state = await this.dependencies.store.readLifecycle();
    if (state.active_package_digest !== verified.packageDigest && state.last_known_good_package_digest !== verified.packageDigest) {
      await this.dependencies.store.removePackage(verified.packageDigest);
    }
  }

  private async migrateReferencedPackagesToImmutableStore(): Promise<void> {
    const packages = this.dependencies.immutablePackages;
    if (!packages) return;
    const record = await this.dependencies.store.readLifecycle();
    const referencedDigests = new Set([record.active_package_digest, record.last_known_good_package_digest].filter((value): value is string => Boolean(value)));
    for (const packageDigest of referencedDigests) {
      const stored = await this.dependencies.store.readPackage(packageDigest);
      if (!stored) continue;
      const packagesRoot = path.resolve(packages.layout.packages);
      const storedRoot = path.resolve(stored.package_root);
      if (stored.package_reference_id && storedRoot.startsWith(`${packagesRoot}${path.sep}`)) continue;
      const priorRoot = stored.package_root;
      const stageRoot = path.join(this.dependencies.runtimeRoot, "staging", `migration-${randomUUID()}`);
      const verified = await this.dependencies.verifier.verifyAndExtract(
        this.dependencies.repository,
        stored.package_version,
        stageRoot,
        "verified_local_recheck",
        { appId: this.appId, publisherId: this.publisherId },
      );
      if (verified.packageDigest !== stored.package_digest) {
        await rm(stageRoot, { recursive: true, force: true });
        throw new AppPlatformError("package_archive_digest_mismatch", "Legacy package identity differs from signed source authority");
      }
      const promoted = await this.promoteVerifiedPackage(verified, stored.package_reference_id ?? randomUUID());
      await this.dependencies.store.savePackage(this.storedPackage(promoted));
      const prior = path.resolve(priorRoot);
      const runtime = path.resolve(this.dependencies.runtimeRoot);
      if (prior !== path.resolve(promoted.packageRoot) && prior.startsWith(`${runtime}${path.sep}`)) {
        await rm(prior, { recursive: true, force: true });
      }
    }
  }

  private runtimeDescriptor(record: LifecycleRecord, verified: VerifiedPackage, grant: CapabilityGrant): RuntimeLaunchDescriptor {
    const target = this.dependencies.runtimeTarget ?? { target: "docker_linux_x64", runtimeKind: "container", transport: "container_internal" };
    if (verified.target !== target.target) throw new AppPlatformError("host_incompatible", "Verified package target does not match the lifecycle runtime target");
    return { ...RuntimeDescriptorSchema.parse({ supervisor_protocol_version: 1, runtime_kind: target.runtimeKind, app_id: this.appId, installation_id: record.installation_id ?? grant.installation_id, package_digest: verified.packageDigest, grant_id: grant.grant_id, verified_entrypoint: verified.manifest.platform_artifacts.find((artifact) => artifact.target === target.target)!.entrypoint, arguments: [], environment_keys: ["BRAINDRIVE_APP_CONNECTION_TOKEN", "BRAINDRIVE_APP_ID", "BRAINDRIVE_INSTALLATION_ID", "BRAINDRIVE_PACKAGE_DIGEST", "BRAINDRIVE_ENDPOINT_BIND"], package_root_ref: verified.packageReferenceId ?? randomUUID(), cache_root_ref: randomUUID(), endpoint_policy: { transport: target.transport, authentication: "per_installation_token", public_bind_allowed: false }, resource_policy_version: 1 }), resolved_entrypoint: verified.entrypoint };
  }

  private createGrant(installationId: string, verified: VerifiedPackage): CapabilityGrant {
    const now = new Date().toISOString();
    if (verified.manifest.app_id !== this.appId || verified.manifest.publisher_id !== this.publisherId) throw new AppPlatformError("denied", "Verified package identity does not match the selected app", 403);
    return CapabilityGrantSchema.parse({ grant_version: 1, grant_revision: 1, revocation_generation: 0, grant_id: randomUUID(), owner_id: OWNER_ID, actor_id: ACTOR_ID, app_id: this.appId, publisher_id: this.publisherId, package_digest: verified.packageDigest, installation_id: installationId, capabilities: manifestCapabilities(verified.manifest), record_scopes: [], decision: { decision_id: randomUUID(), decided_by_actor_id: ACTOR_ID, decided_at: now, outcome: "approved" }, issued_at: now, expires_at: "2036-01-01T00:00:00.000Z", revoked_at: null });
  }

  private runLifecycleMutation<T>(idempotencyKey: string, input: unknown, action: () => Promise<T>): Promise<T> {
    return this.dependencies.store.runIdempotent(
      idempotencyKey,
      input,
      () => this.dependencies.store.runLifecycleMutation(action),
    );
  }

  private storedPackage(verified: VerifiedPackage): StoredPackage {
    return {
      store_version: 1,
      package_digest: verified.packageDigest,
      package_version: verified.manifest.package_version,
      package_root: verified.packageRoot,
      ...(verified.packageReferenceId ? { package_reference_id: verified.packageReferenceId } : {}),
      entrypoint: verified.entrypoint,
      manifest: verified.manifest,
      trust: verified.trust,
    };
  }
  private async requireStoredPackage(packageDigest: string): Promise<StoredPackage> { const stored = await this.dependencies.store.readPackage(packageDigest); if (!stored) throw new AppPlatformError("package_cache_missing", "Verified package cache is missing"); return stored; }
  private async requireGrant(grantId: string): Promise<CapabilityGrant> { const grant = await this.dependencies.store.readGrant(grantId); if (!grant) throw new AppPlatformError("grant_missing", "Capability grant is missing"); return grant; }
  private async requireState(states: LifecycleState[]): Promise<LifecycleRecord> { const record = await this.dependencies.store.readLifecycle(); if (!states.includes(record.state)) throw new AppPlatformError("invalid_state_transition", `Operation is not allowed from ${record.state}`); return record; }

  private newOperation(kind: LifecycleOperation["kind"], prior: LifecycleRecord, installationId: string, idempotencyKey: string, input: unknown, targetState: LifecycleState, nextState: LifecycleState, operationId?: string): LifecycleOperation {
    const now = new Date().toISOString();
    return LifecycleOperationSchema.parse({ lifecycle_operation_version: 1, operation_id: operationId ?? randomUUID(), idempotency_key: idempotencyKey, canonical_input_digest: canonicalInputDigest({ app_id: this.appId, installation_id: installationId, input }), owner_id: OWNER_ID, actor_id: ACTOR_ID, app_id: this.appId, installation_id: installationId, kind, prior_record_digest: canonicalInputDigest(prior), prior_generation: prior.generation, prior_state: prior.state, target_state: targetState, next_state: nextState, stage: "requested", completed_stages: [], compensations: [], status: "running", commit_outcome: "not_committed", recovery: { action: "none", from_stage: "requested", safe_state: prior.state, snapshot_ref: null }, started_at: now, updated_at: now, completed_at: null, result: null, error_code: null });
  }

  private async stage(operation: LifecycleOperation, stage: LifecycleOperation["stage"]): Promise<LifecycleOperation> {
    const latest = await this.dependencies.store.readOperation(operation.operation_id);
    const base = latest?.status === "cancel_requested" ? latest : operation;
    const next = LifecycleOperationSchema.parse({ ...base, stage, completed_stages: base.completed_stages.includes(base.stage) ? base.completed_stages : [...base.completed_stages, base.stage], updated_at: new Date().toISOString() });
    await this.dependencies.store.saveOperation(next); return next;
  }

  private async complete(operation: LifecycleOperation, record: LifecycleRecord, outcome: "committed" | "rolled_back", runtimeAuthorityRemoved: boolean): Promise<LifecycleOperation> {
    const now = new Date().toISOString();
    const next = LifecycleOperationSchema.parse({ ...operation, stage: "completed", completed_stages: operation.completed_stages.includes(operation.stage) ? operation.completed_stages : [...operation.completed_stages, operation.stage], status: "committed", commit_outcome: "committed", updated_at: now, completed_at: now, result: { result_version: 1, outcome, final_state: record.state, final_generation: record.generation, active_package_digest: record.active_package_digest, retained_last_known_good_digest: record.last_known_good_package_digest, runtime_authority_removed: runtimeAuthorityRemoved, owner_data_preserved: true }, error_code: null });
    await this.dependencies.store.saveOperation(next); return next;
  }

  private async fail(operation: LifecycleOperation, code: string, recoveryAction: LifecycleOperation["recovery"]["action"]): Promise<LifecycleOperation> {
    const now = new Date().toISOString();
    const next = LifecycleOperationSchema.parse({ ...operation, status: code === "operation_cancelled" ? "cancelled_before_commit" : "failed", commit_outcome: code === "operation_cancelled" ? "not_committed" : "rolled_back_before_commit", recovery: { ...operation.recovery, action: recoveryAction, from_stage: operation.stage }, updated_at: now, completed_at: now, result: null, error_code: code });
    await this.dependencies.store.saveOperation(next); return next;
  }

  private async ensureNotCancelled(operation: LifecycleOperation): Promise<void> { const latest = await this.dependencies.store.readOperation(operation.operation_id); if (latest?.status === "cancel_requested") throw new AppPlatformError("operation_cancelled", "Lifecycle operation was cancelled before commit"); }
  private emit(transitionEvent: string, prior: LifecycleRecord, next: LifecycleRecord, operation: LifecycleOperation, errorCode?: string): void { this.audit("app.lifecycle.transition_completed", { owner_id: operation.owner_id, actor_id: operation.actor_id, app_id: prior.app_id, installation_id: prior.installation_id ?? next.installation_id, operation_id: operation.operation_id, transition_event: transitionEvent, lifecycle_action: operation.kind, prior_state: prior.state, next_state: next.state, package_digest: next.active_package_digest, outcome: errorCode ? "failed" : next.state === "quarantined" ? "quarantined" : "committed", error_code: errorCode ?? null }); }
}

function capabilityDiff(prior: CapabilityGrant["capabilities"], requested: CapabilityGrant["capabilities"]): z.infer<typeof CapabilityDiffSchema> {
  const priorSet = new Set(prior); const requestedSet = new Set(requested);
  const added = requested.filter((item) => !priorSet.has(item));
  const removed = prior.filter((item) => !requestedSet.has(item));
  const unchanged = requested.filter((item) => priorSet.has(item));
  return CapabilityDiffSchema.parse({ diff_version: 1, prior_capabilities: prior, requested_capabilities: requested, added, removed, unchanged, decision: added.length ? "owner_approval_required" : removed.length ? "narrowing_allowed" : "no_change" });
}

function comparePackageVersion(left: string, right: string): number {
  const parse = (value: string): { core: number[]; pre: string[] | null } => {
    const [core, pre] = value.split("-", 2);
    return { core: core.split(".").map(Number), pre: pre ? pre.split(".") : null };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  if (a.pre === null || b.pre === null) return a.pre === b.pre ? 0 : a.pre === null ? 1 : -1;
  return a.pre.join(".").localeCompare(b.pre.join("."));
}

function storedPackageAvailabilityErrorCode(error: unknown): string | null {
  if (error instanceof ZodError) return "package_manifest_invalid";
  if (!(error instanceof AppPlatformError)) return null;
  return [
    "package_archive_digest_mismatch",
    "package_cache_missing",
    "package_manifest_invalid",
    "package_verification_failed",
    "store_corrupt",
  ].includes(error.code) ? error.code : null;
}

function uninstallRetainedClasses(manifests: readonly (RuntimePackageManifest | null)[]): AppRetentionClass[] {
  const manifest = manifests.find((candidate): candidate is RuntimePackageManifest => Boolean(candidate));
  if (!manifest) return ["app_storage", "artifact_records", "export_receipts", "owner_exports", "lifecycle_tombstone"];
  if (manifest.manifest_version !== 2) return ["app_storage", "artifact_records", "export_receipts", "owner_exports", "lifecycle_tombstone"];
  return manifest.retention_policy.classes
    .filter((entry) => entry.uninstall_behavior !== "remove")
    .map((entry) => entry.retention_class);
}
