import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LifecycleDiagnosticEventSchema } from "../contracts/audit.js";
import { canonicalJson } from "../contracts/common.js";
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
