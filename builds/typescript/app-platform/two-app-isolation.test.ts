import { chmod, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { CapabilityDispatcher } from "../app-capabilities/dispatcher.js";
import { CapabilityRegistry, type HostCapabilityRegistration } from "../app-capabilities/registry.js";
import { AppInferenceDispatcher } from "../app-inference/dispatcher.js";
import { AppInferencePurposeRegistry, type AppInferencePurposeRegistration } from "../app-inference/registry.js";
import { CapabilityTokenBroker } from "./lifecycle/capability-token.js";
import { createAppLifecycle, createBriefAppLifecycle } from "./lifecycle/bootstrap.js";
import { createLifecycleHarness, makeGrant } from "./lifecycle/test-helpers.js";
import { SUPERVISOR_POLICY } from "./contracts/package.js";

const RESUME_APP_ID = "ai.braindrive.resume-builder";
const BRIEF_APP_ID = "ai.braindrive.brief-builder";
const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_B = `sha256:${"b".repeat(64)}` as const;
const roots: string[] = [];

async function makeWritable(root: string): Promise<void> {
  await chmod(root, 0o700).catch(() => undefined);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) await makeWritable(child);
    else await chmod(child, 0o600).catch(() => undefined);
  }));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => {
    await makeWritable(root);
    await rm(root, { recursive: true, force: true });
  }));
});

type Authority = {
  appId: string;
  installationId: string;
  packageDigest: `sha256:${string}`;
  manifestRequests: readonly { name: string; version: number }[];
  requestedPurposes: readonly { purpose_id: string; version: number }[];
  grant: {
    app_id: string;
    installation_id: string;
    package_digest: string;
    capabilities: readonly string[];
    revoked_at: string | null;
    expires_at: string;
  };
  operationId: string;
  idempotencyKey: string;
  deadlineAt: number;
};

function registrations(
  resumeHandler: HostCapabilityRegistration["handler"],
  briefHandler: HostCapabilityRegistration["handler"],
): HostCapabilityRegistration[] {
  return [
    [RESUME_APP_ID, "resume", resumeHandler],
    [BRIEF_APP_ID, "brief", briefHandler],
  ].map(([appId, result, handler]) => ({
    appId: appId as string,
    name: "records.read",
    version: 1,
    audience: "app_data" as const,
    effect: "read" as const,
    inputSchema: z.object({ record_id: z.string().uuid() }).strict(),
    resultSchema: z.object({ app: z.literal(result as "resume" | "brief"), record_id: z.string().uuid() }).strict(),
    limits: { maxInputBytes: 4_096, maxDurationMs: 10_000, maxCallsPerMinute: 60 },
    confirmation: "none" as const,
    confirmationProjection: null,
    auditProjectionId: `${result}.records.read.v1`,
    retryPolicy: "idempotent_only" as const,
    idempotencyPolicy: "required" as const,
    ownerComponentId: `${result}.domain`,
    handler: handler as HostCapabilityRegistration["handler"],
  }));
}

