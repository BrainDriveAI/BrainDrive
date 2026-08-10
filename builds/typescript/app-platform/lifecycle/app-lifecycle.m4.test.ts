import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { SUPERVISOR_POLICY } from "../contracts/package.js";
import { AtomicPackageInstaller, deterministicFixtureId, type AtomicInstallRequest } from "./atomic-install.js";
import { CapabilityTokenBroker } from "./capability-token.js";
import { LifecycleStore } from "./durable-store.js";
import { InstalledAppSupervisorAdapter } from "./installed-app-supervisor-adapter.js";
import { InstallationGrantStore } from "./install-grants.js";
import { InMemoryAppSupervisor, ProcessAppSupervisor, type AppSupervisor } from "./process-supervisor.js";
import { RuntimeAuthorityStore } from "./runtime-authority-store.js";
import { InMemoryRuntimeRegistrationNegotiator } from "./runtime-negotiator.js";
import { SupervisedLifecycleService } from "./supervised-activation.js";
import { createSupervisedRuntimeBinding } from "./supervised-runtime-binding.js";
import { ImmutablePackageStore } from "./verified-package-store.js";
import {
  type BoundedPackageTransport,
  type PackageSourceReference,
  VerifiedPackageVerifier,
  type VerifyPackageRequest,
} from "./verified-package.js";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures/m3-docker/", import.meta.url));
const FIXED_TIME = new Date("2026-08-09T10:46:36.888Z");
const OWNER_ID = "40000000-0000-4000-8000-000000000001";
const ACTOR_ID = "40000000-0000-4000-8000-000000000002";
const ALL_CAPABILITIES = [
  "career.context.read", "career.facts.read", "career.facts.propose", "career.facts.confirm",
  "resume.definitions.read", "resume.definitions.write", "resume.jobs.read", "resume.jobs.write",
  "resume.artifacts.register", "resume.export.request", "resume.operations.read", "app.inference.request",
] as const;

