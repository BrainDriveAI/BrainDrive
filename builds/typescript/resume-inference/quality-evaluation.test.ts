import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import {
  BlindedHumanReviewSchema,
  FreshGenerationOperationSchema,
  HumanCalibrationPolicySchema,
  M7DurableQualityReportSchema,
  M7RetentionContractSchema,
  ProviderPurposeEvidenceSchema,
  assertSanitizedDurableEvidence,
  buildM7DurableQualityReport,
  deleteRawSyntheticReviewArtifacts,
  evaluateHumanCalibration,
  evaluateMultiRunEvidence,
  evaluateProviderConformance,
  loadM7QualityCorpus,
  validateM7FixtureIntegrity,
} from "./quality-evaluation.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const sha = (value: string) => canonicalInputDigest(value);
const sourceRevision = "7ba4e8abebdc0032c9c2f8021321585b85397811";
const policyBinding = {
  source_revision: sourceRevision,
  quality_standard_revision: 3 as const,
  prompt_policy_digest: sha("prompt-policy-7"),
  rubric_digest: sha("resume-quality-revision-3"),
  fixture_corpus_digest: sha("m7-corpus"),
  report_schema_digest: sha("m7-report-schema-1"),
};

function passingOperation(index: number, fixtureId = "f1-foundation-synthetic") {
  return FreshGenerationOperationSchema.parse({
    evidence_schema_version: 1,
    ...policyBinding,
    fixture_id: fixtureId,
    provider_class: "owner-active-provider-class-a",
    model_class: "structured-no-tools-class-a",
    operation_id: `91000000-0000-4000-8000-00000000000${index}`,
    freshness_digest: sha(`fresh-${index}`),
    output_digest: sha(`output-${index}`),
    status: "completed",
    gates: {
      truth: "passed",
      structure: "passed",
      craft_c1: "passed",
      craft_c2: "passed",
      craft_c3: "passed",
      must_use: "passed",
      target_change: "not_applicable",
      repair_non_regression: "not_applicable",
      successor_continuity: "not_applicable",
      artifact_parity: "passed",
    },
    holistic_read: 5,
  });
}

function calibrationPolicy() {
  return HumanCalibrationPolicySchema.parse({
    policy_schema_version: 1,
    authority_status: "accepted",
    policy_id: "resume-quality-human-calibration",
    policy_version: 1,
    accepted_at: "2026-08-11T12:00:00.000Z",
    resume_reviewer_identity_digest: sha("named-resume-reviewer"),
    owner_reviewer_identity_digest: sha("named-owner-reviewer"),
    required_resume_fixture_ids: ["f1-foundation-synthetic", "f4-career-changer-synthetic"],
    required_owner_journey_ids: ["journey-normalized-early-career"],
    minimum_recruiter_read: 3,
    f1_minimum_recruiter_read: 4,
    disagreement_rule: "fail_closed",
  });
}

function review(role: "resume_quality" | "nontechnical_owner", sharedDecision: "passed" | "failed" = "passed") {
  return BlindedHumanReviewSchema.parse({
    review_schema_version: 1,
    ...policyBinding,
    reviewer_role: role,
    reviewer_identity_digest: role === "resume_quality" ? sha("named-resume-reviewer") : sha("named-owner-reviewer"),
    reviewed_at: "2026-08-11T13:00:00.000Z",
    blinded: {
      model_identity_visible: false,
      evaluator_transcript_visible: false,
      fixture_expectations_visible: false,
      prior_scores_visible: false,
    },
    scorecard_input_digest: sha(`${role}-input`),
    resume_decisions: role === "resume_quality" ? [
      {
        fixture_id: "f1-foundation-synthetic",
        mandatory_craft: "passed",
        target_honesty: sharedDecision,
        tone: "passed",
        artifact_usefulness: "passed",
        recruiter_read: 4,
      },
      {
        fixture_id: "f4-career-changer-synthetic",
        mandatory_craft: "passed",
        target_honesty: sharedDecision,
        tone: "passed",
        artifact_usefulness: "passed",
        recruiter_read: 3,
      },
    ] : [],
    owner_decisions: role === "nontechnical_owner" ? [{
      journey_id: "journey-normalized-early-career",
      question_usefulness: "passed",
      clarity: "passed",
      pressure_respected: "passed",
      control_preserved: "passed",
      target_honesty: sharedDecision,
      tone: "passed",
      artifact_usefulness: "passed",
    }] : [],
  });
}

