import { access, lstat, readFile, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  canonicalInputDigest,
  NonEmptyStringSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from "../app-platform/contracts/common.js";
import { InferencePurposeSchema } from "../app-platform/contracts/inference.js";
import { FrozenQualityRegressionManifestSchema } from "../app-platform/contracts/data.js";
import { CRAFT_EVIDENCE_LIMITED_POLICY_DIGEST, PRODUCT_CRAFT_EVALUATOR } from "./craft-evaluator.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "./policy.js";
import { RESUME_QUALITY_STANDARD_DIGEST } from "./strategy.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultCorpusPath = path.join(moduleDirectory, "fixtures", "m7-quality-corpus.json");
const defaultFrozenManifestDirectory = path.join(moduleDirectory, "fixtures", "quality");

export const CORRECTED_CRAFT_REPORT_SCHEMA_ID = "resume.craft-quality-report.v2" as const;
export const CORRECTED_CRAFT_REPORT_SCHEMA_DIGEST = canonicalInputDigest({
  schema_id: CORRECTED_CRAFT_REPORT_SCHEMA_ID,
  schema_version: 2,
});
export const CORRECTED_PROMPT_POLICY_DIGEST = canonicalInputDigest({
  policy_id: RESUME_PROMPT_POLICY_ID,
  policy_version: RESUME_PROMPT_POLICY_VERSION,
});

const SafeIdentitySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,127}$/);
const FullGitRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
const GateVerdictSchema = z.enum(["passed", "failed", "not_applicable"]);
const RequiredGateVerdictSchema = z.enum(["passed", "failed"]);
const ControlledGateStatusSchema = z.enum(["blocked", "passed", "failed"]);

export const M7EvaluationBindingSchema = z.object({
  source_revision: FullGitRevisionSchema,
  quality_standard_revision: z.literal(3),
  quality_standard_digest: Sha256DigestSchema,
  prompt_policy_digest: Sha256DigestSchema,
  rubric_digest: Sha256DigestSchema,
  evaluator_contract_digest: Sha256DigestSchema,
  fixture_corpus_digest: Sha256DigestSchema,
  craft_report_schema_digest: Sha256DigestSchema,
  report_schema_digest: Sha256DigestSchema,
}).strict();

export type M7EvaluationBinding = z.infer<typeof M7EvaluationBindingSchema>;

const EvidenceCaseSchema = z.object({
  fixture_id: SafeIdentitySchema,
  strong_evidence_ids: z.array(SafeIdentitySchema).min(1).max(32),
  must_use_evidence_ids: z.array(SafeIdentitySchema).min(1).max(32),
  used_evidence_ids: z.array(SafeIdentitySchema).max(32),
  omissions: z.array(z.object({
    evidence_id: SafeIdentitySchema,
    reason: z.enum(["owner_requested_exclusion", "target_irrelevant", "space_constraint_after_higher_priority"]),
  }).strict()).max(32),
}).strict();

const CoverageJourneySchema = z.object({
  journey_id: SafeIdentitySchema,
  history_shape: z.enum(["sparse", "early_career", "established", "senior", "promotion", "concurrent", "career_change", "metric_poor"]),
  dimensions: z.array(z.object({
    dimension: z.enum(["responsibilities", "accomplishments", "outcomes", "tools", "scope", "progression"]),
    disposition: z.enum(["answered", "unknown", "not_applicable", "skipped", "deferred", "conflicting"]),
  }).strict()).length(6),
  questions_presented: z.number().int().nonnegative(),
  distinct_evidence_additions: z.number().int().nonnegative(),
  uncertainties_resolved: z.number().int().nonnegative(),
  gaps_intentionally_deferred: z.number().int().nonnegative(),
  repeated_known_or_refused_opportunities: z.literal(0),
  metric_refusals: z.number().int().nonnegative(),
  repeated_metric_requests: z.literal(0),
}).strict();

const TargetCaseSchema = z.object({
  case_id: SafeIdentitySchema,
  target_class: z.enum(["supported", "partial", "no_core_fit", "ambiguous", "malicious", "sparse", "mature"]),
  expected_outcome: z.enum(["variant", "no_meaningful_change"]),
  supported_core_count: z.number().int().nonnegative(),
  supported_transferable_count: z.number().int().nonnegative(),
  material_change_count: z.number().int().nonnegative(),
}).strict();

const CraftCaseSchema = z.object({
  case_id: SafeIdentitySchema,
  case_class: z.enum(["generic", "duty_only", "mutation", "clean"]),
  expected_outcome: z.enum(["blocked", "passed"]),
}).strict();

const CorrectedBindingsSchema = z.object({
  quality_standard_digest: Sha256DigestSchema,
  evaluator_contract_digest: Sha256DigestSchema,
  evidence_limited_policy_digest: Sha256DigestSchema,
  prompt_policy_digest: Sha256DigestSchema,
  craft_report_schema_id: z.literal(CORRECTED_CRAFT_REPORT_SCHEMA_ID),
  craft_report_schema_digest: Sha256DigestSchema,
}).strict();

const CorrectiveRelationsSchema = z.object({
  frozen_negative: z.object({
    fixture_id: SafeIdentitySchema,
    manifest_digest: Sha256DigestSchema,
    semantic_input_digest: Sha256DigestSchema,
    strategy_digest: Sha256DigestSchema,
    section_order_digest: Sha256DigestSchema,
    expected_c1: z.literal("fail"),
    expected_c2: z.literal("fail"),
    expected_c3: z.literal("pass"),
    expected_quality_state: z.literal("needs_correction"),
    passing_label_allowed: z.literal(false),
  }).strict(),
  clean_positive_case_ids: z.array(SafeIdentitySchema).min(2).max(16),
  permutation: z.object({
    relation_id: SafeIdentitySchema,
    permutation_ids: z.array(SafeIdentitySchema).min(2).max(16),
    permutation_digests: z.array(Sha256DigestSchema).min(2).max(16),
    expected_semantic_input_digest: Sha256DigestSchema,
    expected_strategy_digest: Sha256DigestSchema,
    expected_section_order_digest: Sha256DigestSchema,
  }).strict(),
}).strict();

