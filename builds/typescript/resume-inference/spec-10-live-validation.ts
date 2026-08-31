import { randomUUID } from "node:crypto";

import type { z } from "zod";

import type { ModelAdapter, StructuredCompletionResponse } from "../adapters/base.js";
import {
  InferenceAttemptAuditDetailsSchema,
  InferenceTerminalAuditDetailsSchema,
  assertContentFreeInferenceAttemptAudit,
  assertContentFreeInferenceTerminalAudit,
} from "../app-platform/contracts/audit.js";
import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import {
  InferenceDataBlockSchema,
  InferenceRequestSchema,
  PURPOSE_LIMITS,
  PURPOSE_OUTPUT_SCHEMAS,
} from "../app-platform/contracts/inference.js";
import { ResumeInferenceBroker } from "./broker.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "./policy.js";
import {
  SPEC_10_DENSE_CORPUS,
  SPEC_10_DENSE_CORPUS_DIGEST,
  SPEC_10_HOLDOUT_CORPUS,
  SPEC_10_HOLDOUT_CORPUS_DIGEST,
  evaluateSpec10FixtureEligibility,
  fixtureIdentity,
  type Spec10SyntheticFixture,
} from "./spec-10-acceptance-fixture.js";

type DataBlock = z.infer<typeof InferenceDataBlockSchema>;
type Request = z.infer<typeof InferenceRequestSchema>;
type AttemptAuditDetails = z.infer<typeof InferenceAttemptAuditDetailsSchema>;
type TerminalAuditDetails = z.infer<typeof InferenceTerminalAuditDetailsSchema>;
type SafeAttemptDiagnostic = Pick<AttemptAuditDetails, "attempt" | "stage" | "finish_category" | "attempt_outcome" | "duration_class" | "structural_failure_class" | "schema_issue_ids" | "validator_rule_ids">;
type SafeTerminalDiagnostic = Pick<TerminalAuditDetails,
  | "attempt_count"
  | "stage"
  | "finish_category"
  | "error_code"
  | "retryable"
  | "recovery_class"
  | "completion_mode"
  | "final_disposition"
  | "usage_available"
  | "validator_codes"
  | "provider_validator_codes"
  | "provider_validator_rule_ids"
  | "local_candidate_classes"
  | "targeted_fact_repair_validator_codes"
  | "targeted_fact_repair_validator_rule_ids"
  | "targeted_fact_repair_disposition"
  | "full_general_constructor_validator_codes"
  | "full_general_constructor_validator_rule_ids"
  | "full_general_constructor_disposition"
  | "original_failure_code"
  | "recovery_disposition"
  | "repair"
>;

export const SPEC_10_LIVE_PROVIDER_PROFILE = "braindrive-models" as const;
export const SPEC_10_LIVE_MODEL = "braindrive-models-default" as const;
export const SPEC_10_LIVE_MAX_CALLS = 4 as const;
export const SPEC_10_LIVE_MAX_USD = 0.5 as const;

type FixtureName = "dense" | "holdout";
type Balance = { remainingUsd: number; totalSpentUsd: number };
type StopReason =
  | "authentication_failed"
  | "authorization_failed"
  | "quota_exceeded"
  | "rate_limited"
  | "model_mismatch"
  | "call_ceiling_reached"
  | "spend_ceiling_reached"
  | "spend_ceiling_exceeded"
  | "balance_unavailable";

const OWNER_ID = "83000000-0000-4000-8000-000000000001";
const INSTALLATION_ID = "83000000-0000-4000-8000-000000000002";
const FIXED_TIME = "2026-08-15T12:00:00.000Z";
const SAFE_DIGEST = `sha256:${"a".repeat(64)}` as const;

