import { z } from "zod";

import { ContractViolation, type ContractErrorCodeSchema } from "./errors.js";
import { HostBindingIdSchema, CanonicalPublisherIdSchema, CatalogPresentationSchema, ContractSchemaIdSchema } from "./app-registry.js";
import { PackageFileSchema, PackagePathSchema } from "./package.js";
import { SemverSchema, Sha256DigestSchema } from "./common.js";

type ContractErrorCode = z.infer<typeof ContractErrorCodeSchema>;

const packageIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const operationIdPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+@[1-9][0-9]{0,4}$/;
const exportNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;
const supportedCapabilityDependencyOperationIds = new Set(["web.search@1", "web.read@1"]);

const forbiddenManifestAuthorityKeys = new Set([
  "api_key",
  "container_id",
  "container_name",
  "credential",
  "endpoint",
  "endpoint_url",
  "handler",
  "handler_name",
  "host_handler",
  "host_import",
  "host_path",
  "import_name",
  "module",
  "module_path",
  "port",
  "ports",
  "private_binding",
  "raw_response",
  "secret_value",
  "service_name",
  "token",
  "url",
]);

const typedIssueCodes = new Set<ContractErrorCode>([
  "duplicate_identity",
  "forbidden_field",
  "identity_mismatch",
  "package_descriptor_invalid",
  "schema_validation_failed",
  "unsupported_target",
  "unsafe_binding",
  "unmanaged_secret",
  "missing_operation_contract",
  "authority_widening",
]);

export const PackageComponentManifestVersionSchema = z.literal(2);
export const PackageIdSchema = z.string().min(3).max(160).regex(packageIdPattern);
export const OperationIdSchema = z.string().min(5).max(128).regex(operationIdPattern);
export const PackageComponentKindSchema = z.enum(["app", "capability_provider", "dependency_service"]);
export const ComponentIdSchema = HostBindingIdSchema;
export const RuntimeTargetSchema = z.enum(["docker_linux_x64", "desktop_windows_x64", "desktop_macos_universal"]);

export const ComponentAdapterEntrypointSchema = z
  .object({
    package_path: PackagePathSchema,
    export_name: z.string().regex(exportNamePattern),
    abi: z.literal("braindrive-operation-adapter-v1"),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.package_path.startsWith("payload/")) {
      context.addIssue({ code: "custom", path: ["package_path"], message: "package_descriptor_invalid" });
    }
  });

export const OperationContractReferenceSchema = z
  .object({
    schema_id: ContractSchemaIdSchema,
    schema_version: z.number().int().positive().max(65_535),
    content_digest: Sha256DigestSchema,
  })
  .strict();

export const ProvidedOperationSchema = z
  .object({
    operation_id: OperationIdSchema,
    provider_component_id: ComponentIdSchema,
    adapter: ComponentAdapterEntrypointSchema,
    input_contract: OperationContractReferenceSchema,
    result_contract: OperationContractReferenceSchema,
    required_sidecars: z.array(ComponentIdSchema).max(8),
    result_classification: z.literal("generic_envelope"),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.input_contract.schema_id === value.result_contract.schema_id) {
      context.addIssue({ code: "custom", path: ["result_contract", "schema_id"], message: "missing_operation_contract" });
    }
    if (new Set(value.required_sidecars).size !== value.required_sidecars.length) {
      context.addIssue({ code: "custom", path: ["required_sidecars"], message: "duplicate_identity" });
    }
  });

export const CapabilityDependencySchema = z
  .object({
    operation_id: OperationIdSchema,
    requirement: z.enum(["required", "optional"]),
    unavailable_behavior: z.enum(["block_activation", "degrade_with_safe_status"]),
    provider_selection: z.literal("owner_or_admin_policy"),
    silent_install_or_switch: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (OperationIdSchema.safeParse(value.operation_id).success && !supportedCapabilityDependencyOperationIds.has(value.operation_id)) {
      context.addIssue({ code: "custom", path: ["operation_id"], message: "missing_operation_contract" });
    }
    if (value.requirement === "required" && value.unavailable_behavior !== "block_activation") {
      context.addIssue({ code: "custom", path: ["unavailable_behavior"], message: "package_descriptor_invalid" });
    }
    if (value.requirement === "optional" && value.unavailable_behavior !== "degrade_with_safe_status") {
      context.addIssue({ code: "custom", path: ["unavailable_behavior"], message: "package_descriptor_invalid" });
    }
  });

