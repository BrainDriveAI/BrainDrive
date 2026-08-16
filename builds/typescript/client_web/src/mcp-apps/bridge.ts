import type { AppLaunch } from "@/api/apps-adapter";

import {
  BRIDGE_CHANNEL,
  createSafeHostContext,
  createSandboxResourceNotification,
} from "./sandbox-proxy";

export { BRIDGE_CHANNEL };
export const APPS_PROTOCOL_VERSION = "2026-01-26" as const;
export const MAX_BRIDGE_MESSAGE_BYTES = 65_536;
export const MAX_BRIDGE_DEPTH = 32;
export const MAX_OUTSTANDING_REQUESTS = 16;
export const MAX_MESSAGES_PER_10_SECONDS = 100;

export type BridgeStatus = "loading" | "ready" | "error" | "reconnecting" | "disabled" | "stopped";
export type ProxyToHostMessage = {
  channel: typeof BRIDGE_CHANNEL;
  direction: "proxy_to_host";
  proxy_nonce: string;
  source: "proxy" | "view";
  message: unknown;
};
type HostToProxyMessage = {
  channel: typeof BRIDGE_CHANNEL;
  direction: "host_to_proxy";
  proxy_nonce: string;
  message: unknown;
};
type JsonRpcId = string | number;
type JsonRpcRequest = { jsonrpc: "2.0"; id: JsonRpcId; method: string; params?: Record<string, unknown> };
type LegacyMessageDraft = { bridge_version: 1; message_id: string; type: string; payload: Record<string, unknown> };

export type McpAppBridgeOptions = {
  launch: AppLaunch;
  proxyNonce: string;
  sendToProxy: (message: HostToProxyMessage) => void;
  onToolCall?: (name: string, args: Record<string, unknown>, context: { serverConnectionId: string; viewId: string }, signal: AbortSignal) => Promise<unknown>;
  onResourceRead?: (uri: string, context: { serverConnectionId: string; viewId: string }, signal: AbortSignal) => Promise<unknown>;
  onOpenLink?: (url: string) => Promise<unknown>;
  onDownloadFile?: (contents: unknown[]) => Promise<unknown>;
  onLegacyMessage?: (message: LegacyMessageDraft, signal: AbortSignal) => Promise<unknown>;
  onResize?: (size: { width: number; height: number }) => void;
  onRequestTeardown?: () => void;
  onStatus?: (status: BridgeStatus) => void;
  onViolation?: (code: string) => void;
  now?: () => number;
};

type LifecycleState = "awaiting_proxy" | "awaiting_initialize" | "awaiting_initialized" | "ready" | "closed";

export class McpAppBridgeController {
  private lifecycle: LifecycleState = "awaiting_proxy";
  private readonly seenRequestIds = new Set<JsonRpcId>();
  private readonly outstanding = new Map<JsonRpcId, AbortController>();
  private readonly messageTimes: number[] = [];
  private generation: number;

  constructor(private readonly options: McpAppBridgeOptions) {
    this.generation = options.launch.bridge_generation;
    this.options.onStatus?.("loading");
  }

  get state(): LifecycleState { return this.lifecycle; }

  notifyView(message: unknown): boolean {
    if (this.lifecycle !== "ready") return false;
    if (encodedBytes(message) > MAX_BRIDGE_MESSAGE_BYTES || objectDepth(message) > MAX_BRIDGE_DEPTH) {
      return false;
    }
    this.send(message);
    return true;
  }

  async receive(event: MessageEvent, proxyWindow: Window): Promise<boolean> {
    if (this.lifecycle === "closed") return false;
    if (event.source !== proxyWindow) return this.violation("source_window_mismatch");
    if (event.origin !== "null") return this.violation("opaque_origin_required");
    if (!isRecord(event.data) || event.data.channel !== BRIDGE_CHANNEL || event.data.direction !== "proxy_to_host" || event.data.proxy_nonce !== this.options.proxyNonce) {
      return this.violation("proxy_binding_invalid");
    }
    const source = event.data.source;
    if (source !== "proxy" && source !== "view") return this.violation("proxy_binding_invalid");
    const message = event.data.message;
    if (encodedBytes(message) > MAX_BRIDGE_MESSAGE_BYTES) return this.violation("message_oversized");
    if (objectDepth(message) > MAX_BRIDGE_DEPTH) return this.violation("message_too_deep");
    const now = (this.options.now ?? Date.now)();
    while (this.messageTimes.length > 0 && now - this.messageTimes[0]! >= 10_000) this.messageTimes.shift();
    if (this.messageTimes.length >= MAX_MESSAGES_PER_10_SECONDS) return this.violation("rate_limited");
    this.messageTimes.push(now);

    if (isProxyReady(message)) {
      if (source !== "proxy") return this.violation("proxy_control_forged");
      if (this.lifecycle !== "awaiting_proxy") return this.violation("lifecycle_order_invalid");
      this.send(createSandboxResourceNotification(this.options.launch.resource));
      this.lifecycle = "awaiting_initialize";
      return true;
    }
    if (source !== "view") return this.violation("proxy_control_invalid");
    if (isJsonRpc(message)) return await this.handleJsonRpc(message);
    return await this.handleLegacyMessage(message);
  }

