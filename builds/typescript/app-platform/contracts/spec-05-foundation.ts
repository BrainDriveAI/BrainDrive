import { z } from "zod";

import {
  NonEmptyStringSchema,
  OpaqueIdSchema,
  SemverSchema,
  Sha256DigestSchema,
  TimestampSchema,
  encodedByteLength,
} from "./common.js";
import {
  CONTRACT_SIZE_LIMITS,
  MCP_APPS_EXTENSION_ID,
  MCP_APPS_EXTENSION_VERSION,
  MCP_APP_MEDIA_TYPE,
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSION,
} from "./constants.js";
import { McpContentBlockSchema } from "./mcp-app.js";
import { CapabilityNameSchema, SupervisorPolicySchema } from "./package.js";
import { ContractViolation } from "./errors.js";
import { InferenceErrorSchema, InferenceOutcomeMetadataSchema } from "./inference.js";

export const SPEC_05_FOUNDATION_VERSION = 1 as const;

export const Spec05DependencyProfileSchema = z.object({
  profile_version: z.literal(1),
  modern_client: z.literal("@modelcontextprotocol/client@2.0.0"),
  modern_core: z.literal("@modelcontextprotocol/core@2.0.0"),
  fake_peer_server: z.literal("@modelcontextprotocol/server@2.0.0"),
  node_transport: z.literal("@modelcontextprotocol/node@2.0.0"),
  legacy_sdk: z.literal("@modelcontextprotocol/sdk@1.30.0"),
  apps_sdk: z.literal("@modelcontextprotocol/ext-apps@1.7.5"),
  conformance: z.literal("@modelcontextprotocol/conformance@0.2.0-alpha.11"),
  runtime_node: z.literal(">=20"),
  conformance_cli_node: z.literal(">=22"),
}).strict();

export const SPEC_05_DEPENDENCY_PROFILE = Spec05DependencyProfileSchema.parse({
  profile_version: 1,
  modern_client: "@modelcontextprotocol/client@2.0.0",
  modern_core: "@modelcontextprotocol/core@2.0.0",
  fake_peer_server: "@modelcontextprotocol/server@2.0.0",
  node_transport: "@modelcontextprotocol/node@2.0.0",
  legacy_sdk: "@modelcontextprotocol/sdk@1.30.0",
  apps_sdk: "@modelcontextprotocol/ext-apps@1.7.5",
  conformance: "@modelcontextprotocol/conformance@0.2.0-alpha.11",
  runtime_node: ">=20",
  conformance_cli_node: ">=22",
});

export const McpSupportProfileSchema = z.discriminatedUnion("era", [
  z.object({
    profile_version: z.literal(1),
    era: z.literal("modern_stateless"),
    protocol_version: z.literal(MCP_MODERN_PROTOCOL_VERSION),
    negotiation: z.literal("version_negotiation_and_optional_server_discover"),
    session_header: z.literal(false),
    required_methods: z.tuple([
      z.literal("tools/list"), z.literal("tools/call"), z.literal("resources/list"),
      z.literal("resources/templates/list"), z.literal("resources/read"),
    ]),
    apps: z.object({ id: z.literal(MCP_APPS_EXTENSION_ID), version: z.literal(MCP_APPS_EXTENSION_VERSION) }).strict(),
  }).strict(),
  z.object({
    profile_version: z.literal(1),
    era: z.literal("bounded_legacy_stateful"),
    protocol_version: z.literal(MCP_LEGACY_PROTOCOL_VERSION),
    negotiation: z.literal("initialize_initialized"),
    session_header: z.literal(true),
    required_methods: z.tuple([z.literal("tools/list"), z.literal("tools/call")]),
    apps: z.literal(null),
  }).strict(),
]);

export const SPEC_05_SUPPORT_PROFILES = [
  {
    profile_version: 1, era: "modern_stateless", protocol_version: MCP_MODERN_PROTOCOL_VERSION,
    negotiation: "version_negotiation_and_optional_server_discover", session_header: false,
    required_methods: ["tools/list", "tools/call", "resources/list", "resources/templates/list", "resources/read"],
    apps: { id: MCP_APPS_EXTENSION_ID, version: MCP_APPS_EXTENSION_VERSION },
  },
  {
    profile_version: 1, era: "bounded_legacy_stateful", protocol_version: MCP_LEGACY_PROTOCOL_VERSION,
    negotiation: "initialize_initialized", session_header: true,
    required_methods: ["tools/list", "tools/call"], apps: null,
  },
] as const;

