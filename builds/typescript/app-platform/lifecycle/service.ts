import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import type { z } from "zod";
import { canonicalInputDigest } from "../contracts/common.js";
import { LifecycleOperationSchema, LifecycleRecordSchema, type LifecycleState } from "../contracts/lifecycle.js";
import { CapabilityDiffSchema, CapabilityGrantSchema } from "../contracts/package.js";
import { RuntimeDescriptorSchema } from "../contracts/supervisor.js";
import { CapabilityTokenBroker } from "./capability-token.js";
import { AppPlatformError, asAppPlatformError } from "./errors.js";
import type { FixtureRepository } from "./fixture-repository.js";
import type { OwnerDataLifecycle } from "./owner-data.js";
import { PackageVerifier, type VerifiedPackage } from "./package-verifier.js";
import type { AppSupervisor, RuntimeIdentity, RuntimeLaunchDescriptor, StopReason } from "./process-supervisor.js";
import { AppLifecycleStore, type CapabilityGrant, type LifecycleOperation, type LifecycleRecord, type StoredPackage } from "./store.js";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000002";

export type LifecycleDependencies = {
  store: AppLifecycleStore;
  verifier: PackageVerifier;
  repository: FixtureRepository;
  supervisor: AppSupervisor;
  tokenBroker: CapabilityTokenBroker;
  runtimeRoot: string;
  ownerDataRoot: string;
  ownerDataLifecycle?: OwnerDataLifecycle;
  isMemoryMigrationInProgress?: () => boolean;
  runtimeTarget?: {
    target: "docker_linux_x64" | "desktop_windows_x64";
    runtimeKind: "container" | "packaged_node";
    transport: "container_internal" | "loopback";
  };
  audit?: (event: string, details: Record<string, unknown>) => void;
};

export type LifecycleResponse = { record: LifecycleRecord; operation: LifecycleOperation; grant: CapabilityGrant | null };

type InstallInput = { version: string; idempotencyKey: string; approveCapabilities: boolean };
type SimpleInput = { idempotencyKey: string };

export class AppLifecycleService {
  private readonly audit: NonNullable<LifecycleDependencies["audit"]>;

  constructor(public readonly dependencies: LifecycleDependencies) {
    this.audit = dependencies.audit ?? (() => undefined);
  }

  async initialize(): Promise<void> {
    await this.dependencies.store.initialize();
    await this.reconcile();
  }

  status = (): Promise<LifecycleRecord> => this.dependencies.store.readLifecycle();

  async install(input: InstallInput): Promise<LifecycleResponse> {
    return this.dependencies.store.runIdempotent(input.idempotencyKey, { kind: "install", version: input.version, approve_capabilities: input.approveCapabilities }, async () => {
      this.assertMemoryTransferIdle();
      const prior = await this.dependencies.store.readLifecycle();
      if (prior.state !== "not_installed") throw new AppPlatformError("invalid_state_transition", `Install is not allowed from ${prior.state}`);
      const installationId = randomUUID();
      let operation = this.newOperation("install", prior, installationId, input.idempotencyKey, { version: input.version }, "active", "staged");
      await this.dependencies.store.saveOperation(operation);
      let verified: VerifiedPackage | null = null;
      let grant: CapabilityGrant | null = null;
      let runtime: RuntimeIdentity | null = null;
      try {
        operation = await this.stage(operation, "verifying_source");
        const packageRoot = path.join(this.dependencies.runtimeRoot, "staging", operation.operation_id);
        verified = await this.dependencies.verifier.verifyAndExtract(this.dependencies.repository, input.version, packageRoot, "candidate_install_or_update");
        operation = await this.stage(operation, "verifying_package");
        await this.ensureNotCancelled(operation);
        if (!input.approveCapabilities) throw new AppPlatformError("grant_approval_required", "Owner approval is required for the initial capability grant", 409);
        grant = this.createGrant(installationId, verified);
        await this.prepareOwnerData(grant, verified, prior.generation === 0 ? "install" : "reinstall");
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
        if (verified) await rm(verified.packageRoot, { recursive: true, force: true });
        await this.fail(operation, failure.code, prior.state === "not_installed" ? "remove_staging_and_restore_prior" : "none");
        this.emit("app.lifecycle.install.failed", prior, prior, operation, failure.code);
        throw failure;
      }
    });
  }

