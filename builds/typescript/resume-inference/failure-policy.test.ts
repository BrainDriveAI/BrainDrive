import { describe, expect, it } from "vitest";

import { decideInferenceOutcome, normalizeFinishCategory } from "./failure-policy.js";

describe("Spec 09 bounded inference failure policy", () => {
  it("normalizes every accepted, missing, and provider-specific finish reason", () => {
    expect(normalizeFinishCategory("stop")).toBe("stop");
    expect(normalizeFinishCategory("length")).toBe("length");
    expect(normalizeFinishCategory("content_filter")).toBe("content_filter");
    expect(normalizeFinishCategory("refusal")).toBe("refusal");
    expect(normalizeFinishCategory("tool_calls")).toBe("tool_calls");
    expect(normalizeFinishCategory("vendor_reason")).toBe("unknown");
    expect(normalizeFinishCategory("completed")).toBe("missing");
    expect(normalizeFinishCategory(undefined)).toBe("missing");
  });

  it("has one exact decision for the provider finish table", () => {
    const cases = [
      ["stop", 1, "interview_assist", "evaluate_output", null],
      ["length", 1, "interview_assist", "retry", null],
      ["length", 2, "general_resume_draft", "fallback", "incomplete_output"],
      ["length", 2, "interview_assist", "fallback", "incomplete_output"],
      ["content_filter", 1, "general_resume_draft", "fail", "content_filtered"],
      ["refusal", 1, "general_resume_draft", "fail", "provider_refused"],
      ["tool_calls", 1, "general_resume_draft", "fail", "unexpected_tool_call"],
      ["unknown", 1, "general_resume_draft", "fail", "internal_failure"],
      ["missing", 1, "general_resume_draft", "fail", "internal_failure"],
    ] as const;
    for (const [finishCategory, attempt, purpose, action, code] of cases) {
      const decision = decideInferenceOutcome({ event: "finish", finishCategory, attempt, maxAttempts: 2, purpose });
      expect(decision.action, `${purpose}:${finishCategory}:${attempt}`).toBe(action);
      if (decision.action === "fail" || decision.action === "fallback") expect(decision.failure.code).toBe(code);
    }
  });

  it("bounds structural and validation repair before exact fallback or failure", () => {
    expect(decideInferenceOutcome({ event: "structural_failure", stage: "structured_parse", finishCategory: "stop", attempt: 1, maxAttempts: 2, purpose: "interview_assist" }))
      .toEqual({ action: "retry", repairKind: "structural", recoveryClass: "provider_structural_repair" });
    expect(decideInferenceOutcome({ event: "structural_failure", stage: "output_schema_validation", finishCategory: "stop", attempt: 2, maxAttempts: 2, purpose: "general_resume_draft" }))
      .toMatchObject({ action: "fallback", failure: { code: "malformed_structured_output", stage: "output_schema_validation" } });
    expect(decideInferenceOutcome({ event: "structural_failure", stage: "structured_parse", finishCategory: "stop", attempt: 2, maxAttempts: 2, purpose: "interview_assist" }))
      .toMatchObject({ action: "fallback", failure: { code: "malformed_structured_output", stage: "structured_parse" } });
    expect(decideInferenceOutcome({ event: "validation_failure", finishCategory: "stop", attempt: 1, maxAttempts: 2, purpose: "general_resume_draft" }))
      .toEqual({ action: "retry", repairKind: "validation", recoveryClass: "provider_validation_repair" });
    expect(decideInferenceOutcome({ event: "validation_failure", finishCategory: "stop", attempt: 2, maxAttempts: 2, purpose: "interview_assist" }))
      .toMatchObject({ action: "fallback", failure: { code: "evidence_validation_failed", stage: "deterministic_validation" } });
  });

  it("allows only the existing guidance operational fallback and prohibits unsafe categories", () => {
    for (const code of ["provider_unavailable", "quota_exceeded", "rate_limited", "deadline_exceeded", "internal_failure"] as const) {
      const decision = decideInferenceOutcome({
        event: "operational_failure", purpose: "resume_guidance", attempt: 1, maxAttempts: 2,
        stage: "provider_request", finishCategory: "missing", code,
        safeMessage: "Safe recoverable provider failure", retryable: code === "provider_unavailable" || code === "rate_limited" || code === "internal_failure",
      });
      expect(decision, code).toMatchObject({ action: "fallback", failure: { code } });
    }
    for (const code of ["provider_authentication_failed", "provider_authorization_failed", "model_incompatible", "provider_schema_unsupported", "cancelled"] as const) {
      const decision = decideInferenceOutcome({
        event: "operational_failure", purpose: "resume_guidance", attempt: 1, maxAttempts: 2,
        stage: code === "cancelled" ? "cancellation" : "provider_request", finishCategory: "missing", code,
        safeMessage: "Safe terminal failure", retryable: false,
      });
      expect(decision.action, code).toBe("fail");
    }
  });
});
