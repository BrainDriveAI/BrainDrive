import { describe, expect, it } from "vitest";

import { ModelCompatibilityRegistry, VERSIONED_MODEL_COMPATIBILITY_ENTRIES } from "./compatibility.js";
import { PURPOSE_OUTPUT_SCHEMAS } from "../app-platform/contracts/inference.js";
import { conformanceCorpusDigest, RESUME_MODEL_CONFORMANCE_BINDING, RESUME_MODEL_CONFORMANCE_CORPUS_DIGEST } from "./conformance-corpus.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "./policy.js";

function entry(provider: string, model: string) {
  return {
    registry_version: 1, provider_profile_id: provider, model_id: model, purpose: "interview_assist",
    output_schema_id: PURPOSE_OUTPUT_SCHEMAS.interview_assist, compatible: true,
    prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
    fixture_corpus_digest: conformanceCorpusDigest("interview_assist"), tested_at: "2026-08-07T12:00:00.000Z",
    zero_unsupported_claim_gate: true, schema_success_rate: 1, latency_p95_ms: 100,
  };
}

describe("model compatibility registry", () => {
  it("invalidates craft-evaluator conformance from the prior prompt and result policies", () => {
    const base = entry("ollama", "local-model");
    const currentCraft = {
      ...base,
      purpose: "resume_craft_evaluate" as const,
      output_schema_id: PURPOSE_OUTPUT_SCHEMAS.resume_craft_evaluate,
      fixture_corpus_digest: conformanceCorpusDigest("resume_craft_evaluate"),
    };
    const registry = new ModelCompatibilityRegistry([
      { ...currentCraft, prompt_policy_version: "7" },
      currentCraft,
    ]);
    expect(RESUME_PROMPT_POLICY_VERSION).toBe("8");
    expect(RESUME_MODEL_CONFORMANCE_BINDING.prompt_policy_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(RESUME_MODEL_CONFORMANCE_BINDING.evaluator_contract_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(RESUME_MODEL_CONFORMANCE_BINDING.craft_report_schema_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(PURPOSE_OUTPUT_SCHEMAS.resume_craft_evaluate).toBe("resume.craft-evaluate.v2");
    expect(registry.require("ollama", "local-model", "resume_craft_evaluate")).toMatchObject({
      prompt_policy_version: "8",
      output_schema_id: "resume.craft-evaluate.v2",
    });
  });

  it("admits the effective BrainDrive Models alias only for its conformance-backed purposes", () => {
    const allPurposes = Object.keys(PURPOSE_OUTPUT_SCHEMAS) as Array<keyof typeof PURPOSE_OUTPUT_SCHEMAS>;
    const passingPurposes = VERSIONED_MODEL_COMPATIBILITY_ENTRIES.map((candidate) =>
      (candidate as { purpose: keyof typeof PURPOSE_OUTPUT_SCHEMAS }).purpose,
    );
    expect(new Set(passingPurposes).size).toBe(passingPurposes.length);
    const registry = new ModelCompatibilityRegistry(VERSIONED_MODEL_COMPATIBILITY_ENTRIES);
    for (const purpose of passingPurposes) {
      expect(registry.require("braindrive-models", "braindrive-models-default", purpose)).toMatchObject({ purpose, compatible: true });
    }
    for (const purpose of allPurposes.filter((candidate) => !passingPurposes.includes(candidate))) {
      expect(() => registry.require("braindrive-models", "braindrive-models-default", purpose)).toThrow(/conformance record/);
    }
    for (const purpose of ["interview_assist", "general_resume_draft", "targeted_resume_draft"] as const) {
      expect(conformanceCorpusDigest(purpose)).not.toBe(RESUME_MODEL_CONFORMANCE_CORPUS_DIGEST);
    }
    expect(() => registry.require("openrouter", "braindrive-models-default", "general_resume_draft")).toThrow(/conformance record/);
    const stale = new ModelCompatibilityRegistry([{ ...entry("braindrive-models", "braindrive-models-default"), fixture_corpus_digest: `sha256:${"f".repeat(64)}` }]);
    expect(() => stale.require("braindrive-models", "braindrive-models-default", "interview_assist")).toThrow(/conformance record/);
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
