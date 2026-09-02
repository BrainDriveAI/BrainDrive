import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createInternetSearchProviderRuntime,
  INTERNET_SEARCH_LEGACY_ENV_SHIM,
  INTERNET_SEARCH_PROVIDER_COMPONENT_ID,
  INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
  INTERNET_SEARCH_SIDECAR_COMPONENT_ID,
  loadInternetSearchProviderManifest,
} from "./provider-package.js";
import { dependencyResolverFromCapabilityProviderRegistry } from "../app-capabilities/provider-router.js";
import type { PackageComponentManifest } from "../app-platform/contracts/package-components.js";
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
  return createInternetSearchProviderRuntime({
    rootDir: process.cwd(),
    memoryRoot: path.join(root, "memory"),
    stateRoot: path.join(root, "state"),
    env: shimEnv(),
    fetchImpl: input.fetchImpl ?? (async () => new Response("ok", { status: 200 })),
    readExecutor: input.readExecutor ?? null,
  });
}

async function descriptorRuntime(input: {
  fetchImpl?: typeof fetch;
  readExecutor?: WebReadExecutor | null;
} = {}) {
  const root = await tempRoot();
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
    memoryRoot: path.join(root, "memory"),
    stateRoot: path.join(root, "state"),
    env: {
      BRAINDRIVE_SIDECAR_RUNTIME_DESCRIPTOR_FILE: descriptorPath,
      BRAINDRIVE_SIDECAR_STARTUP_TIMEOUT_MS: "25",
      BRAINDRIVE_SIDECAR_READINESS_POLL_MS: "1",
    },
    fetchImpl: input.fetchImpl ?? (async () => new Response("ok", { status: 200 })),
    readExecutor: input.readExecutor ?? null,
  });
}

function noLeak(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(/internet-search-searxng|localhost|127\.|0\.0\.0\.0|\bport\b|credential|secret|vault|authorization|cookie|\/home\/|raw_response|CANARY_/i);
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

describe("SC-005 Internet Search proof provider package migration", () => {
  it("loads the SearXNG proof as a v2 package/component provider fixture", async () => {
    const manifest = await loadInternetSearchProviderManifest(process.cwd());

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
