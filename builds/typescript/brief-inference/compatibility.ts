import { z } from "zod";

import type { AdapterConfig, Preferences } from "../contracts.js";
import { createModelAdapter, resolveEffectiveAdapterConfig } from "../adapters/index.js";
import { resolveProviderCredentialForStartup } from "../secrets/resolver.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import { Sha256DigestSchema } from "../app-platform/contracts/common.js";
import type { BriefProviderResolver } from "./broker.js";
import { BRIEF_OUTPUT_SCHEMA_ID } from "./contracts.js";
import { BRIEF_MODEL_CONFORMANCE_CORPUS_DIGEST } from "./conformance-corpus.js";
import registryDocument from "./model-compatibility.json" with { type: "json" };

export const BriefModelCompatibilityEntrySchema = z.object({
  registry_version: z.literal(1),
  provider_profile_id: z.string().trim().min(1),
  model_id: z.string().trim().min(1),
  purpose: z.literal("brief.generate"),
  output_schema_id: z.literal(BRIEF_OUTPUT_SCHEMA_ID),
  compatible: z.boolean(),
  prompt_policy_id: z.literal("brief.generate.fixed.v2"),
  validation_policy_id: z.literal("brief.grounding.v1"),
  fixture_corpus_digest: Sha256DigestSchema,
  tested_at: z.string().datetime(),
  zero_unsupported_claim_gate: z.boolean(),
  schema_success_rate: z.number().min(0).max(1),
  latency_p95_ms: z.number().int().positive(),
}).strict();

export type BriefModelCompatibilityEntry = z.infer<typeof BriefModelCompatibilityEntrySchema>;

export const VERSIONED_BRIEF_MODEL_COMPATIBILITY_ENTRIES: readonly BriefModelCompatibilityEntry[] = (() => {
  if (registryDocument.registry_version !== 1 || !Array.isArray(registryDocument.entries)) throw new Error("Brief Builder model compatibility registry is invalid");
  return Object.freeze(registryDocument.entries.map((entry) => BriefModelCompatibilityEntrySchema.parse(entry)));
})();

export function createLiveBriefProviderResolver(input: {
  adapterName: string;
  adapterConfig: AdapterConfig;
  loadPreferences: () => Promise<Preferences>;
  compatibilityEntries?: readonly BriefModelCompatibilityEntry[];
}): BriefProviderResolver {
  return async () => {
    const preferences = await input.loadPreferences();
    const effective = resolveEffectiveAdapterConfig(input.adapterConfig, preferences);
    const profileId = preferences.active_provider_profile?.trim() || input.adapterConfig.default_provider_profile?.trim();
    if (!profileId) throw new AppPlatformError("protocol_incompatible", "No owner-active provider is selected for Brief Builder", 409);
    const accepted = (input.compatibilityEntries ?? VERSIONED_BRIEF_MODEL_COMPATIBILITY_ENTRIES).find((entry) =>
      entry.provider_profile_id === profileId && entry.model_id === effective.model && entry.compatible &&
      entry.purpose === "brief.generate" && entry.output_schema_id === BRIEF_OUTPUT_SCHEMA_ID &&
      entry.prompt_policy_id === "brief.generate.fixed.v2" && entry.validation_policy_id === "brief.grounding.v1" &&
      entry.fixture_corpus_digest === BRIEF_MODEL_CONFORMANCE_CORPUS_DIGEST && entry.zero_unsupported_claim_gate && entry.schema_success_rate === 1,
    );
    if (!accepted) throw new AppPlatformError("protocol_incompatible", "The owner-active model has no accepted Brief Builder conformance record", 409);
    const credential = await resolveProviderCredentialForStartup(input.adapterName, effective, preferences);
    const adapter = createModelAdapter(input.adapterName, input.adapterConfig, preferences, { apiKey: credential?.apiKey });
    if (!adapter.completeStructuredNoTools) throw new AppPlatformError("protocol_incompatible", "The owner-active adapter does not support structured no-tools requests", 409);
    return {
      providerProfileId: profileId,
      modelId: effective.model,
      compatibility: "brief_structured_no_tools_v1",
      adapter: {
        completeStructuredNoTools: async (request) => {
          const response = await adapter.completeStructuredNoTools!(request);
          const finishReason = ["stop", "length", "content_filter", "tool_calls"].includes(response.finishReason)
            ? response.finishReason as "stop" | "length" | "content_filter" | "tool_calls"
            : "content_filter";
          return { text: response.text, finishReason };
        },
      },
    };
  };
}
