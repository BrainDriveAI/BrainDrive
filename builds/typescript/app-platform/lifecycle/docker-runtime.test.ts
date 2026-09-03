import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  createInternetSearchProviderRuntime,
  INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
  INTERNET_SEARCH_SIDECAR_COMPONENT_ID,
} from "../../internet-search/provider-package.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function renderPackageSidecars(mode: "dev" | "local" = "dev") {
  const root = await mkdtemp(resolve(os.tmpdir(), "bd-sc008-docker-"));
  roots.push(root);
  const composePath = resolve(root, "package-sidecars.yml");
  const descriptorPath = resolve(root, "package-sidecars.json");
  const scriptPath = resolve(process.cwd(), "../../installer/docker/scripts/render-package-sidecars.mjs");
  await execFileAsync(process.execPath, [scriptPath, "--mode", mode, "--out", composePath, "--descriptors", descriptorPath]);
  return {
    compose: await readFile(composePath, "utf8"),
    descriptor: JSON.parse(await readFile(descriptorPath, "utf8")) as {
      descriptor_version: 1;
      target: string;
      sidecars: Array<{
        package_id: string;
        component_id: string;
        target: string;
        runtime_kind: string;
        transport: string;
        service_name: string;
        endpoint: string;
        health_path: string;
      }>;
    },
    descriptorPath,
  };
}

function noOwnerProjectionLeak(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(/bdsc-[a-f0-9]+|localhost|127\.|0\.0\.0\.0|\bport\b|endpoint|credential|secret|authorization|cookie|\/home\/|raw_response/i);
}

