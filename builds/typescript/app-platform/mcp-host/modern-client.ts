import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  MCP_APPS_EXTENSION_ID,
  MCP_APPS_EXTENSION_VERSION,
  MCP_APP_MEDIA_TYPE,
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSION,
  CONTRACT_SIZE_LIMITS,
} from "../contracts/constants.js";
import { McpAppResourceSchema } from "../contracts/mcp-app.js";
import type { AppRuntimeConnection } from "../lifecycle/process-supervisor.js";
import { AppPlatformError } from "../lifecycle/errors.js";
import { preserveMcpResult, type CompleteMcpResult, type RawMcpCallResult } from "../../mcp/result-envelope.js";

const InitializeResultSchema = z.object({
  protocolVersion: z.string(),
  capabilities: z.object({ tools: z.record(z.string(), z.unknown()).optional(), resources: z.record(z.string(), z.unknown()).optional() }).passthrough(),
  serverInfo: z.object({ name: z.string().min(1), version: z.string().min(1) }).strict(),
  _meta: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const ResourceListSchema = z.object({
  resources: z.array(z.object({
    uri: z.string(),
    name: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }).passthrough()).max(1_000),
}).passthrough();

const ResourceReadSchema = z.object({
  contents: z.array(z.object({
    uri: z.string(),
    mimeType: z.string().optional(),
    text: z.string().optional(),
    blob: z.string().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }).passthrough()).min(1).max(16),
}).passthrough();

const ToolListSchema = z.object({
  tools: z.array(z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()).optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }).passthrough()).max(1_000),
}).passthrough();

export type ModernMcpTool = z.infer<typeof ToolListSchema>["tools"][number];
export type LoadedAppResource = {
  resource: z.infer<typeof McpAppResourceSchema>;
  envelope: {
    descriptor: z.infer<typeof ResourceListSchema>["resources"][number];
    read: z.infer<typeof ResourceReadSchema>;
  };
};
export type ModernMcpSession = {
  connectionId: string;
  protocolVersion: typeof MCP_MODERN_PROTOCOL_VERSION;
  extensionVersion: typeof MCP_APPS_EXTENSION_VERSION;
  serverName: string;
  serverVersion: string;
  resources: z.infer<typeof ResourceListSchema>["resources"];
  tools: ModernMcpTool[];
  initializeEnvelope: z.infer<typeof InitializeResultSchema>;
  resourceListEnvelope: z.infer<typeof ResourceListSchema>;
  toolListEnvelope: z.infer<typeof ToolListSchema>;
};

export interface McpWireTransport {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export class HttpMcpWireTransport implements McpWireTransport {
  private nextRequestId = 1;

  constructor(private readonly connection: AppRuntimeConnection, private readonly timeoutMs = 10_000) {}

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(this.connection.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.connection.authorization}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextRequestId++, method, ...(params ? { params } : {}) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > CONTRACT_SIZE_LIMITS.authorityEnvelopeBytes) {
      throw new AppPlatformError("resource_oversized", "MCP response exceeds the accepted envelope limit");
    }
    if (!response.ok) throw new AppPlatformError("lifecycle_failed", "Installed app MCP request failed", 502);
    let payload: { result?: unknown; error?: { code?: unknown; message?: unknown } };
    try { payload = JSON.parse(text) as typeof payload; }
    catch { throw new AppPlatformError("resource_invalid", "Installed app returned malformed MCP JSON", 502); }
    if (payload.error) throw new AppPlatformError("resource_missing", "Installed app MCP method or resource is unavailable", 404);
    return payload.result;
  }
}

export class ModernMcpAppsClient {
  constructor(private readonly transport: McpWireTransport) {}

