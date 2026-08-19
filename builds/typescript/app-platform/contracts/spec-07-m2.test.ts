import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertContentFreeAudit, AuditEventSchema } from "./audit.js";
import { PURPOSE_OUTPUT_SCHEMAS } from "./inference.js";
import { PURPOSE_RESULT_SCHEMAS } from "../../resume-inference/results.js";

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const id = (suffix: number) => `76000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

describe("Spec 07 milestone 2 interaction contracts", () => {
  it("binds interview phrasing to one host-selected deterministic opportunity", () => {
    expect(PURPOSE_OUTPUT_SCHEMAS.interview_assist).toBe("resume.interview-assist.v2");
    const question = {
      question_id: id(1),
      job_fact_revision_id: id(2),
      opportunity_id: id(3),
      dimension: "accomplishments",
      opportunity_kind: "qualitative",
      value_category: "distinct_accomplishment",
      selection_method: "deterministic_value",
      prompt: "What is one thing you improved or handled especially well?",
      rationale: "Phrase the selected evidence opportunity.",
    };
    expect(PURPOSE_RESULT_SCHEMAS.interview_assist.safeParse({ questions: [question] }).success).toBe(true);
    expect(PURPOSE_RESULT_SCHEMAS.interview_assist.safeParse({ questions: [{ ...question, selection_method: "broker_ranked" }] }).success).toBe(false);
    expect(PURPOSE_RESULT_SCHEMAS.interview_assist.safeParse({ questions: [{ ...question, opportunity_id: undefined }] }).success).toBe(false);
  });

  it("admits only content-free coverage and grouped-confirmation diagnostics", () => {
    const base = {
      event_version: 1,
      event_id: id(10),
      occurred_at: "2026-08-11T12:00:00.000Z",
      correlation_id: id(11),
      actor_id: id(12),
      owner_id: id(13),
      app_id: "ai.braindrive.resume-builder",
      publisher_id: "ai.braindrive",
      package_digest: `sha256:${"a".repeat(64)}`,
      installation_id: id(14),
      operation_id: id(15),
      capability: "resume.definitions.write",
      target_category: "resume_coverage",
      target_id: id(16),
      input_revision: 1,
      outcome: "committed",
      error_code: null,
      schema_version: 1,
      duration_ms: 12,
      item_count: 5,
    } as const;
    const coverage = AuditEventSchema.parse({ ...base, event_name: "app.resume_coverage.transitioned", job_revision_id: id(17), job_dimension: null, coverage_revision_id: id(18), coverage_state: "deferred", timing_class: "human" });
    const grouped = AuditEventSchema.parse({ ...base, event_id: id(19), event_name: "app.resume_confirmation.grouped", capability: "career.facts.confirm", confirmation_group_count: 1, confirmation_unit_count: 2, used_evidence_count: 1, timing_class: "human" });
    expect(() => assertContentFreeAudit(coverage)).not.toThrow();
    expect(() => assertContentFreeAudit(grouped)).not.toThrow();
    expect(AuditEventSchema.safeParse({ ...coverage, prompt: "private owner content" }).success).toBe(false);
  });

  it("retains review-only authority status and explicit later-milestone exclusions", async () => {
    const manifest = JSON.parse(await readFile(resolve(fixtureRoot, "fixtures/spec-07/m2-review-manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      authority_status: "review_only_pending_accepted_spec_and_test_plan",
      excluded_milestones: ["M3", "M4", "M5", "M6", "M7", "M8"],
    });
  });
});
