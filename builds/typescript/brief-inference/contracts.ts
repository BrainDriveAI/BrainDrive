import { z } from "zod";

import { OpaqueIdSchema, Sha256DigestSchema } from "../app-platform/contracts/common.js";

export const BRIEF_GENERATE_PURPOSE = "brief.generate" as const;
export const BRIEF_GENERATE_VERSION = 1 as const;
export const BRIEF_PROMPT_POLICY_ID = "brief.generate.fixed.v1" as const;
export const BRIEF_VALIDATION_POLICY_ID = "brief.grounding.v1" as const;

export const BriefGenerateInputSchema = z.object({
  source_revision_id: OpaqueIdSchema,
  source_text: z.string().trim().min(1).max(32_768),
  source_digest: Sha256DigestSchema,
  owner_context: z.array(z.string().trim().min(1).max(2_048)).max(8).default([]),
}).strict();

export const BriefGenerateOutputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  statements: z.array(z.object({
    statement_id: OpaqueIdSchema,
    text: z.string().trim().min(1).max(1_024),
    support: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("source_quote"), quote: z.string().trim().min(1).max(2_048) }).strict(),
      z.object({ kind: z.literal("owner_context"), context: z.string().trim().min(1).max(2_048) }).strict(),
    ]),
  }).strict()).min(1).max(12),
}).strict();

export type BriefGenerateInput = z.infer<typeof BriefGenerateInputSchema>;
export type BriefGenerateOutput = z.infer<typeof BriefGenerateOutputSchema>;