  async disable(input: SimpleInput): Promise<LifecycleResponse> {
    return this.dependencies.store.runIdempotent(input.idempotencyKey, { kind: "disable" }, async () => {
      const prior = await this.requireState(["active"]);
      let operation = this.newOperation("disable", prior, prior.installation_id!, input.idempotencyKey, {}, "disabled", "disabled");
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
    return this.dependencies.store.runIdempotent(input.idempotencyKey, { kind: "enable" }, async () => {
      this.assertMemoryTransferIdle();
      const prior = await this.requireState(["disabled"]);
      let operation = this.newOperation("enable", prior, prior.installation_id!, input.idempotencyKey, {}, "active", "active");
      await this.dependencies.store.saveOperation(operation);
      const stored = await this.requireStoredPackage(prior.active_package_digest!);
      const grant = await this.requireGrant(prior.grant_id!);
      operation = await this.stage(operation, "verifying_package");
      const verified = await this.dependencies.verifier.verifyAndExtract(this.dependencies.repository, stored.package_version, stored.package_root, "verified_local_recheck");
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
    return this.dependencies.store.runIdempotent(input.idempotencyKey, { kind: "update", version: input.version, approve_capabilities: input.approveCapabilities }, async () => {
      this.assertMemoryTransferIdle();
      const prior = await this.requireState(["active", "disabled"]);
      let operation = this.newOperation("update", prior, prior.installation_id!, input.idempotencyKey, { version: input.version }, prior.state, "updating");
      await this.dependencies.store.saveOperation(operation);
      let candidate: VerifiedPackage | null = null;
      let candidateGrant: CapabilityGrant | null = null;
      try {
        const candidateRoot = path.join(this.dependencies.runtimeRoot, "staging", operation.operation_id);
        operation = await this.stage(operation, "verifying_package");
        candidate = await this.dependencies.verifier.verifyAndExtract(this.dependencies.repository, input.version, candidateRoot, "candidate_install_or_update");
        const priorGrant = await this.requireGrant(prior.grant_id!);
        const diff = capabilityDiff(priorGrant.capabilities, candidate.manifest.requested_capabilities);
        if (diff.decision === "owner_approval_required" && !input.approveCapabilities) throw new AppPlatformError("grant_widening_approval_required", "Update requests additional capabilities");
        candidateGrant = this.createGrant(prior.installation_id!, candidate);
        await this.prepareOwnerData(candidateGrant, candidate, "update");
        await this.dependencies.store.saveGrant(candidateGrant);
        await this.dependencies.store.savePackage(this.storedPackage(candidate));
        const updating = LifecycleRecordSchema.parse({ ...prior, state: "updating", generation: prior.generation + 1, pending_operation_id: operation.operation_id, updated_at: new Date().toISOString() });
        await this.dependencies.store.compareAndSwapLifecycle(prior.generation, updating);
        await this.ensureNotCancelled(operation);
        if (prior.state === "active") {
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
        const next = LifecycleRecordSchema.parse({ ...updating, state: prior.state, generation: updating.generation + 1, active_package_digest: candidate.packageDigest, last_known_good_package_digest: prior.active_package_digest, grant_id: candidateGrant.grant_id, pending_operation_id: null, successful_use_checkpoint: { checkpoint_version: 1, package_digest: candidate.packageDigest, status: "pending", started_at: new Date().toISOString(), completed_at: null, evidence_operation_id: null }, updated_at: new Date().toISOString() });
        await this.dependencies.store.compareAndSwapLifecycle(updating.generation, next);
        this.dependencies.tokenBroker.permitInstallation(prior.installation_id!);
        await this.dependencies.store.revokeGrant(prior.grant_id!);
        operation = await this.complete(operation, next, "committed", prior.state === "disabled");
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
          this.dependencies.tokenBroker.permitInstallation(prior.installation_id!);
        }
        if (candidateGrant) await this.dependencies.store.revokeGrant(candidateGrant.grant_id).catch(() => undefined);
        if (candidate) await rm(candidate.packageRoot, { recursive: true, force: true });
        await this.fail(operation, failure.code, "stop_candidate_and_restore_prior");
        this.emit("app.lifecycle.update.failed", prior, prior, operation, failure.code);
        throw failure;
      }
    });
  }

  async rollback(input: SimpleInput): Promise<LifecycleResponse> {
    return this.dependencies.store.runIdempotent(input.idempotencyKey, { kind: "rollback" }, async () => {
      this.assertMemoryTransferIdle();
      const prior = await this.requireState(["active", "disabled"]);
      if (!prior.last_known_good_package_digest) throw new AppPlatformError("rollback_unavailable", "No last-known-good package is retained");
      let operation = this.newOperation("rollback", prior, prior.installation_id!, input.idempotencyKey, {}, prior.state, "rollback_pending");
      await this.dependencies.store.saveOperation(operation);
      const stored = await this.requireStoredPackage(prior.last_known_good_package_digest);
      const verified = await this.dependencies.verifier.verifyAndExtract(this.dependencies.repository, stored.package_version, stored.package_root, "verified_local_recheck");
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
    return this.dependencies.store.runIdempotent(input.idempotencyKey, { kind: "uninstall" }, async () => {
      this.assertMemoryTransferIdle();
      const prior = await this.requireState(["active", "disabled", "quarantined", "failed_recoverable"]);
      let operation = this.newOperation("uninstall", prior, prior.installation_id!, input.idempotencyKey, {}, "not_installed", "uninstalling");
      await this.dependencies.store.saveOperation(operation);
      const uninstalling = LifecycleRecordSchema.parse({ ...prior, state: "uninstalling", generation: prior.generation + 1, pending_operation_id: operation.operation_id, updated_at: new Date().toISOString() });
      await this.dependencies.store.compareAndSwapLifecycle(prior.generation, uninstalling);
      operation = await this.stage(operation, "revoking_tokens");
      this.dependencies.tokenBroker.revokeInstallation(prior.installation_id!);
      if (prior.grant_id) await this.dependencies.store.revokeGrant(prior.grant_id);
      operation = await this.stage(operation, "stopping");
      await this.stopInstallation(prior.installation_id!, "uninstall");
      await this.dependencies.ownerDataLifecycle?.cleanupDefaultUninstall();
      operation = await this.stage(operation, "removing_runtime_authority");
      for (const packageDigest of [prior.active_package_digest, prior.last_known_good_package_digest].filter((value): value is string => Boolean(value))) {
        const stored = await this.dependencies.store.readPackage(packageDigest);
        if (stored) await rm(stored.package_root, { recursive: true, force: true });
        await this.dependencies.store.removePackage(packageDigest);
      }
      if (prior.grant_id) await this.dependencies.store.removeGrant(prior.grant_id);
      const removed = LifecycleRecordSchema.parse({ lifecycle_schema_version: 1, app_id: "ai.braindrive.resume-builder", installation_id: null, state: "not_installed", generation: uninstalling.generation + 1, active_package_digest: null, last_known_good_package_digest: null, grant_id: null, pending_operation_id: null, successful_use_checkpoint: null, updated_at: new Date().toISOString() });
      await this.dependencies.store.compareAndSwapLifecycle(uninstalling.generation, removed);
      operation = await this.complete(operation, removed, "committed", true);
      this.emit("app.lifecycle.uninstall.committed", prior, removed, operation);
      return { record: removed, operation, grant: null };
    });
  }

  async enforceRevocations(): Promise<LifecycleRecord> {
    const prior = await this.dependencies.store.readLifecycle();
    if (!["active", "disabled"].includes(prior.state)) return prior;
    const stored = await this.requireStoredPackage(prior.active_package_digest!);
    try {
      await this.dependencies.verifier.verifyAndExtract(this.dependencies.repository, stored.package_version, stored.package_root, "verified_local_recheck");
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

  async issueSession(input: { audience: "app_data" | "app_inference" | "app_export" | "app_bridge"; capabilities: CapabilityGrant["capabilities"]; operationId: string; viewId?: string; connectionId?: string }): Promise<ReturnType<CapabilityTokenBroker["issue"]>> {
    const record = await this.requireState(["active"]);
    const grant = await this.requireGrant(record.grant_id!);
    return this.dependencies.tokenBroker.issue({ grant, audience: input.audience, capabilities: input.capabilities, connectionId: input.connectionId ?? randomUUID(), operationId: input.operationId, viewId: input.viewId, ttlMs: 5 * 60_000 });
  }

  async ownerDescriptor(): Promise<{ record: LifecycleRecord; grant: CapabilityGrant | null; packageVersion: string | null }> {
    const record = await this.dependencies.store.readLifecycle();
    const grant = record.grant_id ? await this.dependencies.store.readGrant(record.grant_id) : null;
    const stored = record.active_package_digest ? await this.dependencies.store.readPackage(record.active_package_digest) : null;
    return { record, grant, packageVersion: stored?.package_version ?? null };
  }

  private async reconcile(): Promise<void> {
    let record = await this.dependencies.store.readLifecycle();
    if (["staged", "updating", "rollback_pending", "uninstalling"].includes(record.state)) {
      const operation = record.pending_operation_id ? await this.dependencies.store.readOperation(record.pending_operation_id) : null;
      const priorState = operation?.prior_state ?? "failed_recoverable";
      const safeState: LifecycleState = record.state === "staged" ? "not_installed" : record.state === "uninstalling" ? "not_installed" : priorState === "active" ? "active" : priorState === "disabled" ? "disabled" : "failed_recoverable";
      const next = safeState === "not_installed"
        ? LifecycleRecordSchema.parse({ lifecycle_schema_version: 1, app_id: "ai.braindrive.resume-builder", installation_id: null, state: "not_installed", generation: record.generation + 1, active_package_digest: null, last_known_good_package_digest: null, grant_id: null, pending_operation_id: null, successful_use_checkpoint: null, updated_at: new Date().toISOString() })
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

  private async restartPrior(record: LifecycleRecord): Promise<void> {
    const stored = await this.requireStoredPackage(record.active_package_digest!);
    const grant = await this.requireGrant(record.grant_id!);
    const verified = await this.dependencies.verifier.verifyAndExtract(this.dependencies.repository, stored.package_version, stored.package_root, "verified_local_recheck");
    await this.prepareOwnerData(grant, verified, "enable");
    const started = await this.dependencies.supervisor.start(this.runtimeDescriptor(record, verified, grant));
    await this.dependencies.supervisor.awaitReadiness(started.runtime!);
  }

  private async stopInstallation(installationId: string, reason: StopReason): Promise<void> {
    for (const runtime of this.dependencies.supervisor.inspect(installationId)) await this.dependencies.supervisor.stop(runtime, reason);
  }

  private assertMemoryTransferIdle(): void {
    if (this.dependencies.isMemoryMigrationInProgress?.()) {
      throw new AppPlatformError("invalid_state_transition", "Memory transfer must finish before changing Resume Builder lifecycle state", 409);
    }
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
        compatibility: verified.manifest.compatibility.data_schema,
        reason,
      });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === "incompatible_schema") {
        throw new AppPlatformError("incompatible_schema", "Retained Resume Builder data requires a compatible app version", 409);
      }
      if (code === "denied") throw new AppPlatformError("denied", "Retained Resume Builder data belongs to a different owner", 403);
      if (code === "validation_failed") throw new AppPlatformError("validation_failed", "Retained Resume Builder data failed integrity validation", 409);
      if (code === "recoverable_internal_failure") {
        throw new AppPlatformError("recoverable_internal_failure", "Retained Resume Builder data could not be prepared safely", 500);
      }
      throw error;
    }
  }

  private runtimeDescriptor(record: LifecycleRecord, verified: VerifiedPackage, grant: CapabilityGrant): RuntimeLaunchDescriptor {
    const target = this.dependencies.runtimeTarget ?? { target: "docker_linux_x64", runtimeKind: "container", transport: "container_internal" };
    if (verified.target !== target.target) throw new AppPlatformError("host_incompatible", "Verified package target does not match the lifecycle runtime target");
    return { ...RuntimeDescriptorSchema.parse({ supervisor_protocol_version: 1, runtime_kind: target.runtimeKind, app_id: "ai.braindrive.resume-builder", installation_id: record.installation_id ?? grant.installation_id, package_digest: verified.packageDigest, grant_id: grant.grant_id, verified_entrypoint: verified.manifest.platform_artifacts.find((artifact) => artifact.target === target.target)!.entrypoint, arguments: [], environment_keys: ["BRAINDRIVE_APP_CONNECTION_TOKEN", "BRAINDRIVE_APP_ID", "BRAINDRIVE_INSTALLATION_ID", "BRAINDRIVE_PACKAGE_DIGEST", "BRAINDRIVE_ENDPOINT_BIND"], package_root_ref: randomUUID(), cache_root_ref: randomUUID(), endpoint_policy: { transport: target.transport, authentication: "per_installation_token", public_bind_allowed: false }, resource_policy_version: 1 }), resolved_entrypoint: verified.entrypoint };
  }

  private createGrant(installationId: string, verified: VerifiedPackage): CapabilityGrant {
    const now = new Date().toISOString();
    return CapabilityGrantSchema.parse({ grant_version: 1, grant_revision: 1, revocation_generation: 0, grant_id: randomUUID(), owner_id: OWNER_ID, actor_id: ACTOR_ID, app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive", package_digest: verified.packageDigest, installation_id: installationId, capabilities: verified.manifest.requested_capabilities, record_scopes: [], decision: { decision_id: randomUUID(), decided_by_actor_id: ACTOR_ID, decided_at: now, outcome: "approved" }, issued_at: now, expires_at: "2036-01-01T00:00:00.000Z", revoked_at: null });
  }

  private storedPackage(verified: VerifiedPackage): StoredPackage { return { store_version: 1, package_digest: verified.packageDigest, package_version: verified.manifest.package_version, package_root: verified.packageRoot, entrypoint: verified.entrypoint, manifest: verified.manifest, trust: verified.trust }; }
  private async requireStoredPackage(packageDigest: string): Promise<StoredPackage> { const stored = await this.dependencies.store.readPackage(packageDigest); if (!stored) throw new AppPlatformError("package_cache_missing", "Verified package cache is missing"); return stored; }
  private async requireGrant(grantId: string): Promise<CapabilityGrant> { const grant = await this.dependencies.store.readGrant(grantId); if (!grant) throw new AppPlatformError("grant_missing", "Capability grant is missing"); return grant; }
  private async requireState(states: LifecycleState[]): Promise<LifecycleRecord> { const record = await this.dependencies.store.readLifecycle(); if (!states.includes(record.state)) throw new AppPlatformError("invalid_state_transition", `Operation is not allowed from ${record.state}`); return record; }

  private newOperation(kind: LifecycleOperation["kind"], prior: LifecycleRecord, installationId: string, idempotencyKey: string, input: unknown, targetState: LifecycleState, nextState: LifecycleState): LifecycleOperation {
    const now = new Date().toISOString();
    return LifecycleOperationSchema.parse({ lifecycle_operation_version: 1, operation_id: randomUUID(), idempotency_key: idempotencyKey, canonical_input_digest: canonicalInputDigest(input), owner_id: OWNER_ID, actor_id: ACTOR_ID, app_id: "ai.braindrive.resume-builder", installation_id: installationId, kind, prior_record_digest: canonicalInputDigest(prior), prior_generation: prior.generation, prior_state: prior.state, target_state: targetState, next_state: nextState, stage: "requested", completed_stages: [], compensations: [], status: "running", commit_outcome: "not_committed", recovery: { action: "none", from_stage: "requested", safe_state: prior.state, snapshot_ref: null }, started_at: now, updated_at: now, completed_at: null, result: null, error_code: null });
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
  private emit(transitionEvent: string, prior: LifecycleRecord, next: LifecycleRecord, operation: LifecycleOperation, errorCode?: string): void { this.audit("app.lifecycle.transition_completed", { app_id: prior.app_id, installation_id: prior.installation_id ?? next.installation_id, operation_id: operation.operation_id, transition_event: transitionEvent, lifecycle_action: operation.kind, prior_state: prior.state, next_state: next.state, package_digest: next.active_package_digest, outcome: errorCode ? "failed" : next.state === "quarantined" ? "quarantined" : "committed", error_code: errorCode ?? null }); }
}

function capabilityDiff(prior: CapabilityGrant["capabilities"], requested: CapabilityGrant["capabilities"]): z.infer<typeof CapabilityDiffSchema> {
  const priorSet = new Set(prior); const requestedSet = new Set(requested);
  const added = requested.filter((item) => !priorSet.has(item));
  const removed = prior.filter((item) => !requestedSet.has(item));
  const unchanged = requested.filter((item) => priorSet.has(item));
  return CapabilityDiffSchema.parse({ diff_version: 1, prior_capabilities: prior, requested_capabilities: requested, added, removed, unchanged, decision: added.length ? "owner_approval_required" : removed.length ? "narrowing_allowed" : "no_change" });
}
