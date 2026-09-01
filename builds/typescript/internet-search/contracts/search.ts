import { z } from "zod";

import { OpaqueIdSchema, TimestampSchema } from "../../app-platform/contracts/common.js";
import { InternetSearchFailureSchema } from "./failures.js";

export const WebSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(512),
    max_results: z.number().int().min(1).max(10).default(10),
    filters: z
      .object({
        language: z.string().trim().min(2).max(16).optional(),
        freshness: z.enum(["any", "day", "week", "month", "year"]).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

export const WebSearchResultSchema = z
  .object({
    title: z.string().trim().min(1).max(512),
    url: z.string().url().max(2_048),
    snippet: z.string().max(2_048).nullable(),
    source: z.string().trim().min(1).max(255),
    retrieved_at: TimestampSchema,
    published_at: z.string().trim().min(1).max(64).nullable(),
    updated_at: z.string().trim().min(1).max(64).nullable(),
    freshness: z.enum(["provider-reported", "retrieved", "unknown"]),
    result_class: z.literal("outside-fact"),
  })
  .strict();

export const WebSearchEnvelopeSchema = z
  .object({
    capability: z.literal("web.search"),
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
    usage: z.object({ search_call: z.number().int().min(0).max(1) }).strict(),
    results: z.array(WebSearchResultSchema).max(10),
    failure: InternetSearchFailureSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "success" && value.failure !== null) {
      context.addIssue({ code: "custom", message: "successful search envelopes must not include failure", path: ["failure"] });
    }
    if (value.status === "partial") {
      if (value.results.length === 0) {
        context.addIssue({ code: "custom", message: "partial search envelopes must include completed results", path: ["results"] });
      }
      if (value.failure === null) {
        context.addIssue({ code: "custom", message: "partial search envelopes must include a typed failure", path: ["failure"] });
      }
    }
    if ((value.status === "failure" || value.status === "unavailable" || value.status === "cancelled") && value.failure === null) {
      context.addIssue({ code: "custom", message: "unsuccessful search envelopes must include a typed failure", path: ["failure"] });
    }
  });

export type WebSearchInput = z.infer<typeof WebSearchInputSchema>;
export type WebSearchEnvelope = z.infer<typeof WebSearchEnvelopeSchema>;