const RepairCaseSchema = z.object({
  case_id: SafeIdentitySchema,
  repair_class: z.enum(["safe", "unsafe"]),
  expected_outcome: z.enum(["accepted", "rejected"]),
  unchanged_statements_preserved: z.literal(true),
  support_preserved: z.literal(true),
}).strict();

const SuccessorPairSchema = z.object({
  pair_id: SafeIdentitySchema,
  successor_kind: z.enum(["remembered_detail", "natural_language_revision"]),
  must_use_non_regression: z.literal(true),
  mandatory_craft_non_regression: z.literal(true),
}).strict();

const ParityCaseSchema = z.object({
  case_id: SafeIdentitySchema,
  representation: z.enum(["preview", "clean_text", "pdf", "career_projection"]),
  mutation_expected_caught: z.literal(true),
  affected_side_effect_only: z.literal(true),
}).strict();

const FrictionJourneySchema = z.object({
  journey_id: SafeIdentitySchema,
  factual_submissions: z.number().int().nonnegative(),
  fact_confirmation_groups: z.number().int().nonnegative(),
  non_fact_actions: z.number().int().nonnegative(),
  non_fact_confirmation_dialogs: z.literal(0),
  redundant_confirmations: z.literal(0),
  final_resume_approvals: z.literal(1),
  questions_presented: z.number().int().nonnegative(),
  useful_evidence_additions: z.number().int().nonnegative(),
  uncertainty_resolutions: z.number().int().nonnegative(),
  intentional_deferrals: z.number().int().nonnegative(),
  metric_refusals: z.number().int().nonnegative(),
  repeated_metric_requests: z.literal(0),
}).strict();

export const M7QualityCorpusSchema = z.object({
  corpus_schema_version: z.literal(2),
  synthetic: z.literal(true),
  evidence_scope: z.literal("workflow_only"),
  higher_gate_eligible: z.literal(false),
  corrected_bindings: CorrectedBindingsSchema,
  corrective_relations: CorrectiveRelationsSchema,
  generative_fixture_ids: z.array(SafeIdentitySchema).min(1).max(32),
  holdout_fixture_ids: z.array(SafeIdentitySchema).min(1).max(16),
  evidence_cases: z.array(EvidenceCaseSchema).min(1).max(32),
  coverage_journeys: z.array(CoverageJourneySchema).min(1).max(32),
  target_cases: z.array(TargetCaseSchema).min(1).max(32),
  craft_cases: z.array(CraftCaseSchema).min(1).max(32),
  repair_cases: z.array(RepairCaseSchema).min(1).max(16),
  successor_pairs: z.array(SuccessorPairSchema).min(1).max(16),
  parity_cases: z.array(ParityCaseSchema).min(1).max(16),
  friction_journeys: z.array(FrictionJourneySchema).min(1).max(16),
}).strict();

export type M7QualityCorpus = z.infer<typeof M7QualityCorpusSchema>;

export async function loadM7QualityCorpus(corpusPath = defaultCorpusPath): Promise<M7QualityCorpus> {
  return M7QualityCorpusSchema.parse(JSON.parse(await readFile(corpusPath, "utf8")));
}

export async function loadFrozenQualityRegressionManifest(manifestPath?: string) {
  if (manifestPath) return FrozenQualityRegressionManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const candidates = (await readdir(defaultFrozenManifestDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));
  const matches = [];
  for (const candidate of candidates) {
    const parsed = FrozenQualityRegressionManifestSchema.safeParse(JSON.parse(await readFile(path.join(defaultFrozenManifestDirectory, candidate.name), "utf8")));
    if (parsed.success) matches.push(parsed.data);
  }
  if (matches.length !== 1) throw new Error("M7 requires exactly one schema-valid frozen quality regression manifest");
  return matches[0]!;
}

function requireUnique(label: string, values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw new Error(`M7 fixture integrity rejected duplicate ${label}`);
}

