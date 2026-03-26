import { randomBytes, randomUUID } from "node:crypto";

import type { AuthContext, AuthState } from "../contracts.js";
import { initializeMasterKey, loadMasterKey, type MasterKeyMaterial } from "../secrets/key-provider.js";
import { resolveSecretsPaths, type SecretsPaths } from "../secrets/paths.js";
import { getVaultSecret, upsertVaultSecret } from "../secrets/vault.js";
import { auditLog } from "../logger.js";
import {
  buildInitializedAuthState,
  JWT_SIGNING_KEY_SECRET_REF,
  OWNER_PASSWORD_HASH_SECRET_REF,
  requireUninitializedAccount,
  resolveAccountIdentifier,
} from "./account-store.js";
import { issueAccessToken, issueRefreshToken, verifyAccessToken, verifyRefreshToken } from "./jwt.js";
import { hashPassword, verifyPassword } from "./password.js";
import { activateAuthSession, revokeAuthSession, rotateAuthSession } from "./session-store.js";

const DEFAULT_ACCESS_TTL_SECONDS = 10 * 60;
const DEFAULT_REFRESH_TTL_SECONDS = 14 * 24 * 60 * 60;

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid credentials");
    this.name = "InvalidCredentialsError";
  }
}

export class InvalidAccessTokenError extends Error {
  constructor() {
    super("Invalid access token");
    this.name = "InvalidAccessTokenError";
  }
}

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super("Invalid refresh token");
    this.name = "InvalidRefreshTokenError";
  }
}

export class RefreshReplayDetectedError extends Error {
  constructor() {
    super("Refresh token replay detected");
    this.name = "RefreshReplayDetectedError";
  }
}

export type LocalJwtAuthTokenBundle = {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  refreshMaxAgeSeconds: number;
};

export type LocalJwtAuthService = {
  signup: (input: { identifier: string; password: string }) => Promise<LocalJwtAuthTokenBundle>;
  login: (input: { identifier: string; password: string }) => Promise<LocalJwtAuthTokenBundle>;
  refresh: (refreshToken: string) => Promise<LocalJwtAuthTokenBundle>;
  logout: () => Promise<void>;
  authenticateAccessToken: (accessToken: string) => Promise<AuthContext>;
  getSigningKeyForVerification: () => Promise<string>;
};