export type Spec10LiveValidationReport = {
  evidence_contract_version: 1;
  diagnostic_contract_version: 1;
  status: "passed" | "recovered" | "failed" | "stopped";
  provider_profile_id: typeof SPEC_10_LIVE_PROVIDER_PROFILE;
  model_id: typeof SPEC_10_LIVE_MODEL;
  authorized_call_ceiling: typeof SPEC_10_LIVE_MAX_CALLS;
  authorized_spend_ceiling_usd: typeof SPEC_10_LIVE_MAX_USD;
  provider_call_count: number;
  observed_spend_delta_usd: number;
  spend_disposition: "under_authorized_ceiling" | "at_authorized_ceiling" | "over_authorized_ceiling";
  stop_reason: StopReason | null;
  diagnostics_complete: boolean;
  provider_compatibility_passed: boolean;
  host_recovery_passed: boolean;
  fixtures: Array<{
    fixture_id: string;
    fixture_digest: string;
    provider_call_count: number;
    final_disposition: string;
    completion_mode: string;
    schema_valid: boolean;
    evidence_valid: boolean;
    statement_count: number;
    diagnostics_complete: boolean;
    attempt_diagnostics: SafeAttemptDiagnostic[];
    terminal_diagnostic: SafeTerminalDiagnostic | null;
  }>;
  owner_content_retained: false;
  credentials_tokens_endpoints_private_paths_retained: false;
};

export function buildSpec10LiveRequest(name: FixtureName): Request {
  const fixture = name === "dense" ? SPEC_10_DENSE_CORPUS : SPEC_10_HOLDOUT_CORPUS;
  const eligibility = evaluateSpec10FixtureEligibility(fixture);
  if (!eligibility.eligible) throw new Error(`Spec 10 live fixture is ineligible: ${eligibility.reasons.join(",")}`);
  const dataBlocks = runtimeBlocks(fixture);
  const facts = (dataBlocks[0]!.data as { facts: Array<{ revision_id: string }> }).facts;
  const requestedAt = new Date();
  return InferenceRequestSchema.parse({
    inference_schema_version: 1,
    request_id: randomUUID(),
    owner_id: OWNER_ID,
    actor_id: OWNER_ID,
    app_id: "ai.braindrive.resume-builder",
    installation_id: INSTALLATION_ID,
    operation_id: randomUUID(),
    grant_id: randomUUID(),
    purpose: "general_resume_draft",
    input_snapshot: {
      fact_snapshot_revision: 1,
      fact_snapshot_digest: canonicalInputDigest(facts),
      record_revision_ids: [...facts.map((fact) => fact.revision_id), fixture.strategy!.revision_id],
    },
    data_blocks: dataBlocks,
    prompt_policy_id: RESUME_PROMPT_POLICY_ID,
    prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
    output_schema_id: PURPOSE_OUTPUT_SCHEMAS.general_resume_draft,
    output_schema_version: 1,
    capability_requirements: {
      text_generation: true,
      complete_structured_json: true,
      minimum_context_tokens: PURPOSE_LIMITS.general_resume_draft.input_tokens,
      model_tools: false,
    },
    limits: PURPOSE_LIMITS.general_resume_draft,
    requested_at: requestedAt.toISOString(),
    deadline_at: new Date(requestedAt.getTime() + PURPOSE_LIMITS.general_resume_draft.duration_ms).toISOString(),
  });
}

