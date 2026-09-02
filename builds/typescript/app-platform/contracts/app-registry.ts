import { z } from "zod";

import { canonicalInputDigest, canonicalJson, canonicalJsonDocumentDigest, OpaqueIdSchema, SemverSchema, Sha256DigestSchema } from "./common.js";
import {
  APP_CONTRACT_SCHEMA_VERSION,
  FIRST_PARTY_APP_REGISTRY_VERSION,
  GENERIC_PACKAGE_MANIFEST_VERSION,
  MCP_APPS_EXTENSION_ID,
  MCP_APPS_EXTENSION_VERSION,
  MCP_APP_MEDIA_TYPE,
  MCP_MODERN_PROTOCOL_VERSION,
} from "./constants.js";
import { PackageFileSchema, PackagePathSchema, PlatformArtifactSchema } from "./package.js";

const canonicalDottedIdentifier = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const canonicalNamespacedIdentifier = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/;
const hostBindingIdentifier = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const uiResourceUriPattern = /^ui:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9][a-z0-9._/-]*$/;

export const CanonicalAppIdSchema = z.string().min(3).max(128).regex(canonicalDottedIdentifier);
export const CanonicalPublisherIdSchema = z.string().min(3).max(96).regex(/^[a-z0-9]+(?:\.[a-z0-9]+)+$/);
export const AppRouteKeySchema = z.string().min(2).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const CapabilityIdentifierSchema = z.string().min(3).max(128).regex(canonicalNamespacedIdentifier);
export const InferencePurposeIdentifierSchema = z.string().min(3).max(128).regex(canonicalNamespacedIdentifier);
export const HostBindingIdSchema = z.string().min(3).max(128).regex(hostBindingIdentifier);
export const ContractSchemaIdSchema = z.string().min(3).max(128).regex(canonicalNamespacedIdentifier);
export const UiResourceUriSchema = z.string().regex(uiResourceUriPattern).max(2_048);

const unsafePresentationPattern = /[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]|(?:javascript|data|file):|https?:\s*\/\//i;

function safePresentationText(maxLength: number) {
  return z.string().min(1).max(maxLength).refine(
    (value) => !unsafePresentationPattern.test(value) && !/\[[^\]]*\]\s*\(/.test(value),
    "presentation text must be plain, bounded, and non-navigational",
  );
}

export const CapabilityRequestSchema = z
  .object({ name: CapabilityIdentifierSchema, version: z.number().int().positive().max(65_535) })
  .strict();

export const InferencePurposeRequestSchema = z
  .object({ purpose_id: InferencePurposeIdentifierSchema, version: z.number().int().positive().max(65_535) })
  .strict();

export const AppIdentitySchema = z
  .object({
    app_id: CanonicalAppIdSchema,
    publisher_id: CanonicalPublisherIdSchema,
    route_key: AppRouteKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.app_id.startsWith(`${value.publisher_id}.`)) {
      context.addIssue({ code: "custom", path: ["app_id"], message: "app identity must be subordinate to its publisher identity" });
    }
  });

export const CatalogPresentationSchema = z
  .object({
    display_name: safePresentationText(80),
    summary: safePresentationText(512),
    icon: z
      .object({
        package_path: PackagePathSchema,
        media_type: z.enum(["image/png", "image/webp"]),
        content_digest: Sha256DigestSchema,
      })
      .strict()
      .nullable(),
    retention_summary: safePresentationText(256),
  })
  .strict();

export const PrimaryUiResourceDescriptorSchema = z
  .object({
    resource_version: z.literal(1),
    uri: UiResourceUriSchema,
    package_path: PackagePathSchema,
    mime_type: z.literal(MCP_APP_MEDIA_TYPE),
    content_digest: Sha256DigestSchema,
  })
  .strict();

const DescriptorResourceIdSchema = HostBindingIdSchema;
const DescriptorDocumentIdSchema = HostBindingIdSchema;
const DescriptorContextIdSchema = HostBindingIdSchema;
const DescriptorActionIdSchema = HostBindingIdSchema;
const DescriptorPresentationIdSchema = HostBindingIdSchema;
const DescriptorWorkspaceIdSchema = HostBindingIdSchema;

