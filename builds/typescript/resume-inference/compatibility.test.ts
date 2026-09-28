import { describe, expect, it, vi } from "vitest";

import type { AdapterConfig, Preferences } from "../contracts.js";
import {
  ModelCompatibilityEntrySchema,
  PURPOSE_OUTPUT_SCHEMAS,
} from "../app-platform/contracts/inference.js";
import {
  ModelCompatibilityRegistry,
  VERSIONED_MODEL_COMPATIBILITY_ENTRIES,
  createLiveProviderResolver,
  effectiveInferenceConfigFingerprint,
} from "./compatibility.js";
import {
  conformanceCorpusDigest,
  conformanceFixtureDigest,
  conformanceFixturesForPurpose,
} from "./conformance-corpus.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "./policy.js";

const TESTED_AT = "2026-08-11T12:00:00.000Z";
const EXPIRES_AT = "2026-11-09T12:00:00.000Z";
const CONFIG = effectiveInferenceConfigFingerprint({
  adapterName: "openai-compatible",
  providerProfileId: "braindrive-models",
  providerId: "braindrive-models",
  modelId: "braindrive-models-default",
  baseUrl: "https://managed.invalid/v1",
});

function legacyEntry(provider = "braindrive-models", model = "braindrive-models-default") {
  return {
    registry_version: 1 as const,
    provider_profile_id: provider,
    model_id: model,
    purpose: "interview_assist" as const,
    output_schema_id: PURPOSE_OUTPUT_SCHEMAS.interview_assist,
    compatible: true,
    prompt_policy_id: RESUME_PROMPT_POLICY_ID,
    prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
    fixture_corpus_digest: `sha256:${"b".repeat(64)}`,
    tested_at: TESTED_AT,
    zero_unsupported_claim_gate: true,
    schema_success_rate: 1,
    latency_p95_ms: 100,
  };
}

function v2Entry(overrides: Record<string, unknown> = {}) {
  const purpose = "interview_assist" as const;
  const fixtures = conformanceFixturesForPurpose(purpose);
  const runs = fixtures.flatMap((fixture, fixtureIndex) => Array.from({ length: 3 }, (_, runIndex) => ({
    fixture_id: fixture.fixture_id,
    fixture_digest: conformanceFixtureDigest(purpose, fixture.fixture_id),
    operation_id: `92000000-0000-4000-8000-${String(fixtureIndex * 3 + runIndex + 1).padStart(12, "0")}`,
    attempt_count: 1,
    provider_call_count: 1,
    observed_model_id: "observed-revision-a",
    finish_category: "stop",
    recovery_class: "none",
    completion_mode: "primary",
    final_disposition: "completed",
    error_code: null,
    schema_valid: true,
    evidence_valid: true,
    provider_success: true,
    latency_ms: 100,
  })));
  return {
    registry_version: 2 as const,
    provider_profile_id: "braindrive-models",
    model_id: "braindrive-models-default",
    observed_model_id: "observed-revision-a",
    effective_config_fingerprint: CONFIG,
    purpose,
    output_schema_id: PURPOSE_OUTPUT_SCHEMAS[purpose],
    output_schema_version: 1,
    prompt_policy_id: RESUME_PROMPT_POLICY_ID,
    prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
    fixture_corpus_digest: conformanceCorpusDigest(purpose),
    fixture_count: fixtures.length,
    runs_per_fixture: 3 as const,
    operation_count: runs.length,
    evidence_class: "authorized_live_provider" as const,
    outcomes: {
      primary_success: runs.length,
      structural_repair_success: 0,
      validation_repair_success: 0,
      deterministic_fallback_success: 0,
      host_owned_success: 0,
      safe_failure: 0,
      schema_valid: runs.length,
      evidence_valid: runs.length,
      provider_success: runs.length,
      zero_provider_call: 0,
    },
    all_required_runs_valid: true,
    compatible: true,
    zero_unsupported_claim_gate: true,
    latency_p95_ms: 100,
    tested_at: TESTED_AT,
    expires_at: EXPIRES_AT,
    runs,
    ...overrides,
  };
}

