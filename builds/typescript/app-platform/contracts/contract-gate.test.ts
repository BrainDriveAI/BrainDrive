import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { canonicalJsonDocumentDigest, canonicalSignedBytes, verifyEd25519Signature } from "./common.js";
import {
  assertMonotonicRevocationCandidate,
  assertMonotonicSourceIndexCandidate,
  PackagePathSchema,
  PackageDescriptorSchema,
  PackageManifestSchema,
  PackageSourceIndexSchema,
  RevocationListSchema,
  releaseKeyAuthorizationPayload,
  resolveAuthorizedReleaseKey,
  assertDetachedEnvelopeSignature,
  TrustRootSchema,
} from "./package.js";
import {
  LifecycleOperationSchema,
  LifecycleRecordSchema,
} from "./lifecycle.js";
import {
  RuntimeDescriptorSchema,
  SupervisorCleanupResultSchema,
  SupervisorReconcileResultSchema,
  SupervisorStartResultSchema,
  SupervisorStopResultSchema,
  SupervisorTokenRevocationResultSchema,
} from "./supervisor.js";

const directory = dirname(fileURLToPath(import.meta.url));

async function fixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(directory, "fixtures", path), "utf8"));
}

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

const manifest = {
  manifest_version: 1,
  app_id: "ai.braindrive.resume-builder",
  publisher_id: "ai.braindrive",
  display_name: "Resume Builder",
  package_version: "1.0.0",
  archive: {
    format: "zip",
    profile: "braindrive-zip-v1",
    compression: "store",
    layout_version: 1,
    manifest_path: "manifest.json",
    undeclared_entries: "reject",
    links_and_device_nodes: "reject",
    max_file_count: 256,
    max_compressed_bytes: 67_108_864,
    max_uncompressed_bytes: 268_435_456,
  },
  files: [
    { path: "payload/server/dist/index.js", kind: "file", mode: "executable", size_bytes: 123, digest: digest("a") },
    { path: "provenance/intoto.jsonl", kind: "file", mode: "read_only", size_bytes: 456, digest: digest("b") },
    { path: "sbom/cyclonedx.json", kind: "file", mode: "read_only", size_bytes: 789, digest: digest("c") },
  ],
  platform_artifacts: [
    { target: "docker_linux_x64", os: "linux", architecture: "x64", runtime_kind: "packaged_node", entrypoint: "payload/server/dist/index.js" },
    { target: "desktop_windows_x64", os: "windows", architecture: "x64", runtime_kind: "packaged_node", entrypoint: "payload/server/dist/index.js" },
  ],
  compatibility: {
    app_contract: 1,
    host_min_version: "26.7.23",
    mcp_protocol: "2026-07-28",
    legacy_mcp_adapter: "2025-11-25",
    mcp_apps: { extension_id: "io.modelcontextprotocol/ui", version: "2026-01-26" },
    data_schema: { read_min: 1, read_max: 1, write_version: 1 },
  },
  requested_capabilities: ["career.facts.read", "resume.definitions.write"],
  provenance_path: "provenance/intoto.jsonl",
  sbom_path: "sbom/cyclonedx.json",
  retention_policy: "retain_owner_data_remove_runtime_authority",
} as const;

const signature = (domain_separator: string) => ({
  signature_version: 1,
  domain_separator,
  canonicalization: "braindrive-canonical-json-v1",
  signature_algorithm: "ed25519",
  signing_key_id: "braindrive-app-release-2026-01",
  signature: "A".repeat(86) + "==",
});

