import { describe, expect, it } from "vitest";

import { InternetSearchFailureSchema } from "./failures.js";
import { WebReadEnvelopeSchema, WebReadInputSchema } from "./read.js";
import { InternetSearchReceiptProjectionSchema } from "./receipts.js";
import { WebSearchEnvelopeSchema, WebSearchInputSchema } from "./search.js";

describe("Internet Search operation contract scaffolding", () => {
  it("validates bounded search inputs and outside-fact result envelopes", () => {
    expect(WebSearchInputSchema.parse({ query: "release notes", max_results: 3 })).toMatchObject({
      query: "release notes",
      max_results: 3,
      filters: {},
    });
    expect(() => WebSearchInputSchema.parse({ query: "x", max_results: 11 })).toThrow();

    expect(WebSearchEnvelopeSchema.parse({
      capability: "web.search",
      version: 1,
      request_id: "00000000-0000-4000-8000-000000000101",
      run_id: "00000000-0000-4000-8000-000000000201",
      status: "success",
      retrieved_at: "2026-09-01T00:00:00.000Z",
      provider: { profile: "local-owner-managed", attribution: "host-mediated-search" },
      usage: { search_call: 1 },
      results: [{
        title: "BrainDrive",
        url: "https://example.test/result",
        snippet: null,
        source: "example.test",
        retrieved_at: "2026-09-01T00:00:00.000Z",
        published_at: null,
        updated_at: null,
        freshness: "unknown",
        result_class: "outside-fact",
      }],
      failure: null,
    }).results[0]?.result_class).toBe("outside-fact");
  });

  it("validates URL-shaped read inputs and untrusted outside-fact results", () => {
    expect(WebReadInputSchema.parse({ url: "https://example.test/page" })).toEqual({ url: "https://example.test/page" });
    expect(() => WebReadInputSchema.parse({ url: "http://example.test/page" })).toThrow();
    expect(() => WebReadInputSchema.parse({ url: "/etc/passwd" })).toThrow();

    expect(WebReadEnvelopeSchema.parse({
      capability: "web.read",
      version: 1,
      request_id: "00000000-0000-4000-8000-000000000102",
      run_id: "00000000-0000-4000-8000-000000000202",
      status: "partial",
      retrieved_at: "2026-09-01T00:00:00.000Z",
      provider: { profile: "local-owner-managed", attribution: "host-fetch" },
      usage: { read_call: 1, bytes_read: 262144 },
      result: {
        requested_url: "https://example.test/page",
        canonical_url: "https://example.test/page",
        title: "Example",
        content_type: "text/html",
        content: "bounded text",
        truncated: true,
        trust: "external-untrusted",
        result_class: "outside-fact",
        published_at: null,
        updated_at: null,
      },
      failure: { code: "content_too_large", retryable: false, message: "Content exceeded the configured limit.", completed_items: 1 },
    }).result).toMatchObject({ trust: "external-untrusted", result_class: "outside-fact" });
  });

  it("keeps failure and receipt projections typed and content-minimized", () => {
    expect(InternetSearchFailureSchema.parse({
      code: "provider_unavailable",
      retryable: true,
      message: "Internet Search is unavailable.",
      completed_items: 0,
    }).code).toBe("provider_unavailable");

    expect(InternetSearchReceiptProjectionSchema.parse({
      receipt_version: 1,
      capability_id: "internet-search",
      capability_version: "0.1.0",
      operation_id: "web.search@1",
      request_id: "00000000-0000-4000-8000-000000000103",
      run_id: "00000000-0000-4000-8000-000000000203",
      status: "unavailable",
      failure_code: "provider_unavailable",
      result_count: 0,
      completed_item_count: 0,
      occurred_at: "2026-09-01T00:00:00.000Z",
      limit_profile_id: "is-local-v1.0",
      provider_profile_id: "local-owner-managed",
      max_search_operations_per_run: 5,
      max_read_operations_per_run: 5,
      max_normalized_results_per_search: 10,
      max_redirects_per_read: 3,
      max_returned_read_content_bytes: 262144,
      search_operation_timeout_ms: 10000,
      read_operation_timeout_ms: 10000,
      run_wall_clock_limit_ms: 60000,
      billing: "none_owner_managed_local",
      fallback: "none",
    })).not.toHaveProperty("query");
  });
});
