import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { PermissionSet } from "../contracts.js";
import {
  INTERNET_SEARCH_LOCAL_V1_REGISTRATION,
  InternetSearchCapabilityRegistry,
} from "../internet-search/registry.js";
import { registerInternetSearchCapabilityRoutes } from "../internet-search/routes.js";
import { createMemoryInternetSearchDiagnosticSink } from "../internet-search/diagnostics.js";
import { InternetSearchOperationCoordinator } from "../internet-search/operation-metadata.js";
import type { InternetSearchCapabilityStatusProvider } from "../internet-search/registry.js";
import type { WebReadExecutor } from "../internet-search/read-adapter.js";
import type { WebSearchExecutor } from "../internet-search/search-adapter.js";

const basePermissions: PermissionSet = {
  memory_access: true,
  tool_access: true,
  system_actions: true,
  delegation: true,
  approval_authority: true,
  administration: true,
};

function createApp(options: {
  toolAccess: boolean;
  registry?: InternetSearchCapabilityRegistry;
  searchExecutor?: WebSearchExecutor | null;
  readExecutor?: WebReadExecutor | null;
  operationCoordinator?: InternetSearchOperationCoordinator;
  diagnosticsSink?: ReturnType<typeof createMemoryInternetSearchDiagnosticSink>;
}) {
  const app = Fastify({ logger: false });
  app.addHook("preHandler", async (request) => {
    request.authContext = {
      actorId: "owner",
      actorType: "owner",
      mode: "local-owner",
      permissions: { ...basePermissions, tool_access: options.toolAccess },
    };
  });
  registerInternetSearchCapabilityRoutes(
    app,
    options.registry ?? new InternetSearchCapabilityRegistry([{
      ...INTERNET_SEARCH_LOCAL_V1_REGISTRATION,
      lifecycle_state: "available",
      health: { state: "healthy", checked_at: "2026-09-01T00:00:00.000Z" },
      safe_message: "Internet Search is available.",
    }]),
    {
      searchExecutor: options.searchExecutor,
      readExecutor: options.readExecutor,
      operationCoordinator: options.operationCoordinator,
      diagnosticsSink: options.diagnosticsSink,
    },
  );
  return app;
}

