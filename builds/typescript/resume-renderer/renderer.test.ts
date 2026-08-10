import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ResumeDomainService } from "../resume-domain/service.js";
import { ResumeDataStore } from "../resume-domain/store.js";
import { authority, definitionInput, ownerDecision, proposalInput, testGrant } from "../resume-domain/test-helpers.js";
import { ResumeExportBroker } from "./export-broker.js";
import { parseBackPdf, renderApprovedResume, RESUME_TEMPLATE_ID, RESUME_TEMPLATE_VERSION, sanitizeResumeText } from "./renderer.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function approvedDefinition() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-renderer-")); roots.push(root);
  const store = new ResumeDataStore(root, undefined, {}, false);
  await store.initialize(testGrant().owner_id);
  const service = new ResumeDomainService(store, () => new Date("2026-08-07T12:00:00.000Z"));
  const proposed = await service.proposeFact(proposalInput("Built synthetic scheduling application in 2025"), authority("career.facts.propose"));
  const confirmationAuthority = authority("career.facts.confirm");
  const confirmed = await service.confirmFact({ fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmationAuthority, ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id));
  const definition = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, {
    template_id: RESUME_TEMPLATE_ID,
    template_version: RESUME_TEMPLATE_VERSION,
    statements: [
      { statement_id: crypto.randomUUID(), section_id: "summary", kind: "presentation", text: "<script>bad()</script>Professional &amp; collaborator", supporting_confirmed_fact_revision_ids: [] },
      { statement_id: crypto.randomUUID(), section_id: "experience", kind: "factual", text: "Built synthetic scheduling application in 2025", supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id] },
    ],
    section_order: ["summary", "experience"],
  }), authority("resume.definitions.write"), true);
  if (definition.definition.record_type !== "resume_definition") throw new Error("expected definition");
  return { root, store, service, definition: definition.definition };
}

