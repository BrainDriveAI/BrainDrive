import { describe, expect, it } from "vitest";

import { ModelCompatibilityRegistry, VERSIONED_MODEL_COMPATIBILITY_ENTRIES } from "./compatibility.js";
import { PURPOSE_OUTPUT_SCHEMAS } from "../app-platform/contracts/inference.js";
import { RESUME_MODEL_CONFORMANCE_CORPUS_DIGEST } from "./conformance-corpus.js";

function entry(provider: string, model: string) {
  return {
    registry_version: 1, provider_profile_id: provider, model_id: model, purpose: "interview_assist",
    output_schema_id: PURPOSE_OUTPUT_SCHEMAS.interview_assist, compatible: true,
    fixture_corpus_digest: `sha256:${"a".repeat(64)}`, tested_at: "2026-08-07T12:00:00.000Z",
    zero_unsupported_claim_gate: true, schema_success_rate: 1, latency_p95_ms: 100,
  };
}

describe("model compatibility registry", () => {
  it("admits the effective BrainDrive Models alias only for its conformance-backed purposes", () => {
    expect(VERSIONED_MODEL_COMPATIBILITY_ENTRIES).toHaveLength(6);
    expect(VERSIONED_MODEL_COMPATIBILITY_ENTRIES).toEqual(expect.arrayContaining(Object.keys(PURPOSE_OUTPUT_SCHEMAS).map((purpose) => expect.objectContaining({
      provider_profile_id: "braindrive-models",
      model_id: "braindrive-models-default",
      purpose,
      compatible: true,
      fixture_corpus_digest: RESUME_MODEL_CONFORMANCE_CORPUS_DIGEST,
      zero_unsupported_claim_gate: true,
      schema_success_rate: 1,
    }))));
    const registry = new ModelCompatibilityRegistry(VERSIONED_MODEL_COMPATIBILITY_ENTRIES);
    for (const purpose of Object.keys(PURPOSE_OUTPUT_SCHEMAS) as Array<keyof typeof PURPOSE_OUTPUT_SCHEMAS>) {
      expect(registry.require("braindrive-models", "braindrive-models-default", purpose).purpose).toBe(purpose);
    }
    expect(() => registry.require("openrouter", "braindrive-models-default", "general_resume_draft")).toThrow(/conformance record/);
  });

  it("keeps Ollama, BYOK OpenRouter, and BrainDrive Models independent and conformance-derived", () => {
    const registry = new ModelCompatibilityRegistry([
      entry("ollama", "local-model"),
      entry("openrouter-byok", "remote-model"),
      entry("braindrive-models", "managed-model"),
    ]);
    expect(registry.require("ollama", "local-model", "interview_assist").provider_profile_id).toBe("ollama");
    expect(registry.require("openrouter-byok", "remote-model", "interview_assist").provider_profile_id).toBe("openrouter-byok");
    expect(registry.require("braindrive-models", "managed-model", "interview_assist").provider_profile_id).toBe("braindrive-models");
    expect(() => registry.require("ollama", "remote-model", "interview_assist")).toThrow(/conformance record/);
    expect(() => registry.require("openrouter-byok", "managed-model", "interview_assist")).toThrow(/conformance record/);
  });
});
