import { z } from "zod";

import { OpaqueIdSchema } from "../app-platform/contracts/common.js";
import {
  InternetSearchFailureSchema,
  InternetSearchReceiptProjectionSchema,
  type InternetSearchFailure,
  type InternetSearchFailureCode,
  type InternetSearchOperationId,
  type InternetSearchReceiptProjection,
  type WebReadEnvelope,
  type WebSearchEnvelope,
} from "./contracts/index.js";
import { INTERNET_SEARCH_LOCAL_V1_LIMITS } from "./limits.js";

type InternetSearchEnvelope = WebSearchEnvelope | WebReadEnvelope;

const OperationRequestSchema = z
  .object({
    request_id: OpaqueIdSchema,
    run_id: OpaqueIdSchema,
    input: z.unknown(),
  })
  .strict();

type OperationRequest = z.infer<typeof OperationRequestSchema>;

type OperationRecord = {
  fingerprint: string;
  promise: Promise<InternetSearchEnvelope> | null;
  envelope: InternetSearchEnvelope | null;
};

type RunUsage = {
  startedAtMs: number;
  searchOperations: number;
  readOperations: number;
};

const DEFAULT_FAILURES: Record<InternetSearchFailureCode, { retryable: boolean; message: string }> = {
  invalid_request: { retryable: false, message: "Internet Search request is invalid." },
  not_authorized: { retryable: false, message: "Internet Search authorization is required." },
  disallowed_target: { retryable: false, message: "The target is not allowed by the public web policy." },
  authentication_required: { retryable: false, message: "The resource requires authentication or session state." },
  blocked: { retryable: true, message: "The source or provider refused access." },
  rate_limited: { retryable: true, message: "Internet Search rate limit was reached." },
  budget_exceeded: { retryable: false, message: "Internet Search run budget was exceeded." },
  timeout: { retryable: true, message: "Internet Search timed out." },
  unsupported_content: { retryable: false, message: "The returned content is not supported." },
  content_too_large: { retryable: false, message: "Content exceeded the configured limit." },
  provider_unavailable: { retryable: true, message: "Internet Search provider is unavailable." },
  invalid_provider_response: { retryable: true, message: "Provider response could not be normalized safely." },
  cancelled: { retryable: false, message: "Internet Search was cancelled." },
};

export function createInternetSearchFailure(
  code: InternetSearchFailureCode,
  options: { retryable?: boolean; message?: string; completedItems?: number } = {},
): InternetSearchFailure {
  const defaults = DEFAULT_FAILURES[code];
  return InternetSearchFailureSchema.parse({
    code,
    retryable: options.retryable ?? defaults.retryable,
    message: options.message ?? defaults.message,
    completed_items: options.completedItems ?? 0,
  });
}

export function internetSearchStatusForFailure(code: InternetSearchFailureCode): InternetSearchEnvelope["status"] {
  if (code === "cancelled") return "cancelled";
  if (code === "provider_unavailable") return "unavailable";
  return "failure";
}

export function createInternetSearchReceiptProjection(
  operationId: InternetSearchOperationId,
  envelope: InternetSearchEnvelope,
  options: { capabilityVersion?: string } = {},
): InternetSearchReceiptProjection {
  const resultCount = operationId === "web.search@1"
    ? (envelope as WebSearchEnvelope).results.length
    : ((envelope as WebReadEnvelope).result ? 1 : 0);
  const completedItemCount = envelope.failure?.completed_items ?? resultCount;

  return InternetSearchReceiptProjectionSchema.parse({
    receipt_version: 1,
    capability_id: "internet-search",
    capability_version: options.capabilityVersion ?? "0.1.0",
    operation_id: operationId,
    request_id: envelope.request_id,
    run_id: envelope.run_id,
    status: envelope.status,
    failure_code: envelope.failure?.code ?? null,
    result_count: resultCount,
    completed_item_count: completedItemCount,
    occurred_at: envelope.retrieved_at,
    limit_profile_id: INTERNET_SEARCH_LOCAL_V1_LIMITS.profile_id,
    provider_profile_id: envelope.provider?.profile ?? "local-owner-managed",
    max_search_operations_per_run: INTERNET_SEARCH_LOCAL_V1_LIMITS.max_search_operations_per_run,
    max_read_operations_per_run: INTERNET_SEARCH_LOCAL_V1_LIMITS.max_read_operations_per_run,
    max_normalized_results_per_search: INTERNET_SEARCH_LOCAL_V1_LIMITS.max_normalized_results_per_search,
    max_redirects_per_read: INTERNET_SEARCH_LOCAL_V1_LIMITS.max_redirects_per_read,
    max_returned_read_content_bytes: INTERNET_SEARCH_LOCAL_V1_LIMITS.max_returned_read_content_bytes,
    search_operation_timeout_ms: INTERNET_SEARCH_LOCAL_V1_LIMITS.search_operation_timeout_ms,
    read_operation_timeout_ms: INTERNET_SEARCH_LOCAL_V1_LIMITS.read_operation_timeout_ms,
    run_wall_clock_limit_ms: INTERNET_SEARCH_LOCAL_V1_LIMITS.run_wall_clock_limit_ms,
    billing: INTERNET_SEARCH_LOCAL_V1_LIMITS.billing,
    fallback: INTERNET_SEARCH_LOCAL_V1_LIMITS.fallback,
  });
}

