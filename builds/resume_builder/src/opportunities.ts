import { createHash } from "node:crypto";

export const EVIDENCE_DIMENSIONS = [
  "responsibilities",
  "accomplishments",
  "outcomes",
  "tools",
  "scope",
  "progression",
] as const;

export type EvidenceDimension = typeof EVIDENCE_DIMENSIONS[number];
export type EvidenceCoverageState = "unanswered" | "answered" | "unknown" | "not_applicable" | "skipped" | "deferred" | "conflicting";
export type EvidenceCoverageDimension = {
  state: EvidenceCoverageState;
  evidence_revision_ids: string[];
  recorded_at: string | null;
};
export type EvidenceCoverageDimensions = Record<EvidenceDimension, EvidenceCoverageDimension>;
export type EvidenceOpportunityKind = "qualitative" | "metric";
export type EvidenceValueCategory = "distinct_accomplishment" | "decision_useful_outcome" | "scope_or_scale" | "tools_in_use" | "progression" | "core_responsibility";
export type EvidenceOpportunity = {
  opportunity_id: string;
  dimension: EvidenceDimension;
  opportunity_kind: EvidenceOpportunityKind;
  value_category: EvidenceValueCategory;
  context_digest: `sha256:${string}`;
  state: "available" | "suppressed" | "resolved";
  suppression_reason: "owner_declined" | "already_known" | "duplicate" | "low_value" | null;
  attempt_count: number;
  reopened_at: string | null;
};
export type RankedEvidenceOpportunity = EvidenceOpportunity & {
  selection_method: "deterministic_value";
  rationale: "add_distinct_evidence" | "clarify_outcome" | "show_scope" | "connect_tool_use" | "show_progression" | "clarify_core_work" | "add_optional_specificity";
};

export const OPPORTUNITY_DIMENSION_PRIORITY: readonly EvidenceDimension[] = [
  "accomplishments", "outcomes", "scope", "tools", "progression", "responsibilities",
];

const VALUE_CATEGORY: Record<EvidenceDimension, EvidenceValueCategory> = {
  accomplishments: "distinct_accomplishment",
  outcomes: "decision_useful_outcome",
  scope: "scope_or_scale",
  tools: "tools_in_use",
  progression: "progression",
  responsibilities: "core_responsibility",
};

const RATIONALE: Record<EvidenceDimension, RankedEvidenceOpportunity["rationale"]> = {
  accomplishments: "add_distinct_evidence",
  outcomes: "clarify_outcome",
  scope: "show_scope",
  tools: "connect_tool_use",
  progression: "show_progression",
  responsibilities: "clarify_core_work",
};

const METRIC_DIMENSIONS = new Set<EvidenceDimension>(["accomplishments", "outcomes", "scope"]);

function deterministicUuid(input: string): string {
  const hex = createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4]!;
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function evidenceOpportunityId(
  jobRevisionId: string,
  dimension: EvidenceDimension,
  kind: EvidenceOpportunityKind,
  category: EvidenceValueCategory,
  contextDigest: string,
): string {
  return deterministicUuid(`resume-evidence-opportunity-v1|${jobRevisionId}|${dimension}|${kind}|${category}|${contextDigest}`);
}

export function rankEvidenceOpportunities(input: {
  jobRevisionId: string;
  dimensions: EvidenceCoverageDimensions;
  contextDigests: Partial<Record<EvidenceDimension, `sha256:${string}`>>;
  storedOpportunities: readonly EvidenceOpportunity[];
}): RankedEvidenceOpportunity[] {
  const stored = new Map(input.storedOpportunities.map((opportunity) => [opportunity.opportunity_id, opportunity]));
  const candidates: RankedEvidenceOpportunity[] = [];
  for (const dimension of OPPORTUNITY_DIMENSION_PRIORITY) {
    const coverage = input.dimensions[dimension];
    const contextDigest = input.contextDigests[dimension];
    if (!coverage || !contextDigest) continue;
    const explicitlyReopened = input.storedOpportunities.filter((opportunity) =>
      opportunity.dimension === dimension && opportunity.context_digest === contextDigest && opportunity.state === "available" && opportunity.reopened_at !== null
    );
    for (const opportunity of explicitlyReopened) {
      candidates.push({
        ...opportunity,
        selection_method: "deterministic_value",
        rationale: opportunity.opportunity_kind === "metric" ? "add_optional_specificity" : RATIONALE[dimension],
      });
    }
    const kinds: EvidenceOpportunityKind[] = coverage.state === "unanswered"
      ? ["qualitative"]
      : coverage.state === "answered" && METRIC_DIMENSIONS.has(dimension)
        ? ["metric"]
        : [];
    for (const opportunityKind of kinds) {
      const valueCategory = VALUE_CATEGORY[dimension];
      const opportunityId = evidenceOpportunityId(input.jobRevisionId, dimension, opportunityKind, valueCategory, contextDigest);
      if (candidates.some((candidate) => candidate.opportunity_id === opportunityId)) continue;
      const prior = stored.get(opportunityId);
      const equivalentClosed = input.storedOpportunities.some((opportunity) =>
        opportunity.dimension === dimension && opportunity.opportunity_kind === opportunityKind &&
        opportunity.context_digest === contextDigest && opportunity.state !== "available"
      );
      if ((prior && prior.state !== "available") || equivalentClosed) continue;
      candidates.push({
        opportunity_id: opportunityId,
        dimension,
        opportunity_kind: opportunityKind,
        value_category: valueCategory,
        context_digest: contextDigest,
        state: "available",
        suppression_reason: null,
        attempt_count: prior?.attempt_count ?? 0,
        reopened_at: prior?.reopened_at ?? null,
        selection_method: "deterministic_value",
        rationale: opportunityKind === "metric" ? "add_optional_specificity" : RATIONALE[dimension],
      });
    }
  }
  return candidates.sort((left, right) => {
    const leftKind = left.opportunity_kind === "metric" ? 1 : 0;
    const rightKind = right.opportunity_kind === "metric" ? 1 : 0;
    if (leftKind !== rightKind) return leftKind - rightKind;
    const priority = OPPORTUNITY_DIMENSION_PRIORITY.indexOf(left.dimension) - OPPORTUNITY_DIMENSION_PRIORITY.indexOf(right.dimension);
    return priority || left.opportunity_id.localeCompare(right.opportunity_id);
  });
}

export function coverageProgress(dimensions: EvidenceCoverageDimensions): {
  answered: number;
  intentionally_unresolved: number;
  conflicting: number;
  remaining: number;
  total: number;
} {
  const values = EVIDENCE_DIMENSIONS.map((dimension) => dimensions[dimension].state);
  return {
    answered: values.filter((state) => state === "answered").length,
    intentionally_unresolved: values.filter((state) => ["unknown", "not_applicable", "skipped", "deferred"].includes(state)).length,
    conflicting: values.filter((state) => state === "conflicting").length,
    remaining: values.filter((state) => state === "unanswered").length,
    total: EVIDENCE_DIMENSIONS.length,
  };
}