export const SidecarBindingPolicySchema = z
  .object({
    visibility: z.enum(["owning_app_private", "provider_adapter_only", "host_only"]),
    transport: z.enum(["container_internal", "loopback", "ipc"]),
    public_bind: z.literal(false),
    consumer_projection: z.literal("never"),
  })
  .strict();

const ContainerSidecarTargetSchema = z
  .object({
    target: RuntimeTargetSchema,
    runtime_kind: z.literal("container"),
    image: z.string().min(3).max(256).regex(/^[a-z0-9][a-z0-9./:_-]*$/),
    container_port: z.number().int().positive().max(65_535).default(8080),
    network: z.literal("private"),
    public_network: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.target !== "docker_linux_x64") {
      context.addIssue({ code: "custom", path: ["target"], message: "unsupported_target" });
    }
  });

const ProcessSidecarTargetSchema = z
  .object({
    target: RuntimeTargetSchema,
    runtime_kind: z.literal("packaged_process"),
    artifact_path: PackagePathSchema,
    entrypoint: PackagePathSchema,
    bind: z.enum(["loopback", "ipc"]),
    public_network: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.target === "docker_linux_x64") {
      context.addIssue({ code: "custom", path: ["target"], message: "unsupported_target" });
    }
  });

export const SidecarTargetSchema = z.discriminatedUnion("runtime_kind", [
  ContainerSidecarTargetSchema,
  ProcessSidecarTargetSchema,
]);

export const SidecarDescriptorSchema = z
  .object({
    sidecar_version: z.literal(1),
    component_id: ComponentIdSchema,
    display_name: z.string().min(1).max(80),
    owner_component_id: ComponentIdSchema,
    binding: SidecarBindingPolicySchema,
    targets: z.array(SidecarTargetSchema).min(1).max(3),
    health: z
      .object({
        kind: z.enum(["http_path", "process_exit", "ipc_ping"]),
        path: z.string().regex(/^\/[A-Za-z0-9._~/-]{0,128}$/).optional(),
        interval_ms: z.number().int().positive().max(60_000),
        timeout_ms: z.number().int().positive().max(30_000),
      })
      .strict(),
    lifecycle: z
      .object({
        start_policy: z.enum(["owner_explicit", "host_on_package_activation"]),
        restart_policy: z.enum(["never", "bounded"]),
        stop_on_disable: z.literal(true),
        cleanup_on_uninstall: z.literal(true),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.health.kind === "http_path" && !value.health.path) {
      context.addIssue({ code: "custom", path: ["health", "path"], message: "package_descriptor_invalid" });
    }
    if (new Set(value.targets.map((target) => target.target)).size !== value.targets.length) {
      context.addIssue({ code: "custom", path: ["targets"], message: "duplicate_identity" });
    }
  });

const BasePackageComponentSchema = z
  .object({
    component_id: ComponentIdSchema,
    display_name: z.string().min(1).max(80),
    lifecycle_actions: z.array(z.enum(["enable", "disable", "start", "stop", "restart", "update", "uninstall", "health"])).min(1).max(8),
    sidecars: z.array(ComponentIdSchema).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.lifecycle_actions).size !== value.lifecycle_actions.length) {
      context.addIssue({ code: "custom", path: ["lifecycle_actions"], message: "duplicate_identity" });
    }
    if (new Set(value.sidecars).size !== value.sidecars.length) {
      context.addIssue({ code: "custom", path: ["sidecars"], message: "duplicate_identity" });
    }
  });

export const PackageComponentSchema = z.discriminatedUnion("component_kind", [
  BasePackageComponentSchema.extend({
    component_kind: z.literal("app"),
    app_id: PackageIdSchema,
    route_key: z.string().min(2).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    launchable: z.literal(true),
    requested_capabilities: z.array(CapabilityDependencySchema).max(32),
  }).strict(),
  BasePackageComponentSchema.extend({
    component_kind: z.literal("capability_provider"),
    provider_id: PackageIdSchema,
    launchable: z.literal(false),
    provides: z.array(OperationIdSchema).min(1).max(32),
  }).strict(),
  BasePackageComponentSchema.extend({
    component_kind: z.literal("dependency_service"),
    service_id: PackageIdSchema,
    launchable: z.literal(false),
    provides: z.tuple([]),
  }).strict(),
]);

