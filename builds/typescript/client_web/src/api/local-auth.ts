const LOCAL_OWNER_HEADERS = {
  "x-actor-id": "owner",
  "x-actor-type": "owner",
  "x-auth-mode": "local-owner",
  "x-actor-permissions": JSON.stringify({
    memory_access: true,
    tool_access: true,
    system_actions: true,
    delegation: true,
    approval_authority: true,
    administration: true,
  }),
} as const;

export function buildLocalOwnerHeaders(): Record<string, string> {
  return { ...LOCAL_OWNER_HEADERS };
}
