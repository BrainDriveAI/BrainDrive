import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { validateInferenceClaims } from "./validators.js";

type Corpus = { fixture_version: 1; scenarios: Array<{ id: string; fact: string; supported: string; unsafe: string }> };

describe("starting-position claim harness", () => {
  it("allows each supported fixture and blocks every unsafe variant", async () => {
    const corpus = JSON.parse(await readFile(new URL("./fixtures/starting-positions.json", import.meta.url), "utf8")) as Corpus;
    expect(corpus.fixture_version).toBe(1);
    expect(corpus.scenarios).toHaveLength(8);
    for (const scenario of corpus.scenarios) {
      const factId = crypto.randomUUID();
      const data = { facts: [{ revision_id: factId, fact_kind: "accomplishment", value: scenario.fact, source_revision_ids: [crypto.randomUUID()] }] };
      const blocks = [{ category: "confirmed_fact_snapshot" as const, content_digest: canonicalInputDigest(data), schema_id: "resume.confirmed-facts.v1", schema_version: 1 as const, data }];
      const report = (text: string) => validateInferenceClaims("general_resume_draft", { statements: [{ statement_id: crypto.randomUUID(), kind: "factual", text, supporting_confirmed_fact_revision_ids: [factId] }] }, blocks);
      expect(report(scenario.supported).accepted, scenario.id).toBe(true);
      expect(report(scenario.unsafe).accepted, scenario.id).toBe(false);
    }
  });
});