export const PackageSecretDeclarationSchema = z
  .object({
    secret_id: ComponentIdSchema,
    required: z.boolean(),
    storage: z.literal("braindrive_vault_reference"),
    runtime_delivery: z.literal("scoped_runtime_injection"),
    consumer_projection: z.literal("never"),
  })
  .strict();

export const PackageConfigurationSchema = z
  .object({
    configuration_version: z.literal(1),
    non_secret_settings_schema: OperationContractReferenceSchema.nullable(),
    secrets: z.array(PackageSecretDeclarationSchema).max(32),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.secrets.map((secret) => secret.secret_id)).size !== value.secrets.length) {
      context.addIssue({ code: "custom", path: ["secrets"], message: "duplicate_identity" });
    }
  });

export const PackagePermissionPolicySchema = z
  .object({
    permission_policy_version: z.literal(1),
    network: z.array(z.enum(["public_https", "loopback_to_own_sidecars", "provider_upstream_https"])).max(8),
    filesystem: z.array(z.enum(["package_read", "app_storage", "declared_cache"])).max(8),
    process: z.array(z.enum(["supervised_sidecar"])).max(4),
    credentials: z.array(ComponentIdSchema).max(32),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [key, entries] of Object.entries(value) as [string, unknown][]) {
      if (key.endsWith("_version")) continue;
      if (Array.isArray(entries) && new Set(entries).size !== entries.length) {
        context.addIssue({ code: "custom", path: [key], message: "duplicate_identity" });
      }
    }
  });

export const PackageRetentionPolicySchema = z
  .object({
    retention_policy_version: z.literal(1),
    runtime_binding: z.literal("ephemeral_remove_on_stop_or_uninstall"),
    sidecar_runtime_state: z.literal("remove_on_uninstall"),
    provider_cache: z.literal("delete_by_default_unless_owner_preserves"),
    diagnostics: z.literal("bounded_redacted"),
    evidence: z.literal("content_free_bounded"),
  })
  .strict();

export const PackageDiagnosticsPolicySchema = z
  .object({
    diagnostics_policy_version: z.literal(1),
    store_raw_provider_payloads: z.literal(false),
    store_private_bindings: z.literal(false),
    store_host_paths: z.literal(false),
    store_credentials: z.literal(false),
    durable_projection: z.literal("safe_status_and_typed_failures_only"),
  })
  .strict();

export const PackageEvidencePolicySchema = z
  .object({
    evidence_policy_version: z.literal(1),
    required_evidence: z.array(z.enum(["schema_conformance", "negative_manifest_cases", "unsafe_binding_denial", "secret_redaction_scan"])).min(1).max(8),
    stale_on: z.array(z.enum([
      "manifest_change",
      "adapter_change",
      "sidecar_target_change",
      "runtime_target_change",
      "network_policy_change",
      "permission_change",
      "operation_contract_change",
      "provider_version_change",
      "security_boundary_change",
      "retention_policy_change",
      "diagnostics_policy_change",
    ])).min(1).max(11),
    durable_evidence_content: z.literal("content_free_no_endpoints_no_secrets"),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.required_evidence).size !== value.required_evidence.length) {
      context.addIssue({ code: "custom", path: ["required_evidence"], message: "duplicate_identity" });
    }
    if (new Set(value.stale_on).size !== value.stale_on.length) {
      context.addIssue({ code: "custom", path: ["stale_on"], message: "duplicate_identity" });
    }
  });

