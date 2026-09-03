import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { GrantedCapabilityNameSchema } from "../contracts/package.js";
import { AppRouteKeySchema } from "../contracts/app-registry.js";
import type { CapabilityDependency } from "../contracts/package-components.js";
import { AppPlatformError } from "./errors.js";
import { MODERN_FIXTURE_VERSION } from "./fixture-repository.js";
import { manifestCapabilities, manifestDataCompatibility, type RuntimePackageManifest } from "./package-verifier.js";
import type { AppLifecycleService, LifecycleResponse } from "./service.js";
import { safeSidecarOperation, type HostSidecarLifecycleService, type SidecarLifecycleResponse } from "./sidecar-lifecycle-authority.js";
import type { CapabilityDependencyAvailability, CapabilityDependencyReadiness, CapabilityDependencyResolution, CapabilityDependencyResolver, InstalledPackageStore } from "./installed-package-store.js";

const bindingSchema = z.object({
  operation_id: z.string().uuid(),
  idempotency_key: z.string().min(16).max(256),
  expected_generation: z.number().int().nonnegative(),
}).strict();
const installSchema = bindingSchema.extend({
  installation_id: z.null(),
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  approve_capabilities: z.literal(true),
}).strict();
const installedActionSchema = bindingSchema.extend({ installation_id: z.string().uuid() }).strict();
const updateSchema = installedActionSchema.extend({
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  approve_capabilities: z.boolean(),
}).strict();
const uninstallSchema = installedActionSchema.extend({ confirm_retained_data: z.literal(true) }).strict();
const operationQuerySchema = z.object({ installation_id: z.string().uuid() }).strict();
const sessionSchema = z.object({
  audience: z.enum(["app_data", "app_inference", "app_export", "app_bridge"]),
  capabilities: z.array(GrantedCapabilityNameSchema).min(1),
  operation_id: z.string().uuid(),
  view_id: z.string().uuid().optional(),
}).strict();
const deletionSchema = z.object({
  operation_id: z.string().uuid(), idempotency_key: z.string().min(16).max(256),
  confirm_app_id: z.string().min(3).max(128), trusted_owner_confirmation: z.literal(true),
}).strict();
const sidecarActionSchema = z.object({
  operation_id: z.string().uuid().optional(),
  idempotency_key: z.string().min(16).max(256),
  expected_generation: z.number().int().nonnegative().optional(),
}).strict();
const sidecarParamsSchema = z.object({
  packageId: z.string().min(3).max(128),
  componentId: z.string().min(3).max(128),
}).strict();

export type AppLifecycleRouteEntry = {
  routeKey: string;
  displayName: string;
  publisherName: string;
  service: AppLifecycleService;
  availableVersion?: string;
};
export type AppLifecycleRouteOptions = {
  packageStore?: InstalledPackageStore;
  capabilityDependencyResolver?: CapabilityDependencyResolver | null;
};
export type AppDependencyRouteGate = {
  capability_dependency_status: CapabilityDependencyAvailability[];
  dependency_readiness: CapabilityDependencyReadiness;
};
type AppDependencyRouteEntry = { routeKey: string; service: { appId: string } };

export type AppLifecycleRoutePlatform = ReturnType<typeof createAppLifecycleRoutePlatform>;

