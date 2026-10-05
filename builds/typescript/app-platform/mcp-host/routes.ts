import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { AppPlatformError } from "../lifecycle/errors.js";
import type { AppMcpHost } from "./app-host.js";
import { AppRouteKeySchema, CanonicalAppIdSchema, CapabilityIdentifierSchema } from "../contracts/app-registry.js";

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
  capability: CapabilityIdentifierSchema,
  operation_id: z.string().uuid(),
  input: z.unknown(),
  owner_confirmed: z.boolean().default(false),
}).strict();

const careerReturnRequestSchema = z.object({ operation_id: z.string().uuid(), entry_point: z.enum(["direct", "career"]), summary: z.unknown() }).strict();
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
  capability: CapabilityIdentifierSchema,
  capability_version: z.literal(1),
  operation_id: z.string().uuid(),
  idempotency_key: z.string().min(16).max(256),
  input: z.unknown(),
}).strict();

export type AppMcpHostRouteEntry = { appId: string; routeKey: string; host: AppMcpHost };
export type AppMcpHostRoutePlatform = ReturnType<typeof createAppMcpHostRoutePlatform>;

export function createAppMcpHostRoutePlatform(rawEntries: readonly AppMcpHostRouteEntry[]) {
  const entries = rawEntries.map((entry) => {
    const appId = CanonicalAppIdSchema.parse(entry.appId);
    const routeKey = AppRouteKeySchema.parse(entry.routeKey);
    if (entry.host.appId !== appId || entry.host.routeKey !== routeKey) {
      throw new AppPlatformError("descriptor_invalid", "MCP host route binding does not match the registered host");
    }
    return Object.freeze({ appId, routeKey, host: entry.host });
  });
  if (entries.length === 0 || new Set(entries.map((entry) => entry.appId)).size !== entries.length || new Set(entries.map((entry) => entry.routeKey)).size !== entries.length) {
    throw new AppPlatformError("descriptor_invalid", "MCP host route registry is empty or ambiguous");
  }
  const byRouteKey = new Map(entries.map((entry) => [entry.routeKey, entry]));
  return Object.freeze({
    entries: Object.freeze(entries),
    resolve(raw: unknown): AppMcpHostRouteEntry {
      const routeKey = AppRouteKeySchema.safeParse(raw);
      const entry = routeKey.success ? byRouteKey.get(routeKey.data) : undefined;
      if (!entry) throw new AppPlatformError("app_not_found", "App route is unavailable", 404);
      if (entry.host.appId !== entry.appId || entry.host.routeKey !== entry.routeKey) {
        throw new AppPlatformError("descriptor_invalid", "MCP host route binding is no longer valid");
      }
      return entry;
    },
  });
}

export function registerAppMcpHostRoutes(app: FastifyInstance, hostOrPlatform: AppMcpHost | AppMcpHostRoutePlatform): void {
  const platform = "entries" in hostOrPlatform
    ? hostOrPlatform
    : createAppMcpHostRoutePlatform([{ appId: hostOrPlatform.appId, routeKey: hostOrPlatform.routeKey, host: hostOrPlatform }]);
  app.post("/internal/apps/:appKey/capabilities", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    const token = readBearerToken(request.headers.authorization);
    if (!token) return reply.code(401).send({ error: "capability_authorization_required" });
    const parsed = serverCapabilityRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.send({ result: await selected.host.handleServerCapability(
        token, parsed.data.capability, parsed.data.capability_version, parsed.data.input,
        parsed.data.operation_id, parsed.data.idempotency_key,
      ) });
    } catch (error) { return sendServerCapabilityError(reply, error, parsed.data.operation_id); }
  });

  app.post("/apps/:appKey/launch", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
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
      return reply.send(await selected.host.launch(parsed.data.entry_point, resume));
    }
    catch (error) { return sendSafeError(reply, error); }
  });

  app.post("/apps/:appKey/bridge", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    if (!authorizeOwner(request, reply)) return;
    const parsed = bridgeRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.send(await selected.host.handleBridge(parsed.data.session_id, parsed.data.message, {
        origin: parsed.data.origin,
        sourceMatches: parsed.data.source === "sandbox_iframe",
      }));
    } catch (error) { return sendSafeError(reply, error); }
  });

  app.post("/apps/:appKey/apps-bridge", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    if (!authorizeOwner(request, reply)) return;
    const parsed = appsBridgeRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send(await selected.host.handleAppsBridge(parsed.data.session_id, parsed.data.envelope)); }
    catch (error) { return sendSafeError(reply, error); }
  });

  app.delete("/apps/:appKey/sessions/:sessionId/requests/:operationId", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    if (!authorizeOwner(request, reply)) return;
    const parsed = z.object({ sessionId: z.string().uuid(), operationId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    selected.host.cancelAppsBridgeRequest(parsed.data.sessionId, parsed.data.operationId);
    return reply.code(204).send();
  });

  app.delete("/apps/:appKey/sessions/:sessionId", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    if (!authorizeOwner(request, reply)) return;
    const parsed = z.object({ sessionId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    selected.host.close(parsed.data.sessionId);
    return reply.code(204).send();
  });

  app.post("/apps/:appKey/data/call", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    if (!authorizeOwner(request, reply)) return;
    const parsed = ownerCapabilityRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.send({ result: await selected.host.handleOwnerCapability(
        parsed.data.capability,
        parsed.data.input,
        parsed.data.operation_id,
        parsed.data.owner_confirmed,
        request.authContext!.actorId,
      ) });
    }
    catch (error) { return sendOwnerDataError(reply, error, parsed.data.operation_id, parsed.data.capability); }
  });

  app.post("/apps/:appKey/career-return", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    if (!authorizeOwner(request, reply)) return;
    const parsed = careerReturnRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send(await selected.host.placeCareerReturn(parsed.data.summary, parsed.data.entry_point, parsed.data.operation_id)); }
    catch (error) { return sendSafeError(reply, error); }
  });

  app.post("/apps/:appKey/exports/finalize", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    if (!authorizeOwner(request, reply)) return;
    const parsed = finalizeExportRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const { operation_id, ...input } = parsed.data;
    try { return reply.send(await selected.host.finalizeOwnerExport(input, operation_id)); }
    catch (error) { return sendSafeError(reply, error); }
  });
}

