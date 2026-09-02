import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import {
  CapabilityOperationRouter,
  adapterKey,
  type CapabilityProviderResolver,
  type ProviderOperationAdapter,
  type ProviderOperationDefinition,
  type ProviderOperationFailureCode,
  type ProviderSelectionPolicy,
} from "../app-capabilities/provider-router.js";
import type { SidecarRuntimeBindingService } from "../app-platform/lifecycle/sidecar-supervisor.js";
import { OpaqueIdSchema } from "../app-platform/contracts/common.js";
import {
  type InternetSearchFailureCode,
  InternetSearchOperationIdSchema,
  WebReadEnvelopeSchema,
  WebSearchEnvelopeSchema,
  type WebReadEnvelope,
  type WebSearchEnvelope,
} from "./contracts/index.js";
import { INTERNET_SEARCH_LOCAL_V1_LIMITS } from "./limits.js";
import {
  createInternetSearchFailure,
  InternetSearchOperationCoordinator,
} from "./operation-metadata.js";
import {
  projectInternetSearchOperationDiagnostic,
  type InternetSearchDiagnosticSink,
} from "./diagnostics.js";
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

export type InternetSearchRouteCapabilityRegistry = {
  refresh?(): Promise<void>;
  discover(operationId: z.infer<typeof InternetSearchOperationIdSchema>, options: { authorized: boolean }): Promise<unknown> | unknown;
};

