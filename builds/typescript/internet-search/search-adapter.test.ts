import { afterEach, describe, expect, it, vi } from "vitest";

import { createConfiguredSearxngWebSearchAdapter, WebSearchProviderError, SearxngWebSearchAdapter, type SearxngSearchClient } from "./search-adapter.js";
import { INTERNET_SEARCH_LOCAL_V1_LIMITS } from "./limits.js";
import type { SearxngSidecarSnapshot } from "./sidecar.js";

const requestId = "00000000-0000-4000-8000-000000000301";
const runId = "00000000-0000-4000-8000-000000000401";
const now = "2026-09-01T00:00:00.000Z";

function healthySnapshot(): SearxngSidecarSnapshot {
  return {
    installed: true,
    enabled: true,
    lifecycle_state: "available",
    health: { state: "healthy", checked_at: now },
    safe_message: "Internet Search is available.",
  };
}

function clientWith(handler: SearxngSearchClient["search"]): SearxngSearchClient {
  return { search: handler };
}

function adapterWith(client: SearxngSearchClient, snapshot: SearxngSidecarSnapshot = healthySnapshot()) {
  return new SearxngWebSearchAdapter({
    client,
    statusProvider: { snapshot: () => snapshot },
    now: () => now,
  });
}

function rawResult(overrides: Record<string, unknown> = {}) {
  return {
    title: "BrainDrive release notes",
    url: "https://docs.example.test/braindrive/releases",
    content: "Release notes for BrainDrive.",
    engine: "fixture-engine",
    parsed_url: ["https", "docs.example.test", "/braindrive/releases"],
    score: 42,
    publishedDate: "2026-08-31",
    ...overrides,
  };
}

function expectNoRawProviderLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("fixture-engine");
  expect(serialized).not.toContain("parsed_url");
  expect(serialized).not.toContain("score");
  expect(serialized).not.toMatch(/internet-search-searxng|searxng-local|localhost|127\.0\.0\.1|:8080|credential|secret|vault/i);
}

