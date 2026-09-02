import { z } from "zod";

import { OpaqueIdSchema, Sha256DigestSchema, TimestampSchema } from "./common.js";
import { PackagePathSchema, SupervisorPolicySchema } from "./package.js";
import { ComponentIdSchema, PackageIdSchema, RuntimeTargetSchema } from "./package-components.js";

export const SupervisorProtocolVersionSchema = z.literal(1);

export const SupervisorRuntimeStateSchema = z.enum([
  "starting",
  "ready",
  "unhealthy",
  "backoff",
  "restarting",
  "failed_recoverable",
  "stopped",
]);

export const SupervisorErrorCodeSchema = z.enum([
  "descriptor_invalid",
  "runtime_conflict",
  "start_failed",
  "readiness_failed",
  "health_failed",
  "registration_failed",
  "stop_timeout",
  "ambiguous_runtime_state",
  "restart_exhausted",
  "token_revocation_failed",
  "orphan_cleanup_failed",
]);

const EnvironmentKeySchema = z.enum([
  "BRAINDRIVE_APP_CONNECTION_TOKEN",
  "BRAINDRIVE_APP_ID",
  "BRAINDRIVE_INSTALLATION_ID",
  "BRAINDRIVE_PACKAGE_DIGEST",
  "BRAINDRIVE_ENDPOINT_BIND",
]);

export const RuntimeDescriptorSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    runtime_kind: z.enum(["container", "packaged_node"]),
    app_id: z.string().min(3).max(128).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
    installation_id: OpaqueIdSchema,
    package_digest: Sha256DigestSchema,
    grant_id: OpaqueIdSchema,
    verified_entrypoint: PackagePathSchema,
    arguments: z.tuple([]),
    environment_keys: z.array(EnvironmentKeySchema).min(1).max(5),
    package_root_ref: OpaqueIdSchema,
    cache_root_ref: OpaqueIdSchema,
    endpoint_policy: z
      .object({
        transport: z.enum(["container_internal", "loopback"]),
        authentication: z.literal("per_installation_token"),
        public_bind_allowed: z.literal(false),
      })
      .strict(),
    resource_policy_version: z.literal(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.environment_keys).size !== value.environment_keys.length) {
      context.addIssue({ code: "custom", message: "duplicate_identity" });
    }
    if (
      (value.runtime_kind === "container" && value.endpoint_policy.transport !== "container_internal") ||
      (value.runtime_kind === "packaged_node" && value.endpoint_policy.transport !== "loopback")
    ) {
      context.addIssue({ code: "custom", message: "runtime kind and endpoint transport disagree" });
    }
  });

export const RuntimeIdentitySchema = z
  .object({
    runtime_id: OpaqueIdSchema,
    installation_id: OpaqueIdSchema,
    package_digest: Sha256DigestSchema,
    runtime_generation: z.number().int().positive(),
    endpoint_token_generation: z.number().int().positive(),
  })
  .strict();

export const EndpointDescriptorSchema = z
  .object({
    endpoint_id: OpaqueIdSchema,
    transport: z.enum(["container_internal", "loopback"]),
    address: z.string().regex(/^http:\/\/(?:127\.0\.0\.1|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?):(?:[1-9]\d{0,4})$/),
    authentication: z.literal("per_installation_token"),
    endpoint_token_generation: z.number().int().positive(),
    public_bind: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    const loopbackAddress = value.address.startsWith("http://127.0.0.1:");
    if ((value.transport === "loopback") !== loopbackAddress) {
      context.addIssue({ code: "custom", message: "endpoint address and transport disagree" });
    }
    const port = Number(value.address.slice(value.address.lastIndexOf(":") + 1));
    if (port > 65_535) {
      context.addIssue({ code: "custom", message: "endpoint port is outside the TCP range" });
    }
  });

export const SupervisorStartRequestSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    operation_id: OpaqueIdSchema,
    runtime_role: z.enum(["active", "candidate"]).optional(),
    descriptor: RuntimeDescriptorSchema,
    policy: SupervisorPolicySchema,
    requested_at: TimestampSchema,
  })
  .strict();