const MAX_ACTION_SCHEMA_BYTES = 16_384;
const MAX_ACTION_SCHEMA_DEPTH = 12;
const MAX_ACTION_SCHEMA_PROPERTIES = 128;
const MAX_ACTION_SCHEMA_STRING_LENGTH = 4_096;
const MAX_ACTION_SCHEMA_RUNTIME_STRING_LENGTH = 1_048_576;
const MAX_ACTION_SCHEMA_RUNTIME_ARRAY_ITEMS = 10_000;
const ActionJsonSchemaTypeNameSchema = z.enum(["null", "boolean", "object", "array", "number", "integer", "string"]);
const ActionJsonSchemaScalarSchema = z.union([
  z.string().max(MAX_ACTION_SCHEMA_STRING_LENGTH),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

// App action schemas intentionally use the runtime-enforced subset below instead of
// accepting broad JSON Schema. Keywords outside this set fail manifest validation.
const AppActionJsonSchemaNodeSchema: z.ZodType<Record<string, unknown>> = z.lazy(() => z
  .object({
    type: z.union([ActionJsonSchemaTypeNameSchema, z.array(ActionJsonSchemaTypeNameSchema).min(1).max(8)]).optional(),
    additionalProperties: z.boolean().optional(),
    properties: z.record(z.string().min(1).max(128), AppActionJsonSchemaNodeSchema).optional(),
    required: z.array(z.string().min(1).max(128)).max(MAX_ACTION_SCHEMA_PROPERTIES).optional(),
    items: AppActionJsonSchemaNodeSchema.optional(),
    const: ActionJsonSchemaScalarSchema.optional(),
    enum: z.array(ActionJsonSchemaScalarSchema).min(1).max(MAX_ACTION_SCHEMA_PROPERTIES).optional(),
    minLength: z.number().int().nonnegative().max(MAX_ACTION_SCHEMA_RUNTIME_STRING_LENGTH).optional(),
    maxLength: z.number().int().nonnegative().max(MAX_ACTION_SCHEMA_RUNTIME_STRING_LENGTH).optional(),
    format: z.literal("uuid").optional(),
    minItems: z.number().int().nonnegative().max(MAX_ACTION_SCHEMA_RUNTIME_ARRAY_ITEMS).optional(),
    maxItems: z.number().int().nonnegative().max(MAX_ACTION_SCHEMA_RUNTIME_ARRAY_ITEMS).optional(),
    description: z.string().max(MAX_ACTION_SCHEMA_STRING_LENGTH).optional(),
  })
  .strict()) as z.ZodType<Record<string, unknown>>;

const AppActionJsonSchemaBodyBaseSchema: z.ZodType<Record<string, unknown>> = z
  .object({
    type: z.literal("object"),
    additionalProperties: z.literal(false),
    properties: z.record(z.string().min(1).max(128), AppActionJsonSchemaNodeSchema),
    required: z.array(z.string().min(1).max(128)).max(MAX_ACTION_SCHEMA_PROPERTIES),
    description: z.string().max(MAX_ACTION_SCHEMA_STRING_LENGTH).optional(),
  })
  .strict() as z.ZodType<Record<string, unknown>>;

function uniqueValues(values: readonly string[], path: (string | number)[], context: z.RefinementCtx): void {
  if (new Set(values).size !== values.length) context.addIssue({ code: "custom", path, message: "duplicate_identity" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateActionJsonSchemaBody(value: Record<string, unknown>, context: z.RefinementCtx): void {
  let bytes;
  try {
    bytes = Buffer.byteLength(canonicalJson(value), "utf8");
  } catch {
    context.addIssue({ code: "custom", message: "schema body must be canonical JSON" });
    return;
  }
  if (bytes > MAX_ACTION_SCHEMA_BYTES) {
    context.addIssue({ code: "custom", message: "schema body exceeds action schema size limit" });
  }
  if (value.type !== "object") {
    context.addIssue({ code: "custom", path: ["type"], message: "action schemas must use a root object schema" });
  }
  if (!isRecord(value.properties)) {
    context.addIssue({ code: "custom", path: ["properties"], message: "action schemas must declare object properties" });
  }
  if (value.additionalProperties !== false) {
    context.addIssue({ code: "custom", path: ["additionalProperties"], message: "action schemas must close root additional properties" });
  }
  if (!Array.isArray(value.required) || value.required.some((item) => typeof item !== "string")) {
    context.addIssue({ code: "custom", path: ["required"], message: "action schemas must declare required as a string array" });
  }
  const declaredProperties = isRecord(value.properties) ? new Set(Object.keys(value.properties)) : new Set<string>();
  if (Array.isArray(value.required)) {
    for (const [index, item] of value.required.entries()) {
      if (typeof item === "string" && !declaredProperties.has(item)) {
        context.addIssue({ code: "custom", path: ["required", index], message: "required property must be declared" });
      }
    }
  }
  validateActionJsonSchemaNode(value, context, [], { depth: 0, propertyCount: 0 });
}

function validateActionJsonSchemaNode(
  value: unknown,
  context: z.RefinementCtx,
  path: (string | number)[],
  state: { depth: number; propertyCount: number },
): void {
  if (state.depth > MAX_ACTION_SCHEMA_DEPTH) {
    context.addIssue({ code: "custom", path, message: "schema body exceeds action schema depth limit" });
    return;
  }
  if (typeof value === "string") {
    if (value.length > MAX_ACTION_SCHEMA_STRING_LENGTH) {
      context.addIssue({ code: "custom", path, message: "schema string exceeds action schema safety limit" });
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ACTION_SCHEMA_PROPERTIES) {
      context.addIssue({ code: "custom", path, message: "schema array exceeds action schema safety limit" });
    }
    value.forEach((item, index) => validateActionJsonSchemaNode(item, context, [...path, index], { ...state, depth: state.depth + 1 }));
    return;
  }
  if (!isRecord(value)) return;
  if (Object.keys(value).length > MAX_ACTION_SCHEMA_PROPERTIES) {
    context.addIssue({ code: "custom", path, message: "schema object exceeds action schema safety limit" });
  }
  validateActionJsonSchemaNodeSemantics(value, context, path);
  for (const [key, item] of Object.entries(value)) {
    if (key === "properties" && isRecord(item)) {
      state.propertyCount += Object.keys(item).length;
      if (state.propertyCount > MAX_ACTION_SCHEMA_PROPERTIES) {
        context.addIssue({ code: "custom", path: [...path, key], message: "schema body declares too many properties" });
      }
      for (const [propertyName, propertySchema] of Object.entries(item)) {
        validateActionJsonSchemaNode(propertySchema, context, [...path, key, propertyName], { ...state, depth: state.depth + 1 });
      }
      continue;
    }
    if (key === "items" && isRecord(item)) {
      validateActionJsonSchemaNode(item, context, [...path, key], { ...state, depth: state.depth + 1 });
      continue;
    }
    if (key === "type" || key === "additionalProperties" || key === "required" || key === "const" || key === "enum" || key === "minLength" || key === "maxLength" || key === "format" || key === "minItems" || key === "maxItems" || key === "description") {
      validateActionJsonSchemaNode(item, context, [...path, key], { ...state, depth: state.depth + 1 });
    }
  }
}

function validateActionJsonSchemaNodeSemantics(schema: Record<string, unknown>, context: z.RefinementCtx, path: (string | number)[]): void {
  const types = schemaTypeNames(schema.type);
  const hasType = types.length > 0;
  if (Array.isArray(schema.type) && new Set(schema.type).size !== schema.type.length) {
    context.addIssue({ code: "custom", path: [...path, "type"], message: "schema type union must not contain duplicates" });
  }
  if (Array.isArray(schema.required)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const seenRequired = new Set<string>();
    for (const [index, propertyName] of schema.required.entries()) {
      if (typeof propertyName !== "string") continue;
      if (seenRequired.has(propertyName)) {
        context.addIssue({ code: "custom", path: [...path, "required", index], message: "required property must not be duplicated" });
      }
      seenRequired.add(propertyName);
      if (!(propertyName in properties)) {
        context.addIssue({ code: "custom", path: [...path, "required", index], message: "required property must be declared" });
      }
    }
  }
  if (schema.minLength !== undefined || schema.maxLength !== undefined || schema.format !== undefined) {
    if (hasType && !types.includes("string")) {
      context.addIssue({ code: "custom", path, message: "string validation keywords require a string type" });
    }
    if (typeof schema.minLength === "number" && typeof schema.maxLength === "number" && schema.minLength > schema.maxLength) {
      context.addIssue({ code: "custom", path: [...path, "minLength"], message: "minLength must not exceed maxLength" });
    }
  }
  if (schema.minItems !== undefined || schema.maxItems !== undefined || schema.items !== undefined) {
    if (hasType && !types.includes("array")) {
      context.addIssue({ code: "custom", path, message: "array validation keywords require an array type" });
    }
    if (typeof schema.minItems === "number" && typeof schema.maxItems === "number" && schema.minItems > schema.maxItems) {
      context.addIssue({ code: "custom", path: [...path, "minItems"], message: "minItems must not exceed maxItems" });
    }
  }
  if ((schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined) && hasType && !types.includes("object")) {
    context.addIssue({ code: "custom", path, message: "object validation keywords require an object type" });
  }
  if (Array.isArray(schema.enum)) {
    const canonical = schema.enum.map((item) => canonicalJson(item));
    if (new Set(canonical).size !== canonical.length) {
      context.addIssue({ code: "custom", path: [...path, "enum"], message: "enum values must be unique" });
    }
  }
}

function schemaTypeNames(type: unknown): string[] {
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type.filter((item): item is string => typeof item === "string");
  return [];
}

export const AppActionJsonSchemaBodySchema = AppActionJsonSchemaBodyBaseSchema.superRefine(validateActionJsonSchemaBody);

export const AppActionSchemaResourceSchema = z
  .object({
    schema_id: ContractSchemaIdSchema,
    schema_version: z.literal(1),
    content_digest: Sha256DigestSchema,
    schema: AppActionJsonSchemaBodySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.content_digest !== canonicalInputDigest(value.schema)) {
      context.addIssue({ code: "custom", path: ["content_digest"], message: "schema content digest mismatch" });
    }
  });

export const AppResourceDescriptorSchema = z
  .object({
    resource_version: z.literal(1),
    resource_id: DescriptorResourceIdSchema,
    role: z.enum(["agent_instructions", "interview_guide", "quality_standard", "template_standard", "recovery_guidance", "owner_reference"]),
    title: safePresentationText(80),
    description: safePresentationText(512),
    package_path: PackagePathSchema,
    media_type: z.enum(["text/markdown", "text/plain", "application/json"]),
    content_digest: Sha256DigestSchema,
    owner_editable: z.boolean(),
    prompt_inclusion: z.enum(["never", "workspace_start", "document_open", "action_request"]),
  })
  .strict();

export const WorkspaceDocumentHeaderActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("back_to_chat"),
      label: safePresentationText(40),
    })
    .strict(),
  z
    .object({
      type: z.literal("edit_document"),
      label: safePresentationText(40),
    })
    .strict(),
  z
    .object({
      type: z.literal("app_action"),
      action_id: DescriptorActionIdSchema,
      label: safePresentationText(40),
      delivery: z.literal("chat_prompt"),
      prompt: safePresentationText(512),
    })
    .strict(),
]);

