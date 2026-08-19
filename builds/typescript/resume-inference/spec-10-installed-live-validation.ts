import { randomUUID } from "node:crypto";

import type { ModelAdapter, StructuredCompletionResponse } from "../adapters/base.js";
import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import {
  SPEC_10_DENSE_CORPUS,
  SPEC_10_DENSE_CORPUS_DIGEST,
  SPEC_10_HOLDOUT_CORPUS,
  SPEC_10_HOLDOUT_CORPUS_DIGEST,
  evaluateSpec10FixtureEligibility,
  fixtureIdentity,
  type Spec10SyntheticFixture,
} from "./spec-10-acceptance-fixture.js";

export const SPEC_10_INSTALLED_LIVE_PROVIDER_PROFILE = "braindrive-models" as const;
export const SPEC_10_INSTALLED_LIVE_MODEL = "braindrive-models-default" as const;
export const SPEC_10_INSTALLED_LIVE_MAX_CALLS = 4 as const;
export const SPEC_10_INSTALLED_LIVE_MAX_USD = 0.5 as const;

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

export type Spec10InstalledLiveInvocation = {
  inference_contract_version: 2;
  operation_id: string;
  program: { id: "resume.general-draft"; version: 1 };
  input: {
    facts: Array<{ revision_id: string; fact_kind: string; value: string; state: "confirmed"; source_revision_ids: string[] }>;
    strategy: {
      title: "General Resume";
      fact_revision_ids: string[];
      section_order: string[];
      evidence_priorities: Array<{ fact_revision_id: string; priority: "must_use" }>;
      summary_decision: string;
      omissions: never[];
    };
    presentation_preferences: Record<string, never>;
    persistence_input_digest: `sha256:${string}`;
  };
};

type InstalledLiveProvider = {
  providerProfileId: string;
  modelId: string;
  adapter: Pick<ModelAdapter, "completeStructuredNoTools">;
};

export type Spec10InstalledLiveExecution = {
  execute(invocation: Spec10InstalledLiveInvocation): Promise<unknown>;
  close(): Promise<void>;
};

export type Spec10InstalledLiveValidationReport = {
  evidence_contract_version: 1;
  execution_boundary: "installed_app_contract_v2";
  status: "passed" | "recovered" | "failed" | "stopped";
  provider_profile_id: typeof SPEC_10_INSTALLED_LIVE_PROVIDER_PROFILE;
  model_id: typeof SPEC_10_INSTALLED_LIVE_MODEL;
  authorized_call_ceiling: typeof SPEC_10_INSTALLED_LIVE_MAX_CALLS;
  authorized_spend_ceiling_usd: typeof SPEC_10_INSTALLED_LIVE_MAX_USD;
  provider_call_count: number;
  observed_spend_delta_usd: number;
  spend_disposition: "under_authorized_ceiling" | "at_authorized_ceiling" | "over_authorized_ceiling";
  stop_reason: StopReason | null;
  provider_compatibility_passed: boolean;
  host_recovery_passed: boolean;
  fixtures: Array<{
    fixture_id: string;
    fixture_digest: string;
    provider_call_count: number;
    status: "completed" | "failed";
    completion_mode: "provider" | "deterministic_fallback" | "none";
    attempt_count: number;
    issue_ids: string[];
    schema_valid: boolean;
    evidence_valid: boolean;
    statement_count: number;
  }>;
  owner_content_retained: false;
  credentials_tokens_endpoints_private_paths_retained: false;
};

export function buildSpec10InstalledLiveInvocation(name: FixtureName): Spec10InstalledLiveInvocation {
  const fixture = name === "dense" ? SPEC_10_DENSE_CORPUS : SPEC_10_HOLDOUT_CORPUS;
  const expectedDigest = name === "dense" ? SPEC_10_DENSE_CORPUS_DIGEST : SPEC_10_HOLDOUT_CORPUS_DIGEST;
  const eligibility = evaluateSpec10FixtureEligibility(fixture);
  if (!eligibility.eligible) throw new Error(`Spec 10 live fixture is ineligible: ${eligibility.reasons.join(",")}`);
  if (fixtureIdentity(fixture).fixture_digest !== expectedDigest) throw new Error("Spec 10 live fixture identity drift");
  const facts = appFacts(fixture);
  const factRevisionIds = facts.map((fact) => fact.revision_id);
  return {
    inference_contract_version: 2,
    operation_id: randomUUID(),
    program: { id: "resume.general-draft", version: 1 },
    input: {
      facts,
      strategy: {
        title: "General Resume",
        fact_revision_ids: factRevisionIds,
        section_order: [...fixture.strategy!.section_order],
        evidence_priorities: facts
          .filter((fact) => fact.fact_kind !== "preference")
          .map((fact) => ({ fact_revision_id: fact.revision_id, priority: "must_use" as const })),
        summary_decision: fixture.strategy!.summary_decision,
        omissions: [],
      },
      presentation_preferences: {},
      persistence_input_digest: canonicalInputDigest({
        fixture_digest: expectedDigest,
        fact_revision_ids: factRevisionIds,
        strategy_revision_id: fixture.strategy!.revision_id,
      }),
    },
  };
}

