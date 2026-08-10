import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { MCP_APP_MEDIA_TYPE } from "../contracts/constants.js";
import { MODERN_FIXTURE_VERSION } from "../lifecycle/fixture-repository.js";
import { createLifecycleHarness } from "../lifecycle/test-helpers.js";
import { AppMcpHost } from "./app-host.js";
import { ModernMcpAppsClient, identityForRuntime, type McpWireTransport } from "./modern-client.js";

const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; form-action 'none'"><main>Fixture</main>`;
class HostTransport implements McpWireTransport {
  crash = false;
  toolBarrier: Promise<void> | null = null;
  onToolStarted: (() => void) | null = null;
  async request(method: string): Promise<unknown> {
    if (this.crash) throw new Error("server crash");
    if (method === "server/discover") return { supportedVersions: ["2026-07-28"], capabilities: { tools: {}, resources: {}, extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [MCP_APP_MEDIA_TYPE] } } }, _meta: { "io.modelcontextprotocol/ui": { version: "2026-01-26" }, "io.modelcontextprotocol/serverInfo": { name: "fixture", version: "3.0.0" } } };
    if (method === "resources/list") return { resources: [{ uri: "ui://resume-builder/main", name: "Resume Builder", mimeType: MCP_APP_MEDIA_TYPE, size: Buffer.byteLength(html) }] };
    if (method === "resources/templates/list") return { resourceTemplates: [] };
    if (method === "resources/read") return { contents: [{ uri: "ui://resume-builder/main", mimeType: MCP_APP_MEDIA_TYPE, text: html }] };
    if (method === "tools/list") return { tools: [{ name: "fixture.status", _meta: { ui: { visibility: ["app"] } } }, { name: "hidden", _meta: { ui: { visibility: ["model"] } } }] };
    if (method === "tools/call") {
      this.onToolStarted?.();
      if (this.toolBarrier) await this.toolBarrier;
      return { content: [{ type: "text", text: "ready" }, { type: "resource", resource: { uri: "ui://resume-builder/state", mimeType: "application/json", text: "{}" } }], structuredContent: { ready: true }, _meta: { retained: true }, isError: false };
    }
    throw new Error(method);
  }
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-mcp-host-")); roots.push(root);
  const harness = await createLifecycleHarness(root);
  await harness.service.install({ version: MODERN_FIXTURE_VERSION, idempotencyKey: "m3-install-fixture", approveCapabilities: true });
  const transport = new HostTransport();
  const host = new AppMcpHost(harness.service, { clientFactory: (connection) => new ModernMcpAppsClient(transport, identityForRuntime(connection)) });
  const launch = await host.launch();
  return { harness, host, launch, transport };
}

function bridgeMessage(launch: Awaited<ReturnType<AppMcpHost["launch"]>>, installationId: string, overrides: { sent_at?: string; server_id?: string; tool_name?: string } = {}) {
  return {
    bridge_version: 1, message_id: crypto.randomUUID(), app_id: "ai.braindrive.resume-builder",
    installation_id: installationId, view_id: launch.view_id, operation_id: launch.operation_id,
    sent_at: overrides.sent_at ?? new Date().toISOString(), type: "tool.call",
    payload: { server_id: overrides.server_id ?? launch.server_id, tool_name: overrides.tool_name ?? "fixture.status", arguments: {}, token_id: launch.bridge_token_id },
  };
}

function appsEnvelope(
  launch: Awaited<ReturnType<AppMcpHost["launch"]>>,
  message: Record<string, unknown>,
  overrides: Partial<{
    message_id: string;
    installation_id: string;
    view_id: string;
    operation_id: string;
    bridge_generation: number;
    sent_at: string;
    same_server_id: string;
  }> = {},
) {
  return {
    bridge_envelope_version: 1,
    message_id: overrides.message_id ?? crypto.randomUUID(),
    installation_id: overrides.installation_id ?? launch.installation_id,
    view_id: overrides.view_id ?? launch.view_id,
    operation_id: overrides.operation_id ?? launch.operation_id,
    bridge_generation: overrides.bridge_generation ?? launch.bridge_generation,
    direction: "app_to_host",
    provenance: { source_window_match: true, opaque_origin: "null", same_server_id: overrides.same_server_id ?? launch.server_id },
    sent_at: overrides.sent_at ?? new Date().toISOString(),
    message,
  };
}