export function createAppLifecycleRoutePlatform(rawEntries: readonly AppLifecycleRouteEntry[], maxActiveApps = 2, options: AppLifecycleRouteOptions = {}) {
  const entries = rawEntries.map((entry) => ({ ...entry, routeKey: AppRouteKeySchema.parse(entry.routeKey) }))
    .sort((left, right) => left.routeKey.localeCompare(right.routeKey));
  if (entries.length === 0 || new Set(entries.map((entry) => entry.routeKey)).size !== entries.length || new Set(entries.map((entry) => entry.service.appId)).size !== entries.length
    || new Set(entries.map((entry) => entry.service.ownerActorId)).size !== 1 || new Set(entries.map((entry) => entry.service.ownerId)).size !== 1) {
    throw new AppPlatformError("descriptor_invalid", "Lifecycle route registry is empty or ambiguous");
  }
  const byRouteKey = new Map(entries.map((entry) => [entry.routeKey, entry]));
  const packageStore = options.packageStore ?? null;
  const capabilityDependencyResolver = options.capabilityDependencyResolver ?? null;
  let admissionTail = Promise.resolve();
  return Object.freeze({
    entries: Object.freeze(entries),
    resolve(routeKey: unknown): AppLifecycleRouteEntry {
      const parsed = AppRouteKeySchema.safeParse(routeKey);
      const entry = parsed.success ? byRouteKey.get(parsed.data) : undefined;
      if (!entry) throw new AppPlatformError("app_not_found", "App route is unavailable", 404);
      return entry;
    },
    async activate<T>(selected: AppLifecycleRouteEntry, version: string | null, action: () => Promise<T>): Promise<T> {
      let release!: () => void;
      const prior = admissionTail;
      admissionTail = new Promise<void>((resolve) => { release = resolve; });
      await prior;
      try {
        await assertLegacyAppDependenciesReady(selected, packageStore, capabilityDependencyResolver);
        const states = await Promise.all(entries.map(async (entry) => ({ entry, state: (await entry.service.status()).state })));
        const active = states.filter(({ state }) => ["active", "staged", "updating", "rollback_pending"].includes(state));
        const selectedActive = active.some(({ entry }) => entry.service.appId === selected.service.appId);
        if (!selectedActive && active.length >= maxActiveApps) {
          auditRouteDecision(selected, "app.lifecycle.admission", version, "denied", "active_app_limit_reached");
          throw new AppPlatformError("active_app_limit_reached", "The host-wide active app limit has been reached", 409);
        }
        auditRouteDecision(selected, "app.lifecycle.admission", version, "accepted", null);
        return await action();
      } finally { release(); }
    },
    packageStore,
    capabilityDependencyResolver,
  });
}

