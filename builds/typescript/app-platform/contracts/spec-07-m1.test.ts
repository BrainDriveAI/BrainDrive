import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertContentFreeAudit, AuditEventSchema } from "./audit.js";
import { canonicalInputDigest } from "./common.js";
import {
  ArtifactParityReportRecordSchema,
  CraftQualityReportRecordSchema,
  CraftRepairOperationRecordSchema,
  JobEvidenceCoverageRecordSchema,
  DefinitionApprovalEvidenceSchema,
  ResumeStrategyRecordSchema,
  TargetFitAnalysisRecordSchema,
} from "./data.js";
import { InferenceDataBlockSchema, PURPOSE_LIMITS, PURPOSE_OUTPUT_SCHEMAS } from "./inference.js";
import { PURPOSE_RESULT_SCHEMAS } from "../../resume-inference/results.js";
import { RESUME_PROMPT_POLICY_VERSION } from "../../resume-inference/policy.js";
import { CRAFT_EVIDENCE_LIMITED_POLICY } from "../../resume-inference/craft-evaluator.js";

const ownerId = "70000000-0000-4000-8000-000000000001";
const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const timestamp = "2026-08-11T12:00:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const id = (suffix: number) => `70000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

function envelope(recordType: string, suffix: number) {
  return {
    schema_version: 3,
    record_type: recordType,
    metadata: {
      record_id: id(suffix), revision_id: id(suffix + 100), revision: 1, created_at: timestamp,
      created_by: {
        owner_id: ownerId, actor_id: ownerId, app_id: "ai.braindrive.resume-builder",
        publisher_id: "ai.braindrive", package_digest: digest("a"), installation_id: id(2),
      },
      prior_revision_id: null, extensions: {},
    },
    owner_id: ownerId, updated_at: timestamp, lifecycle_state: "active",
    sensitivity: "sensitive", retention_class: "durable_owner_data", extensions: {},
  };
}