  close(_reason: "view_closed" | "reload" | "revoked" | "unmount"): void {
    void _reason;
    if (this.lifecycle === "closed") return;
    this.lifecycle = "closed";
    this.generation += 1;
    for (const controller of this.outstanding.values()) controller.abort();
    this.outstanding.clear();
    this.options.onStatus?.("stopped");
  }

  requestTeardown(): void {
    if (this.lifecycle !== "ready") return;
    this.send({ jsonrpc: "2.0", id: `host-teardown-${this.generation}`, method: "ui/resource-teardown", params: {} });
  }

  private async handleJsonRpc(message: Record<string, unknown>): Promise<boolean> {
    if (isInitialized(message)) {
      if (this.lifecycle !== "awaiting_initialized") return this.violation("lifecycle_order_invalid");
      this.lifecycle = "ready";
      this.options.onStatus?.("ready");
      return true;
    }
    if (isCancellation(message)) {
      if (this.lifecycle !== "ready") return this.violation("lifecycle_order_invalid");
      const controller = this.outstanding.get(message.params.requestId);
      if (!controller) return this.violation("cancellation_target_invalid");
      controller.abort();
      return true;
    }
    if (isSizeChanged(message)) {
      if (this.lifecycle !== "ready") return this.violation("lifecycle_order_invalid");
      this.options.onResize?.({
        width: clampDimension(message.params.width, 320, 1_920),
        height: clampDimension(message.params.height, 240, 1_200),
      });
      return true;
    }
    if (isRequestTeardown(message)) {
      if (this.lifecycle !== "ready") return this.violation("lifecycle_order_invalid");
      this.options.onRequestTeardown?.();
      return true;
    }
    if (!isRequest(message)) return this.violation("message_schema_invalid");
    if (this.seenRequestIds.has(message.id)) {
      this.sendError(message.id, -32600, "Request ID was already used");
      return this.violation("request_id_reused");
    }
    this.seenRequestIds.add(message.id);
    if (message.method === "ui/initialize") return this.handleInitialize(message);
    if (this.lifecycle !== "ready") {
      this.sendError(message.id, -32002, "MCP App view is not initialized");
      return this.violation("lifecycle_order_invalid");
    }
    if (message.method === "ui/update-model-context" || message.method === "ui/message") {
      this.sendError(message.id, -32601, "App content is not accepted into model context");
      return this.violation("model_context_denied");
    }
    if (this.outstanding.size >= MAX_OUTSTANDING_REQUESTS) {
      this.sendError(message.id, -32003, "Too many outstanding app requests");
      return this.violation("outstanding_limit");
    }
    return await this.executeRequest(message);
  }

