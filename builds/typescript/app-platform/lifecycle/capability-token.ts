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
  viewId?: string | null;
  recordScopes?: string[];
  ttlMs: number;
};

type ConsumeInput = { audience: Audience; capability: Capability; installationId: string; operationId?: string };

export class CapabilityTokenBroker {
  private readonly tokens = new Map<string, { claims: TokenClaims; consumed: boolean }>();
  private readonly revokedInstallations = new Set<string>();

  issue(input: IssueInput): { token: string; claims: TokenClaims } {
    if (input.grant.revoked_at || Date.parse(input.grant.expires_at) <= Date.now()) throw new AppPlatformError("grant_revoked", "Capability grant is no longer active");
    try { assertGrantSubset(input.grant.capabilities, input.capabilities); }
    catch { throw new AppPlatformError("widened_grant", "Requested token capabilities exceed the installed grant"); }
    if (input.audience === "app_export" && (input.capabilities.length !== 1 || input.capabilities[0] !== "resume.export.request")) throw new AppPlatformError("token_audience_invalid", "Export token audience is confused");
    if (input.audience === "app_inference" && (input.capabilities.length !== 1 || input.capabilities[0] !== "app.inference.request")) throw new AppPlatformError("token_audience_invalid", "Inference token audience is confused");
    if (input.audience === "app_data" && input.capabilities.some((capability) => capability === "app.inference.request" || capability === "resume.export.request")) throw new AppPlatformError("token_audience_invalid", "Data token cannot carry inference or export authority");
    if (input.audience === "app_bridge" && !input.viewId) throw new AppPlatformError("token_audience_invalid", "Bridge token requires a view binding");
    const now = new Date();
    const claims = CapabilityTokenSchema.parse({
      token_version: 1,
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
      capabilities: input.capabilities,
      record_scopes: input.recordScopes ?? input.grant.record_scopes,
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
    if (Date.parse(record.claims.expires_at) <= Date.now()) throw new AppPlatformError("token_expired", "Capability token expired", 401);
    if (record.consumed) throw new AppPlatformError("token_replayed", "Capability token nonce was already consumed", 401);
    if (record.claims.audience !== expected.audience || record.claims.installation_id !== expected.installationId || !record.claims.capabilities.includes(expected.capability) || (expected.operationId && record.claims.operation_id !== expected.operationId)) {
      throw new AppPlatformError("token_scope_invalid", "Capability token scope does not match the request", 403);
    }
    record.consumed = true;
    return record.claims;
  }

  revokeInstallation(installationId: string): void { this.revokedInstallations.add(installationId); }
  permitInstallation(installationId: string): void { this.revokedInstallations.delete(installationId); }
  isRevoked(installationId: string): boolean { return this.revokedInstallations.has(installationId); }
  private hash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
}
