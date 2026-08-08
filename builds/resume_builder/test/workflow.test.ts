import { describe, expect, it } from "vitest";

import {
  deriveStage,
  initialWorkflowState,
  nextInterviewTopic,
  progressSummary,
  resumeBuilderWorkflowReducer,
  type DurableWorkflowSnapshot,
} from "../src/workflow.js";

function snapshot(overrides: Partial<DurableWorkflowSnapshot> = {}): DurableWorkflowSnapshot {
  return {
    entry_point: "direct",
    known_topics: [],
    confirmed_fact_count: 0,
    interview: null,
    general_definitions: [],
    jobs: [],
    targeted_definitions: [],
    artifacts: [],
    ...overrides,
  };
}

describe("Resume Builder durable workflow reducer", () => {
  it("skips known context and asks exactly the next unknown topic", () => {
    const loaded = resumeBuilderWorkflowReducer(initialWorkflowState, {
      type: "durable.loaded",
      snapshot: snapshot({ known_topics: ["contact", "employment"] }),
    });
    expect(loaded.currentTopic).toBe("accomplishments");
    expect(progressSummary(loaded)).toEqual({ completed: 2, skipped: 0, remaining: 3, total: 5 });
    expect(nextInterviewTopic(["contact"], ["employment"], ["accomplishments"])).toBe("education");
  });

  it("persists the visible meaning of complete, skip, pause, resume, correct, and reject actions", () => {
    let state = resumeBuilderWorkflowReducer(initialWorkflowState, { type: "durable.loaded", snapshot: snapshot() });
    state = resumeBuilderWorkflowReducer(state, { type: "interview.completed_topic", topic: "contact" });
    state = resumeBuilderWorkflowReducer(state, { type: "interview.skipped_topic", topic: "employment" });
    expect(state.currentTopic).toBe("accomplishments");
    state = resumeBuilderWorkflowReducer(state, { type: "interview.paused" });
    expect(state.currentTopic).toBeNull();
    state = resumeBuilderWorkflowReducer(state, { type: "interview.resumed" });
    expect(state.currentTopic).toBe("accomplishments");

    state = resumeBuilderWorkflowReducer(state, { type: "rewrite.proposed", proposal: { id: "rw-1", original_text: "Original", text: "Proposal" } });
    expect(resumeBuilderWorkflowReducer(state, { type: "rewrite.accepted" }).rewrite?.status).toBe("accepted");
    expect(resumeBuilderWorkflowReducer(state, { type: "rewrite.edited", text: "Owner correction" }).rewrite).toMatchObject({ status: "edited", text: "Owner correction" });
    expect(resumeBuilderWorkflowReducer(state, { type: "rewrite.rejected" }).rewrite?.status).toBe("rejected");
    expect(resumeBuilderWorkflowReducer(state, { type: "rewrite.regenerate" }).rewrite?.status).toBe("regenerate");
  });

  it("derives reopen state from durable records rather than browser state", () => {
    expect(deriveStage(snapshot({ interview: { status: "review_needed", current_topic: null, completed_topics: ["contact"], skipped_topics: [] } }))).toBe("fact_review");
    expect(deriveStage(snapshot({ general_definitions: [{ revision_id: "g1", status: "proposed" }] }))).toBe("general_review");
    expect(deriveStage(snapshot({ general_definitions: [{ revision_id: "g1", status: "approved" }] }))).toBe("job");
    expect(deriveStage(snapshot({ general_definitions: [{ revision_id: "g1", status: "approved" }], jobs: [{ revision_id: "j1" }] }))).toBe("evidence");
    expect(deriveStage(snapshot({ targeted_definitions: [{ revision_id: "t1", parent_revision_id: "g1", status: "approved" }] }))).toBe("preview");
  });

  it("keeps warning classes separate and preserves saved work on stale/lost failures", () => {
    const warnings = { factual: ["Unsupported metric"], document: ["Long section"], evidence_gaps: ["Credential not confirmed"] };
    let state = resumeBuilderWorkflowReducer(initialWorkflowState, { type: "warnings.updated", warnings });
    state = resumeBuilderWorkflowReducer(state, { type: "connection.lost" });
    expect(state.warnings).toEqual(warnings);
    expect(state.error).toMatchObject({ code: "connection_lost", recoverable: true });
    expect(resumeBuilderWorkflowReducer(state, { type: "connection.recovered" }).error).toBeNull();
    expect(resumeBuilderWorkflowReducer(state, { type: "operation.failed", code: "conflict", message: "Refresh and review your saved version.", recoverable: true }).snapshot).toBe(state.snapshot);
  });
});
