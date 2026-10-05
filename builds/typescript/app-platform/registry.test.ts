import { describe, expect, it } from "vitest";

import {
  GenericPackageManifestSchema,
  ResolvedAppDescriptorSchema,
  VerifiedFirstPartyPackageSchema,
  type FirstPartyAppRegistration,
  type GenericPackageManifest,
  type VerifiedFirstPartyPackage,
} from "./contracts/app-registry.js";
import { canonicalInputDigest, canonicalJsonDocumentDigest } from "./contracts/common.js";
import { LegacyResumePackageManifestSchema, parseLegacyResumePackageManifestForMigration } from "./contracts/package.js";
import { FirstPartyAppRegistry } from "./registry.js";

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

function manifest(input: {
  appId: string;
  publisherId?: string;
  routeKey: string;
  displayName: string;
  capability: string;
  purpose: string;
  dataContractVersion?: number;
}): GenericPackageManifest {
  const publisherId = input.publisherId ?? "ai.braindrive";
  return GenericPackageManifestSchema.parse({
    manifest_version: 2,
    app_id: input.appId,
    publisher_id: publisherId,
    package_version: "1.0.0",
    catalog: {
      display_name: input.displayName,
      summary: `${input.displayName} synthetic contract fixture`,
      icon: {
        package_path: "payload/ui/icon.png",
        media_type: "image/png",
        content_digest: digest("d"),
      },
      retention_summary: "Owner data is retained when app runtime authority is removed.",
    },
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
      { path: "payload/ui/icon.png", kind: "file", mode: "read_only", size_bytes: 456, digest: digest("d") },
      { path: "payload/ui/index.html", kind: "file", mode: "read_only", size_bytes: 789, digest: digest("e") },
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
      mcp_apps: { extension_id: "io.modelcontextprotocol/ui", version: "2026-01-26" },
      data_contract_version: input.dataContractVersion ?? 1,
    },
    primary_resource: {
      resource_version: 1,
      uri: `ui://${input.routeKey}/main`,
      package_path: "payload/ui/index.html",
      mime_type: "text/html;profile=mcp-app",
      content_digest: digest("e"),
    },
    requested_capabilities: [{ name: input.capability, version: 1 }],
    requested_inference_purposes: [{ purpose_id: input.purpose, version: 1 }],
    provenance_path: "provenance/intoto.jsonl",
    sbom_path: "sbom/cyclonedx.json",
    retention_policy: "retain_owner_data_remove_runtime_authority",
  });
}

function registration(input: {
  appId: string;
  publisherId?: string;
  routeKey: string;
  capability: string;
  purpose: string;
  dataContractVersion?: number;
}): FirstPartyAppRegistration {
  const publisherId = input.publisherId ?? "ai.braindrive";
  return {
    registration_version: 1,
    app_id: input.appId,
    publisher_id: publisherId,
    route_key: input.routeKey,
    package_source_id: `first-party.${input.routeKey}`,
    lifecycle_binding_id: `lifecycle.${input.routeKey}`,
    runtime_profile_id: `runtime.${input.routeKey}`,
    capability_registrations: [{
      registration_version: 1,
      app_id: input.appId,
      key: { name: input.capability, version: 1 },
      binding_id: `capability.${input.routeKey}.read`,
      input_schema_id: `${input.routeKey}.read.input.v1`,
      result_schema_id: `${input.routeKey}.read.result.v1`,
      limits: { max_input_bytes: 262_144, max_duration_ms: 120_000, max_calls_per_minute: 60 },
      confirmation: "none",
      audit_projection_id: `audit.${input.routeKey}.read.v1`,
      retry_policy: "idempotent_only",
      idempotency_policy: "required",
      owner_component_id: `${input.routeKey}.domain`,
    }],
    inference_purpose_registrations: [{
      registration_version: 1,
      app_id: input.appId,
      key: { purpose_id: input.purpose, version: 1 },
      binding_id: `inference.${input.routeKey}.generate`,
      input_schema_id: `${input.routeKey}.generate.input.v1`,
      output_schema_id: `${input.routeKey}.generate.output.v1`,
      prompt_policy_id: `${input.routeKey}.generate.policy`,
      model_compatibility_class: "owner_active_compatible",
      limits: { max_input_bytes: 262_144, max_input_tokens: 65_536, max_output_tokens: 8_192, max_duration_ms: 120_000, max_attempts: 2 },
      validation_policy_id: `${input.routeKey}.generate.validation.v1`,
      retry_policy: "same_snapshot_only",
      cancellation_policy: "required",
      audit_projection_id: `audit.${input.routeKey}.generate.v1`,
      owner_component_id: `${input.routeKey}.inference`,
    }],
    data_adapter_registration: {
      registration_version: 1,
      app_id: input.appId,
      binding_id: `data.${input.routeKey}`,
      adapter_contract_version: 1,
      data_contract_version: input.dataContractVersion ?? 1,
      namespace_policy: "host_derived_from_verified_app_id",
      retention_policy: "retain_owner_data_remove_runtime_authority",
      owner_component_id: `${input.routeKey}.domain`,
    },
  };
}