describe("web.search@1 SearXNG adapter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes mocked SearXNG results into generic outside-fact envelopes without query expansion", async () => {
    const seen: { query?: string; maxResults?: number } = {};
    const adapter = adapterWith(clientWith(async (input) => {
      seen.query = input.query;
      seen.maxResults = input.maxResults;
      return { results: [rawResult()] };
    }));

    const result = await adapter.search({
      request_id: requestId,
      run_id: runId,
      input: { query: "BrainDrive release notes", max_results: 2 },
    });

    expect(seen).toEqual({ query: "BrainDrive release notes", maxResults: 2 });
    expect(result).toMatchObject({
      capability: "web.search",
      version: 1,
      request_id: requestId,
      run_id: runId,
      status: "success",
      retrieved_at: now,
      provider: { profile: "local-owner-managed", attribution: "host-mediated-search" },
      usage: { search_call: 1 },
      failure: null,
      results: [{
        title: "BrainDrive release notes",
        url: "https://docs.example.test/braindrive/releases",
        snippet: "Release notes for BrainDrive.",
        source: "docs.example.test",
        retrieved_at: now,
        published_at: "2026-08-31",
        updated_at: null,
        freshness: "provider-reported",
        result_class: "outside-fact",
      }],
    });
    expectNoRawProviderLeak(result);
  });

  it("returns empty success for a successful provider response with no results", async () => {
    const adapter = adapterWith(clientWith(async () => ({ results: [] })));

    await expect(adapter.search({
      request_id: requestId,
      run_id: runId,
      input: { query: "nothing here", max_results: 5 },
    })).resolves.toMatchObject({
      status: "success",
      results: [],
      failure: null,
      usage: { search_call: 1 },
    });
  });

  it("returns invalid_request without calling the provider for invalid input", async () => {
    let called = false;
    const adapter = adapterWith(clientWith(async () => {
      called = true;
      return { results: [] };
    }));

    const result = await adapter.search({
      request_id: requestId,
      run_id: runId,
      input: { query: "too many", max_results: 11 },
    });

    expect(called).toBe(false);
    expect(result).toMatchObject({
      status: "failure",
      provider: null,
      usage: { search_call: 0 },
      results: [],
      failure: { code: "invalid_request", retryable: false, completed_items: 0 },
    });
  });

  it("keeps malformed provider responses distinct from empty success", async () => {
    const adapter = adapterWith(clientWith(async () => ({ results: "not an array" })));

    const result = await adapter.search({
      request_id: requestId,
      run_id: runId,
      input: { query: "malformed provider" },
    });

    expect(result).toMatchObject({
      status: "failure",
      results: [],
      failure: { code: "invalid_provider_response", retryable: true, completed_items: 0 },
    });
    expectNoRawProviderLeak(result);
  });

  it("returns partial results when some provider results normalize and others are malformed", async () => {
    const adapter = adapterWith(clientWith(async () => ({
      results: [
        rawResult(),
        { title: "Missing URL", content: "not usable" },
        rawResult({ title: "Loopback URL", url: "http://127.0.0.1/provider-internal" }),
      ],
    })));

    const result = await adapter.search({
      request_id: requestId,
      run_id: runId,
      input: { query: "partial provider response" },
    });

    expect(result.status).toBe("partial");
    expect(result.results).toHaveLength(1);
    expect(result.failure).toMatchObject({
      code: "invalid_provider_response",
      retryable: true,
      completed_items: 1,
    });
  });

  it("maps timeout, rate-limit, provider unavailable, and cancelled failures without inventing results", async () => {
    for (const [code, expectedStatus] of [
      ["timeout", "failure"],
      ["rate_limited", "failure"],
      ["provider_unavailable", "unavailable"],
      ["cancelled", "cancelled"],
    ] as const) {
      const adapter = adapterWith(clientWith(async () => {
        throw new WebSearchProviderError(code, "Synthetic provider failure", code !== "cancelled");
      }));

      const result = await adapter.search({
        request_id: requestId,
        run_id: runId,
        input: { query: `failure ${code}` },
      });

      expect(result).toMatchObject({
        status: expectedStatus,
        results: [],
        failure: { code, completed_items: 0 },
      });
    }
  });

  it("preserves normalized completed work on a timeout with partial provider data", async () => {
    const adapter = adapterWith(clientWith(async () => {
      throw new WebSearchProviderError("timeout", "Search timed out.", true, { results: [rawResult()] });
    }));

    const result = await adapter.search({
      request_id: requestId,
      run_id: runId,
      input: { query: "partial timeout" },
    });

    expect(result.status).toBe("partial");
    expect(result.results).toHaveLength(1);
    expect(result.failure).toMatchObject({ code: "timeout", retryable: true, completed_items: 1 });
    expectNoRawProviderLeak(result);
  });

  it("fails closed when the sidecar is not available", async () => {
    const adapter = adapterWith(clientWith(async () => ({ results: [rawResult()] })), {
      installed: true,
      enabled: true,
      lifecycle_state: "unavailable",
      health: { state: "unhealthy", checked_at: now },
      safe_message: "Internet Search needs attention.",
    });

    await expect(adapter.search({
      request_id: requestId,
      run_id: runId,
      input: { query: "unavailable" },
    })).resolves.toMatchObject({
      status: "unavailable",
      provider: null,
      usage: { search_call: 0 },
      results: [],
      failure: { code: "provider_unavailable", retryable: true, completed_items: 0 },
    });
  });

  it("does not allow configured timeout values to exceed the accepted local V1 search limit", async () => {
    vi.useFakeTimers();
    let fetchStarted = false;
    const adapter = createConfiguredSearxngWebSearchAdapter({
      env: {
        BRAINDRIVE_INTERNET_SEARCH_SIDECAR_URL: "http://internet-search-searxng:8080",
        BRAINDRIVE_INTERNET_SEARCH_QUERY_TIMEOUT_MS: "60000",
      } as NodeJS.ProcessEnv,
      fetchImpl: async (_url, init) => {
        fetchStarted = true;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      },
      now: () => now,
    });
    expect(adapter).not.toBeNull();

    const pending = adapter!.search({
      request_id: requestId,
      run_id: runId,
      input: { query: "timeout clamp" },
    });
    await vi.waitFor(() => expect(fetchStarted).toBe(true));
    await vi.advanceTimersByTimeAsync(INTERNET_SEARCH_LOCAL_V1_LIMITS.search_operation_timeout_ms);

    await expect(pending).resolves.toMatchObject({
      status: "failure",
      failure: { code: "timeout", retryable: true },
    });
  });
});
