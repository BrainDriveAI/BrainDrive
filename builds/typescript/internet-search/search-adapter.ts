import { z } from "zod";

import { OpaqueIdSchema } from "../app-platform/contracts/common.js";
import {
  InternetSearchFailureSchema,
  WebSearchEnvelopeSchema,
  WebSearchInputSchema,
  WebSearchResultSchema,
  type InternetSearchFailure,
  type InternetSearchFailureCode,
  type WebSearchEnvelope,
  type WebSearchInput,
} from "./contracts/index.js";
import {
  assertPrivateSearxngBinding,
  type SearxngSidecarBinding,
  type SearxngSidecarSnapshot,
} from "./sidecar.js";
import { INTERNET_SEARCH_LOCAL_V1_LIMITS } from "./limits.js";

const PROVIDER_PROFILE = "local-owner-managed";
const PROVIDER_ATTRIBUTION = "host-mediated-search";
const DEFAULT_TIMEOUT_MS = INTERNET_SEARCH_LOCAL_V1_LIMITS.search_operation_timeout_ms;
const DEFAULT_SEARXNG_ENGINES = "bing";

const SearchRequestSchema = z
  .object({
    request_id: OpaqueIdSchema,
    run_id: OpaqueIdSchema,
    input: z.unknown(),
    authorized: z.boolean().default(true),
    signal: z.instanceof(AbortSignal).optional(),
  })
  .strict();

const SearxngProviderResponseSchema = z.object({
  results: z.array(z.unknown()),
  unresponsive_engines: z.array(z.array(z.unknown())).optional(),
}).passthrough();

export type WebSearchExecutionRequest = z.input<typeof SearchRequestSchema>;
export type SearxngSearchClientInput = {
  query: string;
  maxResults: number;
  filters: WebSearchInput["filters"];
  signal?: AbortSignal;
};

export interface SearxngSearchClient {
  search(input: SearxngSearchClientInput): Promise<unknown>;
}

export interface WebSearchExecutor {
  search(request: WebSearchExecutionRequest): Promise<WebSearchEnvelope>;
}

export type InternetSearchCapabilityStatusSnapshotProvider = {
  snapshot(): SearxngSidecarSnapshot;
};

export class WebSearchProviderError extends Error {
  constructor(
    readonly code: Extract<InternetSearchFailureCode, "blocked" | "rate_limited" | "timeout" | "provider_unavailable" | "invalid_provider_response" | "cancelled">,
    message: string,
    readonly retryable: boolean,
    readonly partialResponse?: unknown,
  ) {
    super(message);
  }
}

export class SearxngWebSearchAdapter implements WebSearchExecutor {
  readonly #client: SearxngSearchClient;
  readonly #statusProvider: InternetSearchCapabilityStatusSnapshotProvider | null;
  readonly #now: () => string;

  constructor(options: {
    client: SearxngSearchClient;
    statusProvider?: InternetSearchCapabilityStatusSnapshotProvider | null;
    now?: () => string;
  }) {
    this.#client = options.client;
    this.#statusProvider = options.statusProvider ?? null;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async search(rawRequest: WebSearchExecutionRequest): Promise<WebSearchEnvelope> {
    const request = SearchRequestSchema.parse(rawRequest);
    const retrievedAt = this.#now();

    if (!request.authorized) {
      return failureEnvelope(request, retrievedAt, "failure", failure("not_authorized", false, "Search authorization is required."));
    }
    if (request.signal?.aborted) {
      return failureEnvelope(request, retrievedAt, "cancelled", failure("cancelled", false, "Search was cancelled."));
    }

    const parsedInput = WebSearchInputSchema.safeParse(request.input);
    if (!parsedInput.success) {
      return failureEnvelope(request, retrievedAt, "failure", failure("invalid_request", false, "Search input is invalid."));
    }

    if (!this.#isProviderCallable()) {
      return failureEnvelope(request, retrievedAt, "unavailable", failure("provider_unavailable", true, "Internet Search is unavailable."));
    }

    try {
      const response = await this.#client.search({
        query: parsedInput.data.query,
        maxResults: parsedInput.data.max_results,
        filters: parsedInput.data.filters,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      return normalizeSearxngResponse(response, {
        requestId: request.request_id,
        runId: request.run_id,
        retrievedAt,
        maxResults: parsedInput.data.max_results,
      });
    } catch (error) {
      if (error instanceof WebSearchProviderError) {
        return this.#failureFromProviderError(request, retrievedAt, error, parsedInput.data.max_results);
      }
      return failureEnvelope(
        request,
        retrievedAt,
        "unavailable",
        failure("provider_unavailable", true, "Internet Search provider is unavailable."),
      );
    }
  }

