import type { z } from "zod";

import {
  OwnerSafeResumeDataStateSchema,
} from "../app-platform/contracts/data-conformance.js";
import {
  ContractErrorCodeSchema,
  ContractErrorSchema,
} from "../app-platform/contracts/errors.js";
import { ResumeDomainError } from "./errors.js";

type ContractErrorCode = z.infer<typeof ContractErrorCodeSchema>;

const SAFE_MESSAGES: Partial<Record<ContractErrorCode, string>> = {
  invalid_input: "The request could not be validated.",
  not_found_within_scope: "The requested item is unavailable.",
  denied: "This Resume Builder operation is not authorized.",
  conflict: "The saved version changed. Refresh and review the preserved proposal.",
  idempotency_conflict: "This operation identity was already used for different input.",
  incompatible_schema: "The retained Resume Builder data needs a compatible version.",
  invalid_state_transition: "Resume Builder is not active for this operation.",
  cancelled: "The operation was cancelled before a durable change became visible.",
  validation_failed: "The proposed change did not pass deterministic validation.",
  recoverable_internal_failure: "Resume Builder could not complete the operation safely.",
};

export function ownerSafeCapabilityFailure(
  rawError: unknown,
  correlationId: string,
  occurredAt = new Date().toISOString(),
): {
  error: z.infer<typeof ContractErrorSchema>;
  owner_state: z.infer<typeof OwnerSafeResumeDataStateSchema>;
} {
  const candidate = rawError instanceof ResumeDomainError || (rawError && typeof rawError === "object")
    ? rawError as { code?: unknown; details?: { currentRevision?: unknown } }
    : {};
  const parsedCode = ContractErrorCodeSchema.safeParse(candidate.code);
  const code = parsedCode.success ? parsedCode.data : "recoverable_internal_failure";
  const currentRevision = typeof candidate.details?.currentRevision === "number" && Number.isSafeInteger(candidate.details.currentRevision) && candidate.details.currentRevision > 0
    ? candidate.details.currentRevision
    : null;
  const state = code === "conflict" && currentRevision !== null
    ? "conflict"
    : code === "cancelled"
      ? "cancelled"
      : code === "incompatible_schema"
        ? "incompatible"
        : code === "invalid_input" || code === "validation_failed" || code === "idempotency_conflict" || code === "conflict"
          ? "review_needed"
          : "recoverable_failure";
  const ownerState = OwnerSafeResumeDataStateSchema.parse({
    state_version: 1,
    state,
    safe_message: SAFE_MESSAGES[code] ?? SAFE_MESSAGES.recoverable_internal_failure!,
    retryable: code === "recoverable_internal_failure",
    refresh_required: state === "conflict",
    current_revision: state === "conflict" ? currentRevision : null,
    proposal_preserved: state === "conflict",
  });
  const contractError = ContractErrorSchema.parse({
    error_version: 1,
    code,
    safe_message: ownerState.safe_message,
    retryable: ownerState.retryable,
    correlation_id: correlationId,
    occurred_at: occurredAt,
    ...(state === "conflict" && currentRevision !== null
      ? { details: { category: "stale_revision", current_revision: currentRevision } }
      : { details: { category: errorCategory(code) } }),
  });
  return { error: contractError, owner_state: ownerState };
}

function errorCategory(code: ContractErrorCode): string {
  if (code === "denied" || code === "not_found_within_scope") return "access";
  if (code === "cancelled") return "cancellation";
  if (code === "incompatible_schema") return "compatibility";
  if (code === "recoverable_internal_failure") return "internal";
  return "request";
}
