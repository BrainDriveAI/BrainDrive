import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
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
  RestrictedCapabilityAuthoritySchema,
  restrictedAuthorityFromTokenClaims,
} from "../../resume-domain/capability-policy.js";
import { FactDecisionInputSchema, issueHostOwnerDecisionEvidence } from "../../resume-domain/career-data.js";
import { ResumeDomainError } from "../../resume-domain/errors.js";
import { CapabilityNameSchema } from "../contracts/package.js";
import type { CareerReturnSummary } from "../../resume-domain/career.js";
import type { PreparedResumeExport, ResumeExportBroker } from "../../resume-renderer/export-broker.js";
import { CapabilityOperationCoordinator, type CapabilityOperationDisposition } from "../../app-capabilities/operations.js";
import { CapabilityDispatcher } from "../../app-capabilities/dispatcher.js";
import { CapabilityRegistry, type HostCapabilityContext, type HostCapabilityRegistration } from "../../app-capabilities/registry.js";
import {
  ResumeRecoveryOperationLifecycleProjectionSchema,
  ResumeRecoveryReconciliationQuerySchema,
  type ResumeRecoveryOperationLifecycleProjection,
} from "../../app-capabilities/recovery-reconciliation.js";
import { AppActionPlanRequestSchema } from "../contracts/app-action-plan.js";
import type { RuntimeExportBytesReference } from "../contracts/app-action-plan.js";
import type { AppResourceDescriptor } from "../contracts/app-registry.js";
import { AppArtifactExportService } from "../../app-capabilities/artifact-export.js";
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
  type AppDocumentRole,
  type AppDocumentStorageAuthority,
  type AppStorageRetentionClass,
} from "../contracts/app-storage.js";
import { AppArtifactStore } from "../storage/app-artifact-store.js";
import { AppDocumentStorageService } from "../storage/app-document-store.js";
import {
  assertAppChatMetadataMatchesSession,
  buildAppChatModelContext,
  validateJsonValueAgainstActionSchema,
  type AppChatActionExecutionRequest,
  type AppChatResourcePromptContent,
} from "./app-chat-model.js";
import { readVerifiedPackageResource } from "./app-package-resource.js";
import { readOrSeedAppDocument } from "./app-document-content.js";
import { executeAppActionPlan } from "./app-action-plan-executor.js";
import type { AppArtifactRegistrationInput, AppArtifactRegistrationResult, AppChatActionExecuteInput, AppChatActionExecuteResult, AppChatModelContext, AppChatModelContextRequest, AppChatWorkspaceLaunch, AppChatWorkspaceLaunchInput, AppDocumentDeleteInput, AppDocumentDeleteResult, AppDocumentListResult, AppDocumentReadResult, AppDocumentWriteInput, AppExportPrepareInput, AppExportPrepared, AppLaunch, AppResourceReadResult } from "./app-host-types.js";
import { CurrentProcessRecoveryBindingRegistry } from "./recovery-binding-registry.js";
import type { ResumeDataCapability as AppDataCapability } from "../../resume-domain/capability-policy.js";

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

