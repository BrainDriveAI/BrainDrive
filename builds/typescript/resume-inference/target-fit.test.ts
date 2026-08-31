import { describe, expect, it } from "vitest";

import { decideTargetFit, TARGET_FIT_THRESHOLD_POLICY } from "./target-fit.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const supported = (suffix: number, requirement_kind: "required" | "preferred" | "skill" = "required") => ({
  requirement_id: id(suffix), requirement_kind, evidence_status: "supported" as const,
  supporting_confirmed_fact_revision_ids: [id(100 + suffix)],
});
const change = (row: ReturnType<typeof supported>, suffix = 1, action: "selection" | "ordering" | "emphasis" | "faithful_wording" | "shorten" = "emphasis") => ({
  change_id: id(200 + suffix), requirement_id: row.requirement_id, statement_id: id(300 + suffix), action,
  supporting_confirmed_fact_revision_ids: row.supporting_confirmed_fact_revision_ids,
});

describe("provisional score-free target-fit gate", () => {
  it("passes one supported core requirement only with an evidence-bound material change", () => {
    const row = supported(1);
    expect(decideTargetFit([row], [change(row)])).toMatchObject({
      fit_class: "meaningfully_supported", outcome: "targeted_variant", support_counts: { core: 1 },
    });
  });

  it("passes useful transferable fit only at the versioned two-row threshold", () => {
    const first = supported(1, "preferred");
    const second = supported(2, "skill");
    expect(decideTargetFit([first, second], [change(first)])).toMatchObject({
      fit_class: "partially_supported_transferable", outcome: "targeted_variant", support_counts: { transferable: 2 },
    });
    expect(TARGET_FIT_THRESHOLD_POLICY.authority_status).toBe("provisional_planning_default");
  });

  it.each([
    ["no supported core", [{ ...supported(1), evidence_status: "unsupported" as const, supporting_confirmed_fact_revision_ids: [] }], []],
    ["weak transfer", [supported(1, "skill")], []],
    ["partial only", [{ ...supported(1), evidence_status: "partially_supported" as const }], []],
  ])("returns a durable no-change decision for %s", (_label, rows, changes) => {
    expect(decideTargetFit(rows, changes)).toMatchObject({
      fit_class: "lacking_supported_core_fit", outcome: "no_meaningful_change",
      no_change_reason: "insufficient_supported_fit",
    });
    expect(decideTargetFit(rows, changes).owner_next_actions).toEqual(expect.arrayContaining(["use_general_resume", "try_different_target"]));
  });

  it("blocks ambiguous evidence even when another row and change would otherwise pass", () => {
    const row = supported(1);
    expect(decideTargetFit([row, { ...supported(2), evidence_status: "ambiguous" as const }], [change(row)])).toMatchObject({
      outcome: "no_meaningful_change", no_change_reason: "ambiguous_evidence",
      owner_next_actions: ["use_general_resume", "answer_optional_evidence_questions", "try_different_target"],
    });
  });

  it.each(["faithful_wording", "shorten"] as const)("does not treat %s alone as a material relevance change", (action) => {
    const row = supported(1);
    expect(decideTargetFit([row], [change(row, 1, action)])).toMatchObject({
      outcome: "no_meaningful_change", no_change_reason: "no_material_resume_change", material_changes: [],
    });
  });

  it("rejects keyword-shaped changes whose support does not exactly match the supported row", () => {
    const row = supported(1);
    expect(decideTargetFit([row], [{ ...change(row), supporting_confirmed_fact_revision_ids: [id(999)] }])).toMatchObject({
      outcome: "no_meaningful_change", no_change_reason: "no_material_resume_change",
    });
  });
});
