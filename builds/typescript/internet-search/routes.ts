import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { OpaqueIdSchema } from "../app-platform/contracts/common.js";
import {
  InternetSearchOperationIdSchema,
  WebReadEnvelopeSchema,
  WebSearchEnvelopeSchema,
  type WebReadEnvelope,
  type WebSearchEnvelope,
} from "./contracts/index.js";
import {
  createInternetSearchFailure,
  InternetSearchOperationCoordinator,
} from "./operation-metadata.js";
import {
  projectInternetSearchOperationDiagnostic,
  type InternetSearchDiagnosticSink,
} from "./diagnostics.js";
import type { InternetSearchCapabilityRegistry } from "./registry.js";
import type { WebReadExecutor } from "./read-adapter.js";
import type { WebSearchExecutor } from "./search-adapter.js";

const capabilityParamsSchema = z
  .object({
    operationId: InternetSearchOperationIdSchema,
  })
  .strict();

const searchCallRequestSchema = z
  .object({
    request_id: OpaqueIdSchema,
    run_id: OpaqueIdSchema,
    input: z.unknown(),
  })
  .strict();

export function registerInternetSearchCapabilityRoutes(
  app: FastifyInstance,
  registry: InternetSearchCapabilityRegistry,
  options: {
    searchExecutor?: WebSearchExecutor | null;
    readExecutor?: WebReadExecutor | null;
    operationCoordinator?: InternetSearchOperationCoordinator;
    diagnosticsSink?: InternetSearchDiagnosticSink | null;
  } = {},
): void {
  const operationCoordinator = options.operationCoordinator ?? new InternetSearchOperationCoordinator();
  const diagnosticsSink = options.diagnosticsSink ?? null;

  app.get("/capabilities/:operationId", async (request, reply) => {
    const parsed = capabilityParamsSchema.safeParse(request.params);
    if (!parsed.success) return sendCapabilityRouteError(reply, 400, "invalid_capability_operation");
    const authorized = request.authContext?.permissions.tool_access === true;
    if (authorized) await registry.refresh();
    return registry.discover(parsed.data.operationId, {
      authorized,
    });
  });

  app.post("/capabilities/:operationId/call", async (request, reply) => {
    const parsedParams = capabilityParamsSchema.safeParse(request.params);
    if (!parsedParams.success) return sendCapabilityRouteError(reply, 400, "invalid_capability_operation");
    const parsedBody = searchCallRequestSchema.safeParse(request.body);
    if (!parsedBody.success) return sendCapabilityRouteError(reply, 400, "invalid_capability_call");

    const operationStartedAtMs = Date.now();
    const authorized = request.authContext?.permissions.tool_access === true;
    const retrievedAt = new Date().toISOString();
    if (!authorized) {
      return recordOperationDiagnostic(diagnosticsSink, parsedParams.data.operationId, operationRouteFailure(parsedParams.data.operationId, parsedBody.data, retrievedAt, "failure", "not_authorized", false, authorizationMessage(parsedParams.data.operationId)), operationStartedAtMs);
    }

    if (authorized) await registry.refresh();
    const discovery = registry.discover(parsedParams.data.operationId, { authorized: true });
    if (!discovery.callable) {
      return recordOperationDiagnostic(diagnosticsSink, parsedParams.data.operationId, operationRouteFailure(parsedParams.data.operationId, parsedBody.data, retrievedAt, "unavailable", "provider_unavailable", true, "Internet Search is unavailable."), operationStartedAtMs);
    }

    if (parsedParams.data.operationId === "web.search@1") {
      if (!options.searchExecutor) {
        return recordOperationDiagnostic(diagnosticsSink, parsedParams.data.operationId, operationRouteFailure(parsedParams.data.operationId, parsedBody.data, retrievedAt, "unavailable", "provider_unavailable", true, "Internet Search is unavailable."), operationStartedAtMs);
      }
      const envelope = await operationCoordinator.execute(parsedParams.data.operationId, parsedBody.data, async ({ request: operationRequest }) => options.searchExecutor!.search({
        request_id: operationRequest.request_id,
        run_id: operationRequest.run_id,
        input: operationRequest.input,
        authorized: true,
        signal: request.raw.signal,
      }));
      return recordOperationDiagnostic(diagnosticsSink, parsedParams.data.operationId, envelope, operationStartedAtMs);
    }

    if (!options.readExecutor) {
      return recordOperationDiagnostic(diagnosticsSink, parsedParams.data.operationId, operationRouteFailure(parsedParams.data.operationId, parsedBody.data, retrievedAt, "unavailable", "provider_unavailable", true, "Internet Search is unavailable."), operationStartedAtMs);
    }
    const envelope = await operationCoordinator.execute(parsedParams.data.operationId, parsedBody.data, async ({ request: operationRequest }) => options.readExecutor!.read({
      request_id: operationRequest.request_id,
      run_id: operationRequest.run_id,
      input: operationRequest.input,
      authorized: true,
      signal: request.raw.signal,
    }));
    return recordOperationDiagnostic(diagnosticsSink, parsedParams.data.operationId, envelope, operationStartedAtMs);
  });
}

function sendCapabilityRouteError(reply: FastifyReply, statusCode: number, error: string) {
  reply.code(statusCode);
  return { error };
}

function operationRouteFailure(
  operationId: "web.search@1" | "web.read@1",
  request: z.infer<typeof searchCallRequestSchema>,
  retrievedAt: string,
  status: Extract<WebSearchEnvelope["status"], "failure" | "unavailable">,
  code: "not_authorized" | "provider_unavailable",
  retryable: boolean,
  message: string,
): WebSearchEnvelope | WebReadEnvelope {
  if (operationId === "web.read@1") {
    return WebReadEnvelopeSchema.parse({
      capability: "web.read",
      version: 1,
      request_id: request.request_id,
      run_id: request.run_id,
      status,
      retrieved_at: retrievedAt,
      provider: null,
      usage: { read_call: 0, bytes_read: 0 },
      result: null,
      failure: createInternetSearchFailure(code, { retryable, message }),
    });
  }
  return WebSearchEnvelopeSchema.parse({
    capability: "web.search",
    version: 1,
    request_id: request.request_id,
    run_id: request.run_id,
    status,
    retrieved_at: retrievedAt,
    provider: null,
    usage: { search_call: 0 },
    results: [],
    failure: createInternetSearchFailure(code, { retryable, message }),
  });
}

function authorizationMessage(operationId: "web.search@1" | "web.read@1"): string {
  return operationId === "web.read@1" ? "Read authorization is required." : "Search authorization is required.";
}

function recordOperationDiagnostic<TEnvelope extends WebSearchEnvelope | WebReadEnvelope>(
  sink: InternetSearchDiagnosticSink | null,
  operationId: "web.search@1" | "web.read@1",
  envelope: TEnvelope,
  startedAtMs: number,
): TEnvelope {
  sink?.record(projectInternetSearchOperationDiagnostic({
    operationId,
    envelope,
    durationMs: Math.min(Math.max(0, Date.now() - startedAtMs), 60_000),
  }));
  return envelope;
}
