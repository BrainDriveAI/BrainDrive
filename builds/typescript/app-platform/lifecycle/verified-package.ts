import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  canonicalJson,
  canonicalJsonDocumentDigest,
  Sha256DigestSchema,
} from "../contracts/common.js";
import { ContractViolation } from "../contracts/errors.js";
import {
  assertArchiveEntrySet,
  assertDetachedEnvelopeSignature,
  assertMonotonicRevocationCandidate,
  assertMonotonicSourceIndexCandidate,
  assertPackageCompatibility,
  assertPackageTrustAllowsExecution,
  PackageDescriptorSchema,
  PackageManifestSchema,
  PackageSourceIndexSchema,
  PackageTrustSchema,
  resolveAuthorizedReleaseKey,
  RevocationListSchema,
  TrustRootSchema,
  type CapabilityNameSchema,
} from "../contracts/package.js";
import type { VerifiedPackageAuthorityCache } from "./verified-feed-cache.js";

type Manifest = z.infer<typeof PackageManifestSchema>;
type SourceIndex = z.infer<typeof PackageSourceIndexSchema>;
type Revocations = z.infer<typeof RevocationListSchema>;
type Target = Manifest["platform_artifacts"][number]["target"];

const MAX_METADATA_BYTES = 1_048_576;
const MAX_ARCHIVE_BYTES = 67_108_864;
const MAX_ENTRY_BYTES = 67_108_864;
const MAX_ENTRY_COUNT = 256;

const PreverifiedDescriptorEnvelopeSchema = z.object({
  payload: z.object({
    published_at: z.string(),
    archive: z.object({
      media_type: z.literal("application/vnd.braindrive.app+zip"),
      byte_length: z.number().int().positive().max(MAX_ARCHIVE_BYTES),
      digest: Sha256DigestSchema,
    }).passthrough(),
  }).passthrough(),
  signature: z.object({
    signature_version: z.literal(1),
    domain_separator: z.literal("BrainDrive-App-Package-v1"),
    canonicalization: z.literal("braindrive-canonical-json-v1"),
    signature_algorithm: z.literal("ed25519"),
    signing_key_id: z.string().regex(/^braindrive-app-release-[A-Za-z0-9-]{4,64}$/),
    signature: z.string(),
  }).passthrough(),
}).passthrough();

export type PackageSourceReference =
  | { kind: "repository_fixture"; fixtureId: string }
  | { kind: "release_https"; url: string };

export interface BoundedPackageTransport {
  read(reference: PackageSourceReference, limitBytes: number): Promise<Buffer>;
}

export type VerificationStep =
  | "source_allowlist"
  | "source_signature"
  | "source_monotonicity"
  | "download"
  | "package_signature"
  | "archive_digest"
  | "manifest_schema"
  | "archive_safety"
  | "file_inventory"
  | "compatibility"
  | "revocation"
  | "staged";

export type PackageVerificationDiagnostic = {
  event: "app.package.verify";
  step: VerificationStep;
  outcome: "passed" | "failed";
  errorCode: string | null;
};

export type PackageInspection = {
  inspectionVersion: 1;
  identity: {
    appId: Manifest["app_id"];
    publisherId: Manifest["publisher_id"];
    displayName: Manifest["display_name"];
    packageVersion: string;
    packageDigest: `sha256:${string}`;
  };
  trust: {
    policyVersion: 1;
    signingKeyId: string;
    trustRootVersion: 1;
    sourceIndexSequence: number;
    revocationSequence: number;
    revocationStatus: "not_revoked_fresh";
  };
  source: {
    environment: "docker_dev" | "desktop_windows" | "desktop_macos";
    kind: "repository_fixture" | "release_https";
    sourceId: string;
  };
  compatibility: Manifest["compatibility"] & { selectedTarget: Target };
  capabilities: Manifest["requested_capabilities"];
  retention: Manifest["retention_policy"];
  evidence: {
    provenanceDigest: `sha256:${string}`;
    sbomDigest: `sha256:${string}`;
  };
};

export type VerifiedPackage = {
  manifest: Manifest;
  packageDigest: `sha256:${string}`;
  descriptorDigest: `sha256:${string}`;
  stageRoot: string;
  entrypoint: string;
  target: Target;
  inspection: PackageInspection;
  trust: z.infer<typeof PackageTrustSchema>;
};