export const SupervisorStartResultSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    outcome: z.enum(["started", "already_running", "rejected", "failed"]),
    state: SupervisorRuntimeStateSchema,
    runtime: RuntimeIdentitySchema.nullable(),
    error_code: SupervisorErrorCodeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const success = value.outcome === "started" || value.outcome === "already_running";
    if (success !== (value.runtime !== null) || success !== (value.error_code === null)) {
      context.addIssue({ code: "custom", message: "supervisor start outcome is ambiguous" });
    }
    if (success && !["starting", "ready"].includes(value.state)) {
      context.addIssue({ code: "custom", message: "successful start has an invalid runtime state" });
    }
  });

export const SupervisorReadyRequestSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    operation_id: OpaqueIdSchema,
    runtime: RuntimeIdentitySchema,
    deadline_at: TimestampSchema,
  })
  .strict();

export const SupervisorReadyResultSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    outcome: z.enum(["ready", "timeout", "unhealthy", "failed"]),
    state: SupervisorRuntimeStateSchema,
    runtime: RuntimeIdentitySchema,
    endpoint: EndpointDescriptorSchema.nullable(),
    error_code: SupervisorErrorCodeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const ready = value.outcome === "ready";
    if (ready !== (value.endpoint !== null) || ready !== (value.error_code === null) || ready !== (value.state === "ready")) {
      context.addIssue({ code: "custom", message: "supervisor readiness outcome is ambiguous" });
    }
  });

export const SupervisorHealthRequestSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    runtime: RuntimeIdentitySchema,
    checked_at: TimestampSchema,
  })
  .strict();

export const SupervisorHealthResultSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    state: SupervisorRuntimeStateSchema,
    runtime: RuntimeIdentitySchema,
    restart_attempt: z.number().int().min(0).max(3),
    next_backoff_ms: z.union([z.literal(1_000), z.literal(2_000), z.literal(4_000)]).nullable(),
    error_code: SupervisorErrorCodeSchema.nullable(),
  })
  .strict();

export const SupervisorRegistrationRequestSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    operation_id: OpaqueIdSchema,
    runtime: RuntimeIdentitySchema,
    endpoint: EndpointDescriptorSchema,
    connection_id: OpaqueIdSchema,
  })
  .strict();

export const SupervisorRegistrationResultSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    outcome: z.enum(["registered", "already_registered", "rejected", "failed"]),
    registration_id: OpaqueIdSchema.nullable(),
    error_code: SupervisorErrorCodeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const success = value.outcome === "registered" || value.outcome === "already_registered";
    if (success !== (value.registration_id !== null) || success !== (value.error_code === null)) {
      context.addIssue({ code: "custom", message: "supervisor registration outcome is ambiguous" });
    }
  });

export const SupervisorStopRequestSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    operation_id: OpaqueIdSchema,
    runtime: RuntimeIdentitySchema,
    reason: z.enum(["disable", "update", "rollback", "uninstall", "revocation", "shutdown", "reconcile"]),
    grace_deadline_at: TimestampSchema,
  })
  .strict();

export const SupervisorStopResultSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    outcome: z.enum(["stopped_gracefully", "stopped_forced", "already_stopped", "ambiguous"]),
    termination_acknowledged: z.boolean(),
    runtime: RuntimeIdentitySchema,
    error_code: SupervisorErrorCodeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const ambiguous = value.outcome === "ambiguous";
    if (ambiguous === value.termination_acknowledged || ambiguous !== (value.error_code !== null)) {
      context.addIssue({ code: "custom", message: "supervisor stop outcome is ambiguous" });
    }
  });

export const SupervisorTokenRevocationRequestSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    operation_id: OpaqueIdSchema,
    installation_id: OpaqueIdSchema,
    runtime_id: OpaqueIdSchema.nullable(),
    operation_scope_id: OpaqueIdSchema.nullable(),
    prior_token_generation: z.number().int().positive(),
  })
  .strict();

export const SupervisorTokenRevocationResultSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    operation_id: OpaqueIdSchema,
    installation_id: OpaqueIdSchema,
    runtime_id: OpaqueIdSchema.nullable(),
    operation_scope_id: OpaqueIdSchema.nullable(),
    prior_token_generation: z.number().int().positive(),
    next_token_generation: z.number().int().positive(),
    outcome: z.enum(["revoked", "already_revoked", "failed"]),
    error_code: SupervisorErrorCodeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.next_token_generation <= value.prior_token_generation) {
      context.addIssue({ code: "custom", message: "token revocation generation must increase" });
    }
    if ((value.outcome === "failed") !== (value.error_code !== null)) {
      context.addIssue({ code: "custom", message: "token revocation outcome is ambiguous" });
    }
  });

export const SupervisorCleanupRequestSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    operation_id: OpaqueIdSchema,
    installation_id: OpaqueIdSchema,
    expected_runtime_id: OpaqueIdSchema.nullable(),
    observed_runtime_ids: z.array(OpaqueIdSchema).max(4),
    requested_at: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.observed_runtime_ids).size !== value.observed_runtime_ids.length) {
      context.addIssue({ code: "custom", message: "duplicate_identity" });
    }
  });

export const SupervisorCleanupResultSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    operation_id: OpaqueIdSchema,
    installation_id: OpaqueIdSchema,
    outcome: z.enum(["no_orphans", "cleaned", "ambiguous", "failed"]),
    cleaned_runtime_ids: z.array(OpaqueIdSchema).max(4),
    remaining_runtime_count: z.number().int().min(0).max(1),
    registration_count: z.number().int().min(0).max(1),
    tokens_revoked: z.boolean(),
    error_code: SupervisorErrorCodeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.cleaned_runtime_ids).size !== value.cleaned_runtime_ids.length) {
      context.addIssue({ code: "custom", message: "duplicate_identity" });
    }
    const failed = value.outcome === "ambiguous" || value.outcome === "failed";
    if (failed !== (value.error_code !== null)) {
      context.addIssue({ code: "custom", message: "supervisor cleanup outcome is ambiguous" });
    }
    if (!failed && (value.remaining_runtime_count !== 0 || value.registration_count !== 0 || !value.tokens_revoked)) {
      context.addIssue({ code: "custom", message: "successful orphan cleanup must remove all runtime authority" });
    }
  });

export const SupervisorReconcileRequestSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    operation_id: OpaqueIdSchema,
    installation_id: OpaqueIdSchema,
    expected_runtime: RuntimeIdentitySchema.nullable(),
    expected_registration_id: OpaqueIdSchema.nullable(),
    expected_state: z.enum(["active", "disabled", "quarantined", "not_installed", "failed_recoverable"]),
  })
  .strict();

export const SupervisorReconcileResultSchema = z
  .object({
    supervisor_protocol_version: SupervisorProtocolVersionSchema,
    outcome: z.enum(["adopted", "stopped_orphan", "restarted_from_committed_pointer", "no_runtime_expected", "failed_recoverable"]),
    expected_runtime: RuntimeIdentitySchema.nullable(),
    observed_runtime: RuntimeIdentitySchema.nullable(),
    active_runtime_count: z.number().int().min(0).max(1),
    registration_count: z.number().int().min(0).max(1),
    tokens_revoked: z.boolean(),
    error_code: SupervisorErrorCodeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const failed = value.outcome === "failed_recoverable";
    if (failed !== (value.error_code !== null)) {
      context.addIssue({ code: "custom", message: "supervisor reconciliation outcome is ambiguous" });
    }
    if (value.outcome === "no_runtime_expected" && (value.active_runtime_count !== 0 || value.registration_count !== 0)) {
      context.addIssue({ code: "custom", message: "no-runtime reconciliation observed live authority" });
    }
    if (value.outcome === "no_runtime_expected" && (value.expected_runtime !== null || value.observed_runtime !== null)) {
      context.addIssue({ code: "custom", message: "no-runtime reconciliation cannot retain runtime identities" });
    }
    if (["adopted", "restarted_from_committed_pointer"].includes(value.outcome) && (value.observed_runtime === null || value.active_runtime_count !== 1 || value.registration_count !== 1)) {
      context.addIssue({ code: "custom", message: "active reconciliation requires exactly one runtime and registration" });
    }
  });

