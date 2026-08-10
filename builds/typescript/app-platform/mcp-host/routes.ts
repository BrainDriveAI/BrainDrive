import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { AppPlatformError } from "../lifecycle/errors.js";
import type { AppMcpHost } from "./app-host.js";
import { CareerReturnSummarySchema } from "../contracts/data.js";
import { CapabilityNameSchema } from "../contracts/package.js";
import { ownerSafeCapabilityFailure } from "../../resume-domain/owner-safe-state.js";
import { issueHostOwnerCapabilityAuthorization } from "../../resume-domain/capability-policy.js";

const bridgeRequestSchema = z.object({
  session_id: z.string().uuid(),
  origin: z.literal("null"),
  source: z.literal("sandbox_iframe"),
  message: z.unknown(),
}).strict();

const appsBridgeRequestSchema = z.object({
  session_id: z.string().uuid(),
  envelope: z.unknown(),
}).strict();

const ownerCapabilityRequestSchema = z.object({
  capability: CapabilityNameSchema,
  operation_id: z.string().uuid(),
  input: z.unknown(),
  owner_confirmed: z.boolean().default(false),
}).strict();

const careerReturnRequestSchema = z.object({ operation_id: z.string().uuid(), entry_point: z.enum(["direct", "career"]), summary: CareerReturnSummarySchema }).strict();
const launchRequestSchema = z.object({
  entry_point: z.enum(["direct", "career"]).default("direct"),
  resume: z.object({
    session_id: z.string().uuid(),
    view_id: z.string().uuid(),
    operation_id: z.string().uuid(),
    bridge_generation: z.number().int().positive(),
  }).strict().optional(),
}).strict();
const finalizeExportRequestSchema = z.object({
  operation_id: z.string().uuid(),
  artifact_revision_id: z.string().uuid(),
  artifact_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  safe_destination_label: z.string().min(1).max(256).regex(/^[^/\\]+$/),
  outcome: z.enum(["completed", "cancelled", "failed"]),
}).strict();
const serverCapabilityRequestSchema = z.object({
  request_version: z.literal(1),
  capability: CapabilityNameSchema,
  capability_version: z.literal(1),
  operation_id: z.string().uuid(),
  idempotency_key: z.string().min(16).max(256),
  input: z.unknown(),
}).strict();

