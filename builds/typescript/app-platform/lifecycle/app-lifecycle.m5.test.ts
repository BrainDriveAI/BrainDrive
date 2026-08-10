import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJsonDocumentDigest } from "../contracts/common.js";
import { PackageDescriptorSchema, RevocationListSchema, SUPERVISOR_POLICY, TrustRootSchema } from "../contracts/package.js";
import type { ResumeLifecycleDataAdapter } from "../contracts/lifecycle-foundation.js";
import { deterministicFixtureId } from "./atomic-install.js";
import { CapabilityTokenBroker } from "./capability-token.js";
import { createFixtureRepository } from "./fixture-repository.js";
import { LifecycleStore, type DurablePackageReference } from "./durable-store.js";
import { InstalledAppSupervisorAdapter } from "./installed-app-supervisor-adapter.js";
import { InstallationGrantStore } from "./install-grants.js";
import { PackageVerifier as LegacyFixturePackageVerifier } from "./package-verifier.js";
import { InMemoryAppSupervisor, ProcessAppSupervisor, type RuntimeLaunchDescriptor } from "./process-supervisor.js";
import { RuntimeAuthorityStore } from "./runtime-authority-store.js";
import { InMemoryRuntimeRegistrationNegotiator } from "./runtime-negotiator.js";
import { MonotonicRevocationAuthority } from "./revocation-authority.js";
import { capabilityDiff, SimulatedUpdateInterruption, TransactionalUpdateService, type TransactionalUpdateStep } from "./transactional-update.js";
import { FileVerifiedPackageAuthorityCache } from "./verified-feed-cache.js";
import type { ImmutablePackageRecord, ImmutablePackageStore } from "./verified-package-store.js";
import type { VerifiedPackage, VerifyPackageRequest } from "./verified-package.js";
import { makeRuntimeDescriptor } from "./test-helpers.js";
import { ResumeDataLifecycleAdapter } from "../../resume-domain/lifecycle.js";
import { ResumeDataStore } from "../../resume-domain/store.js";

const OWNER_ID = "50000000-0000-4000-8000-000000000001";
const INSTALLATION_ID = "50000000-0000-4000-8000-000000000002";
const OPERATION_ID = "50000000-0000-4000-8000-000000000003";
const GRANT_ID = "50000000-0000-4000-8000-000000000004";
const OLD_DIGEST = `sha256:${"1".repeat(64)}` as const;
const NEW_DIGEST = `sha256:${"2".repeat(64)}` as const;
const roots: string[] = [];
const FIXTURE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "m3-docker");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function dataContext(packageDigest = NEW_DIGEST) {
  return {
    adapter_contract_version: 1 as const,
    operation_id: OPERATION_ID,
    owner_id: OWNER_ID,
    installation_id: INSTALLATION_ID,
    app_id: "ai.braindrive.resume-builder" as const,
    package_digest: packageDigest,
    requested_at: "2026-08-09T12:00:00.000Z",
  };
}

function runtime(packageDigest: typeof OLD_DIGEST | typeof NEW_DIGEST): RuntimeLaunchDescriptor {
  return {
    supervisor_protocol_version: 1,
    runtime_kind: "container",
    app_id: "ai.braindrive.resume-builder",
    installation_id: INSTALLATION_ID,
    package_digest: packageDigest,
    grant_id: GRANT_ID,
    verified_entrypoint: "payload/server.js",
    arguments: [],
    environment_keys: [
      "BRAINDRIVE_APP_CONNECTION_TOKEN",
      "BRAINDRIVE_APP_ID",
      "BRAINDRIVE_INSTALLATION_ID",
      "BRAINDRIVE_PACKAGE_DIGEST",
      "BRAINDRIVE_ENDPOINT_BIND",
    ],
    package_root_ref: "50000000-0000-4000-8000-000000000005",
    cache_root_ref: "50000000-0000-4000-8000-000000000006",
    endpoint_policy: { transport: "container_internal", authentication: "per_installation_token", public_bind_allowed: false },
    resource_policy_version: SUPERVISOR_POLICY.policy_version,
    resolved_entrypoint: "/fixture/server.js",
  };
}

