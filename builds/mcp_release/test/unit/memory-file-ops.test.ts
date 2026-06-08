import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { editMemoryFile, writeMemoryFile } from "../../src/memory-core.js";

describe("memory file operations", () => {
  it("adds canonical Roth IRA boundary bullets when writing the Finance plan", async () => {
    const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "memory-file-ops-finance-write-"));

    try {
      await writeMemoryFile(memoryRoot, "documents/finance/plan.md", [
        "# Finance Plan",
        "",
        "## Owner Decisions",
        "",
        "- Budgeting is not needed for the next step.",
        "",
        "## Planning Guardrails",
        "",
        "- Do not make specific Roth IRA trades.",
        "",
      ].join("\n"));

      const plan = await readFile(path.join(memoryRoot, "documents", "finance", "plan.md"), "utf8");
      expect(markdownSectionContent(plan, "Owner Decisions")).toContain(
        "Roth IRA boundary: the Roth IRA is outside this short-term cash-flow plan unless Katie separately asks to review retirement contributions."
      );
      expect(markdownSectionContent(plan, "Planning Guardrails")).toContain(
        "Roth IRA is not a funding source for this Finance plan. Do not use Roth IRA balances, withdrawals, investment changes, or contribution changes for rent, emergency cushion, or credit-card payoff planning."
      );
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("adds canonical Roth IRA boundary bullets when editing the Finance plan", async () => {
    const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "memory-file-ops-finance-edit-"));

    try {
      await mkdir(path.join(memoryRoot, "documents", "finance"), { recursive: true });
      await writeFile(
        path.join(memoryRoot, "documents", "finance", "plan.md"),
        [
          "# Finance Plan",
          "",
          "## Owner Decisions",
          "",
          "- Budgeting is not needed for the next step.",
          "",
          "## Planning Guardrails",
          "",
          "- Debt payoff waits for APR and minimum-payment evidence.",
          "",
        ].join("\n"),
        "utf8"
      );

      await editMemoryFile(
        memoryRoot,
        "documents/finance/plan.md",
        "Budgeting is not needed for the next step.",
        "Budgeting is not needed for the next step; Roth IRA is outside this plan."
      );

      const plan = await readFile(path.join(memoryRoot, "documents", "finance", "plan.md"), "utf8");
      expect(markdownSectionContent(plan, "Owner Decisions")).toContain(
        "Roth IRA boundary: the Roth IRA is outside this short-term cash-flow plan unless Katie separately asks to review retirement contributions."
      );
      expect(markdownSectionContent(plan, "Planning Guardrails")).toContain(
        "Roth IRA is not a funding source for this Finance plan. Do not use Roth IRA balances, withdrawals, investment changes, or contribution changes for rent, emergency cushion, or credit-card payoff planning."
      );
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });
});

function markdownSectionContent(content: string, section: string): string {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const match = new RegExp(`^##\\s+${escaped}\\s*$`, "im").exec(content);
  if (!match) {
    return "";
  }

  const sectionStart = match.index + match[0].length;
  const rest = content.slice(sectionStart);
  const nextSection = /\n##\s+/.exec(rest);
  return nextSection ? rest.slice(0, nextSection.index) : rest;
}
