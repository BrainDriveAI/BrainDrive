import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ResumeDomainService } from "../resume-domain/service.js";
import { ResumeDataStore } from "../resume-domain/store.js";
import { authority, ownerDecision, proposalInput, testGrant } from "../resume-domain/test-helpers.js";
import { ImmutableInferenceSnapshotBuilder } from "./snapshot.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("immutable inference snapshot", () => {
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
    const request = await builder.build({ inference_contract_version: 1, purpose: "general_resume_draft", operation_id: crypto.randomUUID(), fact_revision_ids: [confirmed.fact.metadata.revision_id] }, grant);
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
    const builder = new ImmutableInferenceSnapshotBuilder(store, () => new Date("2026-08-07T12:00:00.000Z"));
    const operationId = crypto.randomUUID();
    await expect(builder.build({ purpose: "interview_assist", operation_id: operationId, fact_revision_ids: [] }, grant)).rejects.toBeDefined();
    const request = await builder.build({
      inference_contract_version: 1,
      purpose: "interview_assist",
      operation_id: operationId,
      fact_revision_ids: [],
      budget: { input_bytes: 1_024, input_tokens: 256, output_tokens: 128, duration_ms: 5_000, attempts: 1 },
    }, grant);
    expect(request.limits).toMatchObject({ input_bytes: 1_024, input_tokens: 256, output_tokens: 128, duration_ms: 5_000, attempts: 1, concurrency: 1 });
    await expect(builder.build({
      inference_contract_version: 1,
      purpose: "interview_assist",
      operation_id: crypto.randomUUID(),
      fact_revision_ids: [],
      provider: "evil",
      model: "evil",
      endpoint: "https://evil.invalid",
      api_key: "sk-app-selected",
    }, grant)).rejects.toBeDefined();
  });
});