export function registerAppLifecycleRoutes(app: FastifyInstance, serviceOrPlatform: AppLifecycleService | AppLifecycleRoutePlatform): void {
  const platform = "entries" in serviceOrPlatform
    ? serviceOrPlatform
    : createAppLifecycleRoutePlatform([{ routeKey: "resume-builder", displayName: "Resume Builder", publisherName: "BrainDrive", availableVersion: MODERN_FIXTURE_VERSION, service: serviceOrPlatform }]);
  app.get("/apps", async (request, reply) => {
    if (!authorizeOwner(request, reply, platform.entries[0]!.service)) return;
    const apps = await Promise.all(platform.entries.map((entry) => ownerSafeDescriptor(entry, platform)));
    const packages = platform.packageStore ? await platform.packageStore.ownerSafeCatalog({ dependencyResolver: platform.capabilityDependencyResolver }) : [];
    platform.entries.forEach((entry, index) => {
      const descriptor = apps[index]!;
      auditRouteDecision(entry, "app.catalog.projection", descriptor.version.installed ?? descriptor.version.available, "included", null, descriptor.identity.package_digest);
    });
    return reply.send({ catalog_version: 1, apps, packages });
  });

  for (const route of ["/apps/:appKey", "/apps/:appKey/status", "/apps/:appKey/inspect"]) {
    app.get(route, async (request, reply) => {
      const entry = resolveEntry(request, reply, platform);
      if (!entry || !authorizeOwner(request, reply, entry.service)) return;
      return reply.send(await ownerSafeDescriptor(entry, platform));
    });
  }

  app.post("/apps/:appKey/install", async (request, reply) => routeMutate(request, reply, platform, installSchema, true, (service, body) => service.install(packageInput(request, body))));
  app.post("/apps/:appKey/reinstall", async (request, reply) => routeMutate(request, reply, platform, installSchema, true, (service, body) => service.reinstall(packageInput(request, body))));
  app.post("/apps/:appKey/update", async (request, reply) => routeMutate(request, reply, platform, updateSchema, false, (service, body) => service.update(packageInput(request, body))));
  app.post("/apps/:appKey/disable", async (request, reply) => routeMutate(request, reply, platform, installedActionSchema, false, (service, body) => service.disable(simpleInput(request, body))));
  app.post("/apps/:appKey/enable", async (request, reply) => routeMutate(request, reply, platform, installedActionSchema, true, (service, body) => service.enable(simpleInput(request, body))));
  app.post("/apps/:appKey/rollback", async (request, reply) => routeMutate(request, reply, platform, installedActionSchema, false, (service, body) => service.rollback(simpleInput(request, body))));
  app.post("/apps/:appKey/recover", async (request, reply) => routeMutate(request, reply, platform, installedActionSchema, true, (service, body) => service.recover(simpleInput(request, body))));
  app.post("/apps/:appKey/uninstall", async (request, reply) => routeMutate(request, reply, platform, uninstallSchema, false, (service, body) => service.uninstall(simpleInput(request, body))));

  app.get("/apps/:appKey/operations/:operationId", async (request, reply) => {
    const entry = resolveEntry(request, reply, platform);
    if (!entry) return;
    const service = entry.service;
    if (!authorizeOwner(request, reply, service)) return;
    const params = z.object({ operationId: z.string().uuid() }).safeParse(request.params);
    const query = operationQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "invalid_request" });
    const operation = await service.dependencies.store.readOperation(params.data.operationId);
    if (!operation) return reply.code(404).send({ error: "operation_not_found" });
    if (operation.installation_id !== query.data.installation_id || operation.owner_id !== service.ownerId) return reply.code(403).send({ error: "owner_or_installation_mismatch", retryable: false });
    return reply.send(safeOperation(operation));
  });

  app.post("/apps/:appKey/operations/:operationId/cancel", async (request, reply) => {
    const entry = resolveEntry(request, reply, platform);
    if (!entry) return;
    const service = entry.service;
    if (!authorizeOwner(request, reply, service)) return;
    const params = z.object({ operationId: z.string().uuid() }).safeParse(request.params);
    const body = operationQuerySchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const operation = await service.dependencies.store.readOperation(params.data.operationId);
    if (!operation) return reply.code(404).send({ error: "operation_not_found" });
    if (operation.installation_id !== body.data.installation_id || operation.owner_id !== service.ownerId) return reply.code(403).send({ error: "owner_or_installation_mismatch", retryable: false });
    try { return reply.send(safeOperation(await service.cancel(params.data.operationId))); }
    catch (error) { return sendSafeError(reply, error); }
  });

  app.post("/apps/:appKey/session", async (request, reply) => {
    const entry = resolveEntry(request, reply, platform);
    if (!entry) return;
    const service = entry.service;
    if (!authorizeOwner(request, reply, service)) return;
    const parsed = sessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      await assertLegacyAppDependenciesReady(entry, platform.packageStore, platform.capabilityDependencyResolver);
      const issued = await service.issueSession({ audience: parsed.data.audience, capabilities: parsed.data.capabilities, operationId: parsed.data.operation_id, viewId: parsed.data.view_id });
      const claims = issued.claims;
      return reply.send({ token_version: 1, token: issued.token, claims: { audience: claims.audience, installation_id: claims.installation_id, operation_id: claims.operation_id, capabilities: claims.capabilities, expires_at: claims.expires_at, view_id: claims.view_id } });
    } catch (error) { return sendSafeError(reply, error); }
  });

  app.post("/apps/:appKey/data/delete", async (request, reply) => {
    const entry = resolveEntry(request, reply, platform);
    if (!entry || !authorizeOwner(request, reply, entry.service)) return;
    const parsed = deletionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.send(await entry.service.deleteRetainedData({
        operationId: parsed.data.operation_id, idempotencyKey: parsed.data.idempotency_key,
        ownerActorId: request.authContext.actorId, confirmAppId: parsed.data.confirm_app_id,
        trustedOwnerConfirmation: parsed.data.trusted_owner_confirmation,
      }));
    } catch (error) { return sendSafeError(reply, error); }
  });

  app.post("/apps/:appKey/data/export", async (request, reply) => {
    const entry = resolveEntry(request, reply, platform);
    if (!entry || !authorizeOwner(request, reply, entry.service)) return;
    const parsed = deletionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.send(await entry.service.exportRetainedData({
        operationId: parsed.data.operation_id, idempotencyKey: parsed.data.idempotency_key,
        ownerActorId: request.authContext.actorId, confirmAppId: parsed.data.confirm_app_id,
        trustedOwnerConfirmation: parsed.data.trusted_owner_confirmation,
      }));
    } catch (error) { return sendSafeError(reply, error); }
  });

  app.post("/apps/:appKey/data/archive", async (request, reply) => {
    const entry = resolveEntry(request, reply, platform);
    if (!entry || !authorizeOwner(request, reply, entry.service)) return;
    const parsed = deletionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.send(await entry.service.archiveRetainedData({
        operationId: parsed.data.operation_id, idempotencyKey: parsed.data.idempotency_key,
        ownerActorId: request.authContext.actorId, confirmAppId: parsed.data.confirm_app_id,
        trustedOwnerConfirmation: parsed.data.trusted_owner_confirmation,
      }));
    } catch (error) { return sendSafeError(reply, error); }
  });
}

