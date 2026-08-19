import { randomUUID } from "node:crypto";

import {
  InferencePurposeSchema,
  InferenceRequestSchema,
  ModelCompatibilityEntryV2Schema,
  ModelCompatibilityRunSchema,
  PURPOSE_LIMITS,
  PURPOSE_OUTPUT_SCHEMAS,
  type InferencePurpose,
} from "../app-platform/contracts/inference.js";
import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import type { ModelAdapter } from "../adapters/base.js";
import { ResumeInferenceBroker } from "./broker.js";
import { ResumeInferenceError } from "./errors.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "./policy.js";
import {
  conformanceBlocks,
  conformanceCorpusDigest,
  conformanceFixtureDigest,
  conformanceFixturesForPurpose,
  type ResumeConformanceFixture,
} from "./conformance-corpus.js";

export const RESUME_CONFORMANCE_PURPOSES = InferencePurposeSchema.options;
export const RESUME_CONFORMANCE_RUNS_PER_FIXTURE = 3 as const;

type EvidenceClass = "authorized_live_provider" | "credential_free_synthetic";
type ConformanceRun = ReturnType<typeof ModelCompatibilityRunSchema.parse>;

export async function runResumeModelConformance(input: {
  adapter: ModelAdapter;
  providerProfileId: string;
  modelId: string;
  effectiveConfigFingerprint: `sha256:${string}`;
  testedAt?: Date;
  purposes?: InferencePurpose[];
  evidenceClass?: EvidenceClass;
  fixtures?: ResumeConformanceFixture[];
  onDiagnostic?: (diagnostic: {
    purpose: InferencePurpose;
    fixtureId: string;
    operationId: string;
    schemaSuccess: boolean;
    evidenceSuccess: boolean;
    finalDisposition: "completed" | "failed" | "cancelled";
    errorCode: string | null;
  }) => void;
}) {
  if (!input.adapter.completeStructuredNoTools) throw new Error("Adapter lacks structured no-tools completion");
  const testedAtDate = input.testedAt ?? new Date();
  const testedAt = testedAtDate.toISOString();
  const expiresAt = new Date(testedAtDate.getTime() + 90 * 24 * 60 * 60 * 1_000).toISOString();
  const entries: Array<ReturnType<typeof ModelCompatibilityEntryV2Schema.parse>> = [];
  for (const purpose of input.purposes ?? RESUME_CONFORMANCE_PURPOSES) {
    const authorizedFixtures = conformanceFixturesForPurpose(purpose);
    const fixtures = input.fixtures ?? authorizedFixtures;
    if (fixtures.some((fixture) => !authorizedFixtures.some((candidate) => candidate.fixture_id === fixture.fixture_id))) {
      throw new Error("Conformance fixture is not authorized for the selected purpose");
    }
    const runs: ConformanceRun[] = [];
    for (const fixture of fixtures) {
      for (let runIndex = 0; runIndex < RESUME_CONFORMANCE_RUNS_PER_FIXTURE; runIndex += 1) {
        runs.push(await runFixtureOperation(input.adapter, input.providerProfileId, input.modelId, purpose, fixture));
        const run = runs.at(-1)!;
        input.onDiagnostic?.({
          purpose,
          fixtureId: run.fixture_id,
          operationId: run.operation_id,
          schemaSuccess: run.schema_valid,
          evidenceSuccess: run.evidence_valid,
          finalDisposition: run.final_disposition,
          errorCode: run.error_code,
        });
      }
    }
    const outcomes = tallyOutcomes(runs);
    const observedIds = new Set(runs.flatMap((run) => run.observed_model_id === null ? [] : [run.observed_model_id]));
    const observedIdentityConsistent = observedIds.size === 0
      || (observedIds.size === 1 && runs.every((run) => run.observed_model_id !== null));
    const allRequiredRunsValid = runs.every((run) => run.final_disposition === "completed" && run.schema_valid && run.evidence_valid);
    const evidenceClass = purpose === "resume_craft_evaluate"
      ? "host_owned_zero_call" as const
      : input.evidenceClass ?? "credential_free_synthetic";
    const evidenceClassValid = purpose === "resume_craft_evaluate"
      ? outcomes.zero_provider_call === runs.length && outcomes.host_owned_success === runs.length
      : evidenceClass === "authorized_live_provider";
    const latencyP95Ms = percentile95(runs.map((run) => run.latency_ms));
    const compatible = allRequiredRunsValid
      && evidenceClassValid
      && observedIdentityConsistent
      && latencyP95Ms <= PURPOSE_LIMITS[purpose].duration_ms;
    entries.push(ModelCompatibilityEntryV2Schema.parse({
      registry_version: 2,
      provider_profile_id: input.providerProfileId,
      model_id: input.modelId,
      observed_model_id: observedIds.size === 1 ? [...observedIds][0] : null,
      effective_config_fingerprint: input.effectiveConfigFingerprint,
      purpose,
      output_schema_id: PURPOSE_OUTPUT_SCHEMAS[purpose],
      output_schema_version: 1,
      prompt_policy_id: RESUME_PROMPT_POLICY_ID,
      prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
      fixture_corpus_digest: conformanceCorpusDigest(purpose),
      fixture_count: fixtures.length,
      runs_per_fixture: RESUME_CONFORMANCE_RUNS_PER_FIXTURE,
      operation_count: runs.length,
      evidence_class: evidenceClass,
      outcomes,
      all_required_runs_valid: allRequiredRunsValid,
      compatible,
      zero_unsupported_claim_gate: runs.every((run) => run.evidence_valid),
      latency_p95_ms: latencyP95Ms,
      tested_at: testedAt,
      expires_at: expiresAt,
      runs,
    }));
  }
  const report = { registry_version: 2 as const, entries };
  assertSafeConformanceReport(report);
  return report;
}

