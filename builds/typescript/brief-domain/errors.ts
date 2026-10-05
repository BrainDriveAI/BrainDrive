export class BriefDomainError extends Error {
  constructor(readonly code: "invalid_input" | "conflict" | "not_found" | "validation_failed" | "denied" | "persistence_failed", message: string, readonly statusCode = 409) {
    super(message);
    this.name = "BriefDomainError";
  }
}
