import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createInternetSearchProviderRuntime,
  digestInternetSearchProviderManifest,
  INTERNET_SEARCH_LEGACY_ENV_SHIM,
  INTERNET_SEARCH_PROVIDER_COMPONENT_ID,
  INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
  INTERNET_SEARCH_SIDECAR_COMPONENT_ID,
  loadInternetSearchProviderManifest,
} from "./provider-package.js";
import { dependencyResolverFromCapabilityProviderRegistry } from "../app-capabilities/provider-router.js";
import type { PackageComponentManifest } from "../app-platform/contracts/package-components.js";
import { createCatalogPackageService } from "../app-platform/lifecycle/catalog-package-service.js";
import { InstalledPackageStore } from "../app-platform/lifecycle/installed-package-store.js";
import { createStoredZip } from "../app-platform/lifecycle/zip.js";
import type { WebReadExecutor } from "./read-adapter.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-sc005-provider-package-"));
  roots.push(root);
  return root;
}

function shimEnv(): NodeJS.ProcessEnv {
  return {
    BRAINDRIVE_INTERNET_SEARCH_SIDECAR_URL: "http://internet-search-searxng:8080",
    BRAINDRIVE_INTERNET_SEARCH_HEALTH_TIMEOUT_MS: "25",
    BRAINDRIVE_INTERNET_SEARCH_STARTUP_TIMEOUT_MS: "25",
    BRAINDRIVE_INTERNET_SEARCH_READINESS_POLL_MS: "1",
  };
}

async function runtime(input: {
  fetchImpl?: typeof fetch;
  readExecutor?: WebReadExecutor | null;
} = {}) {
  const root = await tempRoot();
  const memoryRoot = path.join(root, "memory");
  const stateRoot = path.join(root, "state");
  const packageStore = await seedInstalledInternetSearchPackage({ stateRoot });
  return createInternetSearchProviderRuntime({
    rootDir: process.cwd(),
    memoryRoot,
    stateRoot,
    env: shimEnv(),
    packageStore,
    fetchImpl: input.fetchImpl ?? (async () => new Response("ok", { status: 200 })),
    readExecutor: input.readExecutor ?? null,
  });
}

async function descriptorRuntime(input: {
  fetchImpl?: typeof fetch;
  readExecutor?: WebReadExecutor | null;
} = {}) {
  const root = await tempRoot();
  const memoryRoot = path.join(root, "memory");
  const stateRoot = path.join(root, "state");
  const packageStore = await seedInstalledInternetSearchPackage({ stateRoot });
  const descriptorPath = path.join(root, "runtime-descriptors.json");
  await writeFile(descriptorPath, JSON.stringify({
    descriptor_version: 1,
    target: "docker_linux_x64",
    sidecars: [{
      package_id: INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
      component_id: INTERNET_SEARCH_SIDECAR_COMPONENT_ID,
      target: "docker_linux_x64",
      runtime_kind: "container",
      transport: "container_internal",
      service_name: "bdsc-0000000000000001",
      endpoint: "http://bdsc-0000000000000001:8080",
      health_path: "/healthz",
    }],
  }), "utf8");
  return createInternetSearchProviderRuntime({
    rootDir: process.cwd(),
    memoryRoot,
    stateRoot,
    env: {
      BRAINDRIVE_SIDECAR_RUNTIME_DESCRIPTOR_FILE: descriptorPath,
      BRAINDRIVE_SIDECAR_STARTUP_TIMEOUT_MS: "25",
      BRAINDRIVE_SIDECAR_READINESS_POLL_MS: "1",
    },
    packageStore,
    fetchImpl: input.fetchImpl ?? (async () => new Response("ok", { status: 200 })),
    readExecutor: input.readExecutor ?? null,
  });
}

async function seedInstalledInternetSearchPackage(input: {
  stateRoot: string;
  manifest?: PackageComponentManifest;
}): Promise<InstalledPackageStore> {
  const store = new InstalledPackageStore(path.join(input.stateRoot, "state", "packages"));
  await store.initialize();
  const manifest = input.manifest ?? await loadInternetSearchProviderManifest(process.cwd());
  await store.installPackage({
    manifest,
    packageDigest: digestInternetSearchProviderManifest(manifest),
    source: { kind: "repository_fixture", label: "Internet Search provider package fixture" },
    installedAt: "2026-09-01T00:00:00.000Z",
  });
  return store;
}

function noLeak(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(/internet-search-searxng|localhost|127\.|0\.0\.0\.0|\bport\b|credential|secret|vault|authorization|cookie|\/home\/|raw_response|CANARY_/i);
}

