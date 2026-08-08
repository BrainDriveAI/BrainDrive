import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { MCP_APP_MEDIA_TYPE } from "../contracts/constants.js";
import { MODERN_FIXTURE_VERSION } from "../lifecycle/fixture-repository.js";
import { createLifecycleHarness } from "../lifecycle/test-helpers.js";
import { AppMcpHost } from "./app-host.js";
import { ModernMcpAppsClient, type McpWireTransport } from "./modern-client.js";

const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; form-action 'none'"><main>Fixture</main>`;
class HostTransport implements McpWireTransport {
  crash = false;
  async request(method: string): Promise<unknown> {
    if (this.crash) throw new Error("server crash");
    if (method === "initialize") return { protocolVersion: "2026-07-28", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "fixture", version: "3.0.0" }, _meta: { "io.modelcontextprotocol/ui": { version: "2026-01-26" } } };
    if (method === "resources/list") return { resources: [{ uri: "ui://resume-builder/main", name: "Resume Builder", mimeType: MCP_APP_MEDIA_TYPE, size: Buffer.byteLength(html) }] };
    if (method === "resources/read") return { contents: [{ uri: "ui://resume-builder/main", mimeType: MCP_APP_MEDIA_TYPE, text: html }] };
    if (method === "tools/list") return { tools: [{ name: "fixture.status", _meta: { "io.modelcontextprotocol/ui": { visibility: ["app"] } } }, { name: "hidden", _meta: { "io.modelcontextprotocol/ui": { visibility: ["model"] } } }] };
    if (method === "tools/call") return { content: [{ type: "text", text: "ready" }, { type: "resource", resource: { uri: "ui://resume-builder/state", mimeType: "application/json", text: "{}" } }], structuredContent: { ready: true }, _meta: { retained: true }, isError: false };
    throw new Error(method);
  }
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-mcp-host-")); roots.push(root);
  const harness = await createLifecycleHarness(root);
  await harness.service.install({ version: MODERN_FIXTURE_VERSION, idempotencyKey: "m3-install-fixture", approveCapabilities: true });
  const transport = new HostTransport();
  const host = new AppMcpHost(harness.service, { clientFactory: () => new ModernMcpAppsClient(transport) });
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

describe("session-bound installed-app bridge", () => {
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
