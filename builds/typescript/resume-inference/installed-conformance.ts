import { randomUUID } from "node:crypto";

import { InstalledAppInferenceExecutor } from "../app-inference/installed-program.js";
import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { RESUME_BUILDER_APP_ID } from "../app-platform/contracts/constants.js";
import {
  InferencePurposeSchema,
  ModelCompatibilityEntryV2Schema,
  ModelCompatibilityRunSchema,
  PURPOSE_OUTPUT_SCHEMAS,
  type InferencePurpose,
} from "../app-platform/contracts/inference.js";
import type { ModelAdapter } from "../adapters/base.js";
import {
  conformanceBlocks,
  conformanceCorpusDigest,
  conformanceFixtureDigest,
  conformanceFixturesForPurpose,
  type ResumeConformanceFixture,
} from "./conformance-corpus.js";
import { runResumeModelConformance } from "./conformance.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "./policy.js";

type ConformanceRun = ReturnType<typeof ModelCompatibilityRunSchema.parse>;
type Program = { id: string; version: number };
type PreviousAttempt = { candidate: unknown; issue_ids: string[] } | null;
type InstalledProgramModule = {
  RESUME_INFERENCE_PROGRAMS: Record<string, Program>;
  prepareResumeInference(input: { program: Program; input: unknown; attempt: number; previous: PreviousAttempt }): unknown;
  adjudicateResumeInference(input: { program: Program; input: unknown; attempt: number; candidate: unknown }): unknown;
};

// The app package is JavaScript by design; its runtime program contract is
// validated by the installed executor and the package's own tests.
// @ts-expect-error The package does not ship TypeScript declarations.
const ACTIVE_PROGRAM_MODULE = await import("../../resume_builder/resources/inference-program.js") as unknown as InstalledProgramModule;

/**
 * Runs the active installed-app inference programs. The older conformance
 * harness remains available for historical/offline broker evidence, but it
 * must not be used as the live product compatibility gate.
 */
