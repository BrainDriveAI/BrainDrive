import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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
    await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, { ...common, title: "Current Resume" }), authority("resume.definitions.write"), true);
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
    expect((await provider.list("career"))[0]?.markdown).not.toContain("Unapproved Draft");
  });
});
