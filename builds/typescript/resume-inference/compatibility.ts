import type { z } from "zod";

import { ModelCompatibilityEntrySchema, type InferencePurpose } from "../app-platform/contracts/inference.js";
import type { ModelAdapter } from "../adapters/base.js";
import type { AdapterConfig, Preferences } from "../contracts.js";
import { createModelAdapter, resolveEffectiveAdapterConfig } from "../adapters/index.js";
import { resolveProviderCredentialForStartup } from "../secrets/resolver.js";
import { ResumeInferenceError } from "./errors.js";
import registryDocument from "./model-compatibility.json" with { type: "json" };

type CompatibilityEntry = z.infer<typeof ModelCompatibilityEntrySchema>;

export const VERSIONED_MODEL_COMPATIBILITY_ENTRIES: unknown[] = (() => {
  if (registryDocument.registry_version !== 1 || !Array.isArray(registryDocument.entries)) {
    throw new Error("Resume Builder model compatibility registry is invalid");
  }
  return registryDocument.entries;
})();

export type ResolvedInferenceProvider = {
  providerProfileId: string;
  providerId: string;
  modelId: string;
  modelClass: "owner_active_compatible";
  adapter: ModelAdapter;
};

export class ModelCompatibilityRegistry {
  private readonly entries: CompatibilityEntry[];
  constructor(entries: unknown[]) {
    this.entries = entries.map((entry) => ModelCompatibilityEntrySchema.parse(entry));
  }
  require(providerProfileId: string, modelId: string, purpose: InferencePurpose): CompatibilityEntry {
    const entry = this.entries.find((candidate) => candidate.provider_profile_id === providerProfileId && candidate.model_id === modelId && candidate.purpose === purpose && candidate.compatible);
    if (!entry) throw new ResumeInferenceError("model_incompatible", "The active provider model has no accepted Resume Builder conformance record");
    return entry;
  }
}

export function createLiveProviderResolver(input: {
  adapterName: string;
  adapterConfig: AdapterConfig;
  loadPreferences: () => Promise<Preferences>;
  compatibility: ModelCompatibilityRegistry;
}): (purpose: InferencePurpose) => Promise<ResolvedInferenceProvider> {
  return async (purpose) => {
    const preferences = await input.loadPreferences();
    const effective = resolveEffectiveAdapterConfig(input.adapterConfig, preferences);
    const profileId = preferences.active_provider_profile?.trim() || input.adapterConfig.default_provider_profile?.trim();
    if (!profileId) throw new ResumeInferenceError("provider_unavailable", "No active provider profile is selected");
    input.compatibility.require(profileId, effective.model, purpose);
    const credential = await resolveProviderCredentialForStartup(input.adapterName, effective, preferences);
    const adapter = createModelAdapter(input.adapterName, input.adapterConfig, preferences, { apiKey: credential?.apiKey });
    if (!adapter.completeStructuredNoTools) throw new ResumeInferenceError("model_incompatible", "The active provider adapter does not support structured no-tools requests");
    return {
      providerProfileId: profileId,
      providerId: effective.provider_id ?? profileId,
      modelId: effective.model,
      modelClass: "owner_active_compatible",
      adapter,
    };
  };
}