describe("model compatibility registry v1/v2", () => {
  it("fails closed when the tracked legacy registry predates the current prompt policy", () => {
    expect(VERSIONED_MODEL_COMPATIBILITY_ENTRIES.length).toBeGreaterThan(0);
    const registry = new ModelCompatibilityRegistry(VERSIONED_MODEL_COMPATIBILITY_ENTRIES);
    expect(() => registry.require("braindrive-models", "braindrive-models-default", "interview_assist"))
      .toThrow(/no accepted Resume Builder conformance record/);
  });

  it("accepts an exact current v2 record and rejects it at the 90-day boundary", () => {
    const entry = v2Entry();
    const current = new ModelCompatibilityRegistry([entry], () => new Date("2026-11-09T11:59:59.999Z"));
    expect(current.require("braindrive-models", "braindrive-models-default", "interview_assist", {
      effectiveConfigFingerprint: CONFIG,
      observedModelId: "observed-revision-a",
    })).toMatchObject({ compatibility_state: "current_v2", spec_09_release_evidence: true });
    const expired = new ModelCompatibilityRegistry([entry], () => new Date(EXPIRES_AT));
    expect(() => expired.require("braindrive-models", "braindrive-models-default", "interview_assist", {
      effectiveConfigFingerprint: CONFIG,
    })).toThrow(/conformance record/);
  });

  it("rejects configuration, observed identity, corpus, and profile drift", () => {
    const registry = new ModelCompatibilityRegistry([v2Entry()], () => new Date("2026-08-12T00:00:00.000Z"));
    const require = (profile: string, fingerprint: string, observed?: string) => registry.require(
      profile, "braindrive-models-default", "interview_assist",
      { effectiveConfigFingerprint: fingerprint, ...(observed ? { observedModelId: observed } : {}) },
    );
    expect(() => require("openrouter", CONFIG)).toThrow();
    expect(() => require("braindrive-models", `sha256:${"f".repeat(64)}`)).toThrow();
    expect(() => require("braindrive-models", CONFIG, "observed-revision-b")).toThrow();
    expect(() => new ModelCompatibilityRegistry([{ ...v2Entry(), fixture_corpus_digest: `sha256:${"f".repeat(64)}` }], () => new Date("2026-08-12T00:00:00.000Z"))
      .require("braindrive-models", "braindrive-models-default", "interview_assist", { effectiveConfigFingerprint: CONFIG })).toThrow();
  });

  it("rejects malformed, partial, insufficient, duplicate, and failed v2 evidence", () => {
    const valid = v2Entry();
    expect(ModelCompatibilityEntrySchema.safeParse({ ...valid, expires_at: "2026-11-08T12:00:00.000Z" }).success).toBe(false);
    expect(ModelCompatibilityEntrySchema.safeParse({ ...valid, runs: valid.runs.slice(0, -1), operation_count: valid.runs.length - 1 }).success).toBe(false);
    expect(ModelCompatibilityEntrySchema.safeParse({ ...valid, runs: valid.runs.map((run, index) => index === 1 ? { ...run, operation_id: valid.runs[0]!.operation_id } : run) }).success).toBe(false);
    expect(ModelCompatibilityEntrySchema.safeParse({ ...valid, effective_config_fingerprint: undefined }).success).toBe(false);
    const partialRuns = valid.runs.slice(0, 3);
    const partial = {
      ...valid,
      fixture_count: 1,
      operation_count: 3,
      runs: partialRuns,
      outcomes: { ...valid.outcomes, primary_success: 3, schema_valid: 3, evidence_valid: 3, provider_success: 3 },
    };
    expect(ModelCompatibilityEntrySchema.safeParse(partial).success).toBe(true);
    expect(() => new ModelCompatibilityRegistry([partial], () => new Date("2026-08-12T00:00:00.000Z"))
      .require("braindrive-models", "braindrive-models-default", "interview_assist", { effectiveConfigFingerprint: CONFIG })).toThrow();

    const failedRuns = valid.runs.map((run, index) => index === 0 ? {
      ...run,
      completion_mode: "none",
      final_disposition: "failed",
      error_code: "provider_unavailable",
      schema_valid: false,
      evidence_valid: false,
      provider_success: false,
    } : run);
    const failed = {
      ...valid,
      runs: failedRuns,
      outcomes: {
        ...valid.outcomes,
        primary_success: valid.runs.length - 1,
        safe_failure: 1,
        schema_valid: valid.runs.length - 1,
        evidence_valid: valid.runs.length - 1,
        provider_success: valid.runs.length - 1,
      },
      compatible: false,
      all_required_runs_valid: false,
      zero_unsupported_claim_gate: false,
    };
    expect(ModelCompatibilityEntrySchema.safeParse(failed).success).toBe(true);
    expect(() => new ModelCompatibilityRegistry([failed], () => new Date("2026-08-12T00:00:00.000Z"))
      .require("braindrive-models", "braindrive-models-default", "interview_assist", { effectiveConfigFingerprint: CONFIG })).toThrow();
    const slowRuns = valid.runs.map((run, index) => index === valid.runs.length - 1 ? { ...run, latency_ms: 60_001 } : run);
    expect(ModelCompatibilityEntrySchema.safeParse({
      ...valid,
      runs: slowRuns,
      latency_p95_ms: 60_001,
      compatible: false,
    }).success).toBe(true);
  });

  it("rejects a forged p95 instead of trusting the declared aggregate", () => {
    const valid = v2Entry();
    const slowRuns = valid.runs.map((run, index) => index === valid.runs.length - 1 ? { ...run, latency_ms: 60_001 } : run);
    const forged = { ...valid, runs: slowRuns, latency_p95_ms: 100, compatible: true };
    expect(ModelCompatibilityEntrySchema.safeParse(forged).success).toBe(false);
    expect(() => new ModelCompatibilityRegistry([forged], () => new Date("2026-08-12T00:00:00.000Z"))).toThrow();
  });

  it("cannot erase or mismatch retained observed identity and fails mixed presence closed", () => {
    const valid = v2Entry();
    const erased = { ...valid, observed_model_id: null };
    const mismatched = { ...valid, observed_model_id: "observed-revision-b" };
    expect(ModelCompatibilityEntrySchema.safeParse(erased).success).toBe(false);
    expect(ModelCompatibilityEntrySchema.safeParse(mismatched).success).toBe(false);
    expect(() => new ModelCompatibilityRegistry([erased], () => new Date("2026-08-12T00:00:00.000Z"))).toThrow();

    const mixedRuns = valid.runs.map((run, index) => index === 0 ? { ...run, observed_model_id: null } : run);
    expect(ModelCompatibilityEntrySchema.safeParse({ ...valid, runs: mixedRuns, compatible: true }).success).toBe(false);
    const mixedFailClosed = { ...valid, runs: mixedRuns, compatible: false };
    expect(ModelCompatibilityEntrySchema.safeParse(mixedFailClosed).success).toBe(true);
    expect(() => new ModelCompatibilityRegistry([mixedFailClosed], () => new Date("2026-08-12T00:00:00.000Z"))
      .require("braindrive-models", "braindrive-models-default", "interview_assist", { effectiveConfigFingerprint: CONFIG })).toThrow();

    const absentRuns = valid.runs.map((run) => ({ ...run, observed_model_id: null }));
    expect(ModelCompatibilityEntrySchema.safeParse({ ...valid, runs: absentRuns, observed_model_id: null }).success).toBe(true);
  });

  it("keeps compatibility preflight before credential resolution and adapter construction", async () => {
    const resolveCredential = vi.fn(async () => ({
      providerId: "braindrive-models",
      source: "env_ref" as const,
      apiKey: "must-not-resolve",
    }));
    const createAdapter = vi.fn();
    const adapterConfig: AdapterConfig = {
      base_url: "https://unused.invalid/v1",
      model: "legacy",
      api_key_env: "UNUSED_KEY",
      default_provider_profile: "braindrive-models",
      provider_profiles: {
        "braindrive-models": {
          base_url: "https://managed.invalid/v1",
          model: "braindrive-models-default",
          api_key_env: "MANAGED_KEY",
          provider_id: "braindrive-models",
        },
      },
    };
    const preferences: Preferences = {
      default_model: "braindrive-models-default",
      approval_mode: "auto-approve",
      active_provider_profile: "braindrive-models",
    };
    const resolver = createLiveProviderResolver({
      adapterName: "openai-compatible",
      adapterConfig,
      loadPreferences: async () => preferences,
      compatibility: new ModelCompatibilityRegistry([], () => new Date("2026-08-12T00:00:00.000Z")),
      resolveCredential,
      createAdapter,
    });
    await expect(resolver("interview_assist")).rejects.toThrow(/conformance record/);
    expect(resolveCredential).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("fingerprints only safe effective identity fields", () => {
    expect(CONFIG).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(CONFIG).not.toMatch(/https|credential|secret|endpoint|owner/i);
    expect(effectiveInferenceConfigFingerprint({
      adapterName: "openai-compatible", providerProfileId: "openrouter", providerId: "openrouter", modelId: "same-model", baseUrl: "https://one.invalid/v1",
    })).not.toBe(effectiveInferenceConfigFingerprint({
      adapterName: "openai-compatible", providerProfileId: "ollama", providerId: "ollama", modelId: "same-model", baseUrl: "http://localhost:11434/v1",
    }));
    expect(effectiveInferenceConfigFingerprint({
      adapterName: "openai-compatible", providerProfileId: "braindrive-models", providerId: "braindrive-models", modelId: "same-model", baseUrl: "https://one.invalid/v1",
    })).not.toBe(effectiveInferenceConfigFingerprint({
      adapterName: "openai-compatible", providerProfileId: "braindrive-models", providerId: "braindrive-models", modelId: "same-model", baseUrl: "https://two.invalid/v1",
    }));
  });

  it("keeps Ollama, BYOK OpenRouter, and BrainDrive Models independent", () => {
    const registry = new ModelCompatibilityRegistry([
      legacyEntry("ollama", "local-model"),
      legacyEntry("openrouter-byok", "remote-model"),
      legacyEntry("braindrive-models", "managed-model"),
    ]);
    expect(registry.require("ollama", "local-model", "interview_assist").provider_profile_id).toBe("ollama");
    expect(registry.require("openrouter-byok", "remote-model", "interview_assist").provider_profile_id).toBe("openrouter-byok");
    expect(() => registry.require("ollama", "remote-model", "interview_assist")).toThrow();
  });
});
