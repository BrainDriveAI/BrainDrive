import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { z } from "zod";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import type { InferenceDataBlockSchema } from "../app-platform/contracts/inference.js";
import { CRAFT_EVIDENCE_LIMITED_POLICY, craftContextFromBlocks, craftDefinitionDigest, evaluateCraftProposal, extractCraftAnchorEvidence } from "../resume-inference/craft-evaluator.js";
import { evaluateDefinitionDeterministicGates } from "../resume-inference/validators.js";
import { evaluateResumeQuality } from "../resume-inference/quality-runtime.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "../resume-inference/policy.js";
import { buildEvidenceAnnotations, canonicalizeStrategyResult, RESUME_QUALITY_POLICY_IDENTITY, RESUME_QUALITY_STANDARD_DIGEST, RESUME_QUALITY_STANDARD_ID, RESUME_QUALITY_STANDARD_VERSION } from "../resume-inference/strategy.js";
import { ResumeDomainService } from "./service.js";
import { ResumeDataStore, type StoreHooks } from "./store.js";
import { authority, definitionInput, ownerDecision, proposalInput, testGrant } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function block(category: z.infer<typeof InferenceDataBlockSchema>["category"], schemaId: string, data: unknown) {
  return { category, content_digest: canonicalInputDigest(data), schema_id: schemaId, schema_version: 1 as const, data };
}

async function setup(dutyOnly = false, includeUnusedContext = false, evidenceLimited = false, hooks: StoreHooks = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-craft-quality-")); roots.push(root);
  const store = new ResumeDataStore(root, undefined, hooks, false);
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
  const annotations = buildEvidenceAnnotations(facts, []);
  const strategyResult = canonicalizeStrategyResult({ strategy_version: 1 as const, history_shape: evidenceLimited ? "early_career" as const : "chronological_standard" as const, history_reason_code: evidenceLimited ? "thin_history" as const : "standard_chronology" as const, role_emphasis: [], section_order: ["experience"], evidence_priorities: [{ fact_revision_id: factId, priority: "must_use" as const }, ...(contextConfirmed ? [{ fact_revision_id: contextConfirmed.fact.metadata.revision_id, priority: "preferred" as const }] : [])], summary_decision: "omit" as const, summary_reason_code: "insufficient_distinct_value" as const, skills_context: [], omissions: [], unresolved_gap_ids: [], owner_rationale: "Use only confirmed evidence." }, facts, annotations);
  const strategyBlocks = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts }), block("evidence_annotations", "resume.evidence-annotations.v1", annotations), block("quality_policy", "resume.quality-policy-identity.v1", RESUME_QUALITY_POLICY_IDENTITY)];
  const savedStrategy = await service.writeResumeStrategy({ kind: "resume_strategy", fact_revision_ids: factIds, coverage_revision_ids: [], target_revision_id: null, presentation_preferences: {}, strategy: strategyResult, inference_binding: { prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, input_digest: canonicalInputDigest(strategyBlocks), output_digest: canonicalInputDigest(strategyResult), provider_profile_id: "owner-active", model_id: "synthetic-model" } }, authority("resume.definitions.write"));
  if (savedStrategy.strategy.record_type !== "resume_strategy") throw new Error("strategy fixture failed");
  const strategy = savedStrategy.strategy;
  const heading = { statement_id: crypto.randomUUID(), section_id: "experience", display_role: "heading" as const, kind: "factual" as const, text: "Synthetic supported statement", supporting_confirmed_fact_revision_ids: [factId] };
  const duty = { statement_id: crypto.randomUUID(), section_id: "experience", display_role: "bullet" as const, kind: "presentation" as const, text: dutyOnly ? "Responsible for routine work" : "Maintained routine work", supporting_confirmed_fact_revision_ids: [] };
  const statements = [heading, duty];
  const generation = { title: "Synthetic Owner", statements, section_order: strategy.section_order, omissions: [] };
  const generationBlocks = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts }), block("resume_strategy", "resume.strategy-record.v1", strategy), block("quality_policy", "resume.quality-policy-identity.v1", RESUME_QUALITY_POLICY_IDENTITY)];
  const strategyBinding = { binding_version: 1 as const, strategy_revision_id: strategy.metadata.revision_id, fact_snapshot_digest: strategy.fact_snapshot_digest, fact_revision_ids: factIds, coverage_revision_ids: [], strategy_input_digest: strategy.input_digest, strategy_output_digest: strategy.output_digest, generation_input_digest: canonicalInputDigest(generationBlocks), generation_output_digest: canonicalInputDigest(generation), prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, quality_standard_id: RESUME_QUALITY_STANDARD_ID, quality_standard_version: RESUME_QUALITY_STANDARD_VERSION, quality_standard_digest: RESUME_QUALITY_STANDARD_DIGEST, provider_profile_id: strategy.provider_profile_id, model_id: strategy.model_id, used_must_use_fact_revision_ids: [factId], omissions: [] };
  const written = await service.writeDefinition({ ...definitionInput(factId), status: "proposed", title: generation.title, statements, section_order: generation.section_order, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, strategy_binding: strategyBinding, generation_result: generation }, authority("resume.definitions.write"));
  if (written.definition.record_type !== "resume_definition") throw new Error("definition fixture failed");
  return { store, service, factId, facts, strategy, definition: written.definition, duty };
}