export function registerInternetSearchCapabilityRoutes(
  app: FastifyInstance,
  registry: InternetSearchRouteCapabilityRegistry,
  options: {
    searchExecutor?: WebSearchExecutor | null;
    readExecutor?: WebReadExecutor | null;
    operationCoordinator?: InternetSearchOperationCoordinator;
    diagnosticsSink?: InternetSearchDiagnosticSink | null;
    operationRouter?: CapabilityOperationRouter;
    providerResolver?: CapabilityProviderResolver;
    bindingService?: SidecarRuntimeBindingService | null;
    packageId?: string;
    providerComponentId?: string;
    selectionPolicy?: ProviderSelectionPolicy | null;
  } = {},
): void {
  const operationCoordinator = options.operationCoordinator ?? new InternetSearchOperationCoordinator();
  const diagnosticsSink = options.diagnosticsSink ?? null;
  const operationRouter = options.operationRouter ?? createInternetSearchOperationRouter(
    requireProviderResolver(options.providerResolver),
    options,
  );

  app.get("/capabilities/:operationId", async (request, reply) => {
    const parsed = capabilityParamsSchema.safeParse(request.params);
    if (!parsed.success) return sendCapabilityRouteError(reply, 400, "invalid_capability_operation");
    const authorized = request.authContext?.permissions.tool_access === true;
    if (authorized) await registry.refresh?.();
    return await registry.discover(parsed.data.operationId, {
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
    if (authorized) await registry.refresh?.();
    const signal = request.raw.signal ?? new AbortController().signal;
    const envelope = authorized
      ? await operationCoordinator.execute(parsedParams.data.operationId, parsedBody.data, async ({ request: operationRequest }) => operationRouter.call(
        parsedParams.data.operationId,
        operationRequest,
        { authorized: true, signal, selectionPolicy: options.selectionPolicy ?? null },
      ) as Promise<WebSearchEnvelope | WebReadEnvelope>)
      : await operationRouter.call(
        parsedParams.data.operationId,
        parsedBody.data,
        { authorized: false, signal, selectionPolicy: options.selectionPolicy ?? null },
      ) as WebSearchEnvelope | WebReadEnvelope;
    return recordOperationDiagnostic(diagnosticsSink, parsedParams.data.operationId, envelope, operationStartedAtMs);
  });
}

export function createInternetSearchOperationRouter(
  providerResolver: CapabilityProviderResolver,
  options: {
    searchExecutor?: WebSearchExecutor | null;
    readExecutor?: WebReadExecutor | null;
    bindingService?: SidecarRuntimeBindingService | null;
    packageId?: string;
    providerComponentId?: string;
    selectionPolicy?: ProviderSelectionPolicy | null;
  },
): CapabilityOperationRouter {
  return new CapabilityOperationRouter({
    registry: providerResolver,
    operations: INTERNET_SEARCH_ROUTE_OPERATIONS,
    adapters: createInternetSearchOperationAdapters(options),
    bindingService: options.bindingService ?? null,
    selectionPolicy: options.selectionPolicy ?? undefined,
  });
}

export const INTERNET_SEARCH_ROUTE_OPERATIONS: readonly ProviderOperationDefinition<z.infer<typeof searchCallRequestSchema>, WebSearchEnvelope | WebReadEnvelope>[] = [
  {
    operation_id: "web.search@1",
    input_schema: searchCallRequestSchema,
    result_schema: WebSearchEnvelopeSchema,
    max_input_bytes: 64 * 1024,
    timeout_ms: INTERNET_SEARCH_LOCAL_V1_LIMITS.search_operation_timeout_ms,
    failure: (request, failure) => operationRouteFailure("web.search@1", request, failure),
  },
  {
    operation_id: "web.read@1",
    input_schema: searchCallRequestSchema,
    result_schema: WebReadEnvelopeSchema,
    max_input_bytes: 64 * 1024,
    timeout_ms: INTERNET_SEARCH_LOCAL_V1_LIMITS.read_operation_timeout_ms,
    failure: (request, failure) => operationRouteFailure("web.read@1", request, failure),
  },
];

function createInternetSearchOperationAdapters(options: {
  searchExecutor?: WebSearchExecutor | null;
  readExecutor?: WebReadExecutor | null;
  packageId?: string;
  providerComponentId?: string;
}): Record<string, ProviderOperationAdapter> {
  const adapters: Record<string, ProviderOperationAdapter> = {};
  const packageId = options.packageId ?? "ai.braindrive.internet-search.searxng";
  const providerComponentId = options.providerComponentId ?? "search.provider";
  if (options.searchExecutor) {
    adapters[adapterKey(packageId, providerComponentId, "web.search@1")] = {
      invoke: async (request, context) => {
        const parsed = searchCallRequestSchema.parse(request);
        return options.searchExecutor!.search({
          request_id: parsed.request_id,
          run_id: parsed.run_id,
          input: parsed.input,
          authorized: true,
          signal: context.signal,
        });
      },
    };
  }
  if (options.readExecutor) {
    adapters[adapterKey(packageId, providerComponentId, "web.read@1")] = {
      invoke: async (request, context) => {
        const parsed = searchCallRequestSchema.parse(request);
        return options.readExecutor!.read({
          request_id: parsed.request_id,
          run_id: parsed.run_id,
          input: parsed.input,
          authorized: true,
          signal: context.signal,
        });
      },
    };
  }
  return adapters;
}

function requireProviderResolver(resolver: CapabilityProviderResolver | undefined): CapabilityProviderResolver {
  if (!resolver) throw new Error("Internet Search capability routes require a package-backed provider resolver");
  return resolver;
}

function sendCapabilityRouteError(reply: FastifyReply, statusCode: number, error: string) {
  reply.code(statusCode);
  return { error };
}

function operationRouteFailure(
  operationId: "web.search@1" | "web.read@1",
  request: z.infer<typeof searchCallRequestSchema> | null,
  failure: { code: ProviderOperationFailureCode; retryable: boolean; message: string },
): WebSearchEnvelope | WebReadEnvelope {
  const safeRequest = request ?? {
    request_id: "00000000-0000-4000-8000-000000000000",
    run_id: "00000000-0000-4000-8000-000000000000",
    input: null,
  };
  const code = internetSearchFailureCode(failure.code);
  const status = internetSearchStatus(failure.code);
  const retrievedAt = new Date().toISOString();
  if (operationId === "web.read@1") {
    return WebReadEnvelopeSchema.parse({
      capability: "web.read",
      version: 1,
      request_id: safeRequest.request_id,
      run_id: safeRequest.run_id,
      status,
      retrieved_at: retrievedAt,
      provider: null,
      usage: { read_call: 0, bytes_read: 0 },
      result: null,
      failure: createInternetSearchFailure(code, {
        retryable: failure.retryable,
        message: failure.message,
      }),
    });
  }
  return WebSearchEnvelopeSchema.parse({
    capability: "web.search",
    version: 1,
    request_id: safeRequest.request_id,
    run_id: safeRequest.run_id,
    status,
    retrieved_at: retrievedAt,
    provider: null,
    usage: { search_call: 0 },
    results: [],
    failure: createInternetSearchFailure(code, {
      retryable: failure.retryable,
      message: failure.message,
    }),
  });
}

function internetSearchFailureCode(code: ProviderOperationFailureCode): InternetSearchFailureCode {
  if (code === "not_authorized") return "not_authorized";
  if (code === "invalid_request") return "invalid_request";
  if (code === "invalid_provider_response") return "invalid_provider_response";
  if (code === "timeout") return "timeout";
  if (code === "cancelled") return "cancelled";
  return "provider_unavailable";
}

function internetSearchStatus(code: ProviderOperationFailureCode): Extract<WebSearchEnvelope["status"], "failure" | "unavailable" | "cancelled"> {
  if (code === "cancelled") return "cancelled";
  if (code === "provider_unavailable" || code === "provider_unhealthy" || code === "provider_selection_required" || code === "unsupported_target") return "unavailable";
  return "failure";
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
