import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { ResumeDomainService } from "../resume-domain/service.js";
import { ResumeDataStore } from "../resume-domain/store.js";
import { authority, definitionInput, ownerDecision, proposalInput, testGrant } from "../resume-domain/test-helpers.js";
import { RESUME_TEMPLATE_ID, RESUME_TEMPLATE_VERSION } from "../resume-renderer/renderer.js";
import { ResumePublishedDocumentProvider } from "./resume-published-document.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("ResumePublishedDocumentProvider", () => {
  it("publishes only the latest approved general resume into Career", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-published-document-"));
    roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    await store.initialize(testGrant().owner_id);
    let now = new Date("2026-08-07T12:00:00.000Z");
    const service = new ResumeDomainService(store, () => now);
    const proposed = await service.proposeFact(proposalInput("Supported work"), authority("career.facts.propose"));
    const confirmationAuthority = authority("career.facts.confirm");
    const confirmed = await service.confirmFact(
      { fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null },
      confirmationAuthority,
      ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id)
    );
    const common = {
      status: "approved",
      template_id: RESUME_TEMPLATE_ID,
      template_version: RESUME_TEMPLATE_VERSION,
      statements: [{
        statement_id: crypto.randomUUID(),
        section_id: "experience",
        kind: "factual",
        text: "Supported work",
        supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id],
      }],
      section_order: ["experience"],
    };
    await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, { ...common, title: "Older Resume" }), authority("resume.definitions.write"), true);
    now = new Date("2026-08-07T13:00:00.000Z");
    const current = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, { ...common, title: "Current Resume" }), authority("resume.definitions.write"), true);
    now = new Date("2026-08-07T14:00:00.000Z");
    await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, { ...common, status: "proposed", title: "Unapproved Draft" }), authority("resume.definitions.write"), false);

    const provider = new ResumePublishedDocumentProvider(service);
    await expect(provider.list("finance")).resolves.toEqual([]);
    await expect(provider.list("career")).resolves.toEqual([
      expect.objectContaining({
        publisherId: "ai.braindrive.resume-builder",
        sourceLabel: "Resume Builder",
        logicalId: "general-resume",
        title: "General Resume",
        markdown: expect.stringContaining("# Current Resume"),
      }),
    ]);
    const approvedBefore = (await provider.list("career"))[0]!.markdown;
    expect(approvedBefore).not.toContain("Unapproved Draft");

    now = new Date("2026-08-07T15:00:00.000Z");
    const correctionAuthority = authority("career.facts.confirm");
    const correction = await service.confirmFact({
      fact_record_id: confirmed.fact.metadata.record_id,
      fact_revision_id: confirmed.fact.metadata.revision_id,
      expected_revision: confirmed.fact.metadata.revision,
      decision: "edit_and_accept",
      edited_value: "Supported corrected work",
      review_note: "Owner remembered a correction",
    }, correctionAuthority, ownerDecision(correctionAuthority, confirmed.fact.metadata.revision_id, "edit_and_accept"));

    // A confirmed fact followed by generation failure cannot publish anything.
    const approvedAfterFailure = (await provider.list("career"))[0]!.markdown;
    expect(approvedAfterFailure).toBe(approvedBefore);
    const successorInput = definitionInput(correction.fact.metadata.revision_id, {
      ...common,
      status: "proposed",
      title: "Remembered Detail Proposal",
      statements: [{
        ...common.statements[0],
        text: correction.fact.value,
        supporting_confirmed_fact_revision_ids: [correction.fact.metadata.revision_id],
      }],
      parent_definition_revision_id: current.definition.metadata.revision_id,
      successor_context: {
        successor_version: 1,
        kind: "remembered_information",
        source_definition_revision_id: current.definition.metadata.revision_id,
        revision_request_revision_id: null,
        changed_fact_revision_ids: [correction.fact.metadata.revision_id],
        stale_tailored_variant_revision_ids: [],
        quality_report_digest: null,
      },
    });
    const successor = await service.writeDefinition(successorInput, authority("resume.definitions.write"), false);
    const retry = await service.writeDefinition(successorInput, authority("resume.definitions.write"), false);
    expect(retry).toMatchObject({ reused: true, definition: { metadata: { revision_id: successor.definition.metadata.revision_id } } });
    const approvedAfterProposal = (await provider.list("career"))[0]!.markdown;
    expect(approvedAfterProposal).toBe(approvedBefore);

    now = new Date("2026-08-07T16:00:00.000Z");
    await service.approveDefinition({
      kind: "approve_definition",
      definition_record_id: successor.definition.metadata.record_id,
      expected_revision: successor.definition.metadata.revision,
    }, authority("resume.definitions.write"), true);
    const approvedAfter = (await provider.list("career"))[0]!.markdown;
    expect(approvedAfter).toContain("# Remembered Detail Proposal");
    expect(approvedAfter).toContain("Supported corrected work");
    expect(approvedAfter).not.toBe(approvedBefore);
    if (process.env.BRAINDRIVE_M4_EVIDENCE === "1") {
      process.stdout.write(`${JSON.stringify({
        milestone: 4,
        career: {
          before_digest: canonicalInputDigest(approvedBefore),
          after_confirmation_failure_digest: canonicalInputDigest(approvedAfterFailure),
          after_proposal_retry_digest: canonicalInputDigest(approvedAfterProposal),
          proposed_successor_revision_id: successor.definition.metadata.revision_id,
          retry_reused_revision_id: retry.definition.metadata.revision_id,
          after_approval_digest: canonicalInputDigest(approvedAfter),
        },
      })}\n`);
    }
  });

  it("fails closed when Career encounters missing or stale bound quality evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-quality-career-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    await store.initialize(testGrant().owner_id);
    const service = new ResumeDomainService(store, () => new Date("2026-08-07T12:00:00.000Z"));
    const proposed = await service.proposeFact(proposalInput("Supported work"), authority("career.facts.propose"));
    const confirmationAuthority = authority("career.facts.confirm");
    const confirmed = await service.confirmFact({ fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmationAuthority, ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id));
    const approved = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, {
      status: "approved", title: "Quality-bound Resume", template_id: RESUME_TEMPLATE_ID, template_version: RESUME_TEMPLATE_VERSION,
      statements: [{ statement_id: crypto.randomUUID(), section_id: "experience", kind: "factual", text: "Supported work", supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id] }], section_order: ["experience"],
    }), authority("resume.definitions.write"), true);
    const stale = { ...approved.definition, title: "Tampered after quality validation" };
    const provider = new ResumePublishedDocumentProvider({ store: { list: async () => [stale] } } as unknown as ResumeDomainService);
    await expect(provider.list("career")).rejects.toThrow(/quality report.*stale/i);
  });
});