describe("conservative ATS PDF renderer", () => {
  it("sanitizes hostile markup, renders deterministic single-column order, and parses back exactly", async () => {
    const { definition } = await approvedDefinition();
    const rendered = renderApprovedResume(definition);
    expect(rendered.bytes.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    expect(rendered.page_count).toBe(1);
    expect(rendered.logical_lines).toEqual([
      "General Resume",
      "Summary",
      "- Professional & collaborator",
      "Experience",
      "- Built synthetic scheduling application in 2025",
    ]);
    expect(parseBackPdf(rendered.bytes)).toEqual(rendered.logical_lines);
    expect(rendered.bytes.toString("latin1")).not.toContain("script");
    expect(sanitizeResumeText("<img src=x onerror=bad()>Safe\u202E text")).toBe("Safe text");
  });

  it("exports only approved lineage, records safe receipts, and leaves the definition immutable", async () => {
    const { store, service, definition } = await approvedDefinition();
    const broker = new ResumeExportBroker(service, () => undefined, () => new Date("2026-08-07T12:01:00.000Z"));
    const preview = await broker.preview({ action: "preview", definition_revision_id: definition.metadata.revision_id }, authority("resume.export.request"));
    expect(preview).toMatchObject({ status: "ready", format: "pdf", renderer: { parse_back: "passed" }, definition: { kind: "general" } });
    const exported = await broker.export({ action: "export", definition_revision_id: definition.metadata.revision_id, safe_filename: "synthetic-resume.pdf", destination_intent: "new_download", overwrite_confirmed: false }, authority("resume.export.request"));
    expect(Buffer.from(exported.bytes_base64, "base64").subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    expect(exported.safe_destination_label).toBe("synthetic-resume.pdf");
    const finalized = await broker.finalize({ artifact_revision_id: exported.artifact_revision_id, artifact_digest: exported.artifact_digest, safe_destination_label: "chosen-resume.pdf", outcome: "completed" }, authority("resume.export.request"));
    expect(finalized).toMatchObject({ outcome: "completed", safe_destination_label: "chosen-resume.pdf" });
    expect(JSON.stringify(exported)).not.toContain(rootPathMarker());
    expect(await store.readRevision(definition.metadata.revision_id)).toEqual(definition);
    const artifacts = await store.list("artifact");
    const receipts = await store.list("export_receipt");
    expect(artifacts).toHaveLength(1);
    expect(receipts).toHaveLength(1);
  });

  it("requires explicit overwrite and cancellation never damages approved work", async () => {
    const { store, service, definition } = await approvedDefinition();
    const broker = new ResumeExportBroker(service);
    await expect(broker.export({ action: "export", definition_revision_id: definition.metadata.revision_id, safe_filename: "resume.pdf", destination_intent: "replace_existing", overwrite_confirmed: false }, authority("resume.export.request"))).rejects.toBeDefined();
    await expect(broker.export({ action: "export", definition_revision_id: definition.metadata.revision_id, safe_filename: "resume.pdf", destination_intent: "new_download", overwrite_confirmed: false }, authority("resume.export.request", crypto.randomUUID(), { isCancelled: () => true }))).rejects.toMatchObject({ code: "cancelled" });
    expect(await store.readRevision(definition.metadata.revision_id)).toEqual(definition);
    expect(await store.list("artifact")).toHaveLength(0);
  });

  it("records chooser cancellation without claiming a completed export", async () => {
    const { store, service, definition } = await approvedDefinition();
    const broker = new ResumeExportBroker(service);
    const prepared = await broker.export({ action: "export", definition_revision_id: definition.metadata.revision_id, safe_filename: "resume.pdf", destination_intent: "new_download", overwrite_confirmed: false }, authority("resume.export.request"));
    const cancelled = await broker.finalize({ artifact_revision_id: prepared.artifact_revision_id, artifact_digest: prepared.artifact_digest, safe_destination_label: "resume.pdf", outcome: "cancelled" }, authority("resume.export.request"));
    expect(cancelled.outcome).toBe("cancelled");
    expect((await store.list("export_receipt"))[0]).toMatchObject({ outcome: "cancelled", safe_destination_label: "resume.pdf" });
    expect(await store.readRevision(definition.metadata.revision_id)).toEqual(definition);
  });

  it("reconciles an ambiguous prepared export after restart without duplicating artifact or receipt side effects", async () => {
    const { root, store, service, definition } = await approvedDefinition();
    const operationId = crypto.randomUUID();
    const exportAuthority = authority("resume.export.request", operationId, { idempotencyKey: "m4-export-restart-reconciliation" });
    const broker = new ResumeExportBroker(service, () => undefined, () => new Date("2026-08-07T12:01:00.000Z"));
    const prepared = await broker.export({ action: "export", definition_revision_id: definition.metadata.revision_id, safe_filename: "resume.pdf", destination_intent: "new_download", overwrite_confirmed: false }, exportAuthority);

    const restartedStore = new ResumeDataStore(root, undefined, {}, false);
    await restartedStore.initialize(exportAuthority.grant.owner_id);
    const restartedBroker = new ResumeExportBroker(new ResumeDomainService(restartedStore, () => new Date("2026-08-07T12:02:00.000Z")));
    const replayed = await restartedBroker.export({ action: "export", definition_revision_id: definition.metadata.revision_id, safe_filename: "resume.pdf", destination_intent: "new_download", overwrite_confirmed: false }, exportAuthority);
    expect(replayed.artifact_revision_id).toBe(prepared.artifact_revision_id);
    expect(await restartedStore.list("artifact")).toHaveLength(1);

    const finalizeInput = { artifact_revision_id: prepared.artifact_revision_id, artifact_digest: prepared.artifact_digest, safe_destination_label: "chosen-resume.pdf", outcome: "completed" as const };
    const finalized = await restartedBroker.finalize(finalizeInput, exportAuthority);
    const finalizedReplay = await restartedBroker.finalize(finalizeInput, exportAuthority);
    expect(finalizedReplay.receipt_revision_id).toBe(finalized.receipt_revision_id);
    await expect(restartedBroker.finalize({ ...finalizeInput, safe_destination_label: "different-resume.pdf" }, exportAuthority)).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(await restartedStore.list("export_receipt")).toHaveLength(1);
    expect(await store.readRevision(definition.metadata.revision_id)).toEqual(definition);
  });
});

function rootPathMarker(): string {
  return "/tmp/";
}
