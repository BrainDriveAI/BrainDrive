import { describe, expect, it } from "vitest";

import {
  InternetSearchFailureCodeSchema,
  InternetSearchReceiptProjectionSchema,
  type WebReadEnvelope,
  type WebSearchEnvelope,
} from "./contracts/index.js";
import { INTERNET_SEARCH_LOCAL_V1_LIMITS } from "./limits.js";
import {
  createInternetSearchFailure,
  createInternetSearchReceiptProjection,
  InternetSearchOperationCoordinator,
} from "./operation-metadata.js";

const now = "2026-09-01T00:00:00.000Z";
const requestId = "00000000-0000-4000-8000-000000001001";
const runId = "00000000-0000-4000-8000-000000001101";

function searchEnvelope(overrides: Partial<WebSearchEnvelope> = {}): WebSearchEnvelope {
  return {
    capability: "web.search",
    version: 1,
    request_id: requestId,
    run_id: runId,
    status: "success",
    retrieved_at: now,
    provider: { profile: "local-owner-managed", attribution: "host-mediated-search" },
    usage: { search_call: 1 },
    results: [{
      title: "Safe result",
      url: "https://public.example/result",
      snippet: "Result summary",
      source: "public.example",
      retrieved_at: now,
      published_at: null,
      updated_at: null,
      freshness: "unknown",
      result_class: "outside-fact",
    }],
    failure: null,
    ...overrides,
  };
}

function readEnvelope(overrides: Partial<WebReadEnvelope> = {}): WebReadEnvelope {
  return {
    capability: "web.read",
    version: 1,
    request_id: requestId,
    run_id: runId,
    status: "partial",
    retrieved_at: now,
    provider: { profile: "local-owner-managed", attribution: "host-fetch" },
    usage: { read_call: 1, bytes_read: 128 },
    result: {
      requested_url: "https://public.example/page",
      canonical_url: "https://public.example/page",
      title: "Safe page",
      content_type: "text/html",
      content: "bounded content",
      truncated: true,
      trust: "external-untrusted",
      result_class: "outside-fact",
      published_at: null,
      updated_at: null,
    },
    failure: createInternetSearchFailure("content_too_large", { completedItems: 1 }),
    ...overrides,
  };
}

