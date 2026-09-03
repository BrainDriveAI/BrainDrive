import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CapabilityProviderRegistry,
  CapabilityOperationRouter,
  StoreBackedProviderSidecarAuthority,
  adapterKey,
  type CapabilityProviderDiscovery,
  type ProviderOperationAdapter,
  type RuntimeTarget,
} from "../app-capabilities/provider-router.js";
import { canonicalJson } from "../app-platform/contracts/common.js";
import {
  PackageComponentManifestSchema,
  type PackageComponentManifest,
} from "../app-platform/contracts/package-components.js";
import { InstalledPackageStore } from "../app-platform/lifecycle/installed-package-store.js";
import {
  GenericSidecarSupervisor,
  type PrivateSidecarRuntimeBinding,
  type SidecarRuntimeDriver,
  type SidecarRuntimeDriverContext,
} from "../app-platform/lifecycle/sidecar-supervisor.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import {
  INTERNET_SEARCH_ROUTE_OPERATIONS,
  type InternetSearchRouteCapabilityRegistry,
} from "./routes.js";
import { INTERNET_SEARCH_LOCAL_V1_LIMITS } from "./limits.js";
import {
  HttpSearxngSearchClient,
  SearxngWebSearchAdapter,
  type WebSearchExecutor,
} from "./search-adapter.js";
import {
  createConfiguredStaticWebReadAdapter,
  type WebReadExecutor,
} from "./read-adapter.js";
import {
  InternetSearchCapabilityDiscoverySchema,
  InternetSearchOperationIdSchema,
  type InternetSearchCapabilityDiscovery,
  type InternetSearchOperationId,
} from "./contracts/index.js";
import { INTERNET_SEARCH_OPERATIONS } from "./registry.js";
import { assertPrivateSearxngBinding } from "./sidecar.js";

export const INTERNET_SEARCH_PROVIDER_PACKAGE_ID = "ai.braindrive.internet-search.searxng";
export const INTERNET_SEARCH_PROVIDER_COMPONENT_ID = "search.provider";
export const INTERNET_SEARCH_SIDECAR_COMPONENT_ID = "search.runtime";

export const INTERNET_SEARCH_LEGACY_ENV_SHIM = Object.freeze({
  variable: "BRAINDRIVE_INTERNET_SEARCH_SIDECAR_URL",
  reason: "Retained only for manually configured legacy environments. Docker dev/local now prefer BRAINDRIVE_SIDECAR_RUNTIME_DESCRIPTOR_FILE generated from package sidecar descriptors.",
  removal_criteria: "Remove after every supported Docker installer path ships package-scoped sidecar descriptors and no supported owner path sets this provider-specific variable.",
});

export type InternetSearchProviderRuntime = {
  packageStore: InstalledPackageStore;
  providerRegistry: CapabilityProviderRegistry;
  capabilityRegistry: InternetSearchRouteCapabilityRegistry;
  operationRouter: CapabilityOperationRouter;
  close(): Promise<void>;
  migrationShim: typeof INTERNET_SEARCH_LEGACY_ENV_SHIM | null;
};

