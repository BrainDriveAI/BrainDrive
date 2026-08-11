import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { ResumeDomainService } from "./service.js";
import { ResumeDataStore } from "./store.js";
import { authority, ownerDecision, testGrant } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup(now = "2026-08-11T12:00:00.000Z") {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-coverage-m2-")); roots.push(root);
  const store = new ResumeDataStore(root, undefined, {}, false);
  await store.initialize(testGrant().owner_id);
  const service = new ResumeDomainService(store, () => new Date(now));
  const jobValue = JSON.stringify({ format: "resume_job_v1", title: "Support Lead", employer: "Northwind", location: "", start_date: "2022", end_date: "Present", responsibilities: "Led escalations" });
  const proposed = await service.proposeFact({
    source: { source_kind: "owner_interview", safe_label: "Resume interview", content_digest: canonicalInputDigest(jobValue), captured_at: now },
    fact: { fact_kind: "employment", state: "suggested", value: jobValue, sensitivity: "standard" },
  }, authority("career.facts.propose"));
  const confirmAuthority = authority("career.facts.confirm");
  const confirmed = await service.confirmFact({ fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmAuthority, ownerDecision(confirmAuthority, proposed.fact.metadata.revision_id));
  return { store, service, job: confirmed.fact };
}

describe("Spec 07 job evidence coverage domain", () => {
  it("initializes all six dimensions explicitly and preserves exact job identity", async () => {
    const { service, job } = await setup();
    await expect(service.writeJobEvidenceCoverage({ action: "initialize", job_fact_revision_id: job.metadata.revision_id }, authority("career.facts.read"))).rejects.toMatchObject({ code: "denied" });
    const result = await service.writeJobEvidenceCoverage({ action: "initialize", job_fact_revision_id: job.metadata.revision_id }, authority("resume.definitions.write"));
    expect(result.coverage).toMatchObject({
      job_fact_revision_id: job.metadata.revision_id,
      dimensions: {
        responsibilities: { state: "answered", evidence_revision_ids: [job.metadata.revision_id] },
        accomplishments: { state: "unanswered" }, outcomes: { state: "unanswered" }, tools: { state: "unanswered" }, scope: { state: "unanswered" }, progression: { state: "unanswered" },
      },
    });
  });

  it("atomically defers every unanswered dimension, creates no fact, and reopens one owner-selected dimension", async () => {
    const { store, service, job } = await setup();
    const initialized = await service.writeJobEvidenceCoverage({ action: "initialize", job_fact_revision_id: job.metadata.revision_id }, authority("resume.definitions.write"));
    const factCount = (await store.list("career_fact")).length;
    const completed = await service.writeJobEvidenceCoverage({ action: "complete_for_now", coverage_record_id: initialized.coverage.metadata.record_id, expected_revision: 1, job_fact_revision_id: job.metadata.revision_id }, authority("resume.definitions.write"));
    expect(Object.values(completed.coverage.dimensions).filter((item) => item.state === "deferred")).toHaveLength(5);
    expect(completed.coverage.dimensions.responsibilities.state).toBe("answered");
    expect(await store.list("career_fact")).toHaveLength(factCount);

    const reopened = await service.writeJobEvidenceCoverage({ action: "reopen", coverage_record_id: completed.coverage.metadata.record_id, expected_revision: 2, job_fact_revision_id: job.metadata.revision_id, dimension: "scope", opportunity_id: null }, authority("resume.definitions.write"));
    expect(reopened.coverage.dimensions.scope).toMatchObject({ state: "unanswered", evidence_revision_ids: [], recorded_at: null });
    expect(reopened.coverage.dimensions.progression.state).toBe("deferred");
  });

  it.each(["unknown", "not_applicable", "skipped"] as const)("persists %s as coverage without creating or confirming a career fact", async (state) => {
    const { store, service, job } = await setup();
    const initialized = await service.writeJobEvidenceCoverage({ action: "initialize", job_fact_revision_id: job.metadata.revision_id }, authority("resume.definitions.write"));
    const before = await store.list("career_fact");
    const transitioned = await service.writeJobEvidenceCoverage({ action: "record", coverage_record_id: initialized.coverage.metadata.record_id, expected_revision: 1, job_fact_revision_id: job.metadata.revision_id, dimension: "outcomes", state, evidence_revision_ids: [], opportunity: null }, authority("resume.definitions.write"));
    expect(transitioned.coverage.dimensions.outcomes.state).toBe(state);
    expect(await store.list("career_fact")).toEqual(before);
  });

  it("rejects stale CAS and evidence associated with another identical-looking job", async () => {
    const { service, job } = await setup();
    const initialized = await service.writeJobEvidenceCoverage({ action: "initialize", job_fact_revision_id: job.metadata.revision_id }, authority("resume.definitions.write"));
    await service.writeJobEvidenceCoverage({ action: "record", coverage_record_id: initialized.coverage.metadata.record_id, expected_revision: 1, job_fact_revision_id: job.metadata.revision_id, dimension: "outcomes", state: "unknown", evidence_revision_ids: [], opportunity: null }, authority("resume.definitions.write"));
    await expect(service.writeJobEvidenceCoverage({ action: "record", coverage_record_id: initialized.coverage.metadata.record_id, expected_revision: 1, job_fact_revision_id: job.metadata.revision_id, dimension: "tools", state: "skipped", evidence_revision_ids: [], opportunity: null }, authority("resume.definitions.write"))).rejects.toMatchObject({ code: "conflict" });

    const duplicateJobValue = job.value;
    const proposedDuplicate = await service.proposeFact({
      source: { source_kind: "owner_interview", safe_label: "Resume interview", content_digest: canonicalInputDigest(duplicateJobValue), captured_at: "2026-08-11T12:00:00.000Z" },
      fact: { fact_kind: "employment", state: "suggested", value: duplicateJobValue, sensitivity: "standard" },
    }, authority("career.facts.propose"));
    const duplicateConfirmationAuthority = authority("career.facts.confirm");
    const duplicateJob = await service.confirmFact({ fact_record_id: proposedDuplicate.fact.metadata.record_id, fact_revision_id: proposedDuplicate.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, duplicateConfirmationAuthority, ownerDecision(duplicateConfirmationAuthority, proposedDuplicate.fact.metadata.revision_id));
    const otherEvidenceValue = JSON.stringify({ value_version: 1, association: "job", job_fact_revision_id: duplicateJob.fact.metadata.revision_id, dimension: "tools", outcome: "answered", owner_text: "Used the same-looking system on the concurrent role." });
    const proposedEvidence = await service.proposeFact({
      source: { source_kind: "owner_interview", safe_label: "Resume job evidence", content_digest: canonicalInputDigest(otherEvidenceValue), captured_at: "2026-08-11T12:00:00.000Z" },
      fact: { fact_kind: "job_evidence", state: "suggested", value: otherEvidenceValue, sensitivity: "standard" },
    }, authority("career.facts.propose"));
    const evidenceConfirmationAuthority = authority("career.facts.confirm");
    const otherEvidence = await service.confirmFact({ fact_record_id: proposedEvidence.fact.metadata.record_id, fact_revision_id: proposedEvidence.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, evidenceConfirmationAuthority, ownerDecision(evidenceConfirmationAuthority, proposedEvidence.fact.metadata.revision_id));
    await expect(service.writeJobEvidenceCoverage({ action: "record", coverage_record_id: initialized.coverage.metadata.record_id, expected_revision: 2, job_fact_revision_id: job.metadata.revision_id, dimension: "tools", state: "answered", evidence_revision_ids: [otherEvidence.fact.metadata.revision_id], opportunity: null }, authority("resume.definitions.write"))).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("persists one-attempt suppression across restart and permits explicit reopen", async () => {
    const { store, service, job } = await setup();
    const initialized = await service.writeJobEvidenceCoverage({ action: "initialize", job_fact_revision_id: job.metadata.revision_id }, authority("resume.definitions.write"));
    const opportunity = { opportunity_id: crypto.randomUUID(), dimension: "scope", opportunity_kind: "metric", value_category: "scope_or_scale", context_digest: canonicalInputDigest({ job: job.metadata.revision_id, dimension: "scope" }) } as const;
    const presented = await service.writeJobEvidenceCoverage({ action: "opportunity_presented", coverage_record_id: initialized.coverage.metadata.record_id, expected_revision: 1, job_fact_revision_id: job.metadata.revision_id, opportunity }, authority("resume.definitions.write"));
    const suppressed = await service.writeJobEvidenceCoverage({ action: "opportunity_suppressed", coverage_record_id: presented.coverage.metadata.record_id, expected_revision: 2, job_fact_revision_id: job.metadata.revision_id, opportunity_id: opportunity.opportunity_id, suppression_reason: "owner_declined" }, authority("resume.definitions.write"));
    expect(suppressed.coverage.opportunities[0]).toMatchObject({ state: "suppressed", attempt_count: 1, suppression_reason: "owner_declined" });

    const restarted = new ResumeDomainService(new ResumeDataStore(store.memoryRoot, store.namespaceRoot, {}, false), () => new Date("2026-08-11T13:00:00.000Z"));
    await restarted.store.initialize(testGrant().owner_id);
    const reopened = await restarted.writeJobEvidenceCoverage({ action: "reopen", coverage_record_id: suppressed.coverage.metadata.record_id, expected_revision: 3, job_fact_revision_id: job.metadata.revision_id, dimension: "scope", opportunity_id: opportunity.opportunity_id }, authority("resume.definitions.write"));
    expect(reopened.coverage.opportunities[0]).toMatchObject({ state: "available", attempt_count: 0, suppression_reason: null, reopened_at: "2026-08-11T13:00:00.000Z" });
  });
});
