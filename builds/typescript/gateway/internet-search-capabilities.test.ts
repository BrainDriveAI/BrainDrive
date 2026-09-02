import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import type { PermissionSet } from "../contracts.js";
import {
  createInternetSearchProviderRuntime,
  INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
  type InternetSearchProviderRuntime,
} from "../internet-search/provider-package.js";
import { registerInternetSearchCapabilityRoutes } from "../internet-search/routes.js";
import { createMemoryInternetSearchDiagnosticSink } from "../internet-search/diagnostics.js";
import { InternetSearchOperationCoordinator } from "../internet-search/operation-metadata.js";
import type { InternetSearchRouteCapabilityRegistry } from "../internet-search/routes.js";
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

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createApp(options: {
  toolAccess: boolean;
  capabilityRegistry?: InternetSearchRouteCapabilityRegistry;
  searchExecutor?: WebSearchExecutor | null;
  readExecutor?: WebReadExecutor | null;
  operationCoordinator?: InternetSearchOperationCoordinator;
  diagnosticsSink?: ReturnType<typeof createMemoryInternetSearchDiagnosticSink>;
  afterRuntime?: (runtime: InternetSearchProviderRuntime) => Promise<void>;
  withShim?: boolean;
}) {
  const app = Fastify({ logger: false });
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-sc005-gateway-"));
  roots.push(root);
  const runtime = await createInternetSearchProviderRuntime({
    rootDir: process.cwd(),
    memoryRoot: path.join(root, "memory"),
    stateRoot: path.join(root, "state"),
    env: options.withShim === false ? {} : {
      BRAINDRIVE_INTERNET_SEARCH_SIDECAR_URL: "http://internet-search-searxng:8080",
      BRAINDRIVE_INTERNET_SEARCH_HEALTH_TIMEOUT_MS: "25",
      BRAINDRIVE_INTERNET_SEARCH_STARTUP_TIMEOUT_MS: "25",
      BRAINDRIVE_INTERNET_SEARCH_READINESS_POLL_MS: "1",
    },
    fetchImpl: async () => new Response("ok", { status: 200 }),
    searchExecutor: options.searchExecutor ?? null,
    readExecutor: options.readExecutor ?? null,
  });
  await options.afterRuntime?.(runtime);
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
    options.capabilityRegistry ?? runtime.capabilityRegistry,
    {
      operationRouter: runtime.operationRouter,
      operationCoordinator: options.operationCoordinator,
      diagnosticsSink: options.diagnosticsSink,
    },
  );
  return app;
}

