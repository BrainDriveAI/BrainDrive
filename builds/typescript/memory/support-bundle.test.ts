import { describe, expect, it } from "vitest";

import { sanitizeSupportAuditEvent } from "./support-bundle.js";

describe("Spec 09 support-bundle inference diagnostics", () => {
  it("retains the exact content-minimized terminal fields", () => {
    const sanitized = sanitizeSupportAuditEvent({
      timestamp: "2026-08-14T12:00:00.000Z",
      event: "app.inference.completed",
      details: {
        diagnostic_version: 1,
        app_id: "ai.braindrive.resume-builder",
        operation_id: "b0000000-0000-4000-8000-000000000001",
        request_id: "b0000000-0000-4000-8000-000000000002",
        purpose: "general_resume_draft",
        prompt_policy_id: "braindrive.resume-builder.fixed",
        prompt_policy_version: "8",
        output_schema_id: "resume.general-draft.v1",
        output_schema_version: 1,
        model_class: "owner_active_compatible",
        attempt_count: 2,
        stage: "deterministic_validation",
        finish_category: "stop",
        error_code: "evidence_validation_failed",
        retryable: false,
        recovery_class: "none",
        completion_mode: "none",
        final_disposition: "failed",
        usage_available: true,
        duration_class: "under_5s",
        validator_codes: ["unsupported_claim"],
        provider_validator_codes: ["missing_provenance", "unsupported_claim"],
        provider_validator_rule_ids: ["statement_support_unresolved", "statement_factual_wording_unsupported"],
        local_candidate_classes: ["targeted_fact_repair", "full_general_constructor"],
        targeted_fact_repair_validator_codes: ["missing_provenance"],
        targeted_fact_repair_validator_rule_ids: ["statement_support_unresolved"],
        targeted_fact_repair_disposition: "rejected",
        full_general_constructor_validator_codes: [],
        full_general_constructor_validator_rule_ids: [],
        full_general_constructor_disposition: "accepted",
        original_failure_code: "evidence_validation_failed",
        recovery_disposition: "full_constructor_accepted",
      },
    });
    expect(sanitized).toMatchObject({
      event: "app.inference.completed",
      details: {
        diagnostic_version: 1,
        purpose: "general_resume_draft",
        operation_id: "b0000000-0000-4000-8000-000000000001",
        stage: "deterministic_validation",
        local_candidate_classes: ["targeted_fact_repair", "full_general_constructor"],
        provider_validator_rule_ids: ["statement_support_unresolved", "statement_factual_wording_unsupported"],
        targeted_fact_repair_validator_rule_ids: ["statement_support_unresolved"],
        full_general_constructor_validator_rule_ids: [],
        targeted_fact_repair_disposition: "rejected",
        full_general_constructor_disposition: "accepted",
        recovery_disposition: "full_constructor_accepted",
        finish_category: "stop",
        recovery_class: "none",
        final_disposition: "failed",
        validator_codes: ["unsupported_claim"],
      },
    });
  });

  it("retains the safe attempt decision fields", () => {
    const sanitized = sanitizeSupportAuditEvent({
      timestamp: "2026-08-14T12:00:00.000Z",
      event: "app.inference.attempt",
      details: {
        diagnostic_version: 1,
        app_id: "ai.braindrive.resume-builder",
        operation_id: "b0000000-0000-4000-8000-000000000001",
        request_id: "b0000000-0000-4000-8000-000000000002",
        purpose: "general_resume_draft",
        attempt: 1,
        stage: "structured_parse",
        finish_category: "stop",
        attempt_outcome: "retry",
      },
    });
    expect(sanitized).toMatchObject({
      event: "app.inference.attempt",
      details: {
        attempt: 1,
        stage: "structured_parse",
        finish_category: "stop",
        attempt_outcome: "retry",
      },
    });
  });

  it("drops prohibited fields and redacts prohibited values even under allowed keys", () => {
    const sanitized = sanitizeSupportAuditEvent({
      timestamp: "2026-08-14T12:00:00.000Z",
      event: "app.inference.completed",
      details: {
        prompt_body: "PRIVATE_PROMPT_CANARY",
        resume_text: "PRIVATE_RESUME_CANARY",
        job_description: "PRIVATE_JOB_CANARY",
        raw_response: "PRIVATE_RESPONSE_CANARY",
        authorization: "Bearer synthetic-secret-value",
        credential: "sk-synthetic-secret-value",
        endpoint: "https://private.example.test/v1",
        raw_path: "/home/owner/private.txt",
        stage: "https://private.example.test/v1",
        prompt_policy_id: "sk-synthetic-secret-value",
        output_schema_id: "/home/owner/private.txt",
      },
    });
    const text = JSON.stringify(sanitized);
    for (const canary of [
      "PRIVATE_PROMPT_CANARY",
      "PRIVATE_RESUME_CANARY",
      "PRIVATE_JOB_CANARY",
      "PRIVATE_RESPONSE_CANARY",
      "synthetic-secret-value",
      "private.example.test",
      "/home/owner/private.txt",
    ]) expect(text).not.toContain(canary);
    expect(sanitized).toMatchObject({
      details: { stage: "[REDACTED]", prompt_policy_id: "[REDACTED]", output_schema_id: "[REDACTED]" },
    });
  });
});

