import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { z } from "zod";
import { z as zod } from "zod";
import { GenericPackageManifestSchema, CanonicalAppIdSchema, CanonicalPublisherIdSchema } from "../contracts/app-registry.js";
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
export type GenericManifest = z.infer<typeof GenericPackageManifestSchema>;
export type RuntimePackageManifest = Manifest | GenericManifest;
type Trust = z.infer<typeof PackageTrustSchema>;
type PackageTarget = Manifest["platform_artifacts"][number]["target"];

export type VerifiedPackage = {
  manifest: RuntimePackageManifest;
  trust: Trust;
  packageDigest: `sha256:${string}`;
  packageRoot: string;
  entrypoint: string;
  target: PackageTarget;
  runtimeKind: "packaged_node";
  packageReferenceId?: string;
};

export type VerifiedCatalogPackage = Pick<VerifiedPackage, "manifest" | "trust" | "packageDigest" | "target" | "runtimeKind">;

export type ExpectedPackageIdentity = { appId: string; publisherId: string };

const SignatureSchema = zod.object({
  signature_version: zod.literal(1), domain_separator: zod.string(), canonicalization: zod.literal("braindrive-canonical-json-v1"),
  signature_algorithm: zod.literal("ed25519"), signing_key_id: zod.string(), signature: zod.string(),
}).strict();
const GenericPackageDescriptorSchema = zod.object({
  payload: zod.object({
    descriptor_version: zod.literal(2), manifest: GenericPackageManifestSchema,
    manifest_digest: zod.string().regex(/^sha256:[a-f0-9]{64}$/),
    archive: zod.object({ media_type: zod.literal("application/vnd.braindrive.app+zip"), byte_length: zod.number().int().positive().max(67_108_864), digest: zod.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict(),
    published_at: zod.string().datetime(),
  }).strict(), signature: SignatureSchema,
}).strict();
const GenericSourceIndexSchema = zod.object({
  payload: zod.object({
    index_version: zod.literal(2), sequence: zod.number().int().positive(), prior_index_digest: zod.string().nullable(), published_at: zod.string().datetime(),
    entries: zod.array(zod.object({
      app_id: CanonicalAppIdSchema, publisher_id: CanonicalPublisherIdSchema, package_version: zod.string(),
      descriptor_digest: zod.string().regex(/^sha256:[a-f0-9]{64}$/), archive_digest: zod.string().regex(/^sha256:[a-f0-9]{64}$/),
      targets: zod.array(zod.enum(["docker_linux_x64", "desktop_windows_x64"])), sources: zod.array(zod.object({ environment: zod.string(), kind: zod.string() }).passthrough()),
    }).strict()).min(1),
  }).strict(), signature: SignatureSchema,
}).strict();
const GenericRevocationListSchema = zod.object({
  payload: zod.object({
    revocation_version: zod.literal(2), sequence: zod.number().int().positive(), prior_list_digest: zod.string().nullable(), issued_at: zod.string().datetime(), next_update_at: zod.string().datetime(),
    entries: zod.array(zod.object({ app_id: CanonicalAppIdSchema, publisher_id: CanonicalPublisherIdSchema, match: zod.union([zod.object({ kind: zod.literal("package_digest"), package_digest: zod.string() }).strict(), zod.object({ kind: zod.literal("version_range"), version_from_inclusive: zod.string(), version_to_inclusive: zod.string() }).strict()]) }).passthrough()),
  }).strict(), signature: SignatureSchema,
}).strict();

export function manifestCapabilities(manifest: RuntimePackageManifest): Manifest["requested_capabilities"] {
  return manifest.manifest_version === 2
    ? manifest.requested_capabilities.map((request) => request.name) as Manifest["requested_capabilities"]
    : manifest.requested_capabilities;
}

export function manifestDataCompatibility(manifest: RuntimePackageManifest): Manifest["compatibility"]["data_schema"] {
  return manifest.manifest_version === 2
    ? { read_min: manifest.compatibility.data_contract_version, read_max: manifest.compatibility.data_contract_version, write_version: manifest.compatibility.data_contract_version }
    : manifest.compatibility.data_schema;
}

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
    expectedIdentity: ExpectedPackageIdentity = { appId: "ai.braindrive.resume-builder", publisherId: "ai.braindrive" },
  ): Promise<VerifiedPackage> {
    return this.verify(repository, version, destination, context, expectedIdentity, true);
  }

  async verifyForCatalog(
    repository: FixtureRepository,
    version: string,
    expectedIdentity: ExpectedPackageIdentity,
  ): Promise<VerifiedCatalogPackage> {
    const verified = await this.verify(repository, version, "", "candidate_install_or_update", expectedIdentity, false);
    return {
      manifest: verified.manifest,
      trust: verified.trust,
      packageDigest: verified.packageDigest,
      target: verified.target,
      runtimeKind: verified.runtimeKind,
    };
  }

  private async verify(
    repository: FixtureRepository,
    version: string,
    destination: string,
    context: "candidate_install_or_update" | "verified_local_recheck",
    expectedIdentity: ExpectedPackageIdentity,
    extract: boolean,
  ): Promise<VerifiedPackage> {
    try {
      const packageKey = `${expectedIdentity.appId}@${version}`;
      const authority = repository.authoritiesByAppVersion
        ? repository.authoritiesByAppVersion[packageKey]
        : repository.authoritiesByVersion?.[version] ?? repository;
      const packagePaths = repository.packagesByAppVersion
        ? repository.packagesByAppVersion[packageKey]
        : repository.packages[version];
      if (!authority || !packagePaths) throw new AppPlatformError("package_not_found", "Requested fixture package is unavailable", 404);
      const trustRoot = TrustRootSchema.parse(JSON.parse(await readFile(authority.trustRootPath, "utf8")));
      let sourceIndex: z.infer<typeof PackageSourceIndexSchema> | z.infer<typeof GenericSourceIndexSchema>;
      try {
        const candidate = JSON.parse(await readFile(authority.sourceIndexPath, "utf8"));
        sourceIndex = candidate?.payload?.index_version === 2 ? GenericSourceIndexSchema.parse(candidate) : PackageSourceIndexSchema.parse(candidate);
      }
      catch { throw new AppPlatformError("source_index_signature_invalid", "Package source index is malformed or untrusted"); }
      let sourceKey: ReturnType<typeof resolveAuthorizedReleaseKey>;
      try { sourceKey = resolveAuthorizedReleaseKey(trustRoot, sourceIndex.signature.signing_key_id, sourceIndex.payload.published_at); assertDetachedEnvelopeSignature(sourceKey.public_key, sourceIndex.signature, sourceIndex.payload); }
      catch { throw new AppPlatformError("source_index_signature_invalid", "Package source index signature is invalid"); }
      const source = sourceIndex.payload.entries.find((entry) => entry.app_id === expectedIdentity.appId && entry.publisher_id === expectedIdentity.publisherId && entry.package_version === version);
      if (!source) throw new AppPlatformError("package_not_found", "Requested fixture package is unavailable", 404);
      if (!source.targets.some((target) => target === this.target)) throw new AppPlatformError("host_incompatible", "Package source does not authorize this host target");

      let descriptor: z.infer<typeof PackageDescriptorSchema> | z.infer<typeof GenericPackageDescriptorSchema>;
      try {
        const candidate = JSON.parse(await readFile(packagePaths.descriptorPath, "utf8"));
        descriptor = candidate?.payload?.descriptor_version === 2 ? GenericPackageDescriptorSchema.parse(candidate) : PackageDescriptorSchema.parse(candidate);
      }
      catch { throw new AppPlatformError("package_signature_invalid", "Package descriptor is malformed or unsigned"); }
      if (canonicalJsonDocumentDigest(descriptor) !== source.descriptor_digest) throw new AppPlatformError("package_signature_invalid", "Package descriptor digest does not match the signed source index");
      let descriptorSigningKey: ReturnType<typeof resolveAuthorizedReleaseKey>;
      try { descriptorSigningKey = resolveAuthorizedReleaseKey(trustRoot, descriptor.signature.signing_key_id, descriptor.payload.published_at); assertDetachedEnvelopeSignature(descriptorSigningKey.public_key, descriptor.signature, descriptor.payload); }
      catch { throw new AppPlatformError("package_signature_invalid", "Package descriptor signature is invalid"); }

      const manifestIdentity = descriptor.payload.manifest;
      if (manifestIdentity.app_id !== source.app_id || manifestIdentity.publisher_id !== source.publisher_id || manifestIdentity.package_version !== source.package_version || manifestIdentity.app_id !== expectedIdentity.appId || manifestIdentity.publisher_id !== expectedIdentity.publisherId) {
        throw new AppPlatformError("package_identity_mismatch", "Package identity does not match the selected first-party registration", 403);
      }
      const archive = await readFile(packagePaths.archivePath);
      const packageDigest = digest(archive);
      if (packageDigest !== descriptor.payload.archive.digest || packageDigest !== source.archive_digest || archive.length !== descriptor.payload.archive.byte_length) {
        throw new AppPlatformError("package_archive_digest_mismatch", "Package archive digest or byte length does not match signed metadata");
      }
      if (compareSemver(this.hostVersion, descriptor.payload.manifest.compatibility.host_min_version) < 0) {
        throw new AppPlatformError("host_incompatible", "Package requires a newer BrainDrive host");
      }

      const revocationCandidate = JSON.parse(await readFile(authority.revocationListPath, "utf8"));
      const revocations = revocationCandidate?.payload?.revocation_version === 2 ? GenericRevocationListSchema.parse(revocationCandidate) : RevocationListSchema.parse(revocationCandidate);
      const revocationKey = resolveAuthorizedReleaseKey(trustRoot, revocations.signature.signing_key_id, revocations.payload.issued_at);
      try { assertDetachedEnvelopeSignature(revocationKey.public_key, revocations.signature, revocations.payload); }
      catch { throw new AppPlatformError("revocation_signature_invalid", "Revocation list signature is invalid"); }
      const revoked = revocations.payload.entries.some((entry) => {
        if (entry.app_id !== expectedIdentity.appId || entry.publisher_id !== expectedIdentity.publisherId) return false;
        const match = entry.match;
        return match.kind === "package_digest" ? match.package_digest === packageDigest
          : compareSemver(version, match.version_from_inclusive) >= 0 && compareSemver(version, match.version_to_inclusive) <= 0;
      });
      if (revoked) throw new AppPlatformError("package_revoked", "Package is explicitly revoked");

      const entries = readStoredZip(archive);
      const manifestEntry = entries.find((entry) => entry.name === "manifest.json");
      if (!manifestEntry) throw new AppPlatformError("package_manifest_invalid", "Package manifest is missing");
      const manifestCandidate = JSON.parse(manifestEntry.bytes.toString("utf8"));
      const manifest: RuntimePackageManifest = manifestCandidate?.manifest_version === 2 ? GenericPackageManifestSchema.parse(manifestCandidate) : PackageManifestSchema.parse(manifestCandidate);
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

      if (extract) {
        await rm(destination, { recursive: true, force: true });
        await mkdir(destination, { recursive: true });
        const storedManifestPath = path.join(destination, ...manifest.archive.manifest_path.split("/"));
        if (!path.resolve(storedManifestPath).startsWith(`${path.resolve(destination)}${path.sep}`)) {
          throw new AppPlatformError("package_path_invalid", "Package manifest path escaped the staging root");
        }
        await mkdir(path.dirname(storedManifestPath), { recursive: true });
        await writeFile(storedManifestPath, manifestEntry.bytes, { mode: 0o400 });
        for (const entry of payloadEntries) {
          const file = declared.get(entry.name)!;
          const target = path.join(destination, ...entry.name.split("/"));
          if (!path.resolve(target).startsWith(`${path.resolve(destination)}${path.sep}`)) throw new AppPlatformError("package_path_invalid", "Package path escaped the staging root");
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, entry.bytes, { mode: file.mode === "executable" ? 0o500 : 0o400 });
        }
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
