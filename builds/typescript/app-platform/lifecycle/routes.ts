import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { CapabilityNameSchema } from "../contracts/package.js";
import { AppPlatformError } from "./errors.js";
import { MODERN_FIXTURE_CAPABILITIES, MODERN_FIXTURE_VERSION } from "./fixture-repository.js";
import type { AppLifecycleService, LifecycleResponse } from "./service.js";

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
  capabilities: z.array(CapabilityNameSchema).min(1),
  operation_id: z.string().uuid(),
  view_id: z.string().uuid().optional(),
}).strict();

export function registerAppLifecycleRoutes(app: FastifyInstance, service: AppLifecycleService): void {
  app.get("/apps", async (request, reply) => {
    if (!authorizeOwner(request, reply, service)) return;
    const descriptor = await ownerSafeDescriptor(service);
    return reply.send({ catalog_version: 1, apps: [descriptor] });
  });

  for (const route of ["/apps/resume-builder", "/apps/resume-builder/status", "/apps/resume-builder/inspect"]) {
    app.get(route, async (request, reply) => {
      if (!authorizeOwner(request, reply, service)) return;
      return reply.send(await ownerSafeDescriptor(service));
    });
  }

  app.post("/apps/resume-builder/install", async (request, reply) => mutate(request, reply, service, installSchema, (body) => service.install(packageInput(request, body))));
  app.post("/apps/resume-builder/reinstall", async (request, reply) => mutate(request, reply, service, installSchema, (body) => service.reinstall(packageInput(request, body))));
  app.post("/apps/resume-builder/update", async (request, reply) => mutate(request, reply, service, updateSchema, (body) => service.update(packageInput(request, body))));
  app.post("/apps/resume-builder/disable", async (request, reply) => mutate(request, reply, service, installedActionSchema, (body) => service.disable(simpleInput(request, body))));
  app.post("/apps/resume-builder/enable", async (request, reply) => mutate(request, reply, service, installedActionSchema, (body) => service.enable(simpleInput(request, body))));
  app.post("/apps/resume-builder/rollback", async (request, reply) => mutate(request, reply, service, installedActionSchema, (body) => service.rollback(simpleInput(request, body))));
  app.post("/apps/resume-builder/recover", async (request, reply) => mutate(request, reply, service, installedActionSchema, (body) => service.recover(simpleInput(request, body))));
  app.post("/apps/resume-builder/uninstall", async (request, reply) => mutate(request, reply, service, uninstallSchema, (body) => service.uninstall(simpleInput(request, body))));

  app.get("/apps/resume-builder/operations/:operationId", async (request, reply) => {
    if (!authorizeOwner(request, reply, service)) return;
    const params = z.object({ operationId: z.string().uuid() }).safeParse(request.params);
    const query = operationQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "invalid_request" });
    const operation = await service.dependencies.store.readOperation(params.data.operationId);
    if (!operation) return reply.code(404).send({ error: "operation_not_found" });
    if (operation.installation_id !== query.data.installation_id || operation.owner_id !== service.ownerId) return reply.code(403).send({ error: "owner_or_installation_mismatch", retryable: false });
    return reply.send(safeOperation(operation));
  });

  app.post("/apps/resume-builder/operations/:operationId/cancel", async (request, reply) => {
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

  app.post("/apps/resume-builder/session", async (request, reply) => {
    if (!authorizeOwner(request, reply, service)) return;
    const parsed = sessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const issued = await service.issueSession({ audience: parsed.data.audience, capabilities: parsed.data.capabilities, operationId: parsed.data.operation_id, viewId: parsed.data.view_id });
      const claims = issued.claims;
      return reply.send({ token_version: 1, token: issued.token, claims: { audience: claims.audience, installation_id: claims.installation_id, operation_id: claims.operation_id, capabilities: claims.capabilities, expires_at: claims.expires_at, view_id: claims.view_id } });
    } catch (error) { return sendSafeError(reply, error); }
  });
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

async function mutate<S extends z.ZodType, T extends LifecycleResponse>(request: FastifyRequest, reply: FastifyReply, service: AppLifecycleService, schema: S, action: (body: z.output<S>) => Promise<T>): Promise<unknown> {
  if (!authorizeOwner(request, reply, service)) return;
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
  try {
    const response = await action(parsed.data);
    return reply.send({ ...(await ownerSafeDescriptor(service)), operation: safeOperation(response.operation) });
  } catch (error) { return sendSafeError(reply, error); }
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

async function ownerSafeDescriptor(service: AppLifecycleService) {
  const descriptor = await service.ownerDescriptor();
  const { record, grant, storedPackage } = descriptor;
  const trust = storedPackage?.trust;
  const manifest = storedPackage?.manifest;
  const retained = await service.dependencies.ownerDataLifecycle?.repairState?.(manifest?.compatibility.data_schema ?? { read_min: 1, read_max: 1, write_version: 1 });
  const pending = record.pending_operation_id ? await service.dependencies.store.readOperation(record.pending_operation_id) : null;
  const trustStatus = record.state === "quarantined" ? "quarantined" : trust?.executable_allowed ? "verified" : "not_verified";
  return {
    contract_version: 1,
    identity: {
      app_id: record.app_id,
      display_name: "Resume Builder",
      publisher_id: "ai.braindrive",
      publisher_name: "BrainDrive",
      installation_id: record.installation_id,
      package_digest: record.active_package_digest,
    },
    state: record.state,
    generation: record.generation,
    version: { installed: descriptor.packageVersion, available: MODERN_FIXTURE_VERSION },
    trust: {
      status: trustStatus,
      policy_version: trust?.trust_policy_version ?? 1,
      signing_key_id: trust?.signing_key_id ?? null,
      checked_at: trust?.checked_at ?? null,
      revocation_status: record.state === "quarantined" ? "revoked" : trust?.revocation_status ?? "not_checked",
    },
    source: { kind: "repository_fixture", label: "Bundled BrainDrive app source" },
    compatibility: {
      host: trust?.compatibility_valid ?? null,
      app_contract: manifest?.compatibility.app_contract ?? 1,
      mcp_protocol: manifest?.compatibility.mcp_protocol ?? "2026-07-28",
      data_schema: manifest?.compatibility.data_schema ?? { read_min: 1, read_max: 1, write_version: 1 },
    },
    capabilities: {
      requested: manifest?.requested_capabilities ?? [...MODERN_FIXTURE_CAPABILITIES],
      granted: grant?.revoked_at ? [] : grant?.capabilities ?? [],
    },
    retention: {
      owner_data_preserved: true,
      retained_data_present: retained ? retained.state !== "missing" : false,
      compatibility: retained?.state ?? "missing",
      safe_message: retained?.safe_message ?? "No retained Resume Builder data is present.",
      uninstall_removes: ["app code", "disposable cache", "runtime authority", "capability grants"],
      uninstall_retains: ["career data", "resume and job history", "artifact metadata", "owner exports", "lifecycle evidence"],
    },
    progress: pending ? safeOperation(pending) : null,
    recovery: {
      available: record.state === "failed_recoverable",
      action: record.state === "failed_recoverable" ? "retry_recovery_or_reinstall" : record.state === "quarantined" ? "uninstall_and_reinstall_verified_version" : "none",
    },
    updated_at: record.updated_at,
  };
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
  };
  return reply.code(failure.statusCode).send({ error: failure.code, safe_message: safeMessage[failure.code] ?? "The lifecycle action could not be completed safely.", retryable: failure.statusCode >= 500 || failure.code === "conflict" });
}
