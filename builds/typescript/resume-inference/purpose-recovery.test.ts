import { describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { InferencePurposeSchema, PURPOSE_OUTPUT_SCHEMAS, type InferencePurpose } from "../app-platform/contracts/inference.js";
import { conformanceBlocks } from "./conformance-corpus.js";
import { decideInferenceOutcome } from "./failure-policy.js";
import { deterministicGuidanceFallback } from "./guidance.js";
import { deterministicHostFallback, normalizeHostOwnedResult } from "./host-assistance.js";
import {
  PURPOSE_RECOVERY_POLICIES,
  purposeRecoveryPolicy,
  type PurposeRecoveryPolicy,
} from "./purpose-recovery.js";
import { parsePurposeResult } from "./results.js";
import { validateInferenceClaims } from "./validators.js";

const EXPECTED_POLICY = {
  interview_assist: ["interview_presentation", ["structural", "incomplete", "validation"], [], "none", "bounded"],
  general_resume_draft: ["general_fact_draft", ["structural", "incomplete", "validation"], [], "general_draft", "bounded"],
  job_description_analyze: ["none", [], [], "none", "bounded"],
  requirement_evidence_match: ["none", [], [], "none", "bounded"],
  tailoring_plan: ["none", [], [], "tailoring_plan", "bounded"],
  targeted_resume_draft: ["none", [], [], "targeted_draft", "bounded"],
  resume_revision_classify: ["none", [], [], "none", "bounded"],
  resume_revision_draft: ["none", [], [], "revision_draft", "bounded"],
  resume_guidance: ["guidance_projection", ["structural", "incomplete", "validation"], ["provider_unavailable", "quota_exceeded", "rate_limited", "deadline_exceeded", "internal_failure"], "none", "bounded"],
  resume_strategy: ["canonical_strategy", ["structural", "incomplete", "validation"], [], "none", "bounded"],
  resume_craft_evaluate: ["craft_evaluation", [], [], "craft_evaluation", "zero"],
  resume_craft_repair: ["none", [], [], "none", "bounded"],
} as const satisfies Record<InferencePurpose, readonly [
  PurposeRecoveryPolicy["deterministic_behavior"],
  readonly PurposeRecoveryPolicy["fallback_on"][number][],
  readonly PurposeRecoveryPolicy["operational_fallback_codes"][number][],
  PurposeRecoveryPolicy["normalization"],
  PurposeRecoveryPolicy["provider_calls"],
]>;

describe("Spec 09 exhaustive Resume purpose recovery policy", () => {
  it("classifies every registered purpose exactly once and fails closed for an unknown purpose", () => {
    expect(Object.keys(PURPOSE_RECOVERY_POLICIES)).toEqual(InferencePurposeSchema.options);
    for (const purpose of InferencePurposeSchema.options) {
      const policy = purposeRecoveryPolicy(purpose);
      expect(policy, purpose).not.toBeNull();
      expect([
        policy?.deterministic_behavior,
        policy?.fallback_on,
        policy?.operational_fallback_codes,
        policy?.normalization,
        policy?.provider_calls,
      ], purpose).toEqual(EXPECTED_POLICY[purpose]);
    }
    expect(purposeRecoveryPolicy("unclassified_purpose")).toBeNull();
    expect(decideInferenceOutcome({
      event: "finish",
      purpose: "unclassified_purpose" as InferencePurpose,
      attempt: 1,
      maxAttempts: 2,
      finishCategory: "stop",
    })).toMatchObject({ action: "fail", failure: { code: "internal_failure", stage: "internal" } });
  });

  it("gives every purpose an explicit clean, structural, incomplete, validation, filter/tool, operational, and cancellation disposition", () => {
    for (const purpose of InferencePurposeSchema.options) {
      const policy = PURPOSE_RECOVERY_POLICIES[purpose];
      const isHostOnly = policy.provider_calls === "zero";
      expect(decideInferenceOutcome({ event: "finish", purpose, attempt: 1, maxAttempts: 2, finishCategory: "stop" }).action).toBe("evaluate_output");
      for (const event of ["structural_failure", "incomplete_output", "validation_failure"] as const) {
        const decision = event === "structural_failure"
          ? decideInferenceOutcome({ event, purpose, attempt: 2, maxAttempts: 2, finishCategory: "stop", stage: "structured_parse" })
          : decideInferenceOutcome({ event, purpose, attempt: 2, maxAttempts: 2, finishCategory: "stop" });
        const trigger = event === "structural_failure" ? "structural" : event === "incomplete_output" ? "incomplete" : "validation";
        expect(decision.action, `${purpose}:${event}`).toBe(!isHostOnly && policy.fallback_on.includes(trigger) ? "fallback" : "fail");
      }
      for (const finishCategory of ["content_filter", "tool_calls"] as const) {
        expect(decideInferenceOutcome({ event: "finish", purpose, attempt: 1, maxAttempts: 2, finishCategory }).action, `${purpose}:${finishCategory}`).toBe("fail");
      }
      for (const code of ["provider_unavailable", "provider_authentication_failed", "cancelled"] as const) {
        const decision = decideInferenceOutcome({
          event: "operational_failure",
          purpose,
          attempt: 1,
          maxAttempts: 2,
          stage: code === "cancelled" ? "cancellation" : "provider_request",
          finishCategory: "missing",
          code,
          safeMessage: "Content-free failure",
          retryable: code === "provider_unavailable",
        });
        expect(decision.action, `${purpose}:${code}`).toBe(policy.operational_fallback_codes.includes(code as never) ? "fallback" : "fail");
      }
    }
  });

  it("keeps deterministic recovery limited to the five approved host behaviors", () => {
    const approved = InferencePurposeSchema.options.filter((purpose) => PURPOSE_RECOVERY_POLICIES[purpose].deterministic_behavior !== "none");
    expect(approved).toEqual([
      "interview_assist",
      "general_resume_draft",
      "resume_guidance",
      "resume_strategy",
      "resume_craft_evaluate",
    ]);
    for (const purpose of InferencePurposeSchema.options) {
      const blocks = conformanceBlocks(purpose);
      const fallback = purpose === "resume_guidance"
        ? deterministicGuidanceFallback(blocks)
        : deterministicHostFallback(purpose, blocks);
      if (PURPOSE_RECOVERY_POLICIES[purpose].deterministic_behavior === "none") {
        expect(fallback, purpose).toBeNull();
        continue;
      }
      expect(fallback, purpose).not.toBeNull();
      const parsed = parsePurposeResult(purpose, PURPOSE_OUTPUT_SCHEMAS[purpose], fallback);
      expect(validateInferenceClaims(purpose, parsed, blocks).accepted, purpose).toBe(true);
    }
  });

  it("presents only the immutable host-ranked interview opportunity with deterministic identity", () => {
    const purpose = "interview_assist" as const;
    const blocks = conformanceBlocks(purpose);
    const before = structuredClone(blocks);
    const first = deterministicHostFallback(purpose, blocks) as { questions: Array<Record<string, unknown>> };
    const permuted = deterministicHostFallback(purpose, [...blocks].reverse()) as typeof first;
    const summary = blocks.find((block) => block.category === "job_evidence_summary")!.data as Record<string, unknown>;

    expect(first).toEqual(permuted);
    expect(blocks).toEqual(before);
    expect(first.questions).toHaveLength(1);
    expect(first.questions[0]).toMatchObject({
      job_fact_revision_id: summary.active_job_fact_revision_id,
      opportunity_id: summary.requested_opportunity_id,
      dimension: summary.requested_dimension,
      opportunity_kind: summary.opportunity_kind,
      value_category: summary.value_category,
      selection_method: "deterministic_value",
    });
    expect(String(first.questions[0]?.prompt)).not.toMatch(/list every|all duties|complete checklist|old job description|must.*(?:number|metric)|exact (?:number|metric)/i);
    const parsed = parsePurposeResult(purpose, PURPOSE_OUTPUT_SCHEMAS[purpose], first);
    expect(validateInferenceClaims(purpose, parsed, blocks)).toMatchObject({ accepted: true, findings: [] });

    const broadened = structuredClone(first);
    broadened.questions[0]!.opportunity_id = crypto.randomUUID();
    expect(parsePurposeResult(purpose, PURPOSE_OUTPUT_SCHEMAS[purpose], broadened)).toBeDefined();
    expect(validateInferenceClaims(purpose, broadened, blocks)).toMatchObject({ accepted: false });
  });

  it("fails closed for missing, duplicate, malformed, unsupported, and ambiguous interview opportunity inputs", () => {
    const purpose = "interview_assist" as const;
    const blocks = conformanceBlocks(purpose);
    const summaryIndex = blocks.findIndex((block) => block.category === "job_evidence_summary");
    const summary = blocks[summaryIndex]!;
    const invalidOpportunity = { ...(summary.data as object), requested_opportunity_id: "unsupported" };
    const unsupportedJob = { ...(summary.data as object), active_job_fact_revision_id: crypto.randomUUID() };
    const cases = [
      blocks.filter((block) => block.category !== "job_evidence_summary"),
      [...blocks, structuredClone(summary)],
      blocks.map((block, index) => index === summaryIndex ? { ...block, schema_id: "resume.job-evidence-summary.v1" } : block),
      blocks.map((block, index) => index === summaryIndex ? { ...block, data: invalidOpportunity, content_digest: canonicalInputDigest(invalidOpportunity) } : block),
      blocks.map((block, index) => index === summaryIndex ? { ...block, data: unsupportedJob, content_digest: canonicalInputDigest(unsupportedJob) } : block),
    ];
    for (const candidate of cases) expect(deterministicHostFallback(purpose, candidate)).toBeNull();
  });

  it("supports a sparse active-job snapshot and fails closed when that authorized job is absent", () => {
    const purpose = "interview_assist" as const;
    const blocks = conformanceBlocks(purpose);
    const snapshotIndex = blocks.findIndex((block) => block.category === "confirmed_fact_snapshot");
    const summary = blocks.find((block) => block.category === "job_evidence_summary")!.data as { active_job_fact_revision_id: string };
    const originalFacts = (blocks[snapshotIndex]!.data as { facts: Array<{ revision_id: string }> }).facts;
    const activeJob = originalFacts.find((fact) => fact.revision_id === summary.active_job_fact_revision_id)!;
    const sparseData = { facts: [activeJob] };
    const sparse = blocks.map((block, index) => index === snapshotIndex
      ? { ...block, data: sparseData, content_digest: canonicalInputDigest(sparseData) }
      : block);
    const result = deterministicHostFallback(purpose, sparse);
    expect(result).not.toBeNull();
    expect(validateInferenceClaims(purpose, parsePurposeResult(purpose, PURPOSE_OUTPUT_SCHEMAS[purpose], result), sparse).accepted).toBe(true);

    for (const facts of [[], originalFacts.filter((fact) => fact.revision_id !== summary.active_job_fact_revision_id)]) {
      const data = { facts };
      const candidate = blocks.map((block, index) => index === snapshotIndex
        ? { ...block, data, content_digest: canonicalInputDigest(data) }
        : block);
      expect(deterministicHostFallback(purpose, candidate)).toBeNull();
    }
  });

  it("copies every ranked dimension and value classification across deterministic input permutations", () => {
    const purpose = "interview_assist" as const;
    const blocks = conformanceBlocks(purpose);
    const summaryIndex = blocks.findIndex((block) => block.category === "job_evidence_summary");
    const base = blocks[summaryIndex]!.data as Record<string, unknown>;
    const permutations = [
      ["responsibilities", "qualitative", "core_responsibility"],
      ["accomplishments", "qualitative", "distinct_accomplishment"],
      ["outcomes", "metric", "decision_useful_outcome"],
      ["tools", "qualitative", "tools_in_use"],
      ["scope", "metric", "scope_or_scale"],
      ["progression", "qualitative", "progression"],
    ] as const;
    const questionIds = new Set<string>();
    for (const [requested_dimension, opportunity_kind, value_category] of permutations) {
      const data = { ...base, requested_dimension, opportunity_kind, value_category };
      const candidate = blocks.map((block, index) => index === summaryIndex
        ? { ...block, data, content_digest: canonicalInputDigest(data) }
        : block);
      const before = structuredClone(candidate);
      const result = deterministicHostFallback(purpose, [...candidate].reverse()) as { questions: Array<Record<string, unknown>> };
      expect(result.questions[0]).toMatchObject({ dimension: requested_dimension, opportunity_kind, value_category });
      expect(validateInferenceClaims(purpose, parsePurposeResult(purpose, PURPOSE_OUTPUT_SCHEMAS[purpose], result), candidate).accepted).toBe(true);
      expect(candidate).toEqual(before);
      questionIds.add(String(result.questions[0]?.question_id));
    }
    expect(questionIds.size).toBe(permutations.length);
  });

  it("is deterministic for Unicode and long irrelevant inputs without mutating or incorporating them", () => {
    const purpose = "interview_assist" as const;
    const baseline = conformanceBlocks(purpose);
    const note = `مرحبا 👩🏽‍💻 e\u0301 ${"x".repeat(8_000)}`;
    const extra = {
      category: "presentation_preferences",
      content_digest: canonicalInputDigest({ note }),
      schema_id: "resume.presentation-preferences.v1",
      schema_version: 1 as const,
      data: { note },
    };
    const first = deterministicHostFallback(purpose, baseline);
    const second = deterministicHostFallback(purpose, [extra, ...baseline]);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).not.toContain("مرحبا");
    expect(JSON.stringify(second)).not.toContain("👩🏽‍💻");
  });

  it("keeps host normalization separate from deterministic fallback eligibility", () => {
    for (const purpose of ["tailoring_plan", "targeted_resume_draft", "resume_revision_draft"] as const) {
      const blocks = conformanceBlocks(purpose);
      expect(PURPOSE_RECOVERY_POLICIES[purpose].normalization).not.toBe("none");
      expect(PURPOSE_RECOVERY_POLICIES[purpose].deterministic_behavior).toBe("none");
      expect(deterministicHostFallback(purpose, blocks)).toBeNull();
      expect(normalizeHostOwnedResult(purpose, {}, blocks)).not.toBeNull();
    }
  });
});