export function createLocalJwtAuthService(options: {
  memoryRoot: string;
  getAuthState: () => AuthState;
  persistAuthState: (nextState: AuthState) => Promise<void>;
  secretsPaths?: SecretsPaths;
}): LocalJwtAuthService {
  const secretsPaths = options.secretsPaths ?? resolveSecretsPaths();
  let cachedMasterKey: MasterKeyMaterial | null = null;

  async function getMasterKey(createIfMissing: boolean): Promise<MasterKeyMaterial> {
    if (cachedMasterKey) {
      return cachedMasterKey;
    }

    try {
      cachedMasterKey = await loadMasterKey(secretsPaths);
      return cachedMasterKey;
    } catch (error) {
      if (!createIfMissing) {
        throw error;
      }

      await initializeMasterKey({ paths: secretsPaths });
      cachedMasterKey = await loadMasterKey(secretsPaths);
      return cachedMasterKey;
    }
  }

  async function getSigningKey(createIfMissing: boolean): Promise<string> {
    const masterKey = await getMasterKey(createIfMissing);
    let signingKey = await getVaultSecret(JWT_SIGNING_KEY_SECRET_REF, masterKey, secretsPaths);

    if (!signingKey && createIfMissing) {
      signingKey = randomBytes(32).toString("base64url");
      await upsertVaultSecret(JWT_SIGNING_KEY_SECRET_REF, signingKey, masterKey, secretsPaths);
    }

    if (!signingKey || signingKey.trim().length === 0) {
      throw new Error("JWT signing key is missing");
    }

    return signingKey;
  }

  async function getPasswordHash(): Promise<string> {
    const masterKey = await getMasterKey(false);
    const hash = await getVaultSecret(OWNER_PASSWORD_HASH_SECRET_REF, masterKey, secretsPaths);
    if (!hash || hash.trim().length === 0) {
      throw new InvalidCredentialsError();
    }

    return hash;
  }

  function resolveSessionPolicy(authState: AuthState): { accessTtlSeconds: number; refreshTtlSeconds: number } {
    return {
      accessTtlSeconds: authState.session_policy?.access_ttl_seconds ?? DEFAULT_ACCESS_TTL_SECONDS,
      refreshTtlSeconds: authState.session_policy?.refresh_ttl_seconds ?? DEFAULT_REFRESH_TTL_SECONDS,
    };
  }

  function buildAuthContext(authState: AuthState): AuthContext {
    return {
      actorId: "owner",
      actorType: "owner",
      permissions: authState.permissions,
      mode: "local",
    };
  }

  async function issueSessionTokens(authState: AuthState, sessionId = randomUUID()): Promise<LocalJwtAuthTokenBundle> {
    const signingKey = await getSigningKey(true);
    const sessionPolicy = resolveSessionPolicy(authState);
    const access = issueAccessToken({
      signingKey,
      sessionId,
      ttlSeconds: sessionPolicy.accessTtlSeconds,
      permissions: authState.permissions,
    });
    const refresh = issueRefreshToken({
      signingKey,
      sessionId,
      ttlSeconds: sessionPolicy.refreshTtlSeconds,
    });

    await activateAuthSession(options.memoryRoot, {
      sessionId,
      refreshJti: refresh.claims.jti,
      expiresAt: toIsoFromEpochSeconds(refresh.claims.exp),
    });

    return {
      accessToken: access.token,
      accessTokenExpiresAt: toIsoFromEpochSeconds(access.claims.exp),
      refreshToken: refresh.token,
      refreshTokenExpiresAt: toIsoFromEpochSeconds(refresh.claims.exp),
      refreshMaxAgeSeconds: sessionPolicy.refreshTtlSeconds,
    };
  }

  return {
    async signup(input) {
      const authState = options.getAuthState();
      requireUninitializedAccount(authState);

      const normalizedIdentifier = input.identifier.trim();
      if (normalizedIdentifier.length === 0 || input.password.length < 8) {
        throw new InvalidCredentialsError();
      }

      const passwordHash = await hashPassword(input.password);
      const masterKey = await getMasterKey(true);
      await upsertVaultSecret(OWNER_PASSWORD_HASH_SECRET_REF, passwordHash, masterKey, secretsPaths);
      await getSigningKey(true);

      const nextState = buildInitializedAuthState(authState, {
        identifier: normalizedIdentifier,
        credentialRef: OWNER_PASSWORD_HASH_SECRET_REF,
        accessTtlSeconds: DEFAULT_ACCESS_TTL_SECONDS,
        refreshTtlSeconds: DEFAULT_REFRESH_TTL_SECONDS,
      });
      await options.persistAuthState(nextState);

      auditLog("auth.signup.success", {
        actor_id: nextState.actor_id,
      });

      return issueSessionTokens(nextState);
    },

    async login(input) {
      const authState = options.getAuthState();
      if (!authState.account_initialized) {
        auditLog("auth.login.failure", { reason: "account_uninitialized" });
        throw new InvalidCredentialsError();
      }

      const identifier = input.identifier.trim();
      const expectedIdentifier = resolveAccountIdentifier(authState);
      if (identifier !== expectedIdentifier) {
        auditLog("auth.login.failure", { reason: "identifier_mismatch" });
        throw new InvalidCredentialsError();
      }

      const passwordHash = await getPasswordHash();
      const matches = await verifyPassword(input.password, passwordHash);
      if (!matches) {
        auditLog("auth.login.failure", { reason: "password_mismatch" });
        throw new InvalidCredentialsError();
      }

      auditLog("auth.login.success", { actor_id: authState.actor_id });
      return issueSessionTokens(authState);
    },

    async refresh(refreshToken) {
      const authState = options.getAuthState();
      if (!authState.account_initialized) {
        throw new InvalidRefreshTokenError();
      }

      const signingKey = await getSigningKey(false);
      let claims;
      try {
        claims = verifyRefreshToken(refreshToken, signingKey);
      } catch {
        throw new InvalidRefreshTokenError();
      }

      const sessionPolicy = resolveSessionPolicy(authState);
      const nextAccess = issueAccessToken({
        signingKey,
        sessionId: claims.sid,
        ttlSeconds: sessionPolicy.accessTtlSeconds,
        permissions: authState.permissions,
      });
      const nextRefresh = issueRefreshToken({
        signingKey,
        sessionId: claims.sid,
        ttlSeconds: sessionPolicy.refreshTtlSeconds,
      });

      const rotationResult = await rotateAuthSession(options.memoryRoot, {
        sessionId: claims.sid,
        currentRefreshJti: claims.jti,
        nextRefreshJti: nextRefresh.claims.jti,
        nextExpiresAt: toIsoFromEpochSeconds(nextRefresh.claims.exp),
      });

      if (rotationResult === "replay") {
        auditLog("auth.refresh.replay_detected", {
          actor_id: authState.actor_id,
          session_id: claims.sid,
        });
        throw new RefreshReplayDetectedError();
      }

      if (rotationResult !== "rotated") {
        throw new InvalidRefreshTokenError();
      }

      auditLog("auth.refresh.success", {
        actor_id: authState.actor_id,
        session_id: claims.sid,
      });

      return {
        accessToken: nextAccess.token,
        accessTokenExpiresAt: toIsoFromEpochSeconds(nextAccess.claims.exp),
        refreshToken: nextRefresh.token,
        refreshTokenExpiresAt: toIsoFromEpochSeconds(nextRefresh.claims.exp),
        refreshMaxAgeSeconds: sessionPolicy.refreshTtlSeconds,
      };
    },

    async logout() {
      await revokeAuthSession(options.memoryRoot);
      auditLog("auth.logout", { actor_id: options.getAuthState().actor_id });
    },

    async authenticateAccessToken(accessToken) {
      const authState = options.getAuthState();
      if (!authState.account_initialized) {
        throw new InvalidAccessTokenError();
      }

      let claims;
      try {
        const signingKey = await getSigningKey(false);
        claims = verifyAccessToken(accessToken, signingKey);
      } catch {
        throw new InvalidAccessTokenError();
      }

      if (claims.mode !== "local" || claims.sub !== "owner") {
        throw new InvalidAccessTokenError();
      }

      if (JSON.stringify(claims.permissions) !== JSON.stringify(authState.permissions)) {
        throw new InvalidAccessTokenError();
      }

      return buildAuthContext(authState);
    },

    async getSigningKeyForVerification() {
      return getSigningKey(false);
    },
  };
}

function toIsoFromEpochSeconds(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}
