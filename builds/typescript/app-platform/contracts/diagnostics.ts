import { z } from "zod";

import { OpaqueIdSchema, Sha256DigestSchema, TimestampSchema } from "./common.js";
import { ComponentIdSchema, OperationIdSchema, PackageIdSchema, RuntimeTargetSchema } from "./package-components.js";

export const PACKAGE_DIAGNOSTICS_RETENTION_POLICY_ID = "package-provider-diagnostics-v1";
export const PACKAGE_DIAGNOSTICS_RETENTION_DAYS = 14;

export const PackageDiagnosticsRetentionPolicySchema = z.object({
  policy_id: z.literal(PACKAGE_DIAGNOSTICS_RETENTION_POLICY_ID),
  retained_event_classes: z.tuple([
    z.literal("operation"),
    z.literal("sidecar_lifecycle"),
    z.literal("qualification_stale"),
  ]),
  local_retention_days: z.literal(PACKAGE_DIAGNOSTICS_RETENTION_DAYS),
  raw_page_content: z.literal("excluded_ephemeral"),
  raw_provider_responses: z.literal("excluded"),
  raw_queries: z.literal("excluded"),
  prompts: z.literal("excluded"),
  credentials: z.literal("excluded"),
  host_paths: z.literal("excluded"),
  provider_endpoints: z.literal("excluded"),
  support_bundle_export: z.literal("safe_projection_only"),
  delivery_evidence: z.literal("separate_sanitized_bundle"),
}).strict();

export const PACKAGE_DIAGNOSTICS_RETENTION_POLICY = Object.freeze(PackageDiagnosticsRetentionPolicySchema.parse({
  policy_id: PACKAGE_DIAGNOSTICS_RETENTION_POLICY_ID,
  retained_event_classes: ["operation", "sidecar_lifecycle", "qualification_stale"],
  local_retention_days: PACKAGE_DIAGNOSTICS_RETENTION_DAYS,
  raw_page_content: "excluded_ephemeral",
  raw_provider_responses: "excluded",
  raw_queries: "excluded",
  prompts: "excluded",
  credentials: "excluded",
  host_paths: "excluded",
  provider_endpoints: "excluded",
  support_bundle_export: "safe_projection_only",
  delivery_evidence: "separate_sanitized_bundle",
}));

export const PACKAGE_SUPPORT_BUNDLE_DIAGNOSTICS_STATUS = Object.freeze({
  status: "safe_projection_only",
  raw_provider_payload_export: "not_claimed",
  reason: "Support bundles may include only bounded generic diagnostic projections; raw provider payload exports require separate allowlisted review.",
} as const);

const DiagnosticRetentionFieldsSchema = z.object({
  retention_policy_id: z.literal(PACKAGE_DIAGNOSTICS_RETENTION_POLICY_ID),
  retention_expires_after_days: z.literal(PACKAGE_DIAGNOSTICS_RETENTION_DAYS),
}).strict();

const SafeDiagnosticIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/)
  .refine((value) => !UNSAFE_DIAGNOSTIC_TEXT_PATTERN.test(value), "diagnostic identifier contains unsafe detail");

const SafeDiagnosticCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/)
  .refine((value) => !UNSAFE_DIAGNOSTIC_TEXT_PATTERN.test(value), "diagnostic code contains unsafe detail");

export const PackageOperationReceiptStatusSchema = z.enum([
  "success",
  "partial",
  "failure",
  "unavailable",
  "cancelled",
]);

export const PackageOperationProviderExecutionSchema = z.enum([
  "not_executed",
  "executed",
]);

export const PackageDiagnosticUsageSchema = z.object({
  call_count: z.number().int().min(0).max(1),
  bytes_class: z.enum(["none", "small", "medium", "large", "limit"]).nullable(),
}).strict();

