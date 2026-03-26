import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthContext, AuthState } from "../contracts.js";
import { auditLog } from "../logger.js";
import { parsePermissionHeaders } from "./headers.js";

function buildLocalOwnerAuthContext(request: FastifyRequest, authState: AuthState): AuthContext {
  const headerContext = parsePermissionHeaders(request.headers as Record<string, unknown>);

  if (
    headerContext.actorId !== authState.actor_id ||
    headerContext.actorType !== authState.actor_type ||
    headerContext.mode !== authState.mode ||
    JSON.stringify(headerContext.permissions) !== JSON.stringify(authState.permissions)
  ) {
    throw new Error("Unauthorized actor");
  }

  return {
    actorId: headerContext.actorId,
    actorType: headerContext.actorType,
    permissions: headerContext.permissions,
    mode: headerContext.mode,
  };
}

export type AuthMiddlewareOptions = {
  mode: AuthState["mode"];
  getAuthState: () => AuthState;
  authenticateLocalJwtAccessToken?: (accessToken: string) => Promise<AuthContext>;
};

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  options: AuthMiddlewareOptions
): Promise<void> {
  try {
    const authState = options.getAuthState();
    request.authContext = await buildAuthContext(request, authState, options);
    auditLog("auth.authorized", {
      actor_id: request.authContext.actorId,
      method: request.method,
      path: request.url,
    });
  } catch {
    auditLog("auth.denied", {
      method: request.method,
      path: request.url,
    });
    reply.code(401).send({ error: "Unauthorized" });
  }
}

async function buildAuthContext(
  request: FastifyRequest,
  authState: AuthState,
  options: AuthMiddlewareOptions
): Promise<AuthContext> {
  if (options.mode === "local-owner") {
    return buildLocalOwnerAuthContext(request, authState);
  }

  if (options.mode === "local") {
    if (!options.authenticateLocalJwtAccessToken) {
      throw new Error("Local JWT auth provider is not configured");
    }

    const accessToken = readBearerToken(request.headers.authorization);
    return options.authenticateLocalJwtAccessToken(accessToken);
  }

  throw new Error("Managed auth mode is not implemented");
}

function readBearerToken(headerValue: unknown): string {
  const value = firstHeaderValue(headerValue);
  if (!value) {
    throw new Error("Missing authorization header");
  }

  const [scheme, token] = value.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new Error("Malformed authorization header");
  }

  return token;
}

function firstHeaderValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return undefined;
}
