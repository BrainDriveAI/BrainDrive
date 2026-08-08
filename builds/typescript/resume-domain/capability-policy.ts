import { z } from "zod";

import {
  ResumeDataCapabilityContextSchema,
  ResumeDataCapabilityNameSchema,
} from "../app-platform/contracts/data-conformance.js";
import { OpaqueIdSchema } from "../app-platform/contracts/common.js";
import { CapabilityGrantSchema, CapabilityTokenSchema } from "../app-platform/contracts/package.js";
import type { CapabilityGrant } from "../app-platform/lifecycle/store.js";
import { ResumeDomainError } from "./errors.js";

export const RestrictedCapabilityAuthoritySchema = z.object({
  authority_version: z.literal(1),
  context: ResumeDataCapabilityContextSchema,
  grant_revision: z.number().int().positive(),
  revocation_generation: z.number().int().nonnegative(),
  token_audience: z.enum(["app_data", "app_export"]),
  connection_id: OpaqueIdSchema,
  view_id: OpaqueIdSchema.nullable(),
  operation_id: OpaqueIdSchema,
}).strict();

export type RestrictedCapabilityAuthority = z.infer<typeof RestrictedCapabilityAuthoritySchema>;
export type ResumeDataCapability = z.infer<typeof ResumeDataCapabilityNameSchema>;
type CapabilityTokenClaims = z.infer<typeof CapabilityTokenSchema>;
export type LiveCapabilityGrantResolver = () => Promise<CapabilityGrant | null>;

/** Non-serializable witness issued only after the gateway authenticates an owner action. */
export class HostOwnerCapabilityAuthorization {
  readonly #actorId: string;

  private constructor(actorId: string) {
    if (!actorId.trim()) throw new ResumeDomainError("denied", "Authenticated owner identity is missing", 403);
    this.#actorId = actorId;
  }

  static issue(actorId: string): HostOwnerCapabilityAuthorization {
    return new HostOwnerCapabilityAuthorization(actorId);
  }

  authenticatedActorId(): string {
    return this.#actorId;
  }
}

export function issueHostOwnerCapabilityAuthorization(actorId: string): HostOwnerCapabilityAuthorization {
  return HostOwnerCapabilityAuthorization.issue(actorId);
}

export function requireHostOwnerCapabilityAuthorization(value: unknown): HostOwnerCapabilityAuthorization {
  if (!(value instanceof HostOwnerCapabilityAuthorization)) denied();
  return value;
}

export function restrictedAuthorityFromTokenClaims(rawClaims: CapabilityTokenClaims): RestrictedCapabilityAuthority {
  const claims = CapabilityTokenSchema.parse(rawClaims);
  if (claims.audience !== "app_data" && claims.audience !== "app_export") denied();
  const grantedCapabilities = claims.capabilities.map((capability) => {
    const parsed = ResumeDataCapabilityNameSchema.safeParse(capability);
    if (!parsed.success) denied();
    return parsed.data;
  });
  return RestrictedCapabilityAuthoritySchema.parse({
    authority_version: 1,
    context: {
      context_version: 1,
      owner_id: claims.owner_id,
      actor_id: claims.actor_id,
      app_id: claims.app_id,
      publisher_id: claims.publisher_id,
      package_digest: claims.package_digest,
      installation_id: claims.installation_id,
      grant_id: claims.grant_id,
      audience: "resume_data",
      granted_capabilities: grantedCapabilities,
      record_scope_ids: claims.record_scopes,
      issued_at: claims.issued_at,
      expires_at: claims.expires_at,
    },
    grant_revision: claims.grant_revision,
    revocation_generation: claims.revocation_generation,
    token_audience: claims.audience,
    connection_id: claims.connection_id,
    view_id: claims.view_id,
    operation_id: claims.operation_id,
  });
}

export class ResumeCapabilityPolicy {
  constructor(
    private readonly resolveLiveGrant: LiveCapabilityGrantResolver,
    private readonly now = () => new Date(),
  ) {}

  async authorize(
    rawCapability: unknown,
    rawAuthority: unknown,
    expectedOperationId: string,
  ): Promise<CapabilityGrant> {
    const capability = ResumeDataCapabilityNameSchema.safeParse(rawCapability);
    const authority = RestrictedCapabilityAuthoritySchema.safeParse(rawAuthority);
    if (!capability.success || !authority.success || !OpaqueIdSchema.safeParse(expectedOperationId).success) denied();

    const binding = authority.data;
    const context = binding.context;
    const currentTime = this.now().getTime();
    const expectedAudience = capability.data === "resume.export.request" ? "app_export" : "app_data";
    if (
      binding.operation_id !== expectedOperationId ||
      binding.token_audience !== expectedAudience ||
      Date.parse(context.issued_at) > currentTime ||
      Date.parse(context.expires_at) <= currentTime ||
      context.granted_capabilities.length !== 1 ||
      context.granted_capabilities[0] !== capability.data
    ) denied();

    const liveRaw = await this.resolveLiveGrant();
    if (!liveRaw) denied();
    const live = CapabilityGrantSchema.safeParse(liveRaw);
    if (!live.success) denied();
    const grant = live.data;
    if (
      grant.revoked_at !== null ||
      Date.parse(grant.expires_at) <= currentTime ||
      grant.grant_revision !== binding.grant_revision ||
      grant.revocation_generation !== binding.revocation_generation ||
      grant.grant_id !== context.grant_id ||
      grant.owner_id !== context.owner_id ||
      grant.actor_id !== context.actor_id ||
      grant.app_id !== context.app_id ||
      grant.publisher_id !== context.publisher_id ||
      grant.package_digest !== context.package_digest ||
      grant.installation_id !== context.installation_id ||
      !grant.capabilities.includes(capability.data) ||
      (grant.record_scopes.length > 0 && context.record_scope_ids.some((scope) => !grant.record_scopes.includes(scope)))
    ) denied();
    return grant;
  }
}

function denied(): never {
  throw new ResumeDomainError("denied", "Capability authority is not active for this operation", 403);
}
