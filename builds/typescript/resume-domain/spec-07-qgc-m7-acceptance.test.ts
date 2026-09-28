import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const reportUrl = new URL("./SPEC-07-QGC-M7-ACCEPTANCE.md", import.meta.url);

describe("Spec 07 quality-gate correction Milestone 7 acceptance record", () => {
  it("maps every correction requirement and release gate while failing release closed", async () => {
    const report = await readFile(reportUrl, "utf8");

    for (let index = 1; index <= 20; index += 1) {
      expect(report).toContain(`| RB7-QGC-REQ-${String(index).padStart(3, "0")} |`);
    }
    for (let index = 1; index <= 5; index += 1) {
      expect(report).toContain(`| RB7-QGC-UX-${String(index).padStart(3, "0")} |`);
    }
    for (let index = 1; index <= 6; index += 1) {
      expect(report).toContain(`| RB7-QGC-DATA-${String(index).padStart(3, "0")} |`);
    }
    for (let index = 1; index <= 9; index += 1) {
      expect(report).toContain(`| RB7-QGC-REC-${String(index).padStart(3, "0")} |`);
    }
    for (let index = 1; index <= 7; index += 1) {
      expect(report).toContain(`| RB7-QGC-SEC-${String(index).padStart(3, "0")} |`);
      expect(report).toContain(`| RB7-QGC-NG-${String(index).padStart(3, "0")} |`);
    }
    for (let index = 1; index <= 10; index += 1) {
      expect(report).toContain(`| RB7-QGC-INV-${String(index).padStart(3, "0")} |`);
      expect(report).toContain(`| RB7-QGC-G${index} |`);
    }
    for (let index = 1; index <= 4; index += 1) {
      expect(report).toContain(`| QGC-US-${index} |`);
    }

    expect(report).toContain("Disposition: **HOLD — not release-ready**");
    expect(report).toContain("Source candidate revision: **UNAVAILABLE**");
    expect(report).toContain("Evidence revision: **UNAVAILABLE**");
    expect(report).toContain("release_ready=false");
    expect(report).toContain("RB7-QGC-G7 | BLOCKED");
    expect(report).toContain("RB7-QGC-G8 | BLOCKED");
    expect(report).toContain("RB7-QGC-G10 | BLOCKED");
    expect(report).not.toContain("/home/hex/");
    expect(report).not.toContain("C:\\Users\\");
  });
});
