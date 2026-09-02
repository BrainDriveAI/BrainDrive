import { randomUUID } from "node:crypto";

import type {
  AppContextRequestDescriptor,
  AppPresentationProfile,
  ChatWorkspaceDescriptor,
} from "../contracts/app-registry.js";
import { canonicalInputDigest, encodedByteLength } from "../contracts/common.js";
import type { RuntimePackageManifest } from "../lifecycle/package-verifier.js";
import { AppPlatformError } from "../lifecycle/errors.js";
import type { CapabilityGrant } from "../lifecycle/store.js";

export type AppChatWorkspaceSelection = {
  presentation: Extract<AppPresentationProfile, { type: "chat_workspace" }>;
  workspace: ChatWorkspaceDescriptor;
};

export type AppChatContextGrant = {
  context_id: string;
  kind: AppContextRequestDescriptor["kind"];
  required: boolean;
  max_bytes: number;
  granted: boolean;
  required_capabilities: readonly { name: string; version: number }[];
};

export type AppChatSessionAuthority = {
  ownerId: string;
  accountId: string;
  actorId: string;
  appId: string;
  publisherId: string;
  installationId: string;
  packageDigest: `sha256:${string}`;
  lifecycleGeneration: number;
  grantId: string;
  grantRevision: number;
  revocationGeneration: number;
  presentationId: string;
  workspaceId: string;
  contextGrantSetDigest: `sha256:${string}`;
};

export type AppChatSessionResumeRequest = {
  sessionId: string;
  viewId: string;
  operationId: string;
  sessionGeneration: number;
};

export type AppChatSessionRecord = AppChatSessionAuthority & {
  sessionId: string;
  viewId: string;
  operationId: string;
  sessionGeneration: number;
  createdAt: string;
  expiresAt: string;
};

export type AppChatSessionPlan = AppChatSessionRecord & {
  expectedSessionId: string | null;
  expectedSessionGeneration: number;
};

export type CommittedAppChatSession = AppChatSessionRecord & {
  resumed: boolean;
  supersededSessionId: string | null;
};

export type AppChatContextProjectionItem =
  | {
      context_projection_version: 1;
      context_id: string;
      kind: AppContextRequestDescriptor["kind"];
      state: "available";
      required: boolean;
      byte_length: number;
      content_digest: `sha256:${string}`;
      content: unknown;
    }
  | {
      context_projection_version: 1;
      context_id: string;
      kind: AppContextRequestDescriptor["kind"];
      state: "unavailable";
      required: boolean;
      reason: "not_granted" | "unsupported" | "too_large";
    };

export type AppChatContextProjection = {
  context_projection_set_version: 1;
  context_grant_set_digest: `sha256:${string}`;
  items: readonly AppChatContextProjectionItem[];
};

export type AppChatContextProvider = (request: AppContextRequestDescriptor) => Promise<unknown>;

const DEFAULT_SESSION_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_SESSIONS_PER_INSTALLATION = 16;

export function selectAppChatWorkspace(
  manifest: RuntimePackageManifest,
  request: { presentationId?: string; workspaceId?: string } = {},
): AppChatWorkspaceSelection {
  if (manifest.manifest_version !== 2 || !manifest.presentations) {
    throw new AppPlatformError("incompatible_schema", "App package does not declare a chat workspace", 409);
  }
  const presentationId = request.presentationId ?? manifest.presentations.default_presentation_id;
  const profile = manifest.presentations.profiles.find((candidate) => candidate.presentation_id === presentationId);
  if (!profile || profile.type !== "chat_workspace") {
    throw new AppPlatformError("incompatible_schema", "Requested app presentation is not a chat workspace", 409);
  }
  if (request.workspaceId !== undefined && request.workspaceId !== profile.workspace_id) {
    throw new AppPlatformError("incompatible_schema", "Requested workspace does not match the selected presentation", 409);
  }
  const workspace = manifest.presentations.workspaces.find((candidate) => candidate.workspace_id === profile.workspace_id);
  if (!workspace) throw new AppPlatformError("descriptor_invalid", "Chat workspace descriptor is missing");
  return { presentation: profile, workspace };
}

export function planAppChatContextGrants(
  workspace: ChatWorkspaceDescriptor,
  grant: CapabilityGrant,
): { grants: AppChatContextGrant[]; digest: `sha256:${string}` } {
  const grantedCapabilities = new Set(grant.capabilities);
  const grants = workspace.context_requests.map((request) => {
    const granted = request.required_capabilities.every((capability) => capability.version === 1 && grantedCapabilities.has(capability.name));
    if (!granted && request.required) {
      throw new AppPlatformError("grant_missing", "Required app-chat context capability is not granted", 403);
    }
    return {
      context_id: request.context_id,
      kind: request.kind,
      required: request.required,
      max_bytes: request.max_bytes,
      granted,
      required_capabilities: request.required_capabilities.map((capability) => ({ name: capability.name, version: capability.version })),
    };
  });
  const digest = canonicalInputDigest({
    app_id: grant.app_id,
    installation_id: grant.installation_id,
    grant_id: grant.grant_id,
    grant_revision: grant.grant_revision,
    revocation_generation: grant.revocation_generation,
    contexts: grants.map(({ context_id, kind, required, max_bytes, granted, required_capabilities }) => ({
      context_id, kind, required, max_bytes, granted, required_capabilities,
    })),
  });
  return { grants, digest };
}

