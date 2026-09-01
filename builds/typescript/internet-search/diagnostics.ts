import { z } from "zod";

import { OpaqueIdSchema, TimestampSchema } from "../app-platform/contracts/common.js";
import {
  InternetSearchFailureCodeSchema,
  InternetSearchOperationIdSchema,
  InternetSearchReceiptStatusSchema,
  type InternetSearchOperationId,
  type WebReadEnvelope,
  type WebSearchEnvelope,
} from "./contracts/index.js";
import { createInternetSearchReceiptProjection } from "./operation-metadata.js";
import type { SearxngSidecarDiagnostic } from "./sidecar.js";

const RETENTION_POLICY_ID = "internet-search-local-v1-diagnostics";
const CAPABILITY_ID = "internet-search";
const DEFAULT_CAPABILITY_VERSION = "0.1.0";
const LOCAL_RETENTION_DAYS = 14;

export const INTERNET_SEARCH_DIAGNOSTIC_RETENTION_POLICY = Object.freeze({
  policy_id: RETENTION_POLICY_ID,
  retained_event_classes: ["operation", "sidecar_lifecycle", "qualification_stale"],
  local_retention_days: LOCAL_RETENTION_DAYS,
  raw_page_content: "excluded_ephemeral",
  raw_provider_responses: "excluded",
  raw_queries: "excluded",
  prompts: "excluded",
  credentials: "excluded",
  host_paths: "excluded",
  provider_endpoints: "excluded",
  delivery_evidence: "separate_sanitized_bundle",
} as const);

export const INTERNET_SEARCH_SUPPORT_BUNDLE_DIAGNOSTICS_STATUS = Object.freeze({
  status: "not_claimed",
  reason: "Search-specific support-bundle export requires a separate allowlisted integration review.",
} as const);

const SafeDiagnosticTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => !unsafeDiagnosticTextPattern.test(value), "diagnostic text contains unsafe detail");

const DiagnosticRetentionFieldsSchema = z.object({
  retention_policy_id: z.literal(RETENTION_POLICY_ID),
  retention_expires_after_days: z.literal(LOCAL_RETENTION_DAYS),
}).strict();

const DiagnosticUsageSchema = z.object({
  call_count: z.number().int().min(0).max(1),
  bytes_class: z.enum(["none", "small", "medium", "large", "limit"]).nullable(),
}).strict();

const OperationDiagnosticEventSchema = z
  .object({
    diagnostic_version: z.literal(1),
    event_type: z.literal("operation"),
    occurred_at: TimestampSchema,
    capability_id: z.literal(CAPABILITY_ID),
    capability_version: SafeDiagnosticTextSchema,
    operation_id: InternetSearchOperationIdSchema,
    request_id: OpaqueIdSchema,
    run_id: OpaqueIdSchema,
    status: InternetSearchReceiptStatusSchema,
    failure_code: InternetSearchFailureCodeSchema.nullable(),
    result_count: z.number().int().min(0).max(10),
    completed_item_count: z.number().int().min(0).max(10),
    provider_profile_id: z.literal("local-owner-managed"),
    limit_profile_id: z.literal("is-local-v1.0"),
    usage: DiagnosticUsageSchema,
    duration_ms: z.number().int().min(0).max(60_000).nullable(),
  })
  .merge(DiagnosticRetentionFieldsSchema)
  .strict();

const SidecarDiagnosticEventSchema = z
  .object({
    diagnostic_version: z.literal(1),
    event_type: z.literal("sidecar_lifecycle"),
    occurred_at: TimestampSchema,
    sequence: z.number().int().min(1),
    state: z.enum(["not_installed", "installed", "starting", "ready", "stopped", "unhealthy", "restarting", "uninstalling"]),
    action: z.enum([
      "install",
      "start",
      "readiness",
      "readiness_failed",
      "health",
      "stop",
      "restart",
      "uninstall",
      "cleanup",
      "binding_rejected",
    ]),
    endpoint_class: z.enum(["container_internal", "loopback"]).nullable(),
    public_bind: z.literal(false),
    error_code: z.enum([
      "binding_rejected",
      "cleanup_failed",
      "health_failed",
      "health_timeout",
      "readiness_timeout",
      "start_failed",
      "stop_failed",
      "unknown",
    ]).nullable(),
  })
  .merge(DiagnosticRetentionFieldsSchema)
  .strict();

