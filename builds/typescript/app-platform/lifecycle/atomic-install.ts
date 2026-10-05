import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { canonicalInputDigest, canonicalJson, OpaqueIdSchema, TimestampSchema } from "../contracts/common.js";
import { ContractViolation } from "../contracts/errors.js";
import { SUPERVISOR_POLICY } from "../contracts/package.js";
import {
  RuntimeIdentitySchema,
  type InstalledAppSupervisor,
} from "../contracts/supervisor.js";
import { LifecycleStore, type DurablePackageReference, type LifecycleMutationHooks } from "./durable-store.js";
import { syncDirectoryEntry } from "./filesystem-durability.js";
import { InstallationGrantStore, type OwnerGrantDecision } from "./install-grants.js";
import { RuntimeAuthorityStore } from "./runtime-authority-store.js";
import {
  ImmutablePackageStore,
  type ImmutablePackageRecord,
} from "./verified-package-store.js";
import {
  VerifiedPackageVerifier,
  type PackageInspection,
  type VerifiedPackage,
  type VerifyPackageRequest,
} from "./verified-package.js";

const InstallStepSchema = z.enum([
  "requested",
  "verified",
  "promoted",
  "owner_approved",
  "package_referenced",
  "staged_committed",
  "supervisor_started",
  "readiness_passed",
  "registration_completed",
  "runtime_authority_persisted",
  "grant_persisted",
  "active_committed",
  "compensated",
]);
export type AtomicInstallStep = z.infer<typeof InstallStepSchema>;