export function registerAppMcpHostRoutes(app: FastifyInstance, host: AppMcpHost): void {
  app.post("/internal/apps/resume-builder/capabilities", async (request, reply) => {
    const token = readBearerToken(request.headers.authorization);
    if (!token) return reply.code(401).send({ error: "capability_authorization_required" });
    const parsed = serverCapabilityRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.send({ result: await host.handleServerCapability(
        token, parsed.data.capability, parsed.data.capability_version, parsed.data.input,
        parsed.data.operation_id, parsed.data.idempotency_key,
      ) });
    } catch (error) { return sendServerCapabilityError(reply, error, parsed.data.operation_id); }
  });

  app.post("/apps/resume-builder/launch", async (request, reply) => {
    if (!authorizeOwner(request, reply)) return;
    const parsed = launchRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const resume = parsed.data.resume
        ? {
            sessionId: parsed.data.resume.session_id,
            viewId: parsed.data.resume.view_id,
            operationId: parsed.data.resume.operation_id,
            bridgeGeneration: parsed.data.resume.bridge_generation,
          }
        : undefined;
      return reply.send(await host.launch(parsed.data.entry_point, resume));
    }
    catch (error) { return sendSafeError(reply, error); }
  });

  app.post("/apps/resume-builder/bridge", async (request, reply) => {
    if (!authorizeOwner(request, reply)) return;
    const parsed = bridgeRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.send(await host.handleBridge(parsed.data.session_id, parsed.data.message, {
        origin: parsed.data.origin,
        sourceMatches: parsed.data.source === "sandbox_iframe",
      }));
    } catch (error) { return sendSafeError(reply, error); }
  });

  app.post("/apps/resume-builder/apps-bridge", async (request, reply) => {
    if (!authorizeOwner(request, reply)) return;
    const parsed = appsBridgeRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send(await host.handleAppsBridge(parsed.data.session_id, parsed.data.envelope)); }
    catch (error) { return sendSafeError(reply, error); }
  });

  app.delete("/apps/resume-builder/sessions/:sessionId/requests/:operationId", async (request, reply) => {
    if (!authorizeOwner(request, reply)) return;
    const parsed = z.object({ sessionId: z.string().uuid(), operationId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    host.cancelAppsBridgeRequest(parsed.data.sessionId, parsed.data.operationId);
    return reply.code(204).send();
  });

  app.delete("/apps/resume-builder/sessions/:sessionId", async (request, reply) => {
    if (!authorizeOwner(request, reply)) return;
    const parsed = z.object({ sessionId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    host.close(parsed.data.sessionId);
    return reply.code(204).send();
  });

  app.post("/apps/resume-builder/data/call", async (request, reply) => {
    if (!authorizeOwner(request, reply)) return;
    const parsed = ownerCapabilityRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.send({ result: await host.handleOwnerCapability(
        parsed.data.capability,
        parsed.data.input,
        parsed.data.operation_id,
        parsed.data.owner_confirmed,
        issueHostOwnerCapabilityAuthorization(request.authContext!.actorId),
      ) });
    }
    catch (error) { return sendOwnerDataError(reply, error, parsed.data.operation_id); }
  });

  app.post("/apps/resume-builder/career-return", async (request, reply) => {
    if (!authorizeOwner(request, reply)) return;
    const parsed = careerReturnRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send(await host.placeCareerReturn(parsed.data.summary, parsed.data.entry_point, parsed.data.operation_id)); }
    catch (error) { return sendSafeError(reply, error); }
  });

  app.post("/apps/resume-builder/exports/finalize", async (request, reply) => {
    if (!authorizeOwner(request, reply)) return;
    const parsed = finalizeExportRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const { operation_id, ...input } = parsed.data;
    try { return reply.send(await host.finalizeOwnerExport(input, operation_id)); }
    catch (error) { return sendSafeError(reply, error); }
  });
}

function readBearerToken(value: unknown): string | null {
  const header = typeof value === "string" ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
  const match = /^Bearer ([A-Za-z0-9_-]{32,512})$/.exec(header);
  return match?.[1] ?? null;
}

function authorizeOwner(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.authContext?.actorType !== "owner" || !request.authContext.permissions.administration) {
    reply.code(403).send({ error: "owner_authorization_required" });
    return false;
  }
  return true;
}

function sendSafeError(reply: FastifyReply, error: unknown) {
  const failure = error instanceof AppPlatformError ? error : new AppPlatformError("lifecycle_failed", "Installed app host operation failed", 500);
  return reply.code(failure.statusCode).send({ error: failure.code, retryable: failure.statusCode >= 500 });
}

function sendOwnerDataError(reply: FastifyReply, error: unknown, correlationId: string) {
  const platform = error instanceof AppPlatformError ? error : new AppPlatformError("recoverable_internal_failure", "Installed app host operation failed", 500);
  const mappedCode = platform.code.startsWith("token_") || platform.code.startsWith("grant_") || platform.code === "bridge_denied" || platform.code === "session_closed" || platform.code === "session_expired"
    ? "denied"
    : platform.code === "protocol_incompatible" || platform.code === "extension_incompatible"
      ? "incompatible_schema"
      : platform.code;
  const failure = ownerSafeCapabilityFailure({ code: mappedCode, details: platform.details }, correlationId);
  return reply.code(platform.statusCode).send(failure);
}

function sendServerCapabilityError(reply: FastifyReply, error: unknown, correlationId: string) {
  const platform = error instanceof AppPlatformError ? error : new AppPlatformError("recoverable_internal_failure", "Installed app host operation failed", 500);
  const mappedCode = platform.code.startsWith("token_") || platform.code.startsWith("grant_") || platform.code === "bridge_denied" || platform.code === "session_closed" || platform.code === "session_expired"
    ? "denied"
    : platform.code === "protocol_incompatible" || platform.code === "extension_incompatible"
      ? "incompatible_schema"
      : platform.code;
  return reply.code(platform.statusCode).send({ error: ownerSafeCapabilityFailure({ code: mappedCode, details: platform.details }, correlationId).error });
}
