import type { z } from "zod";

import {
  assertLifecycleDiagnostic,
  LifecycleDiagnosticEventSchema,
} from "../contracts/audit.js";
import { RESUME_BUILDER_APP_ID, RESUME_BUILDER_PUBLISHER_ID } from "../contracts/constants.js";
import type { DurableLifecycleJournal, DurableLifecycleResult } from "./durable-store.js";

export type LifecycleDiagnosticEvent = z.infer<typeof LifecycleDiagnosticEventSchema>;
export type LifecycleDiagnosticSink = (event: LifecycleDiagnosticEvent) => void;

/** Validates the strict M1 metadata allowlist before any diagnostic leaves M2. */
export class AllowlistedLifecycleDiagnostics {
  constructor(private readonly sink: LifecycleDiagnosticSink) {}

  emit(event: unknown): void {
    assertLifecycleDiagnostic(event);
    this.sink(event);
  }

  emitTransition(journal: DurableLifecycleJournal, result: DurableLifecycleResult): void {
    const failed = result.outcome === "failed_recoverable";
    const packageReference = journal.proposed_active_ref ?? journal.prior_active_ref;
    const elapsedMs = Math.max(
      0,
      Date.parse(journal.completed_at ?? journal.updated_at) - Date.parse(journal.started_at),
    );
    this.emit({
      diagnostic_version: 1,
      event_name: "app.lifecycle.transition",
      occurred_at: journal.completed_at ?? journal.updated_at,
      correlation_id: journal.operation_id,
      operation_id: journal.operation_id,
      owner_id: journal.owner_id,
      actor_id: journal.actor_id,
      app_id: RESUME_BUILDER_APP_ID,
      publisher_id: RESUME_BUILDER_PUBLISHER_ID,
      installation_id: journal.installation_id,
      grant_id: journal.proposed_record.grant_id,
      runtime_id: null,
      registration_id: null,
      package_version: packageReference?.package_version ?? null,
      package_digest: result.active_package_digest,
      prior_state: journal.prior_record.state,
      target_state: journal.proposed_record.state,
      result_state: result.final_state,
      generation: result.final_generation,
      step: "completed",
      attempt: 1,
      source_id: null,
      trust_policy_version: 1,
      revocation_policy_version: 1,
      revocation_sequence: null,
      capability_diff: null,
      data_schema_compatibility: "not_checked",
      snapshot_id: null,
      external_status: "not_attempted",
      outcome: failed ? "failed" : result.outcome === "rolled_back" ? "rolled_back" : "completed",
      error_class: failed ? "recovery" : null,
      error_code: failed ? journal.error_code ?? "recoverable_internal_failure" : null,
      retryable: failed,
      recovery: failed ? "contact_operator" : result.outcome === "rolled_back" ? "restore_prior" : "none",
      elapsed_ms: elapsedMs,
      item_count: journal.completed_steps.length,
      byte_count: 0,
    });
  }
}
