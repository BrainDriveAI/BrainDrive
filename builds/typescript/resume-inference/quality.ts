import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { z } from "zod";

import { canonicalInputDigest, NonEmptyStringSchema, Sha256DigestSchema } from "../app-platform/contracts/common.js";
import { evaluateResumeQuality, type QualityDefinition } from "./quality-runtime.js";
import { validateInferenceClaims } from "./validators.js";
import { extractCleanTextFields } from "./clean-text-extractor.js";
import {
  M7DurableQualityReportSchema,
  M7_QUALITY_EVALUATION_SCHEMA_ID,
  buildM7DurableQualityReport,
  loadM7QualityCorpus,
  validateM7FixtureIntegrity,
} from "./quality-evaluation.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "./policy.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultFixtureRoot = path.join(moduleDirectory, "fixtures", "quality");
const execFileAsync = promisify(execFile);

export const SyntheticQualityFixtureSchema = z.object({
  fixture_schema_version: z.literal(1),
  fixture_id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  synthetic: z.literal(true),
  persona: z.enum(["early_career", "thin_history", "career_changer", "recent_loss", "senior", "metric_poor", "renderer_failure"]),
  canary_literals: z.array(z.string().min(12).max(128)).min(1).max(16),
  approved_definition: z.object({
    sections: z.array(NonEmptyStringSchema).min(1).max(16),
    logical_lines: z.array(z.string().min(1).max(2_048)).min(1).max(500),
  }).strict(),
  expected_recovery: z.object({
    section_count: z.number().int().positive().max(16),
    line_count: z.number().int().positive().max(500),
  }).strict(),
  m3_job_evidence: z.object({
    confirmed_evidence_revision_ids: z.array(z.string().uuid()).min(1).max(100),
    roles: z.array(z.object({
      job_revision_id: z.string().uuid(),
      role_class: z.enum(["substantive", "sparse", "older"]),
      answered_evidence_revision_ids: z.array(z.string().uuid()).max(12),
      output_bullets: z.array(z.object({ text: z.string().min(1).max(512), supporting_revision_ids: z.array(z.string().uuid()).min(1).max(12) }).strict()).max(6),
      contextual_skill_statements: z.array(z.object({ text: z.string().min(1).max(512), supporting_revision_ids: z.array(z.string().uuid()).min(1).max(12) }).strict()).max(6),
      summary_statements: z.array(z.object({ text: z.string().min(1).max(512), supporting_revision_ids: z.array(z.string().uuid()).min(1).max(12) }).strict()).max(4),
    }).strict()).min(1).max(12),
    chronological_job_revision_ids: z.array(z.string().uuid()).min(1).max(12),
    output_job_revision_ids: z.array(z.string().uuid()).min(1).max(12),
    optional_question_prompts: z.array(z.string().min(1).max(512)).min(1).max(20),
  }).strict().optional(),
  m4_successor: z.object({
    source_logical_lines: z.array(z.string().min(1).max(2_048)).min(1).max(500),
    successor_logical_lines: z.array(z.string().min(1).max(2_048)).min(1).max(500),
    expected_preserved_lines: z.array(z.string().min(1).max(2_048)).min(1).max(500),
    corrected_lines: z.array(z.object({ before: z.string().min(1).max(2_048), after: z.string().min(1).max(2_048) }).strict()).min(1).max(100),
    added_lines: z.array(z.string().min(1).max(2_048)).max(100),
  }).strict().optional(),
  m6_revision_successor: z.object({
    classification: z.enum(["presentation", "factual", "mixed"]),
    source_logical_lines: z.array(z.string().min(1).max(2_048)).min(1).max(500),
    successor_logical_lines: z.array(z.string().min(1).max(2_048)).min(1).max(500),
    expected_preserved_lines: z.array(z.string().min(1).max(2_048)).min(1).max(500),
    rewritten_lines: z.array(z.object({ before: z.string().min(1).max(2_048), after: z.string().min(1).max(2_048) }).strict()).min(1).max(100),
    source_support_revision_ids: z.array(z.string().uuid()).min(1).max(500),
    successor_support_revision_ids: z.array(z.string().uuid()).min(1).max(500),
  }).strict().optional(),
}).strict();

