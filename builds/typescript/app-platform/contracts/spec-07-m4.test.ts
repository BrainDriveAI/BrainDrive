import { describe, expect, it } from "vitest";

import { canonicalInputDigest } from "./common.js";
import { RESUME_DATA_SCHEMA_VERSION } from "./constants.js";
import { CraftRepairOperationRecordSchema } from "./data.js";
import { InferenceDataBlockSchema } from "./inference.js";
import { ResumeCraftRepairResultSchema } from "../../resume-inference/results.js";

const timestamp = "2026-08-11T12:00:00.000Z";
const ownerId = "78000000-0000-4000-8000-000000000001";
const id = (suffix: number) => `78000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const digest = (character: string) => `sha256:${character.repeat(64)}`;

function envelope() {
  return {
    schema_version: RESUME_DATA_SCHEMA_VERSION,
    record_type: "craft_repair_operation" as const,
    metadata: {
      record_id: id(2), revision_id: id(3), revision: 1, created_at: timestamp,
      created_by: { owner_id: ownerId, actor_id: ownerId, app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive", package_digest: digest("a"), installation_id: id(4) },
      prior_revision_id: null, extensions: {},
    },
    owner_id: ownerId, updated_at: timestamp, lifecycle_state: "active" as const,
    sensitivity: "sensitive" as const, retention_class: "durable_owner_data" as const, extensions: {},
  };
}

describe("Spec 07 milestone 4 correction contracts", () => {
  it("accepts one exact current repair scope and keeps historical result parsing compatible", () => {
    expect(InferenceDataBlockSchema.safeParse({
      category: "craft_repair_scope",
      content_digest: digest("b"),
      schema_id: "resume.craft-repair-scope.v2",
      schema_version: 1,
      data: { scope_version: 2, source_definition_revision_id: id(5), source_report_revision_id: id(6), statement_scope_ids: [id(7)], correction_class: "duty_only", attempt: 1 },
    }).success).toBe(true);
    const result = { repair_version: 2, source_definition_revision_id: id(5), source_report_revision_id: id(6), changed_statement_ids: [id(7)], title: "Synthetic Owner", statements: [{ statement_id: id(7), section_id: "experience", display_role: "bullet", kind: "presentation", text: "Coordinated routine work", supporting_confirmed_fact_revision_ids: [] }], section_order: ["experience"] };
    expect(ResumeCraftRepairResultSchema.safeParse(result).success).toBe(true);
    expect(ResumeCraftRepairResultSchema.safeParse({ ...result, repair_version: 1 }).success).toBe(true);
  });

  it("binds terminal repair state, transition, recovery, identities, and digests", () => {
    const body = {
      repair_version: 2 as const, action: "repair_statement" as const, attempt: 1 as const,
      source_definition_revision_id: id(5), source_report_revision_id: id(6), source_definition_digest: digest("b"), source_report_digest: digest("c"),
      strategy_revision_id: id(8), target_analysis_revision_id: null, fact_snapshot_digest: digest("d"), statement_scope_ids: [id(7)],
      correction_class: "duty_only" as const, allowed_correction_classes: ["duty_only" as const], prompt_policy_id: "braindrive.resume-builder.fixed", prompt_policy_version: "8",
      provider_profile_id: "owner-active", model_id: "model-a", input_digest: digest("e"), result: "rejected" as const,
      transition: "needs_correction_preserved" as const, recovery_reason: "full_gate_regression" as const,
      successor_definition_revision_id: null, successor_report_revision_id: null, output_digest: digest("f"), unchanged_statement_count: 4,
      error_class: "regression" as const, completed_at: timestamp,
    };
    const record = { ...envelope(), ...body, operation_digest: canonicalInputDigest(body) };
    expect(CraftRepairOperationRecordSchema.safeParse(record).success).toBe(true);
    expect(CraftRepairOperationRecordSchema.safeParse({ ...record, correction_class: "specificity" }).success).toBe(false);
    expect(CraftRepairOperationRecordSchema.safeParse({ ...record, successor_definition_revision_id: id(9) }).success).toBe(false);
  });
});