export type VerifyPackageRequest = {
  version: string;
  environment: "docker_dev" | "desktop_windows" | "desktop_macos";
  target: Target;
  hostVersion: string;
  supportedCapabilities: readonly z.infer<typeof CapabilityNameSchema>[];
  stagingRoot: string;
  trustRootBytes: Buffer;
  pinnedRoot: { keyId: string; publicKey: string };
  sourceIndexBytes: Buffer;
  cachedSourceIndex?: SourceIndex;
  revocationBytes: Buffer;
  cachedRevocations?: Revocations;
};

type ArchiveEntry = {
  path: string;
  bytes: Buffer;
  executable: boolean;
};

function digest(bytes: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function boundedJson(bytes: Buffer, maximum: number, code: "package_source_untrusted" | "package_descriptor_invalid" | "revocation_metadata_invalid"): unknown {
  if (bytes.byteLength === 0 || bytes.byteLength > maximum) {
    throw new ContractViolation(code, "Signed metadata exceeds its accepted byte boundary");
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ContractViolation(code, "Signed metadata is malformed");
  }
}

function parseStrict<T>(schema: z.ZodType<T>, value: unknown, code: "package_source_untrusted" | "package_descriptor_invalid" | "revocation_metadata_invalid", message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ContractViolation(code, message);
  return result.data;
}

function crc32(bytes: Buffer): number {
  const table = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Strict reader for the accepted stored-ZIP profile. It never extracts. */
export function inspectStoredPackageArchive(archive: Buffer): ArchiveEntry[] {
  if (archive.byteLength === 0 || archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new ContractViolation("package_oversize", "Package archive exceeds the accepted byte ceiling");
  }
  if (archive.byteLength < 22) throw new ContractViolation("package_archive_invalid", "Package archive is incomplete");
  const eocdOffset = archive.byteLength - 22;
  if (archive.readUInt32LE(eocdOffset) !== 0x06054b50 || archive.readUInt16LE(eocdOffset + 20) !== 0) {
    throw new ContractViolation("package_archive_invalid", "Package archive has a non-canonical end record");
  }
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  const centralOffset = archive.readUInt32LE(eocdOffset + 16);
  if (
    entryCount === 0
    || entryCount > MAX_ENTRY_COUNT
    || archive.readUInt16LE(eocdOffset + 8) !== entryCount
    || centralOffset + centralSize !== eocdOffset
  ) {
    throw new ContractViolation("package_archive_invalid", "Package archive directory is inconsistent");
  }

  const local: Array<ArchiveEntry & { crc: number; offset: number }> = [];
  let offset = 0;
  while (offset < centralOffset) {
    if (local.length >= entryCount || offset + 30 > centralOffset || archive.readUInt32LE(offset) !== 0x04034b50) {
      throw new ContractViolation("package_archive_invalid", "Package archive local entry is invalid");
    }
    const flags = archive.readUInt16LE(offset + 6);
    const method = archive.readUInt16LE(offset + 8);
    const crc = archive.readUInt32LE(offset + 14);
    const compressed = archive.readUInt32LE(offset + 18);
    const uncompressed = archive.readUInt32LE(offset + 22);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    if (flags !== 0x0800 || method !== 0 || compressed !== uncompressed || compressed > MAX_ENTRY_BYTES || extraLength !== 0) {
      throw new ContractViolation("package_archive_invalid", "Package archive violates the stored-ZIP profile");
    }
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength;
    const dataEnd = dataStart + compressed;
    if (nameLength === 0 || dataEnd > centralOffset) {
      throw new ContractViolation("package_archive_invalid", "Package archive entry exceeds its boundary");
    }
    const entryPath = archive.subarray(nameStart, dataStart).toString("utf8");
    const bytes = Buffer.from(archive.subarray(dataStart, dataEnd));
    if (crc32(bytes) !== crc) throw new ContractViolation("package_archive_invalid", "Package archive CRC is invalid");
    local.push({ path: entryPath, bytes, executable: false, crc, offset });
    offset = dataEnd;
  }
  if (local.length !== entryCount) throw new ContractViolation("package_archive_invalid", "Package archive entry count is inconsistent");

  let centralCursor = centralOffset;
  const archiveContracts: unknown[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (centralCursor + 46 > eocdOffset || archive.readUInt32LE(centralCursor) !== 0x02014b50) {
      throw new ContractViolation("package_archive_invalid", "Package archive central entry is invalid");
    }
    const flags = archive.readUInt16LE(centralCursor + 8);
    const method = archive.readUInt16LE(centralCursor + 10);
    const crc = archive.readUInt32LE(centralCursor + 16);
    const compressed = archive.readUInt32LE(centralCursor + 20);
    const uncompressed = archive.readUInt32LE(centralCursor + 24);
    const nameLength = archive.readUInt16LE(centralCursor + 28);
    const extraLength = archive.readUInt16LE(centralCursor + 30);
    const commentLength = archive.readUInt16LE(centralCursor + 32);
    const disk = archive.readUInt16LE(centralCursor + 34);
    const externalMode = archive.readUInt32LE(centralCursor + 38) >>> 16;
    const localOffset = archive.readUInt32LE(centralCursor + 42);
    const nameStart = centralCursor + 46;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > eocdOffset || flags !== 0x0800 || method !== 0 || compressed !== uncompressed || extraLength !== 0 || commentLength !== 0 || disk !== 0) {
      throw new ContractViolation("package_archive_invalid", "Package archive central metadata is non-canonical");
    }
    const fileType = externalMode & 0o170000;
    if (fileType !== 0o100000) {
      throw new ContractViolation("package_unsafe_link", "Package archive links and device entries are prohibited");
    }
    const entryPath = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const localEntry = local[index];
    if (
      entryPath !== localEntry.path
      || localOffset !== localEntry.offset
      || compressed !== localEntry.bytes.byteLength
      || crc !== localEntry.crc
    ) {
      throw new ContractViolation("package_archive_invalid", "Package archive directory disagrees with local entries");
    }
    const executable = (externalMode & 0o111) !== 0;
    localEntry.executable = executable;
    archiveContracts.push({
      archive_entry_version: 1,
      path: entryPath,
      entry_type: "file",
      mode: executable ? "executable" : "read_only",
      compressed_size_bytes: compressed,
      uncompressed_size_bytes: uncompressed,
      crc32: crc.toString(16).padStart(8, "0"),
    });
    centralCursor = next;
  }
  if (centralCursor !== eocdOffset) throw new ContractViolation("package_archive_invalid", "Package archive central directory has trailing data");
  assertArchiveEntrySet(archiveContracts);
  return local;
}

function parseProvenance(bytes: Buffer): void {
  const lines = bytes.toString("utf8").trim().split("\n");
  if (lines.length === 0 || lines.some((line) => {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      return typeof value.builder !== "string" || typeof value.version !== "string" || typeof value.source !== "string";
    } catch { return true; }
  })) throw new ContractViolation("package_file_mismatch", "Package provenance evidence is invalid");
}

