import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { canonicalInputDigest, canonicalJson, OpaqueIdSchema, Sha256DigestSchema, TimestampSchema } from "../contracts/common.js";
import { RESUME_BUILDER_APP_ID } from "../contracts/constants.js";
import { ContractViolation } from "../contracts/errors.js";
import type { ResumeLifecycleDataAdapter } from "../contracts/lifecycle-foundation.js";
import { CapabilityDiffSchema, SUPERVISOR_POLICY } from "../contracts/package.js";
import { RuntimeIdentitySchema, type InstalledAppSupervisor } from "../contracts/supervisor.js";
import { LifecycleStore, type DurablePackageReference, type MutationLease } from "./durable-store.js";
import { InstallationGrantStore, type OwnerGrantDecision } from "./install-grants.js";
import { RuntimeAuthorityStore, type RuntimeAuthorityRecord } from "./runtime-authority-store.js";
import { MonotonicRevocationAuthority } from "./revocation-authority.js";
import { ImmutablePackageStore, type ImmutablePackageRecord } from "./verified-package-store.js";
import { VerifiedPackageVerifier, type PackageInspection, type VerifiedPackage, type VerifyPackageRequest } from "./verified-package.js";

const UpdateStepSchema = z.enum([
  "requested", "verified", "grant_decided", "package_referenced", "data_inspected", "snapshot_created",
  "migration_validated", "candidate_started", "candidate_ready", "updating_committed", "old_tokens_revoked",
  "old_stopped", "candidate_registered", "runtime_authority_persisted", "pointer_switched", "completed",
  "snapshot_restored", "prior_restarted", "quarantined", "compensated",
]);
export type TransactionalUpdateStep = z.infer<typeof UpdateStepSchema>;

