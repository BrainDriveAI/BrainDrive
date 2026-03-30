import type { AdapterConfig, Preferences } from "../contracts.js";
import type { ModelAdapter } from "./base.js";
import { OpenAICompatibleAdapter } from "./openai-compatible.js";

export type AdapterRuntimeSecrets = {
  apiKey?: string;
};

export function createModelAdapter(
  adapterName: string,
  adapterConfig: AdapterConfig,
  preferences: Preferences,
  runtimeSecrets?: AdapterRuntimeSecrets
): ModelAdapter {
  const selectedAdapterConfig = resolveAdapterConfigForPreferences(adapterConfig, preferences);
  const legacyBootstrapModel = "llama3.1";
  const activeProfile =
    preferences.active_provider_profile?.trim() ||
    adapterConfig.default_provider_profile?.trim() ||
    "";
  // Model resolution: per-provider default takes priority. If no per-provider
  // default exists, use the adapter profile's built-in model — never fall back
  // to the global default_model, since model IDs are provider-specific.
  const providerModel = activeProfile
    ? preferences.provider_default_models?.[activeProfile]?.trim()
    : undefined;
  const preferenceModel = providerModel ?? "";
  const useAdapterModel =
    preferenceModel.length === 0 ||
    (preferenceModel === legacyBootstrapModel && selectedAdapterConfig.model !== legacyBootstrapModel);

  const resolvedConfig: AdapterConfig = {
    ...selectedAdapterConfig,
    model: useAdapterModel ? selectedAdapterConfig.model : preferenceModel,
  };

  switch (adapterName) {
    case "openai-compatible":
      return new OpenAICompatibleAdapter(resolvedConfig, runtimeSecrets);
    default:
      throw new Error(`Unsupported provider adapter: ${adapterName}`);
  }
}

export function resolveAdapterConfigForPreferences(
  adapterConfig: AdapterConfig,
  preferences: Preferences
): AdapterConfig {
  const profiles = adapterConfig.provider_profiles;
  if (!profiles || Object.keys(profiles).length === 0) {
    return adapterConfig;
  }

  const selectedProfile =
    preferences.active_provider_profile?.trim() ||
    adapterConfig.default_provider_profile?.trim() ||
    Object.keys(profiles)[0];

  if (!selectedProfile) {
    throw new Error("No adapter provider profile is available");
  }

  const profileConfig = profiles[selectedProfile];
  if (!profileConfig) {
    throw new Error(`Unsupported provider profile: ${selectedProfile}`);
  }

  const baseUrlOverride = preferences.provider_base_urls?.[selectedProfile];

  return {
    ...profileConfig,
    ...(baseUrlOverride ? { base_url: baseUrlOverride } : {}),
    provider_profiles: profiles,
    default_provider_profile: adapterConfig.default_provider_profile,
  };
}
