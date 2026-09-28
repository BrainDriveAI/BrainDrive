import { access, mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
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
  loadFrozenQualityRegressionManifest,
  loadM7QualityCorpus,
  validateCorrectiveCorpusBindings,
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
  quality_standard_digest: sha("resume-quality-revision-3"),
  prompt_policy_digest: sha("prompt-policy-7"),
  rubric_digest: sha("resume-quality-revision-3"),
  evaluator_contract_digest: sha("product-craft-evaluator-2"),
  fixture_corpus_digest: sha("m7-corpus"),
  craft_report_schema_digest: sha("craft-report-schema-2"),
  report_schema_digest: sha("m7-report-schema-1"),
};

function passingOperation(index: number, fixtureId = "f1-foundation-synthetic") {
  return FreshGenerationOperationSchema.parse({
    evidence_schema_version: 2,
    ...policyBinding,
    evidence_scope: "controlled_provider_generation",
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
      craft_c4: "passed",
      craft_c5: "passed",
      craft_c6: "passed",
      craft_c7: "passed",
      target_t1: "not_applicable",
      target_t2: "not_applicable",
      target_t3: "not_applicable",
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
    review_schema_version: 2,
    ...policyBinding,
    evidence_scope: "controlled_blinded_human_calibration",
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
        evidence_reference_digests: [sha("resume-f1-evidence")],
      },
      {
        fixture_id: "f4-career-changer-synthetic",
        mandatory_craft: "passed",
        target_honesty: sharedDecision,
        tone: "passed",
        artifact_usefulness: "passed",
        recruiter_read: 3,
        evidence_reference_digests: [sha("resume-f4-evidence")],
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
      evidence_reference_digests: [sha("owner-journey-evidence")],
    }] : [],
  });
}