export function registerSidecarLifecycleRoutes(app: FastifyInstance, service: HostSidecarLifecycleService): void {
  app.get("/packages/:packageId/sidecars/:componentId/lifecycle", async (request, reply) => {
    if (!authorizeSidecarOwner(request, reply)) return;
    const params = sidecarParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.send(await service.ownerProjection(params.data.packageId, params.data.componentId));
    } catch (error) {
      return sendSafeSidecarError(reply, error);
    }
  });

  for (const action of ["start", "enable", "disable", "restart", "rollback", "uninstall"] as const) {
    app.post(`/packages/:packageId/sidecars/:componentId/${action}`, async (request, reply) => {
      if (!authorizeSidecarOwner(request, reply)) return;
      const params = sidecarParamsSchema.safeParse(request.params);
      const body = sidecarActionSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
      try {
        const input = {
          authority: { kind: "host" as const },
          packageId: params.data.packageId,
          componentId: params.data.componentId,
          idempotencyKey: body.data.idempotency_key,
          operationId: body.data.operation_id,
          expectedGeneration: body.data.expected_generation,
        };
        const response = await service[action](input) as SidecarLifecycleResponse;
        return reply.send({ ...(await service.ownerProjection(params.data.packageId, params.data.componentId)), operation: safeSidecarOperation(response.operation) });
      } catch (error) {
        return sendSafeSidecarError(reply, error);
      }
    });
  }

  app.post("/packages/sidecars/shutdown", async (request, reply) => {
    if (!authorizeSidecarOwner(request, reply)) return;
    const body = sidecarActionSchema.omit({ expected_generation: true }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const result = await service.shutdown({ authority: { kind: "host" }, idempotencyKey: body.data.idempotency_key, operationId: body.data.operation_id });
      return reply.send({ operation: safeSidecarOperation(result.operation), affected_count: result.records.length });
    } catch (error) {
      return sendSafeSidecarError(reply, error);
    }
  });
}

function resolveEntry(request: FastifyRequest, reply: FastifyReply, platform: AppLifecycleRoutePlatform): AppLifecycleRouteEntry | null {
  try { return platform.resolve((request.params as { appKey?: unknown } | undefined)?.appKey); }
  catch { reply.code(404).send({ error: "app_not_found" }); return null; }
}

function packageInput(request: FastifyRequest, body: z.infer<typeof installSchema> | z.infer<typeof updateSchema>) {
  return {
    version: body.version,
    idempotencyKey: body.idempotency_key,
    approveCapabilities: body.approve_capabilities,
    operationId: body.operation_id,
    ownerActorId: request.authContext.actorId,
    installationId: body.installation_id,
    expectedGeneration: body.expected_generation,
  };
}

function simpleInput(request: FastifyRequest, body: z.infer<typeof installedActionSchema>) {
  return {
    idempotencyKey: body.idempotency_key,
    operationId: body.operation_id,
    ownerActorId: request.authContext.actorId,
    installationId: body.installation_id,
    expectedGeneration: body.expected_generation,
  };
}

async function routeMutate<S extends z.ZodType, T extends LifecycleResponse>(request: FastifyRequest, reply: FastifyReply, platform: AppLifecycleRoutePlatform, schema: S, admissionRequired: boolean, action: (service: AppLifecycleService, body: z.output<S>) => Promise<T>): Promise<unknown> {
  const entry = resolveEntry(request, reply, platform);
  if (!entry || !authorizeOwner(request, reply, entry.service)) return;
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
  try {
    const requestedVersion = typeof parsed.data === "object" && parsed.data !== null && "version" in parsed.data && typeof parsed.data.version === "string" ? parsed.data.version : null;
    const response = admissionRequired ? await platform.activate(entry, requestedVersion, () => action(entry.service, parsed.data)) : await action(entry.service, parsed.data);
    return reply.send({ ...(await ownerSafeDescriptor(entry, platform)), operation: safeOperation(response.operation) });
  } catch (error) { return sendSafeError(reply, error); }
}

function auditRouteDecision(entry: AppLifecycleRouteEntry, event: string, version: string | null, decision: "accepted" | "denied" | "included", errorCode: string | null, packageDigest: string | null = null): void {
  entry.service.dependencies.audit?.(event, {
    app_id: entry.service.appId,
    package_version: version,
    package_digest: packageDigest,
    target: entry.service.dependencies.runtimeTarget?.target ?? null,
    decision,
    error_code: errorCode,
  });
}