const roots: string[] = [];
const supervisors: ProcessAppSupervisor[] = [];

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.close()));
  const makeWritable = async (root: string): Promise<void> => {
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
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

async function fixtureBytes(name: string): Promise<Buffer> {
  if (name.endsWith(".bdapp")) return Buffer.from((await readFile(path.join(FIXTURE_ROOT, `${name}.base64`), "utf8")).trim(), "base64");
  return readFile(path.join(FIXTURE_ROOT, name));
}

class FixtureTransport implements BoundedPackageTransport {
  async read(reference: PackageSourceReference, limitBytes: number): Promise<Buffer> {
    if (reference.kind !== "repository_fixture") throw new Error("unexpected fixture transport");
    const bytes = await fixtureBytes(reference.fixtureId.endsWith("-descriptor") ? "1.0.0.descriptor.json" : "1.0.0.bdapp");
    if (bytes.byteLength > limitBytes) throw new Error("fixture exceeds test bound");
    return bytes;
  }
}

async function verificationRequest(root: string, target: "docker_linux_x64" | "desktop_windows_x64"): Promise<VerifyPackageRequest> {
  const trustRootBytes = await fixtureBytes("trust-root.json");
  const trustRoot = JSON.parse(trustRootBytes.toString("utf8")) as { root_key: { key_id: string; public_key: string } };
  return {
    version: "1.0.0",
    environment: "docker_dev",
    target,
    hostVersion: "26.7.23",
    supportedCapabilities: ALL_CAPABILITIES,
    stagingRoot: path.join(root, "host-app-staging"),
    trustRootBytes,
    pinnedRoot: { keyId: trustRoot.root_key.key_id, publicKey: trustRoot.root_key.public_key },
    sourceIndexBytes: await fixtureBytes("source-index.json"),
    revocationBytes: await fixtureBytes("revocations.json"),
  };
}

async function createHarness(target: "docker_linux_x64" | "desktop_windows_x64") {
  const root = await mkdtemp(path.join(os.tmpdir(), `bd-m4-${target}-`));
  roots.push(root);
  const clock = () => new Date(FIXED_TIME);
  const packages = new ImmutablePackageStore(root, clock);
  const grants = new InstallationGrantStore(root);
  const lifecycle = new LifecycleStore(path.join(root, "host-app-state"), { clock: { now: clock }, leaseDurationMs: 120_000 });
  const runtimeAuthority = new RuntimeAuthorityStore(root, clock);
  const verifier = new VerifiedPackageVerifier(new FixtureTransport(), clock);
  const tokenAuthority = new CapabilityTokenBroker();
  const adapterEvents: Array<{ event: string; details: Record<string, unknown> }> = [];
  const binding = createSupervisedRuntimeBinding({
    target,
    packages,
    tokenAuthority,
    grants,
    clock,
    ids: { next: (() => { let index = 0; return () => deterministicFixtureId(`m4-adapter-${target}-${++index}`); })() },
    audit: (event, details) => adapterEvents.push({ event, details }),
    negotiator: new InMemoryRuntimeRegistrationNegotiator(),
    process: { startupTimeoutMs: 5_000, stopGraceMs: 1_000, automaticRecovery: false },
  });
  const { processSupervisor, supervisor: adapter } = binding;
  supervisors.push(processSupervisor);
  const ids = { index: 0, next() { return deterministicFixtureId(`m4-${target}-id-${++this.index}`); } };
  const installer = new AtomicPackageInstaller({
    verifier,
    packages,
    grants,
    lifecycle,
    supervisor: adapter,
    runtimeAuthority,
    stateRoot: root,
    clock,
    ids,
  });
  const verification = await verificationRequest(root, target);
  const request: AtomicInstallRequest = {
    operationId: deterministicFixtureId(`m4-${target}-install`),
    idempotencyKey: `m4-${target}-install-idempotency`,
    ownerId: OWNER_ID,
    actorId: ACTOR_ID,
    verification,
    decide: (inspection) => ({
      approved: true,
      decisionId: deterministicFixtureId(`m4-${target}-decision`),
      decidedByActorId: ACTOR_ID,
      decidedAt: FIXED_TIME.toISOString(),
      capabilities: inspection.capabilities,
      recordScopes: [],
    }),
  };
  const serviceEvents: Array<{ event: string; details: Record<string, unknown> }> = [];
  const service = new SupervisedLifecycleService({
    lifecycle, grants, packages, verifier, supervisor: adapter, runtimeAuthority, ids, clock,
    audit: (event, details) => serviceEvents.push({ event, details }),
  });
  return { root, packages, grants, lifecycle, runtimeAuthority, verifier, tokenAuthority, binding, processSupervisor, adapter, adapterEvents, installer, request, verification, service, serviceEvents };
}

async function installAndInspect(target: "docker_linux_x64" | "desktop_windows_x64") {
  const harness = await createHarness(target);
  const installed = await harness.installer.install(harness.request);
  const authority = await harness.runtimeAuthority.read(installed.installationId!);
  expect(authority).toMatchObject({
    installation_id: installed.installationId,
    package_digest: installed.packageDigest,
    grant_id: installed.grantId,
  });
  expect(harness.adapter.registrationCount(installed.installationId!)).toBe(1);
  const connection = harness.adapter.connectionForRegisteredInstallation(installed.installationId!);
  const healthUrl = connection.url.replace(/\/mcp$/, "/healthz");
  expect((await fetch(healthUrl)).status).toBe(401);
  expect((await fetch(healthUrl, { headers: { authorization: `Bearer ${connection.authorization}` } })).status).toBe(200);
  const serialized = await readFile(path.join(harness.runtimeAuthority.root, `${installed.installationId}.json`), "utf8");
  expect(serialized).not.toMatch(/127\.0\.0\.1|localhost|authorization|bearer|connection_token|resolved_entrypoint|environment|(?:\/[^" ]+){3,}/i);
  return { harness, installed, authority: authority! };
}

describe.each(["docker_linux_x64", "desktop_windows_x64"] as const)("M4 %s supervisor conformance", (target) => {
  it("activates only after authenticated readiness and one dynamic registration", async () => {
    const { harness, installed, authority } = await installAndInspect(target);
    expect(harness.binding).toMatchObject({
      runtimeKind: target === "desktop_windows_x64" ? "packaged_node" : "container",
      transport: target === "desktop_windows_x64" ? "loopback" : "container_internal",
    });
    expect((await harness.lifecycle.readState()).state).toBe("active");
    expect(authority.runtime.runtime_generation).toBe(1);
    expect(harness.adapterEvents.map((entry) => entry.details.action).filter(Boolean)).toEqual(["start", "readiness", "register"]);
    expect(JSON.stringify(harness.adapterEvents)).not.toMatch(/Bearer |connectionToken|resolved_entrypoint|environment_keys/i);
    expect(installed.generation).toBe(2);
  });

  it("revokes, stops, unregisters, then commits disabled and revalidates before re-enable", async () => {
    const { harness, installed } = await installAndInspect(target);
    const disabled = await harness.service.disable({
      operationId: deterministicFixtureId(`m4-${target}-disable`),
      idempotencyKey: `m4-${target}-disable-idempotency`,
      ownerId: OWNER_ID,
      actorId: ACTOR_ID,
    });
    expect(disabled.final_state).toBe("disabled");
    expect(harness.processSupervisor.inspect(installed.installationId!)).toEqual([]);
    expect(harness.adapter.registrationCount(installed.installationId!)).toBe(0);
    expect(harness.tokenAuthority.isRevoked(installed.installationId!)).toBe(true);
    expect(await harness.runtimeAuthority.read(installed.installationId!)).toBeNull();
    expect(harness.serviceEvents.map((entry) => entry.details.step)).toEqual([
      "tokens_revoked", "runtime_authority_removed", "state_committed",
    ]);

    const enabled = await harness.service.enable({
      operationId: deterministicFixtureId(`m4-${target}-enable`),
      idempotencyKey: `m4-${target}-enable-idempotency`,
      ownerId: OWNER_ID,
      actorId: ACTOR_ID,
      verification: harness.verification,
    });
    expect(enabled.final_state).toBe("active");
    expect(harness.adapter.registrationCount(installed.installationId!)).toBe(1);
    expect(harness.tokenAuthority.isRevoked(installed.installationId!)).toBe(false);
    expect(harness.serviceEvents.map((entry) => entry.details.step).slice(-3)).toEqual([
      "trust_grant_revalidated", "runtime_registered", "state_committed",
    ]);
  });
});

describe("M4 failure and restart reconciliation", () => {
  it("runs the v1 start/readiness/health/register/revoke/stop/cleanup contract against the fake adapter", async () => {
    const { harness, installed } = await installAndInspect("docker_linux_x64");
    await harness.processSupervisor.close();
    supervisors.splice(supervisors.indexOf(harness.processSupervisor), 1);
    const fakeCore = new InMemoryAppSupervisor();
    const fakeAdapter = new InstalledAppSupervisorAdapter({ packages: harness.packages, processSupervisor: fakeCore, tokenAuthority: harness.tokenAuthority, clock: () => FIXED_TIME, negotiator: new InMemoryRuntimeRegistrationNegotiator() });
    const snapshot = await harness.lifecycle.readConsistentSnapshot();
    const descriptor: Parameters<InstalledAppSupervisorAdapter["start"]>[0]["descriptor"] = {
      supervisor_protocol_version: 1 as const,
      runtime_kind: "container" as const,
      app_id: "ai.braindrive.resume-builder" as const,
      installation_id: installed.installationId!,
      package_digest: installed.packageDigest,
      grant_id: installed.grantId!,
      verified_entrypoint: (await harness.packages.read(installed.packageDigest)).entrypoint,
      arguments: [] as [],
      environment_keys: ["BRAINDRIVE_APP_CONNECTION_TOKEN", "BRAINDRIVE_APP_ID", "BRAINDRIVE_INSTALLATION_ID", "BRAINDRIVE_PACKAGE_DIGEST", "BRAINDRIVE_ENDPOINT_BIND"],
      package_root_ref: snapshot.active.package_ref_id!,
      cache_root_ref: deterministicFixtureId("m4-fake-cache"),
      endpoint_policy: { transport: "container_internal" as const, authentication: "per_installation_token" as const, public_bind_allowed: false as const },
      resource_policy_version: 1 as const,
    };
    const operationId = deterministicFixtureId("m4-fake-operation");
    const started = await fakeAdapter.start({ supervisor_protocol_version: 1, operation_id: operationId, descriptor, policy: SUPERVISOR_POLICY, requested_at: FIXED_TIME.toISOString() });
    const ready = await fakeAdapter.awaitReady({ supervisor_protocol_version: 1, operation_id: operationId, runtime: started.runtime!, deadline_at: new Date(FIXED_TIME.getTime() + 30_000).toISOString() });
    expect((await fakeAdapter.health({ supervisor_protocol_version: 1, runtime: started.runtime!, checked_at: FIXED_TIME.toISOString() })).state).toBe("ready");
    const registrationRequest = { supervisor_protocol_version: 1 as const, operation_id: operationId, runtime: started.runtime!, endpoint: ready.endpoint!, connection_id: deterministicFixtureId("m4-fake-connection") };
    const first = await fakeAdapter.register(registrationRequest);
    expect((await fakeAdapter.register(registrationRequest))).toMatchObject({ outcome: "already_registered", registration_id: first.registration_id });
    expect((await fakeAdapter.register({ ...registrationRequest, connection_id: deterministicFixtureId("m4-fake-other-connection") })).outcome).toBe("rejected");
    expect((await fakeAdapter.revokeTokens({ supervisor_protocol_version: 1, operation_id: operationId, installation_id: installed.installationId!, runtime_id: started.runtime!.runtime_id, operation_scope_id: operationId, prior_token_generation: 1 })).outcome).toBe("revoked");
    expect((await fakeAdapter.stop({ supervisor_protocol_version: 1, operation_id: operationId, runtime: started.runtime!, reason: "disable", grace_deadline_at: new Date(FIXED_TIME.getTime() + 5_000).toISOString() })).termination_acknowledged).toBe(true);
    expect(await fakeAdapter.cleanup({ supervisor_protocol_version: 1, operation_id: operationId, installation_id: installed.installationId!, expected_runtime_id: started.runtime!.runtime_id, observed_runtime_ids: [started.runtime!.runtime_id], requested_at: FIXED_TIME.toISOString() })).toMatchObject({ remaining_runtime_count: 0, registration_count: 0, tokens_revoked: true });
  });

  it("returns a typed token-issuer failure without persisting or logging token material", async () => {
    const { harness, installed, authority } = await installAndInspect("docker_linux_x64");
    const failingAuthority = {
      revokeInstallation: () => { throw new Error("failure-canary"); },
      permitInstallation: () => undefined,
      isRevoked: () => false,
    };
    const adapter = new InstalledAppSupervisorAdapter({ packages: harness.packages, processSupervisor: harness.processSupervisor, tokenAuthority: failingAuthority, negotiator: new InMemoryRuntimeRegistrationNegotiator() });
    const result = await adapter.revokeTokens({ supervisor_protocol_version: 1, operation_id: deterministicFixtureId("m4-token-failure"), installation_id: installed.installationId!, runtime_id: authority.runtime.runtime_id, operation_scope_id: null, prior_token_generation: 1 });
    expect(result).toMatchObject({ outcome: "failed", error_code: "token_revocation_failed" });
    expect(JSON.stringify(result)).not.toContain("failure-canary");
  });

  it("keeps re-enable non-active when immutable package bytes no longer match signed authority", async () => {
    const { harness, installed } = await installAndInspect("docker_linux_x64");
    await harness.service.disable({ operationId: deterministicFixtureId("m4-tamper-disable"), idempotencyKey: "aaaaaaaaaaaaaaaa", ownerId: OWNER_ID, actorId: ACTOR_ID });
    const stored = await harness.packages.read(installed.packageDigest);
    const entrypoint = path.join(stored.contentRoot, stored.entrypoint);
    await chmod(entrypoint, 0o700);
    await writeFile(entrypoint, "tampered\n", "utf8");
    await expect(harness.service.enable({
      operationId: deterministicFixtureId("m4-tamper-enable"),
      idempotencyKey: "bbbbbbbbbbbbbbbb",
      ownerId: OWNER_ID,
      actorId: ACTOR_ID,
      verification: harness.verification,
    })).rejects.toMatchObject({ code: "package_file_mismatch" });
    expect((await harness.lifecycle.readState()).state).toBe("disabled");
    expect(harness.processSupervisor.inspect(installed.installationId!)).toEqual([]);
    expect(harness.adapter.registrationCount(installed.installationId!)).toBe(0);
  });

  it("contains the exact runtime and remains disabled after re-enable readiness failure", async () => {
    const { harness, installed } = await installAndInspect("docker_linux_x64");
    await harness.service.disable({ operationId: deterministicFixtureId("m4-ready-disable"), idempotencyKey: "m4-ready-disable-idempotency", ownerId: OWNER_ID, actorId: ACTOR_ID });
    harness.processSupervisor.failNextReadiness = true;
    await expect(harness.service.enable({
      operationId: deterministicFixtureId("m4-ready-enable"),
      idempotencyKey: "m4-ready-enable-idempotency",
      ownerId: OWNER_ID,
      actorId: ACTOR_ID,
      verification: harness.verification,
    })).rejects.toMatchObject({ code: "readiness_failed" });
    expect((await harness.lifecycle.readState()).state).toBe("disabled");
    expect(harness.processSupervisor.inspect(installed.installationId!)).toEqual([]);
    expect(harness.adapter.registrationCount(installed.installationId!)).toBe(0);
    expect(await harness.runtimeAuthority.read(installed.installationId!)).toBeNull();
  });

  it.each([
    ["early exit", "process.exit(2);\n"],
    ["malformed health", "import http from 'node:http'; const port=Number(process.env.BRAINDRIVE_ENDPOINT_BIND?.split(':').at(-1)); const server=http.createServer((_q,r)=>{r.writeHead(200,{'content-type':'text/plain'});r.end('ok')}); server.listen(port,'127.0.0.1'); process.on('SIGTERM',()=>server.close(()=>process.exit(0)));\n"],
  ])("rejects %s before readiness", async (_case, source) => {
    const { harness, installed, authority } = await installAndInspect("docker_linux_x64");
    await harness.processSupervisor.close();
    supervisors.splice(supervisors.indexOf(harness.processSupervisor), 1);
    const script = path.join(harness.root, `fault-${_case.replace(/ /g, "-")}.mjs`);
    await writeFile(script, source, "utf8");
    const core = new ProcessAppSupervisor({ startupTimeoutMs: 200, stopGraceMs: 500, automaticRecovery: false });
    supervisors.push(core);
    const snapshot = await harness.lifecycle.readConsistentSnapshot();
    const started = await core.start({
      supervisor_protocol_version: 1,
      runtime_kind: "container",
      app_id: "ai.braindrive.resume-builder",
      installation_id: installed.installationId!,
      package_digest: installed.packageDigest,
      grant_id: installed.grantId!,
      verified_entrypoint: path.basename(script),
      arguments: [],
      environment_keys: ["BRAINDRIVE_APP_CONNECTION_TOKEN", "BRAINDRIVE_APP_ID", "BRAINDRIVE_INSTALLATION_ID", "BRAINDRIVE_PACKAGE_DIGEST", "BRAINDRIVE_ENDPOINT_BIND"],
      package_root_ref: snapshot.active.package_ref_id!,
      cache_root_ref: deterministicFixtureId(`m4-${_case}-cache`),
      endpoint_policy: { transport: "container_internal", authentication: "per_installation_token", public_bind_allowed: false },
      resource_policy_version: 1,
      resolved_entrypoint: script,
    });
    await expect(core.awaitReadiness(started.runtime!)).rejects.toMatchObject({ code: "readiness_failed" });
    expect(core.inspect(installed.installationId!)).toEqual([]);
    expect(authority.runtime.runtime_id).not.toBe(started.runtime!.runtime_id);
  });

  it("contains stale persisted authority after host restart and records a truthful non-running state", async () => {
    const { harness, installed } = await installAndInspect("docker_linux_x64");
    await harness.processSupervisor.close();
    supervisors.splice(supervisors.indexOf(harness.processSupervisor), 1);
    const restartedCore = new ProcessAppSupervisor({ automaticRecovery: false });
    supervisors.push(restartedCore);
    const restartedAdapter = new InstalledAppSupervisorAdapter({ packages: harness.packages, processSupervisor: restartedCore, tokenAuthority: harness.tokenAuthority, negotiator: new InMemoryRuntimeRegistrationNegotiator() });
    const restartedService = new SupervisedLifecycleService({
      lifecycle: harness.lifecycle,
      grants: harness.grants,
      packages: harness.packages,
      verifier: harness.verifier,
      supervisor: restartedAdapter,
      runtimeAuthority: harness.runtimeAuthority,
      clock: () => FIXED_TIME,
    });
    const outcome = await restartedService.reconcile({
      operationId: deterministicFixtureId("m4-host-restart-reconcile"),
      idempotencyKey: "m4-host-restart-reconcile-key",
      ownerId: OWNER_ID,
      actorId: ACTOR_ID,
    });
    expect(outcome).toBe("failed_recoverable");
    expect((await harness.lifecycle.readState()).state).toBe("failed_recoverable");
    expect(restartedCore.inspect(installed.installationId!)).toEqual([]);
    expect(restartedAdapter.registrationCount(installed.installationId!)).toBe(0);
    expect(await harness.runtimeAuthority.read(installed.installationId!)).toBeNull();
  });

  it("does not let a stale runtime identity stop or untrack a different live generation", async () => {
    const { harness, installed, authority } = await installAndInspect("docker_linux_x64");
    const stale = { ...authority.runtime, runtime_id: deterministicFixtureId("m4-stale-runtime") };
    const result = await harness.processSupervisor.stop(stale, "reconcile");
    expect(result).toMatchObject({ outcome: "ambiguous", termination_acknowledged: false, error_code: "ambiguous_runtime_state" });
    expect(harness.processSupervisor.inspect(installed.installationId!)).toEqual([authority.runtime]);
  });

  it("reports stop timeout and adapter disconnect as ambiguous without claiming containment", async () => {
    const { harness, installed, authority } = await installAndInspect("docker_linux_x64");
    const disconnectedCore: AppSupervisor = {
      start: (descriptor) => harness.processSupervisor.start(descriptor),
      awaitReadiness: (runtime) => harness.processSupervisor.awaitReadiness(runtime),
      health: (runtime) => harness.processSupervisor.health(runtime),
      stop: async (runtime) => ({
        supervisor_protocol_version: 1,
        outcome: "ambiguous",
        termination_acknowledged: false,
        runtime,
        error_code: "stop_timeout",
      }),
      inspect: (installationId) => harness.processSupervisor.inspect(installationId),
      connectionFor: (installationId) => harness.processSupervisor.connectionFor(installationId),
      close: async () => undefined,
    };
    const adapter = new InstalledAppSupervisorAdapter({
      packages: harness.packages,
      processSupervisor: disconnectedCore,
      tokenAuthority: harness.tokenAuthority,
    });
    const operationId = deterministicFixtureId("m4-stop-timeout");
    expect(await adapter.stop({
      supervisor_protocol_version: 1,
      operation_id: operationId,
      runtime: authority.runtime,
      reason: "disable",
      grace_deadline_at: new Date(FIXED_TIME.getTime() + 5_000).toISOString(),
    })).toMatchObject({ outcome: "ambiguous", termination_acknowledged: false, error_code: "stop_timeout" });
    expect(await adapter.cleanup({
      supervisor_protocol_version: 1,
      operation_id: operationId,
      installation_id: installed.installationId!,
      expected_runtime_id: authority.runtime.runtime_id,
      observed_runtime_ids: [authority.runtime.runtime_id],
      requested_at: FIXED_TIME.toISOString(),
    })).toMatchObject({
      outcome: "ambiguous",
      remaining_runtime_count: 1,
      tokens_revoked: true,
      error_code: "orphan_cleanup_failed",
    });
    expect(harness.processSupervisor.inspect(installed.installationId!)).toEqual([authority.runtime]);
  });
});

describe("M4 fixed MCP and persisted-authority regression", () => {
  it("keeps fixed MCP discovery static and persists no endpoint, token, environment, or path", async () => {
    const [tools, config, releaseConfig] = await Promise.all([
      readFile(path.resolve(process.cwd(), "tools.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "mcp/config.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "../mcp_release/src/config.ts"), "utf8"),
    ]);
    expect(tools).toContain("discoverMcpToolDefinitions");
    expect(config).toContain("mcpServersFileSchema");
    expect(releaseConfig).toContain('z.enum(["memory", "auth", "project"])');
    expect([tools, config, releaseConfig].join("\n")).not.toContain("InstalledAppSupervisorAdapter");
  });
});