function parseSbom(bytes: Buffer): void {
  try {
    const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    if (value.bomFormat !== "CycloneDX" || typeof value.specVersion !== "string" || !Array.isArray(value.components)) throw new Error("invalid");
  } catch {
    throw new ContractViolation("package_file_mismatch", "Package SBOM evidence is invalid");
  }
}

export function assertPackageNotRevoked(revocations: Revocations, manifest: Manifest, packageDigest: string): void {
  const compare = (left: string, right: string) => {
    const a = left.split("-")[0].split(".").map(Number);
    const b = right.split("-")[0].split(".").map(Number);
    for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
    return 0;
  };
  const revoked = revocations.payload.entries.some((entry) => entry.match.kind === "package_digest"
    ? entry.match.package_digest === packageDigest
    : compare(manifest.package_version, entry.match.version_from_inclusive) >= 0
      && compare(manifest.package_version, entry.match.version_to_inclusive) <= 0);
  if (revoked) throw new ContractViolation("package_revoked", "Package is explicitly revoked");
}

export class VerifiedPackageVerifier {
  constructor(
    private readonly transport: BoundedPackageTransport,
    private readonly clock: () => Date = () => new Date(),
    private readonly diagnostic?: (event: PackageVerificationDiagnostic) => void,
    private readonly authorityCache?: VerifiedPackageAuthorityCache,
  ) {}

