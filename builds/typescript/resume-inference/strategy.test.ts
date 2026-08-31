import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { ResumeStrategyOmissionReasonSchema } from "../app-platform/contracts/data.js";
import { ResumeStrategyResultSchema } from "./results.js";
import {
  buildEvidenceAnnotations,
  canonicalizeCoverage,
  canonicalizeEvidenceAnnotations,
  canonicalizeFacts,
  canonicalizeStrategyResult,
  canonicalizeStrategyResultFromBlocks,
  RESUME_QUALITY_POLICY_IDENTITY,
} from "./strategy.js";
import { validateInferenceClaims } from "./validators.js";

function block(category: "confirmed_fact_snapshot" | "evidence_annotations" | "quality_policy", schemaId: string, data: unknown) {
  return { category, content_digest: canonicalInputDigest(data), schema_id: schemaId, schema_version: 1 as const, data };
}

function permutations<T>(values: T[]): T[][] {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) => permutations(values.filter((_, candidate) => candidate !== index)).map((rest) => [value, ...rest]));
}

describe("inspectable resume strategy", () => {
  it("canonicalizes every fact and coverage permutation without changing semantic values", () => {
    const currentJobId = "11000000-0000-4000-8000-000000000001";
    const priorJobId = "11000000-0000-4000-8000-000000000002";
    const facts = [
      { revision_id: priorJobId, fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "Associate", employer: "Synthetic Retail", start_date: "2018", end_date: "2021" }), source_revision_ids: ["11000000-0000-4000-8000-000000000011"] },
      { revision_id: "11000000-0000-4000-8000-000000000003", fact_kind: "accomplishment", value: JSON.stringify({ format: "resume_accomplishment_v1", job_fact_revision_id: currentJobId, text: "Improved a supported workflow." }), source_revision_ids: ["11000000-0000-4000-8000-000000000013", "11000000-0000-4000-8000-000000000012"] },
      { revision_id: currentJobId, fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "Specialist", employer: "Synthetic Support", start_date: "2022", end_date: "Present" }), source_revision_ids: ["11000000-0000-4000-8000-000000000014"] },
      { revision_id: "11000000-0000-4000-8000-000000000004", fact_kind: "skill", value: "Synthetic tooling", source_revision_ids: [] },
    ];
    const coverage = [
      { metadata: { revision_id: "11000000-0000-4000-8000-000000000021" }, job_fact_revision_id: priorJobId, dimensions: {}, opportunities: [{ opportunity_id: "11000000-0000-4000-8000-000000000031", state: "available" }] },
      { metadata: { revision_id: "11000000-0000-4000-8000-000000000020" }, job_fact_revision_id: currentJobId, dimensions: {}, opportunities: [{ opportunity_id: "11000000-0000-4000-8000-000000000030", state: "available" }] },
    ];
    const expectedFacts = canonicalizeFacts(facts);
    const expectedCoverage = canonicalizeCoverage(coverage);
    const expectedAnnotations = buildEvidenceAnnotations(facts, coverage);
    for (const factOrder of permutations(facts)) {
      expect(canonicalizeFacts(factOrder)).toEqual(expectedFacts);
      for (const coverageOrder of permutations(coverage)) {
        expect(canonicalizeCoverage(coverageOrder)).toEqual(expectedCoverage);
        expect(buildEvidenceAnnotations(factOrder, coverageOrder)).toEqual(expectedAnnotations);
      }
    }
    expect(expectedFacts.map((fact) => fact.revision_id)).toEqual([
      currentJobId,
      "11000000-0000-4000-8000-000000000003",
      priorJobId,
      "11000000-0000-4000-8000-000000000004",
    ]);
    expect(canonicalizeFacts(expectedFacts)).toEqual(expectedFacts);
    expect(canonicalizeCoverage(expectedCoverage)).toEqual(expectedCoverage);
  });

  it("deduplicates equivalent identities and rejects conflicting fact, coverage, annotation, and strategy identities", () => {
    const job = { revision_id: "12000000-0000-4000-8000-000000000001", fact_kind: "employment", value: "Supported role", source_revision_ids: ["12000000-0000-4000-8000-000000000002"] };
    expect(canonicalizeFacts([job, { ...job, source_revision_ids: [...job.source_revision_ids].reverse() }])).toEqual([job]);
    expect(() => canonicalizeFacts([job, { ...job, value: "Conflicting role" }])).toThrow(/conflicting fact identity/i);

    const coverage = { metadata: { revision_id: "12000000-0000-4000-8000-000000000003" }, job_fact_revision_id: job.revision_id, dimensions: {}, opportunities: [] };
    expect(canonicalizeCoverage([coverage, { ...coverage }])).toEqual([coverage]);
    expect(() => canonicalizeCoverage([coverage, { ...coverage, job_fact_revision_id: "12000000-0000-4000-8000-000000000004" }])).toThrow(/conflicting coverage identity/i);

    const annotations = buildEvidenceAnnotations([job], []);
    expect(canonicalizeEvidenceAnnotations({ ...annotations, facts: [annotations.facts[0]!, annotations.facts[0]!] })).toEqual(annotations);
    expect(() => canonicalizeEvidenceAnnotations({ ...annotations, facts: [annotations.facts[0]!, { ...annotations.facts[0]!, required_priority: "context" }] })).toThrow(/conflicting evidence annotation identity/i);
    const base = {
      strategy_version: 1 as const,
      history_shape: "early_career" as const,
      history_reason_code: "thin_history" as const,
      role_emphasis: [
        { job_fact_revision_id: job.revision_id, priority: "primary" as const, reason_code: "recent" as const, bullet_density: "compact" as const },
        { job_fact_revision_id: job.revision_id, priority: "primary" as const, reason_code: "recent" as const, bullet_density: "compact" as const },
      ],
      section_order: ["experience", "experience"],
      evidence_priorities: [
        { fact_revision_id: job.revision_id, priority: "must_use" as const },
        { fact_revision_id: job.revision_id, priority: "must_use" as const },
      ],
      summary_decision: "omit" as const,
      summary_reason_code: "insufficient_distinct_value" as const,
      skills_context: [],
      omissions: [],
      unresolved_gap_ids: [],
      owner_rationale: "Use supported evidence.",
    };
    expect(canonicalizeStrategyResult(base, [job], annotations)).toMatchObject({ role_emphasis: [base.role_emphasis[0]], evidence_priorities: [base.evidence_priorities[0]], section_order: ["experience"] });
    expect(() => canonicalizeStrategyResult({ ...base, role_emphasis: [base.role_emphasis[0]!, { ...base.role_emphasis[0]!, priority: "supporting" as const }] }, [job], annotations)).toThrow(/conflicting role emphasis identity/i);
    expect(() => canonicalizeStrategyResult({ ...base, evidence_priorities: [base.evidence_priorities[0]!, { ...base.evidence_priorities[0]!, priority: "context" as const }] }, [job], annotations)).toThrow(/conflicting evidence priority identity/i);
    const omission = { fact_revision_id: job.revision_id, reason_code: "space" as const };
    expect(canonicalizeStrategyResult({ ...base, omissions: [omission, omission], unresolved_gap_ids: [job.revision_id, job.revision_id] }, [job], annotations)).toMatchObject({ omissions: [omission], unresolved_gap_ids: [job.revision_id] });
    expect(() => canonicalizeStrategyResult({ ...base, omissions: [omission, { ...omission, reason_code: "conflict" as const }] }, [job], annotations)).toThrow(/conflicting omission identity/i);
  });

  it("uses semantic month chronology before immutable identity tie-breakers", () => {
    const jobs = [
      { revision_id: "12500000-0000-4000-8000-000000000001", fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "January role", employer: "Synthetic Org", start_date: "2022", end_date: "January 2023" }) },
      { revision_id: "12500000-0000-4000-8000-000000000003", fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "December role B", employer: "Synthetic Org", start_date: "2022", end_date: "2023-12" }) },
      { revision_id: "12500000-0000-4000-8000-000000000002", fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "December role A", employer: "Synthetic Org", start_date: "2022", end_date: "December 2023" }) },
    ];
    expect(canonicalizeFacts(jobs).map((job) => job.revision_id)).toEqual([
      "12500000-0000-4000-8000-000000000002",
      "12500000-0000-4000-8000-000000000003",
      "12500000-0000-4000-8000-000000000001",
    ]);
  });

  it("restores sections required by confirmed non-omitted evidence", () => {
    const job = { revision_id: "12600000-0000-4000-8000-000000000001", fact_kind: "employment", value: "Supported role" };
    const contact = { revision_id: "12600000-0000-4000-8000-000000000002", fact_kind: "contact", value: "Owner | owner@example.test" };
    const generalTools = {
      revision_id: "12600000-0000-4000-8000-000000000003",
      fact_kind: "job_evidence",
      value: JSON.stringify({ value_version: 1, association: "general", job_fact_revision_id: null, dimension: "tools", outcome: "answered", owner_text: "Microsoft Excel" }),
    };
    const facts = [job, contact, generalTools];
    const annotations = buildEvidenceAnnotations(facts, []);
    const result = canonicalizeStrategyResult({
      strategy_version: 1 as const,
      history_shape: "early_career" as const,
      history_reason_code: "thin_history" as const,
      role_emphasis: [{ job_fact_revision_id: job.revision_id, priority: "primary" as const, reason_code: "recent" as const, bullet_density: "compact" as const }],
      section_order: ["experience"],
      evidence_priorities: annotations.facts.map((fact) => ({ fact_revision_id: fact.fact_revision_id, priority: fact.required_priority })),
      summary_decision: "omit" as const,
      summary_reason_code: "insufficient_distinct_value" as const,
      skills_context: [],
      omissions: [],
      unresolved_gap_ids: [],
      owner_rationale: "Use the confirmed evidence.",
    }, facts, annotations);

    expect(result.section_order).toEqual(["contact", "experience", "skills"]);
  });

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

  it("drops model-supplied skill context that is not backed by a confirmed skill fact", () => {
    const job = {
      revision_id: "12100000-0000-4000-8000-000000000001",
      fact_kind: "employment",
      value: JSON.stringify({ format: "resume_job_v1", title: "Customer Service Lead", employer: "Synthetic Market" }),
      source_revision_ids: ["12100000-0000-4000-8000-000000000011"],
    };
    const jobEvidence = {
      revision_id: "12100000-0000-4000-8000-000000000002",
      fact_kind: "job_evidence",
      value: JSON.stringify({
        value_version: 1,
        association: "job",
        job_fact_revision_id: job.revision_id,
        dimension: "tools",
        outcome: "answered",
        owner_text: "Customer service, Microsoft Excel, staff scheduling, and employee training",
      }),
      source_revision_ids: ["12100000-0000-4000-8000-000000000012"],
    };
    const facts = [job, jobEvidence];
    const annotations = buildEvidenceAnnotations(facts, []);
    const blocks = [
      block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts }),
      block("evidence_annotations", "resume.evidence-annotations.v1", annotations),
      block("quality_policy", "resume.quality-policy-identity.v1", RESUME_QUALITY_POLICY_IDENTITY),
    ];
    const modelResult = ResumeStrategyResultSchema.parse({
      strategy_version: 1,
      history_shape: "chronological_standard",
      history_reason_code: "standard_chronology",
      role_emphasis: [{ job_fact_revision_id: job.revision_id, priority: "primary", reason_code: "recent", bullet_density: "compact" }],
      section_order: ["experience", "skills"],
      evidence_priorities: annotations.facts.map((fact) => ({ fact_revision_id: fact.fact_revision_id, priority: fact.required_priority })),
      summary_decision: "omit",
      summary_reason_code: "insufficient_distinct_value",
      skills_context: [{
        skill_fact_revision_id: jobEvidence.revision_id,
        placement: "skills_section",
        context_fact_revision_ids: [job.revision_id, "12100000-0000-4000-8000-000000000099"],
      }],
      omissions: [],
      unresolved_gap_ids: [],
      owner_rationale: "Use confirmed customer service evidence.",
    });

    const normalized = canonicalizeStrategyResultFromBlocks(modelResult, blocks) as typeof modelResult;
    expect(normalized.skills_context).toEqual([]);
    expect(validateInferenceClaims("resume_strategy", normalized, blocks).accepted).toBe(true);
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
