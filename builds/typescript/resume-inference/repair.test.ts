import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { repairResumeDraftFromConfirmedFacts } from "./repair.js";
import { validateInferenceClaims } from "./validators.js";

const JOB_ID = "75000000-0000-4000-8000-000000000001";
const ACCOMPLISHMENT_ID = "75000000-0000-4000-8000-000000000002";
const jobValue = JSON.stringify({
  format: "resume_job_v1",
  title: "Inventory Clerk",
  employer: "Riverbend Supply",
  location: "Dayton, Ohio",
  start_date: "January 2018",
  end_date: "February 2021",
  responsibilities: "Received shipments, maintained inventory records, and prepared customer orders.",
});
const accomplishmentValue = JSON.stringify({
  format: "resume_accomplishment_v1",
  job_fact_revision_id: JOB_ID,
  text: "Improved stock retrieval by reorganizing labels so coworkers could find commonly requested items more easily.",
});
const facts = [
  { revision_id: JOB_ID, fact_kind: "employment", value: jobValue, source_revision_ids: [randomUUID()] },
  { revision_id: ACCOMPLISHMENT_ID, fact_kind: "accomplishment", value: accomplishmentValue, source_revision_ids: [randomUUID()] },
];
const factBlock = {
  category: "confirmed_fact_snapshot" as const,
  content_digest: canonicalInputDigest({ facts }),
  schema_id: "resume.confirmed-facts.v1",
  schema_version: 1 as const,
  data: { facts },
};

function statement(section_id: string, text: string, supportingIds: string[]) {
  return { statement_id: randomUUID(), section_id, kind: "factual" as const, text, supporting_confirmed_fact_revision_ids: supportingIds };
}

describe("Resume Builder deterministic fact repair", () => {
  it("replaces only rejected wording and preserves valid statements exactly", () => {
    const heading = statement("experience", "Inventory Clerk, Riverbend Supply, Dayton, Ohio, January 2018 - February 2021", [JOB_ID]);
    const result = {
      title: "Resume",
      statements: [
        statement("summary", "Award-winning inventory leader", [JOB_ID]),
        heading,
        statement("experience", "Transformed the entire warehouse operation", [ACCOMPLISHMENT_ID]),
      ],
      section_order: ["summary", "experience"],
    };
    const initial = validateInferenceClaims("general_resume_draft", result, [factBlock]);
    expect(initial.accepted).toBe(false);

    const repaired = repairResumeDraftFromConfirmedFacts("general_resume_draft", result, initial, [factBlock]);
    const final = validateInferenceClaims("general_resume_draft", repaired, [factBlock]);
    expect(final.accepted).toBe(true);
    expect(repaired).toMatchObject({
      statements: [
        { text: "Inventory Clerk with experience received shipments, maintained inventory records, and prepared customer orders." },
        heading,
        { text: "Improved stock retrieval by reorganizing labels so coworkers could find commonly requested items more easily." },
      ],
    });
  });

  it("adds required summary, job heading, and linked accomplishment without changing a valid responsibility", () => {
    const responsibility = statement("experience", "Received shipments, maintained inventory records, and prepared customer orders.", [JOB_ID]);
    const result = { title: "Resume", statements: [responsibility], section_order: ["experience"] };
    const initial = validateInferenceClaims("general_resume_draft", result, [factBlock]);
    expect(initial.accepted).toBe(false);

    const repaired = repairResumeDraftFromConfirmedFacts("general_resume_draft", result, initial, [factBlock]) as typeof result;
    const final = validateInferenceClaims("general_resume_draft", repaired, [factBlock]);
    expect(final.accepted).toBe(true);
    expect(repaired.statements).toContainEqual(responsibility);
    expect(repaired.statements.map((item) => item.text)).toEqual([
      "Inventory Clerk with experience received shipments, maintained inventory records, and prepared customer orders.",
      "Inventory Clerk, Riverbend Supply, Dayton, Ohio, January 2018 - February 2021",
      responsibility.text,
      "Improved stock retrieval by reorganizing labels so coworkers could find commonly requested items more easily.",
    ]);
    expect(repaired.section_order).toEqual(["summary", "experience"]);
  });
});
