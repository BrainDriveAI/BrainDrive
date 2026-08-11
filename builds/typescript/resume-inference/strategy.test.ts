import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { ResumeStrategyOmissionReasonSchema } from "../app-platform/contracts/data.js";
import { ResumeStrategyResultSchema } from "./results.js";
import { buildEvidenceAnnotations, RESUME_QUALITY_POLICY_IDENTITY } from "./strategy.js";
import { validateInferenceClaims } from "./validators.js";

function block(category: "confirmed_fact_snapshot" | "evidence_annotations" | "quality_policy", schemaId: string, data: unknown) {
  return { category, content_digest: canonicalInputDigest(data), schema_id: schemaId, schema_version: 1 as const, data };
}

describe("inspectable resume strategy", () => {
  it("fails closed for an empty snapshot", () => {
    const facts = { facts: [] };
    const annotations = buildEvidenceAnnotations([], []);
    const strategy = ResumeStrategyResultSchema.parse({
      strategy_version: 1, history_shape: "early_career", history_reason_code: "thin_history", role_emphasis: [], section_order: ["experience"],
      evidence_priorities: [], summary_decision: "omit", summary_reason_code: "insufficient_distinct_value", skills_context: [], omissions: [], unresolved_gap_ids: [], owner_rationale: "No confirmed evidence is available.",
    });
    const report = validateInferenceClaims("resume_strategy", strategy, [
      block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", facts),
      block("evidence_annotations", "resume.evidence-annotations.v1", annotations),
      block("quality_policy", "resume.quality-policy-identity.v1", RESUME_QUALITY_POLICY_IDENTITY),
    ]);
    expect(report.accepted).toBe(false);
  });

  it.each([
    ["early_career", "thin_history", 1, "compact", "omit"],
    ["chronological_standard", "standard_chronology", 3, "compact", "include"],
    ["senior_selective", "senior_compression", 6, "compact", "include"],
    ["career_change", "career_transition", 3, "compact", "include"],
    ["return_to_work", "employment_gap", 2, "compact", "omit"],
    ["concurrent_roles", "overlap_or_promotion", 3, "compact", "include"],
  ] as const)("validates evidence-shaped %s persona planning without quotas", (historyShape, historyReason, roleCount, newestDensity, summaryDecision) => {
    const jobs = Array.from({ length: roleCount }, (_, index) => ({
      revision_id: randomUUID(), fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: index === 0 ? "Líder de Operaciones" : `Role ${index + 1}`, employer: `Organization ${index + 1}` }), source_revision_ids: [randomUUID()],
    }));
    const skill = { revision_id: randomUUID(), fact_kind: "skill", value: "Análisis de datos", source_revision_ids: [randomUUID()] };
    const facts = [...jobs, skill];
    const annotations = buildEvidenceAnnotations(facts, []);
    const strategy = ResumeStrategyResultSchema.parse({
      strategy_version: 1, history_shape: historyShape, history_reason_code: historyReason,
      role_emphasis: jobs.map((job, index) => ({ job_fact_revision_id: job.revision_id, priority: index === 0 ? "primary" : index > 2 ? "compressed" : "supporting", reason_code: index === 0 ? "recent" : index > 2 ? "older_context" : "continuity", bullet_density: index === 0 ? newestDensity : "compact" })),
      section_order: summaryDecision === "include" ? ["summary", "experience", "skills"] : ["experience", "skills"],
      evidence_priorities: annotations.facts.map((fact) => ({ fact_revision_id: fact.fact_revision_id, priority: fact.required_priority })),
      summary_decision: summaryDecision, summary_reason_code: summaryDecision === "include" ? "supported_positioning" : "insufficient_distinct_value",
      skills_context: [{ skill_fact_revision_id: skill.revision_id, placement: roleCount > 1 ? "role" : "skills_section", context_fact_revision_ids: roleCount > 1 ? [jobs[0]!.revision_id] : [] }], omissions: [], unresolved_gap_ids: [],
      owner_rationale: "Prioritize distinct supported work and keep older context concise.",
    });
    const report = validateInferenceClaims("resume_strategy", strategy, [
      block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts }),
      block("evidence_annotations", "resume.evidence-annotations.v1", annotations),
      block("quality_policy", "resume.quality-policy-identity.v1", RESUME_QUALITY_POLICY_IDENTITY),
    ]);
    expect(report.accepted).toBe(true);
    expect(JSON.stringify(strategy)).not.toMatch(/\b(?:score|quota|F[1-9][0-2]?)\b/i);
  });

  it("accepts only the bounded visible omission categories", () => {
    expect(ResumeStrategyOmissionReasonSchema.options).toEqual([
      "redundant", "low_relevance", "space", "older_context", "owner_direction", "structural_mismatch", "conflict",
    ]);
    expect(ResumeStrategyOmissionReasonSchema.safeParse("generic_reason").success).toBe(false);
  });

  it("rejects padded density and permits expanded guidance only for rich distinct role evidence", () => {
    const job = { revision_id: randomUUID(), fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "Operations Lead", employer: "Synthetic Cooperative" }), source_revision_ids: [randomUUID()] };
    const accomplishments = Array.from({ length: 4 }, (_, index) => ({ revision_id: randomUUID(), fact_kind: "accomplishment", value: JSON.stringify({ format: "resume_accomplishment_v1", job_fact_revision_id: job.revision_id, text: `Distinct outcome ${index + 1}` }), source_revision_ids: [randomUUID()] }));
    const facts = [job, ...accomplishments];
    const annotations = buildEvidenceAnnotations(facts, []);
    const value = {
      strategy_version: 1 as const, history_shape: "chronological_standard" as const, history_reason_code: "standard_chronology" as const,
      role_emphasis: [{ job_fact_revision_id: job.revision_id, priority: "primary" as const, reason_code: "evidence_rich" as const, bullet_density: "expanded" as const }],
      section_order: ["experience"], evidence_priorities: annotations.facts.map((fact) => ({ fact_revision_id: fact.fact_revision_id, priority: fact.required_priority })),
      summary_decision: "omit" as const, summary_reason_code: "insufficient_distinct_value" as const, skills_context: [], omissions: [], unresolved_gap_ids: [], owner_rationale: "Use distinct outcomes without padding.",
    };
    const blocks = [block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts }), block("evidence_annotations", "resume.evidence-annotations.v1", annotations)];
    expect(validateInferenceClaims("resume_strategy", value, blocks).accepted).toBe(true);
    const sparseAnnotations = buildEvidenceAnnotations([job], []);
    expect(validateInferenceClaims("resume_strategy", { ...value, evidence_priorities: [{ fact_revision_id: job.revision_id, priority: "must_use" }] }, [
      block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts: [job] }), block("evidence_annotations", "resume.evidence-annotations.v1", sparseAnnotations),
    ]).accepted).toBe(false);
  });
});