  #isProviderCallable(): boolean {
    const snapshot = this.#statusProvider?.snapshot();
    if (!snapshot) return true;
    return snapshot.installed && snapshot.enabled && snapshot.lifecycle_state === "available" && snapshot.health.state === "healthy";
  }

  #failureFromProviderError(
    request: z.infer<typeof SearchRequestSchema>,
    retrievedAt: string,
    error: WebSearchProviderError,
    maxResults: number,
  ): WebSearchEnvelope {
    const normalizedPartial = error.partialResponse
      ? normalizeProviderResults(error.partialResponse, retrievedAt, maxResults)
      : null;
    if (normalizedPartial && normalizedPartial.results.length > 0) {
      return envelope({
        requestId: request.request_id,
        runId: request.run_id,
        status: "partial",
        retrievedAt,
        results: normalizedPartial.results,
        failure: failure(error.code, error.retryable, safeFailureMessage(error.code), normalizedPartial.results.length),
        usageSearchCall: 1,
        includeProvider: true,
      });
    }
    return failureEnvelope(
      request,
      retrievedAt,
      statusForFailureCode(error.code),
      failure(error.code, error.retryable, safeFailureMessage(error.code)),
      true,
    );
  }
}

export class HttpSearxngSearchClient implements SearxngSearchClient {
  readonly #baseUrl: URL;
  readonly #searchPath: string;
  readonly #timeoutMs: number;
  readonly #fetchImpl: typeof fetch;
  readonly #engines: string | null;

  constructor(
    binding: SearxngSidecarBinding,
    options: { searchPath?: string; timeoutMs?: number; fetchImpl?: typeof fetch; engines?: string | null } = {},
  ) {
    this.#baseUrl = new URL(assertPrivateSearxngBinding(binding).endpoint_url);
    this.#searchPath = options.searchPath ?? "/search";
    this.#timeoutMs = capPositiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#engines = normalizeSearxngEngines(options.engines ?? DEFAULT_SEARXNG_ENGINES);
  }