describe("Internet Search capability discovery gateway route", () => {
  it("returns a safe generic projection for an authorized operation lookup", async () => {
    const app = createApp({ toolAccess: true });
    const response = await app.inject({ method: "GET", url: "/capabilities/web.search@1" });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload).toMatchObject({
      discovery_version: 1,
      operation_id: "web.search@1",
      state: "available",
      callable: true,
      capability: { capability_id: "internet-search" },
      provider_profile: { profile_id: "local-owner-managed" },
    });
    expect(JSON.stringify(payload)).not.toMatch(/searxng|https?:|localhost|127\.|\bport\b|credential|secret|vault|\/home\//i);
  });

  it("does not enumerate provider state for a caller without discovery authority", async () => {
    const app = createApp({ toolAccess: false });
    const response = await app.inject({ method: "GET", url: "/capabilities/web.search@1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      operation_id: "web.search@1",
      state: "unauthorized",
      callable: false,
      capability: null,
      provider_profile: null,
      health: null,
      grant: { required: true, authorized: false },
    });
  });

  it("rejects non-Internet-Search operation IDs at the route boundary", async () => {
    const app = createApp({ toolAccess: true });
    const response = await app.inject({ method: "GET", url: "/capabilities/searxng-local" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_capability_operation" });
  });

  it("gates public discovery on sidecar readiness without projecting provider internals", async () => {
    const statusProvider: InternetSearchCapabilityStatusProvider = {
      snapshot: () => ({
        installed: true,
        enabled: true,
        lifecycle_state: "available",
        health: { state: "healthy", checked_at: "2026-09-01T00:00:00.000Z" },
        safe_message: "Internet Search is available.",
      }),
    };
    const registry = new InternetSearchCapabilityRegistry(undefined, { statusProvider });
    const app = createApp({ toolAccess: true, registry });

    const response = await app.inject({ method: "GET", url: "/capabilities/web.read@1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      operation_id: "web.read@1",
      state: "available",
      callable: true,
      health: { state: "healthy" },
    });
    expect(JSON.stringify(response.json())).not.toMatch(/internet-search-searxng|searxng-local|https?:|localhost|127\.|\bport\b|credential|secret|vault|\/home\//i);
  });

  it("refreshes sidecar health before authorized discovery", async () => {
    let refreshed = false;
    const statusProvider: InternetSearchCapabilityStatusProvider = {
      snapshot: () => ({
        installed: true,
        enabled: true,
        lifecycle_state: refreshed ? "available" : "unavailable",
        health: {
          state: refreshed ? "healthy" : "unhealthy",
          checked_at: refreshed ? "2026-09-01T00:00:01.000Z" : "2026-09-01T00:00:00.000Z",
        },
        safe_message: refreshed ? "Internet Search is available." : "Internet Search needs attention.",
      }),
      refresh: async () => {
        refreshed = true;
        return statusProvider.snapshot();
      },
    };
    const registry = new InternetSearchCapabilityRegistry(undefined, { statusProvider });
    const app = createApp({ toolAccess: true, registry });

    const response = await app.inject({ method: "GET", url: "/capabilities/web.search@1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      operation_id: "web.search@1",
      state: "available",
      callable: true,
      health: { state: "healthy" },
    });
    expect(JSON.stringify(response.json())).not.toMatch(/internet-search-searxng|searxng-local|https?:|localhost|127\.|\bport\b|credential|secret|vault|\/home\//i);
  });

  it("routes web.search@1 calls through a generic executor without exposing provider internals", async () => {
    const searchExecutor: WebSearchExecutor = {
      search: async (request) => ({
        capability: "web.search",
        version: 1,
        request_id: request.request_id,
        run_id: request.run_id,
        status: "success",
        retrieved_at: "2026-09-01T00:00:00.000Z",
        provider: { profile: "local-owner-managed", attribution: "host-mediated-search" },
        usage: { search_call: 1 },
        results: [{
          title: "Example result",
          url: "https://example.test/search",
          snippet: "A generic result.",
          source: "example.test",
          retrieved_at: "2026-09-01T00:00:00.000Z",
          published_at: null,
          updated_at: null,
          freshness: "unknown",
          result_class: "outside-fact",
        }],
        failure: null,
      }),
    };
    const app = createApp({ toolAccess: true, searchExecutor });
    const response = await app.inject({
      method: "POST",
      url: "/capabilities/web.search@1/call",
      payload: {
        request_id: "00000000-0000-4000-8000-000000000501",
        run_id: "00000000-0000-4000-8000-000000000601",
        input: { query: "example", max_results: 1 },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      capability: "web.search",
      version: 1,
      status: "success",
      provider: { profile: "local-owner-managed", attribution: "host-mediated-search" },
      results: [{ result_class: "outside-fact" }],
    });
    expect(JSON.stringify(response.json())).not.toMatch(/internet-search-searxng|searxng-local|localhost|127\.|\bport\b|credential|secret|vault|\/home\//i);
  });

  it("records only allowlisted Search operation diagnostics from gateway calls", async () => {
    const diagnosticsSink = createMemoryInternetSearchDiagnosticSink();
    const searchExecutor: WebSearchExecutor = {
      search: async (request) => ({
        capability: "web.search",
        version: 1,
        request_id: request.request_id,
        run_id: request.run_id,
        status: "success",
        retrieved_at: "2026-09-01T00:00:00.000Z",
        provider: { profile: "local-owner-managed", attribution: "host-mediated-search" },
        usage: { search_call: 1 },
        results: [{
          title: "CANARY_RAW_PROVIDER_TITLE",
          url: "https://example.test/search?token=CANARY_PROVIDER_TOKEN",
          snippet: "CANARY_RAW_QUERY_TEXT owner-private CANARY_OWNER_PRIVATE_DATA",
          source: "example.test",
          retrieved_at: "2026-09-01T00:00:00.000Z",
          published_at: null,
          updated_at: null,
          freshness: "unknown",
          result_class: "outside-fact",
        }],
        failure: null,
      }),
    };
    const app = createApp({ toolAccess: true, searchExecutor, diagnosticsSink });
    const response = await app.inject({
      method: "POST",
      url: "/capabilities/web.search@1/call",
      payload: {
        request_id: "00000000-0000-4000-8000-000000000520",
        run_id: "00000000-0000-4000-8000-000000000620",
        input: {
          query: "CANARY_RAW_QUERY_TEXT",
          endpoint: "http://127.0.0.1:18080/search",
          host_path: "/home/canary/private",
          prompt: "CANARY_PROMPT_IGNORE_POLICY",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(diagnosticsSink.events()).toEqual([expect.objectContaining({
      event_type: "operation",
      operation_id: "web.search@1",
      status: "success",
      result_count: 1,
      completed_item_count: 1,
      duration_ms: expect.any(Number),
    })]);
    expect(JSON.stringify(diagnosticsSink.events())).not.toMatch(/CANARY_|https?:|localhost|127\.0\.0\.1|18080|\bport\b|credential|secret|vault|\/home\/canary|owner-private|prompt/i);
  });

  it("replays exact repeated web.search@1 operations and rejects conflicting reuse without invoking the executor", async () => {
    let calls = 0;
    const searchExecutor: WebSearchExecutor = {
      search: async (request) => {
        calls += 1;
        return {
          capability: "web.search",
          version: 1,
          request_id: request.request_id,
          run_id: request.run_id,
          status: "success",
          retrieved_at: "2026-09-01T00:00:00.000Z",
          provider: { profile: "local-owner-managed", attribution: "host-mediated-search" },
          usage: { search_call: 1 },
          results: [],
          failure: null,
        };
      },
    };
    const app = createApp({ toolAccess: true, searchExecutor });
    const payload = {
      request_id: "00000000-0000-4000-8000-000000000507",
      run_id: "00000000-0000-4000-8000-000000000607",
      input: { query: "example" },
    };

    const first = await app.inject({ method: "POST", url: "/capabilities/web.search@1/call", payload });
    const replay = await app.inject({ method: "POST", url: "/capabilities/web.search@1/call", payload });
    const conflict = await app.inject({
      method: "POST",
      url: "/capabilities/web.search@1/call",
      payload: { ...payload, input: { query: "changed" } },
    });

    expect(first.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(conflict.json()).toMatchObject({
      status: "failure",
      provider: null,
      usage: { search_call: 0 },
      results: [],
      failure: { code: "invalid_request", retryable: false, completed_items: 0 },
    });
    expect(calls).toBe(1);
  });

  it("stops web.search@1 before executor invocation when the run search budget is exhausted", async () => {
    let calls = 0;
    const app = createApp({
      toolAccess: true,
      searchExecutor: {
        search: async (request) => {
          calls += 1;
          return {
            capability: "web.search",
            version: 1,
            request_id: request.request_id,
            run_id: request.run_id,
            status: "success",
            retrieved_at: "2026-09-01T00:00:00.000Z",
            provider: { profile: "local-owner-managed", attribution: "host-mediated-search" },
            usage: { search_call: 1 },
            results: [],
            failure: null,
          };
        },
      },
    });
    const run_id = "00000000-0000-4000-8000-000000000608";

    for (let index = 0; index < 5; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/capabilities/web.search@1/call",
        payload: {
          request_id: `00000000-0000-4000-8000-00000000061${index}`,
          run_id,
          input: { query: `example ${index}` },
        },
      });
      expect(response.json()).toMatchObject({ status: "success" });
    }

    const blocked = await app.inject({
      method: "POST",
      url: "/capabilities/web.search@1/call",
      payload: {
        request_id: "00000000-0000-4000-8000-000000000619",
        run_id,
        input: { query: "over budget" },
      },
    });

    expect(calls).toBe(5);
    expect(blocked.json()).toMatchObject({
      status: "failure",
      provider: null,
      usage: { search_call: 0 },
      results: [],
      failure: { code: "budget_exceeded", retryable: false, completed_items: 0 },
    });
  });

  it("returns a typed not_authorized search envelope without enumerating provider details", async () => {
    let called = false;
    const app = createApp({
      toolAccess: false,
      searchExecutor: {
        search: async (request) => {
          called = true;
          return {
            capability: "web.search",
            version: 1,
            request_id: request.request_id,
            run_id: request.run_id,
            status: "failure",
            retrieved_at: "2026-09-01T00:00:00.000Z",
            provider: null,
            usage: { search_call: 0 },
            results: [],
            failure: { code: "not_authorized", retryable: false, message: "Search authorization is required.", completed_items: 0 },
          };
        },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/capabilities/web.search@1/call",
      payload: {
        request_id: "00000000-0000-4000-8000-000000000502",
        run_id: "00000000-0000-4000-8000-000000000602",
        input: { query: "example" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(called).toBe(false);
    expect(response.json()).toMatchObject({
      status: "failure",
      provider: null,
      results: [],
      failure: { code: "not_authorized", retryable: false, completed_items: 0 },
    });
  });

  it("gates web.search@1 execution when discovery is not callable", async () => {
    let called = false;
    const app = createApp({
      toolAccess: true,
      registry: new InternetSearchCapabilityRegistry([{
        ...INTERNET_SEARCH_LOCAL_V1_REGISTRATION,
        lifecycle_state: "unavailable",
        health: { state: "unhealthy", checked_at: "2026-09-01T00:00:00.000Z" },
        safe_message: "Internet Search needs attention.",
      }]),
      searchExecutor: {
        search: async (request) => {
          called = true;
          return {
            capability: "web.search",
            version: 1,
            request_id: request.request_id,
            run_id: request.run_id,
            status: "success",
            retrieved_at: "2026-09-01T00:00:00.000Z",
            provider: { profile: "local-owner-managed", attribution: "host-mediated-search" },
            usage: { search_call: 1 },
            results: [],
            failure: null,
          };
        },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/capabilities/web.search@1/call",
      payload: {
        request_id: "00000000-0000-4000-8000-000000000504",
        run_id: "00000000-0000-4000-8000-000000000604",
        input: { query: "example" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(called).toBe(false);
    expect(response.json()).toMatchObject({
      status: "unavailable",
      provider: null,
      results: [],
      failure: { code: "provider_unavailable", retryable: true, completed_items: 0 },
    });
  });

  it("routes web.read@1 calls through a generic executor without exposing provider internals", async () => {
    const readExecutor: WebReadExecutor = {
      read: async (request) => ({
        capability: "web.read",
        version: 1,
        request_id: request.request_id,
        run_id: request.run_id,
        status: "success",
        retrieved_at: "2026-09-01T00:00:00.000Z",
        provider: { profile: "local-owner-managed", attribution: "host-fetch" },
        usage: { read_call: 1, bytes_read: 12 },
        result: {
          requested_url: "https://example.test/page",
          canonical_url: "https://example.test/page",
          title: "Example",
          content_type: "text/html",
          content: "Example page",
          truncated: false,
          trust: "external-untrusted",
          result_class: "outside-fact",
          published_at: null,
          updated_at: null,
        },
        failure: null,
      }),
    };
    const app = createApp({ toolAccess: true, readExecutor });
    const response = await app.inject({
      method: "POST",
      url: "/capabilities/web.read@1/call",
      payload: {
        request_id: "00000000-0000-4000-8000-000000000503",
        run_id: "00000000-0000-4000-8000-000000000603",
        input: { url: "https://example.test" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      capability: "web.read",
      version: 1,
      status: "success",
      provider: { profile: "local-owner-managed", attribution: "host-fetch" },
      result: { trust: "external-untrusted", result_class: "outside-fact" },
    });
    expect(JSON.stringify(response.json())).not.toMatch(/internet-search-searxng|searxng-local|localhost|127\.|\bport\b|credential|secret|vault|\/home\//i);
  });

  it("stops web.read@1 before executor invocation when the run read budget is exhausted", async () => {
    let calls = 0;
    const app = createApp({
      toolAccess: true,
      readExecutor: {
        read: async (request) => {
          calls += 1;
          return {
            capability: "web.read",
            version: 1,
            request_id: request.request_id,
            run_id: request.run_id,
            status: "success",
            retrieved_at: "2026-09-01T00:00:00.000Z",
            provider: { profile: "local-owner-managed", attribution: "host-fetch" },
            usage: { read_call: 1, bytes_read: 12 },
            result: {
              requested_url: "https://example.test/page",
              canonical_url: "https://example.test/page",
              title: "Example",
              content_type: "text/html",
              content: "Example page",
              truncated: false,
              trust: "external-untrusted",
              result_class: "outside-fact",
              published_at: null,
              updated_at: null,
            },
            failure: null,
          };
        },
      },
    });
    const run_id = "00000000-0000-4000-8000-000000000609";

    for (let index = 0; index < 5; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/capabilities/web.read@1/call",
        payload: {
          request_id: `00000000-0000-4000-8000-00000000062${index}`,
          run_id,
          input: { url: "https://example.test/page" },
        },
      });
      expect(response.json()).toMatchObject({ status: "success" });
    }

    const blocked = await app.inject({
      method: "POST",
      url: "/capabilities/web.read@1/call",
      payload: {
        request_id: "00000000-0000-4000-8000-000000000629",
        run_id,
        input: { url: "https://example.test/next" },
      },
    });

    expect(calls).toBe(5);
    expect(blocked.json()).toMatchObject({
      status: "failure",
      provider: null,
      usage: { read_call: 0, bytes_read: 0 },
      result: null,
      failure: { code: "budget_exceeded", retryable: false, completed_items: 0 },
    });
  });

  it("returns a typed not_authorized read envelope without invoking the executor", async () => {
    let called = false;
    const app = createApp({
      toolAccess: false,
      readExecutor: {
        read: async (request) => {
          called = true;
          return {
            capability: "web.read",
            version: 1,
            request_id: request.request_id,
            run_id: request.run_id,
            status: "failure",
            retrieved_at: "2026-09-01T00:00:00.000Z",
            provider: null,
            usage: { read_call: 0, bytes_read: 0 },
            result: null,
            failure: { code: "not_authorized", retryable: false, message: "Read authorization is required.", completed_items: 0 },
          };
        },
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/capabilities/web.read@1/call",
      payload: {
        request_id: "00000000-0000-4000-8000-000000000505",
        run_id: "00000000-0000-4000-8000-000000000605",
        input: { url: "https://example.test" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(called).toBe(false);
    expect(response.json()).toMatchObject({
      status: "failure",
      provider: null,
      usage: { read_call: 0, bytes_read: 0 },
      result: null,
      failure: { code: "not_authorized", retryable: false, completed_items: 0 },
    });
  });

  it("gates web.read@1 execution when discovery is not callable", async () => {
    let called = false;
    const app = createApp({
      toolAccess: true,
      registry: new InternetSearchCapabilityRegistry([{
        ...INTERNET_SEARCH_LOCAL_V1_REGISTRATION,
        lifecycle_state: "unavailable",
        health: { state: "unhealthy", checked_at: "2026-09-01T00:00:00.000Z" },
        safe_message: "Internet Search needs attention.",
      }]),
      readExecutor: {
        read: async (request) => {
          called = true;
          return {
            capability: "web.read",
            version: 1,
            request_id: request.request_id,
            run_id: request.run_id,
            status: "success",
            retrieved_at: "2026-09-01T00:00:00.000Z",
            provider: { profile: "local-owner-managed", attribution: "host-fetch" },
            usage: { read_call: 1, bytes_read: 0 },
            result: null,
            failure: null,
          };
        },
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/capabilities/web.read@1/call",
      payload: {
        request_id: "00000000-0000-4000-8000-000000000506",
        run_id: "00000000-0000-4000-8000-000000000606",
        input: { url: "https://example.test" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(called).toBe(false);
    expect(response.json()).toMatchObject({
      status: "unavailable",
      provider: null,
      usage: { read_call: 0, bytes_read: 0 },
      result: null,
      failure: { code: "provider_unavailable", retryable: true, completed_items: 0 },
    });
  });
});
