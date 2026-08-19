import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const reportUrl = new URL("./SPEC-07-M8-ACCEPTANCE.md", import.meta.url);

describe("Spec 07 Milestone 8 acceptance manifest", () => {
  it("maps every requirement, story, invariant, and release gate and fails release closed", async () => {
    const report = await readFile(reportUrl, "utf8");

    for (let index = 1; index <= 45; index += 1) {
      expect(report).toContain(`| RB7-REQ-${String(index).padStart(3, "0")} |`);
    }
    for (let index = 1; index <= 8; index += 1) {
      expect(report).toContain(`| US-${index} |`);
    }
    for (let index = 1; index <= 10; index += 1) {
      expect(report).toContain(`| RB7-UX-${String(index).padStart(3, "0")} |`);
    }
    for (let index = 1; index <= 7; index += 1) {
      expect(report).toContain(`| RB7-OBS-${String(index).padStart(3, "0")} |`);
    }
    for (let index = 1; index <= 6; index += 1) {
      expect(report).toContain(`| RB7-SEC-${String(index).padStart(3, "0")} |`);
    }
    for (let index = 1; index <= 16; index += 1) {
      expect(report).toContain(`| RB7-INV-${String(index).padStart(3, "0")} |`);
    }
    for (let index = 1; index <= 12; index += 1) {
      expect(report).toContain(`| RB7-G${index} |`);
    }

    expect(report).toContain("Disposition: **HOLD — not release-ready**");
    expect(report).toContain("release_ready=false");
    expect(report).toContain("63d8a838a3b7aa89895b0759e7ad9e94e1ed7da0");
    expect(report).toContain("immutable implementation candidate");
    expect(report).toContain("Docker dev verification");
    expect(report).toContain("native Windows verification");
    expect(report).toContain("three-generation/provider conformance");
    expect(report).toContain("independent human calibration");
    expect(report).not.toContain("/home/hex/");
    expect(report).not.toContain("C:\\Users\\");
  });
});