export type SyntheticQualityFixture = z.infer<typeof SyntheticQualityFixtureSchema>;

export const ResumeQualityReportSchema = z.object({
  report_schema_version: z.literal(1),
  standard_revision: z.literal(3),
  harness_mode: z.literal("complete_m7"),
  outcome_scope: z.literal("credential_free_deterministic_checks"),
  credential_mode: z.literal("none"),
  fixture_count: z.number().int().nonnegative(),
  fixture_results: z.array(z.object({
    fixture_id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
    fixture_digest: Sha256DigestSchema,
    extractor_boundary: z.literal("independent_clean_text_extractor_v1"),
    section_count: z.number().int().nonnegative(),
    line_count: z.number().int().nonnegative(),
    outcome: z.enum(["passed", "failed"]),
    error_codes: z.array(z.enum(["section_count_mismatch", "line_count_mismatch"])).max(2),
    job_evidence_checks: z.object({
      role_count: z.number().int().nonnegative(),
      role_bullet_count: z.number().int().nonnegative(),
      contextual_skill_count: z.number().int().nonnegative(),
      summary_statement_count: z.number().int().nonnegative(),
      question_count: z.number().int().nonnegative(),
      outcome: z.enum(["passed", "failed"]),
      error_codes: z.array(z.enum(["unsupported_support", "role_density", "padding", "metric_pressure", "history_shape"])).max(5),
    }).strict().nullable(),
    successor_checks: z.object({
      preserved_line_count: z.number().int().nonnegative(),
      corrected_line_count: z.number().int().nonnegative(),
      added_line_count: z.number().int().nonnegative(),
      outcome: z.enum(["passed", "failed"]),
      error_codes: z.array(z.enum(["preservation", "correction", "addition", "structure_regression", "repetition_regression", "generic_language", "support_regression"])).max(7),
    }).strict().nullable(),
  }).strict()),
  anti_overfit: z.object({
    scanner_version: z.literal(1),
    files_scanned: z.number().int().nonnegative(),
    literal_count: z.number().int().nonnegative(),
    outcome: z.enum(["passed", "failed"]),
  }).strict(),
  suite_summary: z.object({
    f1_f12_fixture_ids: z.array(z.string()).length(12),
    mutation: z.object({ total: z.number().int().positive(), caught: z.number().int().nonnegative(), catch_rate: z.number().min(0).max(1), outcome: z.enum(["passed", "failed"]) }).strict(),
    clean: z.object({ total: z.number().int().positive(), blocking_false_positives: z.number().int().nonnegative(), outcome: z.enum(["passed", "failed"]) }).strict(),
    personas: z.object({ covered: z.array(z.string()), thresholds_passed: z.boolean(), outcome: z.enum(["passed", "failed"]) }).strict(),
    successor_no_regression: z.object({ fixture_id: z.literal("f9-strong-successor-synthetic"), outcome: z.enum(["passed", "failed"]) }).strict(),
  }).strict(),
  authorized_generation: z.object({ required_runs_per_generative_fixture: z.literal(3), completed_runs: z.number().int().nonnegative(), status: z.enum(["awaiting_authorization", "completed"]) }).strict(),
  release_gate: z.object({
    tier_1_generation: z.enum(["awaiting_authorization", "passed", "failed"]),
    tier_2_artifacts: z.enum(["passed", "failed"]),
    tier_3_craft: z.enum(["awaiting_authorized_generation", "awaiting_calibration", "passed", "failed"]),
    human_calibration: z.enum(["awaiting_review", "passed", "failed"]),
    provider_conformance: z.enum(["awaiting_authorization", "passed", "failed"]),
    numeric_friction: z.enum(["awaiting_authority", "passed", "failed"]),
    retention_deletion: z.enum(["awaiting_contract", "passed", "failed"]),
    release_ready: z.boolean(),
  }).strict(),
  m7_evaluation: M7DurableQualityReportSchema,
  outcome: z.enum(["passed", "failed"]),
  report_digest: Sha256DigestSchema,
}).strict().superRefine((value, context) => {
  const { report_digest: _digest, ...body } = value;
  if (value.report_digest !== canonicalInputDigest(body)) context.addIssue({ code: "custom", path: ["report_digest"], message: "quality report digest mismatch" });
  if ((value.outcome === "passed") !== (value.fixture_results.every((result) => result.outcome === "passed") && value.anti_overfit.outcome === "passed" && value.suite_summary.mutation.outcome === "passed" && value.suite_summary.clean.outcome === "passed" && value.suite_summary.personas.outcome === "passed" && value.suite_summary.successor_no_regression.outcome === "passed")) {
    context.addIssue({ code: "custom", path: ["outcome"], message: "quality report outcome disagrees with foundation checks" });
  }
});