const UiResourceUriSchema = z.string()
  .regex(/^ui:\/\/[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/)
  .max(2_048)
  .refine((value) => {
    const path = value.slice("ui://".length);
    return !path.includes("\\") && !path.includes("//") && !/(?:^|\/)\.\.(?:\/|$)/.test(path) && !/%2e|%2f|%5c/i.test(path);
  }, "ui resource URI must be canonical and traversal-free");

export const McpNegotiatedPeerSchema = z.object({
  negotiation_version: z.literal(1),
  connection_id: OpaqueIdSchema,
  connection_generation: z.number().int().positive(),
  app_id: NonEmptyStringSchema,
  publisher_id: NonEmptyStringSchema,
  package_digest: Sha256DigestSchema,
  installation_id: OpaqueIdSchema,
  runtime_id: OpaqueIdSchema,
  client_name: NonEmptyStringSchema,
  client_version: SemverSchema,
  server_name: NonEmptyStringSchema,
  server_version: SemverSchema,
  profile: McpSupportProfileSchema,
  advertised_methods: z.array(z.string().min(1).max(128)).max(64),
  unknown_critical_facilities: z.array(z.string().min(1).max(128)).max(16),
  compatible: z.boolean(),
  negotiated_at: TimestampSchema,
}).strict().superRefine((value, context) => {
  const required = new Set(value.profile.required_methods);
  const advertised = new Set(value.advertised_methods);
  if (value.compatible !== ([...required].every((method) => advertised.has(method)) && value.unknown_critical_facilities.length === 0)) {
    context.addIssue({ code: "custom", message: "compatibility does not match required and unknown critical facilities" });
  }
});

export const Spec05ProtocolErrorSchema = z.object({
  category: z.enum(["incompatible", "malformed", "oversized", "unauthorized", "forbidden", "not_found", "conflict", "cancelled", "timeout", "unavailable", "internal"]),
  protocol_code: z.number().int().nullable(),
  safe_message: z.string().min(1).max(512),
  retryable: z.boolean(),
}).strict();

export const Spec05CompleteResultSchema = z.object({
  envelope_version: z.literal(1),
  result_type: z.literal("complete"),
  protocol_version: z.enum([MCP_MODERN_PROTOCOL_VERSION, MCP_LEGACY_PROTOCOL_VERSION]),
  connection_id: OpaqueIdSchema,
  request_id: z.union([z.string().min(1).max(256), z.number().int()]),
  operation_id: OpaqueIdSchema,
  content: z.array(McpContentBlockSchema).max(CONTRACT_SIZE_LIMITS.maxArrayItems),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
  isError: z.boolean(),
  progress_token: z.union([z.string().max(256), z.number()]).nullable(),
  cancellation_id: OpaqueIdSchema.nullable(),
  error: Spec05ProtocolErrorSchema.nullable(),
  projections: z.object({
    model_visible_content_indices: z.array(z.number().int().nonnegative()).max(CONTRACT_SIZE_LIMITS.maxArrayItems),
    app_visible_content_indices: z.array(z.number().int().nonnegative()).max(CONTRACT_SIZE_LIMITS.maxArrayItems),
    model_structured_content: z.boolean(),
    app_structured_content: z.boolean(),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.isError !== (value.error !== null)) context.addIssue({ code: "custom", message: "error state is ambiguous" });
  for (const index of [...value.projections.model_visible_content_indices, ...value.projections.app_visible_content_indices]) {
    if (index >= value.content.length) context.addIssue({ code: "custom", message: "projection index is outside content" });
  }
  if (encodedByteLength(value) > CONTRACT_SIZE_LIMITS.authorityEnvelopeBytes) context.addIssue({ code: "custom", message: "envelope_too_large" });
});

export const McpAppsToolSchema = z.object({
  name: NonEmptyStringSchema,
  description: z.string().max(2_048).optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  _meta: z.object({
    ui: z.object({
      resourceUri: UiResourceUriSchema.optional(),
      visibility: z.array(z.enum(["model", "app"])).min(1).max(2).default(["model", "app"]),
    }).strict(),
  }).strict(),
}).strict();

const DomainSchema = z.string().url().max(2_048).refine((value) => value.startsWith("https://"), "sandbox domains must use HTTPS");
export const McpAppsResourceDescriptorSchema = z.object({
  resource_version: z.literal(1),
  uri: UiResourceUriSchema,
  mime_type: z.literal(MCP_APP_MEDIA_TYPE),
  package_digest: Sha256DigestSchema,
  content_digest: Sha256DigestSchema,
  size_bytes: z.number().int().positive().max(CONTRACT_SIZE_LIMITS.resourceBytes),
  cache_policy: z.enum(["immutable_package_digest", "no_store"]),
  csp: z.object({
    connect_domains: z.array(DomainSchema).max(16).default([]),
    resource_domains: z.array(DomainSchema).max(16).default([]),
    frame_domains: z.array(DomainSchema).max(16).default([]),
    base_uri_domains: z.array(DomainSchema).max(16).default([]),
  }).strict(),
  sandbox: z.literal("double_iframe_opaque_origin_proxy"),
}).strict();

export const AppViewStateSchema = z.object({
  view_state_version: z.literal(1),
  connection_id: OpaqueIdSchema,
  installation_id: OpaqueIdSchema,
  view_id: OpaqueIdSchema,
  operation_id: OpaqueIdSchema.nullable(),
  state: z.enum(["connecting", "ready", "hidden", "closing", "closed", "revoked"]),
  bridge_generation: z.number().int().positive(),
  created_at: TimestampSchema,
  expires_at: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.expires_at) <= Date.parse(value.created_at)) context.addIssue({ code: "custom", message: "view expiry must follow creation" });
});

