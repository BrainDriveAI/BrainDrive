import path from "node:path";
import { open, unlink } from "node:fs/promises";

import type { AuthState } from "../contracts.js";

export const OWNER_PASSWORD_HASH_SECRET_REF = "auth/owner/password_hash";
export const JWT_SIGNING_KEY_SECRET_REF = "auth/jwt/signing_key";

const SIGNUP_LOCK_FILE = "auth-signup.lock";

export class AccountAlreadyInitializedError extends Error {
  constructor() {
    super("Account already initialized");
    this.name = "AccountAlreadyInitializedError";
  }
}

export class AccountInitializationLockedError extends Error {
  constructor() {
    super("Account initialization lock is already held");
    this.name = "AccountInitializationLockedError";
  }
}

export type BootstrapStatus = {
  account_initialized: boolean;
  mode: "local" | "local-owner" | "managed";
};

export async function withSignupLock<T>(memoryRoot: string, action: () => Promise<T>): Promise<T> {
  const lockPath = path.join(memoryRoot, "preferences", SIGNUP_LOCK_FILE);
  let lockHandle: Awaited<ReturnType<typeof open>> | null = null;

  try {
    lockHandle = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new AccountInitializationLockedError();
    }
    throw error;
  }

  try {
    return await action();
  } finally {
    await lockHandle?.close();
    await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });
  }
}

export function toBootstrapStatus(authState: AuthState): BootstrapStatus {
  return {
    account_initialized: Boolean(authState.account_initialized),
    mode: authState.mode,
  };
}

export function requireUninitializedAccount(authState: AuthState): void {
  if (authState.account_initialized) {
    throw new AccountAlreadyInitializedError();
  }
}

export function buildInitializedAuthState(
  authState: AuthState,
  input: {
    identifier: string;
    credentialRef?: string;
    now?: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  }
): AuthState {
  const now = input.now ?? new Date().toISOString();

  return {
    ...authState,
    actor_id: "owner",
    actor_type: "owner",
    mode: "local",
    account_initialized: true,
    account_username: normalizeIdentifier(input.identifier),
    account_created_at: authState.account_created_at ?? now,
    credential_ref: input.credentialRef,
    session_policy: {
      access_ttl_seconds: input.accessTtlSeconds,
      refresh_ttl_seconds: input.refreshTtlSeconds,
    },
    updated_at: now,
  };
}

export function resolveAccountIdentifier(authState: AuthState): string {
  return authState.account_username?.trim() || "owner";
}

export function normalizeIdentifier(identifier: string): string {
  const normalized = identifier.trim();
  if (normalized.length === 0) {
    throw new Error("Identifier is required");
  }

  return normalized;
}
