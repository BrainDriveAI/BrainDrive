import { z } from "zod";

import { canonicalInputDigest, OpaqueIdSchema } from "../app-platform/contracts/common.js";
import { JobEvidenceDimensionSchema } from "../app-platform/contracts/data.js";

export const JobEvidenceSummarySchema = z.object({
  active_job_fact_revision_id: OpaqueIdSchema,
  active_job_revision: z.number().int().positive(),
  requested_opportunity_id: OpaqueIdSchema,
  requested_dimension: JobEvidenceDimensionSchema.exclude(["identity"]),
  opportunity_kind: z.enum(["qualitative", "metric"]),
  value_category: z.enum(["distinct_accomplishment", "decision_useful_outcome", "scope_or_scale", "tools_in_use", "progression", "core_responsibility"]),
  dimensions: z.array(z.object({
    dimension: JobEvidenceDimensionSchema,
    outcome: z.enum(["unanswered", "answered", "skipped", "unknown", "not_applicable", "deferred", "conflicting"]),
    evidence_revision_ids: z.array(OpaqueIdSchema).max(32),
  }).strict()).max(7),
}).strict();

type DataBlock = { category: string; schema_id?: string; schema_version?: number; content_digest?: string; data: unknown };

const INTERVIEW_PROMPTS = {
  responsibilities: "What responsibility best represents the work you handled in this role?",
  accomplishments: "What is one accomplishment from this role that you would want an employer to notice?",
  outcomes: "What became better or easier because of your work in this role?",
  tools: "Which tool or system did you use for this work, and what did you use it for?",
  scope: "What scope or scale best describes this work?",
  progression: "How did your responsibility change or grow in this role?",
} as const;

/**
 * Presents the exact opportunity selected by the host. It never ranks, chooses,
 * or derives another opportunity from facts or free-form owner content.
 */
export function deterministicInterviewPresentation(blocks: readonly DataBlock[]): unknown | null {
  const summaries = blocks.filter((block) => block.category === "job_evidence_summary");
  const snapshots = blocks.filter((block) => block.category === "confirmed_fact_snapshot");
  if (summaries.length !== 1 || snapshots.length !== 1) return null;
  const summaryBlock = summaries[0]!;
  const snapshotBlock = snapshots[0]!;
  if (
    summaryBlock.schema_id !== "resume.job-evidence-summary.v2"
    || summaryBlock.schema_version !== 1
    || summaryBlock.content_digest !== canonicalInputDigest(summaryBlock.data)
    || snapshotBlock.content_digest !== canonicalInputDigest(snapshotBlock.data)
  ) return null;
  const parsed = JobEvidenceSummarySchema.safeParse(summaryBlock.data);
  if (!parsed.success) return null;
  const summary = parsed.data;
  const facts = (snapshotBlock.data as { facts?: unknown } | null)?.facts;
  if (!Array.isArray(facts) || !facts.some((fact) => {
    const value = fact !== null && typeof fact === "object" ? fact as Record<string, unknown> : null;
    return value?.revision_id === summary.active_job_fact_revision_id && value.fact_kind === "employment";
  })) return null;

  const answerBoundary = summary.opportunity_kind === "metric"
    ? "You may answer with a range, frequency, scale description, qualitative effect, I don't know, or skip."
    : "A qualitative answer is enough, and you may skip this question.";
  return {
    questions: [{
      question_id: deterministicQuestionId(summary),
      job_fact_revision_id: summary.active_job_fact_revision_id,
      opportunity_id: summary.requested_opportunity_id,
      dimension: summary.requested_dimension,
      opportunity_kind: summary.opportunity_kind,
      value_category: summary.value_category,
      selection_method: "deterministic_value",
      prompt: `${INTERVIEW_PROMPTS[summary.requested_dimension]} ${answerBoundary}`,
      rationale: "Present the host-ranked evidence opportunity without changing its identity or scope.",
    }],
  };
}

function deterministicQuestionId(summary: z.infer<typeof JobEvidenceSummarySchema>): string {
  const hex = canonicalInputDigest({
    presentation_policy: "resume.interview-host-presentation.v1",
    active_job_fact_revision_id: summary.active_job_fact_revision_id,
    requested_opportunity_id: summary.requested_opportunity_id,
    requested_dimension: summary.requested_dimension,
    opportunity_kind: summary.opportunity_kind,
    value_category: summary.value_category,
  }).slice("sha256:".length);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