export const WorkspaceDocumentPresentationSchema = z
  .object({
    presentation_version: z.literal(1),
    renderer: z.enum(["plain_text", "markdown_document", "paper_document", "json_editor"]),
    chrome: z.enum(["standard", "document"]),
    title: safePresentationText(80).nullable(),
    subtitle: safePresentationText(160).nullable(),
    header_actions: z.array(WorkspaceDocumentHeaderActionSchema).max(6),
  })
  .strict();

export const WorkspaceDocumentInitialContentSchema = z
  .object({
    initial_content_version: z.literal(1),
    source: z.literal("package_file"),
    package_path: PackagePathSchema,
    media_type: z.enum(["text/markdown", "text/plain", "application/json"]),
    content_digest: Sha256DigestSchema,
    seed_policy: z.enum(["when_missing"]),
  })
  .strict();

export const ChatWorkspaceEmptyStateSchema = z
  .object({
    empty_state_version: z.literal(1),
    heading: safePresentationText(80),
    description: safePresentationText(512),
    cta_label: safePresentationText(40).nullable(),
    cta_message: safePresentationText(512).nullable(),
  })
  .strict();

export const WorkspaceDocumentDescriptorSchema = z
  .object({
    document_version: z.literal(1),
    document_id: DescriptorDocumentIdSchema,
    role: z.enum(["conversation", "source_document", "derived_document", "advanced_resource", "recovery", "recovery_document", "action_result_document"]),
    title: safePresentationText(80),
    description: safePresentationText(512),
    editable: z.boolean(),
    default_visibility: z.enum(["primary", "secondary", "advanced"]),
    model_access: z.enum(["none", "read_reference", "read_write_draft", "action_result"]),
    resource_id: DescriptorResourceIdSchema.nullable(),
    data_binding_id: HostBindingIdSchema.nullable(),
    initial_content: WorkspaceDocumentInitialContentSchema.nullable().optional(),
    presentation: WorkspaceDocumentPresentationSchema.nullable().optional(),
  })
  .strict();

export const AppContextRequestDescriptorSchema = z
  .object({
    context_version: z.literal(1),
    context_id: DescriptorContextIdSchema,
    kind: z.enum(["career_context", "owner_profile", "workspace_context", "app_state"]),
    title: safePresentationText(80),
    description: safePresentationText(512),
    required: z.boolean(),
    max_bytes: z.number().int().positive().max(1_048_576),
    freshness_policy: z.enum(["latest_available", "session_snapshot", "explicit_owner_refresh"]),
    required_capabilities: z.array(CapabilityRequestSchema).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    uniqueValues(value.required_capabilities.map((item) => `${item.name}@${item.version}`), ["required_capabilities"], context);
  });

