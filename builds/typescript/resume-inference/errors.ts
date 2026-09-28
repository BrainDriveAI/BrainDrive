import type { z } from "zod";

import type { InferenceErrorSchema } from "../app-platform/contracts/inference.js";

export type ResumeInferenceErrorCode = z.infer<typeof InferenceErrorSchema>["code"];

export class ResumeInferenceError extends Error {
  constructor(
    public readonly code: ResumeInferenceErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ResumeInferenceError";
  }
}

export function classifyInferenceError(error: unknown, signal?: AbortSignal): ResumeInferenceError {
  if (error instanceof ResumeInferenceError) return error;
  if (signal?.aborted) {
    const reason = String(signal.reason ?? "").toLowerCase();
    return reason.includes("timeout")
      ? new ResumeInferenceError("deadline_exceeded", "The model request exceeded its deadline")
      : new ResumeInferenceError("cancelled", "The model request was cancelled");
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/\b403\b/.test(message)) {
    return new ResumeInferenceError("provider_authorization_failed", "The active provider did not authorize this request");
  }
  if (/\b401\b/.test(message)) {
    return new ResumeInferenceError("provider_authentication_failed", "The active provider rejected its credential");
  }
  if (/invalid.*(?:key|credential)|authentication|unauthenticated|unauthori[sz]ed/.test(message)) {
    return new ResumeInferenceError("provider_authentication_failed", "The active provider rejected its credential");
  }
  if (/forbidden|not authori[sz]ed|authorization/.test(message)) {
    return new ResumeInferenceError("provider_authorization_failed", "The active provider did not authorize this request");
  }
  if (/quota|credit|insufficient[_ ]fund/.test(message)) {
    return new ResumeInferenceError("quota_exceeded", "The active provider has no available quota");
  }
  if (/429|rate.?limit/.test(message)) {
    return new ResumeInferenceError("rate_limited", "The active provider rate limit was reached", true);
  }
  if (/timeout|deadline|abort/.test(message)) {
    return new ResumeInferenceError("deadline_exceeded", "The model request exceeded its deadline");
  }
  if (/fetch failed|econn|network|socket|dns|enotfound/.test(message)) {
    return new ResumeInferenceError("provider_unavailable", "The active provider is unavailable", true);
  }
  if (/(?:json[_ -]?schema|response[_ -]?format|structured output).*(?:unsupported|not supported)|(?:unsupported|not supported).*(?:json[_ -]?schema|response[_ -]?format|structured output)/.test(message)) {
    return new ResumeInferenceError("provider_schema_unsupported", "The active provider does not support the required structured response");
  }
  return new ResumeInferenceError("internal_failure", "The model request failed without a committed result", true);
}