export const PackageOperationReceiptDiagnosticEventSchema = z
  .object({
    diagnostic_version: z.literal(1),
    event_type: z.literal("operation"),
    occurred_at: TimestampSchema,
    package_id: PackageIdSchema,
    installation_id: OpaqueIdSchema.nullable(),
    package_version: SafeDiagnosticIdentifierSchema,
    package_digest: Sha256DigestSchema.nullable(),
    provider_component_id: ComponentIdSchema,
    provider_profile_class: z.literal("capability_provider"),
    provider_profile_id: SafeDiagnosticIdentifierSchema,
    provider_selection: z.enum(["single_provider", "owner_or_admin_policy", "not_recorded"]),
    provider_execution: PackageOperationProviderExecutionSchema,
    operation_id: OperationIdSchema,
    request_id: OpaqueIdSchema,
    run_id: OpaqueIdSchema,
    status: PackageOperationReceiptStatusSchema,
    failure_code: SafeDiagnosticCodeSchema.nullable(),
    result_count: z.number().int().min(0).max(100),
    completed_item_count: z.number().int().min(0).max(100),
    limit_profile_id: SafeDiagnosticIdentifierSchema,
    usage: PackageDiagnosticUsageSchema,
    duration_ms: z.number().int().min(0).max(60_000).nullable(),
  })
  .merge(DiagnosticRetentionFieldsSchema)
  .strict();

export const PackageSidecarLifecycleDiagnosticEventSchema = z
  .object({
    diagnostic_version: z.literal(1),
    event_type: z.literal("sidecar_lifecycle"),
    sequence: z.number().int().positive(),
    package_id: PackageIdSchema,
    installation_id: OpaqueIdSchema.nullable(),
    component_id: ComponentIdSchema,
    owner_component_id: ComponentIdSchema,
    action: z.enum(["start", "readiness", "health", "stop", "restart", "uninstall", "cleanup", "binding_rotated", "binding_denied"]),
    state: z.enum(["starting", "running", "stopped", "uninstalled", "unavailable", "failed"]),
    health: z.enum(["unknown", "healthy", "unhealthy"]),
    target: RuntimeTargetSchema.nullable(),
    runtime_kind: z.enum(["container", "packaged_process"]).nullable(),
    binding_class: z.enum(["container_internal_authenticated", "loopback_authenticated", "ipc_authenticated"]).nullable(),
    restart_attempt: z.number().int().min(0).max(3),
    error_code: SafeDiagnosticCodeSchema.nullable(),
    occurred_at: TimestampSchema,
  })
  .merge(DiagnosticRetentionFieldsSchema)
  .strict();

export const PackageQualificationChangeClassSchema = z.enum([
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
  "documentation_only",
  "evidence_only",
  "unrelated",
]);

export const PackageQualificationEvidenceClassSchema = z.enum([
  "schema_conformance",
  "provider_qualification",
  "runtime_target_qualification",
  "operation_contract_conformance",
  "security_redaction_scan",
  "dependent_product_results",
  "support_bundle_review",
]);

export const PackageQualificationDiagnosticEventSchema = z
  .object({
    diagnostic_version: z.literal(1),
    event_type: z.literal("qualification_stale"),
    occurred_at: TimestampSchema,
    package_id: PackageIdSchema,
    provider_component_id: ComponentIdSchema.nullable(),
    change_class: PackageQualificationChangeClassSchema,
    qualification_status: z.enum(["current", "stale"]),
    requires_rerun: z.boolean(),
    affected_evidence: z.array(PackageQualificationEvidenceClassSchema).max(7),
  })
  .merge(DiagnosticRetentionFieldsSchema)
  .strict();

export const PackageDiagnosticEventSchema = z.discriminatedUnion("event_type", [
  PackageOperationReceiptDiagnosticEventSchema,
  PackageSidecarLifecycleDiagnosticEventSchema,
  PackageQualificationDiagnosticEventSchema,
]);

