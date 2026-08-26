import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createBriefAppLifecycle, createDockerAppLifecycle } from "../lifecycle/bootstrap.js";
import { MODERN_FIXTURE_VERSION } from "../lifecycle/fixture-repository.js";
import { AppMcpHost } from "./app-host.js";
import { ResumeAppHostAdapter } from "./resume-host-adapter.js";
import { BriefAppHostAdapter } from "./brief-host-adapter.js";
import { BriefDataStore } from "../../brief-domain/store.js";
import { BriefDomainService } from "../../brief-domain/service.js";
import { BriefInferenceBroker } from "../../brief-inference/broker.js";
import { createBriefCapabilityRegistrations } from "../../app-capabilities/brief-registry.js";
import { AppInferenceDispatcher } from "../../app-inference/dispatcher.js";
import { AppInferencePurposeRegistry } from "../../app-inference/registry.js";
import { createBriefInferencePurposeRegistration } from "../../app-inference/brief-registration.js";
import { canonicalInputDigest } from "../contracts/common.js";

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
  for (const root of roots.splice(0)) {
    await makeWritable(root);
    await rm(root, { recursive: true, force: true });
  }
});

describe("live signed modern MCP Apps fixture", () => {
  async function briefHost(lifecycle: Awaited<ReturnType<typeof createBriefAppLifecycle>>, inferenceOverride?: BriefInferenceBroker, inferenceAudit = vi.fn()) {
    const store = new BriefDataStore(path.dirname(path.dirname(lifecycle.dependencies.ownerDataRoot)), lifecycle.dependencies.ownerDataRoot);
    await store.initialize((await lifecycle.ownerDescriptor()).grant?.owner_id ?? "00000000-0000-4000-8000-000000000001");
    const inference = inferenceOverride ?? new BriefInferenceBroker(async () => ({
      providerProfileId: "synthetic-workflow-fixture", modelId: "synthetic-contract-model", compatibility: "brief_structured_no_tools_v1",
      adapter: { completeStructuredNoTools: async ({ user }) => {
        const source = (JSON.parse(user) as { source: string }).source;
        const quote = source.split(/(?<=[.!?])\s+/)[0]!.trim();
        return { text: JSON.stringify({ title: "Launch brief", statements: [{ statement_id: crypto.randomUUID(), text: quote, support: { kind: "source_quote", quote } }] }), finishReason: "stop" };
      } },
    }));
    const domain = new BriefDomainService(store);
    const inferenceDispatcher = new AppInferenceDispatcher(new AppInferencePurposeRegistry([createBriefInferencePurposeRegistration(inference)]), Date.now, inferenceAudit);
    return { store, inferenceDispatcher, host: new AppMcpHost(BriefAppHostAdapter.create(lifecycle, createBriefCapabilityRegistrations(domain, inferenceDispatcher))) };
  }

  it("binds Brief inference cancellation to the authenticated session and cancels teardown without persistence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-brief-cancel-")); roots.push(root);
    const lifecycle = await createBriefAppLifecycle({ memoryRoot: path.join(root, "memory"), stateRoot: path.join(root, "host"), hostVersion: "26.7.23" });
    await lifecycle.install({ version: "1.0.0", idempotencyKey: "brief-cancel-install", approveCapabilities: true });
    const started: Array<() => void> = [];
    let lateResolve: (() => void) | undefined;
    const providerCall = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      started.shift()?.();
      if (providerCall.mock.calls.length === 2) {
        return new Promise<{ text: string; finishReason: "stop" }>((resolve) => {
          lateResolve = () => resolve({ text: JSON.stringify({ title: "Late", statements: [{ statement_id: crypto.randomUUID(), text: "Atlas launched in May.", support: { kind: "source_quote", quote: "Atlas launched in May." } }] }), finishReason: "stop" });
        });
      }
      return new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
    });
    const broker = new BriefInferenceBroker(async () => ({ providerProfileId: "synthetic", modelId: "pending", compatibility: "brief_structured_no_tools_v1", adapter: { completeStructuredNoTools: providerCall } }));
    const inferenceAudit = vi.fn();
    const { host, store, inferenceDispatcher } = await briefHost(lifecycle, broker, inferenceAudit);
    try {
      const first = await host.launch(), other = await host.launch();
      const bridge = (launch: typeof first, capability: string, input: unknown, requestOperationId: string) => ({
        bridge_version: 1, message_id: crypto.randomUUID(), app_id: "ai.braindrive.brief-builder", installation_id: launch.installation_id,
        view_id: launch.view_id, operation_id: launch.operation_id, sent_at: new Date().toISOString(), type: "capability.call",
        payload: { capability, input, request_operation_id: requestOperationId, token_id: launch.bridge_token_id },
      });
      const cancel = (launch: typeof first, target: string) => ({
        bridge_version: 1, message_id: crypto.randomUUID(), app_id: "ai.braindrive.brief-builder", installation_id: launch.installation_id,
        view_id: launch.view_id, operation_id: launch.operation_id, sent_at: new Date().toISOString(), type: "operation.cancel",
        payload: { target_operation_id: target, token_id: launch.bridge_token_id },
      });
      const input = { purpose_id: "brief.generate", version: 1, input: { source_text: "Atlas launched in May.", owner_context: [] } };
      const descriptor = await lifecycle.ownerDescriptor();
      const deniedContext = {
        appId: "ai.braindrive.brief-builder", installationId: first.installation_id, packageDigest: descriptor.record.active_package_digest as `sha256:${string}`,
        requestedPurposes: [{ purpose_id: "brief.generate", version: 1 }], grant: descriptor.grant!, operationId: crypto.randomUUID(),
        idempotencyKey: "brief-denied-inference-check", deadlineAt: Date.now() + 30_000,
      };
      const internalInput = { source_revision_id: crypto.randomUUID(), source_text: input.input.source_text, source_digest: canonicalInputDigest(input.input.source_text), owner_context: [] };
      await expect(inferenceDispatcher.execute({ purpose_id: "brief.generate", version: 2, input: internalInput }, deniedContext)).rejects.toMatchObject({ code: "incompatible_schema" });
      await expect(inferenceDispatcher.execute({ purpose_id: "resume.generate", version: 1, input: internalInput }, { ...deniedContext, operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "denied" });
      await expect(inferenceDispatcher.execute({ purpose_id: "brief.generate", version: 1, input: internalInput }, { ...deniedContext, operationId: crypto.randomUUID(), requestedPurposes: [] })).rejects.toMatchObject({ code: "denied" });
      await expect(inferenceDispatcher.execute({ purpose_id: "brief.generate", version: 1, input: internalInput }, { ...deniedContext, operationId: crypto.randomUUID(), grant: { ...descriptor.grant!, capabilities: [] } })).rejects.toMatchObject({ code: "denied" });
      expect(providerCall).not.toHaveBeenCalled();
      expect(await store.catalog()).toMatchObject({ sources: [], drafts: [] });
      const operationId = crypto.randomUUID();
      const providerStarted = new Promise<void>((resolve) => started.push(resolve));
      const pending = host.handleBridge(first.session_id, bridge(first, "app.inference.request", input, operationId), { origin: "null", sourceMatches: true });
      await providerStarted;
      await expect(host.handleBridge(other.session_id, cancel(other, operationId), { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "bridge_denied" });
      await expect(host.handleBridge(first.session_id, cancel(first, crypto.randomUUID()), { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "bridge_denied" });
      expect(inferenceDispatcher.cancel("ai.braindrive.resume-builder", first.installation_id, operationId, `brief-${operationId}`)).toBe(false);
      await expect(host.handleBridge(first.session_id, cancel(first, operationId), { origin: "null", sourceMatches: true })).resolves.toMatchObject({ result: { cancelled: true } });
      await expect(pending).rejects.toMatchObject({ code: "cancelled" });
      expect(await store.catalog()).toMatchObject({ sources: [], drafts: [] });

      const teardownOperationId = crypto.randomUUID();
      const teardownStarted = new Promise<void>((resolve) => started.push(resolve));
      const teardownPending = host.handleBridge(first.session_id, bridge(first, "app.inference.request", input, teardownOperationId), { origin: "null", sourceMatches: true });
      await teardownStarted;
      expect(host.close(first.session_id)).toBe(true);
      await expect(teardownPending).rejects.toMatchObject({ code: "cancelled" });
      lateResolve?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(await store.catalog()).toMatchObject({ sources: [], drafts: [] });
      expect(providerCall).toHaveBeenCalledTimes(2);
      expect(inferenceAudit.mock.calls.some(([event]) => event === "app.inference.dispatch")).toBe(true);
    } finally {
      await host.closeAll();
      await lifecycle.dependencies.supervisor.close();
    }
  }, 30_000);

  it("executes the distinct signed Brief package through the generic runtime and preserves approval across restart/reinstall", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-brief-live-")); roots.push(root);
    const memoryRoot = path.join(root, "memory"), stateRoot = path.join(root, "host");
    let lifecycle = await createBriefAppLifecycle({ memoryRoot, stateRoot, hostVersion: "26.7.23" });
    try {
      const installed = await lifecycle.install({ version: "1.0.0", idempotencyKey: "brief-live-install", approveCapabilities: true });
      const first = await briefHost(lifecycle);
      const launch = await first.host.launch();
      expect(launch).toMatchObject({ resource: { app_id: "ai.braindrive.brief-builder", uri: "ui://brief-builder/main" }, entry_point: "direct" });
      expect(launch.resource.html).toContain("Turn your source into a concise");
      expect(launch.resource.html).not.toMatch(/Career|Resume Builder/);
      expect(launch.allowed_capabilities).toEqual(expect.arrayContaining(["brief.records.read", "brief.approvals.confirm", "app.inference.request"]));

      const generated = await first.host.handleOwnerCapability("app.inference.request", { purpose_id: "brief.generate", version: 1, input: { source_text: "Atlas launched in May. Twelve owners joined the pilot.", owner_context: [] } }, crypto.randomUUID(), false, "owner");
      const draft = (generated as { draft: { draft_revision_id: string }; catalog_revision: number }).draft;
      await expect(first.host.handleOwnerCapability("brief.approvals.confirm", { action: "approve", draft_revision_id: draft.draft_revision_id, expected_catalog_revision: 2 }, crypto.randomUUID(), false, "owner")).rejects.toMatchObject({ code: "denied", details: { confirmation: { title: "Approve this brief?" } } });
      const approved = await first.host.handleOwnerCapability("brief.approvals.confirm", { action: "approve", draft_revision_id: draft.draft_revision_id, expected_catalog_revision: 2 }, crypto.randomUUID(), true, "owner") as { approved_revision_id: string };
      expect((await first.store.reopen()).approved?.approved_revision_id).toBe(approved.approved_revision_id);
      await first.host.closeAll();
      await lifecycle.dependencies.supervisor.close();

      lifecycle = await createBriefAppLifecycle({ memoryRoot, stateRoot, hostVersion: "26.7.23" });
      const restarted = await briefHost(lifecycle);
      expect((await restarted.store.reopen()).approved?.approved_revision_id).toBe(approved.approved_revision_id);
      await expect(restarted.host.launch()).resolves.toMatchObject({ resource: { uri: "ui://brief-builder/main" } });
      await lifecycle.uninstall({ idempotencyKey: "brief-live-uninstall", installationId: installed.record.installation_id });
      expect((await restarted.store.reopen()).approved?.approved_revision_id).toBe(approved.approved_revision_id);
      const reinstalled = await lifecycle.reinstall({ version: "1.0.0", idempotencyKey: "brief-live-reinstall", approveCapabilities: true });
      expect((await restarted.store.reopen()).approved?.approved_revision_id).toBe(approved.approved_revision_id);
      await lifecycle.uninstall({ idempotencyKey: "brief-live-uninstall-again", installationId: reinstalled.record.installation_id });
      await expect(lifecycle.deleteRetainedData({ operationId: crypto.randomUUID(), idempotencyKey: "brief-live-explicit-delete", ownerActorId: lifecycle.ownerActorId, confirmAppId: lifecycle.appId, trustedOwnerConfirmation: true })).resolves.toMatchObject({ app_id: "ai.braindrive.brief-builder", deleted: true });
      await expect(restarted.store.catalog()).rejects.toMatchObject({ code: "ENOENT" });
      await restarted.host.closeAll();
    } finally {
      await lifecycle.dependencies.supervisor.close();
    }
  }, 30_000);

  it("updates an active older package before negotiating the current modern release", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-modern-upgrade-")); roots.push(root);
    const lifecycle = await createDockerAppLifecycle({ memoryRoot: path.join(root, "memory"), stateRoot: path.join(root, "host"), hostVersion: "26.7.23" });
    try {
      const prior = await lifecycle.install({ version: "2.0.0", idempotencyKey: "prior-fixture-install", approveCapabilities: true });
      const updated = await lifecycle.update({
        version: MODERN_FIXTURE_VERSION,
        idempotencyKey: "modern-fixture-update",
        approveCapabilities: true,
        installationId: prior.record.installation_id,
        expectedGeneration: prior.record.generation,
      });

      expect(updated.record).toMatchObject({
        state: "active",
        installation_id: prior.record.installation_id,
        last_known_good_package_digest: prior.record.active_package_digest,
      });
      const launch = await new AppMcpHost(new ResumeAppHostAdapter(lifecycle)).launch();
      expect(launch.protocol.server_version).toBe(MODERN_FIXTURE_VERSION);
    } finally {
      await lifecycle.dependencies.supervisor.close();
    }
  });

  it("installs, negotiates, reads ui:// HTML, and preserves a complete tool result over the authenticated runtime", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-modern-fixture-")); roots.push(root);
    const lifecycle = await createDockerAppLifecycle({ memoryRoot: path.join(root, "memory"), stateRoot: path.join(root, "host"), hostVersion: "26.7.23" });
    try {
      const installed = await lifecycle.install({ version: MODERN_FIXTURE_VERSION, idempotencyKey: "modern-fixture-install", approveCapabilities: true });
      const host = new AppMcpHost(new ResumeAppHostAdapter(lifecycle));
      const launch = await host.launch();
      expect(launch.protocol).toMatchObject({ core: "2026-07-28", apps_extension: "2026-01-26", server_version: MODERN_FIXTURE_VERSION });
      expect(launch.resource).toMatchObject({ uri: "ui://resume-builder/main", mime_type: "text/html;profile=mcp-app" });
      expect(launch.resource.html).toContain("Start with what BrainDrive already knows");
      expect(launch.resource.html).toContain("Local extraction passed");
      expect(launch.resource.html).not.toMatch(/https?:|tauri:|fetch\s*\(/i);

      const response = await host.handleBridge(launch.session_id, {
        bridge_version: 1, message_id: crypto.randomUUID(), app_id: "ai.braindrive.resume-builder",
        installation_id: installed.record.installation_id, view_id: launch.view_id, operation_id: launch.operation_id,
        sent_at: new Date().toISOString(), type: "tool.call",
        payload: { server_id: launch.server_id, tool_name: "fixture.status", arguments: {}, token_id: launch.bridge_token_id },
      }, { origin: "null", sourceMatches: true });
      expect(response.status).toBe("completed");
      if (response.status === "completed") {
        expect(response.result.content.map((item) => item.type)).toEqual(["text", "resource_link", "resource"]);
        expect(response.result.structuredContent).toEqual({ ready: true, version: MODERN_FIXTURE_VERSION });
        expect(response.result._meta).toMatchObject({ "io.modelcontextprotocol/ui": { visibility: ["app"] } });
      }
      const resumed = await host.launch("direct", {
        sessionId: launch.session_id,
        viewId: launch.view_id,
        operationId: launch.operation_id,
        bridgeGeneration: launch.bridge_generation,
      });
      expect(resumed).toMatchObject({
        view_id: launch.view_id,
        operation_id: launch.operation_id,
        bridge_generation: 2,
        resumed: true,
      });
      await expect(host.handleAppsBridge(launch.session_id, {})).rejects.toMatchObject({ code: "session_closed" });
      const currentResource = {
        bridge_envelope_version: 1,
        message_id: crypto.randomUUID(),
        installation_id: resumed.installation_id,
        view_id: resumed.view_id,
        operation_id: resumed.operation_id,
        bridge_generation: resumed.bridge_generation,
        direction: "app_to_host",
        provenance: { source_window_match: true, opaque_origin: "null", same_server_id: resumed.server_id },
        sent_at: new Date().toISOString(),
        message: { jsonrpc: "2.0", id: "live-resource-after-resume", method: "resources/read", params: { uri: resumed.resource.uri } },
      };
      await expect(host.handleAppsBridge(resumed.session_id, currentResource)).resolves.toMatchObject({ id: "live-resource-after-resume" });

      const concurrent = await host.launch("career");
      expect(concurrent.view_id).not.toBe(resumed.view_id);
      expect(concurrent.operation_id).not.toBe(resumed.operation_id);
      await expect(host.handleAppsBridge(concurrent.session_id, {
        ...currentResource,
        message_id: crypto.randomUUID(),
        message: { jsonrpc: "2.0", id: "cross-view-live", method: "resources/read", params: { uri: concurrent.resource.uri } },
      })).rejects.toMatchObject({ code: "bridge_denied" });
      expect(host.close(concurrent.session_id)).toBe(true);
      expect(host.sessionCountForTest()).toBe(1);

      await lifecycle.disable({ idempotencyKey: "modern-fixture-disable" });
      await expect(host.handleBridge(resumed.session_id, {}, { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "session_closed" });
      await lifecycle.uninstall({ idempotencyKey: "modern-fixture-final-uninstall" });
    } finally {
      await lifecycle.dependencies.supervisor.close();
    }
  });
});
