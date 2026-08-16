import type { z } from "zod";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import {
  ModelCompatibilityEntrySchema,
  PURPOSE_OUTPUT_SCHEMAS,
  type InferencePurpose,
} from "../app-platform/contracts/inference.js";
import type { ModelAdapter } from "../adapters/base.js";
import type { AdapterConfig, Preferences } from "../contracts.js";
import { createModelAdapter, resolveEffectiveAdapterConfig } from "../adapters/index.js";
import { resolveProviderCredentialForStartup } from "../secrets/resolver.js";
import { ResumeInferenceError } from "./errors.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "./policy.js";
import {
  conformanceCorpusDigest,
  conformanceFixtureDigest,
  conformanceFixturesForPurpose,
} from "./conformance-corpus.js";
import registryDocument from "./model-compatibility.json" with { type: "json" };

type CompatibilityEntry = z.infer<typeof ModelCompatibilityEntrySchema>;

export const VERSIONED_MODEL_COMPATIBILITY_ENTRIES: unknown[] = (() => {
  if (![1, 2].includes(registryDocument.registry_version) || !Array.isArray(registryDocument.entries)) {
    throw new Error("Resume Builder model compatibility registry is invalid");
  }
  return registryDocument.entries;
})();

export type CompatibilityState = "legacy_provisional" | "current_v2";
export type CompatibilityResolution = CompatibilityEntry & {
  compatibility_state: CompatibilityState;
  spec_09_release_evidence: boolean;
};

export type ResolvedInferenceProvider = {
  providerProfileId: string;
  providerId: string;
  modelId: string;
  expectedObservedModelId?: string;
  compatibilityState?: CompatibilityState;
  modelClass: "owner_active_compatible";
  adapter: ModelAdapter;
};

/**
 * Binds effective structured-inference behavior without retaining a credential,
 * secret reference, raw endpoint, prompt, or owner content.
 */
export function effectiveInferenceConfigFingerprint(input: {
  adapterName: string;
  providerProfileId: string;
  providerId: string;
  modelId: string;
  baseUrl: string;
}): `sha256:${string}` {
  return canonicalInputDigest({
    fingerprint_version: 1,
    adapter_name: input.adapterName,
    provider_profile_id: input.providerProfileId,
    provider_id: input.providerId,
    model_id: input.modelId,
    base_url: input.baseUrl,
    structured_completion_contract: "strict-json-schema-no-tools-v1",
  });
}

export class ModelCompatibilityRegistry {
  private readonly entries: CompatibilityEntry[];

  constructor(entries: unknown[], private readonly now: () => Date = () => new Date()) {
    this.entries = entries.map((entry) => ModelCompatibilityEntrySchema.parse(entry));
  }

