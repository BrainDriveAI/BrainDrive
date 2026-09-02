import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createMemoryPackageDiagnosticSink } from "../app-platform/contracts/diagnostics.js";
import type { PackageComponentManifest } from "../app-platform/contracts/package-components.js";
import { InstalledPackageStore } from "../app-platform/lifecycle/installed-package-store.js";
import {
  CapabilityOperationRouter,
  CapabilityProviderRegistry,
  adapterKey,
  dependencyResolverFromCapabilityProviderRegistry,
  type ProviderOperationAdapter,
  type ProviderOperationDefinition,
} from "./provider-router.js";

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type Corpus = {
  valid_cases: Array<{ fixture_id: string; manifest?: PackageComponentManifest }>;
};

const RequestSchema = z.object({
  request_id: z.string().uuid(),
  run_id: z.string().uuid(),
  input: z.object({ query: z.string().min(1) }).strict(),
}).strict();

const ResultSchema = z.object({
  status: z.literal("success"),
  result: z.string(),
  provider_component: z.string(),
}).strict();

async function fixture(fixtureId: string): Promise<PackageComponentManifest> {
  const raw = await readFile(new URL("../app-platform/contracts/fixtures/sidecar-package/sc-001-conformance-corpus.json", import.meta.url), "utf8");
  const source = JSON.parse(raw) as Corpus;
  const manifest = source.valid_cases.find((candidate) => candidate.fixture_id === fixtureId)?.manifest;
  if (!manifest) throw new Error(`missing fixture: ${fixtureId}`);
  return JSON.parse(JSON.stringify(manifest)) as PackageComponentManifest;
}

function digest(seed: string): `sha256:${string}` {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

async function storeWith(...manifests: PackageComponentManifest[]): Promise<InstalledPackageStore> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-sc004-provider-router-"));
  roots.push(root);
  const store = new InstalledPackageStore(root);
  await store.initialize();
  for (const [index, manifest] of manifests.entries()) {
    await store.installPackage({
      manifest,
      packageDigest: digest(String(index + 1)),
      source: { kind: "repository_fixture", label: "SC-004 package-independent fixture" },
      installedAt: "2026-09-01T12:00:00.000Z",
    });
  }
  return store;
}

function providerManifest(overrides: Partial<PackageComponentManifest> = {}): PackageComponentManifest {
  return {
    manifest_version: 2,
    package_id: "ai.braindrive.generic-search.alpha",
    publisher_id: "ai.braindrive",
    package_version: "1.0.0",
    package_kind: ["capability_provider"],
    catalog: {
      display_name: "Generic Search Alpha",
      summary: "Synthetic provider package.",
      icon: null,
      retention_summary: "Provider cache is deleted by default on uninstall.",
    },
    archive: {
      format: "zip",
      profile: "braindrive-package-v2",
      compression: "store",
      layout_version: 1,
      manifest_path: "manifest.json",
      undeclared_entries: "reject",
      links_and_device_nodes: "reject",
    },
    files: [
      { path: "payload/provider/search.js", kind: "file", mode: "read_only", size_bytes: 128, digest: digest("a") },
      { path: "payload/provider/read.js", kind: "file", mode: "read_only", size_bytes: 128, digest: digest("b") },
      { path: "provenance/intoto.jsonl", kind: "file", mode: "read_only", size_bytes: 64, digest: digest("c") },
      { path: "sbom/cyclonedx.json", kind: "file", mode: "read_only", size_bytes: 64, digest: digest("d") },
    ],
    components: [{
      component_id: "alpha.provider",
      component_kind: "capability_provider",
      display_name: "Generic Search Alpha",
      lifecycle_actions: ["enable", "disable", "start", "stop", "restart", "update", "uninstall", "health"],
      sidecars: [],
      provider_id: "ai.braindrive.generic-search.alpha.provider",
      launchable: false,
      provides: ["web.search@1"],
    }],
    sidecars: [],
    provided_operations: [{
      operation_id: "web.search@1",
      provider_component_id: "alpha.provider",
      adapter: {
        package_path: "payload/provider/search.js",
        export_name: "handleSearch",
        abi: "braindrive-operation-adapter-v1",
      },
      input_contract: { schema_id: "web.search.input", schema_version: 1, content_digest: digest("e") },
      result_contract: { schema_id: "web.search.result", schema_version: 1, content_digest: digest("f") },
      required_sidecars: [],
      result_classification: "generic_envelope",
    }],
    capability_dependencies: [],
    configuration: { configuration_version: 1, non_secret_settings_schema: null, secrets: [] },
    permissions: {
      permission_policy_version: 1,
      network: ["provider_upstream_https"],
      filesystem: ["package_read", "declared_cache"],
      process: [],
      credentials: [],
    },
    retention_policy: {
      retention_policy_version: 1,
      runtime_binding: "ephemeral_remove_on_stop_or_uninstall",
      sidecar_runtime_state: "remove_on_uninstall",
      provider_cache: "delete_by_default_unless_owner_preserves",
      diagnostics: "bounded_redacted",
      evidence: "content_free_bounded",
    },
    diagnostics: {
      diagnostics_policy_version: 1,
      store_raw_provider_payloads: false,
      store_private_bindings: false,
      store_host_paths: false,
      store_credentials: false,
      durable_projection: "safe_status_and_typed_failures_only",
    },
    evidence: {
      evidence_policy_version: 1,
      required_evidence: ["schema_conformance", "negative_manifest_cases", "unsafe_binding_denial", "secret_redaction_scan"],
      stale_on: ["manifest_change", "adapter_change", "sidecar_target_change", "network_policy_change", "permission_change", "operation_contract_change"],
      durable_evidence_content: "content_free_no_endpoints_no_secrets",
    },
    ...overrides,
  };
}