export type PackageDiagnosticsRetentionPolicy = z.infer<typeof PackageDiagnosticsRetentionPolicySchema>;
export type PackageDiagnosticEvent = z.infer<typeof PackageDiagnosticEventSchema>;
export type PackageOperationReceiptDiagnosticEvent = z.infer<typeof PackageOperationReceiptDiagnosticEventSchema>;
export type PackageSidecarLifecycleDiagnosticEvent = z.infer<typeof PackageSidecarLifecycleDiagnosticEventSchema>;
export type PackageQualificationDiagnosticEvent = z.infer<typeof PackageQualificationDiagnosticEventSchema>;
export type PackageQualificationChangeClass = z.infer<typeof PackageQualificationChangeClassSchema>;
export type PackageQualificationEvidenceClass = z.infer<typeof PackageQualificationEvidenceClassSchema>;

export interface PackageDiagnosticSink {
  record(event: PackageDiagnosticEvent): void;
}

export function createPackageOperationReceiptDiagnostic(options: {
  packageId: string;
  installationId?: string | null;
  packageVersion: string;
  packageDigest?: `sha256:${string}` | null;
  providerComponentId: string;
  providerProfileId: string;
  providerSelection?: "single_provider" | "owner_or_admin_policy" | "not_recorded";
  providerExecution?: z.infer<typeof PackageOperationProviderExecutionSchema>;
  operationId: string;
  requestId: string;
  runId: string;
  status: z.infer<typeof PackageOperationReceiptStatusSchema>;
  failureCode?: string | null;
  resultCount: number;
  completedItemCount: number;
  occurredAt: string;
  limitProfileId: string;
  usage: z.infer<typeof PackageDiagnosticUsageSchema>;
  durationMs?: number | null;
  unsafeInput?: unknown;
  unsafeProviderResult?: unknown;
}): PackageOperationReceiptDiagnosticEvent {
  return PackageOperationReceiptDiagnosticEventSchema.parse({
    diagnostic_version: 1,
    event_type: "operation",
    occurred_at: options.occurredAt,
    package_id: options.packageId,
    installation_id: options.installationId ?? null,
    package_version: options.packageVersion,
    package_digest: options.packageDigest ?? null,
    provider_component_id: options.providerComponentId,
    provider_profile_class: "capability_provider",
    provider_profile_id: options.providerProfileId,
    provider_selection: options.providerSelection ?? "not_recorded",
    provider_execution: options.providerExecution ?? (options.usage.call_count > 0 ? "executed" : "not_executed"),
    operation_id: options.operationId,
    request_id: options.requestId,
    run_id: options.runId,
    status: options.status,
    failure_code: safeDiagnosticCode(options.failureCode, null),
    result_count: options.resultCount,
    completed_item_count: options.completedItemCount,
    limit_profile_id: options.limitProfileId,
    usage: options.usage,
    duration_ms: options.durationMs ?? null,
    retention_policy_id: PACKAGE_DIAGNOSTICS_RETENTION_POLICY_ID,
    retention_expires_after_days: PACKAGE_DIAGNOSTICS_RETENTION_DAYS,
  });
}

export function createPackageSidecarLifecycleDiagnostic(options: {
  sequence: number;
  packageId: string;
  installationId?: string | null;
  componentId: string;
  ownerComponentId: string;
  action: PackageSidecarLifecycleDiagnosticEvent["action"];
  state: PackageSidecarLifecycleDiagnosticEvent["state"];
  health: PackageSidecarLifecycleDiagnosticEvent["health"];
  target: PackageSidecarLifecycleDiagnosticEvent["target"];
  runtimeKind: PackageSidecarLifecycleDiagnosticEvent["runtime_kind"];
  bindingClass: PackageSidecarLifecycleDiagnosticEvent["binding_class"];
  restartAttempt: number;
  errorCode?: string | null;
  occurredAt: string;
}): PackageSidecarLifecycleDiagnosticEvent {
  return PackageSidecarLifecycleDiagnosticEventSchema.parse({
    diagnostic_version: 1,
    event_type: "sidecar_lifecycle",
    sequence: options.sequence,
    package_id: options.packageId,
    installation_id: options.installationId ?? null,
    component_id: options.componentId,
    owner_component_id: options.ownerComponentId,
    action: options.action,
    state: options.state,
    health: options.health,
    target: options.target,
    runtime_kind: options.runtimeKind,
    binding_class: options.bindingClass,
    restart_attempt: options.restartAttempt,
    error_code: safeDiagnosticCode(options.errorCode, null),
    occurred_at: options.occurredAt,
    retention_policy_id: PACKAGE_DIAGNOSTICS_RETENTION_POLICY_ID,
    retention_expires_after_days: PACKAGE_DIAGNOSTICS_RETENTION_DAYS,
  });
}

