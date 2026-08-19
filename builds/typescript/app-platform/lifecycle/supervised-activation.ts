import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

import { ContractViolation } from "../contracts/errors.js";
import { SUPERVISOR_POLICY } from "../contracts/package.js";
import type { InstalledAppSupervisor } from "../contracts/supervisor.js";
import type { z } from "zod";
import { RuntimeIdentitySchema } from "../contracts/supervisor.js";
import { LifecycleStore, type DurableLifecycleResult } from "./durable-store.js";
import { InstallationGrantStore } from "./install-grants.js";
import { RuntimeAuthorityStore, type RuntimeAuthorityRecord } from "./runtime-authority-store.js";
import { ImmutablePackageStore } from "./verified-package-store.js";
import { VerifiedPackageVerifier, type VerifyPackageRequest } from "./verified-package.js";

export type SupervisedOperationInput = {
  operationId: string;
  idempotencyKey: string;
  ownerId: string;
  actorId: string;
};

export type SupervisedEnableInput = SupervisedOperationInput & {
  verification: VerifyPackageRequest;
};

export type SupervisedLifecycleDependencies = {
  lifecycle: LifecycleStore;
  grants: InstallationGrantStore;
  packages: ImmutablePackageStore;
  verifier: VerifiedPackageVerifier;
  supervisor: InstalledAppSupervisor;
  runtimeAuthority: RuntimeAuthorityStore;
  ids?: { next(): string };
  clock?: () => Date;
  audit?: (event: string, details: Record<string, unknown>) => void;
};

/** M4 lifecycle orchestration. Update, rollback, revocation enforcement, uninstall, and public routes remain outside this module. */
export class SupervisedLifecycleService {
  private readonly ids: { next(): string };
  private readonly clock: () => Date;
  private readonly audit: NonNullable<SupervisedLifecycleDependencies["audit"]>;

