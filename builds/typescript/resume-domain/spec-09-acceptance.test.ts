import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const reportUrl = new URL("./SPEC-09-ACCEPTANCE.md", import.meta.url);

function matrixRows(report: string, prefix: string): string[] {
  return report
    .split("\n")
    .filter((line) => line.startsWith(`| ${prefix}`));
}

describe("Spec 09 Milestone 7 acceptance record", () => {
  it("maps every requirement, story, invariant, and gate while failing release closed", async () => {
    const report = await readFile(reportUrl, "utf8");

    const expected = [
      ...Array.from({ length: 16 }, (_, index) => `RB9-REQ-${String(index + 1).padStart(3, "0")}`),
      ...Array.from({ length: 7 }, (_, index) => `RB9-AI-${String(index + 1).padStart(3, "0")}`),
      ...Array.from({ length: 6 }, (_, index) => `RB9-UX-${String(index + 1).padStart(3, "0")}`),
      ...Array.from({ length: 8 }, (_, index) => `RB9-CONF-${String(index + 1).padStart(3, "0")}`),
      ...Array.from({ length: 12 }, (_, index) => `RB9-INV-${String(index + 1).padStart(3, "0")}`),
      ...Array.from({ length: 6 }, (_, index) => `RB9-US-${index + 1}`),
      ...Array.from({ length: 10 }, (_, index) => `RB9-G${index + 1}`),
    ];

    for (const id of expected) {
      expect(matrixRows(report, `${id} |`), id).toHaveLength(1);
    }

    expect(report).toContain("Disposition: **HOLD — not release-ready**");
    expect(report).toContain("Source candidate revision: **WORKTREE_UNVERIFIED**");
    expect(report).toContain("Evidence revision: **WORKTREE_UNVERIFIED**");
    expect(report).toContain("| RB9-G6 | WORKTREE_UNVERIFIED | live / `P1`");
    expect(report).toContain("| RB9-G9 | WORKTREE_UNVERIFIED | human / `H1`");
    expect(report).toContain("| RB9-G10 | WORKTREE_UNVERIFIED | `C1`, `D1`, `N1`, `N2`");
    expect(report).toContain("No provider call was made and no v2 registry evidence was installed.");
  });

  it("contains only sanitized evidence and no release overclaim", async () => {
    const report = await readFile(reportUrl, "utf8");

    for (const prohibited of [
      /\/home\//i,
      /C:\\Users\\/i,
      /https?:\/\//i,
      /\bBearer\s+[A-Za-z0-9._-]+/i,
      /\bsk-[A-Za-z0-9_-]{8,}/i,
      /Authorization:\s*\S+/i,
    ]) {
      expect(report).not.toMatch(prohibited);
    }

    expect(report).not.toMatch(/^Disposition: \*\*PASS/m);
    expect(report).not.toContain("| `P1` | Exact BrainDrive Models v2 conformance | PASS");
  });
});
