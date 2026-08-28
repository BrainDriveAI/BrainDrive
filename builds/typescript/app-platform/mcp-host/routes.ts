import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { AppPlatformError } from "../lifecycle/errors.js";
import type { AppMcpHost } from "./app-host.js";
import { AppArtifactRegistrationRequestSchema, AppArtifactSafeMediaTypeSchema, AppExportDestinationIntentSchema } from "../contracts/app-artifacts.js";
import { AppDocumentDeleteModeSchema, AppDocumentMediaTypeSchema, AppStorageRetentionClassSchema } from "../contracts/app-storage.js";
import { AppRouteKeySchema, CanonicalAppIdSchema, CapabilityIdentifierSchema, HostBindingIdSchema } from "../contracts/app-registry.js";

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
const chatWorkspaceLaunchRequestSchema = z.object({
  presentation_id: HostBindingIdSchema.optional(),
  workspace_id: HostBindingIdSchema.optional(),
  resume: z.object({
    session_id: z.string().uuid(),
    view_id: z.string().uuid(),
    operation_id: z.string().uuid(),
    session_generation: z.number().int().positive(),
  }).strict().optional(),
}).strict();
const chatDocumentParamsSchema = z.object({
  sessionId: z.string().uuid(),
  documentId: HostBindingIdSchema,
}).passthrough();
const chatDocumentWriteRequestSchema = z.object({
  operation_id: z.string().uuid(),
  idempotency_key: z.string().min(16).max(256),
  expected_revision: z.number().int().positive().nullable(),
  content: z.unknown(),
  media_type: AppDocumentMediaTypeSchema.optional(),
  retention_class: AppStorageRetentionClassSchema.optional(),
}).strict();
const chatDocumentDeleteRequestSchema = z.object({
  operation_id: z.string().uuid(),
  idempotency_key: z.string().min(16).max(256),
  expected_revision: z.number().int().positive(),
  delete_mode: AppDocumentDeleteModeSchema.default("tombstone"),
}).strict();
const finalizeExportRequestSchema = z.object({
  operation_id: z.string().uuid(),
  artifact_revision_id: z.string().uuid(),
  artifact_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  safe_destination_label: z.string().min(1).max(256).regex(/^[^/\\]+$/),
  outcome: z.enum(["completed", "cancelled", "failed"]),
}).strict();
const genericArtifactRegistrationRouteSchema = AppArtifactRegistrationRequestSchema.omit({ authority: true });
const appArtifactSourceRouteSchema = z.object({
  kind: z.enum(["app_document", "app_operation", "runtime_output"]),
  source_id: z.string().min(1).max(256).regex(/^[a-zA-Z0-9_.:@-]+$/),
}).strict();
const safeOwnerLabelRouteSchema = z.string().min(1).max(256).regex(/^[^/\\\u0000-\u001f\u007f]+$/).refine((value) => !/^\.+$/.test(value) && !value.includes(".."));
const genericExportPrepareRouteSchema = z.object({
  request_version: z.literal(1),
  operation_id: z.string().uuid(),
  idempotency_key: z.string().min(16).max(256),
  source: appArtifactSourceRouteSchema,
  content_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  content_size_bytes: z.number().int().positive().max(2_097_152),
  retention_class: AppStorageRetentionClassSchema.default("durable_owner_data"),
  media_type: AppArtifactSafeMediaTypeSchema,
  filename: safeOwnerLabelRouteSchema,
  destination_intent: AppExportDestinationIntentSchema,
  overwrite_confirmed: z.boolean(),
  owner_confirmed: z.boolean(),
  bytes_base64: z.string().min(1).max(2_796_204).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  artifact_id: z.string().uuid().optional(),
  artifact_revision_id: z.string().uuid().optional(),
  is_cancelled: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.destination_intent === "replace_existing" && !value.overwrite_confirmed) context.addIssue({ code: "custom", path: ["overwrite_confirmed"], message: "replacement requires explicit overwrite confirmation" });
  if (value.media_type === "application/pdf" && !value.filename.toLowerCase().endsWith(".pdf")) context.addIssue({ code: "custom", path: ["filename"], message: "PDF exports require a .pdf filename" });
  if (value.media_type === "text/plain" && !value.filename.toLowerCase().endsWith(".txt")) context.addIssue({ code: "custom", path: ["filename"], message: "Text exports require a .txt filename" });
});
const genericFinalizeExportRouteSchema = z.object({
  request_version: z.literal(1),
  operation_id: z.string().uuid(),
  idempotency_key: z.string().min(16).max(256),
  artifact_revision_id: z.string().uuid(),
  content_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  media_type: AppArtifactSafeMediaTypeSchema,
  outcome: z.enum(["completed", "cancelled", "failed"]),
  safe_destination_label: safeOwnerLabelRouteSchema,
}).strict().superRefine((value, context) => {
  if (value.media_type === "application/pdf" && !value.safe_destination_label.toLowerCase().endsWith(".pdf")) context.addIssue({ code: "custom", path: ["safe_destination_label"], message: "PDF receipts require a .pdf label" });
  if (value.media_type === "text/plain" && !value.safe_destination_label.toLowerCase().endsWith(".txt")) context.addIssue({ code: "custom", path: ["safe_destination_label"], message: "Text receipts require a .txt label" });
});
const finalizeExportRouteSchema = z.union([genericFinalizeExportRouteSchema, finalizeExportRequestSchema]);
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

  app.post("/apps/:appKey/chat-workspaces/launch", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    if (!authorizeOwner(request, reply)) return;
    const parsed = chatWorkspaceLaunchRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.send(await selected.host.launchChatWorkspace({
        presentationId: parsed.data.presentation_id,
        workspaceId: parsed.data.workspace_id,
        resume: parsed.data.resume
          ? {
              sessionId: parsed.data.resume.session_id,
              viewId: parsed.data.resume.view_id,
              operationId: parsed.data.resume.operation_id,
              sessionGeneration: parsed.data.resume.session_generation,
            }
          : undefined,
      }));
    }
    catch (error) { return sendSafeError(reply, error); }
  });

  app.get("/apps/:appKey/chat-workspaces/sessions/:sessionId", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    if (!authorizeOwner(request, reply)) return;
    const parsed = z.object({ sessionId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send(await selected.host.readChatWorkspaceSession(parsed.data.sessionId)); }
    catch (error) { return sendSafeError(reply, error); }
  });

  app.get("/apps/:appKey/chat-workspaces/sessions/:sessionId/documents", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    if (!authorizeOwner(request, reply)) return;
    const parsed = z.object({ sessionId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send(await selected.host.listAppDocuments(parsed.data.sessionId)); }
    catch (error) { return sendDocumentError(reply, error); }
  });

  app.get("/apps/:appKey/chat-workspaces/sessions/:sessionId/documents/:documentId", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    if (!authorizeOwner(request, reply)) return;
    const parsed = chatDocumentParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send(await selected.host.readAppDocument(parsed.data.sessionId, parsed.data.documentId)); }
    catch (error) { return sendDocumentError(reply, error); }
  });

  app.put("/apps/:appKey/chat-workspaces/sessions/:sessionId/documents/:documentId", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    if (!authorizeOwner(request, reply)) return;
    const parsedParams = chatDocumentParamsSchema.safeParse(request.params);
    const parsedBody = chatDocumentWriteRequestSchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send(await selected.host.writeAppDocument(parsedParams.data.sessionId, parsedParams.data.documentId, parsedBody.data)); }
    catch (error) { return sendDocumentError(reply, error); }
  });

  app.delete("/apps/:appKey/chat-workspaces/sessions/:sessionId/documents/:documentId", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    if (!authorizeOwner(request, reply)) return;
    const parsedParams = chatDocumentParamsSchema.safeParse(request.params);
    const parsedBody = chatDocumentDeleteRequestSchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send(await selected.host.deleteAppDocument(parsedParams.data.sessionId, parsedParams.data.documentId, parsedBody.data)); }
    catch (error) { return sendDocumentError(reply, error); }
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

  app.post("/apps/:appKey/artifacts/register", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    if (!authorizeOwner(request, reply)) return;
    const parsed = genericArtifactRegistrationRouteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send(await selected.host.registerAppArtifact(parsed.data)); }
    catch (error) { return sendOwnerExportError(reply, error, parsed.data.operation_id); }
  });

  app.post("/apps/:appKey/exports/request", async (request, reply) => {
    const selected = resolveHost(request, reply, platform); if (!selected) return;
    if (!authorizeOwner(request, reply)) return;
    const parsed = genericExportPrepareRouteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send(await selected.host.requestAppExport(parsed.data, request.authContext!.actorId)); }
    catch (error) { return sendOwnerExportError(reply, error, parsed.data.operation_id); }
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
    const parsed = finalizeExportRouteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const { operation_id, ...input } = parsed.data;
    try { return reply.send(await selected.host.finalizeOwnerExport(input, operation_id)); }
    catch (error) { return sendOwnerExportError(reply, error, operation_id); }
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

function sendDocumentError(reply: FastifyReply, error: unknown) {
  const platform = error instanceof AppPlatformError ? error : new AppPlatformError("recoverable_internal_failure", "Installed app document operation failed", 500);
  const code = platform.code === "revision_conflict" ? "conflict" : platform.code;
  const currentRevision = typeof platform.details.currentRevision === "number" ? platform.details.currentRevision : null;
  const safeMessage = code === "conflict"
    ? "The saved version changed. Refresh and review before saving again."
    : code === "denied" || code === "not_found_within_scope" || code === "session_closed"
      ? "This workspace document binding is unavailable."
      : "The app document could not be loaded safely.";
  const retryable = platform.statusCode >= 500;
  return reply.code(platform.statusCode).send({
    error: {
      code,
      safe_message: safeMessage,
      retryable,
      current_revision: currentRevision,
    },
    document_state: {
      state_version: 1,
      state: code === "conflict" ? "conflict" : "unavailable",
      safe_message: safeMessage,
      retryable,
      refresh_required: code === "conflict" || code === "session_closed",
      current_revision: currentRevision,
    },
  });
}

function sendOwnerDataError(reply: FastifyReply, error: unknown, correlationId: string, capability: string) {
  const platform = error instanceof AppPlatformError ? error : new AppPlatformError("recoverable_internal_failure", "Installed app host operation failed", 500);
  const confirmation = safeConfirmationProjection(platform.details?.confirmation, capability);
  const platformCode = confirmation ? "confirmation_required" : platform.code.startsWith("token_") || platform.code.startsWith("grant_") || platform.code === "bridge_denied" || platform.code === "session_closed" || platform.code === "session_expired"
    ? "denied"
    : platform.code === "protocol_incompatible" || platform.code === "extension_incompatible"
      ? "incompatible_schema"
      : platform.code;
  const code = platform.code === "validation_failed" ? safeAppErrorCode(platform.details?.safeCode) ?? platformCode : platformCode;
  const failure = ownerSafeCapabilityFailure({ code, details: platform.details, confirmation }, correlationId);
  return reply.code(platform.statusCode).send(failure);
}

function sendOwnerExportError(reply: FastifyReply, error: unknown, correlationId: string) {
  const platform = error instanceof AppPlatformError ? error : new AppPlatformError("recoverable_internal_failure", "Installed app export operation failed", 500);
  const confirmation = safeConfirmationProjection(platform.details?.confirmation, "app.export.request");
  const safeCode = confirmation ? "confirmation_required" : platform.code === "idempotency_conflict" || platform.code === "cancelled" || platform.code === "not_found_within_scope"
    ? platform.code
    : platform.code === "validation_failed" || platform.code === "invalid_input"
      ? platform.code
      : "recoverable_internal_failure";
  return reply.code(platform.statusCode).send({
    error: {
      code: safeCode,
      safe_message: safeCode === "confirmation_required"
        ? "Review this export in BrainDrive before continuing."
        : safeCode === "idempotency_conflict"
          ? "This export request was already used for a different result."
          : safeCode === "cancelled"
            ? "The export was cancelled before completion."
            : "The app export could not be completed safely.",
      correlation_id: correlationId,
      retryable: safeCode === "recoverable_internal_failure",
      ...(confirmation ? { confirmation } : {}),
    },
  });
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
    error: {
      code: error.code,
      safe_message: safeMessage,
      correlation_id: correlationId,
      retryable: typeof error.details?.retryable === "boolean" ? error.details.retryable : error.code === "recoverable_internal_failure",
      ...safeInferenceErrorDetails(error.details),
      ...(error.confirmation ? { confirmation: error.confirmation } : {}),
    },
    owner_state: error.code === "conflict"
      ? { state_version: 1, state: "conflict", safe_message: safeMessage, retryable: false, refresh_required: true, current_revision: currentRevision, proposal_preserved: true }
      : { state_version: 1, state: "unavailable", safe_message: safeMessage, retryable: error.code === "recoverable_internal_failure", refresh_required: false, current_revision: currentRevision, proposal_preserved: true },
  };
}

