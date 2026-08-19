import type { ModelAdapter } from "../adapters/base.js";
import { createModelAdapter, resolveEffectiveAdapterConfig } from "../adapters/index.js";
import type { AdapterConfig, Preferences } from "../contracts.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import { resolveProviderCredentialForStartup } from "../secrets/resolver.js";

export type InstalledAppStructuredProvider = {
  providerProfileId: string;
  modelId: string;
  adapter: ModelAdapter;
};

export function createInstalledAppProviderResolver(input: {
  adapterName: string;
  adapterConfig: AdapterConfig;
  loadPreferences: () => Promise<Preferences>;
  resolveCredential?: typeof resolveProviderCredentialForStartup;
  createAdapter?: typeof createModelAdapter;
}): () => Promise<InstalledAppStructuredProvider> {
  return async () => {
    const preferences = await input.loadPreferences();
    const effective = resolveEffectiveAdapterConfig(input.adapterConfig, preferences);
    const profileId = preferences.active_provider_profile?.trim() || input.adapterConfig.default_provider_profile?.trim();
    if (!profileId) throw new AppPlatformError("provider_unavailable", "No active provider profile is selected", 409);
    const credential = await (input.resolveCredential ?? resolveProviderCredentialForStartup)(input.adapterName, effective, preferences);
    const adapter = (input.createAdapter ?? createModelAdapter)(input.adapterName, input.adapterConfig, preferences, { apiKey: credential?.apiKey });
    if (!adapter.completeStructuredNoTools) throw new AppPlatformError("protocol_incompatible", "The active provider does not support structured app inference", 409);
    return { providerProfileId: profileId, modelId: effective.model, adapter };
  };
}