function betaManifest(): PackageComponentManifest {
  const alpha = providerManifest();
  const alphaProvider = alpha.components[0] as Extract<PackageComponentManifest["components"][number], { component_kind: "capability_provider" }>;
  return {
    ...alpha,
    package_id: "ai.braindrive.generic-search.beta",
    catalog: { ...alpha.catalog, display_name: "Generic Search Beta" },
    components: [{
      ...alphaProvider,
      component_id: "beta.provider",
      display_name: "Generic Search Beta",
      provider_id: "ai.braindrive.generic-search.beta.provider",
    }],
    provided_operations: [{
      ...alpha.provided_operations[0]!,
      provider_component_id: "beta.provider",
    }],
  };
}

function consumerManifest(dependency: PackageComponentManifest["capability_dependencies"][number]): PackageComponentManifest {
  const alpha = providerManifest();
  return {
    ...alpha,
    package_id: "ai.braindrive.research-consumer",
    catalog: {
      display_name: "Research Consumer",
      summary: "Synthetic app package that depends on generic operation availability.",
      icon: null,
      retention_summary: "Runtime authority is removed on uninstall.",
    },
    package_kind: ["app"],
    components: [{
      component_id: "research.app",
      component_kind: "app",
      display_name: "Research Consumer",
      lifecycle_actions: ["enable", "disable", "start", "stop", "update", "uninstall", "health"],
      sidecars: [],
      app_id: "ai.braindrive.research-consumer",
      route_key: "research-consumer",
      launchable: true,
      requested_capabilities: [dependency],
    }],
    sidecars: [],
    provided_operations: [],
    capability_dependencies: [dependency],
    permissions: {
      permission_policy_version: 1,
      network: ["public_https"],
      filesystem: ["package_read"],
      process: [],
      credentials: [],
    },
  };
}

function adapter(result: string): ProviderOperationAdapter {
  return {
    invoke: async (_request, context) => ({
      status: "success",
      result,
      provider_component: context.provider_component_id,
    }),
  };
}

