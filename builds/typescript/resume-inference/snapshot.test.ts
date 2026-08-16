import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { ResumeDomainService } from "../resume-domain/service.js";
import { ResumeDataStore } from "../resume-domain/store.js";
import { authority, definitionInput, ownerDecision, proposalInput, testGrant } from "../resume-domain/test-helpers.js";
import { synthesizeResumeE2eResult } from "./e2e-fixture.js";
import { ImmutableInferenceSnapshotBuilder } from "./snapshot.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("immutable inference snapshot", () => {
  it("canonicalizes equivalent strategy invocation permutations before snapshot digests and blocks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-inference-canonical-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
    await store.initialize(grant.owner_id);
    const service = new ResumeDomainService(store);
    const confirmedJobs = [];
    for (const [title, startDate, endDate] of [["Earlier", "2018", "2020"], ["Current", "2021", "Present"]]) {
      const value = JSON.stringify({ format: "resume_job_v1", title, employer: "Synthetic Org", start_date: startDate, end_date: endDate });
      const proposed = await service.proposeFact({ ...proposalInput(value), fact: { ...proposalInput().fact, fact_kind: "employment" as const, value } }, authority("career.facts.propose"));
      const confirmAuthority = authority("career.facts.confirm");
      confirmedJobs.push((await service.confirmFact({ fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmAuthority, ownerDecision(confirmAuthority, proposed.fact.metadata.revision_id))).fact);
    }
    const coverage = [];
    for (const jobFact of confirmedJobs) {
      coverage.push((await service.writeJobEvidenceCoverage({ action: "initialize", job_fact_revision_id: jobFact.metadata.revision_id }, authority("resume.definitions.write"))).coverage);
    }
    const builder = new ImmutableInferenceSnapshotBuilder(store, () => new Date("2026-08-11T12:00:00.000Z"));
    const build = (factRevisionIds: string[], coverageRevisionIds: string[]) => builder.build({
      inference_contract_version: 1,
      purpose: "resume_strategy",
      operation_id: crypto.randomUUID(),
      fact_revision_ids: factRevisionIds,
      record_revision_ids: coverageRevisionIds,
    }, grant);
    const forward = await build(confirmedJobs.map((jobFact) => jobFact.metadata.revision_id), coverage.map((record) => record.metadata.revision_id));
    const reverse = await build(confirmedJobs.map((jobFact) => jobFact.metadata.revision_id).reverse(), coverage.map((record) => record.metadata.revision_id).reverse());
    const duplicated = await build(confirmedJobs.flatMap((jobFact) => [jobFact.metadata.revision_id, jobFact.metadata.revision_id]), coverage.flatMap((record) => [record.metadata.revision_id, record.metadata.revision_id]));
    expect(reverse.input_snapshot).toEqual(forward.input_snapshot);
    expect(duplicated.input_snapshot).toEqual(forward.input_snapshot);
    expect(canonicalInputDigest(reverse.data_blocks)).toBe(canonicalInputDigest(forward.data_blocks));
    expect(canonicalInputDigest(duplicated.data_blocks)).toBe(canonicalInputDigest(forward.data_blocks));
    const strategy = synthesizeResumeE2eResult("resume_strategy", forward.data_blocks);
    const saved = await service.writeResumeStrategy({
      kind: "resume_strategy",
      fact_revision_ids: confirmedJobs.flatMap((jobFact) => [jobFact.metadata.revision_id, jobFact.metadata.revision_id]).reverse(),
      coverage_revision_ids: coverage.flatMap((record) => [record.metadata.revision_id, record.metadata.revision_id]).reverse(),
      target_revision_id: null,
      presentation_preferences: {},
      strategy,
      inference_binding: {
        prompt_policy_id: forward.prompt_policy_id,
        prompt_policy_version: forward.prompt_policy_version,
        input_digest: canonicalInputDigest(forward.data_blocks),
        output_digest: canonicalInputDigest(strategy),
        provider_profile_id: "synthetic-resume-e2e",
        model_id: "deterministic-fixture-v1",
      },
    }, authority("resume.definitions.write"));
    expect(saved.strategy).toMatchObject({
      fact_revision_ids: (forward.data_blocks[0]!.data as { facts: Array<{ revision_id: string }> }).facts.map((fact) => fact.revision_id),
      coverage_revision_ids: forward.data_blocks.filter((block) => block.category === "coverage_summary").map((block) => (block.data as { metadata: { revision_id: string } }).metadata.revision_id),
      input_digest: canonicalInputDigest(forward.data_blocks),
      output_digest: canonicalInputDigest(strategy),
    });
  });

  it("reads exact confirmed revisions and never resolves a provider or path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-inference-snapshot-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
    await store.initialize(grant.owner_id);
    const service = new ResumeDomainService(store);
    const proposal = await service.proposeFact(proposalInput("Built product 20%"), authority("career.facts.propose"));
    const confirmationAuthority = authority("career.facts.confirm");
    const confirmed = await service.confirmFact({ fact_record_id: proposal.fact.metadata.record_id, fact_revision_id: proposal.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmationAuthority, ownerDecision(confirmationAuthority, proposal.fact.metadata.revision_id));
    const builder = new ImmutableInferenceSnapshotBuilder(store, () => new Date("2026-08-07T12:00:00.000Z"));
    const request = await builder.build({ inference_contract_version: 1, purpose: "requirement_evidence_match", operation_id: crypto.randomUUID(), fact_revision_ids: [confirmed.fact.metadata.revision_id] }, grant);
    expect(request.input_snapshot.record_revision_ids).toEqual([confirmed.fact.metadata.revision_id]);
    expect(request.data_blocks[0]).toMatchObject({ category: "confirmed_fact_snapshot", data: { facts: [{ value: "Built product 20%" }] } });
    expect(JSON.stringify(request)).not.toContain(root);
  });

  it("rejects unconfirmed facts and missing inference authority", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-inference-snapshot-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
    await store.initialize(grant.owner_id);
    const service = new ResumeDomainService(store);
    const proposal = await service.proposeFact(proposalInput(), authority("career.facts.propose"));
    const builder = new ImmutableInferenceSnapshotBuilder(store);
    const invocation = { inference_contract_version: 1, purpose: "interview_assist", operation_id: crypto.randomUUID(), fact_revision_ids: [proposal.fact.metadata.revision_id] };
    await expect(builder.build(invocation, grant)).rejects.toMatchObject({ code: "validation_failed" });
    await expect(builder.build({ ...invocation, fact_revision_ids: [] }, testGrant())).rejects.toMatchObject({ code: "denied" });
  });

  it("requires the versioned app contract, clamps app budgets, and rejects provider authority fields", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-inference-snapshot-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
    await store.initialize(grant.owner_id);
    const service = new ResumeDomainService(store);
    const builder = new ImmutableInferenceSnapshotBuilder(store, () => new Date("2026-08-07T12:00:00.000Z"));
    const jobValue = JSON.stringify({ format: "resume_job_v1", title: "Coordinator", employer: "Synthetic Org", responsibilities: "Coordinated service work." });
    const proposal = await service.proposeFact({
      ...proposalInput(jobValue),
      fact: { ...proposalInput().fact, fact_kind: "employment" as const, value: jobValue },
    }, authority("career.facts.propose"));
    const confirmationAuthority = authority("career.facts.confirm");
    const confirmed = await service.confirmFact({ fact_record_id: proposal.fact.metadata.record_id, fact_revision_id: proposal.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmationAuthority, ownerDecision(confirmationAuthority, proposal.fact.metadata.revision_id));
    const summary = {
      active_job_fact_revision_id: confirmed.fact.metadata.revision_id,
      active_job_revision: confirmed.fact.metadata.revision,
      requested_opportunity_id: crypto.randomUUID(),
      requested_dimension: "accomplishments",
      opportunity_kind: "qualitative",
      value_category: "distinct_accomplishment",
      dimensions: [{ dimension: "responsibilities", outcome: "answered", evidence_revision_ids: [confirmed.fact.metadata.revision_id] }],
    };
    const operationId = crypto.randomUUID();
    await expect(builder.build({ purpose: "interview_assist", operation_id: operationId, fact_revision_ids: [] }, grant)).rejects.toBeDefined();
    const request = await builder.build({
      inference_contract_version: 1,
      purpose: "interview_assist",
      operation_id: operationId,
      fact_revision_ids: [confirmed.fact.metadata.revision_id],
      derived_blocks: [{ category: "job_evidence_summary", schema_id: "resume.job-evidence-summary.v2", data: summary }],
      budget: { input_bytes: 2_048, input_tokens: 256, output_tokens: 128, duration_ms: 5_000, attempts: 1 },
    }, grant);
    expect(request.limits).toMatchObject({ input_bytes: 2_048, input_tokens: 256, output_tokens: 128, duration_ms: 5_000, attempts: 1, concurrency: 1 });
    await expect(builder.build({
      inference_contract_version: 1,
      purpose: "interview_assist",
      operation_id: crypto.randomUUID(),
      fact_revision_ids: [confirmed.fact.metadata.revision_id],
      derived_blocks: [{ category: "job_evidence_summary", schema_id: "resume.job-evidence-summary.v2", data: summary }],
      provider: "evil",
      model: "evil",
      endpoint: "https://evil.invalid",
      api_key: "sk-app-selected",
    }, grant)).rejects.toBeDefined();
  });

  it("requires current complete job coverage before strategy inference", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-inference-strategy-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
    await store.initialize(grant.owner_id);
    const service = new ResumeDomainService(store);
    const jobValue = JSON.stringify({ format: "resume_job_v1", title: "Coordinator", employer: "Synthetic Org", responsibilities: "Coordinated service work." });
    const proposal = await service.proposeFact({ ...proposalInput(jobValue), fact: { ...proposalInput().fact, fact_kind: "employment" as const, value: jobValue } }, authority("career.facts.propose"));
    const confirmationAuthority = authority("career.facts.confirm");
    const confirmed = await service.confirmFact({ fact_record_id: proposal.fact.metadata.record_id, fact_revision_id: proposal.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmationAuthority, ownerDecision(confirmationAuthority, proposal.fact.metadata.revision_id));
    const coverage = await service.writeJobEvidenceCoverage({ action: "initialize", job_fact_revision_id: confirmed.fact.metadata.revision_id }, authority("resume.definitions.write"));
    const builder = new ImmutableInferenceSnapshotBuilder(store);
    const invocation = (coverageRevisionIds: string[]) => ({
      inference_contract_version: 1 as const,
      purpose: "resume_strategy" as const,
      operation_id: crypto.randomUUID(),
      fact_revision_ids: [confirmed.fact.metadata.revision_id],
      record_revision_ids: coverageRevisionIds,
    });
    await expect(builder.build(invocation([]), grant)).rejects.toMatchObject({ code: "validation_failed" });
    await expect(builder.build(invocation([coverage.coverage.metadata.revision_id]), grant)).resolves.toMatchObject({ purpose: "resume_strategy" });
    const updated = await service.writeJobEvidenceCoverage({ action: "record", coverage_record_id: coverage.coverage.metadata.record_id, expected_revision: 1, job_fact_revision_id: confirmed.fact.metadata.revision_id, dimension: "outcomes", state: "unknown", evidence_revision_ids: [], opportunity: null }, authority("resume.definitions.write"));
    await expect(builder.build(invocation([coverage.coverage.metadata.revision_id]), grant)).rejects.toMatchObject({ code: "validation_failed" });
    await expect(builder.build(invocation([updated.coverage.metadata.revision_id]), grant)).resolves.toMatchObject({ purpose: "resume_strategy" });
    await expect(builder.build({ ...invocation([]), fact_revision_ids: [] }, grant)).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("requires active-job interview assistance to match confirmed job evidence and excludes recovery drafts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-inference-job-evidence-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
    await store.initialize(grant.owner_id);
    const service = new ResumeDomainService(store);
    const jobValue = JSON.stringify({ format: "resume_job_v1", title: "Coordinator", employer: "Synthetic Org", responsibilities: "Coordinated service work." });
    const proposed = await service.proposeFact({ ...proposalInput(jobValue), fact: { ...proposalInput().fact, fact_kind: "employment" as const, value: jobValue } }, authority("career.facts.propose"));
    const confirmAuthority = authority("career.facts.confirm");
    const job = await service.confirmFact({ fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmAuthority, ownerDecision(confirmAuthority, proposed.fact.metadata.revision_id));
    const builder = new ImmutableInferenceSnapshotBuilder(store);
    const base = {
      inference_contract_version: 1 as const,
      purpose: "interview_assist" as const,
      operation_id: crypto.randomUUID(),
      fact_revision_ids: [job.fact.metadata.revision_id],
    };
    await expect(builder.build(base, grant)).rejects.toMatchObject({ code: "invalid_request" });
    await expect(builder.build({
      ...base,
      operation_id: crypto.randomUUID(),
      derived_blocks: [{ category: "job_evidence_summary", schema_id: "resume.job-evidence-summary.v2", data: {
        active_job_fact_revision_id: crypto.randomUUID(),
        active_job_revision: 2,
        requested_opportunity_id: crypto.randomUUID(),
        requested_dimension: "accomplishments",
        opportunity_kind: "qualitative",
        value_category: "distinct_accomplishment",
        dimensions: [],
      } }],
    }, grant)).rejects.toMatchObject({ code: "validation_failed" });
    const request = await builder.build({
      ...base,
      operation_id: crypto.randomUUID(),
      derived_blocks: [{ category: "job_evidence_summary", schema_id: "resume.job-evidence-summary.v2", data: {
        active_job_fact_revision_id: job.fact.metadata.revision_id,
        active_job_revision: job.fact.metadata.revision,
        requested_opportunity_id: crypto.randomUUID(),
        requested_dimension: "accomplishments",
        opportunity_kind: "qualitative",
        value_category: "distinct_accomplishment",
        dimensions: [{ dimension: "responsibilities", outcome: "answered", evidence_revision_ids: [job.fact.metadata.revision_id] }],
      } }],
    }, grant);
    expect(request.data_blocks).toEqual(expect.arrayContaining([expect.objectContaining({ category: "job_evidence_summary" })]));
    expect(JSON.stringify(request)).not.toContain("recovery_draft");
  });

  it("binds revision classification and drafting to the persisted request and immutable source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-inference-revision-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
    await store.initialize(grant.owner_id);
    const service = new ResumeDomainService(store);
    const proposal = await service.proposeFact(proposalInput(), authority("career.facts.propose"));
    const confirmationAuthority = authority("career.facts.confirm");
    const confirmed = await service.confirmFact({ fact_record_id: proposal.fact.metadata.record_id, fact_revision_id: proposal.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmationAuthority, ownerDecision(confirmationAuthority, proposal.fact.metadata.revision_id));
    const source = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id), authority("resume.definitions.write"), true);
    const submitted = await service.submitRevisionRequest({
      kind: "revision_request",
      source_definition_revision_id: source.definition.metadata.revision_id,
      target: { scope: "resume", target_id: null },
      request_text: "Shorten the wording without changing facts.",
    }, authority("resume.definitions.write"));
    const builder = new ImmutableInferenceSnapshotBuilder(store);

    const classification = await builder.build({
      inference_contract_version: 1,
      purpose: "resume_revision_classify",
      operation_id: crypto.randomUUID(),
      fact_revision_ids: [confirmed.fact.metadata.revision_id],
      record_revision_ids: [source.definition.metadata.revision_id, submitted.request.metadata.revision_id],
    }, grant);
    expect(classification.data_blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "general_resume_definition", data: expect.objectContaining({ metadata: expect.objectContaining({ revision_id: source.definition.metadata.revision_id }) }) }),
      expect.objectContaining({ category: "revision_instruction", data: expect.objectContaining({ request_digest: submitted.request.request_digest }) }),
    ]));
    expect(JSON.stringify(classification)).toContain("Shorten the wording");

    await expect(builder.build({
      inference_contract_version: 1,
      purpose: "resume_revision_draft",
      operation_id: crypto.randomUUID(),
      fact_revision_ids: [confirmed.fact.metadata.revision_id],
      record_revision_ids: [source.definition.metadata.revision_id, submitted.request.metadata.revision_id],
    }, grant)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("accepts only one bounded dialogue context and keeps provider authority outside the snapshot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-inference-dialogue-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
    await store.initialize(grant.owner_id);
    const builder = new ImmutableInferenceSnapshotBuilder(store, () => new Date("2026-08-15T12:00:00.000Z"));
    const context = {
      dialogue_version: 1,
      messages: [
        { role: "assistant", content: "Would you like to start with your work history?" },
        { role: "user", content: "Do you mean my last role or all my roles?" },
      ],
      current_user_message: "Do you mean my last role or all my roles?",
      requested_mode: "intake",
    };
    const request = await builder.build({
      inference_contract_version: 1,
      purpose: "resume_dialogue",
      operation_id: crypto.randomUUID(),
      fact_revision_ids: [],
      derived_blocks: [{ category: "dialogue_context", schema_id: "resume.dialogue-context.v1", data: context }],
    }, grant);
    expect(request).toMatchObject({ purpose: "resume_dialogue", prompt_policy_id: "braindrive.resume-builder.dialogue", prompt_policy_version: "3" });
    expect(request.data_blocks).toEqual(expect.arrayContaining([expect.objectContaining({ category: "dialogue_context", data: context })]));
    expect(JSON.stringify(request)).not.toContain("provider_profile_id");

    await expect(builder.build({
      inference_contract_version: 1,
      purpose: "resume_dialogue",
      operation_id: crypto.randomUUID(),
      fact_revision_ids: [],
      derived_blocks: [
        { category: "dialogue_context", schema_id: "resume.dialogue-context.v1", data: context },
        { category: "dialogue_context", schema_id: "resume.dialogue-context.v1", data: context },
      ],
    }, grant)).rejects.toMatchObject({ code: "invalid_request" });
  });
});
