import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import type { AuthState } from "../contracts.js";
import { auditLog } from "../logger.js";

export async function ensureAuthState(memoryRoot: string): Promise<AuthState> {
  const authPath = path.join(memoryRoot, "preferences", "auth-state.json");

  try {
    const raw = await readFile(authPath, "utf8");
    auditLog("auth.state.loaded", { path: authPath });
    return JSON.parse(raw) as AuthState;
  } catch {
    const now = new Date().toISOString();
    const state: AuthState = {
      actor_id: "owner",
      actor_type: "owner",
      mode: "local-owner",
      permissions: {
        memory_access: true,
        tool_access: true,
        system_actions: true,
        delegation: true,
        approval_authority: true,
        administration: true,
      },
      created_at: now,
      updated_at: now,
    };

    await writeFile(authPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    auditLog("auth.state.created", { path: authPath, actor_id: state.actor_id });
    return state;
  }
}

export async function readAuthState(memoryRoot: string): Promise<AuthState> {
  const authPath = path.join(memoryRoot, "preferences", "auth-state.json");
  const raw = await readFile(authPath, "utf8");
  auditLog("auth.state.exported", { path: authPath });
  return JSON.parse(raw) as AuthState;
}