export const AppActionDescriptorSchema = z
  .object({
    action_version: z.literal(1),
    action_id: DescriptorActionIdSchema,
    kind: z.enum(["read", "write", "render", "export", "recover", "inspect"]),
    title: safePresentationText(80),
    description: safePresentationText(512),
    input_schema: AppActionSchemaResourceSchema,
    result_schema: AppActionSchemaResourceSchema,
    confirmation: z.enum(["none", "owner_confirmation", "trusted_owner_confirmation"]),
    idempotency_policy: z.enum(["not_applicable", "optional", "required"]),
    model_exposure: z.enum(["hidden", "available"]),
    required_capabilities: z.array(CapabilityRequestSchema).max(8),
    required_inference_purposes: z.array(InferencePurposeRequestSchema).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.input_schema.schema_id === value.result_schema.schema_id) {
      context.addIssue({ code: "custom", path: ["result_schema", "schema_id"], message: "duplicate_identity" });
    }
    uniqueValues(value.required_capabilities.map((item) => `${item.name}@${item.version}`), ["required_capabilities"], context);
    uniqueValues(value.required_inference_purposes.map((item) => `${item.purpose_id}@${item.version}`), ["required_inference_purposes"], context);
  });

export const ChatWorkspaceDescriptorSchema = z
  .object({
    workspace_version: z.literal(1),
    workspace_id: DescriptorWorkspaceIdSchema,
    title: safePresentationText(80),
    description: safePresentationText(512),
    default_document_id: DescriptorDocumentIdSchema,
    empty_state: ChatWorkspaceEmptyStateSchema.nullable().optional(),
    documents: z.array(WorkspaceDocumentDescriptorSchema).min(1).max(16),
    resources: z.array(AppResourceDescriptorSchema).max(32),
    context_requests: z.array(AppContextRequestDescriptorSchema).max(16),
    actions: z.array(AppActionDescriptorSchema).max(32),
  })
  .strict()
  .superRefine((value, context) => {
    uniqueValues(value.documents.map((item) => item.document_id), ["documents"], context);
    uniqueValues(value.resources.map((item) => item.resource_id), ["resources"], context);
    uniqueValues(value.context_requests.map((item) => item.context_id), ["context_requests"], context);
    uniqueValues(value.actions.map((item) => item.action_id), ["actions"], context);
    uniqueValues(value.actions.flatMap((item) => [item.input_schema.schema_id, item.result_schema.schema_id]), ["actions"], context);
    const documentIds = new Set(value.documents.map((item) => item.document_id));
    if (!documentIds.has(value.default_document_id)) {
      context.addIssue({ code: "custom", path: ["default_document_id"], message: "default document must reference a declared workspace document" });
    }
    const resourceIds = new Set(value.resources.map((item) => item.resource_id));
    const resourceById = new Map(value.resources.map((item) => [item.resource_id, item]));
    const actionIds = new Set(value.actions.map((item) => item.action_id));
    for (const [index, document] of value.documents.entries()) {
      if (document.resource_id !== null && !resourceIds.has(document.resource_id)) {
        context.addIssue({ code: "custom", path: ["documents", index, "resource_id"], message: "document resource must reference a declared app resource" });
      }
      if (document.initial_content) {
        if (!document.data_binding_id || document.role === "conversation") {
          context.addIssue({ code: "custom", path: ["documents", index, "initial_content"], message: "initial document content requires a bound app document" });
        }
        const resource = document.resource_id ? resourceById.get(document.resource_id) : null;
        if (resource && (
          document.initial_content.source !== "package_file" ||
          document.initial_content.package_path !== resource.package_path ||
          document.initial_content.media_type !== resource.media_type ||
          document.initial_content.content_digest !== resource.content_digest ||
          document.initial_content.seed_policy !== "when_missing"
        )) {
          context.addIssue({ code: "custom", path: ["documents", index, "initial_content"], message: "resource-backed document seed must match the immutable package resource" });
        }
      }
      const headerActions = document.presentation?.header_actions ?? [];
      for (const [actionIndex, headerAction] of headerActions.entries()) {
        if (headerAction.type === "app_action" && !actionIds.has(headerAction.action_id)) {
          context.addIssue({ code: "custom", path: ["documents", index, "presentation", "header_actions", actionIndex, "action_id"], message: "document header action must reference a declared workspace action" });
        }
      }
    }
    for (const [index, resource] of value.resources.entries()) {
      if (!resource.owner_editable) continue;
      const overrideDocument = value.documents.find((document) =>
        document.resource_id === resource.resource_id &&
        document.editable &&
        document.data_binding_id &&
        document.initial_content?.source === "package_file" &&
        document.initial_content.package_path === resource.package_path &&
        document.initial_content.media_type === resource.media_type &&
        document.initial_content.content_digest === resource.content_digest &&
        document.initial_content.seed_policy === "when_missing"
      );
      if (!overrideDocument) {
        context.addIssue({ code: "custom", path: ["resources", index, "owner_editable"], message: "owner-editable resources require an editable bound document seeded from the immutable package resource" });
      }
    }
  });

export const AppPresentationProfileSchema = z.discriminatedUnion("type", [
  z
    .object({
      profile_version: z.literal(1),
      presentation_id: DescriptorPresentationIdSchema,
      type: z.literal("surface"),
      label: safePresentationText(80),
      description: safePresentationText(512),
      resource_uri: UiResourceUriSchema,
      owner_visibility: z.enum(["primary", "secondary", "internal"]),
    })
    .strict(),
  z
    .object({
      profile_version: z.literal(1),
      presentation_id: DescriptorPresentationIdSchema,
      type: z.literal("chat_workspace"),
      label: safePresentationText(80),
      description: safePresentationText(512),
      workspace_id: DescriptorWorkspaceIdSchema,
      owner_visibility: z.enum(["primary", "secondary", "internal"]),
    })
    .strict(),
]);

export const AppPresentationSetSchema = z
  .object({
    presentation_set_version: z.literal(1),
    default_presentation_id: DescriptorPresentationIdSchema,
    profiles: z.array(AppPresentationProfileSchema).min(1).max(8),
    workspaces: z.array(ChatWorkspaceDescriptorSchema).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    uniqueValues(value.profiles.map((item) => item.presentation_id), ["profiles"], context);
    uniqueValues(value.workspaces.map((item) => item.workspace_id), ["workspaces"], context);
    const profileIds = new Set(value.profiles.map((item) => item.presentation_id));
    if (!profileIds.has(value.default_presentation_id)) {
      context.addIssue({ code: "custom", path: ["default_presentation_id"], message: "default presentation must reference a declared profile" });
    }
    const workspaceIds = new Set(value.workspaces.map((item) => item.workspace_id));
    for (const [index, profile] of value.profiles.entries()) {
      if (profile.type === "chat_workspace" && !workspaceIds.has(profile.workspace_id)) {
        context.addIssue({ code: "custom", path: ["profiles", index, "workspace_id"], message: "chat presentation must reference a declared workspace" });
      }
    }
  });

