import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { z } from "zod";

import { canonicalJson, OpaqueIdSchema } from "../contracts/common.js";
import { ContractViolation } from "../contracts/errors.js";
import { CapabilityGrantSchema, type PackageManifestSchema } from "../contracts/package.js";
import { syncDirectoryEntry } from "./filesystem-durability.js";

type Manifest = z.infer<typeof PackageManifestSchema>;
export type InstallationGrant = z.infer<typeof CapabilityGrantSchema>;

export type OwnerGrantDecision = {
  approved: boolean;
  decisionId: string;
  decidedByActorId: string;
  decidedAt: string;
  capabilities: readonly Manifest["requested_capabilities"][number][];
  recordScopes: readonly string[];
};

export type GrantIdentity = {
  grantId: string;
  ownerId: string;
  actorId: string;
  installationId: string;
  packageDigest: `sha256:${string}`;
};

export class InstallationGrantStore {
  readonly root: string;

  constructor(stateRoot: string) {
    this.root = path.join(stateRoot, "host-app-state", "grants");
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  decide(identity: GrantIdentity, manifest: Manifest, decision: OwnerGrantDecision): InstallationGrant | null {
    OpaqueIdSchema.parse(identity.grantId);
    OpaqueIdSchema.parse(identity.ownerId);
    OpaqueIdSchema.parse(identity.actorId);
    OpaqueIdSchema.parse(identity.installationId);
    OpaqueIdSchema.parse(decision.decisionId);
    OpaqueIdSchema.parse(decision.decidedByActorId);
    const exact = [...manifest.requested_capabilities];
    if (!decision.approved) return null;
    if (
      decision.decidedByActorId !== identity.actorId
      || JSON.stringify([...decision.capabilities]) !== JSON.stringify(exact)
    ) throw new ContractViolation("widened_grant", "Owner grant decision does not match the exact package capabilities");
    return CapabilityGrantSchema.parse({
      grant_version: 1,
      grant_revision: 1,
      revocation_generation: 0,
      grant_id: identity.grantId,
      owner_id: identity.ownerId,
      actor_id: identity.actorId,
      app_id: manifest.app_id,
      publisher_id: manifest.publisher_id,
      package_digest: identity.packageDigest,
      installation_id: identity.installationId,
      capabilities: exact,
      record_scopes: [...decision.recordScopes],
      decision: {
        decision_id: decision.decisionId,
        decided_by_actor_id: decision.decidedByActorId,
        decided_at: decision.decidedAt,
        outcome: "approved",
      },
      issued_at: decision.decidedAt,
      expires_at: new Date(Date.parse(decision.decidedAt) + 365 * 24 * 60 * 60_000).toISOString(),
      revoked_at: null,
    });
  }

  async persist(grant: InstallationGrant): Promise<void> {
    await this.initialize();
    const parsed = CapabilityGrantSchema.parse(grant);
    const target = this.pathFor(parsed.grant_id);
    try {
      const existing = CapabilityGrantSchema.parse(JSON.parse(await readFile(target, "utf8")));
      if (canonicalJson(existing) !== canonicalJson(parsed)) throw new ContractViolation("idempotency_conflict", "Grant identity already contains different authority");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        if (error instanceof ContractViolation) throw error;
        if (!(error instanceof SyntaxError)) throw error;
        throw new ContractViolation("recoverable_internal_failure", "Stored grant is corrupt");
      }
    }
    const temporary = `${target}.tmp-${randomUUID()}`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${canonicalJson(parsed)}\n`, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    try {
      await rename(temporary, target);
      await syncDirectoryEntry(this.root);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async read(grantId: string): Promise<InstallationGrant | null> {
    OpaqueIdSchema.parse(grantId);
    try {
      return CapabilityGrantSchema.parse(JSON.parse(await readFile(this.pathFor(grantId), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async remove(grantId: string): Promise<void> {
    OpaqueIdSchema.parse(grantId);
    await rm(this.pathFor(grantId), { force: true });
  }

  private pathFor(grantId: string): string {
    return path.join(this.root, `${grantId}.json`);
  }
}