describe("Spec 10 support-bundle recovery-save diagnostics", () => {
  it("retains the exact safe reconciliation fields and drops owner content, endpoints, secrets, and paths", () => {
    const sanitized = sanitizeSupportAuditEvent({
      timestamp: "2026-08-15T12:00:00.000Z",
      event: "app.resume_recovery.reconciliation",
      details: {
        diagnostic_version: 1,
        app_id: "ai.braindrive.resume-builder",
        operation_id: "b1000000-0000-4000-8000-000000000001",
        semantic_digest: `sha256:${"a".repeat(64)}`,
        expected_revision: 3,
        initial_wait_class: "ambiguous_after_initial_wait",
        reconciliation_count: 2,
        reconciliation_class: "operation_read",
        acknowledgement_timing_class: "observed_window",
        idempotency_disposition: "coalesced",
        final_disposition: "committed",
        conflict_class: "none",
        error_code: null,
        resume_text: "PRIVATE_RESUME_CANARY",
        endpoint: "https://private.example.test/v1",
        credential: "sk-synthetic-secret-value",
        raw_path: "/home/owner/private.txt",
      },
    });
    expect(sanitized).toMatchObject({
      event: "app.resume_recovery.reconciliation",
      details: {
        diagnostic_version: 1,
        operation_id: "b1000000-0000-4000-8000-000000000001",
        semantic_digest: `sha256:${"a".repeat(64)}`,
        expected_revision: 3,
        initial_wait_class: "ambiguous_after_initial_wait",
        reconciliation_count: 2,
        reconciliation_class: "operation_read",
        acknowledgement_timing_class: "observed_window",
        idempotency_disposition: "coalesced",
        final_disposition: "committed",
        conflict_class: "none",
      },
    });
    const serialized = JSON.stringify(sanitized);
    for (const canary of ["PRIVATE_RESUME_CANARY", "private.example.test", "synthetic-secret-value", "/home/owner/private.txt"]) {
      expect(serialized).not.toContain(canary);
    }
  });
});

describe("Spec 10 support-bundle owner inference retry diagnostics", () => {
  it("retains only the strict content-free prior/new relation", () => {
    const sanitized = sanitizeSupportAuditEvent({
      timestamp: "2026-08-15T12:00:00.000Z",
      event: "app.inference.owner_retry",
      details: {
        diagnostic_version: 1,
        retry_relation_version: 1,
        retry_reason: "owner_initiated_retry",
        retry_prior_operation_id: "b2000000-0000-4000-8000-000000000001",
        retry_new_operation_id: "b2000000-0000-4000-8000-000000000002",
        retry_semantic_input_digest: `sha256:${"b".repeat(64)}`,
        retry_strategy_revision_id: "b2000000-0000-4000-8000-000000000003",
        retry_provider_profile_id: "owner-profile",
        retry_model_id: "owner-model",
        retry_equivalent: true,
        reason: "PRIVATE_REASON_CANARY",
        resume_text: "PRIVATE_RESUME_CANARY",
        prompt_body: "PRIVATE_PROMPT_CANARY",
        endpoint: "https://private.example.test/v1",
        credential: "sk-synthetic-secret-value",
        raw_path: "/home/owner/private.txt",
      },
    });
    expect(sanitized).toEqual({
      timestamp: "2026-08-15T12:00:00.000Z",
      event: "app.inference.owner_retry",
      details: {
        diagnostic_version: 1,
        retry_relation_version: 1,
        retry_reason: "owner_initiated_retry",
        retry_prior_operation_id: "b2000000-0000-4000-8000-000000000001",
        retry_new_operation_id: "b2000000-0000-4000-8000-000000000002",
        retry_semantic_input_digest: `sha256:${"b".repeat(64)}`,
        retry_strategy_revision_id: "b2000000-0000-4000-8000-000000000003",
        retry_provider_profile_id: "owner-profile",
        retry_model_id: "owner-model",
        retry_equivalent: true,
      },
    });
    const serialized = JSON.stringify(sanitized);
    for (const canary of ["PRIVATE_REASON_CANARY", "PRIVATE_RESUME_CANARY", "PRIVATE_PROMPT_CANARY", "private.example.test", "synthetic-secret-value", "/home/owner/private.txt"]) {
      expect(serialized).not.toContain(canary);
    }
  });
});

describe("installed-app inference support diagnostics", () => {
  it("retains generic content-free attempt and terminal evidence while dropping poison", () => {
    const sanitized = sanitizeSupportAuditEvent({
      timestamp: "2026-08-17T12:00:00.000Z",
      event: "app.inference.program_terminal",
      details: {
        app_id: "ai.braindrive.brief-builder",
        operation_id: "b3000000-0000-4000-8000-000000000001",
        program_id: "brief.generate",
        attempt_count: 2,
        completion_mode: "none",
        app_issue_ids: ["brief.generate/schema-title-invalid"],
        repeated_issue_ids: ["brief.generate/schema-title-invalid"],
        provider_call_count: 2,
        saved_record_written: false,
        approved_record_changed: false,
        execution_disposition: "newly_executed",
        prompt_body: "PRIVATE_PROMPT_CANARY",
        raw_candidate: "PRIVATE_CANDIDATE_CANARY",
        endpoint: "https://private.example.test/v1",
      },
    });

    expect(sanitized).toMatchObject({
      event: "app.inference.program_terminal",
      details: {
        program_id: "brief.generate",
        attempt_count: 2,
        completion_mode: "none",
        app_issue_ids: ["brief.generate/schema-title-invalid"],
        repeated_issue_ids: ["brief.generate/schema-title-invalid"],
        provider_call_count: 2,
        saved_record_written: false,
        approved_record_changed: false,
        execution_disposition: "newly_executed",
      },
    });
    expect(JSON.stringify(sanitized)).not.toMatch(/PRIVATE_PROMPT_CANARY|PRIVATE_CANDIDATE_CANARY|private\.example\.test/);
  });
});
