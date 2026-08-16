import { describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { PURPOSE_OUTPUT_SCHEMAS } from "../app-platform/contracts/inference.js";
import { conformanceBlocks } from "./conformance-corpus.js";
import { synthesizeResumeE2eResult } from "./e2e-fixture.js";
import { deterministicHostFallback, normalizeHostOwnedResult } from "./host-assistance.js";
import { parsePurposeResult } from "./results.js";
import { validateInferenceClaims } from "./validators.js";

function accepted(purpose: "tailoring_plan" | "targeted_resume_draft" | "resume_revision_draft" | "resume_craft_evaluate", value: unknown): unknown {
  const blocks = conformanceBlocks(purpose);
  const parsed = parsePurposeResult(purpose, PURPOSE_OUTPUT_SCHEMAS[purpose], value);
  expect(validateInferenceClaims(purpose, parsed, blocks).accepted).toBe(true);
  return parsed;
}

describe("Resume Builder host-owned inference structure", () => {
  it("uses the persisted strategy's exact section order for general drafts", () => {
    const purpose = "general_resume_draft" as const;
    const blocks = conformanceBlocks(purpose);
    const proposed = synthesizeResumeE2eResult(purpose, blocks) as { section_order: string[] };
    const expected = (blocks.find((block) => block.category === "resume_strategy")!.data as { section_order: string[] }).section_order;

    const normalized = normalizeHostOwnedResult(purpose, { ...proposed, section_order: ["experience"] }, blocks) as { section_order: string[] };

    expect(normalized.section_order).toEqual(expected);
    const parsed = parsePurposeResult(purpose, PURPOSE_OUTPUT_SCHEMAS[purpose], normalized);
    expect(validateInferenceClaims(purpose, parsed, [...blocks]).accepted).toBe(true);
  });

  it("replaces a redundant ungrammatical model summary with bounded confirmed positioning", () => {
    const purpose = "general_resume_draft" as const;
    const blocks = conformanceBlocks(purpose);
    const proposed = synthesizeResumeE2eResult(purpose, blocks) as {
      statements: Array<{ statement_id: string; section_id: string; display_role?: string; text: string }>;
      [key: string]: unknown;
    };
    const bullet = proposed.statements.find((statement) => statement.section_id === "experience" && statement.display_role !== "heading")!;
    const weakText = `Operations Coordinator with experience ${bullet.text.charAt(0).toLocaleLowerCase("en-US")}${bullet.text.slice(1)}`;
    const weak = { ...proposed, statements: proposed.statements.map((statement) => statement.section_id === "summary" ? { ...statement, text: weakText } : statement) };

    const normalized = normalizeHostOwnedResult(purpose, weak, blocks) as typeof proposed;
    expect(normalized.statements.find((statement) => statement.section_id === "summary")?.text).not.toBe(weakText);
    const parsed = parsePurposeResult(purpose, PURPOSE_OUTPUT_SCHEMAS[purpose], normalized);
    expect(validateInferenceClaims(purpose, parsed, blocks).accepted).toBe(true);
  });

  it("keeps the two-role deterministic draft fallback inside exact owner evidence", () => {
    const purpose = "general_resume_draft" as const;
    const primaryJobId = "71000000-0000-4000-8000-000000000001";
    const priorJobId = "71000000-0000-4000-8000-000000000002";
    const factData = { facts: [
      { revision_id: primaryJobId, fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "Product Lead", employer: "Acme Labs", location: null, start_date: "2020", end_date: "2024", responsibilities: null }) },
      { revision_id: priorJobId, fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "Analyst", employer: "Northwind Partners", location: null, start_date: "2017", end_date: "2020", responsibilities: null }) },
    ] };
    const strategyData = {
      summary_decision: "include",
      section_order: ["summary", "experience"],
      evidence_priorities: [
        { fact_revision_id: primaryJobId, priority: "must_use" },
        { fact_revision_id: priorJobId, priority: "must_use" },
      ],
      omissions: [],
    };
    const blocks = [{
      category: "confirmed_fact_snapshot",
      content_digest: canonicalInputDigest(factData),
      schema_id: "resume.confirmed-fact-snapshot.v1",
      schema_version: 1,
      data: factData,
    }, {
      category: "resume_strategy",
      content_digest: canonicalInputDigest(strategyData),
      schema_id: "resume.strategy.v1",
      schema_version: 1,
      data: strategyData,
    }] as const;

    const fallback = deterministicHostFallback(purpose, blocks) as { statements: Array<{ section_id: string; text: string }> };
    expect(fallback.statements.find((statement) => statement.section_id === "summary")?.text).toBe("Product Lead");
    const parsed = parsePurposeResult(purpose, PURPOSE_OUTPUT_SCHEMAS[purpose], fallback);
    expect(validateInferenceClaims(purpose, parsed, [...blocks]).accepted).toBe(true);
  });

  it("calculates the tailoring decision and exact material-change manifest from immutable inputs", () => {
    const purpose = "tailoring_plan" as const;
    const blocks = conformanceBlocks(purpose);
    const proposed = synthesizeResumeE2eResult(purpose, blocks) as Record<string, unknown>;
    const normalized = normalizeHostOwnedResult(purpose, {
      ...proposed,
      fit_class: "lacking_supported_core_fit",
      outcome: "no_meaningful_change",
      no_change_reason: "insufficient_supported_fit",
      support_counts: { core: 0, transferable: 0, partial: 0, unsupported: 99 },
      changes: [],
    }, blocks) as { outcome: string; changes: unknown[] };

    expect(normalized).toMatchObject({ outcome: "targeted_variant" });
    expect(normalized.changes).toHaveLength(1);
    accepted(purpose, normalized);
  });

  it("reconstructs targeted drafts from the parent and applies language only to planned statements", () => {
    const purpose = "targeted_resume_draft" as const;
    const blocks = conformanceBlocks(purpose);
    const proposed = synthesizeResumeE2eResult(purpose, blocks) as {
      statements: Array<{ statement_id: string; text: string }>;
      [key: string]: unknown;
    };
    const normalized = normalizeHostOwnedResult(purpose, {
      ...proposed,
      title: "Injected target title",
      changed_statement_ids: [],
      statements: proposed.statements.map((statement, index) => index === 0
        ? { ...statement, text: "Unplanned rewrite" }
        : statement.statement_id === "73000000-0000-4000-8000-000000000024"
          ? { ...statement, text: "Reduced incomplete forms from 18% to 6% by standardizing the intake process." }
          : statement),
      section_order: ["skills", "experience"],
    }, blocks) as { title: string; changed_statement_ids: string[]; statements: Array<{ statement_id: string; text: string }>; section_order: string[] };

    expect(normalized.title).toBe("Jordan Lee");
    expect(normalized.changed_statement_ids).toEqual(["73000000-0000-4000-8000-000000000024"]);
    expect(normalized.statements.find((statement) => statement.statement_id === "73000000-0000-4000-8000-000000000021")?.text).not.toBe("Unplanned rewrite");
    expect(normalized.section_order).toEqual(["contact", "summary", "experience"]);
    accepted(purpose, normalized);
  });

  it("returns the honest no-change result when a proposed target differs only by punctuation", () => {
    const purpose = "targeted_resume_draft" as const;
    const blocks = conformanceBlocks(purpose);
    const parent = blocks.find((block) => block.category === "general_resume_definition")!.data as {
      statements: Array<{ statement_id: string; text: string }>;
    };
    const punctuationOnly = {
      statements: parent.statements.map((statement) => statement.statement_id === "73000000-0000-4000-8000-000000000024"
        ? { ...statement, text: statement.text.replace(/[.]$/, "") }
        : statement),
    };

    const normalized = normalizeHostOwnedResult(purpose, punctuationOnly, blocks);
    expect(normalized).toMatchObject({ outcome: "no_meaningful_change", no_change_reason: "no_material_resume_change" });
    accepted(purpose, normalized);
  });

  it("reconstructs revision drafts with stable identities and the exact selected scope", () => {
    const purpose = "resume_revision_draft" as const;
    const blocks = conformanceBlocks(purpose);
    const proposed = synthesizeResumeE2eResult(purpose, blocks) as {
      statements: Array<{ statement_id: string; text: string }>;
      [key: string]: unknown;
    };
    const normalized = normalizeHostOwnedResult(purpose, {
      ...proposed,
      title: "Unexpected title",
      changed_statement_ids: proposed.statements.map((statement) => statement.statement_id),
      statements: proposed.statements.map((statement) => ({ ...statement, statement_id: crypto.randomUUID() })),
      section_order: ["experience", "summary", "contact"],
    }, blocks) as { title: string; changed_statement_ids: string[]; statements: Array<{ statement_id: string }>; section_order: string[] };

    expect(normalized.title).toBe("Jordan Lee");
    expect(normalized.changed_statement_ids).toEqual(["73000000-0000-4000-8000-000000000022"]);
    expect(normalized.statements.map((statement) => statement.statement_id)).toEqual([
      "73000000-0000-4000-8000-000000000021",
      "73000000-0000-4000-8000-000000000022",
      "73000000-0000-4000-8000-000000000023",
      "73000000-0000-4000-8000-000000000024",
    ]);
    expect(normalized.section_order).toEqual(["contact", "summary", "experience"]);
    accepted(purpose, normalized);
  });

  it("uses the deterministic craft evaluator when the model cannot reproduce the report schema", () => {
    const purpose = "resume_craft_evaluate" as const;
    const result = deterministicHostFallback(purpose, conformanceBlocks(purpose));

    expect(result).toMatchObject({ report_version: 2, verdict: "fail" });
    accepted(purpose, result);
  });
});