describe("M7 synthetic corpus and strict report contracts", () => {
  it("loads a complete content-free corpus with holdouts and every required relation", async () => {
    const corpus = await loadM7QualityCorpus();
    const frozen = await loadFrozenQualityRegressionManifest();
    const integrity = validateM7FixtureIntegrity(corpus);
    const corrective = validateCorrectiveCorpusBindings(corpus, frozen);

    expect(integrity).toMatchObject({
      outcome: "passed",
      generative_fixture_count: 9,
      holdout_fixture_count: 2,
      must_use_case_count: 9,
      coverage_journey_count: 8,
      target_case_count: 7,
      craft_case_count: 6,
      clean_control_count: 3,
      permutation_relation_count: 1,
      repair_case_count: 2,
      successor_pair_count: 2,
      parity_mutation_count: 4,
      friction_journey_count: 2,
    });
    expect(corrective).toMatchObject({
      outcome: "passed",
      frozen_negative_count: 1,
      clean_positive_count: 3,
      permutation_relation_count: 1,
      evidence_scope: "workflow_only",
      higher_gate_eligible: false,
    });
    expect(corpus.corrective_relations.frozen_negative.manifest_digest).toBe(frozen.manifest_digest);
    expect(corpus.corrective_relations.clean_positive_case_ids).toHaveLength(3);
    expect(new Set(corpus.corrective_relations.permutation.permutation_digests).size).toBeGreaterThanOrEqual(2);
    expect(corpus.holdout_fixture_ids.every((id) => !corpus.generative_fixture_ids.includes(id))).toBe(true);
    expect(JSON.stringify(corpus)).not.toMatch(/resume_text|job_description_text|owner_text|"prompt":|provider_body|credential|private_path/);
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
    expect(() => validateM7FixtureIntegrity({
      ...corpus,
      evidence_scope: "controlled_provider_generation",
    })).toThrow();
    expect(() => validateM7FixtureIntegrity({
      ...corpus,
      corrective_relations: {
        ...corpus.corrective_relations,
        clean_positive_case_ids: [corpus.corrective_relations.clean_positive_case_ids[0]!],
      },
    })).toThrow(/clean/i);
  });

  it("rejects frozen-oracle, permutation, and corrected policy binding drift", async () => {
    const corpus = await loadM7QualityCorpus();
    const frozen = await loadFrozenQualityRegressionManifest();
    expect(() => validateCorrectiveCorpusBindings(corpus, { ...frozen, manifest_digest: sha("drift") })).toThrow();
    expect(() => validateCorrectiveCorpusBindings({
      ...corpus,
      corrective_relations: {
        ...corpus.corrective_relations,
        permutation: { ...corpus.corrective_relations.permutation, expected_semantic_input_digest: sha("drift") },
      },
    }, frozen)).toThrow(/permutation/i);
    expect(() => validateCorrectiveCorpusBindings({
      ...corpus,
      corrected_bindings: { ...corpus.corrected_bindings, evaluator_contract_digest: sha("drift") },
    }, frozen)).toThrow(/binding/i);
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

    expect(() => evaluateMultiRunEvidence({
      binding: policyBinding,
      generative_fixture_ids: ["f1-foundation-synthetic"],
      authorized_provider_models: [{ provider_class: "owner-active-provider-class-a", model_class: "structured-no-tools-class-a" }],
      operations: [passingOperation(1), passingOperation(1), passingOperation(3)],
    })).toThrow(/duplicate operation/i);

    expect(() => evaluateMultiRunEvidence({
      binding: policyBinding,
      generative_fixture_ids: ["f1-foundation-synthetic"],
      authorized_provider_models: [{ provider_class: "owner-active-provider-class-a", model_class: "structured-no-tools-class-a" }],
      operations: [passingOperation(1), { ...passingOperation(1), output_digest: sha("mismatched-restart") }, passingOperation(3)],
    })).toThrow(/mismatched duplicate operation/i);

    expect(() => evaluateMultiRunEvidence({
      binding: policyBinding,
      generative_fixture_ids: ["f1-foundation-synthetic"],
      authorized_provider_models: [{ provider_class: "owner-active-provider-class-a", model_class: "structured-no-tools-class-a" }],
      operations: [passingOperation(1), { ...passingOperation(2), freshness_digest: passingOperation(1).freshness_digest }, passingOperation(3)],
    })).toThrow(/freshness/i);

    expect(() => evaluateMultiRunEvidence({
      binding: policyBinding,
      generative_fixture_ids: ["f1-foundation-synthetic"],
      authorized_provider_models: [{ provider_class: "owner-active-provider-class-a", model_class: "structured-no-tools-class-a" }],
      operations: [passingOperation(1), passingOperation(2), { ...passingOperation(3), model_class: "unauthorized-model-class" }],
    })).toThrow(/unauthorized/i);
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
      evidence_schema_version: 2,
      ...policyBinding,
      evidence_scope: "controlled_provider_conformance",
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

    for (const errorClass of ["timeout", "response_loss", "refusal", "malformed_output", "incompatible", "strict_schema_failure", "unsupported_claim"] as const) {
      const failedVerdicts = errorClass === "unsupported_claim"
        ? { strict_schema: "passed" as const, zero_unsupported_claims: "failed" as const }
        : { strict_schema: "failed" as const, zero_unsupported_claims: "not_evaluated" as const };
      const failed = passing.map((item, index) => index === 0 ? { ...item, outcome: errorClass, ...failedVerdicts } : item);
      expect(evaluateProviderConformance({
        binding: policyBinding,
        required_purposes: [...purposes],
        authorized_provider_models: [{ provider_class: "owner-active-provider-class-a", model_class: "structured-no-tools-class-a" }],
        evidence: failed,
      }).status).toBe("failed");
    }
    expect(evaluateProviderConformance({
      binding: policyBinding,
      required_purposes: [...purposes],
      authorized_provider_models: [{ provider_class: "owner-active-provider-class-a", model_class: "structured-no-tools-class-a" }],
      evidence: passing.slice(1),
    }).status).toBe("blocked");
    expect(() => evaluateProviderConformance({
      binding: policyBinding,
      required_purposes: [...purposes],
      authorized_provider_models: [{ provider_class: "owner-active-provider-class-a", model_class: "structured-no-tools-class-a" }],
      evidence: [...passing, { ...passing[0]!, model_class: "unauthorized-model-class", operation_id: "92000000-0000-4000-8000-000000000099" }],
    })).toThrow(/unauthorized/i);
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
    expect(evaluateHumanCalibration({
      binding: policyBinding,
      policy: calibrationPolicy(),
      reviews: [{ ...review("resume_quality"), reviewer_identity_digest: sha("wrong-reviewer") }, review("nontechnical_owner")],
    })).toMatchObject({ status: "failed", identity_mismatch_count: 1 });
    const belowThreshold = review("resume_quality");
    belowThreshold.resume_decisions[0]!.recruiter_read = 3;
    expect(evaluateHumanCalibration({ binding: policyBinding, policy: calibrationPolicy(), reviews: [belowThreshold, review("nontechnical_owner")] }).status).toBe("failed");
    expect(() => BlindedHumanReviewSchema.parse({
      ...review("resume_quality"),
      resume_decisions: review("resume_quality").resume_decisions.map((decision) => ({ ...decision, evidence_reference_digests: [] })),
    })).toThrow();
  });
});

