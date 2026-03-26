import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { PermissionSet } from "../contracts.js";

const jwtHeaderSchema = z
  .object({
    alg: z.literal("HS256"),
    typ: z.literal("JWT"),
    kid: z.string().trim().min(1).optional(),
  })
  .strict();

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

const baseClaimsSchema = z
  .object({
    sub: z.literal("owner"),
    mode: z.literal("local"),
    typ: z.enum(["access", "refresh"]),
    jti: z.string().trim().min(1),
    sid: z.string().trim().min(1),
    iat: z.number().int().positive(),
    exp: z.number().int().positive(),
  })
  .strict();

const accessClaimsSchema = baseClaimsSchema.extend({
  typ: z.literal("access"),
  permissions: permissionSchema,
});

const refreshClaimsSchema = baseClaimsSchema.extend({
  typ: z.literal("refresh"),
});

export type AccessTokenClaims = z.infer<typeof accessClaimsSchema>;
export type RefreshTokenClaims = z.infer<typeof refreshClaimsSchema>;

export type IssuedJwt<TClaims> = {
  token: string;
  claims: TClaims;
};

type IssueBaseTokenInput = {
  signingKey: string;
  keyId?: string;
  sessionId: string;
  ttlSeconds: number;
  now?: Date;
};

export function issueAccessToken(
  input: IssueBaseTokenInput & {
    permissions: PermissionSet;
  }
): IssuedJwt<AccessTokenClaims> {
  const nowSeconds = toEpochSeconds(input.now ?? new Date());
  const claims: AccessTokenClaims = {
    sub: "owner",
    mode: "local",
    typ: "access",
    jti: randomUUID(),
    sid: input.sessionId,
    iat: nowSeconds,
    exp: nowSeconds + input.ttlSeconds,
    permissions: input.permissions,
  };

  return {
    token: signJwt(claims, input.signingKey, input.keyId),
    claims,
  };
}

export function issueRefreshToken(input: IssueBaseTokenInput): IssuedJwt<RefreshTokenClaims> {
  const nowSeconds = toEpochSeconds(input.now ?? new Date());
  const claims: RefreshTokenClaims = {
    sub: "owner",
    mode: "local",
    typ: "refresh",
    jti: randomUUID(),
    sid: input.sessionId,
    iat: nowSeconds,
    exp: nowSeconds + input.ttlSeconds,
  };

  return {
    token: signJwt(claims, input.signingKey, input.keyId),
    claims,
  };
}

export function verifyAccessToken(token: string, signingKey: string): AccessTokenClaims {
  const claims = verifyJwt(token, signingKey);
  const validated = accessClaimsSchema.parse(claims);
  assertTokenNotExpired(validated);
  return validated;
}

export function verifyRefreshToken(token: string, signingKey: string): RefreshTokenClaims {
  const claims = verifyJwt(token, signingKey);
  const validated = refreshClaimsSchema.parse(claims);
  assertTokenNotExpired(validated);
  return validated;
}

function signJwt(payload: object, signingKey: string, keyId?: string): string {
  const header = jwtHeaderSchema.parse({
    alg: "HS256",
    typ: "JWT",
    ...(keyId ? { kid: keyId } : {}),
  });

  const encodedHeader = toBase64UrlJson(header);
  const encodedPayload = toBase64UrlJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", signingKey).update(signingInput).digest("base64url");

  return `${signingInput}.${signature}`;
}

function verifyJwt(token: string, signingKey: string): unknown {
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new Error("Malformed JWT");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Malformed JWT");
  }

  const header = jwtHeaderSchema.parse(fromBase64UrlJson(encodedHeader));
  if (header.alg !== "HS256") {
    throw new Error("Unsupported JWT algorithm");
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = createHmac("sha256", signingKey).update(signingInput).digest();
  const providedSignature = Buffer.from(encodedSignature, "base64url");

  if (providedSignature.length !== expectedSignature.length) {
    throw new Error("Invalid JWT signature");
  }

  if (!timingSafeEqual(providedSignature, expectedSignature)) {
    throw new Error("Invalid JWT signature");
  }

  return fromBase64UrlJson(encodedPayload);
}

function assertTokenNotExpired(claims: { exp: number }): void {
  const nowSeconds = toEpochSeconds(new Date());
  if (claims.exp <= nowSeconds) {
    throw new Error("Token expired");
  }
}

function toEpochSeconds(value: Date): number {
  return Math.floor(value.getTime() / 1000);
}

function toBase64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function fromBase64UrlJson(value: string): unknown {
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  return JSON.parse(decoded);
}
