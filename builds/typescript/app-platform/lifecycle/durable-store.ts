import { randomUUID } from "node:crypto";
import {
  mkdir as nodeMkdir,
  open as nodeOpen,
  readFile as nodeReadFile,
  readdir as nodeReaddir,
  rename as nodeRename,
  rm as nodeRm,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  canonicalInputDigest,
  canonicalJson,
  canonicalJsonDocumentDigest,
  OpaqueIdSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from "../contracts/common.js";
import { RESUME_BUILDER_APP_ID } from "../contracts/constants.js";
import { ContractViolation } from "../contracts/errors.js";
import {
  LifecycleOperationKindSchema,
  LifecycleRecordSchema,
  LifecycleStateSchema,
} from "../contracts/lifecycle.js";
import {
  LifecycleStateMachine,
  SYSTEM_LIFECYCLE_CLOCK,
  type DurableLifecycleRecord,
  type LifecycleClock,
} from "./state-machine.js";

const STORE_VERSION = 1 as const;
const INITIAL_TIMESTAMP = "1970-01-01T00:00:00.000Z";

const PackageReferenceSchema = z.object({
  package_reference_version: z.literal(1),
  package_ref_id: OpaqueIdSchema,
  app_id: z.literal(RESUME_BUILDER_APP_ID),
  package_digest: Sha256DigestSchema,
  package_version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/),
  cache_key: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,127}$/),
  created_at: TimestampSchema,
}).strict();

export type DurablePackageReference = z.infer<typeof PackageReferenceSchema>;

const PackagePointerSchema = z.object({
  package_pointer_version: z.literal(1),
  app_id: z.literal(RESUME_BUILDER_APP_ID),
  role: z.enum(["active", "last_known_good"]),
  generation: z.number().int().nonnegative(),
  package_digest: Sha256DigestSchema.nullable(),
  package_ref_id: OpaqueIdSchema.nullable(),
  updated_at: TimestampSchema,
}).strict().superRefine((value, context) => {
  if ((value.package_digest === null) !== (value.package_ref_id === null)) {
    context.addIssue({ code: "custom", message: "package pointer digest/reference mismatch" });
  }
});

export type DurablePackagePointer = z.infer<typeof PackagePointerSchema>;

const JournalStepSchema = z.enum([
  "intent_persisted",
  "package_references_persisted",
  "pointers_persisted",
  "state_persisted",
  "result_persisted",
]);

export type LifecycleJournalBoundary = z.infer<typeof JournalStepSchema>;

const JournalResultSchema = z.object({
  result_version: z.literal(1),
  outcome: z.enum(["committed", "rolled_back", "failed_recoverable"]),
  final_state: LifecycleStateSchema,
  final_generation: z.number().int().nonnegative(),
  active_package_digest: Sha256DigestSchema.nullable(),
  last_known_good_package_digest: Sha256DigestSchema.nullable(),
  owner_data_preserved: z.literal(true),
}).strict();

const DurableLifecycleJournalSchema = z.object({
  lifecycle_journal_version: z.literal(1),
  revision: z.number().int().positive(),
  operation_id: OpaqueIdSchema,
  idempotency_key: z.string().min(16).max(256),
  canonical_input_digest: Sha256DigestSchema,
  owner_id: OpaqueIdSchema,
  actor_id: OpaqueIdSchema,
  app_id: z.literal(RESUME_BUILDER_APP_ID),
  installation_id: OpaqueIdSchema.nullable(),
  kind: LifecycleOperationKindSchema,
  prior_record: LifecycleRecordSchema,
  proposed_record: LifecycleRecordSchema,
  prior_active_ref: PackageReferenceSchema.nullable(),
  prior_last_known_good_ref: PackageReferenceSchema.nullable(),
  proposed_active_ref: PackageReferenceSchema.nullable(),
  proposed_last_known_good_ref: PackageReferenceSchema.nullable(),
  completed_steps: z.array(JournalStepSchema).max(5),
  compensations: z.array(z.object({
    action: z.literal("restore_prior_pointers"),
    status: z.enum(["pending", "completed", "failed"]),
  }).strict()).max(1),
  status: z.enum(["prepared", "committing", "committed", "rolled_back", "failed_recoverable"]),
  result: JournalResultSchema.nullable(),
  error_code: z.enum(["conflict", "recoverable_internal_failure"]).nullable(),
  started_at: TimestampSchema,
  updated_at: TimestampSchema,
  completed_at: TimestampSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (new Set(value.completed_steps).size !== value.completed_steps.length) {
    context.addIssue({ code: "custom", message: "duplicate journal boundary" });
  }
  const terminal = ["committed", "rolled_back", "failed_recoverable"].includes(value.status);
  if (terminal !== (value.result !== null && value.completed_at !== null)) {
    context.addIssue({ code: "custom", message: "journal terminal fields disagree" });
  }
});

