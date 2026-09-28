import type { AppInferencePurposeRegistration } from "./registry.js";
import { BriefInferenceBroker } from "../brief-inference/broker.js";
import { BRIEF_PROMPT_POLICY_ID, BRIEF_VALIDATION_POLICY_ID, BriefGenerateInputSchema, BriefGenerateOutputSchema } from "../brief-inference/contracts.js";

export function createBriefInferencePurposeRegistration(broker: BriefInferenceBroker): AppInferencePurposeRegistration {
  return {
    appId: "ai.braindrive.brief-builder", purposeId: "brief.generate", version: 1,
    inputSchema: BriefGenerateInputSchema, outputSchema: BriefGenerateOutputSchema,
    promptPolicyId: BRIEF_PROMPT_POLICY_ID, modelCompatibilityClass: "owner_active_compatible",
    limits: { maxInputBytes: 65_536, maxInputTokens: 16_384, maxOutputTokens: 2_048, maxDurationMs: 30_000, maxAttempts: 2 },
    validationPolicyId: BRIEF_VALIDATION_POLICY_ID, retryPolicy: "same_snapshot_only", cancellationPolicy: "required",
    auditProjectionId: "brief.generate.audit.v1", ownerComponentId: "brief.inference",
    executor: (input, context) => broker.generate(input, { operationId: context.operationId, signal: context.signal, timeoutMs: context.deadlineAt - Date.now() }),
  };
}