export class InternetSearchOperationCoordinator {
  readonly #operations = new Map<string, OperationRecord>();
  readonly #runs = new Map<string, RunUsage>();
  readonly #nowMs: () => number;
  readonly #nowIso: () => string;

  constructor(options: { nowMs?: () => number; nowIso?: () => string } = {}) {
    this.#nowMs = options.nowMs ?? (() => Date.now());
    this.#nowIso = options.nowIso ?? (() => new Date().toISOString());
  }

  async execute<TEnvelope extends InternetSearchEnvelope>(
    operationId: InternetSearchOperationId,
    rawRequest: OperationRequest,
    handler: (context: { operationId: InternetSearchOperationId; request: OperationRequest }) => Promise<TEnvelope>,
  ): Promise<TEnvelope> {
    const request = OperationRequestSchema.parse(rawRequest);
    const operationKey = `${operationId}:${request.request_id}`;
    const fingerprint = stableStringify({ operation_id: operationId, run_id: request.run_id, input: request.input });
    const existing = this.#operations.get(operationKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return this.#failureEnvelope(operationId, request, "invalid_request", {
          message: "Operation identity was reused with different input.",
        }) as TEnvelope;
      }
      if (existing.envelope) return existing.envelope as TEnvelope;
      return existing.promise as Promise<TEnvelope>;
    }

    const budgetFailure = this.#budgetFailure(operationId, request);
    if (budgetFailure) return budgetFailure as TEnvelope;

    this.#reserveOperation(operationId, request.run_id);
    const record: OperationRecord = { fingerprint, promise: null, envelope: null };
    const promise = handler({ operationId, request }).then((envelope) => {
      record.envelope = envelope;
      return envelope;
    }, () => {
      const envelope = this.#failureEnvelope(operationId, request, "provider_unavailable") as TEnvelope;
      record.envelope = envelope;
      return envelope;
    }).finally(() => {
      record.promise = null;
    });
    record.promise = promise;
    this.#operations.set(operationKey, record);
    return promise;
  }

  #budgetFailure(operationId: InternetSearchOperationId, request: OperationRequest): InternetSearchEnvelope | null {
    const run = this.#runs.get(request.run_id);
    if (run && this.#nowMs() - run.startedAtMs > INTERNET_SEARCH_LOCAL_V1_LIMITS.run_wall_clock_limit_ms) {
      return this.#failureEnvelope(operationId, request, "timeout");
    }
    if (operationId === "web.search@1" && run && run.searchOperations >= INTERNET_SEARCH_LOCAL_V1_LIMITS.max_search_operations_per_run) {
      return this.#failureEnvelope(operationId, request, "budget_exceeded");
    }
    if (operationId === "web.read@1" && run && run.readOperations >= INTERNET_SEARCH_LOCAL_V1_LIMITS.max_read_operations_per_run) {
      return this.#failureEnvelope(operationId, request, "budget_exceeded");
    }
    return null;
  }

  #reserveOperation(operationId: InternetSearchOperationId, runId: string): void {
    const run = this.#runs.get(runId) ?? { startedAtMs: this.#nowMs(), searchOperations: 0, readOperations: 0 };
    if (operationId === "web.search@1") run.searchOperations += 1;
    else run.readOperations += 1;
    this.#runs.set(runId, run);
  }

  #failureEnvelope(operationId: InternetSearchOperationId, request: OperationRequest, code: InternetSearchFailureCode, options: { message?: string } = {}): InternetSearchEnvelope {
    const retrievedAt = this.#nowIso();
    const failure = createInternetSearchFailure(code, options);
    if (operationId === "web.read@1") {
      return {
        capability: "web.read",
        version: 1,
        request_id: request.request_id,
        run_id: request.run_id,
        status: internetSearchStatusForFailure(code),
        retrieved_at: retrievedAt,
        provider: null,
        usage: { read_call: 0, bytes_read: 0 },
        result: null,
        failure,
      };
    }
    return {
      capability: "web.search",
      version: 1,
      request_id: request.request_id,
      run_id: request.run_id,
      status: internetSearchStatusForFailure(code),
      retrieved_at: retrievedAt,
      provider: null,
      usage: { search_call: 0 },
      results: [],
      failure,
    };
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableStringify);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortForStableStringify(child)]),
  );
}
