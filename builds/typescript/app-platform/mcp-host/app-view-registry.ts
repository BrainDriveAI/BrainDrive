import { randomUUID } from "node:crypto";

import { AppViewStateSchema } from "../contracts/spec-05-foundation.js";
import { AppPlatformError } from "../lifecycle/errors.js";

export type AppViewAuthority = {
  appId: string;
  installationId: string;
  packageDigest: `sha256:${string}`;
  lifecycleGeneration: number;
  connectionId: string;
  connectionGeneration: number;
  entryPoint: "direct" | "career";
};

export type AppViewResumeRequest = {
  sessionId: string;
  viewId: string;
  operationId: string;
  bridgeGeneration: number;
};

type ViewRecord = AppViewAuthority & {
  sessionId: string;
  viewId: string;
  operationId: string;
  bridgeGeneration: number;
  createdAt: string;
  expiresAt: string;
};

export type AppViewPlan = ViewRecord & {
  expectedSessionId: string | null;
  expectedBridgeGeneration: number;
};

export type CommittedAppView = ViewRecord & {
  resumed: boolean;
  supersededSessionId: string | null;
};

const DEFAULT_VIEW_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_VIEWS_PER_INSTALLATION = 16;

export class AppViewRegistry {
  private readonly views = new Map<string, ViewRecord>();
  private readonly sessions = new Map<string, string>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxViewsPerInstallation: number;

  constructor(options: { now?: () => number; ttlMs?: number; maxViewsPerInstallation?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_VIEW_TTL_MS;
    this.maxViewsPerInstallation = options.maxViewsPerInstallation ?? DEFAULT_MAX_VIEWS_PER_INSTALLATION;
    if (!Number.isInteger(this.ttlMs) || this.ttlMs <= 0 || this.ttlMs > DEFAULT_VIEW_TTL_MS) {
      throw new AppPlatformError("invalid_input", "App view lifetime is invalid", 400);
    }
    if (!Number.isInteger(this.maxViewsPerInstallation) || this.maxViewsPerInstallation <= 0 || this.maxViewsPerInstallation > 64) {
      throw new AppPlatformError("invalid_input", "App view concurrency limit is invalid", 400);
    }
  }

  plan(authority: AppViewAuthority, resume?: AppViewResumeRequest): AppViewPlan {
    this.prune();
    if (!resume) {
      if (this.installationViewCount(authority.appId, authority.installationId) >= this.maxViewsPerInstallation) {
        throw new AppPlatformError("denied", "Installed app view limit was reached", 429);
      }
      const now = this.now();
      return {
        ...authority,
        sessionId: randomUUID(),
        viewId: randomUUID(),
        operationId: randomUUID(),
        bridgeGeneration: 1,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + this.ttlMs).toISOString(),
        expectedSessionId: null,
        expectedBridgeGeneration: 0,
      };
    }

    const viewId = this.sessions.get(sessionKey(authority.appId, resume.sessionId));
    const current = viewId ? this.views.get(viewKey(authority.appId, viewId)) : undefined;
    if (
      !current ||
      current.sessionId !== resume.sessionId ||
      current.viewId !== resume.viewId ||
      current.operationId !== resume.operationId ||
      current.bridgeGeneration !== resume.bridgeGeneration ||
      current.installationId !== authority.installationId ||
      current.packageDigest !== authority.packageDigest ||
      current.lifecycleGeneration !== authority.lifecycleGeneration ||
      current.entryPoint !== authority.entryPoint
    ) {
      throw new AppPlatformError("session_closed", "App view reconnect authority is no longer current", 410);
    }
    const now = this.now();
    return {
      ...current,
      ...authority,
      sessionId: randomUUID(),
      bridgeGeneration: current.bridgeGeneration + 1,
      expiresAt: new Date(now + this.ttlMs).toISOString(),
      expectedSessionId: current.sessionId,
      expectedBridgeGeneration: current.bridgeGeneration,
    };
  }

  commit(plan: AppViewPlan): CommittedAppView {
    this.prune();
    if (plan.expectedSessionId === null) {
      if (this.installationViewCount(plan.appId, plan.installationId) >= this.maxViewsPerInstallation) {
        throw new AppPlatformError("denied", "Installed app view limit was reached", 429);
      }
      if (this.views.has(viewKey(plan.appId, plan.viewId)) || this.sessions.has(sessionKey(plan.appId, plan.sessionId))) {
        throw new AppPlatformError("duplicate_identity", "App view identity already exists", 409);
      }
    } else {
      const current = this.views.get(viewKey(plan.appId, plan.viewId));
      if (
        !current ||
        current.sessionId !== plan.expectedSessionId ||
        current.bridgeGeneration !== plan.expectedBridgeGeneration ||
        this.sessions.get(sessionKey(plan.appId, plan.expectedSessionId)) !== plan.viewId
      ) {
        throw new AppPlatformError("session_closed", "App view reconnect was superseded", 410);
      }
    }

    AppViewStateSchema.parse({
      view_state_version: 1,
      connection_id: plan.connectionId,
      installation_id: plan.installationId,
      view_id: plan.viewId,
      operation_id: plan.operationId,
      state: "ready",
      bridge_generation: plan.bridgeGeneration,
      created_at: plan.createdAt,
      expires_at: plan.expiresAt,
    });
    const supersededSessionId = plan.expectedSessionId;
    if (supersededSessionId) this.sessions.delete(sessionKey(plan.appId, supersededSessionId));
    const { expectedSessionId: _expectedSessionId, expectedBridgeGeneration: _expectedBridgeGeneration, ...record } = plan;
    this.views.set(viewKey(record.appId, record.viewId), record);
    this.sessions.set(sessionKey(record.appId, record.sessionId), record.viewId);
    return { ...record, resumed: supersededSessionId !== null, supersededSessionId };
  }

  close(appId: string, sessionId: string): { closed: boolean; viewId: string | null } {
    this.prune();
    const viewId = this.sessions.get(sessionKey(appId, sessionId));
    const current = viewId ? this.views.get(viewKey(appId, viewId)) : undefined;
    if (!current || current.sessionId !== sessionId) return { closed: false, viewId: null };
    this.sessions.delete(sessionKey(appId, sessionId));
    this.views.delete(viewKey(appId, current.viewId));
    return { closed: true, viewId: current.viewId };
  }

  isCurrentSession(appId: string, sessionId: string): boolean {
    this.prune();
    const viewId = this.sessions.get(sessionKey(appId, sessionId));
    return viewId !== undefined && this.views.get(viewKey(appId, viewId))?.sessionId === sessionId;
  }

  clear(): void {
    this.views.clear();
    this.sessions.clear();
  }

  viewCountForTest(): number {
    this.prune();
    return this.views.size;
  }

  private installationViewCount(appId: string, installationId: string): number {
    return [...this.views.values()].filter((record) => record.appId === appId && record.installationId === installationId).length;
  }

  private prune(): void {
    const now = this.now();
    for (const [viewId, record] of this.views) {
      if (Date.parse(record.expiresAt) > now) continue;
      this.views.delete(viewId);
      this.sessions.delete(sessionKey(record.appId, record.sessionId));
    }
  }
}

function viewKey(appId: string, viewId: string): string { return `${appId}:${viewId}`; }
function sessionKey(appId: string, sessionId: string): string { return `${appId}:${sessionId}`; }