describe("M1 package byte and signing gate", () => {
  it("accepts the versioned trust, source, revocation, and runtime fixtures", async () => {
    const root = TrustRootSchema.parse(await fixture("valid/trust-root.json"));
    const releaseKey = root.release_keys[0];
    expect(verifyEd25519Signature(root.root_key.public_key, releaseKey.authorization.signature, releaseKey.authorization.domain_separator, releaseKeyAuthorizationPayload(releaseKey))).toBe(true);
    expect(resolveAuthorizedReleaseKey(root, releaseKey.key_id, "2026-08-07T12:00:00.000Z")).toEqual(releaseKey);
    expect(() => resolveAuthorizedReleaseKey(root, releaseKey.key_id, "2028-08-07T12:00:00.000Z")).toThrowError(/not currently authorized/);

    const source = PackageSourceIndexSchema.parse(await fixture("valid/package-source-index.json"));
    expect(verifyEd25519Signature(releaseKey.public_key, source.signature.signature, source.signature.domain_separator, source.payload)).toBe(true);
    const revocations = RevocationListSchema.parse(await fixture("valid/revocation-list.json"));
    expect(verifyEd25519Signature(releaseKey.public_key, revocations.signature.signature, revocations.signature.domain_separator, revocations.payload)).toBe(true);

    const fixtureManifest = PackageManifestSchema.parse(await fixture("valid/package-manifest.json"));
    const packageProof = await fixture("valid/package-signature.json") as { manifest_digest: string; archive: { media_type: string; byte_length: number; digest: string }; published_at: string; signature: Record<string, unknown> };
    const packagePayload = { descriptor_version: 1, manifest: fixtureManifest, manifest_digest: packageProof.manifest_digest, archive: packageProof.archive, published_at: packageProof.published_at };
    const descriptor = PackageDescriptorSchema.parse({ payload: packagePayload, signature: packageProof.signature });
    expect(verifyEd25519Signature(releaseKey.public_key, descriptor.signature.signature, descriptor.signature.domain_separator, descriptor.payload)).toBe(true);
    expect(() => assertDetachedEnvelopeSignature(releaseKey.public_key, descriptor.signature, descriptor.payload)).not.toThrow();
    expect(source.payload.entries[0].descriptor_digest).toBe(canonicalJsonDocumentDigest(descriptor));
    expect(source.payload.entries[0].archive_digest).toBe(descriptor.payload.archive.digest);
    expect(verifyEd25519Signature(releaseKey.public_key, descriptor.signature.signature, descriptor.signature.domain_separator, { ...descriptor.payload, published_at: "2026-08-07T12:00:01.000Z" })).toBe(false);
    expect(RuntimeDescriptorSchema.safeParse(await fixture("valid/runtime-descriptor.json")).success).toBe(true);
  });

  it("freezes archive contents and detached signing boundaries", () => {
    expect(PackageManifestSchema.safeParse(manifest).success).toBe(true);
    const payload = {
      descriptor_version: 1,
      manifest,
      manifest_digest: canonicalJsonDocumentDigest(manifest),
      archive: { media_type: "application/vnd.braindrive.app+zip", byte_length: 2_048, digest: digest("e") },
      published_at: "2026-08-07T12:00:00.000Z",
    };
    expect(PackageDescriptorSchema.safeParse({ payload, signature: signature("BrainDrive-App-Package-v1") }).success).toBe(true);
    expect(canonicalSignedBytes("BrainDrive-App-Package-v1", { beta: 2, alpha: 1 })).toBe(
      'BrainDrive-App-Package-v1\n{"alpha":1,"beta":2}\n',
    );
  });

  it("rejects traversal, duplicate case-folded paths, undeclared entrypoints, and unexpected signature domains", () => {
    expect(PackageManifestSchema.safeParse({ ...manifest, files: [{ ...manifest.files[0], path: "../escape.js" }] }).success).toBe(false);
    expect(PackageManifestSchema.safeParse({ ...manifest, files: [...manifest.files, { ...manifest.files[0], path: "PAYLOAD/server/dist/index.js" }] }).success).toBe(false);
    expect(PackageManifestSchema.safeParse({ ...manifest, platform_artifacts: [{ ...manifest.platform_artifacts[0], entrypoint: "payload/missing.js" }] }).success).toBe(false);
    const payload = { descriptor_version: 1, manifest, manifest_digest: canonicalJsonDocumentDigest(manifest), archive: { media_type: "application/vnd.braindrive.app+zip", byte_length: 1, digest: digest("e") }, published_at: "2026-08-07T12:00:00.000Z" };
    expect(PackageDescriptorSchema.safeParse({ payload, signature: signature("Wrong-Domain") }).success).toBe(false);
  });

  it("rejects every unsafe package path fixture", async () => {
    const invalid = await fixture("invalid/package-paths.json") as { paths: string[] };
    for (const path of invalid.paths) {
      expect(PackagePathSchema.safeParse(path).success, path).toBe(false);
    }
  });
});

