import { randomUUID } from "node:crypto";
import { z } from "zod";

import { BridgeMessageSchema, McpAppResourceSchema, parseBridgeMessage } from "../contracts/mcp-app.js";
import { assertContentFreeResumeRecoveryReconciliationAudit } from "../contracts/audit.js";
import { AppsBridgeEnvelopeSchema } from "../contracts/spec-05-foundation.js";
import { ContractViolation } from "../contracts/errors.js";
import type { AppLifecycleService } from "../lifecycle/service.js";
import { AppPlatformError } from "../lifecycle/errors.js";
import type { AppRuntimeConnection } from "../lifecycle/process-supervisor.js";
import {
  ModernMcpAppsClient,
  appVisibleToolNames,
  identityForRuntime,
  type LoadedAppResource,
  type ModernMcpSession,
} from "./modern-client.js";
import { McpConnectionManager } from "../../mcp/host/connection-manager.js";
import { SdkMcpPeer } from "../../mcp/host/sdk-peer.js";
import { projectMcpResult, type CompleteMcpResult } from "../../mcp/result-envelope.js";
import type { CapabilityGrant } from "../lifecycle/store.js";
import type { CapabilityExecutionContext, ResumeCapabilityRouter } from "../../resume-domain/capabilities.js";
import {
  requireHostOwnerCapabilityAuthorization,
  issueHostOwnerCapabilityAuthorization,
  restrictedAuthorityFromTokenClaims,
} from "../../resume-domain/capability-policy.js";
import { FactDecisionInputSchema, issueHostOwnerDecisionEvidence } from "../../resume-domain/career-data.js";
import { ResumeDomainError } from "../../resume-domain/errors.js";
import { CapabilityNameSchema } from "../contracts/package.js";
import type { CareerReturnSummary } from "../../resume-domain/career.js";
import type { ResumeExportBroker } from "../../resume-renderer/export-broker.js";
import { CapabilityOperationCoordinator, type CapabilityOperationDisposition } from "../../app-capabilities/operations.js";
import {
  ResumeRecoveryOperationLifecycleProjectionSchema,
  ResumeRecoveryReconciliationQuerySchema,
  type ResumeRecoveryOperationLifecycleProjection,
} from "../../app-capabilities/recovery-reconciliation.js";
import { canonicalInputDigest } from "../contracts/common.js";
import { resolveAppCapability, type ResumeAppCapabilityName as AppCapabilityName, type AppDataCapability } from "../../app-capabilities/resume-registry.js";
import { InstalledAppInferenceExecutor, InstalledAppInferenceInvocationSchema } from "../../app-inference/installed-program.js";
import { createInstalledAppInferenceProgramClient } from "../../app-inference/installed-program-mcp.js";
import { AppViewRegistry, type AppViewResumeRequest } from "./app-view-registry.js";
import {
  AppChatSessionRegistry,
  planAppChatContextGrants,
  projectAppChatContext,
  projectAppChatSession,
  selectAppChatWorkspace,
  type AppChatSessionAuthority,
  type AppChatSessionRecord,
} from "./app-chat-session.js";
import {
  assertAppChatMetadataMatchesSession,
  buildAppChatModelContext,
  type AppChatActionExecutionRequest,
} from "./app-chat-model.js";
import type { AppChatModelContext, AppChatModelContextRequest, AppChatWorkspaceLaunch, AppChatWorkspaceLaunchInput, AppLaunch } from "./app-host-types.js";
import { CurrentProcessRecoveryBindingRegistry } from "./recovery-binding-registry.js";

type BridgeMessage = z.infer<typeof BridgeMessageSchema>;
type AppResource = z.infer<typeof McpAppResourceSchema>;

const APP_BRIDGE_CAPABILITIES = new Set([
  "career.context.read",
  "career.facts.read",
  "career.facts.propose",
  "resume.definitions.read",
  "resume.definitions.write",
  "resume.jobs.read",
  "resume.jobs.write",
  "resume.artifacts.register",
  "resume.export.request",
  "resume.operations.read",
  "app.inference.request",
]);

const ResumeChatProfileUpdateInputSchema = z.object({
  profile_markdown: z.string().min(1).max(16_384),
  completed_topics: z.array(z.string().min(1).max(128)).max(100).default(["direction", "experience", "education", "credentials", "skills"]),
  current_topic: z.string().min(1).max(128).nullable().default(null),
  skipped_topics: z.array(z.string().min(1).max(128)).max(100).default([]),
}).strict();

const ResumeChatCreateSectionInputSchema = z.object({
  section_id: z.string().min(1).max(128).optional(),
  title: z.string().min(1).max(128).optional(),
  statements: z.array(z.string().min(1).max(8_192)).min(1).max(80),
}).strict();

const ResumeChatCreateInputSchema = z.object({
  title: z.string().min(1).max(256).optional(),
  resume_markdown: z.string().min(1).max(65_536).optional(),
  sections: z.array(ResumeChatCreateSectionInputSchema).min(1).max(32).optional(),
  locale: z.string().min(2).max(35).default("en-US"),
  page_intent: z.enum(["one_page", "two_pages", "concise", "detailed"]).default("one_page"),
}).strict().superRefine((value, context) => {
  if (!value.resume_markdown && !value.sections) {
    context.addIssue({ code: "custom", message: "resume_markdown or sections is required" });
  }
});

type ChatResumeStatement = {
  statement_id: string;
  section_id: string;
  kind: "presentation";
  display_role: "heading" | "bullet" | "line";
  text: string;
  supporting_confirmed_fact_revision_ids: [];
};

type AppsClient = Pick<ModernMcpAppsClient, "negotiate" | "readAppResource" | "callTool" | "cancel">;
type RecoveryOperationBinding = {
  expectedRevision: number | null;
  semanticDigest: `sha256:${string}` | null;
  lifecycleState: "pending" | "completed" | "conflict" | "cancelled" | "failed";
  conflictClass: "idempotency_input_mismatch" | "cas_revision_mismatch" | "durable_value_mismatch";
  ownerId: string;
  actorId: string;
  grantId: string;
  grantRevision: number;
  revocationGeneration: number;
  recordScopeIds: readonly string[];
};
const CURRENT_PROCESS_RECOVERY_BINDINGS = new CurrentProcessRecoveryBindingRegistry<RecoveryOperationBinding>();
type SessionRecord = {
  sessionId: string;
  viewId: string;
  operationId: string;
  installationId: string;
  packageDigest: `sha256:${string}`;
  lifecycleGeneration: number;
  bridgeTokenId: string;
  expiresAt: string;
  client: AppsClient;
  mcp: ModernMcpSession;
  resourceEnvelope: LoadedAppResource["envelope"];
  resource: AppResource;
  bridgeGeneration: number;
  allowedTools: Set<string>;
  allowedCapabilities: Set<string>;
  grant: CapabilityGrant;
  entryPoint: "direct" | "career";
  seenMessages: Set<string>;
  seenProtocolRequestIds: Set<string>;
  messageTimes: number[];
  inferenceOperations: Set<string>;
  appsBridgeOperations: Set<string>;
};

export class ResumeAppHostAdapter {
  readonly appId: string;
  readonly routeKey: string;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly clientFactory: (connection: AppRuntimeConnection) => AppsClient;
  private readonly now: () => number;
  private readonly audit: (event: string, details: Record<string, unknown>) => void;
  private readonly runtimeConnections = new Map<string, AppRuntimeConnection>();
  private readonly connectionManager: McpConnectionManager;
  private readonly viewRegistry: AppViewRegistry;
  private readonly recoveryDiagnosticBindings = new Map<string, RecoveryOperationBinding>();
  private readonly recoveryProcessInstanceId: string | null;
  private readonly startupTransactionRecoveryComplete: boolean;
  private readonly activeChatActions = new Map<string, Array<{ installationId: string; capability: AppCapabilityName; idempotencyKey: string }>>();

  constructor(
    private readonly lifecycle: AppLifecycleService,
    options: {
      clientFactory?: (connection: AppRuntimeConnection) => AppsClient;
      now?: () => number;
      audit?: (event: string, details: Record<string, unknown>) => void;
      capabilityRouter?: ResumeCapabilityRouter;
      installedAppInference?: InstalledAppInferenceExecutor;
      exportBroker?: ResumeExportBroker;
      capabilityOperations?: CapabilityOperationCoordinator;
      viewRegistry?: AppViewRegistry;
      chatSessionRegistry?: AppChatSessionRegistry;
      routeKey?: string;
    } = {},
  ) {
    this.appId = lifecycle.appId;
    this.routeKey = options.routeKey ?? lifecycle.appId.split(".").at(-1)!;
    this.now = options.now ?? Date.now;
    this.audit = options.audit ?? (() => undefined);
    this.connectionManager = new McpConnectionManager({
      peerFactory: (identity) => {
        const connection = this.runtimeConnections.get(identity.runtimeId);
        if (!connection) throw new AppPlatformError("runtime_conflict", "Installed app runtime connection is unavailable");
        return new SdkMcpPeer({ url: connection.url, authorization: connection.authorization });
      },
      audit: this.audit,
    });
    this.clientFactory = options.clientFactory ?? ((connection) => {
      const identity = identityForRuntime(connection, { appId: this.appId, publisherId: this.lifecycle.publisherId, serverId: this.routeKey });
      this.runtimeConnections.set(identity.runtimeId, connection);
      return new ModernMcpAppsClient({ manager: this.connectionManager, identity });
    });
    this.capabilityRouter = options.capabilityRouter;
    const recoveryEvidence = options.capabilityRouter?.domain.store.recoveryLifecycleEvidence();
    this.recoveryProcessInstanceId = recoveryEvidence?.process_instance_id ?? null;
    this.startupTransactionRecoveryComplete = recoveryEvidence?.startup_transaction_recovery_complete ?? false;
    this.exportBroker = options.exportBroker;
    this.capabilityOperations = options.capabilityOperations ?? new CapabilityOperationCoordinator({
      now: this.now,
      onDisposition: (event) => this.emitRecoveryReconciliationAudit(event),
    });
    this.viewRegistry = options.viewRegistry ?? new AppViewRegistry({ now: this.now });
    this.chatSessions = options.chatSessionRegistry ?? new AppChatSessionRegistry({ now: this.now });
    this.installedAppInference = options.installedAppInference;
  }

