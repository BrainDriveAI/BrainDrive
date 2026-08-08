import { randomUUID } from "node:crypto";

import type { z } from "zod";

import { BridgeMessageSchema, McpAppResourceSchema, parseBridgeMessage } from "../contracts/mcp-app.js";
import { ContractViolation } from "../contracts/errors.js";
import type { AppLifecycleService } from "../lifecycle/service.js";
import { AppPlatformError } from "../lifecycle/errors.js";
import type { AppRuntimeConnection } from "../lifecycle/process-supervisor.js";
import {
  HttpMcpWireTransport,
  ModernMcpAppsClient,
  appVisibleToolNames,
  type LoadedAppResource,
  type ModernMcpSession,
} from "./modern-client.js";
import type { CompleteMcpResult } from "../../mcp/result-envelope.js";
import type { CapabilityGrant } from "../lifecycle/store.js";
import type { ResumeCapabilityRouter } from "../../resume-domain/capabilities.js";
import {
  requireHostOwnerCapabilityAuthorization,
  restrictedAuthorityFromTokenClaims,
  type HostOwnerCapabilityAuthorization,
} from "../../resume-domain/capability-policy.js";
import { FactDecisionInputSchema, issueHostOwnerDecisionEvidence } from "../../resume-domain/career-data.js";
import { ResumeDomainError } from "../../resume-domain/errors.js";
import { CapabilityNameSchema } from "../contracts/package.js";
import type { CareerReturnSummary } from "../../resume-domain/career.js";
import type { ResumeInferenceBroker } from "../../resume-inference/broker.js";
import type { ImmutableInferenceSnapshotBuilder } from "../../resume-inference/snapshot.js";
import { ResumeInferenceError } from "../../resume-inference/errors.js";
import type { ResumeExportBroker } from "../../resume-renderer/export-broker.js";

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

type AppsClient = Pick<ModernMcpAppsClient, "negotiate" | "readAppResource" | "callTool">;
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
  allowedTools: Set<string>;
  allowedCapabilities: Set<string>;
  grant: CapabilityGrant;
  entryPoint: "direct" | "career";
  seenMessages: Set<string>;
  messageTimes: number[];
  inferenceOperations: Set<string>;
};

export type AppLaunch = {
  launch_version: 1;
  session_id: string;
  installation_id: string;
  view_id: string;
  operation_id: string;
  bridge_token_id: string;
  server_id: string;
  expires_at: string;
  protocol: { core: string; apps_extension: string; server_name: string; server_version: string };
  resource: AppResource;
  allowed_tools: string[];
  allowed_capabilities: string[];
  entry_point: "direct" | "career";
};

export class AppMcpHost {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly clientFactory: (connection: AppRuntimeConnection) => AppsClient;
  private readonly now: () => number;
  private readonly audit: (event: string, details: Record<string, unknown>) => void;

  constructor(
    private readonly lifecycle: AppLifecycleService,
    options: {
      clientFactory?: (connection: AppRuntimeConnection) => AppsClient;
      now?: () => number;
      audit?: (event: string, details: Record<string, unknown>) => void;
      capabilityRouter?: ResumeCapabilityRouter;
      inferenceBroker?: ResumeInferenceBroker;
      snapshotBuilder?: ImmutableInferenceSnapshotBuilder;
      exportBroker?: ResumeExportBroker;
    } = {},
  ) {
    this.clientFactory = options.clientFactory ?? ((connection) => new ModernMcpAppsClient(new HttpMcpWireTransport(connection)));
    this.now = options.now ?? Date.now;
    this.audit = options.audit ?? (() => undefined);
    this.capabilityRouter = options.capabilityRouter;
    this.inferenceBroker = options.inferenceBroker;
    this.snapshotBuilder = options.snapshotBuilder;
    this.exportBroker = options.exportBroker;
  }

  private readonly capabilityRouter?: ResumeCapabilityRouter;
  private readonly inferenceBroker?: ResumeInferenceBroker;
  private readonly snapshotBuilder?: ImmutableInferenceSnapshotBuilder;
  private readonly exportBroker?: ResumeExportBroker;

