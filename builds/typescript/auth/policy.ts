import type {
  AuthActor,
  AuthAuthorizationDecision,
  AuthAuthorizationRequest,
  AuthService,
  PaaAuthContext,
} from "../contracts.js";
import { readAuthState } from "../memory/auth-state.js";

/**
 * The first PAA route/action inventory. New protected operations must be
 * added here before they are exposed through the Gateway or ToolExecutor.
 */
export const AUTH_OPERATIONS = {
  conversation: new Set(["read", "write"]),
  tool: new Set(["execute"]),
  auth: new Set(["whoami", "check", "export"]),
  gateway: new Set(["request"]),
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

export type GatewayRouteAuthorization = {
  resource: string;
  action: string;
  public: boolean;
};

const PUBLIC_BOOTSTRAP_ROUTES = new Set([
  "/health",
  "/config",
  "/auth/bootstrap-status",
  "/auth/signup",
  "/auth/login",
  "/auth/refresh",
]);

/** Classify every non-bootstrap request before its handler performs work. */
export function classifyGatewayRoute(method: string, rawPath: string): GatewayRouteAuthorization {
  const path = rawPath.split("?", 1)[0] || "/";
  if (PUBLIC_BOOTSTRAP_ROUTES.has(path)) {
    return { resource: "gateway", action: "request", public: true };
  }
  if (path === "/message" || path.startsWith("/conversations")) {
    return {
      resource: "conversation",
      action: method.toUpperCase() === "GET" ? "read" : "write",
      public: false,
    };
  }
  if (path.startsWith("/auth/")) {
    return { resource: "auth", action: "check", public: false };
  }
  return { resource: "gateway", action: "request", public: false };
}

/** Local Auth adapter: callers use this service rather than owning policy decisions. */
export function createLocalPaaAuthService(
  getAuthState: () => {
    actor_id: string;
    actor_type: "owner";
    account_created_at?: string;
    account_initialized?: boolean;
    created_at: string;
  },
  memoryRoot: string,
): AuthService {
  return {
    async authenticate(request) {
      const state = getAuthState();
      const context: PaaAuthContext = {
        actor: { ...ownerActor(state), status: state.account_initialized === false ? "inactive" : "active" },
        authentication_id: request.authentication_id,
        authenticated_at: new Date().toISOString(),
        correlation_id: request.correlation_id,
      };
      validatePaaAuthContext(context);
      return context;
    },
    async authorize(request) {
      return evaluateAuthorization(request);
    },
    async manage(operation, actorId) {
      if (operation !== "revoke" && operation !== "activate") {
        throw new Error("Unknown Auth management operation");
      }
      if (actorId !== getAuthState().actor_id) {
        throw new Error("Unknown actor");
      }
    },
    async exportState() {
      const state = await readAuthState(memoryRoot);
      return {
        schema: "paa-auth-state-v1",
        exported_at: new Date().toISOString(),
        identities: [{
          id: state.actor_id,
          type: state.actor_type,
          status: state.account_initialized === false ? "inactive" : "active",
          created: state.account_created_at ?? state.created_at,
        }],
        policies: [{ actor_id: state.actor_id, resource: "*", action: "*", effect: "allow", precedence: "owner-default" }],
        configuration: { mode: state.mode, session_policy: state.session_policy ?? null },
        audit: { format: "jsonl", credentials_included: false },
      };
    },
  };
}