describe("session-bound installed-app bridge", () => {
  it("routes strict official Apps tool and resource requests without an app-held credential", async () => {
    const { host, launch } = await setup();
    const tool = appsEnvelope(launch, { jsonrpc: "2.0", id: "apps-tool-1", method: "tools/call", params: { name: "fixture.status", arguments: {} } });
    const toolResponse = await host.handleAppsBridge(launch.session_id, tool);
    expect(toolResponse).toMatchObject({
      jsonrpc: "2.0", id: "apps-tool-1",
      result: { consumer: "app", content: expect.any(Array), structuredContent: { ready: true }, _meta: { retained: true }, isError: false },
    });
    expect(JSON.stringify(tool)).not.toContain(launch.bridge_token_id);
    expect(JSON.stringify(toolResponse)).not.toMatch(/(?:bearer\s|\/home\/|[A-Za-z]:\\)/i);

    const resource = appsEnvelope(launch, { jsonrpc: "2.0", id: "apps-resource-1", method: "resources/read", params: { uri: launch.resource.uri } });
    await expect(host.handleAppsBridge(launch.session_id, resource)).resolves.toMatchObject({
      jsonrpc: "2.0", id: "apps-resource-1",
      result: { contents: [{ uri: launch.resource.uri, mimeType: MCP_APP_MEDIA_TYPE, text: html }] },
    });
  });

  it("rejects official Apps replay, stale/cross-view/cross-server, hidden tools, and undeclared resources", async () => {
    const { host, launch } = await setup();
    const valid = appsEnvelope(launch, { jsonrpc: "2.0", id: "apps-valid", method: "tools/call", params: { name: "fixture.status", arguments: {} } });
    await host.handleAppsBridge(launch.session_id, valid);
    await expect(host.handleAppsBridge(launch.session_id, valid)).rejects.toMatchObject({ code: "bridge_replayed" });
    await expect(host.handleAppsBridge(launch.session_id, appsEnvelope(launch, { jsonrpc: "2.0", id: "stale", method: "tools/call", params: { name: "fixture.status" } }, { sent_at: "2020-01-01T00:00:00.000Z" }))).rejects.toMatchObject({ code: "bridge_stale" });
    await expect(host.handleAppsBridge(launch.session_id, appsEnvelope(launch, { jsonrpc: "2.0", id: "view", method: "tools/call", params: { name: "fixture.status" } }, { view_id: crypto.randomUUID() }))).rejects.toMatchObject({ code: "bridge_denied" });
    await expect(host.handleAppsBridge(launch.session_id, appsEnvelope(launch, { jsonrpc: "2.0", id: "server", method: "tools/call", params: { name: "fixture.status" } }, { same_server_id: crypto.randomUUID() }))).rejects.toMatchObject({ code: "bridge_denied" });
    await expect(host.handleAppsBridge(launch.session_id, appsEnvelope(launch, { jsonrpc: "2.0", id: "hidden", method: "tools/call", params: { name: "hidden" } }))).rejects.toMatchObject({ code: "bridge_denied" });
    await expect(host.handleAppsBridge(launch.session_id, appsEnvelope(launch, { jsonrpc: "2.0", id: "resource", method: "resources/read", params: { uri: "ui://resume-builder/other" } }))).rejects.toMatchObject({ code: "bridge_denied" });
  });

  it("launches only after negotiation and returns complete same-server app-visible tool results", async () => {
    const { harness, host, launch } = await setup();
    const state = await harness.service.status();
    const message = bridgeMessage(launch, state.installation_id!);
    const response = await host.handleBridge(launch.session_id, message, { origin: "null", sourceMatches: true });
    expect(response.status).toBe("completed");
    if (response.status === "completed") {
      expect(response.result.content).toHaveLength(2);
      expect(response.result.structuredContent).toEqual({ ready: true });
      expect(response.result._meta).toEqual({ retained: true });
    }
  });

  it("reconnects with stable view/operation identity, rotates bridge authority, and discards a late old-generation result", async () => {
    const { host, launch, transport } = await setup();
    let releaseTool!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    transport.onToolStarted = markStarted;
    transport.toolBarrier = new Promise<void>((resolve) => { releaseTool = resolve; });
    const pending = host.handleAppsBridge(launch.session_id, appsEnvelope(launch, {
      jsonrpc: "2.0", id: "old-generation-call", method: "tools/call", params: { name: "fixture.status", arguments: {} },
    }));
    await started;

    const resumed = await host.launch("direct", {
      sessionId: launch.session_id,
      viewId: launch.view_id,
      operationId: launch.operation_id,
      bridgeGeneration: launch.bridge_generation,
    });
    expect(resumed).toMatchObject({
      view_id: launch.view_id,
      operation_id: launch.operation_id,
      bridge_generation: launch.bridge_generation + 1,
      resumed: true,
    });
    expect(resumed.session_id).not.toBe(launch.session_id);
    expect(host.close(launch.session_id)).toBe(false);
    expect(host.sessionCountForTest()).toBe(1);

    releaseTool();
    await expect(pending).rejects.toMatchObject({ code: "session_closed" });
    await expect(host.handleAppsBridge(resumed.session_id, appsEnvelope(resumed, {
      jsonrpc: "2.0", id: "stale-bridge", method: "resources/read", params: { uri: resumed.resource.uri },
    }, { bridge_generation: launch.bridge_generation }))).rejects.toMatchObject({ code: "bridge_denied" });
    await expect(host.handleAppsBridge(resumed.session_id, appsEnvelope(resumed, {
      jsonrpc: "2.0", id: "current-bridge", method: "resources/read", params: { uri: resumed.resource.uri },
    }))).resolves.toMatchObject({ id: "current-bridge" });
  });

  it("isolates cancellation and bridge identity across concurrent views", async () => {
    const { host, launch, transport } = await setup();
    const second = await host.launch("career");
    expect(second.view_id).not.toBe(launch.view_id);
    expect(second.operation_id).not.toBe(launch.operation_id);

    let releaseTool!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    transport.onToolStarted = markStarted;
    transport.toolBarrier = new Promise<void>((resolve) => { releaseTool = resolve; });
    const operationId = crypto.randomUUID();
    const pending = host.handleAppsBridge(launch.session_id, appsEnvelope(launch, {
      jsonrpc: "2.0", id: "isolated-call", method: "tools/call", params: { name: "fixture.status", arguments: {} },
    }, { message_id: operationId }));
    await started;
    expect(host.cancelAppsBridgeRequest(second.session_id, operationId)).toBe(false);
    expect(host.cancelAppsBridgeRequest(launch.session_id, operationId)).toBe(true);
    releaseTool();
    await pending.catch(() => undefined);

    await expect(host.handleAppsBridge(second.session_id, appsEnvelope(launch, {
      jsonrpc: "2.0", id: "cross-view", method: "resources/read", params: { uri: launch.resource.uri },
    }))).rejects.toMatchObject({ code: "bridge_denied" });
    expect(host.close(launch.session_id)).toBe(true);
    expect(host.sessionCountForTest()).toBe(1);
    await expect(host.handleAppsBridge(second.session_id, appsEnvelope(second, {
      jsonrpc: "2.0", id: "second-still-live", method: "resources/read", params: { uri: second.resource.uri },
    }))).resolves.toMatchObject({ id: "second-still-live" });
  });

  it("rejects replay, stale/wrong-origin/cross-server and undeclared bridge calls", async () => {
    const { harness, host, launch } = await setup();
    const state = await harness.service.status();
    const valid = bridgeMessage(launch, state.installation_id!);
    await host.handleBridge(launch.session_id, valid, { origin: "null", sourceMatches: true });
    await expect(host.handleBridge(launch.session_id, valid, { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "bridge_replayed" });
    const stale = bridgeMessage(launch, state.installation_id!, { sent_at: "2020-01-01T00:00:00.000Z" });
    await expect(host.handleBridge(launch.session_id, stale, { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "bridge_stale" });
    const hidden = bridgeMessage(launch, state.installation_id!, { tool_name: "hidden" });
    await expect(host.handleBridge(launch.session_id, hidden, { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "bridge_denied" });
    const crossServer = bridgeMessage(launch, state.installation_id!, { server_id: crypto.randomUUID() });
    await expect(host.handleBridge(launch.session_id, crossServer, { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "bridge_denied" });
    const wrongBinding = bridgeMessage(launch, state.installation_id!); wrongBinding.payload.token_id = crypto.randomUUID();
    await expect(host.handleBridge(launch.session_id, wrongBinding, { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "bridge_denied" });
    const wrongOrigin = bridgeMessage(launch, state.installation_id!);
    await expect(host.handleBridge(launch.session_id, wrongOrigin, { origin: "https://host.invalid", sourceMatches: true })).rejects.toMatchObject({ code: "bridge_denied" });
  });

  it("rejects malformed and oversized envelopes and surfaces a crashed server without leaking its response", async () => {
    const { harness, host, launch, transport } = await setup();
    const state = await harness.service.status();
    await expect(host.handleBridge(launch.session_id, { invalid: true }, { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "bridge_malformed" });
    await expect(host.handleBridge(launch.session_id, { value: "x".repeat(70_000) }, { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "bridge_oversized" });
    transport.crash = true;
    await expect(host.handleBridge(launch.session_id, bridgeMessage(launch, state.installation_id!), { origin: "null", sourceMatches: true })).rejects.toMatchObject({
      code: "lifecycle_failed",
      message: "Installed app server could not complete the declared operation",
    });
  });

  it("expires sessions and closes them when lifecycle authority changes", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"));
    const { harness, host, launch } = await setup();
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await expect(host.handleBridge(launch.session_id, {}, { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "session_expired" });
    vi.setSystemTime(new Date("2026-08-07T12:10:00.000Z"));
    const second = await host.launch();
    await harness.service.disable({ idempotencyKey: crypto.randomUUID() });
    await expect(host.handleBridge(second.session_id, {}, { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "session_closed" });
    expect(host.sessionCountForTest()).toBe(0);
  });
});
