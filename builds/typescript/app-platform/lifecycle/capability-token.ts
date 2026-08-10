import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { z } from "zod";
import { assertGrantSubset, CapabilityTokenSchema } from "../contracts/package.js";
import type { CapabilityGrant } from "./store.js";
import { AppPlatformError } from "./errors.js";

type TokenClaims = z.infer<typeof CapabilityTokenSchema>;
type Capability = TokenClaims["capabilities"][number];
type Audience = TokenClaims["audience"];

type IssueInput = {
  grant: CapabilityGrant;
  audience: Audience;
  capabilities: Capability[];
  connectionId: string;
  operationId: string;
  idempotencyKey: string;
  tokenGeneration: number;
  viewId?: string | null;
  recordScopes?: string[];
  ttlMs: number;
};

type ConsumeInput = {
  audience: Audience;
  capability: Capability;
  installationId: string;
  ownerId?: string;
  actorId?: string;
  appId?: string;
  publisherId?: string;
  packageDigest?: string;
  grantId?: string;
  grantRevision?: number;
  revocationGeneration?: number;
  tokenGeneration?: number;
  connectionId?: string;
  viewId?: string | null;
  operationId?: string;
  idempotencyKey?: string;
  recordScopes?: readonly string[];
  currentGrant?: CapabilityGrant;
};

export class CapabilityTokenBroker {
  private readonly tokens = new Map<string, { claims: TokenClaims; consumed: boolean }>();
  private readonly revokedInstallations = new Set<string>();
  private readonly revokedConnections = new Set<string>();
  private readonly revokedViews = new Set<string>();

