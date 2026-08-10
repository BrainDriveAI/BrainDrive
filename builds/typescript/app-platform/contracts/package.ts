import { z } from "zod";

import {
  canonicalInputDigest,
  canonicalJsonDocumentDigest,
  OpaqueIdSchema,
  SemverSchema,
  Sha256DigestSchema,
  TimestampSchema,
  verifyEd25519Signature,
} from "./common.js";
import {
  APP_CONTRACT_SCHEMA_VERSION,
  MCP_APPS_EXTENSION_ID,
  MCP_APPS_EXTENSION_VERSION,
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSION,
  RESUME_BUILDER_APP_ID,
  RESUME_BUILDER_PUBLISHER_ID,
} from "./constants.js";
import { ContractViolation } from "./errors.js";

export const CapabilityNameSchema = z.enum([
  "career.context.read",
  "career.facts.read",
  "career.facts.propose",
  "career.facts.confirm",
  "resume.definitions.read",
  "resume.definitions.write",
  "resume.jobs.read",
  "resume.jobs.write",
  "resume.artifacts.register",
  "resume.export.request",
  "resume.operations.read",
  "app.inference.request",
]);

export const PackagePathSchema = z.string().min(1).max(512).superRefine((value, context) => {
  const segments = value.split("/");
  const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("//") ||
    segments.some((segment) => segment === "" || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment) || windowsReserved.test(segment))
  ) {
    context.addIssue({ code: "custom", message: "package path must be normalized, relative, and traversal-free" });
  }
});

export const PackageFileSchema = z
  .object({
    path: PackagePathSchema,
    kind: z.literal("file"),
    mode: z.enum(["read_only", "executable"]),
    size_bytes: z.number().int().nonnegative().max(268_435_456),
    digest: Sha256DigestSchema,
  })
  .strict();

export const ArchiveEntryContractSchema = z
  .object({
    archive_entry_version: z.literal(1),
    path: PackagePathSchema,
    entry_type: z.literal("file"),
    mode: z.enum(["read_only", "executable"]),
    compressed_size_bytes: z.number().int().nonnegative().max(67_108_864),
    uncompressed_size_bytes: z.number().int().nonnegative().max(67_108_864),
    crc32: z.string().regex(/^[a-f0-9]{8}$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.compressed_size_bytes !== value.uncompressed_size_bytes) {
      context.addIssue({ code: "custom", message: "braindrive-zip-v1 permits stored entries only" });
    }
  });

export function assertArchiveEntrySet(entries: readonly unknown[]): z.infer<typeof ArchiveEntryContractSchema>[] {
  if (entries.length > 256) {
    throw new ContractViolation("package_oversize", "Package archive exceeds the file-count ceiling");
  }
  const parsed = entries.map((candidate) => {
    const record = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
    if (record.entry_type !== "file") {
      throw new ContractViolation("package_unsafe_link", "Package archive links and special entries are prohibited");
    }
    if (
      (typeof record.compressed_size_bytes === "number" && record.compressed_size_bytes > 67_108_864) ||
      (typeof record.uncompressed_size_bytes === "number" && record.uncompressed_size_bytes > 67_108_864)
    ) {
      throw new ContractViolation("package_oversize", "Package archive exceeds the byte ceiling");
    }
    if (!PackagePathSchema.safeParse(record.path).success) {
      throw new ContractViolation("package_path_invalid", "Package archive path is unsafe");
    }
    const result = ArchiveEntryContractSchema.safeParse(candidate);
    if (!result.success) {
      throw new ContractViolation("package_archive_invalid", "Package archive entry violates braindrive-zip-v1");
    }
    return result.data;
  });
  const exact = new Set<string>();
  const folded = new Set<string>();
  let totalBytes = 0;
  for (const entry of parsed) {
    if (exact.has(entry.path)) {
      throw new ContractViolation("package_duplicate_path", "Package archive contains a duplicate path");
    }
    const foldedPath = entry.path.toLowerCase();
    if (folded.has(foldedPath)) {
      throw new ContractViolation("package_case_collision", "Package archive contains a case-folded path collision");
    }
    exact.add(entry.path);
    folded.add(foldedPath);
    totalBytes += entry.uncompressed_size_bytes;
  }
  if (totalBytes > 67_108_864) {
    throw new ContractViolation("package_oversize", "Package archive exceeds the aggregate byte ceiling");
  }
  return parsed;
}

