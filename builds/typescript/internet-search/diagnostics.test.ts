import { describe, expect, it } from "vitest";

import {
  INTERNET_SEARCH_DIAGNOSTIC_RETENTION_POLICY,
  INTERNET_SEARCH_SUPPORT_BUNDLE_DIAGNOSTICS_STATUS,
  InternetSearchDiagnosticEventSchema,
  createMemoryInternetSearchDiagnosticSink,
  markInternetSearchQualificationStale,
  projectInternetSearchOperationDiagnostic,
  projectSearxngSidecarDiagnostic,
} from "./diagnostics.js";
import type { WebReadEnvelope, WebSearchEnvelope } from "./contracts/index.js";
import { createInternetSearchFailure } from "./operation-metadata.js";
import type { SearxngSidecarDiagnostic } from "./sidecar.js";

const now = "2026-09-01T00:00:00.000Z";
const requestId = "00000000-0000-4000-8000-000000007001";
const runId = "00000000-0000-4000-8000-000000007101";
const unsafePattern =
  /CANARY_|internet-search-searxng|searxng-local|https?:|localhost|127\.0\.0\.1|18080|\bport\b|credential|secret|vault|api[_-]?key|authorization|cookie|\/home\/canary|\/tmp\/canary|owner-private|prompt/i;

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
      title: "CANARY_RAW_PROVIDER_TITLE",
      url: "https://public.example/result?token=CANARY_PROVIDER_TOKEN",
      snippet: "CANARY_RAW_QUERY_TEXT and CANARY_OWNER_PRIVATE_DATA",
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
    usage: { read_call: 1, bytes_read: 262_144 },
    result: {
      requested_url: "https://public.example/page?api_key=CANARY_PROVIDER_KEY",
      canonical_url: "https://public.example/page",
      title: "CANARY_PAGE_TITLE",
      content_type: "text/html",
      content: "CANARY_RAW_PAGE_TEXT with CANARY_PROMPT_IGNORE_POLICY",
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

function expectNoUnsafe(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(unsafePattern);
}

describe("Internet Search diagnostics and retention", () => {
  it("declares the accepted local V1 content-minimized retention policy", () => {
    expect(INTERNET_SEARCH_DIAGNOSTIC_RETENTION_POLICY).toEqual({
      policy_id: "package-provider-diagnostics-v1",
      retained_event_classes: ["operation", "sidecar_lifecycle", "qualification_stale"],
      local_retention_days: 14,
      raw_page_content: "excluded_ephemeral",
      raw_provider_responses: "excluded",
      raw_queries: "excluded",
      prompts: "excluded",
      credentials: "excluded",
      host_paths: "excluded",
      provider_endpoints: "excluded",
      support_bundle_export: "safe_projection_only",
      delivery_evidence: "separate_sanitized_bundle",
    });
  });

  it("projects operation diagnostics through a strict allowlist", () => {
    const search = projectInternetSearchOperationDiagnostic({
      operationId: "web.search@1",
      envelope: searchEnvelope(),
      durationMs: 42,
      unsafeInput: {
        query: "CANARY_RAW_QUERY_TEXT",
        prompt: "CANARY_PROMPT_IGNORE_POLICY",
        endpoint: "http://127.0.0.1:18080/search",
        owner_private: "owner-private CANARY_OWNER_PRIVATE_DATA",
        host_path: "/home/canary/private-file",
        raw_provider_response: { result: "CANARY_RAW_PROVIDER_JSON" },
        authorization: "Bearer CANARY_AUTHORIZATION_TOKEN",
      },
    });
    const read = projectInternetSearchOperationDiagnostic({
      operationId: "web.read@1",
      envelope: readEnvelope(),
      durationMs: 99,
      unsafeInput: {
        url: "https://public.example/page?api_key=CANARY_PROVIDER_KEY",
        cookie: "CANARY_SESSION_COOKIE",
        local_service: "localhost:18080",
        host_path: "/tmp/canary/raw-page.html",
      },
    });

    expect(InternetSearchDiagnosticEventSchema.parse(search)).toMatchObject({
      diagnostic_version: 1,
      event_type: "operation",
      operation_id: "web.search@1",
      status: "success",
      provider_execution: "executed",
      failure_code: null,
      result_count: 1,
      completed_item_count: 1,
      package_id: "ai.braindrive.internet-search.searxng",
      provider_component_id: "search.provider",
      provider_profile_class: "capability_provider",
      usage: { call_count: 1, bytes_class: null },
      duration_ms: 42,
      retention_policy_id: "package-provider-diagnostics-v1",
    });
    expect(InternetSearchDiagnosticEventSchema.parse(read)).toMatchObject({
      event_type: "operation",
      operation_id: "web.read@1",
      status: "partial",
      provider_execution: "executed",
      failure_code: "content_too_large",
      result_count: 1,
      completed_item_count: 1,
      usage: { call_count: 1, bytes_class: "limit" },
    });

    for (const event of [search, read]) {
      expect(Object.keys(event).sort()).toEqual([
        "capability_id",
        "capability_version",
        "completed_item_count",
        "diagnostic_version",
        "duration_ms",
        "event_type",
        "failure_code",
        "installation_id",
        "limit_profile_id",
        "occurred_at",
        "operation_id",
        "package_digest",
        "package_id",
        "package_version",
        "provider_component_id",
        "provider_execution",
        "provider_profile_class",
        "provider_profile_id",
        "provider_selection",
        "request_id",
        "result_count",
        "retention_expires_after_days",
        "retention_policy_id",
        "run_id",
        "status",
        "usage",
      ]);
      expectNoUnsafe(event);
    }
  });

  it("keeps failure and empty-result receipt diagnostics distinct without raw query or content", () => {
    const emptySearch = projectInternetSearchOperationDiagnostic({
      operationId: "web.search@1",
      envelope: searchEnvelope({ results: [], usage: { search_call: 1 } }),
      unsafeInput: { query: "CANARY_RAW_QUERY_TEXT", authorization: "Bearer CANARY_TOKEN" },
    });
    const partialRead = projectInternetSearchOperationDiagnostic({
      operationId: "web.read@1",
      envelope: readEnvelope(),
      unsafeInput: { url: "https://public.example/private?token=CANARY_TOKEN" },
    });
    const preProviderFailure = projectInternetSearchOperationDiagnostic({
      operationId: "web.search@1",
      envelope: searchEnvelope({
        status: "failure",
        provider: null,
        usage: { search_call: 0 },
        results: [],
        failure: createInternetSearchFailure("not_authorized"),
      }),
      unsafeInput: { query: "CANARY_RAW_QUERY_TEXT" },
    });
    const timeout = projectInternetSearchOperationDiagnostic({
      operationId: "web.search@1",
      envelope: searchEnvelope({
        status: "failure",
        provider: null,
        usage: { search_call: 0 },
        results: [],
        failure: createInternetSearchFailure("timeout"),
      }),
      unsafeInput: { query: "CANARY_RAW_QUERY_TEXT" },
    });
    const cancelled = projectInternetSearchOperationDiagnostic({
      operationId: "web.read@1",
      envelope: readEnvelope({
        status: "cancelled",
        provider: null,
        usage: { read_call: 0, bytes_read: 0 },
        result: null,
        failure: createInternetSearchFailure("cancelled"),
      }),
      unsafeInput: { url: "https://public.example/page" },
    });
    const invalidProvider = projectInternetSearchOperationDiagnostic({
      operationId: "web.search@1",
      envelope: searchEnvelope({
        status: "failure",
        provider: null,
        usage: { search_call: 0 },
        results: [],
        failure: createInternetSearchFailure("invalid_provider_response"),
      }),
      unsafeInput: { raw_provider_response: "CANARY_RAW_PROVIDER_PAYLOAD" },
    });

    expect(emptySearch).toMatchObject({
      status: "success",
      failure_code: null,
      provider_execution: "executed",
      result_count: 0,
      completed_item_count: 0,
      usage: { call_count: 1, bytes_class: null },
    });
    expect(partialRead).toMatchObject({
      status: "partial",
      failure_code: "content_too_large",
      provider_execution: "executed",
      result_count: 1,
      completed_item_count: 1,
      usage: { call_count: 1, bytes_class: "limit" },
    });
    expect(preProviderFailure).toMatchObject({
      status: "failure",
      failure_code: "not_authorized",
      provider_execution: "not_executed",
      result_count: 0,
      usage: { call_count: 0, bytes_class: null },
    });
    expect(timeout).toMatchObject({
      status: "failure",
      failure_code: "timeout",
      provider_execution: "executed",
      result_count: 0,
      usage: { call_count: 0, bytes_class: null },
    });
    expect(cancelled).toMatchObject({
      status: "cancelled",
      failure_code: "cancelled",
      provider_execution: "executed",
      result_count: 0,
      usage: { call_count: 0, bytes_class: "none" },
    });
    expect(invalidProvider).toMatchObject({
      status: "failure",
      failure_code: "invalid_provider_response",
      provider_execution: "executed",
      result_count: 0,
      usage: { call_count: 0, bytes_class: null },
    });
    expectNoUnsafe([emptySearch, partialRead, preProviderFailure, timeout, cancelled, invalidProvider]);
  });

  it("projects sidecar lifecycle diagnostics without raw endpoint or unsafe error details", () => {
    const raw: SearxngSidecarDiagnostic = {
      sequence: 7,
      occurred_at: now,
      state: "unhealthy",
      action: "health",
      endpoint_class: "container_internal",
      public_bind: false,
      error_code: "CANARY_PROVIDER_ENDPOINT http://internet-search-searxng:18080/healthz /home/canary/log",
    };

    const projected = projectSearxngSidecarDiagnostic(raw);

    expect(InternetSearchDiagnosticEventSchema.parse(projected)).toMatchObject({
      diagnostic_version: 1,
      event_type: "sidecar_lifecycle",
      sequence: 7,
      package_id: "ai.braindrive.internet-search.searxng",
      component_id: "search.runtime",
      owner_component_id: "search.provider",
      state: "failed",
      health: "unhealthy",
      action: "health",
      binding_class: "container_internal_authenticated",
      error_code: "unknown",
      retention_policy_id: "package-provider-diagnostics-v1",
    });
    expectNoUnsafe(projected);
  });

  it("marks material qualification changes stale without overclaiming evidence-only changes", () => {
    expect(markInternetSearchQualificationStale({
      changed_at: now,
      change_class: "provider_version_change",
    })).toMatchObject({
      event_type: "qualification_stale",
      package_id: "ai.braindrive.internet-search.searxng",
      provider_component_id: "search.provider",
      qualification_status: "stale",
      requires_rerun: true,
      affected_evidence: ["schema_conformance", "operation_contract_conformance", "provider_qualification", "dependent_product_results"],
    });

    expect(markInternetSearchQualificationStale({
      changed_at: now,
      change_class: "evidence_only",
    })).toMatchObject({
      event_type: "qualification_stale",
      qualification_status: "current",
      requires_rerun: false,
      affected_evidence: [],
    });
  });

  it("keeps an in-memory diagnostic sink capped and schema-validated", () => {
    const sink = createMemoryInternetSearchDiagnosticSink({ maxEvents: 2 });
    sink.record(projectInternetSearchOperationDiagnostic({
      operationId: "web.search@1",
      envelope: searchEnvelope({ request_id: "00000000-0000-4000-8000-000000007201" }),
    }));
    sink.record(projectInternetSearchOperationDiagnostic({
      operationId: "web.search@1",
      envelope: searchEnvelope({ request_id: "00000000-0000-4000-8000-000000007202" }),
    }));
    sink.record(projectInternetSearchOperationDiagnostic({
      operationId: "web.search@1",
      envelope: searchEnvelope({ request_id: "00000000-0000-4000-8000-000000007203" }),
    }));

    expect(sink.events()).toHaveLength(2);
    expect(sink.events()[0]).toMatchObject({ request_id: "00000000-0000-4000-8000-000000007202" });
    for (const event of sink.events()) expectNoUnsafe(event);

    const unsafeEvent = {
      ...projectInternetSearchOperationDiagnostic({ operationId: "web.search@1", envelope: searchEnvelope() }),
      raw_query: "CANARY_RAW_QUERY_TEXT",
    } as unknown as Parameters<typeof sink.record>[0];
    expect(() => sink.record(unsafeEvent)).toThrow(/unrecognized/i);
  });

  it("documents support-bundle Search diagnostics as unclaimed until a narrow export is accepted", () => {
    expect(INTERNET_SEARCH_SUPPORT_BUNDLE_DIAGNOSTICS_STATUS).toEqual({
      status: "safe_projection_only",
      raw_provider_payload_export: "not_claimed",
      reason: "Support bundles may include only bounded generic diagnostic projections; raw provider payload exports require separate allowlisted review.",
    });
  });
});