  async launch(entryPoint: "direct" | "career" = "direct"): Promise<AppLaunch> {
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
    const loadedResource = await client.readAppResource(mcp, "ui://resume-builder/main", packageDigest);
    const resource = loadedResource.resource;
    this.audit("app.mcp.resource_loaded", {
      app_id: record.app_id, installation_id: record.installation_id, package_digest: packageDigest,
      connection_id: mcp.connectionId, adapter: "modern", decision: "allowed", status: "completed",
      resource_size_bytes: resource.size_bytes,
    });
    const allowedTools = appVisibleToolNames(mcp.tools);
    const allowedCapabilities = descriptor.grant.capabilities.filter((capability) => APP_BRIDGE_CAPABILITIES.has(capability));
    const viewId = randomUUID();
    const operationId = randomUUID();
    const issued = await this.lifecycle.issueSession({
      audience: "app_bridge",
      capabilities: ["career.context.read"],
      operationId,
      viewId,
      connectionId: mcp.connectionId,
    });
    this.lifecycle.dependencies.tokenBroker.consume(issued.token, {
      audience: "app_bridge",
      capability: "career.context.read",
      installationId: record.installation_id,
      operationId,
    });
    const session: SessionRecord = {
      sessionId: randomUUID(), viewId, operationId, installationId: record.installation_id,
      packageDigest, lifecycleGeneration: record.generation,
      bridgeTokenId: issued.claims.token_id, expiresAt: issued.claims.expires_at,
      client, mcp, resourceEnvelope: loadedResource.envelope,
      allowedTools: new Set(allowedTools), allowedCapabilities: new Set(allowedCapabilities), grant: descriptor.grant,
      entryPoint,
      seenMessages: new Set(), messageTimes: [], inferenceOperations: new Set(),
    };
    this.sessions.set(session.sessionId, session);
    this.audit("app.mcp.session_opened", {
      app_id: record.app_id, installation_id: session.installationId, package_digest: session.packageDigest,
      connection_id: mcp.connectionId, view_id: viewId, operation_id: operationId,
      protocol_version: mcp.protocolVersion, extension_version: mcp.extensionVersion,
      resource_size_bytes: resource.size_bytes, tool_count: allowedTools.length, outcome: "allowed",
    });
    return {
      launch_version: 1, session_id: session.sessionId, installation_id: session.installationId, view_id: viewId, operation_id: operationId,
      bridge_token_id: session.bridgeTokenId, server_id: mcp.connectionId, expires_at: session.expiresAt,
      protocol: { core: mcp.protocolVersion, apps_extension: mcp.extensionVersion, server_name: mcp.serverName, server_version: mcp.serverVersion },
      resource, allowed_tools: allowedTools, allowed_capabilities: allowedCapabilities,
      entry_point: entryPoint,
    };
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
      if (!session.inferenceOperations.has(message.payload.target_operation_id) || !this.inferenceBroker) {
        throw new AppPlatformError("bridge_denied", "Cancellation target is outside this app session", 403);
      }
      return { status: "capability_completed", result: { cancelled: this.inferenceBroker.cancel(message.payload.target_operation_id) } };
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
        const issued = await this.lifecycle.issueSession({ audience: "app_export", capabilities: ["resume.export.request"], operationId: message.message_id, viewId: session.viewId, connectionId: session.mcp.connectionId });
        this.lifecycle.dependencies.tokenBroker.consume(issued.token, { audience: "app_export", capability: "resume.export.request", installationId: session.installationId, operationId: message.message_id });
        const result = await this.exportBroker.export({ action: "export", definition_revision_id: message.payload.definition_revision_id, safe_filename: message.payload.safe_filename, destination_intent: message.payload.destination_intent, overwrite_confirmed: message.payload.overwrite_confirmed }, { grant: session.grant, capability: "resume.export.request", operationId: message.message_id, idempotencyKey: `bridge-${message.message_id}` });
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
          if (!this.inferenceBroker || !this.snapshotBuilder) throw new AppPlatformError("bridge_denied", "Inference broker is not configured", 403);
          const request = await this.snapshotBuilder.build(message.payload.input, session.grant);
          const issued = await this.lifecycle.issueSession({ audience: "app_inference", capabilities: [parsedCapability.data], operationId: request.operation_id, viewId: session.viewId, connectionId: session.mcp.connectionId });
          this.lifecycle.dependencies.tokenBroker.consume(issued.token, { audience: "app_inference", capability: parsedCapability.data, installationId: session.installationId, operationId: request.operation_id });
          session.inferenceOperations.add(request.operation_id);
          return { status: "capability_completed", result: this.appInferenceProjection(await this.inferenceBroker.execute(request)) };
        }
        if (!this.capabilityRouter) throw new AppPlatformError("bridge_denied", "Data capabilities are not available for this app session", 403);
        const audience = parsedCapability.data === "resume.export.request" ? "app_export" : "app_data";
        const issued = await this.lifecycle.issueSession({ audience, capabilities: [parsedCapability.data], operationId: message.message_id, viewId: session.viewId, connectionId: session.mcp.connectionId });
        const claims = this.lifecycle.dependencies.tokenBroker.consume(issued.token, { audience, capability: parsedCapability.data, installationId: session.installationId, operationId: message.message_id });
        const result = await this.capabilityRouter.execute(parsedCapability.data, message.payload.input, {
          authority: restrictedAuthorityFromTokenClaims(claims),
          operationId: message.message_id,
          correlationId: message.message_id,
          idempotencyKey: `bridge-${message.message_id}`,
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

  async handleOwnerCapability(capability: unknown, input: unknown, operationId: string, hostOwnerConfirmed: boolean, ownerAuthorization: HostOwnerCapabilityAuthorization): Promise<unknown> {
    const parsedCapability = CapabilityNameSchema.safeParse(capability);
    if (!parsedCapability.success) throw new AppPlatformError("invalid_input", "Capability name is invalid", 400);
    requireHostOwnerCapabilityAuthorization(ownerAuthorization);
    const descriptor = await this.lifecycle.ownerDescriptor();
    if (descriptor.record.state !== "active" || !descriptor.record.installation_id || !descriptor.grant) throw new AppPlatformError("invalid_state_transition", "Resume Builder must be active before data access");
    try {
      if (parsedCapability.data === "app.inference.request") {
        if (!this.inferenceBroker || !this.snapshotBuilder) throw new AppPlatformError("bridge_denied", "Inference broker is not configured", 403);
        const issued = await this.lifecycle.issueSession({ audience: "app_inference", capabilities: [parsedCapability.data], operationId });
        this.lifecycle.dependencies.tokenBroker.consume(issued.token, { audience: "app_inference", capability: parsedCapability.data, installationId: descriptor.record.installation_id, operationId });
        const inferenceRequest = await this.snapshotBuilder.build(input, descriptor.grant);
        if (inferenceRequest.operation_id !== operationId) throw new AppPlatformError("invalid_input", "Inference operation identity does not match the owner request", 400);
        return this.appInferenceProjection(await this.inferenceBroker.execute(inferenceRequest));
      }
      if (!this.capabilityRouter) throw new AppPlatformError("bridge_denied", "Data capabilities are not available", 403);
      const audience = parsedCapability.data === "resume.export.request" ? "app_export" : "app_data";
      const issued = await this.lifecycle.issueSession({ audience, capabilities: [parsedCapability.data], operationId });
      const claims = this.lifecycle.dependencies.tokenBroker.consume(issued.token, { audience, capability: parsedCapability.data, installationId: descriptor.record.installation_id, operationId });
      const factDecision = parsedCapability.data === "career.facts.confirm" && hostOwnerConfirmed
        ? FactDecisionInputSchema.safeParse(input)
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
      return await this.capabilityRouter.execute(parsedCapability.data, input, {
        authority: restrictedAuthorityFromTokenClaims(claims),
        operationId,
        correlationId: operationId,
        idempotencyKey: `owner-${operationId}`,
        hostOwnerConfirmed,
        ownerDecision,
      });
    } catch (error) { throw this.asHostError(error); }
  }

  async placeCareerReturn(summary: CareerReturnSummary, entryPoint: "direct" | "career", operationId: string) {
    if (!this.capabilityRouter) throw new AppPlatformError("bridge_denied", "Career return placement is not available", 403);
    const descriptor = await this.lifecycle.ownerDescriptor();
    if (descriptor.record.state !== "active" || !descriptor.record.installation_id || !descriptor.grant) throw new AppPlatformError("invalid_state_transition", "Resume Builder must be active before Career return placement");
    try { return await this.capabilityRouter.placeCareerReturn(summary, entryPoint, operationId, descriptor.grant); }
    catch (error) { throw this.asHostError(error); }
  }

  async finalizeOwnerExport(input: unknown, operationId: string): Promise<unknown> {
    if (!this.exportBroker) throw new AppPlatformError("bridge_denied", "Export broker is not available", 403);
    const descriptor = await this.lifecycle.ownerDescriptor();
    if (descriptor.record.state !== "active" || !descriptor.record.installation_id || !descriptor.grant) throw new AppPlatformError("invalid_state_transition", "Resume Builder must be active before export completion");
    try {
      const issued = await this.lifecycle.issueSession({ audience: "app_export", capabilities: ["resume.export.request"], operationId });
      this.lifecycle.dependencies.tokenBroker.consume(issued.token, { audience: "app_export", capability: "resume.export.request", installationId: descriptor.record.installation_id, operationId });
      return await this.exportBroker.finalize(input, { grant: descriptor.grant, capability: "resume.export.request", operationId, idempotencyKey: `owner-export-${operationId}` });
    } catch (error) { throw this.asHostError(error); }
  }

  close(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    for (const operationId of session.inferenceOperations) this.inferenceBroker?.cancel(operationId);
    return this.sessions.delete(sessionId);
  }
  closeAll(): void { for (const sessionId of [...this.sessions.keys()]) this.close(sessionId); }
  sessionCountForTest(): number { return this.sessions.size; }

  private async requireSession(sessionId: string): Promise<SessionRecord> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new AppPlatformError("session_closed", "App UI session is closed", 410);
    if (Date.parse(session.expiresAt) <= this.now()) {
      this.close(sessionId);
      throw new AppPlatformError("session_expired", "App UI session expired", 401);
    }
    const current = await this.lifecycle.status();
    if (current.state !== "active" || current.installation_id !== session.installationId || current.active_package_digest !== session.packageDigest || current.generation !== session.lifecycleGeneration) {
      this.close(sessionId);
      throw new AppPlatformError("session_closed", "App UI session closed because lifecycle authority changed", 410);
    }
    return session;
  }

  private validateMessage(session: SessionRecord, message: BridgeMessage): void {
    const now = this.now();
    if (message.app_id !== "ai.braindrive.resume-builder" || message.installation_id !== session.installationId || message.view_id !== session.viewId || message.operation_id !== session.operationId) {
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

  private asHostError(error: unknown): AppPlatformError {
    if (error instanceof AppPlatformError) return error;
    if (error instanceof ResumeDomainError) return new AppPlatformError(error.code, error.message, error.statusCode, error.details);
    if (error instanceof ResumeInferenceError) {
      const code = error.code === "invalid_request"
        ? "invalid_input"
        : error.code === "denied"
          ? "denied"
          : error.code === "cancelled"
            ? "cancelled"
            : error.code === "validation_failed" || error.code === "schema_validation_failed"
              ? "validation_failed"
              : error.code === "model_incompatible"
                ? "protocol_incompatible"
                : "recoverable_internal_failure";
      return new AppPlatformError(code, error.message, error.code === "denied" ? 403 : 409);
    }
    return new AppPlatformError("recoverable_internal_failure", "Resume Builder data operation failed", 500);
  }

  private appInferenceProjection(completion: Awaited<ReturnType<ResumeInferenceBroker["execute"]>>): unknown {
    const inference = completion.inference;
    return {
      inference_schema_version: inference.inference_schema_version,
      request_id: inference.request_id,
      operation_id: inference.operation_id,
      purpose: inference.purpose,
      status: inference.status,
      prompt_policy_id: inference.prompt_policy_id,
      prompt_policy_version: inference.prompt_policy_version,
      output_schema_id: inference.output_schema_id,
      output_schema_version: inference.output_schema_version,
      model_class: inference.provider_profile_id ? "owner_active_compatible" : null,
      attempt_count: inference.attempt_count,
      usage: inference.usage,
      error: inference.error,
      result: inference.result,
      validation: completion.validation,
    };
  }
}