export const PlatformArtifactSchema = z
  .object({
    target: z.enum(["docker_linux_x64", "desktop_windows_x64"]),
    os: z.enum(["linux", "windows"]),
    architecture: z.literal("x64"),
    runtime_kind: z.literal("packaged_node"),
    entrypoint: PackagePathSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.target === "docker_linux_x64" && value.os !== "linux") ||
      (value.target === "desktop_windows_x64" && value.os !== "windows")
    ) {
      context.addIssue({ code: "custom", message: "platform target and operating system disagree" });
    }
  });

export const PackageManifestSchema = z
  .object({
    manifest_version: z.literal(1),
    app_id: z.literal(RESUME_BUILDER_APP_ID),
    publisher_id: z.literal(RESUME_BUILDER_PUBLISHER_ID),
    display_name: z.literal("Resume Builder"),
    package_version: SemverSchema,
    archive: z
      .object({
        format: z.literal("zip"),
        profile: z.literal("braindrive-zip-v1"),
        compression: z.literal("store"),
        layout_version: z.literal(1),
        manifest_path: z.literal("manifest.json"),
        undeclared_entries: z.literal("reject"),
        links_and_device_nodes: z.literal("reject"),
        max_file_count: z.literal(256),
        max_compressed_bytes: z.literal(67_108_864),
        max_uncompressed_bytes: z.literal(268_435_456),
      })
      .strict(),
    files: z.array(PackageFileSchema).min(3).max(256),
    platform_artifacts: z.array(PlatformArtifactSchema).length(2),
    compatibility: z
      .object({
        app_contract: z.literal(APP_CONTRACT_SCHEMA_VERSION),
        host_min_version: SemverSchema,
        mcp_protocol: z.literal(MCP_MODERN_PROTOCOL_VERSION),
        legacy_mcp_adapter: z.literal(MCP_LEGACY_PROTOCOL_VERSION),
        mcp_apps: z
          .object({
            extension_id: z.literal(MCP_APPS_EXTENSION_ID),
            version: z.literal(MCP_APPS_EXTENSION_VERSION),
          })
          .strict(),
        data_schema: z
          .object({
            read_min: z.number().int().positive(),
            read_max: z.number().int().positive(),
            write_version: z.number().int().positive(),
          })
          .strict()
          .superRefine((value, context) => {
            if (value.read_min > value.read_max || value.write_version < value.read_min || value.write_version > value.read_max) {
              context.addIssue({ code: "custom", message: "data schema read/write range is inconsistent" });
            }
          }),
      })
      .strict(),
    requested_capabilities: z.array(CapabilityNameSchema).min(1),
    provenance_path: PackagePathSchema,
    sbom_path: PackagePathSchema,
    retention_policy: z.literal("retain_owner_data_remove_runtime_authority"),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.requested_capabilities).size !== value.requested_capabilities.length) {
      context.addIssue({ code: "custom", message: "duplicate_identity" });
    }
    const foldedPaths = value.files.map((file) => file.path.toLowerCase());
    if (new Set(foldedPaths).size !== foldedPaths.length) {
      context.addIssue({ code: "custom", message: "duplicate or case-colliding package path" });
    }
    const sortedPaths = [...value.files.map((file) => file.path)].sort();
    if (value.files.some((file, index) => file.path !== sortedPaths[index])) {
      context.addIssue({ code: "custom", message: "package file inventory must use canonical path order" });
    }
    const filesByPath = new Map(value.files.map((file) => [file.path, file]));
    for (const file of value.files) {
      if (!/^(?:payload|provenance|sbom)\//.test(file.path) || file.path === value.archive.manifest_path) {
        context.addIssue({ code: "custom", message: "package file is outside the accepted archive roots" });
      }
    }
    const entrypoints = new Set(value.platform_artifacts.map((artifact) => artifact.entrypoint));
    for (const file of value.files) {
      if ((file.mode === "executable") !== entrypoints.has(file.path)) {
        context.addIssue({ code: "custom", message: "only declared platform entrypoints may be executable" });
      }
    }
    for (const artifact of value.platform_artifacts) {
      if (filesByPath.get(artifact.entrypoint)?.mode !== "executable") {
        context.addIssue({ code: "custom", message: "platform entrypoint must be a declared executable file" });
      }
    }
    if (!filesByPath.has(value.provenance_path) || !value.provenance_path.startsWith("provenance/")) {
      context.addIssue({ code: "custom", message: "provenance path must identify a declared provenance file" });
    }
    if (!filesByPath.has(value.sbom_path) || !value.sbom_path.startsWith("sbom/")) {
      context.addIssue({ code: "custom", message: "SBOM path must identify a declared SBOM file" });
    }
    const declaredBytes = value.files.reduce((total, file) => total + file.size_bytes, 0);
    if (declaredBytes > value.archive.max_uncompressed_bytes || declaredBytes > value.archive.max_compressed_bytes) {
      context.addIssue({ code: "custom", message: "declared package contents exceed the canonical stored-ZIP byte ceiling" });
    }
    const targets = value.platform_artifacts.map((artifact) => artifact.target);
    if (new Set(targets).size !== 2 || !targets.includes("docker_linux_x64") || !targets.includes("desktop_windows_x64")) {
      context.addIssue({ code: "custom", message: "package must declare the accepted Docker and Windows targets exactly once" });
    }
  });