  private readonly capabilityRouter?: ResumeCapabilityRouter;
  private readonly exportBroker?: ResumeExportBroker;
  private readonly capabilityOperations: CapabilityOperationCoordinator;
  private readonly installedAppInference?: InstalledAppInferenceExecutor;
  private readonly chatSessions: AppChatSessionRegistry;

  async launch(entryPoint: "direct" | "career" = "direct", resume?: AppViewResumeRequest): Promise<AppLaunch> {
    const descriptor = await this.lifecycle.ownerDescriptor();
    const record = descriptor.record;
    if (record.state !== "active" || !record.installation_id || !record.active_package_digest) {
      throw new AppPlatformError("invalid_state_transition", "Resume Builder must be active before launch");
    }
    if (!descriptor.grant) throw new AppPlatformError("grant_missing", "Resume Builder capability grant is missing");
    const packageDigest = record.active_package_digest as `sha256:${string}`;
    const connection = this.lifecycle.dependencies.supervisor.connectionFor(record.installation_id);
    if (connection.runtime.package_digest !== record.active_package_digest) {
      throw new AppPlatformError("runtime_conflict", "Active app runtime does not match the installed package");
    }
    const client = this.clientFactory(connection);
    const mcp = await client.negotiate();
    this.audit("app.mcp.negotiation_completed", {
      app_id: record.app_id, installation_id: record.installation_id, package_digest: packageDigest,
      connection_id: mcp.connectionId, adapter: "modern", decision: "allowed", status: "completed",
      protocol_version: mcp.protocolVersion, extension_version: mcp.extensionVersion,
    });
    const primaryResourceUri = descriptor.storedPackage?.manifest.manifest_version === 2
      ? descriptor.storedPackage.manifest.primary_resource.uri
      : `ui://${this.routeKey}/main`;
    const loadedResource = await client.readAppResource(mcp, primaryResourceUri, packageDigest);
    const resource = loadedResource.resource;
    this.audit("app.mcp.resource_loaded", {
      app_id: record.app_id, installation_id: record.installation_id, package_digest: packageDigest,
      connection_id: mcp.connectionId, adapter: "modern", decision: "allowed", status: "completed",
      resource_size_bytes: resource.size_bytes,
    });
    const allowedTools = appVisibleToolNames(mcp.tools);
    const allowedCapabilities = descriptor.grant.capabilities.filter((capability) => APP_BRIDGE_CAPABILITIES.has(capability));
    const viewPlan = this.viewRegistry.plan({
      appId: this.appId,
      installationId: record.installation_id,
      packageDigest,
      lifecycleGeneration: record.generation,
      connectionId: mcp.connectionId,
      connectionGeneration: mcp.handle.generation,
      entryPoint,
    }, resume);
    const issued = await this.lifecycle.issueSession({
      audience: "app_bridge",
      capabilities: ["career.context.read"],
      operationId: viewPlan.operationId,
      viewId: viewPlan.viewId,
      connectionId: mcp.connectionId,
    });
    this.lifecycle.dependencies.tokenBroker.consume(issued.token, {
      audience: "app_bridge",
      capability: "career.context.read",
      installationId: record.installation_id,
      operationId: viewPlan.operationId,
    });
    const committedView = this.viewRegistry.commit(viewPlan);
    const priorSession = committedView.supersededSessionId
      ? this.sessions.get(committedView.supersededSessionId)
      : undefined;
    if (committedView.supersededSessionId) this.sessions.delete(committedView.supersededSessionId);
    const session: SessionRecord = {
      sessionId: committedView.sessionId, viewId: committedView.viewId, operationId: committedView.operationId, installationId: record.installation_id,
      packageDigest, lifecycleGeneration: record.generation,
      bridgeTokenId: issued.claims.token_id, expiresAt: issued.claims.expires_at,
      client, mcp, resourceEnvelope: loadedResource.envelope, resource, bridgeGeneration: committedView.bridgeGeneration,
      allowedTools: new Set(allowedTools), allowedCapabilities: new Set(allowedCapabilities), grant: descriptor.grant,
      entryPoint,
      seenMessages: new Set(), seenProtocolRequestIds: new Set(), messageTimes: [],
      inferenceOperations: new Set(priorSession?.inferenceOperations), appsBridgeOperations: new Set(),
    };
    this.sessions.set(session.sessionId, session);
    this.audit("app.mcp.session_opened", {
      app_id: record.app_id, installation_id: session.installationId, package_digest: session.packageDigest,
      connection_id: mcp.connectionId, view_id: session.viewId, operation_id: session.operationId,
      protocol_version: mcp.protocolVersion, extension_version: mcp.extensionVersion,
      resource_size_bytes: resource.size_bytes, tool_count: allowedTools.length, outcome: "allowed",
      bridge_generation: session.bridgeGeneration, reconnect_outcome: committedView.resumed ? "resumed" : "created",
    });
    return {
      launch_version: 1, session_id: session.sessionId, installation_id: session.installationId, view_id: session.viewId, operation_id: session.operationId,
      bridge_generation: session.bridgeGeneration, resumed: committedView.resumed,
      bridge_token_id: session.bridgeTokenId, server_id: mcp.connectionId, expires_at: session.expiresAt,
      protocol: { core: mcp.protocolVersion, apps_extension: mcp.extensionVersion, server_name: mcp.serverName, server_version: mcp.serverVersion },
      resource, allowed_tools: allowedTools, allowed_capabilities: allowedCapabilities,
      entry_point: entryPoint,
    };
  }