const ArchivePolicySchema = z
  .object({
    format: z.literal("zip"),
    profile: z.literal("braindrive-zip-v1"),
    compression: z.literal("store"),
    layout_version: z.literal(1),
    manifest_path: z.literal("manifest.json"),
    undeclared_entries: z.literal("reject"),
    links_and_device_nodes: z.literal("reject"),
    max_file_count: z.literal(256),
    max_compressed_bytes: z.literal(67_108_864),
    max_uncompressed_bytes: z.literal(268_435_456),
  })
  .strict();

export const AppRetentionClassSchema = z.enum([
  "runtime_authority",
  "verified_package",
  "disposable_cache",
  "app_storage",
  "artifact_records",
  "export_receipts",
  "owner_exports",
  "lifecycle_tombstone",
]);

export const AppRetentionUninstallBehaviorSchema = z.enum([
  "remove",
  "retain",
  "outside_app_lifecycle",
  "retain_minimal_tombstone",
]);

export const AppRetentionOwnerControlSchema = z.enum([
  "delete_after_uninstall",
  "export_after_uninstall",
  "archive_after_uninstall",
]);

export const AppRetentionPolicySchema = z
  .object({
    retention_policy_version: z.literal(1),
    classes: z.array(z.object({
      retention_class: AppRetentionClassSchema,
      label: safePresentationText(80),
      description: safePresentationText(256),
      uninstall_behavior: AppRetentionUninstallBehaviorSchema,
      owner_controls: z.array(AppRetentionOwnerControlSchema).max(3),
      reinstall_access: z.enum(["fresh_grant_required", "outside_app_lifecycle", "not_restored"]),
    }).strict()).min(8).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    uniqueValues(value.classes.map((item) => item.retention_class), ["classes"], context);
    const byClass = new Map(value.classes.map((item) => [item.retention_class, item]));
    for (const required of AppRetentionClassSchema.options) {
      if (!byClass.has(required)) context.addIssue({ code: "custom", path: ["classes"], message: `missing retention class: ${required}` });
    }
    const mustRemove = ["runtime_authority", "verified_package", "disposable_cache"] as const;
    for (const retentionClass of mustRemove) {
      const entry = byClass.get(retentionClass);
      if (entry && (entry.uninstall_behavior !== "remove" || entry.owner_controls.length !== 0 || entry.reinstall_access !== "not_restored")) {
        context.addIssue({ code: "custom", path: ["classes"], message: `${retentionClass} must be removed on uninstall` });
      }
    }
    const appStorage = byClass.get("app_storage");
    if (appStorage && (
      appStorage.uninstall_behavior !== "retain" ||
      appStorage.reinstall_access !== "fresh_grant_required" ||
      !appStorage.owner_controls.includes("delete_after_uninstall") ||
      !appStorage.owner_controls.includes("export_after_uninstall") ||
      !appStorage.owner_controls.includes("archive_after_uninstall")
    )) {
      context.addIssue({ code: "custom", path: ["classes"], message: "app storage must be retained with post-uninstall owner delete/export/archive controls and fresh reinstall grant" });
    }
    for (const retentionClass of ["artifact_records", "export_receipts"] as const) {
      const entry = byClass.get(retentionClass);
      if (entry && (
        entry.uninstall_behavior !== "retain" ||
        entry.reinstall_access !== "fresh_grant_required" ||
        !entry.owner_controls.includes("delete_after_uninstall") ||
        !entry.owner_controls.includes("export_after_uninstall") ||
        !entry.owner_controls.includes("archive_after_uninstall")
      )) {
        context.addIssue({ code: "custom", path: ["classes"], message: `${retentionClass} must follow retained owner-data controls` });
      }
    }
    const exports = byClass.get("owner_exports");
    if (exports && (exports.uninstall_behavior !== "outside_app_lifecycle" || exports.owner_controls.length !== 0 || exports.reinstall_access !== "outside_app_lifecycle")) {
      context.addIssue({ code: "custom", path: ["classes"], message: "owner exports remain outside app lifecycle deletion" });
    }
    const tombstone = byClass.get("lifecycle_tombstone");
    if (tombstone && (tombstone.uninstall_behavior !== "retain_minimal_tombstone" || tombstone.owner_controls.length !== 0 || tombstone.reinstall_access !== "fresh_grant_required")) {
      context.addIssue({ code: "custom", path: ["classes"], message: "lifecycle tombstones must be minimally retained for audit" });
    }
  });

export const DEFAULT_APP_RETENTION_POLICY = AppRetentionPolicySchema.parse({
  retention_policy_version: 1,
  classes: [
    { retention_class: "runtime_authority", label: "runtime authority", description: "Runtime sessions, bridge authority, grants, and tokens.", uninstall_behavior: "remove", owner_controls: [], reinstall_access: "not_restored" },
    { retention_class: "verified_package", label: "app code", description: "Verified package references and unshared package bytes.", uninstall_behavior: "remove", owner_controls: [], reinstall_access: "not_restored" },
    { retention_class: "disposable_cache", label: "disposable cache", description: "Runtime cache and temporary app instance state.", uninstall_behavior: "remove", owner_controls: [], reinstall_access: "not_restored" },
    { retention_class: "app_storage", label: "app storage", description: "App-owned durable documents, state, and operation records.", uninstall_behavior: "retain", owner_controls: ["delete_after_uninstall", "export_after_uninstall", "archive_after_uninstall"], reinstall_access: "fresh_grant_required" },
    { retention_class: "artifact_records", label: "artifact metadata", description: "App artifact records retained for recovery and audit.", uninstall_behavior: "retain", owner_controls: ["delete_after_uninstall", "export_after_uninstall", "archive_after_uninstall"], reinstall_access: "fresh_grant_required" },
    { retention_class: "export_receipts", label: "export receipts", description: "Owner-visible receipts for mediated exports.", uninstall_behavior: "retain", owner_controls: ["delete_after_uninstall", "export_after_uninstall", "archive_after_uninstall"], reinstall_access: "fresh_grant_required" },
    { retention_class: "owner_exports", label: "owner exports", description: "Files the owner exported outside the app lifecycle.", uninstall_behavior: "outside_app_lifecycle", owner_controls: [], reinstall_access: "outside_app_lifecycle" },
    { retention_class: "lifecycle_tombstone", label: "lifecycle evidence", description: "Minimal install, uninstall, deletion, export, and archive evidence.", uninstall_behavior: "retain_minimal_tombstone", owner_controls: [], reinstall_access: "fresh_grant_required" },
  ],
});

