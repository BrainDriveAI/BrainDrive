import { describe, expect, it } from "vitest";

import {
  JOB_EVIDENCE_DIMENSIONS,
  deriveStage,
  jobEvidenceProgress,
  initialWorkflowState,
  nextJobEvidenceDimension,
  nextInterviewTopic,
  matchRememberedJob,
  prepareRememberedSuccessorStatements,
  confirmedFactDuplicate,
  comparisonSelectionLabel,
  progressSummary,
  recoveryOperationId,
  revisionRoute,
  resumeBuilderWorkflowReducer,
  type DurableWorkflowSnapshot,
  type RecoverySlot,
} from "../src/workflow.js";

const slot: RecoverySlot = {
  session_id: "10000000-0000-4000-8000-000000000001",
  job_fact_revision_id: null,
  question_id: "contact-question",
  field_id: "answer",
};

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
    expect(loaded.currentTopic).toBe("direction");
    expect(progressSummary(loaded)).toEqual({ completed: 2, skipped: 0, remaining: 8, total: 10 });
    expect(nextInterviewTopic(["contact", "direction"], ["employment"], ["accomplishments"])).toBe("education");
  });

  it("persists the visible meaning of complete, skip, pause, resume, correct, and reject actions", () => {
    let state = resumeBuilderWorkflowReducer(initialWorkflowState, { type: "durable.loaded", snapshot: snapshot() });
    state = resumeBuilderWorkflowReducer(state, { type: "interview.completed_topic", topic: "contact" });
    state = resumeBuilderWorkflowReducer(state, { type: "interview.skipped_topic", topic: "employment" });
    expect(state.currentTopic).toBe("direction");
    state = resumeBuilderWorkflowReducer(state, { type: "interview.paused" });
    expect(state.currentTopic).toBeNull();
    state = resumeBuilderWorkflowReducer(state, { type: "interview.resumed" });
    expect(state.currentTopic).toBe("direction");

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

  it("restores the exact acknowledged slot and value without promoting it into submitted state", () => {
    const loaded = resumeBuilderWorkflowReducer(initialWorkflowState, {
      type: "durable.loaded",
      snapshot: snapshot({
        interview: {
          status: "in_progress",
          current_topic: "contact",
          completed_topics: [],
          skipped_topics: [],
          active_job_fact_revision_id: null,
          current_question_id: slot.question_id,
          current_field_id: slot.field_id,
          recovery_draft: {
            slot,
            value: "Saved multiline\nUnicode: résumé 🚀",
            value_digest: `sha256:${"a".repeat(64)}`,
            saved_at: "2026-08-10T12:00:00.000Z",
            acknowledged_revision: 4,
          },
        },
      }),
    });

    expect(loaded.recovery).toEqual({
      slot,
      value: "Saved multiline\nUnicode: résumé 🚀",
      valueDigest: `sha256:${"a".repeat(64)}`,
      acknowledgedRevision: 4,
      acknowledgedAt: "2026-08-10T12:00:00.000Z",
      status: "saved",
      serverValue: null,
      serverValueDigest: null,
    });
    expect(loaded.currentTopic).toBe("contact");
  });

  it("never labels a newer local value saved from an older acknowledgement", () => {
    let state = resumeBuilderWorkflowReducer(initialWorkflowState, {
      type: "recovery.changed",
      slot,
      value: "newer local value",
      valueDigest: `sha256:${"b".repeat(64)}`,
    });
    expect(state.recovery.status).toBe("saving");

    state = resumeBuilderWorkflowReducer(state, {
      type: "recovery.acknowledged",
      slot,
      value: "older acknowledged value",
      valueDigest: `sha256:${"c".repeat(64)}`,
      revision: 2,
      savedAt: "2026-08-10T12:00:01.000Z",
    });
    expect(state.recovery).toMatchObject({ value: "newer local value", status: "saving", acknowledgedRevision: 2 });

    state = resumeBuilderWorkflowReducer(state, {
      type: "recovery.failed",
      code: "recoverable_internal_failure",
    });
    expect(state.recovery.status).toBe("error");
  });

  it("preserves both values on conflict and requires an explicit choice", () => {
    let state = resumeBuilderWorkflowReducer(initialWorkflowState, {
      type: "recovery.changed",
      slot,
      value: "local choice",
      valueDigest: `sha256:${"d".repeat(64)}`,
    });
    state = resumeBuilderWorkflowReducer(state, {
      type: "recovery.conflicted",
      serverValue: "saved choice",
      serverValueDigest: `sha256:${"e".repeat(64)}`,
      serverRevision: 7,
      serverSavedAt: "2026-08-10T12:00:02.000Z",
    });
    expect(state.recovery).toMatchObject({ status: "conflict", value: "local choice", serverValue: "saved choice" });
    expect(resumeBuilderWorkflowReducer(state, { type: "recovery.server_selected" }).recovery).toMatchObject({ status: "saved", value: "saved choice", acknowledgedRevision: 7 });
    expect(resumeBuilderWorkflowReducer(state, { type: "recovery.local_selected" }).recovery).toMatchObject({ status: "saving", value: "local choice", serverValue: null });
    expect(resumeBuilderWorkflowReducer(state, { type: "recovery.discarded" }).recovery.status).toBe("idle");
  });

  it("derives a stable operation identity from slot, digest, and expected revision", () => {
    const digest = `sha256:${"f".repeat(64)}` as const;
    expect(recoveryOperationId(slot, digest, 3)).toBe(recoveryOperationId(slot, digest, 3));
    expect(recoveryOperationId(slot, digest, 3)).not.toBe(recoveryOperationId(slot, digest, 4));
    expect(recoveryOperationId(slot, digest, 3)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("selects only the highest-value unanswered dimension for one job", () => {
    expect(JOB_EVIDENCE_DIMENSIONS).toEqual([
      "responsibilities",
      "accomplishments",
      "outcomes",
      "tools",
      "scope",
      "progression",
    ]);
    expect(nextJobEvidenceDimension({ responsibilities: "answered", accomplishments: "unknown" })).toBe("outcomes");
    expect(nextJobEvidenceDimension({
      responsibilities: "answered",
      accomplishments: "unknown",
      outcomes: "not_applicable",
      tools: "skipped",
      scope: "answered",
      progression: "complete_for_now",
    })).toBeNull();
    expect(jobEvidenceProgress({ responsibilities: "answered", tools: "skipped" })).toEqual({
      answered: 1,
      deferred: 1,
      remaining: 4,
      total: 6,
    });
  });

  it("preserves job navigation outcomes without inventing evidence", () => {
    const jobId = "10000000-0000-4000-8000-000000000009";
    let state = resumeBuilderWorkflowReducer(initialWorkflowState, { type: "job.selected", jobRevisionId: jobId, knownDimensions: ["responsibilities"] });
    expect(state.jobInterview).toMatchObject({ activeJobRevisionId: jobId, currentDimension: "accomplishments" });

    state = resumeBuilderWorkflowReducer(state, { type: "job.dimension_recorded", dimension: "accomplishments", outcome: "unknown" });
    expect(state.jobInterview.currentDimension).toBe("outcomes");
    expect(state.jobInterview.outcomes.accomplishments).toBe("unknown");

    state = resumeBuilderWorkflowReducer(state, { type: "job.dimension_recorded", dimension: "outcomes", outcome: "not_applicable" });
    expect(state.jobInterview.currentDimension).toBe("scope");

    state = resumeBuilderWorkflowReducer(state, { type: "job.back" });
    expect(state.jobInterview.currentDimension).toBe("outcomes");
    expect(state.jobInterview.outcomes.outcomes).toBe("not_applicable");

    state = resumeBuilderWorkflowReducer(state, { type: "job.completed_for_now" });
    expect(state.jobInterview).toMatchObject({ activeJobRevisionId: null, currentDimension: null });
    expect(state.jobInterview.outcomes).toMatchObject({
      accomplishments: "unknown",
      outcomes: "not_applicable",
      tools: "deferred",
      scope: "deferred",
      progression: "deferred",
    });

    state = resumeBuilderWorkflowReducer(state, { type: "job.reopened", jobRevisionId: jobId, dimension: "scope" });
    expect(state.jobInterview).toMatchObject({ activeJobRevisionId: jobId, currentDimension: "scope" });
    expect(state.jobInterview.outcomes.scope).toBeUndefined();
    expect(state.jobInterview.outcomes.progression).toBe("deferred");
  });

  it("matches remembered details only by explicit identity or deterministic exact labels", () => {
    const jobs = [
      { revision_id: "10000000-0000-4000-8000-000000000011", label: "Support Lead at Northwind" },
      { revision_id: "10000000-0000-4000-8000-000000000012", label: "Support Lead at Contoso" },
      { revision_id: "10000000-0000-4000-8000-000000000013", label: "Analyst at Northwind" },
    ];

    expect(matchRememberedJob(jobs, { explicit_revision_id: jobs[1]!.revision_id, description: "ignored" })).toEqual({
      kind: "matched",
      method: "explicit_revision",
      matches: [jobs[1]],
    });
    expect(matchRememberedJob(jobs, { explicit_revision_id: null, description: "  analyst AT northwind  " })).toEqual({
      kind: "matched",
      method: "exact_label",
      matches: [jobs[2]],
    });
    expect(matchRememberedJob(jobs, { explicit_revision_id: null, description: "Northwind" })).toEqual({
      kind: "none",
      method: "none",
      matches: [],
    });
    expect(matchRememberedJob([...jobs, { revision_id: "10000000-0000-4000-8000-000000000014", label: "Analyst at Northwind" }], {
      explicit_revision_id: null,
      description: "analyst at northwind",
    })).toMatchObject({ kind: "ambiguous", method: "exact_label", matches: [jobs[2], expect.objectContaining({ revision_id: "10000000-0000-4000-8000-000000000014" })] });
  });

  it("reuses an exact confirmed fact and preserves unchanged predecessor statement identities", () => {
    const confirmed = [
      { revision_id: "10000000-0000-4000-8000-000000000021", fact_kind: "job_evidence", value: "Used Excel for weekly inventory reporting" },
    ];
    expect(confirmedFactDuplicate(confirmed, "job_evidence", "  used excel for WEEKLY inventory reporting ")).toBe(confirmed[0]);

    const predecessor = [
      { statement_id: "20000000-0000-4000-8000-000000000001", section_id: "summary", kind: "factual" as const, text: "Operations specialist", supporting_confirmed_fact_revision_ids: [confirmed[0]!.revision_id] },
      { statement_id: "20000000-0000-4000-8000-000000000002", section_id: "experience", kind: "factual" as const, text: "Prepared weekly inventory reports", supporting_confirmed_fact_revision_ids: [confirmed[0]!.revision_id] },
    ];
    const generated = [
      { ...predecessor[0]!, statement_id: "30000000-0000-4000-8000-000000000001" },
      { ...predecessor[1]!, statement_id: "30000000-0000-4000-8000-000000000002", text: "Prepared weekly inventory reports in Excel" },
    ];

    expect(prepareRememberedSuccessorStatements(predecessor, generated)).toEqual([
      predecessor[0],
      generated[1],
    ]);
  });

  it("selects exactly two immutable revisions and keeps unchanged comparison content collapsed by default", () => {
    const first = "10000000-0000-4000-8000-000000000031";
    const second = "10000000-0000-4000-8000-000000000032";
    const third = "10000000-0000-4000-8000-000000000033";
    let state = resumeBuilderWorkflowReducer(initialWorkflowState, { type: "comparison.selection_toggled", revisionId: first });
    state = resumeBuilderWorkflowReducer(state, { type: "comparison.selection_toggled", revisionId: second });
    expect(state.comparison).toMatchObject({ selectedRevisionIds: [first, second], status: "idle", expandedUnchanged: false });
    expect(comparisonSelectionLabel(state.comparison.selectedRevisionIds)).toBe("2 versions selected");

    state = resumeBuilderWorkflowReducer(state, { type: "comparison.selection_toggled", revisionId: third });
    expect(state.comparison.selectedRevisionIds).toEqual([first, second]);
    state = resumeBuilderWorkflowReducer(state, { type: "comparison.started" });
    expect(state.comparison.status).toBe("loading");
    state = resumeBuilderWorkflowReducer(state, { type: "comparison.completed", available: true });
    expect(state.comparison.status).toBe("ready");
    state = resumeBuilderWorkflowReducer(state, { type: "comparison.unchanged_toggled" });
    expect(state.comparison.expandedUnchanged).toBe(true);
    state = resumeBuilderWorkflowReducer(state, { type: "comparison.cleared" });
    expect(state.comparison).toEqual({ selectedRevisionIds: [], status: "idle", expandedUnchanged: false });
  });

  it("routes presentation, factual, mixed, and ambiguous revision classifications without approval", () => {
    expect(revisionRoute("presentation")).toBe("generating");
    expect(revisionRoute("factual")).toBe("awaiting_confirmation");
    expect(revisionRoute("mixed")).toBe("awaiting_confirmation");
    expect(revisionRoute("ambiguous")).toBe("clarification_needed");

    let state = resumeBuilderWorkflowReducer(initialWorkflowState, {
      type: "revision.submitted",
      requestRecordId: "10000000-0000-4000-8000-000000000041",
      requestRevisionId: "10000000-0000-4000-8000-000000000042",
      sourceRevisionId: "10000000-0000-4000-8000-000000000043",
      scope: "resume",
    });
    expect(state.revision).toMatchObject({ status: "submitted", classification: null, proposalRevisionId: null });
    state = resumeBuilderWorkflowReducer(state, { type: "revision.classified", classification: "factual", clarification: null });
    expect(state.revision.status).toBe("awaiting_confirmation");
    state = resumeBuilderWorkflowReducer(state, { type: "revision.proposed", proposalRevisionId: "10000000-0000-4000-8000-000000000044" });
    expect(state.revision).toMatchObject({ status: "proposed", proposalRevisionId: "10000000-0000-4000-8000-000000000044" });
    state = resumeBuilderWorkflowReducer(state, { type: "revision.outcome", outcome: "reject" });
    expect(state.revision.status).toBe("rejected");
    expect(state.snapshot).toBeNull();
  });
});
