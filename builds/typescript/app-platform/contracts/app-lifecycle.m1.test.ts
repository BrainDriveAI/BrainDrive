import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertLifecycleDiagnostic,
  LifecycleDiagnosticEventSchema,
} from "./audit.js";
import { canonicalInputDigest, canonicalJsonDocumentDigest } from "./common.js";
import { ContractViolation } from "./errors.js";
import {
  APP_LIFECYCLE_STORAGE_POLICY,
  MIXED_VERSION_POLICY,
  RESUME_LIFECYCLE_DATA_ADAPTER_METHODS,
  ResumeLifecycleDataAdapterRequestSchema,
  ResumeLifecycleDataAdapterResultSchema,
} from "./lifecycle-foundation.js";
import { ALLOWED_LIFECYCLE_TRANSITIONS } from "./lifecycle.js";
import {
  assertArchiveEntrySet,
  assertDetachedEnvelopeSignature,
  assertGrantSubset,
  assertPackageCompatibility,
  assertPackageTrustAllowsExecution,
  PackageDescriptorSchema,
  PackageManifestSchema,
  PackageTrustSchema,
  parsePackageManifest,
  resolveAuthorizedReleaseKey,
  TrustRootSchema,
} from "./package.js";
import {
  INSTALLED_APP_SUPERVISOR_METHODS,
  RuntimeDescriptorSchema,
} from "./supervisor.js";

const directory = dirname(fileURLToPath(import.meta.url));

async function fixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(directory, "fixtures", path), "utf8"));
}