export const PackageComponentManifestSchema = z
  .object({
    manifest_version: PackageComponentManifestVersionSchema,
    package_id: PackageIdSchema,
    publisher_id: CanonicalPublisherIdSchema,
    package_version: SemverSchema,
    package_kind: z.array(PackageComponentKindSchema).min(1).max(3),
    catalog: CatalogPresentationSchema,
    archive: z
      .object({
        format: z.literal("zip"),
        profile: z.literal("braindrive-package-v2"),
        compression: z.literal("store"),
        layout_version: z.literal(1),
        manifest_path: z.literal("manifest.json"),
        undeclared_entries: z.literal("reject"),
        links_and_device_nodes: z.literal("reject"),
      })
      .strict(),
    files: z.array(PackageFileSchema).min(3).max(512),
    components: z.array(PackageComponentSchema).min(1).max(64),
    sidecars: z.array(SidecarDescriptorSchema).max(32),
    provided_operations: z.array(ProvidedOperationSchema).max(64),
    capability_dependencies: z.array(CapabilityDependencySchema).max(64),
    configuration: PackageConfigurationSchema,
    permissions: PackagePermissionPolicySchema,
    retention_policy: PackageRetentionPolicySchema,
    diagnostics: PackageDiagnosticsPolicySchema,
    evidence: PackageEvidencePolicySchema,
  })
  .strict()
  .superRefine((value, context) => {
    rejectForbiddenAuthorityKeys(value, context);
    if (!value.package_id.startsWith(`${value.publisher_id}.`)) {
      context.addIssue({ code: "custom", path: ["package_id"], message: "identity_mismatch" });
    }
    unique(value.package_kind, ["package_kind"], context);
    unique(value.files.map((file) => file.path.toLowerCase()), ["files"], context);
    unique(value.components.map((component) => component.component_id), ["components"], context);
    unique(value.sidecars.map((sidecar) => sidecar.component_id), ["sidecars"], context);
    unique(value.provided_operations.map((operation) => operation.operation_id), ["provided_operations"], context);
    unique(value.capability_dependencies.map((dependency) => dependency.operation_id), ["capability_dependencies"], context);

    const filesByPath = new Map(value.files.map((file) => [file.path, file]));
    for (const file of value.files) {
      if (!/^(?:payload|provenance|sbom)\//.test(file.path)) {
        context.addIssue({ code: "custom", path: ["files"], message: "package_descriptor_invalid" });
      }
    }
    const componentsById = new Map(value.components.map((component) => [component.component_id, component]));
    const sidecarsById = new Map(value.sidecars.map((sidecar) => [sidecar.component_id, sidecar]));
    for (const kind of value.package_kind) {
      if (!value.components.some((component) => component.component_kind === kind)) {
        context.addIssue({ code: "custom", path: ["package_kind"], message: "package_descriptor_invalid" });
      }
    }
    for (const [index, component] of value.components.entries()) {
      if (!value.package_kind.includes(component.component_kind)) {
        context.addIssue({ code: "custom", path: ["components", index, "component_kind"], message: "package_descriptor_invalid" });
      }
      if (component.component_kind === "app") {
        unique(component.requested_capabilities.map((dependency) => dependency.operation_id), ["components", index, "requested_capabilities"], context);
      }
    }
    for (const [index, component] of value.components.entries()) {
      for (const [sidecarIndex, sidecarId] of component.sidecars.entries()) {
        const sidecar = sidecarsById.get(sidecarId);
        if (!sidecar) {
          context.addIssue({ code: "custom", path: ["components", index, "sidecars", sidecarIndex], message: "package_descriptor_invalid" });
          continue;
        }
        if (sidecar.owner_component_id !== component.component_id) {
          context.addIssue({ code: "custom", path: ["sidecars"], message: "identity_mismatch" });
        }
      }
    }
    for (const [index, sidecar] of value.sidecars.entries()) {
      const owner = componentsById.get(sidecar.owner_component_id);
      if (!owner) {
        context.addIssue({ code: "custom", path: ["sidecars", index, "owner_component_id"], message: "identity_mismatch" });
      }
      if (owner?.component_kind === "app" && sidecar.binding.visibility !== "owning_app_private") {
        context.addIssue({ code: "custom", path: ["sidecars", index, "binding", "visibility"], message: "unsafe_binding" });
      }
      if (owner?.component_kind === "capability_provider" && sidecar.binding.visibility !== "provider_adapter_only") {
        context.addIssue({ code: "custom", path: ["sidecars", index, "binding", "visibility"], message: "unsafe_binding" });
      }
      for (const [targetIndex, target] of sidecar.targets.entries()) {
        if (target.runtime_kind === "packaged_process") {
          const artifact = filesByPath.get(target.artifact_path);
          const entrypoint = filesByPath.get(target.entrypoint);
          if (!artifact || !entrypoint || entrypoint.mode !== "executable") {
            context.addIssue({ code: "custom", path: ["sidecars", index, "targets", targetIndex], message: "package_descriptor_invalid" });
          }
        }
      }
    }
    const providerIds = new Set(value.components.filter((component) => component.component_kind === "capability_provider").map((component) => component.component_id));
    const declaredOperationsByProvider = new Map(
      value.components
        .filter((component): component is Extract<z.infer<typeof PackageComponentSchema>, { component_kind: "capability_provider" }> => component.component_kind === "capability_provider")
        .map((component) => [component.component_id, new Set(component.provides)]),
    );
    for (const [index, operation] of value.provided_operations.entries()) {
      if (!providerIds.has(operation.provider_component_id)) {
        context.addIssue({ code: "custom", path: ["provided_operations", index, "provider_component_id"], message: "identity_mismatch" });
      }
      if (!declaredOperationsByProvider.get(operation.provider_component_id)?.has(operation.operation_id)) {
        context.addIssue({ code: "custom", path: ["provided_operations", index, "operation_id"], message: "missing_operation_contract" });
      }
      if (!filesByPath.has(operation.adapter.package_path)) {
        context.addIssue({ code: "custom", path: ["provided_operations", index, "adapter", "package_path"], message: "package_descriptor_invalid" });
      }
      for (const [sidecarIndex, sidecarId] of operation.required_sidecars.entries()) {
        if (!sidecarsById.has(sidecarId)) {
          context.addIssue({ code: "custom", path: ["provided_operations", index, "required_sidecars", sidecarIndex], message: "package_descriptor_invalid" });
        }
      }
    }
    for (const component of value.components) {
      if (component.component_kind === "capability_provider") {
        for (const operationId of component.provides) {
          if (!value.provided_operations.some((operation) => operation.provider_component_id === component.component_id && operation.operation_id === operationId)) {
            context.addIssue({ code: "custom", path: ["provided_operations"], message: "missing_operation_contract" });
          }
        }
      }
    }
    const declaredSecrets = new Set(value.configuration.secrets.map((secret) => secret.secret_id));
    for (const credential of value.permissions.credentials) {
      if (!declaredSecrets.has(credential)) {
        context.addIssue({ code: "custom", path: ["permissions", "credentials"], message: "unmanaged_secret" });
      }
    }
  });