export function validateM7FixtureIntegrity(input: unknown) {
  const corpus = M7QualityCorpusSchema.parse(input);
  requireUnique("generative fixture identity", corpus.generative_fixture_ids);
  requireUnique("holdout fixture identity", corpus.holdout_fixture_ids);
  requireUnique("evidence case identity", corpus.evidence_cases.map((item) => item.fixture_id));
  requireUnique("coverage journey identity", corpus.coverage_journeys.map((item) => item.journey_id));
  requireUnique("target case identity", corpus.target_cases.map((item) => item.case_id));
  requireUnique("craft case identity", corpus.craft_cases.map((item) => item.case_id));
  requireUnique("clean positive control identity", corpus.corrective_relations.clean_positive_case_ids);
  requireUnique("permutation identity", corpus.corrective_relations.permutation.permutation_ids);
  requireUnique("permutation digest", corpus.corrective_relations.permutation.permutation_digests);
  if (corpus.corrective_relations.permutation.permutation_ids.length !== corpus.corrective_relations.permutation.permutation_digests.length) throw new Error("M7 corrective permutation identities and digests must be one-to-one");
  requireUnique("repair case identity", corpus.repair_cases.map((item) => item.case_id));
  requireUnique("successor pair identity", corpus.successor_pairs.map((item) => item.pair_id));
  requireUnique("parity case identity", corpus.parity_cases.map((item) => item.case_id));
  requireUnique("friction journey identity", corpus.friction_journeys.map((item) => item.journey_id));

  if (corpus.holdout_fixture_ids.some((id) => corpus.generative_fixture_ids.includes(id))) {
    throw new Error("M7 holdout fixture identities must be disjoint from the visible generative corpus");
  }
  if (corpus.evidence_cases.length !== corpus.generative_fixture_ids.length ||
      corpus.generative_fixture_ids.some((id) => !corpus.evidence_cases.some((item) => item.fixture_id === id))) {
    throw new Error("M7 must-use evidence cases must cover every generative fixture exactly once");
  }
  for (const item of corpus.evidence_cases) {
    requireUnique(`${item.fixture_id} strong evidence`, item.strong_evidence_ids);
    requireUnique(`${item.fixture_id} must-use evidence`, item.must_use_evidence_ids);
    const strong = new Set(item.strong_evidence_ids);
    if (item.must_use_evidence_ids.some((id) => !strong.has(id))) throw new Error("M7 must-use evidence must be independently annotated as strong");
    const accounted = new Set([...item.used_evidence_ids, ...item.omissions.map((omission) => omission.evidence_id)]);
    if (item.must_use_evidence_ids.some((id) => !accounted.has(id))) throw new Error("M7 must-use evidence is neither used nor validly omitted");
  }
  const requiredHistoryShapes = ["sparse", "early_career", "established", "senior", "promotion", "concurrent", "career_change", "metric_poor"];
  if (requiredHistoryShapes.some((shape) => !corpus.coverage_journeys.some((item) => item.history_shape === shape))) {
    throw new Error("M7 coverage journeys do not cover every required history shape");
  }
  for (const journey of corpus.coverage_journeys) {
    requireUnique(`${journey.journey_id} dimension`, journey.dimensions.map((item) => item.dimension));
    const yieldCount = journey.distinct_evidence_additions + journey.uncertainties_resolved + journey.gaps_intentionally_deferred;
    if (yieldCount < journey.questions_presented) throw new Error("M7 evidence-yield trace contains a question without useful evidence, resolution, or deferral");
  }
  const requiredTargetClasses = ["supported", "partial", "no_core_fit", "ambiguous", "malicious", "sparse", "mature"];
  if (requiredTargetClasses.some((kind) => !corpus.target_cases.some((item) => item.target_class === kind))) throw new Error("M7 target corpus is incomplete");
  const requiredCraftClasses = ["generic", "duty_only", "mutation", "clean"];
  if (requiredCraftClasses.some((kind) => !corpus.craft_cases.some((item) => item.case_class === kind))) throw new Error("M7 craft corpus is incomplete");
  const cleanCaseIds = new Set(corpus.craft_cases.filter((item) => item.case_class === "clean" && item.expected_outcome === "passed").map((item) => item.case_id));
  if (corpus.corrective_relations.clean_positive_case_ids.length < 2 || corpus.corrective_relations.clean_positive_case_ids.some((id) => !cleanCaseIds.has(id))) {
    throw new Error("M7 corrective corpus requires at least two declared passing clean controls");
  }
  if (!corpus.repair_cases.some((item) => item.repair_class === "safe") || !corpus.repair_cases.some((item) => item.repair_class === "unsafe")) throw new Error("M7 repair corpus requires safe and unsafe relations");
  if (!corpus.successor_pairs.some((item) => item.successor_kind === "remembered_detail") || !corpus.successor_pairs.some((item) => item.successor_kind === "natural_language_revision")) throw new Error("M7 successor corpus requires both successor paths");
  const representations = ["preview", "clean_text", "pdf", "career_projection"];
  if (corpus.parity_cases.length !== 4 || representations.some((value) => !corpus.parity_cases.some((item) => item.representation === value))) throw new Error("M7 parity mutations must cover all four representations");
  for (const journey of corpus.friction_journeys) {
    if (journey.fact_confirmation_groups > journey.factual_submissions) throw new Error("M7 friction journey exceeds one fact-confirmation group per factual submission");
    const usefulOutcomes = journey.useful_evidence_additions + journey.uncertainty_resolutions + journey.intentional_deferrals;
    if (usefulOutcomes < journey.questions_presented) throw new Error("M7 friction journey contains a no-yield question");
  }
  return {
    outcome: "passed" as const,
    generative_fixture_count: corpus.generative_fixture_ids.length,
    holdout_fixture_count: corpus.holdout_fixture_ids.length,
    must_use_case_count: corpus.evidence_cases.length,
    coverage_journey_count: corpus.coverage_journeys.length,
    target_case_count: corpus.target_cases.length,
    craft_case_count: corpus.craft_cases.length,
    clean_control_count: corpus.corrective_relations.clean_positive_case_ids.length,
    permutation_relation_count: 1,
    repair_case_count: corpus.repair_cases.length,
    successor_pair_count: corpus.successor_pairs.length,
    parity_mutation_count: corpus.parity_cases.length,
    friction_journey_count: corpus.friction_journeys.length,
  };
}

export function validateCorrectiveCorpusBindings(corpusInput: unknown, manifestInput: unknown) {
  const corpus = M7QualityCorpusSchema.parse(corpusInput);
  const manifest = FrozenQualityRegressionManifestSchema.parse(manifestInput);
  const frozen = corpus.corrective_relations.frozen_negative;
  if (
    frozen.fixture_id !== manifest.fixture_id ||
    frozen.manifest_digest !== manifest.manifest_digest ||
    frozen.semantic_input_digest !== manifest.bindings.semantic_input_digest ||
    frozen.strategy_digest !== manifest.strategy_binding.strategy_digest ||
    frozen.section_order_digest !== manifest.strategy_binding.section_order_digest ||
    frozen.expected_c1 !== manifest.expected.C1 ||
    frozen.expected_c2 !== manifest.expected.C2 ||
    frozen.expected_c3 !== manifest.expected.C3 ||
    frozen.expected_quality_state !== manifest.expected.quality_state ||
    frozen.passing_label_allowed !== manifest.expected.passing_label_allowed
  ) throw new Error("M7 frozen corrective oracle binding mismatch");
  const permutation = corpus.corrective_relations.permutation;
  const expectedPermutationDigests = permutation.permutation_ids.map((permutationId) => canonicalInputDigest({ relation_id: permutation.relation_id, permutation_id: permutationId }));
  if (
    canonicalInputDigest(permutation.permutation_digests) !== canonicalInputDigest(expectedPermutationDigests) ||
    permutation.expected_semantic_input_digest !== manifest.bindings.semantic_input_digest ||
    permutation.expected_strategy_digest !== manifest.strategy_binding.strategy_digest ||
    permutation.expected_section_order_digest !== manifest.strategy_binding.section_order_digest
  ) throw new Error("M7 corrective permutation relation binding mismatch");
  const expectedBindings = {
    quality_standard_digest: RESUME_QUALITY_STANDARD_DIGEST,
    evaluator_contract_digest: PRODUCT_CRAFT_EVALUATOR.binding_digest,
    evidence_limited_policy_digest: CRAFT_EVIDENCE_LIMITED_POLICY_DIGEST,
    prompt_policy_digest: CORRECTED_PROMPT_POLICY_DIGEST,
    craft_report_schema_id: CORRECTED_CRAFT_REPORT_SCHEMA_ID,
    craft_report_schema_digest: CORRECTED_CRAFT_REPORT_SCHEMA_DIGEST,
  } as const;
  if (canonicalInputDigest(corpus.corrected_bindings) !== canonicalInputDigest(expectedBindings)) throw new Error("M7 corrected report, prompt, evaluator, or quality binding mismatch");
  if (
    corpus.corrected_bindings.quality_standard_digest !== manifest.policies.quality_standard.policy_digest ||
    corpus.corrected_bindings.evaluator_contract_digest !== manifest.policies.evaluator_contract.policy_digest ||
    corpus.corrected_bindings.evidence_limited_policy_digest !== manifest.policies.evidence_limited.policy_digest ||
    corpus.corrected_bindings.prompt_policy_digest !== manifest.policies.prompt.policy_digest
  ) throw new Error("M7 corrected corpus binding does not match the frozen oracle policies");
  return {
    outcome: "passed" as const,
    frozen_negative_count: 1,
    clean_positive_count: corpus.corrective_relations.clean_positive_case_ids.length,
    permutation_relation_count: 1,
    evidence_scope: corpus.evidence_scope,
    higher_gate_eligible: corpus.higher_gate_eligible,
  };
}

