import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CareerPlacementAdapter } from "../../resume-domain/career.js";
import { ResumeCapabilityRouter } from "../../resume-domain/capabilities.js";
import { issueHostOwnerCapabilityAuthorization, ResumeCapabilityPolicy } from "../../resume-domain/capability-policy.js";
import { ResumeDomainService } from "../../resume-domain/service.js";
import { ResumeDataStore } from "../../resume-domain/store.js";
import { proposalInput } from "../../resume-domain/test-helpers.js";
import { ResumeInferenceBroker } from "../../resume-inference/broker.js";
import { ImmutableInferenceSnapshotBuilder } from "../../resume-inference/snapshot.js";
import type { ModelAdapter } from "../../adapters/base.js";
import { MODERN_FIXTURE_VERSION } from "../lifecycle/fixture-repository.js";
import { createLifecycleHarness } from "../lifecycle/test-helpers.js";
import { AppMcpHost } from "./app-host.js";
import { ModernMcpAppsClient, type McpWireTransport } from "./modern-client.js";

const html = "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; connect-src 'none'; form-action 'none'\"><main>Fixture</main>";
class FixtureTransport implements McpWireTransport {
  async request(method: string): Promise<unknown> {
    if (method === "initialize") return { protocolVersion: "2026-07-28", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "fixture", version: "3.0.0" }, _meta: { "io.modelcontextprotocol/ui": { version: "2026-01-26" } } };
    if (method === "resources/list") return { resources: [{ uri: "ui://resume-builder/main", name: "Resume Builder", mimeType: "text/html;profile=mcp-app", size: Buffer.byteLength(html) }] };
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
    const router = new ResumeCapabilityRouter(
      new ResumeDomainService(store),
      new CareerPlacementAdapter(root),
      new ResumeCapabilityPolicy(async () => {
        const current = await harness.service.ownerDescriptor();
        return current.record.state === "active" ? current.grant : null;
      }),
    );
    const adapter: ModelAdapter = {
      async complete() { throw new Error("agent path prohibited"); },
      async completeStructuredNoTools() {
        return { text: JSON.stringify({ questions: [{ question_id: crypto.randomUUID(), topic: "experience", prompt: "What did you build?", rationale: "Collect an owner fact" }] }), finishReason: "stop" };
      },
    };
    const broker = new ResumeInferenceBroker(async () => ({ providerProfileId: "owner-profile", providerId: "ollama", modelId: "local-model", modelClass: "owner_active_compatible", adapter }));
    const host = new AppMcpHost(harness.service, { capabilityRouter: router, inferenceBroker: broker, snapshotBuilder: new ImmutableInferenceSnapshotBuilder(store), clientFactory: () => new ModernMcpAppsClient(new FixtureTransport()) });
    const ownerAuthorization = issueHostOwnerCapabilityAuthorization("owner");
    const launch = await host.launch();
    expect(launch.allowed_capabilities).not.toContain("career.facts.confirm");
    expect(launch.allowed_capabilities).toContain("resume.export.request");
    expect(launch.allowed_capabilities).toContain("app.inference.request");
    const state = await harness.service.status();
    const message = (capability: string, input: Record<string, unknown>) => ({
      bridge_version: 1, message_id: crypto.randomUUID(), app_id: "ai.braindrive.resume-builder",
      installation_id: state.installation_id, view_id: launch.view_id, operation_id: launch.operation_id,
      sent_at: new Date().toISOString(), type: "capability.call",
      payload: { capability, input, token_id: launch.bridge_token_id },
    });
    await expect(host.handleBridge(launch.session_id, message("career.context.read", { entry_point: "direct" }), { origin: "null", sourceMatches: true })).resolves.toMatchObject({ status: "capability_completed", result: { context_version: 1 } });
    const inferenceOperationId = crypto.randomUUID();
    const inference = await host.handleBridge(launch.session_id, message("app.inference.request", { purpose: "interview_assist", operation_id: inferenceOperationId, fact_revision_ids: [] }), { origin: "null", sourceMatches: true });
    expect(inference).toMatchObject({ status: "capability_completed", result: { status: "completed", model_class: "owner_active_compatible" } });
    expect(JSON.stringify(inference)).not.toContain("owner-profile");
    expect(JSON.stringify(inference)).not.toContain("local-model");
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