describe("M7 synthetic corpus and strict report contracts", () => {
  it("loads a complete content-free corpus with holdouts and every required relation", async () => {
    const corpus = await loadM7QualityCorpus();
    const integrity = validateM7FixtureIntegrity(corpus);

    expect(integrity).toMatchObject({
      outcome: "passed",
      generative_fixture_count: 9,
      holdout_fixture_count: 2,
      must_use_case_count: 9,
      coverage_journey_count: 8,
      target_case_count: 7,
      craft_case_count: 4,
      repair_case_count: 2,
      successor_pair_count: 2,
      parity_mutation_count: 4,
      friction_journey_count: 2,
    });
    expect(corpus.holdout_fixture_ids.every((id) => !corpus.generative_fixture_ids.includes(id))).toBe(true);
    expect(JSON.stringify(corpus)).not.toMatch(/resume_text|job_description_text|owner_text|prompt|provider_body|credential|private_path/);
    expect(() => M7DurableQualityReportSchema.parse({ unexpected: true })).toThrow();
  });

  it("rejects fixture identity drift, invalid must-use coverage, and incomplete parity relations", async () => {
    const corpus = await loadM7QualityCorpus();
    expect(() => validateM7FixtureIntegrity({
      ...corpus,
      holdout_fixture_ids: [corpus.generative_fixture_ids[0]!, ...corpus.holdout_fixture_ids.slice(1)],
    })).toThrow(/holdout/i);
    expect(() => validateM7FixtureIntegrity({
      ...corpus,
      evidence_cases: corpus.evidence_cases.map((item, index) => index === 0 ? { ...item, used_evidence_ids: [] } : item),
    })).toThrow(/must-use/i);
    expect(() => validateM7FixtureIntegrity({ ...corpus, parity_cases: corpus.parity_cases.slice(0, -1) })).toThrow(/parity/i);
  });
});

describe("M7 multi-run and provider gates", () => {
  it("requires exactly three genuinely fresh passing operations for every fixture/provider class", () => {
    const result = evaluateMultiRunEvidence({
      binding: policyBinding,
      generative_fixture_ids: ["f1-foundation-synthetic"],
      authorized_provider_models: [{ provider_class: "owner-active-provider-class-a", model_class: "structured-no-tools-class-a" }],
      operations: [passingOperation(1), passingOperation(2), passingOperation(3)],
    });
    expect(result).toMatchObject({ status: "passed", expected_operation_count: 3, completed_operation_count: 3, failed_operation_count: 0 });

    expect(evaluateMultiRunEvidence({
      binding: policyBinding,
      generative_fixture_ids: ["f1-foundation-synthetic"],
      authorized_provider_models: [{ provider_class: "owner-active-provider-class-a", model_class: "structured-no-tools-class-a" }],
      operations: [passingOperation(1), passingOperation(1), passingOperation(3)],
    })).toMatchObject({ status: "blocked", completed_operation_count: 2 });

    expect(() => evaluateMultiRunEvidence({
      binding: policyBinding,
      generative_fixture_ids: ["f1-foundation-synthetic"],
      authorized_provider_models: [{ provider_class: "owner-active-provider-class-a", model_class: "structured-no-tools-class-a" }],
      operations: [passingOperation(1), { ...passingOperation(1), output_digest: sha("mismatched-restart") }, passingOperation(3)],
    })).toThrow(/mismatched duplicate operation/i);
  });

  it("fails a mandatory per-run gate even when the aggregate holistic read is maximal", () => {
    const failing = passingOperation(2);
    const result = evaluateMultiRunEvidence({
      binding: policyBinding,
      generative_fixture_ids: ["f1-foundation-synthetic"],
      authorized_provider_models: [{ provider_class: "owner-active-provider-class-a", model_class: "structured-no-tools-class-a" }],
      operations: [passingOperation(1), { ...failing, gates: { ...failing.gates, craft_c2: "failed" as const } }, passingOperation(3)],
    });
    expect(result).toMatchObject({ status: "failed", failed_operation_count: 1 });
  });

  it("classifies every provider error as non-conformance and requires purpose-complete evidence", () => {
    const purposes = ["resume_strategy", "general_resume_draft", "resume_craft_evaluate", "resume_craft_repair"] as const;
    const passing = purposes.map((purpose, index) => ProviderPurposeEvidenceSchema.parse({
      evidence_schema_version: 1,
      ...policyBinding,
      provider_class: "owner-active-provider-class-a",
      model_class: "structured-no-tools-class-a",
      purpose,
      operation_id: `92000000-0000-4000-8000-00000000000${index + 1}`,
      outcome: "passed",
      strict_schema: "passed",
      zero_unsupported_claims: "passed",
    }));
    expect(evaluateProviderConformance({
      binding: policyBinding,
      required_purposes: [...purposes],
      authorized_provider_models: [{ provider_class: "owner-active-provider-class-a", model_class: "structured-no-tools-class-a" }],
      evidence: passing,
    }).status).toBe("passed");

    for (const errorClass of ["timeout", "response_loss", "refusal", "malformed_output", "incompatible"] as const) {
      const failed = passing.map((item, index) => index === 0 ? { ...item, outcome: errorClass, strict_schema: "failed" as const, zero_unsupported_claims: "not_evaluated" as const } : item);
      expect(evaluateProviderConformance({
        binding: policyBinding,
        required_purposes: [...purposes],
        authorized_provider_models: [{ provider_class: "owner-active-provider-class-a", model_class: "structured-no-tools-class-a" }],
        evidence: failed,
      }).status).toBe("failed");
    }
  });
});

