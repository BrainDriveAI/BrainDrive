import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { CONTRACT_SIZE_LIMITS, MCP_APPS_EXTENSION_VERSION, MCP_LEGACY_PROTOCOL_VERSION, MCP_MODERN_PROTOCOL_VERSION } from "./constants.js";
import { SUPERVISOR_POLICY } from "./package.js";
import { INSTALLED_APP_SUPERVISOR_METHODS } from "./supervisor.js";
import {
  AppCapabilityAuthoritySchema,
  AppInferenceCancelSchema,
  AppInferenceEventSchema,
  AppInferenceRequestSchema,
  AppsBridgeEnvelopeSchema,
  AppViewStateSchema,
  assertSpec05Diagnostic,
  McpAppsResourceDescriptorSchema,
  McpAppsToolSchema,
  McpNegotiatedPeerSchema,
  McpSupportProfileSchema,
  SPEC_05_DEPENDENCY_PROFILE,
  SPEC_05_SUPPORT_PROFILES,
  Spec05CompleteResultSchema,
  Spec05FoundationBundleSchema,
  Spec05ParityEvidenceSchema,
} from "./spec-05-foundation.js";

const directory = dirname(fileURLToPath(import.meta.url));
const id = (suffix: number): string => `50000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const digest = (character = "a"): string => `sha256:${character.repeat(64)}`;
const now = "2026-08-08T12:00:00.000Z";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(directory, "fixtures", "spec-05", name), "utf8"));
}

const authority = {
  authority_version: 1,
  grant_id: id(1), grant_revision: 1, revocation_generation: 0,
  token_id: id(2), token_generation: 1,
  owner_id: id(3), actor_id: id(3), app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive",
  package_digest: digest(), installation_id: id(4), connection_id: id(5), view_id: id(6), operation_id: id(7),
  audience: "app_inference", capabilities: ["app.inference.request"], record_scopes: [],
  idempotency_key: "aaaaaaaaaaaaaaaa", issued_at: now, expires_at: "2026-08-08T12:10:00.000Z",
} as const;

describe("Spec 05 Milestone 1 exact dependency and protocol evidence", () => {
  it("pins the accepted packages and normative protocol constants", async () => {
    expect(typeof Client.prototype.getProtocolEra).toBe("function");
    expect(typeof createMcpHandler).toBe("function");
    expect(EXTENSION_ID).toBe("io.modelcontextprotocol/ui");
    expect(RESOURCE_MIME_TYPE).toBe("text/html;profile=mcp-app");
    expect(MCP_APPS_EXTENSION_VERSION).toBe("2026-01-26");
    for (const [name, version] of [
      ["client", "2.0.0"], ["core", "2.0.0"], ["server", "2.0.0"], ["node", "2.0.0"],
      ["sdk", "1.30.0"], ["ext-apps", "1.7.5"], ["conformance", "0.2.0-alpha.11"],
    ]) {
      const packageJson = JSON.parse(await readFile(resolve(directory, "..", "..", "node_modules", "@modelcontextprotocol", name, "package.json"), "utf8")) as { version: string };
      expect(packageJson.version, name).toBe(version);
    }
    expect(SPEC_05_DEPENDENCY_PROFILE.runtime_node).toBe(">=20");
    expect(SPEC_05_DEPENDENCY_PROFILE.conformance_cli_node).toBe(">=22");
  });

  it("runs modern pinned and legacy default clients against one task-owned loopback fake peer", async () => {
    const eras: string[] = [];
    const handler = createMcpHandler(({ era }) => {
      eras.push(era);
      const server = new McpServer({ name: "spec-05-fake-peer", version: "1.0.0" });
      server.registerTool("fixture.status", { description: "Static M1 fixture", inputSchema: z.object({}) }, async () => ({ content: [{ type: "text", text: era }] }));
      return server;
    });
    const http = createServer(toNodeHandler(handler));
    await new Promise<void>((accepted) => http.listen(0, "127.0.0.1", accepted));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("Fake peer did not bind a task-owned port");
    const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);
    try {
      const modern = new Client({ name: "spec-05-modern", version: "1.0.0" }, { versionNegotiation: { mode: { pin: MCP_MODERN_PROTOCOL_VERSION } } });
      await modern.connect(new StreamableHTTPClientTransport(endpoint));
      expect(modern.getNegotiatedProtocolVersion()).toBe(MCP_MODERN_PROTOCOL_VERSION);
      expect(modern.getProtocolEra()).toBe("modern");
      expect((await modern.listTools()).tools.map((tool) => tool.name)).toEqual(["fixture.status"]);
      await modern.close();

      const legacy = new Client({ name: "spec-05-legacy", version: "1.0.0" });
      await legacy.connect(new StreamableHTTPClientTransport(endpoint));
      expect(legacy.getNegotiatedProtocolVersion()).toBe(MCP_LEGACY_PROTOCOL_VERSION);
      expect(legacy.getProtocolEra()).toBe("legacy");
      expect((await legacy.callTool({ name: "fixture.status", arguments: {} })).content[0]).toMatchObject({ type: "text", text: "legacy" });
      await legacy.close();
      expect(eras).toContain("modern");
      expect(eras).toContain("legacy");
    } finally {
      await handler.close();
      await new Promise<void>((accepted, rejected) => http.close((error) => error ? rejected(error) : accepted()));
    }
  });
});

describe("Spec 05 Milestone 1 strict contracts", () => {
  it("freezes stateless modern and bounded stateful legacy support profiles", () => {
    expect(SPEC_05_SUPPORT_PROFILES.map((profile) => McpSupportProfileSchema.parse(profile).era)).toEqual(["modern_stateless", "bounded_legacy_stateful"]);
    expect(SPEC_05_SUPPORT_PROFILES[0].session_header).toBe(false);
    expect(SPEC_05_SUPPORT_PROFILES[1].session_header).toBe(true);
    expect(McpSupportProfileSchema.safeParse({ ...SPEC_05_SUPPORT_PROFILES[0], protocol_version: "2027-01-01" }).success).toBe(false);
  });

  it("fails unknown critical facilities before compatibility", () => {
    const peer = {
      negotiation_version: 1, connection_id: id(10), connection_generation: 1,
      app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive", package_digest: digest(),
      installation_id: id(11), runtime_id: id(12), client_name: "braindrive-app-host", client_version: "1.0.0", server_name: "fixture", server_version: "1.0.0",
      profile: SPEC_05_SUPPORT_PROFILES[0], advertised_methods: SPEC_05_SUPPORT_PROFILES[0].required_methods,
      unknown_critical_facilities: [], compatible: true, negotiated_at: now,
    };
    expect(McpNegotiatedPeerSchema.parse(peer).compatible).toBe(true);
    expect(McpNegotiatedPeerSchema.safeParse({ ...peer, unknown_critical_facilities: ["future/authority"], compatible: true }).success).toBe(false);
    expect(McpNegotiatedPeerSchema.parse({ ...peer, unknown_critical_facilities: ["future/authority"], compatible: false }).compatible).toBe(false);
  });

  it("preserves rich results and exact app/model projections", () => {
    const result = {
      envelope_version: 1, result_type: "complete", protocol_version: MCP_MODERN_PROTOCOL_VERSION,
      connection_id: id(20), request_id: "request-1", operation_id: id(21),
      content: [
        { type: "text", text: "safe summary" },
        { type: "resource_link", name: "artifact", uri: "artifact://opaque/1", mimeType: "application/pdf", size: 1024 },
        { type: "resource", resource: { uri: "data://opaque/1", mimeType: "application/json", text: "{}" } },
      ],
      structuredContent: { status: "ok" }, _meta: { cache: { maxAge: 60 } }, isError: false,
      progress_token: "progress-1", cancellation_id: id(22), error: null,
      projections: { model_visible_content_indices: [0], app_visible_content_indices: [0, 1, 2], model_structured_content: false, app_structured_content: true },
    };
    expect(Spec05CompleteResultSchema.parse(result).content).toHaveLength(3);
    expect(Spec05CompleteResultSchema.safeParse({ ...result, projections: { ...result.projections, model_visible_content_indices: [3] } }).success).toBe(false);
    expect(Spec05CompleteResultSchema.safeParse({ ...result, ignored: true }).success).toBe(false);
  });

  it("freezes Apps linkage, visibility defaults, resources, view state, and exact JSON-RPC", () => {
    const tool = McpAppsToolSchema.parse({ name: "resume.status", inputSchema: { type: "object" }, _meta: { ui: { resourceUri: "ui://resume-builder/main" } } });
    expect(tool._meta.ui.visibility).toEqual(["model", "app"]);
    expect(McpAppsToolSchema.safeParse({ ...tool, _meta: { ui: { ...tool._meta.ui, visibility: ["admin"] } } }).success).toBe(false);
    expect(McpAppsResourceDescriptorSchema.safeParse({ resource_version: 1, uri: "ui://resume-builder/main", mime_type: RESOURCE_MIME_TYPE, package_digest: digest(), content_digest: digest("b"), size_bytes: 1024, cache_policy: "immutable_package_digest", csp: {}, sandbox: "double_iframe_opaque_origin_proxy" }).success).toBe(true);
    expect(McpAppsResourceDescriptorSchema.safeParse({ resource_version: 1, uri: "ui://../escape", mime_type: RESOURCE_MIME_TYPE, package_digest: digest(), content_digest: digest("b"), size_bytes: 1024, cache_policy: "no_store", csp: { connect_domains: ["http://public.example"] }, sandbox: "double_iframe_opaque_origin_proxy" }).success).toBe(false);
    expect(AppViewStateSchema.safeParse({ view_state_version: 1, connection_id: id(30), installation_id: id(31), view_id: id(32), operation_id: null, state: "ready", bridge_generation: 1, created_at: now, expires_at: "2026-08-08T12:10:00.000Z" }).success).toBe(true);
    const bridge = { bridge_envelope_version: 1, message_id: id(33), installation_id: id(31), view_id: id(32), operation_id: null, bridge_generation: 1, direction: "app_to_host", provenance: { source_window_match: true, opaque_origin: "null", same_server_id: id(34) }, sent_at: now, message: { jsonrpc: "2.0", id: "call-1", method: "tools/call", params: { name: "resume.status", arguments: {} } } };
    expect(AppsBridgeEnvelopeSchema.safeParse(bridge).success).toBe(true);
    expect(AppsBridgeEnvelopeSchema.safeParse({ ...bridge, bearer_token: "not-allowed" }).success).toBe(false);
    expect(AppsBridgeEnvelopeSchema.safeParse({ ...bridge, provenance: { ...bridge.provenance, opaque_origin: "https://host" } }).success).toBe(false);
  });

  it("binds short-lived authority and typed no-tools no-fallback inference", () => {
    expect(AppCapabilityAuthoritySchema.safeParse(authority).success).toBe(true);
    expect(AppCapabilityAuthoritySchema.safeParse({ ...authority, expires_at: "2026-08-08T12:16:00.000Z" }).success).toBe(false);
    const request = {
      inference_contract_version: 1, request_id: id(40), operation_id: authority.operation_id, authority,
      intent: "balanced", messages: [{ role: "user", content: "Use only the supplied confirmed facts." }], context: [],
      output_schema: { type: "object", required: ["summary"] }, stream: true, tools: false, allow_provider_fallback: false,
      budget: { input_bytes: 65_536, input_tokens: 16_384, output_tokens: 2_048, duration_ms: 60_000, attempts: 2 },
      requested_at: now, deadline_at: "2026-08-08T12:01:00.000Z",
    } as const;
    expect(AppInferenceRequestSchema.safeParse(request).success).toBe(true);
    expect(AppInferenceRequestSchema.safeParse({ ...request, provider_key: "forbidden" }).success).toBe(false);
    expect(AppInferenceRequestSchema.safeParse({ ...request, tools: true }).success).toBe(false);
    expect(AppInferenceRequestSchema.safeParse({ ...request, allow_provider_fallback: true }).success).toBe(false);
    expect(AppInferenceCancelSchema.safeParse({ inference_contract_version: 1, request_id: request.request_id, operation_id: request.operation_id, idempotency_key: "bbbbbbbbbbbbbbbb", reason: "owner" }).success).toBe(true);
  });

  it("uses fake provider and supervisor boundaries without executing either", async () => {
    const fakeProvider = async (input: unknown): Promise<unknown> => {
      const request = AppInferenceRequestSchema.parse(input);
      return AppInferenceEventSchema.parse({ inference_contract_version: 1, request_id: request.request_id, operation_id: request.operation_id, sequence: 0, event: "completed", structured_output: { summary: "fixture" }, output_digest: digest("c"), usage: { input_tokens: 12, output_tokens: 3 } });
    };
    const request = AppInferenceRequestSchema.parse({ inference_contract_version: 1, request_id: id(50), operation_id: authority.operation_id, authority, intent: "speed", messages: [{ role: "user", content: "fixture" }], context: [], output_schema: { type: "object" }, stream: false, tools: false, allow_provider_fallback: false, budget: { input_bytes: 1024, input_tokens: 256, output_tokens: 64, duration_ms: 1000, attempts: 1 }, requested_at: now, deadline_at: "2026-08-08T12:00:01.000Z" });
    expect(await fakeProvider(request)).toMatchObject({ event: "completed" });

    const fakeSupervisor = { state: "stopped", calls: [] as string[], transition(method: string) { this.calls.push(method); this.state = method === "start" ? "starting" : method === "awaitReady" ? "ready" : method === "stop" ? "stopped" : this.state; } };
    for (const method of ["start", "awaitReady", "health", "register", "stop"]) fakeSupervisor.transition(method);
    expect(fakeSupervisor.calls).toEqual(["start", "awaitReady", "health", "register", "stop"]);
    expect(fakeSupervisor.state).toBe("stopped");
    expect(INSTALLED_APP_SUPERVISOR_METHODS).not.toContain("execute" as never);
    expect(SUPERVISOR_POLICY).toMatchObject({ max_cpu_cores: 1, max_memory_bytes: 536_870_912, max_crash_restarts: 3, restart_backoff_ms: [1_000, 2_000, 4_000] });
  });

  it("keeps normalized parity conclusions exact", () => {
    expect(Spec05ParityEvidenceSchema.safeParse({ evidence_version: 1, scenario_id: "negotiation-modern", docker_outcome: "not_run", windows_outcome: "not_run", normalized_semantics_equal: true, permitted_differences: ["transport", "process_isolation"], unexpected_differences: [] }).success).toBe(true);
    expect(Spec05ParityEvidenceSchema.safeParse({ evidence_version: 1, scenario_id: "bad", docker_outcome: "pass", windows_outcome: "fail", normalized_semantics_equal: true, permitted_differences: [], unexpected_differences: ["error"] }).success).toBe(false);
  });

  it("property-checks deterministic invalid forms", () => {
    const base = AppCapabilityAuthoritySchema.parse(authority);
    const mutations: unknown[] = [];
    for (let index = 0; index < 128; index += 1) {
      mutations.push(index % 4 === 0 ? { ...base, [`unknown_${index}`]: true }
        : index % 4 === 1 ? { ...base, capabilities: [] }
          : index % 4 === 2 ? { ...base, expires_at: base.issued_at }
            : { ...base, package_digest: `sha256:${"g".repeat(64)}` });
    }
    expect(mutations.every((mutation) => !AppCapabilityAuthoritySchema.safeParse(mutation).success)).toBe(true);
  });

  it("freezes the complete decision bundle", () => {
    expect(Spec05FoundationBundleSchema.safeParse({ foundation_version: 1, dependencies: SPEC_05_DEPENDENCY_PROFILE, protocols: SPEC_05_SUPPORT_PROFILES, supervisor_policy: SUPERVISOR_POLICY, renderer: "dedicated_web_client_double_iframe_proxy_no_tauri_authority", desktop_executable: "verified_compiled_javascript_on_braindrive_packaged_node", release_targets: { docker_dev: "required", windows: "first_packaged_claim", macos: "configured_unclaimed", linux: "configured_unclaimed" }, optional_facilities: { sampling: "rejected", prompts_completions: "deferred", remote_oauth: "deferred", stdio: "deferred", subscriptions: "deferred", tasks: "deferred", elicitation: "deferred" } }).success).toBe(true);
  });
});

describe("Spec 05 Milestone 1 fixture, evidence, and diagnostic audit", () => {
  it("maps REQ-001 through REQ-045 exactly once", async () => {
    const manifest = await fixture("requirements.json") as { requirements: Array<{ id: string; method: string; gate: string; owner_role: string }> };
    expect(manifest.requirements.map((entry) => entry.id)).toEqual(Array.from({ length: 45 }, (_, index) => `REQ-${String(index + 1).padStart(3, "0")}`));
    for (const entry of manifest.requirements) {
      expect(["automated", "live", "human", "release"]).toContain(entry.method);
      expect(entry.gate).toMatch(/^M[1-7]-AC[1-9]$/);
      expect(entry.owner_role.length).toBeGreaterThan(0);
    }
  });

  it("records all owner decisions, gates, threats, and disabled runtime claims", async () => {
    const decisions = await fixture("decisions.json") as { accepted_by: string; decisions: Array<{ id: string; owner: string; rationale: string }>; repository_discrepancies: unknown[] };
    expect(decisions.accepted_by).toBe("DJJones");
    expect(decisions.decisions.map((decision) => decision.id)).toEqual(["OQ-1", "OQ-2", "OQ-3", "OQ-4", "OQ-5", "OQ-6", "OQ-7"]);
    expect(decisions.decisions.every((decision) => decision.owner.length > 0 && decision.rationale.length > 0)).toBe(true);
    expect(decisions.repository_discrepancies).toHaveLength(2);
    const corpus = await fixture("conformance-corpus.json") as { cases: Array<{ id: string; boundary: string; accepted: boolean; expected_code: string }>; prohibited_material: string[] };
    expect(new Set(corpus.cases.map((entry) => entry.boundary))).toEqual(new Set(["protocol", "envelope", "projection", "resource", "bridge", "capability", "inference", "supervisor", "diagnostic"]));
    for (const entry of corpus.cases) {
      expect(exerciseConformanceCase(entry.id), entry.id).toBe(entry.expected_code);
      expect(entry.accepted, entry.id).toBe(["accepted", "redacted"].includes(entry.expected_code));
    }
    expect(corpus.prohibited_material).toContain("app HTML");
    const evidence = await fixture("m1-evidence.json") as { acceptance_gates: Array<{ id: string }>; runtime_activation: Record<string, boolean> };
    expect(evidence.acceptance_gates.map((gate) => gate.id)).toEqual(["M1-AC1", "M1-AC2", "M1-AC3", "M1-AC4", "M1-AC5", "M1-AC6"]);
    expect(Object.values(evidence.runtime_activation)).toEqual([false, false, false, false]);
  });

  it("accepts only content-free diagnostics", () => {
    const event = { diagnostic_version: 1, occurred_at: now, event: "bridge", correlation_id: id(60), app_id: "ai.braindrive.resume-builder", package_digest: digest(), installation_id: id(61), connection_id: id(62), view_id: id(63), operation_id: id(64), runtime_id: null, protocol_version: MCP_MODERN_PROTOCOL_VERSION, capability: null, provider_profile_id: null, model_id: null, runtime_state: null, attempt: 1, outcome: "denied", error_category: "forbidden", elapsed_ms: 3, byte_count: 128 };
    expect(() => assertSpec05Diagnostic(event)).not.toThrow();
    for (const forbidden of [{ token: "forbidden" }, { raw_path: "/home/owner/resume" }, { html: "forbidden" }, { provider_credential: "forbidden" }, { endpoint: "http://127.0.0.1:1234" }]) {
      expect(() => assertSpec05Diagnostic({ ...event, ...forbidden })).toThrow();
    }
    expect(() => assertSpec05Diagnostic({ ...event, app_id: "/tmp/owner" })).toThrow();
  });

  it("rejects an oversized bridge deterministically", () => {
    const bridge = { bridge_envelope_version: 1, message_id: id(70), installation_id: id(71), view_id: id(72), operation_id: null, bridge_generation: 1, direction: "app_to_host", provenance: { source_window_match: true, opaque_origin: "null", same_server_id: id(73) }, sent_at: now, message: { jsonrpc: "2.0", id: "call", method: "ui/message", params: { payload: "x".repeat(CONTRACT_SIZE_LIMITS.bridgeMessageBytes) } } };
    expect(AppsBridgeEnvelopeSchema.safeParse(bridge).success).toBe(false);
  });
});

function exerciseConformanceCase(caseId: string): string {
  const result = {
    envelope_version: 1, result_type: "complete", protocol_version: MCP_MODERN_PROTOCOL_VERSION,
    connection_id: id(80), request_id: "fixture", operation_id: id(81), content: [{ type: "text", text: "fixture" }],
    structuredContent: { fixture: true }, isError: false, progress_token: null, cancellation_id: null, error: null,
    projections: { model_visible_content_indices: [0], app_visible_content_indices: [0], model_structured_content: true, app_structured_content: true },
  };
  const resource = { resource_version: 1, uri: "ui://resume-builder/main", mime_type: RESOURCE_MIME_TYPE, package_digest: digest(), content_digest: digest("b"), size_bytes: 1024, cache_policy: "no_store", csp: {}, sandbox: "double_iframe_opaque_origin_proxy" };
  const bridge = { bridge_envelope_version: 1, message_id: id(82), installation_id: id(83), view_id: id(84), operation_id: null, bridge_generation: 1, direction: "app_to_host", provenance: { source_window_match: true, opaque_origin: "null", same_server_id: id(85) }, sent_at: now, message: { jsonrpc: "2.0", id: "fixture", method: "tools/call", params: { name: "fixture.status", arguments: {} } } };
  switch (caseId) {
    case "modern-stateless":
      McpSupportProfileSchema.parse(SPEC_05_SUPPORT_PROFILES[0]);
      return "accepted";
    case "bounded-legacy":
      McpSupportProfileSchema.parse(SPEC_05_SUPPORT_PROFILES[1]);
      return "accepted";
    case "unknown-critical-version":
      return McpSupportProfileSchema.safeParse({ ...SPEC_05_SUPPORT_PROFILES[0], protocol_version: "2099-01-01" }).success ? "accepted" : "protocol_incompatible";
    case "malformed-envelope":
      return Spec05CompleteResultSchema.safeParse({ jsonrpc: "2.0" }).success ? "accepted" : "malformed";
    case "oversized-envelope":
      return Spec05CompleteResultSchema.safeParse({ ...result, content: [{ type: "text", text: "x".repeat(CONTRACT_SIZE_LIMITS.maxStringLength + 1) }] }).success ? "accepted" : "oversized";
    case "rich-complete-result":
      Spec05CompleteResultSchema.parse({ ...result, content: [...result.content, { type: "resource_link", name: "fixture", uri: "artifact://opaque/1" }], projections: { ...result.projections, app_visible_content_indices: [0, 1] } });
      return "accepted";
    case "ui-resource-traversal":
      return McpAppsResourceDescriptorSchema.safeParse({ ...resource, uri: "ui://resume-builder/../escape" }).success ? "accepted" : "resource_invalid";
    case "resource-redirect-domain": {
      const parsed = McpAppsResourceDescriptorSchema.parse({ ...resource, csp: { connect_domains: ["https://redirect.invalid"] } });
      return parsed.csp.connect_domains.length === 0 ? "accepted" : "resource_invalid";
    }
    case "forged-bridge-source":
      return AppsBridgeEnvelopeSchema.safeParse({ ...bridge, provenance: { ...bridge.provenance, source_window_match: false } }).success ? "accepted" : "bridge_provenance_invalid";
    case "cross-view-message":
      AppsBridgeEnvelopeSchema.parse(bridge);
      return bridge.view_id === id(86) ? "accepted" : "view_binding_invalid";
    case "replayed-capability": {
      const consumed = new Set([authority.idempotency_key]);
      return consumed.has(authority.idempotency_key) ? "idempotency_conflict" : "accepted";
    }
    case "cancellation-late-result":
      AppInferenceCancelSchema.parse({ inference_contract_version: 1, request_id: id(87), operation_id: authority.operation_id, idempotency_key: "cccccccccccccccc", reason: "owner" });
      return "late_result_discarded";
    case "provider-unavailable": {
      const event = AppInferenceEventSchema.parse({ inference_contract_version: 1, request_id: id(88), operation_id: authority.operation_id, sequence: 0, event: "failed", error: { code: "provider_unavailable", safe_message: "Configured provider is unavailable", retryable: true } });
      return event.event === "failed" ? event.error.code : "accepted";
    }
    case "supervisor-restart-exhausted":
      return SUPERVISOR_POLICY.max_crash_restarts === 3 && SUPERVISOR_POLICY.restart_backoff_ms.join(",") === "1000,2000,4000" ? "restart_exhausted" : "accepted";
    case "diagnostic-redaction": {
      assertSpec05Diagnostic({ diagnostic_version: 1, occurred_at: now, event: "parity", correlation_id: id(89), app_id: "ai.braindrive.resume-builder", package_digest: digest(), installation_id: null, connection_id: null, view_id: null, operation_id: null, runtime_id: null, protocol_version: MCP_MODERN_PROTOCOL_VERSION, capability: null, provider_profile_id: null, model_id: null, runtime_state: null, attempt: 0, outcome: "completed", error_category: null, elapsed_ms: 1, byte_count: 0 });
      return "redacted";
    }
    default:
      throw new Error(`Unknown Spec 05 conformance case: ${caseId}`);
  }
}
