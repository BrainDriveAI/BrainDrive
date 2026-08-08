import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { validateInferenceClaims } from "./validators.js";

const FACT_ID = "72000000-0000-4000-8000-000000000001";
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
