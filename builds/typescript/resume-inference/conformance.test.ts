import { describe, expect, it } from "vitest";

import type { ModelAdapter } from "../adapters/base.js";
import { InferencePurposeSchema } from "../app-platform/contracts/inference.js";
import { RESUME_CONFORMANCE_PURPOSES, runResumeModelConformance } from "./conformance.js";
import { RESUME_MODEL_CONFORMANCE_BINDING, conformanceBlocks } from "./conformance-corpus.js";

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
});