  private handleInitialize(message: JsonRpcRequest): boolean {
    if (this.lifecycle !== "awaiting_initialize" || !validInitializeParams(message.params)) {
      this.sendError(message.id, -32602, "Invalid MCP Apps initialization");
      this.options.onStatus?.("error");
      return this.violation("initialize_invalid");
    }
    this.send({
      jsonrpc: "2.0", id: message.id,
      result: {
        protocolVersion: APPS_PROTOCOL_VERSION,
        hostInfo: { name: "BrainDrive", version: "1.0.0" },
        hostCapabilities: {
          ...(this.options.onOpenLink ? { openLinks: {} } : {}),
          ...(this.options.onDownloadFile ? { downloadFile: {} } : {}),
          ...(this.options.onToolCall ? { serverTools: { listChanged: false } } : {}),
          ...(this.options.onResourceRead ? { serverResources: { listChanged: false } } : {}),
          sandbox: { permissions: {}, csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] } },
        },
        hostContext: createSafeHostContext(this.options.launch.entry_point, { width: 960, height: 720, platform: "web" }),
      },
    });
    this.lifecycle = "awaiting_initialized";
    return true;
  }

  private async executeRequest(message: JsonRpcRequest): Promise<boolean> {
    const params = message.params ?? {};
    const controller = new AbortController();
    const generation = this.generation;
    this.outstanding.set(message.id, controller);
    try {
      let result: unknown;
      if (message.method === "ping" && exactKeys(params, [])) result = {};
      else if (message.method === "tools/call" && validToolCall(params) && this.options.onToolCall) {
        result = await this.options.onToolCall(params.name, params.arguments, this.context(), controller.signal);
      } else if (message.method === "resources/read" && validResourceRead(params) && this.options.onResourceRead) {
        result = await this.options.onResourceRead(params.uri, this.context(), controller.signal);
      } else if (message.method === "ui/open-link" && validOpenLink(params) && this.options.onOpenLink) {
        result = await this.options.onOpenLink(params.url);
      } else if (message.method === "ui/download-file" && validDownload(params) && this.options.onDownloadFile) {
        result = await this.options.onDownloadFile(params.contents);
      } else if (message.method === "ui/request-display-mode" && validDisplayMode(params)) {
        result = { displayMode: "inline" };
      } else {
        this.sendError(message.id, -32601, "Method is not available to this app view");
        return this.violation(validKnownMethod(message.method) ? "message_schema_invalid" : "method_denied");
      }
      if (this.isCurrentGeneration(generation) && !controller.signal.aborted) this.send({ jsonrpc: "2.0", id: message.id, result });
      return true;
    } catch (error) {
      if (this.isCurrentGeneration(generation)) {
        this.sendError(message.id, controller.signal.aborted || isAbort(error) ? -32800 : -32000, controller.signal.aborted || isAbort(error) ? "Request cancelled" : "App request failed safely");
      }
      return true;
    } finally {
      this.outstanding.delete(message.id);
    }
  }

  private async handleLegacyMessage(message: unknown): Promise<boolean> {
    if (this.lifecycle !== "ready") return this.violation("lifecycle_order_invalid");
    if (!validLegacyDraft(message) || !this.options.onLegacyMessage) return this.violation("message_schema_invalid");
    if (this.seenRequestIds.has(message.message_id)) return this.violation("request_id_reused");
    this.seenRequestIds.add(message.message_id);
    const controller = new AbortController();
    this.outstanding.set(message.message_id, controller);
    const generation = this.generation;
    try {
      const response = await this.options.onLegacyMessage(message, controller.signal);
      if (this.isCurrentGeneration(generation) && !controller.signal.aborted) {
        this.send({ type: "host.result", request_message_id: message.message_id, response });
      }
    } catch (error) {
      if (this.isCurrentGeneration(generation)) {
        this.send({ type: "host.result", request_message_id: message.message_id, error: { error: error instanceof Error ? error.message : "recoverable_internal_failure" } });
      }
    } finally { this.outstanding.delete(message.message_id); }
    return true;
  }

  private context() { return { serverConnectionId: this.options.launch.server_id, viewId: this.options.launch.view_id }; }
  private isCurrentGeneration(generation: number): boolean { return this.lifecycle !== "closed" && generation === this.generation; }
  private send(message: unknown): void { this.options.sendToProxy({ channel: BRIDGE_CHANNEL, direction: "host_to_proxy", proxy_nonce: this.options.proxyNonce, message }); }
  private sendError(id: JsonRpcId, code: number, message: string): void { this.send({ jsonrpc: "2.0", id, error: { code, message } }); }
  private violation(code: string): false { this.options.onViolation?.(code); return false; }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isJsonRpc(value: unknown): value is Record<string, unknown> { return isRecord(value) && value.jsonrpc === "2.0"; }