function digest(value: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function packageComponentFixture(fixtureId: string): Promise<PackageComponentManifest> {
  const raw = await readFile(new URL("../app-platform/contracts/fixtures/sidecar-package/sc-001-conformance-corpus.json", import.meta.url), "utf8");
  const source = JSON.parse(raw) as { valid_cases: Array<{ fixture_id: string; manifest?: PackageComponentManifest }> };
  const manifest = source.valid_cases.find((candidate) => candidate.fixture_id === fixtureId)?.manifest;
  if (!manifest) throw new Error(`missing fixture: ${fixtureId}`);
  return JSON.parse(JSON.stringify(manifest)) as PackageComponentManifest;
}

function withSearchDependency(
  manifest: PackageComponentManifest,
  appId: string,
  routeKey: string,
  requirement: "required" | "optional",
): PackageComponentManifest {
  const dependency = {
    operation_id: "web.search@1",
    requirement,
    unavailable_behavior: requirement === "required" ? "block_activation" as const : "degrade_with_safe_status" as const,
    provider_selection: "owner_or_admin_policy" as const,
    silent_install_or_switch: false as const,
  };
  return {
    ...manifest,
    package_id: appId,
    catalog: { ...manifest.catalog, display_name: "Research Consumer" },
    components: manifest.components.map((component) => component.component_kind === "app"
      ? { ...component, display_name: "Research Consumer", app_id: appId, route_key: routeKey, requested_capabilities: [dependency] }
      : component),
    capability_dependencies: [dependency],
  };
}

async function writeInternetSearchCatalogPackage(root: string): Promise<{
  catalogPath: string;
  archiveDigest: `sha256:${string}`;
}> {
  const sourceRoot = path.join(root, "catalog-source");
  const artifactRoot = path.join(sourceRoot, "artifacts", "internet-search", "0.1.0", "local-dev", "desktop-windows-x64");
  const sourceIndexPath = path.join(sourceRoot, "source-indexes", "internet-search", "0.1.0", "local-dev", "source-index.json");
  const trustRootPath = path.join(sourceRoot, "trust-roots", "internet-search", "local-dev", "trust-root.json");
  const revocationPath = path.join(sourceRoot, "revocations", "internet-search", "local-dev", "revocation-list.json");
  await Promise.all([
    mkdir(artifactRoot, { recursive: true }),
    mkdir(path.dirname(sourceIndexPath), { recursive: true }),
    mkdir(path.dirname(trustRootPath), { recursive: true }),
    mkdir(path.dirname(revocationPath), { recursive: true }),
  ]);

  const manifest = await loadInternetSearchProviderManifest(process.cwd());
  const packageManifest = JSON.parse(JSON.stringify(manifest)) as PackageComponentManifest;
  const packageEntries = packageManifest.files.map((file) => {
    const bytes = Buffer.from(`catalog fixture content for ${file.path}\n`, "utf8");
    file.size_bytes = bytes.byteLength;
    file.digest = digest(bytes);
    return { name: file.path, bytes, executable: file.mode === "executable" };
  });
  const filesByPath = new Map(packageManifest.files.map((file) => [file.path, file]));
  for (const target of packageManifest.sidecars.flatMap((sidecar) => sidecar.targets)) {
    if (target.runtime_kind !== "packaged_process") continue;
    target.dependency_bundle.bundle_digest = filesByPath.get(target.artifact_path)!.digest;
    target.dependency_bundle.lockfile_digest = filesByPath.get(target.dependency_bundle.lockfile_path)!.digest;
    target.dependency_bundle.provenance_digest = filesByPath.get(target.dependency_bundle.provenance_path)!.digest;
    target.dependency_bundle.sbom_digest = filesByPath.get(target.dependency_bundle.sbom_path)!.digest;
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");
  const archiveBytes = createStoredZip([
    { name: "manifest.json", bytes: manifestBytes, executable: false },
    ...packageEntries,
  ]);
  const archiveDigest = digest(archiveBytes);
  const descriptor = {
    descriptor_version: 1,
    package_id: INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
    publisher_id: "ai.braindrive",
    package_version: "0.1.0",
    manifest_package_version: packageManifest.package_version,
    package_kind: ["capability_provider"],
    release_channel: "local-dev",
    target: "desktop_windows_x64",
    archive: { format: "zip", profile: "braindrive-package-v2", digest: archiveDigest, manifest_path: "manifest.json" },
    safe_presentation: packageManifest.catalog,
    relationship_projection: {
      launchable_app: false,
      provides_operations: ["web.search@1", "web.read@1"],
      requires_operations: [],
      depends_on_packages: [],
    },
    authority_boundary: "host_verifies_registers_supervises_and_preserves_owner_data",
  };
  const descriptorBytes = Buffer.from(`${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  const sourceIndexBytes = Buffer.from("{\"source_index_version\":1}\n", "utf8");
  const trustRootBytes = Buffer.from("{\"trust_root_version\":1}\n", "utf8");
  const revocationBytes = Buffer.from("{\"revocation_list_version\":1}\n", "utf8");
  const archiveName = "braindrive-internet-search-0.1.0-local.dev-desktop-windows-x64.bdcap";
  await writeFile(path.join(artifactRoot, "descriptor.json"), descriptorBytes);
  await writeFile(path.join(artifactRoot, archiveName), archiveBytes);
  await writeFile(sourceIndexPath, sourceIndexBytes);
  await writeFile(trustRootPath, trustRootBytes);
  await writeFile(revocationPath, revocationBytes);

  const catalog = {
    catalog_version: 1,
    catalog_id: "ai.braindrive.stage1.local-dev",
    publisher_id: "ai.braindrive",
    release_channel: "local-dev",
    generated_at: "2026-09-09T00:00:00.000Z",
    authority_boundary: {
      catalog_role: "discovery_and_retrieval_metadata_only",
      package_scope: "braindrive_built_and_reviewed",
      host_retains_authority: [
        "package_verification",
        "trust_evaluation",
        "compatibility_filtering",
        "revocation_checking",
        "reviewed_registration_joins",
        "install_update_decisions",
        "lifecycle_state",
        "runtime_supervision",
        "owner_data_preservation",
      ],
      stage1_exclusions: [
        "public_marketplace",
        "third_party_publishing",
        "arbitrary_local_package_installation",
        "source_neutral_registry",
        "owner_added_production_trust_roots",
        "open_registry",
        "federation_claim",
        "catalog_runtime_authority",
      ],
    },
    entries: [{
      package_identity: {
        package_id: INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
        publisher_id: "ai.braindrive",
        package_kind: ["capability_provider"],
        version: "0.1.0",
      },
      release: { channel: "local-dev", artifact_name: archiveName, status: "local_dev_verified" },
      target_artifacts: [{
        target: "desktop_windows_x64",
        descriptor: { reference: "artifacts/internet-search/0.1.0/local-dev/desktop-windows-x64/descriptor.json", digest: digest(descriptorBytes) },
        archive: { reference: `artifacts/internet-search/0.1.0/local-dev/desktop-windows-x64/${archiveName}`, digest: archiveDigest },
        source_index: { reference: "source-indexes/internet-search/0.1.0/local-dev/source-index.json", digest: digest(sourceIndexBytes) },
        trust_root: { reference: "trust-roots/internet-search/local-dev/trust-root.json", digest: digest(trustRootBytes) },
        revocation: { reference: "revocations/internet-search/local-dev/revocation-list.json", digest: digest(revocationBytes) },
      }],
      compatibility: {
        manifest_version: 2,
        package_profile: "braindrive-package-v2",
        host_min_version: "0.1.0",
        mcp_protocol: "2026-07-28",
        mcp_apps_extension: { extension_id: "io.modelcontextprotocol/ui", version: "2026-01-26" },
        targets: ["desktop_windows_x64"],
      },
      safe_presentation: packageManifest.catalog,
      relationship_projection: {
        launchable_app: false,
        provides_operations: ["web.search@1", "web.read@1"],
        requires_operations: [],
        depends_on_packages: [],
      },
      security_projection: {
        catalog_role: "discovery_and_retrieval_metadata_only",
        runtime_authority: false,
        install_decision: false,
        owner_trust_roots: false,
        private_binding_projection: "never",
      },
    }],
  };
  const catalogPath = path.join(sourceRoot, "catalog", "stage1", "catalog.json");
  await mkdir(path.dirname(catalogPath), { recursive: true });
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  return { catalogPath, archiveDigest };
}

describe("SC-005 Internet Search proof provider package migration", () => {
  it("loads the SearXNG proof as a v2 package/component provider fixture", async () => {
    const manifest = await loadInternetSearchProviderManifest(process.cwd());
    const [sidecar] = manifest.sidecars;
    const targets = sidecar!.targets;
    const dockerTarget = targets.find((target) => target.target === "docker_linux_x64");
    const desktopTargets = targets.filter((target) => target.runtime_kind === "packaged_process");

    expect(manifest).toMatchObject({
      manifest_version: 2,
      package_id: INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
      package_kind: ["capability_provider"],
      components: [{
        component_id: INTERNET_SEARCH_PROVIDER_COMPONENT_ID,
        component_kind: "capability_provider",
        launchable: false,
        provides: ["web.search@1", "web.read@1"],
      }],
      sidecars: [{
        component_id: INTERNET_SEARCH_SIDECAR_COMPONENT_ID,
        owner_component_id: INTERNET_SEARCH_PROVIDER_COMPONENT_ID,
        binding: {
          visibility: "provider_adapter_only",
          public_bind: false,
          consumer_projection: "never",
        },
      }],
    });
    expect(dockerTarget).toMatchObject({
      target: "docker_linux_x64",
      runtime_kind: "container",
      image: "searxng/searxng:2026.9",
      public_network: false,
    });
    expect(desktopTargets.map((target) => target.target).sort()).toEqual(["desktop_macos_universal", "desktop_windows_x64"]);
    expect(manifest.provided_operations.find((operation) => operation.operation_id === "web.search@1")?.required_sidecars).toEqual(["search.runtime"]);
    expect(manifest.provided_operations.find((operation) => operation.operation_id === "web.read@1")?.required_sidecars).toEqual([]);
    expect(manifest.evidence.stale_on).toEqual(expect.arrayContaining([
      "dependency_bundle_change",
      "lockfile_change",
      "resource_budget_change",
      "signing_evidence_change",
      "license_provenance_change",
    ]));

    for (const target of desktopTargets) {
      expect(target).toMatchObject({
        bind: "loopback",
        public_network: false,
        dependency_bundle: {
          platform: target.target,
          cache: {
            strategy: "package_version_isolated",
            content_address: null,
            mutable_global_fallback: false,
          },
          dependencies: expect.arrayContaining([
            expect.objectContaining({ name: "self-contained-searxng-compatible-search", kind: "runtime", version: "1.0.0", license_id: "MIT" }),
            expect.objectContaining({ name: "reqwest-rust-client", kind: "language_package", version: "0.12.28", license_id: "MIT+Apache-2.0" }),
            expect.objectContaining({ name: "rustls-tls-stack", kind: "native_library", version: "0.23.45", license_id: "MIT+Apache-2.0" }),
          ]),
        },
        resources: {
          resource_budget_version: 1,
          startup_timeout_ms: 10000,
          health_timeout_ms: 2000,
          stop_timeout_ms: 2000,
          restart_attempts: 2,
          cpu_percent: 25,
          memory_mb: 128,
          disk_mb: 64,
          cache_mb: 16,
          log_bytes: 262144,
          max_output_event_bytes: 8192,
        },
        network_policy: {
          network_policy_version: 1,
          binding: "private_random_loopback",
          outbound: ["provider_upstream_https"],
          public_inbound: false,
          local_network: "deny_by_default",
          proxy: "inherit_host_proxy",
          owner_approval: "owner_visible_network_access",
          self_update: false,
        },
        evidence: {
          support_claim: "admission_only",
          signing: { signature_state: "declared_required_not_yet_qualified" },
          required_evidence: expect.arrayContaining(["dependency_lock_digest", "resource_budget_declared", "network_policy_declared", "signing_metadata", "license_provenance"]),
        },
      });
    }
    expect(desktopTargets.find((target) => target.target === "desktop_windows_x64")?.evidence.signing.platform_signature).toBe("windows_authenticode_required");
    expect(desktopTargets.find((target) => target.target === "desktop_macos_universal")?.evidence.signing.platform_signature).toBe("macos_codesign_notarization_required");
    expect(JSON.stringify(desktopTargets)).not.toMatch(/Docker Desktop|native support|supported on Windows|supported on macOS|localhost|127\.|0\.0\.0\.0|\bport\b|token|secret|credential|raw_log|provider payload/i);
  });

  it("can load the provider manifest from an extracted package repo root", async () => {
    const root = await tempRoot();
    const externalRoot = path.join(root, "braindrive-internet-search");
    await mkdir(externalRoot, { recursive: true });
    await writeFile(path.join(externalRoot, "manifest.json"), await readFile(path.resolve(process.cwd(), "../internet_search/manifest.json"), "utf8"), "utf8");

    const manifest = await loadInternetSearchProviderManifest("/no/ws5/root", {
      BRAINDRIVE_INTERNET_SEARCH_PACKAGE_ROOT: externalRoot,
    });

    expect(manifest.package_id).toBe(INTERNET_SEARCH_PROVIDER_PACKAGE_ID);
    expect(manifest.package_kind).toEqual(["capability_provider"]);
  });

  it("does not install the provider package merely because the Stage 1 catalog lists it", async () => {
    const root = await tempRoot();
    const { catalogPath } = await writeInternetSearchCatalogPackage(root);

    const providerRuntime = await createInternetSearchProviderRuntime({
      rootDir: path.join(root, "missing-host-fixtures"),
      memoryRoot: path.join(root, "memory"),
      stateRoot: path.join(root, "state"),
      hostVersion: "26.7.23",
      target: "desktop_windows_x64",
      catalogSource: { kind: "local_file", catalogPath },
      env: {
        BRAINDRIVE_INTERNET_SEARCH_STARTUP_TIMEOUT_MS: "25",
        BRAINDRIVE_INTERNET_SEARCH_READINESS_POLL_MS: "1",
      },
      fetchImpl: async () => new Response("not ready", { status: 503 }),
    });

    try {
      const installed = await providerRuntime.packageStore.readPackage(INTERNET_SEARCH_PROVIDER_PACKAGE_ID);
      expect(installed).toBeNull();
      expect(await providerRuntime.providerRegistry.discover("web.search@1", { authorized: true })).toMatchObject({
        state: "unavailable",
        callable: false,
        provider_count: 0,
      });
      expect(await providerRuntime.packageStore.ownerSafeCatalog({ currentTarget: "desktop_windows_x64" })).toEqual([]);
      const catalogPackageService = createCatalogPackageService({
        catalogSource: { kind: "local_file", catalogPath },
        packageStore: providerRuntime.packageStore,
        memoryRoot: path.join(root, "memory"),
        stateRoot: path.join(root, "state"),
        target: "desktop_windows_x64",
      });
      const availablePackages = await catalogPackageService.availablePackages();
      expect(availablePackages).toHaveLength(1);
      expect(availablePackages[0]).toMatchObject({
        identity: {
          package_id: INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
          installation_id: null,
          package_digest: null,
        },
        state: "not_installed",
        version: { installed: null, available: "1.0.0" },
        available_actions: ["install"],
      });
    } finally {
      await providerRuntime.close();
    }
  });

  it("can explicitly install the provider package from the Stage 1 catalog", async () => {
    const root = await tempRoot();
    const { catalogPath, archiveDigest } = await writeInternetSearchCatalogPackage(root);

    const providerRuntime = await createInternetSearchProviderRuntime({
      rootDir: path.join(root, "missing-host-fixtures"),
      memoryRoot: path.join(root, "memory"),
      stateRoot: path.join(root, "state"),
      hostVersion: "26.7.23",
      target: "desktop_windows_x64",
      catalogSource: { kind: "local_file", catalogPath },
      env: {
        BRAINDRIVE_INTERNET_SEARCH_STARTUP_TIMEOUT_MS: "25",
        BRAINDRIVE_INTERNET_SEARCH_READINESS_POLL_MS: "1",
      },
      fetchImpl: async () => new Response("not ready", { status: 503 }),
    });

    try {
      const catalogPackageService = createCatalogPackageService({
        catalogSource: { kind: "local_file", catalogPath },
        packageStore: providerRuntime.packageStore,
        memoryRoot: path.join(root, "memory"),
        stateRoot: path.join(root, "state"),
        target: "desktop_windows_x64",
      });
      await catalogPackageService.installPackage(INTERNET_SEARCH_PROVIDER_PACKAGE_ID);
      const installed = await providerRuntime.packageStore.readPackage(INTERNET_SEARCH_PROVIDER_PACKAGE_ID);
      expect(installed).toMatchObject({
        package_id: INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
        package_digest: archiveDigest,
        source: { kind: "local_package", label: "BrainDrive Stage 1 catalog" },
      });
      expect(await readFile(path.join(root, "state", "state", "packages", "catalog-extracted", archiveDigest.slice("sha256:".length), "manifest.json"), "utf8"))
        .toContain(INTERNET_SEARCH_PROVIDER_PACKAGE_ID);
    } finally {
      await providerRuntime.close();
    }
  });

  it("does not install or update the provider package from host manifest environment variables", async () => {
    const root = await tempRoot();
    const externalRoot = path.join(root, "braindrive-internet-search");
    const memoryRoot = path.join(root, "memory");
    const stateRoot = path.join(root, "state");
    await mkdir(externalRoot, { recursive: true });
    const rawManifest = await readFile(path.resolve(process.cwd(), "../internet_search/manifest.json"), "utf8");
    const firstManifest = JSON.parse(rawManifest) as PackageComponentManifest;
    firstManifest.package_version = "0.9.0";
    const seededStore = await seedInstalledInternetSearchPackage({ stateRoot, manifest: firstManifest });
    await writeFile(path.join(externalRoot, "manifest.json"), `${JSON.stringify(firstManifest, null, 2)}\n`, "utf8");

    const firstRuntime = await createInternetSearchProviderRuntime({
      rootDir: "/no/ws5/root",
      memoryRoot,
      stateRoot,
      target: "docker_linux_x64",
      env: { BRAINDRIVE_INTERNET_SEARCH_PACKAGE_ROOT: externalRoot },
      packageStore: seededStore,
      searchExecutor: null,
      readExecutor: null,
    });
    const firstRecord = await firstRuntime.packageStore.readPackage(INTERNET_SEARCH_PROVIDER_PACKAGE_ID);
    await firstRuntime.close();

    await writeFile(path.join(externalRoot, "manifest.json"), rawManifest, "utf8");
    const secondRuntime = await createInternetSearchProviderRuntime({
      rootDir: "/no/ws5/root",
      memoryRoot,
      stateRoot,
      target: "docker_linux_x64",
      env: { BRAINDRIVE_INTERNET_SEARCH_PACKAGE_ROOT: externalRoot },
      packageStore: seededStore,
      searchExecutor: null,
      readExecutor: null,
    });

    try {
      const secondRecord = await secondRuntime.packageStore.readPackage(INTERNET_SEARCH_PROVIDER_PACKAGE_ID);
      expect(secondRecord?.generation).toBe(1);
      expect(secondRecord?.package_version).toBe("0.9.0");
      expect(secondRecord?.package_digest).toBe(firstRecord?.package_digest);
      expect(secondRecord?.previous_package_digest).toBeNull();
      expect(await secondRuntime.packageStore.readComponent(INTERNET_SEARCH_PROVIDER_PACKAGE_ID, INTERNET_SEARCH_SIDECAR_COMPONENT_ID))
        .toMatchObject({ state: "stopped", health: "unknown" });
    } finally {
      await secondRuntime.close();
    }
  });

  it("keeps desktop packaged-process targets as admission-only metadata instead of Docker fallback", async () => {
    const root = await tempRoot();
    const memoryRoot = path.join(root, "memory");
    const stateRoot = path.join(root, "state");
    const packageStore = await seedInstalledInternetSearchPackage({ stateRoot });
    const providerRuntime = await createInternetSearchProviderRuntime({
      rootDir: path.join(root, "missing-host-fixtures"),
      memoryRoot,
      stateRoot,
      target: "desktop_windows_x64",
      env: {},
      packageStore,
      searchExecutor: null,
      readExecutor: null,
    });

    try {
      const manifest = await providerRuntime.packageStore.readPackage(INTERNET_SEARCH_PROVIDER_PACKAGE_ID);
      const sidecar = await providerRuntime.packageStore.readComponent(INTERNET_SEARCH_PROVIDER_PACKAGE_ID, INTERNET_SEARCH_SIDECAR_COMPONENT_ID);
      expect(manifest?.manifest.sidecars[0]?.targets.some((target) => target.target === "desktop_windows_x64" && target.runtime_kind === "packaged_process")).toBe(true);
      expect(await providerRuntime.providerRegistry.discover("web.search@1", { authorized: true })).toMatchObject({
        state: "unavailable",
        callable: false,
        failure: { code: "provider_unavailable" },
      });
      expect(await providerRuntime.providerRegistry.discover("web.read@1", { authorized: true })).toMatchObject({
        state: "available",
        callable: true,
      });
      expect(sidecar).toMatchObject({ state: "stopped", health: "unknown" });
      expect(providerRuntime.migrationShim).toBeNull();
      noLeak(await providerRuntime.packageStore.ownerSafeCatalog({ currentTarget: "desktop_windows_x64" }));
    } finally {
      await providerRuntime.close();
    }
  });

  it("starts without installing Internet Search when no catalog package manifest is present", async () => {
    const root = await tempRoot();
    const previousCwd = process.cwd();
    let providerRuntime!: Awaited<ReturnType<typeof createInternetSearchProviderRuntime>>;
    try {
      process.chdir(root);
      providerRuntime = await createInternetSearchProviderRuntime({
        rootDir: root,
        memoryRoot: path.join(root, "memory"),
        stateRoot: path.join(root, "state"),
        target: "desktop_macos_universal",
        env: {},
        searchExecutor: null,
        readExecutor: null,
      });
    } finally {
      process.chdir(previousCwd);
    }

    try {
      expect(await providerRuntime.packageStore.readPackage(INTERNET_SEARCH_PROVIDER_PACKAGE_ID)).toBeNull();
      expect(await providerRuntime.providerRegistry.discover("web.search@1", { authorized: true })).toMatchObject({
        state: "unavailable",
        callable: false,
      });
      expect(providerRuntime.migrationShim).toBeNull();
    } finally {
      await providerRuntime.close();
    }
  });

  it("does not auto-install Internet Search from the host source manifest", async () => {
    const root = await tempRoot();
    const providerRuntime = await createInternetSearchProviderRuntime({
      rootDir: process.cwd(),
      memoryRoot: path.join(root, "memory"),
      stateRoot: path.join(root, "state"),
      target: "docker_linux_x64",
      env: {},
      searchExecutor: null,
      readExecutor: null,
    });

    try {
      expect(await providerRuntime.packageStore.readPackage(INTERNET_SEARCH_PROVIDER_PACKAGE_ID)).toBeNull();
      expect(await providerRuntime.providerRegistry.discover("web.search@1", { authorized: true })).toMatchObject({
        state: "unavailable",
        callable: false,
      });
    } finally {
      await providerRuntime.close();
    }
  });

  it("does not report stale desktop search availability when no live sidecar binding can be rebuilt", async () => {
    const root = await tempRoot();
    const memoryRoot = path.join(root, "memory");
    const stateRoot = path.join(root, "state");
    const packageStore = await seedInstalledInternetSearchPackage({ stateRoot });
    const seedRuntime = await createInternetSearchProviderRuntime({
      rootDir: process.cwd(),
      memoryRoot,
      stateRoot,
      target: "docker_linux_x64",
      env: {},
      packageStore,
      searchExecutor: null,
      readExecutor: null,
      now: () => "2026-09-15T16:08:29.000Z",
    });
    await seedRuntime.packageStore.setSidecarRuntimeState(
      INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
      INTERNET_SEARCH_SIDECAR_COMPONENT_ID,
      "running",
      "healthy",
      "2026-09-15T16:08:29.000Z",
    );
    await seedRuntime.close();

    const previousCwd = process.cwd();
    let providerRuntime!: Awaited<ReturnType<typeof createInternetSearchProviderRuntime>>;
    try {
      process.chdir(root);
      providerRuntime = await createInternetSearchProviderRuntime({
        rootDir: root,
        memoryRoot,
        stateRoot,
        target: "desktop_windows_x64",
        env: {},
        packageStore,
        searchExecutor: null,
        readExecutor: null,
        now: () => "2026-09-15T16:08:30.000Z",
      });
    } finally {
      process.chdir(previousCwd);
    }

    try {
      if (!providerRuntime.capabilityRegistry.refresh) throw new Error("provider runtime must expose refresh");
      await providerRuntime.capabilityRegistry.refresh();
      const discovery = await providerRuntime.capabilityRegistry.discover("web.search@1", { authorized: true });
      expect(discovery).toMatchObject({
        state: "unavailable",
        callable: false,
        health: { state: "unknown" },
      });
      expect(await providerRuntime.packageStore.readComponent(INTERNET_SEARCH_PROVIDER_PACKAGE_ID, INTERNET_SEARCH_SIDECAR_COMPONENT_ID))
        .toMatchObject({ state: "stopped", health: "unknown", updated_at: "2026-09-15T16:08:30.000Z" });

      const envelope = await providerRuntime.operationRouter.call("web.search@1", {
        request_id: "00000000-0000-4000-8000-000000005014",
        run_id: "00000000-0000-4000-8000-000000005015",
        input: { query: "Qwen 27b", max_results: 1 },
      }, { authorized: true, signal: new AbortController().signal });
      expect(envelope).toMatchObject({
        status: "unavailable",
        provider: null,
        failure: { code: "provider_unavailable", retryable: true },
      });
      noLeak(discovery);
      noLeak(envelope);
    } finally {
      await providerRuntime.close();
    }
  });

  it("routes web.search@1 through installed package records, provider registry, and package-scoped sidecar binding", async () => {
    const fetchCalls: string[] = [];
    const providerRuntime = await runtime({
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        fetchCalls.push(`${url.pathname}?${url.searchParams.get("q") ?? ""}`);
        if (url.pathname === "/healthz") return new Response("ok", { status: 200 });
        return new Response(JSON.stringify({
          results: [{
            title: "Example result",
            url: "https://example.test/search",
            content: "External inert result text.",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    const discovery = await providerRuntime.capabilityRegistry.discover("web.search@1", { authorized: true });
    expect(discovery).toMatchObject({ state: "available", callable: true });
    noLeak(discovery);

    const envelope = await providerRuntime.operationRouter.call("web.search@1", {
      request_id: "00000000-0000-4000-8000-000000005001",
      run_id: "00000000-0000-4000-8000-000000005002",
      input: { query: "example", max_results: 1 },
    }, { authorized: true, signal: new AbortController().signal });

    expect(envelope).toMatchObject({
      capability: "web.search",
      version: 1,
      status: "success",
      provider: { profile: "local-owner-managed", attribution: "host-mediated-search" },
      results: [{ title: "Example result", result_class: "outside-fact" }],
      failure: null,
    });
    expect(fetchCalls).toContain("/healthz?");
    expect(fetchCalls).toContain("/search?example");
    noLeak(envelope);
  });

  it("routes web.read@1 through the same installed provider package without requiring SearXNG sidecar binding", async () => {
    let called = false;
    const providerRuntime = await runtime({
      readExecutor: {
        read: async (request) => {
          called = true;
          return {
            capability: "web.read",
            version: 1,
            request_id: request.request_id,
            run_id: request.run_id,
            status: "success",
            retrieved_at: "2026-09-01T00:00:00.000Z",
            provider: { profile: "local-owner-managed", attribution: "host-fetch" },
            usage: { read_call: 1, bytes_read: 12 },
            result: {
              requested_url: "https://example.test/page",
              canonical_url: "https://example.test/page",
              title: "Example",
              content_type: "text/html",
              content: "Example page",
              truncated: false,
              trust: "external-untrusted",
              result_class: "outside-fact",
              published_at: null,
              updated_at: null,
            },
            failure: null,
          };
        },
      },
    });

    const envelope = await providerRuntime.operationRouter.call("web.read@1", {
      request_id: "00000000-0000-4000-8000-000000005003",
      run_id: "00000000-0000-4000-8000-000000005004",
      input: { url: "https://example.test/page" },
    }, { authorized: true, signal: new AbortController().signal });

    expect(called).toBe(true);
    expect(envelope).toMatchObject({
      capability: "web.read",
      version: 1,
      status: "success",
      result: { trust: "external-untrusted", result_class: "outside-fact" },
    });
    noLeak(envelope);
  });

  it("returns typed unavailable envelopes for absent and unhealthy provider package state", async () => {
    const absentRuntime = await runtime();
    await absentRuntime.packageStore.uninstallPackage(
      INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
      "00000000-0000-4000-8000-000000005005",
      "2026-09-01T00:00:00.000Z",
    );
    const absent = await absentRuntime.operationRouter.call("web.search@1", {
      request_id: "00000000-0000-4000-8000-000000005006",
      run_id: "00000000-0000-4000-8000-000000005007",
      input: { query: "example", max_results: 1 },
    }, { authorized: true, signal: new AbortController().signal });
    expect(absent).toMatchObject({
      status: "unavailable",
      provider: null,
      failure: { code: "provider_unavailable", retryable: true },
    });
    noLeak(absent);

    const unhealthyRuntime = await runtime();
    await unhealthyRuntime.packageStore.setSidecarRuntimeState(
      INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
      INTERNET_SEARCH_SIDECAR_COMPONENT_ID,
      "failed",
      "unhealthy",
      "2026-09-01T00:00:00.000Z",
    );
    const unhealthy = await unhealthyRuntime.operationRouter.call("web.search@1", {
      request_id: "00000000-0000-4000-8000-000000005008",
      run_id: "00000000-0000-4000-8000-000000005009",
      input: { query: "example", max_results: 1 },
    }, { authorized: true, signal: new AbortController().signal });
    expect(unhealthy).toMatchObject({
      status: "unavailable",
      provider: null,
      failure: { code: "provider_unavailable", retryable: true },
    });
    noLeak(unhealthy);
  });

  it("refreshes descriptor-backed runtime health so discovery and calls stop reporting stale availability", async () => {
    let healthy = true;
    const fetchCalls: string[] = [];
    const providerRuntime = await descriptorRuntime({
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        fetchCalls.push(url.pathname);
        if (url.pathname === "/healthz") {
          return new Response(healthy ? "ok" : "unhealthy", { status: healthy ? 200 : 503 });
        }
        return new Response(JSON.stringify({
          results: [{
            title: "Descriptor result",
            url: "https://example.test/result",
            content: "External inert result text.",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    try {
      expect(providerRuntime.migrationShim).toBeNull();
      expect(await providerRuntime.capabilityRegistry.discover("web.search@1", { authorized: true }))
        .toMatchObject({ state: "available", callable: true, health: { state: "healthy" } });

      healthy = false;
      if (!providerRuntime.capabilityRegistry.refresh) throw new Error("descriptor-backed runtime must expose refresh");
      await providerRuntime.capabilityRegistry.refresh();

      const discovery = await providerRuntime.capabilityRegistry.discover("web.search@1", { authorized: true });
      expect(discovery).toMatchObject({
        state: "unhealthy",
        callable: false,
        health: { state: "unhealthy" },
      });
      noLeak(discovery);

      const envelope = await providerRuntime.operationRouter.call("web.search@1", {
        request_id: "00000000-0000-4000-8000-000000005012",
        run_id: "00000000-0000-4000-8000-000000005013",
        input: { query: "descriptor", max_results: 1 },
      }, { authorized: true, signal: new AbortController().signal });
      expect(envelope).toMatchObject({
        status: "unavailable",
        provider: null,
        failure: { code: "provider_unavailable", retryable: true },
      });
      noLeak(envelope);
      expect(fetchCalls.filter((entry) => entry === "/healthz")).toHaveLength(2);
      expect(fetchCalls).not.toContain("/search");
    } finally {
      await providerRuntime.close();
    }
  });

  it("syncs dependent app readiness when the provider package is disabled, re-enabled, and uninstalled", async () => {
    const providerRuntime = await descriptorRuntime();
    try {
      const appId = "ai.braindrive.research-consumer";
      await providerRuntime.packageStore.installPackage({
        manifest: withSearchDependency(await packageComponentFixture("valid-app-owned-sidecar"), appId, "research-consumer", "required"),
        packageDigest: `sha256:${"8".repeat(64)}`,
        source: { kind: "repository_fixture", label: "Synthetic required Search consumer" },
        installedAt: "2026-09-02T12:00:00.000Z",
      });
      const resolver = dependencyResolverFromCapabilityProviderRegistry(providerRuntime.providerRegistry);
      const readConsumerProjection = async () => {
        const packages = await providerRuntime.packageStore.ownerSafeCatalog({ dependencyResolver: resolver });
        return packages.find((candidate) => candidate.identity.package_id === appId)!;
      };

      expect(await providerRuntime.providerRegistry.discover("web.search@1", { authorized: true }))
        .toMatchObject({ state: "available", callable: true });
      expect(await readConsumerProjection()).toMatchObject({
        state: "enabled",
        dependency_readiness: { status: "ready", required_available: true },
        capability_dependency_status: [{ operation_id: "web.search@1", requirement: "required", state: "available", callable: true }],
      });

      await providerRuntime.packageStore.disablePackage(INTERNET_SEARCH_PROVIDER_PACKAGE_ID, "2026-09-02T12:05:00.000Z");
      expect(await providerRuntime.providerRegistry.discover("web.search@1", { authorized: true }))
        .toMatchObject({ state: "disabled", callable: false, failure: { code: "provider_unavailable" } });
      expect(await readConsumerProjection()).toMatchObject({
        state: "enabled",
        dependency_readiness: { status: "blocked", blocking_operation_ids: ["web.search@1"] },
        capability_dependency_status: [{ operation_id: "web.search@1", state: "disabled", callable: false }],
      });

      await providerRuntime.packageStore.enablePackage(INTERNET_SEARCH_PROVIDER_PACKAGE_ID, "2026-09-02T12:10:00.000Z");
      await providerRuntime.packageStore.setSidecarRuntimeState(
        INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
        INTERNET_SEARCH_SIDECAR_COMPONENT_ID,
        "running",
        "healthy",
        "2026-09-02T12:10:01.000Z",
      );
      expect(await providerRuntime.providerRegistry.discover("web.search@1", { authorized: true }))
        .toMatchObject({ state: "available", callable: true });
      expect(await readConsumerProjection()).toMatchObject({
        dependency_readiness: { status: "ready", required_available: true },
        capability_dependency_status: [{ operation_id: "web.search@1", state: "available", callable: true }],
      });

      await providerRuntime.packageStore.uninstallPackage(
        INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
        "00000000-0000-4000-8000-000000008003",
        "2026-09-02T12:15:00.000Z",
      );
      expect(await providerRuntime.providerRegistry.discover("web.search@1", { authorized: true }))
        .toMatchObject({ state: "unavailable", callable: false, provider_count: 0, failure: { code: "provider_unavailable" } });
      const retainedApp = await readConsumerProjection();
      expect(retainedApp).toMatchObject({
        state: "enabled",
        dependency_readiness: { status: "blocked", blocking_operation_ids: ["web.search@1"] },
        capability_dependency_status: [{ operation_id: "web.search@1", state: "missing", callable: false }],
      });
      noLeak(retainedApp);
    } finally {
      await providerRuntime.close();
    }
  });

  it("keeps malformed provider payloads inside the web.search@1 envelope contract", async () => {
    const providerRuntime = await runtime({
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/healthz") return new Response("ok", { status: 200 });
        return new Response(JSON.stringify({ raw_response: "CANARY_RAW_PROVIDER_PAYLOAD" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const envelope = await providerRuntime.operationRouter.call("web.search@1", {
      request_id: "00000000-0000-4000-8000-000000005010",
      run_id: "00000000-0000-4000-8000-000000005011",
      input: { query: "example", max_results: 1 },
    }, { authorized: true, signal: new AbortController().signal });

    expect(envelope).toMatchObject({
      capability: "web.search",
      status: "failure",
      failure: { code: "invalid_provider_response", retryable: true },
    });
    noLeak(envelope);
  });

  it("documents the temporary legacy env shim with explicit removal criteria", async () => {
    const providerRuntime = await runtime();

    expect(providerRuntime.migrationShim).toEqual(INTERNET_SEARCH_LEGACY_ENV_SHIM);
    expect(INTERNET_SEARCH_LEGACY_ENV_SHIM).toMatchObject({
      variable: "BRAINDRIVE_INTERNET_SEARCH_SIDECAR_URL",
      removal_criteria: expect.stringContaining("package-scoped sidecar descriptors"),
    });
  });
});
