import { randomUUID } from "node:crypto";

import type { z } from "zod";
import { CapabilityDispatcher } from "../../app-capabilities/dispatcher.js";
import { CapabilityRegistry } from "../../app-capabilities/registry.js";
import { BridgeMessageSchema, parseBridgeMessage } from "../contracts/mcp-app.js";
import type { AppLifecycleService } from "../lifecycle/service.js";
import { AppPlatformError } from "../lifecycle/errors.js";
import type { AppRuntimeConnection } from "../lifecycle/process-supervisor.js";
import { McpConnectionManager } from "../../mcp/host/connection-manager.js";
import { SdkMcpPeer } from "../../mcp/host/sdk-peer.js";
import { ModernMcpAppsClient, appVisibleToolNames, identityForRuntime, type ModernMcpSession } from "./modern-client.js";
import { AppViewRegistry, type AppViewResumeRequest } from "./app-view-registry.js";
import type { AppLaunch, AppMcpHostAdapter } from "./app-host.js";
import type { CapabilityGrant } from "../lifecycle/store.js";
import type { CompleteMcpResult } from "../../mcp/result-envelope.js";

type BridgeMessage = z.infer<typeof BridgeMessageSchema>;
type Session = {
  sessionId: string; viewId: string; operationId: string; installationId: string; packageDigest: `sha256:${string}`;
  lifecycleGeneration: number; bridgeTokenId: string; expiresAt: string; client: ModernMcpAppsClient; mcp: ModernMcpSession;
  resource: AppLaunch["resource"]; grant: CapabilityGrant; allowedCapabilities: Set<string>; allowedTools: Set<string>; seen: Set<string>;
  inferenceOperations: Set<string>;
};

export class BriefAppHostAdapter implements AppMcpHostAdapter {
  readonly appId = "ai.braindrive.brief-builder";
  readonly routeKey = "brief-builder";
  readonly #sessions = new Map<string, Session>();
  readonly #views = new AppViewRegistry();
  readonly #connections = new Map<string, AppRuntimeConnection>();
  readonly #manager: McpConnectionManager;