  issue(input: IssueInput): { token: string; claims: TokenClaims } {
    if (input.grant.revoked_at || Date.parse(input.grant.expires_at) <= Date.now()) throw new AppPlatformError("grant_revoked", "Capability grant is no longer active");
    if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0 || input.ttlMs > 5 * 60_000) throw new AppPlatformError("token_invalid", "Capability token lifetime is invalid", 400);
    try { assertGrantSubset(input.grant.capabilities, input.capabilities); }
    catch { throw new AppPlatformError("widened_grant", "Requested token capabilities exceed the installed grant"); }
    const recordScopes = input.recordScopes ?? input.grant.record_scopes;
    const grantedScopes = new Set(input.grant.record_scopes);
    if (new Set(recordScopes).size !== recordScopes.length || recordScopes.some((scope) => !grantedScopes.has(scope))) {
      throw new AppPlatformError("widened_grant", "Requested token record scope exceeds the installed grant");
    }
    if (input.audience === "app_export" && (input.capabilities.length !== 1 || input.capabilities[0] !== "resume.export.request")) throw new AppPlatformError("token_audience_invalid", "Export token audience is confused");
    if (input.audience === "app_inference" && (input.capabilities.length !== 1 || input.capabilities[0] !== "app.inference.request")) throw new AppPlatformError("token_audience_invalid", "Inference token audience is confused");
    if (input.audience === "app_data" && input.capabilities.some((capability) => capability === "app.inference.request" || capability === "resume.export.request")) throw new AppPlatformError("token_audience_invalid", "Data token cannot carry inference or export authority");
    if (input.audience === "app_bridge" && !input.viewId) throw new AppPlatformError("token_audience_invalid", "Bridge token requires a view binding");
    const now = new Date();
    const claims = CapabilityTokenSchema.parse({
      token_version: 1,
      token_generation: input.tokenGeneration,
      grant_revision: input.grant.grant_revision,
      revocation_generation: input.grant.revocation_generation,
      token_id: randomUUID(),
      audience: input.audience,
      grant_id: input.grant.grant_id,
      owner_id: input.grant.owner_id,
      actor_id: input.grant.actor_id,
      app_id: input.grant.app_id,
      publisher_id: input.grant.publisher_id,
      package_digest: input.grant.package_digest,
      installation_id: input.grant.installation_id,
      connection_id: input.connectionId,
      view_id: input.viewId ?? null,
      operation_id: input.operationId,
      idempotency_key: input.idempotencyKey,
      capabilities: input.capabilities,
      record_scopes: recordScopes,
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + input.ttlMs).toISOString(),
      nonce: randomBytes(24).toString("base64url"),
    });
    const token = randomBytes(32).toString("base64url");
    this.tokens.set(this.hash(token), { claims, consumed: false });
    return { token, claims };
  }

  consume(token: string, expected: ConsumeInput): TokenClaims {
    const record = this.tokens.get(this.hash(token));
    if (!record) throw new AppPlatformError("token_invalid", "Capability token is unknown", 401);
    if (this.revokedInstallations.has(record.claims.installation_id)) throw new AppPlatformError("token_revoked", "Capability token authority was revoked", 401);
    if (this.revokedConnections.has(record.claims.connection_id) || (record.claims.view_id !== null && this.revokedViews.has(record.claims.view_id))) throw new AppPlatformError("token_revoked", "Capability token authority was revoked", 401);
    if (Date.parse(record.claims.expires_at) <= Date.now()) throw new AppPlatformError("token_expired", "Capability token expired", 401);
    if (record.consumed) throw new AppPlatformError("token_replayed", "Capability token nonce was already consumed", 401);
    const claims = record.claims;
    const exactScopes = expected.recordScopes === undefined || JSON.stringify(claims.record_scopes) === JSON.stringify(expected.recordScopes);
    const current = expected.currentGrant;
    const currentGrantMatches = !current || (
      current.revoked_at === null && Date.parse(current.expires_at) > Date.now() &&
      current.grant_id === claims.grant_id && current.grant_revision === claims.grant_revision &&
      current.revocation_generation === claims.revocation_generation && current.owner_id === claims.owner_id &&
      current.actor_id === claims.actor_id && current.app_id === claims.app_id && current.publisher_id === claims.publisher_id &&
      current.package_digest === claims.package_digest && current.installation_id === claims.installation_id &&
      claims.capabilities.every((capability) => current.capabilities.includes(capability)) &&
      claims.record_scopes.every((scope) => current.record_scopes.includes(scope))
    );
    if (
      claims.audience !== expected.audience || claims.installation_id !== expected.installationId ||
      claims.capabilities.length !== 1 || claims.capabilities[0] !== expected.capability ||
      (expected.ownerId !== undefined && claims.owner_id !== expected.ownerId) ||
      (expected.actorId !== undefined && claims.actor_id !== expected.actorId) ||
      (expected.appId !== undefined && claims.app_id !== expected.appId) ||
      (expected.publisherId !== undefined && claims.publisher_id !== expected.publisherId) ||
      (expected.packageDigest !== undefined && claims.package_digest !== expected.packageDigest) ||
      (expected.grantId !== undefined && claims.grant_id !== expected.grantId) ||
      (expected.grantRevision !== undefined && claims.grant_revision !== expected.grantRevision) ||
      (expected.revocationGeneration !== undefined && claims.revocation_generation !== expected.revocationGeneration) ||
      (expected.tokenGeneration !== undefined && claims.token_generation !== expected.tokenGeneration) ||
      (expected.connectionId !== undefined && claims.connection_id !== expected.connectionId) ||
      (expected.viewId !== undefined && claims.view_id !== expected.viewId) ||
      (expected.operationId !== undefined && claims.operation_id !== expected.operationId) ||
      (expected.idempotencyKey !== undefined && claims.idempotency_key !== expected.idempotencyKey) ||
      !exactScopes || !currentGrantMatches
    ) {
      throw new AppPlatformError("token_scope_invalid", "Capability token scope does not match the request", 403);
    }
    record.consumed = true;
    return record.claims;
  }

  revokeInstallation(installationId: string): void { this.revokedInstallations.add(installationId); }
  revokeConnection(connectionId: string): void { this.revokedConnections.add(connectionId); }
  revokeView(viewId: string): void { this.revokedViews.add(viewId); }
  permitInstallation(installationId: string): void { this.revokedInstallations.delete(installationId); }
  isRevoked(installationId: string): boolean { return this.revokedInstallations.has(installationId); }
  private hash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
}
