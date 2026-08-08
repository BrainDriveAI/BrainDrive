import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { CapabilityNameSchema } from "../contracts/package.js";
import { AppPlatformError } from "./errors.js";
import { MODERN_FIXTURE_CAPABILITIES, MODERN_FIXTURE_VERSION } from "./fixture-repository.js";
import type { AppLifecycleService, LifecycleResponse } from "./service.js";

const actionSchema = z.object({ idempotency_key: z.string().min(16).max(256) }).strict();
const packageActionSchema = actionSchema.extend({ version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/), approve_capabilities: z.boolean() }).strict();
const sessionSchema = z.object({
  audience: z.enum(["app_data", "app_inference", "app_export", "app_bridge"]),
  capabilities: z.array(CapabilityNameSchema).min(1),
  operation_id: z.string().uuid(),
  view_id: z.string().uuid().optional(),
}).strict();

export function registerAppLifecycleRoutes(app: FastifyInstance, service: AppLifecycleService): void {
  app.get("/apps/resume-builder", async (request, reply) => {
    if (!authorizeOwner(request, reply)) return;
    const descriptor = await service.ownerDescriptor();
    reply.send({
      ...safeRecord(descriptor.record),
      display_name: "Resume Builder",
      publisher: "BrainDrive",
      package_version: descriptor.packageVersion,
      available_version: MODERN_FIXTURE_VERSION,
      capabilities: descriptor.grant?.capabilities ?? [...MODERN_FIXTURE_CAPABILITIES],
      inference_disclosure: "Uses your active compatible BrainDrive model only after a later workflow requests it; credentials are never shared with the app.",
      storage_disclosure: "App code and lifecycle metadata use local BrainDrive storage. Default uninstall preserves owner resume data.",
    });
  });

  app.post("/apps/resume-builder/install", async (request, reply) => mutate(request, reply, packageActionSchema, (body) => service.install({ version: body.version, idempotencyKey: body.idempotency_key, approveCapabilities: body.approve_capabilities })));
  app.post("/apps/resume-builder/update", async (request, reply) => mutate(request, reply, packageActionSchema, (body) => service.update({ version: body.version, idempotencyKey: body.idempotency_key, approveCapabilities: body.approve_capabilities })));
  app.post("/apps/resume-builder/disable", async (request, reply) => mutate(request, reply, actionSchema, (body) => service.disable({ idempotencyKey: body.idempotency_key })));
  app.post("/apps/resume-builder/enable", async (request, reply) => mutate(request, reply, actionSchema, (body) => service.enable({ idempotencyKey: body.idempotency_key })));
  app.post("/apps/resume-builder/rollback", async (request, reply) => mutate(request, reply, actionSchema, (body) => service.rollback({ idempotencyKey: body.idempotency_key })));
  app.post("/apps/resume-builder/uninstall", async (request, reply) => mutate(request, reply, actionSchema, (body) => service.uninstall({ idempotencyKey: body.idempotency_key })));

  app.get("/apps/resume-builder/operations/:operationId", async (request, reply) => {
    if (!authorizeOwner(request, reply)) return;
    const parsed = z.object({ operationId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const operation = await service.dependencies.store.readOperation(parsed.data.operationId);
    if (!operation) return reply.code(404).send({ error: "operation_not_found" });
    return reply.send(safeOperation(operation));
  });

  app.post("/apps/resume-builder/operations/:operationId/cancel", async (request, reply) => {
    if (!authorizeOwner(request, reply)) return;
    const parsed = z.object({ operationId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send(safeOperation(await service.cancel(parsed.data.operationId))); }
    catch (error) { return sendSafeError(reply, error); }
  });

  app.post("/apps/resume-builder/session", async (request, reply) => {
    if (!authorizeOwner(request, reply)) return;
    const parsed = sessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const issued = await service.issueSession({ audience: parsed.data.audience, capabilities: parsed.data.capabilities, operationId: parsed.data.operation_id, viewId: parsed.data.view_id });
      const claims = issued.claims;
      return reply.send({ token_version: 1, token: issued.token, claims: { audience: claims.audience, installation_id: claims.installation_id, operation_id: claims.operation_id, capabilities: claims.capabilities, expires_at: claims.expires_at, view_id: claims.view_id } });
    } catch (error) { return sendSafeError(reply, error); }
  });
}

async function mutate<S extends z.ZodType, T extends LifecycleResponse>(
  request: FastifyRequest,
  reply: FastifyReply,
  schema: S,
  action: (body: z.output<S>) => Promise<T>,
): Promise<unknown> {
  if (!authorizeOwner(request, reply)) return;
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
  try {
    const response = await action(parsed.data);
    return reply.send({ ...safeRecord(response.record), operation: safeOperation(response.operation), capabilities: response.grant?.capabilities ?? [] });
  } catch (error) { return sendSafeError(reply, error); }
}

function authorizeOwner(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.authContext?.actorType !== "owner" || !request.authContext.permissions.administration) {
    reply.code(403).send({ error: "owner_authorization_required" });
    return false;
  }
  return true;
}

function safeRecord(record: Awaited<ReturnType<AppLifecycleService["status"]>>) {
  return {
    contract_version: 1,
    app_id: record.app_id,
    state: record.state,
    generation: record.generation,
    installation_id: record.installation_id,
    active_package_digest: record.active_package_digest,
    last_known_good_package_digest: record.last_known_good_package_digest,
    pending_operation_id: record.pending_operation_id,
    successful_use_checkpoint: record.successful_use_checkpoint,
    retained_owner_data: true,
    updated_at: record.updated_at,
  };
}

function safeOperation(operation: NonNullable<Awaited<ReturnType<AppLifecycleService["dependencies"]["store"]["readOperation"]>>>) {
  return {
    operation_version: 1,
    operation_id: operation.operation_id,
    kind: operation.kind,
    status: operation.status,
    stage: operation.stage,
    commit_outcome: operation.commit_outcome,
    prior_state: operation.prior_state,
    target_state: operation.target_state,
    error_code: operation.error_code,
    started_at: operation.started_at,
    updated_at: operation.updated_at,
    completed_at: operation.completed_at,
  };
}

function sendSafeError(reply: FastifyReply, error: unknown) {
  const failure = error instanceof AppPlatformError ? error : new AppPlatformError("lifecycle_failed", "Lifecycle operation failed", 500);
  return reply.code(failure.statusCode).send({ error: failure.code, retryable: failure.statusCode >= 500 });
}
