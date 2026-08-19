import type { z } from "zod";

import { canonicalInputDigest } from "../contracts/common.js";
import { ContractViolation } from "../contracts/errors.js";
import {
  assertDetachedEnvelopeSignature,
  assertMonotonicRevocationCandidate,
  resolveAuthorizedReleaseKey,
  REVOCATION_FRESHNESS_POLICY,
  RevocationListSchema,
  TrustRootSchema,
} from "../contracts/package.js";
import type { VerifiedPackageAuthorityCache, VerifiedRevocations } from "./verified-feed-cache.js";

type TrustRoot = z.infer<typeof TrustRootSchema>;

export type RevocationStatus = {
  cache_state: "missing" | "fresh" | "stale";
  external_status: "online" | "offline";
  sequence: number | null;
  age_seconds: number | null;
  explicitly_revoked: boolean;
  matched_revocation_ids: string[];
};

export type RevocationRefreshResult = {
  outcome: "accepted" | "unchanged" | "rejected";
  sequence: number | null;
  payload_digest: string | null;
  error_code: string | null;
};

export type RevocationVerifier = (candidate: VerifiedRevocations, trustRoot: TrustRoot, pinnedRoot: { keyId: string; publicKey: string }) => void;

function verifyRevocations(candidate: VerifiedRevocations, trustRoot: TrustRoot, pinnedRoot: { keyId: string; publicKey: string }): void {
  if (trustRoot.root_key.key_id !== pinnedRoot.keyId || trustRoot.root_key.public_key !== pinnedRoot.publicKey) {
    throw new ContractViolation("revocation_metadata_invalid", "Revocation trust root does not match pinned authority");
  }
  const key = resolveAuthorizedReleaseKey(trustRoot, candidate.signature.signing_key_id, candidate.payload.issued_at);
  try { assertDetachedEnvelopeSignature(key.public_key, candidate.signature, candidate.payload); }
  catch { throw new ContractViolation("revocation_metadata_invalid", "Revocation metadata signature is invalid"); }
}

function compareSemver(left: string, right: string): number {
  const parse = (value: string) => value.split("-")[0].split(".").map(Number);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

export class MonotonicRevocationAuthority {
  constructor(
    private readonly cache: VerifiedPackageAuthorityCache,
    private readonly clock: () => Date = () => new Date(),
    private readonly verify: RevocationVerifier = verifyRevocations,
    private readonly audit: (event: string, details: Record<string, unknown>) => void = () => undefined,
  ) {}

  async refresh(input: { candidateBytes: Buffer; trustRootBytes: Buffer; pinnedRoot: { keyId: string; publicKey: string } }): Promise<RevocationRefreshResult> {
    try {
      if (input.candidateBytes.byteLength === 0 || input.candidateBytes.byteLength > 1_048_576 || input.trustRootBytes.byteLength > 1_048_576) {
        throw new ContractViolation("revocation_metadata_invalid", "Revocation metadata exceeds its accepted byte boundary");
      }
      const candidate = RevocationListSchema.parse(JSON.parse(input.candidateBytes.toString("utf8")));
      const trustRoot = TrustRootSchema.parse(JSON.parse(input.trustRootBytes.toString("utf8")));
      this.verify(candidate, trustRoot, input.pinnedRoot);
      const current = await this.cache.readRevocations();
      if (current) assertMonotonicRevocationCandidate(current, candidate);
      const unchanged = current?.payload.sequence === candidate.payload.sequence;
      if (!unchanged) await this.cache.storeVerifiedRevocations(candidate);
      const result: RevocationRefreshResult = { outcome: unchanged ? "unchanged" : "accepted", sequence: candidate.payload.sequence, payload_digest: canonicalInputDigest(candidate.payload), error_code: null };
      this.audit("app.revocation.refresh", { outcome: result.outcome, sequence: result.sequence, payload_digest: result.payload_digest, error_code: null });
      return result;
    } catch (error) {
      const code = error instanceof ContractViolation ? error.code : "revocation_metadata_invalid";
      const current = await this.cache.readRevocations().catch(() => null);
      const result: RevocationRefreshResult = { outcome: "rejected", sequence: current?.payload.sequence ?? null, payload_digest: current ? canonicalInputDigest(current.payload) : null, error_code: code };
      this.audit("app.revocation.refresh", { outcome: "rejected", sequence: result.sequence, payload_digest: result.payload_digest, error_code: code });
      return result;
    }
  }

  async status(packageVersion: string, packageDigest: string, externalStatus: "online" | "offline" = "online"): Promise<RevocationStatus> {
    const current = await this.cache.readRevocations();
    if (!current) return { cache_state: "missing", external_status: externalStatus, sequence: null, age_seconds: null, explicitly_revoked: false, matched_revocation_ids: [] };
    const ageSeconds = Math.max(0, Math.floor((this.clock().getTime() - Date.parse(current.payload.issued_at)) / 1_000));
    const matches = current.payload.entries.filter((entry) => entry.match.kind === "package_digest"
      ? entry.match.package_digest === packageDigest
      : compareSemver(packageVersion, entry.match.version_from_inclusive) >= 0 && compareSemver(packageVersion, entry.match.version_to_inclusive) <= 0);
    return {
      cache_state: ageSeconds > REVOCATION_FRESHNESS_POLICY.stale_after_seconds ? "stale" : "fresh",
      external_status: externalStatus,
      sequence: current.payload.sequence,
      age_seconds: ageSeconds,
      explicitly_revoked: matches.length > 0,
      matched_revocation_ids: matches.map((entry) => entry.revocation_id).sort(),
    };
  }

  async assertAllowed(packageVersion: string, packageDigest: string, options: { requireFresh: boolean; externalStatus?: "online" | "offline" }): Promise<RevocationStatus> {
    const status = await this.status(packageVersion, packageDigest, options.externalStatus ?? "online");
    if (status.explicitly_revoked) throw new ContractViolation("package_revoked", "Package is explicitly revoked");
    if (status.cache_state === "missing" || (options.requireFresh && status.cache_state !== "fresh")) {
      throw new ContractViolation("revocation_metadata_invalid", "Required verified revocation authority is unavailable or stale");
    }
    return status;
  }
}
