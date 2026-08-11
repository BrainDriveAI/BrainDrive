import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import type { InferenceDataBlockSchema } from "../app-platform/contracts/inference.js";
import { CRAFT_EVIDENCE_LIMITED_POLICY, craftContextFromBlocks, evaluateCraftProposal } from "../resume-inference/craft-evaluator.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "../resume-inference/policy.js";
import { evaluateResumeQuality } from "../resume-inference/quality-runtime.js";
import { buildEvidenceAnnotations, RESUME_QUALITY_POLICY_IDENTITY, RESUME_QUALITY_STANDARD_DIGEST, RESUME_QUALITY_STANDARD_ID, RESUME_QUALITY_STANDARD_VERSION } from "../resume-inference/strategy.js";
import { TARGET_FIT_THRESHOLD_POLICY } from "../resume-inference/target-fit.js";
import { evaluateDefinitionDeterministicGates } from "../resume-inference/validators.js";
import { ResumeDomainService } from "./service.js";
import { ResumeDataStore } from "./store.js";
import { authority, definitionInput, ownerDecision, proposalInput, testGrant } from "./test-helpers.js";
import type { z } from "zod";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function block(category: z.infer<typeof InferenceDataBlockSchema>["category"], schemaId: string, data: unknown) {
  return { category, content_digest: canonicalInputDigest(data), schema_id: schemaId, schema_version: 1 as const, data };
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-target-fit-")); roots.push(root);
  const store = new ResumeDataStore(root, undefined, {}, false);
  await store.initialize(testGrant().owner_id);
  const service = new ResumeDomainService(store, () => new Date("2026-08-11T12:00:00.000Z"));
  const proposed = await service.proposeFact(proposalInput(), authority("career.facts.propose"));
  const confirmationAuthority = authority("career.facts.confirm");
  const confirmed = await service.confirmFact({ fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmationAuthority, ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id));
  const factId = confirmed.fact.metadata.revision_id;
  const facts = [{ revision_id: factId, fact_kind: confirmed.fact.fact_kind, value: confirmed.fact.value, source_revision_ids: confirmed.fact.source_revision_ids }];
  const strategyResult = {
    strategy_version: 1 as const, history_shape: "early_career" as const, history_reason_code: "thin_history" as const,
    role_emphasis: [], section_order: ["experience"], evidence_priorities: [{ fact_revision_id: factId, priority: "must_use" as const }],
    summary_decision: "omit" as const, summary_reason_code: "insufficient_distinct_value" as const, skills_context: [], omissions: [], unresolved_gap_ids: [],
    owner_rationale: "Use the confirmed accomplishment without padding.",
  };
  const strategyInput = [
    block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts }),
    block("evidence_annotations", "resume.evidence-annotations.v1", buildEvidenceAnnotations(facts, [])),
    block("quality_policy", "resume.quality-policy-identity.v1", RESUME_QUALITY_POLICY_IDENTITY),
  ];
  const strategyResultRecord = await service.writeResumeStrategy({
    kind: "resume_strategy", fact_revision_ids: [factId], coverage_revision_ids: [], target_revision_id: null, presentation_preferences: {}, strategy: strategyResult,
    inference_binding: { prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, input_digest: canonicalInputDigest(strategyInput), output_digest: canonicalInputDigest(strategyResult), provider_profile_id: "owner-active", model_id: "synthetic-model" },
  }, authority("resume.definitions.write"));
  if (strategyResultRecord.strategy.record_type !== "resume_strategy") throw new Error("strategy fixture failed");
  const strategy = strategyResultRecord.strategy;
  const statement = { statement_id: crypto.randomUUID(), section_id: "experience", display_role: "heading" as const, kind: "factual" as const, text: "Synthetic supported statement", supporting_confirmed_fact_revision_ids: [factId] };
  const generation = { title: "General Resume", statements: [statement], section_order: ["experience"], omissions: [] };
  const generationInput = [
    block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts }),
    block("resume_strategy", "resume.strategy-record.v1", strategy),
    block("quality_policy", "resume.quality-policy-identity.v1", RESUME_QUALITY_POLICY_IDENTITY),
  ];
  const strategyBinding = {
    binding_version: 1 as const, strategy_revision_id: strategy.metadata.revision_id, fact_snapshot_digest: strategy.fact_snapshot_digest,
    fact_revision_ids: [factId], coverage_revision_ids: [], strategy_input_digest: strategy.input_digest, strategy_output_digest: strategy.output_digest,
    generation_input_digest: canonicalInputDigest(generationInput), generation_output_digest: canonicalInputDigest(generation), prompt_policy_id: RESUME_PROMPT_POLICY_ID,
    prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, quality_standard_id: RESUME_QUALITY_STANDARD_ID, quality_standard_version: RESUME_QUALITY_STANDARD_VERSION,
    quality_standard_digest: RESUME_QUALITY_STANDARD_DIGEST, provider_profile_id: strategy.provider_profile_id, model_id: strategy.model_id,
    used_must_use_fact_revision_ids: [factId], omissions: [],
  };
  const proposal = await service.writeDefinition({ ...definitionInput(factId), status: "proposed", statements: [statement], prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, strategy_binding: strategyBinding, generation_result: generation }, authority("resume.definitions.write"));
  if (proposal.definition.record_type !== "resume_definition") throw new Error("parent proposal fixture failed");
  const craftBase = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts }), block("general_resume_definition", "resume.definition.v1", proposal.definition), block("resume_strategy", "resume.strategy-record.v1", strategy)];
  const gates = evaluateDefinitionDeterministicGates(proposal.definition, craftBase);
  const mechanical = evaluateResumeQuality(proposal.definition);
  const craftBlocks = [...craftBase, block("deterministic_findings", "resume.craft-deterministic-gates.v1", { ...gates, mechanical_passed: mechanical.accepted, mechanical_report_digest: mechanical.report_digest }), block("craft_gate_policy", "resume.craft-gate-policy.v1", CRAFT_EVIDENCE_LIMITED_POLICY)];
  const evaluation = evaluateCraftProposal(craftContextFromBlocks(craftBlocks));
  const craft = await service.writeCraftQualityReport({ kind: "craft_quality_report", proposal_definition_revision_id: proposal.definition.metadata.revision_id, strategy_revision_id: strategy.metadata.revision_id, target_analysis_revision_id: null, evaluation, inference_binding: { prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, input_digest: canonicalInputDigest(craftBlocks), output_digest: canonicalInputDigest(evaluation), provider_profile_id: "owner-active", model_id: "synthetic-model" } }, authority("resume.definitions.write"));
  const parent = await service.approveDefinition({ kind: "approve_definition", definition_record_id: proposal.definition.metadata.record_id, expected_revision: 1, craft_report_revision_id: craft.report.metadata.revision_id }, authority("resume.definitions.write"), true);
  const jobText = "Requires delivery of synthetic systems.";
  const job = await service.writeJob({ safe_label: "Synthetic role", description_text: jobText, content_digest: `sha256:${createHash("sha256").update(jobText).digest("hex")}`, captured_at: "2026-08-11T12:00:00.000Z", sensitivity: "sensitive" }, authority("resume.jobs.write"));
  if (parent.definition.record_type !== "resume_definition" || job.job.record_type !== "job_description") throw new Error("target fixture failed");
  return { store, service, factId, facts, strategy, parent: parent.definition, job: job.job, statement };
}