export async function projectAppChatContext(
  workspace: ChatWorkspaceDescriptor,
  grantPlan: { grants: readonly AppChatContextGrant[]; digest: `sha256:${string}` },
  providers: Partial<Record<AppContextRequestDescriptor["kind"], AppChatContextProvider>>,
): Promise<AppChatContextProjection> {
  const byContextId = new Map(grantPlan.grants.map((grant) => [grant.context_id, grant]));
  const items: AppChatContextProjectionItem[] = [];
  for (const request of workspace.context_requests) {
    const contextGrant = byContextId.get(request.context_id);
    if (!contextGrant?.granted) {
      items.push(unavailable(request, "not_granted"));
      continue;
    }
    const provider = providers[request.kind];
    if (!provider) {
      if (request.required) throw new AppPlatformError("incompatible_schema", "Required app-chat context provider is unavailable", 409);
      items.push(unavailable(request, "unsupported"));
      continue;
    }
    const content = await provider(request);
    const byteLength = encodedByteLength(content);
    if (byteLength > request.max_bytes) {
      if (request.required) throw new AppPlatformError("validation_failed", "Required app-chat context exceeds its declared bound", 413);
      items.push(unavailable(request, "too_large"));
      continue;
    }
    items.push({
      context_projection_version: 1,
      context_id: request.context_id,
      kind: request.kind,
      state: "available",
      required: request.required,
      byte_length: byteLength,
      content_digest: canonicalInputDigest(content),
      content,
    });
  }
  return {
    context_projection_set_version: 1,
    context_grant_set_digest: grantPlan.digest,
    items,
  };
}

export class AppChatSessionRegistry {
  private readonly sessions = new Map<string, AppChatSessionRecord>();
  private readonly bySession = new Map<string, string>();

  constructor(
    private readonly options: { now?: () => number; ttlMs?: number; maxSessionsPerInstallation?: number } = {},
  ) {
    const ttlMs = this.ttlMs;
    if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > DEFAULT_SESSION_TTL_MS) {
      throw new AppPlatformError("invalid_input", "App-chat session lifetime is invalid", 400);
    }
    if (!Number.isInteger(this.maxSessionsPerInstallation) || this.maxSessionsPerInstallation <= 0 || this.maxSessionsPerInstallation > 64) {
      throw new AppPlatformError("invalid_input", "App-chat session concurrency limit is invalid", 400);
    }
  }

  plan(authority: AppChatSessionAuthority, resume?: AppChatSessionResumeRequest): AppChatSessionPlan {
    this.prune();
    const now = this.now();
    if (!resume) {
      if (this.installationSessionCount(authority.appId, authority.installationId) >= this.maxSessionsPerInstallation) {
        throw new AppPlatformError("denied", "Installed app chat session limit was reached", 429);
      }
      return {
        ...authority,
        sessionId: randomUUID(),
        viewId: randomUUID(),
        operationId: randomUUID(),
        sessionGeneration: 1,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + this.ttlMs).toISOString(),
        expectedSessionId: null,
        expectedSessionGeneration: 0,
      };
    }
    const viewId = this.bySession.get(sessionKey(authority.appId, resume.sessionId));
    const current = viewId ? this.sessions.get(viewKey(authority.appId, viewId)) : undefined;
    if (
      !current ||
      current.sessionId !== resume.sessionId ||
      current.viewId !== resume.viewId ||
      current.operationId !== resume.operationId ||
      current.sessionGeneration !== resume.sessionGeneration ||
      !sameAuthority(current, authority)
    ) {
      throw new AppPlatformError("session_closed", "App-chat session authority is no longer current", 410);
    }
    return {
      ...current,
      ...authority,
      sessionId: randomUUID(),
      sessionGeneration: current.sessionGeneration + 1,
      expiresAt: new Date(now + this.ttlMs).toISOString(),
      expectedSessionId: current.sessionId,
      expectedSessionGeneration: current.sessionGeneration,
    };
  }

  commit(plan: AppChatSessionPlan): CommittedAppChatSession {
    this.prune();
    if (plan.expectedSessionId === null) {
      if (this.installationSessionCount(plan.appId, plan.installationId) >= this.maxSessionsPerInstallation) {
        throw new AppPlatformError("denied", "Installed app chat session limit was reached", 429);
      }
      if (this.sessions.has(viewKey(plan.appId, plan.viewId)) || this.bySession.has(sessionKey(plan.appId, plan.sessionId))) {
        throw new AppPlatformError("duplicate_identity", "App-chat session identity already exists", 409);
      }
    } else {
      const current = this.sessions.get(viewKey(plan.appId, plan.viewId));
      if (
        !current ||
        current.sessionId !== plan.expectedSessionId ||
        current.sessionGeneration !== plan.expectedSessionGeneration ||
        this.bySession.get(sessionKey(plan.appId, plan.expectedSessionId)) !== plan.viewId
      ) {
        throw new AppPlatformError("session_closed", "App-chat reconnect was superseded", 410);
      }
    }

    const supersededSessionId = plan.expectedSessionId;
    if (supersededSessionId) this.bySession.delete(sessionKey(plan.appId, supersededSessionId));
    const { expectedSessionId: _expectedSessionId, expectedSessionGeneration: _expectedSessionGeneration, ...record } = plan;
    this.sessions.set(viewKey(record.appId, record.viewId), record);
    this.bySession.set(sessionKey(record.appId, record.sessionId), record.viewId);
    return { ...record, resumed: supersededSessionId !== null, supersededSessionId };
  }

  read(appId: string, sessionId: string): AppChatSessionRecord {
    this.prune();
    const viewId = this.bySession.get(sessionKey(appId, sessionId));
    const current = viewId ? this.sessions.get(viewKey(appId, viewId)) : undefined;
    if (!current || current.sessionId !== sessionId) throw new AppPlatformError("session_closed", "App-chat session is closed", 410);
    return current;
  }

  renew(appId: string, sessionId: string): AppChatSessionRecord {
    const current = this.read(appId, sessionId);
    const renewed = {
      ...current,
      expiresAt: new Date(this.now() + this.ttlMs).toISOString(),
    };
    this.sessions.set(viewKey(appId, renewed.viewId), renewed);
    return renewed;
  }

  close(appId: string, sessionId: string): { closed: boolean; viewId: string | null } {
    this.prune();
    const viewId = this.bySession.get(sessionKey(appId, sessionId));
    const current = viewId ? this.sessions.get(viewKey(appId, viewId)) : undefined;
    if (!current || current.sessionId !== sessionId) return { closed: false, viewId: null };
    this.bySession.delete(sessionKey(appId, sessionId));
    this.sessions.delete(viewKey(appId, current.viewId));
    return { closed: true, viewId: current.viewId };
  }

  clear(): void {
    this.sessions.clear();
    this.bySession.clear();
  }

  activeSessions(): AppChatSessionRecord[] {
    this.prune();
    return [...this.sessions.values()];
  }

  sessionCountForTest(): number {
    this.prune();
    return this.sessions.size;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private get ttlMs(): number {
    return this.options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  }

  private get maxSessionsPerInstallation(): number {
    return this.options.maxSessionsPerInstallation ?? DEFAULT_MAX_SESSIONS_PER_INSTALLATION;
  }

  private installationSessionCount(appId: string, installationId: string): number {
    return [...this.sessions.values()].filter((session) => session.appId === appId && session.installationId === installationId).length;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, session] of this.sessions) {
      if (Date.parse(session.expiresAt) > now) continue;
      this.sessions.delete(key);
      this.bySession.delete(sessionKey(session.appId, session.sessionId));
    }
  }
}

