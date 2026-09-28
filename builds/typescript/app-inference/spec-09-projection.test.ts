import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { InferenceErrorCodeSchema, PURPOSE_OUTPUT_SCHEMAS } from "../app-platform/contracts/inference.js";
import {
  EvidenceFailureRecoveryContractSchema,
  ResumeInferenceRetryLineageProjectionSchema,
  ResumeInferenceDiagnosticSchema,
  projectResumeInferenceCompletion,
  recoveryFor,
} from "./resume-adapter.js";

const ACTIONS = {
  invalid_request: "none",
  denied: "open_model_settings",
  model_incompatible: "open_model_settings",
  provider_unavailable: "retry",
  quota_exceeded: "review_provider_account",
  rate_limited: "retry",
  deadline_exceeded: "retry",
  cancelled: "continue",
  schema_validation_failed: "retry",
  validation_failed: "none",
  recoverable_internal_failure: "retry",
  malformed_structured_output: "retry",
  incomplete_output: "retry",
  evidence_validation_failed: "evidence_failure",
  provider_schema_unsupported: "open_model_settings",
  provider_authentication_failed: "open_model_settings",
  provider_authorization_failed: "open_model_settings",
  content_filtered: "none",
  provider_refused: "none",
  unexpected_tool_call: "open_model_settings",
  internal_failure: "retry",
} as const;

function failedCompletion(code: keyof typeof ACTIONS) {
  const operationId = randomUUID();
  return {
    inference: {
      inference_schema_version: 1,
      request_id: randomUUID(),
      operation_id: operationId,
      purpose: "general_resume_draft",
      status: code === "cancelled" ? "cancelled" : "failed",
      prompt_policy_id: "braindrive.resume-builder.fixed",
      prompt_policy_version: "8",
      output_schema_id: PURPOSE_OUTPUT_SCHEMAS.general_resume_draft,
      output_schema_version: 1,
      input_digest: canonicalInputDigest({ synthetic: true }),
      output_digest: null,
      result: null,
      provider_profile_id: "owner-profile",
      model_id: "owner-model",
      attempt_count: 2,
      usage: { available: false, input_tokens: null, output_tokens: null },
      error: { code, safe_message: "Safe fixed broker message", retryable: ACTIONS[code] === "retry" },
      outcome: {
        stage: code === "evidence_validation_failed" ? "deterministic_validation" : code === "cancelled" ? "cancellation" : "provider_request",
        finish_category: "stop",
        attempt_count: 2,
        retryable: ACTIONS[code] === "retry",
        recovery_class: "none",
        completion_mode: "none",
        final_disposition: code === "cancelled" ? "cancelled" : "failed",
      },
      started_at: "2026-08-14T12:00:00.000Z",
      completed_at: "2026-08-14T12:00:01.000Z",
    },
    validation: code === "evidence_validation_failed" ? {
      validation_run_id: randomUUID(),
      validator_id: "resume-claim-gate",
      validator_version: "1",
      validator_policy_digest: canonicalInputDigest("policy"),
      input_snapshot_digest: canonicalInputDigest("input"),
      findings_digest: canonicalInputDigest("findings"),
      accepted: false,
      findings: [{
        finding_id: randomUUID(),
        validator_id: "resume-claim-gate",
        validator_version: "1",
        severity: "error",
        code: "unsupported_claim",
        statement_id: randomUUID(),
        safe_message: "MALICIOUS_OWNER_RESUME_CANARY",
      }],
    } : null,
  };
}

