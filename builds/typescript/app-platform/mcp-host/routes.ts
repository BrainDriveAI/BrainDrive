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

const ownerCapabilityRequestSchema = z.object({
  capability: CapabilityNameSchema,
  operation_id: z.string().uuid(),
  input: z.unknown(),
  owner_confirmed: z.boolean().default(false),
}).strict();

const careerReturnRequestSchema = z.object({ operation_id: z.string().uuid(), entry_point: z.enum(["direct", "career"]), summary: CareerReturnSummarySchema }).strict();
const launchRequestSchema = z.object({ entry_point: z.enum(["direct", "career"]).default("direct") }).strict();
const finalizeExportRequestSchema = z.object({
  operation_id: z.string().uuid(),
  artifact_revision_id: z.string().uuid(),
  artifact_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  safe_destination_label: z.string().min(1).max(256).regex(/^[^/\\]+$/),
  outcome: z.enum(["completed", "cancelled", "failed"]),
}).strict();

export function registerAppMcpHostRoutes(app: FastifyInstance, host: AppMcpHost): void {
  app.post("/apps/resume-builder/launch", async (request, reply) => {
    if (!authorizeOwner(request, reply)) return;
    const parsed = launchRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send(await host.launch(parsed.data.entry_point)); }
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