const OperationGatesSchema = z.object({
  truth: RequiredGateVerdictSchema,
  structure: RequiredGateVerdictSchema,
  craft_c1: RequiredGateVerdictSchema,
  craft_c2: RequiredGateVerdictSchema,
  craft_c3: RequiredGateVerdictSchema,
  craft_c4: RequiredGateVerdictSchema,
  craft_c5: RequiredGateVerdictSchema,
  craft_c6: RequiredGateVerdictSchema,
  craft_c7: RequiredGateVerdictSchema,
  target_t1: GateVerdictSchema,
  target_t2: GateVerdictSchema,
  target_t3: GateVerdictSchema,
  must_use: RequiredGateVerdictSchema,
  target_change: GateVerdictSchema,
  repair_non_regression: GateVerdictSchema,
  successor_continuity: GateVerdictSchema,
  artifact_parity: RequiredGateVerdictSchema,
}).strict();

export const FreshGenerationOperationSchema = z.object({
  evidence_schema_version: z.literal(2),
  evidence_scope: z.literal("controlled_provider_generation"),
  source_revision: FullGitRevisionSchema,
  quality_standard_revision: z.literal(3),
  quality_standard_digest: Sha256DigestSchema,
  prompt_policy_digest: Sha256DigestSchema,
  rubric_digest: Sha256DigestSchema,
  evaluator_contract_digest: Sha256DigestSchema,
  fixture_corpus_digest: Sha256DigestSchema,
  craft_report_schema_digest: Sha256DigestSchema,
  report_schema_digest: Sha256DigestSchema,
  fixture_id: SafeIdentitySchema,
  provider_class: SafeIdentitySchema,
  model_class: SafeIdentitySchema,
  operation_id: z.string().uuid(),
  freshness_digest: Sha256DigestSchema,
  output_digest: Sha256DigestSchema,
  status: z.literal("completed"),
  gates: OperationGatesSchema,
  holistic_read: z.number().int().min(1).max(5),
}).strict();

type ProviderModelClass = { provider_class: string; model_class: string };

function assertBinding(binding: M7EvaluationBinding, candidate: M7EvaluationBinding): void {
  const candidateBinding = M7EvaluationBindingSchema.parse({
    source_revision: candidate.source_revision,
    quality_standard_revision: candidate.quality_standard_revision,
    quality_standard_digest: candidate.quality_standard_digest,
    prompt_policy_digest: candidate.prompt_policy_digest,
    rubric_digest: candidate.rubric_digest,
    evaluator_contract_digest: candidate.evaluator_contract_digest,
    fixture_corpus_digest: candidate.fixture_corpus_digest,
    craft_report_schema_digest: candidate.craft_report_schema_digest,
    report_schema_digest: candidate.report_schema_digest,
  });
  if (canonicalInputDigest(binding) !== canonicalInputDigest(candidateBinding)) throw new Error("M7 evidence revision or policy binding mismatch");
}

function operationPassed(operation: z.infer<typeof FreshGenerationOperationSchema>): boolean {
  return Object.values(operation.gates).every((value) => value === "passed" || value === "not_applicable");
}

export function evaluateMultiRunEvidence(input: {
  binding: M7EvaluationBinding;
  generative_fixture_ids: string[];
  authorized_provider_models: ProviderModelClass[];
  operations: unknown[];
}) {
  const binding = M7EvaluationBindingSchema.parse(input.binding);
  const fixtureIds = z.array(SafeIdentitySchema).min(1).parse(input.generative_fixture_ids);
  const providerModels = z.array(z.object({ provider_class: SafeIdentitySchema, model_class: SafeIdentitySchema }).strict()).min(1).parse(input.authorized_provider_models);
  requireUnique("required generative fixture identity", fixtureIds);
  requireUnique("authorized provider/model class", providerModels.map((item) => `${item.provider_class}/${item.model_class}`));
  const parsedOperations = input.operations.map((operation) => FreshGenerationOperationSchema.parse(operation));
  const operationsById = new Map<string, z.infer<typeof FreshGenerationOperationSchema>>();
  for (const operation of parsedOperations) {
    const prior = operationsById.get(operation.operation_id);
    if (prior && canonicalInputDigest(prior) !== canonicalInputDigest(operation)) throw new Error("M7 generation evidence contains a mismatched duplicate operation identity");
    if (prior) throw new Error("M7 generation evidence contains a duplicate operation identity");
    operationsById.set(operation.operation_id, operation);
  }
  const operations = [...operationsById.values()];
  requireUnique("generation freshness digest", operations.map((operation) => operation.freshness_digest));
  operations.forEach((operation) => assertBinding(binding, operation));
  const expectedOperationCount = fixtureIds.length * providerModels.length * 3;
  let missing = false;
  for (const fixtureId of fixtureIds) {
    for (const provider of providerModels) {
      const group = operations.filter((operation) => operation.fixture_id === fixtureId && operation.provider_class === provider.provider_class && operation.model_class === provider.model_class);
      if (group.length < 3) missing = true;
      if (group.length > 3) throw new Error("M7 generation evidence contains more than three operations for one fixture/provider class");
    }
  }
  if (operations.some((operation) => !fixtureIds.includes(operation.fixture_id) || !providerModels.some((provider) => provider.provider_class === operation.provider_class && provider.model_class === operation.model_class))) {
    throw new Error("M7 generation evidence contains an unauthorized fixture or provider/model class");
  }
  const failedOperationCount = operations.filter((operation) => !operationPassed(operation)).length;
  return {
    status: failedOperationCount > 0 ? "failed" as const : missing ? "blocked" as const : "passed" as const,
    expected_operation_count: expectedOperationCount,
    completed_operation_count: operations.length,
    failed_operation_count: failedOperationCount,
  };
}