export async function loadSyntheticQualityFixtures(fixtureRoot = defaultFixtureRoot): Promise<SyntheticQualityFixture[]> {
  const entries = (await readdir(fixtureRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));
  const fixtures = await Promise.all(entries.map(async (entry) =>
    SyntheticQualityFixtureSchema.parse(JSON.parse(await readFile(path.join(fixtureRoot, entry.name), "utf8")))));
  if (new Set(fixtures.map((fixture) => fixture.fixture_id)).size !== fixtures.length) throw new Error("Synthetic quality fixtures contain duplicate identities");
  return fixtures;
}

export function extractQualityFieldsIndependently(fixture: SyntheticQualityFixture): { section_count: number; line_count: number } {
  const extracted = extractCleanTextFields(`${fixture.approved_definition.logical_lines.join("\n")}\n`);
  return {
    section_count: extracted.headings.filter((heading) => fixture.approved_definition.sections.includes(heading)).length,
    line_count: extracted.line_count,
  };
}

function evaluateM3JobEvidence(fixture: SyntheticQualityFixture) {
  const suite = fixture.m3_job_evidence;
  if (!suite) return null;
  const allowed = new Set(suite.confirmed_evidence_revision_ids);
  const errors = new Set<"unsupported_support" | "role_density" | "padding" | "metric_pressure" | "history_shape">();
  let roleBulletCount = 0, contextualSkillCount = 0, summaryStatementCount = 0;
  for (const role of suite.roles) {
    roleBulletCount += role.output_bullets.length;
    contextualSkillCount += role.contextual_skill_statements.length;
    summaryStatementCount += role.summary_statements.length;
    const maximum = role.role_class === "substantive" ? Math.min(6, role.answered_evidence_revision_ids.length) : Math.min(2, role.answered_evidence_revision_ids.length);
    if (role.output_bullets.length > maximum) errors.add("role_density");
    const normalized = role.output_bullets.map((item) => item.text.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"));
    if (new Set(normalized).size !== normalized.length) errors.add("padding");
    for (const statement of [...role.output_bullets, ...role.contextual_skill_statements, ...role.summary_statements]) {
      if (statement.supporting_revision_ids.some((id) => !allowed.has(id))) errors.add("unsupported_support");
    }
    if (role.contextual_skill_statements.some((statement) => !statement.supporting_revision_ids.includes(role.job_revision_id) || statement.supporting_revision_ids.length < 2)) errors.add("unsupported_support");
  }
  if (suite.optional_question_prompts.some((prompt) => /\b(?:must|required|exact (?:number|percentage)|give (?:me )?a (?:number|percentage))\b/i.test(prompt))) errors.add("metric_pressure");
  if (suite.chronological_job_revision_ids.join("|") !== suite.output_job_revision_ids.join("|")) errors.add("history_shape");
  return {
    role_count: suite.roles.length,
    role_bullet_count: roleBulletCount,
    contextual_skill_count: contextualSkillCount,
    summary_statement_count: summaryStatementCount,
    question_count: suite.optional_question_prompts.length,
    outcome: errors.size === 0 ? "passed" as const : "failed" as const,
    error_codes: [...errors],
  };
}

function evaluateM4Successor(fixture: SyntheticQualityFixture) {
  const revision = fixture.m6_revision_successor;
  const suite = fixture.m4_successor ?? (revision ? {
    source_logical_lines: revision.source_logical_lines,
    successor_logical_lines: revision.successor_logical_lines,
    expected_preserved_lines: revision.expected_preserved_lines,
    corrected_lines: revision.rewritten_lines,
    added_lines: [] as string[],
  } : undefined);
  if (!suite) return null;
  const errors = new Set<"preservation" | "correction" | "addition" | "structure_regression" | "repetition_regression" | "generic_language" | "support_regression">();
  const source = new Set(suite.source_logical_lines);
  const successor = new Set(suite.successor_logical_lines);
  if (suite.expected_preserved_lines.some((line) => !source.has(line) || !successor.has(line))) errors.add("preservation");
  if (suite.corrected_lines.some(({ before, after }) => !source.has(before) || successor.has(before) || !successor.has(after))) errors.add("correction");
  if (suite.added_lines.some((line) => source.has(line) || !successor.has(line))) errors.add("addition");
  const headings = new Set(fixture.approved_definition.sections);
  const sourceHeadings = suite.source_logical_lines.filter((line) => headings.has(line));
  const successorHeadings = suite.successor_logical_lines.filter((line) => headings.has(line));
  if (sourceHeadings.join("|") !== successorHeadings.join("|")) errors.add("structure_regression");
  const duplicateCount = (lines: readonly string[]) => {
    const normalized = lines.map((line) => line.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"));
    return normalized.length - new Set(normalized).size;
  };
  if (duplicateCount(suite.successor_logical_lines) > duplicateCount(suite.source_logical_lines)) errors.add("repetition_regression");
  if (suite.successor_logical_lines.some((line) => /\b(?:results-driven|detail-oriented|go-getter|rockstar|best-in-class)\b/i.test(line))) errors.add("generic_language");
  if (revision && canonicalInputDigest([...revision.source_support_revision_ids].sort()) !== canonicalInputDigest([...revision.successor_support_revision_ids].sort())) errors.add("support_regression");
  return {
    preserved_line_count: suite.expected_preserved_lines.length,
    corrected_line_count: suite.corrected_lines.length,
    added_line_count: suite.added_lines.length,
    outcome: errors.size === 0 ? "passed" as const : "failed" as const,
    error_codes: [...errors],
  };
}

async function sourceFiles(root: string): Promise<string[]> {
  const stats = await import("node:fs/promises").then(({ stat }) => stat(root));
  if (stats.isFile()) return [root];
  const results: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (["node_modules", "dist", "fixtures", "schemas"].includes(entry.name) || entry.name.endsWith(".test.ts")) continue;
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...await sourceFiles(candidate));
    else if (entry.isFile() && /\.(?:ts|tsx|js|mjs|html)$/.test(entry.name)) results.push(candidate);
  }
  return results;
}

