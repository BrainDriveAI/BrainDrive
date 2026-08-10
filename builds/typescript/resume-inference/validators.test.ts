import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { validateInferenceClaims } from "./validators.js";

const FACT_ID = "72000000-0000-4000-8000-000000000001";
const JOB_ID = "72000000-0000-4000-8000-000000000002";
const ACCOMPLISHMENT_ID = "72000000-0000-4000-8000-000000000003";
const blocks = (value: string) => {
  const data = { facts: [{ revision_id: FACT_ID, fact_kind: "accomplishment", value, source_revision_ids: [randomUUID()] }] };
  return [{ category: "confirmed_fact_snapshot" as const, content_digest: canonicalInputDigest(data), schema_id: "resume.confirmed-facts.v1", schema_version: 1 as const, data }];
};

describe("deterministic claim gate", () => {
  it("allows supported wording and blocks missing provenance, metrics, dates, and titles", () => {
    const cases = [
      ["Built product 20% in 2025 as Engineer", true],
      ["Built product 21% in 2025 as Engineer", false],
      ["Built product 20% in 2026 as Engineer", false],
      ["Built product 20% in 2025 as Director", false],
    ] as const;
    for (const [text, expected] of cases) {
      const report = validateInferenceClaims("general_resume_draft", { statements: [{ statement_id: randomUUID(), kind: "factual", text, supporting_confirmed_fact_revision_ids: [FACT_ID] }] }, blocks("Built product 20% in 2025 as Engineer"));
      expect(report.accepted).toBe(expected);
    }
    const missing = validateInferenceClaims("general_resume_draft", { statements: [{ statement_id: randomUUID(), kind: "factual", text: "Built product", supporting_confirmed_fact_revision_ids: [randomUUID()] }] }, blocks("Built product"));
    expect(missing.findings[0]?.code).toBe("missing_provenance");
  });

  it("has zero unsupported approvals across a deterministic property sample", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const supported = `Delivered release ${seed}% in 2025 as Engineer`;
      const candidate = seed % 2 === 0 ? supported : `Delivered release ${seed + 1}% in 2025 as Director`;
      const report = validateInferenceClaims("general_resume_draft", { statements: [{ statement_id: randomUUID(), kind: "factual", text: candidate, supporting_confirmed_fact_revision_ids: [FACT_ID] }] }, blocks(supported));
      expect(report.accepted).toBe(seed % 2 === 0);
    }
  });

  it("allows conservative resume grammar without allowing internal structured markers", () => {
    const source = "Coordinate schedules across 4 sites, maintain records, and standardized office processes";
    const supported = validateInferenceClaims("general_resume_draft", { statements: [{
      statement_id: randomUUID(), kind: "factual", text: "Experience coordinating schedules, records management, and standardizing office processes across multiple sites",
      supporting_confirmed_fact_revision_ids: [FACT_ID],
    }] }, blocks(source));
    expect(supported.accepted).toBe(true);

    const leaked = validateInferenceClaims("general_resume_draft", { statements: [{
      statement_id: randomUUID(), kind: "factual", text: "resume_job_v1 job_fact_revision_id",
      supporting_confirmed_fact_revision_ids: [FACT_ID],
    }] }, blocks("resume_job_v1 job_fact_revision_id"));
    expect(leaked.accepted).toBe(false);
  });

  it("requires a summary, an individual job heading, and a concise statement for each linked accomplishment", () => {
    const data = { facts: [
      { revision_id: JOB_ID, fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "Operations Coordinator", employer: "Northstar Health" }), source_revision_ids: [randomUUID()] },
      { revision_id: ACCOMPLISHMENT_ID, fact_kind: "accomplishment", value: JSON.stringify({ format: "resume_accomplishment_v1", job_fact_revision_id: JOB_ID, text: "Reduced incomplete forms from 18% to 6%." }), source_revision_ids: [randomUUID()] },
    ] };
    const structuredBlocks = [{ category: "confirmed_fact_snapshot" as const, content_digest: canonicalInputDigest(data), schema_id: "resume.confirmed-facts.v1", schema_version: 1 as const, data }];
    const complete = validateInferenceClaims("general_resume_draft", { statements: [
      { statement_id: randomUUID(), section_id: "summary", kind: "factual", text: "Operations Coordinator experience", supporting_confirmed_fact_revision_ids: [JOB_ID] },
      { statement_id: randomUUID(), section_id: "experience", kind: "factual", text: "Operations Coordinator | Northstar Health", supporting_confirmed_fact_revision_ids: [JOB_ID] },
      { statement_id: randomUUID(), section_id: "experience", kind: "factual", text: "Reduced incomplete forms from 18% to 6%.", supporting_confirmed_fact_revision_ids: [ACCOMPLISHMENT_ID] },
    ] }, structuredBlocks);
    expect(complete.accepted).toBe(true);

    const incomplete = validateInferenceClaims("general_resume_draft", { statements: [
      { statement_id: randomUUID(), section_id: "experience", kind: "factual", text: "Coordinated operations", supporting_confirmed_fact_revision_ids: [JOB_ID] },
    ] }, structuredBlocks);
    expect(incomplete.accepted).toBe(false);
    expect(incomplete.findings.map((item) => item.safe_message)).toEqual(expect.arrayContaining([
      expect.stringContaining("professional summary"),
      expect.stringContaining("individual experience heading"),
      expect.stringContaining("confirmed accomplishment"),
    ]));
  });

  it("produces stable findings and digests for identical invalid input", () => {
    const statement = { statement_id: randomUUID(), kind: "factual" as const, text: "Invented 99%", supporting_confirmed_fact_revision_ids: [FACT_ID] };
    const first = validateInferenceClaims("general_resume_draft", { statements: [statement] }, blocks("Supported 20%"));
    const second = validateInferenceClaims("general_resume_draft", { statements: [statement] }, blocks("Supported 20%"));
    expect(second.findings).toEqual(first.findings);
    expect(second.findings_digest).toBe(first.findings_digest);
  });

  it("preserves partial and ambiguous evidence but rejects unknown fact identities", () => {
    for (const evidence_status of ["partially_supported", "ambiguous", "clarification_needed"] as const) {
      const report = validateInferenceClaims("requirement_evidence_match", { evidence: [{ requirement_id: randomUUID(), evidence_status, supporting_confirmed_fact_revision_ids: [FACT_ID], explanation: "Needs owner review", clarification: "Clarify scope" }] }, blocks("Relevant experience"));
      expect(report.accepted).toBe(true);
    }
    const rejected = validateInferenceClaims("requirement_evidence_match", { evidence: [{ requirement_id: randomUUID(), evidence_status: "supported", supporting_confirmed_fact_revision_ids: [randomUUID()], explanation: "Unknown", clarification: null }] }, blocks("Relevant experience"));
    expect(rejected.accepted).toBe(false);
  });
});
