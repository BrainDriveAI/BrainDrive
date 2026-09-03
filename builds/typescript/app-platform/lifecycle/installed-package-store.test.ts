import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, afterEach } from "vitest";

import type { PackageComponentManifest } from "../contracts/package-components.js";
import { InstalledPackageStore, type CapabilityDependencyResolver } from "./installed-package-store.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

type Corpus = {
  valid_cases: Array<{ fixture_id: string; manifest?: PackageComponentManifest }>;
};

async function fixture(fixtureId: string): Promise<PackageComponentManifest> {
  const raw = await readFile(new URL("../contracts/fixtures/sidecar-package/sc-001-conformance-corpus.json", import.meta.url), "utf8");
  const source = JSON.parse(raw) as Corpus;
  const manifest = source.valid_cases.find((candidate) => candidate.fixture_id === fixtureId)?.manifest;
  if (!manifest) throw new Error(`missing fixture: ${fixtureId}`);
  return JSON.parse(JSON.stringify(manifest)) as PackageComponentManifest;
}

function digest(seed: string): `sha256:${string}` {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

function installInput(manifest: PackageComponentManifest, seed = "a") {
  return {
    manifest,
    packageDigest: digest(seed),
    source: { kind: "repository_fixture" as const, label: "Synthetic package component fixture" },
    installedAt: "2026-09-01T12:00:00.000Z",
  };
}

function withAppDependency(manifest: PackageComponentManifest, dependency: PackageComponentManifest["capability_dependencies"][number]): PackageComponentManifest {
  return {
    ...manifest,
    components: manifest.components.map((component) => component.component_kind === "app"
      ? { ...component, requested_capabilities: [dependency] }
      : component),
    capability_dependencies: [dependency],
  };
}

function withLargeDesktopRuntime(manifest: PackageComponentManifest): PackageComponentManifest {
  return {
    ...manifest,
    sidecars: manifest.sidecars.map((sidecar) => ({
      ...sidecar,
      targets: sidecar.targets.map((target) => target.runtime_kind === "packaged_process"
        ? {
            ...target,
            resources: {
              ...target.resources,
              startup_timeout_ms: 120_000,
              health_timeout_ms: 30_000,
              disk_mb: 2048,
              cache_mb: 1024,
            },
          }
        : target),
    })),
  };
}

function withOnlyMacDesktopRuntime(manifest: PackageComponentManifest): PackageComponentManifest {
  return {
    ...manifest,
    sidecars: manifest.sidecars.map((sidecar) => ({
      ...sidecar,
      targets: sidecar.targets.filter((target) => target.target === "desktop_macos_universal"),
    })),
  };
}

function dependencyResolver(states: Record<string, Parameters<CapabilityDependencyResolver["resolveDependency"]>[0] | {
  state: "available" | "missing" | "unavailable" | "disabled" | "unhealthy" | "unauthorized" | "selection_required" | "unsupported_target" | "unknown";
  callable: boolean;
  provider_count: number;
  failure_code: "provider_unavailable" | "provider_unhealthy" | "provider_selection_required" | "unsupported_target" | "not_authorized" | "invalid_request" | "unknown" | null;
  safe_message: string;
}>): CapabilityDependencyResolver {
  return {
    resolveDependency: async (operationId) => {
      const state = states[operationId];
      if (!state || typeof state === "string") throw new Error("missing synthetic dependency state");
      return {
        operation_id: operationId,
        checked_at: "2026-09-01T12:05:00.000Z",
        ...state,
      };
    },
  };
}

describe("SC-002 installed package component store", () => {
  it("persists app, provider, sidecar, operation, and dependency-safe component state across store reopen", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-sc002-store-"));
    roots.push(root);
    const store = new InstalledPackageStore(root);
    await store.initialize();

    const provider = await fixture("valid-provider-sidecar");
    const app = await fixture("valid-app-owned-sidecar");
    await store.installPackage(installInput(provider, "b"));
    await store.installPackage(installInput(app, "c"));

    const reopened = new InstalledPackageStore(root);
    await reopened.initialize();
    const packages = await reopened.ownerSafeCatalog();
    expect(packages.map((item) => item.identity.package_id)).toEqual([
      "ai.braindrive.internet-search.searxng",
      "ai.braindrive.notes-assistant",
    ]);
    const providerProjection = packages[0]!;
    expect(providerProjection.components.map((component) => [component.component_kind, component.launchable])).toEqual([
      ["capability_provider", false],
      ["sidecar", false],
    ]);
    expect(providerProjection.components[0]).toMatchObject({
      component_id: "search.provider",
      owner_visible_actions: ["enable", "disable", "start", "stop", "restart", "update", "uninstall", "health"],
      provided_operations: ["web.search@1", "web.read@1"],
    });
    expect(providerProjection.operations.map((operation) => operation.operation_id)).toEqual(["web.search@1", "web.read@1"]);
    expect(JSON.stringify(providerProjection)).not.toMatch(/payload\/|adapter|export_name|provider-key|secret|endpoint|private_binding|host_path|raw_response|service_name|https?:\/\//i);

    const appProjection = packages[1]!;
    expect(appProjection.components.map((component) => [component.component_kind, component.launchable, component.sidecar_count])).toEqual([
      ["app", true, 1],
      ["sidecar", false, 0],
    ]);
    expect(JSON.stringify(appProjection)).not.toMatch(/payload\/|artifact_path|entrypoint|loopback|binding|host_path|secret/i);
  });

  it("projects AC-006 owner-safe runtime cost, first-start, target, and OS-security guidance without private details", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac006-runtime-projection-"));
    roots.push(root);
    const store = new InstalledPackageStore(root);
    await store.initialize();

    const manifest = withLargeDesktopRuntime(await fixture("valid-app-owned-sidecar"));
    await store.installPackage(installInput(manifest, "6"));
    await store.setSidecarRuntimeState(manifest.package_id, "notes.worker", "unavailable", "unhealthy", "2026-09-01T12:15:00.000Z");

    const [projection] = await store.ownerSafeCatalog({ currentTarget: "desktop_windows_x64" });
    expect(projection!.runtime_summary).toMatchObject({
      sidecar_count: 1,
      target_support: "supported",
      target_labels: expect.arrayContaining(["Desktop Windows x64", "Desktop macOS universal"]),
      install_size: {
        classification: "large",
        safe_message: expect.stringMatching(/Large install/i),
      },
      first_start: {
        classification: "lengthy",
        safe_message: expect.stringMatching(/first start may take several minutes/i),
      },
      os_security: {
        classification: "blocked",
        safe_message: expect.stringMatching(/OS security or Host policy blocked/i),
      },
    });
    const runtimeComponent = projection!.components.find((component) => component.component_id === "notes.worker")!;
    expect(runtimeComponent.runtime_summary).toMatchObject({
      target_support: "supported",
      install_size: { classification: "large" },
      first_start: { classification: "lengthy" },
      os_security: { classification: "blocked" },
    });
    expect(JSON.stringify(projection)).not.toMatch(/payload\/|artifact_path|entrypoint|dependency_bundle|package_path|adapter|export_name|localhost|127\.|0\.0\.0\.0|\bport\b|token|pid|secret|credential|raw|service_name|local network/i);

    await store.updatePackage(manifest.package_id, {
      ...installInput(withOnlyMacDesktopRuntime(manifest), "5"),
      updatedAt: "2026-09-01T12:20:00.000Z",
    });
    const [unsupported] = await store.ownerSafeCatalog({ currentTarget: "desktop_windows_x64" });
    expect(unsupported!.runtime_summary).toMatchObject({
      target_support: "unsupported",
      target_message: "This package does not declare a runtime for this desktop target.",
      os_security: {
        classification: "review_required",
        safe_message: expect.stringMatching(/OS security review/i),
      },
    });
  });

  it("projects SC-007 required and optional capability dependency readiness without starting or switching providers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-sc007-dependencies-"));
    roots.push(root);
    const store = new InstalledPackageStore(root);
    await store.initialize();
    const requiredDependency = {
      operation_id: "web.search@1",
      requirement: "required" as const,
      unavailable_behavior: "block_activation" as const,
      provider_selection: "owner_or_admin_policy" as const,
      silent_install_or_switch: false as const,
    };
    const optionalDependency = {
      operation_id: "web.read@1",
      requirement: "optional" as const,
      unavailable_behavior: "degrade_with_safe_status" as const,
      provider_selection: "owner_or_admin_policy" as const,
      silent_install_or_switch: false as const,
    };
    const appManifest = withAppDependency(await fixture("valid-app-owned-sidecar"), requiredDependency);
    await store.installPackage(installInput(appManifest, "7"));

    const blockedCatalog = await store.ownerSafeCatalog({ dependencyResolver: dependencyResolver({
      "web.search@1": {
        state: "missing",
        callable: false,
        provider_count: 0,
        failure_code: "provider_unavailable",
        safe_message: "Capability provider is unavailable.",
      },
    }) });
    expect(blockedCatalog[0]).toMatchObject({
      capability_dependency_status: [{
        operation_id: "web.search@1",
        requirement: "required",
        state: "missing",
        callable: false,
        provider_count: 0,
        failure_code: "provider_unavailable",
      }],
      dependency_readiness: {
        status: "blocked",
        required_available: false,
        blocking_operation_ids: ["web.search@1"],
      },
    });
    expect(blockedCatalog[0]!.available_actions).not.toContain("start");
    expect(blockedCatalog[0]!.components[0]!.owner_visible_actions).not.toContain("start");
    expect(JSON.stringify(blockedCatalog)).not.toMatch(/payload\/|adapter|export_name|searxng|localhost|127\.|0\.0\.0\.0|\bport\b|secret|endpoint|private_binding|host_path|raw_response|service_name/i);

    const readyCatalog = await store.ownerSafeCatalog({ dependencyResolver: dependencyResolver({
      "web.search@1": {
        state: "available",
        callable: true,
        provider_count: 1,
        failure_code: null,
        safe_message: "Capability provider is available.",
      },
    }) });
    expect(readyCatalog[0]).toMatchObject({
      dependency_readiness: { status: "ready", required_available: true },
      capability_dependency_status: [{ operation_id: "web.search@1", state: "available", callable: true }],
    });
    expect(readyCatalog[0]!.components[0]!.owner_visible_actions).toContain("start");

    await store.updatePackage(appManifest.package_id, {
      ...installInput({ ...appManifest, capability_dependencies: [optionalDependency], components: appManifest.components.map((component) => component.component_kind === "app" ? { ...component, requested_capabilities: [optionalDependency] } : component) }, "8"),
      updatedAt: "2026-09-01T12:10:00.000Z",
    });
    const degradedCatalog = await store.ownerSafeCatalog({ dependencyResolver: dependencyResolver({
      "web.read@1": {
        state: "unavailable",
        callable: false,
        provider_count: 1,
        failure_code: "provider_unavailable",
        safe_message: "Capability provider is unavailable.",
      },
    }) });
    expect(degradedCatalog[0]).toMatchObject({
      dependency_readiness: {
        status: "degraded",
        required_available: true,
        optional_available: false,
        degraded_operation_ids: ["web.read@1"],
      },
      capability_dependency_status: [{ operation_id: "web.read@1", requirement: "optional", state: "unavailable" }],
    });
    expect(degradedCatalog[0]!.components[0]!.owner_visible_actions).toContain("start");
  });

  it("preserves unauthorized and unknown dependency readiness as non-ready states", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac002-dependency-states-"));
    roots.push(root);
    const store = new InstalledPackageStore(root);
    await store.initialize();
    const requiredDependency = {
      operation_id: "web.search@1",
      requirement: "required" as const,
      unavailable_behavior: "block_activation" as const,
      provider_selection: "owner_or_admin_policy" as const,
      silent_install_or_switch: false as const,
    };
    const appManifest = withAppDependency(await fixture("valid-app-owned-sidecar"), requiredDependency);
    await store.installPackage(installInput(appManifest, "9"));

    const unauthorizedCatalog = await store.ownerSafeCatalog({ dependencyResolver: dependencyResolver({
      "web.search@1": {
        state: "unauthorized",
        callable: false,
        provider_count: 0,
        failure_code: "not_authorized",
        safe_message: "Capability authorization is required.",
      },
    }) });
    expect(unauthorizedCatalog[0]).toMatchObject({
      dependency_readiness: { status: "blocked", required_available: false, blocking_operation_ids: ["web.search@1"] },
      capability_dependency_status: [{
        operation_id: "web.search@1",
        state: "unauthorized",
        callable: false,
        provider_count: 0,
        failure_code: "not_authorized",
      }],
    });
    expect(unauthorizedCatalog[0]!.available_actions).not.toContain("start");
    expect(JSON.stringify(unauthorizedCatalog)).not.toMatch(/provider_id|provider-key|secret|endpoint|private_binding|host_path|raw_response|service_name|https?:\/\//i);

    const unknownCatalog = await store.ownerSafeCatalog({
      dependencyResolver: { resolveDependency: async () => { throw new Error("synthetic resolver failure"); } },
    });
    expect(unknownCatalog[0]).toMatchObject({
      dependency_readiness: { status: "blocked", required_available: false, blocking_operation_ids: ["web.search@1"] },
      capability_dependency_status: [{
        operation_id: "web.search@1",
        state: "unknown",
        callable: false,
        provider_count: 0,
        failure_code: "unknown",
        safe_message: "Capability dependency readiness could not be checked.",
      }],
    });
    expect(unknownCatalog[0]!.available_actions).not.toContain("start");
    expect(JSON.stringify(unknownCatalog)).not.toMatch(/resolver failure|stack|secret|endpoint|private_binding|host_path|raw_response|service_name|https?:\/\//i);
  });

  it("records update and uninstall transitions without claiming runtime or router behavior", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-sc002-update-"));
    roots.push(root);
    const store = new InstalledPackageStore(root);
    await store.initialize();
    const manifest = await fixture("valid-provider-sidecar");
    await store.installPackage(installInput(manifest, "d"));

    const updatedManifest = { ...manifest, package_version: "1.1.0", catalog: { ...manifest.catalog, display_name: "Generic Search Provider" } };
    const updated = await store.updatePackage(manifest.package_id, {
      manifest: updatedManifest,
      packageDigest: digest("e"),
      source: { kind: "repository_fixture", label: "Synthetic package component fixture" },
      updatedAt: "2026-09-01T12:30:00.000Z",
    });
    expect(updated).toMatchObject({
      package_version: "1.1.0",
      previous_package_digest: digest("d"),
      generation: 2,
      state: "enabled",
    });

    const operationId = "10000000-0000-4000-8000-000000000002";
    const uninstall = await store.uninstallPackage(manifest.package_id, operationId, "2026-09-01T13:00:00.000Z");
    expect(uninstall).toMatchObject({
      operation_id: operationId,
      runtime_state_removed: true,
      callable_registrations_cleared: true,
      retained: { diagnostics: "bounded_redacted", evidence: "content_free_bounded" },
    });
    await expect(store.updatePackage(manifest.package_id, {
      manifest: updatedManifest,
      packageDigest: digest("f"),
      source: { kind: "repository_fixture", label: "Synthetic package component fixture" },
    })).rejects.toMatchObject({ code: "invalid_state_transition" });
    const projection = (await store.ownerSafeCatalog())[0]!;
    expect(projection.state).toBe("uninstalled");
    expect(projection.available_actions).toEqual([]);
    expect(projection.components.every((component) => component.state === "uninstalled")).toBe(true);
  });

  it("returns null for missing component records and fails closed on corrupt or unsupported component records", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-sc002-corrupt-"));
    roots.push(root);
    const store = new InstalledPackageStore(root);
    await store.initialize();
    const manifest = await fixture("valid-app-owned-sidecar");
    await store.installPackage(installInput(manifest, "f"));

    await expect(store.readComponent(manifest.package_id, "missing.component")).resolves.toBeNull();
    const componentRoot = path.join(root, "registry", "installed-components", "ai.braindrive.notes-assistant");
    await mkdir(componentRoot, { recursive: true });
    await writeFile(path.join(componentRoot, "unsupported.component.json"), JSON.stringify({
      record_version: 1,
      package_id: manifest.package_id,
      installation_id: "10000000-0000-4000-8000-000000000001",
      component_id: "unsupported.component",
      component_kind: "runtime_binding",
      display_name: "Unsupported",
      owner_component_id: null,
      state: "enabled",
      health: "not_applicable",
      launchable: false,
      lifecycle_actions: [],
      provided_operations: [],
      required_capabilities: [],
      sidecar_count: 0,
      target_support: [],
      cleanup_on_uninstall: true,
      updated_at: "2026-09-01T12:00:00.000Z",
    }), "utf8");

    await expect(store.readComponent(manifest.package_id, "unsupported.component")).rejects.toMatchObject({ code: "store_corrupt" });
    await expect(store.ownerSafeCatalog()).rejects.toMatchObject({ code: "store_corrupt" });
  });

  it("rejects invalid package component manifests before durable state is created", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-sc002-invalid-"));
    roots.push(root);
    const store = new InstalledPackageStore(root);
    await store.initialize();
    const manifest = await fixture("valid-provider-sidecar");
    await expect(store.installPackage(installInput({ ...manifest, provided_operations: [] } as PackageComponentManifest, "0")))
      .rejects.toMatchObject({ code: "package_manifest_invalid" });
    await expect(store.readPackage(manifest.package_id)).resolves.toBeNull();
    await expect(store.ownerSafeCatalog()).resolves.toEqual([]);
  });
});
