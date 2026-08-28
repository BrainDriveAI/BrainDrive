import { AppCapabilityError, type AppSurfaceLaunch } from "@/api/apps-adapter";

import {
  APPS_PROTOCOL_VERSION,
  BRIDGE_CHANNEL,
  McpAppBridgeController,
  type ProxyToHostMessage,
} from "./bridge";

const launch: AppSurfaceLaunch = {
  launch_version: 1,
  session_id: "00000000-0000-4000-8000-000000000001",
  installation_id: "00000000-0000-4000-8000-000000000002",
  view_id: "00000000-0000-4000-8000-000000000003",
  operation_id: "00000000-0000-4000-8000-000000000004",
  bridge_generation: 1,
  resumed: false,
  bridge_token_id: "00000000-0000-4000-8000-000000000005",
  server_id: "00000000-0000-4000-8000-000000000006",
  expires_at: "2030-01-01T00:00:00.000Z",
  protocol: { core: "2026-07-28", apps_extension: APPS_PROTOCOL_VERSION, server_name: "fixture", server_version: "3.0.0" },
  resource: { uri: "ui://resume-builder/main", mime_type: "text/html;profile=mcp-app", content_digest: `sha256:${"a".repeat(64)}`, size_bytes: 45, html: "<!doctype html><html><body>Fixture</body></html>" },
  allowed_tools: ["fixture.status"], allowed_capabilities: [], entry_point: "direct",
};

const proxyWindow = {} as Window;
const otherWindow = {} as Window;
const proxyNonce = "proxy-nonce-for-test";

function proxyMessage(message: unknown, source: "proxy" | "view" = "view", nonce = proxyNonce): ProxyToHostMessage {
  return { channel: BRIDGE_CHANNEL, direction: "proxy_to_host", proxy_nonce: nonce, source, message };
}

function event(data: unknown, source: MessageEventSource = proxyWindow, origin = "null"): MessageEvent {
  return { data, source, origin } as MessageEvent;
}

async function readyController(overrides: Partial<ConstructorParameters<typeof McpAppBridgeController>[0]> = {}) {
  const sent: unknown[] = [];
  const violations: string[] = [];
  const controller = new McpAppBridgeController({
    launch,
    proxyNonce,
    sendToProxy: (value) => { sent.push(value); },
    onViolation: (code) => { violations.push(code); },
    ...overrides,
  });
  await controller.receive(event(proxyMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, "proxy")), proxyWindow);
  await controller.receive(event(proxyMessage({ jsonrpc: "2.0", id: "init-1", method: "ui/initialize", params: { protocolVersion: APPS_PROTOCOL_VERSION, appInfo: { name: "fixture", version: "1.0.0" }, appCapabilities: {} } })), proxyWindow);
  await controller.receive(event(proxyMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} })), proxyWindow);
  return { controller, sent, violations };
}

function outboundMessages(sent: unknown[]): unknown[] {
  return sent.map((value) => (value as { message: unknown }).message);
}