describe("Internet Search capability discovery gateway route", () => {
  it("returns a safe generic projection for an authorized operation lookup", async () => {
    const app = await createApp({ toolAccess: true });
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
    const app = await createApp({ toolAccess: false });
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
    const app = await createApp({ toolAccess: true });
    const response = await app.inject({ method: "GET", url: "/capabilities/searxng-local" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_capability_operation" });
  });

  it("gates public discovery on sidecar readiness without projecting provider internals", async () => {
    const app = await createApp({ toolAccess: true });

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
    const capabilityRegistry: InternetSearchRouteCapabilityRegistry = {
      refresh: async () => {
        refreshed = true;
      },
      discover: async (operationId, options) => ({
        discovery_version: 1,
        operation_id: operationId,
        state: options.authorized && refreshed ? "available" : "unavailable",
        callable: options.authorized && refreshed,
        capability: options.authorized ? {
          capability_id: "internet-search",
          version: "1.0.0",
          operations: [
            { operation_id: "web.search@1", capability: "web.search", version: 1 },
            { operation_id: "web.read@1", capability: "web.read", version: 1 },
          ],
        } : null,
        provider_profile: options.authorized ? {
          profile_id: "local-owner-managed",
          display_name: "Local Internet Search",
          management: "owner_managed_local",
          billing: "none",
          disclosure: {
            last_reviewed_at: "2026-09-01T00:00:00.000Z",
            summary: "Use is mediated by the local owner-managed Internet Search provider package.",
          },
        } : null,
        health: options.authorized ? { state: refreshed ? "healthy" : "unhealthy", checked_at: "2026-09-01T00:00:01.000Z" } : null,
        grant: { required: true, authorized: options.authorized },
        message: refreshed ? "Internet Search is available." : "Internet Search is unavailable.",
      }),
    };
    const app = await createApp({ toolAccess: true, capabilityRegistry });

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
    const app = await createApp({ toolAccess: true, searchExecutor });
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
    const app = await createApp({ toolAccess: true, searchExecutor, diagnosticsSink });
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
      provider_execution: "executed",
      result_count: 1,
      completed_item_count: 1,
      duration_ms: expect.any(Number),
    })]);
    expect(JSON.stringify(diagnosticsSink.events())).not.toMatch(/CANARY_|https?:|localhost|127\.0\.0\.1|18080|\bport\b|credential|secret|vault|\/home\/canary|owner-private|prompt/i);
  });

  it("records not-executed diagnostics for pre-provider authorization and budget failures", async () => {
    const unauthorizedDiagnostics = createMemoryInternetSearchDiagnosticSink();
    let unauthorizedCalled = false;
    const unauthorizedApp = await createApp({
      toolAccess: false,
      diagnosticsSink: unauthorizedDiagnostics,
      searchExecutor: {
        search: async (request) => {
          unauthorizedCalled = true;
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
    await unauthorizedApp.inject({
      method: "POST",
      url: "/capabilities/web.search@1/call",
      payload: {
        request_id: "00000000-0000-4000-8000-000000000521",
        run_id: "00000000-0000-4000-8000-000000000621",
        input: {
          query: "CANARY_RAW_QUERY_TEXT",
          token: "CANARY_BEARER_TOKEN",
          host_path: "/home/canary/private",
        },
      },
    });
    expect(unauthorizedCalled).toBe(false);
    expect(unauthorizedDiagnostics.events()).toEqual([expect.objectContaining({
      event_type: "operation",
      operation_id: "web.search@1",
      status: "failure",
      failure_code: "not_authorized",
      provider_execution: "not_executed",
      result_count: 0,
      completed_item_count: 0,
      usage: { call_count: 0, bytes_class: null },
    })]);

    const budgetDiagnostics = createMemoryInternetSearchDiagnosticSink();
    let budgetCalls = 0;
    const budgetApp = await createApp({
      toolAccess: true,
      diagnosticsSink: budgetDiagnostics,
      searchExecutor: {
        search: async (request) => {
          budgetCalls += 1;
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
    const run_id = "00000000-0000-4000-8000-000000000622";
    for (let index = 0; index < 6; index += 1) {
      await budgetApp.inject({
        method: "POST",
        url: "/capabilities/web.search@1/call",
        payload: {
          request_id: `00000000-0000-4000-8000-00000000063${index}`,
          run_id,
          input: { query: `example ${index}` },
        },
      });
    }

    expect(budgetCalls).toBe(5);
    expect(budgetDiagnostics.events().at(-1)).toMatchObject({
      event_type: "operation",
      operation_id: "web.search@1",
      status: "failure",
      failure_code: "budget_exceeded",
      provider_execution: "not_executed",
      result_count: 0,
      completed_item_count: 0,
      usage: { call_count: 0, bytes_class: null },
    });
    expect(JSON.stringify([unauthorizedDiagnostics.events(), budgetDiagnostics.events()])).not.toMatch(/CANARY_|https?:|localhost|127\.0\.0\.1|18080|\bport\b|credential|secret|vault|\/home\/canary|owner-private|prompt|authorization|bearer|token/i);
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
    const app = await createApp({ toolAccess: true, searchExecutor });
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
    const app = await createApp({
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
    const app = await createApp({
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
    const app = await createApp({
      toolAccess: true,
      withShim: false,
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
    const app = await createApp({ toolAccess: true, readExecutor });
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
    const app = await createApp({
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
    const app = await createApp({
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
    const app = await createApp({
      toolAccess: true,
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
      afterRuntime: async (runtime) => {
        await runtime.packageStore.disablePackage(
          INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
          "2026-09-01T00:00:00.000Z",
        );
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
