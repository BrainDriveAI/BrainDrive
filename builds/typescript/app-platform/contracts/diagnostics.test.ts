import { describe, expect, it } from "vitest";

import { createJsonSchemaCatalog } from "./generate-json-schemas.js";
import {
  PACKAGE_DIAGNOSTICS_RETENTION_POLICY,
  PACKAGE_DIAGNOSTICS_RETENTION_POLICY_ID,
  PACKAGE_SUPPORT_BUNDLE_DIAGNOSTICS_STATUS,
  PackageDiagnosticEventSchema,
  createMemoryPackageDiagnosticSink,
  createPackageOperationReceiptDiagnostic,
  createPackageSidecarLifecycleDiagnostic,
  markPackageQualificationStale,
} from "./diagnostics.js";

const now = "2026-09-01T00:00:00.000Z";
const packageId = "ai.braindrive.synthetic-provider";
const providerComponentId = "synthetic.provider";
const sidecarComponentId = "synthetic.runtime";
const installationId = "20000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000002";
const runId = "20000000-0000-4000-8000-000000000003";
const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

const unsafePattern =
  /CANARY_|https?:|localhost|127\.0\.0\.1|0\.0\.0\.0|18080|\bport\b|credential|secret|vault|api[_-]?key|authorization|bearer|cookie|token|prompt|\/home\/canary|\/tmp\/canary|owner-private|raw_provider|endpoint/i;

function expectNoUnsafe(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(unsafePattern);
}

