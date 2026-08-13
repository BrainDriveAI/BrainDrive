import type { AdapterConfig, Preferences } from "../contracts.js";
import { createModelAdapter, resolveEffectiveAdapterConfig } from "../adapters/index.js";
import { resolveProviderCredentialForStartup } from "../secrets/resolver.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import type { BriefProviderResolver } from "./broker.js";

export type BriefModelCompatibilityEntry = {
  provider_profile_id: string;
  model_id: string;
  compatible: true;
  prompt_policy_id: "brief.generate.fixed.v1";
  validation_policy_id: "brief.grounding.v1";
  fixture_corpus_digest: `sha256:${string}`;
};

/** Populated only by an accepted Brief conformance run; an empty registry fails closed. */
export const VERSIONED_BRIEF_MODEL_COMPATIBILITY_ENTRIES: readonly BriefModelCompatibilityEntry[] = Object.freeze([]);

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
      entry.prompt_policy_id === "brief.generate.fixed.v1" && entry.validation_policy_id === "brief.grounding.v1",
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
