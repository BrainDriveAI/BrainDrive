import { z } from "zod";

export const InternetSearchFailureCodeSchema = z.enum([
  "invalid_request",
  "not_authorized",
  "disallowed_target",
  "authentication_required",
  "blocked",
  "rate_limited",
  "budget_exceeded",
  "timeout",
  "unsupported_content",
  "content_too_large",
  "provider_unavailable",
  "invalid_provider_response",
  "cancelled",
]);

export const InternetSearchFailureSchema = z
  .object({
    code: InternetSearchFailureCodeSchema,
    retryable: z.boolean(),
    message: z.string().trim().min(1).max(512),
    completed_items: z.number().int().min(0).max(10).default(0),
  })
  .strict();

export type InternetSearchFailureCode = z.infer<typeof InternetSearchFailureCodeSchema>;
export type InternetSearchFailure = z.infer<typeof InternetSearchFailureSchema>;