function authorizeOwner(request: FastifyRequest, reply: FastifyReply, service: AppLifecycleService): boolean {
  if (request.authContext?.actorType !== "owner" || !request.authContext.permissions.administration) {
    reply.code(403).send({ error: "owner_authorization_required" });
    return false;
  }
  if (request.authContext.actorId !== service.ownerActorId) {
    reply.code(403).send({ error: "owner_or_installation_mismatch", retryable: false });
    return false;
  }
  return true;
}

export async function assertLegacyAppDependenciesReady(
  entry: AppDependencyRouteEntry,
  packageStore: InstalledPackageStore | null,
  dependencyResolver: CapabilityDependencyResolver | null,
): Promise<void> {
  const gate = await legacyAppDependencyGate(entry, packageStore, dependencyResolver);
  if (gate.dependency_readiness.status !== "blocked") return;
  throw new AppPlatformError("provider_unavailable", "Required app capability dependency is unavailable", 409, {
    blockingOperationIds: gate.dependency_readiness.blocking_operation_ids,
    dependencyReadiness: gate.dependency_readiness,
  });
}

export async function legacyAppDependencyGate(
  entry: AppDependencyRouteEntry,
  packageStore: InstalledPackageStore | null,
  dependencyResolver: CapabilityDependencyResolver | null,
): Promise<AppDependencyRouteGate> {
  const dependencies = packageStore ? await appPackageDependencies(packageStore, entry.service.appId, entry.routeKey) : [];
  const statuses = await resolveDependencyStatuses(dependencies, dependencyResolver);
  return {
    capability_dependency_status: statuses,
    dependency_readiness: dependencyReadiness(statuses),
  };
}

async function appPackageDependencies(packageStore: InstalledPackageStore, appId: string, routeKey: string): Promise<SafeRouteDependency[]> {
  const dependencies = new Map<string, SafeRouteDependency>();
  for (const record of await packageStore.listPackages()) {
    let matched = false;
    for (const component of record.manifest.components) {
      if (component.component_kind !== "app" || component.app_id !== appId || component.route_key !== routeKey) continue;
      matched = true;
      for (const dependency of component.requested_capabilities) mergeDependency(dependencies, dependency);
    }
    if (matched) for (const dependency of record.manifest.capability_dependencies) mergeDependency(dependencies, dependency);
  }
  return [...dependencies.values()];
}

type SafeRouteDependency = Pick<CapabilityDependency, "operation_id" | "requirement" | "unavailable_behavior">;

function mergeDependency(dependencies: Map<string, SafeRouteDependency>, dependency: CapabilityDependency): void {
  const safe = safeDependency(dependency);
  const prior = dependencies.get(safe.operation_id);
  if (!prior || prior.requirement === "optional" && safe.requirement === "required") {
    dependencies.set(safe.operation_id, safe);
  }
}

function safeDependency(dependency: CapabilityDependency): SafeRouteDependency {
  return {
    operation_id: dependency.operation_id,
    requirement: dependency.requirement,
    unavailable_behavior: dependency.unavailable_behavior,
  };
}

async function resolveDependencyStatuses(dependencies: readonly SafeRouteDependency[], resolver: CapabilityDependencyResolver | null): Promise<CapabilityDependencyAvailability[]> {
  const resolutions = new Map<string, CapabilityDependencyResolution>();
  return await Promise.all(dependencies.map(async (dependency) => {
    let resolution = resolutions.get(dependency.operation_id);
    if (!resolution) {
      resolution = resolver ? await safeResolveDependency(resolver, dependency.operation_id) : dependencyResolution(dependency.operation_id, "unknown", false, 0, "unknown", "Capability dependency readiness has not been checked.", null);
      resolutions.set(dependency.operation_id, resolution);
    }
    const state = dependencyState(resolution);
    return {
      operation_id: dependency.operation_id,
      requirement: dependency.requirement,
      unavailable_behavior: dependency.unavailable_behavior,
      state,
      callable: resolution.callable && state === "available",
      provider_count: resolution.provider_count,
      failure_code: resolution.callable ? null : resolution.failure_code,
      safe_message: resolution.callable ? "Capability dependency is available." : resolution.safe_message,
      checked_at: resolution.checked_at,
    };
  }));
}

function dependencyState(resolution: CapabilityDependencyResolution): CapabilityDependencyResolution["state"] {
  if (resolution.callable) return "available";
  if (resolution.state === "unavailable" && resolution.provider_count === 0) return "missing";
  return resolution.state;
}

