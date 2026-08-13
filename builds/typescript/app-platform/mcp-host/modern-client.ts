import { z } from "zod";

import {
  CONTRACT_SIZE_LIMITS,
  MCP_APPS_EXTENSION_ID,
  MCP_APPS_EXTENSION_VERSION,
  MCP_APP_MEDIA_TYPE,
  MCP_MODERN_PROTOCOL_VERSION,
} from "../contracts/constants.js";
import { McpAppResourceSchema } from "../contracts/mcp-app.js";
import type { AppRuntimeConnection } from "../lifecycle/process-supervisor.js";
import { AppPlatformError } from "../lifecycle/errors.js";
import type { CompleteMcpResult } from "../../mcp/result-envelope.js";
import {
  McpConnectionManager,
  type McpCatalogResource,
  type McpCatalogs,
  type McpCatalogTool,
  type McpConnectionHandle,
  type McpConnectionIdentity,
  type McpPeer,
  type McpPeerNegotiation,
  type McpRequestOptions,
} from "../../mcp/host/connection-manager.js";
import { McpHostError } from "../../mcp/host/errors.js";

export type ModernMcpTool = McpCatalogTool;
export type LoadedAppResource = {
  resource: z.infer<typeof McpAppResourceSchema>;
  envelope: { descriptor: McpCatalogResource; read: unknown };
};
export type ModernMcpSession = {
  connectionId: string;
  protocolVersion: typeof MCP_MODERN_PROTOCOL_VERSION;
  extensionVersion: typeof MCP_APPS_EXTENSION_VERSION;
  serverName: string;
  serverVersion: string;
  resources: McpCatalogResource[];
  resourceTemplates: McpCatalogs["resourceTemplates"];
  tools: ModernMcpTool[];
  discoverEnvelope: McpConnectionHandle["negotiated"];
  resourceListEnvelope: unknown;
  resourceTemplateListEnvelope: unknown;
  toolListEnvelope: unknown;
  handle: McpConnectionHandle;
};

export interface McpWireTransport {
  request(method: string, params?: Record<string, unknown>, options?: McpRequestOptions): Promise<unknown>;
  close?(): Promise<void>;
}

/** Test seam for deterministic JSON-RPC peers; production uses the official SDK peer. */
export class HttpMcpWireTransport implements McpWireTransport {
  private nextRequestId = 1;

  constructor(private readonly connection: AppRuntimeConnection, private readonly timeoutMs = 10_000) {}

