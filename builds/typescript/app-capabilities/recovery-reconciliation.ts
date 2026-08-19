export const RESUME_RECOVERY_RECONCILIATION_POLICY = Object.freeze({
  initial_ui_transition_ms: 500,
  early_poll_elapsed_ms: [625, 750, 1_000, 1_500, 2_500, 4_500, 8_500] as const,
  maximum_poll_interval_ms: 5_000,
  host_operation_deadline_ms: 120_000,
  final_authoritative_read_ms: 120_000,
});

export type ResumeRecoveryBinding = {
  operation_id: string;
  semantic_digest: `sha256:${string}`;
  value_digest: `sha256:${string}`;
  expected_revision: number | null;
};

export type ResumeRecoveryOperationReadback =
  | { state: "not_found_within_scope" }
  | { state: "committed"; operation_id: string; value_digest: `sha256:${string}`; revision: number }
  | { state: "conflict"; conflict_class: "idempotency_input_mismatch" | "cas_revision_mismatch" | "durable_value_mismatch" }
  | { state: "cancelled" }
  | { state: "failed" };

const ResumeRecoveryOperationReadbackSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("not_found_within_scope") }).strict(),
  z.object({ state: z.literal("committed"), operation_id: OpaqueIdSchema, value_digest: Sha256DigestSchema, revision: z.number().int().positive() }).strict(),
  z.object({ state: z.literal("conflict"), conflict_class: z.enum(["idempotency_input_mismatch", "cas_revision_mismatch", "durable_value_mismatch"]) }).strict(),
  z.object({ state: z.literal("cancelled") }).strict(),
  z.object({ state: z.literal("failed") }).strict(),
]);

export const ResumeRecoveryReconciliationQuerySchema = z.object({
  queried_operation_id: OpaqueIdSchema,
  reconciliation: z.literal("resume_recovery_v1"),
}).strict();

const projectionBindingFields = {
  reconciliation_version: z.literal(1),
  queried_operation_id: OpaqueIdSchema,
  semantic_digest: Sha256DigestSchema,
  expected_revision: z.number().int().nonnegative().nullable(),
} as const;

export const ResumeRecoveryOperationLifecycleProjectionSchema = z.discriminatedUnion("lifecycle_state", [
  z.object({
    ...projectionBindingFields,
    lifecycle_state: z.literal("pending"),
    host_operation_settled: z.literal(false),
    operation: z.object({ state: z.literal("not_found_within_scope") }).strict(),
  }).strict(),
  z.object({
    ...projectionBindingFields,
    lifecycle_state: z.literal("completed_without_operation"),
    host_operation_settled: z.literal(true),
    operation: z.object({ state: z.literal("not_found_within_scope") }).strict(),
  }).strict(),
  z.object({
    ...projectionBindingFields,
    lifecycle_state: z.literal("committed"),
    host_operation_settled: z.literal(true),
    operation: z.object({ state: z.literal("committed"), operation_id: OpaqueIdSchema, value_digest: Sha256DigestSchema, revision: z.number().int().positive() }).strict(),
  }).strict(),
  z.object({
    ...projectionBindingFields,
    lifecycle_state: z.literal("cancelled"),
    host_operation_settled: z.literal(true),
    operation: z.object({ state: z.literal("cancelled") }).strict(),
  }).strict(),
  z.object({
    ...projectionBindingFields,
    lifecycle_state: z.literal("failed"),
    host_operation_settled: z.literal(true),
    operation: z.object({ state: z.literal("failed") }).strict(),
  }).strict(),
  z.object({
    ...projectionBindingFields,
    lifecycle_state: z.literal("conflict"),
    host_operation_settled: z.literal(true),
    operation: z.object({ state: z.literal("conflict"), conflict_class: z.enum(["idempotency_input_mismatch", "cas_revision_mismatch", "durable_value_mismatch"]) }).strict(),
  }).strict(),
  z.object({
    reconciliation_version: z.literal(1),
    queried_operation_id: OpaqueIdSchema,
    semantic_digest: z.null(),
    expected_revision: z.null(),
    lifecycle_state: z.literal("current_process_lifecycle_unknown"),
    host_operation_settled: z.literal(false),
    operation: z.object({ state: z.literal("not_found_within_scope") }).strict(),
  }).strict(),
  z.object({
    reconciliation_version: z.literal(1),
    queried_operation_id: OpaqueIdSchema,
    semantic_digest: z.null(),
    expected_revision: z.null(),
    lifecycle_state: z.literal("quiesced_restart_no_operation"),
    host_operation_settled: z.literal(true),
    operation: z.object({ state: z.literal("not_found_within_scope") }).strict(),
  }).strict(),
]);