export function parsePackageManifest(candidate: unknown): z.infer<typeof PackageManifestSchema> {
  const result = PackageManifestSchema.safeParse(candidate);
  if (!result.success) {
    throw new ContractViolation("package_descriptor_invalid", "Package manifest violates the strict descriptor contract");
  }
  return result.data;
}

function canonicalBase64Schema(pattern: RegExp, byteLength: number) {
  return z.string().regex(pattern).refine((value) => {
    const decoded = Buffer.from(value, "base64");
    return decoded.byteLength === byteLength && decoded.toString("base64") === value;
  }, "value must use canonical padded Base64");
}

const Ed25519SignatureSchema = canonicalBase64Schema(/^[A-Za-z0-9+/]{86}==$/, 64);
const Ed25519PublicKeySchema = canonicalBase64Schema(/^[A-Za-z0-9+/]{43}=$/, 32);
const SigningKeyIdSchema = z.string().regex(/^braindrive-app-(?:root|release)-[A-Za-z0-9-]{4,64}$/);

function isReleaseKeyId(value: string): boolean {
  return value.startsWith("braindrive-app-release-");
}

function detachedSignatureSchema<const T extends string>(domainSeparator: T) {
  return z
    .object({
      signature_version: z.literal(1),
      domain_separator: z.literal(domainSeparator),
      canonicalization: z.literal("braindrive-canonical-json-v1"),
      signature_algorithm: z.literal("ed25519"),
      signing_key_id: SigningKeyIdSchema,
      signature: Ed25519SignatureSchema,
    })
    .strict();
}

function isCredentialFreeHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "releases.braindrive.ai" && parsed.username === "" && parsed.password === "" && parsed.hash === "";
  } catch {
    return false;
  }
}

const FixtureIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,127}$/);

export const PackageDescriptorPayloadSchema = z
  .object({
    descriptor_version: z.literal(1),
    manifest: PackageManifestSchema,
    manifest_digest: Sha256DigestSchema,
    archive: z
      .object({
        media_type: z.literal("application/vnd.braindrive.app+zip"),
        byte_length: z.number().int().positive().max(67_108_864),
        digest: Sha256DigestSchema,
      })
      .strict(),
    published_at: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.manifest_digest !== canonicalJsonDocumentDigest(value.manifest)) {
      context.addIssue({ code: "custom", message: "manifest digest must cover canonical manifest bytes" });
    }
  });

export const PackageDescriptorSchema = z
  .object({
    payload: PackageDescriptorPayloadSchema,
    signature: detachedSignatureSchema("BrainDrive-App-Package-v1"),
  })
  .strict()
  .superRefine((value, context) => {
    if (!isReleaseKeyId(value.signature.signing_key_id)) {
      context.addIssue({ code: "custom", message: "package descriptor must be signed by an authorized release key" });
    }
  });

