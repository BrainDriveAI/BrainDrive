import { canonicalInputDigest } from "../app-platform/contracts/common.js";

export const TARGET_FIT_THRESHOLD_POLICY = {
  policy_id: "braindrive.resume-builder.target-fit.provisional-rb7-oq3",
  policy_version: "1",
  authority_status: "provisional_planning_default",
  supported_core_minimum: 1,
  supported_transferable_minimum: 2,
  material_change_minimum: 1,
  score_free: true,
} as const;

export const TARGET_FIT_THRESHOLD_POLICY_DIGEST = canonicalInputDigest(TARGET_FIT_THRESHOLD_POLICY);

export type EvidenceRow = {
  requirement_id: string;
  requirement_kind: "required" | "preferred" | "responsibility" | "skill" | "credential" | "constraint" | "inferred";
  evidence_status: "supported" | "partially_supported" | "unsupported" | "ambiguous" | "clarification_needed";
  supporting_confirmed_fact_revision_ids: string[];
};

export type PlannedChange = {
  change_id: string;
  requirement_id: string;
  statement_id: string | null;
  action: "selection" | "ordering" | "emphasis" | "faithful_wording" | "shorten";
  supporting_confirmed_fact_revision_ids: string[];
};

export type TargetFitDecision = {
  fit_class: "meaningfully_supported" | "partially_supported_transferable" | "lacking_supported_core_fit";
  support_counts: { core: number; transferable: number; partial: number; unsupported: number };
  material_changes: PlannedChange[];
  outcome: "targeted_variant" | "no_meaningful_change";
  no_change_reason: "ambiguous_evidence" | "insufficient_supported_fit" | "no_material_resume_change" | null;
  owner_next_actions: Array<"use_general_resume" | "answer_optional_evidence_questions" | "try_different_target">;
};

const CORE_KINDS = new Set<EvidenceRow["requirement_kind"]>(["required", "responsibility", "credential", "constraint"]);
const TRANSFERABLE_KINDS = new Set<EvidenceRow["requirement_kind"]>(["preferred", "skill"]);
const MATERIAL_ACTIONS = new Set<PlannedChange["action"]>(["selection", "ordering", "emphasis"]);

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return canonicalInputDigest([...new Set(left)].sort()) === canonicalInputDigest([...new Set(right)].sort());
}

export function decideTargetFit(evidence: readonly EvidenceRow[], proposedChanges: readonly PlannedChange[]): TargetFitDecision {
  const supportedCore = evidence.filter((row) => row.evidence_status === "supported" && CORE_KINDS.has(row.requirement_kind));
  const supportedTransferable = evidence.filter((row) => row.evidence_status === "supported" && TRANSFERABLE_KINDS.has(row.requirement_kind));
  const partial = evidence.filter((row) => row.evidence_status === "partially_supported");
  const unsupported = evidence.filter((row) => ["unsupported", "ambiguous", "clarification_needed"].includes(row.evidence_status));
  const ambiguous = evidence.some((row) => ["ambiguous", "clarification_needed"].includes(row.evidence_status));
  const eligibleChanges = proposedChanges.filter((change) => {
    const row = evidence.find((candidate) => candidate.requirement_id === change.requirement_id);
    return Boolean(
      row && row.evidence_status === "supported" && change.statement_id && MATERIAL_ACTIONS.has(change.action)
      && change.supporting_confirmed_fact_revision_ids.length > 0
      && sameIds(change.supporting_confirmed_fact_revision_ids, row.supporting_confirmed_fact_revision_ids),
    );
  }).map((change) => ({
    change_id: change.change_id,
    requirement_id: change.requirement_id,
    statement_id: change.statement_id,
    action: change.action,
    supporting_confirmed_fact_revision_ids: change.supporting_confirmed_fact_revision_ids,
  }));
  const fitClass = supportedCore.length >= TARGET_FIT_THRESHOLD_POLICY.supported_core_minimum
    ? "meaningfully_supported" as const
    : supportedTransferable.length >= TARGET_FIT_THRESHOLD_POLICY.supported_transferable_minimum
      ? "partially_supported_transferable" as const
      : "lacking_supported_core_fit" as const;
  const fitPasses = fitClass !== "lacking_supported_core_fit";
  const materialPasses = eligibleChanges.length >= TARGET_FIT_THRESHOLD_POLICY.material_change_minimum;
  const outcome = !ambiguous && fitPasses && materialPasses ? "targeted_variant" as const : "no_meaningful_change" as const;
  const noChangeReason = outcome === "targeted_variant"
    ? null
    : ambiguous
      ? "ambiguous_evidence" as const
      : !fitPasses
        ? "insufficient_supported_fit" as const
        : "no_material_resume_change" as const;
  return {
    fit_class: fitClass,
    support_counts: {
      core: supportedCore.length,
      transferable: supportedTransferable.length,
      partial: partial.length,
      unsupported: unsupported.length,
    },
    material_changes: outcome === "targeted_variant" ? eligibleChanges : [],
    outcome,
    no_change_reason: noChangeReason,
    owner_next_actions: outcome === "targeted_variant"
      ? []
      : [
          "use_general_resume",
          ...(ambiguous || partial.length > 0 ? ["answer_optional_evidence_questions" as const] : []),
          "try_different_target",
        ],
  };
}
