import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const reportUrl = new URL("./SPEC-06-M8-ACCEPTANCE.md", import.meta.url);

describe("Spec 06 Milestone 8 acceptance manifest", () => {
  it("maps every requirement, story, and release gate and fails release closed", async () => {
    const report = await readFile(reportUrl, "utf8");

    for (let index = 1; index <= 33; index += 1) {
      expect(report).toContain(`| RB6-REQ-${String(index).padStart(3, "0")} |`);
    }
    for (let index = 1; index <= 7; index += 1) expect(report).toContain(`| US-${index} |`);
    for (let index = 1; index <= 12; index += 1) expect(report).toContain(`| RB6-G${index} |`);

    expect(report).toContain("Disposition: **HOLD — not release-ready**");
    expect(report).toContain("release_ready=false");
    expect(report).toContain("Docker `start.sh dev` / `stop.sh dev`");
    expect(report).toContain("native Windows build/preflight/test");
    expect(report).toContain("three-generation");
    expect(report).toContain("independent quality reviewer");
    expect(report).toContain("dirty/non-immutable");
  });
});