export async function runSpec10InstalledLiveValidation(input: {
  adapter: ModelAdapter;
  providerProfileId: string;
  modelId: string;
  readBalance: () => Promise<Balance>;
  createExecution: (provider: InstalledLiveProvider) => Promise<Spec10InstalledLiveExecution>;
}): Promise<Spec10InstalledLiveValidationReport> {
  if (input.providerProfileId !== SPEC_10_INSTALLED_LIVE_PROVIDER_PROFILE || input.modelId !== SPEC_10_INSTALLED_LIVE_MODEL) {
    throw new Error("Spec 10 installed live provider authority mismatch");
  }
  if (!input.adapter.completeStructuredNoTools) throw new Error("Spec 10 installed live adapter lacks structured no-tools completion");
  const initialBalance = await validatedBalance(input.readBalance);
  let providerCallCount = 0;
  let providerReportedCost = 0;
  let observedSpendDelta = 0;
  let stopReason: StopReason | null = null;

  const refreshSpend = async (): Promise<void> => {
    try {
      const current = await validatedBalance(input.readBalance);
      observedSpendDelta = Math.max(
        observedSpendDelta,
        providerReportedCost,
        Math.max(0, current.totalSpentUsd - initialBalance.totalSpentUsd),
        Math.max(0, initialBalance.remainingUsd - current.remainingUsd),
      );
      if (observedSpendDelta > SPEC_10_INSTALLED_LIVE_MAX_USD) stopReason = "spend_ceiling_exceeded";
      else if (observedSpendDelta >= SPEC_10_INSTALLED_LIVE_MAX_USD) stopReason = "spend_ceiling_reached";
    } catch {
      stopReason = "balance_unavailable";
    }
  };

  const guardedAdapter: Pick<ModelAdapter, "completeStructuredNoTools"> = {
    completeStructuredNoTools: async (request): Promise<StructuredCompletionResponse> => {
      await refreshSpend();
      if (stopReason) throw new Error(`Spec 10 installed live stopped: ${stopReason}`);
      if (providerCallCount >= SPEC_10_INSTALLED_LIVE_MAX_CALLS) {
        stopReason = "call_ceiling_reached";
        throw new Error("Spec 10 installed live call ceiling reached");
      }
      providerCallCount += 1;
      let response: StructuredCompletionResponse;
      try {
        response = await input.adapter.completeStructuredNoTools!(request);
      } catch (error) {
        stopReason = classifyStop(error) ?? stopReason;
        throw error;
      }
      if (response.modelId && response.modelId !== SPEC_10_INSTALLED_LIVE_MODEL) {
        stopReason = "model_mismatch";
        throw new Error("Spec 10 installed live observed model mismatch");
      }
      if (response.cost?.status === "provider_reported" && response.cost.currency === "USD" && typeof response.cost.amount === "number") {
        providerReportedCost += Math.max(0, response.cost.amount);
      }
      await refreshSpend();
      return response;
    },
  };

  const execution = await input.createExecution({
    providerProfileId: SPEC_10_INSTALLED_LIVE_PROVIDER_PROFILE,
    modelId: SPEC_10_INSTALLED_LIVE_MODEL,
    adapter: guardedAdapter,
  });
  const fixtures: Spec10InstalledLiveValidationReport["fixtures"] = [];
  try {
    for (const name of ["dense", "holdout"] as const) {
      if (stopReason) break;
      const invocation = buildSpec10InstalledLiveInvocation(name);
      const fixture = name === "dense" ? SPEC_10_DENSE_CORPUS : SPEC_10_HOLDOUT_CORPUS;
      const callsBefore = providerCallCount;
      try {
        const raw = await execution.execute(invocation);
        const completion = parseCompletion(raw, invocation.operation_id);
        fixtures.push({
          fixture_id: fixture.fixture_id,
          fixture_digest: fixtureIdentity(fixture).fixture_digest,
          provider_call_count: providerCallCount - callsBefore,
          status: "completed",
          completion_mode: completion.completion_mode,
          attempt_count: completion.attempt_count,
          issue_ids: completion.issue_ids,
          schema_valid: true,
          evidence_valid: true,
          statement_count: completion.statement_count,
        });
      } catch (error) {
        stopReason = classifyStop(error) ?? stopReason;
        fixtures.push({
          fixture_id: fixture.fixture_id,
          fixture_digest: fixtureIdentity(fixture).fixture_digest,
          provider_call_count: providerCallCount - callsBefore,
          status: "failed",
          completion_mode: "none",
          attempt_count: providerCallCount - callsBefore,
          issue_ids: [],
          schema_valid: false,
          evidence_valid: false,
          statement_count: 0,
        });
      }
    }
  } finally {
    await execution.close();
  }
  await refreshSpend();

  const hostRecoveryPassed = fixtures.length === 2 && fixtures.every((fixture) => fixture.status === "completed" && fixture.schema_valid && fixture.evidence_valid);
  const providerCompatibilityPassed = hostRecoveryPassed && fixtures.every((fixture) => fixture.completion_mode === "provider");
  const report: Spec10InstalledLiveValidationReport = {
    evidence_contract_version: 1,
    execution_boundary: "installed_app_contract_v2",
    status: stopReason ? "stopped" : providerCompatibilityPassed ? "passed" : hostRecoveryPassed ? "recovered" : "failed",
    provider_profile_id: SPEC_10_INSTALLED_LIVE_PROVIDER_PROFILE,
    model_id: SPEC_10_INSTALLED_LIVE_MODEL,
    authorized_call_ceiling: SPEC_10_INSTALLED_LIVE_MAX_CALLS,
    authorized_spend_ceiling_usd: SPEC_10_INSTALLED_LIVE_MAX_USD,
    provider_call_count: providerCallCount,
    observed_spend_delta_usd: Number(observedSpendDelta.toFixed(6)),
    spend_disposition: observedSpendDelta > SPEC_10_INSTALLED_LIVE_MAX_USD
      ? "over_authorized_ceiling"
      : observedSpendDelta >= SPEC_10_INSTALLED_LIVE_MAX_USD
        ? "at_authorized_ceiling"
        : "under_authorized_ceiling",
    stop_reason: stopReason,
    provider_compatibility_passed: providerCompatibilityPassed,
    host_recovery_passed: hostRecoveryPassed,
    fixtures,
    owner_content_retained: false,
    credentials_tokens_endpoints_private_paths_retained: false,
  };
  assertContentFree(report);
  return report;
}

