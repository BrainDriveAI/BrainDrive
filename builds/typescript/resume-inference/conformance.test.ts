import { describe, expect, it } from "vitest";

import type { ModelAdapter, StructuredCompletionRequest } from "../adapters/base.js";
import { InferencePurposeSchema } from "../app-platform/contracts/inference.js";
import {
  RESUME_CONFORMANCE_PURPOSES,
  runResumeModelConformance,
  serializeConformanceReport,
} from "./conformance.js";
import {
  RESUME_CONFORMANCE_FIXTURES,
  RESUME_MODEL_CONFORMANCE_BINDING,
  conformanceBlocks,
  conformanceCorpusDigest,
  conformanceFixtureDigest,
  conformanceFixturesForPurpose,
} from "./conformance-corpus.js";
import { createResumeE2eFixtureProviderResolver, structureResumeE2eProviderResult, synthesizeResumeE2eResult } from "./e2e-fixture.js";

const SHA = `sha256:${"a".repeat(64)}` as const;
const TESTED_AT = new Date("2026-08-11T12:00:00.000Z");
const ordinary = RESUME_CONFORMANCE_FIXTURES.find((fixture) => fixture.fixture_id === "ordinary-one-role")!;

function adapterFor(purpose: Parameters<typeof conformanceBlocks>[0], handler?: (request: StructuredCompletionRequest, call: number) => unknown): ModelAdapter {
  let calls = 0;
  return {
    async complete() { throw new Error("agent loop must not run"); },
    async completeStructuredNoTools(request) {
      calls += 1;
      const blocks = conformanceBlocks(purpose);
      const result = handler ? handler(request, calls) : synthesizeResumeE2eResult(purpose, blocks);
      const providerResult = typeof result === "string" ? result : structureResumeE2eProviderResult(purpose, result, blocks);
      return {
        text: typeof providerResult === "string" ? providerResult : JSON.stringify(providerResult),
        finishReason: "stop",
        modelId: "observed-model-revision-a",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    },
  };
}

function run(purpose: Parameters<typeof conformanceBlocks>[0], adapter = adapterFor(purpose), extra: Record<string, unknown> = {}) {
  return runResumeModelConformance({
    adapter,
    providerProfileId: "synthetic-provider-class",
    modelId: "synthetic-model-class",
    effectiveConfigFingerprint: SHA,
    purposes: [purpose],
    fixtures: [ordinary],
    testedAt: TESTED_AT,
    evidenceClass: "authorized_live_provider",
    ...extra,
  });
}

describe("Resume Builder v2 provider conformance safety", () => {
  it("keeps all purposes and every required fixture class in a stable versioned corpus", () => {
    expect(RESUME_CONFORMANCE_PURPOSES).toEqual(InferencePurposeSchema.options);
    expect(new Set(RESUME_CONFORMANCE_FIXTURES.map((fixture) => fixture.fixture_class))).toEqual(new Set([
      "sparse", "ordinary", "long_many_role", "career_change_gap_overlap", "missing_optional",
      "large_long_output", "ambiguous_conflicting", "unicode_non_english", "adversarial", "structure_deviation",
    ]));
    expect(RESUME_CONFORMANCE_FIXTURES.map((fixture) => fixture.fixture_id)).toEqual([
      "ordinary-one-role", "sparse-career", "long-many-role-history", "career-change-gap-overlap",
      "missing-optional-fields", "large-evidence-long-output", "ambiguous-conflicting-evidence",
      "unicode-non-english", "adversarial-source", "structure-extra-prose", "structure-schema-drift",
    ]);
    for (const purpose of InferencePurposeSchema.options) {
      expect(conformanceFixturesForPurpose(purpose).length).toBeGreaterThan(0);
      expect(conformanceCorpusDigest(purpose)).toMatch(/^sha256:[a-f0-9]{64}$/);
      for (const fixture of conformanceFixturesForPurpose(purpose)) {
        expect(conformanceFixtureDigest(purpose, fixture.fixture_id)).toMatch(/^sha256:[a-f0-9]{64}$/);
        const categories = conformanceBlocks(purpose, fixture.fixture_id).map((block) => block.category);
        expect(categories).toEqual(conformanceBlocks(purpose).map((block) => block.category));
      }
    }
    expect(RESUME_MODEL_CONFORMANCE_BINDING).toMatchObject({ binding_version: 2, prompt_policy_version: "12" });
    expect(() => conformanceBlocks("general_resume_draft", "unicode-non-english")).not.toThrow();
    expect(() => conformanceBlocks("tailoring_plan", "unicode-non-english")).toThrow(/not authorized/);
  });

  it("executes every applicable fixture projection three times without granting synthetic compatibility", async () => {
    const resolver = createResumeE2eFixtureProviderResolver();
    for (const purpose of InferencePurposeSchema.options) {
      const provider = await resolver(purpose);
      const report = await runResumeModelConformance({
        adapter: provider.adapter,
        providerProfileId: provider.providerProfileId,
        modelId: provider.modelId,
        effectiveConfigFingerprint: SHA,
        purposes: [purpose],
        testedAt: TESTED_AT,
      });
      const entry = report.entries[0]!;
      const expectedOperations = conformanceFixturesForPurpose(purpose).length * 3;
      expect(entry.operation_count, purpose).toBe(expectedOperations);
      expect(entry.runs, purpose).toHaveLength(expectedOperations);
      expect(entry.all_required_runs_valid, `${purpose}: ${JSON.stringify(entry.runs)}`).toBe(true);
      expect(entry.compatible, purpose).toBe(purpose === "resume_craft_evaluate");
      if (purpose !== "resume_craft_evaluate") expect(entry.evidence_class).toBe("credential_free_synthetic");
    }
  });

  it("retains exactly three fresh logical operations with decomposed primary outcomes", async () => {
    const report = await run("resume_strategy");
    const entry = report.entries[0]!;
    expect(entry).toMatchObject({
      registry_version: 2,
      fixture_count: 1,
      runs_per_fixture: 3,
      operation_count: 3,
      evidence_class: "authorized_live_provider",
      observed_model_id: "observed-model-revision-a",
      all_required_runs_valid: true,
      compatible: true,
      outcomes: { primary_success: 3, provider_success: 3, safe_failure: 0, zero_provider_call: 0 },
      tested_at: "2026-08-11T12:00:00.000Z",
      expires_at: "2026-11-09T12:00:00.000Z",
    });
    expect(new Set(entry.runs.map((item) => item.operation_id)).size).toBe(3);
    expect(entry.runs).toHaveLength(3);
  });

  it("separates validation repair from primary success and retains every run", async () => {
    const purpose = "interview_assist" as const;
    const valid = synthesizeResumeE2eResult(purpose, conformanceBlocks(purpose)) as { questions: Array<Record<string, unknown>> };
    let calls = 0;
    const adapter = adapterFor(purpose, () => {
      calls += 1;
      return calls % 2 === 1
        ? { ...valid, questions: valid.questions.map((question) => ({ ...question, job_fact_revision_id: "90000000-0000-4000-8000-000000000099" })) }
        : valid;
    });
    const entry = (await run(purpose, adapter)).entries[0]!;
    expect(calls).toBe(6);
    expect(entry.runs).toHaveLength(3);
    expect(entry.outcomes).toMatchObject({ validation_repair_success: 3, provider_success: 3, primary_success: 0 });
    expect(entry.runs.every((item) => item.attempt_count === 2)).toBe(true);
  });

  it("records bounded structural repair for the structure-deviation fixture", async () => {
    const purpose = "general_resume_draft" as const;
    const valid = synthesizeResumeE2eResult(purpose, conformanceBlocks(purpose));
    let calls = 0;
    const adapter = adapterFor(purpose, () => {
      calls += 1;
      return calls % 2 === 1 ? `synthetic prose\n${JSON.stringify(valid)}` : valid;
    });
    const structureFixture = RESUME_CONFORMANCE_FIXTURES.find((fixture) => fixture.fixture_id === "structure-extra-prose")!;
    const entry = (await run(purpose, adapter, { fixtures: [structureFixture] })).entries[0]!;
    expect(calls).toBe(6);
    expect(entry.runs).toHaveLength(3);
    expect(entry.outcomes).toMatchObject({ structural_repair_success: 3, provider_success: 3 });
  });

  it("retains safe failures without raw provider errors or best-of-N selection", async () => {
    const diagnostics: unknown[] = [];
    const adapter = {
      async complete() { throw new Error("not used"); },
      async completeStructuredNoTools() { throw new Error("private provider response https://private.invalid and credential-shaped secret"); },
    } as ModelAdapter;
    const report = await run("resume_strategy", adapter, { onDiagnostic: (value: unknown) => diagnostics.push(value) });
    const entry = report.entries[0]!;
    expect(entry.runs).toHaveLength(3);
    expect(entry.outcomes.safe_failure).toBe(3);
    expect(entry.compatible).toBe(false);
    expect(diagnostics).toHaveLength(3);
    expect(JSON.stringify({ report, diagnostics })).not.toMatch(/private provider|private\.invalid|credential-shaped/);
  });

  it("never counts deterministic fallback as provider success", async () => {
    const purpose = "general_resume_draft" as const;
    const valid = synthesizeResumeE2eResult(purpose, conformanceBlocks(purpose)) as { statements: Array<Record<string, unknown>> };
    const unsupported = {
      ...valid,
      statements: valid.statements.map((statement, index) => index === 0 ? { ...statement, text: "Invented unsupported achievement 999%" } : statement),
    };
    const entry = (await run(purpose, adapterFor(purpose, () => unsupported))).entries[0]!;
    expect(entry.outcomes.deterministic_fallback_success).toBe(3);
    expect(entry.outcomes.provider_success).toBe(0);
    expect(entry.runs.every((item) => item.provider_success === false)).toBe(true);
  });

  it("proves craft evaluation is three host-owned operations with zero provider calls", async () => {
    let calls = 0;
    const adapter = adapterFor("resume_craft_evaluate", () => {
      calls += 1;
      throw new Error("craft evaluation must not call provider");
    });
    const entry = (await run("resume_craft_evaluate", adapter)).entries[0]!;
    expect(calls).toBe(0);
    expect(entry).toMatchObject({
      evidence_class: "host_owned_zero_call",
      compatible: true,
      outcomes: { host_owned_success: 3, zero_provider_call: 3, provider_success: 0 },
    });
  });

  it("fails compatibility when observed model identity drifts between operations", async () => {
    let calls = 0;
    const purpose = "resume_strategy" as const;
    const result = synthesizeResumeE2eResult(purpose, conformanceBlocks(purpose));
    const adapter: ModelAdapter = {
      async complete() { throw new Error("not used"); },
      async completeStructuredNoTools() {
        calls += 1;
        return { text: JSON.stringify(result), finishReason: "stop", modelId: `observed-model-${calls}` };
      },
    };
    const entry = (await run(purpose, adapter)).entries[0]!;
    expect(entry.observed_model_id).toBeNull();
    expect(entry.compatible).toBe(false);
    expect(entry.runs).toHaveLength(3);
  });

  it("serializes only the strict safe report and rejects endpoint/content additions", async () => {
    const report = await run("resume_strategy");
    const serialized = serializeConformanceReport(report);
    expect(serialized).not.toMatch(/system|user|raw_response|authorization|credential|https?:\/\//i);
    expect(() => serializeConformanceReport({
      ...report,
      entries: [{ ...report.entries[0], endpoint: "https://private.invalid" }],
    })).toThrow();
  });
});