export const ProviderPurposeEvidenceSchema = z.object({
  evidence_schema_version: z.literal(2),
  evidence_scope: z.literal("controlled_provider_conformance"),
  source_revision: FullGitRevisionSchema,
  quality_standard_revision: z.literal(3),
  quality_standard_digest: Sha256DigestSchema,
  prompt_policy_digest: Sha256DigestSchema,
  rubric_digest: Sha256DigestSchema,
  evaluator_contract_digest: Sha256DigestSchema,
  fixture_corpus_digest: Sha256DigestSchema,
  craft_report_schema_digest: Sha256DigestSchema,
  report_schema_digest: Sha256DigestSchema,
  provider_class: SafeIdentitySchema,
  model_class: SafeIdentitySchema,
  purpose: InferencePurposeSchema,
  operation_id: z.string().uuid(),
  outcome: z.enum(["passed", "timeout", "response_loss", "refusal", "malformed_output", "incompatible", "strict_schema_failure", "unsupported_claim"]),
  strict_schema: z.enum(["passed", "failed", "not_evaluated"]),
  zero_unsupported_claims: z.enum(["passed", "failed", "not_evaluated"]),
}).strict().superRefine((value, context) => {
  if (value.outcome === "passed" && (value.strict_schema !== "passed" || value.zero_unsupported_claims !== "passed")) context.addIssue({ code: "custom", message: "provider pass requires strict schema and zero unsupported claims" });
  if (value.outcome !== "passed" && value.strict_schema === "passed" && value.zero_unsupported_claims === "passed") context.addIssue({ code: "custom", message: "provider error cannot retain a passing conformance result" });
  if (value.outcome === "strict_schema_failure" && value.strict_schema !== "failed") context.addIssue({ code: "custom", message: "strict-schema failure requires a failed strict-schema verdict" });
  if (value.outcome === "unsupported_claim" && (value.strict_schema !== "passed" || value.zero_unsupported_claims !== "failed")) context.addIssue({ code: "custom", message: "unsupported-claim failure requires valid schema and a failed unsupported-claim gate" });
});

export function evaluateProviderConformance(input: {
  binding: M7EvaluationBinding;
  required_purposes: string[];
  authorized_provider_models: ProviderModelClass[];
  evidence: unknown[];
}) {
  const binding = M7EvaluationBindingSchema.parse(input.binding);
  const purposes = z.array(InferencePurposeSchema).min(1).parse(input.required_purposes);
  const providerModels = z.array(z.object({ provider_class: SafeIdentitySchema, model_class: SafeIdentitySchema }).strict()).min(1).parse(input.authorized_provider_models);
  requireUnique("provider conformance purpose", purposes);
  requireUnique("authorized provider/model class", providerModels.map((item) => `${item.provider_class}/${item.model_class}`));
  const evidence = input.evidence.map((item) => ProviderPurposeEvidenceSchema.parse(item));
  requireUnique("provider conformance operation identity", evidence.map((item) => item.operation_id));
  evidence.forEach((item) => assertBinding(binding, item));
  if (evidence.some((item) => !purposes.includes(item.purpose) || !providerModels.some((provider) => provider.provider_class === item.provider_class && provider.model_class === item.model_class))) {
    throw new Error("M7 provider conformance evidence contains an unauthorized purpose or provider/model class");
  }
  let missing = false;
  let failed = false;
  for (const provider of providerModels) {
    for (const purpose of purposes) {
      const matches = evidence.filter((item) => item.provider_class === provider.provider_class && item.model_class === provider.model_class && item.purpose === purpose);
      if (matches.length === 0) missing = true;
      if (matches.length > 1) throw new Error("M7 provider conformance contains duplicate purpose evidence");
      if (matches.some((item) => item.outcome !== "passed" || item.strict_schema !== "passed" || item.zero_unsupported_claims !== "passed")) failed = true;
    }
  }
  return {
    status: failed ? "failed" as const : missing ? "blocked" as const : "passed" as const,
    required_purpose_count: purposes.length * providerModels.length,
    completed_purpose_count: evidence.length,
    failed_purpose_count: evidence.filter((item) => item.outcome !== "passed" || item.strict_schema !== "passed" || item.zero_unsupported_claims !== "passed").length,
  };
}

export const HumanCalibrationPolicySchema = z.object({
  policy_schema_version: z.literal(1),
  authority_status: z.literal("accepted"),
  policy_id: SafeIdentitySchema,
  policy_version: z.number().int().positive(),
  accepted_at: TimestampSchema,
  resume_reviewer_identity_digest: Sha256DigestSchema,
  owner_reviewer_identity_digest: Sha256DigestSchema,
  required_resume_fixture_ids: z.array(SafeIdentitySchema).min(2).max(32),
  required_owner_journey_ids: z.array(SafeIdentitySchema).min(1).max(32),
  minimum_recruiter_read: z.number().int().min(1).max(5),
  f1_minimum_recruiter_read: z.number().int().min(1).max(5),
  disagreement_rule: z.literal("fail_closed"),
}).strict().superRefine((value, context) => {
  if (new Set(value.required_resume_fixture_ids).size !== value.required_resume_fixture_ids.length) context.addIssue({ code: "custom", message: "human calibration policy contains duplicate resume samples" });
  if (new Set(value.required_owner_journey_ids).size !== value.required_owner_journey_ids.length) context.addIssue({ code: "custom", message: "human calibration policy contains duplicate owner samples" });
  if (value.resume_reviewer_identity_digest === value.owner_reviewer_identity_digest) context.addIssue({ code: "custom", message: "human calibration roles require independently attributable reviewers" });
});

