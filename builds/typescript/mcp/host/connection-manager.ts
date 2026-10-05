import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  CONTRACT_SIZE_LIMITS,
  MCP_APPS_EXTENSION_ID,
  MCP_APPS_EXTENSION_VERSION,
  MCP_APP_MEDIA_TYPE,
  MCP_MODERN_PROTOCOL_VERSION,
} from "../../app-platform/contracts/constants.js";
import { encodedByteLength } from "../../app-platform/contracts/common.js";
import {
  McpNegotiatedPeerSchema,
  SPEC_05_SUPPORT_PROFILES,
} from "../../app-platform/contracts/spec-05-foundation.js";
import {
  preserveMcpResult,
  type CompleteMcpResult,
  type McpResultConsumer,
  type McpToolVisibility,
  type RawMcpCallResult,
} from "../result-envelope.js";
import { asMcpHostError, isAbortError, McpHostError } from "./errors.js";

const UiResourceUriSchema = z.string()
  .regex(/^ui:\/\/[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/)
  .max(2_048)
  .refine((value) => {
    const path = value.slice("ui://".length);
    return !path.includes("\\") && !path.includes("//") && !/(?:^|\/)\.\.(?:\/|$)/.test(path) && !/%2e|%2f|%5c/i.test(path);
  });

const MetaSchema = z.record(z.string(), z.unknown());
const ToolSchema = z.object({
  name: z.string().min(1).max(256),
  title: z.string().max(512).optional(),
  description: z.string().max(2_048).optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  annotations: z.record(z.string(), z.unknown()).optional(),
  icons: z.array(z.record(z.string(), z.unknown())).max(16).optional(),
  execution: z.record(z.string(), z.unknown()).optional(),
  _meta: MetaSchema.optional(),
}).passthrough();
const ToolListSchema = z.object({
  tools: z.array(ToolSchema).max(CONTRACT_SIZE_LIMITS.maxArrayItems),
  nextCursor: z.string().max(2_048).optional(),
  ttlMs: z.number().nonnegative().optional(),
  cacheScope: z.enum(["private", "public"]).optional(),
  _meta: MetaSchema.optional(),
}).passthrough();

const ResourceSchema = z.object({
  uri: z.string().min(1).max(2_048),
  name: z.string().min(1).max(512),
  title: z.string().max(512).optional(),
  description: z.string().max(2_048).optional(),
  mimeType: z.string().min(1).max(256).optional(),
  size: z.number().int().nonnegative().max(CONTRACT_SIZE_LIMITS.resourceBytes).optional(),
  annotations: z.record(z.string(), z.unknown()).optional(),
  icons: z.array(z.record(z.string(), z.unknown())).max(16).optional(),
  _meta: MetaSchema.optional(),
}).passthrough();
const ResourceListSchema = z.object({
  resources: z.array(ResourceSchema).max(CONTRACT_SIZE_LIMITS.maxArrayItems),
  nextCursor: z.string().max(2_048).optional(),
  ttlMs: z.number().nonnegative().optional(),
  cacheScope: z.enum(["private", "public"]).optional(),
  _meta: MetaSchema.optional(),
}).passthrough();

const ResourceTemplateSchema = z.object({
  uriTemplate: z.string().min(1).max(2_048),
  name: z.string().min(1).max(512),
  title: z.string().max(512).optional(),
  description: z.string().max(2_048).optional(),
  mimeType: z.string().min(1).max(256).optional(),
  annotations: z.record(z.string(), z.unknown()).optional(),
  icons: z.array(z.record(z.string(), z.unknown())).max(16).optional(),
  _meta: MetaSchema.optional(),
}).passthrough();
const ResourceTemplateListSchema = z.object({
  resourceTemplates: z.array(ResourceTemplateSchema).max(CONTRACT_SIZE_LIMITS.maxArrayItems),
  nextCursor: z.string().max(2_048).optional(),
  ttlMs: z.number().nonnegative().optional(),
  cacheScope: z.enum(["private", "public"]).optional(),
  _meta: MetaSchema.optional(),
}).passthrough();

const ResourceContentSchema = z.object({
  uri: z.string().min(1).max(2_048),
  mimeType: z.string().min(1).max(256).optional(),
  text: z.string().optional(),
  blob: z.string().optional(),
  _meta: MetaSchema.optional(),
}).passthrough().superRefine((value, context) => {
  if ((value.text === undefined) === (value.blob === undefined)) {
    context.addIssue({ code: "custom", message: "resource content requires exactly one of text or blob" });
  }
});
const ResourceReadSchema = z.object({
  contents: z.array(ResourceContentSchema).min(1).max(16),
  ttlMs: z.number().nonnegative().optional(),
  cacheScope: z.enum(["private", "public"]).optional(),
  _meta: MetaSchema.optional(),
}).passthrough();

export type McpConnectionState =
  | "disconnected"
  | "connecting"
  | "negotiating"
  | "ready"
  | "reconnecting"
  | "failed_recoverable"
  | "closing"
  | "closed";

export type McpConnectionIdentity = {
  appId: string;
  publisherId: string;
  packageDigest: `sha256:${string}`;
  installationId: string;
  runtimeId: string;
  serverId: string;
  generation: number;
};

export type McpPeerNegotiation = {
  protocolVersion: string;
  era: "modern" | "legacy";
  serverInfo?: { name: string; version: string };
  capabilities: Record<string, unknown>;
  discover?: {
    supportedVersions?: unknown;
    capabilities?: unknown;
    _meta?: Record<string, unknown>;
    resultType?: unknown;
    [key: string]: unknown;
  };
};

export type McpRequestOptions = {
  signal?: AbortSignal;
  timeoutMs: number;
  onProgress?: (progress: { progress: number; total?: number; message?: string }) => void;
};

export interface McpPeer {
  connect(options: McpRequestOptions): Promise<McpPeerNegotiation>;
  listTools(options: McpRequestOptions): Promise<unknown>;
  listResources(options: McpRequestOptions): Promise<unknown>;
  listResourceTemplates(options: McpRequestOptions): Promise<unknown>;
  readResource(params: { uri: string }, options: McpRequestOptions): Promise<unknown>;
  callTool(params: { name: string; arguments: Record<string, unknown> }, options: McpRequestOptions): Promise<unknown>;
  close(): Promise<void>;
}

export type McpConnectionHandle = {
  connectionId: string;
  generation: number;
  state: "ready";
  identity: McpConnectionIdentity;
  negotiated: z.infer<typeof McpNegotiatedPeerSchema>;
};

export type McpCatalogTool = z.infer<typeof ToolSchema> & {
  connectionId: string;
  visibility: McpToolVisibility[];
  resourceUri?: string;
};
export type McpCatalogResource = z.infer<typeof ResourceSchema> & { connectionId: string };
export type McpCatalogResourceTemplate = z.infer<typeof ResourceTemplateSchema> & { connectionId: string };
export type McpCatalogs = {
  generation: number;
  tools: McpCatalogTool[];
  resources: McpCatalogResource[];
  resourceTemplates: McpCatalogResourceTemplate[];
  envelopes: { tools: unknown; resources: unknown; resourceTemplates: unknown };
};

export type VerifiedMcpResource = {
  connectionId: string;
  connectionGeneration: number;
  packageDigest: `sha256:${string}`;
  uri: string;
  mimeType: string;
  contentDigest: `sha256:${string}`;
  sizeBytes: number;
  cachePolicy: "immutable_package_digest" | "no_store";
  cacheHit: boolean;
  text?: string;
  blob?: string;
  descriptor: McpCatalogResource;
  envelope: unknown;
};

type ConnectionRecord = {
  key: string;
  identity: McpConnectionIdentity;
  connectionId: string;
  state: McpConnectionState;
  peer: McpPeer;
  negotiated?: z.infer<typeof McpNegotiatedPeerSchema>;
  catalogs?: McpCatalogs;
  catalogGeneration: number;
  reconnectAttempts: number;
  pending: Map<string, AbortController>;
};

type ManagerOptions = {
  peerFactory: (identity: McpConnectionIdentity) => McpPeer;
  timeoutMs?: number;
  maxReadOnlyRetries?: number;
  idFactory?: () => string;
  now?: () => Date;
  audit?: (event: string, details: Record<string, unknown>) => void;
};

export class McpConnectionManager {
  private readonly records = new Map<string, ConnectionRecord>();
  private readonly connecting = new Map<string, Promise<McpConnectionHandle>>();
  private readonly pendingOperations = new Map<string, { record: ConnectionRecord; controller: AbortController }>();
  private readonly resourceCache = new Map<string, VerifiedMcpResource>();
  private readonly timeoutMs: number;
  private readonly maxReadOnlyRetries: number;
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly audit: NonNullable<ManagerOptions["audit"]>;

  constructor(private readonly options: ManagerOptions) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxReadOnlyRetries = options.maxReadOnlyRetries ?? 1;
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.audit = options.audit ?? (() => undefined);
  }

  get connectionCount(): number { return this.records.size; }

  async connect(identity: McpConnectionIdentity): Promise<McpConnectionHandle> {
    validateIdentity(identity);
    const key = connectionKey(identity);
    const existing = this.records.get(key);
    if (existing) {
      if (existing.identity.generation > identity.generation) {
        throw new McpHostError("connection_stale", "Requested MCP connection generation is stale");
      }
      if (existing.identity.generation === identity.generation) {
        if (sameConnectionAuthority(existing.identity, identity)) {
          if (existing.state === "ready" && existing.negotiated) return snapshot(existing);
          const pending = this.connecting.get(key);
          if (pending) return pending;
        } else {
          await this.closeRecord(existing);
        }
      } else {
        await this.closeRecord(existing);
      }
    }

    const pending = this.establish(identity, key);
    this.connecting.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.connecting.get(key) === pending) this.connecting.delete(key);
    }
  }

  async discover(handle: McpConnectionHandle): Promise<McpCatalogs> {
    const record = this.requireRecord(handle);
    if (record.catalogs) return record.catalogs;
    const catalogs = await this.runReadOnly(record, "catalog", async (active) => {
      const requestOptions = this.requestOptions();
      const [toolsRaw, resourcesRaw, templatesRaw] = await Promise.all([
        catalogRequest(active.peer.listTools(requestOptions), "tool"),
        catalogRequest(active.peer.listResources(requestOptions), "resource"),
        catalogRequest(active.peer.listResourceTemplates(requestOptions), "resource template"),
      ]);
      assertIngressBounds(toolsRaw, "catalog_invalid");
      assertIngressBounds(resourcesRaw, "catalog_invalid");
      assertIngressBounds(templatesRaw, "catalog_invalid");
      const toolList = parseOrThrow(ToolListSchema, toolsRaw, "catalog_invalid", "MCP tool catalog is malformed");
      const resourceList = parseOrThrow(ResourceListSchema, resourcesRaw, "catalog_invalid", "MCP resource catalog is malformed");
      const templateList = parseOrThrow(ResourceTemplateListSchema, templatesRaw, "catalog_invalid", "MCP resource template catalog is malformed");
      const tools = normalizeTools(toolList.tools, active.connectionId);
      const resources = normalizeResources(resourceList.resources, active.connectionId);
      const resourceTemplates = normalizeResourceTemplates(templateList.resourceTemplates, active.connectionId);
      active.catalogGeneration += 1;
      return {
        generation: active.catalogGeneration,
        tools,
        resources,
        resourceTemplates,
        envelopes: { tools: toolsRaw, resources: resourcesRaw, resourceTemplates: templatesRaw },
      } satisfies McpCatalogs;
    });
    record.catalogs = catalogs;
    this.audit("mcp.connection.catalog", {
      connection_id: record.connectionId,
      connection_generation: record.identity.generation,
      tool_count: catalogs.tools.length,
      resource_count: catalogs.resources.length,
      template_count: catalogs.resourceTemplates.length,
      outcome: "completed",
    });
    return catalogs;
  }

  async callTool(handle: McpConnectionHandle, request: {
    serverConnectionId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    consumer: McpResultConsumer;
    operationId: string;
    progressToken?: string | number;
    signal?: AbortSignal;
    onProgress?: McpRequestOptions["onProgress"];
  }): Promise<CompleteMcpResult> {
    const record = this.requireRecord(handle);
    this.assertSameServer(record, request.serverConnectionId);
    const catalogs = record.catalogs ?? await this.discover(handle);
    const tool = catalogs.tools.find((candidate) => candidate.name === request.toolName);
    if (!tool) throw new McpHostError("tool_not_found", "MCP tool is not present in the negotiated catalog");
    if (!tool.visibility.includes(request.consumer)) {
      throw new McpHostError("visibility_denied", `MCP tool is not ${request.consumer}-visible`);
    }
    if (this.pendingOperations.has(request.operationId)) {
      throw new McpHostError("duplicate_request", "MCP operation is already in flight");
    }

    const controller = new AbortController();
    const abort = () => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) abort();
    else request.signal?.addEventListener("abort", abort, { once: true });
    record.pending.set(request.operationId, controller);
    this.pendingOperations.set(request.operationId, { record, controller });
    this.audit("mcp.request.started", {
      connection_id: record.connectionId,
      connection_generation: record.identity.generation,
      operation_id: request.operationId,
      method: "tools/call",
      tool: tool.name,
      consumer: request.consumer,
      outcome: "started",
    });
    let raw: unknown;
    try {
      raw = await record.peer.callTool({ name: tool.name, arguments: request.arguments }, {
        signal: controller.signal,
        timeoutMs: this.timeoutMs,
        onProgress: request.onProgress,
      });
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        throw new McpHostError("request_cancelled", "MCP tool call was cancelled", false, error);
      }
      if (!this.isCurrentReady(record)) {
        throw new McpHostError("late_response", "MCP tool response arrived after its connection closed", false, error);
      }
      record.state = "failed_recoverable";
      throw new McpHostError(
        "ambiguous_tool_outcome",
        "MCP tool outcome is ambiguous and was not replayed",
        false,
        error,
      );
    } finally {
      request.signal?.removeEventListener("abort", abort);
      record.pending.delete(request.operationId);
      this.pendingOperations.delete(request.operationId);
    }
    if (!this.isCurrentReady(record)) {
      throw new McpHostError("late_response", "MCP tool response arrived after its connection closed");
    }
    try {
      assertIngressBounds(raw, "envelope_oversized");
      const complete = preserveMcpResult(raw as RawMcpCallResult, {
        protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
        connectionId: record.connectionId,
        requestId: this.idFactory(),
        operationId: request.operationId,
        progressToken: request.progressToken ?? null,
        cancellationId: request.operationId,
        toolVisibility: tool.visibility,
      });
      this.audit("mcp.request.completed", {
        connection_id: record.connectionId,
        connection_generation: record.identity.generation,
        operation_id: request.operationId,
        method: "tools/call",
        content_count: complete.content.length,
        model_content_count: complete.projections.model_visible_content_indices.length,
        app_content_count: complete.projections.app_visible_content_indices.length,
        is_error: complete.isError,
        outcome: "completed",
      });
      return complete;
    } catch (error) {
      if (error instanceof McpHostError) throw error;
      throw new McpHostError("envelope_malformed", "MCP tool returned a malformed complete envelope", false, error);
    }
  }

  async readResource(handle: McpConnectionHandle, request: {
    serverConnectionId: string;
    uri: string;
    packageDigest: `sha256:${string}`;
    mimeType: string;
    expectedContentDigest?: `sha256:${string}`;
    signal?: AbortSignal;
  }): Promise<VerifiedMcpResource> {
    const record = this.requireRecord(handle);
    this.assertSameServer(record, request.serverConnectionId);
    if (!UiResourceUriSchema.safeParse(request.uri).success) {
      throw new McpHostError("resource_uri_invalid", "MCP App resource URI is not canonical");
    }
    if (request.mimeType !== MCP_APP_MEDIA_TYPE) {
      throw new McpHostError("resource_mime_invalid", "MCP App resource media type is not eligible");
    }
    if (request.packageDigest !== record.identity.packageDigest) {
      throw new McpHostError("resource_cache_mismatch", "MCP resource package identity does not match the connection");
    }
    const catalogs = record.catalogs ?? await this.discover(handle);
    const descriptor = catalogs.resources.find((candidate) => candidate.uri === request.uri);
    if (!descriptor) throw new McpHostError("resource_not_found", "MCP resource is not present in the negotiated catalog");
    if (descriptor.mimeType !== request.mimeType) {
      throw new McpHostError("resource_mime_invalid", "MCP resource declaration has an ineligible media type");
    }
    const cachePrefix = resourceCachePrefix(record, request.packageDigest, request.uri);
    const cached = [...this.resourceCache.entries()].find(([key]) => key.startsWith(cachePrefix))?.[1];
    if (cached) {
      if (request.expectedContentDigest && cached.contentDigest !== request.expectedContentDigest) {
        throw new McpHostError("resource_integrity_mismatch", "MCP resource digest does not match the required integrity value");
      }
      this.audit("mcp.resource.cache", {
        connection_id: record.connectionId,
        connection_generation: record.identity.generation,
        cache_policy: cached.cachePolicy,
        outcome: "hit",
      });
      return { ...cached, cacheHit: true };
    }

    let raw: unknown;
    try {
      raw = await record.peer.readResource({ uri: request.uri }, {
        signal: request.signal,
        timeoutMs: this.timeoutMs,
      });
      assertIngressBounds(raw, "resource_oversized");
    } catch (error) {
      throw asMcpHostError(error, "connection_unavailable", "MCP resource read failed");
    }
    if (!this.isCurrentReady(record)) {
      throw new McpHostError("late_response", "MCP resource response arrived after its connection closed");
    }
    const read = parseOrThrow(ResourceReadSchema, raw, "resource_mime_invalid", "MCP resource response is malformed");
    const exact = read.contents.filter((content) => content.uri === request.uri);
    if (exact.length !== 1) throw new McpHostError("resource_uri_invalid", "MCP resource response is missing or ambiguous");
    const content = exact[0]!;
    if (content.mimeType !== request.mimeType) {
      throw new McpHostError("resource_mime_invalid", "MCP resource response has an ineligible media type");
    }
    const bytes = decodeResourceBytes(content);
    if (bytes.length === 0 || bytes.length > CONTRACT_SIZE_LIMITS.resourceBytes) {
      throw new McpHostError("resource_oversized", "MCP resource exceeds the accepted byte limit");
    }
    if (descriptor.size !== undefined && descriptor.size !== bytes.length) {
      throw new McpHostError("resource_cache_mismatch", "MCP resource size does not match its catalog declaration");
    }
    const contentDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
    const declaredIntegrity = integrityFromMeta(descriptor._meta);
    if ((request.expectedContentDigest && request.expectedContentDigest !== contentDigest) || (declaredIntegrity && declaredIntegrity !== contentDigest)) {
      throw new McpHostError("resource_integrity_mismatch", "MCP resource digest does not match its integrity declaration");
    }
    const cachePolicy = cachePolicyFromMeta(content._meta) ?? cachePolicyFromMeta(descriptor._meta) ?? "no_store";
    const verified: VerifiedMcpResource = {
      connectionId: record.connectionId,
      connectionGeneration: record.identity.generation,
      packageDigest: request.packageDigest,
      uri: request.uri,
      mimeType: request.mimeType,
      contentDigest,
      sizeBytes: bytes.length,
      cachePolicy,
      cacheHit: false,
      ...(content.text !== undefined ? { text: content.text } : { blob: content.blob! }),
      descriptor,
      envelope: raw,
    };
    if (cachePolicy === "immutable_package_digest") {
      this.resourceCache.set(`${cachePrefix}${contentDigest}`, verified);
    }
    this.audit("mcp.resource.verified", {
      connection_id: record.connectionId,
      connection_generation: record.identity.generation,
      resource_size_bytes: bytes.length,
      cache_policy: cachePolicy,
      outcome: "verified",
    });
    return verified;
  }

  cancel(operationId: string): boolean {
    const pending = this.pendingOperations.get(operationId);
    if (!pending) return false;
    pending.controller.abort(new DOMException("Cancelled", "AbortError"));
    this.audit("mcp.request.cancelled", {
      connection_id: pending.record.connectionId,
      connection_generation: pending.record.identity.generation,
      operation_id: operationId,
      outcome: "cancelled",
    });
    return true;
  }

  invalidateResourceCache(filter: { packageDigest: `sha256:${string}`; connectionGeneration?: number }): number {
    let removed = 0;
    for (const [key, value] of this.resourceCache) {
      if (value.packageDigest !== filter.packageDigest) continue;
      if (filter.connectionGeneration !== undefined && value.connectionGeneration !== filter.connectionGeneration) continue;
      this.resourceCache.delete(key);
      removed += 1;
    }
    return removed;
  }

  async close(handle: McpConnectionHandle): Promise<void> {
    const record = this.requireRecord(handle);
    await this.closeRecord(record);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.records.values()].map((record) => this.closeRecord(record)));
  }

  private async establish(identity: McpConnectionIdentity, key: string): Promise<McpConnectionHandle> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxReadOnlyRetries; attempt += 1) {
      const record: ConnectionRecord = {
        key,
        identity,
        connectionId: this.idFactory(),
        state: "connecting",
        peer: this.options.peerFactory(identity),
        catalogGeneration: 0,
        reconnectAttempts: attempt,
        pending: new Map(),
      };
      this.records.set(key, record);
      try {
        await this.negotiate(record);
        return snapshot(record);
      } catch (error) {
        lastError = error;
        this.audit("mcp.connection.failed", {
          connection_id: record.connectionId,
          connection_generation: record.identity.generation,
          error_code: error instanceof McpHostError ? error.code : "connection_unavailable",
          outcome: "failed",
        });
        await closePeer(record.peer);
        if (this.records.get(key) === record) this.records.delete(key);
        if (!(error instanceof McpHostError && error.retryable) || attempt >= this.maxReadOnlyRetries) throw error;
      }
    }
    throw new McpHostError("reconnect_exhausted", "MCP negotiation retries were exhausted", false, lastError);
  }

  private async negotiate(record: ConnectionRecord): Promise<void> {
    record.state = "negotiating";
    let negotiation: McpPeerNegotiation;
    try {
      negotiation = await record.peer.connect(this.requestOptions());
    } catch (error) {
      throw asMcpHostError(error, "connection_unavailable", "MCP negotiation could not reach the installed server");
    }
    if (negotiation.era !== "modern" || negotiation.protocolVersion !== MCP_MODERN_PROTOCOL_VERSION) {
      throw new McpHostError("protocol_incompatible", "Installed MCP server did not negotiate the required modern protocol");
    }
    const discover = negotiation.discover;
    const supportedVersions = discover?.supportedVersions;
    if (!Array.isArray(supportedVersions) || !supportedVersions.includes(MCP_MODERN_PROTOCOL_VERSION)) {
      throw new McpHostError("protocol_incompatible", "Installed MCP server discovery omitted the required protocol version");
    }
    const capabilities = isRecord(discover?.capabilities) ? discover.capabilities : negotiation.capabilities;
    if (!isRecord(capabilities.tools) || !isRecord(capabilities.resources)) {
      throw new McpHostError("protocol_incompatible", "Installed MCP server lacks required tools or resources methods");
    }
    const appCapability = isRecord(capabilities.extensions)
      ? capabilities.extensions[MCP_APPS_EXTENSION_ID]
      : undefined;
    if (!isRecord(appCapability) || !Array.isArray(appCapability.mimeTypes) || !appCapability.mimeTypes.includes(MCP_APP_MEDIA_TYPE)) {
      throw new McpHostError("extension_incompatible", "Installed MCP server does not advertise the required MCP Apps media type");
    }
    const extension = discover?._meta?.[MCP_APPS_EXTENSION_ID];
    if (!isRecord(extension) || extension.version !== MCP_APPS_EXTENSION_VERSION) {
      throw new McpHostError("extension_incompatible", "Installed MCP server lacks the required MCP Apps extension");
    }
    const serverInfo = negotiation.serverInfo ?? serverInfoFromDiscover(discover?._meta);
    if (!serverInfo) throw new McpHostError("negotiation_failed", "Installed MCP server did not identify itself");
    const advertisedMethods = [...SPEC_05_SUPPORT_PROFILES[0].required_methods];
    record.negotiated = McpNegotiatedPeerSchema.parse({
      negotiation_version: 1,
      connection_id: record.connectionId,
      connection_generation: record.identity.generation,
      app_id: record.identity.appId,
      publisher_id: record.identity.publisherId,
      package_digest: record.identity.packageDigest,
      installation_id: record.identity.installationId,
      runtime_id: record.identity.runtimeId,
      client_name: "braindrive-app-host",
      client_version: "1.0.0",
      server_name: serverInfo.name,
      server_version: serverInfo.version,
      profile: SPEC_05_SUPPORT_PROFILES[0],
      advertised_methods: advertisedMethods,
      unknown_critical_facilities: [],
      compatible: true,
      negotiated_at: this.now().toISOString(),
    });
    record.state = "ready";
    this.audit("mcp.connection.negotiated", {
      connection_id: record.connectionId,
      connection_generation: record.identity.generation,
      protocol_version: MCP_MODERN_PROTOCOL_VERSION,
      extension_version: MCP_APPS_EXTENSION_VERSION,
      outcome: "compatible",
    });
  }

  private async runReadOnly<T>(record: ConnectionRecord, operation: string, action: (record: ConnectionRecord) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxReadOnlyRetries; attempt += 1) {
      try {
        return await action(record);
      } catch (error) {
        lastError = error;
        const retryable = error instanceof McpHostError ? error.retryable : true;
        this.audit("mcp.connection.read_only_failed", {
          connection_id: record.connectionId,
          connection_generation: record.identity.generation,
          operation,
          attempt,
          error_code: error instanceof McpHostError ? error.code : "connection_unavailable",
          error_name: error instanceof Error ? error.name : "unknown",
          sdk_error_code: isRecord(error) && typeof error.code === "string" ? error.code : null,
          outcome: retryable && attempt < this.maxReadOnlyRetries ? "retrying" : "failed",
        });
        if (!retryable || attempt >= this.maxReadOnlyRetries) {
          if (attempt >= this.maxReadOnlyRetries && retryable) {
            throw new McpHostError("reconnect_exhausted", `MCP ${operation} retries were exhausted`, false, error);
          }
          throw error;
        }
        record.state = "reconnecting";
        await closePeer(record.peer);
        record.peer = this.options.peerFactory(record.identity);
        record.reconnectAttempts += 1;
        record.catalogs = undefined;
        this.invalidateResourceCache({ packageDigest: record.identity.packageDigest, connectionGeneration: record.identity.generation });
        await this.negotiate(record);
      }
    }
    throw new McpHostError("reconnect_exhausted", `MCP ${operation} retries were exhausted`, false, lastError);
  }

  private requestOptions(): McpRequestOptions {
    return { signal: AbortSignal.timeout(this.timeoutMs), timeoutMs: this.timeoutMs };
  }

  private requireRecord(handle: McpConnectionHandle): ConnectionRecord {
    const record = this.records.get(connectionKey(handle.identity));
    if (!record || record.connectionId !== handle.connectionId) {
      throw new McpHostError("connection_stale", "MCP connection handle is stale");
    }
    if (record.identity.generation !== handle.generation) {
      throw new McpHostError("connection_stale", "MCP connection generation is stale");
    }
    if (record.state !== "ready") {
      throw new McpHostError(record.state === "closed" ? "connection_closed" : "connection_unavailable", "MCP connection is not ready", true);
    }
    return record;
  }

  private assertSameServer(record: ConnectionRecord, serverConnectionId: string): void {
    if (serverConnectionId !== record.connectionId) {
      throw new McpHostError("cross_server_denied", "MCP call cannot cross its negotiated server connection");
    }
  }

  private isCurrentReady(record: ConnectionRecord): boolean {
    return this.records.get(record.key) === record && record.state === "ready";
  }

  private async closeRecord(record: ConnectionRecord): Promise<void> {
    if (record.state === "closed") return;
    record.state = "closing";
    for (const controller of record.pending.values()) controller.abort(new DOMException("Connection closed", "AbortError"));
    await closePeer(record.peer);
    record.state = "closed";
    record.catalogs = undefined;
    this.invalidateResourceCache({ packageDigest: record.identity.packageDigest, connectionGeneration: record.identity.generation });
    if (this.records.get(record.key) === record) this.records.delete(record.key);
    this.audit("mcp.connection.closed", {
      connection_id: record.connectionId,
      connection_generation: record.identity.generation,
      outcome: "closed",
    });
  }
}