describe("Spec 09 Resume inference projection", () => {
  it("preserves every semantic code and maps exactly one owner recovery action", () => {
    expect(new Set(InferenceErrorCodeSchema.options)).toEqual(new Set(Object.keys(ACTIONS)));
    for (const [code, action] of Object.entries(ACTIONS) as Array<[keyof typeof ACTIONS, typeof ACTIONS[keyof typeof ACTIONS]]>) {
      const projected = projectResumeInferenceCompletion(failedCompletion(code) as never) as {
        error: { code: string; recovery: string };
        events: Array<{ event: string; error?: { code: string }; outcome?: unknown }>;
      };
      expect(projected.error).toMatchObject({ code, recovery: code === "evidence_validation_failed" ? "none" : action });
      expect(projected.events[1]).toMatchObject({ event: "failed", error: { code }, outcome: expect.any(Object) });
      expect(recoveryFor(code)).toBe(action);
    }
  });

  it("projects only allowlisted validator codes and content-minimized diagnostics", () => {
    const completion = {
      ...failedCompletion("evidence_validation_failed"),
      inference: {
        ...failedCompletion("evidence_validation_failed").inference,
        outcome: {
          ...failedCompletion("evidence_validation_failed").inference.outcome,
          stage: "recovery",
          recovery_class: "deterministic_fallback",
        },
      },
      recovery_diagnostics: {
        provider_validator_codes: ["unsupported_claim"],
        provider_validator_rule_ids: ["statement_factual_wording_unsupported"],
        local_candidate_classes: ["targeted_fact_repair", "full_general_constructor"],
        targeted_fact_repair_validator_codes: ["missing_provenance"],
        targeted_fact_repair_validator_rule_ids: ["statement_support_unresolved"],
        targeted_fact_repair_disposition: "rejected",
        full_general_constructor_validator_codes: ["schema_invalid"],
        full_general_constructor_validator_rule_ids: ["candidate_schema_parse_failed"],
        full_general_constructor_disposition: "schema_rejected",
        original_failure_code: "evidence_validation_failed",
        recovery_disposition: "recovery_rejected",
      },
    };
    const projected = projectResumeInferenceCompletion(completion as never) as {
      validation: unknown;
      diagnostic: Record<string, unknown>;
    };
    expect(projected.validation).toEqual({ accepted: false, finding_count: 1, finding_codes: ["unsupported_claim"] });
    expect(ResumeInferenceDiagnosticSchema.safeParse(projected.diagnostic).success).toBe(true);
    expect(projected.diagnostic).toMatchObject(completion.recovery_diagnostics);
    const legacy = { ...projected.diagnostic };
    for (const key of Object.keys(completion.recovery_diagnostics)) delete legacy[key];
    expect(ResumeInferenceDiagnosticSchema.safeParse(legacy).success).toBe(true);
    for (const contradiction of [
      { ...projected.diagnostic, provider_validator_codes: undefined },
      { ...projected.diagnostic, local_candidate_classes: ["full_general_constructor", "targeted_fact_repair"] },
      { ...projected.diagnostic, full_general_constructor_validator_codes: undefined },
      { ...projected.diagnostic, recovery_disposition: "targeted_accepted" },
      { ...projected.diagnostic, targeted_fact_repair_disposition: "accepted" },
      { ...projected.diagnostic, full_general_constructor_disposition: "accepted" },
      { ...projected.diagnostic, original_failure_code: "internal_failure" },
      { ...projected.diagnostic, stage: null },
      { ...projected.diagnostic, purpose: "resume_strategy" },
      { ...projected.diagnostic, attempt_count: 1 },
      { ...projected.diagnostic, retryable: true },
    ]) expect(ResumeInferenceDiagnosticSchema.safeParse(contradiction).success).toBe(false);
    const visible = JSON.stringify(projected);
    expect(visible).not.toContain("MALICIOUS_OWNER_RESUME_CANARY");
    expect(visible).not.toMatch(/authorization|credential|api_key|endpoint|prompt_body|raw_response/i);
  });

  it("projects one strict actionable evidence-failure contract with a safe immutable binding", () => {
    const completion = failedCompletion("evidence_validation_failed");
    const strategyRevisionId = randomUUID();
    const projected = projectResumeInferenceCompletion(completion as never, {
      invocation: {
        inference_contract_version: 1,
        purpose: "general_resume_draft",
        operation_id: completion.inference.operation_id,
        fact_revision_ids: [],
        record_revision_ids: [strategyRevisionId],
        semantic_binding: {
          semantic_binding_version: 1,
          strategy_revision_id: strategyRevisionId,
          provider_profile_id: "owner-profile",
          model_id: "owner-model",
        },
      },
    }) as {
      error: { recovery: string; recovery_contract: unknown };
      retry_lineage: unknown;
    };

    expect(projected.error.recovery).toBe("evidence_failure");
    expect(EvidenceFailureRecoveryContractSchema.parse(projected.error.recovery_contract)).toEqual({
      recovery_contract_version: 1,
      kind: "evidence_failure",
      actions: [
        { id: "try_again", label: "Try again" },
        { id: "review_confirmed_evidence", label: "Review confirmed evidence" },
        { id: "not_now", label: "Not now" },
      ],
      retry_disclosure: "Try again uses your currently selected provider and may consume credits.",
      semantic_input_digest: completion.inference.input_digest,
      strategy_revision_id: strategyRevisionId,
      provider_profile_id: "owner-profile",
      model_id: "owner-model",
      repeated_equivalent_failure: false,
      emphasized_action: "try_again",
    });
    expect(projected.retry_lineage).toBeNull();
    expect(JSON.stringify(projected)).not.toMatch(/credential|api_key|endpoint|prompt_body|raw_response/i);
  });

  it("projects strict safe owner retry lineage and recognizes only fully equivalent second failures", () => {
    const first = failedCompletion("evidence_validation_failed");
    const strategyRevisionId = randomUUID();
    const second = {
      ...failedCompletion("evidence_validation_failed"),
      inference: {
        ...failedCompletion("evidence_validation_failed").inference,
        operation_id: randomUUID(),
        input_digest: first.inference.input_digest,
        provider_profile_id: first.inference.provider_profile_id,
        model_id: first.inference.model_id,
      },
    };
    const observedPriorEvidenceFailure = {
      operation_id: first.inference.operation_id,
      semantic_input_digest: first.inference.input_digest,
      strategy_revision_id: strategyRevisionId,
      provider_profile_id: "owner-profile",
      model_id: "owner-model",
    };
    const projected = projectResumeInferenceCompletion(second as never, {
      observedPriorEvidenceFailure,
      invocation: {
        inference_contract_version: 1,
        purpose: "general_resume_draft",
        operation_id: second.inference.operation_id,
        fact_revision_ids: [],
        record_revision_ids: [strategyRevisionId],
        semantic_binding: {
          semantic_binding_version: 1,
          strategy_revision_id: strategyRevisionId,
          provider_profile_id: "owner-profile",
          model_id: "owner-model",
        },
        retry_lineage: {
          retry_lineage_version: 1,
          reason: "owner_initiated_retry",
          prior_operation_id: first.inference.operation_id,
          prior_input_digest: first.inference.input_digest,
          strategy_revision_id: strategyRevisionId,
          provider_profile_id: "owner-profile",
          model_id: "owner-model",
        },
      },
    }) as {
      error: { recovery_contract: { repeated_equivalent_failure: boolean; emphasized_action: string } };
      retry_lineage: unknown;
    };

    expect(ResumeInferenceRetryLineageProjectionSchema.parse(projected.retry_lineage)).toEqual({
      retry_lineage_version: 1,
      reason: "owner_initiated_retry",
      prior_operation_id: first.inference.operation_id,
      operation_id: second.inference.operation_id,
      semantic_input_digest: first.inference.input_digest,
      strategy_revision_id: strategyRevisionId,
      provider_profile_id: "owner-profile",
      model_id: "owner-model",
      equivalent: true,
    });
    expect(projected.error.recovery_contract).toMatchObject({
      repeated_equivalent_failure: true,
      emphasized_action: "review_confirmed_evidence",
    });

    for (const change of [
      { input_digest: canonicalInputDigest("changed-facts-or-coverage") },
    ]) {
      const changed = projectResumeInferenceCompletion({
        ...second,
        inference: { ...second.inference, ...change },
      } as never, {
        observedPriorEvidenceFailure,
        invocation: {
          inference_contract_version: 1,
          purpose: "general_resume_draft",
          operation_id: second.inference.operation_id,
          fact_revision_ids: [],
          record_revision_ids: [strategyRevisionId],
          semantic_binding: {
            semantic_binding_version: 1,
            strategy_revision_id: strategyRevisionId,
            provider_profile_id: "owner-profile",
            model_id: "owner-model",
          },
          retry_lineage: {
            retry_lineage_version: 1,
            reason: "owner_initiated_retry",
            prior_operation_id: first.inference.operation_id,
            prior_input_digest: first.inference.input_digest,
            strategy_revision_id: strategyRevisionId,
            provider_profile_id: "owner-profile",
            model_id: "owner-model",
          },
        },
      }) as { error: { recovery_contract: { repeated_equivalent_failure: boolean } }; retry_lineage: { equivalent: boolean } };
      expect(changed.retry_lineage.equivalent).toBe(false);
      expect(changed.error.recovery_contract.repeated_equivalent_failure).toBe(false);
    }

    for (const currentBinding of [
      { strategy_revision_id: randomUUID(), provider_profile_id: "owner-profile", model_id: "owner-model" },
      { strategy_revision_id: strategyRevisionId, provider_profile_id: "changed-provider", model_id: "owner-model" },
      { strategy_revision_id: strategyRevisionId, provider_profile_id: "owner-profile", model_id: "changed-model" },
    ]) {
      const changed = projectResumeInferenceCompletion({
        ...second,
        inference: {
          ...second.inference,
          provider_profile_id: currentBinding.provider_profile_id,
          model_id: currentBinding.model_id,
        },
      } as never, {
        observedPriorEvidenceFailure,
        invocation: {
          inference_contract_version: 1,
          purpose: "general_resume_draft",
          operation_id: second.inference.operation_id,
          fact_revision_ids: [],
          record_revision_ids: [currentBinding.strategy_revision_id],
          semantic_binding: { semantic_binding_version: 1, ...currentBinding },
          retry_lineage: {
            retry_lineage_version: 1,
            reason: "owner_initiated_retry",
            prior_operation_id: first.inference.operation_id,
            prior_input_digest: first.inference.input_digest,
            ...currentBinding,
          },
        },
      }) as { retry_lineage: { equivalent: boolean }; error: { recovery_contract: { repeated_equivalent_failure: boolean; emphasized_action: string } } };
      expect(changed.retry_lineage.equivalent).toBe(false);
      expect(changed.error.recovery_contract).toMatchObject({ repeated_equivalent_failure: false, emphasized_action: "try_again" });
    }

    expect(() => projectResumeInferenceCompletion(second as never, {
      observedPriorEvidenceFailure,
      invocation: {
        inference_contract_version: 1,
        purpose: "general_resume_draft",
        operation_id: second.inference.operation_id,
        fact_revision_ids: [],
        record_revision_ids: [randomUUID()],
        semantic_binding: {
          semantic_binding_version: 1,
          strategy_revision_id: randomUUID(),
          provider_profile_id: "owner-profile",
          model_id: "owner-model",
        },
        retry_lineage: {
          retry_lineage_version: 1,
          reason: "owner_initiated_retry",
          prior_operation_id: first.inference.operation_id,
          prior_input_digest: first.inference.input_digest,
          strategy_revision_id: strategyRevisionId,
          provider_profile_id: "owner-profile",
          model_id: "owner-model",
        },
      },
    })).toThrow();

    for (const changedBinding of [
      { provider_profile_id: "changed-provider" },
      { model_id: "changed-model" },
    ]) expect(() => projectResumeInferenceCompletion({
      ...second,
      inference: { ...second.inference, ...changedBinding },
    } as never, {
      observedPriorEvidenceFailure,
      invocation: {
        inference_contract_version: 1,
        purpose: "general_resume_draft",
        operation_id: second.inference.operation_id,
        fact_revision_ids: [],
        record_revision_ids: [strategyRevisionId],
        semantic_binding: { ...{
          semantic_binding_version: 1,
          strategy_revision_id: strategyRevisionId,
          provider_profile_id: "owner-profile",
          model_id: "owner-model",
        }, ...changedBinding },
        retry_lineage: {
          retry_lineage_version: 1,
          reason: "owner_initiated_retry",
          prior_operation_id: first.inference.operation_id,
          prior_input_digest: first.inference.input_digest,
          strategy_revision_id: strategyRevisionId,
          provider_profile_id: "owner-profile",
          model_id: "owner-model",
        },
      },
    })).toThrow();

    const unknownPrior = projectResumeInferenceCompletion(second as never, {
      invocation: {
        inference_contract_version: 1,
        purpose: "general_resume_draft",
        operation_id: second.inference.operation_id,
        fact_revision_ids: [],
        record_revision_ids: [strategyRevisionId],
        semantic_binding: {
          semantic_binding_version: 1,
          strategy_revision_id: strategyRevisionId,
          provider_profile_id: "owner-profile",
          model_id: "owner-model",
        },
        retry_lineage: {
          retry_lineage_version: 1,
          reason: "owner_initiated_retry",
          prior_operation_id: first.inference.operation_id,
          prior_input_digest: first.inference.input_digest,
          strategy_revision_id: strategyRevisionId,
          provider_profile_id: "owner-profile",
          model_id: "owner-model",
        },
      },
    }) as { retry_lineage: { equivalent: boolean }; error: { recovery_contract: { repeated_equivalent_failure: boolean } } };
    expect(unknownPrior.retry_lineage.equivalent).toBe(false);
    expect(unknownPrior.error.recovery_contract.repeated_equivalent_failure).toBe(false);
  });

  it("shows the recovery note only for deterministic General Resume completion", () => {
    const base = failedCompletion("internal_failure");
    const completed = {
      inference: {
        ...base.inference,
        status: "completed",
        result: { title: "Synthetic", statements: [], section_order: [], omissions: [] },
        output_digest: canonicalInputDigest({ title: "Synthetic" }),
        error: null,
        outcome: {
          ...base.inference.outcome,
          stage: "completed",
          retryable: false,
          recovery_class: "deterministic_fallback",
          completion_mode: "deterministic_fallback",
          final_disposition: "completed",
        },
      },
      validation: null,
    };
    const general = projectResumeInferenceCompletion(completed as never) as { recovery_notice: string | null };
    expect(general.recovery_notice).toBe("BrainDrive recovered a basic fact-backed draft. Review it before approval.");
    const interview = projectResumeInferenceCompletion({
      ...completed,
      inference: {
        ...completed.inference,
        purpose: "interview_assist",
        output_schema_id: PURPOSE_OUTPUT_SCHEMAS.interview_assist,
      },
    } as never) as { recovery_notice: string | null };
    expect(interview.recovery_notice).toBeNull();
  });
});