const QualificationChangeClassSchema = z.enum([
  "provider",
  "adapter",
  "policy",
  "rate_table",
  "operating_configuration",
  "capability_contract",
  "host_enforcement",
  "network_policy",
  "receipt_lifecycle",
  "documentation_only",
  "evidence_only",
  "unrelated",
]);

const QualificationDiagnosticEventSchema = z
  .object({
    diagnostic_version: z.literal(1),
    event_type: z.literal("qualification_stale"),
    occurred_at: TimestampSchema,
    change_class: QualificationChangeClassSchema,
    qualification_status: z.enum(["current", "stale"]),
    requires_rerun: z.boolean(),
    affected_evidence: z.array(z.enum([
      "capability_conformance",
      "provider_qualification",
      "dependent_product_results",
      "billing_reconciliation",
    ])).max(4),
  })
  .merge(DiagnosticRetentionFieldsSchema)
  .strict();

export const InternetSearchDiagnosticEventSchema = z.discriminatedUnion("event_type", [
  OperationDiagnosticEventSchema,
  SidecarDiagnosticEventSchema,
  QualificationDiagnosticEventSchema,
]);

export type InternetSearchDiagnosticEvent = z.infer<typeof InternetSearchDiagnosticEventSchema>;
export type InternetSearchOperationDiagnostic = z.infer<typeof OperationDiagnosticEventSchema>;
export type InternetSearchSidecarDiagnosticProjection = z.infer<typeof SidecarDiagnosticEventSchema>;
export type InternetSearchQualificationDiagnostic = z.infer<typeof QualificationDiagnosticEventSchema>;
export type InternetSearchQualificationChangeClass = z.infer<typeof QualificationChangeClassSchema>;

export interface InternetSearchDiagnosticSink {
  record(event: InternetSearchDiagnosticEvent): void;
}

export function projectInternetSearchOperationDiagnostic(options: {
  operationId: InternetSearchOperationId;
  envelope: WebSearchEnvelope | WebReadEnvelope;
  capabilityVersion?: string;
  durationMs?: number | null;
  unsafeInput?: unknown;
}): InternetSearchOperationDiagnostic {
  const receipt = createInternetSearchReceiptProjection(options.operationId, options.envelope, {
    capabilityVersion: options.capabilityVersion ?? DEFAULT_CAPABILITY_VERSION,
  });

  return OperationDiagnosticEventSchema.parse({
    diagnostic_version: 1,
    event_type: "operation",
    occurred_at: receipt.occurred_at,
    capability_id: CAPABILITY_ID,
    capability_version: receipt.capability_version,
    operation_id: receipt.operation_id,
    request_id: receipt.request_id,
    run_id: receipt.run_id,
    status: receipt.status,
    failure_code: receipt.failure_code,
    result_count: receipt.result_count,
    completed_item_count: receipt.completed_item_count,
    provider_profile_id: receipt.provider_profile_id,
    limit_profile_id: receipt.limit_profile_id,
    usage: usageProjection(options.operationId, options.envelope),
    duration_ms: options.durationMs ?? null,
    retention_policy_id: RETENTION_POLICY_ID,
    retention_expires_after_days: LOCAL_RETENTION_DAYS,
  });
}

export function projectSearxngSidecarDiagnostic(raw: SearxngSidecarDiagnostic): InternetSearchSidecarDiagnosticProjection {
  return SidecarDiagnosticEventSchema.parse({
    diagnostic_version: 1,
    event_type: "sidecar_lifecycle",
    occurred_at: raw.occurred_at,
    sequence: raw.sequence,
    state: raw.state,
    action: raw.action,
    endpoint_class: raw.endpoint_class,
    public_bind: false,
    error_code: safeSidecarErrorCode(raw.error_code),
    retention_policy_id: RETENTION_POLICY_ID,
    retention_expires_after_days: LOCAL_RETENTION_DAYS,
  });
}

