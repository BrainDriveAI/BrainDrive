import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

import type { AuthMode, AuthState, PermissionSet } from "../contracts.js";
import { auditLog } from "../logger.js";

const DEFAULT_PERMISSIONS: PermissionSet = {
  memory_access: true,
  tool_access: true,
  system_actions: true,
  delegation: true,
  approval_authority: true,
  administration: true,
};

const DEFAULT_SESSION_POLICY = {
  access_ttl_seconds: 10 * 60,
  refresh_ttl_seconds: 14 * 24 * 60 * 60,
};

const permissionSchema = z
  .object({
    memory_access: z.boolean(),
    tool_access: z.boolean(),
    system_actions: z.boolean(),
    delegation: z.boolean(),
    approval_authority: z.boolean(),
    administration: z.boolean(),
  })
  .strict();

const authStateInputSchema = z
  .object({
    actor_id: z.string().trim().min(1).optional(),
    actor_type: z.literal("owner").optional(),
    permissions: permissionSchema.optional(),
    mode: z.enum(["local-owner", "local", "managed"]).optional(),
    account_initialized: z.boolean().optional(),
    account_username: z.string().trim().min(1).optional(),
    account_created_at: z.string().trim().min(1).optional(),
    credential_ref: z.string().trim().min(1).optional(),
    session_policy: z
      .object({
        access_ttl_seconds: z.number().int().positive(),
        refresh_ttl_seconds: z.number().int().positive(),
      })
      .strict()
      .optional(),
    created_at: z.string().trim().min(1).optional(),
    updated_at: z.string().trim().min(1).optional(),
  })
  .passthrough();

export async function ensureAuthState(
  memoryRoot: string,
  options: { mode?: AuthMode } = {}
): Promise<AuthState> {
  const authPath = resolveAuthStatePath(memoryRoot);

  try {
    const raw = await readFile(authPath, "utf8");
    const parsedRaw = parseAuthStateInput(raw, authPath);
    const normalized = normalizeAuthState(parsedRaw, options.mode);
    const normalizedJson = formatAuthState(normalized).trim();
    if (raw.trim() !== normalizedJson) {
      await writeFile(authPath, `${normalizedJson}\n`, "utf8");
      auditLog("auth.state.migrated", { path: authPath, mode: normalized.mode });
    } else {
      auditLog("auth.state.loaded", { path: authPath, mode: normalized.mode });
    }
    return normalized;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    const state = createInitialAuthState(options.mode ?? "local-owner");
    await writeFile(authPath, formatAuthState(state), "utf8");
    auditLog("auth.state.created", {
      path: authPath,
      actor_id: state.actor_id,
      mode: state.mode,
      account_initialized: state.account_initialized,
    });
    return state;
  }
}

export async function saveAuthState(memoryRoot: string, state: AuthState): Promise<AuthState> {
  const authPath = resolveAuthStatePath(memoryRoot);
  const normalized = normalizeAuthState(state);
  await writeFile(authPath, formatAuthState(normalized), "utf8");
  auditLog("auth.state.saved", {
    path: authPath,
    mode: normalized.mode,
    account_initialized: normalized.account_initialized,
  });
  return normalized;
}

export async function readAuthState(memoryRoot: string): Promise<AuthState> {
  const authPath = resolveAuthStatePath(memoryRoot);
  const raw = await readFile(authPath, "utf8");
  const parsed = parseAuthStateInput(raw, authPath);
  const normalized = normalizeAuthState(parsed);
  auditLog("auth.state.exported", { path: authPath });
  return normalized;
}

function resolveAuthStatePath(memoryRoot: string): string {
  return path.join(memoryRoot, "preferences", "auth-state.json");
}

function parseAuthStateInput(raw: string, authPath: string): z.input<typeof authStateInputSchema> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Auth state file is not valid JSON: ${authPath}`);
  }

  return authStateInputSchema.parse(parsed);
}

function createInitialAuthState(mode: AuthMode): AuthState {
  const now = new Date().toISOString();
  const base: AuthState = {
    actor_id: "owner",
    actor_type: "owner",
    mode,
    permissions: { ...DEFAULT_PERMISSIONS },
    account_initialized: mode !== "local",
    created_at: now,
    updated_at: now,
  };

  if (mode === "local") {
    base.session_policy = { ...DEFAULT_SESSION_POLICY };
  }

  return base;
}

function normalizeAuthState(input: unknown, modeOverride?: AuthMode): AuthState {
  const parsed = authStateInputSchema.parse(input);
  const now = new Date().toISOString();
  const mode = modeOverride ?? parsed.mode ?? "local-owner";
  const createdAt = parsed.created_at ?? now;
  const updatedAt = parsed.updated_at ?? createdAt;
  const accountInitialized =
    typeof parsed.account_initialized === "boolean" ? parsed.account_initialized : mode !== "local";

  const normalized: AuthState = {
    actor_id: parsed.actor_id ?? "owner",
    actor_type: "owner",
    mode,
    permissions: parsed.permissions ?? { ...DEFAULT_PERMISSIONS },
    account_initialized: accountInitialized,
    created_at: createdAt,
    updated_at: updatedAt,
  };

  if (parsed.account_username) {
    normalized.account_username = parsed.account_username;
  } else if (mode === "local" && accountInitialized) {
    normalized.account_username = "owner";
  }

  if (accountInitialized) {
    normalized.account_created_at = parsed.account_created_at ?? createdAt;
  }

  if (parsed.credential_ref) {
    normalized.credential_ref = parsed.credential_ref;
  }

  if (mode === "local") {
    normalized.session_policy = parsed.session_policy ?? { ...DEFAULT_SESSION_POLICY };
  }

  return normalized;
}

function formatAuthState(state: AuthState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}