function verifiedPackage(rawManifest: GenericPackageManifest, routeKey: string): VerifiedFirstPartyPackage {
  const descriptorBody = {
    descriptor_version: 2 as const,
    manifest: rawManifest,
    manifest_digest: canonicalJsonDocumentDigest(rawManifest),
    archive_digest: digest(routeKey === "resume-builder" ? "1" : "2"),
  };
  const descriptorDigest = canonicalJsonDocumentDigest(descriptorBody);
  return VerifiedFirstPartyPackageSchema.parse({
    verified_package_version: 1,
    source_entry: {
      source_id: `first-party.${routeKey}`,
      app_id: rawManifest.app_id,
      publisher_id: rawManifest.publisher_id,
      package_version: rawManifest.package_version,
      descriptor_digest: descriptorDigest,
      archive_digest: descriptorBody.archive_digest,
    },
    descriptor: { ...descriptorBody, descriptor_digest: descriptorDigest },
    verification: {
      status: "verified",
      source_signature_valid: true,
      descriptor_signature_valid: true,
      archive_digest_valid: true,
      manifest_digest_valid: true,
    },
  });
}

const resumeRegistration = registration({
  appId: "ai.braindrive.resume-builder",
  routeKey: "resume-builder",
  capability: "resume.definitions.read",
  purpose: "resume.generate",
  dataContractVersion: 4,
});
const briefRegistration = registration({
  appId: "ai.braindrive.brief-builder",
  routeKey: "brief-builder",
  capability: "brief.records.read",
  purpose: "brief.generate",
});
const resumeManifest = manifest({
  appId: resumeRegistration.app_id,
  routeKey: resumeRegistration.route_key,
  displayName: "Resume Builder",
  capability: "resume.definitions.read",
  purpose: "resume.generate",
  dataContractVersion: 4,
});
const briefManifest = manifest({
  appId: briefRegistration.app_id,
  routeKey: briefRegistration.route_key,
  displayName: "Brief Builder",
  capability: "brief.records.read",
  purpose: "brief.generate",
});

