import type { AuthContext, AuthState, PermissionSet } from "../contracts.js";

const authHeaderNames = {
  actorId: "x-actor-id",
  actorType: "x-actor-type",
  authMode: "x-auth-mode",
  permissions: "x-actor-permissions",
} as const;

export function authHeadersFromState(authState: AuthState): Record<string, string> {
  return {
    [authHeaderNames.actorId]: authState.actor_id,
    [authHeaderNames.actorType]: authState.actor_type,
    [authHeaderNames.authMode]: authState.mode,
    [authHeaderNames.permissions]: JSON.stringify(authState.permissions),
  };
}

export function authHeadersFromContext(authContext: AuthContext): Record<string, string> {
  return {
    [authHeaderNames.actorId]: authContext.actorId,
    [authHeaderNames.actorType]: authContext.actorType,
    [authHeaderNames.authMode]: authContext.mode,
    [authHeaderNames.permissions]: JSON.stringify(authContext.permissions),
  };
}

export function parsePermissionHeaders(headers: Record<string, unknown>): {
  actorId: string;
  actorType: "owner";
  mode: "local-owner";
  permissions: PermissionSet;
} {
  const actorId = firstHeaderValue(headers[authHeaderNames.actorId]);
  const actorType = firstHeaderValue(headers[authHeaderNames.actorType]);
  const mode = firstHeaderValue(headers[authHeaderNames.authMode]);
  const permissionsRaw = firstHeaderValue(headers[authHeaderNames.permissions]);

  if (actorId !== "owner" || actorType !== "owner" || mode !== "local-owner" || permissionsRaw === undefined) {
    throw new Error("Missing auth headers");
  }

  const permissions = JSON.parse(permissionsRaw) as PermissionSet;
  return {
    actorId,
    actorType,
    mode,
    permissions,
  };
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
