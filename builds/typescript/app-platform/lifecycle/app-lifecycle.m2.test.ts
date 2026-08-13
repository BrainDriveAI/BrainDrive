import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ResumeDataLifecycleAdapter } from "../../resume-domain/lifecycle.js";
import { LifecycleDiagnosticEventSchema } from "../contracts/audit.js";
import { canonicalJson } from "../contracts/common.js";
import type { FirstPartyAppRegistration } from "../contracts/app-registry.js";
import {
  ALLOWED_LIFECYCLE_TRANSITIONS,
  LifecycleRecordSchema,
  type LifecycleState,
} from "../contracts/lifecycle.js";
import { AllowlistedLifecycleDiagnostics } from "./diagnostics.js";
import {
  LifecycleStore,
  NODE_LIFECYCLE_FILESYSTEM,
  type DurablePackageReference,
  type LifecycleFilesystem,
  type LifecycleJournalBoundary,
  type TransitionIntent,
} from "./durable-store.js";
import { LifecycleReconciler } from "./reconciler.js";
import {
  assertAppDataAdapterBinding,
  deleteRetainedAppData,
  validateAppDataBackupIdentity,
  type AppDataLifecycleAdapter,
  type AppDataBackupIdentity,
} from "./owner-data.js";
import { createAppLifecycleContextMap } from "./platform.js";
import { migrateLegacyResumeControlState } from "./state-migration.js";
import { AppLifecycleStore, initialLifecycleRecord } from "./store.js";
import { createLifecycleHarness } from "./test-helpers.js";
import {
  LifecycleStateMachine,
  type DurableLifecycleRecord,
  type LifecycleClock,
} from "./state-machine.js";

const APP_ID = "ai.braindrive.resume-builder" as const;
const OWNER_ID = "20000000-0000-4000-8000-000000000001";
const ACTOR_ID = "20000000-0000-4000-8000-000000000002";
const INSTALLATION_ID = "20000000-0000-4000-8000-000000000003";
const GRANT_ID = "20000000-0000-4000-8000-000000000004";
const ACTIVE_DIGEST = `sha256:${"a".repeat(64)}` as const;
const LKG_DIGEST = `sha256:${"b".repeat(64)}` as const;
const FIXED_TIME = "2026-08-08T12:00:00.000Z";

