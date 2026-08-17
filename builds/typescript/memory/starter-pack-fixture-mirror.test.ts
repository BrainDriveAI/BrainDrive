import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The local test memory fixture (your-memory/) is gitignored, so this guard can
// only run on machines that have it. Where it exists, its instruction files must
// stay byte-identical to the versioned starter-pack templates — the pairing rule
// from AGENTS.md. Owner-content artifacts (spec/plan/journal) fill up during use
// and are deliberately not compared.
const typescriptRoot = path.resolve(__dirname, "..");
const fixtureRoot = path.join(typescriptRoot, "your-memory");
const starterPackRoot = path.join(typescriptRoot, "memory", "starter-pack");

const INSTRUCTION_FILES = ["AGENT.md", "run-interview.md", "run-planning.md", "run-journal.md"];
const PAGES = ["career", "finance", "fitness", "relationships", "new-project", "your-agent"];

describe.skipIf(!existsSync(fixtureRoot))("starter-pack / your-memory instruction mirror", () => {
  it("base AGENT.md matches the fixture", () => {
    expect(readFileSync(path.join(starterPackRoot, "base", "AGENT.md"), "utf8")).toBe(
      readFileSync(path.join(fixtureRoot, "AGENT.md"), "utf8"),
    );
  });

  for (const page of PAGES) {
    for (const file of INSTRUCTION_FILES) {
      const template = path.join(starterPackRoot, "projects", "templates", page, file);
      const fixture = path.join(fixtureRoot, "documents", page, file);
      if (!existsSync(template) || !existsSync(fixture)) continue;
      it(`${page}/${file} matches the fixture`, () => {
        expect(readFileSync(template, "utf8")).toBe(readFileSync(fixture, "utf8"));
      });
    }
  }
});