function snapshot(record: ConnectionRecord): McpConnectionHandle {
  if (record.state !== "ready" || !record.negotiated) {
    throw new McpHostError("connection_unavailable", "MCP connection is not ready", true);
  }
  return {
    connectionId: record.connectionId,
    generation: record.identity.generation,
    state: "ready",
    identity: { ...record.identity },
    negotiated: record.negotiated,
  };
}

function normalizeTools(tools: z.infer<typeof ToolSchema>[], connectionId: string): McpCatalogTool[] {
  const names = new Set<string>();
  return tools.map((tool) => {
    if (names.has(tool.name)) throw new McpHostError("catalog_invalid", "MCP tool catalog contains a duplicate name");
    names.add(tool.name);
    const ui = isRecord(tool._meta?.ui) ? tool._meta.ui : undefined;
    const visibility = parseVisibility(ui?.visibility);
    const resourceUri = ui?.resourceUri;
    if (resourceUri !== undefined && (typeof resourceUri !== "string" || !UiResourceUriSchema.safeParse(resourceUri).success)) {
      throw new McpHostError("catalog_invalid", "MCP tool declares an invalid UI resource URI");
    }
    return {
      ...tool,
      connectionId,
      visibility,
      ...(typeof resourceUri === "string" ? { resourceUri } : {}),
      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    };
  });
}

