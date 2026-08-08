import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDockerAppLifecycle } from "../lifecycle/bootstrap.js";
import { MODERN_FIXTURE_VERSION } from "../lifecycle/fixture-repository.js";
import { AppMcpHost } from "./app-host.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("live signed modern MCP Apps fixture", () => {
  it("installs, negotiates, reads ui:// HTML, and preserves a complete tool result over the authenticated runtime", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-modern-fixture-")); roots.push(root);
    const lifecycle = await createDockerAppLifecycle({ memoryRoot: path.join(root, "memory"), stateRoot: path.join(root, "host"), hostVersion: "26.7.23" });
    try {
      const installed = await lifecycle.install({ version: MODERN_FIXTURE_VERSION, idempotencyKey: "modern-fixture-install", approveCapabilities: true });
      const host = new AppMcpHost(lifecycle);
      const launch = await host.launch();
      expect(launch.protocol).toMatchObject({ core: "2026-07-28", apps_extension: "2026-01-26", server_version: "3.0.0" });
      expect(launch.resource).toMatchObject({ uri: "ui://resume-builder/main", mime_type: "text/html;profile=mcp-app" });
      expect(launch.resource.html).toContain("Start with what BrainDrive already knows");
      expect(launch.resource.html).toContain("ATS parse-back passed");
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
        expect(response.result.structuredContent).toEqual({ ready: true, version: "3.0.0" });
        expect(response.result._meta).toMatchObject({ "io.modelcontextprotocol/ui": { visibility: ["app"] } });
      }
      await lifecycle.disable({ idempotencyKey: "modern-fixture-disable" });
      await expect(host.handleBridge(launch.session_id, {}, { origin: "null", sourceMatches: true })).rejects.toMatchObject({ code: "session_closed" });
    } finally {
      await lifecycle.dependencies.supervisor.close();
    }
  });
});