function spec08Registration(appId: string, routeKey: string): FirstPartyAppRegistration {
  return {
    registration_version: 1,
    app_id: appId,
    publisher_id: "ai.braindrive",
    route_key: routeKey,
    package_source_id: `first-party.${routeKey}`,
    lifecycle_binding_id: `lifecycle.${routeKey}`,
    runtime_profile_id: `runtime.${routeKey}`,
    capability_registrations: [],
    inference_purpose_registrations: [],
    data_adapter_registration: {
      registration_version: 1,
      app_id: appId,
      binding_id: `data.${routeKey}`,
      adapter_contract_version: 1,
      data_contract_version: 1,
      namespace_policy: "host_derived_from_verified_app_id",
      retention_policy: "retain_owner_data_remove_runtime_authority",
      owner_component_id: `${routeKey}.domain`,
    },
  };
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class MutableClock implements LifecycleClock {
  constructor(public milliseconds = Date.parse(FIXED_TIME)) {}
  now(): Date { return new Date(this.milliseconds); }
  advance(milliseconds: number): void { this.milliseconds += milliseconds; }
}

function packageReference(
  digest = ACTIVE_DIGEST,
  id = "20000000-0000-4000-8000-000000000005",
): DurablePackageReference {
  return {
    package_reference_version: 1,
    package_ref_id: id,
    app_id: APP_ID,
    package_digest: digest,
    package_version: digest === ACTIVE_DIGEST ? "1.0.0" : "0.9.0",
    cache_key: digest.slice(7, 23),
    created_at: FIXED_TIME,
  };
}

function recordFor(state: LifecycleState): DurableLifecycleRecord {
  if (state === "not_installed") {
    return LifecycleRecordSchema.parse({
      lifecycle_schema_version: 1,
      app_id: APP_ID,
      installation_id: null,
      state,
      generation: 0,
      active_package_digest: null,
      last_known_good_package_digest: null,
      grant_id: null,
      pending_operation_id: null,
      successful_use_checkpoint: null,
      updated_at: FIXED_TIME,
    });
  }
  return LifecycleRecordSchema.parse({
    lifecycle_schema_version: 1,
    app_id: APP_ID,
    installation_id: INSTALLATION_ID,
    state,
    generation: 7,
    active_package_digest: ACTIVE_DIGEST,
    last_known_good_package_digest: LKG_DIGEST,
    grant_id: GRANT_ID,
    pending_operation_id: ["staged", "updating", "rollback_pending", "uninstalling"].includes(state)
      ? "20000000-0000-4000-8000-000000000006"
      : null,
    successful_use_checkpoint: null,
    updated_at: FIXED_TIME,
  });
}

function transitionAuthority(to: LifecycleState): TransitionIntent["authority"] {
  if (to === "not_installed") return undefined;
  return {
    installation_id: INSTALLATION_ID,
    active_package_digest: ACTIVE_DIGEST,
    last_known_good_package_digest: LKG_DIGEST,
    grant_id: GRANT_ID,
  };
}

function intent(
  operationId = randomUUID(),
  overrides: Partial<TransitionIntent> = {},
): TransitionIntent {
  return {
    operationId,
    idempotencyKey: `m2-operation-${operationId}`,
    canonicalInput: { requested_version: "1.0.0" },
    ownerId: OWNER_ID,
    actorId: ACTOR_ID,
    kind: "install",
    to: "staged",
    authority: transitionAuthority("staged"),
    packageReferences: [packageReference(), packageReference(LKG_DIGEST, "20000000-0000-4000-8000-000000000007")],
    ...overrides,
  };
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function nodeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe("M2 LifecycleStateMachine", () => {
  it("enforces every accepted transition and rejects every other state pair", () => {
    const clock = new MutableClock();
    const machine = new LifecycleStateMachine(clock);
    const states = Object.keys(ALLOWED_LIFECYCLE_TRANSITIONS) as LifecycleState[];

    for (const from of states) {
      for (const to of states) {
        const action = () => machine.transition(recordFor(from), {
          operationId: randomUUID(),
          to,
          authority: transitionAuthority(to),
        });
        if (ALLOWED_LIFECYCLE_TRANSITIONS[from].includes(to)) {
          const next = action();
          expect(next.state, `${from} -> ${to}`).toBe(to);
          expect(next.generation, `${from} -> ${to}`).toBe(recordFor(from).generation + 1);
          expect(next.updated_at).toBe(FIXED_TIME);
          if (to === "not_installed") {
            expect(next).toMatchObject({
              installation_id: null,
              active_package_digest: null,
              last_known_good_package_digest: null,
              grant_id: null,
            });
          }
        } else {
          expect(action, `${from} -> ${to}`).toThrowError(
            expect.objectContaining({ code: "invalid_state_transition" }),
          );
        }
      }
    }
  });
});

describe("M2 versioned LifecycleStore", () => {
  it("treats missing state as not_installed and survives a clean restart with checksummed pointers", async () => {
    const root = await temporaryRoot("bd-m2-store-");
    const store = new LifecycleStore(root, { clock: new MutableClock() });
    await store.initialize();
    expect(await store.readState()).toMatchObject({
      state: "not_installed",
      generation: 0,
      installation_id: null,
      active_package_digest: null,
    });

    const request = intent();
    const result = await store.executeTransition(request);
    expect(result).toMatchObject({ outcome: "committed", final_state: "staged", final_generation: 1 });

    const restarted = new LifecycleStore(root, { clock: new MutableClock() });
    await restarted.initialize();
    const snapshot = await restarted.readConsistentSnapshot();
    expect(snapshot.record.state).toBe("staged");
    expect(snapshot.active.package_digest).toBe(ACTIVE_DIGEST);
    expect(snapshot.lastKnownGood.package_digest).toBe(LKG_DIGEST);
    expect((await restarted.readJournal(request.operationId))?.status).toBe("committed");
  });

  it("reuses same-operation results and rejects operation-ID reuse with different input", async () => {
    const root = await temporaryRoot("bd-m2-retry-");
    const store = new LifecycleStore(root, { clock: new MutableClock() });
    await store.initialize();
    const request = intent();
    const first = await store.executeTransition(request);
    const retry = await store.executeTransition(request);
    expect(retry).toEqual(first);
    await expect(store.executeTransition({
      ...request,
      canonicalInput: { requested_version: "2.0.0" },
    })).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("resumes the same durable operation after an interrupted nonterminal boundary", async () => {
    const root = await temporaryRoot("bd-m2-resume-");
    const store = new LifecycleStore(root, { clock: new MutableClock() });
    await store.initialize();
    const request = intent();
    await expect(store.executeTransition(request, {
      afterBoundary: (boundary) => {
        if (boundary === "pointers_persisted") throw new Error("simulated process loss");
      },
    })).rejects.toThrow("simulated process loss");
    await expect(store.executeTransition(intent())).rejects.toMatchObject({ code: "conflict" });

    const resumed = await store.executeTransition(request);
    expect(resumed).toMatchObject({ outcome: "committed", final_state: "staged", final_generation: 1 });
    expect((await store.listJournals())).toHaveLength(1);
    expect((await store.readConsistentSnapshot()).record.state).toBe("staged");
  });

  it("coalesces an in-process same-operation retry and conflicts a different concurrent mutation", async () => {
    const root = await temporaryRoot("bd-m2-concurrent-");
    const store = new LifecycleStore(root, { clock: new MutableClock() });
    await store.initialize();
    let releaseBoundary!: () => void;
    let boundaryReached!: () => void;
    const reached = new Promise<void>((resolve) => { boundaryReached = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseBoundary = resolve; });
    const firstIntent = intent();
    const first = store.executeTransition(firstIntent, {
      afterBoundary: async (boundary) => {
        if (boundary === "intent_persisted") {
          boundaryReached();
          await blocked;
        }
      },
    });
    await reached;
    const same = store.executeTransition(firstIntent);
    const competingStore = new LifecycleStore(root, { clock: new MutableClock() });
    await competingStore.initialize();
    await expect(competingStore.executeTransition(intent())).rejects.toMatchObject({ code: "conflict" });
    releaseBoundary();
    const [firstResult, sameResult] = await Promise.all([first, same]);
    expect(sameResult).toEqual(firstResult);
    expect((await store.listJournals())).toHaveLength(1);
  });

  it("preserves an expired lease as evidence and allows one stale-lock takeover", async () => {
    const root = await temporaryRoot("bd-m2-stale-lock-");
    const clock = new MutableClock();
    const first = new LifecycleStore(root, { clock, leaseDurationMs: 1_000 });
    await first.initialize();
    const abandoned = await first.acquireMutation(randomUUID());
    clock.advance(1_001);
    const second = new LifecycleStore(root, { clock, leaseDurationMs: 1_000 });
    const replacement = await second.acquireMutation(randomUUID());
    expect(replacement.lease_id).not.toBe(abandoned.lease_id);
    expect((await readdir(second.layout.locks)).some((name) => name.startsWith(`stale-${abandoned.lease_id}-`))).toBe(true);
    await second.releaseMutation(replacement);
  });

  it("never exposes a committed state generation when the atomic state rename fails", async () => {
    const root = await temporaryRoot("bd-m2-atomic-");
    let stateTarget = "";
    let failStateRename = true;
    const filesystem: LifecycleFilesystem = {
      ...NODE_LIFECYCLE_FILESYSTEM,
      rename: async (from, to) => {
        if (to === stateTarget && failStateRename) {
          failStateRename = false;
          throw nodeError("EIO");
        }
        await NODE_LIFECYCLE_FILESYSTEM.rename(from, to);
      },
    };
    const store = new LifecycleStore(root, { filesystem, clock: new MutableClock() });
    stateTarget = store.layout.state;
    await store.initialize();
    const request = intent();
    await expect(store.executeTransition(request)).rejects.toMatchObject({ code: "EIO" });
    expect((await store.readState()).generation).toBe(0);
    await expect(store.readConsistentSnapshot()).rejects.toMatchObject({ code: "recoverable_internal_failure" });

    const restarted = new LifecycleStore(root, { clock: new MutableClock() });
    await restarted.initialize();
    expect(await new LifecycleReconciler(restarted).reconcile()).toEqual([
      expect.objectContaining({ result: expect.objectContaining({ outcome: "rolled_back", final_state: "not_installed" }) }),
    ]);
    expect((await restarted.readConsistentSnapshot()).record.state).toBe("not_installed");
  });

  it.each([
    ["ENOSPC", "open"],
    ["EACCES", "rename"],
  ] as const)("preserves prior state on %s persistence failure", async (code, phase) => {
    const root = await temporaryRoot(`bd-m2-${code.toLowerCase()}-`);
    let failed = false;
    const filesystem: LifecycleFilesystem = {
      ...NODE_LIFECYCLE_FILESYSTEM,
      open: async (targetPath, flags, mode) => {
        if (!failed && phase === "open" && targetPath.includes(`${path.sep}journal${path.sep}`) && targetPath.endsWith(".tmp")) {
          failed = true;
          throw nodeError(code);
        }
        return NODE_LIFECYCLE_FILESYSTEM.open(targetPath, flags, mode);
      },
      rename: async (from, to) => {
        if (!failed && phase === "rename" && to.includes(`${path.sep}journal${path.sep}`)) {
          failed = true;
          throw nodeError(code);
        }
        return NODE_LIFECYCLE_FILESYSTEM.rename(from, to);
      },
    };
    const store = new LifecycleStore(root, { filesystem, clock: new MutableClock() });
    await store.initialize();
    await expect(store.executeTransition(intent())).rejects.toMatchObject({ code });
    expect(await store.readState()).toMatchObject({
      state: "not_installed",
      generation: 0,
      installation_id: null,
      active_package_digest: null,
    });
  });

  it.each([
    ["unknown", { lifecycle_store_version: 2 }],
    ["missing", { document_kind: "state" }],
  ])("fails closed and preserves a %s state version", async (_caseName, document) => {
    const root = await temporaryRoot("bd-m2-version-");
    const store = new LifecycleStore(root, { clock: new MutableClock() });
    await store.initialize();
    await writeFile(store.layout.state, `${JSON.stringify(document)}\n`, "utf8");
    const before = await readFile(store.layout.state, "utf8");
    await expect(store.readState()).rejects.toMatchObject({ code: "incompatible_version" });
    expect(await readFile(store.layout.state, "utf8")).toBe(before);
  });

  it("fails closed on corrupt JSON and checksum mismatch without replacing evidence", async () => {
    const root = await temporaryRoot("bd-m2-corrupt-");
    const store = new LifecycleStore(root, { clock: new MutableClock() });
    await store.initialize();
    await writeFile(store.layout.state, "{torn", "utf8");
    await expect(store.readState()).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    expect(await readFile(store.layout.state, "utf8")).toBe("{torn");

    await rm(store.layout.state, { force: true });
    await store.executeTransition(intent());
    const envelope = JSON.parse(await readFile(store.layout.state, "utf8")) as Record<string, unknown>;
    envelope.checksum = `sha256:${"0".repeat(64)}`;
    const tampered = `${canonicalJson(envelope)}\n`;
    await writeFile(store.layout.state, tampered, "utf8");
    await expect(store.readState()).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    expect(await readFile(store.layout.state, "utf8")).toBe(tampered);
  });
});

describe("M2 restart reconciliation", () => {
  const boundaries: LifecycleJournalBoundary[] = [
    "intent_persisted",
    "package_references_persisted",
    "pointers_persisted",
    "state_persisted",
    "result_persisted",
  ];

  it.each(boundaries)("reconciles a crash after %s without package or owner-data deletion", async (crashBoundary) => {
    const root = await temporaryRoot(`bd-m2-crash-${crashBoundary}-`);
    const store = new LifecycleStore(root, { clock: new MutableClock() });
    await store.initialize();
    const request = intent();
    await expect(store.executeTransition(request, {
      afterBoundary: (boundary) => {
        if (boundary === crashBoundary) throw new Error(`simulated crash after ${boundary}`);
      },
    })).rejects.toThrow(`simulated crash after ${crashBoundary}`);

    const restarted = new LifecycleStore(root, { clock: new MutableClock() });
    await restarted.initialize();
    const reconciled = await new LifecycleReconciler(restarted).reconcile();
    const stateWasCommitted = ["state_persisted", "result_persisted"].includes(crashBoundary);
    if (crashBoundary === "result_persisted") {
      expect(reconciled).toEqual([]);
    } else {
      expect(reconciled).toHaveLength(1);
      expect(reconciled[0]?.result.outcome).toBe(stateWasCommitted ? "committed" : "rolled_back");
    }
    const snapshot = await restarted.readConsistentSnapshot();
    expect(snapshot.record.state).toBe(stateWasCommitted ? "staged" : "not_installed");
    expect(snapshot.record.generation).toBe(stateWasCommitted ? 1 : 0);
    expect((await restarted.readJournal(request.operationId))?.status)
      .toBe(stateWasCommitted ? "committed" : "rolled_back");

    const files = await readdir(path.join(restarted.layout.appRoot, "package-references"));
    expect(files.every((name) => name.endsWith(".json"))).toBe(true);
  });
});

describe("M2 allowlisted diagnostics and non-execution boundary", () => {
  it("emits one strict content-free transition event and rejects forbidden fields", async () => {
    const root = await temporaryRoot("bd-m2-audit-");
    const events: unknown[] = [];
    const diagnostics = new AllowlistedLifecycleDiagnostics((event) => events.push(event));
    const store = new LifecycleStore(root, { clock: new MutableClock(), diagnostics });
    await store.initialize();
    await store.executeTransition(intent());
    expect(events).toHaveLength(1);
    expect(LifecycleDiagnosticEventSchema.parse(events[0])).toEqual(events[0]);
    expect(events[0]).not.toHaveProperty("path");
    expect(events[0]).not.toHaveProperty("manifest");
    expect(events[0]).not.toHaveProperty("token");
    expect(() => diagnostics.emit({ ...(events[0] as object), owner_path: "/private/owner/resume" }))
      .toThrowError(expect.objectContaining({ code: "forbidden_field" }));
  });

  it("keeps the M2 kernel free of process, package-verifier, gateway, and owner-data adapters", async () => {
    const sources = await Promise.all([
      "state-machine.ts",
      "durable-store.ts",
      "reconciler.ts",
      "diagnostics.ts",
    ].map((name) => readFile(path.join(import.meta.dirname, name), "utf8")));
    const combined = sources.join("\n");
    expect(combined).not.toMatch(/node:child_process|ProcessAppSupervisor|PackageVerifier|verifyAndExtract|from ["'].*gateway\/|from ["'].*owner-data/);
  });
});

describe("Spec 08 M2 app-scoped lifecycle platform", () => {
  it("derives distinct lifecycle, idempotency, runtime, and data roots from validated registrations", async () => {
    const root = await temporaryRoot("bd-spec08-m2-context-");
    const registrations = [
      spec08Registration("ai.braindrive.resume-builder", "resume-builder"),
      spec08Registration("ai.braindrive.brief-builder", "brief-builder"),
    ];
    const contexts = createAppLifecycleContextMap({
      registrations,
      stateRoot: path.join(root, "host"),
      memoryRoot: path.join(root, "memory"),
      createService: ({ registration, lifecycleRoot }) => new AppLifecycleStore(lifecycleRoot, { appId: registration.app_id }),
    });
    const resume = contexts.resolveAppId("ai.braindrive.resume-builder");
    const brief = contexts.resolveAppId("ai.braindrive.brief-builder");
    expect(new Set([
      resume.roots.lifecycle,
      brief.roots.lifecycle,
      resume.roots.runtime,
      brief.roots.runtime,
      resume.roots.data,
      brief.roots.data,
    ]).size).toBe(6);
    expect(resume.roots.lifecycle).toBe(path.join(root, "host", "state", "apps", "resume-builder"));
    expect(brief.roots.data).toBe(path.join(root, "memory", "apps", "brief-builder"));

    await Promise.all([resume.service.initialize(), brief.service.initialize()]);
    const [resumeResult, briefResult] = await Promise.all([
      resume.service.runIdempotent("same-operation-key", { installation_id: null }, async () => "resume"),
      brief.service.runIdempotent("same-operation-key", { installation_id: null }, async () => "brief"),
    ]);
    expect([resumeResult, briefResult]).toEqual(["resume", "brief"]);
    expect((await resume.service.readLifecycle()).app_id).toBe("ai.braindrive.resume-builder");
    expect((await brief.service.readLifecycle()).app_id).toBe("ai.braindrive.brief-builder");
  });

  it("rejects unvalidated traversal registrations before any context factory runs", () => {
    const createService = () => { throw new Error("must not run"); };
    expect(() => createAppLifecycleContextMap({
      registrations: [{ ...spec08Registration("ai.braindrive.brief-builder", "brief-builder"), route_key: "../resume-builder" }],
      stateRoot: "/synthetic/state",
      memoryRoot: "/synthetic/memory",
      createService,
    })).toThrowError(expect.objectContaining({ code: "descriptor_invalid" }));
  });
});

describe("Spec 08 M2 legacy Resume control-state migration", () => {
  async function legacyFixture(root: string) {
    const legacyRoot = path.join(root, "state");
    const registry = path.join(legacyRoot, "registry");
    const installationId = "30000000-0000-4000-8000-000000000001";
    const grantId = "30000000-0000-4000-8000-000000000002";
    const packageDigest = `sha256:${"c".repeat(64)}` as const;
    await mkdir(path.join(registry, "grants"), { recursive: true });
    await Promise.all(["operations", "packages", "idempotency", "tombstones"].map((name) => mkdir(path.join(registry, name), { recursive: true })));
    const lifecycle = LifecycleRecordSchema.parse({
      ...initialLifecycleRecord(FIXED_TIME),
      installation_id: installationId,
      state: "active",
      generation: 17,
      active_package_digest: packageDigest,
      grant_id: grantId,
    });
    await writeFile(path.join(registry, "lifecycle.json"), `${canonicalJson(lifecycle)}\n`, "utf8");
    await writeFile(path.join(registry, "grants", `${grantId}.json`), `${canonicalJson({
      grant_version: 1,
      grant_revision: 4,
      revocation_generation: 2,
      grant_id: grantId,
      owner_id: OWNER_ID,
      actor_id: ACTOR_ID,
      app_id: APP_ID,
      publisher_id: "ai.braindrive",
      package_digest: packageDigest,
      installation_id: installationId,
      capabilities: ["career.context.read"],
      record_scopes: [],
      decision: { decision_id: "30000000-0000-4000-8000-000000000003", decided_by_actor_id: ACTOR_ID, decided_at: FIXED_TIME, outcome: "approved" },
      issued_at: FIXED_TIME,
      expires_at: "2036-01-01T00:00:00.000Z",
      revoked_at: null,
    })}\n`, "utf8");
    return { legacyRoot, lifecycle, installationId, grantId, packageDigest };
  }

  it("treats missing legacy state as a deterministic no-op", async () => {
    const root = await temporaryRoot("bd-spec08-m2-missing-");
    await expect(migrateLegacyResumeControlState({ stateRoot: path.join(root, "state") }))
      .resolves.toMatchObject({ outcome: "missing", source_digest: null, destination_digest: null });
  });

  it("copy-verifies and atomically commits once while preserving exact control identities", async () => {
    const root = await temporaryRoot("bd-spec08-m2-migrate-");
    const fixture = await legacyFixture(root);
    const syntheticOwnerArtifact = path.join(root, "memory", "apps", "resume-builder", "records", "approved-artifact.json");
    await mkdir(path.dirname(syntheticOwnerArtifact), { recursive: true });
    const artifactBytes = Buffer.from('{"artifact_id":"synthetic-approved","lineage":"exact"}\n');
    await writeFile(syntheticOwnerArtifact, artifactBytes);
    const first = await migrateLegacyResumeControlState({ stateRoot: fixture.legacyRoot });
    expect(first).toMatchObject({ outcome: "migrated", source_digest: first.destination_digest });
    const migrated = JSON.parse(await readFile(path.join(fixture.legacyRoot, "apps", "resume-builder", "registry", "lifecycle.json"), "utf8"));
    expect(migrated).toEqual(fixture.lifecycle);
    expect(migrated).toMatchObject({ generation: 17, installation_id: fixture.installationId, active_package_digest: fixture.packageDigest, grant_id: fixture.grantId });
    await expect(migrateLegacyResumeControlState({ stateRoot: fixture.legacyRoot }))
      .resolves.toMatchObject({ outcome: "already_migrated", source_digest: first.source_digest, destination_digest: first.destination_digest });
    const evolvedIdempotency = path.join(fixture.legacyRoot, "apps", "resume-builder", "registry", "idempotency", "evolved.json");
    await mkdir(path.dirname(evolvedIdempotency), { recursive: true });
    await writeFile(evolvedIdempotency, `${canonicalJson({ idempotency_version: 1, input_digest: `sha256:${"e".repeat(64)}`, result: { state: "active" } })}\n`, "utf8");
    const evolved = await migrateLegacyResumeControlState({ stateRoot: fixture.legacyRoot });
    expect(evolved).toMatchObject({ outcome: "already_migrated", source_digest: first.source_digest });
    expect(evolved.destination_digest).not.toBe(first.destination_digest);
    expect(await readFile(evolvedIdempotency, "utf8")).toContain("active");
    expect(await readFile(path.join(fixture.legacyRoot, "registry", "lifecycle.json"), "utf8"))
      .toBe(`${canonicalJson(fixture.lifecycle)}\n`);
    expect(await readFile(syntheticOwnerArtifact)).toEqual(artifactBytes);
  });

  it("recovers an exact partial destination and rejects corrupt or conflicting state without replacement", async () => {
    const partialRoot = await temporaryRoot("bd-spec08-m2-partial-");
    const partial = await legacyFixture(partialRoot);
    await mkdir(path.join(partial.legacyRoot, "apps", "resume-builder"), { recursive: true });
    await cp(path.join(partial.legacyRoot, "registry"), path.join(partial.legacyRoot, "apps", "resume-builder", "registry"), { recursive: true });
    await expect(migrateLegacyResumeControlState({ stateRoot: partial.legacyRoot }))
      .resolves.toMatchObject({ outcome: "recovered_partial" });

    const corruptRoot = await temporaryRoot("bd-spec08-m2-corrupt-");
    const corrupt = await legacyFixture(corruptRoot);
    await writeFile(path.join(corrupt.legacyRoot, "registry", "lifecycle.json"), "{", "utf8");
    await expect(migrateLegacyResumeControlState({ stateRoot: corrupt.legacyRoot }))
      .rejects.toMatchObject({ code: "store_corrupt" });

    const conflictRoot = await temporaryRoot("bd-spec08-m2-conflict-");
    const conflict = await legacyFixture(conflictRoot);
    const destination = path.join(conflict.legacyRoot, "apps", "resume-builder", "registry");
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, "lifecycle.json"), `${canonicalJson(initialLifecycleRecord(FIXED_TIME))}\n`, "utf8");
    const before = await readFile(path.join(destination, "lifecycle.json"), "utf8");
    await expect(migrateLegacyResumeControlState({ stateRoot: conflict.legacyRoot }))
      .rejects.toMatchObject({ code: "conflict" });
    expect(await readFile(path.join(destination, "lifecycle.json"), "utf8")).toBe(before);
  });

  it("does not expose a destination or receipt when the atomic commit hook fails", async () => {
    const root = await temporaryRoot("bd-spec08-m2-atomic-");
    const fixture = await legacyFixture(root);
    await expect(migrateLegacyResumeControlState({
      stateRoot: fixture.legacyRoot,
      beforeDestinationCommit: async () => { throw new Error("synthetic commit fault"); },
    })).rejects.toThrow("synthetic commit fault");
    await expect(readFile(path.join(fixture.legacyRoot, "apps", "resume-builder", "registry", "lifecycle.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("Spec 08 M2 generic data lifecycle adapter", () => {
  function fakeAdapter(root: string, appId = "ai.braindrive.brief-builder"): AppDataLifecycleAdapter {
    return {
      identity: {
        adapter_contract_version: 1,
        app_id: appId,
        publisher_id: "ai.braindrive",
        binding_id: "data.brief-builder",
        data_contract_version: 1,
      },
      namespaceRoot: root,
      prepareActivation: async () => ({ state: "ready" }),
      cleanupDefaultUninstall: async () => ({ outcome: "cleaned" }),
      validateBackupIdentity: async (backup: AppDataBackupIdentity) => validateAppDataBackupIdentity({
        adapter_contract_version: 1,
        app_id: appId,
        publisher_id: "ai.braindrive",
        binding_id: "data.brief-builder",
        data_contract_version: 1,
      }, backup),
      deleteRetainedData: async () => {
        await rm(root, { recursive: true, force: true });
        return { deleted: true as const, deleted_namespace_digest: `sha256:${"d".repeat(64)}` as const };
      },
    };
  }

  it("fails adapter or restore identity substitution before adapter work", async () => {
    const root = await temporaryRoot("bd-spec08-m2-adapter-");
    const registration = spec08Registration("ai.braindrive.brief-builder", "brief-builder");
    const adapter = fakeAdapter(path.join(root, "memory", "apps", "brief-builder"));
    expect(assertAppDataAdapterBinding(registration, adapter, path.join(root, "memory"))).toBe(adapter);
    expect(() => assertAppDataAdapterBinding(registration, fakeAdapter(adapter.namespaceRoot, "ai.braindrive.resume-builder"), path.join(root, "memory")))
      .toThrowError(expect.objectContaining({ code: "descriptor_invalid" }));
    await expect(adapter.validateBackupIdentity({
      backup_version: 1,
      app_id: "ai.braindrive.brief-builder",
      publisher_id: "ai.braindrive",
      adapter_binding_id: "data.brief-builder",
      adapter_contract_version: 1,
      data_contract_version: 1,
      content_digest: `sha256:${"e".repeat(64)}`,
    })).resolves.toMatchObject({ app_id: "ai.braindrive.brief-builder", data_contract_version: 1 });
    await expect(adapter.validateBackupIdentity({
      backup_version: 1,
      app_id: "ai.braindrive.resume-builder",
      publisher_id: "ai.braindrive",
      adapter_binding_id: "data.resume-builder",
      adapter_contract_version: 1,
      data_contract_version: 1,
      content_digest: `sha256:${"e".repeat(64)}`,
    })).rejects.toMatchObject({ code: "incompatible_schema" });

    const resumeAdapter = new ResumeDataLifecycleAdapter(path.join(root, "resume-memory"));
    await expect(resumeAdapter.validateBackupIdentity({
      backup_version: 1,
      app_id: "ai.braindrive.resume-builder",
      publisher_id: "ai.braindrive",
      adapter_binding_id: "data.resume-builder",
      adapter_contract_version: 1,
      data_contract_version: 4,
      content_digest: `sha256:${"a".repeat(64)}`,
    })).resolves.toMatchObject({ app_id: "ai.braindrive.resume-builder", adapter_binding_id: "data.resume-builder" });
    await expect(resumeAdapter.validateBackupIdentity({
      backup_version: 1,
      app_id: "ai.braindrive.brief-builder",
      publisher_id: "ai.braindrive",
      adapter_binding_id: "data.resume-builder",
      adapter_contract_version: 1,
      data_contract_version: 4,
      content_digest: `sha256:${"a".repeat(64)}`,
    })).rejects.toMatchObject({ code: "incompatible_schema" });
  });

  it("retains data by default and permits trusted deletion only while uninstalled", async () => {
    const root = await temporaryRoot("bd-spec08-m2-delete-");
    const dataRoot = path.join(root, "memory", "apps", "brief-builder");
    await mkdir(dataRoot, { recursive: true });
    await writeFile(path.join(dataRoot, "synthetic.json"), "{}\n", "utf8");
    const store = new AppLifecycleStore(path.join(root, "state", "apps", "brief-builder"), { appId: "ai.braindrive.brief-builder" });
    await store.initialize();
    const adapter = fakeAdapter(dataRoot);
    expect(await adapter.cleanupDefaultUninstall()).toEqual({ outcome: "cleaned" });
    expect(await readFile(path.join(dataRoot, "synthetic.json"), "utf8")).toBe("{}\n");

    await expect(deleteRetainedAppData({
      store,
      adapter: fakeAdapter(path.join(root, "memory", "apps", "resume-builder")),
      appId: "ai.braindrive.brief-builder",
      ownerId: OWNER_ID,
      ownerActorId: "owner",
      expectedDataRoot: dataRoot,
      request: { operationId: randomUUID(), idempotencyKey: "explicit-delete-cross-root", ownerActorId: "owner", confirmAppId: "ai.braindrive.brief-builder", trustedOwnerConfirmation: true },
    })).rejects.toMatchObject({ code: "denied" });

    const uninstalled = await store.readLifecycle();
    await store.compareAndSwapLifecycle(uninstalled.generation, {
      ...uninstalled,
      state: "active",
      generation: uninstalled.generation + 1,
      installation_id: INSTALLATION_ID,
      active_package_digest: ACTIVE_DIGEST,
      grant_id: GRANT_ID,
    });
    await expect(deleteRetainedAppData({
      store,
      adapter,
      appId: "ai.braindrive.brief-builder",
      ownerId: OWNER_ID,
      ownerActorId: "owner",
      expectedDataRoot: dataRoot,
      request: { operationId: randomUUID(), idempotencyKey: "explicit-delete-active", ownerActorId: "owner", confirmAppId: "ai.braindrive.brief-builder", trustedOwnerConfirmation: true },
    })).rejects.toMatchObject({ code: "invalid_state_transition" });
    expect(await readFile(path.join(dataRoot, "synthetic.json"), "utf8")).toBe("{}\n");
    const active = await store.readLifecycle();
    await store.compareAndSwapLifecycle(active.generation, {
      ...initialLifecycleRecord(FIXED_TIME, "ai.braindrive.brief-builder"),
      generation: active.generation + 1,
    });

    const result = await deleteRetainedAppData({
      store,
      adapter,
      appId: "ai.braindrive.brief-builder",
      ownerId: OWNER_ID,
      ownerActorId: "owner",
      expectedDataRoot: dataRoot,
      request: { operationId: randomUUID(), idempotencyKey: "explicit-delete-safe-01", ownerActorId: "owner", confirmAppId: "ai.braindrive.brief-builder", trustedOwnerConfirmation: true },
    });
    expect(result).toMatchObject({ app_id: "ai.braindrive.brief-builder", deleted: true });
    await expect(readFile(path.join(dataRoot, "synthetic.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await store.readDataDeletionTombstone(result.operation_id)).toMatchObject({ app_id: "ai.braindrive.brief-builder", deleted: true });
  });

  it("serializes retained-data deletion against install data preparation", async () => {
    const root = await temporaryRoot("bd-spec08-m2-delete-install-");
    const harness = await createLifecycleHarness(root);
    const dataRoot = harness.ownerDataRoot;
    await mkdir(dataRoot, { recursive: true });
    await writeFile(path.join(dataRoot, "synthetic.json"), "{}\n", "utf8");

    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
    let deletionEntered!: () => void;
    const deletionStarted = new Promise<void>((resolve) => { deletionEntered = resolve; });
    const events: string[] = [];
    const adapter: AppDataLifecycleAdapter = {
      identity: {
        adapter_contract_version: 1,
        app_id: APP_ID,
        publisher_id: "ai.braindrive",
        binding_id: "data.resume-builder",
        data_contract_version: 4,
      },
      namespaceRoot: dataRoot,
      prepareActivation: async () => { events.push("prepare"); return { state: "ready" }; },
      cleanupDefaultUninstall: async () => ({ outcome: "cleaned" }),
      validateBackupIdentity: async (backup) => backup,
      deleteRetainedData: async () => {
        events.push("delete-start");
        deletionEntered();
        await deleteGate;
        await rm(dataRoot, { recursive: true, force: true });
        events.push("delete-end");
        return { deleted: true, deleted_namespace_digest: `sha256:${"d".repeat(64)}` };
      },
    };
    harness.dependencies.ownerDataLifecycle = adapter;
    harness.dependencies.dataAdapter = adapter;
    const verifyAndExtract = harness.dependencies.verifier.verifyAndExtract.bind(harness.dependencies.verifier);
    let verificationEntered!: () => void;
    const verificationStarted = new Promise<void>((resolve) => { verificationEntered = resolve; });
    harness.dependencies.verifier.verifyAndExtract = async (...args) => {
      verificationEntered();
      return verifyAndExtract(...args);
    };

    const deleting = harness.service.deleteRetainedData({
      operationId: randomUUID(),
      idempotencyKey: "explicit-delete-race-01",
      ownerActorId: "owner",
      confirmAppId: APP_ID,
      trustedOwnerConfirmation: true,
    });
    await deletionStarted;
    const installing = harness.service.install({
      version: "1.0.0",
      idempotencyKey: "install-after-delete-01",
      approveCapabilities: true,
    });
    const overlap = await Promise.race([
      verificationStarted.then(() => "verification-entered" as const),
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 200)),
    ]);
    expect(overlap).toBe("blocked");
    expect(events).toEqual(["delete-start"]);

    releaseDelete();
    await deleting;
    await installing;
    expect(events).toEqual(["delete-start", "delete-end", "prepare"]);
  });

  it("keeps durable prepared evidence when the adapter fails before deletion and permits exact retry", async () => {
    const root = await temporaryRoot("bd-spec08-m2-delete-adapter-retry-");
    const dataRoot = path.join(root, "memory", "apps", "brief-builder");
    const store = new AppLifecycleStore(path.join(root, "state", "apps", "brief-builder"), {
      appId: "ai.braindrive.brief-builder",
    });
    await store.initialize();
    await mkdir(dataRoot, { recursive: true });
    await writeFile(path.join(dataRoot, "synthetic.json"), "{}\n", "utf8");
    const adapter = fakeAdapter(dataRoot);
    const deleteRetainedData = adapter.deleteRetainedData;
    let failBeforeDelete = true;
    adapter.deleteRetainedData = async (request) => {
      if (failBeforeDelete) {
        failBeforeDelete = false;
        throw new Error("synthetic adapter pre-delete fault");
      }
      return deleteRetainedData(request);
    };
    const request = {
      operationId: randomUUID(),
      idempotencyKey: "explicit-delete-adapter-retry",
      ownerActorId: "owner",
      confirmAppId: "ai.braindrive.brief-builder",
      trustedOwnerConfirmation: true,
    } as const;
    const input = {
      store,
      adapter,
      appId: "ai.braindrive.brief-builder",
      ownerId: OWNER_ID,
      ownerActorId: "owner",
      expectedDataRoot: dataRoot,
      request,
    };

    await expect(deleteRetainedAppData(input)).rejects.toThrow("synthetic adapter pre-delete fault");
    expect(await readFile(path.join(dataRoot, "synthetic.json"), "utf8")).toBe("{}\n");
    expect(await store.readDataDeletionTombstone(request.operationId)).toMatchObject({
      status: "prepared",
      deleted: false,
    });
    await expect(store.runLifecycleMutation(async () => "install"))
      .rejects.toMatchObject({ code: "recoverable_internal_failure" });

    await expect(deleteRetainedAppData(input)).resolves.toMatchObject({ deleted: true });
    expect(await store.readDataDeletionTombstone(request.operationId)).toMatchObject({
      status: "committed",
      deleted: true,
    });
  });

  it("persists deletion intent before deleting and recovers a failed final tombstone write", async () => {
    const root = await temporaryRoot("bd-spec08-m2-delete-recovery-");
    const dataRoot = path.join(root, "memory", "apps", "brief-builder");
    const stateRoot = path.join(root, "state", "apps", "brief-builder");
    const operationId = randomUUID();
    let deletionRecordWrites = 0;
    const faultedStore = new AppLifecycleStore(stateRoot, {
      appId: "ai.braindrive.brief-builder",
      beforeRename: async (targetPath) => {
        if (targetPath.endsWith(`data-${operationId}.json`) && ++deletionRecordWrites === 2) {
          throw new Error("synthetic post-delete tombstone fault");
        }
      },
    });
    await faultedStore.initialize();
    await mkdir(dataRoot, { recursive: true });
    await writeFile(path.join(dataRoot, "synthetic.json"), "{}\n", "utf8");
    let deleteCalls = 0;
    const adapter = fakeAdapter(dataRoot);
    const originalDelete = adapter.deleteRetainedData;
    adapter.deleteRetainedData = async (request) => { deleteCalls += 1; return originalDelete(request); };
    const request = {
      operationId,
      idempotencyKey: "explicit-delete-recover-01",
      ownerActorId: "owner",
      confirmAppId: "ai.braindrive.brief-builder",
      trustedOwnerConfirmation: true,
    } as const;

    await expect(deleteRetainedAppData({
      store: faultedStore,
      adapter,
      appId: "ai.braindrive.brief-builder",
      ownerId: OWNER_ID,
      ownerActorId: "owner",
      expectedDataRoot: dataRoot,
      request,
    })).rejects.toThrow("synthetic post-delete tombstone fault");
    expect(deleteCalls).toBe(1);
    expect(await faultedStore.readDataDeletionTombstone(operationId)).toMatchObject({
      operation_id: operationId,
      status: "prepared",
      deleted: false,
    });
    await expect(faultedStore.runLifecycleMutation(async () => "install"))
      .rejects.toMatchObject({ code: "recoverable_internal_failure" });

    const restartedStore = new AppLifecycleStore(stateRoot, { appId: "ai.braindrive.brief-builder" });
    await restartedStore.initialize();
    await expect(restartedStore.runLifecycleMutation(async () => "install"))
      .rejects.toMatchObject({ code: "recoverable_internal_failure" });
    const recovered = await deleteRetainedAppData({
      store: restartedStore,
      adapter,
      appId: "ai.braindrive.brief-builder",
      ownerId: OWNER_ID,
      ownerActorId: "owner",
      expectedDataRoot: dataRoot,
      request,
    });
    expect(deleteCalls).toBe(2);
    expect(recovered).toMatchObject({ operation_id: operationId, deleted: true });
    expect(await restartedStore.readDataDeletionTombstone(operationId)).toMatchObject({
      operation_id: operationId,
      status: "committed",
      deleted: true,
    });
    await expect(restartedStore.runLifecycleMutation(async () => "install")).resolves.toBe("install");
  });
});