  async launchChatWorkspace(input: AppChatWorkspaceLaunchInput = {}): Promise<AppChatWorkspaceLaunch> {
    const descriptor = await this.lifecycle.ownerDescriptor();
    const record = descriptor.record;
    if (record.state !== "active" || !record.installation_id || !record.active_package_digest || !descriptor.grant || !descriptor.storedPackage) {
      throw new AppPlatformError("invalid_state_transition", "App must be active before opening an app-chat workspace");
    }
    const packageDigest = record.active_package_digest as `sha256:${string}`;
    if (descriptor.grant.package_digest !== packageDigest || descriptor.grant.app_id !== record.app_id || descriptor.grant.publisher_id !== this.lifecycle.publisherId || descriptor.grant.installation_id !== record.installation_id) {
      throw new AppPlatformError("denied", "App-chat grant does not match the active installation", 403);
    }
    const selection = selectAppChatWorkspace(descriptor.storedPackage.manifest, {
      presentationId: input.presentationId,
      workspaceId: input.workspaceId,
    });
    const contextGrantPlan = planAppChatContextGrants(selection.workspace, descriptor.grant);
    const sessionPlan = this.chatSessions.plan(this.chatAuthority({
      grant: descriptor.grant,
      installationId: record.installation_id,
      packageDigest,
      lifecycleGeneration: record.generation,
      presentationId: selection.presentation.presentation_id,
      workspaceId: selection.workspace.workspace_id,
      contextGrantSetDigest: contextGrantPlan.digest,
    }), input.resume);
    const context = await projectAppChatContext(selection.workspace, contextGrantPlan, this.capabilityRouter ? {
      career_context: async () => this.projectCareerContextForChat(sessionPlan.viewId, descriptor.grant!, record.installation_id!),
    } : {});
    const committed = this.chatSessions.commit(sessionPlan);
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
        documents: selection.workspace.documents,
        resources: selection.workspace.resources,
        actions: selection.workspace.actions,
      },
      context,
    };
  }

  async readChatWorkspaceSession(sessionId: string): Promise<AppChatWorkspaceLaunch["session"]> {
    const session = this.chatSessions.read(this.appId, sessionId);
    const current = await this.lifecycle.status();
    if (current.state !== "active" || current.installation_id !== session.installationId || current.active_package_digest !== session.packageDigest || current.generation !== session.lifecycleGeneration) {
      this.close(sessionId);
      throw new AppPlatformError("session_closed", "App-chat session closed because lifecycle authority changed", 410);
    }
    const descriptor = await this.lifecycle.ownerDescriptor();
    if (
      !descriptor.grant ||
      descriptor.grant.grant_id !== session.grantId ||
      descriptor.grant.grant_revision !== session.grantRevision ||
      descriptor.grant.revocation_generation !== session.revocationGeneration ||
      descriptor.grant.revoked_at !== null
    ) {
      this.close(sessionId);
      throw new AppPlatformError("session_closed", "App-chat session closed because grant authority changed", 410);
    }
    return projectAppChatSession(session);
  }

  async buildChatWorkspaceModelContext(request: AppChatModelContextRequest): Promise<AppChatModelContext> {
    const { session, descriptor, workspace } = await this.requireChatSessionForModel(request);
    const context = await buildAppChatModelContext({
      metadata: request,
      session,
      workspace,
      storedPackage: descriptor.storedPackage!,
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

  async handleAppsBridge(sessionId: string, rawEnvelope: unknown): Promise<unknown> {
    const session = await this.requireSession(sessionId);
    const parsed = AppsBridgeEnvelopeSchema.safeParse(rawEnvelope);
    if (!parsed.success) throw new AppPlatformError("bridge_malformed", "Apps bridge envelope failed schema validation", 400);
    const envelope = parsed.data;
    if (
      envelope.direction !== "app_to_host" ||
      envelope.installation_id !== session.installationId ||
      envelope.view_id !== session.viewId ||
      envelope.operation_id !== session.operationId ||
      envelope.bridge_generation !== session.bridgeGeneration ||
      !envelope.provenance.source_window_match ||
      envelope.provenance.opaque_origin !== "null" ||
      envelope.provenance.same_server_id !== session.mcp.connectionId
    ) {
      throw new AppPlatformError("bridge_denied", "Apps bridge authority binding is invalid", 403);
    }
    this.validateBridgeIngress(session, envelope.message_id, envelope.sent_at);
    const message = envelope.message;
    if (!("method" in message) || !("id" in message)) {
      throw new AppPlatformError("bridge_denied", "Apps bridge message is not a supported request", 403);
    }
    const protocolRequestId = String(message.id);
    if (session.seenProtocolRequestIds.has(protocolRequestId)) {
      throw new AppPlatformError("bridge_replayed", "Apps bridge request ID was already handled", 409);
    }
    session.seenProtocolRequestIds.add(protocolRequestId);
    const params = message.params ?? {};
    if (message.method === "tools/call") {
      if (!isExactRecord(params, ["name", "arguments"], ["arguments"]) || typeof params.name !== "string") {
        throw new AppPlatformError("bridge_malformed", "Apps tool request failed schema validation", 400);
      }
      const argumentsValue = params.arguments ?? {};
      if (!isRecordValue(argumentsValue)) throw new AppPlatformError("bridge_malformed", "Apps tool arguments failed schema validation", 400);
      if (!session.allowedTools.has(params.name)) throw new AppPlatformError("bridge_denied", "Tool is not app-visible on this server connection", 403);
      const operationId = envelope.message_id;
      session.appsBridgeOperations.add(operationId);
      try {
        const complete = await session.client.callTool(session.mcp, params.name, argumentsValue, operationId);
        if (this.sessions.get(sessionId) !== session) throw new AppPlatformError("session_closed", "App UI session closed before the tool result arrived", 410);
        return { jsonrpc: "2.0", id: message.id, result: projectMcpResult(complete, "app") };
      } catch (error) { throw this.asHostError(error); }
      finally { session.appsBridgeOperations.delete(operationId); }
    }
    if (message.method === "resources/read") {
      if (!isExactRecord(params, ["uri"]) || params.uri !== session.resource.uri) {
        throw new AppPlatformError("bridge_denied", "Resource is not eligible on this server connection", 403);
      }
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          contents: [{
            uri: session.resource.uri,
            mimeType: session.resource.mime_type,
            text: session.resource.html,
            _meta: { contentDigest: session.resource.content_digest, cachePolicy: session.resource.cache_policy },
          }],
        },
      };
    }
    throw new AppPlatformError("bridge_denied", "Apps bridge method is not enabled", 403);
  }

  cancelAppsBridgeRequest(sessionId: string, operationId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !this.viewRegistry.isCurrentSession(this.appId, sessionId) || !session.appsBridgeOperations.has(operationId)) return false;
    return session.client.cancel(operationId);
  }

  async handleBridge(sessionId: string, rawMessage: unknown, context: { origin: string; sourceMatches: boolean }): Promise<{ status: "ready" } | { status: "completed"; result: CompleteMcpResult } | { status: "capability_completed"; result: unknown }> {
    const session = await this.requireSession(sessionId);
    if (!context.sourceMatches || context.origin !== "null") {
      this.close(sessionId);
      throw new AppPlatformError("bridge_denied", "Sandbox message source or origin is invalid", 403);
    }
    let message: BridgeMessage;
    try { message = parseBridgeMessage(rawMessage); }
    catch (error) {
      if (error instanceof ContractViolation && error.code === "envelope_too_large") {
        throw new AppPlatformError("bridge_oversized", "Bridge message exceeds the accepted byte limit", 413);
      }
      throw new AppPlatformError("bridge_malformed", "Bridge message failed schema validation", 400);
    }
    this.validateMessage(session, message);
    if (message.type === "bridge.ready") return { status: "ready" };
    if (message.type === "operation.cancel") {
      if (!session.inferenceOperations.has(message.payload.target_operation_id) || !this.installedAppInference) {
        throw new AppPlatformError("bridge_denied", "Cancellation target is outside this app session", 403);
      }
      const target = message.payload.target_operation_id;
      const idempotencyKey = inferenceIdempotencyKey(target);
      const generic = this.capabilityOperations.cancel(session.grant.app_id, session.installationId, "app.inference.request", idempotencyKey);
      return { status: "capability_completed", result: { cancelled: generic } };
    }
    if (message.type === "career.return") {
      if (!this.capabilityRouter) throw new AppPlatformError("bridge_denied", "Career return placement is unavailable", 403);
      try {
        return { status: "capability_completed", result: await this.capabilityRouter.placeCareerReturn(message.payload.summary, session.entryPoint, message.message_id, session.grant) };
      } catch (error) { throw this.asHostError(error); }
    }
    if (message.type === "export.request") {
      if (!session.allowedCapabilities.has("resume.export.request") || !this.exportBroker) {
        throw new AppPlatformError("bridge_denied", "Export is not declared for this app session", 403);
      }
      try {
        const idempotencyKey = `bridge-${message.message_id}`;
        const issued = await this.lifecycle.issueSession({ audience: "app_export", capabilities: ["resume.export.request"], operationId: message.message_id, idempotencyKey, viewId: session.viewId, connectionId: session.mcp.connectionId });
        const claims = this.consumeIssuedAuthority(issued, session.grant, "resume.export.request", {
          connectionId: session.mcp.connectionId, viewId: session.viewId, operationId: message.message_id, idempotencyKey,
        });
        const exportInput = { action: "export" as const, format: message.payload.format, definition_revision_id: message.payload.definition_revision_id, safe_filename: message.payload.safe_filename, destination_intent: message.payload.destination_intent, overwrite_confirmed: message.payload.overwrite_confirmed };
        const result = await this.capabilityOperations.execute({
          appId: session.grant.app_id,
          installationId: session.installationId, connectionId: session.mcp.connectionId, viewId: session.viewId,
          capability: "resume.export.request", capabilityVersion: 1, operationId: message.message_id,
          idempotencyKey, input: exportInput, deadlineAt: Math.min(Date.parse(claims.expires_at), this.now() + 120_000),
        }, ({ isCancelled }) => this.exportBroker!.export(exportInput, { grant: session.grant, capability: "resume.export.request", operationId: message.message_id, idempotencyKey, isCancelled }));
        return { status: "capability_completed", result };
      } catch (error) { throw this.asHostError(error); }
    }
    if (message.type === "capability.call") {
      const parsedCapability = CapabilityNameSchema.safeParse(message.payload.capability);
      if (!parsedCapability.success || !session.allowedCapabilities.has(parsedCapability.data) || parsedCapability.data === "career.facts.confirm") {
        throw new AppPlatformError("bridge_denied", "Bridge capability is not declared for this app session", 403);
      }
      try {
        if (parsedCapability.data === "app.inference.request") {
          const installedInvocation = InstalledAppInferenceInvocationSchema.safeParse(message.payload.input);
          if (installedInvocation.success) {
            if (!this.installedAppInference) throw new AppPlatformError("bridge_denied", "Installed app inference is not configured", 403);
            const operationId = installedInvocation.data.operation_id;
            const idempotencyKey = inferenceIdempotencyKey(operationId);
            const issued = await this.lifecycle.issueSession({ audience: "app_inference", capabilities: [parsedCapability.data], operationId, idempotencyKey, viewId: session.viewId, connectionId: session.mcp.connectionId });
            const claims = this.consumeIssuedAuthority(issued, session.grant, parsedCapability.data, {
              connectionId: session.mcp.connectionId, viewId: session.viewId, operationId, idempotencyKey,
            });
            session.inferenceOperations.add(operationId);
            const result = await this.capabilityOperations.execute({
              appId: session.grant.app_id, installationId: session.installationId, connectionId: session.mcp.connectionId,
              viewId: session.viewId, capability: "app.inference.request", capabilityVersion: 1, operationId,
              idempotencyKey, input: installedInvocation.data, deadlineAt: Math.min(Date.parse(claims.expires_at), this.now() + 120_000),
            }, ({ signal }) => this.lifecycle.dependencies.store.runIdempotent(idempotencyKey, { capability: parsedCapability.data, input: installedInvocation.data }, () => this.installedAppInference!.execute(installedInvocation.data, {
              appId: session.grant.app_id, installationId: session.installationId, packageDigest: session.packageDigest,
              programClient: createInstalledAppInferenceProgramClient(session.client, session.mcp), signal,
            })));
            return { status: "capability_completed", result };
          }
          throw new AppPlatformError("invalid_input", "Installed app inference requires contract version 2", 400);
        }
        if (!this.capabilityRouter) throw new AppPlatformError("bridge_denied", "Data capabilities are not available for this app session", 403);
        const audience = parsedCapability.data === "resume.export.request" ? "app_export" : "app_data";
        const operationId = message.payload.request_operation_id ?? message.message_id;
        const idempotencyKey = `bridge-${operationId}`;
        const issued = await this.lifecycle.issueSession({ audience, capabilities: [parsedCapability.data], operationId, idempotencyKey, viewId: session.viewId, connectionId: session.mcp.connectionId });
        const claims = this.consumeIssuedAuthority(issued, session.grant, parsedCapability.data, {
          connectionId: session.mcp.connectionId, viewId: session.viewId, operationId, idempotencyKey,
        });
        const result = await this.executeDataCapability(parsedCapability.data, message.payload.input, {
          authority: restrictedAuthorityFromTokenClaims(claims), installationId: session.installationId,
          connectionId: session.mcp.connectionId, viewId: session.viewId, operationId,
          correlationId: message.message_id, idempotencyKey, deadlineAt: Math.min(Date.parse(claims.expires_at), this.now() + 120_000),
        });
        return { status: "capability_completed", result };
      } catch (error) { throw this.asHostError(error); }
    }
    if (message.type !== "tool.call" || message.payload.server_id !== session.mcp.connectionId || !session.allowedTools.has(message.payload.tool_name)) {
      throw new AppPlatformError("bridge_denied", "Bridge operation is not declared for this app session", 403);
    }
    try {
      const result = await session.client.callTool(session.mcp, message.payload.tool_name, message.payload.arguments, session.operationId);
      this.audit("app.mcp.bridge_decision", {
        app_id: message.app_id, installation_id: session.installationId, connection_id: session.mcp.connectionId,
        view_id: session.viewId, operation_id: session.operationId, message_id: message.message_id,
        tool: message.payload.tool_name, decision: "allowed", status: "completed",
      });
      return { status: "completed", result };
    } catch (error) {
      this.audit("app.mcp.bridge_decision", {
        app_id: message.app_id, installation_id: session.installationId, connection_id: session.mcp.connectionId,
        view_id: session.viewId, operation_id: session.operationId, message_id: message.message_id,
        tool: message.payload.tool_name, decision: "allowed", status: "failed",
      });
      if (error instanceof AppPlatformError) throw error;
      throw new AppPlatformError("lifecycle_failed", "Installed app server could not complete the declared operation", 502);
    }
  }

  async handleOwnerCapability(capability: unknown, input: unknown, operationId: string, hostOwnerConfirmed: boolean, ownerActorId: string): Promise<unknown> {
    const parsedCapability = CapabilityNameSchema.safeParse(capability);
    if (!parsedCapability.success) throw new AppPlatformError("invalid_input", "Capability name is invalid", 400);
    const confirmation = resumeOwnerConfirmationProjection(parsedCapability.data, input);
    if (confirmation && !hostOwnerConfirmed) {
      throw new AppPlatformError("denied", "This action requires host owner confirmation", 403, { confirmation });
    }
    const ownerAuthorization = issueHostOwnerCapabilityAuthorization(ownerActorId);
    requireHostOwnerCapabilityAuthorization(ownerAuthorization);
    const descriptor = await this.lifecycle.ownerDescriptor();
    if (descriptor.record.state !== "active" || !descriptor.record.installation_id || !descriptor.grant) throw new AppPlatformError("invalid_state_transition", "Resume Builder must be active before data access");
    try {
      if (parsedCapability.data === "app.inference.request") {
        const installedInvocation = InstalledAppInferenceInvocationSchema.safeParse(input);
        if (installedInvocation.success) {
          if (installedInvocation.data.operation_id !== operationId) {
            throw new AppPlatformError("invalid_input", "Installed app inference operation identity is invalid", 400);
          }
          if (!this.installedAppInference) throw new AppPlatformError("bridge_denied", "Installed app inference is not configured", 403);
          const packageDigest = descriptor.record.active_package_digest;
          const session = packageDigest
            ? [...this.sessions.values()].find((candidate) => candidate.installationId === descriptor.record.installation_id
              && candidate.packageDigest === packageDigest
              && this.viewRegistry.isCurrentSession(this.appId, candidate.sessionId))
            : undefined;
          if (!session) throw new AppPlatformError("session_closed", "No active installed-app program session is available", 410);
          const idempotencyKey = inferenceIdempotencyKey(operationId);
          const issued = await this.lifecycle.issueSession({
            audience: "app_inference",
            capabilities: [parsedCapability.data],
            operationId,
            idempotencyKey,
            viewId: session.viewId,
            connectionId: session.mcp.connectionId,
          });
          this.consumeIssuedAuthority(issued, descriptor.grant, parsedCapability.data, {
            connectionId: session.mcp.connectionId,
            viewId: session.viewId,
            operationId,
            idempotencyKey,
          });
          session.inferenceOperations.add(operationId);
          return this.capabilityOperations.execute({
            appId: descriptor.grant.app_id,
            installationId: descriptor.record.installation_id,
            connectionId: session.mcp.connectionId,
            viewId: session.viewId,
            capability: "app.inference.request",
            capabilityVersion: 1,
            operationId,
            idempotencyKey,
            input: installedInvocation.data,
            deadlineAt: Math.min(Date.parse(issued.claims.expires_at), this.now() + 120_000),
          }, ({ signal }) => this.lifecycle.dependencies.store.runIdempotent(idempotencyKey, { capability: parsedCapability.data, input: installedInvocation.data }, () => this.installedAppInference!.execute(installedInvocation.data, {
            appId: descriptor.grant!.app_id,
            installationId: descriptor.record.installation_id!,
            packageDigest: session.packageDigest,
            programClient: createInstalledAppInferenceProgramClient(session.client, session.mcp),
            signal,
          })));
        }
        throw new AppPlatformError("invalid_input", "Installed app inference requires contract version 2", 400);
      }
      if (!this.capabilityRouter) throw new AppPlatformError("bridge_denied", "Data capabilities are not available", 403);
      const audience = parsedCapability.data === "resume.export.request" ? "app_export" : "app_data";
      const idempotencyKey = `owner-${operationId}`;
      const issued = await this.lifecycle.issueSession({ audience, capabilities: [parsedCapability.data], operationId, idempotencyKey });
      const claims = this.consumeIssuedAuthority(issued, descriptor.grant, parsedCapability.data, {
        connectionId: issued.claims.connection_id, viewId: null, operationId, idempotencyKey,
      });
      const factDecision = parsedCapability.data === "career.facts.confirm" && hostOwnerConfirmed
        ? FactDecisionInputSchema.safeParse(input)
        : null;
      const groupedFactDecisions = parsedCapability.data === "career.facts.confirm" && hostOwnerConfirmed && isRecordValue(input) && Array.isArray(input.decisions)
        ? input.decisions.map((decision) => FactDecisionInputSchema.safeParse(decision))
        : null;
      const ownerDecision = factDecision?.success
        ? issueHostOwnerDecisionEvidence({
            ownerId: descriptor.grant.owner_id,
            actorId: descriptor.grant.actor_id,
            operationId,
            inputRevisionId: factDecision.data.fact_revision_id,
            decision: factDecision.data.decision,
            confirmedAt: new Date(this.now()).toISOString(),
          })
        : undefined;
      const ownerDecisions = groupedFactDecisions?.length && groupedFactDecisions.every((decision) => decision.success)
        ? groupedFactDecisions.map((decision) => issueHostOwnerDecisionEvidence({
            ownerId: descriptor.grant!.owner_id,
            actorId: descriptor.grant!.actor_id,
            operationId,
            inputRevisionId: decision.data!.fact_revision_id,
            decision: decision.data!.decision,
            confirmedAt: new Date(this.now()).toISOString(),
          }))
        : undefined;
      return await this.executeDataCapability(parsedCapability.data, input, {
        authority: restrictedAuthorityFromTokenClaims(claims), installationId: descriptor.record.installation_id,
        connectionId: claims.connection_id, viewId: null, operationId, correlationId: operationId,
        idempotencyKey, deadlineAt: Math.min(Date.parse(claims.expires_at), this.now() + 120_000),
        hostOwnerConfirmed, ownerDecision, ownerDecisions,
      });
    } catch (error) { throw this.asHostError(error); }
  }

  async placeCareerReturn(summary: unknown, entryPoint: "direct" | "career", operationId: string) {
    if (!this.capabilityRouter) throw new AppPlatformError("bridge_denied", "Career return placement is not available", 403);
    const descriptor = await this.lifecycle.ownerDescriptor();
    if (descriptor.record.state !== "active" || !descriptor.record.installation_id || !descriptor.grant) throw new AppPlatformError("invalid_state_transition", "Resume Builder must be active before Career return placement");
    try { return await this.capabilityRouter.placeCareerReturn(summary as CareerReturnSummary, entryPoint, operationId, descriptor.grant); }
    catch (error) { throw this.asHostError(error); }
  }

  async finalizeOwnerExport(input: unknown, operationId: string): Promise<unknown> {
    if (!this.exportBroker) throw new AppPlatformError("bridge_denied", "Export broker is not available", 403);
    const descriptor = await this.lifecycle.ownerDescriptor();
    if (descriptor.record.state !== "active" || !descriptor.record.installation_id || !descriptor.grant) throw new AppPlatformError("invalid_state_transition", "Resume Builder must be active before export completion");
    try {
      const idempotencyKey = `owner-export-${operationId}`;
      const issued = await this.lifecycle.issueSession({ audience: "app_export", capabilities: ["resume.export.request"], operationId, idempotencyKey });
      const claims = this.consumeIssuedAuthority(issued, descriptor.grant, "resume.export.request", {
        connectionId: issued.claims.connection_id, viewId: null, operationId, idempotencyKey,
      });
      return await this.capabilityOperations.execute({
        appId: descriptor.grant.app_id,
        installationId: descriptor.record.installation_id, connectionId: claims.connection_id, viewId: null,
        capability: "resume.export.request", capabilityVersion: 1, operationId, idempotencyKey, input,
        deadlineAt: Math.min(Date.parse(claims.expires_at), this.now() + 120_000),
      }, ({ isCancelled }) => this.exportBroker!.finalize(input, { grant: descriptor.grant!, capability: "resume.export.request", operationId, idempotencyKey, isCancelled }));
    } catch (error) { throw this.asHostError(error); }
  }

  async issueServerCapabilityAuthority(sessionId: string, capability: unknown, operationId: string, idempotencyKey: string): Promise<{ token: string; expiresAt: string }> {
    const session = await this.requireSession(sessionId);
    const entry = resolveAppCapability(capability, 1);
    if (entry.name === "career.facts.confirm" || !session.allowedCapabilities.has(entry.name)) {
      throw new AppPlatformError("denied", "Capability is unavailable", 403);
    }
    const issued = await this.lifecycle.issueSession({
      audience: entry.audience, capabilities: [entry.name], operationId, idempotencyKey,
      connectionId: session.mcp.connectionId,
    });
    return { token: issued.token, expiresAt: issued.claims.expires_at };
  }

  async handleServerCapability(token: string, capability: unknown, capabilityVersion: number, input: unknown, operationId: string, idempotencyKey: string): Promise<unknown> {
    const entry = resolveAppCapability(capability, capabilityVersion);
    if (entry.name === "career.facts.confirm") throw new AppPlatformError("denied", "Capability is unavailable", 403);
    const descriptor = await this.lifecycle.ownerDescriptor();
    if (descriptor.record.state !== "active" || !descriptor.record.installation_id || !descriptor.grant) {
      throw new AppPlatformError("denied", "Capability authority is unavailable", 403);
    }
    const grant = descriptor.grant;
    const claims = this.lifecycle.dependencies.tokenBroker.consume(token, {
      audience: entry.audience, capability: entry.name, installationId: descriptor.record.installation_id,
      ownerId: grant.owner_id, actorId: grant.actor_id, appId: grant.app_id, publisherId: grant.publisher_id,
      packageDigest: grant.package_digest, grantId: grant.grant_id, grantRevision: grant.grant_revision,
      revocationGeneration: grant.revocation_generation, tokenGeneration: Math.max(1, descriptor.record.generation),
      viewId: null, operationId, idempotencyKey, recordScopes: grant.record_scopes, currentGrant: grant,
    });
    const matchingSession = [...this.sessions.values()].find((session) =>
      session.installationId === claims.installation_id && session.mcp.connectionId === claims.connection_id && session.packageDigest === claims.package_digest,
    );
    if (!matchingSession) throw new AppPlatformError("token_scope_invalid", "Capability token scope does not match the active connection", 403);
    if (entry.name === "app.inference.request") {
      const invocation = InstalledAppInferenceInvocationSchema.safeParse(input);
      if (!invocation.success || invocation.data.operation_id !== operationId) throw new AppPlatformError("invalid_input", "Installed app inference requires contract version 2", 400);
      if (!this.installedAppInference) throw new AppPlatformError("denied", "Installed app inference is unavailable", 403);
      matchingSession.inferenceOperations.add(operationId);
      return this.capabilityOperations.execute({
        appId: grant.app_id, installationId: claims.installation_id, connectionId: claims.connection_id, viewId: matchingSession.viewId,
        capability: "app.inference.request", capabilityVersion: 1, operationId, idempotencyKey, input: invocation.data,
        deadlineAt: Math.min(Date.parse(claims.expires_at), this.now() + entry.maxDurationMs),
      }, ({ signal }) => this.lifecycle.dependencies.store.runIdempotent(idempotencyKey, { capability: entry.name, input: invocation.data }, () => this.installedAppInference!.execute(invocation.data, {
        appId: grant.app_id, installationId: claims.installation_id, packageDigest: matchingSession.packageDigest,
        programClient: createInstalledAppInferenceProgramClient(matchingSession.client, matchingSession.mcp), signal,
      })));
    }
    return this.executeDataCapability(entry.name, input, {
      authority: restrictedAuthorityFromTokenClaims(claims), installationId: claims.installation_id,
      connectionId: claims.connection_id, viewId: null, operationId, correlationId: operationId,
      idempotencyKey, deadlineAt: Math.min(Date.parse(claims.expires_at), this.now() + entry.maxDurationMs),
    });
  }

  close(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      const closedChat = this.chatSessions.close(this.appId, sessionId);
      if (closedChat.closed && closedChat.viewId) {
        this.cancelChatActions(sessionId);
        this.lifecycle.dependencies.tokenBroker.revokeView(closedChat.viewId);
      }
      return closedChat.closed;
    }
    const closedView = this.viewRegistry.close(this.appId, sessionId);
    if (!closedView.closed) return false;
    for (const operationId of session.inferenceOperations) this.capabilityOperations.cancel(session.grant.app_id, session.installationId, "app.inference.request", inferenceIdempotencyKey(operationId));
    this.lifecycle.dependencies.tokenBroker.revokeView(closedView.viewId!);
    return this.sessions.delete(sessionId);
  }
  async closeAll(): Promise<void> {
    const connectionIds = new Set([...this.sessions.values()].map((session) => session.mcp.connectionId));
    for (const sessionId of [...this.sessions.keys()]) this.close(sessionId);
    for (const session of this.chatSessions.activeSessions()) {
      this.cancelChatActions(session.sessionId);
      this.lifecycle.dependencies.tokenBroker.revokeView(session.viewId);
    }
    for (const connectionId of connectionIds) this.lifecycle.dependencies.tokenBroker.revokeConnection(connectionId);
    await this.connectionManager.closeAll();
    this.runtimeConnections.clear();
    this.viewRegistry.clear();
    this.chatSessions.clear();
    this.activeChatActions.clear();
  }
  sessionCountForTest(): number { return this.sessions.size; }

  private async requireSession(sessionId: string): Promise<SessionRecord> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new AppPlatformError("session_closed", "App UI session is closed", 410);
    if (Date.parse(session.expiresAt) <= this.now()) {
      this.sessions.delete(sessionId);
      this.viewRegistry.close(this.appId, sessionId);
      this.lifecycle.dependencies.tokenBroker.revokeView(session.viewId);
      throw new AppPlatformError("session_expired", "App UI session expired", 401);
    }
    if (!this.viewRegistry.isCurrentSession(this.appId, sessionId)) {
      this.sessions.delete(sessionId);
      this.lifecycle.dependencies.tokenBroker.revokeView(session.viewId);
      throw new AppPlatformError("session_closed", "App UI session is closed", 410);
    }
    const current = await this.lifecycle.status();
    if (current.state !== "active" || current.installation_id !== session.installationId || current.active_package_digest !== session.packageDigest || current.generation !== session.lifecycleGeneration) {
      this.close(sessionId);
      throw new AppPlatformError("session_closed", "App UI session closed because lifecycle authority changed", 410);
    }
    const descriptor = await this.lifecycle.ownerDescriptor();
    if (
      !descriptor.grant || descriptor.grant.grant_id !== session.grant.grant_id ||
      descriptor.grant.grant_revision !== session.grant.grant_revision ||
      descriptor.grant.revocation_generation !== session.grant.revocation_generation || descriptor.grant.revoked_at !== null
    ) {
      this.close(sessionId);
      throw new AppPlatformError("session_closed", "App UI session closed because grant authority changed", 410);
    }
    return session;
  }

  private chatAuthority(input: {
    grant: CapabilityGrant;
    installationId: string;
    packageDigest: `sha256:${string}`;
    lifecycleGeneration: number;
    presentationId: string;
    workspaceId: string;
    contextGrantSetDigest: `sha256:${string}`;
  }): AppChatSessionAuthority {
    return {
      ownerId: input.grant.owner_id,
      accountId: input.grant.owner_id,
      actorId: input.grant.actor_id,
      appId: input.grant.app_id,
      publisherId: input.grant.publisher_id,
      installationId: input.installationId,
      packageDigest: input.packageDigest,
      lifecycleGeneration: input.lifecycleGeneration,
      grantId: input.grant.grant_id,
      grantRevision: input.grant.grant_revision,
      revocationGeneration: input.grant.revocation_generation,
      presentationId: input.presentationId,
      workspaceId: input.workspaceId,
      contextGrantSetDigest: input.contextGrantSetDigest,
    };
  }

  private async projectCareerContextForChat(viewId: string, grant: CapabilityGrant, installationId: string): Promise<unknown> {
    const operationId = randomUUID();
    const idempotencyKey = `app-chat-context-${operationId}`;
    const issued = await this.lifecycle.issueSession({
      audience: "app_data",
      capabilities: ["career.context.read"],
      operationId,
      idempotencyKey,
      viewId,
    });
    const claims = this.consumeIssuedAuthority(issued, grant, "career.context.read", {
      connectionId: issued.claims.connection_id,
      viewId,
      operationId,
      idempotencyKey,
    });
    return this.executeDataCapability("career.context.read", { entry_point: "direct" }, {
      authority: restrictedAuthorityFromTokenClaims(claims),
      installationId,
      connectionId: claims.connection_id,
      viewId,
      operationId,
      correlationId: operationId,
      idempotencyKey,
      deadlineAt: Math.min(Date.parse(claims.expires_at), this.now() + 120_000),
    });
  }

  private async requireChatSessionForModel(metadata: AppChatModelContextRequest): Promise<{
    session: AppChatSessionRecord;
    descriptor: Awaited<ReturnType<AppLifecycleService["ownerDescriptor"]>>;
    workspace: ReturnType<typeof selectAppChatWorkspace>["workspace"];
  }> {
    if (metadata.app_id !== this.appId) {
      throw new AppPlatformError("denied", "App-chat model session targets a different app", 403);
    }
    const session = this.chatSessions.read(this.appId, metadata.session_id);
    assertAppChatMetadataMatchesSession(metadata, session);
    const current = await this.lifecycle.status();
    if (current.state !== "active" || current.installation_id !== session.installationId || current.active_package_digest !== session.packageDigest || current.generation !== session.lifecycleGeneration) {
      this.close(session.sessionId);
      throw new AppPlatformError("session_closed", "App-chat session closed because lifecycle authority changed", 410);
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
      throw new AppPlatformError("session_closed", "App-chat session closed because grant authority changed", 410);
    }
    const selection = selectAppChatWorkspace(descriptor.storedPackage.manifest, {
      presentationId: session.presentationId,
      workspaceId: session.workspaceId,
    });
    return { session, descriptor, workspace: selection.workspace };
  }

  private async executeChatWorkspaceAction(request: AppChatActionExecutionRequest): Promise<unknown> {
    const { session, descriptor, workspace } = await this.requireChatSessionForModel(request.metadata);
    const action = workspace.actions.find((candidate) => candidate.action_id === request.action.action_id);
    if (!action || action.model_exposure !== "available") {
      throw new AppPlatformError("denied", "App action is not declared for model use", 403);
    }
    if (action.required_capabilities.length !== 1) {
      throw new AppPlatformError("incompatible_schema", "App action must declare exactly one host capability for model execution", 409);
    }
    const capability = resolveAppCapability(action.required_capabilities[0].name, action.required_capabilities[0].version);
    const manifest = descriptor.storedPackage!.manifest;
    const manifestRequests = manifest.manifest_version === 2 ? manifest.requested_capabilities : [];
    const requestedPurposes = manifest.manifest_version === 2 ? manifest.requested_inference_purposes : [];
    if (!manifestRequests.some((candidate) => candidate.name === capability.name && candidate.version === capability.version)) {
      throw new AppPlatformError("denied", "App action capability is not requested by the package", 403);
    }
    if (capability.idempotencyPolicy === "required" && request.idempotencyKey.length < 16) {
      throw new AppPlatformError("invalid_input", "App action requires a stable idempotency key", 400);
    }
    this.rememberChatAction(session.sessionId, session.installationId, capability.name, request.idempotencyKey);
    try {
      if (capability.name === "app.inference.request") {
        return await this.executeChatWorkspaceInferenceAction(request, session, descriptor.grant!, requestedPurposes);
      }
      return await this.executeChatWorkspaceDataAction(request, session, descriptor.grant!, capability.name);
    } finally {
      this.forgetChatAction(session.sessionId, capability.name, request.idempotencyKey);
    }
  }

  private async executeChatWorkspaceInferenceAction(
    request: AppChatActionExecutionRequest,
    session: AppChatSessionRecord,
    grant: CapabilityGrant,
    requestedPurposes: readonly { purpose_id: string; version: number }[],
  ): Promise<unknown> {
    if (!this.installedAppInference) throw new AppPlatformError("denied", "Installed app inference is not configured", 403);
    if (request.action.required_inference_purposes.length !== 1) {
      throw new AppPlatformError("incompatible_schema", "Inference app actions must declare one inference purpose", 409);
    }
    const invocation = InstalledAppInferenceInvocationSchema.safeParse(request.actionInput);
    if (!invocation.success || invocation.data.operation_id !== request.operationId) {
      throw new AppPlatformError("invalid_input", "Installed app inference action input is invalid", 400);
    }
    const requiredPurpose = request.action.required_inference_purposes[0];
    if (invocation.data.program.id !== requiredPurpose.purpose_id || invocation.data.program.version !== requiredPurpose.version) {
      throw new AppPlatformError("denied", "Installed app inference purpose is not declared for this action", 403);
    }
    if (!requestedPurposes.some((candidate) => candidate.purpose_id === requiredPurpose.purpose_id && candidate.version === requiredPurpose.version)) {
      throw new AppPlatformError("denied", "Installed app inference purpose is not requested by the package", 403);
    }
    const connection = this.lifecycle.dependencies.supervisor.connectionFor(session.installationId);
    if (connection.runtime.package_digest !== session.packageDigest) {
      throw new AppPlatformError("runtime_conflict", "Active app runtime does not match the chat workspace package", 409);
    }
    const client = this.clientFactory(connection);
    const mcp = await client.negotiate();
    const issued = await this.lifecycle.issueSession({
      audience: "app_inference",
      capabilities: ["app.inference.request"],
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      viewId: session.viewId,
      connectionId: mcp.connectionId,
    });
    const claims = this.consumeIssuedAuthority(issued, grant, "app.inference.request", {
      connectionId: mcp.connectionId,
      viewId: session.viewId,
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
    });
    return this.capabilityOperations.execute({
      appId: grant.app_id,
      installationId: session.installationId,
      connectionId: mcp.connectionId,
      viewId: session.viewId,
      capability: "app.inference.request",
      capabilityVersion: 1,
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      input: invocation.data,
      deadlineAt: Math.min(Date.parse(claims.expires_at), this.now() + 120_000),
    }, ({ signal }) => this.lifecycle.dependencies.store.runIdempotent(request.idempotencyKey, { capability: "app.inference.request", input: invocation.data }, () => this.installedAppInference!.execute(invocation.data, {
      appId: grant.app_id,
      installationId: session.installationId,
      packageDigest: session.packageDigest,
      programClient: createInstalledAppInferenceProgramClient(client, mcp),
      signal,
    })));
  }

  private async executeChatWorkspaceDataAction(
    request: AppChatActionExecutionRequest,
    session: AppChatSessionRecord,
    grant: CapabilityGrant,
    capability: Exclude<AppCapabilityName, "app.inference.request">,
  ): Promise<unknown> {
    const actionInput = this.translateChatWorkspaceDataActionInput(request, session, capability);
    const issued = await this.lifecycle.issueSession({
      audience: capability === "resume.export.request" ? "app_export" : "app_data",
      capabilities: [capability],
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      viewId: session.viewId,
    });
    const claims = this.consumeIssuedAuthority(issued, grant, capability, {
      connectionId: issued.claims.connection_id,
      viewId: session.viewId,
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
    });
    return this.executeDataCapability(capability as AppDataCapability, actionInput, {
      authority: restrictedAuthorityFromTokenClaims(claims),
      installationId: session.installationId,
      connectionId: claims.connection_id,
      viewId: session.viewId,
      operationId: request.operationId,
      correlationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      deadlineAt: Math.min(Date.parse(claims.expires_at), this.now() + 120_000),
      hostOwnerConfirmed: request.ownerConfirmed,
    });
  }

  private translateChatWorkspaceDataActionInput(
    request: AppChatActionExecutionRequest,
    session: AppChatSessionRecord,
    capability: Exclude<AppCapabilityName, "app.inference.request">,
  ): unknown {
    if (request.action.action_id === "resume.profile.read" && capability === "resume.definitions.read") {
      return normalizeProfileReadInput(request.actionInput);
    }
    if (request.action.action_id === "resume.profile.update" && capability === "resume.definitions.write") {
      return this.profileUpdateInputForChat(request.actionInput, session);
    }
    if (request.action.action_id === "resume.create" && capability === "resume.definitions.write") {
      return resumeCreateInputForChat(request.actionInput);
    }
    if (request.action.action_id === "resume.state.read" && capability === "resume.operations.read" && !hasOperationQuery(request.actionInput)) {
      throw new AppPlatformError("invalid_input", "Resume state read requires queried_operation_id from a previous app action result", 400);
    }
    return request.actionInput;
  }

  private profileUpdateInputForChat(rawInput: unknown, session: AppChatSessionRecord): unknown {
    const input = ResumeChatProfileUpdateInputSchema.parse(rawInput);
    const occurredAt = new Date(this.now()).toISOString();
    return {
      kind: "interview_progress",
      progress: {
        expected_revision: null,
        status: "review_needed",
        current_topic: input.current_topic,
        completed_topics: input.completed_topics,
        skipped_topics: input.skipped_topics,
        draft_state: "owner_reviewed",
        session_id: session.sessionId,
        audit_turn: {
          transcript_version: 1,
          turn_id: randomUUID(),
          session_id: session.sessionId,
          prompt_version: "resume-builder-chat-profile-v1",
          topic: "resume_profile",
          question: "Capture the owner-reviewed Resume Profile from the app chat.",
          answer: input.profile_markdown,
          follow_up: null,
          action: "answered",
          occurred_at: occurredAt,
        },
      },
    };
  }

  private rememberChatAction(sessionId: string, installationId: string, capability: AppCapabilityName, idempotencyKey: string): void {
    const current = this.activeChatActions.get(sessionId) ?? [];
    current.push({ installationId, capability, idempotencyKey });
    this.activeChatActions.set(sessionId, current);
  }

  private forgetChatAction(sessionId: string, capability: AppCapabilityName, idempotencyKey: string): void {
    const next = (this.activeChatActions.get(sessionId) ?? []).filter((item) => item.capability !== capability || item.idempotencyKey !== idempotencyKey);
    if (next.length === 0) this.activeChatActions.delete(sessionId);
    else this.activeChatActions.set(sessionId, next);
  }

  private cancelChatActions(sessionId: string): void {
    const actions = this.activeChatActions.get(sessionId) ?? [];
    for (const action of actions) {
      this.capabilityOperations.cancel(this.appId, action.installationId, action.capability, action.idempotencyKey);
    }
    this.activeChatActions.delete(sessionId);
  }

  private async executeDataCapability(
    capability: AppDataCapability,
    input: unknown,
    context: CapabilityExecutionContext & {
      installationId: string;
      connectionId: string;
      viewId: string | null;
      deadlineAt: number;
    },
  ): Promise<unknown> {
    if (!this.capabilityRouter) throw new AppPlatformError("denied", "Data capabilities are unavailable", 403);
    this.rememberRecoveryDiagnosticBinding(capability, input, context);
    return this.capabilityOperations.execute({
      appId: context.authority.context.app_id,
      installationId: context.installationId, connectionId: context.connectionId, viewId: context.viewId,
      capability, capabilityVersion: 1, operationId: context.operationId, idempotencyKey: context.idempotencyKey,
      input, deadlineAt: context.deadlineAt, isCancelled: context.isCancelled,
    }, ({ isCancelled, idempotencyDecision }) => this.executeRoutedDataCapability(capability, input, {
      ...context, connectionId: context.connectionId, viewId: context.viewId, isCancelled, idempotencyDecision,
    }));
  }

  private rememberRecoveryDiagnosticBinding(
    capability: AppDataCapability,
    input: unknown,
    context: CapabilityExecutionContext & { installationId: string },
  ): void {
    if (capability !== "resume.definitions.write" || !isRecordValue(input) || input.kind !== "interview_recovery_save" || !isRecordValue(input.recovery)) return;
    const expectedRevision = input.recovery.expected_revision;
    if (expectedRevision !== null && (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0)) return;
    const authority = context.authority;
    const key = this.recoveryDiagnosticKey(authority.context.app_id, context.installationId, context.operationId);
    const processKey = this.currentProcessRecoveryKey(authority.context.app_id, context.installationId, context.operationId);
    if (!this.recoveryDiagnosticBindings.has(key)) {
      const binding = (processKey ? CURRENT_PROCESS_RECOVERY_BINDINGS.get(processKey) : undefined) ?? {
        expectedRevision: expectedRevision as number | null,
        semanticDigest: null,
        lifecycleState: "pending",
        conflictClass: "durable_value_mismatch",
        ownerId: authority.context.owner_id,
        actorId: authority.context.actor_id,
        grantId: authority.context.grant_id,
        grantRevision: authority.grant_revision,
        revocationGeneration: authority.revocation_generation,
        recordScopeIds: [...authority.context.record_scope_ids].sort(),
      };
      this.recoveryDiagnosticBindings.set(key, binding);
      if (processKey) CURRENT_PROCESS_RECOVERY_BINDINGS.remember(processKey, binding);
    }
    if (this.recoveryDiagnosticBindings.size > 1_000) {
      const oldestOperationId = this.recoveryDiagnosticBindings.keys().next().value;
      if (oldestOperationId) this.recoveryDiagnosticBindings.delete(oldestOperationId);
    }
  }

  private emitRecoveryReconciliationAudit(event: CapabilityOperationDisposition): void {
    const diagnosticKey = this.recoveryDiagnosticKey(event.appId, event.installationId, event.operationId);
    const processKey = this.currentProcessRecoveryKey(event.appId, event.installationId, event.operationId);
    const binding = this.recoveryDiagnosticBindings.get(diagnosticKey)
      ?? (processKey ? CURRENT_PROCESS_RECOVERY_BINDINGS.get(processKey) : undefined);
    if (!binding || event.capability !== "resume.definitions.write") return;
    if (binding.semanticDigest === null) binding.semanticDigest = event.inputDigest;
    if (!(event.idempotencyDisposition === "conflict" && event.conflictClass === "idempotency_input_mismatch")) {
      binding.lifecycleState = event.finalDisposition;
      if (event.conflictClass !== "none") binding.conflictClass = event.conflictClass;
    }
    if (processKey && binding.lifecycleState !== "pending") CURRENT_PROCESS_RECOVERY_BINDINGS.markTerminal(processKey);
    const initialWaitClass = event.finalDisposition === "pending"
      ? "not_observed"
      : event.elapsedMs <= 500
        ? "completed_before_initial_wait"
        : "ambiguous_after_initial_wait";
    const acknowledgementTimingClass = event.finalDisposition === "pending"
      ? "pending"
      : event.elapsedMs <= 500
        ? "before_initial_wait"
        : event.elapsedMs <= 750
          ? "observed_window"
          : event.elapsedMs <= 8_500
            ? "early_reconciliation"
            : event.elapsedMs < 120_000
              ? "late_reconciliation"
              : "host_deadline";
    const details = {
      diagnostic_version: 1 as const,
      app_id: this.appId,
      operation_id: event.operationId,
      semantic_digest: event.inputDigest,
      expected_revision: binding.expectedRevision,
      initial_wait_class: initialWaitClass,
      reconciliation_count: 0,
      reconciliation_class: "none" as const,
      acknowledgement_timing_class: acknowledgementTimingClass,
      idempotency_disposition: event.idempotencyDisposition,
      final_disposition: event.finalDisposition === "completed" ? "committed" as const : event.finalDisposition,
      conflict_class: event.conflictClass,
      error_code: event.errorCode,
    };
    assertContentFreeResumeRecoveryReconciliationAudit(details);
    this.audit("app.resume_recovery.reconciliation", details);
  }

  private recoveryDiagnosticKey(appId: string, installationId: string, operationId: string): string {
    return `${appId}:${installationId}:${operationId}`;
  }

  private currentProcessRecoveryKey(appId: string, installationId: string, operationId: string): string | null {
    return this.recoveryProcessInstanceId === null
      ? null
      : `${this.recoveryProcessInstanceId}:${this.recoveryDiagnosticKey(appId, installationId, operationId)}`;
  }

  private async executeRoutedDataCapability(
    capability: AppDataCapability,
    input: unknown,
    context: CapabilityExecutionContext & { installationId: string },
  ): Promise<unknown> {
    const query = capability === "resume.operations.read"
      ? ResumeRecoveryReconciliationQuerySchema.safeParse(input)
      : null;
    try {
      const result = await this.capabilityRouter!.execute(capability, input, context);
      if (!query?.success) return result;
      return this.projectCommittedRecoveryOperation(result, query.data.queried_operation_id);
    } catch (error) {
      if (!query?.success || !(error instanceof ResumeDomainError) || error.code !== "not_found_within_scope") throw error;
      return {
        recovery_reconciliation: this.projectMissingRecoveryOperation(query.data.queried_operation_id, context),
      };
    }
  }

  private projectCommittedRecoveryOperation(result: unknown, queriedOperationId: string): unknown {
    if (!isRecordValue(result) || !isRecordValue(result.record) || !Array.isArray(result.results)) return result;
    const progress = result.results.find((candidate) => isRecordValue(candidate) && candidate.record_type === "interview_progress");
    const metadata = isRecordValue(progress) && isRecordValue(progress.metadata) ? progress.metadata : null;
    const recoveryDraft = isRecordValue(progress) && isRecordValue(progress.recovery_draft) ? progress.recovery_draft : null;
    const operation = result.record;
    const candidate = {
      reconciliation_version: 1 as const,
      lifecycle_state: "committed" as const,
      queried_operation_id: queriedOperationId,
      semantic_digest: operation.canonical_input_digest,
      expected_revision: operation.expected_revision,
      host_operation_settled: true as const,
      operation: {
        state: "committed" as const,
        operation_id: operation.operation_id,
        value_digest: recoveryDraft?.value_digest,
        revision: metadata?.revision,
      },
    };
    const projection = ResumeRecoveryOperationLifecycleProjectionSchema.safeParse(candidate);
    if (!projection.success) return {
      ...result,
      recovery_reconciliation: this.currentProcessUnknownRecoveryProjection(queriedOperationId),
    };
    return { ...result, recovery_reconciliation: projection.data };
  }

  private projectMissingRecoveryOperation(
    queriedOperationId: string,
    context: CapabilityExecutionContext & { installationId: string },
  ): ResumeRecoveryOperationLifecycleProjection {
    const authority = context.authority;
    const key = this.recoveryDiagnosticKey(
      authority.context.app_id,
      context.installationId,
      queriedOperationId,
    );
    const processKey = this.currentProcessRecoveryKey(authority.context.app_id, context.installationId, queriedOperationId);
    const binding = this.recoveryDiagnosticBindings.get(key)
      ?? (processKey ? CURRENT_PROCESS_RECOVERY_BINDINGS.get(processKey) : undefined);
    if (binding && (!this.recoveryBindingMatchesAuthority(binding, authority) || binding.semanticDigest === null)) {
      return this.currentProcessUnknownRecoveryProjection(queriedOperationId);
    }
    if (!binding) {
      return this.startupTransactionRecoveryComplete
        ? this.quiescedRestartNoOperationProjection(queriedOperationId)
        : this.currentProcessUnknownRecoveryProjection(queriedOperationId);
    }
    const lifecycle = this.capabilityOperations.inspectLifecycle({
      appId: authority.context.app_id,
      installationId: context.installationId,
      capability: "resume.definitions.write",
      operationId: queriedOperationId,
    });
    const lifecycleState = lifecycle?.state ?? binding.lifecycleState;
    const common = {
      reconciliation_version: 1 as const,
      queried_operation_id: queriedOperationId,
      semantic_digest: binding.semanticDigest,
      expected_revision: binding.expectedRevision,
    };
    if (lifecycleState === "pending") {
      return ResumeRecoveryOperationLifecycleProjectionSchema.parse({
        ...common, lifecycle_state: "pending", host_operation_settled: false,
        operation: { state: "not_found_within_scope" },
      });
    }
    if (lifecycleState === "completed") {
      return ResumeRecoveryOperationLifecycleProjectionSchema.parse({
        ...common, lifecycle_state: "completed_without_operation", host_operation_settled: true,
        operation: { state: "not_found_within_scope" },
      });
    }
    if (lifecycleState === "conflict") {
      return ResumeRecoveryOperationLifecycleProjectionSchema.parse({
        ...common, lifecycle_state: "conflict", host_operation_settled: true,
        operation: { state: "conflict", conflict_class: binding.conflictClass },
      });
    }
    return ResumeRecoveryOperationLifecycleProjectionSchema.parse({
      ...common, lifecycle_state: lifecycleState, host_operation_settled: true,
      operation: { state: lifecycleState },
    });
  }

  private currentProcessUnknownRecoveryProjection(queriedOperationId: string): ResumeRecoveryOperationLifecycleProjection {
    return ResumeRecoveryOperationLifecycleProjectionSchema.parse({
      reconciliation_version: 1,
      queried_operation_id: queriedOperationId,
      semantic_digest: null,
      expected_revision: null,
      lifecycle_state: "current_process_lifecycle_unknown",
      host_operation_settled: false,
      operation: { state: "not_found_within_scope" },
    });
  }

  private quiescedRestartNoOperationProjection(queriedOperationId: string): ResumeRecoveryOperationLifecycleProjection {
    return ResumeRecoveryOperationLifecycleProjectionSchema.parse({
      reconciliation_version: 1,
      queried_operation_id: queriedOperationId,
      semantic_digest: null,
      expected_revision: null,
      lifecycle_state: "quiesced_restart_no_operation",
      host_operation_settled: true,
      operation: { state: "not_found_within_scope" },
    });
  }

  private recoveryBindingMatchesAuthority(binding: RecoveryOperationBinding, authority: CapabilityExecutionContext["authority"]): boolean {
    const scopes = [...authority.context.record_scope_ids].sort();
    return binding.ownerId === authority.context.owner_id
      && binding.actorId === authority.context.actor_id
      && binding.grantId === authority.context.grant_id
      && binding.grantRevision === authority.grant_revision
      && binding.revocationGeneration === authority.revocation_generation
      && binding.recordScopeIds.length === scopes.length
      && binding.recordScopeIds.every((scope, index) => scope === scopes[index]);
  }

  private consumeIssuedAuthority(
    issued: Awaited<ReturnType<AppLifecycleService["issueSession"]>>,
    grant: CapabilityGrant,
    capability: AppCapabilityName,
    binding: { connectionId: string; viewId: string | null; operationId: string; idempotencyKey: string },
  ) {
    return this.lifecycle.dependencies.tokenBroker.consume(issued.token, {
      audience: issued.claims.audience, capability, installationId: grant.installation_id,
      ownerId: grant.owner_id, actorId: grant.actor_id, appId: grant.app_id, publisherId: grant.publisher_id,
      packageDigest: grant.package_digest, grantId: grant.grant_id, grantRevision: grant.grant_revision,
      revocationGeneration: grant.revocation_generation, tokenGeneration: issued.claims.token_generation,
      connectionId: binding.connectionId, viewId: binding.viewId, operationId: binding.operationId,
      idempotencyKey: binding.idempotencyKey, recordScopes: grant.record_scopes, currentGrant: grant,
    });
  }

  private validateMessage(session: SessionRecord, message: BridgeMessage): void {
    const now = this.now();
    if (message.app_id !== this.appId || message.installation_id !== session.installationId || message.view_id !== session.viewId || message.operation_id !== session.operationId) {
      throw new AppPlatformError("bridge_denied", "Bridge identity binding is invalid", 403);
    }
    if (Math.abs(now - Date.parse(message.sent_at)) > 30_000) throw new AppPlatformError("bridge_stale", "Bridge message is stale", 409);
    if (session.seenMessages.has(message.message_id)) throw new AppPlatformError("bridge_replayed", "Bridge message was already handled", 409);
    session.messageTimes = session.messageTimes.filter((value) => now - value < 10_000);
    if (session.messageTimes.length >= 100) throw new AppPlatformError("bridge_denied", "Bridge message rate limit exceeded", 429);
    const tokenId = "token_id" in message.payload ? message.payload.token_id : null;
    if (tokenId !== null && tokenId !== session.bridgeTokenId) throw new AppPlatformError("bridge_denied", "Bridge token binding is invalid", 403);
    session.seenMessages.add(message.message_id);
    session.messageTimes.push(now);
  }

  private validateBridgeIngress(session: SessionRecord, messageId: string, sentAt: string): void {
    const now = this.now();
    if (Math.abs(now - Date.parse(sentAt)) > 30_000) throw new AppPlatformError("bridge_stale", "Apps bridge message is stale", 409);
    if (session.seenMessages.has(messageId)) throw new AppPlatformError("bridge_replayed", "Apps bridge message was already handled", 409);
    session.messageTimes = session.messageTimes.filter((value) => now - value < 10_000);
    if (session.messageTimes.length >= 100) throw new AppPlatformError("bridge_denied", "Apps bridge message rate limit exceeded", 429);
    session.seenMessages.add(messageId);
    session.messageTimes.push(now);
  }

  private asHostError(error: unknown): AppPlatformError {
    if (error instanceof AppPlatformError) return error;
    if (error instanceof ResumeDomainError) return new AppPlatformError(error.code, error.message, error.statusCode, error.details);
    return new AppPlatformError("recoverable_internal_failure", "Resume Builder data operation failed", 500);
  }

}

