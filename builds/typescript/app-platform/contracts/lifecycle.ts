import { z } from "zod";

import { OpaqueIdSchema, Sha256DigestSchema, TimestampSchema } from "./common.js";
import { ContractViolation } from "./errors.js";

export const LifecycleStateSchema = z.enum([
  "not_installed",
  "staged",
  "active",
  "disabled",
  "updating",
  "rollback_pending",
  "uninstalling",
  "quarantined",
  "failed_recoverable",
]);

export type LifecycleState = z.infer<typeof LifecycleStateSchema>;

export const ALLOWED_LIFECYCLE_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  not_installed: ["staged"],
  staged: ["active", "not_installed", "quarantined", "failed_recoverable"],
  active: ["disabled", "updating", "rollback_pending", "uninstalling", "quarantined", "failed_recoverable"],
  disabled: ["active", "updating", "rollback_pending", "uninstalling", "quarantined", "failed_recoverable"],
  updating: ["active", "disabled", "rollback_pending", "quarantined", "failed_recoverable"],
  rollback_pending: ["active", "disabled", "quarantined", "failed_recoverable"],
  uninstalling: ["not_installed", "failed_recoverable"],
  quarantined: ["not_installed"],
  failed_recoverable: ["staged", "active", "disabled", "rollback_pending", "uninstalling", "quarantined"],
};

export const LifecycleTransitionSchema = z
  .object({
    lifecycle_transition_version: z.literal(1),
    transition_id: OpaqueIdSchema,
    operation_id: OpaqueIdSchema,
    installation_id: OpaqueIdSchema,
    package_digest: Sha256DigestSchema,
    from: LifecycleStateSchema,
    to: LifecycleStateSchema,
    requested_at: TimestampSchema,
    committed_at: TimestampSchema.nullable(),
    outcome: z.enum(["pending", "committed", "rolled_back", "rejected", "failed_recoverable"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (!ALLOWED_LIFECYCLE_TRANSITIONS[value.from].includes(value.to)) {
      context.addIssue({ code: "custom", message: "invalid_state_transition" });
    }
    if ((value.outcome === "committed") !== (value.committed_at !== null)) {
      context.addIssue({ code: "custom", message: "lifecycle transition commit timestamp is ambiguous" });
    }
  });

export function assertLifecycleTransition(from: LifecycleState, to: LifecycleState): void {
  if (!ALLOWED_LIFECYCLE_TRANSITIONS[from].includes(to)) {
    throw new ContractViolation("invalid_state_transition", `Lifecycle transition ${from} -> ${to} is not allowed`);
  }
}

export const SuccessfulUseCheckpointSchema = z
  .object({
    checkpoint_version: z.literal(1),
    package_digest: Sha256DigestSchema,
    status: z.enum(["pending", "passed", "failed"]),
    started_at: TimestampSchema,
    completed_at: TimestampSchema.nullable(),
    evidence_operation_id: OpaqueIdSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.status === "pending") !== (value.completed_at === null)) {
      context.addIssue({ code: "custom", message: "successful-use checkpoint completion is ambiguous" });
    }
    if ((value.status === "passed") !== (value.evidence_operation_id !== null)) {
      context.addIssue({ code: "custom", message: "passed successful-use checkpoint requires operation evidence" });
    }
  });

export const LifecycleRecordSchema = z
  .object({
    lifecycle_schema_version: z.literal(1),
    app_id: z.literal("ai.braindrive.resume-builder"),
    installation_id: OpaqueIdSchema.nullable(),
    state: LifecycleStateSchema,
    generation: z.number().int().nonnegative(),
    active_package_digest: Sha256DigestSchema.nullable(),
    last_known_good_package_digest: Sha256DigestSchema.nullable(),
    grant_id: OpaqueIdSchema.nullable(),
    pending_operation_id: OpaqueIdSchema.nullable(),
    successful_use_checkpoint: SuccessfulUseCheckpointSchema.nullable(),
    updated_at: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === "not_installed") {
      if (
        value.installation_id !== null ||
        value.active_package_digest !== null ||
        value.last_known_good_package_digest !== null ||
        value.grant_id !== null ||
        value.successful_use_checkpoint !== null
      ) {
        context.addIssue({ code: "custom", message: "not_installed cannot retain runtime authority" });
      }
      return;
    }
    if (value.installation_id === null) {
      context.addIssue({ code: "custom", message: "installed lifecycle states require installation identity" });
    }
    if (value.state === "active" && (value.active_package_digest === null || value.grant_id === null)) {
      context.addIssue({ code: "custom", message: "active lifecycle state requires package and grant authority" });
    }
    if (
      value.active_package_digest !== null &&
      value.last_known_good_package_digest !== null &&
      value.active_package_digest === value.last_known_good_package_digest
    ) {
      context.addIssue({ code: "custom", message: "active and last-known-good package identities must differ" });
    }
  });