export function markInternetSearchQualificationStale(options: {
  changed_at: string;
  change_class: InternetSearchQualificationChangeClass;
}): InternetSearchQualificationDiagnostic {
  const affectedEvidence = affectedEvidenceForChange(options.change_class);
  return QualificationDiagnosticEventSchema.parse({
    diagnostic_version: 1,
    event_type: "qualification_stale",
    occurred_at: options.changed_at,
    change_class: options.change_class,
    qualification_status: affectedEvidence.length > 0 ? "stale" : "current",
    requires_rerun: affectedEvidence.length > 0,
    affected_evidence: affectedEvidence,
    retention_policy_id: RETENTION_POLICY_ID,
    retention_expires_after_days: LOCAL_RETENTION_DAYS,
  });
}

export function createMemoryInternetSearchDiagnosticSink(options: { maxEvents?: number } = {}) {
  const maxEvents = Math.max(1, options.maxEvents ?? 128);
  const retained: InternetSearchDiagnosticEvent[] = [];
  return {
    record(event: InternetSearchDiagnosticEvent): void {
      retained.push(InternetSearchDiagnosticEventSchema.parse(event));
      if (retained.length > maxEvents) retained.splice(0, retained.length - maxEvents);
    },
    events(): readonly InternetSearchDiagnosticEvent[] {
      return [...retained];
    },
    clear(): void {
      retained.splice(0, retained.length);
    },
  } satisfies InternetSearchDiagnosticSink & {
    events(): readonly InternetSearchDiagnosticEvent[];
    clear(): void;
  };
}

function usageProjection(
  operationId: InternetSearchOperationId,
  envelope: WebSearchEnvelope | WebReadEnvelope,
): z.infer<typeof DiagnosticUsageSchema> {
  if (operationId === "web.search@1") {
    return { call_count: (envelope as WebSearchEnvelope).usage.search_call, bytes_class: null };
  }
  const usage = (envelope as WebReadEnvelope).usage;
  return { call_count: usage.read_call, bytes_class: classifyBytes(usage.bytes_read) };
}

function classifyBytes(bytes: number): z.infer<typeof DiagnosticUsageSchema>["bytes_class"] {
  if (bytes <= 0) return "none";
  if (bytes >= 262_144) return "limit";
  if (bytes < 16_384) return "small";
  if (bytes < 131_072) return "medium";
  return "large";
}

function safeSidecarErrorCode(errorCode: string | null): InternetSearchSidecarDiagnosticProjection["error_code"] {
  if (errorCode === null) return null;
  if (safeSidecarErrorCodes.has(errorCode)) return errorCode as InternetSearchSidecarDiagnosticProjection["error_code"];
  return "unknown";
}

function affectedEvidenceForChange(changeClass: InternetSearchQualificationChangeClass): InternetSearchQualificationDiagnostic["affected_evidence"] {
  if (changeClass === "documentation_only" || changeClass === "evidence_only" || changeClass === "unrelated") return [];
  if (changeClass === "rate_table") return ["billing_reconciliation"];
  if (changeClass === "provider" || changeClass === "adapter" || changeClass === "policy" || changeClass === "operating_configuration") {
    return ["capability_conformance", "provider_qualification", "dependent_product_results"];
  }
  return ["capability_conformance", "dependent_product_results"];
}

const safeSidecarErrorCodes = new Set([
  "binding_rejected",
  "cleanup_failed",
  "health_failed",
  "health_timeout",
  "readiness_timeout",
  "start_failed",
  "stop_failed",
  "unknown",
]);

const unsafeDiagnosticTextPattern =
  /(?:https?:|localhost|127\.0\.0\.1|0\.0\.0\.0|\bport\b|credential|secret|vault|api[_-]?key|authorization|cookie|\/(?:home|tmp|etc|var|Users)\/)/i;
