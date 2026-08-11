import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDockerAppLifecycle } from "../lifecycle/bootstrap.js";
import { MODERN_FIXTURE_VERSION } from "../lifecycle/fixture-repository.js";
import { AppMcpHost } from "./app-host.js";

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
      const launch = await new AppMcpHost(lifecycle).launch();
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
      const host = new AppMcpHost(lifecycle);
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