describe("M1 trust source and revocation gate", () => {
  it("defines a pinned root authorizing bounded release keys", () => {
    const root = {
      trust_root_version: 1,
      trust_domain: "braindrive-app-release",
      root_key: { key_id: "braindrive-app-root-2026", algorithm: "ed25519", public_key: "A".repeat(43) + "=", status: "active" },
      threshold: 1,
      release_keys: [{ key_version: 1, key_id: "braindrive-app-release-2026-01", algorithm: "ed25519", public_key: "A".repeat(43) + "=", not_before: "2026-08-01T00:00:00.000Z", not_after: "2027-08-01T00:00:00.000Z", status: "active", authorization: { ...signature("BrainDrive-App-Release-Key-v1"), signing_key_id: "braindrive-app-root-2026" } }],
    };
    expect(TrustRootSchema.safeParse(root).success).toBe(true);
    expect(TrustRootSchema.safeParse({ ...root, release_keys: [...root.release_keys, root.release_keys[0]] }).success).toBe(false);
  });

  it("freezes signed source and monotonic revocation envelopes", () => {
    const source = {
      payload: { index_version: 1, sequence: 1, prior_index_digest: null, published_at: "2026-08-07T12:00:00.000Z", entries: [{ app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive", package_version: "1.0.0", descriptor_digest: digest("f"), archive_digest: digest("e"), targets: ["docker_linux_x64", "desktop_windows_x64"], sources: [{ environment: "docker_dev", kind: "repository_fixture", descriptor_fixture_id: "resume-builder-1.0.0-descriptor", archive_fixture_id: "resume-builder-1.0.0-bdapp" }, { environment: "desktop_windows", kind: "release_https", descriptor_url: "https://releases.braindrive.ai/apps/resume-builder/1.0.0/descriptor.json", archive_url: "https://releases.braindrive.ai/apps/resume-builder/1.0.0/resume-builder.bdapp" }] }] },
      signature: signature("BrainDrive-App-Source-Index-v1"),
    };
    expect(PackageSourceIndexSchema.safeParse(source).success).toBe(true);
    const parsedSource = PackageSourceIndexSchema.parse(source);
    expect(() => assertMonotonicSourceIndexCandidate(parsedSource, { ...parsedSource, payload: { ...parsedSource.payload, sequence: 0 } })).toThrowError(/monotonic/);
    expect(() => assertMonotonicSourceIndexCandidate(parsedSource, { ...parsedSource, payload: { ...parsedSource.payload, sequence: 2, prior_index_digest: canonicalJsonDocumentDigest(parsedSource.payload) } })).not.toThrow();
    expect(() => assertMonotonicSourceIndexCandidate(parsedSource, { ...parsedSource, payload: { ...parsedSource.payload, published_at: "2026-08-07T12:00:01.000Z" } })).toThrowError(/different content/);

    const revocations = {
      payload: { revocation_version: 1, sequence: 2, prior_list_digest: digest("1"), issued_at: "2026-08-07T12:00:00.000Z", next_update_at: "2026-08-08T12:00:00.000Z", entries: [{ revocation_id: "10000000-0000-4000-8000-000000000001", publisher_id: "ai.braindrive", app_id: "ai.braindrive.resume-builder", match: { kind: "package_digest", package_digest: digest("e") }, reason_code: "security_compromise", revoked_at: "2026-08-07T11:00:00.000Z" }] },
      signature: signature("BrainDrive-App-Revocations-v1"),
    };
    expect(RevocationListSchema.safeParse(revocations).success).toBe(true);
    const parsedRevocations = RevocationListSchema.parse(revocations);
    expect(() => assertMonotonicRevocationCandidate(parsedRevocations, { ...parsedRevocations, payload: { ...parsedRevocations.payload, sequence: 1 } })).toThrowError(/monotonic/);
    expect(() => assertMonotonicRevocationCandidate(parsedRevocations, { ...parsedRevocations, payload: { ...parsedRevocations.payload, sequence: 3, prior_list_digest: canonicalJsonDocumentDigest(parsedRevocations.payload) } })).not.toThrow();
    expect(() => assertMonotonicRevocationCandidate(parsedRevocations, { ...parsedRevocations, payload: { ...parsedRevocations.payload, issued_at: "2026-08-07T12:00:01.000Z" } })).toThrowError(/different content/);
  });

  it("rejects broken revocation chains and duplicate trust identities", async () => {
    expect(RevocationListSchema.safeParse(await fixture("invalid/revocation-chain.json")).success).toBe(false);
    const root = TrustRootSchema.parse(await fixture("valid/trust-root.json"));
    const duplicate = await fixture("security/trust-duplicate-key.json") as { duplicate_key_id: string };
    expect(TrustRootSchema.safeParse({ ...root, release_keys: [{ ...root.release_keys[0], key_id: duplicate.duplicate_key_id }] }).success).toBe(false);
  });
});

describe("M1 lifecycle operation and supervisor gate", () => {
  const runtimeDescriptor = {
    supervisor_protocol_version: 1,
    runtime_kind: "container",
    app_id: "ai.braindrive.resume-builder",
    installation_id: "20000000-0000-4000-8000-000000000001",
    package_digest: digest("e"),
    grant_id: "20000000-0000-4000-8000-000000000002",
    verified_entrypoint: "payload/server/dist/index.js",
    arguments: [],
    environment_keys: ["BRAINDRIVE_APP_CONNECTION_TOKEN"],
    package_root_ref: "20000000-0000-4000-8000-000000000003",
    cache_root_ref: "20000000-0000-4000-8000-000000000004",
    endpoint_policy: { transport: "container_internal", authentication: "per_installation_token", public_bind_allowed: false },
    resource_policy_version: 1,
  } as const;

  it("accepts only verified, opaque, non-shell runtime descriptors", () => {
    expect(RuntimeDescriptorSchema.safeParse(runtimeDescriptor).success).toBe(true);
    expect(RuntimeDescriptorSchema.safeParse({ ...runtimeDescriptor, arguments: ["--command=$(id)"] }).success).toBe(false);
    expect(RuntimeDescriptorSchema.safeParse({ ...runtimeDescriptor, package_root: "/host/apps" }).success).toBe(false);
  });

  it("rejects a public supervisor bind fixture", async () => {
    const publicBind = await fixture("security/supervisor-public-bind.json");
    expect(RuntimeDescriptorSchema.safeParse({ ...runtimeDescriptor, endpoint_policy: publicBind }).success).toBe(false);
  });

  it("makes start, stop, and reconciliation outcomes unambiguous", () => {
    const identity = { runtime_id: "20000000-0000-4000-8000-000000000005", installation_id: runtimeDescriptor.installation_id, package_digest: digest("e"), runtime_generation: 1, endpoint_token_generation: 1 };
    expect(SupervisorStartResultSchema.safeParse({ supervisor_protocol_version: 1, outcome: "started", state: "starting", runtime: identity, error_code: null }).success).toBe(true);
    expect(SupervisorStopResultSchema.safeParse({ supervisor_protocol_version: 1, outcome: "ambiguous", termination_acknowledged: true, runtime: identity, error_code: "ambiguous_runtime_state" }).success).toBe(false);
    expect(SupervisorReconcileResultSchema.safeParse({ supervisor_protocol_version: 1, outcome: "no_runtime_expected", expected_runtime: null, observed_runtime: null, active_runtime_count: 0, registration_count: 0, tokens_revoked: true, error_code: null }).success).toBe(true);
    expect(SupervisorTokenRevocationResultSchema.safeParse({ supervisor_protocol_version: 1, operation_id: "20000000-0000-4000-8000-000000000006", installation_id: runtimeDescriptor.installation_id, runtime_id: identity.runtime_id, operation_scope_id: null, prior_token_generation: 1, next_token_generation: 2, outcome: "revoked", error_code: null }).success).toBe(true);
    expect(SupervisorCleanupResultSchema.safeParse({ supervisor_protocol_version: 1, operation_id: "20000000-0000-4000-8000-000000000006", installation_id: runtimeDescriptor.installation_id, outcome: "cleaned", cleaned_runtime_ids: [identity.runtime_id], remaining_runtime_count: 0, registration_count: 0, tokens_revoked: true, error_code: null }).success).toBe(true);
    expect(SupervisorCleanupResultSchema.safeParse({ supervisor_protocol_version: 1, operation_id: "20000000-0000-4000-8000-000000000006", installation_id: runtimeDescriptor.installation_id, outcome: "cleaned", cleaned_runtime_ids: [identity.runtime_id], remaining_runtime_count: 1, registration_count: 0, tokens_revoked: true, error_code: null }).success).toBe(false);
  });

  it("records lifecycle prior/next state, stages, recovery, and terminal result", () => {
    const record = { lifecycle_schema_version: 1, app_id: "ai.braindrive.resume-builder", installation_id: runtimeDescriptor.installation_id, state: "staged", generation: 1, active_package_digest: null, last_known_good_package_digest: null, grant_id: runtimeDescriptor.grant_id, pending_operation_id: "20000000-0000-4000-8000-000000000006", successful_use_checkpoint: null, updated_at: "2026-08-07T12:00:00.000Z" };
    expect(LifecycleRecordSchema.safeParse(record).success).toBe(true);
    expect(LifecycleOperationSchema.safeParse({ lifecycle_operation_version: 1, operation_id: record.pending_operation_id, idempotency_key: "install-request-0001", canonical_input_digest: digest("9"), owner_id: "20000000-0000-4000-8000-000000000007", actor_id: "20000000-0000-4000-8000-000000000007", app_id: record.app_id, installation_id: record.installation_id, kind: "install", prior_record_digest: digest("8"), prior_generation: 0, prior_state: "not_installed", target_state: "active", next_state: "staged", stage: "staging", completed_stages: ["requested", "verifying_source", "verifying_package"], compensations: [{ stage: "staging", action: "remove_staging", status: "pending" }], status: "running", commit_outcome: "not_committed", recovery: { action: "remove_staging_and_restore_prior", from_stage: "staging", safe_state: "not_installed", snapshot_ref: null }, started_at: record.updated_at, updated_at: record.updated_at, completed_at: null, result: null, error_code: null }).success).toBe(true);
  });
});