export const OperationStatusSchema = z.enum([
  "accepted",
  "running",
  "cancel_requested",
  "committed",
  "cancelled_before_commit",
  "failed",
]);

export const CommitOutcomeSchema = z.enum([
  "not_committed",
  "committed",
  "committed_response_recovered",
  "rolled_back_before_commit",
]);

export const OperationRecordSchema = z
  .object({
    operation_schema_version: z.literal(1),
    operation_id: OpaqueIdSchema,
    idempotency_key: z.string().min(16).max(256),
    canonical_input_digest: Sha256DigestSchema,
    owner_id: OpaqueIdSchema,
    actor_id: OpaqueIdSchema,
    app_id: z.string().min(1).max(512),
    installation_id: OpaqueIdSchema,
    capability: z.string().min(1).max(256),
    target_category: z.string().min(1).max(128),
    target_id: OpaqueIdSchema.nullable(),
    expected_revision: z.number().int().positive().nullable(),
    status: OperationStatusSchema,
    commit_outcome: CommitOutcomeSchema,
    last_cancellable_status: z.literal("running"),
    started_at: TimestampSchema,
    completed_at: TimestampSchema.nullable(),
    result_ref: OpaqueIdSchema.nullable(),
    error_code: z.string().min(1).max(128).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const terminal = ["committed", "cancelled_before_commit", "failed"].includes(value.status);
    if (terminal !== (value.completed_at !== null)) {
      context.addIssue({ code: "custom", message: "terminal operation completion timestamp mismatch" });
    }
    if (value.status === "committed" && !value.commit_outcome.startsWith("committed")) {
      context.addIssue({ code: "custom", message: "committed status requires committed outcome" });
    }
    if (value.status === "cancelled_before_commit" && value.commit_outcome !== "not_committed") {
      context.addIssue({ code: "custom", message: "pre-commit cancellation cannot report a commit" });
    }
  });

export const LifecycleOperationKindSchema = z.enum([
  "install",
  "disable",
  "enable",
  "update",
  "rollback",
  "uninstall",
  "quarantine",
  "reconcile",
]);

export const LifecycleOperationStageSchema = z.enum([
  "requested",
  "verifying_source",
  "verifying_package",
  "staging",
  "granting",
  "snapshotting",
  "migrating",
  "starting",
  "awaiting_readiness",
  "switching_active_pointer",
  "registering",
  "revoking_tokens",
  "stopping",
  "rolling_back",
  "removing_runtime_authority",
  "reconciling",
  "completed",
]);

export const LifecycleResultSchema = z
  .object({
    result_version: z.literal(1),
    outcome: z.enum(["committed", "no_change", "rolled_back", "quarantined", "failed_recoverable"]),
    final_state: LifecycleStateSchema,
    final_generation: z.number().int().nonnegative(),
    active_package_digest: Sha256DigestSchema.nullable(),
    retained_last_known_good_digest: Sha256DigestSchema.nullable(),
    runtime_authority_removed: z.boolean(),
    owner_data_preserved: z.literal(true),
  })
  .strict()
  .superRefine((value, context) => {
    if (["not_installed", "disabled", "quarantined"].includes(value.final_state) && !value.runtime_authority_removed) {
      context.addIssue({ code: "custom", message: "non-runnable result must remove runtime authority" });
    }
    if (value.final_state === "active" && value.active_package_digest === null) {
      context.addIssue({ code: "custom", message: "active lifecycle result requires a package digest" });
    }
  });

