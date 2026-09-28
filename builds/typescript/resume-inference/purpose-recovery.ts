import type { InferencePurpose } from "../app-platform/contracts/inference.js";
import type { ResumeInferenceErrorCode } from "./errors.js";

export type PurposeFallbackTrigger = "structural" | "incomplete" | "validation";
export type PurposeDeterministicBehavior =
  | "none"
  | "interview_presentation"
  | "canonical_strategy"
  | "general_fact_draft"
  | "guidance_projection"
  | "craft_evaluation";
export type PurposeNormalization =
  | "none"
  | "general_draft"
  | "tailoring_plan"
  | "targeted_draft"
  | "revision_draft"
  | "craft_evaluation";

export type PurposeRecoveryPolicy = Readonly<{
  deterministic_behavior: PurposeDeterministicBehavior;
  fallback_on: readonly PurposeFallbackTrigger[];
  operational_fallback_codes: readonly ResumeInferenceErrorCode[];
  normalization: PurposeNormalization;
  provider_calls: "bounded" | "zero";
}>;

const STRUCTURAL_FALLBACK = ["structural", "incomplete", "validation"] as const;
const GUIDANCE_OPERATIONAL_FALLBACK = [
  "provider_unavailable",
  "quota_exceeded",
  "rate_limited",
  "deadline_exceeded",
  "internal_failure",
] as const satisfies readonly ResumeInferenceErrorCode[];

/**
 * Recovery and normalization are intentionally separate. A normalized valid
 * provider result is not deterministic fallback evidence. Adding a new
 * inference purpose makes this Record incomplete at compile time and the
 * matching table test fail at runtime.
 */
export const PURPOSE_RECOVERY_POLICIES = {
  interview_assist: policy("interview_presentation", STRUCTURAL_FALLBACK),
  general_resume_draft: policy("general_fact_draft", STRUCTURAL_FALLBACK, [], "general_draft"),
  job_description_analyze: policy("none"),
  requirement_evidence_match: policy("none"),
  tailoring_plan: policy("none", [], [], "tailoring_plan"),
  targeted_resume_draft: policy("none", [], [], "targeted_draft"),
  resume_revision_classify: policy("none"),
  resume_revision_draft: policy("none", [], [], "revision_draft"),
  resume_guidance: policy("guidance_projection", STRUCTURAL_FALLBACK, GUIDANCE_OPERATIONAL_FALLBACK),
  resume_strategy: policy("canonical_strategy", STRUCTURAL_FALLBACK),
  resume_craft_evaluate: policy("craft_evaluation", [], [], "craft_evaluation", "zero"),
  resume_craft_repair: policy("none"),
} as const satisfies Record<InferencePurpose, PurposeRecoveryPolicy>;

export function purposeRecoveryPolicy(purpose: string): PurposeRecoveryPolicy | null {
  return Object.prototype.hasOwnProperty.call(PURPOSE_RECOVERY_POLICIES, purpose)
    ? PURPOSE_RECOVERY_POLICIES[purpose as keyof typeof PURPOSE_RECOVERY_POLICIES]
    : null;
}

function policy(
  deterministicBehavior: PurposeDeterministicBehavior,
  fallbackOn: readonly PurposeFallbackTrigger[] = [],
  operationalFallbackCodes: readonly ResumeInferenceErrorCode[] = [],
  normalization: PurposeNormalization = "none",
  providerCalls: "bounded" | "zero" = "bounded",
): PurposeRecoveryPolicy {
  return Object.freeze({
    deterministic_behavior: deterministicBehavior,
    fallback_on: Object.freeze([...fallbackOn]),
    operational_fallback_codes: Object.freeze([...operationalFallbackCodes]),
    normalization,
    provider_calls: providerCalls,
  });
}