describe("Internet Search typed failures, limits, and receipts", () => {
  it("keeps the accepted V1 failure taxonomy distinct with safe defaults", () => {
    const failures = InternetSearchFailureCodeSchema.options.map((code) => createInternetSearchFailure(code));

    expect(new Set(failures.map((failure) => failure.code)).size).toBe(InternetSearchFailureCodeSchema.options.length);
    expect(failures).toContainEqual(expect.objectContaining({ code: "invalid_request", retryable: false, completed_items: 0 }));
    expect(failures).toContainEqual(expect.objectContaining({ code: "rate_limited", retryable: true, completed_items: 0 }));
    expect(failures).toContainEqual(expect.objectContaining({ code: "budget_exceeded", retryable: false, completed_items: 0 }));
    expect(failures).toContainEqual(expect.objectContaining({ code: "cancelled", retryable: false, completed_items: 0 }));
    for (const failure of failures) {
      expect(failure.message).toMatch(/\S/);
      expect(JSON.stringify(failure)).not.toMatch(/searxng|localhost|127\.0\.0\.1|credential|secret|vault|\/home\//i);
    }
  });

  it("publishes accepted local V1 limits without caller-controlled widening fields", () => {
    expect(INTERNET_SEARCH_LOCAL_V1_LIMITS).toEqual({
      profile_id: "is-local-v1.0",
      max_normalized_results_per_search: 10,
      max_search_operations_per_run: 5,
      max_read_operations_per_run: 5,
      max_redirects_per_read: 3,
      max_returned_read_content_bytes: 262_144,
      search_operation_timeout_ms: 10_000,
      read_operation_timeout_ms: 10_000,
      run_wall_clock_limit_ms: 60_000,
      retry_rule: "one_retry_retryable_provider_or_network_failures",
      query_adaptation: "none",
      fallback: "none",
      billing: "none_owner_managed_local",
    });
  });

  it("projects receipt-safe metadata from Search and Read envelopes", () => {
    const searchReceipt = createInternetSearchReceiptProjection("web.search@1", searchEnvelope());
    const readReceipt = createInternetSearchReceiptProjection("web.read@1", readEnvelope());

    expect(InternetSearchReceiptProjectionSchema.parse(searchReceipt)).toMatchObject({
      receipt_version: 1,
      capability_id: "internet-search",
      operation_id: "web.search@1",
      request_id: requestId,
      run_id: runId,
      status: "success",
      failure_code: null,
      result_count: 1,
      completed_item_count: 1,
      limit_profile_id: "is-local-v1.0",
      provider_profile_id: "local-owner-managed",
      billing: "none_owner_managed_local",
      fallback: "none",
    });
    expect(InternetSearchReceiptProjectionSchema.parse(readReceipt)).toMatchObject({
      operation_id: "web.read@1",
      status: "partial",
      failure_code: "content_too_large",
      result_count: 1,
      completed_item_count: 1,
    });

    for (const receipt of [searchReceipt, readReceipt]) {
      expect(receipt).not.toHaveProperty("query");
      expect(receipt).not.toHaveProperty("url");
      expect(receipt).not.toHaveProperty("result");
      expect(receipt).not.toHaveProperty("results");
      expect(JSON.stringify(receipt)).not.toMatch(/raw query canary|bounded content|https:\/\/public\.example|searxng-local|localhost|127\.0\.0\.1|:8080|credential|secret|vault|\/home\/hex|brief|job|resume/i);
    }
  });

  it("replays exact idempotent operations and rejects conflicting reuse before executing work", async () => {
    let calls = 0;
    const coordinator = new InternetSearchOperationCoordinator();
    const first = await coordinator.execute("web.search@1", {
      request_id: requestId,
      run_id: runId,
      input: { query: "raw query canary" },
    }, async () => {
      calls += 1;
      return searchEnvelope();
    });
    const replay = await coordinator.execute("web.search@1", {
      request_id: requestId,
      run_id: runId,
      input: { query: "raw query canary" },
    }, async () => {
      calls += 1;
      return searchEnvelope({ retrieved_at: "2026-09-01T00:00:01.000Z" });
    });
    const conflict = await coordinator.execute("web.search@1", {
      request_id: requestId,
      run_id: runId,
      input: { query: "changed query" },
    }, async () => {
      calls += 1;
      return searchEnvelope({ status: "failure" });
    });

    expect(calls).toBe(1);
    expect(replay).toEqual(first);
    expect(conflict).toMatchObject({
      status: "failure",
      usage: { search_call: 0 },
      failure: { code: "invalid_request", retryable: false },
    });
  });

  it("stops new operations when per-run budgets or wall-clock limits are exhausted", async () => {
    let nowMs = 0;
    let calls = 0;
    const coordinator = new InternetSearchOperationCoordinator({ nowMs: () => nowMs });
    for (let index = 0; index < INTERNET_SEARCH_LOCAL_V1_LIMITS.max_search_operations_per_run; index += 1) {
      const result = await coordinator.execute("web.search@1", {
        request_id: `00000000-0000-4000-8000-00000000120${index}`,
        run_id: runId,
        input: { query: `query ${index}` },
      }, async (context) => {
        calls += 1;
        return searchEnvelope({ request_id: context.request.request_id });
      });
      expect(result.status).toBe("success");
    }

    const budgetExceeded = await coordinator.execute("web.search@1", {
      request_id: "00000000-0000-4000-8000-000000001299",
      run_id: runId,
      input: { query: "over budget" },
    }, async () => {
      calls += 1;
      return searchEnvelope();
    });

    const timedRunId = "00000000-0000-4000-8000-000000001499";
    await expect(coordinator.execute("web.read@1", {
      request_id: "00000000-0000-4000-8000-000000001398",
      run_id: timedRunId,
      input: { url: "https://public.example/page" },
    }, async () => readEnvelope({
      request_id: "00000000-0000-4000-8000-000000001398",
      run_id: timedRunId,
      status: "success",
      result: null,
      failure: null,
    }))).resolves.toMatchObject({ status: "success" });

    nowMs = INTERNET_SEARCH_LOCAL_V1_LIMITS.run_wall_clock_limit_ms + 1;
    const timedOutRun = await coordinator.execute("web.read@1", {
      request_id: "00000000-0000-4000-8000-000000001399",
      run_id: timedRunId,
      input: { url: "https://public.example/page" },
    }, async () => readEnvelope());

    expect(calls).toBe(INTERNET_SEARCH_LOCAL_V1_LIMITS.max_search_operations_per_run);
    expect(budgetExceeded).toMatchObject({
      status: "failure",
      usage: { search_call: 0 },
      failure: { code: "budget_exceeded", retryable: false },
    });
    expect(timedOutRun).toMatchObject({
      status: "failure",
      usage: { read_call: 0, bytes_read: 0 },
      failure: { code: "timeout", retryable: true },
    });
  });
});