export const GenericPackageManifestSchema = z
  .object({
    manifest_version: z.literal(GENERIC_PACKAGE_MANIFEST_VERSION),
    app_id: CanonicalAppIdSchema,
    publisher_id: CanonicalPublisherIdSchema,
    package_version: SemverSchema,
    catalog: CatalogPresentationSchema,
    archive: ArchivePolicySchema,
    files: z.array(PackageFileSchema).min(3).max(256),
    platform_artifacts: z.array(PlatformArtifactSchema).min(2).max(3),
    compatibility: z
      .object({
        app_contract: z.literal(APP_CONTRACT_SCHEMA_VERSION),
        host_min_version: SemverSchema,
        mcp_protocol: z.literal(MCP_MODERN_PROTOCOL_VERSION),
        mcp_apps: z
          .object({ extension_id: z.literal(MCP_APPS_EXTENSION_ID), version: z.literal(MCP_APPS_EXTENSION_VERSION) })
          .strict(),
        data_contract_version: z.number().int().positive().max(65_535),
      })
      .strict(),
    primary_resource: PrimaryUiResourceDescriptorSchema,
    presentations: AppPresentationSetSchema.optional(),
    requested_capabilities: z.array(CapabilityRequestSchema).max(64),
    requested_inference_purposes: z.array(InferencePurposeRequestSchema).max(32),
    provenance_path: PackagePathSchema,
    sbom_path: PackagePathSchema,
    retention_policy: AppRetentionPolicySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.app_id.startsWith(`${value.publisher_id}.`)) {
      context.addIssue({ code: "custom", path: ["app_id"], message: "app identity must be subordinate to its publisher identity" });
    }
    const unique = (values: readonly string[], path: (string | number)[]) => {
      if (new Set(values).size !== values.length) context.addIssue({ code: "custom", path, message: "duplicate_identity" });
    };
    unique(value.requested_capabilities.map((item) => `${item.name}@${item.version}`), ["requested_capabilities"]);
    unique(value.requested_inference_purposes.map((item) => `${item.purpose_id}@${item.version}`), ["requested_inference_purposes"]);
    unique(value.files.map((file) => file.path.toLowerCase()), ["files"]);
    const sortedPaths = [...value.files.map((file) => file.path)].sort();
    if (value.files.some((file, index) => file.path !== sortedPaths[index])) {
      context.addIssue({ code: "custom", path: ["files"], message: "package file inventory must use canonical path order" });
    }
    const files = new Map(value.files.map((file) => [file.path, file]));
    for (const file of value.files) {
      if (!/^(?:payload|provenance|sbom)\//.test(file.path) || file.path === value.archive.manifest_path) {
        context.addIssue({ code: "custom", path: ["files"], message: "package file is outside the accepted archive roots" });
      }
    }
    const entrypoints = new Set(value.platform_artifacts.map((artifact) => artifact.entrypoint));
    for (const file of value.files) {
      if ((file.mode === "executable") !== entrypoints.has(file.path)) {
        context.addIssue({ code: "custom", path: ["files"], message: "only package runtime entrypoints may be executable" });
      }
    }
    for (const artifact of value.platform_artifacts) {
      if (files.get(artifact.entrypoint)?.mode !== "executable") {
        context.addIssue({ code: "custom", path: ["platform_artifacts"], message: "platform entrypoint must be a declared executable file" });
      }
    }
    const targets = value.platform_artifacts.map((artifact) => artifact.target);
    if (new Set(targets).size !== targets.length || !targets.includes("docker_linux_x64") || !targets.includes("desktop_windows_x64")) {
      context.addIssue({ code: "custom", path: ["platform_artifacts"], message: "package must declare the accepted targets exactly once" });
    }
    const primary = files.get(value.primary_resource.package_path);
    if (!primary || primary.mode !== "read_only" || primary.digest !== value.primary_resource.content_digest) {
      context.addIssue({ code: "custom", path: ["primary_resource"], message: "primary resource must bind a declared immutable package file" });
    }
    if (value.presentations) {
      const requestedCapabilities = new Set(value.requested_capabilities.map((item) => `${item.name}@${item.version}`));
      const requestedPurposes = new Set(value.requested_inference_purposes.map((item) => `${item.purpose_id}@${item.version}`));
      for (const [index, profile] of value.presentations.profiles.entries()) {
        if (profile.type === "surface" && profile.resource_uri !== value.primary_resource.uri) {
          context.addIssue({ code: "custom", path: ["presentations", "profiles", index, "resource_uri"], message: "surface presentation must bind the primary UI resource" });
        }
      }
      for (const [workspaceIndex, workspace] of value.presentations.workspaces.entries()) {
        for (const [documentIndex, document] of workspace.documents.entries()) {
          if (!document.initial_content) continue;
          const seedFile = files.get(document.initial_content.package_path);
          if (!seedFile || seedFile.mode !== "read_only" || seedFile.digest !== document.initial_content.content_digest) {
            context.addIssue({ code: "custom", path: ["presentations", "workspaces", workspaceIndex, "documents", documentIndex, "initial_content"], message: "initial document content must bind a declared immutable package file" });
          }
        }
        for (const [resourceIndex, resource] of workspace.resources.entries()) {
          const file = files.get(resource.package_path);
          if (!file || file.mode !== "read_only" || file.digest !== resource.content_digest) {
            context.addIssue({ code: "custom", path: ["presentations", "workspaces", workspaceIndex, "resources", resourceIndex], message: "app resource must bind a declared immutable package file" });
          }
        }
        for (const [contextIndex, request] of workspace.context_requests.entries()) {
          for (const [capabilityIndex, capability] of request.required_capabilities.entries()) {
            if (!requestedCapabilities.has(`${capability.name}@${capability.version}`)) {
              context.addIssue({ code: "custom", path: ["presentations", "workspaces", workspaceIndex, "context_requests", contextIndex, "required_capabilities", capabilityIndex], message: "context request capability must be requested by the manifest" });
            }
          }
        }
        for (const [actionIndex, action] of workspace.actions.entries()) {
          for (const [capabilityIndex, capability] of action.required_capabilities.entries()) {
            if (!requestedCapabilities.has(`${capability.name}@${capability.version}`)) {
              context.addIssue({ code: "custom", path: ["presentations", "workspaces", workspaceIndex, "actions", actionIndex, "required_capabilities", capabilityIndex], message: "action capability must be requested by the manifest" });
            }
          }
          for (const [purposeIndex, purpose] of action.required_inference_purposes.entries()) {
            if (!requestedPurposes.has(`${purpose.purpose_id}@${purpose.version}`)) {
              context.addIssue({ code: "custom", path: ["presentations", "workspaces", workspaceIndex, "actions", actionIndex, "required_inference_purposes", purposeIndex], message: "action inference purpose must be requested by the manifest" });
            }
          }
        }
      }
    }
    const icon = value.catalog.icon;
    if (icon) {
      const iconFile = files.get(icon.package_path);
      if (!iconFile || iconFile.mode !== "read_only" || iconFile.digest !== icon.content_digest) {
        context.addIssue({ code: "custom", path: ["catalog", "icon"], message: "catalog icon must bind a declared immutable package file" });
      }
    }
    if (!files.has(value.provenance_path) || !value.provenance_path.startsWith("provenance/")) {
      context.addIssue({ code: "custom", path: ["provenance_path"], message: "provenance path must bind a declared provenance file" });
    }
    if (!files.has(value.sbom_path) || !value.sbom_path.startsWith("sbom/")) {
      context.addIssue({ code: "custom", path: ["sbom_path"], message: "SBOM path must bind a declared SBOM file" });
    }
    const declaredBytes = value.files.reduce((total, file) => total + file.size_bytes, 0);
    if (declaredBytes > value.archive.max_compressed_bytes || declaredBytes > value.archive.max_uncompressed_bytes) {
      context.addIssue({ code: "custom", path: ["files"], message: "declared package contents exceed the archive ceiling" });
    }
  });

