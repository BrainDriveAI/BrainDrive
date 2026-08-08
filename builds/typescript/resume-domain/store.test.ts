import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ResumeDomainError } from "./errors.js";
import { ResumeDomainService } from "./service.js";
import { ResumeDataCatalogSchema, ResumeDataStore } from "./store.js";
import { authority, proposalInput, testGrant } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-data-")); roots.push(root);
  const store = new ResumeDataStore(root, undefined, {}, false);
  await store.initialize(testGrant().owner_id);
  return { root, store, service: new ResumeDomainService(store, () => new Date("2026-08-07T12:00:00.000Z")) };
}

describe("ResumeDataStore atomic catalog and operations", () => {
  it("commits source and fact atomically and reuses the exact result for an equivalent retry", async () => {
    const { store, service } = await setup();
    const operationId = crypto.randomUUID();
    const auth = authority("career.facts.propose", operationId);
    const first = await service.proposeFact(proposalInput(), auth);
    const second = await service.proposeFact(proposalInput(), auth);
    expect(second.reused).toBe(true);
    expect(second.fact.metadata.revision_id).toBe(first.fact.metadata.revision_id);
    expect(await store.list("career_fact")).toHaveLength(1);
    const catalog = await store.catalog();
    expect(catalog.generation).toBe(1);
    expect(catalog.operations[operationId]?.result_revision_ids).toHaveLength(2);
  });

  it("rejects different input under one operation identity", async () => {
    const { service } = await setup();
    const auth = authority("career.facts.propose");
    await service.proposeFact(proposalInput("first"), auth);
    await expect(service.proposeFact(proposalInput("different"), auth)).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("allows one concurrent CAS confirmation and preserves the losing proposal", async () => {
    const { store, service } = await setup();
    const proposal = await service.proposeFact(proposalInput(), authority("career.facts.propose"));
    const input = { fact_record_id: proposal.fact.metadata.record_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null };
    const results = await Promise.allSettled([
      service.confirmFact(input, authority("career.facts.confirm"), true),
      service.confirmFact(input, authority("career.facts.confirm"), true),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "conflict" });
    const head = await store.readHead(proposal.fact.metadata.record_id);
    expect(head.metadata.revision).toBe(2);
    expect(await store.readRevision(proposal.fact.metadata.revision_id)).toMatchObject({ record_type: "career_fact", state: "suggested" });
  });

  it("reports cancellation on the correct side of the commit boundary", async () => {
    const { store, service } = await setup();
    const cancelled = authority("career.facts.propose", crypto.randomUUID(), { isCancelled: () => true });
    await expect(service.proposeFact(proposalInput(), cancelled)).rejects.toMatchObject({ code: "cancelled" });
    expect(await store.list("career_fact")).toHaveLength(0);

    const operationId = crypto.randomUUID();
    const committed = authority("career.facts.propose", operationId);
    const first = await service.proposeFact(proposalInput(), committed);
    const replay = await service.proposeFact(proposalInput(), { ...committed, isCancelled: () => true });
    expect(replay.fact.metadata.revision_id).toBe(first.fact.metadata.revision_id);
    expect(replay.reused).toBe(true);
  });

  it("journals cancellation after record staging but before catalog visibility", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-staged-cancel-")); roots.push(root);
    let cancelled = false;
    const store = new ResumeDataStore(root, undefined, { beforeCatalogCommit: async () => { cancelled = true; } }, false);
    const grant = testGrant();
    await store.initialize(grant.owner_id);
    const service = new ResumeDomainService(store, () => new Date("2026-08-07T12:00:00.000Z"));
    const operationId = crypto.randomUUID();
    await expect(service.proposeFact(proposalInput(), authority("career.facts.propose", operationId, { isCancelled: () => cancelled }))).rejects.toMatchObject({ code: "cancelled" });
    expect(await store.list("career_fact")).toHaveLength(0);
    expect((await store.operation(operationId, grant.installation_id)).record).toMatchObject({ status: "cancelled_before_commit", commit_outcome: "not_committed" });
    await expect(service.proposeFact(proposalInput(), authority("career.facts.propose", operationId))).rejects.toMatchObject({ code: "cancelled" });
  });

  it("recovers the committed identity when response delivery fails after the catalog commit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-response-recovery-")); roots.push(root);
    let failResponse = true;
    const store = new ResumeDataStore(root, undefined, { afterCatalogCommit: async () => { if (failResponse) { failResponse = false; throw new Error("synthetic response loss"); } } }, false);
    const grant = testGrant();
    await store.initialize(grant.owner_id);
    const service = new ResumeDomainService(store, () => new Date("2026-08-07T12:00:00.000Z"));
    const operationId = crypto.randomUUID();
    const auth = authority("career.facts.propose", operationId);
    await expect(service.proposeFact(proposalInput(), auth)).rejects.toThrow("synthetic response loss");
    const recovered = await service.proposeFact(proposalInput(), auth);
    expect(recovered.reused).toBe(true);
    expect(await store.list("career_fact")).toHaveLength(1);
    expect(recovered.fact.metadata.revision_id).toBe((await store.operation(operationId, grant.installation_id)).record.result_ref);
  });

  it("fails closed on corrupt/missing records and unknown newer schemas", async () => {
    const { root, store, service } = await setup();
    const proposal = await service.proposeFact(proposalInput(), authority("career.facts.propose"));
    const catalog = await store.catalog();
    const locator = catalog.revisions[proposal.fact.metadata.revision_id]!;
    await rm(path.join(store.namespaceRoot, locator.relative_path));
    await expect(store.readHead(proposal.fact.metadata.record_id)).rejects.toMatchObject({ code: "validation_failed" });

    const newerRoot = await mkdtemp(path.join(os.tmpdir(), "bd-resume-newer-")); roots.push(newerRoot);
    await mkdir(path.join(newerRoot, "apps", "resume-builder"), { recursive: true });
    await writeFile(path.join(newerRoot, "apps", "resume-builder", "catalog.json"), JSON.stringify({ data_schema_version: 2 }), "utf8");
    await expect(new ResumeDataStore(newerRoot, undefined, {}, false).initialize(testGrant().owner_id)).rejects.toMatchObject({ code: "incompatible_schema" });
    expect(root).not.toBe(newerRoot);
  });

  it("preserves compatible extension data through catalog and record round trips", async () => {
    const { store, service } = await setup();
    const proposal = await service.proposeFact(proposalInput(), authority("career.facts.propose"));
    const catalogPath = path.join(store.namespaceRoot, "catalog.json");
    const catalog = ResumeDataCatalogSchema.parse(JSON.parse(await readFile(catalogPath, "utf8")));
    await writeFile(catalogPath, `${JSON.stringify({ ...catalog, extensions: { future_catalog_hint: { retained: true } } })}\n`, "utf8");
    expect((await store.catalog()).extensions).toEqual({ future_catalog_hint: { retained: true } });
    expect(proposal.fact.extensions).toEqual({});
  });

  it("never enumerates a record outside granted scope", async () => {
    const { store, service } = await setup();
    const proposal = await service.proposeFact(proposalInput(), authority("career.facts.propose"));
    await expect(store.readHead(proposal.fact.metadata.record_id, [crypto.randomUUID()])).rejects.toBeInstanceOf(ResumeDomainError);
    await expect(store.readHead(proposal.fact.metadata.record_id, [crypto.randomUUID()])).rejects.toMatchObject({ code: "not_found_within_scope", statusCode: 404 });
  });
});
