import type { ResumeQualityStateSchema } from "../app-platform/contracts/data.js";
import { CRAFT_EVIDENCE_LIMITED_POLICY, type CraftCriterion, type CraftEvaluationResult } from "../resume-inference/craft-evaluator.js";
import type { z } from "zod";

export type ResumeQualityState = z.infer<typeof ResumeQualityStateSchema>;

export type ResumeOwnerAction =
  | "run_review"
  | "bounded_repair"
  | "add_evidence"
  | "manual_revision"
  | "approve_definition"
  | "keep_prior_approved"
  | "continue"
  | "exit";

export type ResumeOwnerReviewProjection = {
  quality_state: ResumeQualityState;
  status_label: string;
  status_description: string;
  actions: ResumeOwnerAction[];
};

type CorrectionActionTag = { action: "repair_statement" | "add_evidence" | "manual_revision" | "keep_prior_or_exit" } | null;

const QUALITY_STATE_COPY: Record<ResumeQualityState, { label: string; description: string }> = {
  review_not_run: {
    label: "Review not run",
    description: "This version has not completed the product craft review.",
  },
  review_incomplete: {
    label: "Product craft review incomplete",
    description: "The product craft review could not reach a current evidence-backed decision. Your saved work is unchanged.",
  },
  needs_correction: {
    label: "Needs correction",
    description: "At least one required product craft criterion did not pass for this exact version.",
  },
  evidence_limited: {
    label: "More evidence could strengthen this resume",
    description: "The resume remains truthful, but the confirmed evidence does not support ordinary product craft passage.",
  },
  product_craft_passed: {
    label: "Product craft review passed",
    description: "Every applicable product craft criterion passed for this exact version. This is not owner approval or release-quality evidence.",
  },
  owner_approved: {
    label: "Owner approved",
    description: "The owner approved this exact immutable version after its product craft review passed.",
  },
  pre_correction_review: {
    label: "Previously approved — corrected review not run",
    description: "This approved historical version remains available, but it was not reviewed under the corrected product craft contract.",
  },
};

export function resumeQualityStateLabel(state: ResumeQualityState): string {
  return QUALITY_STATE_COPY[state].label;
}

/** Domain-owned owner copy and controls. Product surfaces render this projection without re-adjudicating report verdicts. */
export function projectResumeOwnerReview(state: ResumeQualityState, correctionAction: CorrectionActionTag): ResumeOwnerReviewProjection {
  const common = QUALITY_STATE_COPY[state];
  let actions: ResumeOwnerAction[];
  if (state === "owner_approved") actions = ["continue", "exit"];
  else if (state === "pre_correction_review") actions = ["manual_revision", "keep_prior_approved", "exit"];
  else if (state === "product_craft_passed") actions = ["approve_definition", "manual_revision", "keep_prior_approved", "exit"];
  else if (state === "review_not_run" || state === "review_incomplete") actions = ["run_review", "manual_revision", "keep_prior_approved", "exit"];
  else {
    const primary: ResumeOwnerAction[] = correctionAction?.action === "repair_statement" ? ["bounded_repair"]
      : correctionAction?.action === "add_evidence" ? ["add_evidence"]
        : correctionAction?.action === "manual_revision" ? ["manual_revision"]
          : [];
    if (state === "evidence_limited" && primary.length === 0) primary.push("add_evidence");
    actions = [...primary, ...(primary.includes("manual_revision") ? [] : ["manual_revision" as const]), "keep_prior_approved", "exit"];
    if (correctionAction?.action === "keep_prior_or_exit") actions = ["keep_prior_approved", "exit"];
  }
  return { quality_state: state, status_label: common.label, status_description: common.description, actions };
}

export type ResumeQualityAdjudicationInput = {
  definition_status: "draft" | "proposed" | "approved" | "superseded" | "retired";
  approval_contract_version: 1 | 2 | null;
  deterministic_truth_passed: boolean;
  deterministic_structure_passed: boolean;
  deterministic_mechanical_passed: boolean;
  review_disposition: "not_run" | "available" | "unavailable" | "malformed" | "incompatible" | "disputed";
  bindings_current: boolean;
  report: CraftEvaluationResult | null;
  evidence_limited_policy: {
    policy_id: string;
    policy_version: string;
    authority_status: string;
    ordinary_product_craft_passage_allowed?: boolean;
    owner_approval_allowed?: boolean;
    release_ready_allowed?: boolean;
  } | null;
};

const CRITERIA: CraftCriterion[] = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "T1", "T2", "T3"];

/** Pure projection of immutable gate evidence into the one domain quality state. */
export function adjudicateResumeQualityState(input: ResumeQualityAdjudicationInput): ResumeQualityState {
  if (input.definition_status === "approved" && input.approval_contract_version === 1) return "pre_correction_review";
  if (!input.deterministic_truth_passed || !input.deterministic_structure_passed || !input.deterministic_mechanical_passed) return "needs_correction";
  if (input.review_disposition === "not_run") return "review_not_run";
  if (input.review_disposition !== "available" || !input.bindings_current || !completeReport(input.report)) return "review_incomplete";
  if (input.report!.evidence_context === "limited") return acceptedEvidenceLimitedPolicy(input.evidence_limited_policy) ? "evidence_limited" : "review_incomplete";
  if (input.report!.verdict === "fail" || input.report!.criterion_verdicts.some((entry) => entry.verdict === "fail")) return "needs_correction";
  if (input.definition_status === "approved" && input.approval_contract_version === 2) return "owner_approved";
  return "product_craft_passed";
}

function acceptedEvidenceLimitedPolicy(policy: ResumeQualityAdjudicationInput["evidence_limited_policy"]): boolean {
  return policy?.policy_id === CRAFT_EVIDENCE_LIMITED_POLICY.policy_id &&
    policy.policy_version === CRAFT_EVIDENCE_LIMITED_POLICY.policy_version &&
    policy.authority_status === CRAFT_EVIDENCE_LIMITED_POLICY.authority_status &&
    policy.ordinary_product_craft_passage_allowed === false &&
    policy.owner_approval_allowed === false &&
    policy.release_ready_allowed === false;
}

function completeReport(report: CraftEvaluationResult | null): report is CraftEvaluationResult {
  if (!report || report.report_version !== 2) return false;
  const criteria = report.criterion_verdicts.map((entry) => entry.criterion);
  if (criteria.length !== CRITERIA.length || new Set(criteria).size !== CRITERIA.length || CRITERIA.some((criterion) => !criteria.includes(criterion))) return false;
  if (report.criterion_verdicts.some((entry) => entry.evidence_refs.length === 0)) return false;
  const reportFails = report.criterion_verdicts.some((entry) => entry.verdict === "fail") || report.findings.some((finding) => finding.severity === "blocking");
  return (report.verdict === "fail") === reportFails;
}
