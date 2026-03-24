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
  const preferenceModel = preferences.default_model.trim();
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

  return {
    ...profileConfig,
    provider_profiles: profiles,
    default_provider_profile: adapterConfig.default_provider_profile,
  };
}
