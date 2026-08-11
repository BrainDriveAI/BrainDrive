import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { z } from "zod";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import type { InferenceDataBlockSchema } from "../app-platform/contracts/inference.js";
import { CRAFT_EVIDENCE_LIMITED_POLICY, craftContextFromBlocks, evaluateCraftProposal } from "../resume-inference/craft-evaluator.js";
import { evaluateDefinitionDeterministicGates } from "../resume-inference/validators.js";
import { evaluateResumeQuality } from "../resume-inference/quality-runtime.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "../resume-inference/policy.js";
import { buildEvidenceAnnotations, RESUME_QUALITY_POLICY_IDENTITY, RESUME_QUALITY_STANDARD_DIGEST, RESUME_QUALITY_STANDARD_ID, RESUME_QUALITY_STANDARD_VERSION } from "../resume-inference/strategy.js";
import { ResumeDomainService } from "./service.js";
import { ResumeDataStore } from "./store.js";
import { authority, definitionInput, ownerDecision, proposalInput, testGrant } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function block(category: z.infer<typeof InferenceDataBlockSchema>["category"], schemaId: string, data: unknown) {
  return { category, content_digest: canonicalInputDigest(data), schema_id: schemaId, schema_version: 1 as const, data };
}

async function setup(dutyOnly = false, includeUnusedContext = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-craft-quality-")); roots.push(root);
  const store = new ResumeDataStore(root, undefined, {}, false);
  await store.initialize(testGrant().owner_id);
  const service = new ResumeDomainService(store, () => new Date("2026-08-11T12:00:00.000Z"));
  const proposed = await service.proposeFact(proposalInput(), authority("career.facts.propose"));
  const confirmAuthority = authority("career.facts.confirm");
  const confirmed = await service.confirmFact({ fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmAuthority, ownerDecision(confirmAuthority, proposed.fact.metadata.revision_id));
  const factId = confirmed.fact.metadata.revision_id;
  const contextConfirmed = includeUnusedContext ? await (async () => {
    const input = proposalInput("Synthetic contextual skill");
    const contextProposal = await service.proposeFact({ ...input, fact: { ...input.fact, fact_kind: "skill" as const } }, authority("career.facts.propose"));
    const contextAuthority = authority("career.facts.confirm");
    return service.confirmFact({ fact_record_id: contextProposal.fact.metadata.record_id, fact_revision_id: contextProposal.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, contextAuthority, ownerDecision(contextAuthority, contextProposal.fact.metadata.revision_id));
  })() : null;
  const facts = [confirmed.fact, ...(contextConfirmed ? [contextConfirmed.fact] : [])].map((fact) => ({ revision_id: fact.metadata.revision_id, fact_kind: fact.fact_kind, value: fact.value, source_revision_ids: fact.source_revision_ids }));
  const factIds = facts.map((fact) => fact.revision_id);
  const strategyResult = { strategy_version: 1 as const, history_shape: "chronological_standard" as const, history_reason_code: "standard_chronology" as const, role_emphasis: [], section_order: ["experience"], evidence_priorities: [{ fact_revision_id: factId, priority: "must_use" as const }, ...(contextConfirmed ? [{ fact_revision_id: contextConfirmed.fact.metadata.revision_id, priority: "preferred" as const }] : [])], summary_decision: "omit" as const, summary_reason_code: "insufficient_distinct_value" as const, skills_context: [], omissions: [], unresolved_gap_ids: [], owner_rationale: "Use only confirmed evidence." };
  const strategyBlocks = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts }), block("evidence_annotations", "resume.evidence-annotations.v1", buildEvidenceAnnotations(facts, [])), block("quality_policy", "resume.quality-policy-identity.v1", RESUME_QUALITY_POLICY_IDENTITY)];
  const savedStrategy = await service.writeResumeStrategy({ kind: "resume_strategy", fact_revision_ids: factIds, coverage_revision_ids: [], target_revision_id: null, presentation_preferences: {}, strategy: strategyResult, inference_binding: { prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, input_digest: canonicalInputDigest(strategyBlocks), output_digest: canonicalInputDigest(strategyResult), provider_profile_id: "owner-active", model_id: "synthetic-model" } }, authority("resume.definitions.write"));
  if (savedStrategy.strategy.record_type !== "resume_strategy") throw new Error("strategy fixture failed");
  const strategy = savedStrategy.strategy;
  const heading = { statement_id: crypto.randomUUID(), section_id: "experience", display_role: "heading" as const, kind: "factual" as const, text: "Synthetic supported statement", supporting_confirmed_fact_revision_ids: [factId] };
  const duty = { statement_id: crypto.randomUUID(), section_id: "experience", display_role: "bullet" as const, kind: "presentation" as const, text: dutyOnly ? "Responsible for routine work" : "Maintained routine work", supporting_confirmed_fact_revision_ids: [] };
  const statements = [heading, duty];
  const generation = { title: "General Resume", statements, section_order: ["experience"], omissions: [] };
  const generationBlocks = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts }), block("resume_strategy", "resume.strategy-record.v1", strategy), block("quality_policy", "resume.quality-policy-identity.v1", RESUME_QUALITY_POLICY_IDENTITY)];
  const strategyBinding = { binding_version: 1 as const, strategy_revision_id: strategy.metadata.revision_id, fact_snapshot_digest: strategy.fact_snapshot_digest, fact_revision_ids: factIds, coverage_revision_ids: [], strategy_input_digest: strategy.input_digest, strategy_output_digest: strategy.output_digest, generation_input_digest: canonicalInputDigest(generationBlocks), generation_output_digest: canonicalInputDigest(generation), prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, quality_standard_id: RESUME_QUALITY_STANDARD_ID, quality_standard_version: RESUME_QUALITY_STANDARD_VERSION, quality_standard_digest: RESUME_QUALITY_STANDARD_DIGEST, provider_profile_id: strategy.provider_profile_id, model_id: strategy.model_id, used_must_use_fact_revision_ids: [factId], omissions: [] };
  const written = await service.writeDefinition({ ...definitionInput(factId), status: "proposed", statements, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, strategy_binding: strategyBinding, generation_result: generation }, authority("resume.definitions.write"));
  if (written.definition.record_type !== "resume_definition") throw new Error("definition fixture failed");
  return { store, service, factId, facts, strategy, definition: written.definition, duty };
}