export const CapabilityRegistrationSchema = z
  .object({
    registration_version: z.literal(FIRST_PARTY_APP_REGISTRY_VERSION),
    app_id: CanonicalAppIdSchema,
    key: CapabilityRequestSchema,
    binding_id: HostBindingIdSchema,
    input_schema_id: ContractSchemaIdSchema,
    result_schema_id: ContractSchemaIdSchema,
    limits: z
      .object({
        max_input_bytes: z.number().int().positive().max(1_048_576),
        max_duration_ms: z.number().int().positive().max(120_000),
        max_calls_per_minute: z.number().int().positive().max(600),
      })
      .strict(),
    confirmation: z.enum(["none", "owner_confirmation", "trusted_owner_confirmation"]),
    audit_projection_id: HostBindingIdSchema,
    retry_policy: z.enum(["never", "idempotent_only"]),
    idempotency_policy: z.enum(["not_applicable", "optional", "required"]),
    owner_component_id: HostBindingIdSchema,
  })
  .strict();

export const InferencePurposeRegistrationSchema = z
  .object({
    registration_version: z.literal(1),
    app_id: CanonicalAppIdSchema,
    key: InferencePurposeRequestSchema,
    binding_id: HostBindingIdSchema,
    input_schema_id: ContractSchemaIdSchema,
    output_schema_id: ContractSchemaIdSchema,
    prompt_policy_id: HostBindingIdSchema,
    model_compatibility_class: z.literal("owner_active_compatible"),
    limits: z
      .object({
        max_input_bytes: z.number().int().positive().max(1_048_576),
        max_input_tokens: z.number().int().positive().max(262_144),
        max_output_tokens: z.number().int().positive().max(16_384),
        max_duration_ms: z.number().int().positive().max(120_000),
        max_attempts: z.number().int().min(1).max(2),
      })
      .strict(),
    validation_policy_id: HostBindingIdSchema,
    retry_policy: z.literal("same_snapshot_only"),
    cancellation_policy: z.literal("required"),
    audit_projection_id: HostBindingIdSchema,
    owner_component_id: HostBindingIdSchema,
  })
  .strict();

export const DataAdapterRegistrationSchema = z
  .object({
    registration_version: z.literal(1),
    app_id: CanonicalAppIdSchema,
    binding_id: HostBindingIdSchema,
    adapter_contract_version: z.literal(1),
    data_contract_version: z.number().int().positive().max(65_535),
    namespace_policy: z.literal("host_derived_from_verified_app_id"),
    retention_policy: z.literal("retain_owner_data_remove_runtime_authority"),
    owner_component_id: HostBindingIdSchema,
  })
  .strict();

export const AppOperationBindingSchema = z
  .object({
    installation_id: OpaqueIdSchema,
    lifecycle_generation: z.number().int().nonnegative(),
    grant_id: OpaqueIdSchema,
    grant_revision: z.number().int().positive(),
  })
  .strict();