function router(registry: CapabilityProviderRegistry, adapters: Record<string, ProviderOperationAdapter>, options: { selected?: { packageId: string; providerComponentId: string }; timeoutMs?: number; diagnosticSink?: ReturnType<typeof createMemoryPackageDiagnosticSink> } = {}) {
  const operations: ProviderOperationDefinition<z.infer<typeof RequestSchema>, z.infer<typeof ResultSchema> | Record<string, unknown>>[] = [{
    operation_id: "web.search@1",
    input_schema: RequestSchema,
    result_schema: ResultSchema,
    max_input_bytes: 1024,
    timeout_ms: options.timeoutMs ?? 5_000,
    failure: (request, failure) => ({
      status: failure.code,
      request_id: request?.request_id ?? null,
      run_id: request?.run_id ?? null,
      message: failure.message,
    }),
  }];
  return new CapabilityOperationRouter({
    registry,
    operations,
    adapters,
    selectionPolicy: options.selected ? { selectedProvider: () => options.selected! } : undefined,
    diagnosticSink: options.diagnosticSink,
    now: () => 1_000,
  });
}

function noLeak(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(/https?:|localhost|127\.|0\.0\.0\.0|\bport\b|credential|secret|vault|payload\/|adapter|export_name|host_path|raw_response|service_name|container|process/i);
}