function normalizeResources(resources: z.infer<typeof ResourceSchema>[], connectionId: string): McpCatalogResource[] {
  const uris = new Set<string>();
  return resources.map((resource) => {
    if (uris.has(resource.uri)) throw new McpHostError("catalog_invalid", "MCP resource catalog contains a duplicate URI");
    uris.add(resource.uri);
    if (resource.uri.startsWith("ui://") && !UiResourceUriSchema.safeParse(resource.uri).success) {
      throw new McpHostError("catalog_invalid", "MCP resource catalog contains an invalid UI URI");
    }
    return { ...resource, connectionId };
  });
}

function normalizeResourceTemplates(templates: z.infer<typeof ResourceTemplateSchema>[], connectionId: string): McpCatalogResourceTemplate[] {
  const values = new Set<string>();
  return templates.map((template) => {
    if (values.has(template.uriTemplate)) throw new McpHostError("catalog_invalid", "MCP resource template catalog contains a duplicate URI template");
    values.add(template.uriTemplate);
    if (template.uriTemplate.startsWith("ui://") && (/\\|\/\.\.(?:\/|$)|%2e|%2f|%5c/i.test(template.uriTemplate))) {
      throw new McpHostError("catalog_invalid", "MCP resource template is not canonical");
    }
    return { ...template, connectionId };
  });
}

