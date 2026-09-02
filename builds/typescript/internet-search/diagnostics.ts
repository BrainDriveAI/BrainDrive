import { z } from "zod";

import {
  PACKAGE_DIAGNOSTICS_RETENTION_POLICY,
  PACKAGE_SUPPORT_BUNDLE_DIAGNOSTICS_STATUS,
  PackageDiagnosticEventSchema,
  PackageOperationReceiptDiagnosticEventSchema,
  PackageQualificationDiagnosticEventSchema,
  PackageSidecarLifecycleDiagnosticEventSchema,
  createPackageOperationReceiptDiagnostic,
  createPackageSidecarLifecycleDiagnostic,
  markPackageQualificationStale,
  type PackageQualificationChangeClass,
} from "../app-platform/contracts/diagnostics.js";
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

const CAPABILITY_ID = "internet-search";
const DEFAULT_CAPABILITY_VERSION = "0.1.0";
const INTERNET_SEARCH_PROVIDER_PACKAGE_ID = "ai.braindrive.internet-search.searxng";
const INTERNET_SEARCH_PROVIDER_COMPONENT_ID = "search.provider";
const INTERNET_SEARCH_PROVIDER_PACKAGE_VERSION = "1.0.0";

export const INTERNET_SEARCH_DIAGNOSTIC_RETENTION_POLICY = PACKAGE_DIAGNOSTICS_RETENTION_POLICY;

export const INTERNET_SEARCH_SUPPORT_BUNDLE_DIAGNOSTICS_STATUS = PACKAGE_SUPPORT_BUNDLE_DIAGNOSTICS_STATUS;

const SafeDiagnosticTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => !unsafeDiagnosticTextPattern.test(value), "diagnostic text contains unsafe detail");

const OperationDiagnosticEventSchema = z
  .object(PackageOperationReceiptDiagnosticEventSchema.shape)
  .extend({
    capability_id: z.literal(CAPABILITY_ID),
    capability_version: SafeDiagnosticTextSchema,
    operation_id: InternetSearchOperationIdSchema,
    status: InternetSearchReceiptStatusSchema,
    failure_code: InternetSearchFailureCodeSchema.nullable(),
  })
  .strict();

const SidecarDiagnosticEventSchema = PackageSidecarLifecycleDiagnosticEventSchema;

const QualificationDiagnosticEventSchema = PackageQualificationDiagnosticEventSchema;

export const InternetSearchDiagnosticEventSchema = z.discriminatedUnion("event_type", [
  OperationDiagnosticEventSchema,
  SidecarDiagnosticEventSchema,
  QualificationDiagnosticEventSchema,
]);

export type InternetSearchDiagnosticEvent = z.infer<typeof InternetSearchDiagnosticEventSchema>;
export type InternetSearchOperationDiagnostic = z.infer<typeof OperationDiagnosticEventSchema>;
export type InternetSearchSidecarDiagnosticProjection = z.infer<typeof SidecarDiagnosticEventSchema>;
export type InternetSearchQualificationDiagnostic = z.infer<typeof QualificationDiagnosticEventSchema>;
export type InternetSearchQualificationChangeClass = PackageQualificationChangeClass;

export interface InternetSearchDiagnosticSink {
  record(event: InternetSearchDiagnosticEvent): void;
}

type DiagnosticBytesClass = "none" | "small" | "medium" | "large" | "limit" | null;

export function projectInternetSearchOperationDiagnostic(options: {
  operationId: InternetSearchOperationId;
  envelope: WebSearchEnvelope | WebReadEnvelope;
  capabilityVersion?: string;
  providerExecution?: "not_executed" | "executed";
  durationMs?: number | null;
  unsafeInput?: unknown;
}): InternetSearchOperationDiagnostic {
  const receipt = createInternetSearchReceiptProjection(options.operationId, options.envelope, {
    capabilityVersion: options.capabilityVersion ?? DEFAULT_CAPABILITY_VERSION,
  });
  const genericReceipt = createPackageOperationReceiptDiagnostic({
    packageId: INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
    packageVersion: INTERNET_SEARCH_PROVIDER_PACKAGE_VERSION,
    providerComponentId: INTERNET_SEARCH_PROVIDER_COMPONENT_ID,
    providerProfileId: receipt.provider_profile_id,
    operationId: receipt.operation_id,
    requestId: receipt.request_id,
    runId: receipt.run_id,
    status: receipt.status,
    failureCode: receipt.failure_code,
    providerExecution: options.providerExecution ?? providerExecutionFromEnvelope(options.operationId, options.envelope),
    resultCount: receipt.result_count,
    completedItemCount: receipt.completed_item_count,
    occurredAt: receipt.occurred_at,
    limitProfileId: receipt.limit_profile_id,
    usage: usageProjection(options.operationId, options.envelope),
    durationMs: options.durationMs ?? null,
    unsafeInput: options.unsafeInput,
    unsafeProviderResult: options.envelope,
  });

  return OperationDiagnosticEventSchema.parse({
    ...genericReceipt,
    capability_id: CAPABILITY_ID,
    capability_version: receipt.capability_version,
    operation_id: receipt.operation_id,
    status: receipt.status,
    failure_code: receipt.failure_code,
  });
}

