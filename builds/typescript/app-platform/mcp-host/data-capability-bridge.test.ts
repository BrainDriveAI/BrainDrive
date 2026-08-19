import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CareerPlacementAdapter } from "../../resume-domain/career.js";
import { ResumeRecoveryReconciliationAuditDetailsSchema } from "../contracts/audit.js";
import { canonicalInputDigest } from "../contracts/common.js";
import {
  decideResumeRecoveryReconciliation,
  resumeRecoveryProjectionToReadback,
  ResumeRecoveryOperationLifecycleProjectionSchema,
} from "../../app-capabilities/recovery-reconciliation.js";
import { ResumeCapabilityRouter } from "../../resume-domain/capabilities.js";
import { ResumeCapabilityPolicy } from "../../resume-domain/capability-policy.js";
import { ResumeDomainService } from "../../resume-domain/service.js";
import { ResumeDataStore } from "../../resume-domain/store.js";
import { authority, ownerDecision, proposalInput } from "../../resume-domain/test-helpers.js";
import { MODERN_FIXTURE_VERSION } from "../lifecycle/fixture-repository.js";
import { createLifecycleHarness } from "../lifecycle/test-helpers.js";
import { AppMcpHost } from "./app-host.js";
import { ResumeAppHostAdapter } from "./resume-host-adapter.js";
import { ModernMcpAppsClient, identityForRuntime, type McpWireTransport } from "./modern-client.js";

