import type { FirstPartyAppRegistration } from "./contracts/app-registry.js";

const capability = (appId: string, routeKey: string, name: string, confirmation: "none" | "owner_confirmation" = "none") => ({
  registration_version: 1 as const, app_id: appId, key: { name, version: 1 }, binding_id: `capability.${routeKey}.${name.replaceAll(".", "-")}`,
  input_schema_id: `${routeKey}.${name}.input.v1`, result_schema_id: `${routeKey}.${name}.result.v1`,
  limits: { max_input_bytes: 65_536, max_duration_ms: 30_000, max_calls_per_minute: 60 }, confirmation,
  audit_projection_id: `audit.${routeKey}.${name}.v1`, retry_policy: "idempotent_only" as const, idempotency_policy: "required" as const,
  owner_component_id: name === "app.inference.request" ? `${routeKey}.inference` : `${routeKey}.domain`,
});

export const BRIEF_BUILDER_FIRST_PARTY_REGISTRATION: FirstPartyAppRegistration = {
  registration_version: 1, app_id: "ai.braindrive.brief-builder", publisher_id: "ai.braindrive", route_key: "brief-builder",
  package_source_id: "first-party.brief-builder", lifecycle_binding_id: "lifecycle.brief-builder", runtime_profile_id: "runtime.brief-builder",
  capability_registrations: [
    capability("ai.braindrive.brief-builder", "brief-builder", "brief.records.read"),
    capability("ai.braindrive.brief-builder", "brief-builder", "brief.records.write"),
    capability("ai.braindrive.brief-builder", "brief-builder", "brief.approvals.confirm", "owner_confirmation"),
    capability("ai.braindrive.brief-builder", "brief-builder", "app.inference.request"),
    capability("ai.braindrive.brief-builder", "brief-builder", "web.search"),
    capability("ai.braindrive.brief-builder", "brief-builder", "web.read"),
  ],
  inference_purpose_registrations: [{
    registration_version: 1, app_id: "ai.braindrive.brief-builder", key: { purpose_id: "brief.generate", version: 1 },
    binding_id: "inference.brief-builder.generate", input_schema_id: "brief.generate.input.v1", output_schema_id: "brief.generate.output.v1",
    prompt_policy_id: "brief.generate.fixed.v2", model_compatibility_class: "owner_active_compatible",
    limits: { max_input_bytes: 65_536, max_input_tokens: 16_384, max_output_tokens: 2_048, max_duration_ms: 30_000, max_attempts: 2 },
    validation_policy_id: "brief.grounding.v1", retry_policy: "same_snapshot_only", cancellation_policy: "required",
    audit_projection_id: "audit.brief-builder.generate.v1", owner_component_id: "brief-builder.inference",
  }],
  data_adapter_registration: { registration_version: 1, app_id: "ai.braindrive.brief-builder", binding_id: "data.brief-builder", adapter_contract_version: 1, data_contract_version: 1, namespace_policy: "host_derived_from_verified_app_id", retention_policy: "retain_owner_data_remove_runtime_authority", owner_component_id: "brief-builder.domain" },
};