export async function runSpec10BoundedLiveValidation(input: {
  adapter: ModelAdapter;
  providerProfileId: string;
  modelId: string;
  readBalance: () => Promise<Balance>;
}): Promise<Spec10LiveValidationReport> {
  if (input.providerProfileId !== SPEC_10_LIVE_PROVIDER_PROFILE || input.modelId !== SPEC_10_LIVE_MODEL) {
    throw new Error("Spec 10 live provider authority mismatch");
  }
  if (!input.adapter.completeStructuredNoTools) throw new Error("Spec 10 live adapter lacks structured no-tools completion");
  const expectedDigests = [SPEC_10_DENSE_CORPUS_DIGEST, SPEC_10_HOLDOUT_CORPUS_DIGEST];
  const observedDigests = [fixtureIdentity(SPEC_10_DENSE_CORPUS).fixture_digest, fixtureIdentity(SPEC_10_HOLDOUT_CORPUS).fixture_digest];
  if (JSON.stringify(expectedDigests) !== JSON.stringify(observedDigests)) throw new Error("Spec 10 live fixture identity drift");

  const initialBalance = await validatedBalance(input.readBalance);
  if (initialBalance.remainingUsd <= 0) throw new Error("Spec 10 live balance is unavailable");
  let providerCallCount = 0;
  let providerReportedCost = 0;
  let observedSpendDelta = 0;
  let stopReason: StopReason | null = null;

  const refreshSpend = async (): Promise<number> => {
    let current: Balance;
    try {
      current = await validatedBalance(input.readBalance);
    } catch {
      stopReason = "balance_unavailable";
      return observedSpendDelta;
    }
    observedSpendDelta = Math.max(
      observedSpendDelta,
      providerReportedCost,
      Math.max(0, current.totalSpentUsd - initialBalance.totalSpentUsd),
      Math.max(0, initialBalance.remainingUsd - current.remainingUsd),
    );
    if (observedSpendDelta > SPEC_10_LIVE_MAX_USD) stopReason = "spend_ceiling_exceeded";
    else if (observedSpendDelta >= SPEC_10_LIVE_MAX_USD) stopReason = "spend_ceiling_reached";
    return observedSpendDelta;
  };

  const guardedAdapter: ModelAdapter = {
    async complete() { throw new Error("Spec 10 live general completion path is prohibited"); },
    async completeStructuredNoTools(request): Promise<StructuredCompletionResponse> {
      await refreshSpend();
      if (stopReason) throw new Error(`Spec 10 live stopped: ${stopReason}`);
      if (providerCallCount >= SPEC_10_LIVE_MAX_CALLS) {
        stopReason = "call_ceiling_reached";
        throw new Error("Spec 10 live call ceiling reached");
      }
      providerCallCount += 1;
      let response: StructuredCompletionResponse;
      try {
        response = await input.adapter.completeStructuredNoTools!(request);
      } catch (error) {
        stopReason = classifyProviderStop(error) ?? stopReason;
        throw error;
      }
      if (response.modelId && response.modelId !== SPEC_10_LIVE_MODEL) {
        stopReason = "model_mismatch";
        throw new Error("Spec 10 live observed model mismatch");
      }
      if (response.cost?.status === "provider_reported" && response.cost.currency === "USD" && typeof response.cost.amount === "number") {
        providerReportedCost += Math.max(0, response.cost.amount);
      }
      await refreshSpend();
      return response;
    },
  };

  const fixtures: Spec10LiveValidationReport["fixtures"] = [];
  for (const name of ["dense", "holdout"] as const) {
    if (stopReason) break;
    const fixture = name === "dense" ? SPEC_10_DENSE_CORPUS : SPEC_10_HOLDOUT_CORPUS;
    const callsBefore = providerCallCount;
    const attemptDiagnostics: SafeAttemptDiagnostic[] = [];
    let terminalDiagnostic: SafeTerminalDiagnostic | null = null;
    const captureDiagnostic = (event: string, details: Record<string, unknown>): void => {
      if (event === "app.inference.attempt") {
        assertContentFreeInferenceAttemptAudit(details);
        const parsed = InferenceAttemptAuditDetailsSchema.parse(details);
        attemptDiagnostics.push({
          attempt: parsed.attempt,
          stage: parsed.stage,
          finish_category: parsed.finish_category,
          attempt_outcome: parsed.attempt_outcome,
          ...(parsed.duration_class !== undefined ? { duration_class: parsed.duration_class } : {}),
          ...(parsed.structural_failure_class !== undefined ? { structural_failure_class: parsed.structural_failure_class } : {}),
          ...(parsed.schema_issue_ids !== undefined ? { schema_issue_ids: [...parsed.schema_issue_ids] } : {}),
          ...(parsed.validator_rule_ids !== undefined ? { validator_rule_ids: [...parsed.validator_rule_ids] } : {}),
        });
      } else if (event === "app.inference.completed") {
        assertContentFreeInferenceTerminalAudit(details);
        terminalDiagnostic = projectTerminalDiagnostic(InferenceTerminalAuditDetailsSchema.parse(details));
      }
    };
    try {
      const completion = await new ResumeInferenceBroker(async () => ({
        adapter: guardedAdapter,
        providerProfileId: SPEC_10_LIVE_PROVIDER_PROFILE,
        providerId: SPEC_10_LIVE_PROVIDER_PROFILE,
        modelId: SPEC_10_LIVE_MODEL,
        modelClass: "owner_active_compatible",
      }), captureDiagnostic).execute(buildSpec10LiveRequest(name));
      const result = completion.inference.result as { statements?: unknown[] } | null;
      const fixtureCallCount = providerCallCount - callsBefore;
      fixtures.push({
        fixture_id: fixture.fixture_id,
        fixture_digest: fixtureIdentity(fixture).fixture_digest,
        provider_call_count: fixtureCallCount,
        final_disposition: completion.inference.outcome?.final_disposition ?? "unavailable",
        completion_mode: completion.inference.outcome?.completion_mode ?? "unavailable",
        schema_valid: completion.inference.status === "completed" || completion.validation !== null,
        evidence_valid: completion.validation?.accepted ?? false,
        statement_count: Array.isArray(result?.statements) ? result.statements.length : 0,
        diagnostics_complete: terminalDiagnostic !== null && attemptDiagnostics.length === fixtureCallCount && attemptDiagnostics.every(isCompleteAttemptDiagnostic),
        attempt_diagnostics: attemptDiagnostics,
        terminal_diagnostic: terminalDiagnostic,
      });
      stopReason = classifyInferenceStop(completion.inference.error?.code) ?? stopReason;
    } catch (error) {
      stopReason = classifyProviderStop(error) ?? stopReason;
      const fixtureCallCount = providerCallCount - callsBefore;
      fixtures.push({
        fixture_id: fixture.fixture_id,
        fixture_digest: fixtureIdentity(fixture).fixture_digest,
        provider_call_count: fixtureCallCount,
        final_disposition: "failed",
        completion_mode: "none",
        schema_valid: false,
        evidence_valid: false,
        statement_count: 0,
        diagnostics_complete: terminalDiagnostic !== null && attemptDiagnostics.length === fixtureCallCount && attemptDiagnostics.every(isCompleteAttemptDiagnostic),
        attempt_diagnostics: attemptDiagnostics,
        terminal_diagnostic: terminalDiagnostic,
      });
    }
  }
  await refreshSpend();

  const hostRecoveryPassed = fixtures.length === 2 && fixtures.every((fixture) => fixture.final_disposition === "completed" && fixture.schema_valid && fixture.evidence_valid);
  const diagnosticsComplete = fixtures.length === 2 && fixtures.every((fixture) => fixture.diagnostics_complete);
  const providerCompatibilityPassed = diagnosticsComplete && hostRecoveryPassed && fixtures.every((fixture) => ["primary", "provider_repair"].includes(fixture.completion_mode));
  const report: Spec10LiveValidationReport = {
    evidence_contract_version: 1,
    diagnostic_contract_version: 1,
    status: stopReason ? "stopped" : !diagnosticsComplete ? "failed" : providerCompatibilityPassed ? "passed" : hostRecoveryPassed ? "recovered" : "failed",
    provider_profile_id: SPEC_10_LIVE_PROVIDER_PROFILE,
    model_id: SPEC_10_LIVE_MODEL,
    authorized_call_ceiling: SPEC_10_LIVE_MAX_CALLS,
    authorized_spend_ceiling_usd: SPEC_10_LIVE_MAX_USD,
    provider_call_count: providerCallCount,
    observed_spend_delta_usd: Number(observedSpendDelta.toFixed(6)),
    spend_disposition: observedSpendDelta > SPEC_10_LIVE_MAX_USD
      ? "over_authorized_ceiling"
      : observedSpendDelta >= SPEC_10_LIVE_MAX_USD
        ? "at_authorized_ceiling"
        : "under_authorized_ceiling",
    stop_reason: stopReason,
    diagnostics_complete: diagnosticsComplete,
    provider_compatibility_passed: providerCompatibilityPassed,
    host_recovery_passed: hostRecoveryPassed,
    fixtures,
    owner_content_retained: false,
    credentials_tokens_endpoints_private_paths_retained: false,
  };
  assertContentFree(report);
  return report;
}