export type DurableLifecycleJournal = z.infer<typeof DurableLifecycleJournalSchema>;
export type DurableLifecycleResult = z.infer<typeof JournalResultSchema>;

const StoredEnvelopeSchema = z.object({
  lifecycle_store_version: z.literal(STORE_VERSION),
  document_kind: z.enum(["state", "journal", "active_pointer", "last_known_good_pointer", "package_reference"]),
  generation: z.number().int().nonnegative(),
  checksum: Sha256DigestSchema,
  payload: z.unknown(),
}).strict();

const LeaseSchema = z.object({
  lease_version: z.literal(1),
  lease_id: OpaqueIdSchema,
  operation_id: OpaqueIdSchema,
  app_id: z.literal(RESUME_BUILDER_APP_ID),
  owner_id: OpaqueIdSchema,
  acquired_at: TimestampSchema,
  expires_at: TimestampSchema,
}).strict();

export type MutationLease = z.infer<typeof LeaseSchema>;

export interface LifecycleFilesystem {
  mkdir(targetPath: string, options: { recursive: true }): Promise<string | undefined>;
  open(targetPath: string, flags: string, mode?: number): Promise<FileHandle>;
  readFile(targetPath: string, encoding: "utf8"): Promise<string>;
  readdir(targetPath: string): Promise<string[]>;
  rename(from: string, to: string): Promise<void>;
  rm(targetPath: string, options: { force: true }): Promise<void>;
}

export const NODE_LIFECYCLE_FILESYSTEM: LifecycleFilesystem = {
  mkdir: nodeMkdir,
  open: nodeOpen,
  readFile: nodeReadFile,
  readdir: async (targetPath) => nodeReaddir(targetPath),
  rename: nodeRename,
  rm: nodeRm,
};

export type LifecycleIdFactory = { next(): string };

export const RANDOM_LIFECYCLE_IDS: LifecycleIdFactory = {
  next: () => randomUUID(),
};

export type LifecycleStoreDependencies = {
  filesystem?: LifecycleFilesystem;
  clock?: LifecycleClock;
  ids?: LifecycleIdFactory;
  leaseDurationMs?: number;
  diagnostics?: {
    emitTransition(journal: DurableLifecycleJournal, result: DurableLifecycleResult): void;
  };
};

export type TransitionIntent = {
  operationId: string;
  leaseOperationId?: string;
  idempotencyKey: string;
  canonicalInput: unknown;
  ownerId: string;
  actorId: string;
  kind: z.infer<typeof LifecycleOperationKindSchema>;
  to: z.infer<typeof LifecycleStateSchema>;
  authority?: Parameters<LifecycleStateMachine["transition"]>[1]["authority"];
  packageReferences?: DurablePackageReference[];
};

export type LifecycleMutationHooks = {
  afterBoundary?(boundary: LifecycleJournalBoundary): Promise<void> | void;
};

export type ConsistentLifecycleSnapshot = {
  record: DurableLifecycleRecord;
  active: DurablePackagePointer;
  lastKnownGood: DurablePackagePointer;
};

function initialRecord(): DurableLifecycleRecord {
  return LifecycleRecordSchema.parse({
    lifecycle_schema_version: 1,
    app_id: RESUME_BUILDER_APP_ID,
    installation_id: null,
    state: "not_installed",
    generation: 0,
    active_package_digest: null,
    last_known_good_package_digest: null,
    grant_id: null,
    pending_operation_id: null,
    successful_use_checkpoint: null,
    updated_at: INITIAL_TIMESTAMP,
  });
}