function inferenceIdempotencyKey(operationId: string): string { return `m5-inference-${operationId}`; }

function normalizeProfileReadInput(input: unknown): unknown {
  if (isRecordValue(input) && Object.keys(input).length === 0) return { view: "workspace" };
  return input;
}

function hasOperationQuery(input: unknown): boolean {
  return isRecordValue(input) && (typeof input.queried_operation_id === "string" || input.reconciliation === "resume_recovery_v1");
}

function resumeCreateInputForChat(rawInput: unknown): unknown {
  const input = ResumeChatCreateInputSchema.parse(rawInput);
  const parsed = parseResumeChatContent(input);
  if (parsed.statements.length === 0 || parsed.sectionOrder.length === 0) {
    throw new AppPlatformError("invalid_input", "Resume create requires at least one resume statement", 400);
  }
  return {
    definition_kind: "general",
    status: "proposed",
    title: parsed.title,
    statements: parsed.statements,
    section_order: parsed.sectionOrder,
    presentation_preferences: {},
    locale: input.locale,
    page_intent: input.page_intent,
    template_id: "ats-basic",
    template_version: "1",
    parent_definition_revision_id: null,
    job_revision_id: null,
    policy_version: "owner-authored-v1",
    prompt_policy_version: null,
    variant: null,
  };
}