type AppsClient = Pick<ModernMcpAppsClient, "negotiate" | "readAppResource" | "callTool" | "cancel">;
type ResumeCapabilityRegistrationSpec = {
  name: string;
  audience: HostCapabilityRegistration["audience"];
  effect: HostCapabilityRegistration["effect"];
  confirmation: HostCapabilityRegistration["confirmation"];
  idempotencyPolicy: HostCapabilityRegistration["idempotencyPolicy"];
  ownerComponentId: string;
};
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
const RESUME_GENERIC_CAPABILITY_SPECS: readonly ResumeCapabilityRegistrationSpec[] = Object.freeze([
  { name: "career.context.read", audience: "app_data", effect: "read", confirmation: "none", idempotencyPolicy: "optional", ownerComponentId: "resume-domain" },
  { name: "career.facts.read", audience: "app_data", effect: "read", confirmation: "none", idempotencyPolicy: "optional", ownerComponentId: "resume-domain" },
  { name: "career.facts.propose", audience: "app_data", effect: "mutation", confirmation: "none", idempotencyPolicy: "required", ownerComponentId: "resume-domain" },
  { name: "career.facts.confirm", audience: "app_data", effect: "mutation", confirmation: "owner_confirmation", idempotencyPolicy: "required", ownerComponentId: "resume-domain" },
  { name: "resume.definitions.read", audience: "app_data", effect: "read", confirmation: "none", idempotencyPolicy: "optional", ownerComponentId: "resume-domain" },
  { name: "resume.definitions.write", audience: "app_data", effect: "mutation", confirmation: "none", idempotencyPolicy: "required", ownerComponentId: "resume-domain" },
  { name: "resume.jobs.read", audience: "app_data", effect: "read", confirmation: "none", idempotencyPolicy: "optional", ownerComponentId: "resume-domain" },
  { name: "resume.jobs.write", audience: "app_data", effect: "mutation", confirmation: "none", idempotencyPolicy: "required", ownerComponentId: "resume-domain" },
  { name: "resume.artifacts.register", audience: "app_data", effect: "mutation", confirmation: "none", idempotencyPolicy: "required", ownerComponentId: "resume-domain" },
  { name: "resume.export.request", audience: "app_export", effect: "export", confirmation: "trusted_owner_confirmation", idempotencyPolicy: "required", ownerComponentId: "resume-export" },
  { name: "resume.operations.read", audience: "app_data", effect: "read", confirmation: "none", idempotencyPolicy: "optional", ownerComponentId: "resume-domain" },
  { name: "app.inference.request", audience: "app_inference", effect: "inference", confirmation: "none", idempotencyPolicy: "required", ownerComponentId: "resume-inference" },
]);
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
  private readonly activeChatActions = new Map<string, Array<{ installationId: string; capability: string; idempotencyKey: string }>>();

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
      documentStorage?: AppDocumentStorageService;
      artifactExports?: AppArtifactExportService;
      capabilityDispatcher?: CapabilityDispatcher;
      capabilityRegistrations?: readonly HostCapabilityRegistration[];
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
    const genericStorageRoot = path.join(this.lifecycle.dependencies.ownerDataRoot, "generic");
    this.documentStorage = options.documentStorage ?? new AppDocumentStorageService(genericStorageRoot);
    this.artifactExports = options.artifactExports ?? new AppArtifactExportService({
      store: new AppArtifactStore(genericStorageRoot),
      now: () => new Date(this.now()),
      audit: this.audit,
    });
    this.installedAppInference = options.installedAppInference;
    this.capabilityRegistry = new CapabilityRegistry(options.capabilityRegistrations ?? this.createDefaultCapabilityRegistrations());
    this.capabilityDispatcher = options.capabilityDispatcher
      ?? new CapabilityDispatcher(this.capabilityRegistry, this.now, this.audit);
  }

  private readonly capabilityRouter?: ResumeCapabilityRouter;
  private readonly exportBroker?: ResumeExportBroker;
  private readonly capabilityOperations: CapabilityOperationCoordinator;
  private readonly installedAppInference?: InstalledAppInferenceExecutor;
  private readonly chatSessions: AppChatSessionRegistry;
  private readonly documentStorage: AppDocumentStorageService;
  private readonly artifactExports: AppArtifactExportService;
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly capabilityDispatcher: CapabilityDispatcher;

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
        empty_state: selection.workspace.empty_state ?? null,
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
    return projectAppChatSession(this.chatSessions.renew(this.appId, session.sessionId));
  }

  async readAppDocument(sessionId: string, documentId: string): Promise<AppDocumentReadResult> {
    const { session, descriptor, document } = await this.requireChatSessionForDocument(sessionId, documentId);
    const bindingId = document.data_binding_id ?? document.document_id;
    await this.documentStorage.initialize();
    const authority = this.storageAuthority(session, descriptor.grant!);
    await this.documentStorage.bindActiveAuthority(authority);
    const record = await this.documentStorage.readDocument(authority, document.document_id)
      ?? await readOrSeedAppDocument({
        documentStorage: this.documentStorage,
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

  async listAppDocuments(sessionId: string): Promise<AppDocumentListResult> {
    const { session, descriptor } = await this.requireChatSessionForStorage(sessionId);
    await this.documentStorage.initialize();
    const authority = this.storageAuthority(session, descriptor.grant!);
    await this.documentStorage.bindActiveAuthority(authority);
    return this.documentStorage.listDocuments(authority);
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
    await this.documentStorage.initialize();
    const authority = this.storageAuthority(session, descriptor.grant!);
    await this.documentStorage.bindActiveAuthority(authority);
    const result = await this.documentStorage.writeDocument({
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
    await this.documentStorage.initialize();
    const authority = this.storageAuthority(session, descriptor.grant!);
    await this.documentStorage.bindActiveAuthority(authority);
    const result = await this.documentStorage.deleteDocument({
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
      throw new AppPlatformError("invalid_state_transition", "App must be active before registering artifacts");
    }
    const result = await this.artifactExports.registerArtifact({
      ...input,
      authority: this.artifactAuthority(descriptor.grant, descriptor.record.installation_id, descriptor.record.active_package_digest as `sha256:${string}`, descriptor.record.generation),
    });
    return { result_version: 1, artifact: result.record, replayed: result.replayed };
  }

  async requestAppExport(input: AppExportPrepareInput, ownerActorId: string): Promise<AppExportPrepared> {
    const descriptor = await this.lifecycle.ownerDescriptor();
    if (descriptor.record.state !== "active" || !descriptor.record.installation_id || !descriptor.record.active_package_digest || !descriptor.grant) {
      throw new AppPlatformError("invalid_state_transition", "App must be active before requesting exports");
    }
    if (ownerActorId !== descriptor.grant.actor_id && ownerActorId !== "owner") {
      throw new AppPlatformError("denied", "Owner actor is not bound to this app installation", 403);
    }
    return this.artifactExports.prepareExport({
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
      executeAction: (actionRequest) => this.executeChatWorkspaceActionRequest(actionRequest),
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

  async executeAppChatAction(sessionId: string, actionId: string, input: AppChatActionExecuteInput, ownerActorId: string): Promise<AppChatActionExecuteResult> {
    const sessionProjection = await this.readChatWorkspaceSession(sessionId);
    const metadata = {
      metadata_version: 1 as const,
      app_id: sessionProjection.app_id,
      installation_id: sessionProjection.installation_id,
      package_digest: sessionProjection.package_digest,
      session_id: sessionProjection.session_id,
      view_id: sessionProjection.view_id,
      operation_id: sessionProjection.operation_id,
      session_generation: sessionProjection.session_generation,
      presentation_id: sessionProjection.presentation_id,
      workspace_id: sessionProjection.workspace_id,
      context_grant_set_digest: sessionProjection.context_grant_set_digest,
    };
    const { descriptor, workspace } = await this.requireChatSessionForModel(metadata);
    if (ownerActorId !== descriptor.grant!.actor_id && ownerActorId !== "owner") {
      throw new AppPlatformError("denied", "Owner actor is not bound to this app-chat action", 403);
    }
    const action = workspace.actions.find((candidate) => candidate.action_id === actionId);
    if (!action) throw new AppPlatformError("not_found_within_scope", "App action is not declared for this workspace", 404);
    const actionInput = input.action_input ?? {};
    const validationErrors = validateJsonValueAgainstActionSchema(actionInput, action.input_schema.schema);
    if (validationErrors.length > 0) {
      throw new AppPlatformError("invalid_input", "App action input failed schema validation", 400);
    }
    const result = await this.executeChatWorkspaceActionRequest({
      metadata,
      action,
      actionInput,
      operationId: input.operation_id,
      idempotencyKey: input.idempotency_key,
      ownerConfirmed: input.owner_confirmed,
    });
    const resultValidationErrors = validateJsonValueAgainstActionSchema(result, action.result_schema.schema);
    if (resultValidationErrors.length > 0) {
      throw new AppPlatformError("validation_failed", "App action result failed schema validation", 409);
    }
    return {
      action_id: action.action_id,
      operation_id: input.operation_id,
      idempotency_key: input.idempotency_key,
      result,
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
        const resumePrepared = await this.capabilityOperations.execute({
          appId: session.grant.app_id,
          installationId: session.installationId, connectionId: session.mcp.connectionId, viewId: session.viewId,
          capability: "resume.export.request", capabilityVersion: 1, operationId: message.message_id,
          idempotencyKey, input: exportInput, deadlineAt: Math.min(Date.parse(claims.expires_at), this.now() + 120_000),
        }, ({ isCancelled }) => this.exportBroker!.export(exportInput, { grant: session.grant, capability: "resume.export.request", operationId: message.message_id, idempotencyKey, isCancelled }));
        const result = await this.adoptResumePreparedExport(resumePrepared, session.grant, session.installationId, session.packageDigest, session.lifecycleGeneration, {
          operationId: message.message_id,
          idempotencyKey,
          sourceId: exportInput.definition_revision_id,
          ownerConfirmed: true,
          destinationIntent: exportInput.destination_intent,
          overwriteConfirmed: exportInput.overwrite_confirmed,
        });
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
      const confirmation = resumeOwnerConfirmationProjection(parsedCapability.data, input);
      if (confirmation && !hostOwnerConfirmed) {
        throw new AppPlatformError("denied", "This action requires host owner confirmation", 403, { confirmation });
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
      const generic = await this.finalizeGenericExportReceipt(input, operationId, idempotencyKey, descriptor.grant, descriptor.record.installation_id, descriptor.record.active_package_digest as `sha256:${string}` | null, descriptor.record.generation);
      if (generic) return generic;
      if (isRecordValue(input) && input.request_version === 1) return generic;
      const issued = await this.lifecycle.issueSession({ audience: "app_export", capabilities: ["resume.export.request"], operationId, idempotencyKey });
      const claims = this.consumeIssuedAuthority(issued, descriptor.grant, "resume.export.request", {
        connectionId: issued.claims.connection_id, viewId: null, operationId, idempotencyKey,
      });
      const legacy = await this.capabilityOperations.execute({
        appId: descriptor.grant.app_id,
        installationId: descriptor.record.installation_id, connectionId: claims.connection_id, viewId: null,
        capability: "resume.export.request", capabilityVersion: 1, operationId, idempotencyKey, input,
        deadlineAt: Math.min(Date.parse(claims.expires_at), this.now() + 120_000),
      }, ({ isCancelled }) => this.exportBroker!.finalize(input, { grant: descriptor.grant!, capability: "resume.export.request", operationId, idempotencyKey, isCancelled }));
      return generic ?? legacy;
    } catch (error) { throw this.asHostError(error); }
  }

  async issueServerCapabilityAuthority(sessionId: string, capability: unknown, operationId: string, idempotencyKey: string): Promise<{ token: string; expiresAt: string }> {
    const session = await this.requireSession(sessionId);
    const entry = this.capabilityRegistry.resolve(this.appId, capability, 1);
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
    const entry = this.capabilityRegistry.resolve(this.appId, capability, capabilityVersion);
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
        deadlineAt: Math.min(Date.parse(claims.expires_at), this.now() + entry.limits.maxDurationMs),
      }, ({ signal }) => this.lifecycle.dependencies.store.runIdempotent(idempotencyKey, { capability: entry.name, input: invocation.data }, () => this.installedAppInference!.execute(invocation.data, {
        appId: grant.app_id, installationId: claims.installation_id, packageDigest: matchingSession.packageDigest,
        programClient: createInstalledAppInferenceProgramClient(matchingSession.client, matchingSession.mcp), signal,
      })));
    }
    return this.executeDataCapability(entry.name as AppDataCapability, input, {
      authority: restrictedAuthorityFromTokenClaims(claims), installationId: claims.installation_id,
      connectionId: claims.connection_id, viewId: null, operationId, correlationId: operationId,
      idempotencyKey, deadlineAt: Math.min(Date.parse(claims.expires_at), this.now() + entry.limits.maxDurationMs),
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

  private async requireChatSessionForDocument(sessionId: string, documentId: string): Promise<{
    session: AppChatSessionRecord;
    descriptor: Awaited<ReturnType<AppLifecycleService["ownerDescriptor"]>>;
    document: ReturnType<typeof selectAppChatWorkspace>["workspace"]["documents"][number];
  }> {
    const session = this.chatSessions.read(this.appId, sessionId);
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
    const document = selection.workspace.documents.find((candidate) => candidate.document_id === documentId);
    if (!document) throw new AppPlatformError("not_found_within_scope", "App document is not declared for this workspace", 404);
    if (document.role === "conversation" || !document.data_binding_id) {
      throw new AppPlatformError("denied", "Workspace item is not bound to app document storage", 403);
    }
    return { session: this.chatSessions.renew(this.appId, session.sessionId), descriptor, document };
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
    await this.documentStorage.initialize();
    await this.documentStorage.bindActiveAuthority(authority);
    const record = await readOrSeedAppDocument({
      documentStorage: this.documentStorage,
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
    const session = this.chatSessions.read(this.appId, sessionId);
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
    return { session: this.chatSessions.renew(this.appId, session.sessionId), descriptor };
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

  private async adoptResumePreparedExport(
    prepared: PreparedResumeExport,
    grant: CapabilityGrant,
    installationId: string,
    packageDigest: `sha256:${string}`,
    lifecycleGeneration: number,
    input: {
      operationId: string;
      idempotencyKey: string;
      sourceId: string;
      ownerConfirmed: boolean;
      destinationIntent: "new_download" | "replace_existing";
      overwriteConfirmed: boolean;
    },
  ): Promise<PreparedResumeExport & { generic_artifact: unknown; replayed: boolean }> {
    const bytes = Buffer.from(prepared.bytes_base64, "base64");
    const generic = await this.artifactExports.prepareExport({
      request_version: 1,
      authority: this.artifactAuthority(grant, installationId, packageDigest, lifecycleGeneration),
      operation_id: input.operationId,
      idempotency_key: `${input.idempotencyKey}:generic-export`,
      source: { kind: "app_document", source_id: input.sourceId },
      content_digest: prepared.artifact_digest,
      content_size_bytes: bytes.length,
      retention_class: "durable_owner_data",
      media_type: prepared.mime_type,
      filename: prepared.filename,
      destination_intent: input.destinationIntent,
      overwrite_confirmed: input.overwriteConfirmed,
      owner_confirmed: input.ownerConfirmed,
      bytes_base64: prepared.bytes_base64,
      artifact_id: prepared.artifact_revision_id,
      artifact_revision_id: prepared.artifact_revision_id,
    });
    return {
      ...prepared,
      artifact_revision_id: generic.artifact.artifact_revision_id,
      generic_artifact: generic.artifact,
      replayed: generic.replayed,
    };
  }

  private async finalizeGenericExportReceipt(
    input: unknown,
    operationId: string,
    idempotencyKey: string,
    grant: CapabilityGrant,
    installationId: string,
    packageDigest: `sha256:${string}` | null,
    lifecycleGeneration: number,
  ): Promise<unknown | null> {
    if (!packageDigest || !isRecordValue(input)) return null;
    if (input.request_version === 1 && typeof input.content_digest === "string" && typeof input.media_type === "string") {
      return await this.artifactExports.finalizeExport({
        ...input,
        operation_id: operationId,
        idempotency_key: typeof input.idempotency_key === "string" ? input.idempotency_key : `${idempotencyKey}:generic-receipt`,
        authority: this.artifactAuthority(grant, installationId, packageDigest, lifecycleGeneration),
      });
    }
    if (typeof input.artifact_revision_id !== "string" || typeof input.artifact_digest !== "string" || typeof input.safe_destination_label !== "string" || typeof input.outcome !== "string") {
      return null;
    }
    const artifact = await this.artifactExports.readArtifact(
      this.artifactAuthority(grant, installationId, packageDigest, lifecycleGeneration),
      input.artifact_revision_id,
    );
    if (!artifact || artifact.content_digest !== input.artifact_digest) return null;
    const outcome = input.outcome === "completed" || input.outcome === "cancelled" || input.outcome === "failed"
      ? input.outcome
      : null;
    if (!outcome) return null;
    return await this.artifactExports.finalizeExport({
      request_version: 1,
      authority: this.artifactAuthority(grant, installationId, packageDigest, lifecycleGeneration),
      operation_id: operationId,
      idempotency_key: `${idempotencyKey}:generic-receipt`,
      artifact_revision_id: input.artifact_revision_id,
      content_digest: artifact.content_digest,
      media_type: artifact.media_type,
      outcome,
      safe_destination_label: input.safe_destination_label,
    });
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
    return { session: this.chatSessions.renew(this.appId, session.sessionId), descriptor, workspace: selection.workspace };
  }

  private createDefaultCapabilityRegistrations(): readonly HostCapabilityRegistration[] {
    return RESUME_GENERIC_CAPABILITY_SPECS.map((spec) => ({
      appId: this.appId,
      name: spec.name,
      version: 1,
      audience: spec.audience,
      effect: spec.effect,
      inputSchema: z.unknown(),
      resultSchema: z.unknown(),
      limits: { maxInputBytes: 262_144, maxDurationMs: 120_000, maxCallsPerMinute: 60 },
      confirmation: spec.confirmation,
      confirmationProjection: spec.confirmation === "none"
        ? null
        : {
            title: spec.confirmation === "trusted_owner_confirmation" ? "Approve trusted owner action" : "Approve owner action",
            actionLabel: spec.confirmation === "trusted_owner_confirmation" ? "Approve trusted action" : "Approve action",
          },
      auditProjectionId: `${spec.name}.audit.v1`,
      retryPolicy: "idempotent_only",
      idempotencyPolicy: spec.idempotencyPolicy,
      ownerComponentId: spec.ownerComponentId,
      handler: (input, context) => this.executeRegisteredCapability(spec, input, context),
    }));
  }

  private async executeRegisteredCapability(
    spec: ResumeCapabilityRegistrationSpec,
    input: unknown,
    context: HostCapabilityContext,
  ): Promise<unknown> {
    if (spec.name === "app.inference.request") {
      return this.executeRegisteredInferenceCapability(input, context);
    }
    return this.executeRegisteredDataCapability(spec.name as AppDataCapability, input, context);
  }

  private async executeRegisteredDataCapability(
    capability: AppDataCapability,
    input: unknown,
    context: HostCapabilityContext,
  ): Promise<unknown> {
    const connectionId = context.connectionId ?? context.viewId ?? context.operationId;
    return this.executeDataCapability(capability, input, {
      authority: this.restrictedAuthorityForRegisteredCapability(capability, context, connectionId),
      installationId: context.installationId,
      connectionId,
      viewId: context.viewId,
      operationId: context.operationId,
      correlationId: context.operationId,
      idempotencyKey: context.idempotencyKey,
      deadlineAt: context.deadlineAt,
      hostOwnerConfirmed: context.ownerConfirmation.confirmed,
      isCancelled: context.isCancelled,
    });
  }

  private async executeRegisteredInferenceCapability(input: unknown, context: HostCapabilityContext): Promise<unknown> {
    if (!this.installedAppInference) throw new AppPlatformError("denied", "Installed app inference is not configured", 403);
    if (!context.sessionId || !context.viewId) throw new AppPlatformError("denied", "Installed app inference requires an active app-chat session", 403);
    const session = this.chatSessions.read(this.appId, context.sessionId);
    if (
      session.installationId !== context.installationId ||
      session.packageDigest !== context.packageDigest ||
      session.viewId !== context.viewId ||
      session.lifecycleGeneration !== context.lifecycleGeneration
    ) {
      throw new AppPlatformError("denied", "Installed app inference session binding is invalid", 403);
    }
    const invocation = InstalledAppInferenceInvocationSchema.safeParse(input);
    if (!invocation.success || invocation.data.operation_id !== context.operationId) {
      throw new AppPlatformError("invalid_input", "Installed app inference action input is invalid", 400);
    }
    const connection = this.lifecycle.dependencies.supervisor.connectionFor(session.installationId);
    if (connection.runtime.package_digest !== session.packageDigest) {
      throw new AppPlatformError("runtime_conflict", "Active app runtime does not match the chat workspace package", 409);
    }
    const client = this.clientFactory(connection);
    const mcp = await client.negotiate();
    return this.lifecycle.dependencies.store.runIdempotent(
      context.idempotencyKey,
      { capability: "app.inference.request", input: invocation.data },
      () => this.installedAppInference!.execute(invocation.data, {
        appId: context.appId,
        installationId: context.installationId,
        packageDigest: context.packageDigest,
        programClient: createInstalledAppInferenceProgramClient(client, mcp),
        signal: context.signal,
      }),
    );
  }

  private restrictedAuthorityForRegisteredCapability(
    capability: AppDataCapability,
    context: HostCapabilityContext,
    connectionId: string,
  ): CapabilityExecutionContext["authority"] {
    const grant = context.grant as CapabilityGrant;
    return RestrictedCapabilityAuthoritySchema.parse({
      authority_version: 1,
      context: {
        context_version: 1,
        owner_id: grant.owner_id,
        actor_id: grant.actor_id,
        app_id: context.appId,
        publisher_id: grant.publisher_id,
        package_digest: context.packageDigest,
        installation_id: context.installationId,
        grant_id: grant.grant_id,
        audience: "resume_data",
        granted_capabilities: [capability],
        record_scope_ids: grant.record_scopes,
        issued_at: new Date(this.now()).toISOString(),
        expires_at: new Date(Math.min(Date.parse(grant.expires_at), context.deadlineAt)).toISOString(),
      },
      grant_revision: grant.grant_revision,
      revocation_generation: grant.revocation_generation,
      token_audience: capability === "resume.export.request" ? "app_export" : "app_data",
      connection_id: connectionId,
      view_id: context.viewId,
      operation_id: context.operationId,
    });
  }

  private async executeChatWorkspaceActionRequest(request: AppChatActionExecutionRequest): Promise<unknown> {
    const { session, descriptor, workspace } = await this.requireChatSessionForModel(request.metadata);
    const action = workspace.actions.find((candidate) => candidate.action_id === request.action.action_id);
    if (!action || action.model_exposure !== "available") {
      throw new AppPlatformError("denied", "App action is not declared for workspace use", 403);
    }
    const grantedCapabilities = new Set(descriptor.grant?.capabilities ?? []);
    for (const capability of action.required_capabilities) {
      if (capability.version !== 1 || !grantedCapabilities.has(capability.name)) {
        throw new AppPlatformError("denied", "App action required capability is not granted", 403);
      }
    }
    const manifest = descriptor.storedPackage!.manifest;
    const manifestRequests = manifestCapabilityRequests(manifest);
    const requestedPurposes = manifest.manifest_version === 2 ? manifest.requested_inference_purposes : [];
    if (action.idempotency_policy === "required" && request.idempotencyKey.length < 16) {
      throw new AppPlatformError("invalid_input", "App action requires a stable idempotency key", 400);
    }
    for (const capability of action.required_capabilities) {
      this.rememberChatAction(session.sessionId, session.installationId, capability.name, request.idempotencyKey);
    }
    try {
      const plan = await this.planChatWorkspaceActionWithRuntime(request, session, descriptor, workspace);
      if (plan) {
        return await executeAppActionPlan({
          rawPlan: plan,
          action,
          session,
          workspace,
          grant: descriptor.grant!,
          storedPackage: descriptor.storedPackage!,
          manifestRequests,
          requestedPurposes,
          operationId: request.operationId,
          idempotencyKey: request.idempotencyKey,
          ownerConfirmed: request.ownerConfirmed,
          now: this.now,
          capabilityDispatcher: this.capabilityDispatcher,
          documentStorage: this.documentStorage,
          artifactExports: this.artifactExports,
          resolveRuntimeExportBytes: (reference, expected) => this.resolveRuntimeExportBytes(session, reference, expected),
          storageAuthority: this.storageAuthority(session, descriptor.grant!),
          artifactAuthority: this.artifactAuthority(descriptor.grant!, session.installationId, session.packageDigest, session.lifecycleGeneration),
          audit: this.audit,
        });
      }
      if (action.required_capabilities.length !== 1) {
        throw new AppPlatformError("incompatible_schema", "App action requires a runtime action planner or exactly one host capability", 409);
      }
      const requiredCapability = action.required_capabilities[0]!;
      return await this.capabilityDispatcher.execute(requiredCapability.name, requiredCapability.version, request.actionInput, {
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
        deadlineAt: this.now() + 120_000,
        ownerConfirmation: {
          confirmed: request.ownerConfirmed,
          proofId: request.ownerConfirmed ? randomUUID() : undefined,
        },
      });
    } finally {
      for (const capability of action.required_capabilities) {
        this.forgetChatAction(session.sessionId, capability.name, request.idempotencyKey);
      }
    }
  }

  private async planChatWorkspaceActionWithRuntime(
    request: AppChatActionExecutionRequest,
    session: AppChatSessionRecord,
    descriptor: Awaited<ReturnType<AppLifecycleService["ownerDescriptor"]>>,
    workspace: ReturnType<typeof selectAppChatWorkspace>["workspace"],
  ): Promise<unknown | null> {
    const connection = this.lifecycle.dependencies.supervisor.connectionFor(session.installationId);
    if (connection.runtime.package_digest !== session.packageDigest) {
      throw new AppPlatformError("runtime_conflict", "Active app runtime does not match the chat workspace package", 409);
    }
    const client = this.clientFactory(connection);
    const mcp = await client.negotiate();
    if (!mcp.tools?.some((tool) => tool.name === "app.actions.plan")) return null;
    const authority = this.storageAuthority(session, descriptor.grant!);
    await this.documentStorage.initialize();
    await this.documentStorage.bindActiveAuthority(authority);
    const documents = [];
    for (const document of workspace.documents) {
      if (!document.data_binding_id) continue;
      const record = await readOrSeedAppDocument({
        documentStorage: this.documentStorage,
        authority,
        storedPackage: descriptor.storedPackage!,
        document,
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        audit: this.audit,
      });
      if (!record) continue;
      documents.push({
        document_id: record.document_id,
        document_binding_id: record.document_binding_id,
        media_type: record.media_type,
        revision: record.revision,
        revision_id: record.revision_id,
        content: record.content,
      });
    }
    const planRequest = AppActionPlanRequestSchema.parse({
      action_planning_contract_version: 1,
      action_id: request.action.action_id,
      action_input: request.actionInput,
      owner_confirmed: request.ownerConfirmed,
      operation_id: request.operationId,
      idempotency_key: request.idempotencyKey,
      occurred_at: session.createdAt,
      session: {
        session_id: session.sessionId,
        view_id: session.viewId,
        app_id: session.appId,
        installation_id: session.installationId,
      },
      documents,
    });
    const complete = await client.callTool(mcp, "app.actions.plan", planRequest, request.operationId, "model");
    const projected = projectMcpResult(complete, "model");
    if (projected.isError || !projected.structuredContent) {
      throw new AppPlatformError("validation_failed", "Installed app action planner returned no structured plan", 409);
    }
    return projected.structuredContent;
  }

  private async resolveRuntimeExportBytes(
    session: AppChatSessionRecord,
    reference: RuntimeExportBytesReference,
    expected: {
      contentDigest: string;
      contentSizeBytes: number;
      mediaType: string;
      filename: string;
    },
  ): Promise<Buffer> {
    const connection = this.lifecycle.dependencies.supervisor.connectionFor(session.installationId);
    if (connection.runtime.package_digest !== session.packageDigest) {
      throw new AppPlatformError("runtime_conflict", "Active app runtime does not match the chat workspace package", 409);
    }
    const exportUrl = new URL(`/runtime-exports/${encodeURIComponent(reference.export_id)}`, connection.url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    let bytes: Buffer;
    try {
      response = await fetch(exportUrl, {
        method: "GET",
        headers: { authorization: `Bearer ${connection.authorization}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new AppPlatformError("validation_failed", "App runtime export bytes were unavailable", 409);
      }
      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > expected.contentSizeBytes) {
        throw new AppPlatformError("validation_failed", "App runtime export bytes exceed the planned size", 409);
      }
      const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (mediaType && mediaType !== "application/octet-stream" && mediaType !== expected.mediaType.toLowerCase()) {
        throw new AppPlatformError("validation_failed", "App runtime export bytes media type did not match the plan", 409);
      }
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof AppPlatformError) throw error;
      throw new AppPlatformError("validation_failed", error instanceof Error ? error.message : "App runtime export bytes could not be fetched", 409);
    } finally {
      clearTimeout(timeout);
    }
    if (bytes.length !== expected.contentSizeBytes) {
      throw new AppPlatformError("validation_failed", "App runtime export bytes size did not match the plan", 409);
    }
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== expected.contentDigest) {
      throw new AppPlatformError("validation_failed", "App runtime export bytes digest did not match the plan", 409);
    }
    return bytes;
  }

  private rememberChatAction(sessionId: string, installationId: string, capability: string, idempotencyKey: string): void {
    const current = this.activeChatActions.get(sessionId) ?? [];
    current.push({ installationId, capability, idempotencyKey });
    this.activeChatActions.set(sessionId, current);
  }

  private forgetChatAction(sessionId: string, capability: string, idempotencyKey: string): void {
    const next = (this.activeChatActions.get(sessionId) ?? []).filter((item) => item.capability !== capability || item.idempotencyKey !== idempotencyKey);
    if (next.length === 0) this.activeChatActions.delete(sessionId);
    else this.activeChatActions.set(sessionId, next);
  }

  private cancelChatActions(sessionId: string): void {
    const actions = this.activeChatActions.get(sessionId) ?? [];
    for (const action of actions) {
      this.capabilityDispatcher.cancel(this.appId, action.installationId, action.capability, action.idempotencyKey);
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
    capability: string,
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

function manifestCapabilityRequests(manifest: {
  manifest_version: number;
  requested_capabilities: readonly (string | { name: string; version: number })[];
}): readonly { name: string; version: number }[] {
  return manifest.requested_capabilities.map((capability) => (
    typeof capability === "string" ? { name: capability, version: 1 } : capability
  ));
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

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resumeOwnerConfirmationProjection(capability: AppDataCapability, input: unknown): { title: string; actionLabel: string } | null {
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