function parseVisibility(raw: unknown): McpToolVisibility[] {
  if (raw === undefined) return ["model", "app"];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 2) {
    throw new McpHostError("catalog_invalid", "MCP tool visibility is invalid");
  }
  const parsed = raw.filter((value): value is McpToolVisibility => value === "model" || value === "app");
  if (parsed.length !== raw.length || new Set(parsed).size !== parsed.length) {
    throw new McpHostError("catalog_invalid", "MCP tool visibility is invalid");
  }
  return parsed;
}

function validateIdentity(identity: McpConnectionIdentity): void {
  if (!Number.isInteger(identity.generation) || identity.generation < 1) {
    throw new McpHostError("negotiation_failed", "MCP connection generation is invalid");
  }
  for (const value of [identity.appId, identity.publisherId, identity.packageDigest, identity.installationId, identity.runtimeId, identity.serverId]) {
    if (!value.trim()) throw new McpHostError("negotiation_failed", "MCP connection identity is incomplete");
  }
}

function connectionKey(identity: McpConnectionIdentity): string {
  return JSON.stringify([identity.installationId, identity.serverId]);
}

async function catalogRequest(request: Promise<unknown>, catalog: string): Promise<unknown> {
  try {
    return await request;
  } catch (error) {
    if (isRecord(error) && error.code === "INVALID_RESULT") {
      throw new McpHostError("catalog_invalid", `Installed server returned an invalid MCP ${catalog} catalog`, false, error);
    }
    throw error;
  }
}