  async search(input: SearxngSearchClientInput): Promise<unknown> {
    const url = new URL(this.#baseUrl);
    url.pathname = this.#searchPath;
    url.searchParams.set("q", input.query);
    url.searchParams.set("format", "json");
    url.searchParams.set("categories", "general");
    if (this.#engines) url.searchParams.set("engines", this.#engines);
    url.searchParams.set("safesearch", "1");
    url.searchParams.set("pageno", "1");
    if (input.filters.language) url.searchParams.set("language", input.filters.language);
    if (input.filters.freshness && input.filters.freshness !== "any") {
      url.searchParams.set("time_range", input.filters.freshness);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    const abort = () => controller.abort();
    if (input.signal?.aborted) {
      clearTimeout(timeout);
      throw new WebSearchProviderError("cancelled", "Search was cancelled.", false);
    }
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.#fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json" } });
      if (response.status === 429) throw new WebSearchProviderError("rate_limited", "Search provider rate limit was reached.", true);
      if (response.status === 401 || response.status === 403) throw new WebSearchProviderError("blocked", "Search provider refused the request.", true);
      if (!response.ok) throw new WebSearchProviderError("provider_unavailable", "Search provider is unavailable.", true);
      try {
        return await response.json();
      } catch {
        throw new WebSearchProviderError("invalid_provider_response", "Search provider response is invalid.", true);
      }
    } catch (error) {
      if (error instanceof WebSearchProviderError) throw error;
      if (controller.signal.aborted && input.signal?.aborted) {
        throw new WebSearchProviderError("cancelled", "Search was cancelled.", false);
      }
      if (controller.signal.aborted) {
        throw new WebSearchProviderError("timeout", "Search timed out.", true);
      }
      throw new WebSearchProviderError("provider_unavailable", "Search provider is unavailable.", true);
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
    }
  }
}

export function createConfiguredSearxngWebSearchAdapter(
  options: {
    env?: NodeJS.ProcessEnv;
    statusProvider?: InternetSearchCapabilityStatusSnapshotProvider | null;
    fetchImpl?: typeof fetch;
    now?: () => string;
  } = {},
): SearxngWebSearchAdapter | null {
  const env = options.env ?? process.env;
  const endpointUrl = env.BRAINDRIVE_INTERNET_SEARCH_SIDECAR_URL?.trim();
  if (!endpointUrl) return null;
  const transport = env.BRAINDRIVE_INTERNET_SEARCH_SIDECAR_TRANSPORT === "loopback" ? "loopback" : "container_internal";
  const binding = assertPrivateSearxngBinding({ transport, endpoint_url: endpointUrl });
  return new SearxngWebSearchAdapter({
    client: new HttpSearxngSearchClient(binding, {
      searchPath: env.BRAINDRIVE_INTERNET_SEARCH_SIDECAR_SEARCH_PATH?.trim() || undefined,
      timeoutMs: readPositiveInt(env.BRAINDRIVE_INTERNET_SEARCH_QUERY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
      engines: env.BRAINDRIVE_INTERNET_SEARCH_SIDECAR_ENGINES?.trim() || undefined,
      fetchImpl: options.fetchImpl,
    }),
    statusProvider: options.statusProvider ?? null,
    now: options.now,
  });
}

function normalizeSearxngResponse(
  response: unknown,
  options: { requestId: string; runId: string; retrievedAt: string; maxResults: number },
): WebSearchEnvelope {
  const normalized = normalizeProviderResults(response, options.retrievedAt, options.maxResults);
  if (!normalized.validProviderEnvelope) {
    return envelope({
      requestId: options.requestId,
      runId: options.runId,
      status: "failure",
      retrievedAt: options.retrievedAt,
      results: [],
      failure: failure("invalid_provider_response", true, "Search provider response is invalid."),
      usageSearchCall: 1,
      includeProvider: true,
    });
  }
  if (normalized.invalidResultCount > 0 && normalized.results.length > 0) {
    return envelope({
      requestId: options.requestId,
      runId: options.runId,
      status: "partial",
      retrievedAt: options.retrievedAt,
      results: normalized.results,
      failure: failure("invalid_provider_response", true, "Some Search results could not be normalized.", normalized.results.length),
      usageSearchCall: 1,
      includeProvider: true,
    });
  }
  if (normalized.invalidResultCount > 0) {
    return envelope({
      requestId: options.requestId,
      runId: options.runId,
      status: "failure",
      retrievedAt: options.retrievedAt,
      results: [],
      failure: failure("invalid_provider_response", true, "Search provider response is invalid."),
      usageSearchCall: 1,
      includeProvider: true,
    });
  }
  const providerFailure = providerFailureFromUnresponsiveEngines(response);
  if (normalized.results.length === 0 && providerFailure) {
    return envelope({
      requestId: options.requestId,
      runId: options.runId,
      status: statusForFailureCode(providerFailure.code),
      retrievedAt: options.retrievedAt,
      results: [],
      failure: failure(providerFailure.code, true, providerFailure.message),
      usageSearchCall: 1,
      includeProvider: true,
    });
  }
  return envelope({
    requestId: options.requestId,
    runId: options.runId,
    status: "success",
    retrievedAt: options.retrievedAt,
    results: normalized.results,
    failure: null,
    usageSearchCall: 1,
    includeProvider: true,
  });
}

function normalizeProviderResults(
  response: unknown,
  retrievedAt: string,
  maxResults: number,
): { validProviderEnvelope: boolean; results: WebSearchEnvelope["results"]; invalidResultCount: number } {
  const parsed = SearxngProviderResponseSchema.safeParse(response);
  if (!parsed.success) return { validProviderEnvelope: false, results: [], invalidResultCount: 0 };

  const results: WebSearchEnvelope["results"] = [];
  let invalidResultCount = 0;
  for (const rawResult of parsed.data.results) {
    if (results.length >= maxResults) break;
    const normalized = normalizeResult(rawResult, retrievedAt);
    if (normalized) results.push(normalized);
    else invalidResultCount += 1;
  }
  return { validProviderEnvelope: true, results, invalidResultCount };
}

function providerFailureFromUnresponsiveEngines(response: unknown): { code: "blocked" | "rate_limited" | "provider_unavailable"; message: string } | null {
  const parsed = SearxngProviderResponseSchema.safeParse(response);
  if (!parsed.success || !parsed.data.unresponsive_engines || parsed.data.unresponsive_engines.length === 0) return null;
  const reasons = parsed.data.unresponsive_engines
    .map((entry) => stringValue(entry[1])?.toLowerCase() ?? "")
    .filter(Boolean);
  if (reasons.length === 0) {
    return { code: "provider_unavailable", message: "Search provider engines are unavailable." };
  }
  if (reasons.every((reason) => /rate|too many/.test(reason))) {
    return { code: "rate_limited", message: "Search provider engines are rate limited." };
  }
  if (reasons.every((reason) => /captcha|access denied|forbidden|blocked/.test(reason))) {
    return { code: "blocked", message: "Search provider engines refused the request." };
  }
  return { code: "provider_unavailable", message: "Search provider engines are unavailable." };
}

function normalizeResult(rawResult: unknown, retrievedAt: string): WebSearchEnvelope["results"][number] | null {
  if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult)) return null;
  const raw = rawResult as Record<string, unknown>;
  const title = stringValue(raw.title);
  const url = publicWebUrl(raw.url);
  if (!title || !url) return null;
  const publishedAt = stringValue(raw.publishedDate) ?? stringValue(raw.published_at) ?? null;
  const updatedAt = stringValue(raw.updatedDate) ?? stringValue(raw.updated_at) ?? null;
  const result = {
    title,
    url,
    snippet: stringValue(raw.content) ?? stringValue(raw.snippet) ?? null,
    source: sourceFromUrl(url),
    retrieved_at: retrievedAt,
    published_at: publishedAt,
    updated_at: updatedAt,
    freshness: publishedAt || updatedAt ? "provider-reported" : "unknown",
    result_class: "outside-fact",
  };
  const parsed = WebSearchResultSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

function publicWebUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const hostname = parsed.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "0.0.0.0" || hostname === "::") return null;
  if (isLoopbackOrPrivateIp(hostname)) return null;
  return parsed.toString();
}