function persistenceFailure(message: string): ContractViolation {
  return new ContractViolation("recoverable_internal_failure", message);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function recordDigest(record: DurableLifecycleRecord): string {
  return canonicalJsonDocumentDigest(record);
}

export class LifecycleStore {
  readonly layout: {
    appRoot: string;
    state: string;
    journals: string;
    activePointer: string;
    lastKnownGoodPointer: string;
    packageReferences: string;
    locks: string;
    mutationLock: string;
  };

  private readonly filesystem: LifecycleFilesystem;
  private readonly clock: LifecycleClock;
  private readonly ids: LifecycleIdFactory;
  private readonly leaseDurationMs: number;
  private readonly stateMachine: LifecycleStateMachine;
  private readonly diagnostics: LifecycleStoreDependencies["diagnostics"];
  private readonly inFlight = new Map<string, { inputDigest: string; promise: Promise<DurableLifecycleResult> }>();

  constructor(root: string, dependencies: LifecycleStoreDependencies = {}) {
    const appRoot = path.join(root, "apps", RESUME_BUILDER_APP_ID);
    this.layout = {
      appRoot,
      state: path.join(appRoot, "state", "lifecycle.json"),
      journals: path.join(appRoot, "journal"),
      activePointer: path.join(appRoot, "pointers", "active.json"),
      lastKnownGoodPointer: path.join(appRoot, "pointers", "last-known-good.json"),
      packageReferences: path.join(appRoot, "package-references"),
      locks: path.join(appRoot, "locks"),
      mutationLock: path.join(appRoot, "locks", "mutation.lease.json"),
    };
    this.filesystem = dependencies.filesystem ?? NODE_LIFECYCLE_FILESYSTEM;
    this.clock = dependencies.clock ?? SYSTEM_LIFECYCLE_CLOCK;
    this.ids = dependencies.ids ?? RANDOM_LIFECYCLE_IDS;
    this.leaseDurationMs = dependencies.leaseDurationMs ?? 30_000;
    this.stateMachine = new LifecycleStateMachine(this.clock);
    this.diagnostics = dependencies.diagnostics;
  }

  async initialize(): Promise<void> {
    await Promise.all([
      path.dirname(this.layout.state),
      this.layout.journals,
      path.dirname(this.layout.activePointer),
      this.layout.packageReferences,
      this.layout.locks,
    ].map((directory) => this.filesystem.mkdir(directory, { recursive: true })));
  }

  async readState(): Promise<DurableLifecycleRecord> {
    const value = await this.readEnvelope(this.layout.state, "state", LifecycleRecordSchema);
    return value ?? initialRecord();
  }

  async readJournal(operationId: string): Promise<DurableLifecycleJournal | null> {
    OpaqueIdSchema.parse(operationId);
    return this.readEnvelope(
      path.join(this.layout.journals, `${operationId}.json`),
      "journal",
      DurableLifecycleJournalSchema,
    );
  }

  async listJournals(): Promise<DurableLifecycleJournal[]> {
    const names = (await this.filesystem.readdir(this.layout.journals))
      .filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name))
      .sort();
    return Promise.all(names.map(async (name) => {
      const operationId = name.slice(0, -5);
      const journal = await this.readJournal(operationId);
      if (!journal) throw persistenceFailure("Lifecycle journal disappeared during enumeration");
      return journal;
    }));
  }

  async acquireMutation(operationId: string): Promise<MutationLease> {
    OpaqueIdSchema.parse(operationId);
    await this.filesystem.mkdir(this.layout.locks, { recursive: true });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const acquiredAt = this.clock.now();
      const lease = LeaseSchema.parse({
        lease_version: 1,
        lease_id: this.ids.next(),
        operation_id: operationId,
        app_id: RESUME_BUILDER_APP_ID,
        owner_id: this.ids.next(),
        acquired_at: acquiredAt.toISOString(),
        expires_at: new Date(acquiredAt.getTime() + this.leaseDurationMs).toISOString(),
      });
      try {
        await this.writeExclusive(this.layout.mutationLock, lease);
        return lease;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }

      const existing = await this.readLease();
      if (Date.parse(existing.expires_at) > this.clock.now().getTime()) {
        throw new ContractViolation("conflict", "A lifecycle mutation lease is already active");
      }
      const evidencePath = path.join(
        this.layout.locks,
        `stale-${existing.lease_id}-${this.ids.next()}.json`,
      );
      try {
        await this.filesystem.rename(this.layout.mutationLock, evidencePath);
        await this.syncDirectory(this.layout.locks);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    throw new ContractViolation("conflict", "Lifecycle mutation lease acquisition did not converge");
  }

  async releaseMutation(lease: MutationLease): Promise<void> {
    let existing: MutationLease;
    try {
      existing = await this.readLease();
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    if (existing.lease_id !== lease.lease_id || existing.owner_id !== lease.owner_id) return;
    await this.filesystem.rm(this.layout.mutationLock, { force: true });
    await this.syncDirectory(this.layout.locks);
  }

  async renewMutation(leaseInput: MutationLease, minimumDurationMs = this.leaseDurationMs): Promise<MutationLease> {
    const lease = LeaseSchema.parse(leaseInput);
    const current = await this.readLease();
    if (
      current.lease_id !== lease.lease_id
      || current.owner_id !== lease.owner_id
      || current.operation_id !== lease.operation_id
    ) {
      throw new ContractViolation("conflict", "Lifecycle mutation lease cannot be renewed by another owner");
    }
    const durationMs = Math.max(this.leaseDurationMs, minimumDurationMs);
    const renewed = LeaseSchema.parse({
      ...current,
      expires_at: new Date(this.clock.now().getTime() + durationMs).toISOString(),
    });
    await this.writeAtomic(this.layout.mutationLock, renewed);
    return renewed;
  }

  async executeTransition(
    intent: TransitionIntent,
    hooks: LifecycleMutationHooks = {},
  ): Promise<DurableLifecycleResult> {
    const inputDigest = this.intentDigest(intent);
    const running = this.inFlight.get(intent.operationId);
    if (running) {
      if (running.inputDigest !== inputDigest) {
        throw new ContractViolation("idempotency_conflict", "Operation ID was reused with different canonical input");
      }
      return running.promise;
    }

    const promise = this.executeTransitionOnce(intent, hooks);
    this.inFlight.set(intent.operationId, { inputDigest, promise });
    try {
      return await promise;
    } finally {
      this.inFlight.delete(intent.operationId);
    }
  }

  async prepareTransition(intent: TransitionIntent, lease: MutationLease): Promise<DurableLifecycleJournal> {
    await this.assertLease(lease, intent.leaseOperationId ?? intent.operationId);
    const inputDigest = this.intentDigest(intent);
    const existing = await this.readJournal(intent.operationId);
    if (existing) {
      if (existing.canonical_input_digest !== inputDigest || existing.idempotency_key !== intent.idempotencyKey) {
        throw new ContractViolation("idempotency_conflict", "Operation ID was reused with different canonical input");
      }
      return existing;
    }

    const pending = (await this.listJournals()).find((journal) =>
      !["committed", "rolled_back", "failed_recoverable"].includes(journal.status));
    if (pending) {
      throw new ContractViolation("conflict", "A different lifecycle mutation requires reconciliation");
    }

    const prior = await this.readState();
    const proposed = this.stateMachine.transition(prior, {
      operationId: intent.operationId,
      to: intent.to,
      authority: intent.authority,
    });
    const suppliedReferences = new Map(
      (intent.packageReferences ?? []).map((reference) => {
        const parsed = PackageReferenceSchema.parse(reference);
        return [parsed.package_digest, parsed] as const;
      }),
    );
    const priorActiveRef = await this.resolveReference(prior.active_package_digest, suppliedReferences);
    const priorLastKnownGoodRef = await this.resolveReference(prior.last_known_good_package_digest, suppliedReferences);
    const proposedActiveRef = await this.resolveReference(proposed.active_package_digest, suppliedReferences);
    const proposedLastKnownGoodRef = await this.resolveReference(proposed.last_known_good_package_digest, suppliedReferences);
    const now = this.clock.now().toISOString();
    const journal = DurableLifecycleJournalSchema.parse({
      lifecycle_journal_version: 1,
      revision: 1,
      operation_id: intent.operationId,
      idempotency_key: intent.idempotencyKey,
      canonical_input_digest: inputDigest,
      owner_id: intent.ownerId,
      actor_id: intent.actorId,
      app_id: RESUME_BUILDER_APP_ID,
      installation_id: proposed.installation_id,
      kind: intent.kind,
      prior_record: prior,
      proposed_record: proposed,
      prior_active_ref: priorActiveRef,
      prior_last_known_good_ref: priorLastKnownGoodRef,
      proposed_active_ref: proposedActiveRef,
      proposed_last_known_good_ref: proposedLastKnownGoodRef,
      completed_steps: ["intent_persisted"],
      compensations: [{ action: "restore_prior_pointers", status: "pending" }],
      status: "prepared",
      result: null,
      error_code: null,
      started_at: now,
      updated_at: now,
      completed_at: null,
    });
    await this.writeJournal(journal);
    return journal;
  }

  async commitPrepared(
    operationId: string,
    lease: MutationLease,
    hooks: LifecycleMutationHooks = {},
    leaseOperationId = operationId,
  ): Promise<DurableLifecycleResult> {
    await this.assertLease(lease, leaseOperationId);
    let journal = await this.requireJournal(operationId);
    if (journal.result) return journal.result;

    const current = await this.readState();
    const currentDigest = recordDigest(current);
    const priorDigest = recordDigest(journal.prior_record);
    const proposedDigest = recordDigest(journal.proposed_record);
    if (currentDigest !== priorDigest && currentDigest !== proposedDigest) {
      throw new ContractViolation("conflict", "Lifecycle generation changed outside the prepared operation");
    }

    if (!journal.completed_steps.includes("package_references_persisted")) {
      for (const reference of this.uniqueReferences(journal, "proposed")) await this.writePackageReference(reference);
      journal = await this.markStep(journal, "package_references_persisted");
      await hooks.afterBoundary?.("package_references_persisted");
    }
    if (!journal.completed_steps.includes("pointers_persisted")) {
      await this.writePointers(journal.proposed_record, journal.proposed_active_ref, journal.proposed_last_known_good_ref);
      journal = await this.markStep(journal, "pointers_persisted");
      await hooks.afterBoundary?.("pointers_persisted");
    }
    if (currentDigest !== proposedDigest && !journal.completed_steps.includes("state_persisted")) {
      await this.writeEnvelope(
        this.layout.state,
        "state",
        journal.proposed_record.generation,
        journal.proposed_record,
      );
      journal = await this.markStep(journal, "state_persisted");
      await hooks.afterBoundary?.("state_persisted");
    } else if (!journal.completed_steps.includes("state_persisted")) {
      journal = await this.markStep(journal, "state_persisted");
      await hooks.afterBoundary?.("state_persisted");
    }

    const result = this.resultFor("committed", journal.proposed_record);
    journal = await this.finishJournal(journal, "committed", result, null);
    this.diagnostics?.emitTransition(journal, journal.result!);
    await hooks.afterBoundary?.("result_persisted");
    return journal.result!;
  }

  async reconcileOperation(operationId: string): Promise<DurableLifecycleResult> {
    const existing = await this.requireJournal(operationId);
    if (existing.result) return existing.result;
    const lease = await this.acquireMutation(operationId);
    try {
      let journal = await this.requireJournal(operationId);
      if (journal.result) return journal.result;
      const current = await this.readState();
      const currentDigest = recordDigest(current);
      if (currentDigest === recordDigest(journal.proposed_record)) {
        for (const reference of this.uniqueReferences(journal, "proposed")) await this.writePackageReference(reference);
        await this.writePointers(journal.proposed_record, journal.proposed_active_ref, journal.proposed_last_known_good_ref);
        const result = this.resultFor("committed", journal.proposed_record);
        journal = await this.finishJournal(journal, "committed", result, null);
        this.diagnostics?.emitTransition(journal, journal.result!);
        return journal.result!;
      }
      if (currentDigest === recordDigest(journal.prior_record)) {
        await this.writePointers(journal.prior_record, journal.prior_active_ref, journal.prior_last_known_good_ref);
        journal = DurableLifecycleJournalSchema.parse({
          ...journal,
          revision: journal.revision + 1,
          compensations: [{ action: "restore_prior_pointers", status: "completed" }],
          updated_at: this.clock.now().toISOString(),
        });
        await this.writeJournal(journal);
        const result = this.resultFor("rolled_back", journal.prior_record);
        journal = await this.finishJournal(journal, "rolled_back", result, null);
        this.diagnostics?.emitTransition(journal, journal.result!);
        return journal.result!;
      }

      const result = this.resultFor("failed_recoverable", current);
      journal = await this.finishJournal(journal, "failed_recoverable", result, "conflict");
      this.diagnostics?.emitTransition(journal, journal.result!);
      return journal.result!;
    } finally {
      await this.releaseMutation(lease);
    }
  }

  async readConsistentSnapshot(): Promise<ConsistentLifecycleSnapshot> {
    const record = await this.readState();
    const active = await this.readPointer(this.layout.activePointer, "active", record.generation);
    const lastKnownGood = await this.readPointer(
      this.layout.lastKnownGoodPointer,
      "last_known_good",
      record.generation,
    );
    if (
      active.package_digest !== record.active_package_digest
      || lastKnownGood.package_digest !== record.last_known_good_package_digest
    ) {
      throw persistenceFailure("Lifecycle pointers do not match the durable state generation");
    }
    for (const pointer of [active, lastKnownGood]) {
      if (!pointer.package_digest) continue;
      const reference = await this.readPackageReference(pointer.package_digest);
      if (!reference || reference.package_ref_id !== pointer.package_ref_id) {
        throw persistenceFailure("Lifecycle pointer references missing package metadata");
      }
    }
    return { record, active, lastKnownGood };
  }

  private async executeTransitionOnce(
    intent: TransitionIntent,
    hooks: LifecycleMutationHooks,
  ): Promise<DurableLifecycleResult> {
    const existing = await this.readJournal(intent.operationId);
    if (existing?.result) {
      if (existing.canonical_input_digest !== this.intentDigest(intent)) {
        throw new ContractViolation("idempotency_conflict", "Operation ID was reused with different canonical input");
      }
      return existing.result;
    }
    const lease = await this.acquireMutation(intent.operationId);
    try {
      const journal = await this.prepareTransition(intent, lease);
      if (journal.result) return journal.result;
      await hooks.afterBoundary?.("intent_persisted");
      return await this.commitPrepared(intent.operationId, lease, hooks);
    } finally {
      await this.releaseMutation(lease);
    }
  }

  private intentDigest(intent: TransitionIntent): `sha256:${string}` {
    return canonicalInputDigest({
      operation_id: intent.operationId,
      idempotency_key: intent.idempotencyKey,
      owner_id: intent.ownerId,
      actor_id: intent.actorId,
      kind: intent.kind,
      to: intent.to,
      authority: intent.authority ?? {},
      canonical_input: intent.canonicalInput,
      package_references: intent.packageReferences ?? [],
    });
  }

  private async assertLease(leaseInput: MutationLease, operationId: string): Promise<void> {
    const lease = LeaseSchema.parse(leaseInput);
    const current = await this.readLease();
    if (
      current.lease_id !== lease.lease_id
      || current.owner_id !== lease.owner_id
      || current.operation_id !== operationId
      || Date.parse(current.expires_at) <= this.clock.now().getTime()
    ) {
      throw new ContractViolation("conflict", "Lifecycle mutation lease is missing, stale, or owned elsewhere");
    }
  }

  private async readLease(): Promise<MutationLease> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await this.filesystem.readFile(this.layout.mutationLock, "utf8"));
    } catch (error) {
      if (isMissing(error)) throw error;
      throw persistenceFailure("Lifecycle mutation lease is corrupt and was preserved");
    }
    const result = LeaseSchema.safeParse(parsed);
    if (!result.success) throw persistenceFailure("Lifecycle mutation lease is invalid and was preserved");
    return result.data;
  }

  private async writeExclusive(targetPath: string, value: unknown): Promise<void> {
    const handle = await this.filesystem.open(targetPath, "wx", 0o600);
    try {
      await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.syncDirectory(path.dirname(targetPath));
  }

  private async resolveReference(
    digest: string | null,
    supplied: Map<string, DurablePackageReference>,
  ): Promise<DurablePackageReference | null> {
    if (!digest) return null;
    const candidate = supplied.get(digest) ?? await this.readPackageReference(digest);
    if (!candidate) throw new ContractViolation("conflict", "A lifecycle package digest requires an opaque package reference");
    return PackageReferenceSchema.parse(candidate);
  }

  private async readPackageReference(digest: string): Promise<DurablePackageReference | null> {
    Sha256DigestSchema.parse(digest);
    return this.readEnvelope(
      path.join(this.layout.packageReferences, `${digest.slice(7)}.json`),
      "package_reference",
      PackageReferenceSchema,
    );
  }

  private async writePackageReference(reference: DurablePackageReference): Promise<void> {
    const parsed = PackageReferenceSchema.parse(reference);
    const targetPath = path.join(this.layout.packageReferences, `${parsed.package_digest.slice(7)}.json`);
    const existing = await this.readPackageReference(parsed.package_digest);
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(parsed)) {
        throw new ContractViolation("conflict", "Immutable package reference identity changed");
      }
      return;
    }
    await this.writeEnvelope(targetPath, "package_reference", 1, parsed);
  }

  private uniqueReferences(
    journal: DurableLifecycleJournal,
    side: "prior" | "proposed",
  ): DurablePackageReference[] {
    const candidates = side === "prior"
      ? [journal.prior_active_ref, journal.prior_last_known_good_ref]
      : [journal.proposed_active_ref, journal.proposed_last_known_good_ref];
    return [...new Map(candidates.filter((item): item is DurablePackageReference => item !== null)
      .map((item) => [item.package_digest, item])).values()];
  }

  private pointerFor(
    role: "active" | "last_known_good",
    record: DurableLifecycleRecord,
    reference: DurablePackageReference | null,
  ): DurablePackagePointer {
    const digest = role === "active" ? record.active_package_digest : record.last_known_good_package_digest;
    if (digest !== (reference?.package_digest ?? null)) {
      throw persistenceFailure("Lifecycle state and package reference disagree");
    }
    return PackagePointerSchema.parse({
      package_pointer_version: 1,
      app_id: RESUME_BUILDER_APP_ID,
      role,
      generation: record.generation,
      package_digest: digest,
      package_ref_id: reference?.package_ref_id ?? null,
      updated_at: record.updated_at,
    });
  }

  private async writePointers(
    record: DurableLifecycleRecord,
    activeReference: DurablePackageReference | null,
    lastKnownGoodReference: DurablePackageReference | null,
  ): Promise<void> {
    const active = this.pointerFor("active", record, activeReference);
    const lastKnownGood = this.pointerFor("last_known_good", record, lastKnownGoodReference);
    await this.writeEnvelope(this.layout.activePointer, "active_pointer", record.generation, active);
    await this.writeEnvelope(
      this.layout.lastKnownGoodPointer,
      "last_known_good_pointer",
      record.generation,
      lastKnownGood,
    );
  }

  private async readPointer(
    targetPath: string,
    role: "active" | "last_known_good",
    generation: number,
  ): Promise<DurablePackagePointer> {
    const kind = role === "active" ? "active_pointer" : "last_known_good_pointer";
    const pointer = await this.readEnvelope(targetPath, kind, PackagePointerSchema);
    if (!pointer) {
      if (generation !== 0) throw persistenceFailure("Lifecycle pointer is missing for a persisted generation");
      return PackagePointerSchema.parse({
        package_pointer_version: 1,
        app_id: RESUME_BUILDER_APP_ID,
        role,
        generation: 0,
        package_digest: null,
        package_ref_id: null,
        updated_at: INITIAL_TIMESTAMP,
      });
    }
    if (pointer.role !== role || pointer.generation !== generation) {
      throw persistenceFailure("Lifecycle pointer generation is torn or mismatched");
    }
    return pointer;
  }

  private async markStep(
    journal: DurableLifecycleJournal,
    step: LifecycleJournalBoundary,
  ): Promise<DurableLifecycleJournal> {
    const next = DurableLifecycleJournalSchema.parse({
      ...journal,
      revision: journal.revision + 1,
      completed_steps: journal.completed_steps.includes(step)
        ? journal.completed_steps
        : [...journal.completed_steps, step],
      status: "committing",
      updated_at: this.clock.now().toISOString(),
    });
    await this.writeJournal(next);
    return next;
  }

  private resultFor(
    outcome: DurableLifecycleResult["outcome"],
    record: DurableLifecycleRecord,
  ): DurableLifecycleResult {
    return JournalResultSchema.parse({
      result_version: 1,
      outcome,
      final_state: record.state,
      final_generation: record.generation,
      active_package_digest: record.active_package_digest,
      last_known_good_package_digest: record.last_known_good_package_digest,
      owner_data_preserved: true,
    });
  }

  private async finishJournal(
    journal: DurableLifecycleJournal,
    status: "committed" | "rolled_back" | "failed_recoverable",
    result: DurableLifecycleResult,
    errorCode: "conflict" | "recoverable_internal_failure" | null,
  ): Promise<DurableLifecycleJournal> {
    const now = this.clock.now().toISOString();
    const next = DurableLifecycleJournalSchema.parse({
      ...journal,
      revision: journal.revision + 1,
      completed_steps: journal.completed_steps.includes("result_persisted")
        ? journal.completed_steps
        : [...journal.completed_steps, "result_persisted"],
      status,
      result,
      error_code: errorCode,
      updated_at: now,
      completed_at: now,
    });
    await this.writeJournal(next);
    return next;
  }

  private async writeJournal(journal: DurableLifecycleJournal): Promise<void> {
    await this.writeEnvelope(
      path.join(this.layout.journals, `${journal.operation_id}.json`),
      "journal",
      journal.revision,
      DurableLifecycleJournalSchema.parse(journal),
    );
  }

  private async requireJournal(operationId: string): Promise<DurableLifecycleJournal> {
    const journal = await this.readJournal(operationId);
    if (!journal) throw new ContractViolation("not_found_within_scope", "Lifecycle operation does not exist");
    return journal;
  }

  private async readEnvelope<T>(
    targetPath: string,
    kind: z.infer<typeof StoredEnvelopeSchema>["document_kind"],
    payloadSchema: z.ZodType<T>,
  ): Promise<T | null> {
    let raw: unknown;
    try {
      raw = JSON.parse(await this.filesystem.readFile(targetPath, "utf8"));
    } catch (error) {
      if (isMissing(error)) return null;
      throw persistenceFailure(`Durable ${kind} document is corrupt and was preserved`);
    }
    if (
      !raw
      || typeof raw !== "object"
      || !("lifecycle_store_version" in raw)
      || (raw as { lifecycle_store_version?: unknown }).lifecycle_store_version !== STORE_VERSION
    ) {
      throw new ContractViolation("incompatible_version", `Durable ${kind} document version is missing or unsupported`);
    }
    const envelopeResult = StoredEnvelopeSchema.safeParse(raw);
    if (!envelopeResult.success || envelopeResult.data.document_kind !== kind) {
      throw persistenceFailure(`Durable ${kind} envelope is invalid and was preserved`);
    }
    const envelope = envelopeResult.data;
    const expectedChecksum = canonicalJsonDocumentDigest({
      document_kind: envelope.document_kind,
      generation: envelope.generation,
      payload: envelope.payload,
    });
    if (envelope.checksum !== expectedChecksum) {
      throw persistenceFailure(`Durable ${kind} checksum failed and evidence was preserved`);
    }
    const parsed = payloadSchema.safeParse(envelope.payload);
    if (!parsed.success) throw persistenceFailure(`Durable ${kind} payload is invalid and was preserved`);
    return parsed.data;
  }

  private async writeEnvelope(
    targetPath: string,
    kind: z.infer<typeof StoredEnvelopeSchema>["document_kind"],
    generation: number,
    payload: unknown,
  ): Promise<void> {
    const envelope = StoredEnvelopeSchema.parse({
      lifecycle_store_version: STORE_VERSION,
      document_kind: kind,
      generation,
      checksum: canonicalJsonDocumentDigest({ document_kind: kind, generation, payload }),
      payload,
    });
    await this.writeAtomic(targetPath, envelope);
  }

  private async writeAtomic(targetPath: string, value: unknown): Promise<void> {
    const directory = path.dirname(targetPath);
    await this.filesystem.mkdir(directory, { recursive: true });
    const tempPath = `${targetPath}.${this.ids.next()}.tmp`;
    const handle = await this.filesystem.open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await this.filesystem.rename(tempPath, targetPath);
      await this.syncDirectory(directory);
    } catch (error) {
      await this.filesystem.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async syncDirectory(directoryPath: string): Promise<void> {
    const directory = await this.filesystem.open(directoryPath, "r");
    try {
      await directory.sync();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || !["EPERM", "EINVAL", "ENOTSUP"].includes(code ?? "")) throw error;
    } finally {
      await directory.close();
    }
  }
}

export { DurableLifecycleJournalSchema, JournalResultSchema, PackagePointerSchema, PackageReferenceSchema };