describe("SC-009 generic package diagnostics, receipts, redaction, and staleness", () => {
  it("declares content-free retention and safe support-bundle posture for all package providers", () => {
    expect(PACKAGE_DIAGNOSTICS_RETENTION_POLICY).toEqual({
      policy_id: "package-provider-diagnostics-v1",
      retained_event_classes: ["operation", "sidecar_lifecycle", "qualification_stale"],
      local_retention_days: 14,
      raw_page_content: "excluded_ephemeral",
      raw_provider_responses: "excluded",
      raw_queries: "excluded",
      prompts: "excluded",
      credentials: "excluded",
      host_paths: "excluded",
      provider_endpoints: "excluded",
      support_bundle_export: "safe_projection_only",
      delivery_evidence: "separate_sanitized_bundle",
    });
    expect(PACKAGE_SUPPORT_BUNDLE_DIAGNOSTICS_STATUS).toEqual({
      status: "safe_projection_only",
      raw_provider_payload_export: "not_claimed",
      reason: "Support bundles may include only bounded generic diagnostic projections; raw provider payload exports require separate allowlisted review.",
    });
  });

  it("projects provider operation receipts through a package-independent allowlist", () => {
    const event = createPackageOperationReceiptDiagnostic({
      packageId,
      installationId,
      packageVersion: "1.2.3",
      packageDigest: digest,
      providerComponentId,
      providerProfileId: "local-owner-managed",
      providerSelection: "owner_or_admin_policy",
      operationId: "web.search@1",
      requestId,
      runId,
      status: "success",
      failureCode: null,
      resultCount: 2,
      completedItemCount: 2,
      occurredAt: now,
      limitProfileId: "generic-local-v1",
      usage: { call_count: 1, bytes_class: null },
      durationMs: 37,
      unsafeInput: {
        query: "CANARY_RAW_QUERY_TEXT",
        endpoint: "http://127.0.0.1:18080/search",
        authorization: "Bearer CANARY_AUTHORIZATION_TOKEN",
        prompt: "CANARY_PROMPT",
        host_path: "/home/canary/file",
      },
      unsafeProviderResult: {
        raw_provider_response: "CANARY_RAW_PROVIDER_PAYLOAD",
        owner_private: "owner-private",
      },
    });

    expect(PackageDiagnosticEventSchema.parse(event)).toMatchObject({
      diagnostic_version: 1,
      event_type: "operation",
      package_id: packageId,
      provider_component_id: providerComponentId,
      provider_profile_class: "capability_provider",
      provider_selection: "owner_or_admin_policy",
      provider_execution: "executed",
      operation_id: "web.search@1",
      status: "success",
      failure_code: null,
      retention_policy_id: PACKAGE_DIAGNOSTICS_RETENTION_POLICY_ID,
    });
    expect(Object.keys(event).sort()).toEqual([
      "completed_item_count",
      "diagnostic_version",
      "duration_ms",
      "event_type",
      "failure_code",
      "installation_id",
      "limit_profile_id",
      "occurred_at",
      "operation_id",
      "package_digest",
      "package_id",
      "package_version",
      "provider_component_id",
      "provider_execution",
      "provider_profile_class",
      "provider_profile_id",
      "provider_selection",
      "request_id",
      "result_count",
      "retention_expires_after_days",
      "retention_policy_id",
      "run_id",
      "status",
      "usage",
    ]);
    expectNoUnsafe(event);
  });

  it("distinguishes provider execution and result outcomes without retaining unsafe payloads", () => {
    const base = {
      packageId,
      installationId,
      packageVersion: "1.2.3",
      packageDigest: digest,
      providerComponentId,
      providerProfileId: "local-owner-managed",
      operationId: "web.search@1",
      requestId,
      runId,
      occurredAt: now,
      limitProfileId: "generic-local-v1",
      unsafeInput: { query: "CANARY_RAW_QUERY_TEXT", host_path: "/home/canary/private" },
      unsafeProviderResult: { raw_provider_response: "CANARY_RAW_PROVIDER_PAYLOAD" },
    };

    const notSearched = createPackageOperationReceiptDiagnostic({
      ...base,
      providerExecution: "not_executed",
      status: "failure",
      failureCode: "not_authorized",
      resultCount: 0,
      completedItemCount: 0,
      usage: { call_count: 0, bytes_class: null },
    });
    const searchedEmpty = createPackageOperationReceiptDiagnostic({
      ...base,
      providerExecution: "executed",
      status: "success",
      failureCode: null,
      resultCount: 0,
      completedItemCount: 0,
      usage: { call_count: 1, bytes_class: null },
    });
    const searchedPartial = createPackageOperationReceiptDiagnostic({
      ...base,
      providerExecution: "executed",
      status: "partial",
      failureCode: "content_too_large",
      resultCount: 1,
      completedItemCount: 1,
      usage: { call_count: 1, bytes_class: "limit" },
    });

    expect(notSearched).toMatchObject({
      provider_execution: "not_executed",
      status: "failure",
      failure_code: "not_authorized",
      result_count: 0,
      usage: { call_count: 0 },
    });
    expect(searchedEmpty).toMatchObject({
      provider_execution: "executed",
      status: "success",
      failure_code: null,
      result_count: 0,
      usage: { call_count: 1 },
    });
    expect(searchedPartial).toMatchObject({
      provider_execution: "executed",
      status: "partial",
      failure_code: "content_too_large",
      result_count: 1,
      usage: { call_count: 1 },
    });
    expectNoUnsafe([notSearched, searchedEmpty, searchedPartial]);
  });

  it("redacts lifecycle error details and never projects runtime bindings", () => {
    const event = createPackageSidecarLifecycleDiagnostic({
      sequence: 1,
      packageId,
      installationId,
      componentId: sidecarComponentId,
      ownerComponentId: providerComponentId,
      action: "health",
      state: "failed",
      health: "unhealthy",
      target: "docker_linux_x64",
      runtimeKind: "container",
      bindingClass: "container_internal_authenticated",
      restartAttempt: 1,
      errorCode: "CANARY http://127.0.0.1:18080 /home/canary/sidecar.log",
      occurredAt: now,
    });

    expect(PackageDiagnosticEventSchema.parse(event)).toMatchObject({
      event_type: "sidecar_lifecycle",
      action: "health",
      state: "failed",
      health: "unhealthy",
      binding_class: "container_internal_authenticated",
      error_code: "unknown",
    });
    expectNoUnsafe(event);
  });

  it("marks material qualification changes stale and leaves evidence-only edits current", () => {
    expect(markPackageQualificationStale({
      changedAt: now,
      packageId,
      providerComponentId,
      changeClass: "manifest_change",
    })).toMatchObject({
      event_type: "qualification_stale",
      qualification_status: "stale",
      requires_rerun: true,
      affected_evidence: ["schema_conformance", "operation_contract_conformance", "provider_qualification", "dependent_product_results"],
    });

    expect(markPackageQualificationStale({
      changedAt: now,
      packageId,
      providerComponentId,
      changeClass: "security_boundary_change",
    })).toMatchObject({
      qualification_status: "stale",
      affected_evidence: ["schema_conformance", "provider_qualification", "security_redaction_scan", "support_bundle_review", "dependent_product_results"],
    });

    expect(markPackageQualificationStale({
      changedAt: now,
      packageId,
      changeClass: "evidence_only",
    })).toMatchObject({
      qualification_status: "current",
      requires_rerun: false,
      affected_evidence: [],
    });
  });

  it("keeps generic diagnostic sinks capped and strict", () => {
    const sink = createMemoryPackageDiagnosticSink({ maxEvents: 1 });
    sink.record(createPackageOperationReceiptDiagnostic({
      packageId,
      packageVersion: "1.2.3",
      providerComponentId,
      providerProfileId: "local-owner-managed",
      operationId: "web.search@1",
      requestId,
      runId,
      status: "failure",
      failureCode: "provider_unavailable",
      resultCount: 0,
      completedItemCount: 0,
      occurredAt: now,
      limitProfileId: "generic-local-v1",
      usage: { call_count: 0, bytes_class: null },
    }));
    sink.record(markPackageQualificationStale({
      changedAt: now,
      packageId,
      changeClass: "adapter_change",
    }));

    expect(sink.events()).toHaveLength(1);
    expect(sink.events()[0]).toMatchObject({ event_type: "qualification_stale" });
    expectNoUnsafe(sink.events());

    const unsafeEvent = {
      ...sink.events()[0],
      endpoint: "http://127.0.0.1:18080",
    } as unknown as Parameters<typeof sink.record>[0];
    expect(() => sink.record(unsafeEvent)).toThrow(/unrecognized/i);
  });

  it("registers package diagnostics schemas in the generated schema catalog", () => {
    const catalog = createJsonSchemaCatalog();
    expect(Object.keys(catalog)).toEqual(expect.arrayContaining([
      "package-diagnostic-event",
      "package-diagnostics-retention-policy",
      "package-operation-receipt-diagnostic-event",
      "package-qualification-diagnostic-event",
      "package-sidecar-lifecycle-diagnostic-event",
    ]));
    expect(catalog["package-diagnostic-event"]).toMatchObject({
      $id: "https://schemas.braindrive.ai/app-platform/v1/package-diagnostic-event.schema.json",
    });
  });
});