export const LifecycleOperationSchema = z
  .object({
    lifecycle_operation_version: z.literal(1),
    operation_id: OpaqueIdSchema,
    idempotency_key: z.string().min(16).max(256),
    canonical_input_digest: Sha256DigestSchema,
    owner_id: OpaqueIdSchema,
    actor_id: OpaqueIdSchema,
    app_id: z.literal("ai.braindrive.resume-builder"),
    installation_id: OpaqueIdSchema,
    kind: LifecycleOperationKindSchema,
    prior_record_digest: Sha256DigestSchema,
    prior_generation: z.number().int().nonnegative(),
    prior_state: LifecycleStateSchema,
    target_state: LifecycleStateSchema,
    next_state: LifecycleStateSchema,
    stage: LifecycleOperationStageSchema,
    completed_stages: z.array(LifecycleOperationStageSchema).max(18),
    compensations: z
      .array(
        z
          .object({
            stage: LifecycleOperationStageSchema,
            action: z.enum(["remove_staging", "stop_candidate", "restore_pointer", "restore_snapshot", "revoke_tokens", "remove_registration"]),
            status: z.enum(["pending", "completed", "failed"]),
          })
          .strict(),
      )
      .max(18),
    status: OperationStatusSchema,
    commit_outcome: CommitOutcomeSchema,
    recovery: z
      .object({
        action: z.enum([
          "none",
          "remove_staging_and_restore_prior",
          "stop_candidate_and_restore_prior",
          "restore_snapshot_and_last_known_good",
          "revoke_and_quarantine",
          "reconcile_committed_pointer",
          "complete_runtime_authority_removal",
        ]),
        from_stage: LifecycleOperationStageSchema,
        safe_state: LifecycleStateSchema,
        snapshot_ref: OpaqueIdSchema.nullable(),
      })
      .strict(),
    started_at: TimestampSchema,
    updated_at: TimestampSchema,
    completed_at: TimestampSchema.nullable(),
    result: LifecycleResultSchema.nullable(),
    error_code: z.string().min(1).max(128).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.completed_stages).size !== value.completed_stages.length) {
      context.addIssue({ code: "custom", message: "duplicate lifecycle operation stage" });
    }
    const compensationIdentities = value.compensations.map((item) => `${item.stage}/${item.action}`);
    if (new Set(compensationIdentities).size !== compensationIdentities.length) {
      context.addIssue({ code: "custom", message: "duplicate lifecycle compensation" });
    }
    const terminal = ["committed", "cancelled_before_commit", "failed"].includes(value.status);
    if (terminal !== (value.completed_at !== null)) {
      context.addIssue({ code: "custom", message: "lifecycle terminal completion timestamp mismatch" });
    }
    if ((value.status === "committed") !== (value.result !== null)) {
      context.addIssue({ code: "custom", message: "lifecycle committed status and result disagree" });
    }
    if (value.status === "committed" && !value.commit_outcome.startsWith("committed")) {
      context.addIssue({ code: "custom", message: "lifecycle committed status requires committed outcome" });
    }
    if (value.status === "failed" && value.error_code === null) {
      context.addIssue({ code: "custom", message: "failed lifecycle operation requires a safe error code" });
    }
    if (value.result !== null) {
      const expectedFinalState = value.result.outcome === "rolled_back"
        ? value.prior_state
        : value.result.outcome === "quarantined"
          ? "quarantined"
          : value.result.outcome === "failed_recoverable"
            ? "failed_recoverable"
            : value.target_state;
      if (value.result.final_state !== expectedFinalState) {
        context.addIssue({ code: "custom", message: "lifecycle result does not match operation outcome" });
      }
    }
    if (value.status === "running" && value.next_state === value.prior_state && value.kind !== "reconcile") {
      context.addIssue({ code: "custom", message: "running lifecycle operation must expose its next state" });
    }
  });

export function assertEquivalentRetry(
  existing: Pick<z.infer<typeof OperationRecordSchema>, "installation_id" | "idempotency_key" | "canonical_input_digest">,
  candidate: Pick<z.infer<typeof OperationRecordSchema>, "installation_id" | "idempotency_key" | "canonical_input_digest">,
): void {
  const sameIdentity =
    existing.installation_id === candidate.installation_id && existing.idempotency_key === candidate.idempotency_key;
  if (sameIdentity && existing.canonical_input_digest !== candidate.canonical_input_digest) {
    throw new ContractViolation("idempotency_conflict", "Operation identity was reused with different canonical input");
  }
}