  require(
    providerProfileId: string,
    modelId: string,
    purpose: InferencePurpose,
    options: { effectiveConfigFingerprint?: string; observedModelId?: string } = {},
  ): CompatibilityResolution {
    const candidates = this.entries.filter((candidate) =>
      candidate.provider_profile_id === providerProfileId
      && candidate.model_id === modelId
      && candidate.purpose === purpose
      && candidate.compatible
      && candidate.prompt_policy_id === RESUME_PROMPT_POLICY_ID
      && candidate.prompt_policy_version === RESUME_PROMPT_POLICY_VERSION
      && candidate.output_schema_id === PURPOSE_OUTPUT_SCHEMAS[purpose]
      && (candidate.registry_version === 1 || candidate.fixture_corpus_digest === conformanceCorpusDigest(purpose)));

    const v2 = candidates.find((candidate) => {
      if (candidate.registry_version !== 2) return false;
      if (options.effectiveConfigFingerprint !== candidate.effective_config_fingerprint) return false;
      if (Date.parse(candidate.expires_at) <= this.now().getTime()) return false;
      if (options.observedModelId && candidate.observed_model_id && options.observedModelId !== candidate.observed_model_id) return false;
      const retainedObservedIds = new Set(candidate.runs.flatMap((run) => run.observed_model_id === null ? [] : [run.observed_model_id]));
      const missingObservedIdentity = candidate.runs.some((run) => run.observed_model_id === null);
      if (retainedObservedIds.size > 1 || (retainedObservedIds.size === 1 && missingObservedIdentity)) return false;
      if (retainedObservedIds.size === 0 ? candidate.observed_model_id !== null : !retainedObservedIds.has(candidate.observed_model_id ?? "")) return false;
      const sortedLatencies = candidate.runs.map((run) => run.latency_ms).sort((left, right) => left - right);
      const retainedLatencyP95 = sortedLatencies[Math.max(0, Math.ceil(sortedLatencies.length * 0.95) - 1)]!;
      if (candidate.latency_p95_ms !== retainedLatencyP95) return false;
      const expectedFixtures = conformanceFixturesForPurpose(purpose);
      if (candidate.fixture_count !== expectedFixtures.length || candidate.operation_count !== expectedFixtures.length * candidate.runs_per_fixture) return false;
      const expectedDigests = new Map(expectedFixtures.map((fixture) => [fixture.fixture_id, conformanceFixtureDigest(purpose, fixture.fixture_id)]));
      if (candidate.runs.some((run) => expectedDigests.get(run.fixture_id) !== run.fixture_digest)) return false;
      return candidate.all_required_runs_valid;
    });
    if (v2) {
      return { ...v2, compatibility_state: "current_v2", spec_09_release_evidence: true };
    }

    const legacy = candidates.find((candidate) => candidate.registry_version === 1);
    if (legacy) {
      return { ...legacy, compatibility_state: "legacy_provisional", spec_09_release_evidence: false };
    }
    throw new ResumeInferenceError("model_incompatible", "The active provider model has no accepted Resume Builder conformance record");
  }
}

export function createLiveProviderResolver(input: {
  adapterName: string;
  adapterConfig: AdapterConfig;
  loadPreferences: () => Promise<Preferences>;
  compatibility: ModelCompatibilityRegistry;
  resolveCredential?: typeof resolveProviderCredentialForStartup;
  createAdapter?: typeof createModelAdapter;
}): (purpose: InferencePurpose) => Promise<ResolvedInferenceProvider> {
  return async (purpose) => {
    const preferences = await input.loadPreferences();
    const effective = resolveEffectiveAdapterConfig(input.adapterConfig, preferences);
    const profileId = preferences.active_provider_profile?.trim() || input.adapterConfig.default_provider_profile?.trim();
    if (!profileId) throw new ResumeInferenceError("provider_unavailable", "No active provider profile is selected");
    const providerId = effective.provider_id ?? profileId;
    const configFingerprint = effectiveInferenceConfigFingerprint({
      adapterName: input.adapterName,
      providerProfileId: profileId,
      providerId,
      modelId: effective.model,
      baseUrl: effective.base_url,
    });
    // Compatibility is deliberately resolved before credential access or adapter
    // construction, so incompatible requests cannot transmit owner data.
    const compatibility = input.compatibility.require(profileId, effective.model, purpose, {
      effectiveConfigFingerprint: configFingerprint,
    });
    const credential = await (input.resolveCredential ?? resolveProviderCredentialForStartup)(input.adapterName, effective, preferences);
    const adapter = (input.createAdapter ?? createModelAdapter)(input.adapterName, input.adapterConfig, preferences, { apiKey: credential?.apiKey });
    if (!adapter.completeStructuredNoTools) throw new ResumeInferenceError("model_incompatible", "The active provider adapter does not support structured no-tools requests");
    return {
      providerProfileId: profileId,
      providerId,
      modelId: effective.model,
      ...(compatibility.registry_version === 2 && compatibility.observed_model_id
        ? { expectedObservedModelId: compatibility.observed_model_id }
        : {}),
      modelClass: "owner_active_compatible",
      compatibilityState: compatibility.compatibility_state,
      adapter,
    };
  };
}