export async function createInternetSearchProviderRuntime(input: {
  rootDir: string;
  memoryRoot: string;
  stateRoot?: string;
  target?: RuntimeTarget;
  env?: NodeJS.ProcessEnv;
  packageStore?: InstalledPackageStore;
  searchExecutor?: WebSearchExecutor | null;
  readExecutor?: WebReadExecutor | null;
  fetchImpl?: typeof fetch;
  now?: () => string;
}): Promise<InternetSearchProviderRuntime> {
  const env = input.env ?? process.env;
  const target = input.target ?? "docker_linux_x64";
  const store = input.packageStore ?? new InstalledPackageStore(packageStoreRoot(input.memoryRoot, input.stateRoot));
  await store.initialize();
  const manifest = await loadInternetSearchProviderManifest(input.rootDir);
  await installProofPackageIfMissing(store, manifest);

  const packageRuntimeSidecars = await readPackageRuntimeSidecars(env.BRAINDRIVE_SIDECAR_RUNTIME_DESCRIPTOR_FILE, manifest, target);
  const shim = readLegacySearxngEnvShim(env);
  const driver = packageRuntimeSidecars
    ? new PackageRuntimeDescriptorSidecarDriver(packageRuntimeSidecars, input.fetchImpl)
    : shim
      ? new SearxngPackageSidecarDriver(shim, input.fetchImpl)
      : null;
  const supervisor = new GenericSidecarSupervisor({
    store,
    target,
    drivers: driver ? [driver] : [],
    readinessTimeoutMs: readPositiveInt(env.BRAINDRIVE_SIDECAR_STARTUP_TIMEOUT_MS ?? env.BRAINDRIVE_INTERNET_SEARCH_STARTUP_TIMEOUT_MS, 10_000),
    readinessPollMs: readPositiveInt(env.BRAINDRIVE_SIDECAR_READINESS_POLL_MS ?? env.BRAINDRIVE_INTERNET_SEARCH_READINESS_POLL_MS, 250),
  });
  if (driver) await startProofSidecarIfReachable(supervisor);

  const providerRegistry = new CapabilityProviderRegistry({ store, target });
  const capabilityRegistry = new InternetSearchPackageCapabilityRegistry(providerRegistry, async () => {
    if (!driver) return;
    try {
      await supervisor.health({
        packageId: INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
        componentId: INTERNET_SEARCH_SIDECAR_COMPONENT_ID,
        authority: { kind: "host" },
      });
    } catch {
      return;
    }
  });
  const searchExecutor = input.searchExecutor === null
    ? null
    : input.searchExecutor ?? new BindingBackedSearxngSearchExecutor({
        fetchImpl: input.fetchImpl,
        env,
        now: input.now,
      });
  const readExecutor = input.readExecutor === null
    ? null
    : input.readExecutor ?? createConfiguredStaticWebReadAdapter({
        env,
        fetchImpl: input.fetchImpl,
        now: input.now,
      });
  return {
    packageStore: store,
    providerRegistry,
    capabilityRegistry,
    operationRouter: new CapabilityOperationRouter({
      registry: providerRegistry,
      operations: INTERNET_SEARCH_ROUTE_OPERATIONS,
      adapters: internetSearchPackageOperationAdapters({ searchExecutor, readExecutor }),
      bindingService: supervisor.bindingService,
      sidecarAuthority: new StoreBackedProviderSidecarAuthority({
        store,
        target,
        bindingService: supervisor.bindingService,
      }),
    }),
    close: async () => {
      if (driver) {
        await supervisor.stop({
          packageId: INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
          componentId: INTERNET_SEARCH_SIDECAR_COMPONENT_ID,
          authority: { kind: "host" },
        }, "stop").catch(() => undefined);
      }
    },
    migrationShim: packageRuntimeSidecars ? null : shim ? INTERNET_SEARCH_LEGACY_ENV_SHIM : null,
  };
}

export async function loadInternetSearchProviderManifest(rootDir: string): Promise<PackageComponentManifest> {
  const manifestPath = manifestCandidates(rootDir).find((candidate) => existsSync(candidate));
  if (!manifestPath) throw new Error("Internet Search provider package manifest is missing");
  return PackageComponentManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
}

