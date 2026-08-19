import { describe, expect, it } from "vitest";
import { initialBriefWorkflowState, reduceBriefWorkflow } from "../src/workflow.js";

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
});