export function projectAppChatSession(session: CommittedAppChatSession | AppChatSessionRecord) {
  return {
    session_id: session.sessionId,
    view_id: session.viewId,
    operation_id: session.operationId,
    session_generation: session.sessionGeneration,
    owner_id: session.ownerId,
    account_id: session.accountId,
    actor_id: session.actorId,
    app_id: session.appId,
    publisher_id: session.publisherId,
    installation_id: session.installationId,
    package_digest: session.packageDigest,
    lifecycle_generation: session.lifecycleGeneration,
    grant_id: session.grantId,
    grant_revision: session.grantRevision,
    revocation_generation: session.revocationGeneration,
    presentation_id: session.presentationId,
    workspace_id: session.workspaceId,
    context_grant_set_digest: session.contextGrantSetDigest,
    created_at: session.createdAt,
    expires_at: session.expiresAt,
  };
}

type UnavailableContextReason = Extract<AppChatContextProjectionItem, { state: "unavailable" }>["reason"];

function unavailable(request: AppContextRequestDescriptor, reason: UnavailableContextReason): AppChatContextProjectionItem {
  return {
    context_projection_version: 1,
    context_id: request.context_id,
    kind: request.kind,
    state: "unavailable",
    required: request.required,
    reason,
  };
}

function sameAuthority(left: AppChatSessionAuthority, right: AppChatSessionAuthority): boolean {
  return left.ownerId === right.ownerId
    && left.accountId === right.accountId
    && left.actorId === right.actorId
    && left.appId === right.appId
    && left.publisherId === right.publisherId
    && left.installationId === right.installationId
    && left.packageDigest === right.packageDigest
    && left.lifecycleGeneration === right.lifecycleGeneration
    && left.grantId === right.grantId
    && left.grantRevision === right.grantRevision
    && left.revocationGeneration === right.revocationGeneration
    && left.presentationId === right.presentationId
    && left.workspaceId === right.workspaceId
    && left.contextGrantSetDigest === right.contextGrantSetDigest;
}

function viewKey(appId: string, viewId: string): string { return `${appId}:${viewId}`; }
function sessionKey(appId: string, sessionId: string): string { return `${appId}:${sessionId}`; }