export function digestInternetSearchProviderManifest(manifest: PackageComponentManifest): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(manifest)).digest("hex")}`;
}

class InternetSearchPackageCapabilityRegistry implements InternetSearchRouteCapabilityRegistry {
  constructor(
    private readonly registry: CapabilityProviderRegistry,
    private readonly refreshProvider: () => Promise<void>,
  ) {}

  async refresh(): Promise<void> {
    await this.refreshProvider();
  }

  async discover(operationIdInput: InternetSearchOperationId, options: { authorized: boolean }): Promise<InternetSearchCapabilityDiscovery> {
    const operationId = InternetSearchOperationIdSchema.parse(operationIdInput);
    const discovery = await this.registry.discover(operationId, options);
    return projectInternetSearchDiscovery(operationId, discovery);
  }
}

class BindingBackedSearxngSearchExecutor implements WebSearchExecutor {
  constructor(private readonly options: {
    env: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    now?: () => string;
  }) {}

  async search(request: Parameters<WebSearchExecutor["search"]>[0]) {
    const binding = currentProviderBinding.getStore();
    if (!binding?.endpoint) throw new AppPlatformError("ambiguous_runtime_state", "Search sidecar binding is unavailable");
    const transport = binding.transport === "loopback" ? "loopback" : "container_internal";
    const adapter = new SearxngWebSearchAdapter({
      client: new HttpSearxngSearchClient({
        transport,
        endpoint_url: binding.endpoint,
      }, {
        searchPath: this.options.env.BRAINDRIVE_INTERNET_SEARCH_SIDECAR_SEARCH_PATH?.trim() || undefined,
        timeoutMs: readPositiveInt(this.options.env.BRAINDRIVE_INTERNET_SEARCH_QUERY_TIMEOUT_MS, INTERNET_SEARCH_LOCAL_V1_LIMITS.search_operation_timeout_ms),
        fetchImpl: this.options.fetchImpl,
      }),
      now: this.options.now,
    });
    return adapter.search(request);
  }
}

class SearxngPackageSidecarDriver implements SidecarRuntimeDriver {
  readonly runtimeKind = "container" as const;

  constructor(
    private readonly shim: NonNullable<ReturnType<typeof readLegacySearxngEnvShim>>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async start(_context: SidecarRuntimeDriverContext) {
    return {
      transport: this.shim.transport,
      endpoint: this.shim.endpointUrl,
    };
  }

  async health(context: SidecarRuntimeDriverContext) {
    const healthUrl = new URL(this.shim.endpointUrl);
    healthUrl.pathname = this.shim.healthPath ?? context.sidecar.health.path ?? "/healthz";
    healthUrl.search = "";
    healthUrl.hash = "";
    try {
      const response = await this.fetchImpl(healthUrl, {
        signal: AbortSignal.timeout(this.shim.healthTimeoutMs),
      });
      return { healthy: response.ok, error_code: response.ok ? null : "health_failed" };
    } catch {
      return { healthy: false, error_code: "health_failed" };
    }
  }

  async stop(_context: SidecarRuntimeDriverContext): Promise<void> {
    return;
  }

  async uninstall(_context: SidecarRuntimeDriverContext): Promise<void> {
    return;
  }

  async cleanup(_context: SidecarRuntimeDriverContext): Promise<void> {
    return;
  }
}

type PackageRuntimeSidecar = {
  package_id: string;
  component_id: string;
  target: RuntimeTarget;
  runtime_kind: "container";
  transport: "container_internal";
  endpoint: string;
  health_path: string;
};

class PackageRuntimeDescriptorSidecarDriver implements SidecarRuntimeDriver {
  readonly runtimeKind = "container" as const;

  constructor(
    private readonly sidecars: readonly PackageRuntimeSidecar[],
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async start(context: SidecarRuntimeDriverContext) {
    const descriptor = this.requireDescriptor(context);
    return {
      transport: descriptor.transport,
      endpoint: descriptor.endpoint,
    };
  }

  async health(context: SidecarRuntimeDriverContext) {
    const descriptor = this.requireDescriptor(context);
    const healthUrl = new URL(descriptor.endpoint);
    healthUrl.pathname = descriptor.health_path || context.sidecar.health.path || "/healthz";
    healthUrl.search = "";
    healthUrl.hash = "";
    try {
      const response = await this.fetchImpl(healthUrl, {
        signal: AbortSignal.timeout(context.sidecar.health.timeout_ms),
      });
      return { healthy: response.ok, error_code: response.ok ? null : "health_failed" };
    } catch {
      return { healthy: false, error_code: "health_failed" };
    }
  }

  async stop(_context: SidecarRuntimeDriverContext): Promise<void> {
    return;
  }

  async uninstall(_context: SidecarRuntimeDriverContext): Promise<void> {
    return;
  }

  async cleanup(_context: SidecarRuntimeDriverContext): Promise<void> {
    return;
  }

  private requireDescriptor(context: SidecarRuntimeDriverContext): PackageRuntimeSidecar {
    const descriptor = this.sidecars.find((candidate) => (
      candidate.package_id === context.packageId
      && candidate.component_id === context.sidecar.component_id
      && candidate.target === context.target.target
      && candidate.runtime_kind === context.target.runtime_kind
    ));
    if (!descriptor) throw new AppPlatformError("host_incompatible", "Package sidecar runtime descriptor is unavailable");
    return descriptor;
  }
}

async function installProofPackageIfMissing(store: InstalledPackageStore, manifest: PackageComponentManifest): Promise<void> {
  const existing = await store.readPackage(manifest.package_id);
  if (existing) return;
  await store.installPackage({
    manifest,
    packageDigest: digestInternetSearchProviderManifest(manifest),
    source: { kind: "repository_fixture", label: "Internet Search provider package fixture" },
    installedAt: "2026-09-01T00:00:00.000Z",
  });
}

async function startProofSidecarIfReachable(supervisor: GenericSidecarSupervisor): Promise<void> {
  try {
    await supervisor.start({
      packageId: INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
      componentId: INTERNET_SEARCH_SIDECAR_COMPONENT_ID,
      authority: { kind: "host" },
    });
    await supervisor.awaitReadiness({
      packageId: INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
      componentId: INTERNET_SEARCH_SIDECAR_COMPONENT_ID,
      authority: { kind: "host" },
    });
  } catch {
    return;
  }
}

function projectInternetSearchDiscovery(
  operationId: InternetSearchOperationId,
  discovery: CapabilityProviderDiscovery,
): InternetSearchCapabilityDiscovery {
  if (!discovery.grant.authorized) {
    return InternetSearchCapabilityDiscoverySchema.parse({
      discovery_version: 1,
      operation_id: operationId,
      state: "unauthorized",
      callable: false,
      capability: null,
      provider_profile: null,
      health: null,
      grant: { required: true, authorized: false },
      message: "Capability authorization is required.",
    });
  }
  const hasProvider = discovery.provider_count > 0;
  const state = discovery.state === "available"
    ? "available"
    : discovery.state === "disabled"
      ? "disabled"
      : discovery.state === "unhealthy"
        ? "unhealthy"
        : "unavailable";
  return InternetSearchCapabilityDiscoverySchema.parse({
    discovery_version: 1,
    operation_id: operationId,
    state,
    callable: state === "available",
    capability: hasProvider ? {
      capability_id: "internet-search",
      version: "1.0.0",
      operations: INTERNET_SEARCH_OPERATIONS,
    } : null,
    provider_profile: hasProvider ? {
      profile_id: "local-owner-managed",
      display_name: "Local Internet Search",
      management: "owner_managed_local",
      billing: "none",
      disclosure: {
        last_reviewed_at: "2026-09-01T00:00:00.000Z",
        summary: "Use is mediated by the local owner-managed Internet Search provider package.",
      },
    } : null,
    health: discovery.health ? {
      state: discovery.health.state,
      checked_at: discovery.health.checked_at,
    } : null,
    grant: { required: true, authorized: true },
    message: state === "available"
      ? "Internet Search is available."
      : hasProvider
        ? "Internet Search is unavailable."
        : "Internet Search is not installed.",
  });
}

function readLegacySearxngEnvShim(env: NodeJS.ProcessEnv): {
  endpointUrl: string;
  transport: "container_internal" | "loopback";
  healthPath?: string;
  healthTimeoutMs: number;
} | null {
  if (!readBooleanEnv(env.BRAINDRIVE_INTERNET_SEARCH_ENABLED, true)) return null;
  const endpointUrl = env.BRAINDRIVE_INTERNET_SEARCH_SIDECAR_URL?.trim();
  if (!endpointUrl) return null;
  const transport = env.BRAINDRIVE_INTERNET_SEARCH_SIDECAR_TRANSPORT === "loopback" ? "loopback" : "container_internal";
  const binding = assertPrivateSearxngBinding({ transport, endpoint_url: endpointUrl });
  return {
    endpointUrl: binding.endpoint_url,
    transport,
    healthPath: env.BRAINDRIVE_INTERNET_SEARCH_SIDECAR_HEALTH_PATH?.trim() || undefined,
    healthTimeoutMs: readPositiveInt(env.BRAINDRIVE_INTERNET_SEARCH_HEALTH_TIMEOUT_MS, 1_000),
  };
}

async function readPackageRuntimeSidecars(
  descriptorFile: string | undefined,
  manifest: PackageComponentManifest,
  target: RuntimeTarget,
): Promise<PackageRuntimeSidecar[] | null> {
  const descriptorPath = descriptorFile?.trim();
  if (!descriptorPath) return null;
  const raw = JSON.parse(await readFile(descriptorPath, "utf8")) as {
    descriptor_version?: unknown;
    target?: unknown;
    sidecars?: unknown;
  };
  if (raw.descriptor_version !== 1 || raw.target !== target || !Array.isArray(raw.sidecars)) {
    throw new AppPlatformError("descriptor_invalid", "Package sidecar runtime descriptor file is invalid");
  }
  const sidecars: PackageRuntimeSidecar[] = [];
  for (const candidate of raw.sidecars) {
    const value = candidate as Partial<PackageRuntimeSidecar>;
    if (value.package_id !== manifest.package_id) continue;
    const sidecar = manifest.sidecars.find((entry) => entry.component_id === value.component_id);
    if (!sidecar) continue;
    const targetDescriptor = sidecar.targets.find((entry) => entry.target === target && entry.runtime_kind === "container");
    if (!targetDescriptor || value.runtime_kind !== "container" || value.transport !== "container_internal" || value.target !== target) {
      throw new AppPlatformError("descriptor_invalid", "Package sidecar runtime descriptor does not match the manifest target");
    }
    const binding = assertPrivateSearxngBinding({ transport: value.transport, endpoint_url: String(value.endpoint ?? "") });
    sidecars.push({
      package_id: manifest.package_id,
      component_id: sidecar.component_id,
      target,
      runtime_kind: "container",
      transport: "container_internal",
      endpoint: binding.endpoint_url,
      health_path: typeof value.health_path === "string" && value.health_path.startsWith("/") ? value.health_path : sidecar.health.path ?? "/healthz",
    });
  }
  return sidecars.length > 0 ? sidecars : null;
}

function packageStoreRoot(memoryRoot: string, stateRoot?: string): string {
  const root = path.resolve(stateRoot ?? path.join(path.dirname(memoryRoot), "app-platform-host"));
  return path.join(root, "state", "packages");
}

function manifestCandidates(rootDir: string): string[] {
  return [
    path.resolve(rootDir, "builds/internet_search/manifest.json"),
    path.resolve(rootDir, "../internet_search/manifest.json"),
    path.resolve(process.cwd(), "builds/internet_search/manifest.json"),
    path.resolve(process.cwd(), "../internet_search/manifest.json"),
    fileURLToPath(new URL("../../../internet_search/manifest.json", import.meta.url)),
    fileURLToPath(new URL("../../../../internet_search/manifest.json", import.meta.url)),
  ];
}

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return fallback;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const currentProviderBinding = new AsyncLocalStorage<PrivateSidecarRuntimeBinding>();

export function internetSearchPackageOperationAdapters(input: {
  searchExecutor: WebSearchExecutor | null;
  readExecutor: WebReadExecutor | null;
}): Record<string, ProviderOperationAdapter> {
  const adapters: Record<string, ProviderOperationAdapter> = {};
  if (input.searchExecutor) {
    adapters[adapterKey(INTERNET_SEARCH_PROVIDER_PACKAGE_ID, INTERNET_SEARCH_PROVIDER_COMPONENT_ID, "web.search@1")] = {
      invoke: async (request, context) => {
        const binding = context.bindingForRequiredSidecar(INTERNET_SEARCH_SIDECAR_COMPONENT_ID) as PrivateSidecarRuntimeBinding;
        return await currentProviderBinding.run(binding, async () => input.searchExecutor!.search(request as Parameters<WebSearchExecutor["search"]>[0]));
      },
    };
  }
  if (input.readExecutor) {
    adapters[adapterKey(INTERNET_SEARCH_PROVIDER_PACKAGE_ID, INTERNET_SEARCH_PROVIDER_COMPONENT_ID, "web.read@1")] = {
      invoke: async (request) => input.readExecutor!.read(request as Parameters<WebReadExecutor["read"]>[0]),
    };
  }
  return adapters;
}
