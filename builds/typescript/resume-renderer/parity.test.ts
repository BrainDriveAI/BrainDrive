import { describe, expect, it } from "vitest";

import type { ResumeDefinitionRecordSchema } from "../app-platform/contracts/data.js";
import type { z } from "zod";
import { verifyArtifactParity } from "./parity.js";
import { renderApprovedResume, renderApprovedResumeCleanText, renderApprovedResumeMarkdown } from "./renderer.js";
import { evaluateResumeQuality } from "../resume-inference/quality-runtime.js";

type ResumeDefinition = z.infer<typeof ResumeDefinitionRecordSchema>;

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;

function definition(): ResumeDefinition {
  const candidate = {
    schema_version: 3,
    record_type: "resume_definition",
    metadata: { record_id: id(1), revision_id: id(2), revision: 2, prior_revision_id: id(3), created_at: "2026-08-11T12:00:00.000Z", created_by: { owner_id: id(6), actor_id: id(4), app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive", package_digest: digest("9"), installation_id: id(7) }, extensions: {} },
    owner_id: id(6), updated_at: "2026-08-11T12:00:00.000Z", lifecycle_state: "active", sensitivity: "standard", retention_class: "durable_owner_data", extensions: {},
    definition_kind: "general", status: "approved", title: "Owner Name",
    statements: [
      { statement_id: id(10), section_id: "contact", kind: "factual", text: "Owner Name | owner@example.test", supporting_confirmed_fact_revision_ids: [id(20)] },
      { statement_id: id(11), section_id: "experience", kind: "factual", display_role: "heading", text: "Lead Engineer | Example Co | 2020–Present", supporting_confirmed_fact_revision_ids: [id(21)] },
      { statement_id: id(12), section_id: "experience", kind: "factual", text: "Built accessible owner-facing workflows", supporting_confirmed_fact_revision_ids: [id(22)] },
    ],
    selected_fact_revision_ids: [id(20), id(21), id(22)], section_order: ["contact", "experience"], presentation_preferences: {}, locale: "en-US", page_intent: "one_page", template_id: "resume.single-column", template_version: "1", parent_definition_revision_id: null, job_revision_id: null, policy_version: "1", prompt_policy_version: null, strategy_binding: null, approved_at: "2026-08-11T12:00:00.000Z",
    approval_evidence: { validation_run_id: id(30), validator_id: "validator", validator_version: "1", validator_policy_digest: digest("a"), input_snapshot_digest: digest("b"), output_digest: digest("c"), findings_digest: digest("d"), prompt_policy_id: "owner-authored", prompt_policy_version: "owner-edit-v1", provider_policy_id: "no-provider-owner-edit-v1", quality_report_digest: digest("e"), quality_input_digest: digest("f"), quality_validator_id: "quality", quality_validator_version: "1", validated_at: "2026-08-11T12:00:00.000Z" },
    successor_context: null,
  } as ResumeDefinition;
  const quality = evaluateResumeQuality(candidate);
  return { ...candidate, approval_evidence: { ...candidate.approval_evidence!, quality_report_digest: quality.report_digest, quality_input_digest: quality.input_digest, quality_validator_id: quality.validator_id, quality_validator_version: quality.validator_version } };
}

describe("independent artifact parity verifier", () => {
  it("reconstructs all five representations without using the renderer logical manifest", () => {
    const approved = definition();
    const pdf = renderApprovedResume(approved);
    const clean = renderApprovedResumeCleanText(approved);
    const markdown = renderApprovedResumeMarkdown(approved);
    const result = verifyArtifactParity({ definition: approved, preview_lines: pdf.logical_lines, clean_text: clean.text, pdf_bytes: pdf.bytes, career_markdown: markdown, checked_at: "2026-08-11T12:01:00.000Z" });
    expect(result.report).toMatchObject({ disposition: "pass", mismatch_categories: [] });
    expect(new Set(result.report.representations.map((entry) => entry.logical_manifest_digest)).size).toBe(1);
    expect(result.unsafe_representations).toEqual([]);
    expect(result.approved_source_lines).toEqual(pdf.logical_lines);
  });

  it("classifies a mutated preview independently and blocks only that side effect", () => {
    const approved = definition();
    const pdf = renderApprovedResume(approved);
    const result = verifyArtifactParity({
      definition: approved,
      preview_lines: pdf.logical_lines.map((line) => line.includes("Built accessible owner-facing workflows") ? "- Built fabricated workflows" : line),
      clean_text: renderApprovedResumeCleanText(approved).text,
      pdf_bytes: pdf.bytes,
      career_markdown: renderApprovedResumeMarkdown(approved),
      checked_at: "2026-08-11T12:01:00.000Z",
    });
    expect(result.report.disposition).toBe("block_preview");
    expect(result.unsafe_representations).toEqual(["preview"]);
    expect(result.report.mismatch_categories).toContain("normalized_digest");
  });

  it("keeps an independently reconstructed approved-source fallback when clean text is unsafe", () => {
    const approved = definition();
    const pdf = renderApprovedResume(approved);
    const result = verifyArtifactParity({
      definition: approved,
      preview_lines: pdf.logical_lines,
      clean_text: "Owner Name\n\nExperience\n- Fabricated claim\n",
      pdf_bytes: pdf.bytes,
      career_markdown: renderApprovedResumeMarkdown(approved),
      checked_at: "2026-08-11T12:01:00.000Z",
    });
    expect(result.report.disposition).toBe("block_export");
    expect(result.unsafe_representations).toEqual(["clean_text"]);
    expect(result.approved_source_lines).toEqual(pdf.logical_lines);
    expect(result.approved_source_lines).not.toContain("- Fabricated claim");
  });
});
