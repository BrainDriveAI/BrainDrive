import { describe, expect, it } from "vitest";

import { validateCraftRepair } from "./craft-repair.js";

const SOURCE_ID = "82000000-0000-4000-8000-000000000001";
const REPORT_ID = "82000000-0000-4000-8000-000000000002";
const FACT_ID = "82000000-0000-4000-8000-000000000003";
const CHANGED_ID = "82000000-0000-4000-8000-000000000004";
const UNCHANGED_ID = "82000000-0000-4000-8000-000000000005";

const source = {
  metadata: { revision_id: SOURCE_ID },
  title: "Synthetic Resume",
  statements: [
    { statement_id: CHANGED_ID, section_id: "experience", display_role: "bullet" as const, kind: "factual" as const, text: "Responsible for service requests.", supporting_confirmed_fact_revision_ids: [FACT_ID] },
    { statement_id: UNCHANGED_ID, section_id: "education", display_role: "line" as const, kind: "factual" as const, text: "Synthetic University", supporting_confirmed_fact_revision_ids: [FACT_ID] },
  ],
  section_order: ["experience", "education"],
};
const report = {
  metadata: { revision_id: REPORT_ID },
  proposal_definition_revision_id: SOURCE_ID,
  verdict: "fail" as const,
  findings: [{ finding_id: "82000000-0000-4000-8000-000000000006", criterion: "C2" as const, statement_id: CHANGED_ID, severity: "blocking" as const, correction_class: "duty_only" as const, safe_message: "Use a concrete supported action.", evidence_category: "statement_support" as const, evidence_revision_ids: [FACT_ID] }],
};

function repair(overrides: Record<string, unknown> = {}) {
  return {
    repair_version: 1 as const,
    source_definition_revision_id: SOURCE_ID,
    source_report_revision_id: REPORT_ID,
    changed_statement_ids: [CHANGED_ID],
    title: source.title,
    statements: [{ ...source.statements[0]!, text: "Resolved service requests using the documented intake process." }, source.statements[1]!],
    section_order: source.section_order,
    ...overrides,
  };
}

describe("bounded craft repair preservation", () => {
  it("accepts one named wording change with exact support and structure preservation", () => {
    expect(validateCraftRepair(source, report, repair())).toEqual([]);
  });

  it.each([
    ["unnamed statement drift", { statements: [repair().statements[0], { ...source.statements[1]!, text: "Changed university" }] }, "unnamed_statement_changed"],
    ["support drift", { statements: [{ ...repair().statements[0], supporting_confirmed_fact_revision_ids: [] }, source.statements[1]!] }, "support_changed"],
    ["section order drift", { section_order: ["education", "experience"] }, "section_order_changed"],
    ["added statement", { statements: [...repair().statements, { ...source.statements[1]!, statement_id: "82000000-0000-4000-8000-000000000007" }] }, "statement_set_changed"],
    ["unplanned manifest", { changed_statement_ids: [UNCHANGED_ID] }, "repair_scope_changed"],
    ["title drift", { title: "Target Optimized Resume" }, "title_changed"],
  ] as const)("rejects %s", (_label, overrides, code) => {
    expect(validateCraftRepair(source, report, repair(overrides))).toContainEqual(expect.objectContaining({ code }));
  });
});
