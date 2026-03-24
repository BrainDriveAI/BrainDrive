export type PermissionSet = {
  memory_access: boolean;
  tool_access: boolean;
  system_actions: boolean;
  delegation: boolean;
  approval_authority: boolean;
  administration: boolean;
};

export type RequestContext = {
  correlationId: string;
  actorId: string;
  actorType: "owner";
  authMode: "local-owner";
  permissions: PermissionSet;
};

export const ownerPermissions: PermissionSet = {
  memory_access: true,
  tool_access: true,
  system_actions: true,
  delegation: true,
  approval_authority: true,
  administration: true,
};

const OWNER_CONTEXT: RequestContext = {
  correlationId: "",
  actorId: "owner",
  actorType: "owner",
  authMode: "local-owner",
  permissions: ownerPermissions,
};

export function parseRequestContext(headers: Record<string, string | string[] | undefined>): RequestContext {
  const correlationId = headerValue(headers, "x-paa-correlation-id") ?? "";
  const actorId = headerValue(headers, "x-paa-actor-id") ?? "owner";
  const actorType = parseActorType(headerValue(headers, "x-paa-actor-type"));
  const authMode = parseAuthMode(headerValue(headers, "x-paa-auth-mode"));
  const permissions = parsePermissions(headerValue(headers, "x-paa-actor-permissions"));

  return {
    correlationId,
    actorId,
    actorType,
    authMode,
    permissions,
  };
}

export function defaultRequestContext(): RequestContext {
  return {
    ...OWNER_CONTEXT,
    permissions: { ...OWNER_CONTEXT.permissions },
  };
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const candidate = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(candidate)) {
    return candidate[0];
  }
  return candidate;
}

function parseActorType(value: string | undefined): "owner" {
  if (!value || value === "owner") {
    return "owner";
  }
  return "owner";
}

function parseAuthMode(value: string | undefined): "local-owner" {
  if (!value || value === "local-owner") {
    return "local-owner";
  }
  return "local-owner";
}

function parsePermissions(value: string | undefined): PermissionSet {
  if (!value || value.trim().length === 0) {
    return { ...ownerPermissions };
  }

  try {
    const parsed = JSON.parse(value) as Partial<PermissionSet>;
    return {
      memory_access: parsed.memory_access ?? ownerPermissions.memory_access,
      tool_access: parsed.tool_access ?? ownerPermissions.tool_access,
      system_actions: parsed.system_actions ?? ownerPermissions.system_actions,
      delegation: parsed.delegation ?? ownerPermissions.delegation,
      approval_authority: parsed.approval_authority ?? ownerPermissions.approval_authority,
      administration: parsed.administration ?? ownerPermissions.administration,
    };
  } catch {
    return { ...ownerPermissions };
  }
}