  async verify(request: VerifyPackageRequest): Promise<VerifiedPackage> {
    let step: VerificationStep = "source_allowlist";
    const passed = (value: VerificationStep) => this.diagnostic?.({ event: "app.package.verify", step: value, outcome: "passed", errorCode: null });
    try {
      if (!(["docker_dev", "desktop_windows", "desktop_macos"] as const).includes(request.environment) || !(["docker_linux_x64", "desktop_windows_x64", "desktop_macos_universal"] as const).includes(request.target)) {
        throw new ContractViolation("package_source_untrusted", "Package environment or target is outside the source allowlist");
      }
      const trustRoot = parseStrict(TrustRootSchema, boundedJson(request.trustRootBytes, MAX_METADATA_BYTES, "package_source_untrusted"), "package_source_untrusted", "Package trust root violates its strict schema");
      if (trustRoot.root_key.key_id !== request.pinnedRoot.keyId || trustRoot.root_key.public_key !== request.pinnedRoot.publicKey) {
        throw new ContractViolation("package_source_untrusted", "Package trust root does not match the pinned authority");
      }
      passed(step);

      step = "source_signature";
      const sourceIndex = parseStrict(PackageSourceIndexSchema, boundedJson(request.sourceIndexBytes, MAX_METADATA_BYTES, "package_source_untrusted"), "package_source_untrusted", "Package source index violates its strict schema");
      const indexKey = resolveAuthorizedReleaseKey(trustRoot, sourceIndex.signature.signing_key_id, sourceIndex.payload.published_at);
      try {
        assertDetachedEnvelopeSignature(indexKey.public_key, sourceIndex.signature, sourceIndex.payload);
      } catch {
        throw new ContractViolation("package_source_untrusted", "Package source index signature is invalid");
      }
      passed(step);

      step = "source_monotonicity";
      const cachedSourceIndex = request.cachedSourceIndex ?? await this.authorityCache?.readSourceIndex() ?? undefined;
      if (cachedSourceIndex) assertMonotonicSourceIndexCandidate(parseStrict(PackageSourceIndexSchema, cachedSourceIndex, "package_source_untrusted", "Cached package source index violates its strict schema"), sourceIndex);
      const selected = sourceIndex.payload.entries.find((entry) => entry.package_version === request.version);
      if (!selected || !selected.targets.includes(request.target)) {
        throw new ContractViolation("incompatible_version", "Signed source index does not contain the requested package target");
      }
      const source = selected.sources.find((candidate) => candidate.environment === request.environment);
      if (!source) throw new ContractViolation("package_source_untrusted", "Requested package source is not allowlisted");
      passed(step);

      step = "download";
      const descriptorReference: PackageSourceReference = source.kind === "repository_fixture"
        ? { kind: source.kind, fixtureId: source.descriptor_fixture_id }
        : { kind: source.kind, url: source.descriptor_url };
      const archiveReference: PackageSourceReference = source.kind === "repository_fixture"
        ? { kind: source.kind, fixtureId: source.archive_fixture_id }
        : { kind: source.kind, url: source.archive_url };
      const descriptorBytes = await this.transport.read(descriptorReference, MAX_METADATA_BYTES);
      if (descriptorBytes.byteLength === 0 || descriptorBytes.byteLength > MAX_METADATA_BYTES) {
        throw new ContractViolation("package_oversize", "Package descriptor exceeds its accepted byte boundary");
      }
      const archive = await this.transport.read(archiveReference, MAX_ARCHIVE_BYTES);
      if (archive.byteLength === 0 || archive.byteLength > MAX_ARCHIVE_BYTES) {
        throw new ContractViolation("package_oversize", "Package archive exceeds its accepted byte boundary");
      }
      passed(step);

      step = "package_signature";
      const descriptorCandidate = boundedJson(descriptorBytes, MAX_METADATA_BYTES, "package_descriptor_invalid");
      const envelope = parseStrict(PreverifiedDescriptorEnvelopeSchema, descriptorCandidate, "package_descriptor_invalid", "Package signature envelope is malformed");
      if (canonicalJsonDocumentDigest(descriptorCandidate) !== selected.descriptor_digest) {
        throw new ContractViolation("package_signature_invalid", "Package descriptor does not match the signed index");
      }
      const descriptorKey = resolveAuthorizedReleaseKey(trustRoot, envelope.signature.signing_key_id, envelope.payload.published_at);
      assertDetachedEnvelopeSignature(descriptorKey.public_key, envelope.signature, envelope.payload);
      passed(step);

      step = "archive_digest";
      const packageDigest = digest(archive);
      if (
        packageDigest !== selected.archive_digest
        || packageDigest !== envelope.payload.archive.digest
        || archive.byteLength !== envelope.payload.archive.byte_length
      ) throw new ContractViolation("package_digest_mismatch", "Package archive does not match signed authority");
      passed(step);

      step = "manifest_schema";
      const descriptor = parseStrict(PackageDescriptorSchema, descriptorCandidate, "package_descriptor_invalid", "Package descriptor or manifest violates its strict schema");
      const manifest = parseStrict(PackageManifestSchema, descriptor.payload.manifest, "package_descriptor_invalid", "Package manifest violates its strict schema");
      if (canonicalJsonDocumentDigest(manifest) !== descriptor.payload.manifest_digest) {
        throw new ContractViolation("package_descriptor_invalid", "Package manifest digest does not match the descriptor");
      }
      passed(step);

      step = "archive_safety";
      const entries = inspectStoredPackageArchive(archive);
      const manifestEntry = entries.find((entry) => entry.path === manifest.archive.manifest_path);
      if (!manifestEntry || manifestEntry.executable || manifestEntry.bytes.toString("utf8") !== `${canonicalJson(manifest)}\n`) {
        throw new ContractViolation("package_file_mismatch", "Canonical package manifest entry is missing or altered");
      }
      passed(step);

      step = "file_inventory";
      const expected = new Map(manifest.files.map((file) => [file.path, file]));
      const payloadEntries = entries.filter((entry) => entry.path !== manifest.archive.manifest_path);
      if (payloadEntries.length !== expected.size) throw new ContractViolation("package_file_mismatch", "Package inventory is incomplete");
      for (const entry of payloadEntries) {
        const file = expected.get(entry.path);
        if (!file || file.size_bytes !== entry.bytes.byteLength || file.digest !== digest(entry.bytes) || (file.mode === "executable") !== entry.executable) {
          throw new ContractViolation("package_file_mismatch", "Package file does not match the signed inventory");
        }
      }
      const selectedArtifact = manifest.platform_artifacts.find((artifact) => artifact.target === request.target);
      if (!selectedArtifact || expected.get(selectedArtifact.entrypoint)?.mode !== "executable") {
        throw new ContractViolation("package_file_mismatch", "Selected package entrypoint is not declared executable authority");
      }
      const provenance = payloadEntries.find((entry) => entry.path === manifest.provenance_path);
      const sbom = payloadEntries.find((entry) => entry.path === manifest.sbom_path);
      if (!provenance || !sbom) throw new ContractViolation("package_file_mismatch", "Package provenance or SBOM is missing");
      parseProvenance(provenance.bytes);
      parseSbom(sbom.bytes);
      passed(step);

      step = "compatibility";
      assertPackageCompatibility(manifest, request.hostVersion, request.target);
      const supported = new Set(request.supportedCapabilities);
      if (manifest.requested_capabilities.some((capability) => !supported.has(capability))) {
        throw new ContractViolation("widened_grant", "Package requests an unsupported host capability");
      }
      passed(step);

      step = "revocation";
      const revocations = parseStrict(RevocationListSchema, boundedJson(request.revocationBytes, MAX_METADATA_BYTES, "revocation_metadata_invalid"), "revocation_metadata_invalid", "Revocation metadata violates its strict schema");
      const revocationKey = resolveAuthorizedReleaseKey(trustRoot, revocations.signature.signing_key_id, revocations.payload.issued_at);
      try {
        assertDetachedEnvelopeSignature(revocationKey.public_key, revocations.signature, revocations.payload);
      } catch {
        throw new ContractViolation("revocation_metadata_invalid", "Revocation metadata signature is invalid");
      }
      const cachedRevocations = request.cachedRevocations ?? await this.authorityCache?.readRevocations() ?? undefined;
      if (cachedRevocations) assertMonotonicRevocationCandidate(parseStrict(RevocationListSchema, cachedRevocations, "revocation_metadata_invalid", "Cached revocation metadata violates its strict schema"), revocations);
      assertPackageNotRevoked(revocations, manifest, packageDigest);
      const ageSeconds = Math.max(0, Math.floor((this.clock().getTime() - Date.parse(revocations.payload.issued_at)) / 1_000));
      if (ageSeconds > 86_400) throw new ContractViolation("revocation_metadata_invalid", "Fresh revocation authority is required for installation");
      const trust = PackageTrustSchema.parse({
        trust_policy_version: 1,
        descriptor_digest: canonicalJsonDocumentDigest(descriptor),
        package_digest: packageDigest,
        manifest_digest: descriptor.payload.manifest_digest,
        publisher_id: manifest.publisher_id,
        signing_key_id: descriptor.signature.signing_key_id,
        trust_root_version: 1,
        source_index_sequence: sourceIndex.payload.sequence,
        source_index_signature_valid: true,
        package_signature_valid: true,
        archive_digest_valid: true,
        file_inventory_valid: true,
        source_trusted: true,
        compatibility_valid: true,
        revocation_list_sequence: revocations.payload.sequence,
        revocation_status: "not_revoked_fresh",
        revocation_age_seconds: ageSeconds,
        verification_context: "candidate_install_or_update",
        checked_at: this.clock().toISOString(),
        executable_allowed: true,
      });
      assertPackageTrustAllowsExecution(trust);
      await this.authorityCache?.storeVerified(sourceIndex, revocations);
      passed(step);

      step = "staged";
      await mkdir(request.stagingRoot, { recursive: true, mode: 0o700 });
      const stageRoot = await mkdtemp(path.join(request.stagingRoot, "verify-"));
      await chmod(stageRoot, 0o700);
      try {
        for (const entry of entries) {
          const targetPath = path.join(stageRoot, ...entry.path.split("/"));
          if (!path.resolve(targetPath).startsWith(`${path.resolve(stageRoot)}${path.sep}`)) {
            throw new ContractViolation("package_path_invalid", "Package entry escaped the staging root");
          }
          await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
          await writeFile(targetPath, entry.bytes, { mode: 0o400, flag: "wx" });
          await chmod(targetPath, 0o400);
        }
      } catch (error) {
        await rm(stageRoot, { recursive: true, force: true });
        throw error;
      }
      passed(step);
      const sourceId = source.kind === "repository_fixture"
        ? source.archive_fixture_id
        : digest(source.archive_url).slice(7, 39);
      return {
        manifest,
        packageDigest: Sha256DigestSchema.parse(packageDigest) as `sha256:${string}`,
        descriptorDigest: canonicalJsonDocumentDigest(descriptor),
        stageRoot,
        entrypoint: selectedArtifact.entrypoint,
        target: request.target,
        trust,
        inspection: {
          inspectionVersion: 1,
          identity: {
            appId: manifest.app_id,
            publisherId: manifest.publisher_id,
            displayName: manifest.display_name,
            packageVersion: manifest.package_version,
            packageDigest,
          },
          trust: {
            policyVersion: 1,
            signingKeyId: descriptor.signature.signing_key_id,
            trustRootVersion: 1,
            sourceIndexSequence: sourceIndex.payload.sequence,
            revocationSequence: revocations.payload.sequence,
            revocationStatus: "not_revoked_fresh",
          },
          source: { environment: request.environment, kind: source.kind, sourceId },
          compatibility: { ...manifest.compatibility, selectedTarget: request.target },
          capabilities: [...manifest.requested_capabilities],
          retention: manifest.retention_policy,
          evidence: { provenanceDigest: digest(provenance.bytes), sbomDigest: digest(sbom.bytes) },
        },
      };
    } catch (error) {
      const code = error instanceof ContractViolation ? error.code : "recoverable_internal_failure";
      this.diagnostic?.({ event: "app.package.verify", step, outcome: "failed", errorCode: code });
      if (error instanceof ContractViolation) throw error;
      throw new ContractViolation("recoverable_internal_failure", "Package verification failed safely");
    }
  }
}

/** Reads only the accepted first-party HTTPS origin and enforces streaming bounds. */
export class FirstPartyHttpsTransport implements BoundedPackageTransport {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async read(reference: PackageSourceReference, limitBytes: number): Promise<Buffer> {
    if (reference.kind !== "release_https") throw new ContractViolation("package_source_untrusted", "Repository fixtures require an injected fixture transport");
    const url = new URL(reference.url);
    if (url.protocol !== "https:" || url.hostname !== "releases.braindrive.ai" || url.username || url.password || url.hash) {
      throw new ContractViolation("package_source_untrusted", "Package URL is outside the first-party allowlist");
    }
    const response = await this.fetchImpl(url, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) throw new ContractViolation("package_source_untrusted", "Package download failed");
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > limitBytes) throw new ContractViolation("package_oversize", "Package download exceeds its accepted byte boundary");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel();
        throw new ContractViolation("package_oversize", "Package download exceeds its accepted byte boundary");
      }
      chunks.push(Buffer.from(value));
    }
    if (declaredLength > 0 && total !== declaredLength) throw new ContractViolation("package_digest_mismatch", "Package download is incomplete");
    return Buffer.concat(chunks);
  }
}