export type PackageComponentManifest = z.infer<typeof PackageComponentManifestSchema>;
export type PackageComponent = z.infer<typeof PackageComponentSchema>;
export type SidecarDescriptor = z.infer<typeof SidecarDescriptorSchema>;
export type ProvidedOperation = z.infer<typeof ProvidedOperationSchema>;
export type CapabilityDependency = z.infer<typeof CapabilityDependencySchema>;

export function parsePackageComponentManifestForConformance(candidate: unknown): PackageComponentManifest {
  const result = PackageComponentManifestSchema.safeParse(candidate);
  if (result.success) return result.data;
  const code = inferPackageComponentFailureCode(result.error.issues);
  throw new ContractViolation(code, `Package component manifest violates the ${code} gate`);
}

function inferPackageComponentFailureCode(issues: z.ZodIssue[]): ContractErrorCode {
  for (const issue of issues) {
    if (issue.code === "unrecognized_keys" && issue.keys.some((key) => forbiddenManifestAuthorityKeys.has(key))) {
      return "forbidden_field";
    }
    if (typedIssueCodes.has(issue.message as ContractErrorCode)) return issue.message as ContractErrorCode;
    const path = issue.path.join(".");
    if (path.includes("silent_install_or_switch") || path.includes("provider_selection")) return "authority_widening";
    if (path.includes("public_bind") || path.includes("binding")) return "unsafe_binding";
    if (path.includes("target")) return "unsupported_target";
    if (path.includes("secrets") || path.includes("credentials")) return "unmanaged_secret";
    if (path.includes("provided_operations") || path.includes("input_contract") || path.includes("result_contract")) return "missing_operation_contract";
  }
  return "schema_validation_failed";
}

function unique(values: readonly string[], path: (string | number)[], context: z.RefinementCtx): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path, message: "duplicate_identity" });
  }
}

function rejectForbiddenAuthorityKeys(value: unknown, context: z.RefinementCtx, path: (string | number)[] = []): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenAuthorityKeys(item, context, [...path, index]));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenManifestAuthorityKeys.has(key)) {
      context.addIssue({ code: "custom", path: [...path, key], message: "forbidden_field" });
    }
    rejectForbiddenAuthorityKeys(item, context, [...path, key]);
  }
}