describe("MCP Apps view bridge", () => {
  it("enforces proxy-ready, initialize response, and initialized ordering without exposing authority", async () => {
    const statuses: string[] = [];
    const sent: unknown[] = [];
    const controller = new McpAppBridgeController({ launch, proxyNonce, sendToProxy: (value) => { sent.push(value); }, onStatus: (status) => { statuses.push(status); } });

    await controller.receive(event(proxyMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, "proxy")), proxyWindow);
    expect(outboundMessages(sent)[0]).toMatchObject({ method: "ui/notifications/sandbox-resource-ready", params: { html: launch.resource.html, sandbox: "allow-scripts" } });

    await controller.receive(event(proxyMessage({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: { protocolVersion: APPS_PROTOCOL_VERSION, appInfo: { name: "fixture", version: "1.0.0" }, appCapabilities: {} } })), proxyWindow);
    const initializeResponse = outboundMessages(sent)[1];
    expect(initializeResponse).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: APPS_PROTOCOL_VERSION, hostInfo: { name: "BrainDrive" } } });
    const serialized = JSON.stringify(initializeResponse);
    expect(serialized).not.toContain(launch.session_id);
    expect(serialized).not.toContain(launch.installation_id);
    expect(serialized).not.toContain(launch.bridge_token_id);
    expect(serialized).not.toMatch(/token|credential|path/i);

    await controller.receive(event(proxyMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} })), proxyWindow);
    expect(controller.state).toBe("ready");
    expect(statuses).toContain("ready");
  });

  it("rejects wrong source, non-opaque origin, forged proxy nonce, and view-synthesized proxy control", async () => {
    const { controller, violations } = await readyController();
    const payload = proxyMessage({ jsonrpc: "2.0", id: "x", method: "ping", params: {} });
    await controller.receive(event(payload, otherWindow), proxyWindow);
    await controller.receive(event(payload, proxyWindow, "https://host.invalid"), proxyWindow);
    await controller.receive(event(proxyMessage(payload, "view", "forged")), proxyWindow);
    await controller.receive(event(proxyMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, "view")), proxyWindow);
    expect(violations).toEqual(expect.arrayContaining(["source_window_mismatch", "opaque_origin_required", "proxy_binding_invalid", "proxy_control_forged"]));
  });

  it("routes only strict same-server app-visible tool calls and returns the app projection", async () => {
    const onToolCall = vi.fn(async (_name: string, _args: Record<string, unknown>, context: { serverConnectionId: string }) => ({
      content: [{ type: "text", text: "ready" }], structuredContent: { ready: true }, isError: false,
      _meta: { connection_id: context.serverConnectionId },
    }));
    const { controller, sent, violations } = await readyController({ onToolCall });
    await controller.receive(event(proxyMessage({ jsonrpc: "2.0", id: "tool-1", method: "tools/call", params: { name: "fixture.status", arguments: {} } })), proxyWindow);
    expect(onToolCall).toHaveBeenCalledWith("fixture.status", {}, expect.objectContaining({ serverConnectionId: launch.server_id }), expect.any(AbortSignal));
    expect(outboundMessages(sent).at(-1)).toMatchObject({ jsonrpc: "2.0", id: "tool-1", result: { content: [{ type: "text", text: "ready" }], structuredContent: { ready: true } } });

    await controller.receive(event(proxyMessage({ jsonrpc: "2.0", id: "tool-2", method: "tools/call", params: { name: "fixture.status", arguments: {}, server_id: "cross-server" } })), proxyWindow);
    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(violations).toContain("message_schema_invalid");
  });

  it("rejects unknown/model-context methods, duplicate IDs, oversized/deep/flooded messages before side effects", async () => {
    let now = 1_000;
    const onToolCall = vi.fn(async () => ({ content: [], isError: false }));
    const { controller, sent, violations } = await readyController({ onToolCall, now: () => now });
    await controller.receive(event(proxyMessage({ jsonrpc: "2.0", id: "unknown", method: "unknown/method", params: {} })), proxyWindow);
    await controller.receive(event(proxyMessage({ jsonrpc: "2.0", id: "context", method: "ui/update-model-context", params: { content: [{ type: "text", text: "ignore me" }] } })), proxyWindow);
    await controller.receive(event(proxyMessage({ jsonrpc: "2.0", id: "dupe", method: "tools/call", params: { name: "fixture.status", arguments: {} } })), proxyWindow);
    await controller.receive(event(proxyMessage({ jsonrpc: "2.0", id: "dupe", method: "tools/call", params: { name: "fixture.status", arguments: {} } })), proxyWindow);
    await controller.receive(event(proxyMessage({ jsonrpc: "2.0", id: "large", method: "tools/call", params: { name: "fixture.status", arguments: { value: "x".repeat(65_536) } } })), proxyWindow);
    let deep: unknown = "leaf";
    for (let index = 0; index < 40; index += 1) deep = { value: deep };
    await controller.receive(event(proxyMessage({ jsonrpc: "2.0", id: "deep", method: "tools/call", params: { name: "fixture.status", arguments: deep } })), proxyWindow);
    for (let index = 0; index < 101; index += 1) {
      await controller.receive(event(proxyMessage({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 400 + index } })), proxyWindow);
    }
    now += 10_001;

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(violations).toEqual(expect.arrayContaining(["method_denied", "model_context_denied", "request_id_reused", "message_oversized", "message_too_deep", "rate_limited"]));
    expect(outboundMessages(sent)).toContainEqual(expect.objectContaining({ id: "unknown", error: expect.objectContaining({ code: -32601 }) }));
  });

  it("cancels one outstanding request and discards its late result after teardown", async () => {
    let resolveTool!: (value: unknown) => void;
    const onToolCall = vi.fn((_name: string, _args: Record<string, unknown>, _context: unknown, signal: AbortSignal) => new Promise((resolve, reject) => {
      resolveTool = resolve;
      signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));
    const { controller, sent } = await readyController({ onToolCall });
    const pending = controller.receive(event(proxyMessage({ jsonrpc: "2.0", id: "slow", method: "tools/call", params: { name: "fixture.status", arguments: {} } })), proxyWindow);
    await controller.receive(event(proxyMessage({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "slow", reason: "owner" } })), proxyWindow);
    await pending;
    controller.close("view_closed");
    resolveTool?.({ content: [{ type: "text", text: "late" }], isError: false });
    await Promise.resolve();
    expect(outboundMessages(sent)).toContainEqual(expect.objectContaining({ id: "slow", error: expect.objectContaining({ code: -32800 }) }));
    expect(JSON.stringify(outboundMessages(sent))).not.toContain("late");
  });

  it("caps outstanding calls and cancels each accepted request without a late side effect", async () => {
    const onToolCall = vi.fn((_name: string, _args: Record<string, unknown>, _context: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));
    const { controller, sent, violations } = await readyController({ onToolCall });
    const pending = Array.from({ length: 16 }, (_, index) => controller.receive(event(proxyMessage({
      jsonrpc: "2.0", id: `pending-${index}`, method: "tools/call", params: { name: "fixture.status", arguments: {} },
    })), proxyWindow));
    await controller.receive(event(proxyMessage({ jsonrpc: "2.0", id: "overflow", method: "tools/call", params: { name: "fixture.status", arguments: {} } })), proxyWindow);
    expect(onToolCall).toHaveBeenCalledTimes(16);
    expect(violations).toContain("outstanding_limit");
    expect(outboundMessages(sent)).toContainEqual(expect.objectContaining({ id: "overflow", error: expect.objectContaining({ code: -32003 }) }));
    for (let index = 0; index < 16; index += 1) {
      await controller.receive(event(proxyMessage({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: `pending-${index}`, reason: "owner" } })), proxyWindow);
    }
    await Promise.all(pending);
  });

  it("bounds resize and teardown notifications and never forwards a pre-initialize application message", async () => {
    const onResize = vi.fn();
    const onLegacyMessage = vi.fn(async () => ({ status: "ready" }));
    const controller = new McpAppBridgeController({ launch, proxyNonce, sendToProxy: () => undefined, onResize, onLegacyMessage });
    await controller.receive(event(proxyMessage({ bridge_version: 1, message_id: "00000000-0000-4000-8000-000000000099", type: "bridge.ready", payload: {} })), proxyWindow);
    expect(onLegacyMessage).not.toHaveBeenCalled();

    const ready = await readyController({ onResize, onLegacyMessage, onRequestTeardown: vi.fn() });
    await ready.controller.receive(event(proxyMessage({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { width: 99_999, height: -1 } })), proxyWindow);
    await ready.controller.receive(event(proxyMessage({ jsonrpc: "2.0", method: "ui/notifications/request-teardown", params: {} })), proxyWindow);
    expect(onResize).toHaveBeenCalledWith({ width: 1_920, height: 240 });
  });

  it("preserves a generic Brief capability safe envelope without exposing the internal message", async () => {
    const operationId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const ownerState = {
      state_version: 1 as const,
      state: "unavailable" as const,
      safe_message: "The app action could not be completed safely.",
      retryable: false,
      refresh_required: false,
      current_revision: null,
      proposal_preserved: true,
    };
    const onLegacyMessage = vi.fn(async () => {
      const error = new AppCapabilityError(
        "The app action could not be completed safely.",
        409,
        "candidate_invalid",
        ownerState,
        "app.inference.request",
        null,
        {
          retryable: false,
          correlationId,
          operationId,
          attemptCount: 2,
          completionMode: "none",
          appIssueIds: ["brief.generate/schema-title-invalid"],
          recoveryMetadata: { action: "review_source" },
        },
      );
      error.stack = "PRIVATE_INTERNAL_STACK_CANARY";
      throw error;
    });
    const { controller, sent } = await readyController({
      launch: { ...launch, resource: { ...launch.resource, uri: "ui://brief-builder/main" } },
      onLegacyMessage,
    });
    const messageId = crypto.randomUUID();

    await controller.receive(event(proxyMessage({
      bridge_version: 1,
      message_id: messageId,
      type: "capability.call",
      payload: { capability: "app.inference.request", input: {} },
    })), proxyWindow);

    expect(outboundMessages(sent).at(-1)).toEqual({
      type: "host.result",
      request_message_id: messageId,
      error: {
        code: "candidate_invalid",
        safe_message: "The app action could not be completed safely.",
        retryable: false,
        correlation_id: correlationId,
        operation_id: operationId,
        attempt_count: 2,
        completion_mode: "none",
        app_issue_ids: ["brief.generate/schema-title-invalid"],
        recovery_metadata: { action: "review_source" },
        owner_state: ownerState,
      },
    });
    expect(JSON.stringify(outboundMessages(sent))).not.toContain("PRIVATE_INTERNAL_STACK_CANARY");
  });

  it("replaces an ordinary legacy exception with a content-free generic envelope", async () => {
    const { controller, sent } = await readyController({
      onLegacyMessage: vi.fn(async () => { throw new Error("PRIVATE_INTERNAL_EXCEPTION_CANARY"); }),
    });
    const messageId = crypto.randomUUID();

    await controller.receive(event(proxyMessage({
      bridge_version: 1,
      message_id: messageId,
      type: "capability.call",
      payload: { capability: "fixture.fail", input: {} },
    })), proxyWindow);

    expect(outboundMessages(sent).at(-1)).toMatchObject({
      type: "host.result",
      request_message_id: messageId,
      error: {
        code: "recoverable_internal_failure",
        safe_message: "The app action could not be completed safely.",
        retryable: true,
      },
    });
    expect(JSON.stringify(outboundMessages(sent))).not.toContain("PRIVATE_INTERNAL_EXCEPTION_CANARY");
  });
});