async function safeResolveDependency(resolver: CapabilityDependencyResolver, operationId: string): Promise<CapabilityDependencyResolution> {
  try { return await resolver.resolveDependency(operationId); }
  catch { return dependencyResolution(operationId, "unknown", false, 0, "unknown", "Capability dependency readiness could not be checked.", null); }
}

function dependencyReadiness(dependencies: readonly CapabilityDependencyAvailability[]): CapabilityDependencyReadiness {
  const blocking = dependencies.filter((dependency) => dependency.requirement === "required" && !dependency.callable).map((dependency) => dependency.operation_id);
  const degraded = dependencies.filter((dependency) => dependency.requirement === "optional" && !dependency.callable).map((dependency) => dependency.operation_id);
  const hasUnknown = dependencies.some((dependency) => dependency.state === "unknown");
  return {
    status: blocking.length > 0 ? "blocked" : degraded.length > 0 ? "degraded" : hasUnknown ? "unknown" : "ready",
    required_available: blocking.length === 0,
    optional_available: degraded.length === 0,
    blocking_operation_ids: blocking,
    degraded_operation_ids: degraded,
  };
}

function dependencyResolution(
  operationId: string,
  state: CapabilityDependencyResolution["state"],
  callable: boolean,
  providerCount: number,
  failureCode: CapabilityDependencyResolution["failure_code"],
  safeMessage: string,
  checkedAt: string | null,
): CapabilityDependencyResolution {
  return {
    operation_id: operationId,
    state,
    callable,
    provider_count: providerCount,
    failure_code: failureCode,
    safe_message: safeMessage,
    checked_at: checkedAt,
  };
}

