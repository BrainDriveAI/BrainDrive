export type ResumeDomainErrorCode =
  | "invalid_input"
  | "not_found_within_scope"
  | "denied"
  | "conflict"
  | "idempotency_conflict"
  | "incompatible_schema"
  | "cancelled"
  | "validation_failed"
  | "recoverable_internal_failure";

export class ResumeDomainError extends Error {
  constructor(
    public readonly code: ResumeDomainErrorCode,
    message: string,
    public readonly statusCode = 409,
  ) {
    super(message);
    this.name = "ResumeDomainError";
  }
}