export const PackageSourceIndexSchema = z
  .object({
    payload: z
      .object({
        index_version: z.literal(1),
        sequence: z.number().int().positive(),
        prior_index_digest: Sha256DigestSchema.nullable(),
        published_at: TimestampSchema,
        entries: z
          .array(
            z
              .object({
                app_id: z.literal(RESUME_BUILDER_APP_ID),
                publisher_id: z.literal(RESUME_BUILDER_PUBLISHER_ID),
                package_version: SemverSchema,
                descriptor_digest: Sha256DigestSchema,
                archive_digest: Sha256DigestSchema,
                targets: z.tuple([z.literal("docker_linux_x64"), z.literal("desktop_windows_x64")]),
                sources: z.tuple([
                  z
                    .object({
                      environment: z.literal("docker_dev"),
                      kind: z.literal("repository_fixture"),
                      descriptor_fixture_id: FixtureIdSchema,
                      archive_fixture_id: FixtureIdSchema,
                    })
                    .strict(),
                  z
                    .object({
                      environment: z.literal("desktop_windows"),
                      kind: z.literal("release_https"),
                      descriptor_url: z.string().url().refine(isCredentialFreeHttpsUrl, "desktop descriptor must use the credential-free BrainDrive HTTPS release origin"),
                      archive_url: z.string().url().refine(isCredentialFreeHttpsUrl, "desktop archive must use the credential-free BrainDrive HTTPS release origin"),
                    })
                    .strict(),
                ]),
              })
              .strict(),
          )
          .min(1)
          .max(1_000),
      })
      .strict()
      .superRefine((value, context) => {
        if ((value.sequence === 1) !== (value.prior_index_digest === null)) {
          context.addIssue({ code: "custom", message: "source index chain metadata is inconsistent" });
        }
        const identities = value.entries.map((entry) => `${entry.publisher_id}/${entry.app_id}/${entry.package_version}`);
        if (new Set(identities).size !== identities.length) {
          context.addIssue({ code: "custom", message: "duplicate_identity" });
        }
      }),
    signature: detachedSignatureSchema("BrainDrive-App-Source-Index-v1"),
  })
  .strict()
  .superRefine((value, context) => {
    if (!isReleaseKeyId(value.signature.signing_key_id)) {
      context.addIssue({ code: "custom", message: "package source index must be signed by an authorized release key" });
    }
  });

function compareSemver(left: string, right: string): number {
  const parse = (value: string): { core: number[]; prerelease: string[] | null } => {
    const separator = value.indexOf("-");
    const coreValue = separator === -1 ? value : value.slice(0, separator);
    const prereleaseValue = separator === -1 ? undefined : value.slice(separator + 1);
    return {
      core: coreValue.split(".").map(Number),
      prerelease: prereleaseValue === undefined ? null : prereleaseValue.split("."),
    };
  };
  const leftValue = parse(left);
  const rightValue = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftValue.core[index] !== rightValue.core[index]) {
      return leftValue.core[index] - rightValue.core[index];
    }
  }
  if (leftValue.prerelease === null || rightValue.prerelease === null) {
    return leftValue.prerelease === rightValue.prerelease ? 0 : leftValue.prerelease === null ? 1 : -1;
  }
  const length = Math.max(leftValue.prerelease.length, rightValue.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftValue.prerelease[index];
    const rightPart = rightValue.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export const RevocationMatchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("package_digest"), package_digest: Sha256DigestSchema }).strict(),
  z
    .object({
      kind: z.literal("version_range"),
      version_from_inclusive: SemverSchema,
      version_to_inclusive: SemverSchema,
    })
    .strict(),
]).superRefine((value, context) => {
  if (value.kind === "version_range" && compareSemver(value.version_from_inclusive, value.version_to_inclusive) > 0) {
    context.addIssue({ code: "custom", message: "revocation version range is reversed" });
  }
});

export const RevocationListSchema = z
  .object({
    payload: z
      .object({
        revocation_version: z.literal(1),
        sequence: z.number().int().positive(),
        prior_list_digest: Sha256DigestSchema.nullable(),
        issued_at: TimestampSchema,
        next_update_at: TimestampSchema,
        entries: z
          .array(
            z
              .object({
                revocation_id: OpaqueIdSchema,
                publisher_id: z.literal(RESUME_BUILDER_PUBLISHER_ID),
                app_id: z.literal(RESUME_BUILDER_APP_ID),
                match: RevocationMatchSchema,
                reason_code: z.enum(["security_compromise", "malicious_release", "signing_key_compromise", "critical_defect"]),
                revoked_at: TimestampSchema,
              })
              .strict(),
          )
          .max(10_000),
      })
      .strict()
      .superRefine((value, context) => {
        if ((value.sequence === 1) !== (value.prior_list_digest === null)) {
          context.addIssue({ code: "custom", message: "revocation chain metadata is inconsistent" });
        }
        if (Date.parse(value.next_update_at) <= Date.parse(value.issued_at)) {
          context.addIssue({ code: "custom", message: "revocation next update must follow issuance" });
        }
        if (new Set(value.entries.map((entry) => entry.revocation_id)).size !== value.entries.length) {
          context.addIssue({ code: "custom", message: "duplicate_identity" });
        }
      }),
    signature: detachedSignatureSchema("BrainDrive-App-Revocations-v1"),
  })
  .strict()
  .superRefine((value, context) => {
    if (!isReleaseKeyId(value.signature.signing_key_id)) {
      context.addIssue({ code: "custom", message: "revocation list must be signed by an authorized release key" });
    }
  });