export type ResumeRecoveryOperationLifecycleProjection = z.infer<typeof ResumeRecoveryOperationLifecycleProjectionSchema>;

export function resumeRecoveryProjectionToReadback(projection: ResumeRecoveryOperationLifecycleProjection): {
  host_operation_settled: boolean;
  operation: ResumeRecoveryOperationReadback;
} {
  return {
    host_operation_settled: projection.host_operation_settled,
    operation: ResumeRecoveryOperationReadbackSchema.parse(projection.operation) as ResumeRecoveryOperationReadback,
  };
}

export type ResumeRecoveryWorkspaceReadback =
  | { state: "matching_commit"; operation_id: string | null; value_digest: `sha256:${string}`; revision: number }
  | { state: "different_commit"; value_digest: `sha256:${string}`; revision: number }
  | { state: "no_commit" };

export type ResumeRecoveryReconciliationDecision = {
  state: "pending" | "committed" | "conflict" | "cancelled" | "not_saved";
  final: boolean;
  reconciliation_class: "operation_read" | "operation_then_workspace";
  conflict_class: "none" | "idempotency_input_mismatch" | "cas_revision_mismatch" | "durable_binding_mismatch" | "durable_value_mismatch";
};

export function nextResumeRecoveryPollElapsedMs(elapsedMs: number): number | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new TypeError("Recovery reconciliation elapsed time must be non-negative");
  if (elapsedMs >= RESUME_RECOVERY_RECONCILIATION_POLICY.final_authoritative_read_ms) return null;
  const early = RESUME_RECOVERY_RECONCILIATION_POLICY.early_poll_elapsed_ms.find((candidate) => candidate > elapsedMs);
  if (early !== undefined) return early;
  return Math.min(
    elapsedMs + RESUME_RECOVERY_RECONCILIATION_POLICY.maximum_poll_interval_ms,
    RESUME_RECOVERY_RECONCILIATION_POLICY.final_authoritative_read_ms,
  );
}

export function decideResumeRecoveryReconciliation(input: {
  binding: ResumeRecoveryBinding;
  elapsed_ms: number;
  host_operation_settled: boolean;
  operation: ResumeRecoveryOperationReadback;
  workspace: ResumeRecoveryWorkspaceReadback | null;
}): ResumeRecoveryReconciliationDecision {
  const operationClass = input.workspace === null ? "operation_read" : "operation_then_workspace";
  const expectedCommittedRevision = (input.binding.expected_revision ?? 0) + 1;

  if (input.operation.state === "committed") {
    const exact = input.operation.operation_id === input.binding.operation_id
      && input.operation.value_digest === input.binding.value_digest
      && input.operation.revision === expectedCommittedRevision;
    return exact
      ? decision("committed", true, operationClass)
      : decision("conflict", true, operationClass, "durable_binding_mismatch");
  }
  if (input.operation.state === "conflict") {
    return decision("conflict", true, operationClass, input.operation.conflict_class);
  }

  if (input.host_operation_settled && input.workspace?.state === "matching_commit") {
    const exact = input.workspace.value_digest === input.binding.value_digest
      && input.workspace.revision === expectedCommittedRevision
      && input.workspace.operation_id === input.binding.operation_id;
    return exact
      ? decision("committed", true, "operation_then_workspace")
      : decision("conflict", true, "operation_then_workspace", "durable_binding_mismatch");
  }
  if (input.host_operation_settled && input.workspace?.state === "different_commit") {
    return decision("conflict", true, "operation_then_workspace", "durable_value_mismatch");
  }
  if (input.operation.state === "cancelled" && input.host_operation_settled && input.workspace?.state === "no_commit") {
    return decision("cancelled", true, "operation_then_workspace");
  }

  const terminalBoundaryReached = input.elapsed_ms >= RESUME_RECOVERY_RECONCILIATION_POLICY.final_authoritative_read_ms;
  if (terminalBoundaryReached && input.host_operation_settled && input.workspace?.state === "no_commit") {
    return decision("not_saved", true, "operation_then_workspace");
  }
  return decision("pending", false, operationClass);
}

function decision(
  state: ResumeRecoveryReconciliationDecision["state"],
  final: boolean,
  reconciliationClass: ResumeRecoveryReconciliationDecision["reconciliation_class"],
  conflictClass: ResumeRecoveryReconciliationDecision["conflict_class"] = "none",
): ResumeRecoveryReconciliationDecision {
  return { state, final, reconciliation_class: reconciliationClass, conflict_class: conflictClass };
}
import { z } from "zod";

import { OpaqueIdSchema, Sha256DigestSchema } from "../app-platform/contracts/common.js";