  constructor(private readonly dependencies: SupervisedLifecycleDependencies) {
    this.ids = dependencies.ids ?? { next: () => randomUUID() };
    this.clock = dependencies.clock ?? (() => new Date());
    this.audit = dependencies.audit ?? (() => undefined);
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.dependencies.lifecycle.initialize(),
      this.dependencies.grants.initialize(),
      this.dependencies.packages.initialize(),
      this.dependencies.runtimeAuthority.initialize(),
    ]);
  }

  async disable(input: SupervisedOperationInput): Promise<DurableLifecycleResult> {
    await this.initialize();
    const existing = await this.dependencies.lifecycle.readJournal(input.operationId);
    if (existing?.result) return existing.result;
    const prior = await this.dependencies.lifecycle.readState();
    if (prior.state !== "active" || !prior.installation_id) {
      throw new ContractViolation("invalid_state_transition", "Disable requires active lifecycle authority");
    }
    let lease = await this.dependencies.lifecycle.acquireMutation(input.operationId);
    try {
      const prepared = await this.dependencies.lifecycle.prepareTransition({
        operationId: input.operationId,
        idempotencyKey: input.idempotencyKey,
        canonicalInput: { action: "disable", generation: prior.generation },
        ownerId: input.ownerId,
        actorId: input.actorId,
        kind: "disable",
        to: "disabled",
      }, lease);
      if (prepared.result) return prepared.result;
      lease = await this.dependencies.lifecycle.renewMutation(lease, SUPERVISOR_POLICY.startup_timeout_ms + 30_000);
      const authority = await this.requireAuthority(prior.installation_id, prior.active_package_digest, prior.grant_id);
      const revoked = await this.dependencies.supervisor.revokeTokens({
        supervisor_protocol_version: 1,
        operation_id: input.operationId,
        installation_id: prior.installation_id,
        runtime_id: authority.runtime.runtime_id,
        operation_scope_id: input.operationId,
        prior_token_generation: authority.runtime.endpoint_token_generation,
      });
      if (revoked.outcome === "failed") throw new ContractViolation("stop_unacknowledged", "Disable token authority could not be revoked");
      this.emit("disable", "tokens_revoked", prior, authority, null);

      const stopped = await this.dependencies.supervisor.stop({
        supervisor_protocol_version: 1,
        operation_id: input.operationId,
        runtime: authority.runtime,
        reason: "disable",
        grace_deadline_at: new Date(this.clock().getTime() + 5_000).toISOString(),
      });
      let contained = stopped.termination_acknowledged;
      const cleanup = await this.dependencies.supervisor.cleanup({
        supervisor_protocol_version: 1,
        operation_id: input.operationId,
        installation_id: prior.installation_id,
        expected_runtime_id: authority.runtime.runtime_id,
        observed_runtime_ids: [authority.runtime.runtime_id],
        requested_at: this.clock().toISOString(),
      });
      contained = contained || (
        !["ambiguous", "failed"].includes(cleanup.outcome)
        && cleanup.remaining_runtime_count === 0
        && cleanup.registration_count === 0
        && cleanup.tokens_revoked
      );
      if (!contained || cleanup.remaining_runtime_count !== 0 || cleanup.registration_count !== 0 || !cleanup.tokens_revoked) {
        throw new ContractViolation("ambiguous_runtime_state", "Disable could not prove runtime authority removal");
      }
      this.emit("disable", "runtime_authority_removed", prior, authority, null);
      await this.dependencies.runtimeAuthority.remove(prior.installation_id);
      const result = await this.dependencies.lifecycle.commitPrepared(input.operationId, lease);
      this.emit("disable", "state_committed", prior, authority, result.final_state);
      return result;
    } finally {
      await this.dependencies.lifecycle.releaseMutation(lease);
    }
  }

  async enable(input: SupervisedEnableInput): Promise<DurableLifecycleResult> {
    await this.initialize();
    const existing = await this.dependencies.lifecycle.readJournal(input.operationId);
    if (existing?.result) {
      if (existing.result.outcome === "committed") return existing.result;
      throw new ContractViolation("readiness_failed", "Prior re-enable attempt failed safely");
    }
    const prior = await this.dependencies.lifecycle.readState();
    if (prior.state !== "disabled" || !prior.installation_id || !prior.active_package_digest || !prior.grant_id) {
      throw new ContractViolation("invalid_state_transition", "Re-enable requires disabled package and grant authority");
    }
    let lease = await this.dependencies.lifecycle.acquireMutation(input.operationId);
    let authority: RuntimeAuthorityRecord | null = null;
    let startedRuntime: z.infer<typeof RuntimeIdentitySchema> | null = null;
    let prepared = false;
    let failed: unknown = null;
    try {
      const journal = await this.dependencies.lifecycle.prepareTransition({
        operationId: input.operationId,
        idempotencyKey: input.idempotencyKey,
        canonicalInput: { action: "enable", generation: prior.generation, package_digest: prior.active_package_digest },
        ownerId: input.ownerId,
        actorId: input.actorId,
        kind: "enable",
        to: "active",
      }, lease);
      if (journal.result?.outcome === "committed") return journal.result;
      prepared = true;
      lease = await this.dependencies.lifecycle.renewMutation(lease, SUPERVISOR_POLICY.startup_timeout_ms + 30_000);

      const verified = await this.dependencies.verifier.verify(input.verification);
      try {
        if (verified.packageDigest !== prior.active_package_digest) {
          throw new ContractViolation("package_digest_mismatch", "Re-enable authority differs from committed package digest");
        }
        const stored = await this.dependencies.packages.assertStoredIntegrity(verified);
        const grant = await this.dependencies.grants.read(prior.grant_id);
        if (
          !grant
          || grant.installation_id !== prior.installation_id
          || grant.package_digest !== prior.active_package_digest
          || grant.revoked_at !== null
          || Date.parse(grant.expires_at) <= this.clock().getTime()
        ) {
          throw new ContractViolation("denied", "Re-enable grant is missing, expired, revoked, or mismatched");
        }
        this.emit("enable", "trust_grant_revalidated", prior, null, null);
        const snapshot = await this.dependencies.lifecycle.readConsistentSnapshot();
        if (!snapshot.active.package_ref_id) throw new ContractViolation("conflict", "Active package reference is unavailable");
        const cacheRootRef = this.ids.next();
        const connectionId = this.ids.next();
        const desktop = verified.target !== "docker_linux_x64";
        const started = await this.dependencies.supervisor.start({
          supervisor_protocol_version: 1,
          operation_id: input.operationId,
          descriptor: {
            supervisor_protocol_version: 1,
            runtime_kind: desktop ? "packaged_node" : "container",
            app_id: verified.manifest.app_id,
            installation_id: prior.installation_id,
            package_digest: verified.packageDigest,
            grant_id: grant.grant_id,
            verified_entrypoint: stored.entrypoint,
            arguments: [],
            environment_keys: [
              "BRAINDRIVE_APP_CONNECTION_TOKEN", "BRAINDRIVE_APP_ID", "BRAINDRIVE_INSTALLATION_ID",
              "BRAINDRIVE_PACKAGE_DIGEST", "BRAINDRIVE_ENDPOINT_BIND",
            ],
            package_root_ref: snapshot.active.package_ref_id,
            cache_root_ref: cacheRootRef,
            endpoint_policy: { transport: desktop ? "loopback" : "container_internal", authentication: "per_installation_token", public_bind_allowed: false },
            resource_policy_version: 1,
          },
          policy: SUPERVISOR_POLICY,
          requested_at: this.clock().toISOString(),
        });
        if (!started.runtime || !["started", "already_running"].includes(started.outcome)) {
          throw new ContractViolation("ambiguous_runtime_state", "Re-enable start did not prove one exact runtime");
        }
        startedRuntime = started.runtime;
        const ready = await this.dependencies.supervisor.awaitReady({
          supervisor_protocol_version: 1,
          operation_id: input.operationId,
          runtime: started.runtime,
          deadline_at: new Date(this.clock().getTime() + SUPERVISOR_POLICY.startup_timeout_ms).toISOString(),
        });
        if (ready.outcome !== "ready" || !ready.endpoint) throw new ContractViolation("readiness_failed", "Re-enable readiness gate failed");
        const registered = await this.dependencies.supervisor.register({
          supervisor_protocol_version: 1,
          operation_id: input.operationId,
          runtime: started.runtime,
          endpoint: ready.endpoint,
          connection_id: connectionId,
        });
        if (!registered.registration_id || !["registered", "already_registered"].includes(registered.outcome)) {
          throw new ContractViolation("readiness_failed", "Re-enable dynamic registration gate failed");
        }
        authority = await this.dependencies.runtimeAuthority.persist({
          installation_id: prior.installation_id,
          package_version: stored.packageVersion,
          package_digest: verified.packageDigest,
          grant_id: grant.grant_id,
          runtime: started.runtime,
          registration_id: registered.registration_id,
          connection_id: connectionId,
        });
        this.emit("enable", "runtime_registered", prior, authority, null);
        const result = await this.dependencies.lifecycle.commitPrepared(input.operationId, lease);
        this.emit("enable", "state_committed", prior, authority, result.final_state);
        return result;
      } finally {
        await rm(verified.stageRoot, { recursive: true, force: true });
      }
    } catch (error) {
      failed = error;
      if (authority) await this.contain(input.operationId, authority).catch(() => undefined);
      else if (startedRuntime) await this.containRuntime(input.operationId, prior.installation_id, startedRuntime).catch(() => undefined);
      else {
        const observed = await this.dependencies.runtimeAuthority.read(prior.installation_id).catch(() => null);
        if (observed) await this.contain(input.operationId, observed).catch(() => undefined);
      }
      await this.dependencies.runtimeAuthority.remove(prior.installation_id).catch(() => undefined);
    } finally {
      await this.dependencies.lifecycle.releaseMutation(lease);
    }
    if (prepared) await this.dependencies.lifecycle.reconcileOperation(input.operationId).catch(() => undefined);
    if (failed instanceof ContractViolation) throw failed;
    throw new ContractViolation("recoverable_internal_failure", "Re-enable failed and runtime authority was contained");
  }

  async reconcile(input: SupervisedOperationInput): Promise<"adopted" | "no_runtime" | "failed_recoverable"> {
    await this.initialize();
    const state = await this.dependencies.lifecycle.readState();
    if (!state.installation_id) return "no_runtime";
    const authority = await this.dependencies.runtimeAuthority.read(state.installation_id);
    const result = await this.dependencies.supervisor.reconcile({
      supervisor_protocol_version: 1,
      operation_id: input.operationId,
      installation_id: state.installation_id,
      expected_runtime: state.state === "active" ? authority?.runtime ?? null : null,
      expected_registration_id: state.state === "active" ? authority?.registration_id ?? null : null,
      expected_state: ["active", "disabled", "quarantined", "not_installed", "failed_recoverable"].includes(state.state)
        ? state.state as "active" | "disabled" | "quarantined" | "not_installed" | "failed_recoverable"
        : "failed_recoverable",
    });
    if (state.state !== "active") {
      if (result.active_runtime_count !== 0 || result.registration_count !== 0 || !result.tokens_revoked) {
        throw new ContractViolation("ambiguous_runtime_state", "Non-active reconciliation retained runtime authority");
      }
      await this.dependencies.runtimeAuthority.remove(state.installation_id);
      return "no_runtime";
    }
    if (result.outcome === "adopted") return "adopted";
    if (result.active_runtime_count !== 0 || result.registration_count !== 0 || !result.tokens_revoked) {
      throw new ContractViolation("ambiguous_runtime_state", "Active reconciliation could not contain stale authority");
    }
    await this.dependencies.runtimeAuthority.remove(state.installation_id);
    await this.dependencies.lifecycle.executeTransition({
      operationId: input.operationId,
      idempotencyKey: input.idempotencyKey,
      canonicalInput: { action: "reconcile", generation: state.generation, outcome: result.outcome },
      ownerId: input.ownerId,
      actorId: input.actorId,
      kind: "reconcile",
      to: "failed_recoverable",
    });
    return "failed_recoverable";
  }

  private async requireAuthority(installationId: string, packageDigest: string | null, grantId: string | null): Promise<RuntimeAuthorityRecord> {
    const authority = await this.dependencies.runtimeAuthority.read(installationId);
    if (!authority || authority.package_digest !== packageDigest || authority.grant_id !== grantId) {
      throw new ContractViolation("ambiguous_runtime_state", "Committed lifecycle and runtime authority differ");
    }
    return authority;
  }

  private async contain(operationId: string, authority: RuntimeAuthorityRecord): Promise<void> {
    await this.containRuntime(operationId, authority.installation_id, authority.runtime);
  }

  private async containRuntime(operationId: string, installationId: string, runtime: z.infer<typeof RuntimeIdentitySchema>): Promise<void> {
    await this.dependencies.supervisor.revokeTokens({
      supervisor_protocol_version: 1,
      operation_id: operationId,
      installation_id: installationId,
      runtime_id: runtime.runtime_id,
      operation_scope_id: operationId,
      prior_token_generation: runtime.endpoint_token_generation,
    });
    await this.dependencies.supervisor.stop({
      supervisor_protocol_version: 1,
      operation_id: operationId,
      runtime,
      reason: "reconcile",
      grace_deadline_at: new Date(this.clock().getTime() + 5_000).toISOString(),
    });
    const cleanup = await this.dependencies.supervisor.cleanup({
      supervisor_protocol_version: 1,
      operation_id: operationId,
      installation_id: installationId,
      expected_runtime_id: runtime.runtime_id,
      observed_runtime_ids: [runtime.runtime_id],
      requested_at: this.clock().toISOString(),
    });
    if (cleanup.remaining_runtime_count !== 0 || cleanup.registration_count !== 0 || !cleanup.tokens_revoked) {
      throw new ContractViolation("ambiguous_runtime_state", "Runtime containment was not acknowledged");
    }
  }

  private emit(action: string, step: string, state: Awaited<ReturnType<LifecycleStore["readState"]>>, authority: RuntimeAuthorityRecord | null, resultState: string | null): void {
    this.audit("app.lifecycle.supervised_action", {
      app_id: state.app_id,
      installation_id: state.installation_id,
      package_digest: state.active_package_digest,
      grant_id: state.grant_id,
      runtime_id: authority?.runtime.runtime_id ?? null,
      registration_id: authority?.registration_id ?? null,
      action,
      step,
      prior_state: state.state,
      result_state: resultState,
    });
  }
}