export async function runAntiOverfitScan(input: { productRoots: string[]; canaryLiterals: string[] }): Promise<{ files_scanned: number; literal_count: number; outcome: "passed" }> {
  const literals = [...new Set(input.canaryLiterals)];
  const files = (await Promise.all(input.productRoots.map(sourceFiles))).flat();
  for (const file of files) {
    const contents = await readFile(file, "utf8");
    if (literals.some((literal) => contents.includes(literal))) throw new Error("Resume quality anti-overfit scan rejected a fixture literal in product code or policy");
  }
  return { files_scanned: files.length, literal_count: literals.length, outcome: "passed" };
}

async function currentGitRevision(): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: path.resolve(moduleDirectory, "../../..") });
  const revision = stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Resume quality harness could not bind evidence to a full Git revision");
  return revision;
}

export async function runResumeQualityFoundation(options: { fixtureRoot?: string; productRoots?: string[]; sourceRevision?: string } = {}) {
  const fixtures = await loadSyntheticQualityFixtures(options.fixtureRoot);
  const m7Corpus = await loadM7QualityCorpus();
  const m7CorpusIntegrity = validateM7FixtureIntegrity(m7Corpus);
  const fixtureResults = fixtures.map((fixture) => {
    const extracted = extractQualityFieldsIndependently(fixture);
    const errorCodes: Array<"section_count_mismatch" | "line_count_mismatch"> = [];
    if (extracted.section_count !== fixture.expected_recovery.section_count) errorCodes.push("section_count_mismatch");
    if (extracted.line_count !== fixture.expected_recovery.line_count) errorCodes.push("line_count_mismatch");
    const jobEvidenceChecks = evaluateM3JobEvidence(fixture);
    const successorChecks = evaluateM4Successor(fixture);
    return {
      fixture_id: fixture.fixture_id,
      fixture_digest: canonicalInputDigest(fixture),
      extractor_boundary: "independent_clean_text_extractor_v1" as const,
      ...extracted,
      outcome: errorCodes.length === 0 && (!jobEvidenceChecks || jobEvidenceChecks.outcome === "passed") && (!successorChecks || successorChecks.outcome === "passed") ? "passed" as const : "failed" as const,
      error_codes: errorCodes,
      job_evidence_checks: jobEvidenceChecks,
      successor_checks: successorChecks,
    };
  });
  const productRoots = options.productRoots ?? [
    moduleDirectory,
    path.resolve(moduleDirectory, "../resume-domain"),
    path.resolve(moduleDirectory, "../resume-renderer"),
    path.resolve(moduleDirectory, "../../resume_builder/src"),
  ];
  const antiOverfit = await runAntiOverfitScan({ productRoots, canaryLiterals: fixtures.flatMap((fixture) => fixture.canary_literals) });
  const f1F12 = fixtures.filter((fixture) => /^f(?:[1-9]|1[0-2])-/.test(fixture.fixture_id)).sort((left, right) => Number(left.fixture_id.match(/^f(\d+)/)?.[1]) - Number(right.fixture_id.match(/^f(\d+)/)?.[1]));
  const proof = validatorProof();
  const coveredPersonas = [...new Set(f1F12.map((fixture) => fixture.persona))].sort();
  const f9 = fixtureResults.find((result) => result.fixture_id === "f9-strong-successor-synthetic");
  const suiteSummary = {
    f1_f12_fixture_ids: f1F12.map((fixture) => fixture.fixture_id),
    mutation: { total: proof.mutationTotal, caught: proof.mutationCaught, catch_rate: proof.mutationCaught / proof.mutationTotal, outcome: proof.mutationCaught === proof.mutationTotal ? "passed" as const : "failed" as const },
    clean: { total: proof.cleanTotal, blocking_false_positives: proof.cleanFalsePositives, outcome: proof.cleanFalsePositives === 0 ? "passed" as const : "failed" as const },
    personas: { covered: coveredPersonas, thresholds_passed: f1F12.length === 12 && coveredPersonas.length >= 7, outcome: f1F12.length === 12 && coveredPersonas.length >= 7 ? "passed" as const : "failed" as const },
    successor_no_regression: { fixture_id: "f9-strong-successor-synthetic" as const, outcome: f9?.successor_checks?.outcome === "passed" ? "passed" as const : "failed" as const },
  };
  const sourceRevision = options.sourceRevision ?? await currentGitRevision();
  if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw new Error("Resume quality harness requires a full Git revision");
  const deterministicFoundation = {
    fixture_results: fixtureResults,
    anti_overfit: antiOverfit,
    suite_summary: suiteSummary,
    m7_corpus_integrity: m7CorpusIntegrity,
  };
  const m7Evaluation = buildM7DurableQualityReport({
    binding: {
      source_revision: sourceRevision,
      quality_standard_revision: 3,
      prompt_policy_digest: canonicalInputDigest({ policy_id: RESUME_PROMPT_POLICY_ID, policy_version: RESUME_PROMPT_POLICY_VERSION }),
      rubric_digest: canonicalInputDigest({ standard: "resume-quality", revision: 3 }),
      fixture_corpus_digest: canonicalInputDigest(m7Corpus),
      report_schema_digest: canonicalInputDigest({ schema_id: M7_QUALITY_EVALUATION_SCHEMA_ID, schema_version: 1 }),
    },
    corpus_integrity: m7CorpusIntegrity,
    deterministic_foundation: {
      status: fixtureResults.every((result) => result.outcome === "passed") && antiOverfit.outcome === "passed" && suiteSummary.mutation.outcome === "passed" && suiteSummary.clean.outcome === "passed" && suiteSummary.personas.outcome === "passed" && suiteSummary.successor_no_regression.outcome === "passed" ? "passed" : "failed",
      report_digest: canonicalInputDigest(deterministicFoundation),
    },
  });
  const body = {
    report_schema_version: 1 as const,
    standard_revision: 3 as const,
    harness_mode: "complete_m7" as const,
    outcome_scope: "credential_free_deterministic_checks" as const,
    credential_mode: "none" as const,
    fixture_count: fixtures.length,
    fixture_results: fixtureResults,
    anti_overfit: { scanner_version: 1 as const, ...antiOverfit },
    suite_summary: suiteSummary,
    authorized_generation: { required_runs_per_generative_fixture: 3 as const, completed_runs: 0, status: "awaiting_authorization" as const },
    release_gate: {
      tier_1_generation: "awaiting_authorization" as const,
      tier_2_artifacts: fixtureResults.every((result) => result.outcome === "passed") ? "passed" as const : "failed" as const,
      tier_3_craft: "awaiting_authorized_generation" as const,
      human_calibration: "awaiting_review" as const,
      provider_conformance: "awaiting_authorization" as const,
      numeric_friction: "awaiting_authority" as const,
      retention_deletion: "awaiting_contract" as const,
      release_ready: false,
    },
    m7_evaluation: m7Evaluation,
    outcome: fixtureResults.every((result) => result.outcome === "passed") && antiOverfit.outcome === "passed" && suiteSummary.mutation.outcome === "passed" && suiteSummary.clean.outcome === "passed" && suiteSummary.personas.outcome === "passed" && suiteSummary.successor_no_regression.outcome === "passed" ? "passed" as const : "failed" as const,
  };
  return ResumeQualityReportSchema.parse({ ...body, report_digest: canonicalInputDigest(body) });
}

