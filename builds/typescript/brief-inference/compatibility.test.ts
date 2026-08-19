import { describe, expect, it } from "vitest";

import type { AdapterConfig, Preferences } from "../contracts.js";
import { BRIEF_OUTPUT_SCHEMA_ID } from "./contracts.js";
import { BRIEF_MODEL_CONFORMANCE_CORPUS_DIGEST } from "./conformance-corpus.js";
import { createLiveBriefProviderResolver, VERSIONED_BRIEF_MODEL_COMPATIBILITY_ENTRIES, type BriefModelCompatibilityEntry } from "./compatibility.js";

const adapterConfig: AdapterConfig = {
  base_url: "http://127.0.0.1:11434/v1", model: "local-model", api_key_env: "OLLAMA_API_KEY", provider_id: "ollama",
  default_provider_profile: "ollama",
  provider_profiles: { ollama: { base_url: "http://127.0.0.1:11434/v1", model: "local-model", api_key_env: "OLLAMA_API_KEY", provider_id: "ollama" } },
};
const preferences: Preferences = { default_model: "legacy", approval_mode: "ask-on-write", active_provider_profile: "ollama" };
const accepted: BriefModelCompatibilityEntry = {
  registry_version: 1, provider_profile_id: "ollama", model_id: "local-model", purpose: "brief.generate", output_schema_id: BRIEF_OUTPUT_SCHEMA_ID,
  compatible: true, prompt_policy_id: "brief.generate.fixed.v2", validation_policy_id: "brief.grounding.v1", fixture_corpus_digest: BRIEF_MODEL_CONFORMANCE_CORPUS_DIGEST,
  tested_at: "2026-08-13T12:00:00.000Z", zero_unsupported_claim_gate: true, schema_success_rate: 1, latency_p95_ms: 100,
};

describe("Brief live provider compatibility", () => {
  it("loads the versioned registry and keeps an unqualified owner-active model fail-closed", async () => {
    expect(VERSIONED_BRIEF_MODEL_COMPATIBILITY_ENTRIES.every((entry) => entry.provider_profile_id !== "ollama" || entry.model_id !== "local-model")).toBe(true);
    const resolve = createLiveBriefProviderResolver({ adapterName: "openai-compatible", adapterConfig, loadPreferences: async () => preferences });
    await expect(resolve()).rejects.toMatchObject({ code: "protocol_incompatible" });
  });

  it("resolves exactly the active profile/model when its current Brief evidence is accepted", async () => {
    const resolve = createLiveBriefProviderResolver({ adapterName: "openai-compatible", adapterConfig, loadPreferences: async () => preferences, compatibilityEntries: [accepted] });
    await expect(resolve()).resolves.toMatchObject({ providerProfileId: "ollama", modelId: "local-model", compatibility: "brief_structured_no_tools_v1" });
    const stale = createLiveBriefProviderResolver({ adapterName: "openai-compatible", adapterConfig, loadPreferences: async () => preferences, compatibilityEntries: [{ ...accepted, fixture_corpus_digest: `sha256:${"f".repeat(64)}` }] });
    await expect(stale()).rejects.toMatchObject({ code: "protocol_incompatible" });
  });
});