describe("M7 sanitization, gate precedence, and deletion", () => {
  it("keeps release readiness false when any automated, provider, human, friction, or deletion gate is missing", async () => {
    const corpus = await loadM7QualityCorpus();
    const frozen = await loadFrozenQualityRegressionManifest();
    const report = buildM7DurableQualityReport({
      binding: { ...policyBinding, fixture_corpus_digest: canonicalInputDigest(corpus) },
      corpus_integrity: validateM7FixtureIntegrity(corpus),
      corrective_bindings: validateCorrectiveCorpusBindings(corpus, frozen),
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
    expect(report.gates).toMatchObject({ corrective_corpus: "passed", workflow_fixture_boundary: "passed", controlled_authority: "blocked" });
    expect(M7DurableQualityReportSchema.parse(report)).toEqual(report);
    expect(() => M7DurableQualityReportSchema.parse({ ...report, owner_text: "forbidden" })).toThrow();
    expect(() => assertSanitizedDurableEvidence({ ...report, nested: { prompt: "forbidden" } })).toThrow(/prohibited/i);
    expect(() => assertSanitizedDurableEvidence({ ...report, nested: { value: "/home/private/review.json" } })).toThrow(/path/i);
    expect(() => assertSanitizedDurableEvidence({ ...report, nested: { raw_output: "forbidden" } })).toThrow(/prohibited/i);
    expect(() => assertSanitizedDurableEvidence({ ...report, nested: { value: "RB6_F1_CANARY_DEADBEEF" } })).toThrow(/canary/i);
    expect(assertSanitizedDurableEvidence(report)).toEqual(report);
  });

  it("deletes only sentinel-marked raw synthetic review artifacts under an accepted bounded contract", async () => {
    const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), "bd-m7-review-parent-")));
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
    const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), "bd-m7-review-parent-")));
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

  it("refuses mismatched sentinels, symlinks, and broad deletion targets", async () => {
    const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), "bd-m7-review-parent-")));
    temporaryRoots.push(parent);
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
    const mismatched = path.join(parent, "mismatched-review");
    await mkdir(mismatched);
    await writeFile(path.join(mismatched, ".braindrive-synthetic-review.json"), JSON.stringify({ synthetic: true, retention_contract_digest: sha("wrong-contract") }), "utf8");
    await expect(deleteRawSyntheticReviewArtifacts({ parent_directory: parent, workspace_directory: mismatched, contract, completed_at: "2026-08-11T14:00:00.000Z" })).rejects.toThrow(/does not match/i);

    const symlinked = path.join(parent, "symlinked-review");
    await mkdir(symlinked);
    await writeFile(path.join(symlinked, ".braindrive-synthetic-review.json"), JSON.stringify({ synthetic: true, retention_contract_digest: canonicalInputDigest(contract) }), "utf8");
    if (process.platform === "win32") {
      const linkedSource = path.join(parent, "linked-review-source");
      await mkdir(linkedSource);
      await writeFile(path.join(linkedSource, "raw-scorecard.json"), "{}", "utf8");
      await symlink(linkedSource, path.join(symlinked, "linked-scorecards"), "junction");
    } else {
      await symlink(path.join(symlinked, ".braindrive-synthetic-review.json"), path.join(symlinked, "linked-scorecard.json"));
    }
    await expect(deleteRawSyntheticReviewArtifacts({ parent_directory: parent, workspace_directory: symlinked, contract, completed_at: "2026-08-11T14:00:00.000Z" })).rejects.toThrow(/symbolic/i);

    await expect(deleteRawSyntheticReviewArtifacts({ parent_directory: parent, workspace_directory: parent, contract, completed_at: "2026-08-11T14:00:00.000Z" })).rejects.toThrow(/bounded/i);
  });
});