  constructor(
    private readonly lifecycle: AppLifecycleService,
    private readonly dispatcher: CapabilityDispatcher,
    private readonly now: () => number = Date.now,
    private readonly audit: (event: string, details: Record<string, unknown>) => void = () => undefined,
  ) {
    if (lifecycle.appId !== this.appId) throw new AppPlatformError("descriptor_invalid", "Brief host adapter lifecycle identity is invalid");
    this.#manager = new McpConnectionManager({
      peerFactory: (identity) => {
        const connection = this.#connections.get(identity.runtimeId);
        if (!connection) throw new AppPlatformError("runtime_conflict", "Brief Builder runtime is unavailable");
        return new SdkMcpPeer({ url: connection.url, authorization: connection.authorization });
      },
    });
  }

  static create(lifecycle: AppLifecycleService, registrations: ConstructorParameters<typeof CapabilityRegistry>[0], audit?: (event: string, details: Record<string, unknown>) => void): BriefAppHostAdapter {
    return new BriefAppHostAdapter(lifecycle, new CapabilityDispatcher(new CapabilityRegistry(registrations)), Date.now, audit);
  }

  async launch(entryPoint: "direct" | "career" = "direct", resume?: AppViewResumeRequest): Promise<AppLaunch> {
    if (entryPoint !== "direct") throw new AppPlatformError("denied", "Brief Builder supports direct entry only", 403);
    const descriptor = await this.lifecycle.ownerDescriptor();
    const record = descriptor.record;
    if (record.state !== "active" || !record.installation_id || !record.active_package_digest || !descriptor.grant) throw new AppPlatformError("invalid_state_transition", "Brief Builder must be active before launch");
    const packageDigest = record.active_package_digest as `sha256:${string}`;
    const connection = this.lifecycle.dependencies.supervisor.connectionFor(record.installation_id);
    if (connection.runtime.package_digest !== packageDigest) throw new AppPlatformError("runtime_conflict", "Brief Builder runtime does not match the installed package");
    const identity = identityForRuntime(connection, { appId: this.appId, publisherId: this.lifecycle.publisherId, serverId: this.routeKey });
    this.#connections.set(identity.runtimeId, connection);
    const client = new ModernMcpAppsClient({ manager: this.#manager, identity });
    this.audit("brief.mcp.launch_stage", { app_id: this.appId, installation_id: record.installation_id, stage: "negotiating" });
    const mcp = await client.negotiate();
    this.audit("brief.mcp.launch_stage", { app_id: this.appId, installation_id: record.installation_id, stage: "reading_resource" });
    const loaded = await client.readAppResource(mcp, `ui://${this.routeKey}/main`, packageDigest);
    const plan = this.#views.plan({ appId: this.appId, installationId: record.installation_id, packageDigest, lifecycleGeneration: record.generation, connectionId: mcp.connectionId, connectionGeneration: mcp.handle.generation, entryPoint }, resume);
    const issued = await this.lifecycle.issueSession({ audience: "app_bridge", capabilities: ["brief.records.read"], operationId: plan.operationId, idempotencyKey: `brief-view-${plan.operationId}`, viewId: plan.viewId, connectionId: mcp.connectionId });
    const view = this.#views.commit(plan);
    if (view.supersededSessionId) {
      const superseded = this.#sessions.get(view.supersededSessionId);
      if (superseded) this.cancelSessionOperations(superseded);
      this.#sessions.delete(view.supersededSessionId);
    }
    const allowedCapabilities = new Set(descriptor.grant.capabilities);
    const allowedTools = new Set(appVisibleToolNames(mcp.tools));
    this.#sessions.set(view.sessionId, { sessionId: view.sessionId, viewId: view.viewId, operationId: view.operationId, installationId: record.installation_id, packageDigest, lifecycleGeneration: record.generation, bridgeTokenId: issued.claims.token_id, expiresAt: issued.claims.expires_at, client, mcp, resource: loaded.resource, grant: descriptor.grant, allowedCapabilities, allowedTools, seen: new Set(), inferenceOperations: new Set() });
    this.audit("brief.mcp.launch_stage", { app_id: this.appId, installation_id: record.installation_id, stage: "ready" });
    return { launch_version: 1, session_id: view.sessionId, installation_id: record.installation_id, view_id: view.viewId, operation_id: view.operationId, bridge_generation: view.bridgeGeneration, resumed: view.resumed, bridge_token_id: issued.claims.token_id, server_id: mcp.connectionId, expires_at: issued.claims.expires_at, protocol: { core: mcp.protocolVersion, apps_extension: mcp.extensionVersion, server_name: mcp.serverName, server_version: mcp.serverVersion }, resource: loaded.resource, allowed_tools: [...allowedTools], allowed_capabilities: [...allowedCapabilities], entry_point: "direct" };
  }

  async handleBridge(sessionId: string, raw: unknown, context: { origin: string; sourceMatches: boolean }): Promise<{ status: "ready" } | { status: "completed"; result: CompleteMcpResult } | { status: "capability_completed"; result: unknown }> {
    const session = await this.requireSession(sessionId);
    if (context.origin !== "null" || !context.sourceMatches) { this.close(sessionId); throw new AppPlatformError("bridge_denied", "Sandbox message binding is invalid", 403); }
    let message: BridgeMessage;
    try { message = parseBridgeMessage(raw); } catch { throw new AppPlatformError("bridge_malformed", "Brief Builder bridge message is invalid", 400); }
    if (message.app_id !== this.appId || message.installation_id !== session.installationId || message.view_id !== session.viewId || message.operation_id !== session.operationId || ("token_id" in message.payload && message.payload.token_id !== session.bridgeTokenId)) throw new AppPlatformError("bridge_denied", "Brief Builder bridge identity is invalid", 403);
    if (Math.abs(this.now() - Date.parse(message.sent_at)) > 30_000 || session.seen.has(message.message_id)) throw new AppPlatformError("bridge_replayed", "Brief Builder bridge message is stale or replayed", 409);
    session.seen.add(message.message_id);
    if (message.type === "bridge.ready") return { status: "ready" };
    if (message.type === "operation.cancel") {
      const target = message.payload.target_operation_id;
      if (!session.inferenceOperations.has(target)) throw new AppPlatformError("bridge_denied", "Cancellation target is outside this app session", 403);
      return { status: "capability_completed", result: { cancelled: this.dispatcher.cancel(this.appId, session.installationId, "app.inference.request", `brief-${target}`) } };
    }
    if (message.type !== "capability.call" || !session.allowedCapabilities.has(message.payload.capability)) throw new AppPlatformError("bridge_denied", "Bridge capability is unavailable", 403);
    const requestOperationId = message.payload.request_operation_id ?? message.message_id;
    if (message.payload.capability === "app.inference.request") session.inferenceOperations.add(requestOperationId);
    return { status: "capability_completed", result: await this.dispatch(message.payload.capability, message.payload.input, requestOperationId, false, undefined) };
  }

  async handleOwnerCapability(capability: unknown, input: unknown, operationId: string, hostOwnerConfirmed: boolean, _ownerActorId: string): Promise<unknown> {
    return this.dispatch(capability, input, operationId, hostOwnerConfirmed, hostOwnerConfirmed ? randomUUID() : undefined);
  }

  async handleServerCapability(_token: string, _capability: unknown, _capabilityVersion: number, _input: unknown, _operationId: string, _idempotencyKey: string): Promise<unknown> { throw new AppPlatformError("denied", "Brief Builder server-origin capability calls are not enabled", 403); }
  async issueServerCapabilityAuthority(): Promise<{ token: string; expiresAt: string }> { throw new AppPlatformError("denied", "Brief Builder server-origin capability calls are not enabled", 403); }
  async handleAppsBridge(): Promise<unknown> { throw new AppPlatformError("bridge_denied", "Brief Builder Apps bridge methods are not enabled", 403); }
  cancelAppsBridgeRequest(): boolean { return false; }
  async placeCareerReturn(): Promise<unknown> { throw new AppPlatformError("denied", "Brief Builder has no Career authority", 403); }
  async finalizeOwnerExport(): Promise<unknown> { throw new AppPlatformError("denied", "Brief Builder has no export authority", 403); }

  close(sessionId: string): boolean {
    const session = this.#sessions.get(sessionId); if (!session) return false;
    if (!this.#views.close(this.appId, sessionId).closed) return false;
    this.cancelSessionOperations(session);
    this.lifecycle.dependencies.tokenBroker.revokeView(session.viewId);
    return this.#sessions.delete(sessionId);
  }
  async closeAll(): Promise<void> { for (const id of [...this.#sessions.keys()]) this.close(id); await this.#manager.closeAll(); this.#connections.clear(); this.#views.clear(); }
  sessionCountForTest(): number { return this.#sessions.size; }

  private async dispatch(capability: unknown, input: unknown, operationId: string, ownerConfirmed: boolean, proofId?: string): Promise<unknown> {
    const descriptor = await this.lifecycle.ownerDescriptor();
    if (descriptor.record.state !== "active" || !descriptor.record.installation_id || !descriptor.record.active_package_digest || !descriptor.grant || !descriptor.storedPackage) throw new AppPlatformError("denied", "Brief Builder capability authority is unavailable", 403);
    const manifest = descriptor.storedPackage.manifest;
    const manifestRequests = manifest.manifest_version === 2 ? manifest.requested_capabilities : [];
    const requestedPurposes = manifest.manifest_version === 2 ? manifest.requested_inference_purposes : [];
    return this.dispatcher.execute(capability, 1, input, { appId: this.appId, installationId: descriptor.record.installation_id, packageDigest: descriptor.record.active_package_digest as `sha256:${string}`, manifestRequests, requestedPurposes, grant: descriptor.grant, operationId, idempotencyKey: `brief-${operationId}`, deadlineAt: this.now() + 30_000, ownerConfirmation: { confirmed: ownerConfirmed, proofId } });
  }

  private cancelSessionOperations(session: Session): void {
    for (const operationId of session.inferenceOperations) this.dispatcher.cancel(this.appId, session.installationId, "app.inference.request", `brief-${operationId}`);
  }

  private async requireSession(sessionId: string): Promise<Session> {
    const session = this.#sessions.get(sessionId);
    if (!session || !this.#views.isCurrentSession(this.appId, sessionId) || Date.parse(session.expiresAt) <= this.now()) throw new AppPlatformError("session_closed", "Brief Builder session is closed", 410);
    const record = await this.lifecycle.status();
    if (record.state !== "active" || record.installation_id !== session.installationId || record.active_package_digest !== session.packageDigest || record.generation !== session.lifecycleGeneration) { this.close(sessionId); throw new AppPlatformError("session_closed", "Brief Builder lifecycle authority changed", 410); }
    return session;
  }
}
