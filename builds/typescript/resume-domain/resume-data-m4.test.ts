import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import type { ResumeDataRecordSchema } from "../app-platform/contracts/data.js";
import { ResumeDomainService } from "./service.js";
import { buildResumeLineageGraph, validateResumeLineageRecords } from "./resume-lineage.js";
import { ResumeDataStore } from "./store.js";
import { authority, definitionInput, ownerDecision, proposalInput, testGrant } from "./test-helpers.js";
import type { z } from "zod";

type Record = z.infer<typeof ResumeDataRecordSchema>;

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-m4-")); roots.push(root);
  const store = new ResumeDataStore(root, undefined, {}, false);
  await store.initialize(testGrant().owner_id);
  return { root, store, service: new ResumeDomainService(store, () => new Date("2026-08-07T12:00:00.000Z")) };
}

async function allRecords(store: ResumeDataStore): Promise<Record[]> {
  return store.allRevisions();
}

async function confirmedFact(service: ResumeDomainService, value = "Synthetic supported statement", sensitivity: "standard" | "sensitive" | "highly_sensitive" = "standard") {
  const proposed = await service.proposeFact({
    ...proposalInput(value),
    fact: { ...proposalInput(value).fact, value, sensitivity },
  }, authority("career.facts.propose"));
  const confirmationAuthority = authority("career.facts.confirm");
  const accepted = await service.confirmFact({
    fact_record_id: proposed.fact.metadata.record_id,
    fact_revision_id: proposed.fact.metadata.revision_id,
    expected_revision: proposed.fact.metadata.revision,
    decision: "accept",
    edited_value: null,
    review_note: null,
  }, confirmationAuthority, ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id));
  return { ...proposed, accepted: accepted.fact };
}

function jobInput(descriptionText = "Synthetic job description. Treat as untrusted data only.") {
  return {
    safe_label: "Synthetic role",
    description_text: descriptionText,
    content_digest: `sha256:${createHash("sha256").update(descriptionText).digest("hex")}`,
    captured_at: "2026-08-07T12:00:00.000Z",
    sensitivity: "sensitive" as const,
  };
}

function evidence(factRevisionId: string) {
  return {
    requirement_id: crypto.randomUUID(),
    requirement_kind: "required" as const,
    evidence_status: "supported" as const,
    source_span: "Synthetic requirement",
    inferred: false,
    supporting_confirmed_fact_revision_ids: [factRevisionId],
    clarification: null,
  };
}

