import { describe, expect, it } from "vitest";

import type { AdapterConfig, Preferences } from "../contracts.js";
import { resolveEffectiveAdapterConfig } from "../adapters/index.js";
import { resolveProviderCredentialForStartup } from "./resolver.js";

describe("resolveProviderCredentialForStartup", () => {
  it("does not reuse a single unrelated provider credential for a selected provider profile", async () => {
    const adapterConfig: AdapterConfig = {
      base_url: "http://127.0.0.1:11434/v1",
      model: "",
      api_key_env: "OLLAMA_API_KEY",
      provider_id: "ollama",
      default_provider_profile: "braindrive-models",
      provider_profiles: {
        "braindrive-models": {
          base_url: "https://my.braindrive.ai/credits/v1",
          model: "braindrive-models-default",
          api_key_env: "AI_GATEWAY_API_KEY",
          provider_id: "braindrive-models",
        },
        ollama: {
          base_url: "http://127.0.0.1:11434/v1",
          model: "",
          api_key_env: "OLLAMA_API_KEY",
          provider_id: "ollama",
        },
      },
    };
    const preferences: Preferences = {
      default_model: "llama3.1",
      approval_mode: "ask-on-write",
      active_provider_profile: "ollama",
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
        },
      },
    };

    await expect(resolveProviderCredentialForStartup("openai-compatible", adapterConfig, preferences)).resolves.toBe(
      undefined
    );
  });

  it("resolves only the active BYOK or BrainDrive Models credential and keeps Ollama keyless", async () => {
    const byokEnv = "BRAINDRIVE_M5_TEST_BYOK_KEY";
    const managedEnv = "BRAINDRIVE_M5_TEST_MANAGED_KEY";
    process.env[byokEnv] = "fixture-byok-credential";
    process.env[managedEnv] = "fixture-managed-credential";
    try {
      const adapterConfig: AdapterConfig = {
        base_url: "http://127.0.0.1:11434/v1", model: "", api_key_env: "OLLAMA_API_KEY", provider_id: "ollama",
        default_provider_profile: "ollama",
        provider_profiles: {
          ollama: { base_url: "http://127.0.0.1:11434/v1", model: "llama3.1", api_key_env: "OLLAMA_API_KEY", provider_id: "ollama" },
          openrouter: { base_url: "https://openrouter.ai/api/v1", model: "owner/model", api_key_env: "OPENROUTER_API_KEY", provider_id: "openrouter" },
          "braindrive-models": { base_url: "https://my.braindrive.ai/credits/v1", model: "managed/model", api_key_env: "AI_GATEWAY_API_KEY", provider_id: "braindrive-models" },
        },
      };
      const credentials: Preferences["provider_credentials"] = {
        openrouter: { mode: "secret_ref", secret_ref: "provider/openrouter/api_key", env_ref: byokEnv },
        "braindrive-models": { mode: "secret_ref", secret_ref: "provider/ai-gateway/api_key", env_ref: managedEnv },
      };
      const preference = (profile: string): Preferences => ({ default_model: "", approval_mode: "ask-on-write", active_provider_profile: profile, provider_credentials: credentials });
      const ollama = preference("ollama");
      await expect(resolveProviderCredentialForStartup("openai-compatible", resolveEffectiveAdapterConfig(adapterConfig, ollama), ollama)).resolves.toBeUndefined();
      const byok = preference("openrouter");
      await expect(resolveProviderCredentialForStartup("openai-compatible", resolveEffectiveAdapterConfig(adapterConfig, byok), byok)).resolves.toMatchObject({ providerId: "openrouter", apiKey: "fixture-byok-credential" });
      const managed = preference("braindrive-models");
      await expect(resolveProviderCredentialForStartup("openai-compatible", resolveEffectiveAdapterConfig(adapterConfig, managed), managed)).resolves.toMatchObject({ providerId: "braindrive-models", apiKey: "fixture-managed-credential" });
    } finally {
      delete process.env[byokEnv];
      delete process.env[managedEnv];
    }
  });
});
