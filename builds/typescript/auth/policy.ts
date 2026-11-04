import type {
  AuthActor,
  AuthAuthorizationDecision,
  AuthAuthorizationRequest,
  PaaAuthContext,
} from "../contracts.js";

/**
 * The first PAA route/action inventory. New protected operations must be
 * added here before they are exposed through the Gateway or ToolExecutor.
 */
export const AUTH_OPERATIONS = {
  conversation: new Set(["read", "write"]),
  tool: new Set(["execute"]),
  auth: new Set(["whoami", "check", "export"]),
} as const;

function knownResource(resource: string): resource is keyof typeof AUTH_OPERATIONS {
  return resource in AUTH_OPERATIONS;
}

/**
 * Deterministic v1 owner policy. Unknown actors, resources, and actions deny;
 * no permission list is accepted from the caller as an authorization source.
 */
export function evaluateAuthorization(
  request: AuthAuthorizationRequest,
): AuthAuthorizationDecision {
  if (!request.actor.id.trim()) {
    return { allowed: false, reason: "unknown_actor" };
  }

  if (request.actor.status !== "active") {
    return { allowed: false, reason: "inactive_actor" };
  }

  if (!knownResource(request.resource)) {
    return { allowed: false, reason: "unknown_resource" };
  }

  if (!AUTH_OPERATIONS[request.resource].has(request.action)) {
    return { allowed: false, reason: "unknown_action" };
  }

  if (request.actor.type === "owner") {
    return { allowed: true, reason: "allowed" };
  }

  return { allowed: false, reason: "policy_denied" };
}

export function ownerActor(authState: {
  actor_id: string;
  actor_type: "owner";
  account_created_at?: string;
  created_at: string;
}): AuthActor {
  return {
    id: authState.actor_id,
    type: authState.actor_type,
    status: "active",
    created: authState.account_created_at ?? authState.created_at,
  };
}

export function validatePaaAuthContext(context: PaaAuthContext, now = new Date()): void {
  const keys = Object.keys(context).sort();
  const allowedKeys = ["actor", "authentication_id", "authenticated_at", "correlation_id", "expires_at"];
  if (keys.some((key) => !allowedKeys.includes(key))) {
    throw new Error("Invalid auth context fields");
  }

  if (!context.actor.id.trim() || !context.authentication_id.trim() || !context.correlation_id.trim()) {
    throw new Error("Invalid auth context identity");
  }

  const authenticatedAt = Date.parse(context.authenticated_at);
  if (Number.isNaN(authenticatedAt)) {
    throw new Error("Invalid auth context timestamp");
  }

  if (context.expires_at !== undefined) {
    const expiresAt = Date.parse(context.expires_at);
    if (Number.isNaN(expiresAt) || expiresAt <= now.getTime()) {
      throw new Error("Expired auth context");
    }
  }
}
