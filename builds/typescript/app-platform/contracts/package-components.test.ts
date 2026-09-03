import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ContractViolation } from "./errors.js";
import { createJsonSchemaCatalog } from "./generate-json-schemas.js";
import {
  PackageComponentManifestSchema,
  parsePackageComponentManifestForConformance,
  type CapabilityDependency,
  type PackageComponentManifest,
} from "./package-components.js";

const directory = dirname(fileURLToPath(import.meta.url));

type MutationPath = (string | number)[];
type Corpus = {
  corpus_version: number;
  roadmap_id: string;
  valid_cases: {
    fixture_id: string;
    requirements: string[];
    manifest?: PackageComponentManifest;
    manifest_from?: string;
    overrides?: Record<string, unknown>;
  }[];
  invalid_cases: {
    fixture_id: string;
    base: string;
    expected_code: string;
    mutation_path: MutationPath;
    mutation_value: unknown;
  }[];
};

async function corpus(): Promise<Corpus> {
  return JSON.parse(await readFile(resolve(directory, "fixtures", "sidecar-package", "sc-001-conformance-corpus.json"), "utf8"));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function setPath(value: Record<string, unknown>, path: MutationPath, next: unknown): void {
  let cursor: Record<string, unknown> | unknown[] = value;
  for (const key of path.slice(0, -1)) {
    cursor = Array.isArray(cursor) ? cursor[key as number] as Record<string, unknown> : cursor[key as string] as Record<string, unknown>;
  }
  const leaf = path[path.length - 1];
  if (Array.isArray(cursor)) {
    cursor[leaf as number] = next;
  } else {
    cursor[leaf as string] = next;
  }
}

function baseManifest(source: Corpus, fixtureId: string): PackageComponentManifest {
  const fixture = source.valid_cases.find((candidate) => candidate.fixture_id === fixtureId);
  if (!fixture?.manifest) throw new Error(`missing base fixture: ${fixtureId}`);
  return fixture.manifest;
}

function materializeValid(source: Corpus, fixtureId: string): Record<string, unknown> {
  const fixture = source.valid_cases.find((candidate) => candidate.fixture_id === fixtureId);
  if (!fixture) throw new Error(`missing valid fixture: ${fixtureId}`);
  if (fixture.manifest) return clone(fixture.manifest);
  if (fixtureId === "valid-combined-app-provider") return combinedAppProvider(source);
  if (fixtureId === "valid-dependency-service") return dependencyService(source);
  throw new Error(`unknown derived fixture: ${fixtureId}`);
}

function combinedAppProvider(source: Corpus): Record<string, unknown> {
  const manifest = clone(baseManifest(source, "valid-provider-sidecar")) as Record<string, unknown>;
  manifest.package_id = "ai.braindrive.research-workbench";
  manifest.package_kind = ["app", "capability_provider"];
  const files = manifest.files as unknown[];
  files.unshift({
    path: "payload/app/index.html",
    kind: "file",
    mode: "read_only",
    size_bytes: 128,
    digest: "sha256:9999999999999999999999999999999999999999999999999999999999999999",
  });
  const components = manifest.components as unknown[];
  components.unshift({
    component_id: "research.app",
    component_kind: "app",
    display_name: "Research Workbench",
    lifecycle_actions: ["enable", "disable", "start", "stop", "update", "uninstall", "health"],
    sidecars: [],
    app_id: "ai.braindrive.research-workbench",
    route_key: "research-workbench",
    launchable: true,
    requested_capabilities: [{
      operation_id: "web.search@1",
      requirement: "optional",
      unavailable_behavior: "degrade_with_safe_status",
      provider_selection: "owner_or_admin_policy",
      silent_install_or_switch: false,
    }],
  });
  manifest.capability_dependencies = [{
    operation_id: "web.search@1",
    requirement: "optional",
    unavailable_behavior: "degrade_with_safe_status",
    provider_selection: "owner_or_admin_policy",
    silent_install_or_switch: false,
  }];
  return manifest;
}

function dependencyService(source: Corpus): Record<string, unknown> {
  const manifest = clone(baseManifest(source, "valid-app-owned-sidecar")) as Record<string, unknown>;
  manifest.package_id = "ai.braindrive.local-index";
  manifest.package_kind = ["dependency_service"];
  manifest.components = [{
    component_id: "index.service",
    component_kind: "dependency_service",
    display_name: "Local Index Service",
    lifecycle_actions: ["enable", "disable", "start", "stop", "restart", "update", "uninstall", "health"],
    sidecars: ["notes.worker"],
    service_id: "ai.braindrive.local-index.service",
    launchable: false,
    provides: [],
  }];
  const sidecars = manifest.sidecars as Record<string, unknown>[];
  sidecars[0] = {
    ...sidecars[0],
    owner_component_id: "index.service",
    binding: {
      visibility: "host_only",
      transport: "loopback",
      public_bind: false,
      consumer_projection: "never",
    },
  };
  return manifest;
}

function appWithDependency(source: Corpus, dependency: CapabilityDependency): Record<string, unknown> {
  const manifest = clone(baseManifest(source, "valid-app-owned-sidecar")) as Record<string, unknown>;
  manifest.package_id = "ai.braindrive.research-consumer";
  manifest.catalog = { ...(manifest.catalog as Record<string, unknown>), display_name: "Research Consumer" };
  manifest.capability_dependencies = [dependency];
  manifest.components = (manifest.components as Record<string, unknown>[]).map((component) => component.component_kind === "app"
    ? { ...component, display_name: "Research Consumer", app_id: "ai.braindrive.research-consumer", route_key: "research-consumer", requested_capabilities: [dependency] }
    : component);
  return manifest;
}

describe("SC-001 package component manifest conformance", () => {
  it("admits app, capability-provider, combined, and dependency-service package shapes", async () => {
    const source = await corpus();
    expect(source).toMatchObject({ corpus_version: 1, roadmap_id: "SC-001" });
    const expected = [
      "valid-app-owned-sidecar",
      "valid-provider-sidecar",
      "valid-combined-app-provider",
      "valid-dependency-service",
    ];
    expect(source.valid_cases.map((fixture) => fixture.fixture_id)).toEqual(expected);

    for (const fixtureId of expected) {
      const manifest = parsePackageComponentManifestForConformance(materializeValid(source, fixtureId));
      expect(manifest.package_kind.length, fixtureId).toBeGreaterThanOrEqual(1);
      expect(manifest.diagnostics.store_private_bindings, fixtureId).toBe(false);
      expect(manifest.diagnostics.store_credentials, fixtureId).toBe(false);
      expect(manifest.evidence.durable_evidence_content, fixtureId).toBe("content_free_no_endpoints_no_secrets");
      expect(manifest.evidence.stale_on, fixtureId).toEqual(expect.arrayContaining([
        "manifest_change",
        "adapter_change",
        "sidecar_target_change",
        "runtime_target_change",
        "network_policy_change",
        "permission_change",
        "operation_contract_change",
        "provider_version_change",
        "security_boundary_change",
        "retention_policy_change",
        "diagnostics_policy_change",
      ]));
    }
  });

  it("keeps component launchability separate from capability providers and dependency services", async () => {
    const source = await corpus();
    const provider = parsePackageComponentManifestForConformance(materializeValid(source, "valid-provider-sidecar"));
    expect(provider.components).toHaveLength(1);
    expect(provider.components[0]).toMatchObject({ component_kind: "capability_provider", launchable: false });

    const combined = parsePackageComponentManifestForConformance(materializeValid(source, "valid-combined-app-provider"));
    expect(combined.components.map((component) => [component.component_kind, component.launchable])).toEqual([
      ["app", true],
      ["capability_provider", false],
    ]);

    const dependency = parsePackageComponentManifestForConformance(materializeValid(source, "valid-dependency-service"));
    expect(dependency.components).toHaveLength(1);
    expect(dependency.components[0]).toMatchObject({ component_kind: "dependency_service", launchable: false });
  });

  it("admits rich desktop packaged-process targets as admission-only metadata", async () => {
    const source = await corpus();
    const manifest = parsePackageComponentManifestForConformance(materializeValid(source, "valid-app-owned-sidecar"));
    const [sidecar] = manifest.sidecars;
    const desktopTargets = sidecar.targets.filter((target) => target.runtime_kind === "packaged_process");
    expect(desktopTargets.map((target) => target.target)).toEqual(["desktop_windows_x64", "desktop_macos_universal"]);
    expect(manifest.evidence.stale_on).toEqual(expect.arrayContaining([
      "dependency_bundle_change",
      "lockfile_change",
      "resource_budget_change",
      "signing_evidence_change",
      "license_provenance_change",
    ]));

    for (const target of desktopTargets) {
      expect(target.bind).toBe("loopback");
      expect(target.public_network).toBe(false);
      expect(target.dependency_bundle.platform).toBe(target.target);
      expect(target.dependency_bundle.dependencies).toHaveLength(1);
      expect(target.dependency_bundle.cache.mutable_global_fallback).toBe(false);
      expect(target.resources).toMatchObject({
        resource_budget_version: 1,
        startup_timeout_ms: 20000,
        health_timeout_ms: 5000,
        restart_attempts: 2,
      });
      expect(target.network_policy).toMatchObject({
        binding: "private_random_loopback",
        public_inbound: false,
        local_network: "deny_by_default",
        self_update: false,
      });
      expect(target.evidence).toMatchObject({
        support_claim: "admission_only",
        required_evidence: expect.arrayContaining([
          "dependency_lock_digest",
          "resource_budget_declared",
          "network_policy_declared",
          "signing_metadata",
          "license_provenance",
        ]),
        stale_on: expect.arrayContaining([
          "dependency_bundle_change",
          "lockfile_change",
          "resource_budget_change",
          "network_policy_change",
          "signing_evidence_change",
          "license_provenance_change",
        ]),
      });
      expect(target.evidence.signing.signature_state).toBe("declared_required_not_yet_qualified");
    }
  });

  it("admits canonical Search and Read dependency contracts with explicit availability behavior", async () => {
    const source = await corpus();
    const requiredSearch: CapabilityDependency = {
      operation_id: "web.search@1",
      requirement: "required",
      unavailable_behavior: "block_activation",
      provider_selection: "owner_or_admin_policy",
      silent_install_or_switch: false,
    };
    const optionalRead: CapabilityDependency = {
      operation_id: "web.read@1",
      requirement: "optional",
      unavailable_behavior: "degrade_with_safe_status",
      provider_selection: "owner_or_admin_policy",
      silent_install_or_switch: false,
    };

    const required = parsePackageComponentManifestForConformance(appWithDependency(source, requiredSearch));
    expect(required.capability_dependencies).toEqual([requiredSearch]);
    expect(required.components[0]).toMatchObject({ component_kind: "app", requested_capabilities: [requiredSearch] });

    const optional = parsePackageComponentManifestForConformance(appWithDependency(source, optionalRead));
    expect(optional.capability_dependencies).toEqual([optionalRead]);
    expect(optional.components[0]).toMatchObject({ component_kind: "app", requested_capabilities: [optionalRead] });
  });

  it("rejects invalid, unsafe, unsupported, and authority-widening manifests with typed failures", async () => {
    const source = await corpus();
    for (const fixture of source.invalid_cases) {
      const manifest = materializeValid(source, fixture.base);
      setPath(manifest, fixture.mutation_path, fixture.mutation_value);
      expect(PackageComponentManifestSchema.safeParse(manifest).success, fixture.fixture_id).toBe(false);
      expect(() => parsePackageComponentManifestForConformance(manifest), fixture.fixture_id)
        .toThrowError(ContractViolation);
      try {
        parsePackageComponentManifestForConformance(manifest);
      } catch (error) {
        expect(error).toMatchObject({ code: fixture.expected_code });
      }
    }
  });

  it("rejects private binding, endpoint, provider payload, host path, and host handler authority fields", async () => {
    const source = await corpus();
    const forbidden = [
      "endpoint",
      "endpoint_url",
      "private_binding",
      "host_path",
      "raw_response",
      "host_handler",
      "module_path",
      "service_name",
      "port",
    ];
    for (const field of forbidden) {
      const manifest = materializeValid(source, "valid-provider-sidecar");
      setPath(manifest, ["components", 0, field], "host.internal.value");
      expect(() => parsePackageComponentManifestForConformance(manifest), field).toThrowError(
        expect.objectContaining({ code: "forbidden_field" }),
      );
    }
  });

  it("registers package-component schemas in the generated schema catalog", () => {
    const catalog = createJsonSchemaCatalog();
    expect(Object.keys(catalog)).toEqual(expect.arrayContaining([
      "package-component-manifest",
      "sidecar-descriptor",
      "provided-operation",
      "package-component-capability-dependency",
      "package-component-diagnostics-policy",
      "package-component-evidence-policy",
    ]));
    expect(catalog["package-component-manifest"]).toMatchObject({
      $id: "https://schemas.braindrive.ai/app-platform/v1/package-component-manifest.schema.json",
    });
  });
});
