import { z } from "zod";

import { canonicalInputDigest, canonicalJsonDocumentDigest, OpaqueIdSchema, SemverSchema, Sha256DigestSchema } from "./common.js";
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

function uniqueValues(values: readonly string[], path: (string | number)[], context: z.RefinementCtx): void {
  if (new Set(values).size !== values.length) context.addIssue({ code: "custom", path, message: "duplicate_identity" });
}

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

export const WorkspaceDocumentDescriptorSchema = z
  .object({
    document_version: z.literal(1),
    document_id: DescriptorDocumentIdSchema,
    role: z.enum(["conversation", "source_document", "derived_document", "advanced_resource", "recovery"]),
    title: safePresentationText(80),
    description: safePresentationText(512),
    editable: z.boolean(),
    default_visibility: z.enum(["primary", "secondary", "advanced"]),
    model_access: z.enum(["none", "read_reference", "read_write_draft", "action_result"]),
    resource_id: DescriptorResourceIdSchema.nullable(),
    data_binding_id: HostBindingIdSchema.nullable(),
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
    input_schema_id: ContractSchemaIdSchema,
    result_schema_id: ContractSchemaIdSchema,
    confirmation: z.enum(["none", "owner_confirmation", "trusted_owner_confirmation"]),
    idempotency_policy: z.enum(["not_applicable", "optional", "required"]),
    model_exposure: z.enum(["hidden", "available"]),
    required_capabilities: z.array(CapabilityRequestSchema).max(8),
    required_inference_purposes: z.array(InferencePurposeRequestSchema).max(8),
  })
  .strict()
  .superRefine((value, context) => {
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
    const documentIds = new Set(value.documents.map((item) => item.document_id));
    if (!documentIds.has(value.default_document_id)) {
      context.addIssue({ code: "custom", path: ["default_document_id"], message: "default document must reference a declared workspace document" });
    }
    const resourceIds = new Set(value.resources.map((item) => item.resource_id));
    for (const [index, document] of value.documents.entries()) {
      if (document.resource_id !== null && !resourceIds.has(document.resource_id)) {
        context.addIssue({ code: "custom", path: ["documents", index, "resource_id"], message: "document resource must reference a declared app resource" });
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
    retention_policy: z.literal("retain_owner_data_remove_runtime_authority"),
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
export type AppPresentationProfile = z.infer<typeof AppPresentationProfileSchema>;
export type AppPresentationSet = z.infer<typeof AppPresentationSetSchema>;
export type ChatWorkspaceDescriptor = z.infer<typeof ChatWorkspaceDescriptorSchema>;
export type WorkspaceDocumentDescriptor = z.infer<typeof WorkspaceDocumentDescriptorSchema>;
export type AppResourceDescriptor = z.infer<typeof AppResourceDescriptorSchema>;
export type AppContextRequestDescriptor = z.infer<typeof AppContextRequestDescriptorSchema>;
export type AppActionDescriptor = z.infer<typeof AppActionDescriptorSchema>;
export type FirstPartyAppRegistration = z.infer<typeof FirstPartyAppRegistrationSchema>;
export type VerifiedFirstPartyPackage = z.infer<typeof VerifiedFirstPartyPackageSchema>;
export type ResolvedAppDescriptor = z.infer<typeof ResolvedAppDescriptorSchema>;