export const TrustRootSchema = z
  .object({
    trust_root_version: z.literal(1),
    trust_domain: z.literal("braindrive-app-release"),
    root_key: z
      .object({
        key_id: SigningKeyIdSchema,
        algorithm: z.literal("ed25519"),
        public_key: Ed25519PublicKeySchema,
        status: z.literal("active"),
      })
      .strict(),
    threshold: z.literal(1),
    release_keys: z
      .array(
        z
          .object({
            key_version: z.literal(1),
            key_id: SigningKeyIdSchema,
            algorithm: z.literal("ed25519"),
            public_key: Ed25519PublicKeySchema,
            not_before: TimestampSchema,
            not_after: TimestampSchema,
            status: z.enum(["active", "retired", "revoked"]),
            authorization: detachedSignatureSchema("BrainDrive-App-Release-Key-v1"),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.root_key.key_id.startsWith("braindrive-app-root-")) {
      context.addIssue({ code: "custom", message: "pinned trust key must be an app root key" });
    }
    const keyIds = [value.root_key.key_id, ...value.release_keys.map((key) => key.key_id)];
    if (new Set(keyIds).size !== keyIds.length) {
      context.addIssue({ code: "custom", message: "duplicate_identity" });
    }
    for (const key of value.release_keys) {
      if (!isReleaseKeyId(key.key_id)) {
        context.addIssue({ code: "custom", message: "release key identity is invalid" });
      }
      if (Date.parse(key.not_after) <= Date.parse(key.not_before)) {
        context.addIssue({ code: "custom", message: "release key validity window is invalid" });
      }
      if (key.authorization.signing_key_id !== value.root_key.key_id) {
        context.addIssue({ code: "custom", message: "release key must be authorized by the pinned root key" });
      }
    }
  });

export function releaseKeyAuthorizationPayload(
  key: z.infer<typeof TrustRootSchema>["release_keys"][number],
): Omit<typeof key, "authorization"> {
  const { authorization: _authorization, ...payload } = key;
  return payload;
}

export function resolveAuthorizedReleaseKey(
  trustRoot: z.infer<typeof TrustRootSchema>,
  signingKeyId: string,
  at: string,
): z.infer<typeof TrustRootSchema>["release_keys"][number] {
  const key = trustRoot.release_keys.find((candidate) => candidate.key_id === signingKeyId);
  const timestamp = Date.parse(at);
  if (
    !key ||
    key.status !== "active" ||
    !Number.isFinite(timestamp) ||
    timestamp < Date.parse(key.not_before) ||
    timestamp > Date.parse(key.not_after) ||
    !verifyEd25519Signature(
      trustRoot.root_key.public_key,
      key.authorization.signature,
      key.authorization.domain_separator,
      releaseKeyAuthorizationPayload(key),
    )
  ) {
    throw new ContractViolation("signing_key_untrusted", "Signing key is not currently authorized by the app trust root");
  }
  return key;
}

export function assertDetachedEnvelopeSignature(
  publicKey: string,
  signature: { signature: string; domain_separator: string },
  payload: unknown,
): void {
  if (!verifyEd25519Signature(publicKey, signature.signature, signature.domain_separator, payload)) {
    throw new ContractViolation("package_signature_invalid", "Detached Ed25519 signature is invalid");
  }
}

export const RevocationFreshnessPolicySchema = z
  .object({
    policy_version: z.literal(1),
    refresh_interval_seconds: z.literal(3_600),
    stale_after_seconds: z.literal(86_400),
    stale_without_explicit_match: z.literal("allow_verified_local_with_diagnostic"),
    explicit_match: z.literal("fail_closed_and_quarantine"),
    cache_update: z.literal("verified_monotonic_only"),
  })
  .strict();

export const REVOCATION_FRESHNESS_POLICY = RevocationFreshnessPolicySchema.parse({
  policy_version: 1,
  refresh_interval_seconds: 3_600,
  stale_after_seconds: 86_400,
  stale_without_explicit_match: "allow_verified_local_with_diagnostic",
  explicit_match: "fail_closed_and_quarantine",
  cache_update: "verified_monotonic_only",
});

export function assertMonotonicSourceIndexCandidate(
  current: z.infer<typeof PackageSourceIndexSchema>,
  candidate: z.infer<typeof PackageSourceIndexSchema>,
): void {
  if (candidate.payload.sequence < current.payload.sequence) {
    throw new ContractViolation("source_index_rollback", "Package source index sequence must be monotonic");
  }
  if (
    candidate.payload.sequence === current.payload.sequence &&
    canonicalInputDigest(candidate.payload) !== canonicalInputDigest(current.payload)
  ) {
    throw new ContractViolation("source_index_rollback", "A package source index sequence cannot identify different content");
  }
  if (
    candidate.payload.sequence > current.payload.sequence &&
    (candidate.payload.sequence !== current.payload.sequence + 1 ||
      candidate.payload.prior_index_digest !== canonicalJsonDocumentDigest(current.payload))
  ) {
    throw new ContractViolation("source_index_rollback", "Package source index does not extend the verified chain");
  }
}

export function assertMonotonicRevocationCandidate(
  current: z.infer<typeof RevocationListSchema>,
  candidate: z.infer<typeof RevocationListSchema>,
): void {
  if (candidate.payload.sequence < current.payload.sequence) {
    throw new ContractViolation("revocation_rollback", "Revocation sequence must be monotonic");
  }
  if (
    candidate.payload.sequence === current.payload.sequence &&
    canonicalInputDigest(candidate.payload) !== canonicalInputDigest(current.payload)
  ) {
    throw new ContractViolation("revocation_rollback", "A revocation sequence cannot identify different content");
  }
  if (
    candidate.payload.sequence > current.payload.sequence &&
    (candidate.payload.sequence !== current.payload.sequence + 1 ||
      candidate.payload.prior_list_digest !== canonicalJsonDocumentDigest(current.payload))
  ) {
    throw new ContractViolation("revocation_rollback", "Revocation list does not extend the verified chain");
  }
}

export const PackageTrustSchema = z
  .object({
    trust_policy_version: z.literal(1),
    descriptor_digest: Sha256DigestSchema,
    package_digest: Sha256DigestSchema,
    manifest_digest: Sha256DigestSchema,
    publisher_id: z.literal(RESUME_BUILDER_PUBLISHER_ID),
    signing_key_id: SigningKeyIdSchema,
    trust_root_version: z.literal(1),
    source_index_sequence: z.number().int().positive(),
    source_index_signature_valid: z.boolean(),
    package_signature_valid: z.boolean(),
    archive_digest_valid: z.boolean(),
    file_inventory_valid: z.boolean(),
    source_trusted: z.boolean(),
    compatibility_valid: z.boolean(),
    revocation_list_sequence: z.number().int().positive(),
    revocation_status: z.enum(["not_revoked_fresh", "not_revoked_stale", "revoked"]),
    revocation_age_seconds: z.number().int().nonnegative(),
    verification_context: z.enum(["candidate_install_or_update", "verified_local_recheck"]),
    checked_at: TimestampSchema,
    executable_allowed: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    const expected =
      value.source_index_signature_valid &&
      value.package_signature_valid &&
      value.archive_digest_valid &&
      value.file_inventory_valid &&
      value.source_trusted &&
      value.compatibility_valid &&
      value.revocation_status !== "revoked" &&
      (value.revocation_status !== "not_revoked_stale" || value.verification_context === "verified_local_recheck");
    if (value.executable_allowed !== expected) {
      context.addIssue({ code: "custom", message: "executable_allowed must derive from all trust checks" });
    }
  });

export function assertPackageTrustAllowsExecution(trust: z.infer<typeof PackageTrustSchema>): void {
  if (trust.revocation_status === "revoked") {
    throw new ContractViolation("package_revoked", "Package is explicitly revoked");
  }
  if (!trust.compatibility_valid) {
    throw new ContractViolation("incompatible_version", "Package is incompatible with this host");
  }
  if (!trust.source_index_signature_valid || !trust.source_trusted) {
    throw new ContractViolation("package_source_untrusted", "Package source is not trusted");
  }
  if (!trust.package_signature_valid) {
    throw new ContractViolation("package_signature_invalid", "Package signature is invalid");
  }
  if (!trust.archive_digest_valid) {
    throw new ContractViolation("package_digest_mismatch", "Package archive digest does not match authority");
  }
  if (!trust.file_inventory_valid) {
    throw new ContractViolation("package_file_mismatch", "Package inventory does not match authority");
  }
  if (!trust.executable_allowed) {
    throw new ContractViolation("revocation_metadata_invalid", "Package execution is not authorized by the current trust state");
  }
}

export function assertPackageCompatibility(
  manifest: z.infer<typeof PackageManifestSchema>,
  hostVersion: string,
  target: z.infer<typeof PlatformArtifactSchema>["target"],
): void {
  if (
    !SemverSchema.safeParse(hostVersion).success ||
    compareSemver(hostVersion, manifest.compatibility.host_min_version) < 0 ||
    !manifest.platform_artifacts.some((artifact) => artifact.target === target)
  ) {
    throw new ContractViolation("incompatible_version", "Package is incompatible with this host version or platform");
  }
}

export const CapabilityGrantSchema = z
  .object({
    grant_version: z.literal(1),
    grant_revision: z.number().int().positive(),
    revocation_generation: z.number().int().nonnegative(),
    grant_id: OpaqueIdSchema,
    owner_id: OpaqueIdSchema,
    actor_id: OpaqueIdSchema,
    app_id: z.literal(RESUME_BUILDER_APP_ID),
    publisher_id: z.literal(RESUME_BUILDER_PUBLISHER_ID),
    package_digest: Sha256DigestSchema,
    installation_id: OpaqueIdSchema,
    capabilities: z.array(CapabilityNameSchema).min(1),
    record_scopes: z.array(OpaqueIdSchema),
    decision: z
      .object({
        decision_id: OpaqueIdSchema,
        decided_by_actor_id: OpaqueIdSchema,
        decided_at: TimestampSchema,
        outcome: z.literal("approved"),
      })
      .strict(),
    issued_at: TimestampSchema,
    expires_at: TimestampSchema,
    revoked_at: TimestampSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.capabilities).size !== value.capabilities.length) {
      context.addIssue({ code: "custom", message: "duplicate_identity" });
    }
    if (new Set(value.record_scopes).size !== value.record_scopes.length) {
      context.addIssue({ code: "custom", message: "duplicate_identity" });
    }
    if (Date.parse(value.expires_at) <= Date.parse(value.issued_at)) {
      context.addIssue({ code: "custom", message: "grant expiry must follow issuance" });
    }
    if (value.decision.decided_by_actor_id !== value.actor_id || value.decision.decided_at !== value.issued_at) {
      context.addIssue({ code: "custom", message: "grant decision attribution is inconsistent" });
    }
  });

