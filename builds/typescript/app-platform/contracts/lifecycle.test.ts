import { describe, expect, it } from "vitest";

import {
  ALLOWED_LIFECYCLE_TRANSITIONS,
  assertEquivalentRetry,
  assertLifecycleTransition,
  LifecycleTransitionSchema,
  OperationRecordSchema,
} from "./lifecycle.js";

describe("lifecycle contract", () => {
  it("accepts every declared transition and rejects every other state pair", () => {
    const states = Object.keys(ALLOWED_LIFECYCLE_TRANSITIONS) as Array<keyof typeof ALLOWED_LIFECYCLE_TRANSITIONS>;
    for (const from of states) {
      for (const to of states) {
        const accepted = ALLOWED_LIFECYCLE_TRANSITIONS[from].includes(to);
        if (accepted) {
          expect(() => assertLifecycleTransition(from, to), `${from} -> ${to}`).not.toThrow();
        } else {
          expect(() => assertLifecycleTransition(from, to), `${from} -> ${to}`).toThrowError(/not allowed/);
        }
      }
    }
  });

  it("rejects direct not-installed activation and ambiguous commit metadata", () => {
    const transition = {
      lifecycle_transition_version: 1,
      transition_id: "90000000-0000-4000-8000-000000000001",
      operation_id: "90000000-0000-4000-8000-000000000002",
      installation_id: "90000000-0000-4000-8000-000000000003",
      package_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      from: "not_installed",
      to: "active",
      requested_at: "2026-08-07T12:00:00.000Z",
      committed_at: null,
      outcome: "committed",
    };
    expect(LifecycleTransitionSchema.safeParse(transition).success).toBe(false);
  });
});

describe("operation and idempotency contract", () => {
  const operation = {
    operation_schema_version: 1,
    operation_id: "91000000-0000-4000-8000-000000000001",
    idempotency_key: "0000000000000000",
    canonical_input_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    owner_id: "91000000-0000-4000-8000-000000000002",
    actor_id: "91000000-0000-4000-8000-000000000002",
    app_id: "ai.braindrive.resume-builder",
    installation_id: "91000000-0000-4000-8000-000000000003",
    capability: "resume.definitions.write",
    target_category: "resume_definition",
    target_id: null,
    expected_revision: null,
    status: "committed",
    commit_outcome: "committed_response_recovered",
    last_cancellable_status: "running",
    started_at: "2026-08-07T12:00:00.000Z",
    completed_at: "2026-08-07T12:00:01.000Z",
    result_ref: "91000000-0000-4000-8000-000000000004",
    error_code: null,
  } as const;

  it("accepts equivalent terminal retries and rejects changed input under the same identity", () => {
    expect(OperationRecordSchema.safeParse(operation).success).toBe(true);
    expect(() => assertEquivalentRetry(operation, { ...operation })).not.toThrow();
    expect(() => assertEquivalentRetry(operation, { ...operation, canonical_input_digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" })).toThrowError(/different canonical input/);
  });

  it("prevents cancelled operations from claiming a commit", () => {
    expect(OperationRecordSchema.safeParse({ ...operation, status: "cancelled_before_commit", commit_outcome: "committed", result_ref: null }).success).toBe(false);
  });
});
