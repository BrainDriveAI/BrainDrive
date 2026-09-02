import { randomUUID } from "node:crypto";
import path from "node:path";

import type { z } from "zod";
import { CapabilityDispatcher } from "../../app-capabilities/dispatcher.js";
import { CapabilityRegistry } from "../../app-capabilities/registry.js";
import { AppArtifactExportService } from "../../app-capabilities/artifact-export.js";
import { AppArtifactStore } from "../storage/app-artifact-store.js";
import { AppDocumentStorageService } from "../storage/app-document-store.js";
import { BridgeMessageSchema, parseBridgeMessage } from "../contracts/mcp-app.js";
import type { AppLifecycleService } from "../lifecycle/service.js";
import { AppPlatformError } from "../lifecycle/errors.js";
import type { AppResourceDescriptor } from "../contracts/app-registry.js";
import type { AppRuntimeConnection } from "../lifecycle/process-supervisor.js";
import { McpConnectionManager } from "../../mcp/host/connection-manager.js";
import { SdkMcpPeer } from "../../mcp/host/sdk-peer.js";
import { ModernMcpAppsClient, appVisibleToolNames, identityForRuntime, type ModernMcpSession } from "./modern-client.js";
import { AppViewRegistry, type AppViewResumeRequest } from "./app-view-registry.js";
import type { AppArtifactRegistrationInput, AppArtifactRegistrationResult, AppChatModelContext, AppChatModelContextRequest, AppChatWorkspaceLaunch, AppChatWorkspaceLaunchInput, AppDocumentDeleteInput, AppDocumentDeleteResult, AppDocumentListResult, AppDocumentReadResult, AppDocumentWriteInput, AppExportPrepareInput, AppExportPrepared, AppLaunch, AppMcpHostAdapter, AppResourceReadResult } from "./app-host.js";
import type { CapabilityGrant } from "../lifecycle/store.js";
import type { CompleteMcpResult } from "../../mcp/result-envelope.js";
import {
  AppChatSessionRegistry,
  planAppChatContextGrants,
  projectAppChatContext,
  projectAppChatSession,
  selectAppChatWorkspace,
  type AppChatSessionRecord,
} from "./app-chat-session.js";
import {
  assertAppChatMetadataMatchesSession,
  buildAppChatModelContext,
  type AppChatActionExecutionRequest,
  type AppChatResourcePromptContent,
} from "./app-chat-model.js";
import { readVerifiedPackageResource } from "./app-package-resource.js";
import { readOrSeedAppDocument } from "./app-document-content.js";
import type { AppDocumentRole, AppDocumentStorageAuthority, AppStorageRetentionClass } from "../contracts/app-storage.js";

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
  readonly #chatSessions: AppChatSessionRegistry;
  readonly #connections = new Map<string, AppRuntimeConnection>();
  readonly #manager: McpConnectionManager;
  readonly #documentStorage: AppDocumentStorageService;
  readonly #artifactExports: AppArtifactExportService;
  readonly #activeChatActions = new Map<string, Array<{ installationId: string; capability: string; idempotencyKey: string }>>();

  constructor(
    private readonly lifecycle: AppLifecycleService,
    private readonly dispatcher: CapabilityDispatcher,
    private readonly now: () => number = Date.now,
    private readonly audit: (event: string, details: Record<string, unknown>) => void = () => undefined,
  ) {
    if (lifecycle.appId !== this.appId) throw new AppPlatformError("descriptor_invalid", "Brief host adapter lifecycle identity is invalid");
    this.#chatSessions = new AppChatSessionRegistry({ now });
    this.#manager = new McpConnectionManager({
      peerFactory: (identity) => {
        const connection = this.#connections.get(identity.runtimeId);
        if (!connection) throw new AppPlatformError("runtime_conflict", "Brief Builder runtime is unavailable");
        return new SdkMcpPeer({ url: connection.url, authorization: connection.authorization });
      },
    });
    const genericStorageRoot = path.join(this.lifecycle.dependencies.ownerDataRoot, "generic");
    this.#documentStorage = new AppDocumentStorageService(genericStorageRoot);
    this.#artifactExports = new AppArtifactExportService({
      store: new AppArtifactStore(genericStorageRoot),
      now: () => new Date(this.now()),
      audit: this.audit,
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

  async launchChatWorkspace(input: AppChatWorkspaceLaunchInput = {}): Promise<AppChatWorkspaceLaunch> {
    const descriptor = await this.lifecycle.ownerDescriptor();
    const record = descriptor.record;
    if (record.state !== "active" || !record.installation_id || !record.active_package_digest || !descriptor.grant || !descriptor.storedPackage) {
      throw new AppPlatformError("invalid_state_transition", "Brief Builder must be active before opening an app-chat workspace");
    }
    const packageDigest = record.active_package_digest as `sha256:${string}`;
    if (descriptor.grant.package_digest !== packageDigest || descriptor.grant.app_id !== record.app_id || descriptor.grant.publisher_id !== this.lifecycle.publisherId || descriptor.grant.installation_id !== record.installation_id) {
      throw new AppPlatformError("denied", "Brief Builder app-chat grant does not match the active installation", 403);
    }
    const selection = selectAppChatWorkspace(descriptor.storedPackage.manifest, {
      presentationId: input.presentationId,
      workspaceId: input.workspaceId,
    });
    const contextGrantPlan = planAppChatContextGrants(selection.workspace, descriptor.grant);
    const sessionPlan = this.#chatSessions.plan({
      ownerId: descriptor.grant.owner_id,
      accountId: descriptor.grant.owner_id,
      actorId: descriptor.grant.actor_id,
      appId: descriptor.grant.app_id,
      publisherId: descriptor.grant.publisher_id,
      installationId: record.installation_id,
      packageDigest,
      lifecycleGeneration: record.generation,
      grantId: descriptor.grant.grant_id,
      grantRevision: descriptor.grant.grant_revision,
      revocationGeneration: descriptor.grant.revocation_generation,
      presentationId: selection.presentation.presentation_id,
      workspaceId: selection.workspace.workspace_id,
      contextGrantSetDigest: contextGrantPlan.digest,
    }, input.resume);
    const context = await projectAppChatContext(selection.workspace, contextGrantPlan, {});
    const committed = this.#chatSessions.commit(sessionPlan);
    this.audit("app.chat_workspace.session_opened", {
      app_id: this.appId,
      installation_id: committed.installationId,
      package_digest: committed.packageDigest,
      view_id: committed.viewId,
      operation_id: committed.operationId,
      presentation_id: committed.presentationId,
      workspace_id: committed.workspaceId,
      lifecycle_generation: committed.lifecycleGeneration,
      grant_revision: committed.grantRevision,
      revocation_generation: committed.revocationGeneration,
      context_grant_set_digest: committed.contextGrantSetDigest,
      context_count: context.items.length,
      reconnect_outcome: committed.resumed ? "resumed" : "created",
      outcome: "allowed",
    });
    return {
      launch_version: 1,
      kind: "chat_workspace",
      session: projectAppChatSession(committed),
      resumed: committed.resumed,
      presentation: selection.presentation,
      workspace: {
        workspace_version: selection.workspace.workspace_version,
        workspace_id: selection.workspace.workspace_id,
        title: selection.workspace.title,
        description: selection.workspace.description,
        default_document_id: selection.workspace.default_document_id,
        empty_state: selection.workspace.empty_state ?? null,
        documents: selection.workspace.documents,
        resources: selection.workspace.resources,
        actions: selection.workspace.actions,
      },
      context,
    };
  }

  async readChatWorkspaceSession(sessionId: string): Promise<AppChatWorkspaceLaunch["session"]> {
    return projectAppChatSession(await this.requireChatSession(sessionId));
  }

  async listAppDocuments(sessionId: string): Promise<AppDocumentListResult> {
    const { session, descriptor } = await this.requireChatSessionForStorage(sessionId);
    await this.#documentStorage.initialize();
    const authority = this.storageAuthority(session, descriptor.grant!);
    await this.#documentStorage.bindActiveAuthority(authority);
    return this.#documentStorage.listDocuments(authority);
  }

  async readAppDocument(sessionId: string, documentId: string): Promise<AppDocumentReadResult> {
    const { session, descriptor, document } = await this.requireChatSessionForDocument(sessionId, documentId);
    const bindingId = document.data_binding_id ?? document.document_id;
    await this.#documentStorage.initialize();
    const authority = this.storageAuthority(session, descriptor.grant!);
    await this.#documentStorage.bindActiveAuthority(authority);
    const record = await this.#documentStorage.readDocument(authority, document.document_id)
      ?? await readOrSeedAppDocument({
        documentStorage: this.#documentStorage,
        authority,
        storedPackage: descriptor.storedPackage!,
        document,
        operationId: randomUUID(),
        idempotencyKey: `document-seed-${randomUUID()}`,
        audit: this.audit,
      });
    return {
      result_version: 1,
      state: record ? "current" : "missing",
      document_id: document.document_id,
      document_binding_id: bindingId,
      record,
    };
  }

  async readAppResource(sessionId: string, resourceId: string): Promise<AppResourceReadResult> {
    const { session, descriptor } = await this.requireChatSessionForStorage(sessionId);
    const selection = selectAppChatWorkspace(descriptor.storedPackage!.manifest, {
      presentationId: session.presentationId,
      workspaceId: session.workspaceId,
    });
    const resource = selection.workspace.resources.find((candidate) => candidate.resource_id === resourceId);
    if (!resource) throw new AppPlatformError("not_found_within_scope", "App package resource is not declared for this workspace", 404);
    return readVerifiedPackageResource(descriptor.storedPackage!, resource);
  }

  async writeAppDocument(sessionId: string, documentId: string, input: AppDocumentWriteInput): Promise<AppDocumentReadResult> {
    const { session, descriptor, document } = await this.requireChatSessionForDocument(sessionId, documentId);
    if (!document.editable) throw new AppPlatformError("denied", "App document is read-only in this workspace", 403);
    const bindingId = document.data_binding_id ?? document.document_id;
    await this.#documentStorage.initialize();
    const authority = this.storageAuthority(session, descriptor.grant!);
    await this.#documentStorage.bindActiveAuthority(authority);
    const result = await this.#documentStorage.writeDocument({
      request_version: 1,
      authority,
      document_id: document.document_id,
      document_binding_id: bindingId,
      record_kind: document.role === "advanced_resource" ? "state" : "document",
      role: documentStorageRole(document),
      retention_class: input.retention_class ?? defaultRetentionClassForDocument(document),
      media_type: input.media_type ?? (typeof input.content === "string" ? "text/markdown" : "application/json"),
      expected_revision: input.expected_revision,
      operation_id: input.operation_id,
      idempotency_key: input.idempotency_key,
      content: input.content,
    });
    this.audit(result.audit.event, result.audit);
    return {
      result_version: 1,
      state: "current",
      document_id: document.document_id,
      document_binding_id: bindingId,
      record: result.record,
    };
  }

  async deleteAppDocument(sessionId: string, documentId: string, input: AppDocumentDeleteInput): Promise<AppDocumentDeleteResult> {
    const { session, descriptor, document } = await this.requireChatSessionForDocument(sessionId, documentId);
    if (!document.editable) throw new AppPlatformError("denied", "App document is read-only in this workspace", 403);
    await this.#documentStorage.initialize();
    const authority = this.storageAuthority(session, descriptor.grant!);
    await this.#documentStorage.bindActiveAuthority(authority);
    const result = await this.#documentStorage.deleteDocument({
      request_version: 1,
      authority,
      document_id: document.document_id,
      expected_revision: input.expected_revision,
      operation_id: input.operation_id,
      idempotency_key: input.idempotency_key,
      delete_mode: input.delete_mode ?? "tombstone",
    });
    this.audit(result.audit.event, result.audit);
    return result;
  }

  async registerAppArtifact(input: AppArtifactRegistrationInput): Promise<AppArtifactRegistrationResult> {
    const descriptor = await this.lifecycle.ownerDescriptor();
    if (descriptor.record.state !== "active" || !descriptor.record.installation_id || !descriptor.record.active_package_digest || !descriptor.grant) {
      throw new AppPlatformError("invalid_state_transition", "Brief Builder must be active before registering artifacts");
    }
    const result = await this.#artifactExports.registerArtifact({
      ...input,
      authority: this.artifactAuthority(descriptor.grant, descriptor.record.installation_id, descriptor.record.active_package_digest as `sha256:${string}`, descriptor.record.generation),
    });
    return { result_version: 1, artifact: result.record, replayed: result.replayed };
  }

  async requestAppExport(input: AppExportPrepareInput, ownerActorId: string): Promise<AppExportPrepared> {
    const descriptor = await this.lifecycle.ownerDescriptor();
    if (descriptor.record.state !== "active" || !descriptor.record.installation_id || !descriptor.record.active_package_digest || !descriptor.grant) {
      throw new AppPlatformError("invalid_state_transition", "Brief Builder must be active before requesting exports");
    }
    if (ownerActorId !== descriptor.grant.actor_id && ownerActorId !== "owner") {
      throw new AppPlatformError("denied", "Owner actor is not bound to this app installation", 403);
    }
    return this.#artifactExports.prepareExport({
      ...input,
      owner_confirmed: input.owner_confirmed === true,
      authority: this.artifactAuthority(descriptor.grant, descriptor.record.installation_id, descriptor.record.active_package_digest as `sha256:${string}`, descriptor.record.generation),
    });
  }

  async buildChatWorkspaceModelContext(request: AppChatModelContextRequest): Promise<AppChatModelContext> {
    const { session, descriptor, workspace } = await this.requireChatSessionForModel(request);
    const context = await buildAppChatModelContext({
      metadata: request,
      session,
      workspace,
      storedPackage: descriptor.storedPackage!,
      resolveResourcePromptContent: (resource) => this.resolveOwnerEditableResourcePrompt(resource, session, descriptor, workspace),
      executeAction: (actionRequest) => this.executeChatWorkspaceAction(actionRequest),
    });
    return {
      prompt_context: context.promptContext,
      tools: context.tools,
      evidence: {
        action_exposure: context.evidence.actionExposure,
        resources: context.evidence.resources,
      },
    };
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
    const closedChat = this.#chatSessions.close(this.appId, sessionId);
    if (closedChat.closed) {
      this.cancelChatActions(sessionId);
      return true;
    }
    const session = this.#sessions.get(sessionId); if (!session) return false;
    if (!this.#views.close(this.appId, sessionId).closed) return false;
    this.cancelSessionOperations(session);
    this.lifecycle.dependencies.tokenBroker.revokeView(session.viewId);
    return this.#sessions.delete(sessionId);
  }
  async closeAll(): Promise<void> {
    for (const id of [...this.#sessions.keys()]) this.close(id);
    for (const session of this.#chatSessions.activeSessions()) this.cancelChatActions(session.sessionId);
    await this.#manager.closeAll();
    this.#connections.clear();
    this.#views.clear();
    this.#chatSessions.clear();
    this.#activeChatActions.clear();
  }
  sessionCountForTest(): number { return this.#sessions.size + this.#chatSessions.sessionCountForTest(); }

  private async executeChatWorkspaceAction(request: AppChatActionExecutionRequest): Promise<unknown> {
    const { session, descriptor, workspace } = await this.requireChatSessionForModel(request.metadata);
    const action = workspace.actions.find((candidate) => candidate.action_id === request.action.action_id);
    if (!action || action.model_exposure !== "available") throw new AppPlatformError("denied", "App action is not declared for model use", 403);
    if (action.required_capabilities.length !== 1) throw new AppPlatformError("incompatible_schema", "App action must declare exactly one host capability for model execution", 409);
    const requiredCapability = action.required_capabilities[0]!;
    const manifest = descriptor.storedPackage!.manifest;
    const manifestRequests = manifest.manifest_version === 2 ? manifest.requested_capabilities : [];
    const requestedPurposes = manifest.manifest_version === 2 ? manifest.requested_inference_purposes : [];
    this.rememberChatAction(session.sessionId, session.installationId, requiredCapability.name, request.idempotencyKey);
    try {
      return await this.dispatcher.execute(requiredCapability.name, requiredCapability.version, request.actionInput, {
        appId: session.appId,
        installationId: session.installationId,
        packageDigest: session.packageDigest,
        sessionId: session.sessionId,
        viewId: session.viewId,
        lifecycleGeneration: session.lifecycleGeneration,
        grantId: session.grantId,
        grantRevision: session.grantRevision,
        revocationGeneration: session.revocationGeneration,
        manifestRequests,
        requestedPurposes,
        grant: descriptor.grant!,
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        deadlineAt: this.now() + 30_000,
        ownerConfirmation: {
          confirmed: request.ownerConfirmed,
          proofId: request.ownerConfirmed ? randomUUID() : undefined,
        },
      });
    } finally {
      this.forgetChatAction(session.sessionId, requiredCapability.name, request.idempotencyKey);
    }
  }

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

  private rememberChatAction(sessionId: string, installationId: string, capability: string, idempotencyKey: string): void {
    const current = this.#activeChatActions.get(sessionId) ?? [];
    current.push({ installationId, capability, idempotencyKey });
    this.#activeChatActions.set(sessionId, current);
  }

  private forgetChatAction(sessionId: string, capability: string, idempotencyKey: string): void {
    const next = (this.#activeChatActions.get(sessionId) ?? []).filter((item) => item.capability !== capability || item.idempotencyKey !== idempotencyKey);
    if (next.length === 0) this.#activeChatActions.delete(sessionId);
    else this.#activeChatActions.set(sessionId, next);
  }

  private cancelChatActions(sessionId: string): void {
    const actions = this.#activeChatActions.get(sessionId) ?? [];
    for (const action of actions) this.dispatcher.cancel(this.appId, action.installationId, action.capability, action.idempotencyKey);
    this.#activeChatActions.delete(sessionId);
  }

  private async requireSession(sessionId: string): Promise<Session> {
    const session = this.#sessions.get(sessionId);
    if (!session || !this.#views.isCurrentSession(this.appId, sessionId) || Date.parse(session.expiresAt) <= this.now()) throw new AppPlatformError("session_closed", "Brief Builder session is closed", 410);
    const record = await this.lifecycle.status();
    if (record.state !== "active" || record.installation_id !== session.installationId || record.active_package_digest !== session.packageDigest || record.generation !== session.lifecycleGeneration) { this.close(sessionId); throw new AppPlatformError("session_closed", "Brief Builder lifecycle authority changed", 410); }
    return session;
  }

  private async requireChatSessionForModel(metadata: AppChatModelContextRequest): Promise<{
    session: AppChatSessionRecord;
    descriptor: Awaited<ReturnType<AppLifecycleService["ownerDescriptor"]>>;
    workspace: ReturnType<typeof selectAppChatWorkspace>["workspace"];
  }> {
    if (metadata.app_id !== this.appId) throw new AppPlatformError("denied", "App-chat model session targets a different app", 403);
    const session = await this.requireChatSession(metadata.session_id);
    assertAppChatMetadataMatchesSession(metadata, session);
    const descriptor = await this.lifecycle.ownerDescriptor();
    const selection = selectAppChatWorkspace(descriptor.storedPackage!.manifest, {
      presentationId: session.presentationId,
      workspaceId: session.workspaceId,
    });
    return { session, descriptor, workspace: selection.workspace };
  }

  private async requireChatSession(sessionId: string): Promise<AppChatSessionRecord> {
    const session = this.#chatSessions.read(this.appId, sessionId);
    const current = await this.lifecycle.status();
    if (current.state !== "active" || current.installation_id !== session.installationId || current.active_package_digest !== session.packageDigest || current.generation !== session.lifecycleGeneration) {
      this.close(session.sessionId);
      throw new AppPlatformError("session_closed", "Brief Builder app-chat session closed because lifecycle authority changed", 410);
    }
    const descriptor = await this.lifecycle.ownerDescriptor();
    if (
      !descriptor.grant ||
      !descriptor.storedPackage ||
      descriptor.grant.grant_id !== session.grantId ||
      descriptor.grant.grant_revision !== session.grantRevision ||
      descriptor.grant.revocation_generation !== session.revocationGeneration ||
      descriptor.grant.revoked_at !== null ||
      descriptor.grant.package_digest !== session.packageDigest ||
      descriptor.grant.installation_id !== session.installationId
    ) {
      this.close(session.sessionId);
      throw new AppPlatformError("session_closed", "Brief Builder app-chat session closed because grant authority changed", 410);
    }
    return this.#chatSessions.renew(this.appId, session.sessionId);
  }

  private async requireChatSessionForDocument(sessionId: string, documentId: string): Promise<{
    session: AppChatSessionRecord;
    descriptor: Awaited<ReturnType<AppLifecycleService["ownerDescriptor"]>>;
    document: ReturnType<typeof selectAppChatWorkspace>["workspace"]["documents"][number];
  }> {
    const { session, descriptor } = await this.requireChatSessionForStorage(sessionId);
    const selection = selectAppChatWorkspace(descriptor.storedPackage!.manifest, {
      presentationId: session.presentationId,
      workspaceId: session.workspaceId,
    });
    const document = selection.workspace.documents.find((candidate) => candidate.document_id === documentId);
    if (!document) throw new AppPlatformError("not_found_within_scope", "App document is not declared for this workspace", 404);
    if (document.role === "conversation" || !document.data_binding_id) {
      throw new AppPlatformError("denied", "Workspace item is not bound to app document storage", 403);
    }
    return { session, descriptor, document };
  }

  private async resolveOwnerEditableResourcePrompt(
    resource: AppResourceDescriptor,
    session: AppChatSessionRecord,
    descriptor: Awaited<ReturnType<AppLifecycleService["ownerDescriptor"]>>,
    workspace: ReturnType<typeof selectAppChatWorkspace>["workspace"],
  ): Promise<AppChatResourcePromptContent | null> {
    const document = workspace.documents.find((candidate) =>
      candidate.resource_id === resource.resource_id &&
      candidate.editable &&
      Boolean(candidate.data_binding_id)
    );
    if (!document) return null;
    const authority = this.storageAuthority(session, descriptor.grant!);
    await this.#documentStorage.initialize();
    await this.#documentStorage.bindActiveAuthority(authority);
    const record = await readOrSeedAppDocument({
      documentStorage: this.#documentStorage,
      authority,
      storedPackage: descriptor.storedPackage!,
      document,
      operationId: randomUUID(),
      idempotencyKey: `resource-override-seed-${randomUUID()}`,
      audit: this.audit,
    });
    if (!record) return null;
    return {
      content: appDocumentPromptText(record.content),
      contentDigest: record.content_digest as `sha256:${string}`,
      source: "owner_override",
      ownerRevision: record.revision,
    };
  }

  private async requireChatSessionForStorage(sessionId: string): Promise<{
    session: AppChatSessionRecord;
    descriptor: Awaited<ReturnType<AppLifecycleService["ownerDescriptor"]>>;
  }> {
    const session = await this.requireChatSession(sessionId);
    const descriptor = await this.lifecycle.ownerDescriptor();
    if (
      !descriptor.grant ||
      !descriptor.storedPackage ||
      descriptor.grant.grant_id !== session.grantId ||
      descriptor.grant.grant_revision !== session.grantRevision ||
      descriptor.grant.revocation_generation !== session.revocationGeneration ||
      descriptor.grant.revoked_at !== null ||
      descriptor.grant.package_digest !== session.packageDigest ||
      descriptor.grant.installation_id !== session.installationId
    ) {
      this.close(session.sessionId);
      throw new AppPlatformError("session_closed", "Brief Builder app-chat session closed because grant authority changed", 410);
    }
    return { session, descriptor };
  }

  private storageAuthority(session: AppChatSessionRecord, grant: CapabilityGrant): AppDocumentStorageAuthority {
    return {
      authority_version: 1,
      owner_id: session.ownerId,
      actor_id: session.actorId,
      app_id: session.appId,
      publisher_id: session.publisherId,
      installation_id: session.installationId,
      package_digest: session.packageDigest,
      lifecycle_generation: session.lifecycleGeneration,
      grant_id: grant.grant_id,
      grant_revision: grant.grant_revision,
      revocation_generation: grant.revocation_generation,
    };
  }

  private artifactAuthority(
    grant: CapabilityGrant,
    installationId: string,
    packageDigest: `sha256:${string}`,
    lifecycleGeneration: number,
  ): AppDocumentStorageAuthority {
    return {
      authority_version: 1,
      owner_id: grant.owner_id,
      actor_id: grant.actor_id,
      app_id: grant.app_id,
      publisher_id: grant.publisher_id,
      installation_id: installationId,
      package_digest: packageDigest,
      lifecycle_generation: lifecycleGeneration,
      grant_id: grant.grant_id,
      grant_revision: grant.grant_revision,
      revocation_generation: grant.revocation_generation,
    };
  }
}

function documentStorageRole(document: ReturnType<typeof selectAppChatWorkspace>["workspace"]["documents"][number]): AppDocumentRole {
  if (document.role === "source_document") return "source_document";
  if (document.role === "derived_document") return "derived_document";
  if (document.role === "recovery" || document.role === "recovery_document") return "recovery_document";
  if (document.role === "action_result_document" || document.model_access === "action_result") return "action_result_document";
  return "app_state";
}

function defaultRetentionClassForDocument(document: ReturnType<typeof selectAppChatWorkspace>["workspace"]["documents"][number]): AppStorageRetentionClass {
  const role = documentStorageRole(document);
  if (role === "recovery_document") return "rollback_recovery_window";
  if (role === "action_result_document") return "durable_operation_lookup";
  return "durable_owner_data";
}

function appDocumentPromptText(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
}
