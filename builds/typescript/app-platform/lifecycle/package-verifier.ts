import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { z } from "zod";
import { canonicalJson, canonicalJsonDocumentDigest } from "../contracts/common.js";
import {
  assertDetachedEnvelopeSignature,
  PackageDescriptorSchema,
  PackageManifestSchema,
  PackageSourceIndexSchema,
  PackageTrustSchema,
  resolveAuthorizedReleaseKey,
  RevocationListSchema,
  TrustRootSchema,
} from "../contracts/package.js";
import { AppPlatformError } from "./errors.js";
import type { FixtureRepository } from "./fixture-repository.js";
import { readStoredZip } from "./zip.js";

type Manifest = z.infer<typeof PackageManifestSchema>;
type Trust = z.infer<typeof PackageTrustSchema>;
type PackageTarget = Manifest["platform_artifacts"][number]["target"];

export type VerifiedPackage = {
  manifest: Manifest;
  trust: Trust;
  packageDigest: `sha256:${string}`;
  packageRoot: string;
  entrypoint: string;
  target: PackageTarget;
  runtimeKind: "packaged_node";
};

function digest(bytes: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function compareSemver(left: string, right: string): number {
  const a = left.split("-")[0].split(".").map(Number);
  const b = right.split("-")[0].split(".").map(Number);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

export class PackageVerifier {
  constructor(
    private readonly hostVersion: string,
    private readonly target: string = "docker_linux_x64",
  ) {}

  async verifyAndExtract(
    repository: FixtureRepository,
    version: string,
    destination: string,
    context: "candidate_install_or_update" | "verified_local_recheck",
  ): Promise<VerifiedPackage> {
    try {
      const authority = repository.authoritiesByVersion?.[version] ?? repository;
      const trustRoot = TrustRootSchema.parse(JSON.parse(await readFile(authority.trustRootPath, "utf8")));
      let sourceIndex: z.infer<typeof PackageSourceIndexSchema>;
      try { sourceIndex = PackageSourceIndexSchema.parse(JSON.parse(await readFile(authority.sourceIndexPath, "utf8"))); }
      catch { throw new AppPlatformError("source_index_signature_invalid", "Package source index is malformed or untrusted"); }
      let sourceKey: ReturnType<typeof resolveAuthorizedReleaseKey>;
      try { sourceKey = resolveAuthorizedReleaseKey(trustRoot, sourceIndex.signature.signing_key_id, sourceIndex.payload.published_at); assertDetachedEnvelopeSignature(sourceKey.public_key, sourceIndex.signature, sourceIndex.payload); }
      catch { throw new AppPlatformError("source_index_signature_invalid", "Package source index signature is invalid"); }
      const source = sourceIndex.payload.entries.find((entry) => entry.package_version === version);
      if (!source || !repository.packages[version]) throw new AppPlatformError("package_not_found", "Requested fixture package is unavailable", 404);
      if (!source.targets.some((target) => target === this.target)) throw new AppPlatformError("host_incompatible", "Package source does not authorize this host target");

      let descriptor: z.infer<typeof PackageDescriptorSchema>;
      try { descriptor = PackageDescriptorSchema.parse(JSON.parse(await readFile(repository.packages[version].descriptorPath, "utf8"))); }
      catch { throw new AppPlatformError("package_signature_invalid", "Package descriptor is malformed or unsigned"); }
      if (canonicalJsonDocumentDigest(descriptor) !== source.descriptor_digest) throw new AppPlatformError("package_signature_invalid", "Package descriptor digest does not match the signed source index");
      let packageKey: ReturnType<typeof resolveAuthorizedReleaseKey>;
      try { packageKey = resolveAuthorizedReleaseKey(trustRoot, descriptor.signature.signing_key_id, descriptor.payload.published_at); assertDetachedEnvelopeSignature(packageKey.public_key, descriptor.signature, descriptor.payload); }
      catch { throw new AppPlatformError("package_signature_invalid", "Package descriptor signature is invalid"); }

      const archive = await readFile(repository.packages[version].archivePath);
      const packageDigest = digest(archive);
      if (packageDigest !== descriptor.payload.archive.digest || packageDigest !== source.archive_digest || archive.length !== descriptor.payload.archive.byte_length) {
        throw new AppPlatformError("package_archive_digest_mismatch", "Package archive digest or byte length does not match signed metadata");
      }
      if (compareSemver(this.hostVersion, descriptor.payload.manifest.compatibility.host_min_version) < 0) {
        throw new AppPlatformError("host_incompatible", "Package requires a newer BrainDrive host");
      }

      const revocations = RevocationListSchema.parse(JSON.parse(await readFile(authority.revocationListPath, "utf8")));
      const revocationKey = resolveAuthorizedReleaseKey(trustRoot, revocations.signature.signing_key_id, revocations.payload.issued_at);
      try { assertDetachedEnvelopeSignature(revocationKey.public_key, revocations.signature, revocations.payload); }
      catch { throw new AppPlatformError("revocation_signature_invalid", "Revocation list signature is invalid"); }
      const revoked = revocations.payload.entries.some((entry) => {
        const match = entry.match;
        return match.kind === "package_digest" ? match.package_digest === packageDigest
          : compareSemver(version, match.version_from_inclusive) >= 0 && compareSemver(version, match.version_to_inclusive) <= 0;
      });
      if (revoked) throw new AppPlatformError("package_revoked", "Package is explicitly revoked");

      const entries = readStoredZip(archive);
      const manifestEntry = entries.find((entry) => entry.name === "manifest.json");
      if (!manifestEntry) throw new AppPlatformError("package_manifest_invalid", "Package manifest is missing");
      const manifest = PackageManifestSchema.parse(JSON.parse(manifestEntry.bytes.toString("utf8")));
      if (manifestEntry.bytes.toString("utf8") !== `${canonicalJson(manifest)}\n` || canonicalJsonDocumentDigest(manifest) !== descriptor.payload.manifest_digest || canonicalJson(manifest) !== canonicalJson(descriptor.payload.manifest)) {
        throw new AppPlatformError("package_manifest_invalid", "Package manifest is not the signed canonical document");
      }
      const platformArtifact = manifest.platform_artifacts.find((artifact) => artifact.target === this.target);
      if (!platformArtifact) throw new AppPlatformError("host_incompatible", "Package does not contain a compatible host artifact");
      const declared = new Map(manifest.files.map((file) => [file.path, file]));
      const payloadEntries = entries.filter((entry) => entry.name !== "manifest.json");
      if (payloadEntries.length !== declared.size) throw new AppPlatformError("package_inventory_invalid", "Package contains undeclared or missing entries");
      for (const entry of payloadEntries) {
        const file = declared.get(entry.name);
        if (!file || file.size_bytes !== entry.bytes.length || file.digest !== digest(entry.bytes)) throw new AppPlatformError("package_inventory_invalid", "Package file inventory does not match signed metadata");
      }

      await rm(destination, { recursive: true, force: true });
      await mkdir(destination, { recursive: true });
      for (const entry of payloadEntries) {
        const file = declared.get(entry.name)!;
        const target = path.join(destination, ...entry.name.split("/"));
        if (!path.resolve(target).startsWith(`${path.resolve(destination)}${path.sep}`)) throw new AppPlatformError("package_path_invalid", "Package path escaped the staging root");
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, entry.bytes, { mode: file.mode === "executable" ? 0o500 : 0o400 });
      }
      const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(revocations.payload.issued_at)) / 1000));
      const stale = ageSeconds > 86_400;
      if (stale && context === "candidate_install_or_update") throw new AppPlatformError("revocation_metadata_stale", "Fresh revocation metadata is required for a candidate package");
      const trust = PackageTrustSchema.parse({
        trust_policy_version: 1, descriptor_digest: canonicalJsonDocumentDigest(descriptor), package_digest: packageDigest,
        manifest_digest: descriptor.payload.manifest_digest, publisher_id: manifest.publisher_id, signing_key_id: descriptor.signature.signing_key_id,
        trust_root_version: 1, source_index_sequence: sourceIndex.payload.sequence, source_index_signature_valid: true, package_signature_valid: true,
        archive_digest_valid: true, file_inventory_valid: true, source_trusted: true, compatibility_valid: true,
        revocation_list_sequence: revocations.payload.sequence, revocation_status: stale ? "not_revoked_stale" : "not_revoked_fresh", revocation_age_seconds: ageSeconds,
        verification_context: context, checked_at: new Date().toISOString(), executable_allowed: !stale || context === "verified_local_recheck",
      });
      return {
        manifest,
        trust,
        packageDigest,
        packageRoot: destination,
        entrypoint: path.join(destination, ...platformArtifact.entrypoint.split("/")),
        target: platformArtifact.target,
        runtimeKind: platformArtifact.runtime_kind,
      };
    } catch (error) {
      if (error instanceof AppPlatformError) throw error;
      throw new AppPlatformError("package_verification_failed", error instanceof Error ? error.message : "Package verification failed");
    }
  }
}