export async function runInstalledResumeModelConformance(input: {
  adapter: ModelAdapter;
  providerProfileId: string;
  modelId: string;
  effectiveConfigFingerprint: `sha256:${string}`;
  testedAt?: Date;
  purposes?: InferencePurpose[];
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

  for (const purpose of input.purposes ?? InferencePurposeSchema.options) {
    // Craft evaluation is an app-owned zero-call operation in the accepted
    // compatibility contract; retain that authority while other purposes use
    // the active installed-program path below.
    if (purpose === "resume_craft_evaluate") {
      const hostOwned = await runResumeModelConformance({
        adapter: input.adapter,
        providerProfileId: input.providerProfileId,
        modelId: input.modelId,
        effectiveConfigFingerprint: input.effectiveConfigFingerprint,
        testedAt: testedAtDate,
        purposes: [purpose],
        evidenceClass: "authorized_live_provider",
        onDiagnostic: input.onDiagnostic,
      });
      entries.push(...hostOwned.entries);
      continue;
    }
    const authorizedFixtures = conformanceFixturesForPurpose(purpose);
    const runs: ConformanceRun[] = [];
    for (const fixture of authorizedFixtures) {
      for (let runIndex = 0; runIndex < 3; runIndex += 1) {
        const run = await runInstalledFixtureOperation(input.adapter, input.providerProfileId, input.modelId, purpose, fixture);
        runs.push(run);
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
    const latencyP95Ms = percentile95(runs.map((run) => run.latency_ms));
    const compatible = allRequiredRunsValid
      && observedIdentityConsistent
      && latencyP95Ms <= limitsFor(purpose).duration_ms;
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
      fixture_count: authorizedFixtures.length,
      runs_per_fixture: 3,
      operation_count: runs.length,
      evidence_class: "authorized_live_provider",
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

  return { registry_version: 2 as const, entries };
}

async function runInstalledFixtureOperation(
  adapter: ModelAdapter,
  providerProfileId: string,
  modelId: string,
  purpose: InferencePurpose,
  fixture: ResumeConformanceFixture,
): Promise<ConformanceRun> {
  const operationId = randomUUID();
  const program = ACTIVE_PROGRAM_MODULE.RESUME_INFERENCE_PROGRAMS[purpose];
  if (!program) throw new Error(`Missing installed Resume program for ${purpose}`);
  const request = conformanceRequest(purpose, fixture.fixture_id, operationId);
  const activeInput = activeProgramInput(purpose, request);
  let providerCallCount = 0;
  let observedModelId: string | null = null;
  const provider = {
    providerProfileId,
    modelId,
    adapter: {
      completeStructuredNoTools: async (completionRequest: Parameters<NonNullable<ModelAdapter["completeStructuredNoTools"]>>[0]) => {
        providerCallCount += 1;
        const response = await adapter.completeStructuredNoTools!(completionRequest);
        if (response.modelId) {
          observedModelId ??= response.modelId;
          if (observedModelId !== response.modelId) throw new Error("model_identity_changed");
        }
        return response;
      },
    },
  };
  const executor = new InstalledAppInferenceExecutor({ resolveProvider: async () => provider });
  const startedAt = Date.now();
  try {
    const completion = await executor.execute({
      inference_contract_version: 2,
      operation_id: operationId,
      program: { id: program.id, version: program.version },
      input: activeInput,
    }, {
      appId: RESUME_BUILDER_APP_ID,
      installationId: randomUUID(),
      packageDigest: canonicalInputDigest({ package: "resume-builder", program }),
      programClient: {
        prepare: async ({ program: requestedProgram, input, attempt, previous }) => ACTIVE_PROGRAM_MODULE.prepareResumeInference({ program: requestedProgram, input, attempt, previous }),
        adjudicate: async ({ program: requestedProgram, input, attempt, candidate }) => ACTIVE_PROGRAM_MODULE.adjudicateResumeInference({ program: requestedProgram, input, attempt, candidate }),
      },
    }) as { attempt_count: number; completion_mode: "provider" | "deterministic_fallback" };
    const attemptCount = completion.attempt_count;
    const repaired = attemptCount > 1;
    const completionMode = completion.completion_mode === "provider"
      ? repaired ? "provider_repair" : "primary"
      : "deterministic_fallback";
    const recoveryClass = completion.completion_mode === "provider"
      ? repaired ? "provider_structural_repair" : "none"
      : "deterministic_fallback";
    return ModelCompatibilityRunSchema.parse({
      fixture_id: fixture.fixture_id,
      fixture_digest: conformanceFixtureDigest(purpose, fixture.fixture_id),
      operation_id: operationId,
      attempt_count: attemptCount,
      provider_call_count: providerCallCount,
      observed_model_id: observedModelId,
      finish_category: "stop",
      recovery_class: recoveryClass,
      completion_mode: completionMode,
      final_disposition: "completed",
      error_code: null,
      schema_valid: true,
      evidence_valid: true,
      provider_success: completion.completion_mode === "provider",
      latency_ms: Math.max(0, Date.now() - startedAt),
    });
  } catch (error) {
    const errorCode = error instanceof Error && error.message === "model_identity_changed" ? "model_incompatible" : "internal_failure";
    if (process.env.BRAINDRIVE_RESUME_CONFORMANCE_DIAGNOSTICS === "1") {
      process.stderr.write(`${JSON.stringify({
        installed_execution: {
          purpose,
          fixture_id: fixture.fixture_id,
          provider_calls: providerCallCount,
          safe_error_class: classifyInstalledExecutionError(error),
          ...(safeLocalProgramError(error) ? { local_program_error: safeLocalProgramError(error) } : {}),
          ...(safeAppIssueIds(error) ? { app_issue_ids: safeAppIssueIds(error) } : {}),
        },
      })}\n`);
    }
    return ModelCompatibilityRunSchema.parse({
      fixture_id: fixture.fixture_id,
      fixture_digest: conformanceFixtureDigest(purpose, fixture.fixture_id),
      operation_id: operationId,
      attempt_count: providerCallCount,
      provider_call_count: providerCallCount,
      observed_model_id: observedModelId,
      finish_category: "unknown",
      recovery_class: "none",
      completion_mode: "none",
      final_disposition: "failed",
      error_code: errorCode,
      schema_valid: false,
      evidence_valid: false,
      provider_success: false,
      latency_ms: Math.max(0, Date.now() - startedAt),
    });
  }
}

function classifyInstalledExecutionError(error: unknown): string {
  if (error instanceof Error && /^[a-z][a-z0-9_-]{2,63}$/.test(error.message)) return error.message;
  return "provider_failure_or_unexpected_execution_error";
}

function safeAppIssueIds(error: unknown): string[] | null {
  if (!error || typeof error !== "object") return null;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const issueIds = (details as { appIssueIds?: unknown }).appIssueIds;
  return Array.isArray(issueIds) && issueIds.every((value) => typeof value === "string") ? issueIds.slice(0, 20) : null;
}

function safeLocalProgramError(error: unknown): string | null {
  if (!(error instanceof Error) || /provider|http|code=/i.test(error.message)) return null;
  return error.message.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 96) || error.name;
}

function conformanceRequest(purpose: InferencePurpose, fixtureId: string, operationId: string) {
  const blocks = conformanceBlocks(purpose, fixtureId);
  const facts = (blocks.find((block) => block.category === "confirmed_fact_snapshot")?.data as { facts?: Array<{ revision_id?: unknown }> } | undefined)?.facts ?? [];
  const recordRevisionIds = new Set<string>();
  for (const fact of facts) if (typeof fact.revision_id === "string") recordRevisionIds.add(fact.revision_id);
  for (const block of blocks) {
    const revisionId = (block.data as { metadata?: { revision_id?: unknown } } | null)?.metadata?.revision_id;
    if (typeof revisionId === "string") recordRevisionIds.add(revisionId);
  }
  return {
    inference_schema_version: 1,
    request_id: randomUUID(),
    owner_id: randomUUID(),
    actor_id: randomUUID(),
    app_id: RESUME_BUILDER_APP_ID,
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
  };
}

function activeProgramInput(purpose: InferencePurpose, request: ReturnType<typeof conformanceRequest>): unknown {
  if (purpose !== "general_resume_draft") return request;
  const factsBlock = request.data_blocks.find((block) => block.category === "confirmed_fact_snapshot");
  const strategyBlock = request.data_blocks.find((block) => block.category === "resume_strategy");
  const facts = Array.isArray((factsBlock?.data as { facts?: unknown[] } | undefined)?.facts)
    ? ((factsBlock!.data as { facts: Array<Record<string, unknown>> }).facts).map((fact) => ({
      ...fact,
      revision_id: String(fact.revision_id),
      state: "confirmed" as const,
      source_revision_ids: Array.isArray(fact.source_revision_ids) ? fact.source_revision_ids : [fact.revision_id],
      value: fact.fact_kind === "job_evidence"
        ? JSON.stringify({ value_version: 1, association: "job", job_fact_revision_id: fact.job_fact_revision_id, dimension: fact.dimension, outcome: "answered", owner_text: fact.value })
        : fact.value,
    }))
    : [];
  const strategy = (strategyBlock?.data ?? {}) as Record<string, unknown>;
  const factRevisionIds = facts.map((fact) => fact.revision_id);
  return {
    facts,
    strategy: {
      title: "General Resume",
      fact_revision_ids: factRevisionIds,
      section_order: Array.isArray(strategy.section_order) ? strategy.section_order : ["contact", "summary", "experience"],
      evidence_priorities: Array.isArray(strategy.evidence_priorities) ? strategy.evidence_priorities : [],
      summary_decision: strategy.summary_decision === "omit" ? "omit" : "include",
      omissions: Array.isArray(strategy.omissions) ? strategy.omissions : [],
    },
    presentation_preferences: {},
    persistence_input_digest: canonicalInputDigest({ purpose, fact_revision_ids: factRevisionIds, strategy_revision_id: (strategy.metadata as { revision_id?: unknown } | undefined)?.revision_id ?? null }),
  };
}

function limitsFor(purpose: InferencePurpose) {
  return {
    interview_assist: { duration_ms: 60_000 }, general_resume_draft: { duration_ms: 120_000 }, job_description_analyze: { duration_ms: 90_000 },
    requirement_evidence_match: { duration_ms: 120_000 }, tailoring_plan: { duration_ms: 90_000 }, targeted_resume_draft: { duration_ms: 120_000 },
    resume_revision_classify: { duration_ms: 60_000 }, resume_revision_draft: { duration_ms: 120_000 }, resume_guidance: { duration_ms: 90_000 },
    resume_strategy: { duration_ms: 90_000 }, resume_craft_evaluate: { duration_ms: 120_000 }, resume_craft_repair: { duration_ms: 120_000 },
  }[purpose];
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
