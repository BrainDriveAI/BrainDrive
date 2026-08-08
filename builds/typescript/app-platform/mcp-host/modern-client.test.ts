import { describe, expect, it } from "vitest";

import { MCP_APP_MEDIA_TYPE } from "../contracts/constants.js";
import { ModernMcpAppsClient, appVisibleToolNames, validateSandboxHtml, type McpWireTransport } from "./modern-client.js";

const safeHtml = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; form-action 'none'"><main>Safe</main>`;

class FixtureTransport implements McpWireTransport {
  constructor(private readonly overrides: Record<string, unknown> = {}) {}
  async request(method: string): Promise<unknown> {
    if (method in this.overrides) return this.overrides[method];
    if (method === "initialize") return { protocolVersion: "2026-07-28", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "fixture", version: "3.0.0" }, _meta: { "io.modelcontextprotocol/ui": { version: "2026-01-26" } } };
    if (method === "resources/list") return { resources: [{ uri: "ui://resume-builder/main", name: "Resume Builder", mimeType: MCP_APP_MEDIA_TYPE, size: Buffer.byteLength(safeHtml), annotations: { audience: ["user"] }, _meta: { retainedDescriptor: true } }], _meta: { retainedList: true } };
    if (method === "tools/list") return { tools: [{ name: "fixture.status", inputSchema: { type: "object" }, _meta: { "io.modelcontextprotocol/ui": { visibility: ["app"] } } }, { name: "model.only", _meta: { "io.modelcontextprotocol/ui": { visibility: ["model"] } } }] };
    if (method === "resources/read") return { contents: [{ uri: "ui://resume-builder/main", mimeType: MCP_APP_MEDIA_TYPE, text: safeHtml, annotations: { priority: 1 }, _meta: { retainedRead: true } }], _meta: { retainedEnvelope: true } };
    if (method === "tools/call") return { content: [{ type: "text", text: "one" }, { type: "resource_link", name: "ui", uri: "ui://resume-builder/main" }], structuredContent: { ready: true }, _meta: { retained: true }, isError: false };
    throw new Error(method);
  }
}

describe("modern installed-app MCP client", () => {
  it("negotiates exact modern core and Apps versions before reading a bounded ui resource", async () => {
    const client = new ModernMcpAppsClient(new FixtureTransport());
    const session = await client.negotiate();
    expect(session).toMatchObject({ protocolVersion: "2026-07-28", extensionVersion: "2026-01-26", serverName: "fixture" });
    expect(appVisibleToolNames(session.tools)).toEqual(["fixture.status"]);
    const loaded = await client.readAppResource(session, "ui://resume-builder/main", `sha256:${"a".repeat(64)}`);
    expect(loaded.resource.html).toBe(safeHtml);
    expect(loaded.envelope.descriptor).toMatchObject({ annotations: { audience: ["user"] }, _meta: { retainedDescriptor: true } });
    expect(loaded.envelope.read).toMatchObject({ _meta: { retainedEnvelope: true }, contents: [{ annotations: { priority: 1 }, _meta: { retainedRead: true } }] });
    expect(session.resourceListEnvelope).toMatchObject({ _meta: { retainedList: true } });
  });

  it.each([
    ["legacy protocol", { initialize: { protocolVersion: "2025-11-25", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "legacy", version: "1" } } }, "protocol_incompatible"],
    ["missing Apps extension", { initialize: { protocolVersion: "2026-07-28", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "partial", version: "1" }, _meta: {} } }, "extension_incompatible"],
  ])("rejects %s before resource reads", async (_label, overrides, code) => {
    await expect(new ModernMcpAppsClient(new FixtureTransport(overrides)).negotiate()).rejects.toMatchObject({ code });
  });

  it.each([
    ["wrong mime", { "resources/list": { resources: [{ uri: "ui://resume-builder/main", name: "bad", mimeType: "text/html", size: 4 }] } }, "resource_invalid"],
    ["oversized declaration", { "resources/list": { resources: [{ uri: "ui://resume-builder/main", name: "large", mimeType: MCP_APP_MEDIA_TYPE, size: 2_097_153 }] } }, "resource_oversized"],
    ["malicious network content", { "resources/read": { contents: [{ uri: "ui://resume-builder/main", mimeType: MCP_APP_MEDIA_TYPE, text: safeHtml.replace("</main>", "<script>fetch('https://bad.invalid')</script></main>") }] } }, "resource_oversized"],
    ["missing resource", { "resources/list": { resources: [] } }, "resource_missing"],
  ])("fails safely for %s", async (_label, overrides, code) => {
    const client = new ModernMcpAppsClient(new FixtureTransport(overrides));
    const session = await client.negotiate();
    await expect(client.readAppResource(session, "ui://resume-builder/main", `sha256:${"b".repeat(64)}`)).rejects.toMatchObject({ code });
  });

  it("returns a complete unflattened tool result", async () => {
    const client = new ModernMcpAppsClient(new FixtureTransport());
    const session = await client.negotiate();
    const result = await client.callTool(session, "fixture.status", {}, "20000000-0000-4000-8000-000000000002");
    expect(result.content).toHaveLength(2);
    expect(result.structuredContent).toEqual({ ready: true });
    expect(result._meta).toEqual({ retained: true });
  });

  it("denies sandbox escape, external network, navigation, and missing-CSP HTML", () => {
    expect(() => validateSandboxHtml(safeHtml.replace("</main>", "<script>fetch('https://bad.invalid')</script></main>"))).toThrowError(expect.objectContaining({ code: "resource_invalid" }));
    expect(() => validateSandboxHtml(safeHtml.replace("</main>", "<form action='/escape'></form></main>"))).toThrowError(expect.objectContaining({ code: "resource_invalid" }));
    expect(() => validateSandboxHtml("<!doctype html><main>no policy</main>")).toThrowError(expect.objectContaining({ code: "resource_invalid" }));
  });
});