function craftInput(fixture: Pick<Awaited<ReturnType<typeof setup>>, "facts" | "definition" | "strategy">) {
  const base = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts: fixture.facts }), block("general_resume_definition", "resume.definition.v1", fixture.definition), block("resume_strategy", "resume.strategy-record.v1", fixture.strategy)];
  const gates = evaluateDefinitionDeterministicGates(fixture.definition, base);
  const mechanical = evaluateResumeQuality(fixture.definition);
  const gatesBlock = block("deterministic_findings", "resume.craft-deterministic-gates.v1", { ...gates, mechanical_passed: mechanical.accepted, mechanical_report_digest: mechanical.report_digest });
  const anchorContext = craftContextFromBlocks([...base, gatesBlock]);
  const blocks = [...base, gatesBlock, block("craft_anchor_evidence", "resume.craft-anchor-evidence.v1", extractCraftAnchorEvidence(anchorContext)), block("craft_gate_policy", "resume.craft-gate-policy.v1", CRAFT_EVIDENCE_LIMITED_POLICY)];
  const evaluation = evaluateCraftProposal(craftContextFromBlocks(blocks));
  return { kind: "craft_quality_report" as const, proposal_definition_revision_id: fixture.definition.metadata.revision_id, strategy_revision_id: fixture.strategy.metadata.revision_id, target_analysis_revision_id: null, evaluation, inference_binding: { prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, input_digest: canonicalInputDigest(blocks), output_digest: canonicalInputDigest(evaluation), provider_profile_id: "owner-active", model_id: "synthetic-model" } };
}

function repairInput(fixture: Awaited<ReturnType<typeof setup>>, saved: Awaited<ReturnType<ResumeDomainService["writeCraftQualityReport"]>>, text: string) {
  const repair = {
    repair_version: 2 as const,
    source_definition_revision_id: fixture.definition.metadata.revision_id,
    source_report_revision_id: saved.report.metadata.revision_id,
    changed_statement_ids: [fixture.duty.statement_id],
    title: fixture.definition.title,
    statements: fixture.definition.statements.map((statement) => statement.statement_id === fixture.duty.statement_id ? { ...statement, text } : statement),
    section_order: fixture.definition.section_order,
  };
  return {
    kind: "craft_repair" as const,
    source_definition_revision_id: fixture.definition.metadata.revision_id,
    source_report_revision_id: saved.report.metadata.revision_id,
    repair,
    inference_binding: { prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, input_digest: saved.repair_input_digest, output_digest: canonicalInputDigest(repair), provider_profile_id: fixture.strategy.provider_profile_id, model_id: fixture.strategy.model_id },
  };
}

async function advanceHead(store: ResumeDataStore, record: Parameters<ResumeDataStore["commit"]>[0][number]) {
  const mutationAuthority = authority("resume.definitions.write");
  const successor = {
    ...record,
    metadata: { ...record.metadata, revision_id: crypto.randomUUID(), revision: record.metadata.revision + 1, prior_revision_id: record.metadata.revision_id },
  } as Parameters<ResumeDataStore["commit"]>[0][number];
  await store.commit([successor], {
    operationId: mutationAuthority.operationId,
    idempotencyKey: mutationAuthority.idempotencyKey,
    canonicalInput: { stale_head_test: record.metadata.revision_id },
    ownerId: mutationAuthority.grant.owner_id,
    actorId: mutationAuthority.grant.actor_id,
    installationId: mutationAuthority.grant.installation_id,
    capability: mutationAuthority.capability,
    targetCategory: record.record_type,
    targetId: record.metadata.record_id,
    expectedRevision: record.metadata.revision,
  });
}

