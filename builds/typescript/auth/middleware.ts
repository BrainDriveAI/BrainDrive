import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthContext, AuthState } from "../contracts.js";
import { auditLog } from "../logger.js";
import { parsePermissionHeaders } from "./headers.js";

export function buildAuthContext(request: FastifyRequest, authState: AuthState): AuthContext {
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

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  authState: AuthState
): Promise<void> {
  try {
    request.authContext = buildAuthContext(request, authState);
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
