import { z } from "zod";

import { OpaqueIdSchema, TimestampSchema } from "../../app-platform/contracts/common.js";
import { InternetSearchFailureCodeSchema } from "./failures.js";

export const InternetSearchReceiptStatusSchema = z.enum([
  "success",
  "partial",
  "failure",
  "unavailable",
  "cancelled",
]);

export const InternetSearchReceiptProjectionSchema = z
  .object({
    receipt_version: z.literal(1),
    capability_id: z.literal("internet-search"),
    capability_version: z.string().min(1).max(32),
    operation_id: z.enum(["web.search@1", "web.read@1"]),
    request_id: OpaqueIdSchema,
    run_id: OpaqueIdSchema,
    status: InternetSearchReceiptStatusSchema,
    failure_code: InternetSearchFailureCodeSchema.nullable(),
    result_count: z.number().int().min(0).max(10),
    completed_item_count: z.number().int().min(0).max(10),
    occurred_at: TimestampSchema,
    limit_profile_id: z.literal("is-local-v1.0"),
    provider_profile_id: z.literal("local-owner-managed"),
    max_search_operations_per_run: z.literal(5),
    max_read_operations_per_run: z.literal(5),
    max_normalized_results_per_search: z.literal(10),
    max_redirects_per_read: z.literal(3),
    max_returned_read_content_bytes: z.literal(262_144),
    search_operation_timeout_ms: z.literal(10_000),
    read_operation_timeout_ms: z.literal(10_000),
    run_wall_clock_limit_ms: z.literal(60_000),
    billing: z.literal("none_owner_managed_local"),
    fallback: z.literal("none"),
  })
  .strict();

export type InternetSearchReceiptProjection = z.infer<typeof InternetSearchReceiptProjectionSchema>;