export const CapabilityDiffSchema = z
  .object({
    diff_version: z.literal(1),
    prior_capabilities: z.array(CapabilityNameSchema),
    requested_capabilities: z.array(CapabilityNameSchema),
    added: z.array(CapabilityNameSchema),
    removed: z.array(CapabilityNameSchema),
    unchanged: z.array(CapabilityNameSchema),
    decision: z.enum(["no_change", "narrowing_allowed", "owner_approval_required"]),
  })
  .strict()
  .superRefine((value, context) => {
    const sorted = (items: readonly string[]) => [...items].sort();
    const prior = new Set(value.prior_capabilities);
    const requested = new Set(value.requested_capabilities);
    const expectedAdded = sorted([...requested].filter((item) => !prior.has(item)));
    const expectedRemoved = sorted([...prior].filter((item) => !requested.has(item)));
    const expectedUnchanged = sorted([...requested].filter((item) => prior.has(item)));
    if (
      [value.prior_capabilities, value.requested_capabilities, value.added, value.removed, value.unchanged]
        .some((items) => new Set(items).size !== items.length)
    ) {
      context.addIssue({ code: "custom", message: "duplicate_identity" });
    }
    if (
      JSON.stringify(sorted(value.added)) !== JSON.stringify(expectedAdded) ||
      JSON.stringify(sorted(value.removed)) !== JSON.stringify(expectedRemoved) ||
      JSON.stringify(sorted(value.unchanged)) !== JSON.stringify(expectedUnchanged)
    ) {
      context.addIssue({ code: "custom", message: "capability diff does not match prior and requested grants" });
    }
    const expectedDecision = expectedAdded.length > 0 ? "owner_approval_required" : expectedRemoved.length > 0 ? "narrowing_allowed" : "no_change";
    if (value.decision !== expectedDecision) {
      context.addIssue({ code: "custom", message: "capability diff decision is invalid" });
    }
  });

