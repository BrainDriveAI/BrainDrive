import { describe, expect, it } from "vitest";

import { AuditEventSchema, assertContentFreeAudit } from "./audit.js";

const id = (suffix: number) => `78000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const digest = (character: string) => `sha256:${character.repeat(64)}`;

describe("Spec 07 milestone 6 diagnostic contracts", () => {
  it("admits normalized semantic friction evidence while keeping the numeric gate blocked", () => {
    const event = AuditEventSchema.parse({
      event_version: 1, event_id: id(1), event_name: "app.capability.completed", occurred_at: "2026-08-11T12:00:00.000Z",
      correlation_id: id(2), actor_id: id(3), owner_id: id(4), app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive",
      package_digest: digest("a"), installation_id: id(5), operation_id: id(6), capability: "resume.definitions.write",
      target_category: "resume_definitions", target_id: id(7), input_revision: 2, outcome: "committed", error_code: null, schema_version: 3,
      duration_ms: 14, item_count: 1, confirmation_group_count: 0, confirmation_unit_count: 0, redundant_confirmation_count: 0,
      non_fact_dialog_count: 0, final_approval_count: 1, interaction_budget_status: "semantic_pass_numeric_gate_blocked", timing_class: "human",
    });
    expect(() => assertContentFreeAudit(event)).not.toThrow();
    expect(AuditEventSchema.safeParse({ ...event, resume_text: "private owner content" }).success).toBe(false);
  });

  it("admits content-free parity lineage and rejects content-bearing diagnostics", () => {
    const event = AuditEventSchema.parse({
      event_version: 1, event_id: id(10), event_name: "app.resume_parity.checked", occurred_at: "2026-08-11T12:00:00.000Z",
      correlation_id: id(11), actor_id: id(12), owner_id: id(13), app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive",
      package_digest: digest("b"), installation_id: id(14), operation_id: id(15), capability: "resume.export.request",
      target_category: "artifact_parity_report", target_id: id(16), input_revision: null, outcome: "allowed", error_code: null, schema_version: 3,
      duration_ms: 5, item_count: 5, definition_revision_id: id(17), parity_revision_id: id(18), parity_digest: digest("c"), timing_class: "automation",
    });
    expect(() => assertContentFreeAudit(event)).not.toThrow();
    expect(AuditEventSchema.safeParse({ ...event, clean_text: "owner@example.test" }).success).toBe(false);
  });
});
