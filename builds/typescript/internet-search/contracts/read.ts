import { z } from "zod";

import { OpaqueIdSchema, TimestampSchema } from "../../app-platform/contracts/common.js";
import { InternetSearchFailureSchema } from "./failures.js";

const HttpsUrlSchema = z.string().trim().url().max(2_048).refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, {
  message: "web.read accepts public HTTPS URLs only",
});

export const WebReadInputSchema = z
  .object({
    url: HttpsUrlSchema,
  })
  .strict();

export const WebReadResultSchema = z
  .object({
    requested_url: HttpsUrlSchema,
    canonical_url: HttpsUrlSchema,
    title: z.string().trim().min(1).max(512).nullable(),
    content_type: z.string().trim().min(1).max(128),
    content: z.string().max(262_144),
    truncated: z.boolean(),
    trust: z.literal("external-untrusted"),
    result_class: z.literal("outside-fact"),
    published_at: z.string().trim().min(1).max(64).nullable(),
    updated_at: z.string().trim().min(1).max(64).nullable(),
  })
  .strict();

export const WebReadEnvelopeSchema = z
  .object({
    capability: z.literal("web.read"),
    version: z.literal(1),
    request_id: OpaqueIdSchema,
    run_id: OpaqueIdSchema,
    status: z.enum(["success", "partial", "failure", "unavailable", "cancelled"]),
    retrieved_at: TimestampSchema,
    provider: z
      .object({
        profile: z.string().trim().min(1).max(128),
        attribution: z.string().trim().min(1).max(128),
      })
      .strict()
      .nullable(),
    usage: z.object({ read_call: z.number().int().min(0).max(1), bytes_read: z.number().int().min(0).max(262_144) }).strict(),
    result: WebReadResultSchema.nullable(),
    failure: InternetSearchFailureSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "success" && value.failure !== null) {
      context.addIssue({ code: "custom", message: "successful read envelopes must not include failure", path: ["failure"] });
    }
    if (value.status === "partial") {
      if (value.result === null) {
        context.addIssue({ code: "custom", message: "partial read envelopes must include bounded content", path: ["result"] });
      }
      if (value.failure === null) {
        context.addIssue({ code: "custom", message: "partial read envelopes must include a typed failure", path: ["failure"] });
      }
    }
    if ((value.status === "failure" || value.status === "unavailable" || value.status === "cancelled") && value.failure === null) {
      context.addIssue({ code: "custom", message: "unsuccessful read envelopes must include a typed failure", path: ["failure"] });
    }
  });

export type WebReadInput = z.infer<typeof WebReadInputSchema>;
export type WebReadEnvelope = z.infer<typeof WebReadEnvelopeSchema>;
