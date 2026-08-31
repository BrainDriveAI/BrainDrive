import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  MCP_APPS_EXTENSION_ID,
  MCP_APPS_EXTENSION_VERSION,
  MCP_APP_MEDIA_TYPE,
  MCP_MODERN_PROTOCOL_VERSION,
} from "../../app-platform/contracts/constants.js";
import {
  McpConnectionManager,
  type McpConnectionIdentity,
  type McpPeer,
  type McpPeerNegotiation,
  type McpRequestOptions,
} from "./connection-manager.js";
import { McpHostError } from "./errors.js";

const digest = (value: string): `sha256:${string}` => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const packageDigest = `sha256:${"a".repeat(64)}` as const;
const uiText = "<!doctype html><main>fixture</main>";

function identity(generation = 1): McpConnectionIdentity {
  return {
    appId: "ai.braindrive.resume-builder",
    publisherId: "ai.braindrive",
    packageDigest,
    installationId: "22000000-0000-4000-8000-000000000001",
    runtimeId: `22000000-0000-4000-8000-${String(generation).padStart(12, "0")}`,
    serverId: "resume-builder",
    generation,
  };
}

function negotiation(overrides: Partial<McpPeerNegotiation> = {}): McpPeerNegotiation {
  return {
    protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
    era: "modern",
    serverInfo: { name: "fixture", version: "1.0.0" },
    capabilities: { tools: {}, resources: {}, extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MEDIA_TYPE] } } },
    discover: {
      supportedVersions: [MCP_MODERN_PROTOCOL_VERSION],
      capabilities: { tools: {}, resources: {}, extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MEDIA_TYPE] } } },
      _meta: {
        [MCP_APPS_EXTENSION_ID]: { version: MCP_APPS_EXTENSION_VERSION },
        "io.modelcontextprotocol/serverInfo": { name: "fixture", version: "1.0.0" },
      },
      resultType: "complete",
    },
    ...overrides,
  };
}

class FixturePeer implements McpPeer {
  connectCount = 0;
  closeCount = 0;
  listToolsCount = 0;
  callToolCount = 0;
  failConnectCount = 0;
  failDiscoveryCount = 0;
  callImpl?: (options: McpRequestOptions) => Promise<unknown>;

  constructor(public negotiated: McpPeerNegotiation = negotiation()) {}

  async connect(): Promise<McpPeerNegotiation> {
    this.connectCount += 1;
    if (this.failConnectCount-- > 0) throw new McpHostError("connection_unavailable", "Fixture connect failed", true);
    return this.negotiated;
  }

  async listTools(): Promise<unknown> {
    this.listToolsCount += 1;
    if (this.failDiscoveryCount-- > 0) throw new McpHostError("connection_unavailable", "Fixture discovery failed", true);
    return {
      tools: [
        { name: "shared.status", inputSchema: { type: "object" }, _meta: { ui: { visibility: ["model", "app"] } } },
        { name: "app.only", inputSchema: { type: "object" }, _meta: { ui: { visibility: ["app"], resourceUri: "ui://resume-builder/main" } } },
        { name: "model.only", inputSchema: { type: "object" }, _meta: { ui: { visibility: ["model"] } } },
      ],
      _meta: { catalogRevision: 4 },
    };
  }

  async listResources(): Promise<unknown> {
    return {
      resources: [{
        uri: "ui://resume-builder/main",
        name: "Resume Builder",
        mimeType: MCP_APP_MEDIA_TYPE,
        size: Buffer.byteLength(uiText),
        _meta: { integrity: digest(uiText), cachePolicy: "immutable_package_digest" },
      }],
      _meta: { catalogRevision: 5 },
    };
  }

  async listResourceTemplates(): Promise<unknown> {
    return {
      resourceTemplates: [{ uriTemplate: "ui://resume-builder/{view}", name: "Resume view", mimeType: MCP_APP_MEDIA_TYPE }],
      _meta: { catalogRevision: 6 },
    };
  }

  async readResource(): Promise<unknown> {
    return {
      contents: [{ uri: "ui://resume-builder/main", mimeType: MCP_APP_MEDIA_TYPE, text: uiText, _meta: { cachePolicy: "immutable_package_digest" } }],
      _meta: { readRevision: 1 },
    };
  }

  async callTool(_params: { name: string; arguments: Record<string, unknown> }, options: McpRequestOptions): Promise<unknown> {
    this.callToolCount += 1;
    if (this.callImpl) return this.callImpl(options);
    options.onProgress?.({ progress: 1, total: 1, message: "done" });
    return {
      content: [{ type: "text", text: "ready" }, { type: "resource_link", name: "ui", uri: "ui://resume-builder/main" }],
      structuredContent: { ready: true },
      _meta: { retained: true },
      isError: false,
    };
  }