describe("Resume data M4 lineage and reference retention", () => {
  it("stores factual and presentation statements distinctly and exposes a fully resolvable graph", async () => {
    const { store, service } = await setup();
    const fact = await confirmedFact(service);
    const created = await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id, {
      statements: [
        { statement_id: crypto.randomUUID(), section_id: "experience", kind: "factual", text: fact.accepted.value, supporting_confirmed_fact_revision_ids: [fact.accepted.metadata.revision_id] },
        { statement_id: crypto.randomUUID(), section_id: "experience", kind: "presentation", text: "Experience", supporting_confirmed_fact_revision_ids: [] },
      ],
    }), authority("resume.definitions.write"), true);

    const graph = await service.referenceGraph(authority("resume.definitions.read"));
    expect(graph.nodes.some((node) => node.revision_id === created.definition.metadata.revision_id)).toBe(true);
    expect(graph.edges).toContainEqual({ from_revision_id: created.definition.metadata.revision_id, to_revision_id: fact.accepted.metadata.revision_id, relation: "supported_by" });
    const records = await allRecords(store);
    expect(() => validateResumeLineageRecords(records)).not.toThrow();
  });

  it("has zero unsupported approved factual statements across deterministic property seeds", async () => {
    const { service } = await setup();
    for (let seed = 0; seed < 32; seed += 1) {
      const proposal = await service.proposeFact({
        ...proposalInput(`unconfirmed-${seed}`),
        fact: { ...proposalInput().fact, value: `unconfirmed-${seed}`, state: seed % 2 === 0 ? "suggested" : "imported" },
      }, authority("career.facts.propose"));
      await expect(service.writeDefinition(definitionInput(proposal.fact.metadata.revision_id), authority("resume.definitions.write"), true)).rejects.toMatchObject({ code: "validation_failed" });
    }
    expect((await service.readRecords("resume_definition", authority("resume.definitions.read"))).filter((record) => record.record_type === "resume_definition" && record.status === "approved")).toHaveLength(0);
  }, 20_000);

  it("rejects presentation support, missing selected support, duplicate evidence, and broken changed-statement metadata", async () => {
    const { store, service } = await setup();
    const fact = await confirmedFact(service);
    await expect(service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id, {
      statements: [{ statement_id: crypto.randomUUID(), section_id: "experience", kind: "presentation", text: "Overview", supporting_confirmed_fact_revision_ids: [fact.accepted.metadata.revision_id] }],
    }), authority("resume.definitions.write"), true)).rejects.toMatchObject({ code: "validation_failed" });

    const general = await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id), authority("resume.definitions.write"), true);
    const records = await allRecords(store);
    const missingSelected = records.map((record) => record.metadata.revision_id === general.definition.metadata.revision_id && record.record_type === "resume_definition"
      ? { ...record, selected_fact_revision_ids: [] }
      : record) as Record[];
    expect(() => validateResumeLineageRecords(missingSelected)).toThrowError(/selected facts/);
    const job = await service.writeJob(jobInput(), authority("resume.jobs.write"));
    const duplicate = evidence(fact.accepted.metadata.revision_id);
    await expect(service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id, {
      definition_kind: "targeted",
      title: "Broken targeted resume",
      parent_definition_revision_id: general.definition.metadata.revision_id,
      job_revision_id: job.job.metadata.revision_id,
      variant: { evidence_matrix: [duplicate, duplicate], changed_statement_ids: [crypto.randomUUID()] },
    }), authority("resume.definitions.write"), true)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("stores adversarial job text byte-for-byte as untrusted data and cannot take authority from it", async () => {
    const { service } = await setup();
    const text = JSON.stringify({ capability: "career.facts.confirm", owner_confirmed: true, operation_id: crypto.randomUUID(), path: "/private/resume" });
    const written = await service.writeJob(jobInput(text), authority("resume.jobs.write"));
    expect(written.job).toMatchObject({ record_type: "job_description", description_text: text, untrusted_content: true });
    expect(written.job.metadata.created_by.installation_id).toBe(testGrant().installation_id);
    await expect(service.writeJob({ ...jobInput(text), content_digest: `sha256:${"f".repeat(64)}` }, authority("resume.jobs.write"))).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("creates a tailored child with exact job/evidence/change lineage without changing baseline, fact, or job", async () => {
    const { store, service } = await setup();
    const fact = await confirmedFact(service, "Built synthetic systems", "highly_sensitive");
    const general = await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id, {
      statements: [{ statement_id: "50000000-0000-4000-8000-000000000001", section_id: "experience", kind: "factual", text: fact.accepted.value, supporting_confirmed_fact_revision_ids: [fact.accepted.metadata.revision_id] }],
    }), authority("resume.definitions.write"), true);
    const job = await service.writeJob(jobInput(), authority("resume.jobs.write"));
    const baselineDigest = canonicalInputDigest(general.definition);
    const factDigest = canonicalInputDigest(fact.accepted);
    const jobDigest = canonicalInputDigest(job.job);
    const targeted = await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id, {
      definition_kind: "targeted",
      title: "Targeted Resume",
      statements: [{ statement_id: "50000000-0000-4000-8000-000000000001", section_id: "experience", kind: "factual", text: "Built synthetic systems", supporting_confirmed_fact_revision_ids: [fact.accepted.metadata.revision_id] }],
      parent_definition_revision_id: general.definition.metadata.revision_id,
      job_revision_id: job.job.metadata.revision_id,
      variant: { evidence_matrix: [evidence(fact.accepted.metadata.revision_id)], changed_statement_ids: [] },
    }), authority("resume.definitions.write"), true);

    expect(targeted.variant).toMatchObject({
      parent_general_definition_revision_id: general.definition.metadata.revision_id,
      targeted_definition_revision_id: targeted.definition.metadata.revision_id,
      job_revision_id: job.job.metadata.revision_id,
      sensitivity: "highly_sensitive",
    });
    expect(canonicalInputDigest(await store.readRevision(general.definition.metadata.revision_id))).toBe(baselineDigest);
    expect(canonicalInputDigest(await store.readRevision(fact.accepted.metadata.revision_id))).toBe(factDigest);
    expect(canonicalInputDigest(await store.readRevision(job.job.metadata.revision_id))).toBe(jobDigest);
  });

  it("keeps historical superseded confirmed support resolvable after a fact correction", async () => {
    const { store, service } = await setup();
    const fact = await confirmedFact(service);
    const general = await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id), authority("resume.definitions.write"), true);
    const correctionAuthority = authority("career.facts.confirm");
    await service.confirmFact({
      fact_record_id: fact.accepted.metadata.record_id,
      fact_revision_id: fact.accepted.metadata.revision_id,
      expected_revision: fact.accepted.metadata.revision,
      decision: "edit_and_accept",
      edited_value: "Corrected synthetic statement",
      review_note: "Synthetic correction",
    }, correctionAuthority, ownerDecision(correctionAuthority, fact.accepted.metadata.revision_id, "edit_and_accept"));
    const graph = await service.referenceGraph(authority("resume.definitions.read"));
    expect(graph.edges).toContainEqual({ from_revision_id: general.definition.metadata.revision_id, to_revision_id: fact.accepted.metadata.revision_id, relation: "supported_by" });
    const records = await allRecords(store);
    expect(() => validateResumeLineageRecords(records)).not.toThrow();
  });

  it("creates one remembered successor and derives exact supersession impacts without mutating source or tailored siblings", async () => {
    const { store, service } = await setup();
    const original = await confirmedFact(service, "Managed weekly inventory reporting");
    const correctedId = "50000000-0000-4000-8000-000000000041";
    const removedId = "50000000-0000-4000-8000-000000000042";
    const rewordedId = "50000000-0000-4000-8000-000000000043";
    const unchangedId = "50000000-0000-4000-8000-000000000044";
    const addedId = "50000000-0000-4000-8000-000000000045";
    const sourceStatements = [
      { statement_id: correctedId, section_id: "experience", kind: "factual" as const, text: original.accepted.value, supporting_confirmed_fact_revision_ids: [original.accepted.metadata.revision_id] },
      { statement_id: removedId, section_id: "experience", kind: "factual" as const, text: `${original.accepted.value}.`, supporting_confirmed_fact_revision_ids: [original.accepted.metadata.revision_id] },
      { statement_id: rewordedId, section_id: "summary", kind: "presentation" as const, text: "Operations summary", supporting_confirmed_fact_revision_ids: [] },
      { statement_id: unchangedId, section_id: "experience", kind: "presentation" as const, text: "Experience", supporting_confirmed_fact_revision_ids: [] },
    ];
    const source = await service.writeDefinition(definitionInput(original.accepted.metadata.revision_id, {
      statements: sourceStatements,
      section_order: ["summary", "experience"],
    }), authority("resume.definitions.write"), true);
    const job = await service.writeJob(jobInput(), authority("resume.jobs.write"));
    const tailored = await service.writeDefinition(definitionInput(original.accepted.metadata.revision_id, {
      definition_kind: "targeted",
      title: "Tailored sibling",
      statements: sourceStatements,
      section_order: ["summary", "experience"],
      parent_definition_revision_id: source.definition.metadata.revision_id,
      job_revision_id: job.job.metadata.revision_id,
      variant: { evidence_matrix: [evidence(original.accepted.metadata.revision_id)], changed_statement_ids: [] },
    }), authority("resume.definitions.write"), true);
    if (!tailored.variant) throw new Error("expected tailored variant");
    const sourceDigest = canonicalInputDigest(source.definition);
    const tailoredDefinitionDigest = canonicalInputDigest(tailored.definition);
    const tailoredVariantDigest = canonicalInputDigest(tailored.variant);

    const correctionAuthority = authority("career.facts.confirm");
    const correction = await service.confirmFact({
      fact_record_id: original.accepted.metadata.record_id,
      fact_revision_id: original.accepted.metadata.revision_id,
      expected_revision: original.accepted.metadata.revision,
      decision: "edit_and_accept",
      edited_value: "Managed weekly inventory reporting in Excel",
      review_note: "Owner remembered the tool used",
    }, correctionAuthority, ownerDecision(correctionAuthority, original.accepted.metadata.revision_id, "edit_and_accept"));

    const successorInput = definitionInput(correction.fact.metadata.revision_id, {
      status: "proposed",
      title: "Remembered detail proposal",
      statements: [
        { statement_id: correctedId, section_id: "experience", kind: "factual", text: correction.fact.value, supporting_confirmed_fact_revision_ids: [correction.fact.metadata.revision_id] },
        { statement_id: rewordedId, section_id: "summary", kind: "presentation", text: "Operations and inventory summary", supporting_confirmed_fact_revision_ids: [] },
        sourceStatements[3],
        { statement_id: addedId, section_id: "experience", kind: "factual", text: correction.fact.value, supporting_confirmed_fact_revision_ids: [correction.fact.metadata.revision_id] },
      ],
      section_order: ["summary", "experience"],
      parent_definition_revision_id: source.definition.metadata.revision_id,
      successor_context: {
        successor_version: 1,
        kind: "remembered_information",
        source_definition_revision_id: source.definition.metadata.revision_id,
        revision_request_revision_id: null,
        changed_fact_revision_ids: [correction.fact.metadata.revision_id],
        stale_tailored_variant_revision_ids: [tailored.variant.metadata.revision_id],
        quality_report_digest: null,
      },
    });
    const successor = await service.writeDefinition(successorInput, authority("resume.definitions.write"), false);
    const retried = await service.writeDefinition(successorInput, authority("resume.definitions.write"), false);
    expect(retried.reused).toBe(true);
    expect(retried.definition.metadata.revision_id).toBe(successor.definition.metadata.revision_id);

    const impact = await service.analyzeImpact({
      source_definition_revision_id: source.definition.metadata.revision_id,
      changed_fact_revision_ids: [correction.fact.metadata.revision_id],
    }, authority("resume.definitions.read"));
    expect(impact.affected_statements).toEqual([
      { statement_id: correctedId, change: "corrected" },
      { statement_id: removedId, change: "removed" },
      { statement_id: rewordedId, change: "reworded" },
      { statement_id: addedId, change: "added" },
    ]);
    expect(impact.stale_tailored_variants).toEqual([{
      variant_revision_id: tailored.variant.metadata.revision_id,
      status: "based_on_older_evidence",
      rebuild: "explicit_owner_action",
    }]);
    expect(canonicalInputDigest(await store.readRevision(source.definition.metadata.revision_id))).toBe(sourceDigest);
    expect(canonicalInputDigest(await store.readRevision(tailored.definition.metadata.revision_id))).toBe(tailoredDefinitionDigest);
    expect(canonicalInputDigest(await store.readRevision(tailored.variant.metadata.revision_id))).toBe(tailoredVariantDigest);
    if (process.env.BRAINDRIVE_M4_EVIDENCE === "1") {
      process.stdout.write(`${JSON.stringify({
        milestone: 4,
        facts: {
          original: { revision_id: original.accepted.metadata.revision_id, digest: canonicalInputDigest(original.accepted) },
          corrected: { revision_id: correction.fact.metadata.revision_id, digest: canonicalInputDigest(correction.fact), supersedes_revision_id: correction.fact.supersedes_fact_revision_id },
        },
        definitions: {
          source: { revision_id: source.definition.metadata.revision_id, before_digest: sourceDigest, after_digest: canonicalInputDigest(await store.readRevision(source.definition.metadata.revision_id)) },
          successor: { revision_id: successor.definition.metadata.revision_id, digest: canonicalInputDigest(successor.definition), parent_revision_id: source.definition.metadata.revision_id, status: "proposed" },
          retry: { reused: retried.reused, revision_id: retried.definition.metadata.revision_id },
        },
        tailored: {
          definition: { revision_id: tailored.definition.metadata.revision_id, before_digest: tailoredDefinitionDigest, after_digest: canonicalInputDigest(await store.readRevision(tailored.definition.metadata.revision_id)) },
          variant: { revision_id: tailored.variant.metadata.revision_id, before_digest: tailoredVariantDigest, after_digest: canonicalInputDigest(await store.readRevision(tailored.variant.metadata.revision_id)) },
        },
        impact,
      })}\n`);
    }
  });

  it("rejects a remembered successor that changes the identity of unchanged predecessor content", async () => {
    const { service } = await setup();
    const fact = await confirmedFact(service);
    const sourceStatement = { statement_id: "50000000-0000-4000-8000-000000000051", section_id: "experience", kind: "factual" as const, text: fact.accepted.value, supporting_confirmed_fact_revision_ids: [fact.accepted.metadata.revision_id] };
    const source = await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id, { statements: [sourceStatement] }), authority("resume.definitions.write"), true);
    await expect(service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id, {
      status: "proposed",
      statements: [{ ...sourceStatement, statement_id: "50000000-0000-4000-8000-000000000052" }],
      parent_definition_revision_id: source.definition.metadata.revision_id,
      successor_context: {
        successor_version: 1,
        kind: "remembered_information",
        source_definition_revision_id: source.definition.metadata.revision_id,
        revision_request_revision_id: null,
        changed_fact_revision_ids: [fact.accepted.metadata.revision_id],
        stale_tailored_variant_revision_ids: [],
        quality_report_digest: null,
      },
    }), authority("resume.definitions.write"), false)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects broken and cyclic graphs deterministically", async () => {
    const { store, service } = await setup();
    const fact = await confirmedFact(service);
    const first = await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id), authority("resume.definitions.write"), true);
    const second = await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id, { parent_definition_revision_id: first.definition.metadata.revision_id }), authority("resume.definitions.write"), true);
    const records = await allRecords(store);
    const firstIndex = records.findIndex((record) => record.metadata.revision_id === first.definition.metadata.revision_id);
    const cycled = records.map((record, index) => index === firstIndex && record.record_type === "resume_definition"
      ? { ...record, parent_definition_revision_id: second.definition.metadata.revision_id }
      : record) as Record[];
    expect(() => validateResumeLineageRecords(cycled)).toThrowError(/cycle/);
    const broken = records.filter((record) => record.metadata.revision_id !== fact.accepted.metadata.revision_id);
    expect(() => buildResumeLineageGraph(broken)).toThrowError(/resolve/);
  });

  it("compares and selects immutable versions and creates a CAS-protected rollback child", async () => {
    const { store, service } = await setup();
    const fact = await confirmedFact(service);
    const firstStatementId = "50000000-0000-4000-8000-000000000011";
    const first = await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id, {
      title: "First General",
      statements: [{ statement_id: firstStatementId, section_id: "experience", kind: "factual", text: fact.accepted.value, supporting_confirmed_fact_revision_ids: [fact.accepted.metadata.revision_id] }],
    }), authority("resume.definitions.write"), true);
    const second = await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id, {
      title: "Second General",
      statements: [{ statement_id: firstStatementId, section_id: "experience", kind: "factual", text: `${fact.accepted.value}.`, supporting_confirmed_fact_revision_ids: [fact.accepted.metadata.revision_id] }],
      parent_definition_revision_id: first.definition.metadata.revision_id,
      status: "proposed",
    }), authority("resume.definitions.write"), false);
    const compared = await service.compareDefinitions({ left_revision_id: first.definition.metadata.revision_id, right_revision_id: second.definition.metadata.revision_id }, authority("resume.definitions.read"));
    expect(compared.changed.map((change) => change.statement_id)).toEqual([firstStatementId]);
    await expect(service.compareDefinitions({ left_revision_id: first.definition.metadata.revision_id, right_revision_id: second.definition.metadata.revision_id, left_expected_revision: 2 }, authority("resume.definitions.read"))).rejects.toMatchObject({ code: "conflict" });
    expect((await service.selectDefinition(first.definition.metadata.revision_id, authority("resume.definitions.read"))).metadata.revision_id).toBe(first.definition.metadata.revision_id);

    await expect(service.rollbackDefinition({ current_definition_record_id: second.definition.metadata.record_id, current_expected_revision: 1, target_definition_revision_id: first.definition.metadata.revision_id }, authority("resume.definitions.write"), false)).rejects.toMatchObject({ code: "denied" });
    const rolledBack = await service.rollbackDefinition({ current_definition_record_id: second.definition.metadata.record_id, current_expected_revision: 1, target_definition_revision_id: first.definition.metadata.revision_id }, authority("resume.definitions.write"), true);
    expect(rolledBack.definition).toMatchObject({ title: "First General", parent_definition_revision_id: first.definition.metadata.revision_id, status: "approved" });
    expect(await store.readRevision(second.definition.metadata.revision_id)).toEqual(second.definition);
    await expect(service.rollbackDefinition({ current_definition_record_id: second.definition.metadata.record_id, current_expected_revision: 2, target_definition_revision_id: first.definition.metadata.revision_id }, authority("resume.definitions.write"), true)).rejects.toMatchObject({ code: "conflict" });
  });

  it("compares exact adjacent and non-adjacent revisions with safe unavailable and retired outcomes without mutation", async () => {
    const { store, service } = await setup();
    const firstFact = await confirmedFact(service, "Original supported comparison fact");
    const secondFact = await confirmedFact(service, "Corrected supported comparison fact");
    const statementIds = {
      changed: "50000000-0000-4000-8000-000000000071",
      moved: "50000000-0000-4000-8000-000000000072",
      unchanged: "50000000-0000-4000-8000-000000000073",
      removed: "50000000-0000-4000-8000-000000000074",
      added: "50000000-0000-4000-8000-000000000075",
    };
    const source = await service.writeDefinition(definitionInput(firstFact.accepted.metadata.revision_id, {
      statements: [
        { statement_id: statementIds.changed, section_id: "experience", kind: "factual", text: firstFact.accepted.value, supporting_confirmed_fact_revision_ids: [firstFact.accepted.metadata.revision_id] },
        { statement_id: statementIds.moved, section_id: "experience", kind: "presentation", text: "Movable statement", supporting_confirmed_fact_revision_ids: [] },
        { statement_id: statementIds.unchanged, section_id: "summary", kind: "presentation", text: "Unchanged statement", supporting_confirmed_fact_revision_ids: [] },
        { statement_id: statementIds.removed, section_id: "experience", kind: "presentation", text: "Removed statement", supporting_confirmed_fact_revision_ids: [] },
      ],
      section_order: ["summary", "experience"],
    }), authority("resume.definitions.write"), true);
    const successor = await service.writeDefinition(definitionInput(secondFact.accepted.metadata.revision_id, {
      status: "proposed",
      parent_definition_revision_id: source.definition.metadata.revision_id,
      statements: [
        { statement_id: statementIds.moved, section_id: "experience", kind: "presentation", text: "Movable statement", supporting_confirmed_fact_revision_ids: [] },
        { statement_id: statementIds.changed, section_id: "experience", kind: "factual", text: secondFact.accepted.value, supporting_confirmed_fact_revision_ids: [secondFact.accepted.metadata.revision_id] },
        { statement_id: statementIds.unchanged, section_id: "summary", kind: "presentation", text: "Unchanged statement", supporting_confirmed_fact_revision_ids: [] },
        { statement_id: statementIds.added, section_id: "experience", kind: "presentation", text: "Added statement", supporting_confirmed_fact_revision_ids: [] },
      ],
      section_order: ["summary", "experience"],
    }), authority("resume.definitions.write"), false);
    const nonAdjacent = await service.writeDefinition(definitionInput(secondFact.accepted.metadata.revision_id, {
      status: "proposed",
      parent_definition_revision_id: successor.definition.metadata.revision_id,
      statements: successor.definition.record_type === "resume_definition" ? successor.definition.statements : [],
      section_order: ["summary", "experience"],
    }), authority("resume.definitions.write"), false);
    const unrelated = await service.writeDefinition(definitionInput(firstFact.accepted.metadata.revision_id, {
      title: "Unrelated general version",
      statements: source.definition.record_type === "resume_definition" ? source.definition.statements : [],
      section_order: ["summary", "experience"],
    }), authority("resume.definitions.write"), true);
    const job = await service.writeJob(jobInput(), authority("resume.jobs.write"));
    const targeted = await service.writeDefinition(definitionInput(firstFact.accepted.metadata.revision_id, {
      definition_kind: "targeted",
      status: "proposed",
      title: "Incompatible targeted version",
      parent_definition_revision_id: source.definition.metadata.revision_id,
      job_revision_id: job.job.metadata.revision_id,
      statements: source.definition.record_type === "resume_definition" ? source.definition.statements : [],
      section_order: ["summary", "experience"],
      variant: { evidence_matrix: [evidence(firstFact.accepted.metadata.revision_id)], changed_statement_ids: [] },
    }), authority("resume.definitions.write"), false);
    const retired = await service.retireRecord({ record_id: unrelated.definition.metadata.record_id, expected_revision: unrelated.definition.metadata.revision }, authority("resume.definitions.write"));
    const stateDigest = canonicalInputDigest(await store.allRevisions());

    const compared = await service.compareDefinitions({
      left_revision_id: source.definition.metadata.revision_id,
      right_revision_id: successor.definition.metadata.revision_id,
      left_expected_revision: source.definition.metadata.revision,
      right_expected_revision: successor.definition.metadata.revision,
    }, authority("resume.definitions.read"));
    expect(compared).toMatchObject({ result: "available", compatibility: "compatible", relation: "related", unavailable_reason: null, unchanged_count: 1 });
    expect(compared.added.map((change) => change.statement_id)).toEqual([statementIds.added]);
    expect(compared.removed.map((change) => change.statement_id)).toEqual([statementIds.removed]);
    expect(compared.changed.map((change) => change.statement_id)).toEqual([statementIds.changed]);
    expect(compared.moved.map((change) => change.statement_id)).toEqual([statementIds.changed, statementIds.moved]);
    expect(compared.evidence_changed.map((change) => change.statement_id)).toEqual([statementIds.changed]);
    expect(compared.unchanged.map((change) => change.statement_id)).toEqual([statementIds.unchanged]);
    await expect(service.compareDefinitions({ left_revision_id: source.definition.metadata.revision_id, right_revision_id: nonAdjacent.definition.metadata.revision_id }, authority("resume.definitions.read"))).resolves.toMatchObject({ result: "available", relation: "related" });
    await expect(service.compareDefinitions({ left_revision_id: source.definition.metadata.revision_id, right_revision_id: source.definition.metadata.revision_id }, authority("resume.definitions.read"))).resolves.toMatchObject({ relation: "identical", observable_summary: ["No observable changes."] });
    await expect(service.compareDefinitions({ left_revision_id: source.definition.metadata.revision_id, right_revision_id: unrelated.definition.metadata.revision_id }, authority("resume.definitions.read"))).resolves.toMatchObject({ result: "unavailable", relation: "unrelated", unavailable_reason: "unrelated" });
    await expect(service.compareDefinitions({ left_revision_id: source.definition.metadata.revision_id, right_revision_id: targeted.definition.metadata.revision_id }, authority("resume.definitions.read"))).resolves.toMatchObject({ result: "unavailable", relation: "related", compatibility: "incompatible", unavailable_reason: "incompatible" });
    await expect(service.compareDefinitions({ left_revision_id: unrelated.definition.metadata.revision_id, right_revision_id: retired.record.metadata.revision_id }, authority("resume.definitions.read"))).resolves.toMatchObject({ result: "available", relation: "related", observable_summary: ["No observable changes."] });
    await expect(service.compareDefinitions({ left_revision_id: crypto.randomUUID(), right_revision_id: source.definition.metadata.revision_id }, authority("resume.definitions.read"))).rejects.toMatchObject({ code: "not_found_within_scope", statusCode: 404 });
    await expect(service.compareDefinitions({ left_revision_id: source.definition.metadata.revision_id, right_revision_id: successor.definition.metadata.revision_id, left_expected_revision: 99 }, authority("resume.definitions.read"))).rejects.toMatchObject({ code: "conflict" });
    expect(canonicalInputDigest(await store.allRevisions())).toBe(stateDigest);
  });

  it("creates a new variant for a targeted approval successor", async () => {
    const { store, service } = await setup();
    const fact = await confirmedFact(service);
    const statementId = "50000000-0000-4000-8000-000000000021";
    const statement = { statement_id: statementId, section_id: "experience", kind: "factual" as const, text: fact.accepted.value, supporting_confirmed_fact_revision_ids: [fact.accepted.metadata.revision_id] };
    const general = await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id, { statements: [statement] }), authority("resume.definitions.write"), true);
    const job = await service.writeJob(jobInput(), authority("resume.jobs.write"));
    const draft = await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id, {
      definition_kind: "targeted",
      status: "proposed",
      title: "Targeted proposal",
      statements: [statement],
      parent_definition_revision_id: general.definition.metadata.revision_id,
      job_revision_id: job.job.metadata.revision_id,
      variant: { evidence_matrix: [evidence(fact.accepted.metadata.revision_id)], changed_statement_ids: [] },
    }), authority("resume.definitions.write"), false);
    const approved = await service.approveDefinition({ kind: "approve_definition", definition_record_id: draft.definition.metadata.record_id, expected_revision: 1 }, authority("resume.definitions.write"), true);
    expect(approved.variant).toMatchObject({ record_type: "tailored_variant", targeted_definition_revision_id: approved.definition.metadata.revision_id });
    const rollback = await service.rollbackDefinition({ current_definition_record_id: approved.definition.metadata.record_id, current_expected_revision: 2, target_definition_revision_id: draft.definition.metadata.revision_id }, authority("resume.definitions.write"), false);
    expect(rollback).toMatchObject({
      definition: { definition_kind: "targeted", status: "proposed", parent_definition_revision_id: general.definition.metadata.revision_id, job_revision_id: job.job.metadata.revision_id },
      variant: { record_type: "tailored_variant", targeted_definition_revision_id: rollback.definition.metadata.revision_id },
    });
    const records = await allRecords(store);
    expect(() => validateResumeLineageRecords(records)).not.toThrow();
  });

  it("validates artifact compatibility/digests and stores only path-free accepted export receipts", async () => {
    const { service } = await setup();
    const fact = await confirmedFact(service);
    const definition = await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id), authority("resume.definitions.write"), true);
    if (definition.definition.record_type !== "resume_definition" || !definition.definition.approval_evidence) throw new Error("expected approved definition");
    const baseArtifact = {
      definition_revision_id: definition.definition.metadata.revision_id,
      template_id: definition.definition.template_id,
      template_version: definition.definition.template_version,
      renderer_id: "synthetic.renderer",
      renderer_version: "1",
      font_manifest_digest: `sha256:${"b".repeat(64)}`,
      validation_run_id: definition.definition.approval_evidence.validation_run_id,
      findings: [],
      artifact_digest: `sha256:${"c".repeat(64)}`,
      format: "pdf" as const,
      accepted: true,
    };
    await expect(service.registerArtifact({ ...baseArtifact, artifact_digest: "sha256:not-a-digest" }, authority("resume.artifacts.register"))).rejects.toBeDefined();
    await expect(service.registerArtifact({ ...baseArtifact, template_version: "incompatible" }, authority("resume.artifacts.register"))).rejects.toMatchObject({ code: "validation_failed" });
    await expect(service.registerArtifact({ ...baseArtifact, validation_run_id: crypto.randomUUID() }, authority("resume.artifacts.register"))).rejects.toMatchObject({ code: "validation_failed" });
    const artifact = await service.registerArtifact(baseArtifact, authority("resume.artifacts.register"));
    await expect(service.recordExportReceipt({ artifact_revision_id: artifact.artifact.metadata.revision_id, artifact_digest: `sha256:${"d".repeat(64)}`, format: "pdf", outcome: "completed", exported_at: "2026-08-07T12:00:00.000Z", safe_destination_label: "resume.pdf" }, authority("resume.export.request"))).rejects.toMatchObject({ code: "validation_failed" });
    for (const unsafe of ["/tmp/resume.pdf", "..\\resume.pdf", "C:resume.pdf", "..", "."]) {
      await expect(service.recordExportReceipt({ artifact_revision_id: artifact.artifact.metadata.revision_id, artifact_digest: baseArtifact.artifact_digest, format: "pdf", outcome: "completed", exported_at: "2026-08-07T12:00:00.000Z", safe_destination_label: unsafe }, authority("resume.export.request"))).rejects.toBeDefined();
    }
    const receipt = await service.recordExportReceipt({ artifact_revision_id: artifact.artifact.metadata.revision_id, artifact_digest: baseArtifact.artifact_digest, format: "pdf", outcome: "completed", exported_at: "2026-08-07T12:00:00.000Z", safe_destination_label: "resume.pdf" }, authority("resume.export.request"));
    expect(JSON.stringify(receipt)).not.toContain("/tmp/");
    expect(receipt.receipt).toMatchObject({ artifact_revision_id: artifact.artifact.metadata.revision_id, safe_destination_label: "resume.pdf" });
  });

  it("blocks retirement/deletion through every inbound provenance edge and retires only an unreferenced record by successor", async () => {
    const { store, service } = await setup();
    const fact = await confirmedFact(service);
    const statementId = "50000000-0000-4000-8000-000000000031";
    const statement = { statement_id: statementId, section_id: "experience", kind: "factual" as const, text: fact.accepted.value, supporting_confirmed_fact_revision_ids: [fact.accepted.metadata.revision_id] };
    const general = await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id, { statements: [statement] }), authority("resume.definitions.write"), true);
    const job = await service.writeJob(jobInput(), authority("resume.jobs.write"));
    const targeted = await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id, {
      definition_kind: "targeted",
      title: "Targeted Resume",
      statements: [statement],
      parent_definition_revision_id: general.definition.metadata.revision_id,
      job_revision_id: job.job.metadata.revision_id,
      variant: { evidence_matrix: [evidence(fact.accepted.metadata.revision_id)], changed_statement_ids: [] },
    }), authority("resume.definitions.write"), true);
    if (targeted.definition.record_type !== "resume_definition" || !targeted.definition.approval_evidence) throw new Error("expected approved targeted definition");
    const artifact = await service.registerArtifact({ definition_revision_id: targeted.definition.metadata.revision_id, template_id: targeted.definition.template_id, template_version: targeted.definition.template_version, renderer_id: "synthetic.renderer", renderer_version: "1", font_manifest_digest: `sha256:${"b".repeat(64)}`, validation_run_id: targeted.definition.approval_evidence.validation_run_id, findings: [], artifact_digest: `sha256:${"c".repeat(64)}`, format: "pdf", accepted: true }, authority("resume.artifacts.register"));
    await service.recordExportReceipt({ artifact_revision_id: artifact.artifact.metadata.revision_id, artifact_digest: `sha256:${"c".repeat(64)}`, format: "pdf", outcome: "completed", exported_at: "2026-08-07T12:00:00.000Z", safe_destination_label: "resume.pdf" }, authority("resume.export.request"));

    for (const revisionId of [fact.source.metadata.revision_id, fact.accepted.metadata.revision_id, general.definition.metadata.revision_id, job.job.metadata.revision_id, artifact.artifact.metadata.revision_id]) {
      await expect(service.assertRecordDeletable(revisionId, authority("resume.definitions.write"))).rejects.toMatchObject({ code: "conflict" });
    }
    await expect(service.retireRecord({ record_id: job.job.metadata.record_id, expected_revision: 1 }, authority("resume.jobs.write"))).rejects.toMatchObject({ code: "conflict" });

    const unused = await service.writeJob(jobInput("Unreferenced synthetic job"), authority("resume.jobs.write"));
    const retired = await service.retireRecord({ record_id: unused.job.metadata.record_id, expected_revision: 1 }, authority("resume.jobs.write"));
    expect(retired.record).toMatchObject({ lifecycle_state: "retired", metadata: { revision: 2, prior_revision_id: unused.job.metadata.revision_id } });
    expect(await store.readRevision(unused.job.metadata.revision_id)).toEqual(unused.job);
  });

  it("reuses concurrent equivalent saves and keeps every generated graph reference resolvable", async () => {
    const { store, service } = await setup();
    const operationId = crypto.randomUUID();
    const input = jobInput("Concurrent synthetic job");
    const writeAuthority = authority("resume.jobs.write", operationId);
    const results = await Promise.all([
      service.writeJob(input, writeAuthority),
      service.writeJob(input, writeAuthority),
    ]);
    expect(new Set(results.map((result) => result.job.metadata.revision_id)).size).toBe(1);
    expect(results.some((result) => result.reused)).toBe(true);

    for (let seed = 0; seed < 12; seed += 1) {
      const fact = await confirmedFact(service, `Supported property statement ${seed}`);
      await service.writeDefinition(definitionInput(fact.accepted.metadata.revision_id, { title: `General ${seed}`, status: "proposed" }), authority("resume.definitions.write"), false);
      const records = await allRecords(store);
      const graph = buildResumeLineageGraph(records);
      const nodeIds = new Set(graph.nodes.map((node) => node.revision_id));
      expect(graph.edges.every((edge) => nodeIds.has(edge.from_revision_id) && nodeIds.has(edge.to_revision_id))).toBe(true);
    }
  }, 20_000);
});