function fitInput(fixture: Awaited<ReturnType<typeof setup>>, evidenceStatus: "supported" | "unsupported") {
  const requirementId = crypto.randomUUID();
  const evidence = [{ requirement_id: requirementId, requirement_kind: "required" as const, evidence_status: evidenceStatus, source_span: "Requires delivery of synthetic systems.", inferred: false, supporting_confirmed_fact_revision_ids: evidenceStatus === "supported" ? [fixture.factId] : [], clarification: null }];
  const changes = evidenceStatus === "supported" ? [{ change_id: crypto.randomUUID(), requirement_id: requirementId, statement_id: fixture.statement.statement_id, action: "emphasis" as const, rationale: "Emphasize the supported accomplishment.", supporting_confirmed_fact_revision_ids: [fixture.factId] }] : [];
  const plan = evidenceStatus === "supported"
    ? { plan_version: 2 as const, threshold_policy_id: TARGET_FIT_THRESHOLD_POLICY.policy_id, threshold_policy_version: TARGET_FIT_THRESHOLD_POLICY.policy_version, fit_class: "meaningfully_supported" as const, outcome: "targeted_variant" as const, no_change_reason: null, support_counts: { core: 1, transferable: 0, partial: 0, unsupported: 0 }, changes }
    : { plan_version: 2 as const, threshold_policy_id: TARGET_FIT_THRESHOLD_POLICY.policy_id, threshold_policy_version: TARGET_FIT_THRESHOLD_POLICY.policy_version, fit_class: "lacking_supported_core_fit" as const, outcome: "no_meaningful_change" as const, no_change_reason: "insufficient_supported_fit" as const, support_counts: { core: 0, transferable: 0, partial: 0, unsupported: 1 }, changes };
  const blocks = [
    block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts: fixture.facts }),
    block("general_resume_definition", "resume.definition.v1", fixture.parent),
    block("job_description", "resume.job-description.v1", fixture.job),
    block("resume_strategy", "resume.strategy-record.v1", fixture.strategy),
    block("evidence_matrix", "resume.requirement-evidence.v1", evidence),
    block("target_fit_policy", "resume.target-fit-policy.v1", TARGET_FIT_THRESHOLD_POLICY),
  ];
  return { kind: "target_fit_analysis" as const, parent_general_definition_revision_id: fixture.parent.metadata.revision_id, job_revision_id: fixture.job.metadata.revision_id, strategy_revision_id: fixture.strategy.metadata.revision_id, evidence_matrix: evidence, plan, inference_binding: { prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, input_digest: canonicalInputDigest(blocks), output_digest: canonicalInputDigest(plan), provider_profile_id: "owner-active", model_id: "synthetic-model" } };
}