describe("M5 prerequisite contracts", () => {
  it("implements opaque schema discovery, snapshot integrity, and exact restore without returning a path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m5-data-"));
    roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    await store.initialize(OWNER_ID);
    const adapter = new ResumeDataLifecycleAdapter(root);
    const inspected = await adapter.inspectSchema({ action: "inspect_schema", context: dataContext() });
    expect(inspected).toMatchObject({ outcome: "compatible", observed_schema_version: 1, readable: true, writable: true });
    const discovered = await adapter.discoverRetainedData({ action: "discover_retained_data", context: dataContext() });
    expect(discovered).toMatchObject({ present: true, schema_version: 1, compatible: true });

    const snapshot = await adapter.snapshot({ action: "snapshot", context: dataContext(), from_schema_version: 1, to_schema_version: 1 });
    expect(snapshot.snapshot_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(snapshot)).not.toMatch(/[\\/]apps[\\/]|catalog\.json/);
    const catalogPath = path.join(root, "apps", "resume-builder", "catalog.json");
    const priorBytes = await readFile(catalogPath, "utf8");
    await writeFile(catalogPath, "{\"corrupt\":true}\n", "utf8");
    const restored = await adapter.restore({ action: "restore", context: dataContext(), snapshot_id: snapshot.snapshot_id });
    expect(restored.restored_digest).toBe(snapshot.snapshot_digest);
    expect(await readFile(catalogPath, "utf8")).toBe(priorBytes);
  });

  it("fails closed for an unimplemented schema transformer while retaining its recovery snapshot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m5-data-migration-"));
    roots.push(root);
    await new ResumeDataStore(root, undefined, {}, false).initialize(OWNER_ID);
    const adapter = new ResumeDataLifecycleAdapter(root);
    const snapshot = await adapter.snapshot({ action: "snapshot", context: dataContext(), from_schema_version: 1, to_schema_version: 2 });
    await expect(adapter.migrate({ action: "migrate", context: dataContext(), snapshot_id: snapshot.snapshot_id, from_schema_version: 1, to_schema_version: 2 })).rejects.toMatchObject({ code: "incompatible_schema" });
    expect(await adapter.listSnapshotIds()).toEqual([snapshot.snapshot_id]);
  });

  it("readiness-probes one non-authoritative candidate beside the old runtime and promotes only after old stop", async () => {
    const supervisor = new InMemoryAppSupervisor();
    const old = await supervisor.start(runtime(OLD_DIGEST));
    const candidate = await supervisor.start(runtime(NEW_DIGEST), "candidate");
    expect(supervisor.inspect(INSTALLATION_ID).map((value) => value.package_digest).sort()).toEqual([NEW_DIGEST, OLD_DIGEST].sort());
    await supervisor.awaitReadiness(candidate.runtime!);
    expect(() => supervisor.promoteCandidate(candidate.runtime!)).toThrowError(/prior runtime must stop/i);
    await supervisor.stop(old.runtime!, "update");
    supervisor.promoteCandidate(candidate.runtime!);
    expect(supervisor.inspect(INSTALLATION_ID)).toEqual([candidate.runtime]);
    await supervisor.close();
  });

  it("runs the candidate slot against two authenticated Docker-target fixture processes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m5-process-candidate-"));
    roots.push(root);
    const repository = await createFixtureRepository(path.join(root, "source"));
    const verifier = new LegacyFixturePackageVerifier("26.7.23");
    const oldPackage = await verifier.verifyAndExtract(repository, "1.0.0", path.join(root, "runtime-old"), "candidate_install_or_update");
    const newPackage = await verifier.verifyAndExtract(repository, "2.0.0", path.join(root, "runtime-new"), "candidate_install_or_update");
    const oldDescriptor = makeRuntimeDescriptor(oldPackage);
    const candidateDescriptor = { ...makeRuntimeDescriptor(newPackage), installation_id: oldDescriptor.installation_id };
    const supervisor = new ProcessAppSupervisor({ startupTimeoutMs: 5_000, stopGraceMs: 1_000, automaticRecovery: false });
    try {
      const old = await supervisor.start(oldDescriptor);
      await supervisor.awaitReadiness(old.runtime!);
      const candidate = await supervisor.start(candidateDescriptor, "candidate");
      await supervisor.awaitReadiness(candidate.runtime!);
      expect(supervisor.inspect(oldDescriptor.installation_id)).toHaveLength(2);
      await supervisor.stop(old.runtime!, "update");
      supervisor.promoteCandidate(candidate.runtime!);
      expect(supervisor.inspect(oldDescriptor.installation_id)).toEqual([candidate.runtime]);
    } finally {
      await supervisor.close();
    }
  });
});

