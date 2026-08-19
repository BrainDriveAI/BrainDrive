import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { PackageDescriptorSchema, PackageSourceIndexSchema, RevocationListSchema } from "../contracts/package.js";
import type { InstalledAppSupervisor } from "../contracts/supervisor.js";
import {
  AtomicPackageInstaller,
  deterministicFixtureId,
  SimulatedInstallInterruption,
  type AtomicInstallRequest,
} from "./atomic-install.js";
import { LifecycleStore } from "./durable-store.js";
import { InstallationGrantStore } from "./install-grants.js";
import { createStoredZip } from "./zip.js";
import { FileVerifiedPackageAuthorityCache } from "./verified-feed-cache.js";
import { ImmutablePackageStore } from "./verified-package-store.js";
import {
  inspectStoredPackageArchive,
  assertPackageNotRevoked,
  type BoundedPackageTransport,
  type PackageSourceReference,
  VerifiedPackageVerifier,
  type VerifyPackageRequest,
} from "./verified-package.js";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures/m3-docker/", import.meta.url));
const FIXED_TIME = new Date("2026-08-09T10:46:36.888Z");
const OWNER_ID = "30000000-0000-4000-8000-000000000001";
const ACTOR_ID = "30000000-0000-4000-8000-000000000002";
const ALL_CAPABILITIES = [
  "career.context.read",
  "career.facts.read",
  "career.facts.propose",
  "career.facts.confirm",
  "resume.definitions.read",
  "resume.definitions.write",
  "resume.jobs.read",
  "resume.jobs.write",
  "resume.artifacts.register",
  "resume.export.request",
  "resume.operations.read",
  "app.inference.request",
] as const;

const roots: string[] = [];

afterEach(async () => {
  const makeWritable = async (root: string): Promise<void> => {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = path.join(root, entry.name);
      await chmod(child, 0o700).catch(() => undefined);
      await makeWritable(child);
    }
  };
  await Promise.all(roots.splice(0).map(async (root) => {
    await makeWritable(root);
    await rm(root, { recursive: true, force: true });
  }));
});

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function fixtureBytes(name: string): Promise<Buffer> {
  if (name.endsWith(".bdapp")) {
    return Buffer.from((await readFile(path.join(FIXTURE_ROOT, `${name}.base64`), "utf8")).trim(), "base64");
  }
  return readFile(path.join(FIXTURE_ROOT, name));
}

class FixtureTransport implements BoundedPackageTransport {
  constructor(
    private readonly overrides: Partial<Record<"descriptor" | "archive", Buffer | Error>> = {},
  ) {}

  async read(reference: PackageSourceReference, limitBytes: number): Promise<Buffer> {
    if (reference.kind !== "repository_fixture") throw new Error("unexpected transport");
    const kind = reference.fixtureId.endsWith("-descriptor") ? "descriptor" : "archive";
    const override = this.overrides[kind];
    if (override instanceof Error) throw override;
    const bytes = override ?? await fixtureBytes(kind === "descriptor" ? "1.0.0.descriptor.json" : "1.0.0.bdapp");
    if (bytes.byteLength > limitBytes) throw new Error("fixture limit exceeded");
    return Buffer.from(bytes);
  }
}

async function verificationRequest(root: string, overrides: Partial<VerifyPackageRequest> = {}): Promise<VerifyPackageRequest> {
  const trustRootBytes = await fixtureBytes("trust-root.json");
  const trustRoot = JSON.parse(trustRootBytes.toString("utf8")) as { root_key: { key_id: string; public_key: string } };
  return {
    version: "1.0.0",
    environment: "docker_dev",
    target: "docker_linux_x64",
    hostVersion: "26.7.23",
    supportedCapabilities: ALL_CAPABILITIES,
    stagingRoot: path.join(root, "host-app-staging"),
    trustRootBytes,
    pinnedRoot: { keyId: trustRoot.root_key.key_id, publicKey: trustRoot.root_key.public_key },
    sourceIndexBytes: await fixtureBytes("source-index.json"),
    revocationBytes: await fixtureBytes("revocations.json"),
    ...overrides,
  };
}

class FakeSupervisor implements InstalledAppSupervisor {
  readonly calls: string[] = [];
  failure: "start" | "ready" | "register" | "ambiguous_start" | null = null;