describe("Spec 07 milestone 1 schema-3 contracts", () => {
  const coverageBody = {
    coverage_version: 1,
    job_fact_revision_id: id(10),
    dimensions: {
      responsibilities: { state: "answered", evidence_revision_ids: [id(11)], recorded_at: timestamp },
      tools: { state: "unknown", evidence_revision_ids: [], recorded_at: timestamp },
      accomplishments: { state: "unanswered", evidence_revision_ids: [], recorded_at: null },
      outcomes: { state: "not_applicable", evidence_revision_ids: [], recorded_at: timestamp },
      scope: { state: "skipped", evidence_revision_ids: [], recorded_at: timestamp },
      progression: { state: "deferred", evidence_revision_ids: [], recorded_at: timestamp },
    },
    opportunities: [],
    migrated_legacy_evidence_revision_ids: [id(11)],
  } as const;

  it("defines strict coverage and derived-record authorities without numeric quality scores", () => {
    const coverage = {
      ...envelope("job_evidence_coverage", 20), ...coverageBody,
      coverage_digest: canonicalInputDigest(coverageBody),
    };
    expect(JobEvidenceCoverageRecordSchema.safeParse(coverage).success).toBe(true);
    expect(JobEvidenceCoverageRecordSchema.safeParse({ ...coverage, dimensions: { ...coverage.dimensions, tools: { ...coverage.dimensions.tools, evidence_revision_ids: [id(12)] } } }).success).toBe(false);

    const strategy = {
      ...envelope("resume_strategy", 30), strategy_version: 1,
      fact_snapshot_digest: digest("b"), fact_revision_ids: [id(10), id(11)], coverage_revision_ids: [coverage.metadata.revision_id],
      target_revision_id: null, history_shape: "chronological_standard", history_reason_code: "standard_chronology", role_emphasis: [],
      section_order: ["experience"], evidence_priorities: [], summary_decision: "omit", summary_reason_code: "insufficient_distinct_value", skills_context: [],
      omissions: [], unresolved_gap_ids: [], owner_rationale: "Lead with confirmed evidence.", prompt_policy_id: "braindrive.resume-builder.fixed",
      prompt_policy_version: "6", quality_standard_id: "braindrive.resume-quality", quality_standard_version: "3", quality_standard_digest: digest("9"), provider_profile_id: "owner-active", model_id: "model-a", input_digest: digest("c"), output_digest: digest("d"),
    };
    const targetBody = {
      analysis_version: 1 as const,
      parent_general_definition_revision_id: id(41), job_revision_id: id(42), target_content_digest: digest("8"), strategy_revision_id: strategy.metadata.revision_id,
      strategy_digest: canonicalInputDigest(strategy), fact_snapshot_digest: strategy.fact_snapshot_digest, fact_revision_ids: strategy.fact_revision_ids,
      evidence_matrix_digest: digest("e"), fit_class: "partially_supported_transferable" as const,
      support_counts: { core: 0, transferable: 2, partial: 1, unsupported: 3 },
      material_changes: [], threshold_policy_id: "braindrive.resume-builder.target-fit.provisional-rb7-oq3", threshold_policy_version: "1",
      prompt_policy_id: "braindrive.resume-builder.fixed", prompt_policy_version: "6", provider_profile_id: "owner-active", model_id: "model-a",
      input_digest: digest("c"), output_digest: digest("d"), outcome: "no_meaningful_change" as const, analysis_state: "completed" as const,
      no_change_reason: "insufficient_supported_fit" as const, owner_next_actions: ["use_general_resume" as const, "try_different_target" as const], targeted_definition_revision_id: null,
    };
    const target = {
      ...envelope("target_fit_analysis", 40), ...targetBody, analysis_digest: canonicalInputDigest(targetBody),
    };
    const craftBody = {
      report_version: 1 as const,
      proposal_definition_revision_id: id(51), strategy_revision_id: strategy.metadata.revision_id,
      target_analysis_revision_id: null, definition_digest: digest("0"), strategy_digest: canonicalInputDigest(strategy),
      fact_snapshot_digest: digest("1"), fact_revision_ids: strategy.fact_revision_ids, coverage_revision_ids: strategy.coverage_revision_ids,
      quality_standard_id: "braindrive.resume-quality", quality_standard_version: "3", quality_standard_digest: digest("2"),
      evidence_limited_policy_id: CRAFT_EVIDENCE_LIMITED_POLICY.policy_id, evidence_limited_policy_version: CRAFT_EVIDENCE_LIMITED_POLICY.policy_version,
      evidence_limited_authority_status: CRAFT_EVIDENCE_LIMITED_POLICY.authority_status,
      truth_validation_digest: digest("7"), structure_validation_digest: digest("8"),
      criterion_verdicts: ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "T1", "T2", "T3"].map((criterion) => ({ criterion, verdict: criterion.startsWith("T") ? "not_applicable" : "pass", finding_ids: [] })),
      findings: [], evidence_context: "standard" as const, verdict: "pass" as const,
      prompt_policy_id: "braindrive.resume-builder.fixed", prompt_policy_version: "7",
      provider_profile_id: "owner-active", model_id: "model-a", input_digest: digest("3"), output_digest: digest("4"), evaluated_at: timestamp,
    };
    const craft = { ...envelope("craft_quality_report", 50), ...craftBody, report_digest: canonicalInputDigest(craftBody) };
    const repairBody = {
      repair_version: 1 as const, attempt: 1 as const,
      source_definition_revision_id: id(51), source_report_revision_id: craft.metadata.revision_id,
      source_definition_digest: craft.definition_digest, source_report_digest: craft.report_digest,
      strategy_revision_id: strategy.metadata.revision_id, target_analysis_revision_id: null, fact_snapshot_digest: craft.fact_snapshot_digest,
      statement_scope_ids: [id(61)], allowed_correction_classes: ["specificity"],
      prompt_policy_id: "braindrive.resume-builder.fixed", prompt_policy_version: "7", provider_profile_id: "owner-active", model_id: "model-a",
      input_digest: digest("5"), result: "completed" as const, successor_definition_revision_id: id(62),
      successor_report_revision_id: id(63), output_digest: digest("6"), unchanged_statement_count: 4, error_class: null, completed_at: timestamp,
    };
    const repair = { ...envelope("craft_repair_operation", 60), ...repairBody, operation_digest: canonicalInputDigest(repairBody) };
    const parityBody = {
      parity_version: 1 as const, approved_definition_revision_id: id(71),
      parity_policy_id: "resume.artifact-parity", parity_policy_version: "1",
      representations: ["approved_definition", "preview", "clean_text", "pdf_extraction", "career_projection"].map((kind, index) => ({
        kind, revision_id: id(72 + index), logical_manifest_digest: digest(String(index + 5)), entry_count: 4,
      })),
      mismatch_categories: [], disposition: "pass" as const, checked_at: timestamp,
    };
    const parity = { ...envelope("artifact_parity_report", 70), ...parityBody, report_digest: canonicalInputDigest(parityBody) };
    for (const [schema, value] of [
      [ResumeStrategyRecordSchema, strategy], [TargetFitAnalysisRecordSchema, target],
      [CraftQualityReportRecordSchema, craft], [CraftRepairOperationRecordSchema, repair],
      [ArtifactParityReportRecordSchema, parity],
    ] as const) {
      expect(schema.safeParse(value).success).toBe(true);
      expect(schema.safeParse({ ...value, numeric_score: 100 }).success).toBe(false);
    }
    expect(ArtifactParityReportRecordSchema.safeParse({ ...parity, checked_at: "2026-08-11T12:05:00.000Z" }).success).toBe(false);
  });

  it("versions the new brokered purposes, bounded limits, data blocks, and strict results", () => {
    expect(RESUME_PROMPT_POLICY_VERSION).toBe("7");
    expect(PURPOSE_OUTPUT_SCHEMAS).toMatchObject({
      resume_strategy: "resume.strategy.v1",
      tailoring_plan: "resume.tailoring-plan.v2",
      resume_craft_evaluate: "resume.craft-evaluate.v1",
      resume_craft_repair: "resume.craft-repair.v1",
    });
    for (const purpose of ["resume_strategy", "resume_craft_evaluate", "resume_craft_repair"] as const) {
      expect(PURPOSE_LIMITS[purpose]).toMatchObject({ attempts: 2, concurrency: 1 });
      expect(PURPOSE_RESULT_SCHEMAS[purpose].safeParse({ unsupported: true }).success).toBe(false);
    }
    expect(InferenceDataBlockSchema.safeParse({
      category: "coverage_summary", content_digest: digest("9"), schema_id: "resume.coverage-summary.v1",
      schema_version: 1, data: {}, raw_prompt: "forbidden",
    }).success).toBe(false);
    expect(InferenceDataBlockSchema.safeParse({
      category: "craft_gate_policy", content_digest: canonicalInputDigest(CRAFT_EVIDENCE_LIMITED_POLICY), schema_id: "resume.craft-gate-policy.v1",
      schema_version: 1, data: CRAFT_EVIDENCE_LIMITED_POLICY,
    }).success).toBe(true);
  });

  it("binds current persuasive approval evidence and rejects content-bearing diagnostic substitutes", async () => {
    const baseApproval = {
      validation_run_id: id(80), validator_id: "resume.claim-validator", validator_version: "1",
      validator_policy_digest: digest("1"), input_snapshot_digest: digest("2"), output_digest: digest("3"), findings_digest: digest("4"),
      prompt_policy_id: "braindrive.resume-builder.fixed", prompt_policy_version: "3", provider_policy_id: "owner-active-compatible",
      quality_report_digest: digest("5"), quality_input_digest: digest("6"), quality_validator_id: "resume.quality", quality_validator_version: "3", validated_at: timestamp,
      persuasive_quality: {
        contract_version: 1, status: "current", coverage_revision_ids: [id(81)], strategy_revision_id: id(82),
        craft_report_revision_id: id(83), craft_report_digest: digest("8"), craft_definition_digest: digest("9"),
        target_analysis_revision_id: null, successor_continuity_digest: digest("7"),
        evidence_limited_policy_id: CRAFT_EVIDENCE_LIMITED_POLICY.policy_id, evidence_limited_policy_version: CRAFT_EVIDENCE_LIMITED_POLICY.policy_version,
        evidence_limited_authority_status: CRAFT_EVIDENCE_LIMITED_POLICY.authority_status,
        parity_policy_id: "resume.artifact-parity", parity_policy_version: "1",
      },
    } as const;
    expect(DefinitionApprovalEvidenceSchema.safeParse(baseApproval).success).toBe(true);
    expect(DefinitionApprovalEvidenceSchema.safeParse({ ...baseApproval, persuasive_quality: { ...baseApproval.persuasive_quality, craft_report_revision_id: null } }).success).toBe(false);

    const forbidden = JSON.parse(await readFile(resolve(fixtureRoot, "fixtures/security/spec-07-forbidden-audit.json"), "utf8"));
    expect(AuditEventSchema.safeParse(forbidden).success).toBe(false);
    expect(() => assertContentFreeAudit(forbidden)).toThrow(/prohibited|content-free/i);
    const manifest = JSON.parse(await readFile(resolve(fixtureRoot, "fixtures/spec-07/m1-review-manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ authority_status: "review_only_pending_accepted_spec_and_test_plan" });
  });
});
