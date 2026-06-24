import { describe, expect, it } from "vitest";

import type { AdapterConfig, Preferences } from "../contracts.js";
import { resolveEffectiveAdapterConfig } from "./index.js";

describe("resolveEffectiveAdapterConfig", () => {
  const adapterConfig: AdapterConfig = {
    base_url: "https://unused.example/v1",
    model: "legacy-default",
    api_key_env: "UNUSED_KEY",
    provider_profiles: {
      openrouter: {
        base_url: "https://openrouter.ai/api/v1",
        model: "anthropic/claude-haiku-4.5",
        api_key_env: "OPENROUTER_API_KEY",
        provider_id: "openrouter",
      },
      ollama: {
        base_url: "http://127.0.0.1:11434/v1",
        model: "llama3.1",
        api_key_env: "OLLAMA_API_KEY",
        provider_id: "ollama",
      },
    },
    default_provider_profile: "openrouter",
  };

  it("uses the active provider default model for the final adapter config", () => {
    const preferences: Preferences = {
      default_model: "anthropic/claude-haiku-4.5",
      approval_mode: "auto-approve",
      active_provider_profile: "openrouter",
      provider_default_models: {
        openrouter: "google/gemini-3.5-flash",
      },
    };

    expect(resolveEffectiveAdapterConfig(adapterConfig, preferences)).toMatchObject({
      base_url: "https://openrouter.ai/api/v1",
      provider_id: "openrouter",
      model: "google/gemini-3.5-flash",
    });
  });

  it("ignores the legacy bootstrap model when the selected profile has a real default", () => {
    const preferences: Preferences = {
      default_model: "llama3.1",
      approval_mode: "auto-approve",
      active_provider_profile: "openrouter",
      provider_default_models: {
        openrouter: "llama3.1",
      },
    };

    expect(resolveEffectiveAdapterConfig(adapterConfig, preferences).model).toBe("anthropic/claude-haiku-4.5");
  });
});
