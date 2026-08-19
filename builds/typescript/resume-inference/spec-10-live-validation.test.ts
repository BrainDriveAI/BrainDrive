import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ModelAdapter, StructuredCompletionResponse } from "../adapters/base.js";
import { structureResumeE2eProviderResult } from "./e2e-fixture.js";
import { deterministicHostFallback } from "./host-assistance.js";
import {
  SPEC_10_LIVE_MAX_CALLS,
  SPEC_10_LIVE_MAX_USD,
  buildSpec10LiveRequest,
  runSpec10BoundedLiveValidation,
} from "./spec-10-live-validation.js";

function validAdapter(): ModelAdapter {
  let calls = 0;
  return {
    async complete() { throw new Error("general completion is prohibited"); },
    async completeStructuredNoTools(): Promise<StructuredCompletionResponse> {
      const invocation = buildSpec10LiveRequest(calls++ === 0 ? "dense" : "holdout");
      return {
        text: JSON.stringify(structureResumeE2eProviderResult("general_resume_draft", deterministicHostFallback("general_resume_draft", invocation.data_blocks), invocation.data_blocks)),
        finishReason: "stop",
        modelId: "braindrive-models-default",
        usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
        cost: { status: "provider_reported", amount: 0.01, currency: "USD" },
      };
    },
  };
}