function sameConnectionAuthority(left: McpConnectionIdentity, right: McpConnectionIdentity): boolean {
  return left.appId === right.appId
    && left.publisherId === right.publisherId
    && left.packageDigest === right.packageDigest
    && left.installationId === right.installationId
    && left.runtimeId === right.runtimeId
    && left.serverId === right.serverId
    && left.generation === right.generation;
}

function resourceCachePrefix(record: ConnectionRecord, packageDigest: string, uri: string): string {
  return `${JSON.stringify([packageDigest, record.identity.generation, record.connectionId, uri])}:`;
}

function decodeResourceBytes(content: z.infer<typeof ResourceContentSchema>): Buffer {
  if (content.text !== undefined) return Buffer.from(content.text, "utf8");
  const blob = content.blob!;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(blob) || blob.length % 4 !== 0) {
    throw new McpHostError("resource_mime_invalid", "MCP resource blob is not canonical base64");
  }
  return Buffer.from(blob, "base64");
}

function integrityFromMeta(meta: Record<string, unknown> | undefined): `sha256:${string}` | undefined {
  const value = meta?.integrity;
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value) ? value as `sha256:${string}` : undefined;
}

function cachePolicyFromMeta(meta: Record<string, unknown> | undefined): "immutable_package_digest" | "no_store" | undefined {
  const value = meta?.cachePolicy;
  return value === "immutable_package_digest" || value === "no_store" ? value : undefined;
}