async function setupAbsenceRoute() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-craft-absence-")); roots.push(root);
  const store = new ResumeDataStore(root, undefined, {}, false);
  await store.initialize(testGrant().owner_id);
  const service = new ResumeDomainService(store, () => new Date("2026-08-11T12:00:00.000Z"));
  const jobValue = JSON.stringify({ format: "resume_job_v1", title: "Support Lead", employer: "Northwind", location: "", start_date: "2022", end_date: "Present", responsibilities: "Led escalations" });
  const proposed = await service.proposeFact({ source: { source_kind: "owner_interview", safe_label: "Resume interview", content_digest: canonicalInputDigest(jobValue), captured_at: "2026-08-11T12:00:00.000Z" }, fact: { fact_kind: "employment", state: "suggested", value: jobValue, sensitivity: "standard" } }, authority("career.facts.propose"));
  const confirmAuthority = authority("career.facts.confirm");
  const confirmed = await service.confirmFact({ fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmAuthority, ownerDecision(confirmAuthority, proposed.fact.metadata.revision_id));
  const initialized = await service.writeJobEvidenceCoverage({ action: "initialize", job_fact_revision_id: confirmed.fact.metadata.revision_id }, authority("resume.definitions.write"));
  const opportunity = { opportunity_id: crypto.randomUUID(), dimension: "accomplishments" as const, opportunity_kind: "qualitative" as const, value_category: "distinct_accomplishment" as const, context_digest: canonicalInputDigest({ job: confirmed.fact.metadata.revision_id, dimension: "accomplishments" }) };
  const presented = await service.writeJobEvidenceCoverage({ action: "opportunity_presented", coverage_record_id: initialized.coverage.metadata.record_id, expected_revision: 1, job_fact_revision_id: confirmed.fact.metadata.revision_id, opportunity }, authority("resume.definitions.write"));
  const facts = [{ revision_id: confirmed.fact.metadata.revision_id, fact_kind: confirmed.fact.fact_kind, value: confirmed.fact.value, source_revision_ids: confirmed.fact.source_revision_ids }];
  const strategyResult = { strategy_version: 1 as const, history_shape: "chronological_standard" as const, history_reason_code: "standard_chronology" as const, role_emphasis: [{ job_fact_revision_id: confirmed.fact.metadata.revision_id, priority: "primary" as const, reason_code: "recent" as const, bullet_density: "compact" as const }], section_order: ["experience"], evidence_priorities: [{ fact_revision_id: confirmed.fact.metadata.revision_id, priority: "must_use" as const }], summary_decision: "omit" as const, summary_reason_code: "insufficient_distinct_value" as const, skills_context: [], omissions: [], unresolved_gap_ids: [opportunity.opportunity_id], owner_rationale: "Use confirmed role identity and leave the optional gap explicit." };
  const strategyBlocks = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts }), block("coverage_summary", "resume.coverage-summary.v1", presented.coverage), block("evidence_annotations", "resume.evidence-annotations.v1", buildEvidenceAnnotations(facts, [presented.coverage])), block("quality_policy", "resume.quality-policy-identity.v1", RESUME_QUALITY_POLICY_IDENTITY)];
  const savedStrategy = await service.writeResumeStrategy({ kind: "resume_strategy", fact_revision_ids: [confirmed.fact.metadata.revision_id], coverage_revision_ids: [presented.coverage.metadata.revision_id], target_revision_id: null, presentation_preferences: {}, strategy: strategyResult, inference_binding: { prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, input_digest: canonicalInputDigest(strategyBlocks), output_digest: canonicalInputDigest(strategyResult), provider_profile_id: "owner-active", model_id: "synthetic-model" } }, authority("resume.definitions.write"));
  if (savedStrategy.strategy.record_type !== "resume_strategy") throw new Error("absence strategy fixture failed");
  const heading = { statement_id: crypto.randomUUID(), section_id: "experience", display_role: "heading" as const, kind: "factual" as const, text: "Support Lead Northwind 2022 Present", supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id] };
  const generation = { title: "Synthetic Owner", statements: [heading], section_order: ["experience"], omissions: [] };
  const generationBlocks = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts }), block("coverage_summary", "resume.coverage-summary.v1", presented.coverage), block("resume_strategy", "resume.strategy-record.v1", savedStrategy.strategy), block("quality_policy", "resume.quality-policy-identity.v1", RESUME_QUALITY_POLICY_IDENTITY)];
  const strategyBinding = { binding_version: 1 as const, strategy_revision_id: savedStrategy.strategy.metadata.revision_id, fact_snapshot_digest: savedStrategy.strategy.fact_snapshot_digest, fact_revision_ids: [confirmed.fact.metadata.revision_id], coverage_revision_ids: [presented.coverage.metadata.revision_id], strategy_input_digest: savedStrategy.strategy.input_digest, strategy_output_digest: savedStrategy.strategy.output_digest, generation_input_digest: canonicalInputDigest(generationBlocks), generation_output_digest: canonicalInputDigest(generation), prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, quality_standard_id: RESUME_QUALITY_STANDARD_ID, quality_standard_version: RESUME_QUALITY_STANDARD_VERSION, quality_standard_digest: RESUME_QUALITY_STANDARD_DIGEST, provider_profile_id: savedStrategy.strategy.provider_profile_id, model_id: savedStrategy.strategy.model_id, used_must_use_fact_revision_ids: [confirmed.fact.metadata.revision_id], omissions: [] };
  const written = await service.writeDefinition({ ...definitionInput(confirmed.fact.metadata.revision_id), status: "proposed", title: generation.title, statements: generation.statements, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, strategy_binding: strategyBinding, generation_result: generation }, authority("resume.definitions.write"));
  if (written.definition.record_type !== "resume_definition") throw new Error("absence definition fixture failed");
  return { store, service, factId: confirmed.fact.metadata.revision_id, facts, strategy: savedStrategy.strategy, definition: written.definition, duty: heading, coverage: presented.coverage, opportunity };
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
    expect(saved).toMatchObject({ quality_state: "product_craft_passed", report: { record_type: "craft_quality_report", report_version: 2, verdict: "pass", proposal_definition_revision_id: fixture.definition.metadata.revision_id, evidence_limited_authority_status: "accepted_implementation_blocker" } });
    const successor = await fixture.service.writeDefinition({ ...definitionInput(fixture.factId), status: "proposed", title: fixture.definition.title, statements: fixture.definition.statements, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, strategy_binding: fixture.definition.strategy_binding, generation_result: { title: fixture.definition.title, statements: fixture.definition.statements, section_order: fixture.definition.section_order, omissions: [] } }, authority("resume.definitions.write"));
    await expect(fixture.service.approveDefinition({ kind: "approve_definition", definition_record_id: successor.definition.metadata.record_id, expected_revision: 1, craft_report_revision_id: saved.report.metadata.revision_id }, authority("resume.definitions.write"), true)).rejects.toMatchObject({ code: "validation_failed" });
    const approved = await fixture.service.approveDefinition({ kind: "approve_definition", definition_record_id: fixture.definition.metadata.record_id, expected_revision: 1, craft_report_revision_id: saved.report.metadata.revision_id }, authority("resume.definitions.write"), true);
    expect(approved.definition).toMatchObject({ status: "approved", approval_evidence: { persuasive_quality: { contract_version: 2, quality_state: "owner_approved", craft_report_revision_id: saved.report.metadata.revision_id } } });
    if (approved.definition.record_type !== "resume_definition") throw new Error("approved definition fixture failed");
    expect(approved.career_return_summary).toEqual({
      summary_version: 2,
      approved_reference: {
        kind: "general_resume",
        record_id: approved.definition.metadata.record_id,
        revision_id: approved.definition.metadata.revision_id,
        definition_digest: craftDefinitionDigest(approved.definition),
      },
      quality_state: "owner_approved",
      craft_report_reference: {
        revision_id: saved.report.metadata.revision_id,
        report_digest: saved.report.report_digest,
      },
      updated_at: approved.definition.approved_at,
    });
  });

  it("accepts a proposal that selects a strict subset of its complete strategy snapshot", async () => {
    const fixture = await setup(false, true);
    expect(fixture.definition.selected_fact_revision_ids).toHaveLength(1);
    expect(fixture.strategy.fact_revision_ids).toHaveLength(2);
    const saved = await fixture.service.writeCraftQualityReport(craftInput(fixture), authority("resume.definitions.write"));
    await expect(fixture.service.approveDefinition({ kind: "approve_definition", definition_record_id: fixture.definition.metadata.record_id, expected_revision: 1, craft_report_revision_id: saved.report.metadata.revision_id }, authority("resume.definitions.write"), true)).resolves.toMatchObject({ definition: { status: "approved" } });
  });

  it("reuses an identical report, rejects a mismatched replay, and returns one v2 correction action", async () => {
    const fixture = await setup(true);
    const input = craftInput(fixture);
    const reportAuthority = authority("resume.definitions.write");
    const saved = await fixture.service.writeCraftQualityReport(input, reportAuthority);
    expect(saved).toMatchObject({
      quality_state: "needs_correction",
      correction_action: { action: "repair_statement", statement_scope_ids: [fixture.duty.statement_id], correction_class: "duty_only", attempt: 1 },
      repair_scope: { scope_version: 2, statement_scope_ids: [fixture.duty.statement_id], correction_class: "duty_only", attempt: 1 },
      report: { report_version: 2, verdict: "fail" },
    });
    const replay = await fixture.service.writeCraftQualityReport(input, reportAuthority);
    expect(replay).toMatchObject({ reused: true, report: { metadata: { revision_id: saved.report.metadata.revision_id } } });
    await expect(fixture.service.writeCraftQualityReport({ ...input, inference_binding: { ...input.inference_binding, output_digest: `sha256:${"f".repeat(64)}` } }, reportAuthority)).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("persists one bounded successor only after full v2 revalidation and reuses the exact result", async () => {
    const fixture = await setup(true);
    const saved = await fixture.service.writeCraftQualityReport(craftInput(fixture), authority("resume.definitions.write"));
    if (!saved.repair_scope) throw new Error("repair fixture did not produce a bounded scope");
    const repair = {
      repair_version: 2 as const,
      source_definition_revision_id: fixture.definition.metadata.revision_id,
      source_report_revision_id: saved.report.metadata.revision_id,
      changed_statement_ids: [fixture.duty.statement_id],
      title: fixture.definition.title,
      statements: fixture.definition.statements.map((statement) => statement.statement_id === fixture.duty.statement_id ? { ...statement, text: "Coordinated routine work" } : statement),
      section_order: fixture.definition.section_order,
    };
    const input = {
      kind: "craft_repair" as const,
      source_definition_revision_id: fixture.definition.metadata.revision_id,
      source_report_revision_id: saved.report.metadata.revision_id,
      repair,
      inference_binding: { prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, input_digest: saved.repair_input_digest, output_digest: canonicalInputDigest(repair), provider_profile_id: fixture.strategy.provider_profile_id, model_id: fixture.strategy.model_id },
    };
    const repairAuthority = authority("resume.definitions.write");
    const completed = await fixture.service.writeCraftRepair(input, repairAuthority);

    expect(completed).toMatchObject({
      reused: false,
      operation: { repair_version: 2, action: "repair_statement", result: "completed", transition: "needs_correction_to_product_craft_passed", recovery_reason: null },
      definition: { status: "proposed", title: fixture.definition.title, metadata: { revision: 1 } },
      report: { report_version: 2, verdict: "pass" },
    });
    expect(completed.report?.proposal_definition_revision_id).toBe(completed.definition?.metadata.revision_id);
    expect(completed.operation.successor_definition_revision_id).toBe(completed.definition?.metadata.revision_id);
    expect(completed.operation.successor_report_revision_id).toBe(completed.report?.metadata.revision_id);
    expect(await fixture.store.readRevision(fixture.definition.metadata.revision_id)).toEqual(fixture.definition);

    const replay = await fixture.service.writeCraftRepair(input, repairAuthority);
    expect(replay).toMatchObject({ reused: true, operation: { metadata: { revision_id: completed.operation.metadata.revision_id } }, definition: { metadata: { revision_id: completed.definition?.metadata.revision_id } }, report: { metadata: { revision_id: completed.report?.metadata.revision_id } } });
    await expect(fixture.service.writeCraftRepair({ ...input, repair: { ...repair, title: "Changed" } }, repairAuthority)).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(fixture.service.writeCraftRepair(input, authority("resume.definitions.write"))).rejects.toMatchObject({ code: "conflict" });
  });

  it("records a no-op repair as rejected and preserves the source without a successor", async () => {
    const fixture = await setup(true);
    const saved = await fixture.service.writeCraftQualityReport(craftInput(fixture), authority("resume.definitions.write"));
    const repair = {
      repair_version: 2 as const,
      source_definition_revision_id: fixture.definition.metadata.revision_id,
      source_report_revision_id: saved.report.metadata.revision_id,
      changed_statement_ids: [fixture.duty.statement_id],
      title: fixture.definition.title,
      statements: fixture.definition.statements,
      section_order: fixture.definition.section_order,
    };
    const result = await fixture.service.writeCraftRepair({
      kind: "craft_repair",
      source_definition_revision_id: fixture.definition.metadata.revision_id,
      source_report_revision_id: saved.report.metadata.revision_id,
      repair,
      inference_binding: { prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, input_digest: saved.repair_input_digest, output_digest: canonicalInputDigest(repair), provider_profile_id: fixture.strategy.provider_profile_id, model_id: fixture.strategy.model_id },
    }, authority("resume.definitions.write"));

    expect(result).toMatchObject({ operation: { result: "rejected", transition: "needs_correction_preserved", recovery_reason: "validation_rejected", successor_definition_revision_id: null, successor_report_revision_id: null }, definition: null, report: null });
    expect(await fixture.store.list("resume_definition")).toEqual([fixture.definition]);
  });

  it("rejects a full-gate regression and a provider switch without changing the source", async () => {
    const regressionFixture = await setup(true);
    const regressionReport = await regressionFixture.service.writeCraftQualityReport(craftInput(regressionFixture), authority("resume.definitions.write"));
    const regression = await regressionFixture.service.writeCraftRepair(repairInput(regressionFixture, regressionReport, "Responsible for coordinated routine work"), authority("resume.definitions.write"));
    expect(regression).toMatchObject({ operation: { result: "rejected", error_class: "regression", recovery_reason: "full_gate_regression", transition: "needs_correction_preserved" }, definition: null, report: null });
    expect(await regressionFixture.store.list("resume_definition")).toEqual([regressionFixture.definition]);

    const providerFixture = await setup(true);
    const providerReport = await providerFixture.service.writeCraftQualityReport(craftInput(providerFixture), authority("resume.definitions.write"));
    const input = repairInput(providerFixture, providerReport, "Coordinated routine work");
    await expect(providerFixture.service.writeCraftRepair({ ...input, inference_binding: { ...input.inference_binding, provider_profile_id: "other-provider" } }, authority("resume.definitions.write"))).rejects.toMatchObject({ code: "validation_failed" });
    expect(await providerFixture.store.list("craft_repair_operation")).toHaveLength(0);
    expect(await providerFixture.store.list("resume_definition")).toEqual([providerFixture.definition]);
  });

  it("records a same-provider failure once, replays it, and preserves the proposal", async () => {
    const fixture = await setup(true);
    const saved = await fixture.service.writeCraftQualityReport(craftInput(fixture), authority("resume.definitions.write"));
    const input = {
      kind: "craft_repair_failure" as const,
      source_definition_revision_id: fixture.definition.metadata.revision_id,
      source_report_revision_id: saved.report.metadata.revision_id,
      failure_class: "provider" as const,
      prompt_policy_id: RESUME_PROMPT_POLICY_ID,
      prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
      provider_profile_id: fixture.strategy.provider_profile_id,
      model_id: fixture.strategy.model_id,
      input_digest: saved.repair_input_digest,
    };
    const repairAuthority = authority("resume.definitions.write");
    const failed = await fixture.service.writeCraftRepairFailure(input, repairAuthority);
    expect(failed).toMatchObject({ reused: false, operation: { result: "failed", error_class: "provider", recovery_reason: "provider_failure", transition: "needs_correction_preserved", successor_definition_revision_id: null, successor_report_revision_id: null }, definition: null, report: null });
    expect(await fixture.store.list("resume_definition")).toEqual([fixture.definition]);
    expect(await fixture.store.list("craft_quality_report")).toEqual([saved.report]);
    const replay = await fixture.service.writeCraftRepairFailure(input, repairAuthority);
    expect(replay).toMatchObject({ reused: true, operation: { metadata: { revision_id: failed.operation.metadata.revision_id } } });
    await expect(fixture.service.writeCraftRepair(repairInput(fixture, saved, "Coordinated routine work"), authority("resume.definitions.write"))).rejects.toMatchObject({ code: "conflict" });
  });

  it("recovers the exact committed successor after response loss", async () => {
    let failRepairResponse = false;
    const fixture = await setup(true, false, false, { afterCatalogCommit: async () => { if (failRepairResponse) { failRepairResponse = false; throw new Error("synthetic repair response loss"); } } });
    const saved = await fixture.service.writeCraftQualityReport(craftInput(fixture), authority("resume.definitions.write"));
    const input = repairInput(fixture, saved, "Coordinated routine work");
    const repairAuthority = authority("resume.definitions.write");
    failRepairResponse = true;

    await expect(fixture.service.writeCraftRepair(input, repairAuthority)).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    const recovered = await fixture.service.writeCraftRepair(input, repairAuthority);
    expect(recovered).toMatchObject({ reused: true, operation: { result: "completed" }, definition: { status: "proposed" }, report: { verdict: "pass" } });
    expect(await fixture.store.list("craft_repair_operation")).toHaveLength(1);
    expect(await fixture.store.list("resume_definition")).toHaveLength(2);
    expect(await fixture.store.list("craft_quality_report")).toHaveLength(2);
  });

  it("rolls back a pre-switch persistence fault and succeeds once after restart", async () => {
    let failBeforeSwitch = false;
    const fixture = await setup(true, false, false, { beforeCatalogCommit: async () => { if (failBeforeSwitch) throw new Error("synthetic repair persistence fault"); } });
    const saved = await fixture.service.writeCraftQualityReport(craftInput(fixture), authority("resume.definitions.write"));
    const input = repairInput(fixture, saved, "Coordinated routine work");
    const repairAuthority = authority("resume.definitions.write");
    failBeforeSwitch = true;

    await expect(fixture.service.writeCraftRepair(input, repairAuthority)).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    expect(await fixture.store.list("craft_repair_operation")).toHaveLength(0);
    expect(await fixture.store.list("resume_definition")).toEqual([fixture.definition]);
    const restartedStore = new ResumeDataStore(fixture.store.memoryRoot, fixture.store.namespaceRoot, {}, false);
    await restartedStore.initialize(testGrant().owner_id);
    const restarted = new ResumeDomainService(restartedStore, () => new Date("2026-08-11T12:00:00.000Z"));
    const completed = await restarted.writeCraftRepair(input, repairAuthority);
    expect(completed).toMatchObject({ reused: false, operation: { result: "completed" }, report: { verdict: "pass" } });
    expect(await restartedStore.list("craft_repair_operation")).toHaveLength(1);
  });

  it("serializes concurrent attempts to exactly one durable repair", async () => {
    const fixture = await setup(true);
    const saved = await fixture.service.writeCraftQualityReport(craftInput(fixture), authority("resume.definitions.write"));
    const input = repairInput(fixture, saved, "Coordinated routine work");
    const attempts = await Promise.allSettled([
      fixture.service.writeCraftRepair(input, authority("resume.definitions.write")),
      fixture.service.writeCraftRepair(input, authority("resume.definitions.write")),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.status === "rejected")).toMatchObject({ reason: { code: "conflict" } });
    expect(await fixture.store.list("craft_repair_operation")).toHaveLength(1);
    expect(await fixture.store.list("resume_definition")).toHaveLength(2);
  });

  it.each(["source", "report"] as const)("rejects a stale %s head without recording an attempt", async (stale) => {
    const fixture = await setup(true);
    const saved = await fixture.service.writeCraftQualityReport(craftInput(fixture), authority("resume.definitions.write"));
    await advanceHead(fixture.store, stale === "source" ? fixture.definition : saved.report);

    await expect(fixture.service.writeCraftRepair(repairInput(fixture, saved, "Coordinated routine work"), authority("resume.definitions.write"))).rejects.toMatchObject({ code: "conflict" });
    expect(await fixture.store.list("craft_repair_operation")).toHaveLength(0);
    expect(await fixture.store.allRevisions()).not.toContainEqual(expect.objectContaining({ record_type: "resume_definition", parent_definition_revision_id: fixture.definition.metadata.revision_id }));
  });

  it("preserves an existing approved definition digest across a rejected successor repair", async () => {
    const fixture = await setup();
    const passing = await fixture.service.writeCraftQualityReport(craftInput(fixture), authority("resume.definitions.write"));
    const approved = await fixture.service.approveDefinition({ kind: "approve_definition", definition_record_id: fixture.definition.metadata.record_id, expected_revision: 1, craft_report_revision_id: passing.report.metadata.revision_id }, authority("resume.definitions.write"), true);
    if (approved.definition.record_type !== "resume_definition") throw new Error("approval fixture failed");
    const approvedDigest = craftDefinitionDigest(approved.definition);
    const duty = { ...fixture.duty, text: "Responsible for routine work" };
    const statements = fixture.definition.statements.map((statement) => statement.statement_id === duty.statement_id ? duty : statement);
    const generation = { title: fixture.definition.title, statements, section_order: fixture.definition.section_order, omissions: [] };
    const proposal = await fixture.service.writeDefinition({
      ...definitionInput(fixture.factId),
      status: "proposed",
      title: fixture.definition.title,
      statements,
      prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
      strategy_binding: { ...fixture.definition.strategy_binding!, generation_output_digest: canonicalInputDigest(generation) },
      generation_result: generation,
    }, authority("resume.definitions.write"));
    if (proposal.definition.record_type !== "resume_definition") throw new Error("proposal fixture failed");
    const repairFixture = { ...fixture, definition: proposal.definition, duty };
    const failed = await fixture.service.writeCraftQualityReport(craftInput(repairFixture), authority("resume.definitions.write"));
    const rejected = await fixture.service.writeCraftRepair(repairInput(repairFixture, failed, "Responsible for coordinated routine work"), authority("resume.definitions.write"));

    expect(rejected.operation).toMatchObject({ result: "rejected", recovery_reason: "full_gate_regression" });
    const approvedHead = await fixture.store.readHead(approved.definition.metadata.record_id);
    expect(approvedHead.record_type === "resume_definition" ? craftDefinitionDigest(approvedHead) : null).toBe(approvedDigest);
    expect(approvedHead).toMatchObject({ metadata: { revision_id: approved.definition.metadata.revision_id }, status: "approved" });
    expect(await fixture.store.list("tailored_variant")).toHaveLength(0);
  });

  it("returns one exact bound evidence opportunity for absence and creates no fact when declined", async () => {
    const fixture = await setupAbsenceRoute();
    const factsBefore = await fixture.store.list("career_fact");
    const saved = await fixture.service.writeCraftQualityReport(craftInput(fixture), authority("resume.definitions.write"));

    expect(saved).toMatchObject({
      quality_state: "needs_correction",
      correction_action: {
        action: "add_evidence",
        coverage_record_id: fixture.coverage.metadata.record_id,
        coverage_revision_id: fixture.coverage.metadata.revision_id,
        coverage_revision: fixture.coverage.metadata.revision,
        job_fact_revision_id: fixture.factId,
        opportunity_id: fixture.opportunity.opportunity_id,
        dimension: "accomplishments",
        opportunity_kind: "qualitative",
        attempt: 1,
      },
      repair_scope: null,
      report: { report_version: 2, verdict: "fail" },
    });
    expect(await fixture.store.list("career_fact")).toEqual(factsBefore);

    const declined = await fixture.service.writeJobEvidenceCoverage({ action: "record", coverage_record_id: fixture.coverage.metadata.record_id, expected_revision: fixture.coverage.metadata.revision, job_fact_revision_id: fixture.factId, dimension: "accomplishments", state: "unknown", evidence_revision_ids: [], opportunity: fixture.opportunity }, authority("resume.definitions.write"));
    expect(declined.coverage.opportunities).toContainEqual(expect.objectContaining({ opportunity_id: fixture.opportunity.opportunity_id, state: "suppressed", suppression_reason: "owner_declined", attempt_count: 1 }));
    expect(await fixture.store.list("career_fact")).toEqual(factsBefore);
  });

  it("persists evidence-limited state but blocks ordinary owner approval", async () => {
    const fixture = await setup(false, false, true);
    const saved = await fixture.service.writeCraftQualityReport(craftInput(fixture), authority("resume.definitions.write"));
    expect(saved).toMatchObject({ quality_state: "evidence_limited", report: { evidence_context: "limited" } });
    await expect(fixture.service.approveDefinition({ kind: "approve_definition", definition_record_id: fixture.definition.metadata.record_id, expected_revision: 1, craft_report_revision_id: saved.report.metadata.revision_id }, authority("resume.definitions.write"), true)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("does not convert a repaired evidence-limited proposal into product-craft passed", async () => {
    const fixture = await setup(true, false, true);
    const saved = await fixture.service.writeCraftQualityReport(craftInput(fixture), authority("resume.definitions.write"));
    expect(saved).toMatchObject({ quality_state: "evidence_limited", correction_action: { action: "repair_statement" } });
    const repaired = await fixture.service.writeCraftRepair(repairInput(fixture, saved, "Coordinated routine work"), authority("resume.definitions.write"));
    expect(repaired).toMatchObject({ operation: { result: "rejected", recovery_reason: "full_gate_regression", transition: "needs_correction_preserved" }, definition: null, report: null });
  });
});
