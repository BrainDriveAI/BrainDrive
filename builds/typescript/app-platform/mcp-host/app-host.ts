import type { AppViewResumeRequest } from "./app-view-registry.js";
import type { CompleteMcpResult } from "../../mcp/result-envelope.js";
import type { AppChatModelContext, AppChatModelContextRequest, AppChatWorkspaceLaunch, AppChatWorkspaceLaunchInput, AppLaunch } from "./app-host-types.js";

export type { AppChatModelContext, AppChatModelContextRequest, AppChatWorkspaceLaunch, AppChatWorkspaceLaunchInput, AppLaunch } from "./app-host-types.js";

export interface AppMcpHostAdapter {
  readonly appId: string;
  readonly routeKey: string;
  launch(entryPoint?: "direct" | "career", resume?: AppViewResumeRequest): Promise<AppLaunch>;
  launchChatWorkspace(input?: AppChatWorkspaceLaunchInput): Promise<AppChatWorkspaceLaunch>;
  readChatWorkspaceSession(sessionId: string): Promise<AppChatWorkspaceLaunch["session"]>;
  buildChatWorkspaceModelContext(request: AppChatModelContextRequest): Promise<AppChatModelContext>;
  handleAppsBridge(sessionId: string, rawEnvelope: unknown): Promise<unknown>;
  cancelAppsBridgeRequest(sessionId: string, operationId: string): boolean;
  handleBridge(sessionId: string, rawMessage: unknown, context: { origin: string; sourceMatches: boolean }): Promise<{ status: "ready" } | { status: "completed"; result: CompleteMcpResult } | { status: "capability_completed"; result: unknown }>;
  handleOwnerCapability(capability: unknown, input: unknown, operationId: string, hostOwnerConfirmed: boolean, ownerActorId: string): Promise<unknown>;
  placeCareerReturn(summary: unknown, entryPoint: "direct" | "career", operationId: string): Promise<unknown>;
  finalizeOwnerExport(input: unknown, operationId: string): Promise<unknown>;
  issueServerCapabilityAuthority(sessionId: string, capability: unknown, operationId: string, idempotencyKey: string): Promise<{ token: string; expiresAt: string }>;
  handleServerCapability(token: string, capability: unknown, capabilityVersion: number, input: unknown, operationId: string, idempotencyKey: string): Promise<unknown>;
  close(sessionId: string): boolean;
  closeAll(): Promise<void>;
  sessionCountForTest(): number;
}

/** App-neutral facade. Executable product behavior is supplied only by a reviewed adapter. */
export class AppMcpHost implements AppMcpHostAdapter {
  constructor(private readonly adapter: AppMcpHostAdapter) {}
  get appId(): string { return this.adapter.appId; }
  get routeKey(): string { return this.adapter.routeKey; }
  launch(entryPoint: "direct" | "career" = "direct", resume?: AppViewResumeRequest): Promise<AppLaunch> { return this.adapter.launch(entryPoint, resume); }
  launchChatWorkspace(input: AppChatWorkspaceLaunchInput = {}): Promise<AppChatWorkspaceLaunch> { return this.adapter.launchChatWorkspace(input); }
  readChatWorkspaceSession(sessionId: string): Promise<AppChatWorkspaceLaunch["session"]> { return this.adapter.readChatWorkspaceSession(sessionId); }
  buildChatWorkspaceModelContext(request: AppChatModelContextRequest): Promise<AppChatModelContext> { return this.adapter.buildChatWorkspaceModelContext(request); }
  handleAppsBridge(sessionId: string, rawEnvelope: unknown): Promise<unknown> { return this.adapter.handleAppsBridge(sessionId, rawEnvelope); }
  cancelAppsBridgeRequest(sessionId: string, operationId: string): boolean { return this.adapter.cancelAppsBridgeRequest(sessionId, operationId); }
  handleBridge(sessionId: string, rawMessage: unknown, context: { origin: string; sourceMatches: boolean }) { return this.adapter.handleBridge(sessionId, rawMessage, context); }
  handleOwnerCapability(capability: unknown, input: unknown, operationId: string, hostOwnerConfirmed: boolean, ownerActorId: string): Promise<unknown> { return this.adapter.handleOwnerCapability(capability, input, operationId, hostOwnerConfirmed, ownerActorId); }
  placeCareerReturn(summary: unknown, entryPoint: "direct" | "career", operationId: string): Promise<unknown> { return this.adapter.placeCareerReturn(summary, entryPoint, operationId); }
  finalizeOwnerExport(input: unknown, operationId: string): Promise<unknown> { return this.adapter.finalizeOwnerExport(input, operationId); }
  issueServerCapabilityAuthority(sessionId: string, capability: unknown, operationId: string, idempotencyKey: string) { return this.adapter.issueServerCapabilityAuthority(sessionId, capability, operationId, idempotencyKey); }
  handleServerCapability(token: string, capability: unknown, capabilityVersion: number, input: unknown, operationId: string, idempotencyKey: string): Promise<unknown> { return this.adapter.handleServerCapability(token, capability, capabilityVersion, input, operationId, idempotencyKey); }
  close(sessionId: string): boolean { return this.adapter.close(sessionId); }
  closeAll(): Promise<void> { return this.adapter.closeAll(); }
  sessionCountForTest(): number { return this.adapter.sessionCountForTest(); }
}