function isCompleteAttemptDiagnostic(diagnostic: SafeAttemptDiagnostic): boolean {
  if (diagnostic.duration_class === undefined) return false;
  if (["structured_parse", "output_schema_validation"].includes(diagnostic.stage)) {
    if (diagnostic.structural_failure_class === undefined) return false;
    return diagnostic.stage === "output_schema_validation"
      ? diagnostic.schema_issue_ids !== undefined && diagnostic.schema_issue_ids.length > 0
      : diagnostic.schema_issue_ids === undefined;
  }
  return diagnostic.structural_failure_class === undefined && diagnostic.schema_issue_ids === undefined;
}

function projectTerminalDiagnostic(details: TerminalAuditDetails): SafeTerminalDiagnostic {
  return {
    attempt_count: details.attempt_count,
    stage: details.stage,
    finish_category: details.finish_category,
    error_code: details.error_code,
    retryable: details.retryable,
    recovery_class: details.recovery_class,
    completion_mode: details.completion_mode,
    final_disposition: details.final_disposition,
    usage_available: details.usage_available,
    validator_codes: [...details.validator_codes],
    ...(details.provider_validator_codes !== undefined ? { provider_validator_codes: [...details.provider_validator_codes] } : {}),
    ...(details.provider_validator_rule_ids !== undefined ? { provider_validator_rule_ids: [...details.provider_validator_rule_ids] } : {}),
    ...(details.local_candidate_classes !== undefined ? { local_candidate_classes: [...details.local_candidate_classes] } : {}),
    ...(details.targeted_fact_repair_validator_codes !== undefined
      ? { targeted_fact_repair_validator_codes: [...details.targeted_fact_repair_validator_codes] }
      : {}),
    ...(details.targeted_fact_repair_validator_rule_ids !== undefined
      ? { targeted_fact_repair_validator_rule_ids: [...details.targeted_fact_repair_validator_rule_ids] }
      : {}),
    ...(details.targeted_fact_repair_disposition !== undefined
      ? { targeted_fact_repair_disposition: details.targeted_fact_repair_disposition }
      : {}),
    ...(details.full_general_constructor_validator_codes !== undefined
      ? { full_general_constructor_validator_codes: [...details.full_general_constructor_validator_codes] }
      : {}),
    ...(details.full_general_constructor_validator_rule_ids !== undefined
      ? { full_general_constructor_validator_rule_ids: [...details.full_general_constructor_validator_rule_ids] }
      : {}),
    ...(details.full_general_constructor_disposition !== undefined
      ? { full_general_constructor_disposition: details.full_general_constructor_disposition }
      : {}),
    ...(details.original_failure_code !== undefined ? { original_failure_code: details.original_failure_code } : {}),
    ...(details.recovery_disposition !== undefined ? { recovery_disposition: details.recovery_disposition } : {}),
    ...(details.repair !== undefined ? { repair: details.repair } : {}),
  };
}