export const CapabilityTokenSchema = z
  .object({
    token_version: z.literal(1),
    token_generation: z.number().int().positive(),
    grant_revision: z.number().int().positive(),
    revocation_generation: z.number().int().nonnegative(),
    token_id: OpaqueIdSchema,
    audience: z.enum(["app_data", "app_inference", "app_export", "app_bridge"]),
    grant_id: OpaqueIdSchema,
    owner_id: OpaqueIdSchema,
    actor_id: OpaqueIdSchema,
    app_id: z.literal(RESUME_BUILDER_APP_ID),
    publisher_id: z.literal(RESUME_BUILDER_PUBLISHER_ID),
    package_digest: Sha256DigestSchema,
    installation_id: OpaqueIdSchema,
    connection_id: OpaqueIdSchema,
    view_id: OpaqueIdSchema.nullable(),
    operation_id: OpaqueIdSchema,
    idempotency_key: z.string().min(16).max(256),
    capabilities: z.array(CapabilityNameSchema).min(1),
    record_scopes: z.array(OpaqueIdSchema),
    issued_at: TimestampSchema,
    expires_at: TimestampSchema,
    nonce: z.string().min(16).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    const lifetimeMs = Date.parse(value.expires_at) - Date.parse(value.issued_at);
    if (lifetimeMs <= 0 || lifetimeMs > 15 * 60_000) {
      context.addIssue({ code: "custom", message: "capability tokens must be short-lived (15 minutes maximum)" });
    }
    if (new Set(value.capabilities).size !== value.capabilities.length || new Set(value.record_scopes).size !== value.record_scopes.length) {
      context.addIssue({ code: "custom", message: "duplicate_identity" });
    }
    if (value.audience === "app_inference" && (value.capabilities.length !== 1 || value.capabilities[0] !== "app.inference.request")) {
      context.addIssue({ code: "custom", message: "token audience and grant do not agree" });
    }
    if (value.audience === "app_export" && (value.capabilities.length !== 1 || value.capabilities[0] !== "resume.export.request")) {
      context.addIssue({ code: "custom", message: "token audience and grant do not agree" });
    }
    if (value.audience === "app_bridge" && value.view_id === null) {
      context.addIssue({ code: "custom", message: "bridge tokens require a view binding" });
    }
  });