describe("FirstPartyAppRegistry", () => {
  it("resolves two exact identities by app ID and route key with stable immutable descriptors", () => {
    const registry = new FirstPartyAppRegistry([briefRegistration, resumeRegistration]);
    expect(registry.listRegistrations().map((entry) => entry.app_id)).toEqual([
      "ai.braindrive.brief-builder",
      "ai.braindrive.resume-builder",
    ]);
    expect(registry.resolveAppId("ai.braindrive.resume-builder").route_key).toBe("resume-builder");
    expect(registry.resolveRouteKey("brief-builder").app_id).toBe("ai.braindrive.brief-builder");

    const first = registry.resolveVerifiedApp("resume-builder", verifiedPackage(resumeManifest, "resume-builder"));
    const second = registry.resolveVerifiedApp("resume-builder", verifiedPackage(resumeManifest, "resume-builder"));
    expect(second).toEqual(first);
    const { descriptor_digest: _descriptorDigest, ...body } = first;
    expect(first.descriptor_digest).toBe(canonicalInputDigest(body));
    expect(first.operation_binding).toBeNull();
    const operationBinding = {
      installation_id: "10000000-0000-4000-8000-000000000001",
      lifecycle_generation: 2,
      grant_id: "10000000-0000-4000-8000-000000000002",
      grant_revision: 3,
    };
    const bound = registry.resolveVerifiedApp("resume-builder", verifiedPackage(resumeManifest, "resume-builder"), operationBinding);
    expect(ResolvedAppDescriptorSchema.parse(bound).operation_binding).toEqual(operationBinding);
    expect(bound.descriptor_digest).not.toBe(first.descriptor_digest);
    expect(() => registry.resolveVerifiedApp("resume-builder", verifiedPackage(resumeManifest, "resume-builder"), {
      ...operationBinding,
      raw_owner_path: "/home/owner",
    })).toThrowError(expect.objectContaining({ code: "descriptor_invalid" }));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.reviewed_authority.capabilities)).toBe(true);
    expect(() => (first.catalog.display_name as string) = "changed").toThrow();
  });

  it.each([
    ["duplicate app ID", [resumeRegistration, { ...resumeRegistration, route_key: "resume-copy" }]],
    ["duplicate route key", [resumeRegistration, { ...briefRegistration, route_key: "resume-builder" }]],
    ["case-folded app collision", [resumeRegistration, { ...briefRegistration, app_id: "AI.BRAINDRIVE.RESUME-BUILDER" }]],
    ["canonical route collision", [resumeRegistration, { ...briefRegistration, route_key: "RESUME-BUILDER" }]],
  ])("rejects %s deterministically", (_label, registrations) => {
    expect(() => new FirstPartyAppRegistry(registrations)).toThrowError(expect.objectContaining({ code: "duplicate_identity" }));
  });

  it("fails closed on package source, descriptor, manifest, publisher, and registration mismatches", () => {
    const registry = new FirstPartyAppRegistry([resumeRegistration, briefRegistration]);
    const valid = verifiedPackage(resumeManifest, "resume-builder");
    const mismatches: unknown[] = [
      { ...valid, source_entry: { ...valid.source_entry, source_id: "first-party.unknown" } },
      { ...valid, source_entry: { ...valid.source_entry, app_id: briefRegistration.app_id } },
      { ...valid, source_entry: { ...valid.source_entry, publisher_id: "ai.example" } },
      { ...valid, source_entry: { ...valid.source_entry, descriptor_digest: digest("9") } },
      { ...valid, descriptor: { ...valid.descriptor, manifest: { ...valid.descriptor.manifest, app_id: briefRegistration.app_id } } },
      { ...valid, descriptor: { ...valid.descriptor, archive_digest: digest("9") } },
    ];
    for (const candidate of mismatches) {
      expect(() => registry.resolveVerifiedApp("resume-builder", candidate)).toThrowError(
        expect.objectContaining({ code: expect.stringMatching(/identity_mismatch|descriptor_invalid/) }),
      );
    }
    expect(() => registry.resolveVerifiedApp("brief-builder", valid)).toThrowError(expect.objectContaining({ code: "identity_mismatch" }));
    expect(() => registry.resolveRouteKey("missing-app")).toThrowError(expect.objectContaining({ code: "registration_missing" }));
  });

  it("requires every requested capability, purpose, and data contract to have a reviewed host binding", () => {
    const registry = new FirstPartyAppRegistry([resumeRegistration]);
    const candidates = [
      { ...resumeManifest, requested_capabilities: [{ name: "resume.unregistered.read", version: 1 }] },
      { ...resumeManifest, requested_inference_purposes: [{ purpose_id: "resume.unregistered", version: 1 }] },
      { ...resumeManifest, compatibility: { ...resumeManifest.compatibility, data_contract_version: 3 } },
    ];
    for (const candidate of candidates) {
      expect(() => registry.resolveVerifiedApp("resume-builder", verifiedPackage(GenericPackageManifestSchema.parse(candidate), "resume-builder")))
        .toThrowError(expect.objectContaining({ code: "registration_missing" }));
    }
  });

  it("rejects incomplete or internally mismatched host registrations before package resolution", () => {
    const invalidRegistrations = [
      { ...resumeRegistration, runtime_profile_id: "" },
      { ...resumeRegistration, lifecycle_binding_id: "" },
      { ...resumeRegistration, data_adapter_registration: undefined },
      { ...resumeRegistration, publisher_id: "ai.example" },
      {
        ...resumeRegistration,
        capability_registrations: [{ ...resumeRegistration.capability_registrations[0], app_id: briefRegistration.app_id }],
      },
    ];
    for (const candidate of invalidRegistrations) {
      expect(() => new FirstPartyAppRegistry([candidate])).toThrowError(expect.objectContaining({ code: "descriptor_invalid" }));
    }
  });

  it("binds the verified primary resource to the selected host route key", () => {
    const registry = new FirstPartyAppRegistry([resumeRegistration]);
    const mismatchedResource = GenericPackageManifestSchema.parse({
      ...resumeManifest,
      primary_resource: { ...resumeManifest.primary_resource, uri: "ui://other-app/main" },
    });
    expect(() => registry.resolveVerifiedApp("resume-builder", verifiedPackage(mismatchedResource, "resume-builder")))
      .toThrowError(expect.objectContaining({ code: "identity_mismatch" }));
  });

  it("rejects unsafe metadata and manifest attempts to name executable host bindings", () => {
    expect(GenericPackageManifestSchema.safeParse({
      ...briefManifest,
      catalog: { ...briefManifest.catalog, summary: "<script>hostAction()</script>" },
    }).success).toBe(false);
    expect(GenericPackageManifestSchema.safeParse({
      ...briefManifest,
      catalog: { ...briefManifest.catalog, summary: "Visit javascript:hostAction()" },
    }).success).toBe(false);
    for (const field of ["handler", "handler_name", "module", "module_path", "import_name", "data_adapter", "inference_policy"]) {
      expect(GenericPackageManifestSchema.safeParse({ ...briefManifest, [field]: "host.internal.execute" }).success, field).toBe(false);
    }
    expect(GenericPackageManifestSchema.safeParse({
      ...briefManifest,
      requested_capabilities: [{ ...briefManifest.requested_capabilities[0], handler: "host.internal.execute" }],
    }).success).toBe(false);
    expect(GenericPackageManifestSchema.safeParse({
      ...briefManifest,
      requested_inference_purposes: [{ ...briefManifest.requested_inference_purposes[0], policy_module: "host.internal.execute" }],
    }).success).toBe(false);
  });

  it("keeps Resume v1 parsing migration-only and rejects generic candidates through that reader", async () => {
    const legacy = LegacyResumePackageManifestSchema.parse(
      JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(new URL("./contracts/fixtures/valid/package-manifest.json", import.meta.url), "utf8"))),
    );
    expect(parseLegacyResumePackageManifestForMigration(legacy)).toEqual(legacy);
    expect(() => parseLegacyResumePackageManifestForMigration({ ...briefManifest, manifest_version: 1 })).toThrowError(
      expect.objectContaining({ code: "package_descriptor_invalid" }),
    );
    expect(GenericPackageManifestSchema.safeParse(legacy).success).toBe(false);
  });

  it("exposes no dynamic registration, package loading, marketplace, or distribution method", () => {
    expect(Object.getOwnPropertyNames(FirstPartyAppRegistry.prototype).sort()).toEqual([
      "constructor", "listRegistrations", "resolveAppId", "resolveRouteKey", "resolveVerifiedApp",
    ].sort());
  });
});