describe("Spec 04 app-lifecycle Milestone 1 fixture corpus", () => {
  it("proves every positive and adversarial vector at its exact fail-closed boundary", async () => {
    const corpus = await fixture("spec-04/package-corpus.json") as {
      cases: Array<{ id: string; mutation: string; accepted: boolean; expected_code: string }>;
    };
    const expectedIds = [
      "signed-good", "wrong-key", "tampered", "malformed", "incompatible",
      "capability-widened", "revoked", "traversal", "unsafe-link",
      "duplicate-path", "case-collision", "oversize",
    ];
    expect(corpus.cases.map((entry) => entry.id)).toEqual(expectedIds);

    const outcomes = new Map<string, string>();
    for (const entry of corpus.cases) {
      outcomes.set(entry.id, await exercisePackageFixture(entry.id));
    }
    for (const entry of corpus.cases) {
      expect(outcomes.get(entry.id), entry.id).toBe(entry.expected_code);
      expect(entry.accepted, entry.id).toBe(entry.expected_code === "verified");
      expect(canonicalInputDigest(entry), entry.id).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it("keeps all fixture material public-key-only and non-executable", async () => {
    const corpusText = await readFile(resolve(directory, "fixtures", "spec-04", "package-corpus.json"), "utf8");
    const contractTree = await Promise.all([
      readFile(resolve(directory, "fixtures", "valid", "trust-root.json"), "utf8"),
      readFile(resolve(directory, "fixtures", "valid", "package-signature.json"), "utf8"),
      readFile(resolve(directory, "fixtures", "valid", "package-manifest.json"), "utf8"),
    ]);
    const text = [corpusText, ...contractTree].join("\n");
    expect(text).not.toMatch(/BEGIN (?:OPENSSH |EC |RSA )?PRIVATE KEY|private[_-]?key|seed_phrase/i);
    expect(RuntimeDescriptorSchema.safeParse(await fixture("valid/runtime-descriptor.json")).success).toBe(true);
    expect(INSTALLED_APP_SUPERVISOR_METHODS).toEqual(["start", "awaitReady", "health", "register", "stop", "revokeTokens", "cleanup", "reconcile"]);
    expect(RESUME_LIFECYCLE_DATA_ADAPTER_METHODS).toEqual(["inspectSchema", "discoverRetainedData", "snapshot", "migrate", "restore"]);
    expect(INSTALLED_APP_SUPERVISOR_METHODS).not.toContain("execute");
    expect(RESUME_LIFECYCLE_DATA_ADAPTER_METHODS).not.toContain("delete");
  });
});

describe("Spec 04 app-lifecycle Milestone 1 evidence contract", () => {
  it("maps REQ-001 through REQ-040 to one evidence method, G0-G6 gate, and accountable owner", async () => {
    const manifest = await fixture("spec-04/requirements.json") as {
      requirements: Array<{ id: string; method: string; gate: string; owner_role: string }>;
    };
    const expectedIds = Array.from({ length: 40 }, (_, index) => `REQ-${String(index + 1).padStart(3, "0")}`);
    expect(manifest.requirements.map((entry) => entry.id)).toEqual(expectedIds);
    expect(new Set(manifest.requirements.map((entry) => entry.id)).size).toBe(40);
    for (const entry of manifest.requirements) {
      expect(["automated", "live", "human", "release"]).toContain(entry.method);
      expect(entry.gate).toMatch(/^G[0-6]$/);
      expect(entry.owner_role.length).toBeGreaterThan(0);
    }
  });

  it("keeps transition, failure, storage, and release-gate matrices executable", async () => {
    const evidence = await fixture("spec-04/m1-evidence.json") as {
      gates: Array<{ id: string; accountable_owner: string }>;
      transitions: Array<{ from: keyof typeof ALLOWED_LIFECYCLE_TRANSITIONS; allowed: string[] }>;
      failures: Array<{ fixture_id: string; expected_code: string }>;
    };
    expect(evidence.gates.map((gate) => gate.id)).toEqual(["G0", "G1", "G2", "G3", "G4", "G5", "G6"]);
    expect(evidence.gates.every((gate) => gate.accountable_owner === "DJJones")).toBe(true);
    expect(evidence.transitions).toHaveLength(Object.keys(ALLOWED_LIFECYCLE_TRANSITIONS).length);
    for (const transition of evidence.transitions) {
      expect(transition.allowed).toEqual(ALLOWED_LIFECYCLE_TRANSITIONS[transition.from]);
    }
    expect(evidence.failures.map((failure) => failure.fixture_id)).toEqual(
      (await fixture("spec-04/package-corpus.json") as { cases: Array<{ id: string }> }).cases.map((entry) => entry.id),
    );
    expect(APP_LIFECYCLE_STORAGE_POLICY).toHaveLength(7);
    expect(MIXED_VERSION_POLICY.unknown_or_newer_contract).toBe("fail_closed_without_execution");
    const context = {
      adapter_contract_version: 1,
      operation_id: "11000000-0000-4000-8000-000000000001",
      owner_id: "11000000-0000-4000-8000-000000000002",
      installation_id: "11000000-0000-4000-8000-000000000003",
      app_id: "ai.braindrive.resume-builder",
      package_digest: `sha256:${"a".repeat(64)}`,
      requested_at: "2026-08-08T12:00:00.000Z",
    } as const;
    expect(ResumeLifecycleDataAdapterRequestSchema.safeParse({ action: "snapshot", context, from_schema_version: 1, to_schema_version: 2 }).success).toBe(true);
    expect(ResumeLifecycleDataAdapterRequestSchema.safeParse({ action: "delete_retained_data", context }).success).toBe(false);
    expect(ResumeLifecycleDataAdapterResultSchema.safeParse({ action: "discover_retained_data", present: true, schema_version: 1, compatible: true, data_ref: "11000000-0000-4000-8000-000000000004" }).success).toBe(true);
    expect(ResumeLifecycleDataAdapterResultSchema.safeParse({ action: "discover_retained_data", present: false, schema_version: null, compatible: true, data_ref: null }).success).toBe(false);
  });

  it("accepts only allowlisted lifecycle diagnostics and rejects sensitive or arbitrary metadata", () => {
    const event = {
      diagnostic_version: 1,
      event_name: "app.package.verify",
      occurred_at: "2026-08-08T12:00:00.000Z",
      correlation_id: "10000000-0000-4000-8000-000000000001",
      operation_id: "10000000-0000-4000-8000-000000000002",
      owner_id: "10000000-0000-4000-8000-000000000003",
      actor_id: "10000000-0000-4000-8000-000000000003",
      app_id: "ai.braindrive.resume-builder",
      publisher_id: "ai.braindrive",
      installation_id: null,
      grant_id: null,
      runtime_id: null,
      registration_id: null,
      package_version: "1.0.0",
      package_digest: `sha256:${"a".repeat(64)}`,
      prior_state: "not_installed",
      target_state: "staged",
      result_state: "staged",
      generation: 1,
      step: "verifying_package",
      attempt: 1,
      source_id: "docker-dev-fixture",
      trust_policy_version: 1,
      revocation_policy_version: 1,
      revocation_sequence: 1,
      capability_diff: "no_change",
      data_schema_compatibility: "compatible",
      snapshot_id: null,
      external_status: "verified",
      outcome: "completed",
      error_class: null,
      error_code: null,
      retryable: false,
      recovery: "none",
      elapsed_ms: 4,
      item_count: 3,
      byte_count: 2048,
    } as const;
    expect(LifecycleDiagnosticEventSchema.parse(event)).toEqual(event);
    expect(() => assertLifecycleDiagnostic(event)).not.toThrow();
    expect(() => assertLifecycleDiagnostic({ ...event, error_code: "invalid_input" })).toThrow();
    expect(() => assertLifecycleDiagnostic({ ...event, outcome: "failed", error_class: "validation", error_code: null })).toThrow();
    for (const forbidden of [
      { token: "secret" },
      { raw_manifest: "untrusted metadata" },
      { owner_path: "/home/owner/resume" },
      { provider_credential: "sk-not-allowed" },
      { app_output: "resume content" },
    ]) {
      expect(() => assertLifecycleDiagnostic({ ...event, ...forbidden })).toThrow();
    }
  });
});

async function exercisePackageFixture(id: string): Promise<string> {
  const trustRoot = TrustRootSchema.parse(await fixture("valid/trust-root.json"));
  const manifest = PackageManifestSchema.parse(await fixture("valid/package-manifest.json"));
  const proof = await fixture("valid/package-signature.json") as {
    manifest_digest: string;
    archive: { media_type: string; byte_length: number; digest: string };
    published_at: string;
    signature: Record<string, unknown>;
  };
  const payload = {
    descriptor_version: 1,
    manifest,
    manifest_digest: proof.manifest_digest,
    archive: proof.archive,
    published_at: proof.published_at,
  };
  const descriptor = PackageDescriptorSchema.parse({ payload, signature: proof.signature });
  const releaseKey = resolveAuthorizedReleaseKey(trustRoot, descriptor.signature.signing_key_id, descriptor.payload.published_at);

  switch (id) {
    case "signed-good":
      assertDetachedEnvelopeSignature(releaseKey.public_key, descriptor.signature, descriptor.payload);
      expect(descriptor.payload.manifest_digest).toBe(canonicalJsonDocumentDigest(manifest));
      return "verified";
    case "wrong-key":
      return violationCode(() => resolveAuthorizedReleaseKey(trustRoot, "braindrive-app-release-unknown", descriptor.payload.published_at));
    case "tampered":
      return violationCode(() => assertDetachedEnvelopeSignature(releaseKey.public_key, descriptor.signature, { ...descriptor.payload, published_at: "2026-08-07T12:00:01.000Z" }));
    case "malformed":
      return violationCode(() => parsePackageManifest({ ...manifest, trust_me: true }));
    case "incompatible":
      return violationCode(() => assertPackageCompatibility(
        PackageManifestSchema.parse({ ...manifest, compatibility: { ...manifest.compatibility, host_min_version: "99.0.0" } }),
        "26.7.23",
        "docker_linux_x64",
      ));
    case "capability-widened":
      return violationCode(() => assertGrantSubset(["career.facts.read"], ["career.facts.read", "career.facts.propose"]));
    case "revoked": {
      const trust = PackageTrustSchema.parse({
        trust_policy_version: 1,
        descriptor_digest: canonicalJsonDocumentDigest(descriptor),
        package_digest: descriptor.payload.archive.digest,
        manifest_digest: descriptor.payload.manifest_digest,
        publisher_id: manifest.publisher_id,
        signing_key_id: descriptor.signature.signing_key_id,
        trust_root_version: 1,
        source_index_sequence: 1,
        source_index_signature_valid: true,
        package_signature_valid: true,
        archive_digest_valid: true,
        file_inventory_valid: true,
        source_trusted: true,
        compatibility_valid: true,
        revocation_list_sequence: 1,
        revocation_status: "revoked",
        revocation_age_seconds: 0,
        verification_context: "verified_local_recheck",
        checked_at: "2026-08-08T12:00:00.000Z",
        executable_allowed: false,
      });
      return violationCode(() => assertPackageTrustAllowsExecution(trust));
    }
    case "traversal":
      return violationCode(() => assertArchiveEntrySet([archiveEntry("../escape.js")]));
    case "unsafe-link":
      return violationCode(() => assertArchiveEntrySet([{ ...archiveEntry("payload/link"), entry_type: "symbolic_link", link_target: "../outside" }]));
    case "duplicate-path":
      return violationCode(() => assertArchiveEntrySet([archiveEntry("payload/server.js"), archiveEntry("payload/server.js")]));
    case "case-collision":
      return violationCode(() => assertArchiveEntrySet([archiveEntry("payload/server.js"), archiveEntry("PAYLOAD/server.js")]));
    case "oversize":
      return violationCode(() => assertArchiveEntrySet([{ ...archiveEntry("payload/server.js"), compressed_size_bytes: 67_108_865, uncompressed_size_bytes: 67_108_865 }]));
    default:
      throw new Error(`Unknown fixture ${id}`);
  }
}

function violationCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ContractViolation);
    return (error as ContractViolation).code;
  }
  throw new Error("Expected contract violation");
}

function archiveEntry(path: string): Record<string, unknown> {
  return {
    archive_entry_version: 1,
    path,
    entry_type: "file",
    mode: "read_only",
    compressed_size_bytes: 16,
    uncompressed_size_bytes: 16,
    crc32: "00000000",
  };
}