describe("M5 signed monotonic revocation authority", () => {
  it("accepts a valid signed list and preserves it when a tampered candidate is rejected", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m5-revocation-signed-"));
    roots.push(root);
    const cache = new FileVerifiedPackageAuthorityCache(root);
    const candidateBytes = await readFile(path.join(FIXTURE_ROOT, "revocations.json"));
    const trustRootBytes = await readFile(path.join(FIXTURE_ROOT, "trust-root.json"));
    const trustRoot = TrustRootSchema.parse(JSON.parse(trustRootBytes.toString("utf8")));
    const authority = new MonotonicRevocationAuthority(cache, () => new Date("2026-08-09T12:00:00.000Z"));
    const request = { candidateBytes, trustRootBytes, pinnedRoot: { keyId: trustRoot.root_key.key_id, publicKey: trustRoot.root_key.public_key } };

    await expect(authority.refresh(request)).resolves.toMatchObject({ outcome: "accepted", sequence: 1 });
    const tampered = JSON.parse(candidateBytes.toString("utf8")) as { signature: { signature: string } };
    tampered.signature.signature = `${tampered.signature.signature.startsWith("A") ? "B" : "A"}${tampered.signature.signature.slice(1)}`;
    await expect(authority.refresh({ ...request, candidateBytes: Buffer.from(JSON.stringify(tampered)) })).resolves.toMatchObject({ outcome: "rejected", sequence: 1, error_code: "revocation_metadata_invalid" });
    await expect(authority.refresh({ ...request, candidateBytes: Buffer.alloc(0) })).resolves.toMatchObject({ outcome: "rejected", sequence: 1, error_code: "revocation_metadata_invalid" });
    expect((await cache.readRevocations())?.payload.sequence).toBe(1);
  });

  it("rejects an older replacement and keeps stale offline explicit matches authoritative", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m5-revocation-monotonic-"));
    roots.push(root);
    const { authority, cache, candidate, trustRoot } = await revocationAuthority(root, OLD_DIGEST, () => new Date("2026-08-11T12:00:00.000Z"));
    const next = RevocationListSchema.parse({
      ...candidate,
      payload: {
        ...candidate.payload,
        sequence: 2,
        prior_list_digest: canonicalJsonDocumentDigest(candidate.payload),
        issued_at: "2026-08-09T11:36:36.888Z",
        next_update_at: "2026-08-09T12:36:36.888Z",
      },
    });
    const refreshInput = { trustRootBytes: Buffer.from(JSON.stringify(trustRoot)), pinnedRoot: { keyId: trustRoot.root_key.key_id, publicKey: trustRoot.root_key.public_key } };
    await expect(authority.refresh({ ...refreshInput, candidateBytes: Buffer.from(JSON.stringify(next)) })).resolves.toMatchObject({ outcome: "accepted", sequence: 2 });
    await expect(authority.refresh({ ...refreshInput, candidateBytes: Buffer.from(JSON.stringify(candidate)) })).resolves.toMatchObject({ outcome: "rejected", sequence: 2, error_code: "revocation_rollback" });
    expect((await cache.readRevocations())?.payload.sequence).toBe(2);
    await expect(authority.status("1.0.0", OLD_DIGEST, "offline")).resolves.toMatchObject({ cache_state: "stale", external_status: "offline", explicitly_revoked: true, sequence: 2 });
    await expect(authority.assertAllowed("1.0.0", OLD_DIGEST, { requireFresh: false, externalStatus: "offline" })).rejects.toMatchObject({ code: "package_revoked" });
  });
});

class FakePackages {
  readonly records = new Map<string, ImmutablePackageRecord>();
  readonly references = new Map<string, Set<string>>();
  async initialize() {}
  async promote(verified: VerifiedPackage) {
    const record = { packageDigest: verified.packageDigest, packageVersion: verified.manifest.package_version, contentRoot: verified.stageRoot, entrypoint: verified.entrypoint, target: verified.target, referenceCount: this.references.get(verified.packageDigest)?.size ?? 0 } satisfies ImmutablePackageRecord;
    this.records.set(verified.packageDigest, record);
    return record;
  }
  async acquire(digest: string, referenceId: string) { const set = this.references.get(digest) ?? new Set<string>(); set.add(referenceId); this.references.set(digest, set); return { ...this.require(digest), referenceCount: set.size }; }
  async release(digest: string, referenceId: string) { const set = this.references.get(digest) ?? new Set<string>(); set.delete(referenceId); this.references.set(digest, set); return { ...this.require(digest), referenceCount: set.size }; }
  async read(digest: string) { return { ...this.require(digest), referenceCount: this.references.get(digest)?.size ?? 0 }; }
  async resolveReferencedRuntime(digest: string, referenceId: string) { if (!this.references.get(digest)?.has(referenceId)) throw new Error("missing package reference"); return this.read(digest); }
  private require(digest: string) { const record = this.records.get(digest); if (!record) throw new Error("missing package"); return record; }
}

class FakeLifecycleData implements ResumeLifecycleDataAdapter {
  schemaVersion = 1;
  failMigration = false;
  failRestore = false;
  readonly snapshots = new Map<string, { schema: number; digest: `sha256:${string}` }>();
  inspectSchema = async (_request: Parameters<ResumeLifecycleDataAdapter["inspectSchema"]>[0]) => ({ action: "inspect_schema" as const, outcome: "compatible" as const, observed_schema_version: this.schemaVersion, readable: true, writable: true, content_digest: this.digest() });
  discoverRetainedData = async (_request: Parameters<ResumeLifecycleDataAdapter["discoverRetainedData"]>[0]) => ({ action: "discover_retained_data" as const, present: true, schema_version: this.schemaVersion, compatible: true, data_ref: deterministicFixtureId("m5-fake-data") });
  snapshot = async (request: Parameters<ResumeLifecycleDataAdapter["snapshot"]>[0]) => { const id = deterministicFixtureId(`m5-snapshot-${this.snapshots.size + 1}`); const digest = this.digest(); this.snapshots.set(id, { schema: request.from_schema_version, digest }); return { action: "snapshot" as const, snapshot_id: id, snapshot_digest: digest, schema_version: request.from_schema_version }; };
  migrate = async (request: Parameters<ResumeLifecycleDataAdapter["migrate"]>[0]) => { this.schemaVersion = request.to_schema_version; if (this.failMigration) throw new Error("injected migration failure"); return { action: "migrate" as const, migration_id: deterministicFixtureId(`m5-migration-${request.to_schema_version}`), snapshot_id: request.snapshot_id, from_schema_version: request.from_schema_version, to_schema_version: request.to_schema_version, result_digest: this.digest() }; };
  restore = async (request: Parameters<ResumeLifecycleDataAdapter["restore"]>[0]) => { if (this.failRestore) throw new Error("injected restore failure"); const snapshot = this.snapshots.get(request.snapshot_id); if (!snapshot) throw new Error("missing snapshot"); this.schemaVersion = snapshot.schema; return { action: "restore" as const, snapshot_id: request.snapshot_id, restored_schema_version: snapshot.schema, restored_digest: snapshot.digest }; };
  listSnapshotIds = async () => [...this.snapshots.keys()].sort();
  releaseSnapshot = async (snapshotId: string) => { this.snapshots.delete(snapshotId); };
  private digest() { return `sha256:${String(this.schemaVersion).repeat(64)}` as `sha256:${string}`; }
}