async function validatedBalance(readBalance: () => Promise<Balance>): Promise<Balance> {
  const balance = await readBalance();
  if (![balance.remainingUsd, balance.totalSpentUsd].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("Spec 10 live balance is unavailable");
  }
  return balance;
}

function classifyProviderStop(error: unknown): StopReason | null {
  const value = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  return classifyInferenceStop(typeof value.code === "string" ? value.code : null)
    ?? classifyInferenceStop(typeof value.message === "string" ? value.message : null);
}

function classifyInferenceStop(value: string | null | undefined): StopReason | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized.includes("authentication")) return "authentication_failed";
  if (normalized.includes("authorization")) return "authorization_failed";
  if (normalized.includes("quota")) return "quota_exceeded";
  if (normalized.includes("rate") && normalized.includes("limit")) return "rate_limited";
  if (normalized.includes("model") && (normalized.includes("mismatch") || normalized.includes("incompatible"))) return "model_mismatch";
  if (normalized.includes("call_ceiling")) return "call_ceiling_reached";
  if (normalized.includes("spend_ceiling")) return normalized.includes("exceeded") ? "spend_ceiling_exceeded" : "spend_ceiling_reached";
  if (normalized.includes("balance_unavailable")) return "balance_unavailable";
  return null;
}

function assertContentFree(report: Spec10LiveValidationReport): void {
  const serialized = JSON.stringify(report);
  if (/https?:\/\/|authorization\s*:|"(?:credential|secret|prompt|resume_text|owner_text)"\s*:|\/home\//i.test(serialized)) {
    throw new Error("Spec 10 live report contains prohibited content");
  }
}

