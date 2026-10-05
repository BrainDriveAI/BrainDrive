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
  if (/401|403|unauthori[sz]ed|invalid.*(?:key|credential)|authentication/.test(message)) {
    return new ResumeInferenceError("denied", "The active provider rejected its credential");
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
  return new ResumeInferenceError("recoverable_internal_failure", "The model request failed without a committed result", true);
}