async function revocationAuthority(root: string, packageDigest?: string, clock = () => new Date("2026-08-09T12:00:00.000Z")) {
  const cache = new FileVerifiedPackageAuthorityCache(root);
  const fixture = RevocationListSchema.parse(JSON.parse(await readFile(path.join(FIXTURE_ROOT, "revocations.json"), "utf8")));
  const trustRoot = TrustRootSchema.parse(JSON.parse(await readFile(path.join(FIXTURE_ROOT, "trust-root.json"), "utf8")));
  const candidate = packageDigest
    ? RevocationListSchema.parse({
      ...fixture,
      payload: {
        ...fixture.payload,
        entries: [{
          revocation_id: deterministicFixtureId(`m5-revoked-${packageDigest}`),
          publisher_id: "ai.braindrive",
          app_id: "ai.braindrive.resume-builder",
          match: { kind: "package_digest", package_digest: packageDigest },
          reason_code: "critical_defect",
          revoked_at: fixture.payload.issued_at,
        }],
      },
    })
    : fixture;
  const authority = new MonotonicRevocationAuthority(cache, clock, () => undefined);
  const result = await authority.refresh({
    candidateBytes: Buffer.from(JSON.stringify(candidate)),
    trustRootBytes: Buffer.from(JSON.stringify(trustRoot)),
    pinnedRoot: { keyId: trustRoot.root_key.key_id, publicKey: trustRoot.root_key.public_key },
  });
  expect(result.outcome).toBe("accepted");
  return { authority, cache, candidate, trustRoot };
}