async function runFixtureOperation(
  adapter: ModelAdapter,
  providerProfileId: string,
  modelId: string,
  purpose: InferencePurpose,
  fixture: ResumeConformanceFixture,
): Promise<ConformanceRun> {
  const operationId = randomUUID();
  const observedIds = new Set<string>();
  let providerCallCount = 0;
  const guardedAdapter: ModelAdapter = {
    async complete() { throw new Error("Conformance cannot enter the agent-loop completion path"); },
    async completeStructuredNoTools(request) {
      providerCallCount += 1;
      const response = await adapter.completeStructuredNoTools!(request);
      if (response.modelId) {
        observedIds.add(response.modelId);
        if (observedIds.size > 1) {
          throw new ResumeInferenceError("model_incompatible", "The provider model identity changed during one logical operation");
        }
      }
      return response;
    },
  };
  const broker = new ResumeInferenceBroker(async () => ({
    providerProfileId,
    providerId: providerProfileId,
    modelId,
    modelClass: "owner_active_compatible",
    adapter: guardedAdapter,
  }));
  const startedAt = Date.now();
  const completion = await broker.execute(conformanceRequest(purpose, fixture.fixture_id, operationId));
  const latencyMs = Math.max(0, Date.now() - startedAt);
  const outcome = completion.inference.outcome;
  if (!outcome) throw new Error("Conformance broker omitted required outcome metadata");
  const schemaValid = completion.inference.status === "completed" || completion.validation !== null;
  const evidenceValid = completion.validation?.accepted ?? false;
  return ModelCompatibilityRunSchema.parse({
    fixture_id: fixture.fixture_id,
    fixture_digest: conformanceFixtureDigest(purpose, fixture.fixture_id),
    operation_id: operationId,
    attempt_count: completion.inference.attempt_count,
    provider_call_count: providerCallCount,
    observed_model_id: observedIds.size === 1 ? [...observedIds][0] : null,
    finish_category: outcome.finish_category,
    recovery_class: outcome.recovery_class,
    completion_mode: outcome.completion_mode,
    final_disposition: outcome.final_disposition,
    error_code: completion.inference.error?.code ?? null,
    schema_valid: schemaValid,
    evidence_valid: evidenceValid,
    provider_success: outcome.final_disposition === "completed" && ["primary", "provider_repair"].includes(outcome.completion_mode),
    latency_ms: latencyMs,
  });
}