const SharedReviewVerdictSchema = z.enum(["passed", "failed"]);

export const BlindedHumanReviewSchema = z.object({
  review_schema_version: z.literal(2),
  evidence_scope: z.literal("controlled_blinded_human_calibration"),
  source_revision: FullGitRevisionSchema,
  quality_standard_revision: z.literal(3),
  quality_standard_digest: Sha256DigestSchema,
  prompt_policy_digest: Sha256DigestSchema,
  rubric_digest: Sha256DigestSchema,
  evaluator_contract_digest: Sha256DigestSchema,
  fixture_corpus_digest: Sha256DigestSchema,
  craft_report_schema_digest: Sha256DigestSchema,
  report_schema_digest: Sha256DigestSchema,
  reviewer_role: z.enum(["resume_quality", "nontechnical_owner"]),
  reviewer_identity_digest: Sha256DigestSchema,
  reviewed_at: TimestampSchema,
  blinded: z.object({
    model_identity_visible: z.literal(false),
    evaluator_transcript_visible: z.literal(false),
    fixture_expectations_visible: z.literal(false),
    prior_scores_visible: z.literal(false),
  }).strict(),
  scorecard_input_digest: Sha256DigestSchema,
  resume_decisions: z.array(z.object({
    fixture_id: SafeIdentitySchema,
    mandatory_craft: SharedReviewVerdictSchema,
    target_honesty: SharedReviewVerdictSchema,
    tone: SharedReviewVerdictSchema,
    artifact_usefulness: SharedReviewVerdictSchema,
    recruiter_read: z.number().int().min(1).max(5),
    evidence_reference_digests: z.array(Sha256DigestSchema).min(1).max(32),
  }).strict()).max(32),
  owner_decisions: z.array(z.object({
    journey_id: SafeIdentitySchema,
    question_usefulness: SharedReviewVerdictSchema,
    clarity: SharedReviewVerdictSchema,
    pressure_respected: SharedReviewVerdictSchema,
    control_preserved: SharedReviewVerdictSchema,
    target_honesty: SharedReviewVerdictSchema,
    tone: SharedReviewVerdictSchema,
    artifact_usefulness: SharedReviewVerdictSchema,
    evidence_reference_digests: z.array(Sha256DigestSchema).min(1).max(32),
  }).strict()).max(32),
}).strict().superRefine((value, context) => {
  if (value.reviewer_role === "resume_quality" && (value.resume_decisions.length === 0 || value.owner_decisions.length !== 0)) context.addIssue({ code: "custom", message: "resume-quality reviewer must submit only resume decisions" });
  if (value.reviewer_role === "nontechnical_owner" && (value.owner_decisions.length === 0 || value.resume_decisions.length !== 0)) context.addIssue({ code: "custom", message: "non-technical owner reviewer must submit only owner decisions" });
  const decisionIds = value.reviewer_role === "resume_quality" ? value.resume_decisions.map((item) => item.fixture_id) : value.owner_decisions.map((item) => item.journey_id);
  if (new Set(decisionIds).size !== decisionIds.length) context.addIssue({ code: "custom", message: "human calibration decisions require unique sample identities" });
});

export function evaluateHumanCalibration(input: {
  binding: M7EvaluationBinding;
  policy: unknown;
  reviews: unknown[];
}) {
  const binding = M7EvaluationBindingSchema.parse(input.binding);
  const policy = HumanCalibrationPolicySchema.parse(input.policy);
  const reviews = input.reviews.map((item) => BlindedHumanReviewSchema.parse(item));
  reviews.forEach((item) => assertBinding(binding, item));
  const expectedIdentities = new Map([
    ["resume_quality", policy.resume_reviewer_identity_digest],
    ["nontechnical_owner", policy.owner_reviewer_identity_digest],
  ] as const);
  const identityMismatchCount = reviews.filter((item) => expectedIdentities.get(item.reviewer_role) !== item.reviewer_identity_digest).length;
  if (identityMismatchCount > 0) return { status: "failed" as const, reviewer_count: reviews.length, identity_mismatch_count: identityMismatchCount, disagreement_count: 0, failing_decision_count: 0 };
  requireUnique("human calibration reviewer role", reviews.map((item) => item.reviewer_role));
  const resumeReview = reviews.find((item) => item.reviewer_role === "resume_quality" && item.reviewer_identity_digest === policy.resume_reviewer_identity_digest);
  const ownerReview = reviews.find((item) => item.reviewer_role === "nontechnical_owner" && item.reviewer_identity_digest === policy.owner_reviewer_identity_digest);
  if (!resumeReview || !ownerReview) return { status: "blocked" as const, reviewer_count: reviews.length, identity_mismatch_count: 0, disagreement_count: 0, failing_decision_count: 0 };
  const resumeFixtureIds = new Set(resumeReview.resume_decisions.map((item) => item.fixture_id));
  const ownerJourneyIds = new Set(ownerReview.owner_decisions.map((item) => item.journey_id));
  if (policy.required_resume_fixture_ids.some((id) => !resumeFixtureIds.has(id)) || policy.required_owner_journey_ids.some((id) => !ownerJourneyIds.has(id))) {
    return { status: "blocked" as const, reviewer_count: reviews.length, identity_mismatch_count: 0, disagreement_count: 0, failing_decision_count: 0 };
  }
  const sharedKeys = ["target_honesty", "tone", "artifact_usefulness"] as const;
  const disagreementCount = sharedKeys.filter((key) => {
    const resumeVerdicts = new Set(resumeReview.resume_decisions.map((item) => item[key]));
    const ownerVerdicts = new Set(ownerReview.owner_decisions.map((item) => item[key]));
    return resumeVerdicts.size !== 1 || ownerVerdicts.size !== 1 || [...resumeVerdicts][0] !== [...ownerVerdicts][0];
  }).length;
  let failingDecisionCount = resumeReview.resume_decisions.filter((item) =>
    item.mandatory_craft === "failed" || item.target_honesty === "failed" || item.tone === "failed" || item.artifact_usefulness === "failed" ||
    item.recruiter_read < (item.fixture_id.startsWith("f1-") ? policy.f1_minimum_recruiter_read : policy.minimum_recruiter_read)).length;
  failingDecisionCount += ownerReview.owner_decisions.filter((item) => Object.values(item).some((value) => value === "failed")).length;
  return {
    status: disagreementCount > 0 || failingDecisionCount > 0 ? "failed" as const : "passed" as const,
    reviewer_count: reviews.length,
    identity_mismatch_count: 0,
    disagreement_count: disagreementCount,
    failing_decision_count: failingDecisionCount,
  };
}