  async request(method: string, params?: Record<string, unknown>, options?: McpRequestOptions): Promise<unknown> {
    const id = this.nextRequestId++;
    const response = await fetch(this.connection.url, {
      method: "POST",
      redirect: "manual",
      headers: { authorization: `Bearer ${this.connection.authorization}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
      signal: options?.signal ?? AbortSignal.timeout(this.timeoutMs),
    });
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      throw new McpHostError("resource_redirect_denied", "Installed app MCP redirects are not permitted");
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > CONTRACT_SIZE_LIMITS.authorityEnvelopeBytes) {
      throw new McpHostError("envelope_oversized", "MCP response exceeds the accepted envelope limit");
    }
    if (!response.ok) throw new McpHostError("connection_unavailable", "Installed app MCP request failed", true);
    let payload: { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } };
    try { payload = JSON.parse(text) as typeof payload; }
    catch { throw new McpHostError("envelope_malformed", "Installed app returned malformed MCP JSON"); }
    if (payload.jsonrpc !== "2.0" || payload.id !== id) throw new McpHostError("envelope_malformed", "Installed app returned a mismatched MCP response");
    if (payload.error) throw new McpHostError("connection_unavailable", "Installed app MCP method is unavailable", true);
    return payload.result;
  }
}

type ManagedClientSource = { manager: McpConnectionManager; identity: McpConnectionIdentity };

export class ModernMcpAppsClient {
  private readonly manager: McpConnectionManager;
  private readonly identity: McpConnectionIdentity;

  constructor(source: McpWireTransport | ManagedClientSource, identity?: McpConnectionIdentity) {
    if (isManagedSource(source)) {
      this.manager = source.manager;
      this.identity = source.identity;
      return;
    }
    this.identity = identity ?? fixtureIdentity();
    this.manager = new McpConnectionManager({
      peerFactory: () => new WireMcpPeer(source),
      maxReadOnlyRetries: 0,
    });
  }

  async negotiate(): Promise<ModernMcpSession> {
    try {
      const handle = await this.manager.connect(this.identity);
      const catalogs = await this.manager.discover(handle);
      return {
        connectionId: handle.connectionId,
        protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
        extensionVersion: MCP_APPS_EXTENSION_VERSION,
        serverName: handle.negotiated.server_name,
        serverVersion: handle.negotiated.server_version,
        resources: catalogs.resources,
        resourceTemplates: catalogs.resourceTemplates,
        tools: catalogs.tools,
        discoverEnvelope: handle.negotiated,
        resourceListEnvelope: catalogs.envelopes.resources,
        resourceTemplateListEnvelope: catalogs.envelopes.resourceTemplates,
        toolListEnvelope: catalogs.envelopes.tools,
        handle,
      };
    } catch (error) {
      throw toAppPlatformError(error);
    }
  }

  async readAppResource(session: ModernMcpSession, uri: string, packageDigest: `sha256:${string}`): Promise<LoadedAppResource> {
    try {
      const verified = await this.manager.readResource(session.handle, {
        serverConnectionId: session.connectionId,
        uri,
        packageDigest,
        mimeType: MCP_APP_MEDIA_TYPE,
      });
      if (typeof verified.text !== "string") {
        throw new McpHostError("resource_mime_invalid", "MCP App HTML resources must use text content");
      }
      validateSandboxHtml(verified.text);
      const resource = McpAppResourceSchema.parse({
        resource_version: 1,
        app_id: this.identity.appId,
        package_digest: packageDigest,
        uri,
        mime_type: MCP_APP_MEDIA_TYPE,
        extension: { id: MCP_APPS_EXTENSION_ID, version: MCP_APPS_EXTENSION_VERSION },
        content_digest: verified.contentDigest,
        size_bytes: verified.sizeBytes,
        cache_policy: verified.cachePolicy,
        html: verified.text,
      });
      return { resource, envelope: { descriptor: verified.descriptor, read: verified.envelope } };
    } catch (error) {
      throw toAppPlatformError(error);
    }
  }

  async callTool(session: ModernMcpSession, toolName: string, args: Record<string, unknown>, operationId: string): Promise<CompleteMcpResult> {
    try {
      return await this.manager.callTool(session.handle, {
        serverConnectionId: session.connectionId,
        toolName,
        arguments: args,
        consumer: "app",
        operationId,
      });
    } catch (error) {
      throw toAppPlatformError(error);
    }
  }

  cancel(operationId: string): boolean {
    return this.manager.cancel(operationId);
  }
}

export function identityForRuntime(connection: AppRuntimeConnection, app: { appId: string; publisherId: string; serverId: string }): McpConnectionIdentity {
  return {
    appId: app.appId,
    publisherId: app.publisherId,
    packageDigest: connection.runtime.package_digest as `sha256:${string}`,
    installationId: connection.runtime.installation_id,
    runtimeId: connection.runtime.runtime_id,
    serverId: app.serverId,
    generation: connection.runtime.runtime_generation,
  };
}

export function appVisibleToolNames(tools: ModernMcpTool[]): string[] {
  return tools.filter((tool) => tool.visibility.includes("app")).map((tool) => tool.name);
}

export function validateSandboxHtml(html: string): void {
  const cspTag = /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i.exec(html)?.[0] ?? "";
  const requiredCsp = cspTag.includes("default-src 'none'") && cspTag.includes("connect-src 'none'") && cspTag.includes("form-action 'none'");
  const prohibited = /<(?:base|iframe|frame|object|embed|form)\b|\b(?:https?:|file:|tauri:|javascript:)|\b(?:window\.open|location\s*=|location\.(?:assign|replace)|fetch\s*\(|XMLHttpRequest|WebSocket)\b|\bdownload\b/i;
  if (!requiredCsp || prohibited.test(html)) {
    throw new AppPlatformError("resource_invalid", "App UI resource violates the sandbox content policy");
  }
}

class WireMcpPeer implements McpPeer {
  constructor(private readonly transport: McpWireTransport) {}

  async connect(options: McpRequestOptions): Promise<McpPeerNegotiation> {
    const discover = await this.transport.request("server/discover", {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": MCP_MODERN_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientInfo": { name: "braindrive-app-host", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {
          extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MEDIA_TYPE] } },
        },
      },
    }, options) as McpPeerNegotiation["discover"];
    const serverInfo = discover?._meta?.["io.modelcontextprotocol/serverInfo"];
    return {
      protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
      era: "modern",
      capabilities: isRecord(discover?.capabilities) ? discover.capabilities : {},
      ...(isServerInfo(serverInfo) ? { serverInfo } : {}),
      discover,
    };
  }

  listTools(options: McpRequestOptions): Promise<unknown> { return this.transport.request("tools/list", undefined, options); }
  listResources(options: McpRequestOptions): Promise<unknown> { return this.transport.request("resources/list", undefined, options); }
  listResourceTemplates(options: McpRequestOptions): Promise<unknown> { return this.transport.request("resources/templates/list", undefined, options); }
  readResource(params: { uri: string }, options: McpRequestOptions): Promise<unknown> { return this.transport.request("resources/read", params, options); }
  callTool(params: { name: string; arguments: Record<string, unknown> }, options: McpRequestOptions): Promise<unknown> { return this.transport.request("tools/call", params, options); }
  async close(): Promise<void> { await this.transport.close?.(); }
}

function fixtureIdentity(): McpConnectionIdentity {
  return {
    appId: "ai.braindrive.synthetic-fixture",
    publisherId: "ai.braindrive",
    packageDigest: `sha256:${"a".repeat(64)}`,
    installationId: "20000000-0000-4000-8000-000000000001",
    runtimeId: "20000000-0000-4000-8000-000000000002",
    serverId: "synthetic-fixture",
    generation: 1,
  };
}

function isManagedSource(source: McpWireTransport | ManagedClientSource): source is ManagedClientSource {
  return "manager" in source && "identity" in source;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isServerInfo(value: unknown): value is { name: string; version: string } {
  return isRecord(value) && typeof value.name === "string" && value.name.length > 0 && typeof value.version === "string" && value.version.length > 0;
}

function toAppPlatformError(error: unknown): AppPlatformError {
  if (error instanceof AppPlatformError) return error;
  if (!(error instanceof McpHostError)) return new AppPlatformError("lifecycle_failed", "Installed app MCP operation failed", 502);
  if (error.code === "protocol_incompatible" || error.code === "extension_incompatible") {
    return new AppPlatformError(error.code, error.message, 409);
  }
  if (error.code === "resource_not_found") return new AppPlatformError("resource_missing", error.message, 404);
  if (error.code === "resource_oversized" || error.code === "envelope_oversized") return new AppPlatformError("resource_oversized", error.message, 413);
  if (error.code.startsWith("resource_") || error.code === "catalog_invalid" || error.code === "envelope_malformed") {
    return new AppPlatformError("resource_invalid", error.message, 409);
  }
  if (error.code === "request_cancelled") return new AppPlatformError("operation_cancelled", error.message, 409);
  return new AppPlatformError("lifecycle_failed", "Installed app server could not complete the declared operation", 502);
}
