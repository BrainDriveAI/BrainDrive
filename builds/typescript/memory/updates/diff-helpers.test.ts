import { describe, expect, it } from "vitest";

import { mergeTextWithLineInsertions, summarizeLineDiff } from "./diff-helpers.js";

describe("diff helpers", () => {
  it("summarizes line-level additions and removals", () => {
    const diff = summarizeLineDiff("a\nb\n", "a\nc\n");
    expect(diff).toEqual({
      added_lines: 1,
      removed_lines: 1,
      changed: true,
    });
  });

  it("merges missing source lines into target while preserving target custom lines", () => {
    const source = ["# Agent", "- Keep concise", "- Use checklists", ""].join("\n");
    const target = ["# Agent", "- Keep concise", "- Local customization", ""].join("\n");

    const merged = mergeTextWithLineInsertions(source, target);

    expect(merged.changed).toBe(true);
    expect(merged.inserted_lines).toBe(1);
    expect(merged.content).toContain("- Use checklists");
    expect(merged.content).toContain("- Local customization");
  });
});