export const SupervisorPolicySchema = z
  .object({
    policy_version: z.literal(1),
    isolation: z.literal("one_process_or_container_per_active_installation"),
    max_cpu_cores: z.literal(1),
    max_memory_bytes: z.literal(536_870_912),
    max_output_bytes_per_request: z.literal(1_048_576),
    request_timeout_ms: z.literal(120_000),
    startup_timeout_ms: z.literal(30_000),
    max_crash_restarts: z.literal(3),
    restart_backoff_ms: z.tuple([z.literal(1_000), z.literal(2_000), z.literal(4_000)]),
    after_restart_limit: z.literal("owner_retry_required"),
    public_bind_allowed: z.literal(false),
  })
  .strict();

export const SUPERVISOR_POLICY = SupervisorPolicySchema.parse({
  policy_version: 1,
  isolation: "one_process_or_container_per_active_installation",
  max_cpu_cores: 1,
  max_memory_bytes: 536_870_912,
  max_output_bytes_per_request: 1_048_576,
  request_timeout_ms: 120_000,
  startup_timeout_ms: 30_000,
  max_crash_restarts: 3,
  restart_backoff_ms: [1_000, 2_000, 4_000],
  after_restart_limit: "owner_retry_required",
  public_bind_allowed: false,
});

export function assertGrantSubset(
  installed: readonly z.infer<typeof CapabilityNameSchema>[],
  requested: readonly z.infer<typeof CapabilityNameSchema>[],
): void {
  const allowed = new Set(installed);
  if (requested.some((capability) => !allowed.has(capability))) {
    throw new ContractViolation("widened_grant", "Requested capabilities exceed the installed grant");
  }
}