describe("SC-004 generic capability provider registry and operation router", () => {
  it("loads provider operations from installed package records and routes by operation id through the generic adapter ABI", async () => {
    const store = await storeWith(providerManifest());
    const registry = new CapabilityProviderRegistry({ store, target: "docker_linux_x64" });
    const callRouter = router(registry, { "ai.braindrive.generic-search.alpha:alpha.provider:web.search@1": adapter("alpha-result") });

    const discovery = await registry.discover("web.search@1", { authorized: true });
    expect(discovery).toMatchObject({
      discovery_version: 1,
      operation_id: "web.search@1",
      state: "available",
      callable: true,
      provider_count: 1,
      grant: { required: true, authorized: true },
    });
    noLeak(discovery);

    await expect(callRouter.call("web.search@1", {
      request_id: "10000000-0000-4000-8000-000000000101",
      run_id: "10000000-0000-4000-8000-000000000102",
      input: { query: "fixture" },
    }, { authorized: true, signal: new AbortController().signal })).resolves.toEqual({
      status: "success",
      result: "alpha-result",
      provider_component: "alpha.provider",
    });
  });

  it("routes web.read@1 through the same generic provider operation boundary", async () => {
    const manifest = await fixture("valid-provider-sidecar");
    const store = await storeWith(manifest);
    const registry = new CapabilityProviderRegistry({ store, target: "docker_linux_x64" });
    const operations: ProviderOperationDefinition<z.infer<typeof RequestSchema>, z.infer<typeof ResultSchema> | Record<string, unknown>>[] = [{
      operation_id: "web.read@1",
      input_schema: RequestSchema,
      result_schema: ResultSchema,
      max_input_bytes: 1024,
      timeout_ms: 5_000,
      failure: (request, failure) => ({
        status: failure.code,
        request_id: request?.request_id ?? null,
        run_id: request?.run_id ?? null,
        message: failure.message,
      }),
    }];
    const callRouter = new CapabilityOperationRouter({
      registry,
      operations,
      adapters: {
        [adapterKey(manifest.package_id, "search.provider", "web.read@1")]: adapter("read-result"),
      },
    });

    await expect(callRouter.call("web.read@1", {
      request_id: "10000000-0000-4000-8000-000000000111",
      run_id: "10000000-0000-4000-8000-000000000112",
      input: { query: "https://example.test/page" },
    }, { authorized: true, signal: new AbortController().signal })).resolves.toEqual({
      status: "success",
      result: "read-result",
      provider_component: "search.provider",
    });
  });

  it("records content-free operation receipts for package-provider calls", async () => {
    const diagnostics = createMemoryPackageDiagnosticSink();
    const store = await storeWith(providerManifest());
    const registry = new CapabilityProviderRegistry({ store, target: "docker_linux_x64" });
    const callRouter = router(registry, {
      "ai.braindrive.generic-search.alpha:alpha.provider:web.search@1": adapter("CANARY_RAW_PROVIDER_PAYLOAD"),
    }, { diagnosticSink: diagnostics });

    await callRouter.call("web.search@1", {
      request_id: "10000000-0000-4000-8000-000000000201",
      run_id: "10000000-0000-4000-8000-000000000202",
      input: { query: "synthetic" },
    }, { authorized: true, signal: new AbortController().signal });

    expect(diagnostics.events()).toEqual([expect.objectContaining({
      event_type: "operation",
      package_id: "ai.braindrive.generic-search.alpha",
      provider_component_id: "alpha.provider",
      provider_profile_class: "capability_provider",
      provider_selection: "single_provider",
      provider_execution: "executed",
      operation_id: "web.search@1",
      request_id: "10000000-0000-4000-8000-000000000201",
      run_id: "10000000-0000-4000-8000-000000000202",
      status: "success",
      failure_code: null,
      retention_policy_id: "package-provider-diagnostics-v1",
      usage: { call_count: 1, bytes_class: null },
    })]);
    noLeak(diagnostics.events());
    expect(JSON.stringify(diagnostics.events())).not.toMatch(/CANARY_|RAW_PROVIDER/i);
  });

  it("does not enumerate provider records to unauthorized consumers", async () => {
    const registry = new CapabilityProviderRegistry({ store: await storeWith(providerManifest()), target: "docker_linux_x64" });

    const installed = await registry.discover("web.search@1", { authorized: false });
    const missing = await new CapabilityProviderRegistry({ store: await storeWith(), target: "docker_linux_x64" })
      .discover("web.search@1", { authorized: false });

    expect(installed).toEqual(missing);
    expect(installed).toMatchObject({
      state: "unauthorized",
      callable: false,
      provider_count: 0,
      selected_provider: null,
    });
    noLeak(installed);
  });

  it("requires explicit owner/admin selection when multiple compatible providers exist", async () => {
    const registry = new CapabilityProviderRegistry({ store: await storeWith(providerManifest(), betaManifest()), target: "docker_linux_x64" });

    const ambiguousDiscovery = await registry.discover("web.search@1", { authorized: true });
    expect(ambiguousDiscovery).toMatchObject({
      state: "selection_required",
      callable: false,
      provider_count: 2,
      selected_provider: null,
      failure: { code: "provider_selection_required" },
    });
    noLeak(ambiguousDiscovery);

    await expect(router(registry, {
      "ai.braindrive.generic-search.alpha:alpha.provider:web.search@1": adapter("alpha-result"),
      "ai.braindrive.generic-search.beta:beta.provider:web.search@1": adapter("beta-result"),
    }).call("web.search@1", {
      request_id: "10000000-0000-4000-8000-000000000103",
      run_id: "10000000-0000-4000-8000-000000000104",
      input: { query: "fixture" },
    }, { authorized: true, signal: new AbortController().signal })).resolves.toMatchObject({
      status: "provider_selection_required",
      message: "Owner or admin provider selection is required.",
    });

    await expect(router(registry, {
      "ai.braindrive.generic-search.alpha:alpha.provider:web.search@1": adapter("alpha-result"),
      "ai.braindrive.generic-search.beta:beta.provider:web.search@1": adapter("beta-result"),
    }, { selected: { packageId: "ai.braindrive.generic-search.beta", providerComponentId: "beta.provider" } }).call("web.search@1", {
      request_id: "10000000-0000-4000-8000-000000000105",
      run_id: "10000000-0000-4000-8000-000000000106",
      input: { query: "fixture" },
    }, { authorized: true, signal: new AbortController().signal })).resolves.toMatchObject({
      result: "beta-result",
      provider_component: "beta.provider",
    });
  });

  it("preserves the AC-002 provider readiness matrix across discovery and dependency projection", async () => {
    const required = {
      operation_id: "web.search@1",
      requirement: "required" as const,
      unavailable_behavior: "block_activation" as const,
      provider_selection: "owner_or_admin_policy" as const,
      silent_install_or_switch: false as const,
    };

    const availableStore = await storeWith(consumerManifest(required), providerManifest());
    const availableRegistry = new CapabilityProviderRegistry({ store: availableStore, target: "docker_linux_x64" });
    const available = await availableRegistry.discover("web.search@1", { authorized: true });
    expect(available).toMatchObject({ state: "available", callable: true, provider_count: 1, failure: null });
    const availableProjection = await availableStore.ownerSafeCatalog({ dependencyResolver: dependencyResolverFromCapabilityProviderRegistry(availableRegistry) });
    expect(availableProjection.find((entry) => entry.identity.package_id === "ai.braindrive.research-consumer")).toMatchObject({
      dependency_readiness: { status: "ready" },
      capability_dependency_status: [{ state: "available", callable: true, failure_code: null }],
    });

    const missingStore = await storeWith(consumerManifest(required));
    const missingRegistry = new CapabilityProviderRegistry({ store: missingStore, target: "docker_linux_x64" });
    const missing = await missingStore.ownerSafeCatalog({ dependencyResolver: dependencyResolverFromCapabilityProviderRegistry(missingRegistry) });
    expect(missing[0]).toMatchObject({
      dependency_readiness: { status: "blocked", blocking_operation_ids: ["web.search@1"] },
      capability_dependency_status: [{ state: "missing", callable: false, provider_count: 0, failure_code: "provider_unavailable" }],
    });

    const disabledStore = await storeWith(consumerManifest(required), providerManifest());
    await disabledStore.disablePackage("ai.braindrive.generic-search.alpha", "2026-09-01T13:00:00.000Z");
    const disabledRegistry = new CapabilityProviderRegistry({ store: disabledStore, target: "docker_linux_x64" });
    const disabled = await disabledStore.ownerSafeCatalog({ dependencyResolver: dependencyResolverFromCapabilityProviderRegistry(disabledRegistry) });
    expect(disabled.find((entry) => entry.identity.package_id === "ai.braindrive.research-consumer")).toMatchObject({
      dependency_readiness: { status: "blocked" },
      capability_dependency_status: [{ state: "disabled", callable: false, provider_count: 1, failure_code: "provider_unavailable" }],
    });

    const sidecarManifest = await fixture("valid-provider-sidecar");
    const unhealthyStore = await storeWith(consumerManifest(required), sidecarManifest);
    await unhealthyStore.setSidecarRuntimeState(sidecarManifest.package_id, "search.runtime", "failed", "unhealthy", "2026-09-01T13:00:00.000Z");
    const unhealthyRegistry = new CapabilityProviderRegistry({ store: unhealthyStore, target: "docker_linux_x64" });
    const unhealthy = await unhealthyStore.ownerSafeCatalog({ dependencyResolver: dependencyResolverFromCapabilityProviderRegistry(unhealthyRegistry) });
    expect(unhealthy.find((entry) => entry.identity.package_id === "ai.braindrive.research-consumer")).toMatchObject({
      dependency_readiness: { status: "blocked" },
      capability_dependency_status: [{ state: "unhealthy", callable: false, provider_count: 1, failure_code: "provider_unhealthy" }],
    });

    const unavailableStore = await storeWith(consumerManifest(required), sidecarManifest);
    const unavailableRegistry = new CapabilityProviderRegistry({ store: unavailableStore, target: "docker_linux_x64" });
    const unavailable = await unavailableStore.ownerSafeCatalog({ dependencyResolver: dependencyResolverFromCapabilityProviderRegistry(unavailableRegistry) });
    expect(unavailable.find((entry) => entry.identity.package_id === "ai.braindrive.research-consumer")).toMatchObject({
      dependency_readiness: { status: "blocked" },
      capability_dependency_status: [{ state: "unavailable", callable: false, provider_count: 1, failure_code: "provider_unavailable" }],
    });

    const unsupportedStore = await storeWith(consumerManifest(required), sidecarManifest);
    const unsupportedRegistry = new CapabilityProviderRegistry({ store: unsupportedStore, target: "desktop_windows_x64" });
    const unsupported = await unsupportedStore.ownerSafeCatalog({ dependencyResolver: dependencyResolverFromCapabilityProviderRegistry(unsupportedRegistry) });
    expect(unsupported.find((entry) => entry.identity.package_id === "ai.braindrive.research-consumer")).toMatchObject({
      dependency_readiness: { status: "blocked" },
      capability_dependency_status: [{ state: "unsupported_target", callable: false, provider_count: 1, failure_code: "unsupported_target" }],
    });

    const ambiguousStore = await storeWith(consumerManifest(required), providerManifest(), betaManifest());
    const ambiguousRegistry = new CapabilityProviderRegistry({ store: ambiguousStore, target: "docker_linux_x64" });
    const ambiguous = await ambiguousStore.ownerSafeCatalog({ dependencyResolver: dependencyResolverFromCapabilityProviderRegistry(ambiguousRegistry) });
    expect(ambiguous.find((entry) => entry.identity.package_id === "ai.braindrive.research-consumer")).toMatchObject({
      dependency_readiness: { status: "blocked" },
      capability_dependency_status: [{ state: "selection_required", callable: false, provider_count: 2, failure_code: "provider_selection_required" }],
    });

    const unauthorizedDiscovery = await availableRegistry.discover("web.search@1", { authorized: false });
    expect(unauthorizedDiscovery).toMatchObject({
      state: "unauthorized",
      callable: false,
      provider_count: 0,
      operation: null,
      selected_provider: null,
      health: null,
      failure: { code: "not_authorized" },
    });

    noLeak(unauthorizedDiscovery);
    for (const projection of [availableProjection, missing, disabled, unhealthy, unavailable, unsupported, ambiguous]) {
      expect(JSON.stringify(projection)).not.toMatch(/https?:|localhost|127\.|0\.0\.0\.0|\bport\b|credential|secret|vault|payload\/|adapter|export_name|host_path|raw_response|service_name|private_binding/i);
    }
  });

  it("fails closed for disabled, unhealthy, unsupported-target, and uninstalled provider state", async () => {
    const disabledStore = await storeWith(providerManifest());
    await disabledStore.disablePackage("ai.braindrive.generic-search.alpha", "2026-09-01T13:00:00.000Z");
    await expect(router(new CapabilityProviderRegistry({ store: disabledStore, target: "docker_linux_x64" }), {
      "ai.braindrive.generic-search.alpha:alpha.provider:web.search@1": adapter("unused"),
    }).call("web.search@1", {
      request_id: "10000000-0000-4000-8000-000000000107",
      run_id: "10000000-0000-4000-8000-000000000108",
      input: { query: "fixture" },
    }, { authorized: true, signal: new AbortController().signal })).resolves.toMatchObject({ status: "provider_unavailable" });

    const sidecarManifest = await fixture("valid-provider-sidecar");
    const unhealthyStore = await storeWith(sidecarManifest);
    await unhealthyStore.setSidecarRuntimeState(sidecarManifest.package_id, "search.runtime", "failed", "unhealthy", "2026-09-01T13:00:00.000Z");
    const unhealthy = await new CapabilityProviderRegistry({ store: unhealthyStore, target: "docker_linux_x64" }).discover("web.search@1", { authorized: true });
    expect(unhealthy).toMatchObject({ state: "unhealthy", callable: false, failure: { code: "provider_unhealthy" } });
    noLeak(unhealthy);

    const unsupported = await new CapabilityProviderRegistry({ store: await storeWith(sidecarManifest), target: "desktop_windows_x64" }).discover("web.search@1", { authorized: true });
    expect(unsupported).toMatchObject({ state: "unsupported_target", callable: false, failure: { code: "unsupported_target" } });
    noLeak(unsupported);

    const uninstalledStore = await storeWith(providerManifest());
    await uninstalledStore.uninstallPackage("ai.braindrive.generic-search.alpha", "10000000-0000-4000-8000-000000000109", "2026-09-01T13:00:00.000Z");
    const uninstalled = await new CapabilityProviderRegistry({ store: uninstalledStore, target: "docker_linux_x64" }).discover("web.search@1", { authorized: true });
    expect(uninstalled).toMatchObject({ state: "unavailable", callable: false, provider_count: 0 });
  });

  it("evaluates app capability dependencies through generic provider discovery without starting or switching providers", async () => {
    const required = {
      operation_id: "web.search@1",
      requirement: "required" as const,
      unavailable_behavior: "block_activation" as const,
      provider_selection: "owner_or_admin_policy" as const,
      silent_install_or_switch: false as const,
    };
    const emptyStore = await storeWith(consumerManifest(required));
    const missing = await emptyStore.ownerSafeCatalog({
      dependencyResolver: dependencyResolverFromCapabilityProviderRegistry(new CapabilityProviderRegistry({ store: emptyStore, target: "docker_linux_x64" })),
    });
    expect(missing[0]).toMatchObject({
      identity: { package_id: "ai.braindrive.research-consumer" },
      dependency_readiness: { status: "blocked", blocking_operation_ids: ["web.search@1"] },
      capability_dependency_status: [{
        operation_id: "web.search@1",
        requirement: "required",
        state: "missing",
        callable: false,
        provider_count: 0,
        failure_code: "provider_unavailable",
      }],
    });
    expect(missing[0]!.components[0]!.owner_visible_actions).not.toContain("start");
    noLeak(missing);

    const readyStore = await storeWith(consumerManifest(required), providerManifest());
    const ready = await readyStore.ownerSafeCatalog({
      dependencyResolver: dependencyResolverFromCapabilityProviderRegistry(new CapabilityProviderRegistry({ store: readyStore, target: "docker_linux_x64" })),
    });
    expect(ready.find((entry) => entry.identity.package_id === "ai.braindrive.research-consumer")).toMatchObject({
      dependency_readiness: { status: "ready", required_available: true },
      capability_dependency_status: [{ operation_id: "web.search@1", state: "available", callable: true, provider_count: 1 }],
    });
    noLeak(ready);

    const ambiguousStore = await storeWith(consumerManifest(required), providerManifest(), betaManifest());
    const ambiguous = await ambiguousStore.ownerSafeCatalog({
      dependencyResolver: dependencyResolverFromCapabilityProviderRegistry(new CapabilityProviderRegistry({ store: ambiguousStore, target: "docker_linux_x64" })),
    });
    expect(ambiguous.find((entry) => entry.identity.package_id === "ai.braindrive.research-consumer")).toMatchObject({
      dependency_readiness: { status: "blocked", blocking_operation_ids: ["web.search@1"] },
      capability_dependency_status: [{ operation_id: "web.search@1", state: "selection_required", callable: false, provider_count: 2, failure_code: "provider_selection_required" }],
    });
    noLeak(ambiguous);
  });

  it("returns typed failures for malformed requests, missing adapters, malformed results, timeout, and cancellation", async () => {
    const registry = new CapabilityProviderRegistry({ store: await storeWith(providerManifest()), target: "docker_linux_x64" });
    const key = "ai.braindrive.generic-search.alpha:alpha.provider:web.search@1";

    await expect(router(registry, { [key]: adapter("unused") }).call("web.search@1", {
      request_id: "10000000-0000-4000-8000-000000000110",
      run_id: "10000000-0000-4000-8000-000000000111",
      input: {},
    }, { authorized: true, signal: new AbortController().signal })).resolves.toMatchObject({ status: "invalid_request" });

    await expect(router(registry, {}).call("web.search@1", {
      request_id: "10000000-0000-4000-8000-000000000112",
      run_id: "10000000-0000-4000-8000-000000000113",
      input: { query: "fixture" },
    }, { authorized: true, signal: new AbortController().signal })).resolves.toMatchObject({ status: "provider_unavailable" });

    await expect(router(registry, { [key]: { invoke: async () => ({ raw_response: "CANARY_RAW_PROVIDER_PAYLOAD" }) } }).call("web.search@1", {
      request_id: "10000000-0000-4000-8000-000000000114",
      run_id: "10000000-0000-4000-8000-000000000115",
      input: { query: "fixture" },
    }, { authorized: true, signal: new AbortController().signal })).resolves.toMatchObject({ status: "invalid_provider_response" });

    const timedOut = router(registry, { [key]: { invoke: async (_request, context) => new Promise((resolve, reject) => {
      context.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      setTimeout(() => resolve({ status: "success", result: "late", provider_component: "alpha.provider" }), 10_000);
    }) } }, { timeoutMs: 1 });
    await expect(timedOut.call("web.search@1", {
      request_id: "10000000-0000-4000-8000-000000000116",
      run_id: "10000000-0000-4000-8000-000000000117",
      input: { query: "fixture" },
    }, { authorized: true, signal: new AbortController().signal })).resolves.toMatchObject({ status: "timeout" });

    const controller = new AbortController();
    controller.abort();
    await expect(router(registry, { [key]: adapter("unused") }).call("web.search@1", {
      request_id: "10000000-0000-4000-8000-000000000118",
      run_id: "10000000-0000-4000-8000-000000000119",
      input: { query: "fixture" },
    }, { authorized: true, signal: controller.signal })).resolves.toMatchObject({ status: "cancelled" });
  });

  it("records provider execution state for missing adapter, malformed response, timeout, and cancellation receipts", async () => {
    const registry = new CapabilityProviderRegistry({ store: await storeWith(providerManifest()), target: "docker_linux_x64" });
    const key = "ai.braindrive.generic-search.alpha:alpha.provider:web.search@1";

    const missingAdapterDiagnostics = createMemoryPackageDiagnosticSink();
    await router(registry, {}, { diagnosticSink: missingAdapterDiagnostics }).call("web.search@1", {
      request_id: "10000000-0000-4000-8000-000000000211",
      run_id: "10000000-0000-4000-8000-000000000212",
      input: { query: "CANARY_RAW_QUERY_TEXT" },
    }, { authorized: true, signal: new AbortController().signal });
    expect(missingAdapterDiagnostics.events()).toEqual([expect.objectContaining({
      provider_execution: "not_executed",
      status: "unavailable",
      failure_code: "provider_unavailable",
      result_count: 0,
      completed_item_count: 0,
      usage: { call_count: 0, bytes_class: null },
    })]);

    const invalidDiagnostics = createMemoryPackageDiagnosticSink();
    await router(registry, { [key]: { invoke: async () => ({ raw_response: "CANARY_RAW_PROVIDER_PAYLOAD" }) } }, { diagnosticSink: invalidDiagnostics }).call("web.search@1", {
      request_id: "10000000-0000-4000-8000-000000000213",
      run_id: "10000000-0000-4000-8000-000000000214",
      input: { query: "fixture" },
    }, { authorized: true, signal: new AbortController().signal });
    expect(invalidDiagnostics.events()).toEqual([expect.objectContaining({
      provider_execution: "executed",
      status: "failure",
      failure_code: "invalid_provider_response",
      usage: { call_count: 1, bytes_class: null },
    })]);

    const timeoutDiagnostics = createMemoryPackageDiagnosticSink();
    await router(registry, { [key]: { invoke: async (_request, context) => new Promise((_resolve, reject) => {
      context.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }) } }, { timeoutMs: 1, diagnosticSink: timeoutDiagnostics }).call("web.search@1", {
      request_id: "10000000-0000-4000-8000-000000000215",
      run_id: "10000000-0000-4000-8000-000000000216",
      input: { query: "fixture" },
    }, { authorized: true, signal: new AbortController().signal });
    expect(timeoutDiagnostics.events()).toEqual([expect.objectContaining({
      provider_execution: "executed",
      status: "failure",
      failure_code: "timeout",
      usage: { call_count: 1, bytes_class: null },
    })]);

    let invoked = false;
    const controller = new AbortController();
    const cancelledDiagnostics = createMemoryPackageDiagnosticSink();
    const call = router(registry, { [key]: { invoke: async (_request, context) => {
      invoked = true;
      return await new Promise((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      });
    } } }, { diagnosticSink: cancelledDiagnostics }).call("web.search@1", {
      request_id: "10000000-0000-4000-8000-000000000217",
      run_id: "10000000-0000-4000-8000-000000000218",
      input: { query: "fixture" },
    }, { authorized: true, signal: controller.signal });
    await vi.waitFor(() => expect(invoked).toBe(true));
    controller.abort();
    await expect(call).resolves.toMatchObject({ status: "cancelled" });
    expect(cancelledDiagnostics.events()).toEqual([expect.objectContaining({
      provider_execution: "executed",
      status: "cancelled",
      failure_code: "cancelled",
      usage: { call_count: 1, bytes_class: null },
    })]);

    expect(JSON.stringify([
      missingAdapterDiagnostics.events(),
      invalidDiagnostics.events(),
      timeoutDiagnostics.events(),
      cancelledDiagnostics.events(),
    ])).not.toMatch(/CANARY_|RAW_PROVIDER|https?:|localhost|127\.|0\.0\.0\.0|\bport\b|credential|secret|vault|payload\/|adapter|export_name|host_path|authorization|bearer|token/i);
  });
});
