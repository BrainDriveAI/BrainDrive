import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

const authSessionSchema = z
  .object({
    active_session_id: z.string().trim().min(1).nullable(),
    active_refresh_jti_hash: z.string().trim().min(1).nullable(),
    previous_refresh_jti_hash: z.string().trim().min(1).nullable(),
    expires_at: z.string().trim().min(1).nullable(),
    rotated_at: z.string().trim().min(1).nullable(),
    updated_at: z.string().trim().min(1),
  })
  .strict();

export type AuthSessionState = z.infer<typeof authSessionSchema>;

export type RotateSessionResult = "rotated" | "invalid" | "replay";

export async function loadAuthSessionState(memoryRoot: string): Promise<AuthSessionState> {
  const sessionPath = resolveAuthSessionPath(memoryRoot);

  try {
    const raw = await readFile(sessionPath, "utf8");
    return authSessionSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    const empty = buildEmptySessionState();
    await writeFile(sessionPath, `${JSON.stringify(empty, null, 2)}\n`, "utf8");
    return empty;
  }
}

export async function activateAuthSession(
  memoryRoot: string,
  input: {
    sessionId: string;
    refreshJti: string;
    expiresAt: string;
    now?: string;
  }
): Promise<AuthSessionState> {
  const now = input.now ?? new Date().toISOString();
  const nextState: AuthSessionState = {
    active_session_id: input.sessionId,
    active_refresh_jti_hash: hashRefreshJti(input.refreshJti),
    previous_refresh_jti_hash: null,
    expires_at: input.expiresAt,
    rotated_at: now,
    updated_at: now,
  };
  await saveAuthSessionState(memoryRoot, nextState);
  return nextState;
}

export async function rotateAuthSession(
  memoryRoot: string,
  input: {
    sessionId: string;
    currentRefreshJti: string;
    nextRefreshJti: string;
    nextExpiresAt: string;
    now?: string;
  }
): Promise<RotateSessionResult> {
  const currentState = await loadAuthSessionState(memoryRoot);
  const currentHash = hashRefreshJti(input.currentRefreshJti);

  if (
    !currentState.active_session_id ||
    !currentState.active_refresh_jti_hash ||
    currentState.active_session_id !== input.sessionId
  ) {
    return "invalid";
  }

  if (currentHash === currentState.previous_refresh_jti_hash) {
    await revokeAuthSession(memoryRoot, input.now);
    return "replay";
  }

  if (currentHash !== currentState.active_refresh_jti_hash) {
    return "invalid";
  }

  const now = input.now ?? new Date().toISOString();
  const nextState: AuthSessionState = {
    active_session_id: input.sessionId,
    active_refresh_jti_hash: hashRefreshJti(input.nextRefreshJti),
    previous_refresh_jti_hash: currentHash,
    expires_at: input.nextExpiresAt,
    rotated_at: now,
    updated_at: now,
  };
  await saveAuthSessionState(memoryRoot, nextState);
  return "rotated";
}

export async function revokeAuthSession(memoryRoot: string, now = new Date().toISOString()): Promise<AuthSessionState> {
  const revoked: AuthSessionState = {
    active_session_id: null,
    active_refresh_jti_hash: null,
    previous_refresh_jti_hash: null,
    expires_at: null,
    rotated_at: now,
    updated_at: now,
  };
  await saveAuthSessionState(memoryRoot, revoked);
  return revoked;
}

function resolveAuthSessionPath(memoryRoot: string): string {
  return path.join(memoryRoot, "preferences", "auth-session.json");
}

function buildEmptySessionState(): AuthSessionState {
  return {
    active_session_id: null,
    active_refresh_jti_hash: null,
    previous_refresh_jti_hash: null,
    expires_at: null,
    rotated_at: null,
    updated_at: new Date().toISOString(),
  };
}

async function saveAuthSessionState(memoryRoot: string, state: AuthSessionState): Promise<void> {
  const sessionPath = resolveAuthSessionPath(memoryRoot);
  const validated = authSessionSchema.parse(state);
  await writeFile(sessionPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}

function hashRefreshJti(jti: string): string {
  return createHash("sha256").update(jti).digest("hex");
}