export const AppsBridgeMethodSchema = z.enum([
  "ui/initialize", "ui/notifications/initialized", "ui/notifications/sandbox-proxy-ready",
  "ui/notifications/sandbox-resource-ready", "ui/notifications/size-changed", "ui/notifications/tool-input",
  "ui/notifications/tool-input-partial", "ui/notifications/tool-result", "ui/notifications/tool-cancelled",
  "ui/notifications/host-context-changed", "ui/notifications/request-teardown", "ui/resource-teardown",
  "ui/request-display-mode", "ui/open-link", "ui/download-file", "ui/message", "ui/update-model-context",
  "tools/list", "tools/call", "resources/list", "resources/templates/list", "resources/read",
]);

export const AppsBridgeJsonRpcMessageSchema = z.union([
  z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string().min(1).max(256), z.number().int()]), method: AppsBridgeMethodSchema, params: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ jsonrpc: z.literal("2.0"), method: AppsBridgeMethodSchema, params: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string().min(1).max(256), z.number().int()]), result: z.unknown() }).strict(),
  z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string().min(1).max(256), z.number().int()]), error: z.object({ code: z.number().int(), message: z.string().min(1).max(512), data: z.unknown().optional() }).strict() }).strict(),
]);

export const AppsBridgeEnvelopeSchema = z.object({
  bridge_envelope_version: z.literal(1),
  message_id: OpaqueIdSchema,
  installation_id: OpaqueIdSchema,
  view_id: OpaqueIdSchema,
  operation_id: OpaqueIdSchema.nullable(),
  bridge_generation: z.number().int().positive(),
  direction: z.enum(["app_to_host", "host_to_app"]),
  provenance: z.object({ source_window_match: z.literal(true), opaque_origin: z.literal("null"), same_server_id: OpaqueIdSchema }).strict(),
  sent_at: TimestampSchema,
  message: AppsBridgeJsonRpcMessageSchema,
}).strict().superRefine((value, context) => {
  if (encodedByteLength(value) > CONTRACT_SIZE_LIMITS.bridgeMessageBytes) context.addIssue({ code: "custom", message: "bridge_message_too_large" });
});