function parseResumeChatContent(input: z.infer<typeof ResumeChatCreateInputSchema>): {
  title: string;
  statements: Array<{
    statement_id: string;
    section_id: string;
    kind: "presentation";
    display_role: "heading" | "bullet" | "line";
    text: string;
    supporting_confirmed_fact_revision_ids: [];
  }>;
  sectionOrder: string[];
} {
  const sectionOrder: string[] = [];
  const statements: ChatResumeStatement[] = [];
  let title = normalizeStatementText(input.title ?? "") || null;

  const addSection = (sectionId: string) => {
    if (!sectionOrder.includes(sectionId)) sectionOrder.push(sectionId);
  };
  const addStatement = (sectionId: string, text: string, displayRole: "heading" | "bullet" | "line") => {
    const normalizedText = normalizeStatementText(text);
    if (!normalizedText) return;
    addSection(sectionId);
    statements.push({
      statement_id: randomUUID(),
      section_id: sectionId,
      kind: "presentation",
      display_role: displayRole,
      text: normalizedText,
      supporting_confirmed_fact_revision_ids: [],
    });
  };

  if (input.sections) {
    for (const section of input.sections) {
      const sectionTitle = normalizeStatementText(section.title ?? section.section_id ?? "resume");
      const sectionId = sectionIdFor(section.section_id ?? sectionTitle);
      addSection(sectionId);
      if (section.title) addStatement(sectionId, sectionTitle, "heading");
      for (const statement of section.statements) addStatement(sectionId, statement, "bullet");
    }
  }

  if (input.resume_markdown) {
    let currentSection = "summary";
    for (const rawLine of input.resume_markdown.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const h1 = /^#\s+(.+)$/.exec(line);
      if (h1) {
        title ??= normalizeStatementText(h1[1]);
        continue;
      }
      const h2 = /^#{2,6}\s+(.+)$/.exec(line);
      if (h2) {
        const heading = normalizeStatementText(h2[1]);
        currentSection = sectionIdFor(heading);
        addStatement(currentSection, heading, "heading");
        continue;
      }
      const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
      if (bullet) {
        addStatement(currentSection, bullet[1], "bullet");
        continue;
      }
      addStatement(currentSection, line, "line");
    }
  }

  if (statements.length > 500) {
    throw new AppPlatformError("invalid_input", "Resume create supports up to 500 statements", 400);
  }
  return {
    title: title ?? "General Resume",
    statements,
    sectionOrder: sectionOrder.length > 0 ? sectionOrder : ["summary"],
  };
}

