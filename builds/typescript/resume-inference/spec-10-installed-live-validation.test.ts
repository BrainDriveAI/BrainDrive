import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type { ModelAdapter } from "../adapters/base.js";
import {
  SPEC_10_INSTALLED_LIVE_MAX_CALLS,
  SPEC_10_INSTALLED_LIVE_MAX_USD,
  buildSpec10InstalledLiveInvocation,
  runSpec10InstalledLiveValidation,
  type Spec10InstalledLiveExecution,
} from "./spec-10-installed-live-validation.js";

function executionUsing(providerMode: "provider" | "fallback"): (provider: {
  providerProfileId: string;
  modelId: string;
  adapter: Pick<ModelAdapter, "completeStructuredNoTools">;
}) => Promise<Spec10InstalledLiveExecution> {
  return async (provider) => ({
    async execute(invocation) {
      const attempts = providerMode === "provider" ? 1 : 2;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        await provider.adapter.completeStructuredNoTools!({
          system: "synthetic installed app plan",
          user: "{}",
          schemaName: "resume_general_draft_slot_text_v1",
          schema: { type: "object" },
          maxOutputTokens: 64,
          timeoutMs: 1_000,
        });
      }
      return {
        inference_contract_version: 2,
        operation_id: invocation.operation_id,
        program: invocation.program,
        status: "completed",
        completion_mode: providerMode === "provider" ? "provider" : "deterministic_fallback",
        attempt_count: attempts,
        issue_ids: providerMode === "provider" ? [] : ["resume.general-draft/schema-candidate-shape-invalid"],
        result: {
          draft: { statements: Array.from({ length: 25 }, () => ({ supporting_confirmed_fact_revision_ids: [crypto.randomUUID()] })) },
        },
      };
    },
    async close() {},
  });
}

const adapter: ModelAdapter = {
  async complete() { throw new Error("unstructured completion prohibited"); },
  async completeStructuredNoTools() {
    return { text: "{}", finishReason: "stop", modelId: "braindrive-models-default", cost: { status: "provider_reported", amount: 0.01, currency: "USD" } };
  },
};

describe("Spec 10 installed-app bounded live validation", () => {
  it("freezes contract-v2 Resume app authority and completes dense plus holdout within the ceiling", async () => {
    expect(SPEC_10_INSTALLED_LIVE_MAX_CALLS).toBe(4);
    expect(SPEC_10_INSTALLED_LIVE_MAX_USD).toBe(0.5);
    expect(buildSpec10InstalledLiveInvocation("dense")).toMatchObject({
      inference_contract_version: 2,
      program: { id: "resume.general-draft", version: 1 },
    });

    const report = await runSpec10InstalledLiveValidation({
      adapter,
      providerProfileId: "braindrive-models",
      modelId: "braindrive-models-default",
      readBalance: async () => ({ remainingUsd: 5, totalSpentUsd: 1 }),
      createExecution: executionUsing("provider"),
    });

    expect(report).toMatchObject({
      status: "passed",
      execution_boundary: "installed_app_contract_v2",
      provider_call_count: 2,
      provider_compatibility_passed: true,
      host_recovery_passed: true,
    });
    expect(report.fixtures.map((fixture) => fixture.fixture_id)).toEqual([
      "spec-10-dense-synthetic-v1",
      "spec-10-holdout-synthetic-v1",
    ]);
  });

  it("classifies app-owned deterministic recovery separately and keeps the report content-free", async () => {
    const report = await runSpec10InstalledLiveValidation({
      adapter,
      providerProfileId: "braindrive-models",
      modelId: "braindrive-models-default",
      readBalance: async () => ({ remainingUsd: 5, totalSpentUsd: 1 }),
      createExecution: executionUsing("fallback"),
    });

    expect(report).toMatchObject({ status: "recovered", provider_call_count: 4, provider_compatibility_passed: false, host_recovery_passed: true });
    expect(report.fixtures.every((fixture) => fixture.completion_mode === "deterministic_fallback")).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/https?:\/\/|authorization\s*:|"(?:credential|secret|prompt|resume_text|owner_text)"\s*:|\/home\//i);
  });

  it("rejects the wrong provider authority before constructing an execution", async () => {
    let constructed = false;
    await expect(runSpec10InstalledLiveValidation({
      adapter,
      providerProfileId: "openrouter",
      modelId: "braindrive-models-default",
      readBalance: async () => ({ remainingUsd: 5, totalSpentUsd: 1 }),
      createExecution: async (provider) => { constructed = true; return executionUsing("provider")(provider); },
    })).rejects.toThrow("provider authority mismatch");
    expect(constructed).toBe(false);
  });

  it("keeps the credentialed script free of the retired Resume broker", async () => {
    const source = await readFile(new URL("../scripts/resume-spec10-live-validation.ts", import.meta.url), "utf8");
    expect(source).toContain("runSpec10InstalledLiveValidation");
    expect(source).not.toMatch(/ResumeInferenceBroker|runSpec10BoundedLiveValidation|buildSpec10LiveRequest/);
  });
});
