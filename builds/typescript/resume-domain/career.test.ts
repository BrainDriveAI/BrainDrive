import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureGitReady } from "../git.js";
import { CareerPlacementAdapter } from "./career.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-career-placement-")); roots.push(root);
  await mkdir(path.join(root, "me"), { recursive: true });
  await mkdir(path.join(root, "documents", "career"), { recursive: true });
  await writeFile(path.join(root, "me", "profile.md"), "# Profile\nSynthetic owner context.\n", "utf8");
  await writeFile(path.join(root, "documents", "career", "spec.md"), "# Goals\nSynthetic goal.\n", "utf8");
  await writeFile(path.join(root, "documents", "career", "plan.md"), "# Plan\nSynthetic next step.\n", "utf8");
  await ensureGitReady(root);
  return { root, adapter: new CareerPlacementAdapter(root, () => new Date("2026-08-07T12:00:00.000Z")) };
}

describe("Career bounded context and return placement", () => {
  it("uses the same three bounded sources for direct and Career entry without paths", async () => {
    const { root, adapter } = await setup();
    const direct = await adapter.project("direct");
    const career = await adapter.project("career");
    expect(direct.sources.map((source) => source.source_kind)).toEqual(["owner_profile", "career_spec", "career_plan"]);
    expect(career.sources).toEqual(direct.sources);
    expect(JSON.stringify(direct)).not.toContain(root);
    expect(JSON.stringify(direct)).not.toContain("me/profile.md");
  });

  it("writes only the approved concise fields through the insert-only Career journal anchor", async () => {
    const { root, adapter } = await setup();
    const journalPath = path.join(root, "documents", "career", "journal.md");
    const anchor = "<!-- New entries go directly below this line, newest first, using the standard journal entry format from run-journal.md. Keep this line in place. -->";
    await writeFile(journalPath, `# Your Career Journal\n\n${anchor}\n\n## 2026-08-01 - Existing\n\n- Entry:\n  Existing owner note.\n`, "utf8");
    const summary = { summary_version: 1 as const, status: "completed" as const, outcome_summary: "General resume approved.", approved_reference: { kind: "general_resume" as const, record_id: crypto.randomUUID(), revision_id: crypto.randomUUID(), safe_label: "General resume" }, stable_fact_proposals: [{ fact_record_id: crypto.randomUUID(), fact_revision_id: crypto.randomUUID(), safe_summary: "Synthetic stable fact", proposed_placement: "owner_profile" as const }], next_career_action: "Review target roles.", updated_at: "2026-08-07T12:00:00.000Z" };
    const operationId = crypto.randomUUID();
    expect(await adapter.placeReturn(summary, operationId)).toMatchObject({ committed: true, reused: false });
    expect(await adapter.placeReturn(summary, operationId)).toMatchObject({ committed: true, reused: true });
    const journal = await readFile(journalPath, "utf8");
    expect(journal.indexOf("Resume Builder Return")).toBeLessThan(journal.indexOf("2026-08-01 - Existing"));
    expect(journal).toContain("Approved resume: General resume");
    expect(journal).toContain("Synthetic stable fact");
    expect(journal).toContain("Next Career action: Review target roles.");
    expect(journal).not.toContain("record_id");
    expect(journal).not.toContain("job description");
    expect(journal.match(/2026-08-01 - Existing/g)).toHaveLength(1);
    expect(journal.match(/Resume Builder Return/g)).toHaveLength(1);
    expect(journal).not.toContain(operationId);

    const operationPath = path.join(root, "apps", "resume-builder", "career-return-operations", `${operationId}.json`);
    const operation = JSON.parse(await readFile(operationPath, "utf8")) as Record<string, unknown>;
    await writeFile(operationPath, `${JSON.stringify({ ...operation, status: "pending" })}\n`, "utf8");
    expect(await adapter.placeReturn(summary, operationId)).toMatchObject({ committed: true, reused: true });
    expect((await readFile(journalPath, "utf8")).match(/Resume Builder Return/g)).toHaveLength(1);

    await expect(adapter.placeReturn({ ...summary, outcome_summary: "Different result." }, operationId)).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("places an exact v2 approved identity and narrow quality state once across response-loss retry", async () => {
    const { root, adapter } = await setup();
    const summary = {
      summary_version: 2 as const,
      approved_reference: {
        kind: "general_resume" as const,
        record_id: crypto.randomUUID(),
        revision_id: crypto.randomUUID(),
        definition_digest: `sha256:${"a".repeat(64)}` as const,
      },
      quality_state: "owner_approved" as const,
      craft_report_reference: {
        revision_id: crypto.randomUUID(),
        report_digest: `sha256:${"b".repeat(64)}` as const,
      },
      updated_at: "2026-08-07T12:00:00.000Z",
    };
    const operationId = crypto.randomUUID();
    await expect(adapter.placeReturn(summary, operationId)).resolves.toMatchObject({ committed: true, reused: false });

    const journalPath = path.join(root, "documents", "career", "journal.md");
    const operationPath = path.join(root, "apps", "resume-builder", "career-return-operations", `${operationId}.json`);
    const committedJournal = await readFile(journalPath, "utf8");
    expect(committedJournal).toContain("Quality status: Owner approved");
    expect(committedJournal).toContain(`Approved resume revision: ${summary.approved_reference.revision_id}`);
    expect(committedJournal).toContain(`Product craft report revision: ${summary.craft_report_reference.revision_id}`);
    expect(committedJournal).not.toContain(summary.approved_reference.definition_digest);
    expect(committedJournal).not.toContain(summary.craft_report_reference.report_digest);
    expect(committedJournal).not.toMatch(/release[- ]quality|independent review passed|score/i);

    const operation = JSON.parse(await readFile(operationPath, "utf8")) as Record<string, unknown>;
    await writeFile(operationPath, `${JSON.stringify({ ...operation, status: "pending" })}\n`, "utf8");
    await expect(adapter.placeReturn(summary, operationId)).resolves.toMatchObject({ committed: true, reused: true });
    expect(await readFile(journalPath, "utf8")).toBe(committedJournal);
    expect(committedJournal.match(/Resume Builder Return/g)).toHaveLength(1);
  });

  it("fails closed when an accepted context source exceeds its size bound", async () => {
    const { root, adapter } = await setup();
    await writeFile(path.join(root, "documents", "career", "plan.md"), "x".repeat(16_385), "utf8");
    await expect(adapter.project("career")).rejects.toMatchObject({ code: "validation_failed", statusCode: 413 });
  });

  it("serializes concurrent return placements without losing either accepted summary", async () => {
    const { root, adapter } = await setup();
    const base = { summary_version: 1 as const, status: "completed" as const, approved_reference: null, stable_fact_proposals: [], next_career_action: null, updated_at: "2026-08-07T12:00:00.000Z" };
    await Promise.all([
      adapter.placeReturn({ ...base, outcome_summary: "Concurrent result A" }, crypto.randomUUID()),
      adapter.placeReturn({ ...base, outcome_summary: "Concurrent result B" }, crypto.randomUUID()),
    ]);
    const journal = await readFile(path.join(root, "documents", "career", "journal.md"), "utf8");
    expect(journal).toContain("Concurrent result A");
    expect(journal).toContain("Concurrent result B");
    expect(journal.match(/Resume Builder Return/g)).toHaveLength(2);
  });
});