function sourceFromUrl(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase();
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isLoopbackOrPrivateIp(hostname: string): boolean {
  if (hostname === "::1") return true;
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 127 || first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function envelope(input: {
  requestId: string;
  runId: string;
  status: WebSearchEnvelope["status"];
  retrievedAt: string;
  results: WebSearchEnvelope["results"];
  failure: InternetSearchFailure | null;
  usageSearchCall: 0 | 1;
  includeProvider: boolean;
}): WebSearchEnvelope {
  return WebSearchEnvelopeSchema.parse({
    capability: "web.search",
    version: 1,
    request_id: input.requestId,
    run_id: input.runId,
    status: input.status,
    retrieved_at: input.retrievedAt,
    provider: input.includeProvider ? { profile: PROVIDER_PROFILE, attribution: PROVIDER_ATTRIBUTION } : null,
    usage: { search_call: input.usageSearchCall },
    results: input.results,
    failure: input.failure,
  });
}

function failureEnvelope(
  request: z.infer<typeof SearchRequestSchema>,
  retrievedAt: string,
  status: WebSearchEnvelope["status"],
  failureValue: InternetSearchFailure,
  includeProvider = false,
): WebSearchEnvelope {
  return envelope({
    requestId: request.request_id,
    runId: request.run_id,
    status,
    retrievedAt,
    results: [],
    failure: failureValue,
    usageSearchCall: includeProvider ? 1 : 0,
    includeProvider,
  });
}

function failure(
  code: InternetSearchFailureCode,
  retryable: boolean,
  message: string,
  completedItems = 0,
): InternetSearchFailure {
  return InternetSearchFailureSchema.parse({
    code,
    retryable,
    message,
    completed_items: completedItems,
  });
}

function statusForFailureCode(code: InternetSearchFailureCode): WebSearchEnvelope["status"] {
  if (code === "cancelled") return "cancelled";
  if (code === "provider_unavailable") return "unavailable";
  return "failure";
}

function safeFailureMessage(code: InternetSearchFailureCode): string {
  switch (code) {
    case "blocked":
      return "Search provider refused the request.";
    case "rate_limited":
      return "Search rate limit was reached.";
    case "timeout":
      return "Search timed out.";
    case "provider_unavailable":
      return "Internet Search provider is unavailable.";
    case "invalid_provider_response":
      return "Search provider response is invalid.";
    case "cancelled":
      return "Search was cancelled.";
    default:
      return "Search failed.";
  }
}

function readPositiveInt(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return capPositiveInt(parsed, fallback, max);
}

function normalizeSearxngEngines(value: string | null | undefined): string | null {
  const engines = String(value ?? "")
    .split(",")
    .map((engine) => engine.trim())
    .filter((engine) => /^[a-z0-9][a-z0-9 _-]{0,63}$/i.test(engine));
  return engines.length > 0 ? engines.join(",") : null;
}

function capPositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}