function sectionIdFor(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || `section-${randomUUID()}`;
}

function normalizeStatementText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resumeOwnerConfirmationProjection(capability: AppCapabilityName, input: unknown): { title: string; actionLabel: string } | null {
  if (capability === "career.facts.confirm") {
    if (isRecordValue(input) && Array.isArray(input.decisions)) return { title: "Review factual units from one answer", actionLabel: "Confirm" };
    if (isRecordValue(input) && input.decision === "edit_and_accept") return { title: "Confirm corrected career information", actionLabel: "Confirm" };
    if (isRecordValue(input) && input.decision === "reject") return { title: "Remove this career information?", actionLabel: "Confirm" };
    return { title: "Confirm career fact", actionLabel: "Confirm" };
  }
  if (capability !== "resume.definitions.write" || !isRecordValue(input)) return null;
  if (input.kind === "approve_definition") return { title: "Approve resume version", actionLabel: "Confirm" };
  if (input.kind === "revision_proposal" && input.owner_outcome === "edit") return { title: "Save edited revision proposal", actionLabel: "Confirm" };
  if (input.kind !== "revision_outcome") return null;
  if (input.state === "accepted") return { title: "Accept revision proposal", actionLabel: "Confirm" };
  if (input.state === "rejected") return { title: "Reject revision proposal", actionLabel: "Confirm" };
  if (input.state === "regenerate") return { title: "Regenerate revision proposal", actionLabel: "Confirm" };
  if (input.state === "generating" && (input.classification === "factual" || input.classification === "mixed")) {
    return { title: "Confirm factual resume revision", actionLabel: "Confirm" };
  }
  return null;
}

function isExactRecord(value: unknown, allowedKeys: string[], optionalKeys: string[] = []): value is Record<string, unknown> {
  if (!isRecordValue(value)) return false;
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  return allowedKeys.filter((key) => !optionalKeys.includes(key)).every((key) => key in value);
}
