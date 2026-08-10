import { describe, expect, it } from "vitest";

import { PURPOSE_RESULT_SCHEMAS } from "./results.js";
import { synthesizeResumeE2eResult } from "./e2e-fixture.js";

const factId = "10000000-0000-4000-8000-000000000001";
const parentId = "10000000-0000-4000-8000-000000000002";
const jobId = "10000000-0000-4000-8000-000000000003";
const requirementId = "10000000-0000-4000-8000-000000000004";
const statementId = "10000000-0000-4000-8000-000000000005";
const contactId = "10000000-0000-4000-8000-000000000006";
const educationId = "10000000-0000-4000-8000-000000000007";
const accomplishmentId = "10000000-0000-4000-8000-000000000008";
const facts = { category: "confirmed_fact_snapshot", data: { facts: [
  { revision_id: factId, fact_kind: "employment", value: JSON.stringify({ format: "resume_job_v1", title: "Software Developer", employer: "Synthetic Systems", location: "Dayton, Ohio", start_date: "2022", end_date: "Present", responsibilities: "Delivered synthetic TypeScript systems." }) },
  { revision_id: accomplishmentId, fact_kind: "accomplishment", value: JSON.stringify({ format: "resume_accomplishment_v1", job_fact_revision_id: factId, text: "Reduced deployment time by 20%." }) },
  { revision_id: contactId, fact_kind: "contact", value: "Synthetic Owner | owner@example.test" },
  { revision_id: educationId, fact_kind: "education", value: "Synthetic University, 2025" },
] } };
const parent = { category: "general_resume_definition", data: { metadata: { revision_id: parentId }, title: "General Resume", statements: [{ statement_id: statementId, section_id: "experience", display_role: "heading", kind: "factual", text: "Delivered synthetic TypeScript systems", supporting_confirmed_fact_revision_ids: [factId] }], section_order: ["experience"] } };
const job = { category: "job_description", data: { metadata: { revision_id: jobId }, description_text: "Requires TypeScript delivery." } };

describe("Resume Builder isolated E2E inference fixture", () => {
  it("produces contract-valid outputs for every accepted purpose without entering the agent loop", () => {
    const cases = {
      interview_assist: [facts],
      general_resume_draft: [facts],
      job_description_analyze: [facts, job],
      requirement_evidence_match: [facts, { category: "job_analysis", data: { requirements: [{ requirement_id: requirementId }] } }],
      tailoring_plan: [facts, parent],
      targeted_resume_draft: [facts, parent, job],
    } as const;
    for (const [purpose, blocks] of Object.entries(cases)) {
      expect(() => PURPOSE_RESULT_SCHEMAS[purpose as keyof typeof cases].parse(synthesizeResumeE2eResult(purpose as keyof typeof cases, [...blocks]))).not.toThrow();
    }
  });

  it("builds a readable general-resume section structure from fact kinds", () => {
    const draft = synthesizeResumeE2eResult("general_resume_draft", [facts]) as {
      title: string;
      statements: Array<{ section_id: string; text: string }>;
      section_order: string[];
    };
    expect(draft.title).toBe("Synthetic Owner");
    expect(draft.section_order).toEqual(["contact", "summary", "experience", "education"]);
    expect(draft.statements.map((item) => item.text)).toEqual(expect.arrayContaining([
      "Software Developer | Synthetic Systems | Dayton, Ohio | 2022 - Present",
      "Delivered synthetic TypeScript systems.",
      "Reduced deployment time by 20%.",
    ]));
    expect(draft.statements.every((item) => !item.text.includes("resume_job_v1"))).toBe(true);
  });
});