async function ownerSafeDescriptor(entry: AppLifecycleRouteEntry, platform: AppLifecycleRoutePlatform) {
  const service = entry.service;
  const descriptor = await service.ownerDescriptor();
  const { record, grant, storedPackage } = descriptor;
  let trust = storedPackage?.trust;
  let manifest: RuntimePackageManifest | undefined = storedPackage?.manifest;
  let availablePackage: Awaited<ReturnType<typeof service.dependencies.verifier.verifyForCatalog>> | null = null;
  let availabilityError: AppPlatformError | null = null;
  const availableVersion = entry.availableVersion ?? descriptor.packageVersion;
  if (availableVersion) {
    try {
      availablePackage = await service.dependencies.verifier.verifyForCatalog(service.dependencies.repository, availableVersion, { appId: service.appId, publisherId: service.publisherId });
      manifest = availablePackage.manifest;
      trust = availablePackage.trust;
    } catch (error) {
      availabilityError = error instanceof AppPlatformError ? error : new AppPlatformError("package_verification_failed", "Available package verification failed");
    }
  }
  const retention = retentionProjection(manifest);
  const shouldInspectRetainedData = record.state !== "not_installed" || record.generation > 0;
  const retained = !availabilityError && shouldInspectRetainedData
    ? await service.dependencies.ownerDataLifecycle?.repairState?.(manifest ? manifestDataCompatibility(manifest) : { read_min: 1, read_max: 1, write_version: 1 })
    : undefined;
  const pending = record.pending_operation_id ? await service.dependencies.store.readOperation(record.pending_operation_id) : null;
  const trustStatus = record.state === "quarantined" ? "quarantined" : trust?.executable_allowed ? "verified" : "not_verified";
  const dependencyGate = await legacyAppDependencyGate(entry, platform.packageStore, platform.capabilityDependencyResolver);
  const packageUsable = !availabilityError && record.state !== "quarantined" && Boolean(manifest && trust?.executable_allowed) && dependencyGate.dependency_readiness.status !== "blocked";
  return {
    contract_version: 1,
    identity: {
      app_id: record.app_id,
      display_name: manifest?.manifest_version === 2 ? manifest.catalog.display_name : entry.displayName,
      publisher_id: service.publisherId,
      publisher_name: entry.publisherName,
      installation_id: record.installation_id,
      package_digest: record.active_package_digest,
    },
    route_key: entry.routeKey,
    state: record.state,
    generation: record.generation,
    version: { installed: descriptor.packageVersion, available: availableVersion },
    trust: {
      status: trustStatus,
      policy_version: trust?.trust_policy_version ?? 1,
      signing_key_id: trust?.signing_key_id ?? null,
      checked_at: storedPackage?.trust.checked_at ?? null,
      revocation_status: record.state === "quarantined" ? "revoked" : trust?.revocation_status ?? "not_checked",
    },
    source: { kind: "repository_fixture", label: "Bundled BrainDrive app source" },
    compatibility: {
      host: availabilityError ? false : trust?.compatibility_valid ?? null,
      app_contract: manifest?.compatibility.app_contract ?? null,
      mcp_protocol: manifest?.compatibility.mcp_protocol ?? null,
      data_schema: manifest ? manifestDataCompatibility(manifest) : null,
    },
    capabilities: {
      requested: manifest ? manifestCapabilities(manifest) : [],
      granted: grant?.revoked_at ? [] : grant?.capabilities ?? [],
    },
    ...dependencyGate,
    retention: {
      owner_data_preserved: retention.ownerDataPreserved,
      retained_data_present: shouldInspectRetainedData ? retained ? retained.state !== "missing" : false : null,
      compatibility: shouldInspectRetainedData ? retained?.state ?? "missing" : "not_inspected",
      safe_message: shouldInspectRetainedData ? retained?.safe_message ?? `No retained ${entry.displayName} data is present.` : "Owner data is not inspected before this app has lifecycle history.",
      uninstall_removes: retention.removes,
      uninstall_retains: retention.retains,
      post_uninstall_controls: retention.controls,
    },
    progress: pending ? safeOperation(pending) : null,
    recovery: {
      available: record.state === "failed_recoverable",
      action: record.state === "failed_recoverable" ? "retry_recovery_or_reinstall" : record.state === "quarantined" ? "uninstall_and_reinstall_verified_version" : "none",
    },
    catalog: manifest?.manifest_version === 2 ? {
      summary: manifest.catalog.summary, icon: manifest.catalog.icon,
      retention_summary: manifest.catalog.retention_summary, primary_resource_uri: manifest.primary_resource.uri,
      presentations: manifest.presentations ? {
        presentation_set_version: manifest.presentations.presentation_set_version,
        default_presentation_id: manifest.presentations.default_presentation_id,
        profiles: manifest.presentations.profiles.map((profile) => profile.type === "chat_workspace"
          ? {
              profile_version: profile.profile_version,
              presentation_id: profile.presentation_id,
              type: profile.type,
              label: profile.label,
              description: profile.description,
              workspace_id: profile.workspace_id,
              owner_visibility: profile.owner_visibility,
            }
          : {
              profile_version: profile.profile_version,
              presentation_id: profile.presentation_id,
              type: profile.type,
              label: profile.label,
              description: profile.description,
              resource_uri: profile.resource_uri,
              owner_visibility: profile.owner_visibility,
            }),
      } : null,
      provenance: "verified_first_party_package",
    } : null,
    availability: {
      status: availabilityError || record.state === "quarantined" ? "unavailable" : manifest && trust?.executable_allowed ? "available" : "unavailable",
      package_digest: availablePackage?.packageDigest ?? null,
      error_code: availabilityError?.code ?? (record.state === "quarantined" ? "package_revoked" : null),
      safe_message: availabilityError ? unavailablePackageMessage(availabilityError.code) : record.state === "quarantined" ? unavailablePackageMessage("package_revoked") : null,
    },
    available_actions: lifecycleActions(record.state, descriptor.packageVersion, availableVersion, packageUsable),
    updated_at: record.updated_at,
  };
}

function retentionProjection(manifest: RuntimePackageManifest | undefined): {
  ownerDataPreserved: boolean;
  removes: string[];
  retains: string[];
  controls: Array<"delete" | "export" | "archive">;
} {
  if (!manifest) return { ownerDataPreserved: false, removes: [], retains: [], controls: [] };
  if (manifest.manifest_version !== 2) {
    return {
      ownerDataPreserved: manifest.retention_policy === "retain_owner_data_remove_runtime_authority",
      removes: ["app code", "disposable cache", "runtime authority", "capability grants"],
      retains: manifest.retention_policy === "retain_owner_data_remove_runtime_authority" ? ["app storage", "owner exports", "lifecycle evidence"] : [],
      controls: ["delete", "export", "archive"],
    };
  }
  const removed = manifest.retention_policy.classes
    .filter((entry) => entry.uninstall_behavior === "remove")
    .map((entry) => entry.label);
  const retained = manifest.retention_policy.classes
    .filter((entry) => entry.uninstall_behavior === "retain" || entry.uninstall_behavior === "outside_app_lifecycle" || entry.uninstall_behavior === "retain_minimal_tombstone")
    .map((entry) => entry.label);
  const controls = new Set<"delete" | "export" | "archive">();
  for (const entry of manifest.retention_policy.classes) {
    if (entry.owner_controls.includes("delete_after_uninstall")) controls.add("delete");
    if (entry.owner_controls.includes("export_after_uninstall")) controls.add("export");
    if (entry.owner_controls.includes("archive_after_uninstall")) controls.add("archive");
  }
  return {
    ownerDataPreserved: manifest.retention_policy.classes.some((entry) => entry.uninstall_behavior === "retain"),
    removes: [...removed, "capability grants"],
    retains: retained,
    controls: [...controls],
  };
}