export function qualityReportMarkdown(report: z.infer<typeof ResumeQualityReportSchema>): string {
  const summary = report.suite_summary;
  return [
    "# Resume Quality Report",
    "",
    `- Report digest: \`${report.report_digest}\``,
    `- Deterministic outcome: ${report.outcome}`,
    `- Outcome scope: ${report.outcome_scope}`,
    `- Synthetic fixtures: ${report.fixture_count} (${summary.f1_f12_fixture_ids.length} F1–F12 fixtures)`,
    `- Mutation catch: ${summary.mutation.caught}/${summary.mutation.total}`,
    `- Blocking clean false positives: ${summary.clean.blocking_false_positives}/${summary.clean.total}`,
    `- Persona thresholds: ${summary.personas.outcome}`,
    `- F9 successor no-regression: ${summary.successor_no_regression.outcome}`,
    `- Anti-overfit: ${report.anti_overfit.outcome}`,
    `- Authorized generation: ${report.authorized_generation.status} (${report.authorized_generation.completed_runs} completed; ${report.authorized_generation.required_runs_per_generative_fixture} required per generative fixture)`,
    `- Tier 3 craft: ${report.release_gate.tier_3_craft}`,
    `- Human calibration: ${report.release_gate.human_calibration}`,
    `- Provider conformance: ${report.release_gate.provider_conformance}`,
    `- Numeric friction: ${report.release_gate.numeric_friction}`,
    `- Retention/deletion: ${report.release_gate.retention_deletion}`,
    `- M7 corpus integrity: ${report.m7_evaluation.gates.fixture_integrity} (${report.m7_evaluation.corpus_integrity.generative_fixture_count} generative, ${report.m7_evaluation.corpus_integrity.holdout_fixture_count} holdout)`,
    `- M7 must-use cases: ${report.m7_evaluation.corpus_integrity.must_use_case_count}`,
    `- M7 coverage/yield journeys: ${report.m7_evaluation.corpus_integrity.coverage_journey_count}`,
    `- M7 target cases: ${report.m7_evaluation.corpus_integrity.target_case_count}`,
    `- M7 craft/repair cases: ${report.m7_evaluation.corpus_integrity.craft_case_count}/${report.m7_evaluation.corpus_integrity.repair_case_count}`,
    `- M7 successor pairs: ${report.m7_evaluation.corpus_integrity.successor_pair_count}`,
    `- M7 parity mutations: ${report.m7_evaluation.corpus_integrity.parity_mutation_count}`,
    `- M7 normalized friction journeys: ${report.m7_evaluation.corpus_integrity.friction_journey_count} (semantic ${report.m7_evaluation.gates.semantic_friction}; numeric ${report.m7_evaluation.gates.numeric_friction})`,
    `- M7 multi-run gate: ${report.m7_evaluation.gates.multi_run}`,
    `- Release ready: ${report.release_gate.release_ready}`,
    "",
  ].join("\n");
}