  async close(): Promise<void> { this.closeCount += 1; }
}

describe("Milestone 2 negotiated persistent connection manager", () => {
  it("negotiates before discovery, reuses matching generations, and closes stale generations", async () => {
    const peers: FixturePeer[] = [];
    const manager = new McpConnectionManager({ peerFactory: () => { const peer = new FixturePeer(); peers.push(peer); return peer; } });

    const first = await manager.connect(identity(1));
    expect(first.state).toBe("ready");
    expect(peers[0]!.listToolsCount).toBe(0);
    expect((await manager.connect(identity(1))).connectionId).toBe(first.connectionId);
    expect(peers).toHaveLength(1);

    const catalogs = await manager.discover(first);
    expect(catalogs.tools).toHaveLength(3);
    expect(peers[0]!.listToolsCount).toBe(1);

    const second = await manager.connect(identity(2));
    expect(second.connectionId).not.toBe(first.connectionId);
    expect(peers[0]!.closeCount).toBe(1);
    await expect(manager.discover(first)).rejects.toMatchObject({ code: "connection_stale" });
    await manager.close(second);
    expect(peers[1]!.closeCount).toBe(1);
  });

  it.each([
    ["legacy era", negotiation({ protocolVersion: "2025-11-25", era: "legacy" }), "protocol_incompatible"],
    ["missing resources", negotiation({ capabilities: { tools: {} }, discover: { ...negotiation().discover, capabilities: { tools: {} } } }), "protocol_incompatible"],
    ["wrong Apps media type", negotiation({ discover: { ...negotiation().discover, capabilities: { tools: {}, resources: {}, extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: ["text/html"] } } } } }), "extension_incompatible"],
    ["missing Apps extension", negotiation({ discover: { ...negotiation().discover, _meta: {} } }), "extension_incompatible"],
  ])("rejects %s without partial catalog registration", async (_label, peerNegotiation, code) => {
    const peer = new FixturePeer(peerNegotiation);
    const manager = new McpConnectionManager({ peerFactory: () => peer });
    await expect(manager.connect(identity())).rejects.toMatchObject({ code });
    expect(peer.listToolsCount).toBe(0);
    expect(peer.closeCount).toBe(1);
    expect(manager.connectionCount).toBe(0);
  });

  it("normalizes complete catalogs, exact visibility, and same-server calls", async () => {
    const peer = new FixturePeer();
    const manager = new McpConnectionManager({ peerFactory: () => peer });
    const connection = await manager.connect(identity());
    const catalogs = await manager.discover(connection);

    expect(catalogs.tools.map((tool) => [tool.name, tool.visibility])).toEqual([
      ["shared.status", ["model", "app"]],
      ["app.only", ["app"]],
      ["model.only", ["model"]],
    ]);
    expect(catalogs.resourceTemplates[0]).toMatchObject({ uriTemplate: "ui://resume-builder/{view}" });
    expect(catalogs.envelopes.tools).toMatchObject({ _meta: { catalogRevision: 4 } });
    expect(catalogs.envelopes.resources).toMatchObject({ _meta: { catalogRevision: 5 } });

    await expect(manager.callTool(connection, {
      serverConnectionId: connection.connectionId,
      toolName: "app.only",
      arguments: {},
      consumer: "model",
      operationId: "22000000-0000-4000-8000-000000000010",
    })).rejects.toMatchObject({ code: "visibility_denied" });
    await expect(manager.callTool(connection, {
      serverConnectionId: "22000000-0000-4000-8000-000000000099",
      toolName: "app.only",
      arguments: {},
      consumer: "app",
      operationId: "22000000-0000-4000-8000-000000000011",
    })).rejects.toMatchObject({ code: "cross_server_denied" });

    const progress = vi.fn();
    const result = await manager.callTool(connection, {
      serverConnectionId: connection.connectionId,
      toolName: "app.only",
      arguments: {},
      consumer: "app",
      operationId: "22000000-0000-4000-8000-000000000012",
      progressToken: "progress-12",
      onProgress: progress,
    });
    expect(result.content).toHaveLength(2);
    expect(result.structuredContent).toEqual({ ready: true });
    expect(result.projections.model_visible_content_indices).toEqual([]);
    expect(progress).toHaveBeenCalledWith({ progress: 1, total: 1, message: "done" });
  });

  it("validates ui resources, integrity, size, MIME, cache identity, and same connection", async () => {
    const peer = new FixturePeer();
    const manager = new McpConnectionManager({ peerFactory: () => peer });
    const connection = await manager.connect(identity());
    await manager.discover(connection);

    const loaded = await manager.readResource(connection, {
      serverConnectionId: connection.connectionId,
      uri: "ui://resume-builder/main",
      packageDigest,
      mimeType: MCP_APP_MEDIA_TYPE,
      expectedContentDigest: digest(uiText),
    });
    expect(loaded).toMatchObject({
      uri: "ui://resume-builder/main",
      mimeType: MCP_APP_MEDIA_TYPE,
      contentDigest: digest(uiText),
      cachePolicy: "immutable_package_digest",
      text: uiText,
    });
    expect((await manager.readResource(connection, {
      serverConnectionId: connection.connectionId,
      uri: "ui://resume-builder/main",
      packageDigest,
      mimeType: MCP_APP_MEDIA_TYPE,
      expectedContentDigest: digest(uiText),
    })).cacheHit).toBe(true);

    await expect(manager.readResource(connection, {
      serverConnectionId: connection.connectionId,
      uri: "ui://../escape",
      packageDigest,
      mimeType: MCP_APP_MEDIA_TYPE,
    })).rejects.toMatchObject({ code: "resource_uri_invalid" });
    await expect(manager.readResource(connection, {
      serverConnectionId: connection.connectionId,
      uri: "ui://resume-builder/main",
      packageDigest,
      mimeType: "text/html",
    })).rejects.toMatchObject({ code: "resource_mime_invalid" });
    await expect(manager.readResource(connection, {
      serverConnectionId: connection.connectionId,
      uri: "ui://resume-builder/main",
      packageDigest,
      mimeType: MCP_APP_MEDIA_TYPE,
      expectedContentDigest: `sha256:${"b".repeat(64)}`,
    })).rejects.toMatchObject({ code: "resource_integrity_mismatch" });

    peer.readResource = async () => ({ contents: [{ uri: "ui://resume-builder/main", mimeType: MCP_APP_MEDIA_TYPE, text: "x".repeat(2_097_153) }] });
    manager.invalidateResourceCache({ packageDigest, connectionGeneration: connection.generation });
    await expect(manager.readResource(connection, {
      serverConnectionId: connection.connectionId,
      uri: "ui://resume-builder/main",
      packageDigest,
      mimeType: MCP_APP_MEDIA_TYPE,
    })).rejects.toMatchObject({ code: "resource_oversized" });
  });

  it("bounds read-only reconnect but never replays an ambiguous tool call", async () => {
    const peers: FixturePeer[] = [];
    const manager = new McpConnectionManager({
      maxReadOnlyRetries: 1,
      peerFactory: () => {
        const peer = new FixturePeer();
        if (peers.length === 0) peer.failDiscoveryCount = 1;
        peers.push(peer);
        return peer;
      },
    });
    const connection = await manager.connect(identity());
    const catalogs = await manager.discover(connection);
    expect(catalogs.tools).toHaveLength(3);
    expect(peers).toHaveLength(2);
    expect(peers[0]!.closeCount).toBe(1);

    peers[1]!.callImpl = async () => { throw new McpHostError("connection_unavailable", "Disconnected after send", true); };
    await expect(manager.callTool(connection, {
      serverConnectionId: connection.connectionId,
      toolName: "shared.status",
      arguments: {},
      consumer: "model",
      operationId: "22000000-0000-4000-8000-000000000020",
    })).rejects.toMatchObject({ code: "ambiguous_tool_outcome", retryable: false });
    expect(peers[1]!.callToolCount).toBe(1);
  });

  it("propagates cancellation, rejects duplicate operations, and discards late results after close", async () => {
    const peer = new FixturePeer();
    let resolveLate!: (value: unknown) => void;
    peer.callImpl = (options) => new Promise((resolve, reject) => {
      resolveLate = resolve;
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    const manager = new McpConnectionManager({ peerFactory: () => peer });
    const connection = await manager.connect(identity());
    await manager.discover(connection);
    const operationId = "22000000-0000-4000-8000-000000000030";
    const pending = manager.callTool(connection, {
      serverConnectionId: connection.connectionId,
      toolName: "shared.status",
      arguments: {},
      consumer: "model",
      operationId,
    });
    await expect(manager.callTool(connection, {
      serverConnectionId: connection.connectionId,
      toolName: "shared.status",
      arguments: {},
      consumer: "model",
      operationId,
    })).rejects.toMatchObject({ code: "duplicate_request" });
    expect(manager.cancel(operationId)).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "request_cancelled" });

    peer.callImpl = () => new Promise((resolve) => { resolveLate = resolve; });
    const late = manager.callTool(connection, {
      serverConnectionId: connection.connectionId,
      toolName: "shared.status",
      arguments: {},
      consumer: "model",
      operationId: "22000000-0000-4000-8000-000000000031",
    });
    await manager.close(connection);
    resolveLate({ content: [{ type: "text", text: "too late" }], isError: false });
    await expect(late).rejects.toMatchObject({ code: "late_response" });
    expect(manager.connectionCount).toBe(0);
  });
});