function appFacts(fixture: Spec10SyntheticFixture): Spec10InstalledLiveInvocation["input"]["facts"] {
  const answeredIds = new Set(fixture.coverage.flatMap((coverage) => Object.values(coverage.dimensions)
    .filter((dimension) => dimension.outcome === "answered")
    .flatMap((dimension) => dimension.evidence_revision_ids)));
  return fixture.facts
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
      state: "confirmed" as const,
      source_revision_ids: [fact.revision_id],
    }))
    .sort((left, right) => left.revision_id.localeCompare(right.revision_id));
}

function parseCompletion(raw: unknown, operationId: string): {
  completion_mode: "provider" | "deterministic_fallback";
  attempt_count: number;
  issue_ids: string[];
  statement_count: number;
} {
  if (!raw || typeof raw !== "object") throw new Error("installed_app_completion_invalid");
  const value = raw as Record<string, unknown>;
  if (value.inference_contract_version !== 2 || value.operation_id !== operationId || value.status !== "completed") throw new Error("installed_app_completion_invalid");
  if (value.completion_mode !== "provider" && value.completion_mode !== "deterministic_fallback") throw new Error("installed_app_completion_invalid");
  if (!Number.isInteger(value.attempt_count) || (value.attempt_count as number) < 1 || (value.attempt_count as number) > 2) throw new Error("installed_app_completion_invalid");
  if (!Array.isArray(value.issue_ids) || value.issue_ids.some((item) => typeof item !== "string")) throw new Error("installed_app_completion_invalid");
  const result = value.result && typeof value.result === "object" ? value.result as Record<string, unknown> : null;
  const draft = result?.draft && typeof result.draft === "object" ? result.draft as Record<string, unknown> : null;
  if (!draft || !Array.isArray(draft.statements)) throw new Error("installed_app_completion_invalid");
  return {
    completion_mode: value.completion_mode,
    attempt_count: value.attempt_count as number,
    issue_ids: [...value.issue_ids] as string[],
    statement_count: draft.statements.length,
  };
}

async function validatedBalance(readBalance: () => Promise<Balance>): Promise<Balance> {
  const balance = await readBalance();
  if (![balance.remainingUsd, balance.totalSpentUsd].every((value) => Number.isFinite(value) && value >= 0)) throw new Error("balance_unavailable");
  return balance;
}

function classifyStop(error: unknown): StopReason | null {
  const value = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  const text = [value.code, value.message].filter((item): item is string => typeof item === "string").join(" ").toLowerCase();
  if (text.includes("authentication")) return "authentication_failed";
  if (text.includes("authorization")) return "authorization_failed";
  if (text.includes("quota")) return "quota_exceeded";
  if (text.includes("rate") && text.includes("limit")) return "rate_limited";
  if (text.includes("model") && (text.includes("mismatch") || text.includes("incompatible"))) return "model_mismatch";
  if (text.includes("call_ceiling")) return "call_ceiling_reached";
  if (text.includes("spend_ceiling")) return text.includes("exceeded") ? "spend_ceiling_exceeded" : "spend_ceiling_reached";
  if (text.includes("balance_unavailable")) return "balance_unavailable";
  return null;
}

function assertContentFree(report: Spec10InstalledLiveValidationReport): void {
  const serialized = JSON.stringify(report);
  if (/https?:\/\/|authorization\s*:|"(?:credential|secret|prompt|resume_text|owner_text)"\s*:|\/home\//i.test(serialized)) {
    throw new Error("Spec 10 installed live report contains prohibited content");
  }
}