const FixtureIntegrityResultSchema = z.object({
  outcome: z.literal("passed"),
  generative_fixture_count: z.number().int().positive(),
  holdout_fixture_count: z.number().int().positive(),
  must_use_case_count: z.number().int().positive(),
  coverage_journey_count: z.number().int().positive(),
  target_case_count: z.number().int().positive(),
  craft_case_count: z.number().int().positive(),
  clean_control_count: z.number().int().min(2),
  permutation_relation_count: z.literal(1),
  repair_case_count: z.number().int().positive(),
  successor_pair_count: z.number().int().positive(),
  parity_mutation_count: z.number().int().positive(),
  friction_journey_count: z.number().int().positive(),
}).strict();

const CorrectiveBindingResultSchema = z.object({
  outcome: z.literal("passed"),
  frozen_negative_count: z.literal(1),
  clean_positive_count: z.number().int().min(2),
  permutation_relation_count: z.literal(1),
  evidence_scope: z.literal("workflow_only"),
  higher_gate_eligible: z.literal(false),
}).strict();

export const M7DurableQualityReportSchema = z.object({
  report_schema_version: z.literal(2),
  source_revision: FullGitRevisionSchema,
  quality_standard_revision: z.literal(3),
  quality_standard_digest: Sha256DigestSchema,
  prompt_policy_digest: Sha256DigestSchema,
  rubric_digest: Sha256DigestSchema,
  evaluator_contract_digest: Sha256DigestSchema,
  fixture_corpus_digest: Sha256DigestSchema,
  craft_report_schema_digest: Sha256DigestSchema,
  report_schema_digest: Sha256DigestSchema,
  outcome_scope: z.literal("synthetic_sanitized_quality_gate_correction"),
  corpus_integrity: FixtureIntegrityResultSchema,
  corrective_bindings: CorrectiveBindingResultSchema,
  deterministic_foundation: z.object({ status: z.enum(["passed", "failed"]), report_digest: Sha256DigestSchema }).strict(),
  gates: z.object({
    fixture_integrity: z.enum(["passed", "failed"]),
    deterministic_foundation: z.enum(["passed", "failed"]),
    semantic_friction: z.enum(["passed", "failed"]),
    corrective_corpus: z.enum(["passed", "failed"]),
    workflow_fixture_boundary: z.literal("passed"),
    controlled_authority: ControlledGateStatusSchema,
    multi_run: ControlledGateStatusSchema,
    provider_conformance: ControlledGateStatusSchema,
    human_calibration: ControlledGateStatusSchema,
    numeric_friction: ControlledGateStatusSchema,
    retention_deletion: ControlledGateStatusSchema,
  }).strict(),
  release_ready: z.boolean(),
  report_digest: Sha256DigestSchema,
}).strict().superRefine((value, context) => {
  const { report_digest: _digest, ...body } = value;
  if (value.report_digest !== canonicalInputDigest(body)) context.addIssue({ code: "custom", path: ["report_digest"], message: "M7 durable report digest mismatch" });
  const allPassed = Object.values(value.gates).every((status) => status === "passed");
  if (value.release_ready !== allPassed) context.addIssue({ code: "custom", path: ["release_ready"], message: "M7 release readiness must follow every mandatory gate" });
});

export function buildM7DurableQualityReport(input: {
  binding: M7EvaluationBinding;
  corpus_integrity: ReturnType<typeof validateM7FixtureIntegrity>;
  corrective_bindings: ReturnType<typeof validateCorrectiveCorpusBindings>;
  deterministic_foundation: { status: "passed" | "failed"; report_digest: string };
  multi_run_status?: "blocked" | "passed" | "failed";
  provider_conformance_status?: "blocked" | "passed" | "failed";
  human_calibration_status?: "blocked" | "passed" | "failed";
  numeric_friction_status?: "blocked" | "passed" | "failed";
  retention_deletion_status?: "blocked" | "passed" | "failed";
  controlled_authority_status?: "blocked" | "passed" | "failed";
}) {
  const binding = M7EvaluationBindingSchema.parse(input.binding);
  const corpusIntegrity = FixtureIntegrityResultSchema.parse(input.corpus_integrity);
  const correctiveBindings = CorrectiveBindingResultSchema.parse(input.corrective_bindings);
  const deterministicFoundation = z.object({ status: z.enum(["passed", "failed"]), report_digest: Sha256DigestSchema }).strict().parse(input.deterministic_foundation);
  const gates = {
    fixture_integrity: corpusIntegrity.outcome,
    deterministic_foundation: deterministicFoundation.status,
    semantic_friction: corpusIntegrity.outcome,
    corrective_corpus: correctiveBindings.outcome,
    workflow_fixture_boundary: "passed" as const,
    controlled_authority: input.controlled_authority_status ?? "blocked",
    multi_run: input.multi_run_status ?? "blocked",
    provider_conformance: input.provider_conformance_status ?? "blocked",
    human_calibration: input.human_calibration_status ?? "blocked",
    numeric_friction: input.numeric_friction_status ?? "blocked",
    retention_deletion: input.retention_deletion_status ?? "blocked",
  } as const;
  const body = {
    report_schema_version: 2 as const,
    ...binding,
    outcome_scope: "synthetic_sanitized_quality_gate_correction" as const,
    corpus_integrity: corpusIntegrity,
    corrective_bindings: correctiveBindings,
    deterministic_foundation: deterministicFoundation,
    gates,
    release_ready: Object.values(gates).every((status) => status === "passed"),
  };
  const report = M7DurableQualityReportSchema.parse({ ...body, report_digest: canonicalInputDigest(body) });
  return assertSanitizedDurableEvidence(report);
}