export function markPackageQualificationStale(options: {
  changedAt: string;
  packageId: string;
  providerComponentId?: string | null;
  changeClass: PackageQualificationChangeClass;
}): PackageQualificationDiagnosticEvent {
  const affectedEvidence = affectedEvidenceForChange(options.changeClass);
  return PackageQualificationDiagnosticEventSchema.parse({
    diagnostic_version: 1,
    event_type: "qualification_stale",
    occurred_at: options.changedAt,
    package_id: options.packageId,
    provider_component_id: options.providerComponentId ?? null,
    change_class: options.changeClass,
    qualification_status: affectedEvidence.length > 0 ? "stale" : "current",
    requires_rerun: affectedEvidence.length > 0,
    affected_evidence: affectedEvidence,
    retention_policy_id: PACKAGE_DIAGNOSTICS_RETENTION_POLICY_ID,
    retention_expires_after_days: PACKAGE_DIAGNOSTICS_RETENTION_DAYS,
  });
}

export function createMemoryPackageDiagnosticSink(options: { maxEvents?: number } = {}) {
  const maxEvents = Math.max(1, options.maxEvents ?? 128);
  const retained: PackageDiagnosticEvent[] = [];
  return {
    record(event: PackageDiagnosticEvent): void {
      retained.push(PackageDiagnosticEventSchema.parse(event));
      if (retained.length > maxEvents) retained.splice(0, retained.length - maxEvents);
    },
    events(): readonly PackageDiagnosticEvent[] {
      return [...retained];
    },
    clear(): void {
      retained.splice(0, retained.length);
    },
  } satisfies PackageDiagnosticSink & {
    events(): readonly PackageDiagnosticEvent[];
    clear(): void;
  };
}

function affectedEvidenceForChange(changeClass: PackageQualificationChangeClass): PackageQualificationEvidenceClass[] {
  if (changeClass === "documentation_only" || changeClass === "evidence_only" || changeClass === "unrelated") return [];
  if (changeClass === "sidecar_target_change" || changeClass === "runtime_target_change") {
    return ["runtime_target_qualification", "provider_qualification", "dependent_product_results"];
  }
  if (changeClass === "network_policy_change" || changeClass === "permission_change" || changeClass === "security_boundary_change") {
    return ["schema_conformance", "provider_qualification", "security_redaction_scan", "support_bundle_review", "dependent_product_results"];
  }
  if (changeClass === "operation_contract_change") {
    return ["schema_conformance", "operation_contract_conformance", "provider_qualification", "dependent_product_results"];
  }
  if (changeClass === "retention_policy_change" || changeClass === "diagnostics_policy_change") {
    return ["schema_conformance", "security_redaction_scan", "support_bundle_review"];
  }
  return ["schema_conformance", "operation_contract_conformance", "provider_qualification", "dependent_product_results"];
}

function safeDiagnosticCode(value: string | null | undefined, fallback: string | null): string | null {
  if (!value) return fallback;
  const candidate = value.trim();
  return /^[a-z0-9_]{1,64}$/.test(candidate) && !UNSAFE_DIAGNOSTIC_TEXT_PATTERN.test(candidate) ? candidate : fallback ?? "unknown";
}

const UNSAFE_DIAGNOSTIC_TEXT_PATTERN =
  /(?:https?:|localhost|127\.0\.0\.1|0\.0\.0\.0|\bport\b|credential|secret|vault|api[_-]?key|authorization|bearer|cookie|token|prompt|\/(?:home|tmp|etc|var|Users)\/|\\Users\\|raw_provider|owner-private|endpoint)/i;