describe("durable target-fit operation", () => {
  it("persists score-free no-change guidance and never creates a targeted child", async () => {
    const fixture = await setup();
    const saved = await fixture.service.writeTargetFitAnalysis(fitInput(fixture, "unsupported"), authority("resume.definitions.write"));
    expect(saved.analysis).toMatchObject({ outcome: "no_meaningful_change", analysis_state: "completed", no_change_reason: "insufficient_supported_fit", material_changes: [], targeted_definition_revision_id: null });
    expect(saved.analysis.owner_next_actions).toEqual(["use_general_resume", "try_different_target"]);
    expect(await fixture.store.list("resume_definition")).toHaveLength(1);
  });

  it("persists a passing gate, creates at most one bound child, and reuses semantic retries", async () => {
    const fixture = await setup();
    const analysisOperation = crypto.randomUUID();
    const input = fitInput(fixture, "supported");
    const first = await fixture.service.writeTargetFitAnalysis(input, authority("resume.definitions.write", analysisOperation));
    const retried = await fixture.service.writeTargetFitAnalysis(input, authority("resume.definitions.write", analysisOperation));
    expect(retried.reused).toBe(true);
    expect(retried.analysis.metadata.revision_id).toBe(first.analysis.metadata.revision_id);

    const changed = { ...fixture.statement, text: "Synthetic supported statement." };
    const generated = { parent_general_definition_revision_id: fixture.parent.metadata.revision_id, job_revision_id: fixture.job.metadata.revision_id, title: fixture.parent.title, statements: [changed], changed_statement_ids: [fixture.statement.statement_id], section_order: fixture.parent.section_order };
    const targetBlocks = [
      block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts: fixture.facts }),
      block("general_resume_definition", "resume.definition.v1", fixture.parent),
      block("job_description", "resume.job-description.v1", fixture.job),
      block("resume_strategy", "resume.strategy-record.v1", fixture.strategy),
      block("target_fit_analysis", "resume.target-fit-analysis.v1", first.analysis),
    ];
    const childInput = {
      ...definitionInput(fixture.factId), definition_kind: "targeted", status: "proposed", title: fixture.parent.title, statements: [changed], section_order: fixture.parent.section_order,
      parent_definition_revision_id: fixture.parent.metadata.revision_id, job_revision_id: fixture.job.metadata.revision_id, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
      variant: { evidence_matrix: input.evidence_matrix, changed_statement_ids: generated.changed_statement_ids, target_fit_analysis_revision_id: first.analysis.metadata.revision_id, generation_result: generated, inference_binding: { prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, input_digest: canonicalInputDigest(targetBlocks), output_digest: canonicalInputDigest(generated), provider_profile_id: "owner-active", model_id: "synthetic-model" } },
    };
    const childOperations = [crypto.randomUUID(), crypto.randomUUID()];
    const concurrent = await Promise.allSettled(childOperations.map((operationId) => fixture.service.writeDefinition(childInput, authority("resume.definitions.write", operationId))));
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    const winnerIndex = concurrent.findIndex((result) => result.status === "fulfilled");
    const child = (concurrent[winnerIndex] as PromiseFulfilledResult<Awaited<ReturnType<typeof fixture.service.writeDefinition>>>).value;
    const childRetry = await fixture.service.writeDefinition(childInput, authority("resume.definitions.write", childOperations[winnerIndex]!));
    expect(childRetry.reused).toBe(true);
    expect(childRetry.definition.metadata.revision_id).toBe(child.definition.metadata.revision_id);
    const completed = await fixture.store.readHead(first.analysis.metadata.record_id);
    expect(completed).toMatchObject({ record_type: "target_fit_analysis", analysis_state: "completed", targeted_definition_revision_id: child.definition.metadata.revision_id });
    expect((await fixture.store.list("tailored_variant")).filter((record) => record.record_type === "tailored_variant" && record.target_fit_analysis_revision_id === first.analysis.metadata.revision_id)).toHaveLength(1);
    expect((concurrent.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "conflict" });

    if (completed.record_type !== "target_fit_analysis" || child.definition.record_type !== "resume_definition") throw new Error("targeted craft fixture failed");
    const craftBase = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts: fixture.facts }), block("general_resume_definition", "resume.definition.v1", child.definition), block("resume_strategy", "resume.strategy-record.v1", fixture.strategy), block("target_fit_analysis", "resume.target-fit-analysis.v1", completed)];
    const craftGates = evaluateDefinitionDeterministicGates(child.definition, craftBase);
    const craftMechanical = evaluateResumeQuality(child.definition);
    const craftBlocks = [...craftBase, block("deterministic_findings", "resume.craft-deterministic-gates.v1", { ...craftGates, mechanical_passed: craftMechanical.accepted, mechanical_report_digest: craftMechanical.report_digest }), block("craft_gate_policy", "resume.craft-gate-policy.v1", CRAFT_EVIDENCE_LIMITED_POLICY)];
    const craftEvaluation = evaluateCraftProposal(craftContextFromBlocks(craftBlocks));
    const craftReport = await fixture.service.writeCraftQualityReport({ kind: "craft_quality_report", proposal_definition_revision_id: child.definition.metadata.revision_id, strategy_revision_id: fixture.strategy.metadata.revision_id, target_analysis_revision_id: completed.metadata.revision_id, evaluation: craftEvaluation, inference_binding: { prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, input_digest: canonicalInputDigest(craftBlocks), output_digest: canonicalInputDigest(craftEvaluation), provider_profile_id: "owner-active", model_id: "synthetic-model" } }, authority("resume.definitions.write"));
    await expect(fixture.service.approveDefinition({ kind: "approve_definition", definition_record_id: child.definition.metadata.record_id, expected_revision: 1, craft_report_revision_id: craftReport.report.metadata.revision_id }, authority("resume.definitions.write"), true)).resolves.toMatchObject({ definition: { status: "approved", definition_kind: "targeted" } });
  });
});
