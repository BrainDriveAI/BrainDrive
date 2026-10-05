import { describe, expect, it } from "vitest";

import {
  coverageProgress,
  evidenceOpportunityId,
  rankEvidenceOpportunities,
  type EvidenceCoverageDimensions,
  type EvidenceOpportunity,
} from "../src/opportunities.js";

const JOB_ID = "10000000-0000-4000-8000-000000000001";
const DIGEST = `sha256:${"a".repeat(64)}` as const;

function coverage(overrides: Partial<EvidenceCoverageDimensions> = {}): EvidenceCoverageDimensions {
  const unanswered = { state: "unanswered" as const, evidence_revision_ids: [], recorded_at: null };
  return {
    responsibilities: unanswered,
    accomplishments: unanswered,
    outcomes: unanswered,
    tools: unanswered,
    scope: unanswered,
    progression: unanswered,
    ...overrides,
  };
}

describe("Spec 07 evidence-opportunity policy", () => {
  it("ranks the same highest-value opportunity regardless of input order", () => {
    const dimensions = coverage();
    const first = rankEvidenceOpportunities({
      jobRevisionId: JOB_ID,
      dimensions,
      contextDigests: Object.fromEntries(Object.keys(dimensions).map((dimension) => [dimension, DIGEST])),
      storedOpportunities: [],
    });
    const reversed = rankEvidenceOpportunities({
      jobRevisionId: JOB_ID,
      dimensions: Object.fromEntries(Object.entries(dimensions).reverse()) as EvidenceCoverageDimensions,
      contextDigests: Object.fromEntries(Object.keys(dimensions).reverse().map((dimension) => [dimension, DIGEST])),
      storedOpportunities: [],
    });

    expect(first[0]).toMatchObject({ dimension: "accomplishments", opportunity_kind: "qualitative", selection_method: "deterministic_value" });
    expect(first[0]?.opportunity_id).toBe("347b7fb1-c84c-470a-8e6f-ffc83d87186e");
    expect(reversed[0]).toEqual(first[0]);
    expect(new Set(first.map((item) => item.opportunity_id)).size).toBe(first.length);
  });

  it("excludes known dimensions and never repeats a suppressed equivalent", () => {
    const dimensions = coverage({
      accomplishments: { state: "answered", evidence_revision_ids: ["20000000-0000-4000-8000-000000000001"], recorded_at: "2026-08-11T12:00:00.000Z" },
      outcomes: { state: "unknown", evidence_revision_ids: [], recorded_at: "2026-08-11T12:00:00.000Z" },
    });
    const suppressed: EvidenceOpportunity = {
      opportunity_id: evidenceOpportunityId(JOB_ID, "scope", "qualitative", "scope_or_scale", DIGEST),
      dimension: "scope",
      opportunity_kind: "qualitative",
      value_category: "scope_or_scale",
      context_digest: DIGEST,
      state: "suppressed",
      suppression_reason: "owner_declined",
      attempt_count: 1,
      reopened_at: null,
    };
    const ranked = rankEvidenceOpportunities({
      jobRevisionId: JOB_ID,
      dimensions,
      contextDigests: Object.fromEntries(Object.keys(dimensions).map((dimension) => [dimension, DIGEST])),
      storedOpportunities: [suppressed],
    });

    expect(ranked.some((item) => item.dimension === "accomplishments" && item.opportunity_kind === "qualitative")).toBe(false);
    expect(ranked.some((item) => item.dimension === "outcomes")).toBe(false);
    expect(ranked.some((item) => item.opportunity_id === suppressed.opportunity_id)).toBe(false);
  });

  it("gives a metric opportunity its own single attempt and reopens only by owner action or new context", () => {
    const answered = coverage({
      outcomes: { state: "answered", evidence_revision_ids: ["20000000-0000-4000-8000-000000000002"], recorded_at: "2026-08-11T12:00:00.000Z" },
    });
    const refused: EvidenceOpportunity = {
      opportunity_id: evidenceOpportunityId(JOB_ID, "outcomes", "metric", "decision_useful_outcome", DIGEST),
      dimension: "outcomes",
      opportunity_kind: "metric",
      value_category: "decision_useful_outcome",
      context_digest: DIGEST,
      state: "suppressed",
      suppression_reason: "owner_declined",
      attempt_count: 1,
      reopened_at: null,
    };
    const sameContext = rankEvidenceOpportunities({ jobRevisionId: JOB_ID, dimensions: answered, contextDigests: { outcomes: DIGEST }, storedOpportunities: [refused] });
    const newDigest = `sha256:${"b".repeat(64)}` as const;
    const newContext = rankEvidenceOpportunities({ jobRevisionId: JOB_ID, dimensions: answered, contextDigests: { outcomes: newDigest }, storedOpportunities: [refused] });
    const completedMetric = rankEvidenceOpportunities({ jobRevisionId: JOB_ID, dimensions: answered, contextDigests: { outcomes: newDigest }, storedOpportunities: [{ ...refused, state: "resolved", suppression_reason: null, context_digest: newDigest }] });
    const reopened = rankEvidenceOpportunities({ jobRevisionId: JOB_ID, dimensions: answered, contextDigests: { outcomes: DIGEST }, storedOpportunities: [{ ...refused, state: "available", suppression_reason: null, attempt_count: 0, reopened_at: "2026-08-11T13:00:00.000Z" }] });

    expect(sameContext.some((item) => item.opportunity_kind === "metric")).toBe(false);
    expect(newContext.find((item) => item.opportunity_kind === "metric")?.opportunity_id).not.toBe(refused.opportunity_id);
    expect(completedMetric.some((item) => item.opportunity_kind === "metric")).toBe(false);
    expect(reopened.find((item) => item.opportunity_kind === "metric")?.attempt_count).toBe(0);
  });

  it("reports every explicit disposition and an empty eligible bank", () => {
    const dimensions = coverage({
      responsibilities: { state: "answered", evidence_revision_ids: [crypto.randomUUID()], recorded_at: "2026-08-11T12:00:00.000Z" },
      accomplishments: { state: "unknown", evidence_revision_ids: [], recorded_at: "2026-08-11T12:00:00.000Z" },
      outcomes: { state: "not_applicable", evidence_revision_ids: [], recorded_at: "2026-08-11T12:00:00.000Z" },
      tools: { state: "skipped", evidence_revision_ids: [], recorded_at: "2026-08-11T12:00:00.000Z" },
      scope: { state: "deferred", evidence_revision_ids: [], recorded_at: "2026-08-11T12:00:00.000Z" },
      progression: { state: "conflicting", evidence_revision_ids: [], recorded_at: "2026-08-11T12:00:00.000Z" },
    });
    expect(coverageProgress(dimensions)).toEqual({ answered: 1, intentionally_unresolved: 4, conflicting: 1, remaining: 0, total: 6 });
    expect(rankEvidenceOpportunities({ jobRevisionId: JOB_ID, dimensions, contextDigests: {}, storedOpportunities: [] })).toEqual([]);
  });
});