const AtomicInstallJournalSchema = z.object({
  install_journal_version: z.literal(1),
  operation_id: OpaqueIdSchema,
  input_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  owner_id: OpaqueIdSchema,
  actor_id: OpaqueIdSchema,
  installation_id: OpaqueIdSchema,
  grant_id: OpaqueIdSchema,
  decision_id: OpaqueIdSchema,
  package_reference_id: OpaqueIdSchema,
  cache_reference_id: OpaqueIdSchema,
  staged_operation_id: OpaqueIdSchema,
  active_operation_id: OpaqueIdSchema,
  compensation_operation_id: OpaqueIdSchema,
  package_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  package_version: z.string().nullable(),
  runtime: RuntimeIdentitySchema.nullable(),
  endpoint_id: OpaqueIdSchema.nullable(),
  registration_id: OpaqueIdSchema.nullable(),
  completed_steps: z.array(InstallStepSchema),
  status: z.enum(["running", "completed", "denied", "failed"]),
  error_code: z.string().nullable(),
  started_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();

type AtomicInstallJournal = z.infer<typeof AtomicInstallJournalSchema>;

export type AtomicInstallResult = {
  outcome: "active" | "denied";
  inspection: PackageInspection;
  installationId: string | null;
  grantId: string | null;
  packageDigest: `sha256:${string}`;
  generation: number;
};

export type AtomicInstallRequest = {
  operationId: string;
  idempotencyKey: string;
  ownerId: string;
  actorId: string;
  verification: VerifyPackageRequest;
  decide(inspection: PackageInspection): Promise<OwnerGrantDecision> | OwnerGrantDecision;
};

export type AtomicInstallDependencies = {
  verifier: VerifiedPackageVerifier;
  packages: ImmutablePackageStore;
  grants: InstallationGrantStore;
  lifecycle: LifecycleStore;
  supervisor: InstalledAppSupervisor;
  stateRoot: string;
  clock?: () => Date;
  ids?: { next(): string };
  beforeStep?(step: AtomicInstallStep): Promise<void> | void;
  activeTransitionHooks?: LifecycleMutationHooks;
  runtimeAuthority?: RuntimeAuthorityStore;
};

export class SimulatedInstallInterruption extends Error {
  constructor(public readonly step: AtomicInstallStep) {
    super(`simulated interruption at ${step}`);
  }
}

function stableSourceInput(request: AtomicInstallRequest): unknown {
  return {
    operation_id: request.operationId,
    idempotency_key: request.idempotencyKey,
    owner_id: request.ownerId,
    actor_id: request.actorId,
    version: request.verification.version,
    environment: request.verification.environment,
    target: request.verification.target,
    host_version: request.verification.hostVersion,
  };
}

function transitionIdempotencyKey(kind: "stage" | "active", request: AtomicInstallRequest): string {
  return `m3-${kind}-${createHash("sha256").update(request.idempotencyKey).digest("hex")}`;
}

async function writeAtomic(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  try {
    await rename(temporary, target);
    await syncDirectoryEntry(path.dirname(target));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export class AtomicPackageInstaller {
  private readonly clock: () => Date;
  private readonly ids: { next(): string };
  private readonly journalsRoot: string;

  constructor(private readonly dependencies: AtomicInstallDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.ids = dependencies.ids ?? { next: () => randomUUID() };
    this.journalsRoot = path.join(dependencies.stateRoot, "host-app-state", "install-operations");
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.dependencies.packages.initialize(),
      this.dependencies.grants.initialize(),
      this.dependencies.lifecycle.initialize(),
      mkdir(this.journalsRoot, { recursive: true, mode: 0o700 }),
    ]);
  }

  async install(request: AtomicInstallRequest): Promise<AtomicInstallResult> {
    await this.initialize();
    OpaqueIdSchema.parse(request.operationId);
    OpaqueIdSchema.parse(request.ownerId);
    OpaqueIdSchema.parse(request.actorId);
    if (request.idempotencyKey.length < 16 || request.idempotencyKey.length > 256) {
      throw new ContractViolation("invalid_input", "Install idempotency key is outside its accepted boundary");
    }
    const inputDigest = canonicalInputDigest(stableSourceInput(request));
    let journal = await this.readJournal(request.operationId);
    if (journal) {
      if (journal.input_digest !== inputDigest) throw new ContractViolation("idempotency_conflict", "Install operation was reused with different input");
      return this.resume(journal, request);
    }
    const initial = await this.dependencies.lifecycle.readState();
    if (initial.state !== "not_installed") throw new ContractViolation("invalid_state_transition", "Install requires not_installed state");
    const now = this.clock().toISOString();
    journal = AtomicInstallJournalSchema.parse({
      install_journal_version: 1,
      operation_id: request.operationId,
      input_digest: inputDigest,
      owner_id: request.ownerId,
      actor_id: request.actorId,
      installation_id: this.ids.next(),
      grant_id: this.ids.next(),
      decision_id: this.ids.next(),
      package_reference_id: this.ids.next(),
      cache_reference_id: this.ids.next(),
      staged_operation_id: this.ids.next(),
      active_operation_id: this.ids.next(),
      compensation_operation_id: this.ids.next(),
      package_digest: null,
      package_version: null,
      runtime: null,
      endpoint_id: null,
      registration_id: null,
      completed_steps: ["requested"],
      status: "running",
      error_code: null,
      started_at: now,
      updated_at: now,
    });
    await this.writeJournal(journal);

    let verifiedPackage: VerifiedPackage | null = null;
    try {
      await this.before("requested");
      const verified = await this.dependencies.verifier.verify(request.verification);
      verifiedPackage = verified;
      journal = await this.advance(journal, "verified", {
        package_digest: verified.packageDigest,
        package_version: verified.manifest.package_version,
      });

      await this.dependencies.packages.promote(verified);
      journal = await this.advance(journal, "promoted");

      const decision = await request.decide(verified.inspection);
      const grant = this.dependencies.grants.decide({
        grantId: journal.grant_id,
        ownerId: request.ownerId,
        actorId: request.actorId,
        installationId: journal.installation_id,
        packageDigest: verified.packageDigest,
      }, verified.manifest, {
        ...decision,
        decisionId: journal.decision_id,
      });
      if (!grant) {
        journal = AtomicInstallJournalSchema.parse({ ...journal, status: "denied", updated_at: this.clock().toISOString() });
        await this.writeJournal(journal);
        return {
          outcome: "denied",
          inspection: verified.inspection,
          installationId: null,
          grantId: null,
          packageDigest: verified.packageDigest,
          generation: initial.generation,
        };
      }
      journal = await this.advance(journal, "owner_approved");

      const referenced = await this.dependencies.packages.acquire(verified.packageDigest, journal.package_reference_id);
      journal = await this.advance(journal, "package_referenced");
      const durableReference = this.durableReference(journal, referenced);
      await this.dependencies.lifecycle.executeTransition({
        operationId: journal.staged_operation_id,
        idempotencyKey: transitionIdempotencyKey("stage", request),
        canonicalInput: stableSourceInput(request),
        ownerId: request.ownerId,
        actorId: request.actorId,
        kind: "install",
        to: "staged",
        authority: {
          installation_id: journal.installation_id,
          active_package_digest: null,
          grant_id: null,
        },
      });
      journal = await this.advance(journal, "staged_committed");

      await this.dependencies.grants.persist(grant);
      journal = await this.advance(journal, "grant_persisted");

      const desktop = verified.target === "desktop_windows_x64";
      const started = await this.dependencies.supervisor.start({
        supervisor_protocol_version: 1,
        operation_id: request.operationId,
        descriptor: {
          supervisor_protocol_version: 1,
          runtime_kind: desktop ? "packaged_node" : "container",
          app_id: verified.manifest.app_id,
          installation_id: journal.installation_id,
          package_digest: verified.packageDigest,
          grant_id: journal.grant_id,
          verified_entrypoint: verified.entrypoint,
          arguments: [],
          environment_keys: [
            "BRAINDRIVE_APP_CONNECTION_TOKEN",
            "BRAINDRIVE_APP_ID",
            "BRAINDRIVE_INSTALLATION_ID",
            "BRAINDRIVE_PACKAGE_DIGEST",
            "BRAINDRIVE_ENDPOINT_BIND",
          ],
          package_root_ref: journal.package_reference_id,
          cache_root_ref: journal.cache_reference_id,
          endpoint_policy: { transport: desktop ? "loopback" : "container_internal", authentication: "per_installation_token", public_bind_allowed: false },
          resource_policy_version: 1,
        },
        policy: SUPERVISOR_POLICY,
        requested_at: this.clock().toISOString(),
      });
      if (!["started", "already_running"].includes(started.outcome) || !started.runtime) {
        throw new ContractViolation("ambiguous_runtime_state", "Supervisor start did not prove a single runtime identity");
      }
      journal = await this.advance(journal, "supervisor_started", { runtime: started.runtime });

      const ready = await this.dependencies.supervisor.awaitReady({
        supervisor_protocol_version: 1,
        operation_id: request.operationId,
        runtime: started.runtime,
        deadline_at: new Date(this.clock().getTime() + SUPERVISOR_POLICY.startup_timeout_ms).toISOString(),
      });
      if (ready.outcome !== "ready" || !ready.endpoint) throw new ContractViolation("readiness_failed", "Supervisor readiness gate failed");
      journal = await this.advance(journal, "readiness_passed", { endpoint_id: ready.endpoint.endpoint_id });

      const registered = await this.dependencies.supervisor.register({
        supervisor_protocol_version: 1,
        operation_id: request.operationId,
        runtime: started.runtime,
        endpoint: ready.endpoint,
        connection_id: journal.cache_reference_id,
      });
      if (!["registered", "already_registered"].includes(registered.outcome) || !registered.registration_id) {
        throw new ContractViolation("readiness_failed", "Supervisor registration gate failed");
      }
      journal = await this.advance(journal, "registration_completed", { registration_id: registered.registration_id });

      if (this.dependencies.runtimeAuthority) {
        await this.dependencies.runtimeAuthority.persist({
          installation_id: journal.installation_id,
          package_version: verified.manifest.package_version,
          package_digest: verified.packageDigest,
          grant_id: journal.grant_id,
          runtime: started.runtime,
          registration_id: registered.registration_id,
          connection_id: journal.cache_reference_id,
        });
        journal = await this.advance(journal, "runtime_authority_persisted");
      }

      const activated = await this.dependencies.lifecycle.executeTransition({
        operationId: journal.active_operation_id,
        idempotencyKey: transitionIdempotencyKey("active", request),
        canonicalInput: stableSourceInput(request),
        ownerId: request.ownerId,
        actorId: request.actorId,
        kind: "install",
        to: "active",
        authority: {
          installation_id: journal.installation_id,
          active_package_digest: verified.packageDigest,
          grant_id: journal.grant_id,
        },
        packageReferences: [durableReference],
      }, this.dependencies.activeTransitionHooks);
      journal = await this.advance(journal, "active_committed");
      journal = AtomicInstallJournalSchema.parse({ ...journal, status: "completed", updated_at: this.clock().toISOString() });
      await this.writeJournal(journal);
      return {
        outcome: "active",
        inspection: verified.inspection,
        installationId: journal.installation_id,
        grantId: journal.grant_id,
        packageDigest: verified.packageDigest,
        generation: activated.final_generation,
      };
    } catch (error) {
      if (error instanceof SimulatedInstallInterruption) throw error;
      const possiblyCommitted = await this.dependencies.lifecycle.readState();
      if (
        verifiedPackage
        && possiblyCommitted.state === "active"
        && possiblyCommitted.installation_id === journal.installation_id
        && possiblyCommitted.grant_id === journal.grant_id
        && possiblyCommitted.active_package_digest === verifiedPackage.packageDigest
        && await this.dependencies.grants.read(journal.grant_id)
      ) {
        journal = AtomicInstallJournalSchema.parse({
          ...(await this.readJournal(journal.operation_id) ?? journal),
          completed_steps: [...new Set([...journal.completed_steps, "active_committed"])],
          status: "completed",
          error_code: null,
          updated_at: this.clock().toISOString(),
        });
        await this.writeJournal(journal);
        return {
          outcome: "active",
          inspection: verifiedPackage.inspection,
          installationId: journal.installation_id,
          grantId: journal.grant_id,
          packageDigest: verifiedPackage.packageDigest,
          generation: possiblyCommitted.generation,
        };
      }
      await this.compensate(journal);
      const code = error instanceof ContractViolation ? error.code : "recoverable_internal_failure";
      journal = AtomicInstallJournalSchema.parse({
        ...(await this.readJournal(journal.operation_id) ?? journal),
        status: "failed",
        error_code: code,
        updated_at: this.clock().toISOString(),
      });
      await this.writeJournal(journal);
      if (error instanceof ContractViolation) throw error;
      throw new ContractViolation("recoverable_internal_failure", "Atomic install failed and was compensated");
    }
  }

  private async resume(journal: AtomicInstallJournal, request: AtomicInstallRequest): Promise<AtomicInstallResult> {
    if (journal.status === "failed") throw new ContractViolation("recoverable_internal_failure", "Prior install attempt failed safely");
    const state = await this.dependencies.lifecycle.readState();
    if (journal.status === "denied") {
      const verified = await this.dependencies.verifier.verify(request.verification);
      await rm(verified.stageRoot, { recursive: true, force: true });
      if (journal.package_digest !== verified.packageDigest) throw new ContractViolation("idempotency_conflict", "Denied package authority changed during retry");
      return {
        outcome: "denied",
        inspection: verified.inspection,
        installationId: null,
        grantId: null,
        packageDigest: verified.packageDigest,
        generation: state.generation,
      };
    }
    if (
      journal.status === "completed"
      || (state.state === "active" && state.installation_id === journal.installation_id && state.grant_id === journal.grant_id && state.active_package_digest === journal.package_digest)
    ) {
      const verified = await this.dependencies.verifier.verify(request.verification);
      if (verified.packageDigest !== journal.package_digest) throw new ContractViolation("idempotency_conflict", "Installed package authority changed during retry");
      await rm(verified.stageRoot, { recursive: true, force: true });
      if (journal.status !== "completed") {
        journal = AtomicInstallJournalSchema.parse({ ...journal, status: "completed", updated_at: this.clock().toISOString() });
        await this.writeJournal(journal);
      }
      return {
        outcome: "active",
        inspection: verified.inspection,
        installationId: journal.installation_id,
        grantId: journal.grant_id,
        packageDigest: verified.packageDigest,
        generation: state.generation,
      };
    }
    await this.compensate(journal);
    journal = AtomicInstallJournalSchema.parse({ ...(await this.readJournal(journal.operation_id) ?? journal), status: "failed", error_code: "recoverable_internal_failure", updated_at: this.clock().toISOString() });
    await this.writeJournal(journal);
    throw new ContractViolation("recoverable_internal_failure", "Interrupted install was compensated to its prior safe state");
  }

  private async compensate(journalInput: AtomicInstallJournal): Promise<void> {
    let journal = await this.readJournal(journalInput.operation_id) ?? journalInput;
    for (const operationId of [journal.staged_operation_id, journal.active_operation_id]) {
      const transition = await this.dependencies.lifecycle.readJournal(operationId).catch(() => null);
      if (transition && !transition.result) await this.dependencies.lifecycle.reconcileOperation(operationId).catch(() => undefined);
    }
    const runtime = journal.runtime;
    if (journal.completed_steps.includes("supervisor_started") || journal.completed_steps.includes("staged_committed")) {
      await this.dependencies.supervisor.revokeTokens({
        supervisor_protocol_version: 1,
        operation_id: journal.operation_id,
        installation_id: journal.installation_id,
        runtime_id: runtime?.runtime_id ?? null,
        operation_scope_id: journal.operation_id,
        prior_token_generation: runtime?.endpoint_token_generation ?? 1,
      }).catch(() => undefined);
      if (runtime) {
        await this.dependencies.supervisor.stop({
          supervisor_protocol_version: 1,
          operation_id: journal.operation_id,
          runtime,
          reason: "reconcile",
          grace_deadline_at: new Date(this.clock().getTime() + 5_000).toISOString(),
        }).catch(() => undefined);
      }
      await this.dependencies.supervisor.cleanup({
        supervisor_protocol_version: 1,
        operation_id: journal.operation_id,
        installation_id: journal.installation_id,
        expected_runtime_id: runtime?.runtime_id ?? null,
        observed_runtime_ids: runtime ? [runtime.runtime_id] : [],
        requested_at: this.clock().toISOString(),
      }).catch(() => undefined);
    }
    await this.dependencies.grants.remove(journal.grant_id);
    await this.dependencies.runtimeAuthority?.remove(journal.installation_id).catch(() => undefined);
    const state = await this.dependencies.lifecycle.readState();
    if (state.state === "staged" && state.installation_id === journal.installation_id) {
      await this.dependencies.lifecycle.executeTransition({
        operationId: journal.compensation_operation_id,
        idempotencyKey: `m3-compensate-${journal.operation_id}`,
        canonicalInput: { install_operation_id: journal.operation_id },
        ownerId: journal.owner_id,
        actorId: journal.actor_id,
        kind: "install",
        to: "not_installed",
      });
    }
    if (journal.package_digest && journal.completed_steps.includes("package_referenced")) {
      await this.dependencies.packages.release(journal.package_digest, journal.package_reference_id);
    }
    journal = await this.advance(journal, "compensated");
  }

  private durableReference(journal: AtomicInstallJournal, stored: ImmutablePackageRecord): DurablePackageReference {
    return {
      package_reference_version: 1,
      package_ref_id: journal.package_reference_id,
      app_id: "ai.braindrive.resume-builder",
      package_digest: stored.packageDigest,
      package_version: stored.packageVersion,
      cache_key: stored.packageDigest.slice(7, 23),
      created_at: this.clock().toISOString(),
    };
  }

  private async before(step: AtomicInstallStep): Promise<void> {
    await this.dependencies.beforeStep?.(step);
  }

  private async advance(
    journalInput: AtomicInstallJournal,
    step: AtomicInstallStep,
    patch: Partial<AtomicInstallJournal> = {},
  ): Promise<AtomicInstallJournal> {
    await this.before(step);
    const journal = AtomicInstallJournalSchema.parse({
      ...journalInput,
      ...patch,
      completed_steps: journalInput.completed_steps.includes(step) ? journalInput.completed_steps : [...journalInput.completed_steps, step],
      updated_at: this.clock().toISOString(),
    });
    await this.writeJournal(journal);
    return journal;
  }

  private pathFor(operationId: string): string {
    return path.join(this.journalsRoot, `${operationId}.json`);
  }

  private async readJournal(operationId: string): Promise<AtomicInstallJournal | null> {
    try {
      return AtomicInstallJournalSchema.parse(JSON.parse(await readFile(this.pathFor(operationId), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private writeJournal(journal: AtomicInstallJournal): Promise<void> {
    return writeAtomic(this.pathFor(journal.operation_id), AtomicInstallJournalSchema.parse(journal));
  }
}

export function deterministicFixtureId(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
