import { z } from "zod";

import { canonicalInputDigest, OpaqueIdSchema, Sha256DigestSchema } from "../app-platform/contracts/common.js";
import { JobEvidenceValueSchema } from "../app-platform/contracts/data.js";
import {
  canonicalizeCoverage,
  canonicalizeEvidenceAnnotations,
  canonicalizeFacts,
} from "./canonical-strategy.js";

export {
  CANONICAL_RESUME_SECTION_PRECEDENCE,
  canonicalSectionOrder,
  canonicalizeCoverage,
  canonicalizeEvidenceAnnotations,
  canonicalizeFacts,
  canonicalizeOpaqueIds,
  canonicalizeSectionOrder,
  canonicalizeStrategyResult,
  sectionForFact,
} from "./canonical-strategy.js";

export const RESUME_QUALITY_STANDARD_ID = "braindrive.resume-quality" as const;
export const RESUME_QUALITY_STANDARD_VERSION = "3" as const;
export const RESUME_QUALITY_STANDARD_DIGEST = "sha256:bf644a25e4587c43acc84a521ae6955b0c950ff8dbd17bafb34cb52b2c65f498" as const;

export const ResumeQualityPolicyIdentitySchema = z.object({
  quality_policy_version: z.literal(1),
  quality_standard_id: z.literal(RESUME_QUALITY_STANDARD_ID),
  quality_standard_version: z.literal(RESUME_QUALITY_STANDARD_VERSION),
  quality_standard_digest: z.literal(RESUME_QUALITY_STANDARD_DIGEST),
}).strict();

export const RESUME_QUALITY_POLICY_IDENTITY = ResumeQualityPolicyIdentitySchema.parse({
  quality_policy_version: 1,
  quality_standard_id: RESUME_QUALITY_STANDARD_ID,
  quality_standard_version: RESUME_QUALITY_STANDARD_VERSION,
  quality_standard_digest: RESUME_QUALITY_STANDARD_DIGEST,
});

export const ResumeEvidenceAnnotationsSchema = z.object({
  annotation_version: z.literal(1),
  facts: z.array(z.object({
    fact_revision_id: OpaqueIdSchema,
    evidence_class: z.enum(["role_identity", "accomplishment", "answered_job_evidence", "contact", "education", "credential", "project", "skill", "presentation_preference", "other"]),
    job_fact_revision_id: OpaqueIdSchema.nullable(),
    required_priority: z.enum(["must_use", "preferred", "context"]),
  }).strict()).max(500),
  coverage_digest: Sha256DigestSchema,
  unresolved_gap_ids: z.array(OpaqueIdSchema).max(100),
}).strict();

type SnapshotFact = { revision_id: string; fact_kind: string; value: string };
type Coverage = {
  metadata?: { revision_id?: string };
  job_fact_revision_id?: string;
  dimensions?: Record<string, { state?: string }>;
  opportunities?: Array<{ opportunity_id?: string; state?: string }>;
};

export function buildEvidenceAnnotations(facts: SnapshotFact[], coverage: Coverage[]) {
  const canonicalFacts = canonicalizeFacts(facts);
  const canonicalCoverage = canonicalizeCoverage(coverage);
  const annotations = canonicalFacts.map((fact) => {
    let evidenceClass: z.infer<typeof ResumeEvidenceAnnotationsSchema>["facts"][number]["evidence_class"] = "other";
    let jobFactRevisionId: string | null = null;
    let requiredPriority: "must_use" | "preferred" | "context" = "must_use";
    if (fact.fact_kind === "employment") {
      evidenceClass = "role_identity";
      jobFactRevisionId = fact.revision_id;
    } else if (fact.fact_kind === "accomplishment") {
      evidenceClass = "accomplishment";
      try { jobFactRevisionId = (JSON.parse(fact.value) as { job_fact_revision_id?: string }).job_fact_revision_id ?? null; } catch { /* unstructured legacy accomplishment */ }
    } else if (fact.fact_kind === "job_evidence") {
      const parsed = JobEvidenceValueSchema.safeParse(parseJson(fact.value));
      evidenceClass = "answered_job_evidence";
      jobFactRevisionId = parsed.success ? parsed.data.job_fact_revision_id : null;
    } else if (fact.fact_kind === "contact") evidenceClass = "contact";
    else if (fact.fact_kind === "education") evidenceClass = "education";
    else if (fact.fact_kind === "credential") evidenceClass = "credential";
    else if (fact.fact_kind === "project") evidenceClass = "project";
    else if (fact.fact_kind === "skill") { evidenceClass = "skill"; requiredPriority = "preferred"; }
    else if (fact.fact_kind === "preference") { evidenceClass = "presentation_preference"; requiredPriority = "context"; }
    return { fact_revision_id: fact.revision_id, evidence_class: evidenceClass, job_fact_revision_id: jobFactRevisionId, required_priority: requiredPriority };
  });
  const unresolvedGapIds = canonicalCoverage.flatMap((record) => (record.opportunities ?? [])
    .filter((opportunity) => opportunity.state === "available" && typeof opportunity.opportunity_id === "string")
    .map((opportunity) => opportunity.opportunity_id!));
  return ResumeEvidenceAnnotationsSchema.parse(canonicalizeEvidenceAnnotations({
    annotation_version: 1,
    facts: annotations,
    coverage_digest: canonicalInputDigest(canonicalCoverage.map((record) => ({ revision_id: record.metadata?.revision_id, job_fact_revision_id: record.job_fact_revision_id, dimensions: record.dimensions, opportunities: record.opportunities }))),
    unresolved_gap_ids: [...new Set(unresolvedGapIds)].sort(),
  }));
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}