function serverInfoFromDiscover(meta: Record<string, unknown> | undefined): { name: string; version: string } | undefined {
  const raw = meta?.["io.modelcontextprotocol/serverInfo"];
  if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.version !== "string" || !raw.name || !raw.version) return undefined;
  return { name: raw.name, version: raw.version };
}

function assertIngressBounds(value: unknown, code: "catalog_invalid" | "envelope_oversized" | "resource_oversized"): void {
  if (encodedByteLength(value) > CONTRACT_SIZE_LIMITS.authorityEnvelopeBytes) {
    throw new McpHostError(code, "MCP response exceeds the accepted envelope byte limit");
  }
  walkJson(value, 0);
}

function walkJson(value: unknown, depth: number): void {
  if (depth > 32) throw new McpHostError("envelope_oversized", "MCP response exceeds the accepted nesting depth");
  if (typeof value === "string" && value.length > CONTRACT_SIZE_LIMITS.resourceBytes * 2) {
    throw new McpHostError("envelope_oversized", "MCP response contains an oversized string");
  }
  if (Array.isArray(value)) {
    if (value.length > CONTRACT_SIZE_LIMITS.maxArrayItems) throw new McpHostError("envelope_oversized", "MCP response contains too many items");
    value.forEach((item) => walkJson(item, depth + 1));
    return;
  }
  if (isRecord(value)) {
    const entries = Object.values(value);
    if (entries.length > CONTRACT_SIZE_LIMITS.maxArrayItems) throw new McpHostError("envelope_oversized", "MCP response contains too many fields");
    entries.forEach((item) => walkJson(item, depth + 1));
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, code: "catalog_invalid" | "resource_mime_invalid", message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new McpHostError(code, message, false, parsed.error);
  return parsed.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function closePeer(peer: McpPeer): Promise<void> {
  try { await peer.close(); } catch { /* best-effort close remains bounded by the peer */ }
}