  async start(request: Parameters<InstalledAppSupervisor["start"]>[0]): ReturnType<InstalledAppSupervisor["start"]> {
    this.calls.push("start");
    if (this.failure === "start" || this.failure === "ambiguous_start") {
      return { supervisor_protocol_version: 1, outcome: "failed", state: "failed_recoverable", runtime: null, error_code: this.failure === "ambiguous_start" ? "ambiguous_runtime_state" : "start_failed" };
    }
    return {
      supervisor_protocol_version: 1,
      outcome: "started",
      state: "starting",
      runtime: {
        runtime_id: deterministicFixtureId("runtime"),
        installation_id: request.descriptor.installation_id,
        package_digest: request.descriptor.package_digest,
        runtime_generation: 1,
        endpoint_token_generation: 1,
      },
      error_code: null,
    };
  }

  async awaitReady(request: Parameters<InstalledAppSupervisor["awaitReady"]>[0]): ReturnType<InstalledAppSupervisor["awaitReady"]> {
    this.calls.push("awaitReady");
    if (this.failure === "ready") return { supervisor_protocol_version: 1, outcome: "timeout", state: "failed_recoverable", runtime: request.runtime, endpoint: null, error_code: "readiness_failed" };
    return {
      supervisor_protocol_version: 1,
      outcome: "ready",
      state: "ready",
      runtime: request.runtime,
      endpoint: { endpoint_id: deterministicFixtureId("endpoint"), transport: "loopback", address: "http://127.0.0.1:43210", authentication: "per_installation_token", endpoint_token_generation: 1, public_bind: false },
      error_code: null,
    };
  }

  async health(request: Parameters<InstalledAppSupervisor["health"]>[0]): ReturnType<InstalledAppSupervisor["health"]> {
    this.calls.push("health");
    return { supervisor_protocol_version: 1, state: "ready", runtime: request.runtime, restart_attempt: 0, next_backoff_ms: null, error_code: null };
  }

  async register(_request: Parameters<InstalledAppSupervisor["register"]>[0]): ReturnType<InstalledAppSupervisor["register"]> {
    this.calls.push("register");
    if (this.failure === "register") return { supervisor_protocol_version: 1, outcome: "failed", registration_id: null, error_code: "registration_failed" };
    return { supervisor_protocol_version: 1, outcome: "registered", registration_id: deterministicFixtureId("registration"), error_code: null };
  }

  async stop(request: Parameters<InstalledAppSupervisor["stop"]>[0]): ReturnType<InstalledAppSupervisor["stop"]> {
    this.calls.push("stop");
    return { supervisor_protocol_version: 1, outcome: "stopped_gracefully", termination_acknowledged: true, runtime: request.runtime, error_code: null };
  }

  async revokeTokens(request: Parameters<InstalledAppSupervisor["revokeTokens"]>[0]): ReturnType<InstalledAppSupervisor["revokeTokens"]> {
    this.calls.push("revokeTokens");
    return { ...request, next_token_generation: request.prior_token_generation + 1, outcome: "revoked", error_code: null };
  }

  async cleanup(request: Parameters<InstalledAppSupervisor["cleanup"]>[0]): ReturnType<InstalledAppSupervisor["cleanup"]> {
    this.calls.push("cleanup");
    return { supervisor_protocol_version: 1, operation_id: request.operation_id, installation_id: request.installation_id, outcome: "cleaned", cleaned_runtime_ids: request.observed_runtime_ids, remaining_runtime_count: 0, registration_count: 0, tokens_revoked: true, error_code: null };
  }

  async reconcile(_request: Parameters<InstalledAppSupervisor["reconcile"]>[0]): ReturnType<InstalledAppSupervisor["reconcile"]> {
    this.calls.push("reconcile");
    return { supervisor_protocol_version: 1, outcome: "no_runtime_expected", expected_runtime: null, observed_runtime: null, active_runtime_count: 0, registration_count: 0, tokens_revoked: true, error_code: null };
  }
}

type Harness = Awaited<ReturnType<typeof installHarness>>;

