import { z } from "zod";

import { NonEmptyStringSchema, OpaqueIdSchema, Sha256DigestSchema, TimestampSchema, encodedByteLength } from "./common.js";
import {
  APP_BRIDGE_SCHEMA_VERSION,
  CONTRACT_SIZE_LIMITS,
  MCP_APPS_EXTENSION_ID,
  MCP_APPS_EXTENSION_VERSION,
  MCP_APP_MEDIA_TYPE,
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSION,
} from "./constants.js";
import { CanonicalAppIdSchema } from "./app-registry.js";
import { CareerReturnSummarySchema } from "./data.js";
import { ContractViolation } from "./errors.js";

const AnnotationsSchema = z
  .object({
    audience: z.array(z.enum(["user", "assistant"])).optional(),
    priority: z.number().min(0).max(1).optional(),
    lastModified: TimestampSchema.optional(),
  })
  .strict();

const ResourceLinkSchema = z
  .object({
    type: z.literal("resource_link"),
    name: NonEmptyStringSchema,
    title: z.string().max(512).optional(),
    uri: z.string().max(2_048),
    description: z.string().max(2_048).optional(),
    mimeType: z.string().max(256).optional(),
    size: z.number().int().nonnegative().max(CONTRACT_SIZE_LIMITS.resourceBytes).optional(),
    annotations: AnnotationsSchema.optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const EmbeddedResourceSchema = z
  .object({
    type: z.literal("resource"),
    resource: z
      .object({
        uri: z.string().max(2_048),
        mimeType: z.string().max(256).optional(),
        text: z.string().max(CONTRACT_SIZE_LIMITS.resourceBytes).optional(),
        blob: z.string().max(Math.ceil((CONTRACT_SIZE_LIMITS.resourceBytes * 4) / 3) + 8).optional(),
        _meta: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .superRefine((value, context) => {
        if ((value.text === undefined) === (value.blob === undefined)) {
          context.addIssue({ code: "custom", message: "embedded resource requires exactly one of text or blob" });
        }
      }),
    annotations: AnnotationsSchema.optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const McpContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(CONTRACT_SIZE_LIMITS.maxStringLength), annotations: AnnotationsSchema.optional(), _meta: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ type: z.literal("image"), data: z.string().max(Math.ceil((CONTRACT_SIZE_LIMITS.resourceBytes * 4) / 3) + 8), mimeType: z.string().min(1).max(256), annotations: AnnotationsSchema.optional(), _meta: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ type: z.literal("audio"), data: z.string().max(Math.ceil((CONTRACT_SIZE_LIMITS.resourceBytes * 4) / 3) + 8), mimeType: z.string().min(1).max(256), annotations: AnnotationsSchema.optional(), _meta: z.record(z.string(), z.unknown()).optional() }).strict(),
  ResourceLinkSchema,
  EmbeddedResourceSchema,
]);

export const CompleteMcpResultSchema = z
  .object({
    envelope_version: z.literal(1),
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
    protocol_error: z
      .object({
        code: z.number().int(),
        message: z.string().min(1).max(512),
        data: z.unknown().optional(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.isError !== (value.protocol_error !== null)) {
      context.addIssue({ code: "custom", message: "error status and typed protocol error must agree" });
    }
    if (encodedByteLength(value) > CONTRACT_SIZE_LIMITS.authorityEnvelopeBytes) {
      context.addIssue({ code: "custom", message: "envelope_too_large" });
    }
  });

export const McpAppResourceSchema = z
  .object({
    resource_version: z.literal(1),
    app_id: CanonicalAppIdSchema,
    package_digest: Sha256DigestSchema,
    uri: z.string().regex(/^ui:\/\/[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/).max(2_048),
    mime_type: z.literal(MCP_APP_MEDIA_TYPE),
    extension: z
      .object({
        id: z.literal(MCP_APPS_EXTENSION_ID),
        version: z.literal(MCP_APPS_EXTENSION_VERSION),
      })
      .strict(),
    content_digest: Sha256DigestSchema,
    size_bytes: z.number().int().positive().max(CONTRACT_SIZE_LIMITS.resourceBytes),
    cache_policy: z.enum(["immutable_package_digest", "no_store"]),
    html: z.string().min(1).max(CONTRACT_SIZE_LIMITS.resourceBytes),
  })
  .strict()
  .superRefine((value, context) => {
    if (Buffer.byteLength(value.html, "utf8") !== value.size_bytes) {
      context.addIssue({ code: "custom", message: "resource size does not match encoded HTML" });
    }
  });

const BridgeBaseSchema = z
  .object({
    bridge_version: z.literal(APP_BRIDGE_SCHEMA_VERSION),
    message_id: OpaqueIdSchema,
    app_id: CanonicalAppIdSchema,
    installation_id: OpaqueIdSchema,
    view_id: OpaqueIdSchema,
    operation_id: OpaqueIdSchema.nullable(),
    sent_at: TimestampSchema,
  })
  .strict();

export const BridgeMessageSchema = z.discriminatedUnion("type", [
  BridgeBaseSchema.extend({ type: z.literal("bridge.ready"), payload: z.object({ supported_capabilities: z.array(z.string().min(1).max(256)) }).strict() }).strict(),
  BridgeBaseSchema.extend({ type: z.literal("tool.call"), payload: z.object({ server_id: OpaqueIdSchema, tool_name: NonEmptyStringSchema, arguments: z.record(z.string(), z.unknown()), token_id: OpaqueIdSchema }).strict() }).strict(),
  BridgeBaseSchema.extend({ type: z.literal("tool.result"), payload: z.object({ request_message_id: OpaqueIdSchema, result: CompleteMcpResultSchema }).strict() }).strict(),
  BridgeBaseSchema.extend({ type: z.literal("capability.call"), payload: z.object({ capability: z.string().min(1).max(256), input: z.record(z.string(), z.unknown()), token_id: OpaqueIdSchema, request_operation_id: OpaqueIdSchema.optional() }).strict() }).strict(),
  BridgeBaseSchema.extend({ type: z.literal("inference.request"), payload: z.object({ request_id: OpaqueIdSchema, token_id: OpaqueIdSchema }).strict() }).strict(),
  BridgeBaseSchema.extend({ type: z.literal("export.request"), payload: z.object({
    definition_revision_id: OpaqueIdSchema,
    format: z.enum(["pdf", "text"]).default("pdf"),
    safe_filename: z.string().min(1).max(128).regex(/^[^/\\]+\.(?:pdf|txt)$/i),
    destination_intent: z.enum(["new_download", "replace_existing"]),
    overwrite_confirmed: z.boolean(),
    token_id: OpaqueIdSchema,
  }).strict() }).strict(),
  BridgeBaseSchema.extend({ type: z.literal("host.action"), payload: z.object({ action: z.enum(["open_link", "copy_to_clipboard", "navigate_settings", "resize"]), value: z.string().max(16_384), token_id: OpaqueIdSchema }).strict() }).strict(),
  BridgeBaseSchema.extend({ type: z.literal("operation.cancel"), payload: z.object({ target_operation_id: OpaqueIdSchema, token_id: OpaqueIdSchema }).strict() }).strict(),
  BridgeBaseSchema.extend({ type: z.literal("career.return"), payload: z.object({ summary: CareerReturnSummarySchema, token_id: OpaqueIdSchema }).strict() }).strict(),
  BridgeBaseSchema.extend({ type: z.literal("bridge.error"), payload: z.object({ code: z.string().min(1).max(128), safe_message: z.string().min(1).max(512), retryable: z.boolean() }).strict() }).strict(),
]);

export const BridgePolicySchema = z
  .object({
    policy_version: z.literal(1),
    sandbox_same_origin: z.literal(false),
    direct_tauri_authority: z.literal(false),
    ambient_navigation: z.literal(false),
    ambient_clipboard: z.literal(false),
    max_message_bytes: z.literal(CONTRACT_SIZE_LIMITS.bridgeMessageBytes),
    max_messages_per_10_seconds: z.literal(100),
    require_origin_and_source_match: z.literal(true),
    require_installation_view_operation_binding: z.literal(true),
    require_same_server_tool_visibility: z.literal(true),
  })
  .strict();

export const BRIDGE_POLICY = BridgePolicySchema.parse({
  policy_version: 1,
  sandbox_same_origin: false,
  direct_tauri_authority: false,
  ambient_navigation: false,
  ambient_clipboard: false,
  max_message_bytes: CONTRACT_SIZE_LIMITS.bridgeMessageBytes,
  max_messages_per_10_seconds: 100,
  require_origin_and_source_match: true,
  require_installation_view_operation_binding: true,
  require_same_server_tool_visibility: true,
});

export function parseBridgeMessage(value: unknown): z.infer<typeof BridgeMessageSchema> {
  if (encodedByteLength(value) > CONTRACT_SIZE_LIMITS.bridgeMessageBytes) {
    throw new ContractViolation("envelope_too_large", "Bridge message exceeds the accepted byte limit");
  }
  const parsed = BridgeMessageSchema.safeParse(value);
  if (!parsed.success) {
    throw new ContractViolation("malformed_envelope", "Bridge message failed schema validation");
  }
  return parsed.data;
}

export function assertUniqueIdentities(values: readonly string[]): void {
  if (new Set(values).size !== values.length) {
    throw new ContractViolation("duplicate_identity", "Identity list contains a duplicate");
  }
}
