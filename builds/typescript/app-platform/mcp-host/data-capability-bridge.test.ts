import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CareerPlacementAdapter } from "../../resume-domain/career.js";
import { canonicalInputDigest } from "../contracts/common.js";
import { ResumeCapabilityRouter } from "../../resume-domain/capabilities.js";
import { issueHostOwnerCapabilityAuthorization, ResumeCapabilityPolicy } from "../../resume-domain/capability-policy.js";
import { ResumeDomainService } from "../../resume-domain/service.js";
import { ResumeDataStore } from "../../resume-domain/store.js";
import { authority, ownerDecision, proposalInput } from "../../resume-domain/test-helpers.js";
import { ResumeInferenceBroker } from "../../resume-inference/broker.js";
import { ImmutableInferenceSnapshotBuilder } from "../../resume-inference/snapshot.js";
import type { ModelAdapter } from "../../adapters/base.js";
import { MODERN_FIXTURE_VERSION } from "../lifecycle/fixture-repository.js";
import { createLifecycleHarness } from "../lifecycle/test-helpers.js";
import { AppMcpHost } from "./app-host.js";
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
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("M4 capability bridge", () => {
  it("executes declared reads and denies confirmation from the sandbox", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m4-bridge-")); roots.push(root);
    const harness = await createLifecycleHarness(root);
    await harness.service.install({ version: MODERN_FIXTURE_VERSION, idempotencyKey: "m4-capability-install", approveCapabilities: true });
    const descriptor = await harness.service.ownerDescriptor();
    const store = new ResumeDataStore(root, path.join(root, "owner-data"), {}, false);
    await store.initialize(descriptor.grant!.owner_id);
    const domain = new ResumeDomainService(store);
    const router = new ResumeCapabilityRouter(
      domain,
      new CareerPlacementAdapter(root),
      new ResumeCapabilityPolicy(async () => {
        const current = await harness.service.ownerDescriptor();
        return current.record.state === "active" ? current.grant : null;
      }),
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
    const adapter: ModelAdapter = {
      async complete() { throw new Error("agent path prohibited"); },
      async completeStructuredNoTools() {
        return { text: JSON.stringify({ questions: [{ question_id: crypto.randomUUID(), job_fact_revision_id: confirmedJob.fact.metadata.revision_id, dimension: "accomplishments", selection_method: "broker_ranked", prompt: "What did you build in this role? A qualitative answer is enough.", rationale: "Collect the highest-value unanswered evidence for the active job." }] }), finishReason: "stop" };
      },
    };
    const broker = new ResumeInferenceBroker(async () => ({ providerProfileId: "owner-profile", providerId: "ollama", modelId: "local-model", modelClass: "owner_active_compatible", adapter }));
    const host = new AppMcpHost(harness.service, { capabilityRouter: router, inferenceBroker: broker, snapshotBuilder: new ImmutableInferenceSnapshotBuilder(store), clientFactory: (connection) => new ModernMcpAppsClient(new FixtureTransport(), identityForRuntime(connection)) });
    const ownerAuthorization = issueHostOwnerCapabilityAuthorization("owner");
    const launch = await host.launch();
    expect(launch.allowed_capabilities).not.toContain("career.facts.confirm");
    expect(launch.allowed_capabilities).toContain("resume.export.request");
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
    const firstRecovery = await host.handleBridge(
      launch.session_id,
      message("resume.definitions.write", recoveryInput, recoveryOperationId),
      { origin: "null", sourceMatches: true },
    );
    const replayedRecovery = await host.handleBridge(
      launch.session_id,
      message("resume.definitions.write", recoveryInput, recoveryOperationId),
      { origin: "null", sourceMatches: true },
    );
    expect(firstRecovery).toMatchObject({ status: "capability_completed", result: { reused: false, acknowledgement: { revision: 1 } } });
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
      message("resume.operations.read", { queried_operation_id: recoveryOperationId }),
      { origin: "null", sourceMatches: true },
    )).resolves.toMatchObject({ status: "capability_completed", result: { record: { operation_id: recoveryOperationId, status: "committed" }, results: [expect.objectContaining({ record_type: "interview_progress" })] } });
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
    const jobEvidenceSummary = { active_job_fact_revision_id: confirmedJob.fact.metadata.revision_id, active_job_revision: confirmedJob.fact.metadata.revision, requested_dimension: "accomplishments", dimensions: [] };
    const inferenceInput = { inference_contract_version: 1, purpose: "interview_assist", operation_id: inferenceOperationId, fact_revision_ids: [confirmedJob.fact.metadata.revision_id], derived_blocks: [{ category: "job_evidence_summary", schema_id: "resume.job-evidence-summary.v1", data: jobEvidenceSummary }] };
    const inference = await host.handleBridge(launch.session_id, message("app.inference.request", inferenceInput), { origin: "null", sourceMatches: true });
    expect(inference).toMatchObject({ status: "capability_completed", result: { inference_contract_version: 1, status: "completed", model_class: "owner_active_compatible", events: [{ event: "progress" }, { event: "completed" }] } });
    expect(JSON.stringify(inference)).not.toContain("owner-profile");
    expect(JSON.stringify(inference)).not.toContain("local-model");
    const serverInferenceOperationId = crypto.randomUUID();
    const serverInferenceKey = `m5-server-inference-${serverInferenceOperationId}`;
    const serverInferenceAuthority = await host.issueServerCapabilityAuthority(launch.session_id, "app.inference.request", serverInferenceOperationId, serverInferenceKey);
    await expect(host.handleServerCapability(serverInferenceAuthority.token, "app.inference.request", 1, { ...inferenceInput, operation_id: serverInferenceOperationId }, serverInferenceOperationId, serverInferenceKey)).resolves.toMatchObject({ inference_contract_version: 1, status: "completed" });
    const reconnectProviderCall = vi.fn(async () => { throw new Error("reconnect must reuse the durable inference result"); });
    const reconnectBroker = new ResumeInferenceBroker(async () => ({
      providerProfileId: "different-profile", providerId: "openrouter", modelId: "different-model",
      modelClass: "owner_active_compatible", adapter: { async complete() { throw new Error("agent path prohibited"); }, completeStructuredNoTools: reconnectProviderCall },
    }));
    const reconnectHost = new AppMcpHost(harness.service, { capabilityRouter: router, inferenceBroker: reconnectBroker, snapshotBuilder: new ImmutableInferenceSnapshotBuilder(store), clientFactory: (connection) => new ModernMcpAppsClient(new FixtureTransport(), identityForRuntime(connection)) });
    const reconnectLaunch = await reconnectHost.launch();
    const reconnectMessage = {
      bridge_version: 1, message_id: crypto.randomUUID(), app_id: "ai.braindrive.resume-builder",
      installation_id: state.installation_id, view_id: reconnectLaunch.view_id, operation_id: reconnectLaunch.operation_id,
      sent_at: new Date().toISOString(), type: "capability.call",
      payload: { capability: "app.inference.request", input: inferenceInput, token_id: reconnectLaunch.bridge_token_id },
    };
    await expect(reconnectHost.handleBridge(reconnectLaunch.session_id, reconnectMessage, { origin: "null", sourceMatches: true })).resolves.toEqual(inference);
    expect(reconnectProviderCall).not.toHaveBeenCalled();
    const cancel = (target: string) => ({
      bridge_version: 1, message_id: crypto.randomUUID(), app_id: "ai.braindrive.resume-builder",
      installation_id: state.installation_id, view_id: launch.view_id, operation_id: launch.operation_id,
      sent_at: new Date().toISOString(), type: "operation.cancel",
      payload: { target_operation_id: target, token_id: launch.bridge_token_id },
    });
    await expect(host.handleBridge(launch.session_id, cancel(inferenceOperationId), { origin: "null", sourceMatches: true })).resolves.toMatchObject({ status: "capability_completed", result: { cancelled: false } });
    await expect(host.handleBridge(launch.session_id, cancel(crypto.randomUUID()), { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "bridge_denied" });
    await expect(host.handleBridge(launch.session_id, message("career.facts.confirm", {}), { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "bridge_denied" });

    const proposed = await host.handleOwnerCapability("career.facts.propose", proposalInput(), crypto.randomUUID(), false, ownerAuthorization) as {
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
    await expect(host.handleOwnerCapability("career.facts.confirm", confirmationInput, confirmationOperation, false, ownerAuthorization)).rejects.toMatchObject({ code: "denied" });
    const confirmed = await host.handleOwnerCapability("career.facts.confirm", confirmationInput, confirmationOperation, true, ownerAuthorization) as {
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
    await expect(host.handleOwnerCapability("career.facts.confirm", confirmationInput, confirmationOperation, true, ownerAuthorization)).resolves.toMatchObject({ reused: true });
  });
});