async function installHarness(options: {
  supervisor?: FakeSupervisor;
  beforeStep?: ConstructorParameters<typeof AtomicPackageInstaller>[0]["beforeStep"];
  activeTransitionHooks?: ConstructorParameters<typeof AtomicPackageInstaller>[0]["activeTransitionHooks"];
} = {}) {
  const root = await temporaryRoot("bd-m3-install-");
  const supervisor = options.supervisor ?? new FakeSupervisor();
  const packages = new ImmutablePackageStore(root, () => FIXED_TIME);
  const grants = new InstallationGrantStore(root);
  const lifecycle = new LifecycleStore(path.join(root, "host-app-state"), { clock: { now: () => FIXED_TIME } });
  const ids = { index: 0, next() { this.index += 1; return deterministicFixtureId(`install-id-${this.index}`); } };
  const installer = new AtomicPackageInstaller({
    verifier: new VerifiedPackageVerifier(new FixtureTransport(), () => FIXED_TIME),
    packages,
    grants,
    lifecycle,
    supervisor,
    stateRoot: root,
    clock: () => FIXED_TIME,
    ids,
    beforeStep: options.beforeStep,
    activeTransitionHooks: options.activeTransitionHooks,
  });
  const verification = await verificationRequest(root);
  const request: AtomicInstallRequest = {
    operationId: deterministicFixtureId("install-operation"),
    idempotencyKey: "m3-install-idempotency-key",
    ownerId: OWNER_ID,
    actorId: ACTOR_ID,
    verification,
    decide: (inspection) => ({
      approved: true,
      decisionId: deterministicFixtureId("ignored-decision"),
      decidedByActorId: ACTOR_ID,
      decidedAt: FIXED_TIME.toISOString(),
      capabilities: inspection.capabilities,
      recordScopes: [],
    }),
  };
  return { root, supervisor, packages, grants, lifecycle, installer, request };
}

async function expectCompensated(harness: Harness): Promise<void> {
  expect(await harness.lifecycle.readState()).toMatchObject({ state: "not_installed", active_package_digest: null, grant_id: null });
  const stored = await harness.packages.read("sha256:760cdc911896cdb347ee7abed3b5c79decf7aa2cb46619a2b3f2cf40024d9454");
  expect(stored.referenceCount).toBe(0);
  expect(await readdir(harness.grants.root)).toEqual([]);
}