function resolveHost(request: FastifyRequest, reply: FastifyReply, platform: AppMcpHostRoutePlatform): AppMcpHostRouteEntry | null {
  try { return platform.resolve((request.params as { appKey?: unknown } | undefined)?.appKey); }
  catch { reply.code(404).send({ error: "app_not_found" }); return null; }
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

function sendOwnerDataError(reply: FastifyReply, error: unknown, correlationId: string, capability: string) {
  const platform = error instanceof AppPlatformError ? error : new AppPlatformError("recoverable_internal_failure", "Installed app host operation failed", 500);
  const confirmation = safeConfirmationProjection(platform.details?.confirmation, capability);
  const mappedCode = confirmation ? "confirmation_required" : platform.code.startsWith("token_") || platform.code.startsWith("grant_") || platform.code === "bridge_denied" || platform.code === "session_closed" || platform.code === "session_expired"
    ? "denied"
    : platform.code === "protocol_incompatible" || platform.code === "extension_incompatible"
      ? "incompatible_schema"
      : platform.code;
  const failure = ownerSafeCapabilityFailure({ code: mappedCode, details: platform.details, confirmation }, correlationId);
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

function safeConfirmationProjection(value: unknown, capability: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const projection = value as Record<string, unknown>;
  if (typeof projection.title !== "string" || !projection.title.trim() || projection.title.length > 256
    || typeof projection.actionLabel !== "string" || !projection.actionLabel.trim() || projection.actionLabel.length > 256) return null;
  return { capability, title: projection.title, action_label: projection.actionLabel };
}

function ownerSafeCapabilityFailure(error: { code: string; details?: Record<string, unknown>; confirmation?: { capability: string; title: string; action_label: string } | null }, correlationId: string) {
  const currentRevision = typeof error.details?.currentRevision === "number" ? error.details.currentRevision : null;
  const safeMessage = error.code === "confirmation_required"
    ? "Review this action in BrainDrive before continuing."
    : error.code === "conflict"
      ? "The saved version changed. Refresh and review the preserved proposal."
      : "The app action could not be completed safely.";
  return {
    error: { code: error.code, safe_message: safeMessage, correlation_id: correlationId, retryable: error.code === "recoverable_internal_failure", ...(error.confirmation ? { confirmation: error.confirmation } : {}) },
    owner_state: error.code === "conflict"
      ? { state_version: 1, state: "conflict", safe_message: safeMessage, retryable: false, refresh_required: true, current_revision: currentRevision, proposal_preserved: true }
      : { state_version: 1, state: "unavailable", safe_message: safeMessage, retryable: error.code === "recoverable_internal_failure", refresh_required: false, current_revision: currentRevision, proposal_preserved: true },
  };
}
