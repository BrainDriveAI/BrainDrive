import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ResumeQualityReportSchema,
  loadSyntheticQualityFixtures,
  runAntiOverfitScan,
  runResumeQualityFoundation,
  qualityReportMarkdown,
} from "./quality.js";
import { assertBoundQualityReport, evaluateResumeQuality } from "./quality-runtime.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("credential-free Resume Quality foundation", () => {
  it("is deterministic for one fixed revision and identical synthetic inputs", async () => {
    const revision = "7ba4e8abebdc0032c9c2f8021321585b85397811";
    const first = await runResumeQualityFoundation({ sourceRevision: revision });
    const second = await runResumeQualityFoundation({ sourceRevision: revision });
    expect(second.report_digest).toBe(first.report_digest);
    expect(second.m7_evaluation.report_digest).toBe(first.m7_evaluation.report_digest);
  });

  it("loads only declared synthetic fixtures and emits a sanitized schema-valid report", async () => {
    const fixtures = await loadSyntheticQualityFixtures();
    expect(fixtures.length).toBeGreaterThan(0);
    expect(fixtures.every((fixture) => fixture.synthetic === true)).toBe(true);
    const report = ResumeQualityReportSchema.parse(await runResumeQualityFoundation());
    expect(report.credential_mode).toBe("none");
    expect(report.harness_mode).toBe("complete_m7");
    expect(report.outcome_scope).toBe("credential_free_deterministic_checks");
    expect(report.fixture_count).toBe(fixtures.length);
    expect(JSON.stringify(report)).not.toContain("owner_text");
    expect(JSON.stringify(report)).not.toContain("resume_text");
    for (const fixture of fixtures) {
      for (const literal of fixture.canary_literals) expect(JSON.stringify(report)).not.toContain(literal);
    }
    expect(report.anti_overfit.files_scanned).toBeGreaterThan(1);
    expect(report.anti_overfit.outcome).toBe("passed");
    expect(report.suite_summary.f1_f12_fixture_ids).toHaveLength(12);
    expect(report.suite_summary.mutation).toMatchObject({ caught: 12, total: 12, catch_rate: 1, outcome: "passed" });
    expect(report.suite_summary.clean).toMatchObject({ blocking_false_positives: 0, outcome: "passed" });
    expect(report.suite_summary.personas).toMatchObject({ thresholds_passed: true, outcome: "passed" });
    expect(report.suite_summary.successor_no_regression.outcome).toBe("passed");
    expect(report.authorized_generation).toEqual({ required_runs_per_generative_fixture: 3, completed_runs: 0, status: "awaiting_authorization" });
    expect(report.release_gate).toEqual({
      tier_1_generation: "awaiting_authorization",
      tier_2_artifacts: "passed",
      tier_3_craft: "awaiting_authorized_generation",
      human_calibration: "awaiting_review",
      provider_conformance: "awaiting_authorization",
      numeric_friction: "awaiting_authority",
      retention_deletion: "awaiting_contract",
      release_ready: false,
    });
    expect(report.m7_evaluation).toMatchObject({
      source_revision: expect.stringMatching(/^[a-f0-9]{40}$/),
      outcome_scope: "synthetic_sanitized_evaluation",
      corpus_integrity: {
        outcome: "passed",
        generative_fixture_count: 9,
        holdout_fixture_count: 2,
        parity_mutation_count: 4,
      },
      gates: {
        fixture_integrity: "passed",
        deterministic_foundation: "passed",
        semantic_friction: "passed",
        multi_run: "blocked",
        provider_conformance: "blocked",
        human_calibration: "blocked",
        numeric_friction: "blocked",
        retention_deletion: "blocked",
      },
      release_ready: false,
    });
    expect(qualityReportMarkdown(report)).toContain(`Report digest: \`${report.report_digest}\``);
    const m3 = report.fixture_results.find((result) => result.fixture_id === "m3-job-evidence-synthetic")?.job_evidence_checks;
    expect(m3).toMatchObject({ role_count: 3, role_bullet_count: 4, contextual_skill_count: 1, outcome: "passed", error_codes: [] });
    const m4 = report.fixture_results.find((result) => result.fixture_id === "m4-remembered-successor-synthetic")?.successor_checks;
    expect(m4).toMatchObject({ preserved_line_count: 8, corrected_line_count: 1, added_line_count: 1, outcome: "passed", error_codes: [] });
    const m6 = report.fixture_results.find((result) => result.fixture_id === "m6-revision-successor-synthetic")?.successor_checks;
    expect(m6).toMatchObject({ preserved_line_count: 6, corrected_line_count: 1, added_line_count: 0, outcome: "passed", error_codes: [] });
  });

  it("rejects fixture canary literals in product code or policy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-quality-overfit-")); roots.push(root);
    const product = path.join(root, "product");
    await mkdir(product, { recursive: true });
    await writeFile(path.join(product, "policy.ts"), "export const bad = 'RB6_SYNTHETIC_CANARY_7D91';\n", "utf8");
    await expect(runAntiOverfitScan({ productRoots: [product], canaryLiterals: ["RB6_SYNTHETIC_CANARY_7D91"] }))
      .rejects.toThrow(/anti-overfit/i);
  });
});