describe("M3 deterministic signed Docker fixture", () => {
  it("matches frozen hashes, verifies provenance/SBOM, and contains no private key", async () => {
    const expected = JSON.parse(await readFile(path.join(FIXTURE_ROOT, "hashes.json"), "utf8")) as { files: Record<string, string> };
    for (const [name, expectedDigest] of Object.entries(expected.files)) {
      const bytes = name === "decoded-1.0.0.bdapp" ? await fixtureBytes("1.0.0.bdapp") : await readFile(path.join(FIXTURE_ROOT, name));
      expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`, name).toBe(expectedDigest);
    }
    const combined = (await Promise.all((await readdir(FIXTURE_ROOT)).map((name) => readFile(path.join(FIXTURE_ROOT, name), "utf8")))).join("\n");
    expect(combined).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY|PRIVATE KEY-----|private_key|signing_seed/i);
  });
});

describe("M3 verifier and safe archive handling", () => {
  it("verifies in the accepted order and stages every path non-executable", async () => {
    const root = await temporaryRoot("bd-m3-verify-");
    const diagnostics: string[] = [];
    const verifier = new VerifiedPackageVerifier(new FixtureTransport(), () => FIXED_TIME, (event) => diagnostics.push(`${event.step}:${event.outcome}`));
    const verified = await verifier.verify(await verificationRequest(root));
    expect(diagnostics).toEqual([
      "source_allowlist:passed", "source_signature:passed", "source_monotonicity:passed", "download:passed",
      "package_signature:passed", "archive_digest:passed", "manifest_schema:passed", "archive_safety:passed",
      "file_inventory:passed", "compatibility:passed", "revocation:passed", "staged:passed",
    ]);
    expect(verified.inspection).toMatchObject({
      identity: { appId: "ai.braindrive.resume-builder", packageVersion: "1.0.0", packageDigest: verified.packageDigest },
      source: { environment: "docker_dev", kind: "repository_fixture" },
      compatibility: { selectedTarget: "docker_linux_x64", app_contract: 1 },
      retention: "retain_owner_data_remove_runtime_authority",
    });
    for (const relative of ["manifest.json", "payload/docker/index.js", "provenance/build.jsonl", "sbom/cyclonedx.json"]) {
      expect((await stat(path.join(verified.stageRoot, relative))).mode & 0o111, relative).toBe(0);
    }
  });

  it.each([
    ["wrong pinned key", async (root: string) => verificationRequest(root, { pinnedRoot: { keyId: "braindrive-app-root-fixture-other-2026", publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } }), "package_source_untrusted"],
    ["tampered index", async (root: string) => { const bytes = await fixtureBytes("source-index.json"); bytes[100] ^= 1; return verificationRequest(root, { sourceIndexBytes: bytes }); }, "package_source_untrusted"],
    ["tampered descriptor", async (root: string) => verificationRequest(root), "package_signature_invalid"],
    ["tampered archive", async (root: string) => verificationRequest(root), "package_digest_mismatch"],
    ["unsupported host range", async (root: string) => verificationRequest(root, { hostVersion: "0.1.0" }), "incompatible_version"],
    ["unsupported capability", async (root: string) => verificationRequest(root, { supportedCapabilities: ["career.context.read"] }), "widened_grant"],
  ] as const)("rejects %s before staging", async (kind, buildRequest, expectedCode) => {
    const root = await temporaryRoot("bd-m3-reject-");
    const request = await buildRequest(root);
    let transport = new FixtureTransport();
    if (kind === "tampered descriptor") {
      const descriptor = await fixtureBytes("1.0.0.descriptor.json");
      descriptor[120] ^= 1;
      transport = new FixtureTransport({ descriptor });
    } else if (kind === "tampered archive") {
      const archive = await fixtureBytes("1.0.0.bdapp");
      archive[500] ^= 1;
      transport = new FixtureTransport({ archive });
    }
    await expect(new VerifiedPackageVerifier(transport, () => FIXED_TIME).verify(request)).rejects.toMatchObject({ code: expectedCode });
    await expect(readdir(request.stagingRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a rollback index, stale revocation authority, and an explicit package revocation", async () => {
    const root = await temporaryRoot("bd-m3-monotonic-");
    const current = PackageSourceIndexSchema.parse(JSON.parse((await fixtureBytes("source-index.json")).toString("utf8")));
    const newer = PackageSourceIndexSchema.parse({ ...current, payload: { ...current.payload, sequence: 2, prior_index_digest: `sha256:${"a".repeat(64)}` } });
    await expect(new VerifiedPackageVerifier(new FixtureTransport(), () => FIXED_TIME).verify(await verificationRequest(root, { cachedSourceIndex: newer })))
      .rejects.toMatchObject({ code: "source_index_rollback" });
    const staleClock = () => new Date(FIXED_TIME.getTime() + 86_401_000);
    await expect(new VerifiedPackageVerifier(new FixtureTransport(), staleClock).verify(await verificationRequest(root)))
      .rejects.toMatchObject({ code: "revocation_metadata_invalid" });

    const descriptor = PackageDescriptorSchema.parse(JSON.parse((await fixtureBytes("1.0.0.descriptor.json")).toString("utf8")));
    const revocations = RevocationListSchema.parse(JSON.parse((await fixtureBytes("revocations.json")).toString("utf8")));
    const explicitlyRevoked = RevocationListSchema.parse({
      ...revocations,
      payload: {
        ...revocations.payload,
        entries: [{
          revocation_id: deterministicFixtureId("revoked-package"),
          publisher_id: descriptor.payload.manifest.publisher_id,
          app_id: descriptor.payload.manifest.app_id,
          match: { kind: "package_digest", package_digest: descriptor.payload.archive.digest },
          reason_code: "critical_defect",
          revoked_at: revocations.payload.issued_at,
        }],
      },
    });
    expect(() => assertPackageNotRevoked(explicitlyRevoked, descriptor.payload.manifest, descriptor.payload.archive.digest))
      .toThrowError(expect.objectContaining({ code: "package_revoked" }));
  });

  it("atomically reuses only strict last-verified feed authority after restart", async () => {
    const root = await temporaryRoot("bd-m3-feed-cache-");
    const cache = new FileVerifiedPackageAuthorityCache(root);
    const request = await verificationRequest(root);
    const first = await new VerifiedPackageVerifier(new FixtureTransport(), () => FIXED_TIME, undefined, cache).verify(request);
    expect((await cache.readSourceIndex())?.payload.sequence).toBe(1);
    expect((await cache.readRevocations())?.payload.sequence).toBe(1);
    const restarted = await new VerifiedPackageVerifier(new FixtureTransport(), () => FIXED_TIME, undefined, new FileVerifiedPackageAuthorityCache(root)).verify(request);
    expect(restarted.packageDigest).toBe(first.packageDigest);
    await writeFile(cache.layout.sourceIndex, "{\"payload\":{}}\n", "utf8");
    await expect(new VerifiedPackageVerifier(new FixtureTransport(), () => FIXED_TIME, undefined, cache).verify(request))
      .rejects.toMatchObject({ code: "package_source_untrusted" });
  });

  it.each([
    ["traversal", "../escape.js", "package_path_invalid"],
    ["absolute", "/absolute.js", "package_path_invalid"],
  ])("rejects %s paths", async (_kind, entryPath, expectedCode) => {
    const archive = createStoredZip([{ name: entryPath, bytes: Buffer.from("x"), executable: false }]);
    expect(() => inspectStoredPackageArchive(archive)).toThrowError(expect.objectContaining({ code: expectedCode }));
  });

  it("rejects duplicate/case collisions, links/devices, and expansion metadata", () => {
    const duplicate = createStoredZip([
      { name: "payload/a.js", bytes: Buffer.from("a"), executable: false },
      { name: "payload/a.js", bytes: Buffer.from("b"), executable: false },
    ]);
    expect(() => inspectStoredPackageArchive(duplicate)).toThrowError(expect.objectContaining({ code: "package_duplicate_path" }));
    const collision = createStoredZip([
      { name: "payload/A.js", bytes: Buffer.from("a"), executable: false },
      { name: "payload/a.js", bytes: Buffer.from("b"), executable: false },
    ]);
    expect(() => inspectStoredPackageArchive(collision)).toThrowError(expect.objectContaining({ code: "package_case_collision" }));
    const unsafe = createStoredZip([{ name: "payload/a.js", bytes: Buffer.from("a"), executable: false }]);
    const central = unsafe.readUInt32LE(unsafe.byteLength - 6);
    unsafe.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
    expect(() => inspectStoredPackageArchive(unsafe)).toThrowError(expect.objectContaining({ code: "package_unsafe_link" }));
    const expansion = createStoredZip([{ name: "payload/a.js", bytes: Buffer.from("a"), executable: false }]);
    expansion.writeUInt32LE(2, 22);
    expect(() => inspectStoredPackageArchive(expansion)).toThrowError(expect.objectContaining({ code: "package_archive_invalid" }));
  });

  it("holds the traversal-free path invariant across a generated path corpus", () => {
    for (let index = 0; index < 64; index += 1) {
      const safePath = `payload/segment-${index}/file-${(index * 17) % 97}.js`;
      expect(inspectStoredPackageArchive(createStoredZip([{ name: safePath, bytes: Buffer.from([index]), executable: false }]))[0].path).toBe(safePath);
      const unsafePath = `payload/segment-${index}/../escape-${index}.js`;
      expect(() => inspectStoredPackageArchive(createStoredZip([{ name: unsafePath, bytes: Buffer.from([index]), executable: false }])))
        .toThrowError(expect.objectContaining({ code: "package_path_invalid" }));
    }
  });

  it("fails closed on a partial download and simulated full disk without leaving staging", async () => {
    const partialRoot = await temporaryRoot("bd-m3-partial-");
    const partial = new VerifiedPackageVerifier(new FixtureTransport({ archive: Object.assign(new Error("partial stream"), { code: "ECONNRESET" }) }), () => FIXED_TIME);
    await expect(partial.verify(await verificationRequest(partialRoot))).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    await expect(readdir(path.join(partialRoot, "host-app-staging"))).rejects.toMatchObject({ code: "ENOENT" });

    const diskRoot = await temporaryRoot("bd-m3-disk-");
    const verified = await new VerifiedPackageVerifier(new FixtureTransport(), () => FIXED_TIME).verify(await verificationRequest(diskRoot));
    const store = new ImmutablePackageStore(diskRoot, () => FIXED_TIME, { beforePromotion: () => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); } });
    await expect(store.promote(verified)).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    await expect(stat(verified.stageRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("M3 immutable store and explicit grants", () => {
  it("promotes by digest with immutable modes and reference-counts identical content", async () => {
    const root = await temporaryRoot("bd-m3-store-");
    const request = await verificationRequest(root);
    const verifier = new VerifiedPackageVerifier(new FixtureTransport(), () => FIXED_TIME);
    const store = new ImmutablePackageStore(root, () => FIXED_TIME);
    const first = await store.promote(await verifier.verify(request));
    expect((await stat(first.contentRoot)).mode & 0o222).toBe(0);
    const entrypointMode = (await stat(path.join(first.contentRoot, first.entrypoint))).mode;
    expect(entrypointMode & 0o222).toBe(0);
    if (process.platform !== "win32") expect(entrypointMode & 0o111).not.toBe(0);
    const refA = deterministicFixtureId("ref-a");
    const refB = deterministicFixtureId("ref-b");
    expect((await store.acquire(first.packageDigest, refA)).referenceCount).toBe(1);
    expect((await store.acquire(first.packageDigest, refA)).referenceCount).toBe(1);
    expect((await store.acquire(first.packageDigest, refB)).referenceCount).toBe(2);
    expect((await store.release(first.packageDigest, refA)).referenceCount).toBe(1);
    expect((await store.promote(await verifier.verify(request))).contentRoot).toBe(first.contentRoot);
    const secondStoreInstance = new ImmutablePackageStore(root, () => FIXED_TIME);
    const refC = deterministicFixtureId("ref-c");
    const refD = deterministicFixtureId("ref-d");
    const concurrent = await Promise.all([
      store.acquire(first.packageDigest, refC),
      secondStoreInstance.acquire(first.packageDigest, refD),
    ]);
    expect(concurrent.map((record) => record.referenceCount).sort()).toEqual([2, 3]);
    expect((await store.read(first.packageDigest)).referenceCount).toBe(3);
    expect(await store.removeIfUnreferenced(first.packageDigest)).toBe(false);
    await Promise.all([refB, refC, refD].map((referenceId) => store.release(first.packageDigest, referenceId)));
    expect(await store.removeIfUnreferenced(first.packageDigest)).toBe(true);
    await expect(stat(first.contentRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates only the exact installation-scoped approved grant and persists no paths or credentials", async () => {
    const root = await temporaryRoot("bd-m3-grant-");
    const verified = await new VerifiedPackageVerifier(new FixtureTransport(), () => FIXED_TIME).verify(await verificationRequest(root));
    const store = new InstallationGrantStore(root);
    const identity = { grantId: deterministicFixtureId("grant"), ownerId: OWNER_ID, actorId: ACTOR_ID, installationId: deterministicFixtureId("installation"), packageDigest: verified.packageDigest };
    const denied = store.decide(identity, verified.manifest, { approved: false, decisionId: deterministicFixtureId("denied"), decidedByActorId: ACTOR_ID, decidedAt: FIXED_TIME.toISOString(), capabilities: verified.inspection.capabilities, recordScopes: [] });
    expect(denied).toBeNull();
    const grant = store.decide(identity, verified.manifest, { approved: true, decisionId: deterministicFixtureId("approved"), decidedByActorId: ACTOR_ID, decidedAt: FIXED_TIME.toISOString(), capabilities: verified.inspection.capabilities, recordScopes: [] });
    expect(grant?.capabilities).toEqual(verified.manifest.requested_capabilities);
    await store.persist(grant!);
    const serialized = JSON.stringify(await store.read(identity.grantId));
    expect(serialized).not.toMatch(/credential|token|secret|(?:\/[^" ]+){3,}/i);
    expect(() => store.decide(identity, verified.manifest, { approved: true, decisionId: deterministicFixtureId("wide"), decidedByActorId: ACTOR_ID, decidedAt: FIXED_TIME.toISOString(), capabilities: ["career.context.read"], recordScopes: [] }))
      .toThrowError(expect.objectContaining({ code: "widened_grant" }));
  });

  it("rejects an idempotent promotion when existing immutable bytes no longer match signed authority", async () => {
    const root = await temporaryRoot("bd-m3-store-corrupt-");
    const request = await verificationRequest(root);
    const verifier = new VerifiedPackageVerifier(new FixtureTransport(), () => FIXED_TIME);
    const store = new ImmutablePackageStore(root, () => FIXED_TIME);
    const first = await store.promote(await verifier.verify(request));
    const entrypoint = path.join(first.contentRoot, first.entrypoint);
    await chmod(entrypoint, 0o600);
    await writeFile(entrypoint, "tampered immutable content\n", "utf8");
    const candidate = await verifier.verify(request);
    await expect(store.promote(candidate)).rejects.toMatchObject({ code: "package_file_mismatch" });
    await expect(stat(candidate.stageRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("M3 atomic install with interface-faithful fake supervisor", () => {
  it("publishes active only after start, readiness, registration, grant, and pointer commit", async () => {
    const h = await installHarness();
    const result = await h.installer.install(h.request);
    expect(result).toMatchObject({ outcome: "active", generation: 2 });
    expect(h.supervisor.calls).toEqual(["start", "awaitReady", "register"]);
    expect(await h.lifecycle.readState()).toMatchObject({ state: "active", active_package_digest: result.packageDigest, grant_id: result.grantId });
    expect(await h.grants.read(result.grantId!)).toMatchObject({ installation_id: result.installationId, package_digest: result.packageDigest });
    expect((await h.packages.read(result.packageDigest)).referenceCount).toBe(1);
    const retry = await h.installer.install(h.request);
    expect(retry).toMatchObject({ outcome: "active", generation: 2 });
    expect(h.supervisor.calls).toEqual(["start", "awaitReady", "register"]);
  });

  it("owner denial creates no grant, lifecycle reference, runtime, or active authority", async () => {
    const h = await installHarness();
    h.request.decide = (inspection) => ({ approved: false, decisionId: deterministicFixtureId("denial"), decidedByActorId: ACTOR_ID, decidedAt: FIXED_TIME.toISOString(), capabilities: inspection.capabilities, recordScopes: [] });
    const result = await h.installer.install(h.request);
    expect(result).toMatchObject({ outcome: "denied", installationId: null, grantId: null, generation: 0 });
    expect(h.supervisor.calls).toEqual([]);
    expect(await h.lifecycle.readState()).toMatchObject({ state: "not_installed", active_package_digest: null, grant_id: null });
    expect(await readdir(h.grants.root)).toEqual([]);
    expect((await h.packages.read(result.packageDigest)).referenceCount).toBe(0);
  });

  it.each(["start", "ready", "register", "ambiguous_start"] as const)("compensates fake supervisor %s failure", async (failure) => {
    const supervisor = new FakeSupervisor();
    supervisor.failure = failure;
    const h = await installHarness({ supervisor });
    await expect(h.installer.install(h.request)).rejects.toBeInstanceOf(Error);
    await expectCompensated(h);
    expect(supervisor.calls).toContain("revokeTokens");
    expect(supervisor.calls).toContain("cleanup");
    if (["ready", "register"].includes(failure)) expect(supervisor.calls).toContain("stop");
  });

  it("rolls back pointer persistence failure before revoking/stopping/unregistering", async () => {
    const h = await installHarness({
      activeTransitionHooks: { afterBoundary: (boundary) => { if (boundary === "pointers_persisted") throw new Error("pointer persistence interruption"); } },
    });
    await expect(h.installer.install(h.request)).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    await expectCompensated(h);
    expect(h.supervisor.calls.slice(-3)).toEqual(["revokeTokens", "stop", "cleanup"]);
  });

  it("reconciles an interrupted install to not_installed on restart", async () => {
    const supervisor = new FakeSupervisor();
    const interrupted = await installHarness({
      supervisor,
      beforeStep: (step) => { if (step === "readiness_passed") throw new SimulatedInstallInterruption(step); },
    });
    await expect(interrupted.installer.install(interrupted.request)).rejects.toBeInstanceOf(SimulatedInstallInterruption);
    expect((await interrupted.lifecycle.readState()).state).toBe("staged");
    expect((await interrupted.lifecycle.readConsistentSnapshot()).active.package_digest).toBeNull();
    const restarted = new AtomicPackageInstaller({
      verifier: new VerifiedPackageVerifier(new FixtureTransport(), () => FIXED_TIME),
      packages: interrupted.packages,
      grants: interrupted.grants,
      lifecycle: interrupted.lifecycle,
      supervisor,
      stateRoot: interrupted.root,
      clock: () => FIXED_TIME,
    });
    await expect(restarted.install(interrupted.request)).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    await expectCompensated(interrupted);
    expect(supervisor.calls.slice(-3)).toEqual(["revokeTokens", "stop", "cleanup"]);
  });
});

describe("M3 scope boundary", () => {
  it("does not import a real process supervisor, gateway, MCP registry, owner data, or model/provider code", async () => {
    const sources = await Promise.all([
      "verified-package.ts", "verified-package-store.ts", "install-grants.ts", "atomic-install.ts",
    ].map((name) => readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), name), "utf8")));
    const combined = sources.join("\n");
    expect(combined).not.toMatch(/node:child_process|ProcessAppSupervisor|from ["'].*gateway\/|from ["'].*mcp\/|from ["'].*owner-data|provider|model_id/);
  });
});
