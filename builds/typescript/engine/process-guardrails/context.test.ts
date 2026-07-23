import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ProcessGuardrailContextError,
  buildProcessGuardrailStageContext,
  type ProcessGuardrailInstructionSnapshot,
} from "./context.js";
import { PROCESS_GUARDRAIL_STAGES, type ProcessGuardrailStage } from "./state-machine.js";

const digest = "a".repeat(64);

function instructions(stage: ProcessGuardrailStage): ProcessGuardrailInstructionSnapshot {
  const procedure = stage === "plan"
    ? "run-planning.md"
    : stage === "journal_handoff"
      ? "run-journal.md"
      : "run-interview.md";
  return {
    page_id: "career",
    stage,
    sources: [
      {
        path: "documents/career/AGENT.md",
        kind: "managed",
        digest,
        content: "active page behavior",
      },
      {
        path: `documents/career/${procedure}`,
        kind: "managed",
        digest,
        content: `active ${stage} procedure`,
      },
    ],
  };
}

describe("process guardrail stage context", () => {
  it.each(PROCESS_GUARDRAIL_STAGES)("builds an allowlisted manifest for %s", (stage) => {
    const built = buildProcessGuardrailStageContext({
      stage,
      safetyContext: "system safety",
      ownerDirection: {
        messageIds: ["message-current"],
        content: "current owner direction",
      },
      instructions: instructions(stage),
      prerequisites: stage === "interview"
        ? []
        : [{
            kind: stage === "plan" ? "specification" : "interview",
            status: "accepted",
            path: "documents/career/spec.md",
            digest,
            content: "required accepted artifact",
          }],
      tokenBudget: 4_000,
    });

    expect(built.manifest.stage).toBe(stage);
    expect(built.manifest.owner_message_ids).toEqual(["message-current"]);
    expect(built.manifest.instruction_refs).toEqual(
      instructions(stage).sources.map(({ path, digest: sourceDigest }) => ({
        path,
        digest: sourceDigest,
      }))
    );
    expect(JSON.stringify(built.manifest)).not.toContain("current owner direction");
    expect(JSON.stringify(built.manifest)).not.toContain("active page behavior");
    expect(built.messages.map((message) => message.content).join("\n")).toContain(
      `Active guarded stage: ${stage}`
    );
  });

  it("represents an owner-skipped prerequisite without inventing artifact content", () => {
    const built = buildProcessGuardrailStageContext({
      stage: "plan",
      safetyContext: "system safety",
      ownerDirection: { messageIds: ["m1"], content: "continue without a specification" },
      instructions: instructions("plan"),
      prerequisites: [{
        kind: "specification",
        status: "absent_by_owner_choice",
      }],
      tokenBudget: 2_000,
    });

    expect(built.manifest.prerequisites).toEqual([{
      kind: "specification",
      status: "absent_by_owner_choice",
    }]);
    expect(built.messages.map((message) => message.content).join("\n")).toContain(
      "specification: absent_by_owner_choice"
    );
  });

  it("represents an accepted non-artifact prerequisite and structural retry feedback", () => {
    const built = buildProcessGuardrailStageContext({
      stage: "specification",
      safetyContext: "system safety",
      ownerDirection: { messageIds: ["m1"], content: "turn this into my goals" },
      instructions: instructions("specification"),
      prerequisites: [{
        kind: "interview",
        status: "accepted",
      }],
      structuralFeedbackCodes: ["required_section_missing"],
      tokenBudget: 2_000,
    });

    expect(built.manifest.prerequisites).toEqual([{
      kind: "interview",
      status: "accepted",
    }]);
    const rendered = built.messages.map((message) => message.content).join("\n");
    expect(rendered).toContain("interview: accepted (no artifact)");
    expect(rendered).toContain("required_section_missing");
  });

  it("rejects a missing prerequisite before provider-facing context exists", () => {
    expect(() => buildProcessGuardrailStageContext({
      stage: "plan",
      safetyContext: "system safety",
      ownerDirection: { messageIds: ["m1"], content: "make a plan" },
      instructions: instructions("plan"),
      prerequisites: [{ kind: "specification", status: "missing" }],
      tokenBudget: 2_000,
    })).toThrowError(ProcessGuardrailContextError);
  });

  it("fails safely on oversized allowlisted input without summarizing excluded content", () => {
    expect(() => buildProcessGuardrailStageContext({
      stage: "interview",
      safetyContext: "system safety",
      ownerDirection: { messageIds: ["m1"], content: "x".repeat(20_000) },
      instructions: instructions("interview"),
      prerequisites: [],
      tokenBudget: 100,
    })).toThrowError(/context budget/i);
  });

  it("ignores unrelated history, downstream instructions, and evaluation-only input", () => {
    const built = buildProcessGuardrailStageContext({
      stage: "interview",
      safetyContext: "system safety",
      ownerDirection: { messageIds: ["m1"], content: "active direction" },
      instructions: instructions("interview"),
      prerequisites: [],
      tokenBudget: 2_000,
      unrelatedHistory: "must not appear",
      downstreamInstructions: "must not appear either",
      evaluationFixture: "frozen-only-value",
    } as Parameters<typeof buildProcessGuardrailStageContext>[0] & Record<string, unknown>);
    const rendered = built.messages.map((message) => message.content).join("\n");

    expect(rendered).not.toContain("must not appear");
    expect(rendered).not.toContain("frozen-only-value");
    expect(JSON.stringify(built.manifest)).not.toContain("must not appear");
  });

  it("keeps evaluation personas, answers, and retired runtime interview behavior out of production modules", () => {
    const productionModules = [
      "process-definition.ts",
      "instruction-loader.ts",
      "context.ts",
      "artifact-validator.ts",
      "control-tools.ts",
      "guarded-tool-executor.ts",
    ].map((name) =>
      readFileSync(new URL(name, import.meta.url), "utf8")
    ).join("\n");
    const forbidden = [
      "Katie",
      "marketing coordinator",
      "vegetable garden",
      "ask exactly one question",
      "at most one question mark",
      "judge score",
      "gauntlet answer",
    ];

    for (const phrase of forbidden) {
      expect(productionModules).not.toContain(phrase);
    }
  });
});