describe("M7 blinded human calibration", () => {
  it("blocks missing reviewers, fails disagreement closed, and passes attributable blinded agreement", () => {
    const policy = calibrationPolicy();
    expect(evaluateHumanCalibration({ binding: policyBinding, policy, reviews: [review("resume_quality")] }).status).toBe("blocked");
    expect(evaluateHumanCalibration({ binding: policyBinding, policy, reviews: [review("resume_quality"), review("nontechnical_owner", "failed")] })).toMatchObject({ status: "failed", disagreement_count: 1 });
    expect(evaluateHumanCalibration({ binding: policyBinding, policy, reviews: [review("resume_quality"), review("nontechnical_owner")] })).toMatchObject({ status: "passed", disagreement_count: 0, reviewer_count: 2 });
  });

  it("rejects transcript-aware scorecards and revision or policy mismatches", () => {
    expect(() => BlindedHumanReviewSchema.parse({
      ...review("resume_quality"),
      blinded: { ...review("resume_quality").blinded, evaluator_transcript_visible: true },
    })).toThrow();
    const mismatched = { ...review("resume_quality"), source_revision: "a".repeat(40) };
    expect(() => evaluateHumanCalibration({ binding: policyBinding, policy: calibrationPolicy(), reviews: [mismatched, review("nontechnical_owner")] })).toThrow(/revision|binding/i);
  });
});

describe("M7 sanitization, gate precedence, and deletion", () => {
  it("keeps release readiness false when any automated, provider, human, friction, or deletion gate is missing", async () => {
    const corpus = await loadM7QualityCorpus();
    const report = buildM7DurableQualityReport({
      binding: { ...policyBinding, fixture_corpus_digest: canonicalInputDigest(corpus) },
      corpus_integrity: validateM7FixtureIntegrity(corpus),
      deterministic_foundation: { status: "passed", report_digest: sha("foundation") },
    });
    expect(report.release_ready).toBe(false);
    expect(report.gates).toMatchObject({
      multi_run: "blocked",
      provider_conformance: "blocked",
      human_calibration: "blocked",
      numeric_friction: "blocked",
      retention_deletion: "blocked",
    });
    expect(M7DurableQualityReportSchema.parse(report)).toEqual(report);
    expect(() => M7DurableQualityReportSchema.parse({ ...report, owner_text: "forbidden" })).toThrow();
    expect(() => assertSanitizedDurableEvidence({ ...report, nested: { prompt: "forbidden" } })).toThrow(/prohibited/i);
    expect(() => assertSanitizedDurableEvidence({ ...report, nested: { value: "/home/private/review.json" } })).toThrow(/path/i);
    expect(assertSanitizedDurableEvidence(report)).toEqual(report);
  });

  it("deletes only sentinel-marked raw synthetic review artifacts under an accepted bounded contract", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "bd-m7-review-parent-"));
    temporaryRoots.push(parent);
    const workspace = path.join(parent, "bounded-review");
    await mkdir(workspace);
    const contract = M7RetentionContractSchema.parse({
      contract_schema_version: 1,
      authority_status: "accepted",
      policy_id: "synthetic-review-retention",
      policy_version: 1,
      accepted_at: "2026-08-11T12:00:00.000Z",
      synthetic_only: true,
      delete_after_ingestion: true,
      maximum_retention_hours: 24,
    });
    await writeFile(path.join(workspace, ".braindrive-synthetic-review.json"), JSON.stringify({ synthetic: true, retention_contract_digest: canonicalInputDigest(contract) }), "utf8");
    await writeFile(path.join(workspace, "raw-scorecard.json"), JSON.stringify({ synthetic: true, score: 4 }), "utf8");

    const attestation = await deleteRawSyntheticReviewArtifacts({
      parent_directory: parent,
      workspace_directory: workspace,
      contract,
      completed_at: "2026-08-11T14:00:00.000Z",
    });
    expect(attestation).toMatchObject({ deleted: true, raw_artifact_count: 2, policy_digest: canonicalInputDigest(contract) });
    expect(JSON.stringify(attestation)).not.toContain(parent);
    await expect(access(workspace)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(parent)).resolves.toBeUndefined();
  });

  it("refuses deletion without the exact synthetic sentinel and leaves the workspace intact", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "bd-m7-review-parent-"));
    temporaryRoots.push(parent);
    const workspace = path.join(parent, "unmarked-review");
    await mkdir(workspace);
    await writeFile(path.join(workspace, "raw-scorecard.json"), "{}", "utf8");
    const contract = M7RetentionContractSchema.parse({
      contract_schema_version: 1,
      authority_status: "accepted",
      policy_id: "synthetic-review-retention",
      policy_version: 1,
      accepted_at: "2026-08-11T12:00:00.000Z",
      synthetic_only: true,
      delete_after_ingestion: true,
      maximum_retention_hours: 24,
    });
    await expect(deleteRawSyntheticReviewArtifacts({
      parent_directory: parent,
      workspace_directory: workspace,
      contract,
      completed_at: "2026-08-11T14:00:00.000Z",
    })).rejects.toThrow(/sentinel/i);
    await expect(access(workspace)).resolves.toBeUndefined();
  });
});