async function updateHarness(failStep?: string, options: { data?: ResumeLifecycleDataAdapter; revocations?: MonotonicRevocationAuthority; targetSchema?: number; targetVersion?: string; targetDigest?: typeof OLD_DIGEST | typeof NEW_DIGEST; addCapability?: boolean; interruptStep?: TransactionalUpdateStep } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-m5-update-"));
  roots.push(root);
  const stateRoot = path.join(root, "state");
  const lifecycle = new LifecycleStore(path.join(stateRoot, "host-app-state"), { leaseDurationMs: 120_000 });
  const grants = new InstallationGrantStore(stateRoot);
  const runtimeAuthority = new RuntimeAuthorityStore(stateRoot);
  const packages = new FakePackages();
  await Promise.all([lifecycle.initialize(), grants.initialize(), runtimeAuthority.initialize(), packages.initialize()]);
  const descriptor = PackageDescriptorSchema.parse(JSON.parse(await readFile(path.join(FIXTURE_ROOT, "1.0.0.descriptor.json"), "utf8")));
  const oldManifest = descriptor.payload.manifest;
  const targetSchema = options.targetSchema ?? 1;
  const targetVersion = options.targetVersion ?? "2.0.0";
  const targetDigest = options.targetDigest ?? NEW_DIGEST;
  const requestedCapabilities = options.addCapability ? [...oldManifest.requested_capabilities, "app.inference.request"] : oldManifest.requested_capabilities;
  const newManifest = PackageDescriptorSchema.shape.payload.shape.manifest.parse({ ...oldManifest, package_version: targetVersion, requested_capabilities: requestedCapabilities, compatibility: { ...oldManifest.compatibility, data_schema: { read_min: 1, read_max: targetSchema, write_version: targetSchema } } });
  const oldRef = deterministicFixtureId("m5-old-ref");
  const oldRecord = { packageDigest: OLD_DIGEST, packageVersion: "1.0.0", contentRoot: path.join(root, "old"), entrypoint: "payload/server.js", target: "docker_linux_x64", referenceCount: 1 } satisfies ImmutablePackageRecord;
  await mkdir(oldRecord.contentRoot, { recursive: true });
  packages.records.set(OLD_DIGEST, oldRecord); packages.references.set(OLD_DIGEST, new Set([oldRef]));
  const oldGrantId = deterministicFixtureId("m5-old-grant");
  const oldGrant = grants.decide({ grantId: oldGrantId, ownerId: OWNER_ID, actorId: OWNER_ID, installationId: INSTALLATION_ID, packageDigest: OLD_DIGEST }, oldManifest, { approved: true, decisionId: deterministicFixtureId("m5-old-decision"), decidedByActorId: OWNER_ID, decidedAt: "2026-08-09T12:00:00.000Z", capabilities: oldManifest.requested_capabilities, recordScopes: [] })!;
  await grants.persist(oldGrant);
  await lifecycle.executeTransition({ operationId: deterministicFixtureId("m5-stage"), idempotencyKey: "0000000000000001", canonicalInput: { stage: true }, ownerId: OWNER_ID, actorId: OWNER_ID, kind: "install", to: "staged", authority: { installation_id: INSTALLATION_ID } });
  const oldReference: DurablePackageReference = { package_reference_version: 1, package_ref_id: oldRef, app_id: "ai.braindrive.resume-builder", package_digest: OLD_DIGEST, package_version: "1.0.0", cache_key: "1111111111111111", created_at: "2026-08-09T12:00:00.000Z" };
  await lifecycle.executeTransition({ operationId: deterministicFixtureId("m5-active"), idempotencyKey: "m5-active-idempotency", canonicalInput: { active: true }, ownerId: OWNER_ID, actorId: OWNER_ID, kind: "install", to: "active", authority: { installation_id: INSTALLATION_ID, active_package_digest: OLD_DIGEST, grant_id: oldGrantId }, packageReferences: [oldReference] });
  const core = new InMemoryAppSupervisor();
  const tokenAuthority = new CapabilityTokenBroker();
  const adapter = new InstalledAppSupervisorAdapter({ packages: packages as unknown as ImmutablePackageStore, processSupervisor: core, tokenAuthority, clock: () => new Date("2026-08-09T12:00:00.000Z"), ids: { next: (() => { let n = 0; return () => deterministicFixtureId(`m5-adapter-${++n}`); })() }, negotiator: new InMemoryRuntimeRegistrationNegotiator() });
  const { resolved_entrypoint: _resolved, ...oldDescriptor } = runtime(OLD_DIGEST);
  const started = await adapter.start({ supervisor_protocol_version: 1, operation_id: deterministicFixtureId("m5-old-start"), descriptor: { ...oldDescriptor, package_root_ref: oldRef }, policy: SUPERVISOR_POLICY, requested_at: "2026-08-09T12:00:00.000Z" });
  if (!started.runtime) throw new Error(`old runtime start failed: ${JSON.stringify(started)}`);
  const ready = await adapter.awaitReady({ supervisor_protocol_version: 1, operation_id: deterministicFixtureId("m5-old-ready"), runtime: started.runtime!, deadline_at: "2026-08-09T12:01:00.000Z" });
  const registered = await adapter.register({ supervisor_protocol_version: 1, operation_id: deterministicFixtureId("m5-old-register"), runtime: started.runtime!, endpoint: ready.endpoint!, connection_id: deterministicFixtureId("m5-old-connection") });
  await runtimeAuthority.persist({ installation_id: INSTALLATION_ID, package_version: "1.0.0", package_digest: OLD_DIGEST, grant_id: oldGrantId, runtime: started.runtime!, registration_id: registered.registration_id!, connection_id: deterministicFixtureId("m5-old-connection") });
  const memoryRoot = path.join(root, "memory");
  await new ResumeDataStore(memoryRoot, undefined, {}, false).initialize(OWNER_ID);
  const data = options.data ?? new ResumeDataLifecycleAdapter(memoryRoot);
  const candidateRoot = path.join(root, "candidate"); await mkdir(candidateRoot, { recursive: true });
  const verified = { manifest: newManifest, packageDigest: targetDigest, descriptorDigest: `sha256:${"3".repeat(64)}`, stageRoot: candidateRoot, entrypoint: "payload/server.js", target: "docker_linux_x64", inspection: { inspectionVersion: 1, identity: { appId: newManifest.app_id, publisherId: newManifest.publisher_id, displayName: newManifest.display_name, packageVersion: targetVersion, packageDigest: targetDigest }, trust: { policyVersion: 1, signingKeyId: "fixture", trustRootVersion: 1, sourceIndexSequence: 2, revocationSequence: 1, revocationStatus: "not_revoked_fresh" }, source: { environment: "docker_dev", kind: "repository_fixture", sourceId: "fixture" }, compatibility: { ...newManifest.compatibility, selectedTarget: "docker_linux_x64" }, capabilities: newManifest.requested_capabilities, retention: newManifest.retention_policy, evidence: { provenanceDigest: `sha256:${"4".repeat(64)}`, sbomDigest: `sha256:${"5".repeat(64)}` } }, trust: {} } as unknown as VerifiedPackage;
  const verifier = { verify: async (request: VerifyPackageRequest) => {
    if (request.version !== "1.0.0") return verified;
    const rollbackRoot = path.join(root, `rollback-${Date.now()}-${Math.random()}`); await mkdir(rollbackRoot, { recursive: true });
    return { ...verified, manifest: oldManifest, packageDigest: OLD_DIGEST, stageRoot: rollbackRoot, inspection: { ...verified.inspection, identity: { ...verified.inspection.identity, packageVersion: "1.0.0", packageDigest: OLD_DIGEST }, compatibility: { ...oldManifest.compatibility, selectedTarget: "docker_linux_x64" }, capabilities: oldManifest.requested_capabilities } } as VerifiedPackage;
  } };
  let sawSideBySide = false;
  const serviceDependencies = { verifier, packages, grants, lifecycle, supervisor: adapter, runtimeAuthority, data, revocations: options.revocations, stateRoot, clock: () => new Date("2026-08-09T12:00:00.000Z"), ids: { next: (() => { let n = 0; return () => deterministicFixtureId(`m5-service-${++n}`); })() }, beforeStep: async (step: TransactionalUpdateStep) => { if (step === "candidate_ready") sawSideBySide = core.inspect(INSTALLATION_ID).length === 2 && adapter.registrationCount(INSTALLATION_ID) === 1; if (step === options.interruptStep) throw new SimulatedUpdateInterruption(step); if (step === failStep) throw new Error(`injected ${step}`); } };
  const service = new TransactionalUpdateService(serviceDependencies);
  const verification = { version: targetVersion, environment: "docker_dev", target: "docker_linux_x64", hostVersion: "26.7.23", supportedCapabilities: newManifest.requested_capabilities, stagingRoot: path.join(root, "staging"), trustRootBytes: Buffer.alloc(0), pinnedRoot: { keyId: "fixture", publicKey: "fixture" }, sourceIndexBytes: Buffer.alloc(0), revocationBytes: Buffer.alloc(0) } satisfies VerifyPackageRequest;
  const request = { operationId: deterministicFixtureId(`m5-update-${failStep ?? "success"}`), idempotencyKey: `m5-update-${failStep ?? "success"}-idempotency`, ownerId: OWNER_ID, actorId: OWNER_ID, expectedPackageDigest: targetDigest, verification, decide: (inspection: Awaited<ReturnType<typeof service.inspectUpdate>>) => ({ approved: true, decisionId: deterministicFixtureId(`m5-new-decision-${failStep ?? "success"}`), decidedByActorId: OWNER_ID, decidedAt: "2026-08-09T12:00:00.000Z", capabilities: inspection.package.capabilities, recordScopes: [] }) };
  return { service, serviceDependencies, request, lifecycle, core, adapter, runtimeAuthority, packages, data, sawSideBySide: () => sawSideBySide, oldGrantId, oldManifest, root };
}