const UpdateJournalSchema = z.object({
  update_journal_version: z.literal(1),
  operation_id: OpaqueIdSchema,
  input_digest: Sha256DigestSchema,
  idempotency_key: z.string().min(16).max(256),
  owner_id: OpaqueIdSchema,
  actor_id: OpaqueIdSchema,
  installation_id: OpaqueIdSchema,
  kind: z.enum(["update", "rollback"]),
  prior_state: z.enum(["active", "disabled"]),
  prior_generation: z.number().int().nonnegative(),
  prior_package_digest: Sha256DigestSchema,
  prior_package_version: z.string(),
  prior_grant_id: OpaqueIdSchema,
  prior_package_ref_id: OpaqueIdSchema,
  candidate_package_digest: Sha256DigestSchema.nullable(),
  candidate_package_version: z.string().nullable(),
  candidate_grant_id: OpaqueIdSchema,
  candidate_package_ref_id: OpaqueIdSchema,
  cache_ref_id: OpaqueIdSchema,
  connection_id: OpaqueIdSchema,
  updating_transition_id: OpaqueIdSchema,
  switch_transition_id: OpaqueIdSchema,
  compensation_transition_id: OpaqueIdSchema,
  snapshot_id: OpaqueIdSchema.nullable(),
  target_snapshot_id: OpaqueIdSchema.nullable(),
  snapshot_digest: Sha256DigestSchema.nullable(),
  from_schema_version: z.number().int().positive().nullable(),
  to_schema_version: z.number().int().positive().nullable(),
  candidate_runtime: RuntimeIdentitySchema.nullable(),
  candidate_endpoint: z.unknown().nullable(),
  candidate_registration_id: OpaqueIdSchema.nullable(),
  completed_steps: z.array(UpdateStepSchema),
  status: z.enum(["running", "committed", "rolled_back", "quarantined", "failed_recoverable"]),
  error_code: z.string().nullable(),
  started_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();

type UpdateJournal = z.infer<typeof UpdateJournalSchema>;
type DataAdapter = ResumeLifecycleDataAdapter & {
  releaseSnapshot?(snapshotId: string): Promise<void>;
  listSnapshotIds?(): Promise<string[]>;
};

/** Test-only crash boundary used to prove durable restart reconciliation. */
export class SimulatedUpdateInterruption extends Error {
  constructor(readonly step: TransactionalUpdateStep) {
    super(`simulated update interruption after ${step}`);
    this.name = "SimulatedUpdateInterruption";
  }
}

export type UpdateInspection = {
  package: PackageInspection;
  version_decision: "newer" | "same_version" | "version_rollback";
  capability_diff: z.infer<typeof CapabilityDiffSchema>;
  data_decision: "compatible" | "migration_required" | "incompatible" | "missing" | "repair_required";
  observed_schema_version: number | null;
  target_schema_version: number;
};

export type TransactionalUpdateRequest = {
  operationId: string;
  idempotencyKey: string;
  ownerId: string;
  actorId: string;
  expectedPackageDigest: string;
  verification: VerifyPackageRequest;
  decide(inspection: UpdateInspection): Promise<OwnerGrantDecision> | OwnerGrantDecision;
};

export type TransactionalRollbackRequest = {
  operationId: string;
  idempotencyKey: string;
  ownerId: string;
  actorId: string;
  verification: VerifyPackageRequest;
  decide(inspection: UpdateInspection): Promise<OwnerGrantDecision> | OwnerGrantDecision;
};

export type TransactionalUpdateResult = {
  outcome: "active" | "rolled_back" | "quarantined";
  packageDigest: string;
  lastKnownGoodDigest: string | null;
  generation: number;
  checkpoint: "pending" | "passed" | null;
};

export type TransactionalUpdateDependencies = {
  verifier: Pick<VerifiedPackageVerifier, "verify">;
  packages: Pick<ImmutablePackageStore, "initialize" | "promote" | "acquire" | "release" | "read" | "resolveReferencedRuntime">;
  grants: InstallationGrantStore;
  lifecycle: LifecycleStore;
  supervisor: InstalledAppSupervisor;
  runtimeAuthority: RuntimeAuthorityStore;
  data: DataAdapter;
  revocations?: MonotonicRevocationAuthority;
  stateRoot: string;
  clock?: () => Date;
  ids?: { next(): string };
  beforeStep?(step: TransactionalUpdateStep): Promise<void> | void;
  audit?: (event: string, details: Record<string, unknown>) => void;
};

function compareSemver(left: string, right: string): number {
  const parse = (value: string): { core: number[]; pre: string[] | null } => {
    const [core, pre] = value.split("-", 2);
    return { core: core.split(".").map(Number), pre: pre ? pre.split(".") : null };
  };
  const a = parse(left); const b = parse(right);
  for (let index = 0; index < 3; index += 1) if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  if (a.pre === null || b.pre === null) return a.pre === b.pre ? 0 : a.pre === null ? 1 : -1;
  return a.pre.join(".").localeCompare(b.pre.join("."));
}

export function capabilityDiff(prior: readonly string[], requested: readonly string[]): z.infer<typeof CapabilityDiffSchema> {
  const priorSet = new Set(prior); const requestedSet = new Set(requested);
  const added = [...requestedSet].filter((value) => !priorSet.has(value)).sort();
  const removed = [...priorSet].filter((value) => !requestedSet.has(value)).sort();
  const unchanged = [...requestedSet].filter((value) => priorSet.has(value)).sort();
  return CapabilityDiffSchema.parse({ diff_version: 1, prior_capabilities: [...prior], requested_capabilities: [...requested], added, removed, unchanged, decision: added.length ? "owner_approval_required" : removed.length ? "narrowing_allowed" : "no_change" });
}

function transitionKey(kind: string, idempotencyKey: string): string {
  return `m5-${kind}-${createHash("sha256").update(idempotencyKey).digest("hex")}`;
}

async function writeAtomic(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(`${canonicalJson(value)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary, target); }
  catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error; }
}

export class TransactionalUpdateService {
  private readonly clock: () => Date;
  private readonly ids: { next(): string };
  private readonly journalsRoot: string;
  private readonly audit: NonNullable<TransactionalUpdateDependencies["audit"]>;

  constructor(private readonly dependencies: TransactionalUpdateDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.ids = dependencies.ids ?? { next: () => randomUUID() };
    this.journalsRoot = path.join(dependencies.stateRoot, "host-app-state", "update-operations");
    this.audit = dependencies.audit ?? (() => undefined);
  }

  async initialize(): Promise<void> {
    await Promise.all([this.dependencies.packages.initialize(), this.dependencies.grants.initialize(), this.dependencies.lifecycle.initialize(), this.dependencies.runtimeAuthority.initialize(), mkdir(this.journalsRoot, { recursive: true, mode: 0o700 })]);
  }

  async inspectUpdate(input: Omit<TransactionalUpdateRequest, "expectedPackageDigest" | "decide">): Promise<UpdateInspection> {
    await this.initialize();
    const state = await this.requireActive();
    const priorGrant = await this.requireGrant(state.grant_id!, state.installation_id!, state.active_package_digest!);
    const priorPackage = await this.dependencies.packages.read(state.active_package_digest!);
    const verified = await this.dependencies.verifier.verify(input.verification);
    try { return await this.inspectVerified(input, verified, priorPackage, priorGrant.capabilities); }
    finally { await rm(verified.stageRoot, { recursive: true, force: true }).catch(() => undefined); }
  }

  async update(input: TransactionalUpdateRequest): Promise<TransactionalUpdateResult> {
    await this.initialize();
    this.validateRequest(input);
    const existing = await this.readJournal(input.operationId);
    const inputDigest = canonicalInputDigest(this.stableInput("update", input));
    if (existing) {
      if (existing.input_digest !== inputDigest) throw new ContractViolation("idempotency_conflict", "Update operation was reused with different input");
      return this.resume(existing);
    }
    const prior = await this.requireActive();
    const priorSnapshot = await this.dependencies.lifecycle.readConsistentSnapshot();
    if (!priorSnapshot.active.package_ref_id) throw new ContractViolation("conflict", "Active package reference is unavailable");
    const priorPackage = await this.dependencies.packages.read(prior.active_package_digest!);
    const priorGrant = await this.requireGrant(prior.grant_id!, prior.installation_id!, prior.active_package_digest!);
    let journal = await this.createJournal("update", input, prior, priorPackage, priorSnapshot.active.package_ref_id, inputDigest);
    let lease: MutationLease | null = null;
    try {
      lease = await this.dependencies.lifecycle.acquireMutation(input.operationId);
      const verified = await this.dependencies.verifier.verify(input.verification);
      if (verified.packageDigest !== input.expectedPackageDigest) throw new ContractViolation("package_digest_mismatch", "Explicit update authority differs from inspected package digest");
      const inspection = await this.inspectVerified(input, verified, priorPackage, priorGrant.capabilities);
      if (inspection.version_decision !== "newer") throw new ContractViolation(inspection.version_decision === "same_version" ? "conflict" : "source_index_rollback", "Update version must be newer than the active version");
      journal = await this.advance(journal, "verified", { candidate_package_digest: verified.packageDigest, candidate_package_version: verified.manifest.package_version });
      const decision = await input.decide(inspection);
      const grant = this.dependencies.grants.decide({ grantId: journal.candidate_grant_id, ownerId: input.ownerId, actorId: input.actorId, installationId: prior.installation_id!, packageDigest: verified.packageDigest }, verified.manifest, decision);
      if (!grant) throw new ContractViolation("denied", "Owner denied replacement capability grant");
      await this.dependencies.grants.persist(grant);
      journal = await this.advance(journal, "grant_decided");
      const promoted = await this.dependencies.packages.promote(verified);
      await this.dependencies.packages.acquire(verified.packageDigest, journal.candidate_package_ref_id);
      journal = await this.advance(journal, "package_referenced");
      journal = await this.prepareData(journal, verified, input);
      const candidate = await this.startCandidate(journal, promoted, verified, grant.grant_id);
      journal = await this.advance(journal, "candidate_started", { candidate_runtime: candidate.runtime });
      const ready = await this.dependencies.supervisor.awaitReady({ supervisor_protocol_version: 1, operation_id: input.operationId, runtime: candidate.runtime!, deadline_at: new Date(this.clock().getTime() + SUPERVISOR_POLICY.startup_timeout_ms).toISOString() });
      if (ready.outcome !== "ready" || !ready.endpoint) throw new ContractViolation("readiness_failed", "Candidate readiness gate failed");
      journal = await this.advance(journal, "candidate_ready", { candidate_endpoint: ready.endpoint });
      if (this.dependencies.revocations) await this.dependencies.revocations.assertAllowed(verified.manifest.package_version, verified.packageDigest, { requireFresh: true });

      await this.commitChildTransition(journal.updating_transition_id, lease, input, "updating", { installation_id: prior.installation_id, active_package_digest: prior.active_package_digest, last_known_good_package_digest: prior.last_known_good_package_digest, grant_id: prior.grant_id });
      journal = await this.advance(journal, "updating_committed");
      const priorAuthority = await this.requireRuntimeAuthority(prior.installation_id!, prior.active_package_digest!);
      await this.revokeAndStop(journal, priorAuthority);
      journal = await this.advance(journal, "old_stopped");
      const registered = await this.dependencies.supervisor.register({ supervisor_protocol_version: 1, operation_id: input.operationId, runtime: candidate.runtime!, endpoint: ready.endpoint, connection_id: journal.connection_id });
      if (!registered.registration_id || !["registered", "already_registered"].includes(registered.outcome)) throw new ContractViolation("readiness_failed", "Candidate registration gate failed");
      journal = await this.advance(journal, "candidate_registered", { candidate_registration_id: registered.registration_id });
      await this.dependencies.runtimeAuthority.persist({ installation_id: prior.installation_id!, package_version: verified.manifest.package_version, package_digest: verified.packageDigest, grant_id: grant.grant_id, runtime: candidate.runtime!, registration_id: registered.registration_id, connection_id: journal.connection_id });
      journal = await this.advance(journal, "runtime_authority_persisted");
      const checkpoint = { checkpoint_version: 1 as const, package_digest: verified.packageDigest, status: "pending" as const, started_at: this.clock().toISOString(), completed_at: null, evidence_operation_id: null };
      const activeResult = await this.commitChildTransition(journal.switch_transition_id, lease, input, "active", { installation_id: prior.installation_id, active_package_digest: verified.packageDigest, last_known_good_package_digest: prior.active_package_digest, grant_id: grant.grant_id, successful_use_checkpoint: checkpoint }, [this.durableReference(journal.candidate_package_ref_id, promoted)]);
      journal = await this.advance(journal, "pointer_switched");
      journal = await this.finish(journal, "committed", null);
      this.emit("update", "committed", journal, null);
      return { outcome: "active", packageDigest: verified.packageDigest, lastKnownGoodDigest: prior.active_package_digest, generation: activeResult.final_generation, checkpoint: "pending" };
    } catch (error) {
      if (error instanceof SimulatedUpdateInterruption) throw error;
      if (lease) {
        try { await this.compensate(journal, lease); }
        catch { await this.enterFailedRecoverable(journal, lease).catch(() => undefined); }
      }
      const current = await this.dependencies.lifecycle.readState().catch(() => prior);
      if (current.state === "quarantined") {
        journal = await this.finish(journal, "quarantined", "package_revoked");
        return { outcome: "quarantined", packageDigest: current.active_package_digest!, lastKnownGoodDigest: current.last_known_good_package_digest, generation: current.generation, checkpoint: null };
      }
      if (current.state === "failed_recoverable") {
        await this.finish(journal, "failed_recoverable", "recoverable_internal_failure");
        throw new ContractViolation("recoverable_internal_failure", "Update compensation could not prove a safe active runtime");
      }
      journal = await this.finish(journal, "rolled_back", this.safeCode(error));
      this.emit("update", "rolled_back", journal, this.safeCode(error));
      if (error instanceof ContractViolation) throw error;
      throw new ContractViolation("recoverable_internal_failure", "Transactional update failed and was compensated");
    } finally {
      if (lease) await this.dependencies.lifecycle.releaseMutation(lease);
    }
  }

  async rollback(input: TransactionalRollbackRequest): Promise<TransactionalUpdateResult> {
    await this.initialize();
    this.validateRequest(input);
    const prior = await this.requireActive();
    if (!prior.last_known_good_package_digest) throw new ContractViolation("conflict", "No last-known-good package is retained");
    const pointers = await this.dependencies.lifecycle.readConsistentSnapshot();
    if (!pointers.active.package_ref_id || !pointers.lastKnownGood.package_ref_id) throw new ContractViolation("conflict", "Rollback package references are unavailable");
    const currentPackage = await this.dependencies.packages.read(prior.active_package_digest!);
    const target = await this.dependencies.packages.read(prior.last_known_good_package_digest);
    if (this.dependencies.revocations) await this.dependencies.revocations.assertAllowed(target.packageVersion, target.packageDigest, { requireFresh: false });
    const inputDigest = canonicalInputDigest(this.stableInput("rollback", input));
    const existing = await this.readJournal(input.operationId);
    if (existing) {
      if (existing.input_digest !== inputDigest) throw new ContractViolation("idempotency_conflict", "Rollback operation was reused with different input");
      return this.resume(existing);
    }
    const priorGrant = await this.requireGrant(prior.grant_id!, prior.installation_id!, prior.active_package_digest!);
    const request: TransactionalUpdateRequest = { ...input, expectedPackageDigest: target.packageDigest };
    let journal = await this.createJournal("rollback", request, prior, currentPackage, pointers.active.package_ref_id, inputDigest);
    journal = UpdateJournalSchema.parse({ ...journal, candidate_package_ref_id: pointers.lastKnownGood.package_ref_id });
    await this.writeJournal(journal);
    let lease: MutationLease | null = null;
    try {
      lease = await this.dependencies.lifecycle.acquireMutation(input.operationId);
      const verified = await this.dependencies.verifier.verify(input.verification);
      if (verified.packageDigest !== target.packageDigest) throw new ContractViolation("package_digest_mismatch", "Rollback verification differs from retained LKG");
      const inspection = await this.inspectVerified(input, verified, currentPackage, priorGrant.capabilities);
      if (inspection.version_decision !== "version_rollback") throw new ContractViolation("conflict", "Rollback target must be older than the active version");
      journal = await this.advance(journal, "verified", { candidate_package_digest: verified.packageDigest, candidate_package_version: verified.manifest.package_version });
      const decision = await input.decide(inspection);
      const grant = this.dependencies.grants.decide({ grantId: journal.candidate_grant_id, ownerId: input.ownerId, actorId: input.actorId, installationId: prior.installation_id!, packageDigest: verified.packageDigest }, verified.manifest, decision);
      if (!grant) throw new ContractViolation("denied", "Owner denied rollback capability grant");
      await this.dependencies.grants.persist(grant);
      journal = await this.advance(journal, "grant_decided");
      await rm(verified.stageRoot, { recursive: true, force: true }).catch(() => undefined);
      journal = await this.advance(journal, "package_referenced");
      journal = await this.prepareRollbackData(journal, verified, input);
      const candidate = await this.startCandidate(journal, target, verified, grant.grant_id);
      journal = await this.advance(journal, "candidate_started", { candidate_runtime: candidate.runtime });
      const ready = await this.dependencies.supervisor.awaitReady({ supervisor_protocol_version: 1, operation_id: input.operationId, runtime: candidate.runtime!, deadline_at: new Date(this.clock().getTime() + SUPERVISOR_POLICY.startup_timeout_ms).toISOString() });
      if (ready.outcome !== "ready" || !ready.endpoint) throw new ContractViolation("readiness_failed", "Rollback candidate readiness gate failed");
      journal = await this.advance(journal, "candidate_ready", { candidate_endpoint: ready.endpoint });
      await this.commitChildTransition(journal.updating_transition_id, lease, input, "rollback_pending", { installation_id: prior.installation_id, active_package_digest: prior.active_package_digest, last_known_good_package_digest: prior.last_known_good_package_digest, grant_id: prior.grant_id });
      journal = await this.advance(journal, "updating_committed");
      await this.revokeAndStop(journal, await this.requireRuntimeAuthority(prior.installation_id!, prior.active_package_digest!));
      journal = await this.advance(journal, "old_stopped");
      const registered = await this.dependencies.supervisor.register({ supervisor_protocol_version: 1, operation_id: input.operationId, runtime: candidate.runtime!, endpoint: ready.endpoint, connection_id: journal.connection_id });
      if (!registered.registration_id) throw new ContractViolation("readiness_failed", "Rollback candidate registration failed");
      journal = await this.advance(journal, "candidate_registered", { candidate_registration_id: registered.registration_id });
      await this.dependencies.runtimeAuthority.persist({ installation_id: prior.installation_id!, package_version: target.packageVersion, package_digest: target.packageDigest, grant_id: grant.grant_id, runtime: candidate.runtime!, registration_id: registered.registration_id, connection_id: journal.connection_id });
      journal = await this.advance(journal, "runtime_authority_persisted");
      const checkpoint = { checkpoint_version: 1 as const, package_digest: target.packageDigest, status: "pending" as const, started_at: this.clock().toISOString(), completed_at: null, evidence_operation_id: null };
      const result = await this.commitChildTransition(journal.switch_transition_id, lease, input, "active", { installation_id: prior.installation_id, active_package_digest: target.packageDigest, last_known_good_package_digest: prior.active_package_digest, grant_id: grant.grant_id, successful_use_checkpoint: checkpoint });
      journal = await this.advance(journal, "pointer_switched");
      await this.finish(journal, "committed", null);
      this.emit("rollback", "committed", journal, null);
      return { outcome: "rolled_back", packageDigest: target.packageDigest, lastKnownGoodDigest: prior.active_package_digest, generation: result.final_generation, checkpoint: "pending" };
    } catch (error) {
      if (error instanceof SimulatedUpdateInterruption) throw error;
      if (lease) {
        try { await this.compensate(journal, lease); }
        catch { await this.enterFailedRecoverable(journal, lease).catch(() => undefined); }
      }
      await this.finish(journal, "rolled_back", this.safeCode(error));
      if (error instanceof ContractViolation) throw error;
      throw new ContractViolation("recoverable_internal_failure", "Transactional rollback failed and was compensated");
    } finally { if (lease) await this.dependencies.lifecycle.releaseMutation(lease); }
  }

  async recordSuccessfulUse(input: { operationId: string; idempotencyKey: string; ownerId: string; actorId: string; evidenceOperationId: string }): Promise<TransactionalUpdateResult> {
    await this.initialize();
    const state = await this.requireActive();
    if (!state.successful_use_checkpoint || state.successful_use_checkpoint.status !== "pending") throw new ContractViolation("conflict", "No successful-use checkpoint is pending");
    const result = await this.dependencies.lifecycle.executeTransition({ operationId: input.operationId, idempotencyKey: input.idempotencyKey, canonicalInput: { action: "successful_use", evidence_operation_id: input.evidenceOperationId, package_digest: state.active_package_digest }, ownerId: input.ownerId, actorId: input.actorId, kind: "update", to: "active", authority: { successful_use_checkpoint: { ...state.successful_use_checkpoint, status: "passed", completed_at: this.clock().toISOString(), evidence_operation_id: input.evidenceOperationId } } });
    await this.cleanupAcceptedQuota(state.active_package_digest!, state.last_known_good_package_digest);
    this.audit("app.update.checkpoint", { operation_id: input.operationId, installation_id: state.installation_id, package_digest: state.active_package_digest, evidence_operation_id: input.evidenceOperationId, outcome: "passed" });
    return { outcome: "active", packageDigest: state.active_package_digest!, lastKnownGoodDigest: state.last_known_good_package_digest, generation: result.final_generation, checkpoint: "passed" };
  }

  async enforceRevocations(input: { operationId: string; idempotencyKey: string; ownerId: string; actorId: string; externalStatus?: "online" | "offline" }): Promise<TransactionalUpdateResult | null> {
    if (!this.dependencies.revocations) return null;
    await this.initialize();
    const state = await this.dependencies.lifecycle.readState();
    if (!state.installation_id || !state.active_package_digest || !["active", "disabled", "updating", "rollback_pending"].includes(state.state)) return null;
    const stored = await this.dependencies.packages.read(state.active_package_digest);
    const status = await this.dependencies.revocations.status(stored.packageVersion, stored.packageDigest, input.externalStatus ?? "online");
    this.audit("app.revocation.match", { operation_id: input.operationId, installation_id: state.installation_id, package_digest: stored.packageDigest, sequence: status.sequence, cache_state: status.cache_state, external_status: status.external_status, explicitly_revoked: status.explicitly_revoked, matched_count: status.matched_revocation_ids.length });
    if (!status.explicitly_revoked) return null;
    const lease = await this.dependencies.lifecycle.acquireMutation(input.operationId);
    try {
      const authority = await this.dependencies.runtimeAuthority.read(state.installation_id);
      if (authority) await this.revokeAndStop({ operation_id: input.operationId } as UpdateJournal, authority).catch(() => undefined);
      await this.dependencies.supervisor.cleanup({ supervisor_protocol_version: 1, operation_id: input.operationId, installation_id: state.installation_id, expected_runtime_id: authority?.runtime.runtime_id ?? null, observed_runtime_ids: authority ? [authority.runtime.runtime_id] : [], requested_at: this.clock().toISOString() });
      await this.dependencies.runtimeAuthority.remove(state.installation_id);
      const transitionId = this.ids.next();
      const result = await this.commitChildTransition(transitionId, lease, input, "quarantined", { installation_id: state.installation_id, active_package_digest: state.active_package_digest, last_known_good_package_digest: state.last_known_good_package_digest, grant_id: state.grant_id });
      this.audit("app.revocation.quarantine", { operation_id: input.operationId, installation_id: state.installation_id, package_digest: state.active_package_digest, outcome: "quarantined" });
      return { outcome: "quarantined", packageDigest: state.active_package_digest, lastKnownGoodDigest: state.last_known_good_package_digest, generation: result.final_generation, checkpoint: null };
    } finally { await this.dependencies.lifecycle.releaseMutation(lease); }
  }

  async reconcile(): Promise<number> {
    await this.initialize();
    const names = (await readdir(this.journalsRoot)).filter((name) => name.endsWith(".json")).sort();
    let recovered = 0;
    for (const name of names) {
      const journal = UpdateJournalSchema.parse(JSON.parse(await readFile(path.join(this.journalsRoot, name), "utf8")));
      if (journal.status !== "running") continue;
      await this.resume(journal).catch(() => undefined);
      recovered += 1;
    }
    return recovered;
  }

  private async inspectVerified(input: { operationId: string; ownerId: string; actorId: string }, verified: VerifiedPackage, priorPackage: ImmutablePackageRecord, priorCapabilities: readonly string[]): Promise<UpdateInspection> {
    const versionComparison = compareSemver(verified.manifest.package_version, priorPackage.packageVersion);
    const context = this.dataContext(input, verified.packageDigest);
    const data = await this.dependencies.data.inspectSchema({ action: "inspect_schema", context });
    const compatibility = verified.manifest.compatibility.data_schema;
    const observed = data.observed_schema_version;
    const dataDecision: UpdateInspection["data_decision"] = data.outcome === "missing" ? "missing" : data.outcome === "repair_required" ? "repair_required" : data.outcome === "incompatible" || observed === null || observed < compatibility.read_min || observed > compatibility.read_max ? "incompatible" : observed === compatibility.write_version ? "compatible" : "migration_required";
    return { package: verified.inspection, version_decision: versionComparison > 0 ? "newer" : versionComparison === 0 ? "same_version" : "version_rollback", capability_diff: capabilityDiff(priorCapabilities, verified.manifest.requested_capabilities), data_decision: dataDecision, observed_schema_version: observed, target_schema_version: compatibility.write_version };
  }

  private async prepareData(journalInput: UpdateJournal, verified: VerifiedPackage, input: TransactionalUpdateRequest): Promise<UpdateJournal> {
    let journal = await this.advance(journalInput, "data_inspected");
    const context = this.dataContext({ ...input, installation_id: journal.installation_id }, verified.packageDigest);
    const inspected = await this.dependencies.data.inspectSchema({ action: "inspect_schema", context });
    if (inspected.outcome === "repair_required" || inspected.outcome === "incompatible") throw new ContractViolation("incompatible_schema", "Retained data is not safe for update");
    if (inspected.outcome === "missing") return journal;
    const target = verified.manifest.compatibility.data_schema;
    if (inspected.observed_schema_version === null || inspected.observed_schema_version < target.read_min || inspected.observed_schema_version > target.read_max) throw new ContractViolation("incompatible_schema", "Candidate cannot read retained data schema");
    if (inspected.observed_schema_version === target.write_version) return journal;
    const snapshot = await this.dependencies.data.snapshot({ action: "snapshot", context, from_schema_version: inspected.observed_schema_version, to_schema_version: target.write_version });
    journal = await this.advance(journal, "snapshot_created", { snapshot_id: snapshot.snapshot_id, snapshot_digest: snapshot.snapshot_digest, from_schema_version: inspected.observed_schema_version, to_schema_version: target.write_version });
    const migration = await this.dependencies.data.migrate({ action: "migrate", context, snapshot_id: snapshot.snapshot_id, from_schema_version: inspected.observed_schema_version, to_schema_version: target.write_version });
    const after = await this.dependencies.data.inspectSchema({ action: "inspect_schema", context });
    if (after.outcome !== "compatible" || after.observed_schema_version !== target.write_version || after.content_digest !== migration.result_digest) throw new ContractViolation("validation_failed", "Migrated data failed post-migration validation");
    return this.advance(journal, "migration_validated");
  }

  private async prepareRollbackData(journalInput: UpdateJournal, verified: VerifiedPackage, input: TransactionalRollbackRequest): Promise<UpdateJournal> {
    let journal = await this.advance(journalInput, "data_inspected");
    const context = this.dataContext({ ...input, installation_id: journal.installation_id }, verified.packageDigest);
    const inspected = await this.dependencies.data.inspectSchema({ action: "inspect_schema", context });
    if (inspected.outcome === "missing") return journal;
    if (inspected.outcome !== "compatible" || inspected.observed_schema_version === null) throw new ContractViolation("incompatible_schema", "Current retained data is unsafe for rollback");
    const target = verified.manifest.compatibility.data_schema;
    if (inspected.observed_schema_version === target.write_version) return journal;
    const priorUpdate = await this.findRecoveryJournal(journal.prior_package_digest, verified.packageDigest);
    if (!priorUpdate?.snapshot_id) throw new ContractViolation("incompatible_schema", "Rollback requires a retained compatible pre-migration snapshot");
    const recovery = await this.dependencies.data.snapshot({ action: "snapshot", context, from_schema_version: inspected.observed_schema_version, to_schema_version: target.write_version });
    journal = await this.advance(journal, "snapshot_created", { snapshot_id: recovery.snapshot_id, target_snapshot_id: priorUpdate.snapshot_id, snapshot_digest: recovery.snapshot_digest, from_schema_version: inspected.observed_schema_version, to_schema_version: target.write_version });
    const restored = await this.dependencies.data.restore({ action: "restore", context, snapshot_id: priorUpdate.snapshot_id });
    if (restored.restored_schema_version !== target.write_version) throw new ContractViolation("validation_failed", "Rollback snapshot schema differs from target package");
    const after = await this.dependencies.data.inspectSchema({ action: "inspect_schema", context });
    if (after.outcome !== "compatible" || after.observed_schema_version !== target.write_version || after.content_digest !== restored.restored_digest) throw new ContractViolation("validation_failed", "Rollback data restore did not validate");
    return this.advance(journal, "migration_validated");
  }

  private async findRecoveryJournal(activeDigest: string, targetDigest: string): Promise<UpdateJournal | null> {
    const names = (await readdir(this.journalsRoot)).filter((name) => name.endsWith(".json")).sort().reverse();
    for (const name of names) {
      const journal = UpdateJournalSchema.parse(JSON.parse(await readFile(path.join(this.journalsRoot, name), "utf8")));
      if (journal.status === "committed" && journal.candidate_package_digest === activeDigest && journal.prior_package_digest === targetDigest && journal.snapshot_id) return journal;
    }
    return null;
  }

  private async startCandidate(journal: UpdateJournal, stored: ImmutablePackageRecord, verified: VerifiedPackage, grantId: string) {
    const desktop = stored.target !== "docker_linux_x64";
    const started = await this.dependencies.supervisor.start({ supervisor_protocol_version: 1, operation_id: journal.operation_id, runtime_role: "candidate", descriptor: { supervisor_protocol_version: 1, runtime_kind: desktop ? "packaged_node" : "container", app_id: RESUME_BUILDER_APP_ID, installation_id: journal.installation_id, package_digest: verified.packageDigest, grant_id: grantId, verified_entrypoint: stored.entrypoint, arguments: [], environment_keys: ["BRAINDRIVE_APP_CONNECTION_TOKEN", "BRAINDRIVE_APP_ID", "BRAINDRIVE_INSTALLATION_ID", "BRAINDRIVE_PACKAGE_DIGEST", "BRAINDRIVE_ENDPOINT_BIND"], package_root_ref: journal.candidate_package_ref_id, cache_root_ref: journal.cache_ref_id, endpoint_policy: { transport: desktop ? "loopback" : "container_internal", authentication: "per_installation_token", public_bind_allowed: false }, resource_policy_version: 1 }, policy: SUPERVISOR_POLICY, requested_at: this.clock().toISOString() });
    if (!started.runtime || !["started", "already_running"].includes(started.outcome)) throw new ContractViolation("ambiguous_runtime_state", "Candidate start did not prove an exact runtime");
    return started;
  }

  private async revokeAndStop(journal: Pick<UpdateJournal, "operation_id">, authority: RuntimeAuthorityRecord): Promise<void> {
    const revoked = await this.dependencies.supervisor.revokeTokens({ supervisor_protocol_version: 1, operation_id: journal.operation_id, installation_id: authority.installation_id, runtime_id: authority.runtime.runtime_id, operation_scope_id: journal.operation_id, prior_token_generation: authority.runtime.endpoint_token_generation });
    if (revoked.outcome === "failed") throw new ContractViolation("stop_unacknowledged", "Prior runtime tokens could not be revoked");
    const stopped = await this.dependencies.supervisor.stop({ supervisor_protocol_version: 1, operation_id: journal.operation_id, runtime: authority.runtime, reason: "update", grace_deadline_at: new Date(this.clock().getTime() + 5_000).toISOString() });
    if (!stopped.termination_acknowledged) throw new ContractViolation("ambiguous_runtime_state", "Prior runtime stop was ambiguous");
  }

  private async compensate(journalInput: UpdateJournal, lease: MutationLease): Promise<void> {
    let journal = await this.readJournal(journalInput.operation_id) ?? journalInput;
    const current = await this.dependencies.lifecycle.readState();
    if (current.state === "active" && current.active_package_digest === journal.candidate_package_digest) return;
    if (journal.candidate_runtime) {
      await this.dependencies.supervisor.stop({ supervisor_protocol_version: 1, operation_id: journal.operation_id, runtime: journal.candidate_runtime, reason: "reconcile", grace_deadline_at: new Date(this.clock().getTime() + 5_000).toISOString() }).catch(() => undefined);
    }
    if (journal.snapshot_id) {
      const restored = await this.dependencies.data.restore({ action: "restore", context: this.dataContext(journal, journal.prior_package_digest), snapshot_id: journal.snapshot_id });
      if (restored.restored_digest !== journal.snapshot_digest) throw new ContractViolation("validation_failed", "Compensation restore digest differs from update snapshot");
      journal = await this.advance(journal, "snapshot_restored");
    }
    if (current.state === "updating" || current.state === "rollback_pending") {
      const priorStored = await this.dependencies.packages.read(journal.prior_package_digest);
      await this.commitChildTransition(journal.compensation_transition_id, lease, { operationId: journal.operation_id, idempotencyKey: journal.idempotency_key, ownerId: journal.owner_id, actorId: journal.actor_id }, "active", { installation_id: journal.installation_id, active_package_digest: journal.prior_package_digest, last_known_good_package_digest: current.last_known_good_package_digest, grant_id: journal.prior_grant_id, successful_use_checkpoint: null });
      await this.dependencies.runtimeAuthority.remove(journal.installation_id).catch(() => undefined);
      await this.restartPrior(journal, priorStored);
      journal = await this.advance(journal, "prior_restarted");
    }
    if (journal.kind === "update" && journal.candidate_package_digest) await this.dependencies.packages.release(journal.candidate_package_digest, journal.candidate_package_ref_id).catch(() => undefined);
    await this.dependencies.grants.remove(journal.candidate_grant_id).catch(() => undefined);
    await this.advance(journal, "compensated");
  }

  private async restartPrior(journal: UpdateJournal, stored: ImmutablePackageRecord): Promise<void> {
    const desktop = stored.target !== "docker_linux_x64";
    const started = await this.dependencies.supervisor.start({ supervisor_protocol_version: 1, operation_id: journal.operation_id, descriptor: { supervisor_protocol_version: 1, runtime_kind: desktop ? "packaged_node" : "container", app_id: RESUME_BUILDER_APP_ID, installation_id: journal.installation_id, package_digest: journal.prior_package_digest, grant_id: journal.prior_grant_id, verified_entrypoint: stored.entrypoint, arguments: [], environment_keys: ["BRAINDRIVE_APP_CONNECTION_TOKEN", "BRAINDRIVE_APP_ID", "BRAINDRIVE_INSTALLATION_ID", "BRAINDRIVE_PACKAGE_DIGEST", "BRAINDRIVE_ENDPOINT_BIND"], package_root_ref: journal.prior_package_ref_id, cache_root_ref: this.ids.next(), endpoint_policy: { transport: desktop ? "loopback" : "container_internal", authentication: "per_installation_token", public_bind_allowed: false }, resource_policy_version: 1 }, policy: SUPERVISOR_POLICY, requested_at: this.clock().toISOString() });
    if (!started.runtime) throw new ContractViolation("ambiguous_runtime_state", "Prior runtime restart failed");
    const ready = await this.dependencies.supervisor.awaitReady({ supervisor_protocol_version: 1, operation_id: journal.operation_id, runtime: started.runtime, deadline_at: new Date(this.clock().getTime() + SUPERVISOR_POLICY.startup_timeout_ms).toISOString() });
    if (!ready.endpoint) throw new ContractViolation("readiness_failed", "Prior runtime did not recover readiness");
    const connectionId = this.ids.next();
    const registered = await this.dependencies.supervisor.register({ supervisor_protocol_version: 1, operation_id: journal.operation_id, runtime: started.runtime, endpoint: ready.endpoint, connection_id: connectionId });
    if (!registered.registration_id) throw new ContractViolation("readiness_failed", "Prior runtime registration did not recover");
    await this.dependencies.runtimeAuthority.persist({ installation_id: journal.installation_id, package_version: stored.packageVersion, package_digest: journal.prior_package_digest, grant_id: journal.prior_grant_id, runtime: started.runtime, registration_id: registered.registration_id, connection_id: connectionId });
  }

  private async enterFailedRecoverable(journal: UpdateJournal, lease: MutationLease): Promise<void> {
    const authority = await this.dependencies.runtimeAuthority.read(journal.installation_id).catch(() => null);
    if (authority) await this.revokeAndStop(journal, authority).catch(() => undefined);
    const observed = authority ? [authority.runtime.runtime_id] : [];
    await this.dependencies.supervisor.cleanup({ supervisor_protocol_version: 1, operation_id: journal.operation_id, installation_id: journal.installation_id, expected_runtime_id: authority?.runtime.runtime_id ?? null, observed_runtime_ids: observed, requested_at: this.clock().toISOString() }).catch(() => undefined);
    await this.dependencies.runtimeAuthority.remove(journal.installation_id).catch(() => undefined);
    const state = await this.dependencies.lifecycle.readState();
    if (state.state !== "failed_recoverable" && state.state !== "quarantined") {
      await this.commitChildTransition(this.ids.next(), lease, { operationId: journal.operation_id, idempotencyKey: journal.idempotency_key, ownerId: journal.owner_id, actorId: journal.actor_id }, "failed_recoverable", { installation_id: state.installation_id, active_package_digest: state.active_package_digest, last_known_good_package_digest: state.last_known_good_package_digest, grant_id: state.grant_id });
    }
  }

  private async commitChildTransition(operationId: string, lease: MutationLease, input: { operationId: string; idempotencyKey: string; ownerId: string; actorId: string }, to: "updating" | "rollback_pending" | "active" | "quarantined" | "failed_recoverable", authority: Record<string, unknown>, packageReferences: DurablePackageReference[] = []) {
    await this.dependencies.lifecycle.prepareTransition({ operationId, leaseOperationId: input.operationId, idempotencyKey: transitionKey(to, input.idempotencyKey), canonicalInput: { parent_operation_id: input.operationId, to, authority }, ownerId: input.ownerId, actorId: input.actorId, kind: to === "rollback_pending" ? "rollback" : to === "quarantined" ? "quarantine" : "update", to, authority, packageReferences }, lease);
    return this.dependencies.lifecycle.commitPrepared(operationId, lease, {}, input.operationId);
  }

  private dataContext(input: { operationId?: string; operation_id?: string; ownerId?: string; owner_id?: string; installation_id?: string }, packageDigest: string) {
    return { adapter_contract_version: 1 as const, operation_id: input.operationId ?? input.operation_id!, owner_id: input.ownerId ?? input.owner_id!, installation_id: input.installation_id ?? (input as { installationId?: string }).installationId ?? "00000000-0000-4000-8000-000000000000", app_id: RESUME_BUILDER_APP_ID, package_digest: Sha256DigestSchema.parse(packageDigest), requested_at: this.clock().toISOString() };
  }

  private durableReference(referenceId: string, stored: ImmutablePackageRecord): DurablePackageReference { return { package_reference_version: 1, package_ref_id: referenceId, app_id: RESUME_BUILDER_APP_ID, package_digest: stored.packageDigest, package_version: stored.packageVersion, cache_key: stored.packageDigest.slice(7, 23), created_at: this.clock().toISOString() }; }

  private async createJournal(kind: "update" | "rollback", input: TransactionalUpdateRequest, prior: Awaited<ReturnType<LifecycleStore["readState"]>>, priorPackage: ImmutablePackageRecord, priorRefId: string, inputDigest: string): Promise<UpdateJournal> {
    const now = this.clock().toISOString();
    const journal = UpdateJournalSchema.parse({ update_journal_version: 1, operation_id: input.operationId, input_digest: inputDigest, idempotency_key: input.idempotencyKey, owner_id: input.ownerId, actor_id: input.actorId, installation_id: prior.installation_id, kind, prior_state: prior.state, prior_generation: prior.generation, prior_package_digest: prior.active_package_digest, prior_package_version: priorPackage.packageVersion, prior_grant_id: prior.grant_id, prior_package_ref_id: priorRefId, candidate_package_digest: null, candidate_package_version: null, candidate_grant_id: this.ids.next(), candidate_package_ref_id: this.ids.next(), cache_ref_id: this.ids.next(), connection_id: this.ids.next(), updating_transition_id: this.ids.next(), switch_transition_id: this.ids.next(), compensation_transition_id: this.ids.next(), snapshot_id: null, target_snapshot_id: null, snapshot_digest: null, from_schema_version: null, to_schema_version: null, candidate_runtime: null, candidate_endpoint: null, candidate_registration_id: null, completed_steps: ["requested"], status: "running", error_code: null, started_at: now, updated_at: now });
    await this.writeJournal(journal); return journal;
  }

  private async advance(journalInput: UpdateJournal, step: TransactionalUpdateStep, patch: Partial<UpdateJournal> = {}): Promise<UpdateJournal> {
    const journal = UpdateJournalSchema.parse({ ...journalInput, ...patch, completed_steps: journalInput.completed_steps.includes(step) ? journalInput.completed_steps : [...journalInput.completed_steps, step], updated_at: this.clock().toISOString() });
    await this.writeJournal(journal);
    await this.dependencies.beforeStep?.(step);
    return journal;
  }

  private async finish(journalInput: UpdateJournal, status: UpdateJournal["status"], errorCode: string | null): Promise<UpdateJournal> { const journal = UpdateJournalSchema.parse({ ...journalInput, status, error_code: errorCode, completed_steps: status === "committed" && !journalInput.completed_steps.includes("completed") ? [...journalInput.completed_steps, "completed"] : journalInput.completed_steps, updated_at: this.clock().toISOString() }); await this.writeJournal(journal); return journal; }
  private async readJournal(operationId: string): Promise<UpdateJournal | null> { try { return UpdateJournalSchema.parse(JSON.parse(await readFile(path.join(this.journalsRoot, `${operationId}.json`), "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } }
  private writeJournal(journal: UpdateJournal): Promise<void> { return writeAtomic(path.join(this.journalsRoot, `${journal.operation_id}.json`), journal); }

  private async resume(journal: UpdateJournal): Promise<TransactionalUpdateResult> {
    const state = await this.dependencies.lifecycle.readState();
    if (journal.status === "committed" || (state.state === "active" && state.active_package_digest === journal.candidate_package_digest)) {
      if (journal.status === "running") await this.finish(journal, "committed", null);
      return { outcome: "active", packageDigest: state.active_package_digest!, lastKnownGoodDigest: state.last_known_good_package_digest, generation: state.generation, checkpoint: state.successful_use_checkpoint?.status === "failed" ? null : state.successful_use_checkpoint?.status ?? null };
    }
    if (journal.status === "quarantined" || state.state === "quarantined") return { outcome: "quarantined", packageDigest: state.active_package_digest!, lastKnownGoodDigest: state.last_known_good_package_digest, generation: state.generation, checkpoint: null };
    const lease = await this.dependencies.lifecycle.acquireMutation(journal.operation_id);
    try { await this.compensate(journal, lease); await this.finish(journal, "rolled_back", "recoverable_internal_failure"); }
    finally { await this.dependencies.lifecycle.releaseMutation(lease); }
    throw new ContractViolation("recoverable_internal_failure", "Interrupted update was restored to its prior safe state");
  }

  private async cleanupAcceptedQuota(activeDigest: string, lastKnownGoodDigest: string | null): Promise<void> {
    const retainedDigests = new Set([activeDigest, lastKnownGoodDigest].filter((value): value is string => value !== null));
    const journals = await this.readAllJournals();
    const recovery = journals
      .filter((journal) => journal.status === "committed" && journal.candidate_package_digest === activeDigest && journal.prior_package_digest === lastKnownGoodDigest)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];

    if (this.dependencies.data.listSnapshotIds && this.dependencies.data.releaseSnapshot) {
      const retainedSnapshotId = recovery?.snapshot_id ?? recovery?.target_snapshot_id ?? null;
      for (const snapshotId of await this.dependencies.data.listSnapshotIds()) {
        if (snapshotId !== retainedSnapshotId) await this.dependencies.data.releaseSnapshot(snapshotId);
      }
    }

    for (const journal of journals) {
      if (journal.kind !== "update" || !journal.candidate_package_digest || retainedDigests.has(journal.candidate_package_digest)) continue;
      await this.dependencies.packages.release(journal.candidate_package_digest, journal.candidate_package_ref_id).catch(() => undefined);
    }
  }

  private async readAllJournals(): Promise<UpdateJournal[]> {
    const names = (await readdir(this.journalsRoot)).filter((name) => name.endsWith(".json")).sort();
    return Promise.all(names.map(async (name) => UpdateJournalSchema.parse(JSON.parse(await readFile(path.join(this.journalsRoot, name), "utf8")))));
  }

  private async requireActive() { const state = await this.dependencies.lifecycle.readState(); if (state.state !== "active" || !state.installation_id || !state.active_package_digest || !state.grant_id) throw new ContractViolation("invalid_state_transition", "Transactional lifecycle action requires active state"); return state; }
  private async requireGrant(grantId: string, installationId: string, packageDigest: string) { const grant = await this.dependencies.grants.read(grantId); if (!grant || grant.installation_id !== installationId || grant.package_digest !== packageDigest || grant.revoked_at !== null || Date.parse(grant.expires_at) <= this.clock().getTime()) throw new ContractViolation("denied", "Active grant authority is missing, expired, revoked, or mismatched"); return grant; }
  private async requireRuntimeAuthority(installationId: string, packageDigest: string) { const authority = await this.dependencies.runtimeAuthority.read(installationId); if (!authority || authority.package_digest !== packageDigest) throw new ContractViolation("ambiguous_runtime_state", "Active runtime authority is missing or mismatched"); return authority; }
  private validateRequest(input: { operationId: string; idempotencyKey: string; ownerId: string; actorId: string }) { OpaqueIdSchema.parse(input.operationId); OpaqueIdSchema.parse(input.ownerId); OpaqueIdSchema.parse(input.actorId); if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 256) throw new ContractViolation("invalid_input", "Lifecycle idempotency key is outside its accepted boundary"); }
  private stableInput(kind: string, input: { operationId: string; idempotencyKey: string; ownerId: string; actorId: string; verification: VerifyPackageRequest }) { return { kind, operation_id: input.operationId, idempotency_key: input.idempotencyKey, owner_id: input.ownerId, actor_id: input.actorId, version: input.verification.version, environment: input.verification.environment, target: input.verification.target }; }
  private safeCode(error: unknown): string { return error instanceof ContractViolation ? error.code : "recoverable_internal_failure"; }
  private emit(action: string, outcome: string, journal: UpdateJournal, errorCode: string | null) { this.audit("app.lifecycle.operation", { action, outcome, operation_id: journal.operation_id, installation_id: journal.installation_id, prior_package_digest: journal.prior_package_digest, candidate_package_digest: journal.candidate_package_digest, snapshot_id: journal.snapshot_id, snapshot_digest: journal.snapshot_digest, from_schema_version: journal.from_schema_version, to_schema_version: journal.to_schema_version, error_code: errorCode }); }
}
