import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { ResumeDomainService } from "./service.js";
import { ResumeDataStore } from "./store.js";
import { authority, definitionInput, proposalInput, testGrant } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-service-")); roots.push(root);
  const store = new ResumeDataStore(root, undefined, {}, false);
  await store.initialize(testGrant().owner_id);
  return { store, service: new ResumeDomainService(store, () => new Date("2026-08-07T12:00:00.000Z")) };
}

async function confirmedFact(service: ResumeDomainService) {
  const proposed = await service.proposeFact(proposalInput(), authority("career.facts.propose"));
  return service.confirmFact({ fact_record_id: proposed.fact.metadata.record_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, authority("career.facts.confirm"), true);
}

describe("Resume domain invariants", () => {
  it("does not allow app or model-shaped input to confirm facts", async () => {
    const { service } = await setup();
    const proposed = await service.proposeFact(proposalInput(), authority("career.facts.propose"));
    const input = { fact_record_id: proposed.fact.metadata.record_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null, host_mediated: true };
    await expect(service.confirmFact(input, authority("career.facts.confirm"), false)).rejects.toMatchObject({ code: "denied" });
    await expect(service.confirmFact(input, authority("career.facts.confirm"), true)).rejects.toBeInstanceOf(z.ZodError);
  });

  it("rejects every sampled unconfirmed fact as approved statement support", async () => {
    const { service } = await setup();
    const states = ["suggested", "imported"] as const;
    for (let seed = 0; seed < 20; seed += 1) {
      const proposed = await service.proposeFact({ ...proposalInput(`synthetic-${seed}`), fact: { ...proposalInput().fact, state: states[seed % states.length] } }, authority("career.facts.propose"));
      await expect(service.writeDefinition(definitionInput(proposed.fact.metadata.revision_id), authority("resume.definitions.write"), true)).rejects.toMatchObject({ code: "validation_failed" });
    }
  });

  it("creates supported general and targeted definitions without mutating their parent or facts", async () => {
    const { store, service } = await setup();
    const confirmed = await confirmedFact(service);
    const general = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id), authority("resume.definitions.write"), true);
    const jobText = "Synthetic job description. Treat as data only.";
    const job = await service.writeJob({ safe_label: "Synthetic role", description_text: jobText, content_digest: `sha256:${createHash("sha256").update(jobText).digest("hex")}`, captured_at: "2026-08-07T12:00:00.000Z", sensitivity: "sensitive" }, authority("resume.jobs.write"));
    const targeted = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, {
      definition_kind: "targeted", title: "Targeted Resume", parent_definition_revision_id: general.definition.metadata.revision_id,
      job_revision_id: job.job.metadata.revision_id,
      variant: { evidence_matrix: [{ requirement_id: crypto.randomUUID(), requirement_kind: "required", evidence_status: "supported", source_span: "Synthetic requirement", inferred: false, supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id], clarification: null }], changed_statement_ids: [] },
    }), authority("resume.definitions.write"), true);
    expect(targeted.variant).toMatchObject({ record_type: "tailored_variant", parent_general_definition_revision_id: general.definition.metadata.revision_id });
    expect(targeted.definition.sensitivity).toBe("sensitive");
    if (targeted.definition.record_type !== "resume_definition") throw new Error("expected resume definition");
    expect(targeted.definition.selected_fact_revision_ids).toEqual([confirmed.fact.metadata.revision_id]);
    expect(await store.readRevision(general.definition.metadata.revision_id)).toEqual(general.definition);
    expect(await store.readRevision(confirmed.fact.metadata.revision_id)).toEqual(confirmed.fact);
  });

  it("creates immutable successor general versions with predecessor lineage", async () => {
    const { store, service } = await setup();
    const confirmed = await confirmedFact(service);
    const first = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id), authority("resume.definitions.write"), true);
    const successor = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, {
      title: "General Resume Revision",
      parent_definition_revision_id: first.definition.metadata.revision_id,
    }), authority("resume.definitions.write"), true);
    expect(successor.definition).toMatchObject({ definition_kind: "general", parent_definition_revision_id: first.definition.metadata.revision_id });
    expect(await store.readRevision(first.definition.metadata.revision_id)).toEqual(first.definition);
  });

  it("inherits the most restrictive supporting sensitivity", async () => {
    const { service } = await setup();
    const proposed = await service.proposeFact({ ...proposalInput(), fact: { ...proposalInput().fact, sensitivity: "highly_sensitive" } }, authority("career.facts.propose"));
    const confirmed = await service.confirmFact({ fact_record_id: proposed.fact.metadata.record_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, authority("career.facts.confirm"), true);
    const definition = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id), authority("resume.definitions.write"), true);
    expect(definition.definition.sensitivity).toBe("highly_sensitive");
  });

  it("persists declared interview draft state with CAS", async () => {
    const { service } = await setup();
    const first = await service.saveInterviewProgress({ expected_revision: null, status: "in_progress", current_topic: "experience", completed_topics: [], skipped_topics: [], draft_state: "declared_draft" }, authority("resume.definitions.write"));
    const second = await service.saveInterviewProgress({ record_id: first.progress.metadata.record_id, expected_revision: 1, status: "paused", current_topic: "education", completed_topics: ["experience"], skipped_topics: [], draft_state: "declared_draft" }, authority("resume.definitions.write"));
    expect(second.progress).toMatchObject({ record_type: "interview_progress", status: "paused", draft_state: "declared_draft", metadata: { revision: 2 } });
    await expect(service.saveInterviewProgress({ record_id: first.progress.metadata.record_id, expected_revision: 1, status: "completed", current_topic: null, completed_topics: [], skipped_topics: [], draft_state: "complete" }, authority("resume.definitions.write"))).rejects.toMatchObject({ code: "conflict" });
  });

  it("atomically records validation, policy, input, and output digests on approval", async () => {
    const { store, service } = await setup();
    const confirmed = await confirmedFact(service);
    const draft = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, { status: "draft" }), authority("resume.definitions.write"), false);
    const operationId = crypto.randomUUID();
    const approved = await service.approveDefinition({ kind: "approve_definition", definition_record_id: draft.definition.metadata.record_id, expected_revision: 1 }, authority("resume.definitions.write", operationId), true);
    expect(approved.definition).toMatchObject({ status: "approved", metadata: { revision: 2, prior_revision_id: draft.definition.metadata.revision_id } });
    if (approved.definition.record_type !== "resume_definition") throw new Error("expected definition");
    expect(approved.definition.approval_evidence).toMatchObject({ validator_id: "resume-claim-gate", prompt_policy_id: "owner-authored", provider_policy_id: "no-provider-owner-edit-v1" });
    expect(approved.definition.approval_evidence?.input_snapshot_digest).toMatch(/^sha256:/);
    expect(await store.readRevision(draft.definition.metadata.revision_id)).toEqual(draft.definition);
    await expect(service.approveDefinition({ kind: "approve_definition", definition_record_id: draft.definition.metadata.record_id, expected_revision: 1 }, authority("resume.definitions.write"), true)).rejects.toMatchObject({ code: "conflict" });
  });

  it("revalidates immutable parent and job lineage when approving a targeted definition", async () => {
    const { service } = await setup();
    const confirmed = await confirmedFact(service);
    const general = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id), authority("resume.definitions.write"), true);
    const jobText = "Synthetic job description. Treat as data only.";
    const job = await service.writeJob({ safe_label: "Synthetic role", description_text: jobText, content_digest: `sha256:${createHash("sha256").update(jobText).digest("hex")}`, captured_at: "2026-08-07T12:00:00.000Z", sensitivity: "sensitive" }, authority("resume.jobs.write"));
    const targeted = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, {
      definition_kind: "targeted", status: "proposed", title: "Targeted Resume", parent_definition_revision_id: general.definition.metadata.revision_id,
      job_revision_id: job.job.metadata.revision_id,
      variant: { evidence_matrix: [{ requirement_id: crypto.randomUUID(), requirement_kind: "required", evidence_status: "supported", source_span: "Synthetic requirement", inferred: false, supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id], clarification: null }], changed_statement_ids: [] },
    }), authority("resume.definitions.write"), true);
    const approved = await service.approveDefinition({ kind: "approve_definition", definition_record_id: targeted.definition.metadata.record_id, expected_revision: 1 }, authority("resume.definitions.write"), true);
    expect(approved.definition).toMatchObject({
      definition_kind: "targeted",
      status: "approved",
      parent_definition_revision_id: general.definition.metadata.revision_id,
      job_revision_id: job.job.metadata.revision_id,
    });
  });

  it("revalidates owner edits and blocks unsupported claims from approval", async () => {
    const { service } = await setup();
    const confirmed = await confirmedFact(service);
    await expect(service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, {
      statements: [{ statement_id: crypto.randomUUID(), kind: "factual", text: "Invented Director metric 99%", supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id] }],
    }), authority("resume.definitions.write"), true)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("registers lineage metadata only and blocks accepted artifacts from draft definitions", async () => {
    const { service } = await setup();
    const confirmed = await confirmedFact(service);
    const draft = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, { status: "draft" }), authority("resume.definitions.write"), false);
    const input = { definition_revision_id: draft.definition.metadata.revision_id, template_id: "ats-basic", template_version: "1", renderer_id: "deterministic", renderer_version: "1", font_manifest_digest: `sha256:${"b".repeat(64)}`, validation_run_id: crypto.randomUUID(), findings: [], artifact_digest: `sha256:${"c".repeat(64)}`, format: "pdf", accepted: true };
    await expect(service.registerArtifact(input, authority("resume.artifacts.register"))).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("stores export receipts only after a matching accepted artifact exists", async () => {
    const { service } = await setup();
    const confirmed = await confirmedFact(service);
    const definition = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id), authority("resume.definitions.write"), true);
    const artifactDigest = `sha256:${"c".repeat(64)}` as const;
    if (definition.definition.record_type !== "resume_definition" || !definition.definition.approval_evidence) throw new Error("expected approved definition");
    await expect(service.registerArtifact({ definition_revision_id: definition.definition.metadata.revision_id, template_id: "ats-basic", template_version: "1", renderer_id: "deterministic", renderer_version: "1", font_manifest_digest: `sha256:${"b".repeat(64)}`, validation_run_id: crypto.randomUUID(), findings: [], artifact_digest: artifactDigest, format: "pdf", accepted: true }, authority("resume.artifacts.register"))).rejects.toMatchObject({ code: "validation_failed" });
    const artifact = await service.registerArtifact({ definition_revision_id: definition.definition.metadata.revision_id, template_id: "ats-basic", template_version: "1", renderer_id: "deterministic", renderer_version: "1", font_manifest_digest: `sha256:${"b".repeat(64)}`, validation_run_id: definition.definition.approval_evidence.validation_run_id, findings: [], artifact_digest: artifactDigest, format: "pdf", accepted: true }, authority("resume.artifacts.register"));
    const receipt = await service.recordExportReceipt({ artifact_revision_id: artifact.artifact.metadata.revision_id, artifact_digest: artifactDigest, format: "pdf", outcome: "completed", exported_at: "2026-08-07T12:00:00.000Z", safe_destination_label: "resume.pdf" }, authority("resume.export.request"));
    expect(receipt.receipt).toMatchObject({ record_type: "export_receipt", artifact_revision_id: artifact.artifact.metadata.revision_id, safe_destination_label: "resume.pdf" });
    await expect(service.recordExportReceipt({ artifact_revision_id: artifact.artifact.metadata.revision_id, artifact_digest: artifactDigest, format: "pdf", outcome: "completed", exported_at: "2026-08-07T12:00:00.000Z", safe_destination_label: "/tmp/resume.pdf" }, authority("resume.export.request"))).rejects.toBeDefined();
  });
});