  async negotiate(): Promise<ModernMcpSession> {
    const initializedResult = InitializeResultSchema.safeParse(await this.transport.request("initialize", {
      protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "braindrive-app-host", version: "1.0.0" },
      _meta: { [MCP_APPS_EXTENSION_ID]: { version: MCP_APPS_EXTENSION_VERSION } },
    }));
    if (!initializedResult.success) throw new AppPlatformError("protocol_incompatible", "Installed app returned an invalid initialization envelope");
    const initialized = initializedResult.data;
    if (initialized.protocolVersion === MCP_LEGACY_PROTOCOL_VERSION) {
      throw new AppPlatformError("protocol_incompatible", "Legacy MCP servers cannot launch interactive Apps");
    }
    if (initialized.protocolVersion !== MCP_MODERN_PROTOCOL_VERSION || !initialized.capabilities.resources || !initialized.capabilities.tools) {
      throw new AppPlatformError("protocol_incompatible", "Installed app MCP protocol or capabilities are incompatible");
    }
    const extension = initialized._meta?.[MCP_APPS_EXTENSION_ID] as { version?: unknown } | undefined;
    if (extension?.version !== MCP_APPS_EXTENSION_VERSION) {
      throw new AppPlatformError("extension_incompatible", "Installed app UI extension is incompatible");
    }
    const listedResourcesResult = ResourceListSchema.safeParse(await this.transport.request("resources/list"));
    if (!listedResourcesResult.success) throw new AppPlatformError("resource_invalid", "Installed app returned an invalid resource list");
    const listedToolsResult = ToolListSchema.safeParse(await this.transport.request("tools/list"));
    if (!listedToolsResult.success) throw new AppPlatformError("protocol_incompatible", "Installed app returned an invalid tool list");
    const listedResources = listedResourcesResult.data;
    const listedTools = listedToolsResult.data;
    return {
      connectionId: randomUUID(),
      protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
      extensionVersion: MCP_APPS_EXTENSION_VERSION,
      serverName: initialized.serverInfo.name,
      serverVersion: initialized.serverInfo.version,
      resources: listedResources.resources,
      tools: listedTools.tools,
      initializeEnvelope: initialized,
      resourceListEnvelope: listedResources,
      toolListEnvelope: listedTools,
    };
  }

  async readAppResource(session: ModernMcpSession, uri: string, packageDigest: `sha256:${string}`): Promise<LoadedAppResource> {
    const descriptor = session.resources.find((resource) => resource.uri === uri);
    if (!descriptor) throw new AppPlatformError("resource_missing", "Declared app UI resource is unavailable", 404);
    if (descriptor.uri !== uri || !uri.startsWith("ui://") || descriptor.mimeType !== MCP_APP_MEDIA_TYPE) {
      throw new AppPlatformError("resource_invalid", "App UI resource declaration is incompatible");
    }
    if ((descriptor.size ?? 0) > CONTRACT_SIZE_LIMITS.resourceBytes) {
      throw new AppPlatformError("resource_oversized", "App UI resource exceeds the accepted byte limit");
    }
    const readResult = ResourceReadSchema.safeParse(await this.transport.request("resources/read", { uri }));
    if (!readResult.success) throw new AppPlatformError("resource_invalid", "Installed app returned an invalid resource envelope");
    const read = readResult.data;
    const exact = read.contents.filter((content) => content.uri === uri);
    if (exact.length !== 1 || exact[0]!.mimeType !== MCP_APP_MEDIA_TYPE || typeof exact[0]!.text !== "string" || exact[0]!.blob !== undefined) {
      throw new AppPlatformError("resource_invalid", "App UI resource response is missing or ambiguous");
    }
    const html = exact[0]!.text;
    const sizeBytes = Buffer.byteLength(html, "utf8");
    if (sizeBytes === 0 || sizeBytes > CONTRACT_SIZE_LIMITS.resourceBytes || (descriptor.size !== undefined && descriptor.size !== sizeBytes)) {
      throw new AppPlatformError("resource_oversized", "App UI resource size does not match its declaration");
    }
    validateSandboxHtml(html);
    const resource = McpAppResourceSchema.parse({
      resource_version: 1,
      app_id: "ai.braindrive.resume-builder",
      package_digest: packageDigest,
      uri,
      mime_type: MCP_APP_MEDIA_TYPE,
      extension: { id: MCP_APPS_EXTENSION_ID, version: MCP_APPS_EXTENSION_VERSION },
      content_digest: `sha256:${createHash("sha256").update(html).digest("hex")}`,
      size_bytes: sizeBytes,
      cache_policy: exact[0]!._meta?.cachePolicy === "no_store" ? "no_store" : "immutable_package_digest",
      html,
    });
    return { resource, envelope: { descriptor, read } };
  }

  async callTool(session: ModernMcpSession, toolName: string, args: Record<string, unknown>, operationId: string): Promise<CompleteMcpResult> {
    const raw = await this.transport.request("tools/call", { name: toolName, arguments: args }) as RawMcpCallResult;
    return preserveMcpResult(raw, {
      protocolVersion: session.protocolVersion,
      connectionId: session.connectionId,
      requestId: randomUUID(),
      operationId,
    });
  }
}

export function appVisibleToolNames(tools: ModernMcpTool[]): string[] {
  return tools.filter((tool) => {
    const ui = tool._meta?.[MCP_APPS_EXTENSION_ID] as { visibility?: unknown } | undefined;
    return Array.isArray(ui?.visibility) && ui.visibility.includes("app");
  }).map((tool) => tool.name);
}

export function validateSandboxHtml(html: string): void {
  const cspTag = /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i.exec(html)?.[0] ?? "";
  const requiredCsp = cspTag.includes("default-src 'none'") && cspTag.includes("connect-src 'none'") && cspTag.includes("form-action 'none'");
  const prohibited = /<(?:base|iframe|frame|object|embed|form)\b|\b(?:https?:|file:|tauri:|javascript:)|\b(?:window\.open|location\s*=|location\.(?:assign|replace)|fetch\s*\(|XMLHttpRequest|WebSocket)\b|\bdownload\b/i;
  if (!requiredCsp || prohibited.test(html)) {
    throw new AppPlatformError("resource_invalid", "App UI resource violates the sandbox content policy");
  }
}