export const INSTALLED_APP_SUPERVISOR_METHODS = [
  "start",
  "awaitReady",
  "health",
  "register",
  "stop",
  "revokeTokens",
  "cleanup",
  "reconcile",
] as const;

export interface InstalledAppSupervisor {
  start(request: z.infer<typeof SupervisorStartRequestSchema>): Promise<z.infer<typeof SupervisorStartResultSchema>>;
  awaitReady(request: z.infer<typeof SupervisorReadyRequestSchema>): Promise<z.infer<typeof SupervisorReadyResultSchema>>;
  health(request: z.infer<typeof SupervisorHealthRequestSchema>): Promise<z.infer<typeof SupervisorHealthResultSchema>>;
  register(request: z.infer<typeof SupervisorRegistrationRequestSchema>): Promise<z.infer<typeof SupervisorRegistrationResultSchema>>;
  stop(request: z.infer<typeof SupervisorStopRequestSchema>): Promise<z.infer<typeof SupervisorStopResultSchema>>;
  revokeTokens(request: z.infer<typeof SupervisorTokenRevocationRequestSchema>): Promise<z.infer<typeof SupervisorTokenRevocationResultSchema>>;
  cleanup(request: z.infer<typeof SupervisorCleanupRequestSchema>): Promise<z.infer<typeof SupervisorCleanupResultSchema>>;
  reconcile(request: z.infer<typeof SupervisorReconcileRequestSchema>): Promise<z.infer<typeof SupervisorReconcileResultSchema>>;
}

export const SidecarRuntimeBindingAudienceSchema = z.enum(["provider_adapter_only", "owning_app_private", "host_only"]);

export const SidecarRuntimeBindingProjectionSchema = z
  .object({
    binding_version: z.literal(1),
    binding_id: OpaqueIdSchema,
    package_id: PackageIdSchema,
    installation_id: OpaqueIdSchema,
    component_id: ComponentIdSchema,
    owner_component_id: ComponentIdSchema,
    runtime_id: OpaqueIdSchema,
    binding_generation: z.number().int().positive(),
    target: RuntimeTargetSchema,
    transport: z.enum(["container_internal", "loopback", "ipc"]),
    endpoint_class: z.enum(["container_internal_authenticated", "loopback_authenticated", "ipc_authenticated"]),
    audience: SidecarRuntimeBindingAudienceSchema,
    public_bind: z.literal(false),
    created_at: TimestampSchema,
  })
  .strict();

export const SidecarLifecycleDiagnosticEventSchema = z
  .object({
    diagnostic_version: z.literal(1),
    sequence: z.number().int().positive(),
    package_id: PackageIdSchema,
    installation_id: OpaqueIdSchema,
    component_id: ComponentIdSchema,
    owner_component_id: ComponentIdSchema,
    action: z.enum(["start", "readiness", "health", "stop", "restart", "uninstall", "cleanup", "binding_rotated", "binding_denied"]),
    state: z.enum(["starting", "running", "stopped", "uninstalled", "unavailable", "failed"]),
    health: z.enum(["unknown", "healthy", "unhealthy"]),
    target: RuntimeTargetSchema.nullable(),
    runtime_kind: z.enum(["container", "packaged_process"]).nullable(),
    binding_class: z.enum(["container_internal_authenticated", "loopback_authenticated", "ipc_authenticated"]).nullable(),
    restart_attempt: z.number().int().min(0).max(3),
    error_code: z.string().regex(/^[a-z0-9_]{1,64}$/).nullable(),
    occurred_at: TimestampSchema,
  })
  .strict();
