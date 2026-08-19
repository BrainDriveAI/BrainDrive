import { describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { compareDefinitionRevisions } from "./definition-comparison.js";
import type { ResumeDefinition } from "./resume-lineage.js";

const ids = {
  leftRecord: "60000000-0000-4000-8000-000000000001",
  left: "60000000-0000-4000-8000-000000000002",
  rightRecord: "60000000-0000-4000-8000-000000000003",
  right: "60000000-0000-4000-8000-000000000004",
  thirdRecord: "60000000-0000-4000-8000-000000000005",
  third: "60000000-0000-4000-8000-000000000006",
  unrelatedRecord: "60000000-0000-4000-8000-000000000007",
  unrelated: "60000000-0000-4000-8000-000000000008",
  targetedRecord: "60000000-0000-4000-8000-000000000009",
  targeted: "60000000-0000-4000-8000-000000000010",
  job: "60000000-0000-4000-8000-000000000011",
  fact1: "60000000-0000-4000-8000-000000000012",
  fact2: "60000000-0000-4000-8000-000000000013",
  a: "60000000-0000-4000-8000-000000000021",
  b: "60000000-0000-4000-8000-000000000022",
  c: "60000000-0000-4000-8000-000000000023",
  d: "60000000-0000-4000-8000-000000000024",
  e: "60000000-0000-4000-8000-000000000025",
} as const;

function definition(overrides: Partial<ResumeDefinition> & Pick<ResumeDefinition, "metadata" | "statements">): ResumeDefinition {
  return {
    schema_version: 2,
    record_type: "resume_definition",
    owner_id: "60000000-0000-4000-8000-000000000030",
    sensitivity: "standard",
    retention_class: "durable_owner_data",
    lifecycle_state: "active",
    updated_at: "2026-08-10T12:00:00.000Z",
    definition_kind: "general",
    status: "approved",
    title: "Synthetic resume",
    selected_fact_revision_ids: [ids.fact1],
    section_order: ["summary", "experience"],
    presentation_preferences: {},
    locale: "en-US",
    page_intent: "one_page",
    template_id: "ats-basic",
    template_version: "1",
    parent_definition_revision_id: null,
    job_revision_id: null,
    policy_version: "owner-authored-v1",
    prompt_policy_version: null,
    approved_at: "2026-08-10T12:00:00.000Z",
    approval_evidence: null,
    successor_context: null,
    ...overrides,
  } as ResumeDefinition;
}

function metadata(recordId: string, revisionId: string, revision = 1, priorRevisionId: string | null = null) {
  return {
    record_id: recordId,
    revision_id: revisionId,
    revision,
    created_at: "2026-08-10T12:00:00.000Z",
    created_by: {
      owner_id: "60000000-0000-4000-8000-000000000030",
      actor_id: "60000000-0000-4000-8000-000000000031",
      app_id: "ai.braindrive.resume-builder",
      publisher_id: "ai.braindrive",
      package_digest: `sha256:${"a".repeat(64)}`,
      installation_id: "60000000-0000-4000-8000-000000000032",
    },
    prior_revision_id: priorRevisionId,
    extensions: {},
  };
}

const statement = (statementId: string, text: string, support: string[] = [], sectionId = "experience") => ({
  statement_id: statementId,
  section_id: sectionId,
  kind: support.length ? "factual" as const : "presentation" as const,
  text,
  supporting_confirmed_fact_revision_ids: support,
});

describe("deterministic definition comparison", () => {
  const left = definition({
    metadata: metadata(ids.leftRecord, ids.left),
    statements: [
      statement(ids.a, "Original supported statement", [ids.fact1]),
      statement(ids.b, "Movable statement"),
      statement(ids.c, "Unchanged statement"),
      statement(ids.d, "Removed statement"),
    ],
  });
  const right = definition({
    metadata: metadata(ids.rightRecord, ids.right),
    parent_definition_revision_id: ids.left,
    selected_fact_revision_ids: [ids.fact2],
    statements: [
      statement(ids.b, "Movable statement"),
      statement(ids.a, "Corrected supported statement", [ids.fact2]),
      statement(ids.c, "Unchanged statement"),
      statement(ids.e, "Added statement"),
    ],
  });

  it("reproduces the ordered golden content, movement, and evidence manifest without mutation", () => {
    const before = canonicalInputDigest([left, right]);
    const result = compareDefinitionRevisions(left, right, [left, right]);

    expect(result).toMatchObject({
      comparison_version: 2,
      result: "available",
      compatibility: "compatible",
      relation: "related",
      unavailable_reason: null,
      left_revision_id: ids.left,
      right_revision_id: ids.right,
      left_digest: canonicalInputDigest(left),
      right_digest: canonicalInputDigest(right),
      unchanged_count: 1,
      evidence_changes: { added_revision_ids: [ids.fact2], removed_revision_ids: [ids.fact1] },
    });
    expect(result.added.map((change) => change.statement_id)).toEqual([ids.e]);
    expect(result.removed.map((change) => change.statement_id)).toEqual([ids.d]);
    expect(result.changed.map((change) => change.statement_id)).toEqual([ids.a]);
    expect(result.moved.map((change) => change.statement_id)).toEqual([ids.a, ids.b]);
    expect(result.evidence_changed.map((change) => change.statement_id)).toEqual([ids.a]);
    expect(result.unchanged.map((change) => change.statement_id)).toEqual([ids.c]);
    expect(result.changed[0]).toMatchObject({
      before: { index: 0, text: "Original supported statement", supporting_confirmed_fact_revision_ids: [ids.fact1] },
      after: { index: 1, text: "Corrected supported statement", supporting_confirmed_fact_revision_ids: [ids.fact2] },
    });
    expect(result.observable_summary).toEqual([
      "1 statement added.",
      "1 statement removed.",
      "1 statement changed.",
      "2 statements moved.",
      "Evidence references changed for 1 statement.",
    ]);
    expect(canonicalInputDigest([left, right])).toBe(before);
  });

  it("handles identical, non-adjacent, unrelated, and incompatible selected revisions explicitly", () => {
    expect(compareDefinitionRevisions(left, left, [left])).toMatchObject({
      result: "available", compatibility: "compatible", relation: "identical", unavailable_reason: null,
      observable_summary: ["No observable changes."],
    });

    const third = definition({
      metadata: metadata(ids.thirdRecord, ids.third),
      parent_definition_revision_id: ids.right,
      selected_fact_revision_ids: right.selected_fact_revision_ids,
      statements: right.statements,
    });
    expect(compareDefinitionRevisions(left, third, [left, right, third])).toMatchObject({ result: "available", relation: "related", compatibility: "compatible" });

    const unrelated = definition({ metadata: metadata(ids.unrelatedRecord, ids.unrelated), statements: left.statements });
    expect(compareDefinitionRevisions(left, unrelated, [left, right, unrelated])).toMatchObject({
      result: "unavailable", relation: "unrelated", compatibility: "incompatible", unavailable_reason: "unrelated",
      added: [], removed: [], changed: [], moved: [], evidence_changed: [], unchanged: [],
    });

    const targeted = definition({
      metadata: metadata(ids.targetedRecord, ids.targeted),
      definition_kind: "targeted",
      parent_definition_revision_id: ids.left,
      job_revision_id: ids.job,
      statements: left.statements,
    });
    expect(compareDefinitionRevisions(left, targeted, [left, targeted])).toMatchObject({
      result: "unavailable", relation: "related", compatibility: "incompatible", unavailable_reason: "incompatible",
    });
  });

  it("reports a support-only difference as evidence change without changing statement meaning", () => {
    const supportOnlyLeft = definition({
      metadata: metadata(ids.leftRecord, ids.left),
      statements: [statement(ids.a, "Same supported statement", [ids.fact1])],
    });
    const supportOnlyRight = definition({
      metadata: metadata(ids.rightRecord, ids.right),
      parent_definition_revision_id: ids.left,
      statements: [statement(ids.a, "Same supported statement", [ids.fact2])],
    });

    const result = compareDefinitionRevisions(supportOnlyLeft, supportOnlyRight, [supportOnlyLeft, supportOnlyRight]);
    expect(result.changed).toEqual([]);
    expect(result.evidence_changed.map((change) => change.statement_id)).toEqual([ids.a]);
    expect(result.unchanged).toEqual([]);
    expect(result.observable_summary).toEqual(["Evidence references changed for 1 statement."]);
  });

  it("classifies deterministic moves across property seeds", () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      const sourceStatements = Array.from({ length: 7 }, (_, index) => statement(`70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, `Statement ${index + 1}`));
      const offset = seed % sourceStatements.length;
      const targetStatements = [...sourceStatements.slice(offset), ...sourceStatements.slice(0, offset)];
      const source = definition({ metadata: metadata(ids.leftRecord, ids.left), selected_fact_revision_ids: [], statements: sourceStatements });
      const target = definition({ metadata: metadata(ids.rightRecord, ids.right), selected_fact_revision_ids: [], parent_definition_revision_id: ids.left, statements: targetStatements });
      const result = compareDefinitionRevisions(source, target, [source, target]);
      expect(result.changed).toEqual([]);
      expect(result.evidence_changed).toEqual([]);
      expect(result.moved).toHaveLength(offset === 0 ? 0 : sourceStatements.length);
      expect(result.moved.map((change) => change.statement_id)).toEqual(sourceStatements.filter((entry, index) => index !== targetStatements.indexOf(entry)).map((entry) => entry.statement_id));
    }
  });
});
