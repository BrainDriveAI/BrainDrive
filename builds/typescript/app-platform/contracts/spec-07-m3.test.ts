import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AuditEventSchema, assertContentFreeAudit } from "./audit.js";
import { ResumeDefinitionRecordSchema, ResumeStrategyRecordSchema } from "./data.js";
import { RESUME_PROMPT_POLICY_VERSION } from "../../resume-inference/policy.js";
import { RESUME_QUALITY_STANDARD_DIGEST, RESUME_QUALITY_STANDARD_VERSION } from "../../resume-inference/strategy.js";

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const id = (suffix: number) => `77000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

describe("Spec 07 milestone 3 review contracts", () => {
  it("binds current general definitions to strategy, coverage, quality, provider, and model identities", () => {
    expect(RESUME_PROMPT_POLICY_VERSION).toBe("7");
    expect(RESUME_QUALITY_STANDARD_VERSION).toBe("3");
    expect(RESUME_QUALITY_STANDARD_DIGEST).toMatch(/^sha256:[0-9a-f]{64}$/);
    for (const key of ["fact_revision_ids", "coverage_revision_ids", "history_reason_code", "skills_context", "quality_standard_digest", "provider_profile_id", "model_id"]) {
      expect(key in ResumeStrategyRecordSchema.shape).toBe(true);
    }
    expect("strategy_binding" in ResumeDefinitionRecordSchema.shape).toBe(true);
  });

  it("allows only sanitized strategy diagnostics", () => {
    const event = AuditEventSchema.parse({
      event_version: 1, event_id: id(1), event_name: "app.resume_strategy.completed", occurred_at: "2026-08-11T12:00:00.000Z",
      correlation_id: id(2), actor_id: id(3), owner_id: id(4), app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive",
      package_digest: `sha256:${"a".repeat(64)}`, installation_id: id(5), operation_id: id(6), capability: "resume.definitions.write",
      target_category: "resume_strategy", target_id: null, input_revision: null, outcome: "committed", error_code: null, schema_version: 3,
      duration_ms: 12, item_count: 1, strategy_revision_id: id(7), history_shape: "career_change", used_evidence_count: 6,
      omitted_evidence_count: 1, omission_reason_categories: ["older_context"], unresolved_gap_count: 2, timing_class: "automation",
    });
    expect(() => assertContentFreeAudit(event)).not.toThrow();
    expect(AuditEventSchema.safeParse({ ...event, resume_text: "private owner content" }).success).toBe(false);
  });

  it("keeps draft authority and later milestones explicit", async () => {
    const manifest = JSON.parse(await readFile(resolve(fixtureRoot, "fixtures/spec-07/m3-review-manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      authority_status: "review_only_pending_accepted_spec_and_test_plan",
      open_decisions: ["RB7-OQ-1"],
      excluded_milestones: ["M4", "M5", "M6", "M7", "M8"],
      quality_authority: { version: "3", status: "accepted" },
    });
  });
});