describe("M5 transactional update", () => {
  it("classifies unchanged, narrowed, and widened capability sets deterministically", () => {
    expect(capabilityDiff(["career.context.read"], ["career.context.read"]).decision).toBe("no_change");
    expect(capabilityDiff(["career.context.read", "app.inference.request"], ["career.context.read"])).toMatchObject({ decision: "narrowing_allowed", removed: ["app.inference.request"] });
    expect(capabilityDiff(["career.context.read"], ["career.context.read", "app.inference.request"])).toMatchObject({ decision: "owner_approval_required", added: ["app.inference.request"] });
  });

  it("rejects a same-version, same-digest action without changing active authority", async () => {
    const harness = await updateHarness(undefined, { targetVersion: "1.0.0", targetDigest: OLD_DIGEST });
    await expect(harness.service.update(harness.request)).rejects.toMatchObject({ code: "conflict" });
    expect(await harness.lifecycle.readState()).toMatchObject({ state: "active", active_package_digest: OLD_DIGEST });
    expect(harness.adapter.registrationCount(INSTALLATION_ID)).toBe(1);
  });

  it("requires a new exact owner grant before a widened capability can execute", async () => {
    const harness = await updateHarness(undefined, { addCapability: true });
    await expect(harness.service.inspectUpdate(harness.request)).resolves.toMatchObject({ capability_diff: { decision: "owner_approval_required", added: ["app.inference.request"] } });
    const deniedRequest = {
      ...harness.request,
      decide: async (inspection: Awaited<ReturnType<typeof harness.service.inspectUpdate>>) => ({ approved: false, decisionId: deterministicFixtureId("m5-widened-denied"), decidedByActorId: OWNER_ID, decidedAt: "2026-08-09T12:00:00.000Z", capabilities: inspection.package.capabilities, recordScopes: [] }),
    };
    await expect(harness.service.update(deniedRequest)).rejects.toMatchObject({ code: "denied" });
    expect(await harness.lifecycle.readState()).toMatchObject({ state: "active", active_package_digest: OLD_DIGEST });
    expect(harness.core.inspect(INSTALLATION_ID)[0]?.package_digest).toBe(OLD_DIGEST);
  });

  it("keeps the old registration while the candidate reaches readiness, then switches one generation and records LKG/checkpoint", async () => {
    const harness = await updateHarness();
    const inspection = await harness.service.inspectUpdate(harness.request);
    expect(inspection).toMatchObject({ version_decision: "newer", data_decision: "compatible", capability_diff: { decision: "no_change" } });
    const result = await harness.service.update(harness.request);
    expect(result).toMatchObject({ outcome: "active", packageDigest: NEW_DIGEST, lastKnownGoodDigest: OLD_DIGEST, checkpoint: "pending" });
    expect(harness.sawSideBySide()).toBe(true);
    expect(harness.core.inspect(INSTALLATION_ID)).toHaveLength(1);
    expect(harness.core.inspect(INSTALLATION_ID)[0]?.package_digest).toBe(NEW_DIGEST);
    expect(harness.adapter.registrationCount(INSTALLATION_ID)).toBe(1);
    expect(await harness.lifecycle.readState()).toMatchObject({ state: "active", active_package_digest: NEW_DIGEST, last_known_good_package_digest: OLD_DIGEST, successful_use_checkpoint: { status: "pending" } });
    const checkpoint = await harness.service.recordSuccessfulUse({ operationId: deterministicFixtureId("m5-checkpoint"), idempotencyKey: "m5-checkpoint-idempotency", ownerId: OWNER_ID, actorId: OWNER_ID, evidenceOperationId: deterministicFixtureId("m5-checkpoint-evidence") });
    expect(checkpoint.checkpoint).toBe("passed");
    expect((await harness.lifecycle.readState()).successful_use_checkpoint?.status).toBe("passed");
  });

  it("performs an explicit verified rollback to the non-revoked LKG and swaps the prior active version into LKG", async () => {
    const harness = await updateHarness();
    await harness.service.update(harness.request);
    const rollbackVerification = { ...harness.request.verification, version: "1.0.0" };
    const result = await harness.service.rollback({ operationId: deterministicFixtureId("m5-rollback"), idempotencyKey: "m5-rollback-idempotency", ownerId: OWNER_ID, actorId: OWNER_ID, verification: rollbackVerification, decide: (inspection) => ({ approved: true, decisionId: deterministicFixtureId("m5-rollback-decision"), decidedByActorId: OWNER_ID, decidedAt: "2026-08-09T12:00:00.000Z", capabilities: inspection.package.capabilities, recordScopes: [] }) });
    expect(result).toMatchObject({ outcome: "rolled_back", packageDigest: OLD_DIGEST, lastKnownGoodDigest: NEW_DIGEST, checkpoint: "pending" });
    expect(harness.core.inspect(INSTALLATION_ID)).toHaveLength(1);
    expect(harness.core.inspect(INSTALLATION_ID)[0]?.package_digest).toBe(OLD_DIGEST);
    expect(harness.adapter.registrationCount(INSTALLATION_ID)).toBe(1);
  });

  it("compensates a pre-switch candidate failure without stopping the old runtime or changing its pointer", async () => {
    const harness = await updateHarness("candidate_ready");
    await expect(harness.service.update(harness.request)).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    expect(await harness.lifecycle.readState()).toMatchObject({ state: "active", active_package_digest: OLD_DIGEST });
    expect(harness.core.inspect(INSTALLATION_ID)).toHaveLength(1);
    expect(harness.core.inspect(INSTALLATION_ID)[0]?.package_digest).toBe(OLD_DIGEST);
    expect(harness.adapter.registrationCount(INSTALLATION_ID)).toBe(1);
  });

  it("snapshots, migrates, validates, and retains only opaque hashes through a schema-changing update", async () => {
    const data = new FakeLifecycleData();
    const harness = await updateHarness(undefined, { data, targetSchema: 2 });
    expect((await harness.service.inspectUpdate(harness.request)).data_decision).toBe("migration_required");
    await harness.service.update(harness.request);
    expect(data.schemaVersion).toBe(2);
    expect(data.snapshots.size).toBe(1);
    const journal = await readFile(path.join(harness.root, "state", "host-app-state", "update-operations", `${harness.request.operationId}.json`), "utf8");
    expect(journal).toMatch(/"snapshot_digest":"sha256:/);
    expect(journal).not.toMatch(/owner content|resume text|snapshot_path/i);
  });

  it("restores the exact pre-migration schema after a partial migration failure", async () => {
    const data = new FakeLifecycleData(); data.failMigration = true;
    const harness = await updateHarness(undefined, { data, targetSchema: 2 });
    await expect(harness.service.update(harness.request)).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    expect(data.schemaVersion).toBe(1);
    expect(await harness.lifecycle.readState()).toMatchObject({ state: "active", active_package_digest: OLD_DIGEST });
    expect(harness.core.inspect(INSTALLATION_ID)).toHaveLength(1);
  });

  it("contains all runtime authority and records failed_recoverable when snapshot restore itself fails", async () => {
    const data = new FakeLifecycleData(); data.failMigration = true; data.failRestore = true;
    const harness = await updateHarness(undefined, { data, targetSchema: 2 });
    await expect(harness.service.update(harness.request)).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    expect(await harness.lifecycle.readState()).toMatchObject({ state: "failed_recoverable", active_package_digest: OLD_DIGEST });
    expect(harness.core.inspect(INSTALLATION_ID)).toEqual([]);
    expect(harness.adapter.registrationCount(INSTALLATION_ID)).toBe(0);
  });

  it("keeps only the accepted active/LKG recovery snapshot quota after successful use", async () => {
    const data = new FakeLifecycleData();
    await data.snapshot({ action: "snapshot", context: dataContext(), from_schema_version: 1, to_schema_version: 1 });
    const harness = await updateHarness(undefined, { data, targetSchema: 2 });
    await harness.service.update(harness.request);
    expect(data.snapshots.size).toBe(2);
    await harness.service.recordSuccessfulUse({ operationId: deterministicFixtureId("m5-quota-checkpoint"), idempotencyKey: "m5-quota-checkpoint-idempotency", ownerId: OWNER_ID, actorId: OWNER_ID, evidenceOperationId: deterministicFixtureId("m5-quota-evidence") });
    expect(data.snapshots.size).toBe(1);
  });

  it("recovers every durable update boundary without two registrations or a mixed pointer", async () => {
    const steps: TransactionalUpdateStep[] = [
      "verified", "grant_decided", "package_referenced", "data_inspected", "candidate_started", "candidate_ready",
      "updating_committed", "old_stopped", "candidate_registered", "runtime_authority_persisted", "pointer_switched",
    ];
    for (const step of steps) {
      const harness = await updateHarness(undefined, { interruptStep: step });
      await expect(harness.service.update(harness.request)).rejects.toBeInstanceOf(SimulatedUpdateInterruption);
      const { beforeStep: _beforeStep, ...restartDependencies } = harness.serviceDependencies;
      expect(await new TransactionalUpdateService(restartDependencies).reconcile()).toBe(1);
      const state = await harness.lifecycle.readState();
      const expectedDigest = step === "pointer_switched" ? NEW_DIGEST : OLD_DIGEST;
      expect(state).toMatchObject({ state: "active", active_package_digest: expectedDigest });
      expect(harness.core.inspect(INSTALLATION_ID)).toHaveLength(1);
      expect(harness.core.inspect(INSTALLATION_ID)[0]?.package_digest).toBe(expectedDigest);
      expect(harness.adapter.registrationCount(INSTALLATION_ID)).toBe(1);
    }
  }, 30_000);

  it("blocks a revoked update and revoked LKG rollback, including stale offline authority", async () => {
    const newRevocationRoot = await mkdtemp(path.join(os.tmpdir(), "bd-m5-revoked-new-"));
    roots.push(newRevocationRoot);
    const { authority: revokedNew } = await revocationAuthority(newRevocationRoot, NEW_DIGEST);
    const updateHarnessResult = await updateHarness(undefined, { revocations: revokedNew });
    await expect(updateHarnessResult.service.update(updateHarnessResult.request)).rejects.toMatchObject({ code: "package_revoked" });
    expect(await updateHarnessResult.lifecycle.readState()).toMatchObject({ state: "active", active_package_digest: OLD_DIGEST });

    const oldRevocationRoot = await mkdtemp(path.join(os.tmpdir(), "bd-m5-revoked-lkg-"));
    roots.push(oldRevocationRoot);
    const { authority: revokedOld } = await revocationAuthority(oldRevocationRoot, OLD_DIGEST);
    const rollbackHarness = await updateHarness(undefined, { revocations: revokedOld });
    await rollbackHarness.service.update(rollbackHarness.request);
    await expect(rollbackHarness.service.rollback({ operationId: deterministicFixtureId("m5-revoked-rollback"), idempotencyKey: "m5-revoked-rollback-idempotency", ownerId: OWNER_ID, actorId: OWNER_ID, verification: { ...rollbackHarness.request.verification, version: "1.0.0" }, decide: (inspection) => ({ approved: true, decisionId: deterministicFixtureId("m5-revoked-rollback-decision"), decidedByActorId: OWNER_ID, decidedAt: "2026-08-09T12:00:00.000Z", capabilities: inspection.package.capabilities, recordScopes: [] }) })).rejects.toMatchObject({ code: "package_revoked" });
  });

  it("immediately revokes runtime authority and quarantines a matching live package", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m5-revoked-current-"));
    roots.push(root);
    const { authority } = await revocationAuthority(root, OLD_DIGEST);
    const harness = await updateHarness(undefined, { revocations: authority });
    const result = await harness.service.enforceRevocations({ operationId: deterministicFixtureId("m5-quarantine"), idempotencyKey: "0000000000000002", ownerId: OWNER_ID, actorId: OWNER_ID, externalStatus: "offline" });
    expect(result).toMatchObject({ outcome: "quarantined", packageDigest: OLD_DIGEST });
    expect(await harness.lifecycle.readState()).toMatchObject({ state: "quarantined", active_package_digest: OLD_DIGEST });
    expect(harness.core.inspect(INSTALLATION_ID)).toEqual([]);
    expect(harness.adapter.registrationCount(INSTALLATION_ID)).toBe(0);
    expect(await harness.runtimeAuthority.read(INSTALLATION_ID)).toBeNull();
  });

  it("serializes concurrent update and revocation mutations behind the lifecycle lease", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m5-concurrent-revocation-"));
    roots.push(root);
    const { authority } = await revocationAuthority(root, OLD_DIGEST);
    const harness = await updateHarness(undefined, { revocations: authority });
    const blockerId = deterministicFixtureId("m5-concurrent-blocker");
    const lease = await harness.lifecycle.acquireMutation(blockerId);
    try {
      await expect(harness.service.update(harness.request)).rejects.toMatchObject({ code: "conflict" });
      await expect(harness.service.enforceRevocations({ operationId: deterministicFixtureId("m5-concurrent-quarantine"), idempotencyKey: "m5-concurrent-quarantine-idempotency", ownerId: OWNER_ID, actorId: OWNER_ID })).rejects.toMatchObject({ code: "conflict" });
    } finally {
      await harness.lifecycle.releaseMutation(lease);
    }
    expect(await harness.lifecycle.readState()).toMatchObject({ state: "active", active_package_digest: OLD_DIGEST });
    expect(harness.adapter.registrationCount(INSTALLATION_ID)).toBe(1);
  });
});
