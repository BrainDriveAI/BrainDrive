import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ModelAdapter } from "../adapters/base.js";
import { InferencePurposeSchema } from "../app-platform/contracts/inference.js";
import { RESUME_CONFORMANCE_PURPOSES, runResumeModelConformance } from "./conformance.js";
import { RESUME_MODEL_CONFORMANCE_BINDING, conformanceBlocks } from "./conformance-corpus.js";
import { synthesizeResumeE2eResult } from "./e2e-fixture.js";

describe("Resume Builder provider conformance safety", () => {
  it("keeps the runner purpose list synchronized with every versioned inference purpose", () => {
    expect(RESUME_CONFORMANCE_PURPOSES).toEqual(InferencePurposeSchema.options);
    expect(RESUME_CONFORMANCE_PURPOSES).toContain("resume_strategy");
    expect(RESUME_CONFORMANCE_PURPOSES).toContain("resume_craft_evaluate");
    expect(RESUME_CONFORMANCE_PURPOSES).toContain("resume_craft_repair");
  });

  it("supplies purpose-complete strategy, target, evaluation, and repair inputs", () => {
    expect(RESUME_MODEL_CONFORMANCE_BINDING).toMatchObject({
      binding_version: 2,
      evidence_scope: "controlled_provider_conformance",
      quality_standard_revision: 3,
      prompt_policy_version: "8",
      craft_report_schema_id: "resume.craft-quality-report.v2",
      host_assistance_policy_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(conformanceBlocks("resume_strategy").map((item) => item.category)).toEqual(expect.arrayContaining(["confirmed_fact_snapshot", "evidence_annotations", "quality_policy"]));
    expect(conformanceBlocks("general_resume_draft").map((item) => item.category)).toEqual(expect.arrayContaining(["confirmed_fact_snapshot", "resume_strategy", "quality_policy"]));
    expect(conformanceBlocks("tailoring_plan").map((item) => item.category)).toEqual(expect.arrayContaining(["general_resume_definition", "evidence_matrix", "target_fit_policy"]));
    expect(conformanceBlocks("targeted_resume_draft").map((item) => item.category)).toEqual(expect.arrayContaining(["general_resume_definition", "resume_strategy", "target_fit_analysis"]));
    expect(conformanceBlocks("resume_craft_evaluate").map((item) => item.category)).toEqual(expect.arrayContaining(["general_resume_definition", "resume_strategy", "deterministic_findings", "craft_anchor_evidence", "craft_gate_policy"]));
    expect(conformanceBlocks("resume_craft_repair").map((item) => item.category)).toEqual(expect.arrayContaining(["craft_quality_report", "craft_repair_scope"]));
  });

  it("turns provider timeout/loss into safe non-conformance without leaking the provider error", async () => {
    const diagnostics: unknown[] = [];
    const adapter = {
      completeStructuredNoTools: async () => {
        throw new Error("private provider response and credential-shaped secret");
      },
    } as unknown as ModelAdapter;
    const result = await runResumeModelConformance({
      adapter,
      providerProfileId: "synthetic-provider-class",
      modelId: "synthetic-model-class",
      purposes: ["resume_strategy"],
      testedAt: new Date("2026-08-11T12:00:00.000Z"),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    expect(result.entries).toEqual([expect.objectContaining({ purpose: "resume_strategy", compatible: false, schema_success_rate: 0, zero_unsupported_claim_gate: false })]);
    expect(diagnostics).toEqual([{ purpose: "resume_strategy", schemaSuccess: false, findings: [{ code: "provider_non_conformance", safe_message: "The provider operation did not produce conformance evidence" }] }]);
    expect(JSON.stringify({ result, diagnostics })).not.toMatch(/private provider|credential-shaped/);
  });

  it("records the dialogue-specific prompt identity in compatibility evidence", async () => {
    const purpose = "resume_dialogue" as const;
    const blocks = conformanceBlocks(purpose);
    const adapter = {
      completeStructuredNoTools: async () => ({
        text: JSON.stringify(synthesizeResumeE2eResult(purpose, blocks)),
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
    } as unknown as ModelAdapter;

    const result = await runResumeModelConformance({
      adapter,
      providerProfileId: "synthetic-provider-class",
      modelId: "synthetic-model-class",
      purposes: [purpose],
      testedAt: new Date("2026-08-15T12:00:00.000Z"),
    });

    expect(result.entries).toEqual([expect.objectContaining({
      purpose,
      prompt_policy_id: "braindrive.resume-builder.dialogue",
      prompt_policy_version: "3",
      compatible: true,
    })]);
  });

  it("uses one constrained validation repair before recording non-conformance", async () => {
    const purpose = "interview_assist" as const;
    const blocks = conformanceBlocks(purpose);
    const valid = synthesizeResumeE2eResult(purpose, blocks) as { questions: Array<Record<string, unknown>> };
    const invalid = {
      ...valid,
      questions: valid.questions.map((question, index) => index === 0
        ? { ...question, job_fact_revision_id: randomUUID() }
        : question),
    };
    const requests: Array<{ system: string; user: string }> = [];
    const adapter = {
      completeStructuredNoTools: async (request: { system: string; user: string }) => {
        requests.push(request);
        return {
          text: JSON.stringify(requests.length === 1 ? invalid : valid),
          finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      },
    } as unknown as ModelAdapter;

    const result = await runResumeModelConformance({
      adapter,
      providerProfileId: "synthetic-provider-class",
      modelId: "synthetic-model-class",
      purposes: [purpose],
      testedAt: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(requests).toHaveLength(2);
    expect(requests[1]?.system).toMatch(/evidence-validation repair/i);
    expect(result.entries).toEqual([expect.objectContaining({ purpose, compatible: true, schema_success_rate: 1, zero_unsupported_claim_gate: true })]);
  });

  it("applies host strategy canonicalization before deterministic validation", async () => {
    const purpose = "resume_strategy" as const;
    const blocks = conformanceBlocks(purpose);
    const valid = synthesizeResumeE2eResult(purpose, blocks) as {
      role_emphasis: Array<Record<string, unknown>>;
      evidence_priorities: Array<Record<string, unknown>>;
    };
    const nonCanonicalRoleEmphasis = valid.role_emphasis.map((role, index) => index === 0 ? { ...role, bullet_density: "expanded" } : role);
    const nonCanonical = {
      ...valid,
      role_emphasis: [...nonCanonicalRoleEmphasis, nonCanonicalRoleEmphasis[0]],
      evidence_priorities: [...valid.evidence_priorities, valid.evidence_priorities[0]],
    };
    let calls = 0;
    const adapter = {
      completeStructuredNoTools: async () => {
        calls += 1;
        return {
          text: JSON.stringify(nonCanonical),
          finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      },
    } as unknown as ModelAdapter;

    const result = await runResumeModelConformance({
      adapter,
      providerProfileId: "synthetic-provider-class",
      modelId: "synthetic-model-class",
      purposes: [purpose],
      testedAt: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(calls).toBe(1);
    expect(result.entries).toEqual([expect.objectContaining({ purpose, compatible: true, schema_success_rate: 1, zero_unsupported_claim_gate: true })]);
  });

  it("qualifies the four host-assisted purposes by their complete system outcome", async () => {
    const purposes = ["tailoring_plan", "targeted_resume_draft", "resume_revision_draft", "resume_craft_evaluate"] as const;
    for (const purpose of purposes) {
      const blocks = conformanceBlocks(purpose);
      const valid = purpose === "resume_craft_evaluate" ? {} : synthesizeResumeE2eResult(purpose, blocks) as Record<string, unknown>;
      const providerResult = purpose === "tailoring_plan"
        ? { ...valid, support_counts: { core: 0, transferable: 0, partial: 0, unsupported: 99 } }
        : purpose === "targeted_resume_draft"
          ? { ...valid, title: "Injected title", changed_statement_ids: [] }
          : purpose === "resume_revision_draft"
            ? { ...valid, title: "Unexpected title", changed_statement_ids: [] }
            : valid;
      const adapter = {
        completeStructuredNoTools: async () => ({
          text: JSON.stringify(providerResult),
          finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        }),
      } as unknown as ModelAdapter;

      const result = await runResumeModelConformance({
        adapter,
        providerProfileId: "synthetic-provider-class",
        modelId: "synthetic-model-class",
        purposes: [purpose],
        testedAt: new Date("2026-08-11T12:00:00.000Z"),
      });

      expect(result.entries).toEqual([expect.objectContaining({ purpose, compatible: true, schema_success_rate: 1, zero_unsupported_claim_gate: true })]);
    }
  });

  it("includes the production fact-only draft fallback in complete-system conformance", async () => {
    const purpose = "general_resume_draft" as const;
    const blocks = conformanceBlocks(purpose);
    const valid = synthesizeResumeE2eResult(purpose, blocks) as { statements: Array<Record<string, unknown>>; [key: string]: unknown };
    const unsupported = {
      ...valid,
      statements: valid.statements.map((statement, index) => index === 0 ? { ...statement, text: "Invented unsupported achievement 999%" } : statement),
    };
    const adapter = {
      completeStructuredNoTools: async () => ({
        text: JSON.stringify(unsupported),
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
    } as unknown as ModelAdapter;

    const result = await runResumeModelConformance({
      adapter,
      providerProfileId: "synthetic-provider-class",
      modelId: "synthetic-model-class",
      purposes: [purpose],
      testedAt: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result.entries).toEqual([expect.objectContaining({ purpose, compatible: true, schema_success_rate: 1, zero_unsupported_claim_gate: true })]);
  });
});
