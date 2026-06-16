import { describe, expect, it } from "vitest";

import type { AdapterConfig, Preferences } from "../contracts.js";
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
});
