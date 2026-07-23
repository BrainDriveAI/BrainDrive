import { describe, expect, it } from "vitest";

import {
  PROCESS_GUARDRAIL_VALIDATION_CODES,
  validateProcessGuardrailArtifact,
  validateProcessGuardrailStageOutcome,
  type ProcessGuardrailArtifactValidationInput,
} from "./artifact-validator.js";
import { artifactContractFor } from "./process-definition.js";

function contentFor(pageId: string, stage: "specification" | "plan"): string {
  const contract = artifactContractFor(pageId, stage);
  return contract.requiredHeadings.map((heading) => `${heading}\n\nOwner content.`).join("\n\n");
}

function input(
  overrides: Partial<ProcessGuardrailArtifactValidationInput> = {}
): ProcessGuardrailArtifactValidationInput {
  return {
    pageId: "career",
    stage: "specification",
    toolName: "memory_write",
    targetPath: "documents/career/spec.md",
    candidateContent: contentFor("career", "specification"),
    originalContent: null,
    prerequisites: [{ kind: "interview", status: "accepted" }],
    journalEligibility: "not_applicable",
    ...overrides,
  };
}

describe("process guardrail artifact validation", () => {
  it("accepts valid canonical creation and targeted edits that preserve unrelated bytes", () => {
    const original = `${contentFor("career", "specification")}\n\n## Owner Custom Section\n\nKeep me.`;
    const candidate = original.replace("Owner content.", "Updated owner content.");

    expect(validateProcessGuardrailArtifact(input()).ok).toBe(true);
    expect(validateProcessGuardrailArtifact(input({
      toolName: "memory_edit",
      originalContent: original,
      candidateContent: candidate,
      edit: { find: "Owner content.", replace: "Updated owner content." },
    }))).toMatchObject({ ok: true });
    expect(candidate).toContain("## Owner Custom Section\n\nKeep me.");
  });

  it("rejects edits aimed at owner-defined sections outside the active artifact contract", () => {
    const original = `${contentFor("career", "specification")}\n\n## Owner Custom Section\n\nKeep me.`;
    const candidate = original.replace("Keep me.", "Removed.");

    expect(validateProcessGuardrailArtifact(input({
      toolName: "memory_edit",
      originalContent: original,
      candidateContent: candidate,
      edit: { find: "Keep me.", replace: "Removed." },
    }))).toMatchObject({
      ok: false,
      codes: expect.arrayContaining(["owner_content_removed"]),
    });
  });

  it("emits every structural validator code on its corresponding invalid shape", () => {
    const cases: ProcessGuardrailArtifactValidationInput[] = [
      input({ targetPath: "documents/fitness/spec.md" }),
      input({ targetPath: "documents/career/AGENT-user.md" }),
      input({ targetPath: "diagnostics/process-guardrails/state/x.json" }),
      input({ toolName: "memory_delete" }),
      input({ candidateContent: "" }),
      input({ candidateContent: contentFor("career", "specification").replace("## What You Want", "") }),
      input({ candidateContent: `${contentFor("career", "specification")}\n\n## What You Want\nAgain` }),
      input({
        stage: "plan",
        targetPath: "documents/career/plan.md",
        candidateContent: contentFor("career", "plan"),
        prerequisites: [{ kind: "specification", status: "missing" }],
      }),
      input({
        stage: "plan",
        targetPath: "documents/career/plan.md",
        candidateContent: contentFor("career", "plan"),
        prerequisites: [],
      }),
      input({
        originalContent: contentFor("career", "specification"),
        candidateContent: contentFor("career", "specification").replace("Owner content.", "Changed"),
      }),
      input({
        toolName: "memory_edit",
        originalContent: contentFor("career", "specification"),
        candidateContent: contentFor("career", "specification").replaceAll("Owner content.", ""),
        edit: {
          find: contentFor("career", "specification"),
          replace: contentFor("career", "specification").replaceAll("Owner content.", ""),
        },
      }),
      input({
        stage: "journal_handoff",
        targetPath: "documents/career/journal.md",
        candidateContent: "# Your Career Journal\n\n## 2026-07-23 - Update\n\nEntry",
        prerequisites: [{ kind: "plan", status: "accepted" }],
        journalEligibility: "ineligible",
      }),
      input({
        stage: "journal_handoff",
        targetPath: "documents/career/journal.md",
        candidateContent: "# Your Career Journal\n\n## 2026-07-23 - Update\n\nEntry\n\n## 2026-07-23 - Update\n\nEntry",
        prerequisites: [{ kind: "plan", status: "accepted" }],
        journalEligibility: "eligible",
      }),
    ];

    const codes = new Set(cases.flatMap((candidate) =>
      validateProcessGuardrailArtifact(candidate).codes
    ));
    expect(codes).toEqual(new Set(PROCESS_GUARDRAIL_VALIDATION_CODES));
  });

  it("accepts journal no-entry handoff and rejects artifact-bearing no-entry outcomes", () => {
    expect(validateProcessGuardrailStageOutcome({
      stage: "journal_handoff",
      outcome: "handoff_complete_no_entry",
      artifactPath: null,
    })).toEqual({ ok: true, codes: [] });
    expect(validateProcessGuardrailStageOutcome({
      stage: "journal_handoff",
      outcome: "handoff_complete_no_entry",
      artifactPath: "documents/career/journal.md",
    }).ok).toBe(false);
  });
});