const SAFE_APP_ERROR_CODE = /^[a-z][a-z0-9_]{0,95}$/;
const SAFE_APP_ISSUE_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\/[a-z][a-z0-9-]*$/;
const SAFE_COMPLETION_MODES = new Set(["none", "provider", "provider_generated", "deterministic_fallback", "conservative_fallback", "safe_failure"]);
const SAFE_RECOVERY_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_RECOVERY_STRING = /^[a-z0-9][a-z0-9_.:-]{0,127}$/i;
const FORBIDDEN_RECOVERY_KEY = /(^|_)(content|body|text|prompt|completion|document|description|source|path|destination|authorization|credential|api_key|token|secret|permission)(_|$)/i;

function safeAppErrorCode(value: unknown): string | null {
  return typeof value === "string" && SAFE_APP_ERROR_CODE.test(value) ? value : null;
}

function safeInferenceErrorDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!details) return {};
  const projected: Record<string, unknown> = {};
  if (z.string().uuid().safeParse(details.operationId).success) projected.operation_id = details.operationId;
  if (Number.isInteger(details.attemptCount) && Number(details.attemptCount) >= 0 && Number(details.attemptCount) <= 2) projected.attempt_count = details.attemptCount;
  if (typeof details.completionMode === "string" && SAFE_COMPLETION_MODES.has(details.completionMode)) projected.completion_mode = details.completionMode;
  if (Array.isArray(details.appIssueIds) && details.appIssueIds.length <= 20
    && details.appIssueIds.every((value) => typeof value === "string" && value.length <= 160 && SAFE_APP_ISSUE_ID.test(value))
    && new Set(details.appIssueIds).size === details.appIssueIds.length) {
    projected.app_issue_ids = details.appIssueIds;
  }
  const recoveryMetadata = safeRecoveryMetadata(details.recoveryMetadata);
  if (recoveryMetadata) projected.recovery_metadata = recoveryMetadata;
  return projected;
}

function safeRecoveryMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 16) return null;
  const safeScalar = (candidate: unknown): boolean => (
    typeof candidate === "boolean"
    || (Number.isInteger(candidate) && Math.abs(Number(candidate)) <= 1_000_000)
    || (typeof candidate === "string" && SAFE_RECOVERY_STRING.test(candidate))
  );
  for (const [key, candidate] of entries) {
    if (!SAFE_RECOVERY_KEY.test(key) || FORBIDDEN_RECOVERY_KEY.test(key)) return null;
    if (Array.isArray(candidate)) {
      if (candidate.length > 20 || !candidate.every(safeScalar)) return null;
    } else if (!safeScalar(candidate)) return null;
  }
  return JSON.stringify(value).length <= 4_096 ? value as Record<string, unknown> : null;
}
