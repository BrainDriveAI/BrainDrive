import { describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import {
  RESUME_RECOVERY_RECONCILIATION_POLICY,
  decideResumeRecoveryReconciliation,
  nextResumeRecoveryPollElapsedMs,
  resumeRecoveryProjectionToReadback,
  ResumeRecoveryOperationLifecycleProjectionSchema,
  type ResumeRecoveryBinding,
} from "./recovery-reconciliation.js";

const operationId = "91000000-0000-4000-8000-000000000001";
const valueDigest = canonicalInputDigest("Synthetic recovery value");
const binding: ResumeRecoveryBinding = {
  operation_id: operationId,
  semantic_digest: canonicalInputDigest({ operation_id: operationId }),
  value_digest: valueDigest,
  expected_revision: 0,
};

describe("Spec 10 durable recovery reconciliation contract", () => {
  it("freezes the accepted initial transition, authoritative reads, bounded backoff, and host deadline", () => {
    expect(RESUME_RECOVERY_RECONCILIATION_POLICY).toEqual({
      initial_ui_transition_ms: 500,
      early_poll_elapsed_ms: [625, 750, 1_000, 1_500, 2_500, 4_500, 8_500],
      maximum_poll_interval_ms: 5_000,
      host_operation_deadline_ms: 120_000,
      final_authoritative_read_ms: 120_000,
    });
    expect([0, 625, 750, 1_000, 1_500, 2_500, 4_500, 8_500].map(nextResumeRecoveryPollElapsedMs)).toEqual([
      625, 750, 1_000, 1_500, 2_500, 4_500, 8_500, 13_500,
    ]);
    expect(nextResumeRecoveryPollElapsedMs(118_500)).toBe(120_000);
    expect(nextResumeRecoveryPollElapsedMs(120_000)).toBeNull();
  });

  it("treats every early scoped miss as pending and never lets elapsed client time prove not-saved", () => {
    for (const elapsedMs of [500, 625, 8_500, 119_999, 120_000]) {
      expect(decideResumeRecoveryReconciliation({
        binding,
        elapsed_ms: elapsedMs,
        host_operation_settled: false,
        operation: { state: "not_found_within_scope" },
        workspace: elapsedMs === 120_000 ? { state: "no_commit" } : null,
      })).toMatchObject({ state: "pending", final: false, conflict_class: "none" });
    }
  });

  it("accepts only an exact committed operation/value/revision binding", () => {
    const committed = {
      state: "committed" as const,
      operation_id: binding.operation_id,
      value_digest: binding.value_digest,
      revision: 1,
    };
    expect(decideResumeRecoveryReconciliation({
      binding,
      elapsed_ms: 741,
      host_operation_settled: false,
      operation: committed,
      workspace: null,
    })).toEqual({ state: "committed", final: true, reconciliation_class: "operation_read", conflict_class: "none" });

    for (const stale of [
      { ...committed, operation_id: "91000000-0000-4000-8000-000000000002" },
      { ...committed, value_digest: canonicalInputDigest("Different value") },
      { ...committed, revision: 2 },
    ]) {
      expect(decideResumeRecoveryReconciliation({ binding, elapsed_ms: 741, host_operation_settled: false, operation: stale, workspace: null }))
        .toEqual({ state: "conflict", final: true, reconciliation_class: "operation_read", conflict_class: "durable_binding_mismatch" });
    }
  });

  it("classifies not-saved only at the aligned host boundary after final workspace readback", () => {
    const atBoundary = {
      binding,
      elapsed_ms: 120_000,
      host_operation_settled: true,
      operation: { state: "failed" as const },
    };
    expect(decideResumeRecoveryReconciliation({ ...atBoundary, workspace: null })).toMatchObject({ state: "pending", final: false });
    expect(decideResumeRecoveryReconciliation({ ...atBoundary, workspace: { state: "no_commit" } })).toEqual({
      state: "not_saved", final: true, reconciliation_class: "operation_then_workspace", conflict_class: "none",
    });
    expect(decideResumeRecoveryReconciliation({
      ...atBoundary,
      workspace: { state: "matching_commit", operation_id: operationId, value_digest: valueDigest, revision: 1 },
    })).toEqual({ state: "committed", final: true, reconciliation_class: "operation_then_workspace", conflict_class: "none" });
    for (const mismatchedOperationId of [null, "91000000-0000-4000-8000-000000000002"]) {
      expect(decideResumeRecoveryReconciliation({
        ...atBoundary,
        workspace: { state: "matching_commit", operation_id: mismatchedOperationId, value_digest: valueDigest, revision: 1 },
      })).toEqual({ state: "conflict", final: true, reconciliation_class: "operation_then_workspace", conflict_class: "durable_binding_mismatch" });
    }
    expect(decideResumeRecoveryReconciliation({
      ...atBoundary,
      workspace: { state: "different_commit", value_digest: canonicalInputDigest("Winning value"), revision: 1 },
    })).toEqual({ state: "conflict", final: true, reconciliation_class: "operation_then_workspace", conflict_class: "durable_value_mismatch" });
  });

  it("keeps CAS/idempotency conflict and explicit settled cancellation distinct", () => {
    expect(decideResumeRecoveryReconciliation({
      binding, elapsed_ms: 700, host_operation_settled: true,
      operation: { state: "conflict", conflict_class: "cas_revision_mismatch" },
      workspace: { state: "different_commit", value_digest: canonicalInputDigest("Winner"), revision: 1 },
    })).toEqual({ state: "conflict", final: true, reconciliation_class: "operation_then_workspace", conflict_class: "cas_revision_mismatch" });
    expect(decideResumeRecoveryReconciliation({
      binding, elapsed_ms: 600, host_operation_settled: true,
      operation: { state: "cancelled" }, workspace: { state: "no_commit" },
    })).toEqual({ state: "cancelled", final: true, reconciliation_class: "operation_then_workspace", conflict_class: "none" });
    expect(decideResumeRecoveryReconciliation({
      binding, elapsed_ms: 120_000, host_operation_settled: false,
      operation: { state: "cancelled" }, workspace: { state: "no_commit" },
    })).toEqual({ state: "pending", final: false, reconciliation_class: "operation_then_workspace", conflict_class: "none" });
  });

  it("converts the strict host projection into reachable reconciliation inputs", () => {
    const pending = ResumeRecoveryOperationLifecycleProjectionSchema.parse({
      reconciliation_version: 1,
      lifecycle_state: "pending",
      queried_operation_id: operationId,
      semantic_digest: binding.semantic_digest,
      expected_revision: binding.expected_revision,
      host_operation_settled: false,
      operation: { state: "not_found_within_scope" },
    });
    expect(resumeRecoveryProjectionToReadback(pending)).toEqual({
      host_operation_settled: false,
      operation: { state: "not_found_within_scope" },
    });
    expect(decideResumeRecoveryReconciliation({
      binding, elapsed_ms: 120_000, workspace: { state: "no_commit" }, ...resumeRecoveryProjectionToReadback(pending),
    })).toMatchObject({ state: "pending", final: false });

    expect(() => ResumeRecoveryOperationLifecycleProjectionSchema.parse({
      ...pending,
      lifecycle_state: "committed",
      host_operation_settled: true,
    })).toThrow();

    const currentProcessUnknown = ResumeRecoveryOperationLifecycleProjectionSchema.parse({
      reconciliation_version: 1,
      lifecycle_state: "current_process_lifecycle_unknown",
      queried_operation_id: operationId,
      semantic_digest: null,
      expected_revision: null,
      host_operation_settled: false,
      operation: { state: "not_found_within_scope" },
    });
    expect(decideResumeRecoveryReconciliation({
      binding, elapsed_ms: 120_000, workspace: { state: "no_commit" },
      ...resumeRecoveryProjectionToReadback(currentProcessUnknown),
    })).toMatchObject({ state: "pending", final: false });

    const quiescedRestart = ResumeRecoveryOperationLifecycleProjectionSchema.parse({
      reconciliation_version: 1,
      lifecycle_state: "quiesced_restart_no_operation",
      queried_operation_id: operationId,
      semantic_digest: null,
      expected_revision: null,
      host_operation_settled: true,
      operation: { state: "not_found_within_scope" },
    });
    expect(decideResumeRecoveryReconciliation({
      binding, elapsed_ms: 120_000, workspace: { state: "no_commit" },
      ...resumeRecoveryProjectionToReadback(quiescedRestart),
    })).toEqual({ state: "not_saved", final: true, reconciliation_class: "operation_then_workspace", conflict_class: "none" });
    expect(decideResumeRecoveryReconciliation({
      binding, elapsed_ms: 120_000,
      workspace: { state: "different_commit", value_digest: canonicalInputDigest("Restart winner"), revision: 1 },
      ...resumeRecoveryProjectionToReadback(quiescedRestart),
    })).toEqual({ state: "conflict", final: true, reconciliation_class: "operation_then_workspace", conflict_class: "durable_value_mismatch" });
  });
});
