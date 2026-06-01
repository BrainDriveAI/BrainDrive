import { describe, expect, it } from "vitest";

import { buildClaimToArtifactLedger, extractAssistantClaims } from "./claim-artifact-ledger.js";

describe("claim-to-artifact ledger", () => {
  it("extracts todo update claims from assistant text", () => {
    const claims = extractAssistantClaims(
      "I've updated your active Todo list with the concrete action items we need next."
    );

    expect(claims).toEqual([
      expect.objectContaining({
        type: "todo_updated",
        requiredArtifacts: ["me/todo.md"],
      }),
    ]);
  });

  it("marks a promised todo update missing when me/todo.md did not change", () => {
    const ledger = buildClaimToArtifactLedger({
      assistantText: "I've updated your active Todo list with set up autopay.",
      observedArtifacts: [
        {
          path: "me/todo.md",
          status: "unchanged",
          content: "- [ ] Review April 2026 actual spending report #finance",
        },
      ],
    });

    expect(ledger[0]).toMatchObject({
      verificationStatus: "missing",
      ownerImpact: "todo_updated claim is missing the expected durable artifact change.",
    });
  });

  it("verifies a promised todo update when the changed artifact contains the task", () => {
    const ledger = buildClaimToArtifactLedger({
      assistantText: "I've updated your active Todo list with set up autopay.",
      observedArtifacts: [
        {
          path: "me/todo.md",
          status: "modified",
          content: "- [ ] Set up credit card autopay minimums #finance",
        },
      ],
    });

    expect(ledger[0]?.verificationStatus).toBe("verified");
  });

  it("detects contradicted category mapping claims when changed artifacts omit the merchant", () => {
    const ledger = buildClaimToArtifactLedger({
      assistantText: "I categorized MJP Services and Blue Door Payment in the report.",
      observedArtifacts: [
        {
          path: "documents/finance/budget/reports/latest.md",
          status: "modified",
          content: "No merchant details here.",
        },
      ],
    });

    expect(ledger[0]?.verificationStatus).toBe("contradicted");
  });
});