const prohibitedKeys = new Set([
  "owner_text",
  "resume_text",
  "job_description_text",
  "prompt",
  "system_prompt",
  "user_prompt",
  "provider_body",
  "provider_response",
  "model_output",
  "raw_output",
  "transcript",
  "reviewer_transcript",
  "interview_answers",
  "credential",
  "credentials",
  "api_key",
  "secret",
  "token",
  "private_path",
  "production_id",
  "raw_content",
]);
const privatePathPattern = /(?:^|[\s"'(])(?:\/(?:home|Users|private|root|var\/folders|tmp)\/[^\s"')]*|[A-Za-z]:\\[^\s"')]+)/;
const syntheticCanaryPattern = /\bRB\d+_(?:[A-Z0-9]+_)*CANARY_[A-F0-9]{4,}\b/;

export function assertSanitizedDurableEvidence<T>(input: T): T {
  const visit = (value: unknown, keyPath: string[]): void => {
    if (typeof value === "string") {
      if (privatePathPattern.test(value)) throw new Error(`M7 durable evidence contains a private path at ${keyPath.join(".") || "root"}`);
      if (syntheticCanaryPattern.test(value)) throw new Error(`M7 durable evidence contains a synthetic canary at ${keyPath.join(".") || "root"}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...keyPath, String(index)]));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (prohibitedKeys.has(key.toLocaleLowerCase("en-US"))) throw new Error(`M7 durable evidence contains prohibited field ${key}`);
      visit(child, [...keyPath, key]);
    }
  };
  visit(input, []);
  return input;
}

export const M7RetentionContractSchema = z.object({
  contract_schema_version: z.literal(1),
  authority_status: z.literal("accepted"),
  policy_id: SafeIdentitySchema,
  policy_version: z.number().int().positive(),
  accepted_at: TimestampSchema,
  synthetic_only: z.literal(true),
  delete_after_ingestion: z.literal(true),
  maximum_retention_hours: z.number().int().positive().max(168),
}).strict();

const RawDeletionAttestationSchema = z.object({
  attestation_schema_version: z.literal(1),
  policy_digest: Sha256DigestSchema,
  raw_artifact_count: z.number().int().positive(),
  raw_artifact_bytes: z.number().int().nonnegative(),
  raw_artifact_digest: Sha256DigestSchema,
  completed_at: TimestampSchema,
  deleted: z.literal(true),
}).strict();

async function rawWorkspaceManifest(root: string, current = root): Promise<Array<{ relative_name: string; size: number; digest: string }>> {
  const entries = await readdir(current, { withFileTypes: true });
  const manifest: Array<{ relative_name: string; size: number; digest: string }> = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const candidate = path.join(current, entry.name);
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink()) throw new Error("M7 raw review workspace cannot contain symbolic links");
    if (metadata.isDirectory()) manifest.push(...await rawWorkspaceManifest(root, candidate));
    else if (metadata.isFile()) {
      const bytes = await readFile(candidate);
      manifest.push({ relative_name: path.relative(root, candidate), size: bytes.byteLength, digest: canonicalInputDigest(bytes.toString("base64")) });
    } else throw new Error("M7 raw review workspace contains an unsupported filesystem object");
  }
  return manifest;
}

export async function deleteRawSyntheticReviewArtifacts(input: {
  parent_directory: string;
  workspace_directory: string;
  contract: unknown;
  completed_at: string;
}) {
  const contract = M7RetentionContractSchema.parse(input.contract);
  const completedAt = TimestampSchema.parse(input.completed_at);
  const parent = path.resolve(input.parent_directory);
  const workspace = path.resolve(input.workspace_directory);
  const relative = path.relative(parent, workspace);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || parent === path.parse(parent).root) throw new Error("M7 deletion target is outside the bounded review parent");
  const parentMetadata = await lstat(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) throw new Error("M7 deletion parent must be a real bounded directory");
  const workspaceMetadata = await lstat(workspace);
  if (!workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink()) throw new Error("M7 deletion target must be a real bounded directory");
  const [realParent, realWorkspace] = await Promise.all([realpath(parent), realpath(workspace)]);
  if (realParent !== parent || realWorkspace !== workspace || path.relative(realParent, realWorkspace).startsWith("..")) {
    throw new Error("M7 deletion target or ancestor cannot traverse a symbolic link");
  }
  const sentinelPath = path.join(workspace, ".braindrive-synthetic-review.json");
  let sentinel: unknown;
  try {
    sentinel = JSON.parse(await readFile(sentinelPath, "utf8"));
  } catch {
    throw new Error("M7 deletion requires the exact synthetic review sentinel");
  }
  const sentinelSchema = z.object({ synthetic: z.literal(true), retention_contract_digest: Sha256DigestSchema }).strict();
  const parsedSentinel = sentinelSchema.parse(sentinel);
  const policyDigest = canonicalInputDigest(contract);
  if (parsedSentinel.retention_contract_digest !== policyDigest) throw new Error("M7 synthetic review sentinel does not match the accepted retention contract");
  const manifest = await rawWorkspaceManifest(workspace);
  if (manifest.length === 0) throw new Error("M7 raw review workspace is unexpectedly empty");
  const rawArtifactBytes = manifest.reduce((total, item) => total + item.size, 0);
  const rawArtifactDigest = canonicalInputDigest(manifest);
  await rm(workspace, { recursive: true, force: false });
  try {
    await access(workspace);
    throw new Error("M7 raw synthetic review artifact deletion could not be verified");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return RawDeletionAttestationSchema.parse({
    attestation_schema_version: 1,
    policy_digest: policyDigest,
    raw_artifact_count: manifest.length,
    raw_artifact_bytes: rawArtifactBytes,
    raw_artifact_digest: rawArtifactDigest,
    completed_at: completedAt,
    deleted: true,
  });
}

export const M7_QUALITY_EVALUATION_SCHEMA_ID = NonEmptyStringSchema.parse("braindrive.resume-builder.quality-evaluation.v2");