function validatorProof(): { mutationTotal: number; mutationCaught: number; cleanTotal: number; cleanFalsePositives: number } {
  const factId = "7f000000-0000-4000-8000-000000000001";
  const source = "Engineer at Acme in 2024 delivered release 20% using TypeScript in Boston https://example.test";
  const data = { facts: [{ revision_id: factId, fact_kind: "accomplishment", value: source, source_revision_ids: ["7f000000-0000-4000-8000-000000000002"] }] };
  const blocks = [{ category: "confirmed_fact_snapshot" as const, content_digest: canonicalInputDigest(data), schema_id: "resume.confirmed-facts.v1", schema_version: 1 as const, data }];
  const mutations = [
    "Engineer at Acme in 2024 delivered release 21% using TypeScript in Boston https://example.test",
    "Director at Acme in 2024 delivered release 20% using TypeScript in Boston https://example.test",
    "Engineer at Acme in 2025 delivered release 20% using TypeScript in Boston https://example.test",
    "Engineer at Acme in 2024 delivered release 20% using TypeScript in Seattle https://example.test",
    "Engineer at Acme in 2024 delivered release 20% using Python in Boston https://example.test",
    "Led Acme in 2024 and delivered release 20% using TypeScript in Boston https://example.test",
    "Senior Engineer at Acme in 2024 delivered release 20% using TypeScript in Boston https://example.test",
    "Certified Engineer at Acme in 2024 delivered release 20% using TypeScript in Boston https://example.test",
    "Engineer at Acme in 2024 led a team of 9 and delivered release 20% using TypeScript in Boston https://example.test",
    "Engineer at Acme in 2024 owned strategy and delivered release 20% using TypeScript in Boston https://example.test",
    "Expert Engineer at Acme in 2024 delivered release 20% using TypeScript in Boston https://example.test",
    "Engineer at Acme in 2024 delivered release 20% using TypeScript in Boston https://other.test",
  ];
  const validate = (text: string) => validateInferenceClaims("general_resume_draft", { statements: [{ statement_id: "7f000000-0000-4000-8000-000000000003", section_id: "experience", kind: "factual", text, supporting_confirmed_fact_revision_ids: [factId] }] }, blocks).accepted;
  const cleanDefinition: QualityDefinition = { title: "Synthetic Owner", statements: [{ statement_id: "7f000000-0000-4000-8000-000000000004", section_id: "experience", kind: "factual", display_role: "bullet", text: "Delivered a supported release.", supporting_confirmed_fact_revision_ids: [factId] }], section_order: ["experience"], selected_fact_revision_ids: [factId], locale: "en-US", page_intent: "one_page", template_id: "resume.single-column", template_version: "1" };
  const cleanResults = [validate(source), evaluateResumeQuality(cleanDefinition).accepted];
  return { mutationTotal: mutations.length, mutationCaught: mutations.filter((text) => !validate(text)).length, cleanTotal: cleanResults.length, cleanFalsePositives: cleanResults.filter((accepted) => !accepted).length };
}
