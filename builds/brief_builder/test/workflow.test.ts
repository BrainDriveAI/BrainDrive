import { describe, expect, it } from "vitest";
import { BRIEF_APP_ACTIONS, BRIEF_APP_STORAGE_DOCUMENTS, buildBriefProofWriteActionInput, initialBriefWorkflowState, reduceBriefWorkflow } from "../src/index.js";

describe("Brief Builder workflow", () => {
  it("completes direct source, generation, owner edit, and approval", () => {
    const source = reduceBriefWorkflow(initialBriefWorkflowState, { type: "source.changed", source: "Owner source" });
    const generating = reduceBriefWorkflow(source, { type: "generation.started" });
    const review = reduceBriefWorkflow(generating, { type: "generation.completed", title: "Brief", statements: [{ text: "Supported", supportLabel: "Owner source" }] });
    const edited = reduceBriefWorkflow(review, { type: "draft.edited", title: "Edited brief", statements: review.statements });
    const approved = reduceBriefWorkflow(edited, { type: "approval.completed", approvedRevisionId: crypto.randomUUID() });
    expect(approved).toMatchObject({ stage: "approved", draftTitle: "Edited brief" });
  });

  it("preserves the last approved revision across failure/cancel and reopens durable state", () => {
    const approved = { ...initialBriefWorkflowState, stage: "approved" as const, approvedRevisionId: crypto.randomUUID(), draftTitle: "Safe", statements: [{ text: "Safe", supportLabel: "source" }] };
    expect(reduceBriefWorkflow(approved, { type: "operation.failed", code: "validation_failed", safeMessage: "Failed safely" })).toMatchObject({ stage: "approved", approvedRevisionId: approved.approvedRevisionId });
    expect(reduceBriefWorkflow(approved, { type: "operation.cancelled" })).toMatchObject({ stage: "approved", approvedRevisionId: approved.approvedRevisionId });
    expect(reduceBriefWorkflow(initialBriefWorkflowState, { type: "durable.reopened", state: approved })).toMatchObject({ draftTitle: "Safe", approvedRevisionId: approved.approvedRevisionId });
  });

  it("lets the owner reject a pending draft without changing the prior approval", () => {
    const approvedRevisionId = crypto.randomUUID();
    const pending = {
      ...initialBriefWorkflowState,
      stage: "review" as const,
      approvedRevisionId,
      draftTitle: "Pending replacement",
      statements: [{ text: "Pending", supportLabel: "source" }],
    };
    expect(reduceBriefWorkflow(pending, { type: "approval.rejected" })).toMatchObject({
      stage: "approved",
      approvedRevisionId,
      draftTitle: "",
      statements: [],
    });
  });

  it("declares durable app storage documents without Resume-specific bindings", () => {
    expect(BRIEF_APP_STORAGE_DOCUMENTS.source).toMatchObject({
      documentId: "brief.source",
      bindingId: "brief.source.current",
      role: "source_document",
      retentionClass: "durable_owner_data",
    });
    expect(BRIEF_APP_STORAGE_DOCUMENTS.actionResult).toMatchObject({
      role: "action_result_document",
      retentionClass: "durable_operation_lookup",
    });
    expect(BRIEF_APP_STORAGE_DOCUMENTS.previewCache).toMatchObject({
      documentId: "brief.preview",
      bindingId: "brief.preview.cache",
      retentionClass: "transient_abandoned_operation",
    });
    expect(JSON.stringify(BRIEF_APP_STORAGE_DOCUMENTS)).not.toMatch(/resume/i);
  });

  it("declares a proof action that targets the generic capability dispatcher", () => {
    expect(BRIEF_APP_ACTIONS).toEqual([
      expect.objectContaining({
        actionId: "brief.proof.read",
        capability: "brief.records.read",
        inputSchemaId: "brief.proof.read.input.v1",
        resultSchemaId: "brief.proof.read.result.v1",
        idempotencyPolicy: "optional",
      }),
      expect.objectContaining({
        actionId: "brief.proof.write",
        capability: "brief.records.write",
        inputSchemaId: "brief.proof.write.input.v1",
        resultSchemaId: "brief.proof.write.result.v1",
        idempotencyPolicy: "required",
      }),
    ]);
    expect(buildBriefProofWriteActionInput({
      sourceRevisionId: "00000000-0000-4000-8000-000000000001",
      expectedCatalogRevision: 2,
      title: "Proof brief",
      statementText: "Supported statement",
      supportContext: "Owner source",
      statementId: "00000000-0000-4000-8000-000000000002",
    })).toEqual({
      action: "edit",
      source_revision_id: "00000000-0000-4000-8000-000000000001",
      expected_catalog_revision: 2,
      title: "Proof brief",
      statements: [{
        statement_id: "00000000-0000-4000-8000-000000000002",
        text: "Supported statement",
        support: { kind: "owner_context", context: "Owner source" },
      }],
    });
    expect(JSON.stringify(BRIEF_APP_ACTIONS)).not.toMatch(/resume/i);
  });
});