export const AppCapabilityAuthoritySchema = z.object({
  authority_version: z.literal(1),
  grant_id: OpaqueIdSchema,
  grant_revision: z.number().int().positive(),
  revocation_generation: z.number().int().nonnegative(),
  token_id: OpaqueIdSchema,
  token_generation: z.number().int().positive(),
  owner_id: OpaqueIdSchema,
  actor_id: OpaqueIdSchema,
  app_id: NonEmptyStringSchema,
  publisher_id: NonEmptyStringSchema,
  package_digest: Sha256DigestSchema,
  installation_id: OpaqueIdSchema,
  connection_id: OpaqueIdSchema,
  view_id: OpaqueIdSchema.nullable(),
  operation_id: OpaqueIdSchema,
  audience: z.enum(["app_data", "app_inference", "app_export", "app_bridge"]),
  capabilities: z.array(CapabilityNameSchema).min(1),
  record_scopes: z.array(OpaqueIdSchema),
  idempotency_key: z.string().min(16).max(256),
  issued_at: TimestampSchema,
  expires_at: TimestampSchema,
}).strict().superRefine((value, context) => {
  const lifetime = Date.parse(value.expires_at) - Date.parse(value.issued_at);
  if (lifetime <= 0 || lifetime > 15 * 60_000) context.addIssue({ code: "custom", message: "authority lifetime exceeds 15 minutes" });
  if (new Set(value.capabilities).size !== value.capabilities.length) context.addIssue({ code: "custom", message: "duplicate capability" });
  if (value.audience === "app_bridge" && value.view_id === null) context.addIssue({ code: "custom", message: "bridge authority requires a view" });
});

export const AppInferenceRequestSchema = z.object({
  inference_contract_version: z.literal(1),
  request_id: OpaqueIdSchema,
  operation_id: OpaqueIdSchema,
  authority: AppCapabilityAuthoritySchema,
  intent: z.enum(["quality", "balanced", "speed"]),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(131_072) }).strict()).min(1).max(64),
  context: z.array(z.object({ schema_id: NonEmptyStringSchema, content_digest: Sha256DigestSchema, data: z.unknown() }).strict()).max(16),
  output_schema: z.record(z.string(), z.unknown()),
  stream: z.boolean(),
  tools: z.literal(false),
  allow_provider_fallback: z.literal(false),
  budget: z.object({ input_bytes: z.number().int().positive().max(327_680), input_tokens: z.number().int().positive().max(81_920), output_tokens: z.number().int().positive().max(8_192), duration_ms: z.number().int().positive().max(120_000), attempts: z.number().int().min(1).max(2) }).strict(),
  requested_at: TimestampSchema,
  deadline_at: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.authority.audience !== "app_inference" || value.authority.capabilities.length !== 1 || value.authority.capabilities[0] !== "app.inference.request") context.addIssue({ code: "custom", message: "inference authority is not exact" });
  if (value.authority.operation_id !== value.operation_id) context.addIssue({ code: "custom", message: "operation binding mismatch" });
  if (Date.parse(value.deadline_at) <= Date.parse(value.requested_at)) context.addIssue({ code: "custom", message: "deadline must follow request" });
});

export const AppInferenceEventSchema = z.discriminatedUnion("event", [
  z.object({ inference_contract_version: z.literal(1), request_id: OpaqueIdSchema, operation_id: OpaqueIdSchema, sequence: z.number().int().nonnegative(), event: z.literal("progress"), delta: z.string().max(32_768) }).strict(),
  z.object({ inference_contract_version: z.literal(1), request_id: OpaqueIdSchema, operation_id: OpaqueIdSchema, sequence: z.number().int().nonnegative(), event: z.literal("completed"), structured_output: z.unknown(), output_digest: Sha256DigestSchema, usage: z.object({ input_tokens: z.number().int().nonnegative().nullable(), output_tokens: z.number().int().nonnegative().nullable() }).strict(), outcome: InferenceOutcomeMetadataSchema.optional() }).strict(),
  z.object({ inference_contract_version: z.literal(1), request_id: OpaqueIdSchema, operation_id: OpaqueIdSchema, sequence: z.number().int().nonnegative(), event: z.literal("failed"), error: InferenceErrorSchema, outcome: InferenceOutcomeMetadataSchema.optional() }).strict(),
]);

export const AppInferenceCancelSchema = z.object({
  inference_contract_version: z.literal(1), request_id: OpaqueIdSchema, operation_id: OpaqueIdSchema,
  idempotency_key: z.string().min(16).max(256), reason: z.enum(["owner", "view_closed", "timeout", "lifecycle_revoked"]),
}).strict();