function authority(appId: string, installationId: string, packageDigest: `sha256:${string}`, operationId = crypto.randomUUID()): Authority {
  return {
    appId,
    installationId,
    packageDigest,
    manifestRequests: [{ name: "records.read", version: 1 }],
    requestedPurposes: [{ purpose_id: "summarize", version: 1 }],
    grant: {
      app_id: appId,
      installation_id: installationId,
      package_digest: packageDigest,
      capabilities: ["records.read", "app.inference.request"],
      revoked_at: null,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
    operationId,
    idempotencyKey: `operation-${operationId}`,
    deadlineAt: Date.now() + 10_000,
  };
}

describe("Spec 08 M7 generated two-app attack matrix", () => {
  it("keeps the complete cross-app identity inventory provisional and defers release adjudication", async () => {
    const evidence = JSON.parse(await readFile(
      path.resolve(process.cwd(), "app-platform/contracts/fixtures/spec-08/m7-provisional-evidence.json"),
      "utf8",
    )) as { status: string; requirements: string[]; attack_matrix: { identity_fields: string[]; forbidden_pre_denial_side_effects: string[] }; release_adjudication: string };
    expect(evidence.status).toBe("provisional");
    expect(evidence.release_adjudication).toBe("deferred_to_m8");
    expect(evidence.requirements).toHaveLength(15);
    expect(evidence.attack_matrix.identity_fields).toEqual(expect.arrayContaining([
      "route_key", "app_id", "publisher_id", "version", "package_digest", "installation_id", "grant_id",
      "token_generation", "runtime_id", "connection_id", "session_id", "view_id", "operation_id",
      "idempotency_key", "capability", "purpose_id", "resource_uri", "resource_digest", "owner_id",
      "actor_id", "state_root", "data_root", "backup_root",
    ]));
    expect(evidence.attack_matrix.forbidden_pre_denial_side_effects).toEqual(expect.arrayContaining([
      "handler_invocation", "provider_invocation", "owner_data_access", "process_start", "token_consumption",
    ]));
    expect(JSON.stringify(evidence)).not.toMatch(/"(?:accepted|pass|passed)"/i);
  });

  it.each([
    ["route/app identity", (valid: Authority, other: Authority) => ({ ...valid, appId: other.appId })],
    ["installation", (valid: Authority, other: Authority) => ({ ...valid, grant: { ...valid.grant, installation_id: other.installationId } })],
    ["package digest", (valid: Authority, other: Authority) => ({ ...valid, grant: { ...valid.grant, package_digest: other.packageDigest } })],
    ["grant app", (valid: Authority, other: Authority) => ({ ...valid, grant: { ...valid.grant, app_id: other.appId } })],
    ["capability", (valid: Authority) => ({ ...valid, manifestRequests: [{ name: "other.records.read", version: 1 }] })],
  ] as const)("denies swapped %s authority before a reviewed handler runs", async (_field, mutate) => {
    const resumeHandler = vi.fn(async (input: { record_id: string }) => ({ app: "resume" as const, record_id: input.record_id }));
    const briefHandler = vi.fn(async (input: { record_id: string }) => ({ app: "brief" as const, record_id: input.record_id }));
    const dispatcher = new CapabilityDispatcher(new CapabilityRegistry(registrations(resumeHandler, briefHandler)));
    const resume = authority(RESUME_APP_ID, crypto.randomUUID(), DIGEST_A);
    const brief = authority(BRIEF_APP_ID, crypto.randomUUID(), DIGEST_B);
    await expect(dispatcher.execute("records.read", 1, { record_id: crypto.randomUUID() }, mutate(resume, brief)))
      .rejects.toMatchObject({ code: "denied" });
    expect(resumeHandler).not.toHaveBeenCalled();
    expect(briefHandler).not.toHaveBeenCalled();
  });

  it.each([
    ["owner", (claims: ReturnType<CapabilityTokenBroker["issue"]>["claims"], other: ReturnType<typeof makeGrant>) => ({ ownerId: other.owner_id })],
    ["actor", (_claims: ReturnType<CapabilityTokenBroker["issue"]>["claims"], other: ReturnType<typeof makeGrant>) => ({ actorId: other.actor_id })],
    ["publisher", () => ({ publisherId: "ai.other" })],
    ["grant", (_claims: ReturnType<CapabilityTokenBroker["issue"]>["claims"], other: ReturnType<typeof makeGrant>) => ({ grantId: other.grant_id })],
    ["audience", () => ({ audience: "app_export" as const })],
    ["connection", () => ({ connectionId: crypto.randomUUID() })],
    ["view", () => ({ viewId: crypto.randomUUID() })],
    ["operation", () => ({ operationId: crypto.randomUUID() })],
    ["idempotency", () => ({ idempotencyKey: "other-idempotency-key" })],
  ] as const)("rejects a cross-app %s token substitution before consumption", (_field, mutate) => {
    const broker = new CapabilityTokenBroker();
    const resumeGrant = makeGrant();
    const briefGrant = { ...makeGrant(), app_id: BRIEF_APP_ID };
    const issued = broker.issue({
      grant: resumeGrant,
      audience: "app_data",
      capabilities: ["career.context.read"],
      connectionId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      idempotencyKey: "resume-token-operation-1",
      tokenGeneration: 1,
      viewId: null,
      ttlMs: 60_000,
    });
    const expected = {
      audience: "app_data" as const,
      capability: "career.context.read" as const,
      installationId: issued.claims.installation_id,
      ownerId: issued.claims.owner_id,
      actorId: issued.claims.actor_id,
      appId: issued.claims.app_id,
      publisherId: issued.claims.publisher_id,
      packageDigest: issued.claims.package_digest,
      grantId: issued.claims.grant_id,
      connectionId: issued.claims.connection_id,
      viewId: issued.claims.view_id,
      operationId: issued.claims.operation_id,
      idempotencyKey: issued.claims.idempotency_key,
    };
    expect(() => broker.consume(issued.token, { ...expected, ...mutate(issued.claims, briefGrant) } as Parameters<CapabilityTokenBroker["consume"]>[1]))
      .toThrowError(expect.objectContaining({ code: expect.stringMatching(/^token_/) }));
    expect(() => broker.consume(issued.token, expected)).not.toThrow();
  });

  it("keeps equal operation IDs independent across apps and rejects conflicting identity reuse within one app", async () => {
    const resumeHandler = vi.fn(async (input: { record_id: string }) => ({ app: "resume" as const, record_id: input.record_id }));
    const briefHandler = vi.fn(async (input: { record_id: string }) => ({ app: "brief" as const, record_id: input.record_id }));
    const dispatcher = new CapabilityDispatcher(new CapabilityRegistry(registrations(resumeHandler, briefHandler)));
    const sharedOperation = crypto.randomUUID();
    const resume = authority(RESUME_APP_ID, crypto.randomUUID(), DIGEST_A, sharedOperation);
    const brief = authority(BRIEF_APP_ID, crypto.randomUUID(), DIGEST_B, sharedOperation);
    const resumeRecord = crypto.randomUUID(), briefRecord = crypto.randomUUID();
    await expect(Promise.all([
      dispatcher.execute("records.read", 1, { record_id: resumeRecord }, resume),
      dispatcher.execute("records.read", 1, { record_id: briefRecord }, brief),
    ])).resolves.toEqual([
      { app: "resume", record_id: resumeRecord },
      { app: "brief", record_id: briefRecord },
    ]);
    await expect(dispatcher.execute("records.read", 1, { record_id: resumeRecord }, resume)).resolves.toEqual({ app: "resume", record_id: resumeRecord });
    await expect(dispatcher.execute("records.read", 1, { record_id: resumeRecord }, { ...resume, idempotencyKey: "changed-idempotency-key" }))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(dispatcher.execute("records.read", 1, { record_id: resumeRecord }, { ...resume, operationId: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(resumeHandler).toHaveBeenCalledTimes(1);
    expect(briefHandler).toHaveBeenCalledTimes(1);
  });

  it("isolates inference purpose, operation, idempotency, cancellation, and provider side effects by app", async () => {
    const resumeExecutor = vi.fn(async (input: { text: string }) => ({ app: "resume" as const, text: input.text }));
    const briefExecutor = vi.fn(async (input: { text: string }) => ({ app: "brief" as const, text: input.text }));
    const purpose = (appId: string, app: "resume" | "brief", executor: AppInferencePurposeRegistration["executor"]): AppInferencePurposeRegistration => ({
      appId,
      purposeId: "summarize",
      version: 1,
      inputSchema: z.object({ text: z.string().max(512) }).strict(),
      outputSchema: z.object({ app: z.literal(app), text: z.string() }).strict(),
      promptPolicyId: `${app}.summarize.fixed.v1`,
      modelCompatibilityClass: "owner_active_compatible",
      limits: { maxInputBytes: 1_024, maxInputTokens: 256, maxOutputTokens: 128, maxDurationMs: 10_000, maxAttempts: 1 },
      validationPolicyId: `${app}.summary.v1`,
      retryPolicy: "same_snapshot_only",
      cancellationPolicy: "required",
      auditProjectionId: `${app}.summary.audit.v1`,
      ownerComponentId: `${app}.inference`,
      executor,
    });
    const dispatcher = new AppInferenceDispatcher(new AppInferencePurposeRegistry([
      purpose(RESUME_APP_ID, "resume", resumeExecutor),
      purpose(BRIEF_APP_ID, "brief", briefExecutor),
    ]));
    const sharedOperation = crypto.randomUUID();
    const resume = authority(RESUME_APP_ID, crypto.randomUUID(), DIGEST_A, sharedOperation);
    const brief = authority(BRIEF_APP_ID, crypto.randomUUID(), DIGEST_B, sharedOperation);
    await expect(Promise.all([
      dispatcher.execute({ purpose_id: "summarize", version: 1, input: { text: "resume" } }, resume),
      dispatcher.execute({ purpose_id: "summarize", version: 1, input: { text: "brief" } }, brief),
    ])).resolves.toEqual([{ app: "resume", text: "resume" }, { app: "brief", text: "brief" }]);
    await expect(dispatcher.execute({ purpose_id: "summarize", version: 1, input: { text: "resume" } }, { ...resume, appId: brief.appId }))
      .rejects.toMatchObject({ code: "denied" });
    await expect(dispatcher.execute({ purpose_id: "summarize", version: 1, input: { text: "resume" } }, { ...resume, idempotencyKey: "changed-inference-key" }))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(dispatcher.execute({ purpose_id: "summarize", version: 1, input: { text: "resume" } }, { ...resume, operationId: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(dispatcher.cancel(BRIEF_APP_ID, resume.installationId, sharedOperation, resume.idempotencyKey)).toBe(false);
    expect(resumeExecutor).toHaveBeenCalledTimes(1);
    expect(briefExecutor).toHaveBeenCalledTimes(1);
  });
});

describe("Spec 08 M7 two-app lifecycle failure isolation", () => {
  it("runs two real package process trees concurrently within the conservative admission policy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m7-live-two-apps-")); roots.push(root);
    const resume = await createAppLifecycle({ memoryRoot: path.join(root, "memory"), stateRoot: path.join(root, "resume-host"), hostVersion: "26.7.23" });
    const brief = await createBriefAppLifecycle({ memoryRoot: path.join(root, "memory"), stateRoot: path.join(root, "brief-host"), hostVersion: "26.7.23" });
    try {
      const [resumeInstalled, briefInstalled] = await Promise.all([
        resume.install({ version: "1.0.0", idempotencyKey: "m7-live-resume-install", approveCapabilities: true }),
        brief.install({ version: "1.0.0", idempotencyKey: "m7-live-brief-install", approveCapabilities: true }),
      ]);
      const resumeId = resumeInstalled.record.installation_id!;
      const briefId = briefInstalled.record.installation_id!;
      const resumeRuntime = resume.dependencies.supervisor.inspect(resumeId)[0]!;
      const briefRuntime = brief.dependencies.supervisor.inspect(briefId)[0]!;
      const resumeConnection = resume.dependencies.supervisor.connectionFor(resumeId);
      const briefConnection = brief.dependencies.supervisor.connectionFor(briefId);
      expect(resumeRuntime.runtime_id).not.toBe(briefRuntime.runtime_id);
      expect(resumeConnection.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
      expect(briefConnection.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
      expect(resumeConnection.authorization).not.toBe(briefConnection.authorization);
      expect(SUPERVISOR_POLICY).toMatchObject({
        max_cpu_cores: 1,
        max_memory_bytes: 536_870_912,
        max_crash_restarts: 3,
      });
    } finally {
      await Promise.all([resume.dependencies.supervisor.close(), brief.dependencies.supervisor.close()]);
    }
  }, 30_000);

  it("runs concurrent lifecycles with equal operation IDs and revokes only the selected app", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m7-lifecycle-isolation-")); roots.push(root);
    const resume = await createLifecycleHarness(path.join(root, "resume"), { appId: RESUME_APP_ID, routeKey: "resume-builder", displayName: "Resume Builder" });
    const brief = await createLifecycleHarness(path.join(root, "brief"), { appId: BRIEF_APP_ID, routeKey: "brief-builder", displayName: "Brief Builder" });
    const operationId = crypto.randomUUID();
    const [resumeInstalled, briefInstalled] = await Promise.all([
      resume.service.install({ version: "1.0.0", operationId, idempotencyKey: operationId, approveCapabilities: true }),
      brief.service.install({ version: "1.0.0", operationId, idempotencyKey: operationId, approveCapabilities: true }),
    ]);
    expect(resumeInstalled.record.state).toBe("active");
    expect(briefInstalled.record.state).toBe("active");

    const resumeToken = await resume.service.issueSession({ audience: "app_data", capabilities: ["career.context.read"], operationId: crypto.randomUUID() });
    const briefToken = await brief.service.issueSession({ audience: "app_data", capabilities: ["career.context.read"], operationId: crypto.randomUUID() });
    await resume.service.uninstall({ idempotencyKey: "resume-isolated-uninstall", installationId: resumeInstalled.record.installation_id });
    expect(resume.supervisor.inspect(resumeInstalled.record.installation_id!)).toEqual([]);
    expect(resume.tokenBroker.isRevoked(resumeInstalled.record.installation_id!)).toBe(true);
    expect(brief.supervisor.inspect(briefInstalled.record.installation_id!)).toHaveLength(1);
    expect(brief.tokenBroker.isRevoked(briefInstalled.record.installation_id!)).toBe(false);
    expect(() => resume.tokenBroker.consume(resumeToken.token, { audience: "app_data", capability: "career.context.read", installationId: resumeInstalled.record.installation_id! })).toThrowError(expect.objectContaining({ code: "token_revoked" }));
    expect(() => brief.tokenBroker.consume(briefToken.token, { audience: "app_data", capability: "career.context.read", installationId: briefInstalled.record.installation_id! })).not.toThrow();
    expect(await brief.service.status()).toMatchObject({ state: "active", app_id: BRIEF_APP_ID });
  });

  it("rolls back a failing update for one app while the other remains active", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m7-update-isolation-")); roots.push(root);
    const resume = await createLifecycleHarness(path.join(root, "resume"), { appId: RESUME_APP_ID, routeKey: "resume-builder", displayName: "Resume Builder" });
    const brief = await createLifecycleHarness(path.join(root, "brief"), { appId: BRIEF_APP_ID, routeKey: "brief-builder", displayName: "Brief Builder" });
    const [resumeInstalled, briefInstalled] = await Promise.all([
      resume.service.install({ version: "1.0.0", idempotencyKey: "resume-install-m7", approveCapabilities: true }),
      brief.service.install({ version: "1.0.0", idempotencyKey: "brief-install-m7", approveCapabilities: true }),
    ]);
    const priorDigest = resumeInstalled.record.active_package_digest;
    resume.supervisor.failNextReadiness = true;
    await expect(resume.service.update({ version: "1.0.0", idempotencyKey: "resume-update-m7", approveCapabilities: true, installationId: resumeInstalled.record.installation_id, expectedGeneration: resumeInstalled.record.generation }))
      .rejects.toBeDefined();
    expect(await resume.service.status()).toMatchObject({ state: "active", active_package_digest: priorDigest });
    expect(await brief.service.status()).toMatchObject({ state: "active", installation_id: briefInstalled.record.installation_id });
    expect(brief.supervisor.inspect(briefInstalled.record.installation_id!)).toHaveLength(1);
  });
});