describe("Spec 10 bounded live validation", () => {
  it("freezes the approved authority and completes dense plus holdout within two calls", async () => {
    expect(SPEC_10_LIVE_MAX_CALLS).toBe(4);
    expect(SPEC_10_LIVE_MAX_USD).toBe(0.5);
    const balance = vi.fn(async () => ({ remainingUsd: 5, totalSpentUsd: 1 }));
    const report = await runSpec10BoundedLiveValidation({
      adapter: validAdapter(),
      providerProfileId: "braindrive-models",
      modelId: "braindrive-models-default",
      readBalance: balance,
    });

    expect(report).toMatchObject({
      status: "passed",
      provider_profile_id: "braindrive-models",
      model_id: "braindrive-models-default",
      provider_call_count: 2,
      authorized_call_ceiling: 4,
      authorized_spend_ceiling_usd: 0.5,
      owner_content_retained: false,
      credentials_tokens_endpoints_private_paths_retained: false,
    });
    expect(report.fixtures.map((fixture) => fixture.fixture_id)).toEqual([
      "spec-10-dense-synthetic-v1",
      "spec-10-holdout-synthetic-v1",
    ]);
    expect(report.fixtures.every((fixture) => fixture.schema_valid && fixture.evidence_valid)).toBe(true);
  });

  it("stops before another call when observed spend reaches the approved ceiling", async () => {
    let reads = 0;
    const report = await runSpec10BoundedLiveValidation({
      adapter: validAdapter(),
      providerProfileId: "braindrive-models",
      modelId: "braindrive-models-default",
      readBalance: async () => ({ remainingUsd: 5, totalSpentUsd: reads++ < 2 ? 1 : 1.5 }),
    });

    expect(report.status).toBe("stopped");
    expect(report.stop_reason).toBe("spend_ceiling_reached");
    expect(report.provider_call_count).toBe(1);
  });

  it("rejects wrong authority and keeps the serialized report content-free", async () => {
    await expect(runSpec10BoundedLiveValidation({
      adapter: validAdapter(),
      providerProfileId: "openrouter",
      modelId: "braindrive-models-default",
      readBalance: async () => ({ remainingUsd: 5, totalSpentUsd: 1 }),
    })).rejects.toThrow("provider authority mismatch");

    const report = await runSpec10BoundedLiveValidation({
      adapter: validAdapter(),
      providerProfileId: "braindrive-models",
      modelId: "braindrive-models-default",
      readBalance: async () => ({ remainingUsd: 5, totalSpentUsd: 1 }),
    });
    expect(JSON.stringify(report)).not.toMatch(/https?:\/\/|authorization\s*:|"(?:credential|secret|prompt|resume_text|owner_text)"\s*:|\/home\//i);
  });

  it("classifies valid deterministic recovery separately from live-provider compatibility", async () => {
    const adapter: ModelAdapter = {
      async complete() { throw new Error("general completion is prohibited"); },
      async completeStructuredNoTools() {
        return {
          text: "{",
          finishReason: "stop",
          modelId: "braindrive-models-default",
          cost: { status: "provider_reported", amount: 0.01, currency: "USD" },
        };
      },
    };
    const report = await runSpec10BoundedLiveValidation({
      adapter,
      providerProfileId: "braindrive-models",
      modelId: "braindrive-models-default",
      readBalance: async () => ({ remainingUsd: 5, totalSpentUsd: 1 }),
    });

    expect(report.status).toBe("recovered");
    expect(report.provider_compatibility_passed).toBe(false);
    expect(report.host_recovery_passed).toBe(true);
    expect(report.provider_call_count).toBe(4);
    expect(report.fixtures.every((fixture) => fixture.completion_mode === "deterministic_fallback")).toBe(true);
    expect(report.diagnostics_complete).toBe(true);
    for (const fixture of report.fixtures) {
      expect(fixture.attempt_diagnostics).toEqual([
        { attempt: 1, stage: "structured_parse", finish_category: "stop", attempt_outcome: "retry", duration_class: "under_1s", structural_failure_class: "invalid_json" },
        { attempt: 2, stage: "structured_parse", finish_category: "stop", attempt_outcome: "fallback", duration_class: "under_1s", structural_failure_class: "invalid_json" },
      ]);
      expect(fixture.terminal_diagnostic).toMatchObject({
        attempt_count: 2,
        stage: "completed",
        recovery_class: "deterministic_fallback",
        completion_mode: "deterministic_fallback",
        final_disposition: "completed",
        validator_codes: [],
        repair: "deterministic_fact_fallback",
      });
    }
  });

  it("retains only precise content-free schema issue IDs for malformed provider fields", async () => {
    let calls = 0;
    const adapter: ModelAdapter = {
      async complete() { throw new Error("general completion is prohibited"); },
      async completeStructuredNoTools() {
        const fixtureName = calls < 2 ? "dense" : "holdout";
        const invocation = buildSpec10LiveRequest(fixtureName);
        const valid = structuredClone(structureResumeE2eProviderResult(
          "general_resume_draft",
          deterministicHostFallback("general_resume_draft", invocation.data_blocks),
          invocation.data_blocks,
        )) as { title: unknown; experience_roles: Array<{ bullet_statements: Array<Record<string, unknown>> }> };
        const malformed = calls % 2 === 0;
        calls += 1;
        if (malformed) {
          valid.title = 42;
          const bullet = valid.experience_roles[0]!.bullet_statements[0]!;
          valid.experience_roles[0]!.bullet_statements = Array.from({ length: 7 }, () => ({ ...bullet, statement_id: randomUUID() }));
        }
        return {
          text: JSON.stringify(valid),
          finishReason: "stop",
          modelId: "braindrive-models-default",
          cost: { status: "provider_reported", amount: 0.01, currency: "USD" },
        };
      },
    };
    const report = await runSpec10BoundedLiveValidation({
      adapter,
      providerProfileId: "braindrive-models",
      modelId: "braindrive-models-default",
      readBalance: async () => ({ remainingUsd: 5, totalSpentUsd: 1 }),
    });

    expect(report.status).toBe("passed");
    expect(report.provider_call_count).toBe(4);
    for (const fixture of report.fixtures) {
      expect(fixture.attempt_diagnostics[0]).toMatchObject({
        stage: "output_schema_validation",
        structural_failure_class: "purpose_schema_mismatch",
        schema_issue_ids: ["title_invalid", "experience_role_bullet_limit_exceeded"],
      });
      expect(fixture.attempt_diagnostics[1]).not.toHaveProperty("schema_issue_ids");
    }
    expect(JSON.stringify(report)).not.toContain('"title":42');
  });

  it("passes the precise semantic host-binding ID into the one structural retry", async () => {
    let calls = 0;
    const adapter: ModelAdapter = {
      async complete() { throw new Error("general completion is prohibited"); },
      async completeStructuredNoTools() {
        const fixtureName = calls < 2 ? "dense" : "holdout";
        const invocation = buildSpec10LiveRequest(fixtureName);
        const valid = structuredClone(structureResumeE2eProviderResult(
          "general_resume_draft",
          deterministicHostFallback("general_resume_draft", invocation.data_blocks),
          invocation.data_blocks,
        )) as { statements: Array<Record<string, unknown>>; experience_roles: Array<{ bullet_statements: Array<Record<string, unknown>> }> };
        if (calls % 2 === 0) valid.statements.push(structuredClone(valid.experience_roles[0]!.bullet_statements[0]!));
        calls += 1;
        return {
          text: JSON.stringify(valid),
          finishReason: "stop",
          modelId: "braindrive-models-default",
          cost: { status: "provider_reported", amount: 0.01, currency: "USD" },
        };
      },
    };
    const report = await runSpec10BoundedLiveValidation({
      adapter,
      providerProfileId: "braindrive-models",
      modelId: "braindrive-models-default",
      readBalance: async () => ({ remainingUsd: 5, totalSpentUsd: 1 }),
    });

    expect(report.status).toBe("passed");
    expect(report.provider_call_count).toBe(4);
    for (const fixture of report.fixtures) {
      expect(fixture.attempt_diagnostics[0]).toMatchObject({
        structural_failure_class: "host_normalization_mismatch",
        schema_issue_ids: ["experience_role_top_level_leakage"],
      });
      expect(fixture.attempt_diagnostics[1]).not.toHaveProperty("schema_issue_ids");
    }
  });

  it("retains allowlisted evidence-repair codes without retaining the candidate or finding text", async () => {
    let calls = 0;
    const adapter: ModelAdapter = {
      async complete() { throw new Error("general completion is prohibited"); },
      async completeStructuredNoTools() {
        const invocation = buildSpec10LiveRequest(calls++ < 2 ? "dense" : "holdout");
        const draft = structuredClone(structureResumeE2eProviderResult("general_resume_draft", deterministicHostFallback("general_resume_draft", invocation.data_blocks), invocation.data_blocks)) as {
          statements: Array<{ text: string; supporting_confirmed_fact_revision_ids: string[] }>;
        };
        draft.statements[0]!.text = "PROHIBITED_LIVE_DIAGNOSTIC_CANARY";
        draft.statements[0]!.supporting_confirmed_fact_revision_ids = ["83000000-0000-4000-8000-000000000099"];
        return {
          text: JSON.stringify(draft),
          finishReason: "stop",
          modelId: "braindrive-models-default",
          cost: { status: "provider_reported", amount: 0.01, currency: "USD" },
        };
      },
    };
    const report = await runSpec10BoundedLiveValidation({
      adapter,
      providerProfileId: "braindrive-models",
      modelId: "braindrive-models-default",
      readBalance: async () => ({ remainingUsd: 5, totalSpentUsd: 1 }),
    });

    expect(report.status).toBe("recovered");
    expect(report.diagnostics_complete).toBe(true);
    for (const fixture of report.fixtures) {
      expect(fixture.attempt_diagnostics).toEqual([
        { attempt: 1, stage: "deterministic_validation", finish_category: "stop", attempt_outcome: "retry", duration_class: "under_1s", validator_rule_ids: ["statement_support_unresolved"] },
        { attempt: 2, stage: "deterministic_validation", finish_category: "stop", attempt_outcome: "fallback", duration_class: "under_1s", validator_rule_ids: ["statement_support_unresolved"] },
      ]);
      expect(fixture.terminal_diagnostic).toMatchObject({
        provider_validator_codes: ["missing_provenance"],
        provider_validator_rule_ids: ["statement_support_unresolved"],
        targeted_fact_repair_validator_rule_ids: ["statement_support_unresolved"],
        full_general_constructor_validator_rule_ids: [],
        original_failure_code: "evidence_validation_failed",
        recovery_disposition: "full_constructor_accepted",
      });
    }
    expect(JSON.stringify(report)).not.toContain("PROHIBITED_LIVE_DIAGNOSTIC_CANARY");
    expect(JSON.stringify(report)).not.toContain("83000000-0000-4000-8000-000000000099");
  });
});
