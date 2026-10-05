import path from "node:path";

import type { FirstPartyAppRegistration } from "../contracts/app-registry.js";
import { ContractViolation } from "../contracts/errors.js";
import { FirstPartyAppRegistry } from "../registry.js";

export type AppLifecycleScopedRoots = {
  lifecycle: string;
  idempotency: string;
  runtime: string;
  data: string;
};

export type AppLifecycleContext<T> = {
  registration: FirstPartyAppRegistration;
  roots: AppLifecycleScopedRoots;
  service: T;
};

export type CreateAppLifecycleContextMapInput<T> = {
  registrations: readonly unknown[];
  stateRoot: string;
  memoryRoot: string;
  createService(input: {
    registration: FirstPartyAppRegistration;
    lifecycleRoot: string;
    runtimeRoot: string;
    dataRoot: string;
  }): T;
};

function scoped(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...segments);
  if (candidate === resolvedRoot || !candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new ContractViolation("descriptor_invalid", "Registered app root is outside its host-owned platform root");
  }
  return candidate;
}

export function createAppLifecycleContextMap<T>(input: CreateAppLifecycleContextMapInput<T>) {
  const registry = new FirstPartyAppRegistry(input.registrations);
  const contexts = registry.listRegistrations().map((registration): AppLifecycleContext<T> => {
    const lifecycle = scoped(input.stateRoot, "state", "apps", registration.route_key);
    const runtime = scoped(input.stateRoot, "runtime", "apps", registration.route_key);
    const data = scoped(input.memoryRoot, "apps", registration.route_key);
    const roots = {
      lifecycle,
      idempotency: path.join(lifecycle, "registry", "idempotency"),
      runtime,
      data,
    };
    return {
      registration,
      roots,
      service: input.createService({ registration, lifecycleRoot: lifecycle, runtimeRoot: runtime, dataRoot: data }),
    };
  });
  const allRoots = contexts.flatMap((context) => [context.roots.lifecycle, context.roots.idempotency, context.roots.runtime, context.roots.data]);
  if (new Set(allRoots).size !== allRoots.length) {
    throw new ContractViolation("duplicate_identity", "Registered app contexts contain a shared lifecycle, idempotency, runtime, or data root");
  }
  const byAppId = new Map(contexts.map((context) => [context.registration.app_id, context]));
  const byRouteKey = new Map(contexts.map((context) => [context.registration.route_key, context]));
  return Object.freeze({
    list: (): readonly AppLifecycleContext<T>[] => contexts,
    resolveAppId: (appId: string): AppLifecycleContext<T> => {
      const registration = registry.resolveAppId(appId);
      return byAppId.get(registration.app_id)!;
    },
    resolveRouteKey: (routeKey: string): AppLifecycleContext<T> => {
      const registration = registry.resolveRouteKey(routeKey);
      return byRouteKey.get(registration.route_key)!;
    },
  });
}