export function projectSearxngSidecarDiagnostic(raw: SearxngSidecarDiagnostic): InternetSearchSidecarDiagnosticProjection {
  return createPackageSidecarLifecycleDiagnostic({
    sequence: raw.sequence,
    packageId: INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
    componentId: "search.runtime",
    ownerComponentId: INTERNET_SEARCH_PROVIDER_COMPONENT_ID,
    action: sidecarAction(raw.action),
    state: sidecarState(raw.state),
    health: sidecarHealth(raw.state),
    target: null,
    runtimeKind: null,
    bindingClass: raw.endpoint_class === "container_internal"
      ? "container_internal_authenticated"
      : raw.endpoint_class === "loopback"
        ? "loopback_authenticated"
        : null,
    restartAttempt: raw.state === "restarting" ? 1 : 0,
    errorCode: raw.error_code,
    occurredAt: raw.occurred_at,
  });
}

export function markInternetSearchQualificationStale(options: {
  changed_at: string;
  change_class: InternetSearchQualificationChangeClass;
}): InternetSearchQualificationDiagnostic {
  return markPackageQualificationStale({
    changedAt: options.changed_at,
    packageId: INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
    providerComponentId: INTERNET_SEARCH_PROVIDER_COMPONENT_ID,
    changeClass: options.change_class,
  });
}

export function createMemoryInternetSearchDiagnosticSink(options: { maxEvents?: number } = {}) {
  const maxEvents = Math.max(1, options.maxEvents ?? 128);
  const retained: InternetSearchDiagnosticEvent[] = [];
  return {
    record(event: InternetSearchDiagnosticEvent): void {
      const parsed = InternetSearchDiagnosticEventSchema.parse(event);
      PackageDiagnosticEventSchema.parse(packageDiagnosticProjection(parsed));
      retained.push(parsed);
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
): { call_count: number; bytes_class: DiagnosticBytesClass } {
  if (operationId === "web.search@1") {
    return { call_count: (envelope as WebSearchEnvelope).usage.search_call, bytes_class: null };
  }
  const usage = (envelope as WebReadEnvelope).usage;
  return { call_count: usage.read_call, bytes_class: classifyBytes(usage.bytes_read) };
}

function providerExecutionFromEnvelope(
  operationId: InternetSearchOperationId,
  envelope: WebSearchEnvelope | WebReadEnvelope,
): "not_executed" | "executed" {
  if (operationId === "web.search@1" && (envelope as WebSearchEnvelope).usage.search_call > 0) return "executed";
  if (operationId === "web.read@1" && (envelope as WebReadEnvelope).usage.read_call > 0) return "executed";
  const failureCode = envelope.failure?.code;
  return failureCode === "invalid_provider_response" || failureCode === "timeout" || failureCode === "cancelled"
    ? "executed"
    : "not_executed";
}

function classifyBytes(bytes: number): DiagnosticBytesClass {
  if (bytes <= 0) return "none";
  if (bytes >= 262_144) return "limit";
  if (bytes < 16_384) return "small";
  if (bytes < 131_072) return "medium";
  return "large";
}

function sidecarAction(action: SearxngSidecarDiagnostic["action"]): InternetSearchSidecarDiagnosticProjection["action"] {
  if (action === "binding_rejected") return "binding_denied";
  if (action === "readiness_failed") return "readiness";
  if (action === "install") return "start";
  return action;
}

function sidecarState(state: SearxngSidecarDiagnostic["state"]): InternetSearchSidecarDiagnosticProjection["state"] {
  if (state === "ready") return "running";
  if (state === "unhealthy") return "failed";
  if (state === "not_installed") return "uninstalled";
  if (state === "starting" || state === "restarting") return "starting";
  if (state === "uninstalling") return "stopped";
  return "stopped";
}

function sidecarHealth(state: SearxngSidecarDiagnostic["state"]): InternetSearchSidecarDiagnosticProjection["health"] {
  if (state === "ready") return "healthy";
  if (state === "unhealthy") return "unhealthy";
  return "unknown";
}

function packageDiagnosticProjection(event: InternetSearchDiagnosticEvent) {
  if (event.event_type !== "operation") return event;
  const { capability_id: _capabilityId, capability_version: _capabilityVersion, ...genericEvent } = event;
  return genericEvent;
}

const unsafeDiagnosticTextPattern =
  /(?:https?:|localhost|127\.0\.0\.1|0\.0\.0\.0|\bport\b|credential|secret|vault|api[_-]?key|authorization|cookie|\/(?:home|tmp|etc|var|Users)\/)/i;