function isRequest(value: Record<string, unknown>): value is JsonRpcRequest { return exactKeys(value, ["jsonrpc", "id", "method", "params"], ["params"]) && (typeof value.id === "string" || Number.isInteger(value.id)) && typeof value.method === "string" && (value.params === undefined || isRecord(value.params)); }
function isProxyReady(value: unknown): boolean { return isRecord(value) && exactKeys(value, ["jsonrpc", "method", "params"]) && value.jsonrpc === "2.0" && value.method === "ui/notifications/sandbox-proxy-ready" && isRecord(value.params) && exactKeys(value.params, []); }
function isInitialized(value: Record<string, unknown>): boolean { return exactKeys(value, ["jsonrpc", "method", "params"]) && value.jsonrpc === "2.0" && value.method === "ui/notifications/initialized" && isRecord(value.params) && exactKeys(value.params, []); }
function isCancellation(value: Record<string, unknown>): value is { jsonrpc: "2.0"; method: "notifications/cancelled"; params: { requestId: JsonRpcId; reason?: string } } { if (!exactKeys(value, ["jsonrpc", "method", "params"]) || value.method !== "notifications/cancelled" || !isRecord(value.params) || !exactKeys(value.params, ["requestId", "reason"], ["reason"])) return false; return typeof value.params.requestId === "string" || Number.isInteger(value.params.requestId); }
function isSizeChanged(value: Record<string, unknown>): value is { jsonrpc: "2.0"; method: string; params: { width?: number; height?: number } } { return exactKeys(value, ["jsonrpc", "method", "params"]) && value.method === "ui/notifications/size-changed" && isRecord(value.params) && exactKeys(value.params, ["width", "height"], ["width", "height"]) && (value.params.width === undefined || typeof value.params.width === "number") && (value.params.height === undefined || typeof value.params.height === "number"); }
function isRequestTeardown(value: Record<string, unknown>): boolean { return exactKeys(value, ["jsonrpc", "method", "params"]) && value.method === "ui/notifications/request-teardown" && (value.params === undefined || (isRecord(value.params) && exactKeys(value.params, []))); }
function validInitializeParams(value: Record<string, unknown> | undefined): boolean { return Boolean(value && exactKeys(value, ["protocolVersion", "appInfo", "appCapabilities"]) && value.protocolVersion === APPS_PROTOCOL_VERSION && isRecord(value.appInfo) && exactKeys(value.appInfo, ["name", "version", "title", "description", "websiteUrl", "icons"], ["title", "description", "websiteUrl", "icons"]) && typeof value.appInfo.name === "string" && typeof value.appInfo.version === "string" && isRecord(value.appCapabilities) && exactKeys(value.appCapabilities, ["experimental", "tools", "availableDisplayModes"], ["experimental", "tools", "availableDisplayModes"])); }
function validToolCall(value: Record<string, unknown>): value is { name: string; arguments: Record<string, unknown> } { return exactKeys(value, ["name", "arguments"], ["arguments"]) && typeof value.name === "string" && value.name.length > 0 && (value.arguments === undefined || isRecord(value.arguments)); }
function validResourceRead(value: Record<string, unknown>): value is { uri: string } { return exactKeys(value, ["uri"]) && typeof value.uri === "string" && /^ui:\/\/[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/.test(value.uri); }
function validOpenLink(value: Record<string, unknown>): value is { url: string } { return exactKeys(value, ["url"]) && typeof value.url === "string" && value.url.length <= 2_048; }
function validDownload(value: Record<string, unknown>): value is { contents: unknown[] } { return exactKeys(value, ["contents"]) && Array.isArray(value.contents) && value.contents.length <= 16; }
function validDisplayMode(value: Record<string, unknown>): boolean { return exactKeys(value, ["mode"]) && value.mode === "inline"; }
function validKnownMethod(method: string): boolean { return ["tools/call", "resources/read", "ui/open-link", "ui/download-file", "ui/request-display-mode", "ping"].includes(method); }
function validLegacyDraft(value: unknown): value is LegacyMessageDraft { return isRecord(value) && exactKeys(value, ["bridge_version", "message_id", "type", "payload"]) && value.bridge_version === 1 && typeof value.message_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.message_id) && typeof value.type === "string" && ["bridge.ready", "capability.call", "export.request", "operation.cancel", "career.return", "host.action", "chat.sync", "chat.turn.commit", "chat.turn.recover", "chat.transcript.extract"].includes(value.type) && isRecord(value.payload); }
function exactKeys(value: Record<string, unknown>, keys: string[], optional: string[] = []): boolean { const allowed = new Set(keys); if (Object.keys(value).some((key) => !allowed.has(key))) return false; return keys.filter((key) => !optional.includes(key)).every((key) => key in value); }
function encodedBytes(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.POSITIVE_INFINITY; } }
function objectDepth(value: unknown, seen = new Set<object>()): number { if (!isRecord(value) && !Array.isArray(value)) return 0; if (seen.has(value)) return Number.POSITIVE_INFINITY; seen.add(value); const children = Array.isArray(value) ? value : Object.values(value); const depth = 1 + children.reduce((max, child) => Math.max(max, objectDepth(child, seen)), 0); seen.delete(value); return depth; }
function clampDimension(value: number | undefined, minimum: number, maximum: number): number { if (!Number.isFinite(value)) return minimum; return Math.max(minimum, Math.min(maximum, Math.round(value ?? minimum))); }
function isAbort(value: unknown): boolean { return value instanceof DOMException && value.name === "AbortError"; }
