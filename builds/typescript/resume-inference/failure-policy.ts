import type { z } from "zod";

import type {
  InferenceFinishCategorySchema,
  InferencePurpose,
  InferenceRecoveryClassSchema,
  InferenceStageSchema,
} from "../app-platform/contracts/inference.js";
import type { ResumeInferenceErrorCode } from "./errors.js";
import { purposeRecoveryPolicy } from "./purpose-recovery.js";

export type InferenceFinishCategory = z.infer<typeof InferenceFinishCategorySchema>;
export type InferenceFailureStage = z.infer<typeof InferenceStageSchema>;
export type InferenceRecoveryClass = z.infer<typeof InferenceRecoveryClassSchema>;

export type PolicyFailure = {
  code: ResumeInferenceErrorCode;
  safeMessage: string;
  retryable: boolean;
  stage: InferenceFailureStage;
  finishCategory: InferenceFinishCategory;
};

type PolicyContext = {
  purpose: InferencePurpose;
  attempt: number;
  maxAttempts: number;
};

export type InferenceDecisionInput = PolicyContext & (
  | { event: "finish"; finishCategory: InferenceFinishCategory }
  | {
      event: "structural_failure";
      stage: "structured_parse" | "output_schema_validation";
      finishCategory: InferenceFinishCategory;
    }
  | { event: "incomplete_output"; finishCategory: InferenceFinishCategory }
  | { event: "validation_failure"; finishCategory: InferenceFinishCategory }
  | {
      event: "operational_failure";
      stage: "compatibility_preflight" | "provider_resolution" | "provider_request" | "cancellation" | "internal";
      finishCategory: InferenceFinishCategory;
      code: ResumeInferenceErrorCode;
      safeMessage: string;
      retryable: boolean;
    }
);

export type InferenceDecision =
  | { action: "evaluate_output" }
  | { action: "retry"; repairKind: "structural" | "validation"; recoveryClass: "provider_structural_repair" | "provider_validation_repair" }
  | { action: "fallback"; failure: PolicyFailure }
  | { action: "fail"; failure: PolicyFailure };

const FAILURE_MESSAGES = {
  malformed_structured_output: "The provider response could not be read as the required structured result",
  incomplete_output: "The provider response ended before the structured result was complete",
  evidence_validation_failed: "Generated output did not pass deterministic evidence validation",
  content_filtered: "The active provider filtered the structured response",
  provider_refused: "The active provider declined to produce an eligible structured response",
  unexpected_tool_call: "The active provider attempted a tool call although tools are disabled",
  internal_failure: "The provider returned an unrecognized completion state",
} as const;

/** Normalize provider-specific strings before any output parsing occurs. */
export function normalizeFinishCategory(finishReason: unknown): InferenceFinishCategory {
  if (typeof finishReason !== "string" || finishReason.trim().length === 0 || finishReason === "completed") return "missing";
  switch (finishReason.trim().toLowerCase()) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    case "refusal":
    case "refused":
      return "refusal";
    case "tool_call":
    case "tool_calls":
      return "tool_calls";
    default:
      return "unknown";
  }
}

export function decideInferenceOutcome(input: InferenceDecisionInput): InferenceDecision {
  const recoveryPolicy = purposeRecoveryPolicy(String(input.purpose));
  if (recoveryPolicy === null) {
    return { action: "fail", failure: failure(
      "internal_failure",
      "The inference purpose has no accepted recovery policy",
      false,
      "internal",
      input.finishCategory,
    ) };
  }
  const canRetry = input.attempt < input.maxAttempts;

  if (input.event === "finish") {
    if (input.finishCategory === "stop") return { action: "evaluate_output" };
    if (input.finishCategory === "length") {
      if (canRetry) return structuralRetry();
      return fallbackOrFail(input.purpose, "incomplete", failure(
        "incomplete_output",
        FAILURE_MESSAGES.incomplete_output,
        true,
        "finish_reason",
        input.finishCategory,
      ));
    }
    if (input.finishCategory === "content_filter") {
      return { action: "fail", failure: failure("content_filtered", FAILURE_MESSAGES.content_filtered, false, "finish_reason", input.finishCategory) };
    }
    if (input.finishCategory === "refusal") {
      return { action: "fail", failure: failure("provider_refused", FAILURE_MESSAGES.provider_refused, false, "finish_reason", input.finishCategory) };
    }
    if (input.finishCategory === "tool_calls") {
      return { action: "fail", failure: failure("unexpected_tool_call", FAILURE_MESSAGES.unexpected_tool_call, false, "finish_reason", input.finishCategory) };
    }
    return { action: "fail", failure: failure("internal_failure", FAILURE_MESSAGES.internal_failure, true, "finish_reason", input.finishCategory) };
  }

  if (input.event === "structural_failure") {
    if (canRetry) return structuralRetry();
    return fallbackOrFail(input.purpose, "structural", failure(
      "malformed_structured_output",
      FAILURE_MESSAGES.malformed_structured_output,
      true,
      input.stage,
      input.finishCategory,
    ));
  }

  if (input.event === "incomplete_output") {
    if (canRetry) return structuralRetry();
    return fallbackOrFail(input.purpose, "incomplete", failure(
      "incomplete_output",
      FAILURE_MESSAGES.incomplete_output,
      true,
      "finish_reason",
      input.finishCategory,
    ));
  }

  if (input.event === "validation_failure") {
    if (canRetry) {
      return { action: "retry", repairKind: "validation", recoveryClass: "provider_validation_repair" };
    }
    return fallbackOrFail(input.purpose, "validation", failure(
      "evidence_validation_failed",
      FAILURE_MESSAGES.evidence_validation_failed,
      false,
      "deterministic_validation",
      input.finishCategory,
    ));
  }

  const operationalFailure = failure(
    input.code,
    input.safeMessage,
    input.retryable,
    input.stage,
    input.finishCategory,
  );
  if (recoveryPolicy.provider_calls !== "zero" && recoveryPolicy.operational_fallback_codes.includes(input.code)) {
    return { action: "fallback", failure: operationalFailure };
  }
  return { action: "fail", failure: operationalFailure };
}

function structuralRetry(): InferenceDecision {
  return { action: "retry", repairKind: "structural", recoveryClass: "provider_structural_repair" };
}

function fallbackOrFail(
  purpose: InferencePurpose,
  failureClass: "structural" | "incomplete" | "validation",
  terminalFailure: PolicyFailure,
): InferenceDecision {
  const policy = purposeRecoveryPolicy(String(purpose));
  return policy?.provider_calls !== "zero" && policy?.fallback_on.includes(failureClass)
    ? { action: "fallback", failure: terminalFailure }
    : { action: "fail", failure: terminalFailure };
}

function failure(
  code: ResumeInferenceErrorCode,
  safeMessage: string,
  retryable: boolean,
  stage: InferenceFailureStage,
  finishCategory: InferenceFinishCategory,
): PolicyFailure {
  return { code, safeMessage, retryable, stage, finishCategory };
}