describe("Docker development first-party app package boundary", () => {
  it("mounts both separately buildable packages read-only for the enabled fixtures", async () => {
    const compose = await readFile(
      resolve(process.cwd(), "../../installer/docker/compose.dev.yml"),
      "utf8",
    );

    expect(compose).toContain("../../builds/resume_builder:/app/resume_builder:ro");
    expect(compose).toContain("../../builds/brief_builder:/app/brief_builder:ro");
  });

  it("selects the Docker adapter without publishing an app endpoint, Docker socket, host secret, or extra privilege", async () => {
    const compose = await readFile(resolve(process.cwd(), "../../installer/docker/compose.dev.yml"), "utf8");
    const appService = compose.slice(compose.indexOf("  app:"), compose.indexOf("\n  web:"));

    expect(appService).toContain("BRAINDRIVE_APP_PLATFORM_TARGET: docker_linux_x64");
    expect(appService).toContain("no-new-privileges:true");
    expect(appService).not.toMatch(/^\s{4}ports:/m);
    expect(appService).not.toMatch(/docker\.sock|BRAINDRIVE_APP_CONNECTION_TOKEN|BRAINDRIVE_ENDPOINT_BIND/);
    expect(appService).not.toMatch(/\/home\/|\/Users\/|[A-Za-z]:\\/);
  });

  it("does not keep provider-specific Internet Search sidecar services or endpoint env in base compose files", async () => {
    const [devCompose, localCompose] = await Promise.all([
      readFile(resolve(process.cwd(), "../../installer/docker/compose.dev.yml"), "utf8"),
      readFile(resolve(process.cwd(), "../../installer/docker/compose.local.yml"), "utf8"),
    ]);

    for (const compose of [devCompose, localCompose]) {
      expect(compose).not.toContain("internet-search-searxng");
      expect(compose).not.toContain("BRAINDRIVE_INTERNET_SEARCH_SIDECAR_URL");
      expect(compose).not.toContain("BRAINDRIVE_INTERNET_SEARCH_SIDECAR_TRANSPORT");
      expect(compose).not.toContain("BRAINDRIVE_INTERNET_SEARCH_SIDECAR_HEALTH_PATH");
    }
  });

  it("renders private Docker sidecar services from package manifests and wires only a generic descriptor file into app", async () => {
    const { compose, descriptor } = await renderPackageSidecars("dev");
    const [sidecar] = descriptor.sidecars;
    const searxngSettings = await readFile(
      resolve(process.cwd(), "../../installer/docker/sidecars/searxng/settings.yml"),
      "utf8",
    );

    expect(descriptor).toMatchObject({
      descriptor_version: 1,
      target: "docker_linux_x64",
      sidecars: [{
        package_id: INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
        component_id: INTERNET_SEARCH_SIDECAR_COMPONENT_ID,
        target: "docker_linux_x64",
        runtime_kind: "container",
        transport: "container_internal",
        health_path: "/healthz",
      }],
    });
    expect(sidecar?.service_name).toMatch(/^bdsc-[a-f0-9]{16}$/);
    expect(sidecar?.endpoint).toBe(`http://${sidecar?.service_name}:8080`);
    expect(compose).toContain("BRAINDRIVE_SIDECAR_RUNTIME_DESCRIPTOR_FILE: /run/braindrive-sidecars/runtime-descriptors.json");
    expect(compose).toContain(`${sidecar?.service_name}:`);
    expect(compose).toContain("image: searxng/searxng:2026.9");
    expect(compose).toContain("FORCE_OWNERSHIP: \"false\"");
    expect(compose).toMatch(/SEARXNG_SECRET: [A-Za-z0-9_-]{32,}/);
    expect(compose).toContain("./sidecars/searxng/settings.yml:/etc/searxng/settings.yml:ro");
    expect(compose).toContain("no-new-privileges:true");
    expect(JSON.stringify(descriptor)).not.toContain("config_mounts");
    expect(JSON.stringify(descriptor)).not.toContain("/etc/searxng/settings.yml");
    expect(compose).not.toMatch(/^\s{4}ports:/m);
    expect(compose).not.toContain("BRAINDRIVE_INTERNET_SEARCH_SIDECAR_URL");
    expect(compose).not.toContain("internet-search-searxng");
    expect(searxngSettings).toContain("use_default_settings: true");
    expect(searxngSettings).toContain("- json");
  });

  it("ignores desktop packaged-process targets when rendering Docker sidecars", async () => {
    const { descriptor, compose } = await renderPackageSidecars("dev");

    expect(descriptor.target).toBe("docker_linux_x64");
    expect(descriptor.sidecars).toHaveLength(1);
    expect(descriptor.sidecars[0]).toMatchObject({
      target: "docker_linux_x64",
      runtime_kind: "container",
    });
    expect(JSON.stringify(descriptor)).not.toMatch(/desktop_windows_x64|desktop_macos_universal|packaged_process|Docker Desktop|native support/i);
    expect(compose).not.toMatch(/desktop_windows_x64|desktop_macos_universal|packaged_process|Docker Desktop|native support/i);
  });

  it("keeps the Docker installer proof manifest in parity with the source package manifest", async () => {
    const [sourceManifest, installerManifest] = await Promise.all([
      readFile(resolve(process.cwd(), "../internet_search/manifest.json"), "utf8"),
      readFile(resolve(process.cwd(), "../../installer/docker/package-manifests/internet-search/manifest.json"), "utf8"),
    ]);

    expect(JSON.parse(installerManifest)).toEqual(JSON.parse(sourceManifest));
  });

  it("starts Internet Search through a package runtime descriptor without the legacy provider env shim", async () => {
    const { descriptorPath } = await renderPackageSidecars("dev");
    const fetchCalls: string[] = [];
    const root = await mkdtemp(resolve(os.tmpdir(), "bd-sc008-runtime-"));
    roots.push(root);
    const providerRuntime = await createInternetSearchProviderRuntime({
      rootDir: process.cwd(),
      memoryRoot: resolve(root, "memory"),
      stateRoot: resolve(root, "state"),
      target: "docker_linux_x64",
      env: {
        BRAINDRIVE_SIDECAR_RUNTIME_DESCRIPTOR_FILE: descriptorPath,
        BRAINDRIVE_SIDECAR_STARTUP_TIMEOUT_MS: "25",
        BRAINDRIVE_SIDECAR_READINESS_POLL_MS: "1",
      },
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        fetchCalls.push(`${url.hostname}${url.pathname}?${url.searchParams.get("q") ?? ""}`);
        if (url.pathname === "/healthz") return new Response("ok", { status: 200 });
        return new Response(JSON.stringify({
          results: [{ title: "Descriptor result", url: "https://example.test/result", content: "External inert result." }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
      readExecutor: null,
    });

    try {
      expect(providerRuntime.migrationShim).toBeNull();
      const discovery = await providerRuntime.capabilityRegistry.discover("web.search@1", { authorized: true });
      expect(discovery).toMatchObject({ state: "available", callable: true });
      noOwnerProjectionLeak(discovery);
      const envelope = await providerRuntime.operationRouter.call("web.search@1", {
        request_id: "00000000-0000-4000-8000-000000008001",
        run_id: "00000000-0000-4000-8000-000000008002",
        input: { query: "descriptor", max_results: 1 },
      }, { authorized: true, signal: new AbortController().signal });
      expect(envelope).toMatchObject({ capability: "web.search", status: "success" });
      noOwnerProjectionLeak(envelope);
      expect(fetchCalls.some((call) => /^bdsc-[a-f0-9]{16}\/healthz\?$/.test(call))).toBe(true);
      expect(fetchCalls.some((call) => /^bdsc-[a-f0-9]{16}\/search\?descriptor$/.test(call))).toBe(true);
    } finally {
      await providerRuntime.close();
    }
  });

  it("keeps admitted desktop sidecar targets stopped instead of partially activating through Docker", async () => {
    const root = await mkdtemp(resolve(os.tmpdir(), "bd-sc008-desktop-unsupported-"));
    roots.push(root);
    const providerRuntime = await createInternetSearchProviderRuntime({
      rootDir: process.cwd(),
      memoryRoot: resolve(root, "memory"),
      stateRoot: resolve(root, "state"),
      target: "desktop_windows_x64",
      env: {},
      searchExecutor: null,
      readExecutor: null,
    });

    try {
      const discovery = await providerRuntime.providerRegistry.discover("web.search@1", { authorized: true });
      expect(discovery).toMatchObject({
        state: "unavailable",
        callable: false,
        failure: { code: "provider_unavailable" },
      });
      const readDiscovery = await providerRuntime.providerRegistry.discover("web.read@1", { authorized: true });
      expect(readDiscovery).toMatchObject({ state: "available", callable: true });
      const sidecar = await providerRuntime.packageStore.readComponent(INTERNET_SEARCH_PROVIDER_PACKAGE_ID, INTERNET_SEARCH_SIDECAR_COMPONENT_ID);
      expect(sidecar).toMatchObject({ state: "stopped", health: "unknown" });
      expect(providerRuntime.migrationShim).toBeNull();
    } finally {
      await providerRuntime.close();
    }
  });

  it("keeps the documented support bundle executable and path-redacted", async () => {
    const scriptPath = resolve(
      process.cwd(),
      "../../installer/docker/scripts/support-bundle.sh",
    );
    const [script, metadata] = await Promise.all([
      readFile(scriptPath, "utf8"),
      stat(scriptPath),
    ]);

    expect(script.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    if (process.platform !== "win32") expect(metadata.mode & 0o111).not.toBe(0);
    expect(script).not.toContain("compose-config-rendered.txt");
    for (const replacement of [
      "[MEMORY_ROOT]",
      "[APP_STATE_ROOT]",
      "[SECRETS_ROOT]",
      "[HOST_PATH]",
    ]) {
      expect(script).toContain(replacement);
    }
  });
});