const html = "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; connect-src 'none'; form-action 'none'\"><main>Fixture</main>";
class FixtureTransport implements McpWireTransport {
  async request(method: string): Promise<unknown> {
    if (method === "server/discover") return { supportedVersions: ["2026-07-28"], capabilities: { tools: {}, resources: {}, extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } }, _meta: { "io.modelcontextprotocol/ui": { version: "2026-01-26" }, "io.modelcontextprotocol/serverInfo": { name: "fixture", version: "3.0.0" } } };
    if (method === "resources/list") return { resources: [{ uri: "ui://resume-builder/main", name: "Resume Builder", mimeType: "text/html;profile=mcp-app", size: Buffer.byteLength(html) }] };
    if (method === "resources/templates/list") return { resourceTemplates: [] };
    if (method === "resources/read") return { contents: [{ uri: "ui://resume-builder/main", mimeType: "text/html;profile=mcp-app", text: html }] };
    if (method === "tools/list") return { tools: [] };
    throw new Error(method);
  }
}

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("M4 capability bridge", () => {
  it("recovers a catalog-published pending save as an exact committed operation after process restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m2-restart-commit-")); roots.push(root);
    const harness = await createLifecycleHarness(root);
    await harness.service.install({ version: MODERN_FIXTURE_VERSION, idempotencyKey: "m2-restart-commit-install", approveCapabilities: true });
    const descriptor = await harness.service.ownerDescriptor();
    let markCatalogPublished!: () => void;
    const catalogPublished = new Promise<void>((resolve) => { markCatalogPublished = resolve; });
    const abandonedProcess = new Promise<void>(() => undefined);
    const oldStore = new ResumeDataStore(root, path.join(root, "owner-data"), {
      afterCatalogCommit: async () => { markCatalogPublished(); await abandonedProcess; },
    }, false, crypto.randomUUID());
    await oldStore.initialize(descriptor.grant!.owner_id);
    const oldAdapter = new ResumeAppHostAdapter(harness.service, {
      capabilityRouter: new ResumeCapabilityRouter(
        new ResumeDomainService(oldStore),
        new CareerPlacementAdapter(root),
        new ResumeCapabilityPolicy(async () => (await harness.service.ownerDescriptor()).grant),
      ),
    });
    const operationId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const value = "catalog-published pending restart value";
    const input = {
      kind: "interview_recovery_save",
      recovery: {
        expected_revision: null,
        session_id: sessionId,
        current_topic: "contact",
        completed_topics: [],
        skipped_topics: [],
        slot: { session_id: sessionId, job_fact_revision_id: null, question_id: "contact-question", field_id: "answer" },
        value,
        value_digest: canonicalInputDigest(value),
      },
    };
    void oldAdapter.handleOwnerCapability(
      "resume.definitions.write", input, operationId, false, descriptor.grant!.actor_id,
    );
    await catalogPublished;

    const reopenedStore = new ResumeDataStore(
      root,
      path.join(root, "owner-data"),
      { leaseWaitMs: 100, leaseRetryMs: 5 },
      false,
      crypto.randomUUID(),
    );
    await reopenedStore.initialize(descriptor.grant!.owner_id);
    const restartedAdapter = new ResumeAppHostAdapter(harness.service, {
      capabilityRouter: new ResumeCapabilityRouter(
        new ResumeDomainService(reopenedStore),
        new CareerPlacementAdapter(root),
        new ResumeCapabilityPolicy(async () => (await harness.service.ownerDescriptor()).grant),
      ),
    });
    await expect(restartedAdapter.handleOwnerCapability(
      "resume.operations.read",
      { queried_operation_id: operationId, reconciliation: "resume_recovery_v1" },
      crypto.randomUUID(),
      false,
      descriptor.grant!.actor_id,
    )).resolves.toMatchObject({
      record: { operation_id: operationId, status: "committed" },
      results: [{ recovery_draft: { value_digest: input.recovery.value_digest }, metadata: { revision: 1 } }],
      recovery_reconciliation: {
        lifecycle_state: "committed",
        host_operation_settled: true,
        operation: { state: "committed", operation_id: operationId, value_digest: input.recovery.value_digest, revision: 1 },
      },
    });
    expect(await reopenedStore.list("interview_progress")).toHaveLength(1);
    expect((await reopenedStore.integrityScan()).staged_transaction_count).toBe(0);
  });

  it("keeps a deadline response pending until the real recovery adapter settles cancelled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m2-deadline-")); roots.push(root);
    const harness = await createLifecycleHarness(root);
    await harness.service.install({ version: MODERN_FIXTURE_VERSION, idempotencyKey: "m2-deadline-install", approveCapabilities: true });
    const descriptor = await harness.service.ownerDescriptor();
    let enterPublish!: () => void;
    let releasePublish!: () => void;
    let failPublish = false;
    const publishing = new Promise<void>((resolve) => { enterPublish = resolve; });
    const release = new Promise<void>((resolve) => { releasePublish = resolve; });
    const store = new ResumeDataStore(root, path.join(root, "owner-data"), {
      beforeCatalogPublish: async () => {
        enterPublish();
        await release;
        if (failPublish) throw new Error("synthetic restart failure before catalog publication");
      },
    }, false);
    await store.initialize(descriptor.grant!.owner_id);
    const router = new ResumeCapabilityRouter(
      new ResumeDomainService(store),
      new CareerPlacementAdapter(root),
      new ResumeCapabilityPolicy(async () => (await harness.service.ownerDescriptor()).grant),
    );
    const clockStart = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(clockStart);
    const adapter = new ResumeAppHostAdapter(harness.service, {
      capabilityRouter: router,
      clientFactory: (connection) => new ModernMcpAppsClient(new FixtureTransport(), identityForRuntime(connection, {
        appId: harness.service.appId, publisherId: harness.service.publisherId, serverId: "resume-builder",
      })),
    });
    const host = new AppMcpHost(adapter);
    const launch = await host.launch();
    const state = await harness.service.status();
    const message = (capability: string, input: Record<string, unknown>, requestOperationId?: string) => ({
      bridge_version: 1, message_id: crypto.randomUUID(), app_id: "ai.braindrive.resume-builder",
      installation_id: state.installation_id, view_id: launch.view_id, operation_id: launch.operation_id,
      sent_at: new Date().toISOString(), type: "capability.call",
      payload: { capability, input, token_id: launch.bridge_token_id, ...(requestOperationId ? { request_operation_id: requestOperationId } : {}) },
    });
    const operationId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const value = "synthetic deadline recovery";
    const input = {
      kind: "interview_recovery_save",
      recovery: {
        expected_revision: null,
        session_id: sessionId,
        current_topic: "contact",
        completed_topics: [],
        skipped_topics: [],
        slot: { session_id: sessionId, job_fact_revision_id: null, question_id: "contact-question", field_id: "answer" },
        value,
        value_digest: canonicalInputDigest(value),
      },
    };
    const write = host.handleBridge(launch.session_id, message("resume.definitions.write", input, operationId), { origin: "null", sourceMatches: true });
    await publishing;
    const deadline = expect(write).rejects.toMatchObject({ code: "cancelled", statusCode: 408 });
    await vi.advanceTimersByTimeAsync(120_000);
    await deadline;
    await expect(host.handleBridge(
      launch.session_id,
      message("resume.operations.read", { queried_operation_id: operationId, reconciliation: "resume_recovery_v1" }),
      { origin: "null", sourceMatches: true },
    )).resolves.toMatchObject({ result: { recovery_reconciliation: {
      lifecycle_state: "pending", host_operation_settled: false, operation: { state: "not_found_within_scope" },
    } } });

    releasePublish();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await expect(host.handleBridge(
      launch.session_id,
      message("resume.operations.read", { queried_operation_id: operationId, reconciliation: "resume_recovery_v1" }),
      { origin: "null", sourceMatches: true },
    )).resolves.toMatchObject({ result: { recovery_reconciliation: {
      lifecycle_state: "cancelled", host_operation_settled: true, operation: { state: "cancelled" },
    } } });
    expect(await store.list("interview_progress")).toHaveLength(0);

    failPublish = true;
    const failedOperationId = crypto.randomUUID();
    const failedValue = "synthetic failed restart value";
    const failedInput = {
      ...input,
      recovery: {
        ...input.recovery,
        value: failedValue,
        value_digest: canonicalInputDigest(failedValue),
      },
    };
    await expect(host.handleBridge(
      launch.session_id,
      message("resume.definitions.write", failedInput, failedOperationId),
      { origin: "null", sourceMatches: true },
    )).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    await expect(host.handleBridge(
      launch.session_id,
      message("resume.operations.read", { queried_operation_id: failedOperationId, reconciliation: "resume_recovery_v1" }),
      { origin: "null", sourceMatches: true },
    )).resolves.toMatchObject({ result: { recovery_reconciliation: {
      lifecycle_state: "failed", host_operation_settled: true, operation: { state: "failed" },
    } } });

    const restartedStore = new ResumeDataStore(root, path.join(root, "owner-data"), {}, false, crypto.randomUUID());
    await restartedStore.initialize(descriptor.grant!.owner_id);
    const restartedAdapter = new ResumeAppHostAdapter(harness.service, {
      capabilityRouter: new ResumeCapabilityRouter(
        new ResumeDomainService(restartedStore),
        new CareerPlacementAdapter(root),
        new ResumeCapabilityPolicy(async () => (await harness.service.ownerDescriptor()).grant),
      ),
    });
    const restartedRead = await restartedAdapter.handleOwnerCapability(
      "resume.operations.read",
      { queried_operation_id: operationId, reconciliation: "resume_recovery_v1" },
      crypto.randomUUID(),
      false,
      descriptor.grant!.actor_id,
    ) as { recovery_reconciliation: unknown };
    const restartedProjection = ResumeRecoveryOperationLifecycleProjectionSchema.parse(restartedRead.recovery_reconciliation);
    expect(restartedProjection).toMatchObject({
      lifecycle_state: "quiesced_restart_no_operation",
      host_operation_settled: true,
      operation: { state: "not_found_within_scope" },
    });
    expect(decideResumeRecoveryReconciliation({
      binding: {
        operation_id: operationId,
        semantic_digest: canonicalInputDigest(input),
        value_digest: input.recovery.value_digest,
        expected_revision: null,
      },
      elapsed_ms: 120_000,
      workspace: { state: "no_commit" },
      ...resumeRecoveryProjectionToReadback(restartedProjection),
    })).toMatchObject({ state: "not_saved", final: true });
    const failedRestartRead = await restartedAdapter.handleOwnerCapability(
      "resume.operations.read",
      { queried_operation_id: failedOperationId, reconciliation: "resume_recovery_v1" },
      crypto.randomUUID(),
      false,
      descriptor.grant!.actor_id,
    ) as { recovery_reconciliation: unknown };
    const failedRestartProjection = ResumeRecoveryOperationLifecycleProjectionSchema.parse(failedRestartRead.recovery_reconciliation);
    expect(failedRestartProjection).toMatchObject({ lifecycle_state: "quiesced_restart_no_operation", host_operation_settled: true });
    expect(decideResumeRecoveryReconciliation({
      binding: {
        operation_id: failedOperationId,
        semantic_digest: canonicalInputDigest(failedInput),
        value_digest: failedInput.recovery.value_digest,
        expected_revision: null,
      },
      elapsed_ms: 120_000,
      workspace: { state: "no_commit" },
      ...resumeRecoveryProjectionToReadback(failedRestartProjection),
    })).toMatchObject({ state: "not_saved", final: true });
  });

  it("executes declared reads and denies confirmation from the sandbox", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m4-bridge-")); roots.push(root);
    const harness = await createLifecycleHarness(root);
    await harness.service.install({ version: MODERN_FIXTURE_VERSION, idempotencyKey: "m4-capability-install", approveCapabilities: true });
    const descriptor = await harness.service.ownerDescriptor();
    let releaseRecovery!: () => void;
    let markRecoveryStaged!: () => void;
    let delayRecovery = false;
    let failRecovery = false;
    const recoveryRelease = new Promise<void>((resolve) => { releaseRecovery = resolve; });
    const recoveryStaged = new Promise<void>((resolve) => { markRecoveryStaged = resolve; });
    const store = new ResumeDataStore(root, path.join(root, "owner-data"), {
      afterTransactionStaged: async () => {
        if (failRecovery) throw new Error("synthetic recovery adapter failure");
        if (!delayRecovery) return;
        markRecoveryStaged();
        await recoveryRelease;
      },
    }, false);
    await store.initialize(descriptor.grant!.owner_id);
    const domain = new ResumeDomainService(store);
    const capabilityEvents: Array<{ event: string; details: Record<string, unknown> }> = [];
    const router = new ResumeCapabilityRouter(
      domain,
      new CareerPlacementAdapter(root),
      new ResumeCapabilityPolicy(async () => {
        const current = await harness.service.ownerDescriptor();
        return current.record.state === "active" ? current.grant : null;
      }),
      (event, details) => capabilityEvents.push({ event, details }),
    );
    const proposedJobAuthority = authority("career.facts.propose", crypto.randomUUID(), { grant: descriptor.grant! });
    const proposedJob = await domain.proposeFact({
      ...proposalInput("Product Builder at Synthetic Company"),
      fact: { fact_kind: "employment", state: "suggested", value: "Product Builder at Synthetic Company", sensitivity: "standard" },
    }, proposedJobAuthority);
    const confirmedJobAuthority = authority("career.facts.confirm", crypto.randomUUID(), { grant: descriptor.grant! });
    const confirmedJob = await domain.confirmFact({
      fact_record_id: proposedJob.fact.metadata.record_id,
      fact_revision_id: proposedJob.fact.metadata.revision_id,
      expected_revision: 1,
      decision: "accept",
      edited_value: null,
      review_note: null,
    }, confirmedJobAuthority, ownerDecision(confirmedJobAuthority, proposedJob.fact.metadata.revision_id));
    const hostEvents: Array<{ event: string; details: Record<string, unknown> }> = [];
    const host = new AppMcpHost(new ResumeAppHostAdapter(harness.service, {
      capabilityRouter: router,
      audit: (event, details) => hostEvents.push({ event, details }),
      clientFactory: (connection) => new ModernMcpAppsClient(new FixtureTransport(), identityForRuntime(connection, { appId: harness.service.appId, publisherId: harness.service.publisherId, serverId: "resume-builder" })),
    }));
    const launch = await host.launch();
    expect(launch.allowed_capabilities).not.toContain("career.facts.confirm");
    expect(launch.allowed_capabilities).toContain("resume.export.request");
    expect(launch.allowed_capabilities).toContain("resume.operations.read");
    expect(launch.allowed_capabilities).toContain("app.inference.request");
    const state = await harness.service.status();
    const message = (capability: string, input: Record<string, unknown>, requestOperationId?: string) => ({
      bridge_version: 1, message_id: crypto.randomUUID(), app_id: "ai.braindrive.resume-builder",
      installation_id: state.installation_id, view_id: launch.view_id, operation_id: launch.operation_id,
      sent_at: new Date().toISOString(), type: "capability.call",
      payload: { capability, input, token_id: launch.bridge_token_id, ...(requestOperationId ? { request_operation_id: requestOperationId } : {}) },
    });
    await expect(host.handleBridge(launch.session_id, message("career.context.read", { entry_point: "direct" }), { origin: "null", sourceMatches: true })).resolves.toMatchObject({ status: "capability_completed", result: { context_version: 1 } });
    const recoveryOperationId = crypto.randomUUID();
    const recoverySessionId = crypto.randomUUID();
    const recoveryValue = "bridge response-loss recovery value résumé 🚀";
    const recoveryInput = {
      kind: "interview_recovery_save",
      recovery: {
        expected_revision: null,
        session_id: recoverySessionId,
        current_topic: "contact",
        completed_topics: [],
        skipped_topics: [],
        slot: { session_id: recoverySessionId, job_fact_revision_id: null, question_id: "contact-question", field_id: "answer" },
        value: recoveryValue,
        value_digest: canonicalInputDigest(recoveryValue),
      },
    };
    delayRecovery = true;
    const firstRecoveryPromise = host.handleBridge(
      launch.session_id,
      message("resume.definitions.write", recoveryInput, recoveryOperationId),
      { origin: "null", sourceMatches: true },
    );
    await recoveryStaged;
    await expect(host.handleBridge(
      launch.session_id,
      message("resume.operations.read", { queried_operation_id: recoveryOperationId }),
      { origin: "null", sourceMatches: true },
    )).rejects.toMatchObject({ code: "not_found_within_scope" });
    const pendingProjection = await host.handleBridge(
      launch.session_id,
      message("resume.operations.read", { queried_operation_id: recoveryOperationId, reconciliation: "resume_recovery_v1" }),
      { origin: "null", sourceMatches: true },
    ) as { result: { recovery_reconciliation: unknown } };
    expect(ResumeRecoveryOperationLifecycleProjectionSchema.parse(pendingProjection.result.recovery_reconciliation)).toMatchObject({
      lifecycle_state: "pending",
      host_operation_settled: false,
      operation: { state: "not_found_within_scope" },
    });
    const sameProcessObserver = new ResumeAppHostAdapter(harness.service, { capabilityRouter: router });
    await expect(sameProcessObserver.handleOwnerCapability(
      "resume.operations.read",
      { queried_operation_id: recoveryOperationId, reconciliation: "resume_recovery_v1" },
      crypto.randomUUID(),
      false,
      descriptor.grant!.actor_id,
    )).resolves.toMatchObject({ recovery_reconciliation: {
      lifecycle_state: "pending",
      host_operation_settled: false,
    } });
    const coalescedRecoveryPromise = host.handleBridge(
      launch.session_id,
      message("resume.definitions.write", recoveryInput, recoveryOperationId),
      { origin: "null", sourceMatches: true },
    );
    await Promise.resolve();
    releaseRecovery();
    const [firstRecovery, coalescedRecovery] = await Promise.all([firstRecoveryPromise, coalescedRecoveryPromise]);
    const replayedRecovery = await host.handleBridge(
      launch.session_id,
      message("resume.definitions.write", recoveryInput, recoveryOperationId),
      { origin: "null", sourceMatches: true },
    );
    expect(firstRecovery).toMatchObject({ status: "capability_completed", result: { reused: false, acknowledgement: { revision: 1 } } });
    expect(coalescedRecovery).toEqual(firstRecovery);
    expect(replayedRecovery).toMatchObject({ status: "capability_completed", result: { reused: true, acknowledgement: { revision: 1 } } });
    await expect(host.handleBridge(
      launch.session_id,
      message("resume.definitions.write", {
        ...recoveryInput,
        recovery: { ...recoveryInput.recovery, value: "different", value_digest: canonicalInputDigest("different") },
      }, recoveryOperationId),
      { origin: "null", sourceMatches: true },
    )).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(host.handleBridge(
      launch.session_id,
      message("resume.definitions.write", {
        ...recoveryInput,
        recovery: { ...recoveryInput.recovery, expected_revision: 1 },
      }, recoveryOperationId),
      { origin: "null", sourceMatches: true },
    )).rejects.toMatchObject({ code: "idempotency_conflict" });
    const committedProgress = (firstRecovery as { result: { progress: { metadata: { record_id: string } } } }).result.progress;
    const staleCasOperationId = crypto.randomUUID();
    await expect(host.handleBridge(
      launch.session_id,
      message("resume.definitions.write", {
        ...recoveryInput,
        recovery: {
          ...recoveryInput.recovery,
          record_id: committedProgress.metadata.record_id,
          expected_revision: null,
          value: "synthetic stale CAS value",
          value_digest: canonicalInputDigest("synthetic stale CAS value"),
        },
      }, staleCasOperationId),
      { origin: "null", sourceMatches: true },
    )).rejects.toMatchObject({ code: "conflict" });
    await expect(host.handleBridge(
      launch.session_id,
      message("resume.operations.read", { queried_operation_id: staleCasOperationId, reconciliation: "resume_recovery_v1" }),
      { origin: "null", sourceMatches: true },
    )).resolves.toMatchObject({ result: { recovery_reconciliation: {
      lifecycle_state: "conflict",
      host_operation_settled: true,
      operation: { state: "conflict", conflict_class: "cas_revision_mismatch" },
    } } });
    const failedOperationId = crypto.randomUUID();
    failRecovery = true;
    await expect(host.handleBridge(
      launch.session_id,
      message("resume.definitions.write", {
        ...recoveryInput,
        recovery: {
          ...recoveryInput.recovery,
          record_id: committedProgress.metadata.record_id,
          expected_revision: 1,
          value: "synthetic failed recovery value",
          value_digest: canonicalInputDigest("synthetic failed recovery value"),
        },
      }, failedOperationId),
      { origin: "null", sourceMatches: true },
    )).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    failRecovery = false;
    await expect(host.handleBridge(
      launch.session_id,
      message("resume.operations.read", { queried_operation_id: failedOperationId, reconciliation: "resume_recovery_v1" }),
      { origin: "null", sourceMatches: true },
    )).resolves.toMatchObject({ result: { recovery_reconciliation: {
      lifecycle_state: "failed",
      host_operation_settled: true,
      operation: { state: "failed" },
    } } });
    await expect(host.handleBridge(
      launch.session_id,
      message("resume.operations.read", { queried_operation_id: recoveryOperationId }),
      { origin: "null", sourceMatches: true },
    )).resolves.toMatchObject({ status: "capability_completed", result: { record: { operation_id: recoveryOperationId, status: "committed" }, results: [expect.objectContaining({ record_type: "interview_progress" })] } });
    const committedProjection = await host.handleBridge(
      launch.session_id,
      message("resume.operations.read", { queried_operation_id: recoveryOperationId, reconciliation: "resume_recovery_v1" }),
      { origin: "null", sourceMatches: true },
    ) as { result: { record: unknown; results: unknown[]; recovery_reconciliation: unknown } };
    expect(committedProjection.result).toMatchObject({ record: { operation_id: recoveryOperationId }, results: [expect.any(Object)] });
    expect(ResumeRecoveryOperationLifecycleProjectionSchema.parse(committedProjection.result.recovery_reconciliation)).toMatchObject({
      lifecycle_state: "committed",
      host_operation_settled: true,
      operation: {
        state: "committed",
        operation_id: recoveryOperationId,
        value_digest: recoveryInput.recovery.value_digest,
        revision: 1,
      },
    });
    const recoveryEvents = hostEvents.filter(({ event }) => event === "app.resume_recovery.reconciliation");
    expect(recoveryEvents.map(({ details }) => [details.idempotency_disposition, details.final_disposition])).toEqual(expect.arrayContaining([
      ["created", "pending"],
      ["coalesced", "pending"],
      ["created", "committed"],
      ["coalesced", "committed"],
      ["replayed", "committed"],
      ["conflict", "conflict"],
    ]));
    for (const { details } of recoveryEvents) expect(ResumeRecoveryReconciliationAuditDetailsSchema.safeParse(details).success).toBe(true);
    const originalSemanticDigest = canonicalInputDigest({
      capability: "resume.definitions.write",
      operation_id: recoveryOperationId,
      idempotency_key: `bridge-${recoveryOperationId}`,
      input: recoveryInput,
    });
    for (const { details } of recoveryEvents.filter(({ details }) => details.operation_id === recoveryOperationId)) {
      expect(details.expected_revision).toBeNull();
      expect(details.semantic_digest).toBe(originalSemanticDigest);
    }
    const serializedRecoveryEvents = JSON.stringify(recoveryEvents);
    for (const canary of [recoveryValue, "different", "synthetic stale CAS value", root, "endpoint", "token", "credential"]) {
      expect(serializedRecoveryEvents).not.toContain(canary);
    }
    expect(await store.list("interview_progress")).toHaveLength(1);
    const reopenedStore = new ResumeDataStore(root, path.join(root, "owner-data"), {}, false, crypto.randomUUID());
    await reopenedStore.initialize(descriptor.grant!.owner_id);
    const reopenedRouter = new ResumeCapabilityRouter(
      new ResumeDomainService(reopenedStore),
      new CareerPlacementAdapter(root),
      new ResumeCapabilityPolicy(async () => (await harness.service.ownerDescriptor()).grant),
    );
    const restartedAdapter = new ResumeAppHostAdapter(harness.service, { capabilityRouter: reopenedRouter });
    await expect(restartedAdapter.handleOwnerCapability(
      "resume.operations.read",
      { queried_operation_id: recoveryOperationId, reconciliation: "resume_recovery_v1" },
      crypto.randomUUID(),
      false,
      descriptor.grant!.actor_id,
    )).resolves.toMatchObject({
      record: { operation_id: recoveryOperationId },
      results: [{ recovery_draft: { value_digest: recoveryInput.recovery.value_digest } }],
      recovery_reconciliation: { lifecycle_state: "committed", operation: { operation_id: recoveryOperationId } },
    });
    const missingRestartOperationId = crypto.randomUUID();
    const missingRestartRead = await restartedAdapter.handleOwnerCapability(
      "resume.operations.read",
      { queried_operation_id: missingRestartOperationId, reconciliation: "resume_recovery_v1" },
      crypto.randomUUID(),
      false,
      descriptor.grant!.actor_id,
    ) as { recovery_reconciliation: unknown };
    const missingRestartProjection = ResumeRecoveryOperationLifecycleProjectionSchema.parse(missingRestartRead.recovery_reconciliation);
    expect(missingRestartProjection).toMatchObject({
      lifecycle_state: "quiesced_restart_no_operation",
      host_operation_settled: true,
      semantic_digest: null,
      expected_revision: null,
      operation: { state: "not_found_within_scope" },
    });
    expect(decideResumeRecoveryReconciliation({
      binding: {
        operation_id: missingRestartOperationId,
        semantic_digest: canonicalInputDigest({ operation_id: missingRestartOperationId }),
        value_digest: canonicalInputDigest("losing restart value"),
        expected_revision: null,
      },
      elapsed_ms: 120_000,
      workspace: {
        state: "different_commit",
        value_digest: recoveryInput.recovery.value_digest,
        revision: 1,
      },
      ...resumeRecoveryProjectionToReadback(missingRestartProjection),
    })).toEqual({
      state: "conflict",
      final: true,
      reconciliation_class: "operation_then_workspace",
      conflict_class: "durable_value_mismatch",
    });
    const serverOperationId = crypto.randomUUID();
    const serverIdempotencyKey = "m4-server-context-operation";
    const projectSpy = vi.spyOn(router.career, "project");
    const firstServerAuthority = await host.issueServerCapabilityAuthority(launch.session_id, "career.context.read", serverOperationId, serverIdempotencyKey);
    const firstServerResult = await host.handleServerCapability(firstServerAuthority.token, "career.context.read", 1, { entry_point: "direct" }, serverOperationId, serverIdempotencyKey);
    const retryServerAuthority = await host.issueServerCapabilityAuthority(launch.session_id, "career.context.read", serverOperationId, serverIdempotencyKey);
    const retryServerResult = await host.handleServerCapability(retryServerAuthority.token, "career.context.read", 1, { entry_point: "direct" }, serverOperationId, serverIdempotencyKey);
    expect(retryServerResult).toEqual(firstServerResult);
    expect(projectSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(firstServerResult)).not.toContain(firstServerAuthority.token);
    await expect(host.handleServerCapability(firstServerAuthority.token, "career.context.read", 1, { entry_point: "direct" }, serverOperationId, serverIdempotencyKey)).rejects.toMatchObject({ code: "token_replayed" });
    const inferenceOperationId = crypto.randomUUID();
    const inferenceInput = { inference_contract_version: 1, purpose: "interview_assist", operation_id: inferenceOperationId, fact_revision_ids: [confirmedJob.fact.metadata.revision_id] };
    await expect(host.handleBridge(launch.session_id, message("app.inference.request", inferenceInput), { origin: "null", sourceMatches: true }))
      .rejects.toMatchObject({ code: "invalid_input", message: "Installed app inference requires contract version 2" });
    const serverInferenceOperationId = crypto.randomUUID();
    const serverInferenceKey = `m5-server-inference-${serverInferenceOperationId}`;
    const serverInferenceAuthority = await host.issueServerCapabilityAuthority(launch.session_id, "app.inference.request", serverInferenceOperationId, serverInferenceKey);
    await expect(host.handleServerCapability(serverInferenceAuthority.token, "app.inference.request", 1, { ...inferenceInput, operation_id: serverInferenceOperationId }, serverInferenceOperationId, serverInferenceKey))
      .rejects.toMatchObject({ code: "invalid_input", message: "Installed app inference requires contract version 2" });
    const cancel = (target: string) => ({
      bridge_version: 1, message_id: crypto.randomUUID(), app_id: "ai.braindrive.resume-builder",
      installation_id: state.installation_id, view_id: launch.view_id, operation_id: launch.operation_id,
      sent_at: new Date().toISOString(), type: "operation.cancel",
      payload: { target_operation_id: target, token_id: launch.bridge_token_id },
    });
    await expect(host.handleBridge(launch.session_id, cancel(inferenceOperationId), { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "bridge_denied" });
    await expect(host.handleBridge(launch.session_id, cancel(crypto.randomUUID()), { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "bridge_denied" });
    await expect(host.handleBridge(launch.session_id, message("career.facts.confirm", {}), { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "bridge_denied" });

    const proposed = await host.handleOwnerCapability("career.facts.propose", proposalInput(), crypto.randomUUID(), false, "owner") as {
      fact: { metadata: { record_id: string; revision_id: string; revision: number } };
    };
    const confirmationOperation = crypto.randomUUID();
    const confirmationInput = {
      fact_record_id: proposed.fact.metadata.record_id,
      fact_revision_id: proposed.fact.metadata.revision_id,
      expected_revision: proposed.fact.metadata.revision,
      decision: "accept",
      edited_value: null,
      review_note: null,
    };
    await expect(host.handleOwnerCapability("career.facts.confirm", confirmationInput, confirmationOperation, false, "owner")).rejects.toMatchObject({
      code: "denied",
      details: { confirmation: { title: "Confirm career fact", actionLabel: "Confirm" } },
    });
    const confirmed = await host.handleOwnerCapability("career.facts.confirm", confirmationInput, confirmationOperation, true, "owner") as {
      fact: { state: string; confirmation: { operation_id: string; input_revision_id: string; host_mediated: boolean } };
      reused: boolean;
    };
    expect(confirmed).toMatchObject({
      fact: {
        state: "confirmed",
        confirmation: {
          operation_id: confirmationOperation,
          input_revision_id: proposed.fact.metadata.revision_id,
          host_mediated: true,
        },
      },
      reused: false,
    });
    await expect(host.handleOwnerCapability("career.facts.confirm", confirmationInput, confirmationOperation, true, "owner")).resolves.toMatchObject({ reused: true });

    const groupedProposals = await Promise.all([
      host.handleOwnerCapability("career.facts.propose", proposalInput("First factual unit from one submission"), crypto.randomUUID(), false, "owner"),
      host.handleOwnerCapability("career.facts.propose", proposalInput("Second factual unit from one submission"), crypto.randomUUID(), false, "owner"),
    ]) as Array<{ fact: { metadata: { record_id: string; revision_id: string; revision: number } } }>;
    const groupedOperation = crypto.randomUUID();
    const groupedInput = {
      decisions: groupedProposals.map((item, index) => ({
        fact_record_id: item.fact.metadata.record_id,
        fact_revision_id: item.fact.metadata.revision_id,
        expected_revision: item.fact.metadata.revision,
        decision: index === 0 ? "accept" as const : "reject" as const,
        edited_value: null,
        review_note: null,
      })),
    };
    await expect(host.handleOwnerCapability("career.facts.confirm", groupedInput, groupedOperation, true, "owner")).resolves.toMatchObject({
      facts: [{ state: "confirmed", confirmation: { operation_id: groupedOperation } }, { state: "rejected", confirmation: { operation_id: groupedOperation } }],
      reused: false,
    });
    await expect(host.handleOwnerCapability("career.facts.confirm", groupedInput, groupedOperation, true, "owner")).resolves.toMatchObject({ reused: true });
    expect(capabilityEvents.filter(({ event }) => event === "app.resume_confirmation.grouped")).toEqual([
      expect.objectContaining({ details: expect.objectContaining({ confirmation_group_count: 1, confirmation_unit_count: 2, used_evidence_count: 1, item_count: 2, timing_class: "human" }) }),
    ]);
  });

});