export const Spec05DiagnosticSchema = z.object({
  diagnostic_version: z.literal(1),
  occurred_at: TimestampSchema,
  event: z.enum(["negotiation", "resource", "bridge", "capability", "inference", "supervisor", "parity"]),
  correlation_id: OpaqueIdSchema,
  app_id: NonEmptyStringSchema,
  package_digest: Sha256DigestSchema.nullable(),
  installation_id: OpaqueIdSchema.nullable(),
  connection_id: OpaqueIdSchema.nullable(),
  view_id: OpaqueIdSchema.nullable(),
  operation_id: OpaqueIdSchema.nullable(),
  runtime_id: OpaqueIdSchema.nullable(),
  protocol_version: z.enum([MCP_MODERN_PROTOCOL_VERSION, MCP_LEGACY_PROTOCOL_VERSION]).nullable(),
  capability: CapabilityNameSchema.nullable(),
  provider_profile_id: NonEmptyStringSchema.nullable(),
  model_id: NonEmptyStringSchema.nullable(),
  runtime_state: z.enum(["starting", "ready", "unhealthy", "backoff", "restarting", "failed_recoverable", "stopped"]).nullable(),
  attempt: z.number().int().nonnegative(),
  outcome: z.enum(["allowed", "denied", "completed", "cancelled", "failed"]),
  error_category: Spec05ProtocolErrorSchema.shape.category.nullable(),
  elapsed_ms: z.number().int().nonnegative(),
  byte_count: z.number().int().nonnegative(),
}).strict();

const SPEC_05_FORBIDDEN_DIAGNOSTIC_KEY = /(^|_)(content|body|text|html|prompt|completion|resume|job|path|destination|authorization|credential|api_key|token|secret|permission|endpoint)(_|$)/i;
const SPEC_05_FORBIDDEN_DIAGNOSTIC_VALUE = /(?:bearer\s+[A-Za-z0-9._~-]+|sk-[A-Za-z0-9_-]{12,}|[A-Za-z]:\\|\/(?:home|Users|var|tmp|etc)\/)/i;

export function assertSpec05Diagnostic(value: unknown): asserts value is z.infer<typeof Spec05DiagnosticSchema> {
  const visit = (candidate: unknown, key = ""): void => {
    if (SPEC_05_FORBIDDEN_DIAGNOSTIC_KEY.test(key)) throw new ContractViolation("forbidden_field", `Diagnostic field ${key} is prohibited`);
    if (typeof candidate === "string" && SPEC_05_FORBIDDEN_DIAGNOSTIC_VALUE.test(candidate)) throw new ContractViolation("forbidden_field", "Diagnostic contains a prohibited path or credential pattern");
    if (Array.isArray(candidate)) candidate.forEach((item) => visit(item, key));
    else if (candidate && typeof candidate === "object") Object.entries(candidate).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(value);
  if (!Spec05DiagnosticSchema.safeParse(value).success) throw new ContractViolation("invalid_input", "Diagnostic failed the Spec 05 allowlist");
}

export const Spec05ParityEvidenceSchema = z.object({
  evidence_version: z.literal(1),
  scenario_id: NonEmptyStringSchema,
  docker_outcome: z.enum(["pass", "fail", "blocked", "not_run"]),
  windows_outcome: z.enum(["pass", "fail", "blocked", "not_run"]),
  normalized_semantics_equal: z.boolean(),
  permitted_differences: z.array(z.enum(["transport", "process_isolation", "package_root_ref", "cache_root_ref", "diagnostic_platform"])),
  unexpected_differences: z.array(z.string().min(1).max(256)),
}).strict().superRefine((value, context) => {
  if (value.normalized_semantics_equal !== (value.unexpected_differences.length === 0)) context.addIssue({ code: "custom", message: "parity conclusion is inconsistent" });
});

export const Spec05FoundationBundleSchema = z.object({
  foundation_version: z.literal(SPEC_05_FOUNDATION_VERSION),
  dependencies: Spec05DependencyProfileSchema,
  protocols: z.tuple([McpSupportProfileSchema, McpSupportProfileSchema]),
  supervisor_policy: SupervisorPolicySchema,
  renderer: z.literal("dedicated_web_client_double_iframe_proxy_no_tauri_authority"),
  desktop_executable: z.literal("verified_compiled_javascript_on_braindrive_packaged_node"),
  release_targets: z.object({ docker_dev: z.literal("required"), windows: z.literal("first_packaged_claim"), macos: z.literal("configured_unclaimed"), linux: z.literal("configured_unclaimed") }).strict(),
  optional_facilities: z.object({ sampling: z.literal("rejected"), prompts_completions: z.literal("deferred"), remote_oauth: z.literal("deferred"), stdio: z.literal("deferred"), subscriptions: z.literal("deferred"), tasks: z.literal("deferred"), elicitation: z.literal("deferred") }).strict(),
}).strict();