function craftInput(fixture: Awaited<ReturnType<typeof setup>>) {
  const base = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts: fixture.facts }), block("general_resume_definition", "resume.definition.v1", fixture.definition), block("resume_strategy", "resume.strategy-record.v1", fixture.strategy)];
  const gates = evaluateDefinitionDeterministicGates(fixture.definition, base);
  const mechanical = evaluateResumeQuality(fixture.definition);
  const blocks = [...base, block("deterministic_findings", "resume.craft-deterministic-gates.v1", { ...gates, mechanical_passed: mechanical.accepted, mechanical_report_digest: mechanical.report_digest }), block("craft_gate_policy", "resume.craft-gate-policy.v1", CRAFT_EVIDENCE_LIMITED_POLICY)];
  const evaluation = evaluateCraftProposal(craftContextFromBlocks(blocks));
  return { kind: "craft_quality_report" as const, proposal_definition_revision_id: fixture.definition.metadata.revision_id, strategy_revision_id: fixture.strategy.metadata.revision_id, target_analysis_revision_id: null, evaluation, inference_binding: { prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, input_digest: canonicalInputDigest(blocks), output_digest: canonicalInputDigest(evaluation), provider_profile_id: "owner-active", model_id: "synthetic-model" } };
}

describe("durable independent craft evidence", () => {
  it("rejects direct current-policy approval writes even with host owner confirmation", async () => {
    const fixture = await setup();
    await expect(fixture.service.writeDefinition({
      ...definitionInput(fixture.factId),
      statements: fixture.definition.statements,
      prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
      strategy_binding: fixture.definition.strategy_binding,
      generation_result: { title: fixture.definition.title, statements: fixture.definition.statements, section_order: fixture.definition.section_order, omissions: [] },
    }, authority("resume.definitions.write"), true)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("fails approval without current craft evidence, persists a clean report, and binds it to approval", async () => {
    const fixture = await setup();
    await expect(fixture.service.approveDefinition({ kind: "approve_definition", definition_record_id: fixture.definition.metadata.record_id, expected_revision: 1 }, authority("resume.definitions.write"), true)).rejects.toMatchObject({ code: "validation_failed" });
    const saved = await fixture.service.writeCraftQualityReport(craftInput(fixture), authority("resume.definitions.write"));
    expect(saved.report).toMatchObject({ record_type: "craft_quality_report", verdict: "pass", proposal_definition_revision_id: fixture.definition.metadata.revision_id, evidence_limited_authority_status: "provisional_planning_default" });
    const successor = await fixture.service.writeDefinition({ ...definitionInput(fixture.factId), status: "proposed", statements: fixture.definition.statements, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, strategy_binding: fixture.definition.strategy_binding, generation_result: { title: fixture.definition.title, statements: fixture.definition.statements, section_order: fixture.definition.section_order, omissions: [] } }, authority("resume.definitions.write"));
    await expect(fixture.service.approveDefinition({ kind: "approve_definition", definition_record_id: successor.definition.metadata.record_id, expected_revision: 1, craft_report_revision_id: saved.report.metadata.revision_id }, authority("resume.definitions.write"), true)).rejects.toMatchObject({ code: "validation_failed" });
    const approved = await fixture.service.approveDefinition({ kind: "approve_definition", definition_record_id: fixture.definition.metadata.record_id, expected_revision: 1, craft_report_revision_id: saved.report.metadata.revision_id }, authority("resume.definitions.write"), true);
    expect(approved.definition).toMatchObject({ status: "approved", approval_evidence: { persuasive_quality: { status: "current", craft_report_revision_id: saved.report.metadata.revision_id } } });
  });

  it("accepts a proposal that selects a strict subset of its complete strategy snapshot", async () => {
    const fixture = await setup(false, true);
    expect(fixture.definition.selected_fact_revision_ids).toHaveLength(1);
    expect(fixture.strategy.fact_revision_ids).toHaveLength(2);
    const saved = await fixture.service.writeCraftQualityReport(craftInput(fixture), authority("resume.definitions.write"));
    await expect(fixture.service.approveDefinition({ kind: "approve_definition", definition_record_id: fixture.definition.metadata.record_id, expected_revision: 1, craft_report_revision_id: saved.report.metadata.revision_id }, authority("resume.definitions.write"), true)).resolves.toMatchObject({ definition: { status: "approved" } });
  });

  it("rejects a stale report and accepts exactly one bounded non-regressive repair", async () => {
    const fixture = await setup(true);
    const saved = await fixture.service.writeCraftQualityReport(craftInput(fixture), authority("resume.definitions.write"));
    expect(saved.report.verdict).toBe("fail");
    const repairedStatements = fixture.definition.statements.map((statement) => statement.statement_id === fixture.duty.statement_id ? { ...statement, text: "Maintained routine work" } : statement);
    const repairResult = { repair_version: 1 as const, source_definition_revision_id: fixture.definition.metadata.revision_id, source_report_revision_id: saved.report.metadata.revision_id, changed_statement_ids: [fixture.duty.statement_id], title: fixture.definition.title, statements: repairedStatements, section_order: fixture.definition.section_order };
    const repairInput = { kind: "craft_repair" as const, source_definition_revision_id: fixture.definition.metadata.revision_id, source_report_revision_id: saved.report.metadata.revision_id, repair: repairResult, inference_binding: { prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, input_digest: saved.repair_input_digest, output_digest: canonicalInputDigest(repairResult), provider_profile_id: "owner-active", model_id: "synthetic-model" } };
    const repairAuthority = authority("resume.definitions.write");
    const result = await fixture.service.writeCraftRepair(repairInput, repairAuthority);
    expect(result.operation).toMatchObject({ result: "completed", attempt: 1, source_definition_revision_id: fixture.definition.metadata.revision_id });
    expect(result.definition?.statements.find((statement) => statement.statement_id === fixture.duty.statement_id)?.text).toBe("Maintained routine work");
    expect(result.report?.verdict).toBe("pass");
    const replay = await fixture.service.writeCraftRepair(repairInput, repairAuthority);
    expect(replay).toMatchObject({ reused: true, operation: { metadata: { revision_id: result.operation.metadata.revision_id } } });
    await expect(fixture.service.writeCraftRepair(repairInput, authority("resume.definitions.write"))).rejects.toMatchObject({ code: "conflict" });
  });
});