function block(category: DataBlock["category"], schemaId: string, data: unknown): DataBlock {
  return InferenceDataBlockSchema.parse({
    category,
    schema_id: schemaId,
    schema_version: 1,
    content_digest: canonicalInputDigest(data),
    data,
  });
}

function runtimeBlocks(fixture: Spec10SyntheticFixture): DataBlock[] {
  const answeredIds = new Set(fixture.coverage.flatMap((coverage) => Object.values(coverage.dimensions)
    .filter((dimension) => dimension.outcome === "answered")
    .flatMap((dimension) => dimension.evidence_revision_ids)));
  const facts = fixture.facts
    .filter((fact) => fact.fact_kind !== "job_evidence" || answeredIds.has(fact.revision_id))
    .map((fact) => ({
      revision_id: fact.revision_id,
      fact_kind: fact.fact_kind,
      value: fact.fact_kind === "job_evidence"
        ? JSON.stringify({
            value_version: 1,
            association: "job",
            job_fact_revision_id: fact.job_fact_revision_id,
            dimension: fact.dimension,
            outcome: "answered",
            owner_text: fact.value,
          })
        : fact.value,
      source_revision_ids: [fact.revision_id],
    }))
    .sort((left, right) => left.revision_id.localeCompare(right.revision_id));
  const strategy = {
    schema_version: 3,
    record_type: "resume_strategy",
    metadata: {
      record_id: fixture.strategy!.revision_id,
      revision_id: fixture.strategy!.revision_id,
      revision: 1,
      created_at: FIXED_TIME,
      created_by: {
        owner_id: OWNER_ID,
        actor_id: OWNER_ID,
        app_id: "ai.braindrive.resume-builder",
        publisher_id: "ai.braindrive",
        package_digest: SAFE_DIGEST,
        installation_id: INSTALLATION_ID,
      },
      prior_revision_id: null,
      extensions: {},
    },
    owner_id: OWNER_ID,
    updated_at: FIXED_TIME,
    lifecycle_state: "active",
    sensitivity: "sensitive",
    retention_class: "durable_owner_data",
    extensions: {},
    strategy_version: 1,
    fact_snapshot_digest: canonicalInputDigest(facts),
    fact_revision_ids: facts.map((fact) => fact.revision_id),
    coverage_revision_ids: [...fixture.strategy!.coverage_revision_ids].sort(),
    target_revision_id: null,
    history_shape: "chronological_standard",
    history_reason_code: "standard_chronology",
    role_emphasis: [...fixture.jobs]
      .sort((left, right) => left.fact_revision_id.localeCompare(right.fact_revision_id))
      .map((job, index) => ({
        job_fact_revision_id: job.fact_revision_id,
        priority: index === 0 ? "primary" : "supporting",
        reason_code: index === 0 ? "recent" : "continuity",
        bullet_density: "expanded",
      })),
    section_order: [...fixture.strategy!.section_order],
    summary_decision: fixture.strategy!.summary_decision,
    summary_reason_code: "supported_positioning",
    evidence_priorities: facts
      .filter((fact) => fact.fact_kind !== "preference")
      .map((fact) => ({ fact_revision_id: fact.revision_id, priority: "must_use" as const })),
    skills_context: [],
    omissions: [],
    unresolved_gap_ids: [],
    owner_rationale: "Use each eligible confirmed evidence unit and preserve role association.",
    prompt_policy_id: RESUME_PROMPT_POLICY_ID,
    prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
    quality_standard_id: "braindrive.resume-quality",
    quality_standard_version: "3",
    quality_standard_digest: SAFE_DIGEST,
    provider_profile_id: SPEC_10_LIVE_PROVIDER_PROFILE,
    model_id: SPEC_10_LIVE_MODEL,
    input_digest: SAFE_DIGEST,
    output_digest: SAFE_DIGEST,
  };
  return [
    block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts }),
    block("resume_strategy", "resume.strategy-record.v1", strategy),
  ];
}
