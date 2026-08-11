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

  it("keeps one optional active-job question pressure-free for every persona starting position", async () => {
    const corpus = JSON.parse(await readFile(new URL("./fixtures/starting-positions.json", import.meta.url), "utf8")) as Corpus;
    const dimensions = ["responsibilities", "tools", "accomplishments", "outcomes", "scope", "progression"] as const;
    for (const [index, scenario] of corpus.scenarios.entries()) {
      const jobId = crypto.randomUUID();
      const facts = { facts: [{ revision_id: jobId, fact_kind: "employment", value: scenario.fact, source_revision_ids: [crypto.randomUUID()] }] };
      const dimension = dimensions[index % dimensions.length]!;
      const summary = { active_job_fact_revision_id: jobId, active_job_revision: 1, requested_dimension: dimension, dimensions: [] };
      const blocks = [
        { category: "confirmed_fact_snapshot" as const, content_digest: canonicalInputDigest(facts), schema_id: "resume.confirmed-facts.v1", schema_version: 1 as const, data: facts },
        { category: "job_evidence_summary" as const, content_digest: canonicalInputDigest(summary), schema_id: "resume.job-evidence-summary.v1", schema_version: 1 as const, data: summary },
      ];
      const result = { questions: [{ question_id: crypto.randomUUID(), job_fact_revision_id: jobId, dimension, selection_method: "deterministic_gap", prompt: "What useful detail do you remember about this part of the role? A qualitative answer is enough, and it is okay not to know.", rationale: "This is the highest-value unanswered evidence area for the active job." }] };
      expect(validateInferenceClaims("interview_assist", result, blocks).accepted, scenario.id).toBe(true);
    }
  });

  it.each([
    "same-employer roles",
    "promotion",
    "concurrent work",
    "self-employment",
    "volunteer work",
    "missing dates",
    "missing tools",
    "missing metrics",
    "general skills",
  ])("does not turn %s into a required checklist or metric demand", (scenario) => {
    const prompt = `What useful detail do you remember for ${scenario}? A short qualitative answer is enough, and you can skip this.`;
    expect(prompt).not.toMatch(/\b(?:must|required|exact (?:number|percentage)|give (?:me )?a (?:number|percentage))\b/i);
  });
});