function lifecycleActions(state: string, installed: string | null, available: string | null, packageUsable: boolean): string[] {
  if (state === "not_installed") return packageUsable ? ["install"] : [];
  if (state === "failed_recoverable") {
    return [
      ...(packageUsable && available && installed !== available ? ["update"] : []),
      ...(packageUsable ? ["recover"] : []),
      "uninstall",
    ];
  }
  const actions = state === "active" ? [...(packageUsable ? ["launch"] : []), "disable", "uninstall"]
    : state === "disabled" ? [...(packageUsable ? ["enable"] : []), "uninstall"]
    : state === "quarantined" ? ["uninstall"] : [];
  if (packageUsable && available && ["active", "disabled"].includes(state) && installed !== available) actions.push("update");
  return actions;
}

function unavailablePackageMessage(code: string): string {
  if (code === "package_revoked") return "This app version is revoked and cannot be installed.";
  if (code === "host_incompatible") return "This app version is not compatible with the current host.";
  return "This app version could not be verified and is unavailable.";
}

function safeOperation(operation: NonNullable<Awaited<ReturnType<AppLifecycleService["dependencies"]["store"]["readOperation"]>>>) {
  return {
    operation_version: 1,
    operation_id: operation.operation_id,
    installation_id: operation.installation_id,
    kind: operation.kind,
    status: operation.status,
    stage: operation.stage,
    completed_stages: operation.completed_stages,
    commit_outcome: operation.commit_outcome,
    prior_state: operation.prior_state,
    target_state: operation.target_state,
    result_state: operation.result?.final_state ?? null,
    error_code: operation.error_code,
    recovery_action: operation.recovery.action,
    started_at: operation.started_at,
    updated_at: operation.updated_at,
    completed_at: operation.completed_at,
  };
}

function sendSafeError(reply: FastifyReply, error: unknown) {
  const failure = error instanceof AppPlatformError ? error : new AppPlatformError("lifecycle_failed", "Lifecycle operation failed", 500);
  const safeMessage: Record<string, string> = {
    conflict: "App status changed. Refresh and retry from the current state.",
    denied: "This request does not match the authorized owner or installation.",
    package_revoked: "This app version is revoked and cannot run.",
    incompatible_schema: "Retained data is preserved but requires a compatible app version.",
    readiness_failed: "The app did not become ready. The last safe state was preserved.",
    active_app_limit_reached: "Disable another active app before starting this one.",
  };
  return reply.code(failure.statusCode).send({ error: failure.code, safe_message: safeMessage[failure.code] ?? "The lifecycle action could not be completed safely.", retryable: failure.statusCode >= 500 || failure.code === "conflict" });
}

function authorizeSidecarOwner(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.authContext?.actorType !== "owner" || !request.authContext.permissions.administration) {
    reply.code(403).send({ error: "owner_authorization_required" });
    return false;
  }
  return true;
}

function sendSafeSidecarError(reply: FastifyReply, error: unknown) {
  const failure = error instanceof AppPlatformError ? error : new AppPlatformError("lifecycle_failed", "Sidecar lifecycle operation failed", 500);
  const safeMessage: Record<string, string> = {
    conflict: "Sidecar status changed. Refresh and retry from the current state.",
    denied: "Only the Host may operate package sidecars.",
    idempotency_conflict: "This sidecar operation key was already used with different input.",
    readiness_failed: "The candidate sidecar did not become ready. The last safe state was preserved.",
    rollback_unavailable: "No last-known-good sidecar package is available for rollback.",
    runtime_conflict: "Another sidecar lifecycle operation is already active.",
  };
  return reply.code(failure.statusCode).send({
    error: failure.code,
    safe_message: safeMessage[failure.code] ?? "The sidecar lifecycle action could not be completed safely.",
    retryable: failure.statusCode >= 500 || failure.code === "conflict",
  });
}