describe("runtime Resume Quality gate", () => {
  const definition = () => ({
    title: "Synthetic Owner",
    statements: [
      { statement_id: crypto.randomUUID(), section_id: "contact", kind: "factual" as const, display_role: "line" as const, text: "owner@example.test | https://example.test", supporting_confirmed_fact_revision_ids: [crypto.randomUUID()] },
      { statement_id: crypto.randomUUID(), section_id: "summary", kind: "presentation" as const, display_role: "line" as const, text: "Operations coordinator with supported scheduling experience.", supporting_confirmed_fact_revision_ids: [] },
      { statement_id: crypto.randomUUID(), section_id: "experience", kind: "factual" as const, display_role: "heading" as const, text: "Coordinator | Synthetic Org | 2024–Present", supporting_confirmed_fact_revision_ids: [crypto.randomUUID()] },
      { statement_id: crypto.randomUUID(), section_id: "experience", kind: "factual" as const, display_role: "bullet" as const, text: "Coordinated service schedules across teams.", supporting_confirmed_fact_revision_ids: [crypto.randomUUID()] },
    ],
    section_order: ["contact", "summary", "experience"],
    selected_fact_revision_ids: [] as string[], locale: "en-US", page_intent: "one_page", template_id: "resume.single-column", template_version: "1",
  });

  it("binds a passing deterministic report to exact definition content", () => {
    const input = definition();
    const report = evaluateResumeQuality(input);
    expect(report).toMatchObject({ standard_revision: 3, accepted: true, findings: [] });
    expect(assertBoundQualityReport({ ...input, approval_evidence: {
      quality_report_digest: report.report_digest,
      quality_input_digest: report.input_digest,
      quality_validator_id: report.validator_id,
      quality_validator_version: report.validator_version,
    } })).toEqual(report);
    expect(() => assertBoundQualityReport({ ...input, title: "Changed", approval_evidence: {
      quality_report_digest: report.report_digest,
      quality_input_digest: report.input_digest,
      quality_validator_id: report.validator_id,
      quality_validator_version: report.validator_version,
    } })).toThrow(/stale/i);
  });

  it("blocks accepted mutation classes and has no blocking clean false positive", () => {
    const clean = definition();
    expect(evaluateResumeQuality(clean).accepted).toBe(true);
    const mutations = [
      { ...clean, section_order: [...clean.section_order, "candidate score"] },
      { ...clean, statements: [...clean.statements, { ...clean.statements[3]!, statement_id: crypto.randomUUID() }] },
      { ...clean, statements: clean.statements.map((item, index) => index === 1 ? { ...item, text: "Results-driven, best-in-class rockstar" } : item) },
      { ...clean, statements: clean.statements.map((item, index) => index === 0 ? { ...item, text: "SSN 123-45-6789" } : item) },
    ];
    expect(mutations.every((mutation) => !evaluateResumeQuality(mutation).accepted)).toBe(true);
  });
});