function conformanceRequest(purpose: InferencePurpose, fixtureId: string, operationId: string) {
  const blocks = conformanceBlocks(purpose, fixtureId);
  const factBlock = blocks.find((block) => block.category === "confirmed_fact_snapshot");
  const facts = (factBlock?.data as { facts?: Array<{ revision_id?: unknown }> } | undefined)?.facts ?? [];
  const recordRevisionIds = new Set<string>();
  for (const fact of facts) if (typeof fact.revision_id === "string") recordRevisionIds.add(fact.revision_id);
  for (const block of blocks) {
    const revisionId = (block.data as { metadata?: { revision_id?: unknown } } | null)?.metadata?.revision_id;
    if (typeof revisionId === "string") recordRevisionIds.add(revisionId);
  }
  const now = new Date();
  return InferenceRequestSchema.parse({
    inference_schema_version: 1,
    request_id: randomUUID(),
    owner_id: randomUUID(),
    actor_id: randomUUID(),
    app_id: "ai.braindrive.resume-builder",
    installation_id: randomUUID(),
    operation_id: operationId,
    grant_id: randomUUID(),
    purpose,
    input_snapshot: {
      fact_snapshot_revision: 1,
      fact_snapshot_digest: canonicalInputDigest(facts),
      record_revision_ids: [...recordRevisionIds],
    },
    data_blocks: blocks,
    prompt_policy_id: RESUME_PROMPT_POLICY_ID,
    prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
    output_schema_id: PURPOSE_OUTPUT_SCHEMAS[purpose],
    output_schema_version: 1,
    capability_requirements: {
      text_generation: true,
      complete_structured_json: true,
      minimum_context_tokens: PURPOSE_LIMITS[purpose].input_tokens,
      model_tools: false,
    },
    limits: PURPOSE_LIMITS[purpose],
    requested_at: now.toISOString(),
    deadline_at: new Date(now.getTime() + PURPOSE_LIMITS[purpose].duration_ms).toISOString(),
  });
}

function tallyOutcomes(runs: ConformanceRun[]) {
  return {
    primary_success: runs.filter((run) => run.completion_mode === "primary").length,
    structural_repair_success: runs.filter((run) => run.completion_mode === "provider_repair" && run.recovery_class === "provider_structural_repair").length,
    validation_repair_success: runs.filter((run) => run.completion_mode === "provider_repair" && run.recovery_class === "provider_validation_repair").length,
    deterministic_fallback_success: runs.filter((run) => run.completion_mode === "deterministic_fallback").length,
    host_owned_success: runs.filter((run) => run.completion_mode === "host_owned").length,
    safe_failure: runs.filter((run) => run.final_disposition !== "completed").length,
    schema_valid: runs.filter((run) => run.schema_valid).length,
    evidence_valid: runs.filter((run) => run.evidence_valid).length,
    provider_success: runs.filter((run) => run.provider_success).length,
    zero_provider_call: runs.filter((run) => run.provider_call_count === 0).length,
  };
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

export function serializeConformanceReport(report: unknown): string {
  const parsed = zConformanceReport(report);
  assertSafeConformanceReport(parsed);
  return JSON.stringify(parsed, null, 2);
}

function zConformanceReport(report: unknown): { registry_version: 2; entries: Array<ReturnType<typeof ModelCompatibilityEntryV2Schema.parse>> } {
  if (!report || typeof report !== "object" || (report as { registry_version?: unknown }).registry_version !== 2 || !Array.isArray((report as { entries?: unknown }).entries)) {
    throw new Error("Resume conformance report is invalid");
  }
  return {
    registry_version: 2,
    entries: (report as { entries: unknown[] }).entries.map((entry) => ModelCompatibilityEntryV2Schema.parse(entry)),
  };
}

function assertSafeConformanceReport(report: unknown): void {
  const serialized = JSON.stringify(report);
  if (/https?:\/\/|authorization|"credential(?:_value|_ref)?"\s*:|secret_ref|private[_-]?path|provider[_-]?(?:body|error)|raw[_-]?(?:output|response)|"prompt"\s*:|prompt_text|resume_text|job_description_text|owner_text/i.test(serialized)) {
    throw new Error("Resume conformance report contains prohibited diagnostic content");
  }
}