export const FirstPartyAppRegistrationSchema = z
  .object({
    registration_version: z.literal(1),
    app_id: CanonicalAppIdSchema,
    publisher_id: CanonicalPublisherIdSchema,
    route_key: AppRouteKeySchema,
    package_source_id: HostBindingIdSchema,
    lifecycle_binding_id: HostBindingIdSchema,
    runtime_profile_id: HostBindingIdSchema,
    capability_registrations: z.array(CapabilityRegistrationSchema).max(64),
    inference_purpose_registrations: z.array(InferencePurposeRegistrationSchema).max(32),
    data_adapter_registration: DataAdapterRegistrationSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.app_id.startsWith(`${value.publisher_id}.`)) {
      context.addIssue({ code: "custom", path: ["app_id"], message: "app identity must be subordinate to its publisher identity" });
    }
    const bindings = [
      ...value.capability_registrations.map((item) => item.app_id),
      ...value.inference_purpose_registrations.map((item) => item.app_id),
      value.data_adapter_registration.app_id,
    ];
    if (bindings.some((appId) => appId !== value.app_id)) {
      context.addIssue({ code: "custom", message: "host binding app identity mismatch" });
    }
    const capabilityKeys = value.capability_registrations.map((item) => `${item.key.name}@${item.key.version}`);
    const purposeKeys = value.inference_purpose_registrations.map((item) => `${item.key.purpose_id}@${item.key.version}`);
    if (new Set(capabilityKeys).size !== capabilityKeys.length || new Set(purposeKeys).size !== purposeKeys.length) {
      context.addIssue({ code: "custom", message: "duplicate_identity" });
    }
  });

export const VerifiedFirstPartyPackageSchema = z
  .object({
    verified_package_version: z.literal(1),
    source_entry: z
      .object({
        source_id: HostBindingIdSchema,
        app_id: CanonicalAppIdSchema,
        publisher_id: CanonicalPublisherIdSchema,
        package_version: SemverSchema,
        descriptor_digest: Sha256DigestSchema,
        archive_digest: Sha256DigestSchema,
      })
      .strict(),
    descriptor: z
      .object({
        descriptor_version: z.literal(2),
        manifest: GenericPackageManifestSchema,
        manifest_digest: Sha256DigestSchema,
        archive_digest: Sha256DigestSchema,
        descriptor_digest: Sha256DigestSchema,
      })
      .strict(),
    verification: z
      .object({
        status: z.literal("verified"),
        source_signature_valid: z.literal(true),
        descriptor_signature_valid: z.literal(true),
        archive_digest_valid: z.literal(true),
        manifest_digest_valid: z.literal(true),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const manifest = value.descriptor.manifest;
    if (
      value.source_entry.app_id !== manifest.app_id ||
      value.source_entry.publisher_id !== manifest.publisher_id ||
      value.source_entry.package_version !== manifest.package_version
    ) {
      context.addIssue({ code: "custom", message: "source and manifest identity mismatch" });
    }
    if (
      value.source_entry.archive_digest !== value.descriptor.archive_digest ||
      value.source_entry.descriptor_digest !== value.descriptor.descriptor_digest
    ) {
      context.addIssue({ code: "custom", message: "source and descriptor digest mismatch" });
    }
    if (value.descriptor.manifest_digest !== canonicalJsonDocumentDigest(manifest)) {
      context.addIssue({ code: "custom", message: "manifest digest mismatch" });
    }
    const { descriptor_digest: _descriptorDigest, ...descriptorBody } = value.descriptor;
    if (value.descriptor.descriptor_digest !== canonicalJsonDocumentDigest(descriptorBody)) {
      context.addIssue({ code: "custom", message: "descriptor digest mismatch" });
    }
  });

export const ResolvedAppDescriptorSchema = z
  .object({
    resolved_descriptor_version: z.literal(1),
    app_id: CanonicalAppIdSchema,
    publisher_id: CanonicalPublisherIdSchema,
    route_key: AppRouteKeySchema,
    package: z
      .object({
        source_id: HostBindingIdSchema,
        package_version: SemverSchema,
        descriptor_digest: Sha256DigestSchema,
        manifest_digest: Sha256DigestSchema,
        package_digest: Sha256DigestSchema,
      })
      .strict(),
    catalog: CatalogPresentationSchema,
    runtime_profile_id: HostBindingIdSchema,
    lifecycle_binding_id: HostBindingIdSchema,
    operation_binding: AppOperationBindingSchema.nullable(),
    resources: z
      .object({ primary: PrimaryUiResourceDescriptorSchema })
      .strict(),
    presentations: AppPresentationSetSchema.nullable(),
    compatibility: GenericPackageManifestSchema.shape.compatibility,
    requested_authority: z
      .object({
        capabilities: z.array(CapabilityRequestSchema).max(64),
        inference_purposes: z.array(InferencePurposeRequestSchema).max(32),
        data_contract_version: z.number().int().positive().max(65_535),
      })
      .strict(),
    reviewed_authority: z
      .object({
        capabilities: z.array(CapabilityRegistrationSchema).max(64),
        inference_purposes: z.array(InferencePurposeRegistrationSchema).max(32),
        data_adapter: DataAdapterRegistrationSchema,
      })
      .strict(),
    descriptor_digest: Sha256DigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const { descriptor_digest: _descriptorDigest, ...body } = value;
    if (value.descriptor_digest !== canonicalInputDigest(body)) {
      context.addIssue({ code: "custom", path: ["descriptor_digest"], message: "resolved descriptor digest mismatch" });
    }
  });

export type GenericPackageManifest = z.infer<typeof GenericPackageManifestSchema>;
export type AppRetentionPolicy = z.infer<typeof AppRetentionPolicySchema>;
export type AppRetentionClass = z.infer<typeof AppRetentionClassSchema>;
export type AppPresentationProfile = z.infer<typeof AppPresentationProfileSchema>;
export type AppPresentationSet = z.infer<typeof AppPresentationSetSchema>;
export type ChatWorkspaceEmptyState = z.infer<typeof ChatWorkspaceEmptyStateSchema>;
export type ChatWorkspaceDescriptor = z.infer<typeof ChatWorkspaceDescriptorSchema>;
export type WorkspaceDocumentInitialContent = z.infer<typeof WorkspaceDocumentInitialContentSchema>;
export type WorkspaceDocumentDescriptor = z.infer<typeof WorkspaceDocumentDescriptorSchema>;
export type AppResourceDescriptor = z.infer<typeof AppResourceDescriptorSchema>;
export type AppContextRequestDescriptor = z.infer<typeof AppContextRequestDescriptorSchema>;
export type AppActionDescriptor = z.infer<typeof AppActionDescriptorSchema>;
export type FirstPartyAppRegistration = z.infer<typeof FirstPartyAppRegistrationSchema>;
export type VerifiedFirstPartyPackage = z.infer<typeof VerifiedFirstPartyPackageSchema>;
export type ResolvedAppDescriptor = z.infer<typeof ResolvedAppDescriptorSchema>;
