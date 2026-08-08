import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureGitReady } from "../git.js";
import { CareerPlacementAdapter } from "./career.js";
import { ResumeCapabilityRouter } from "./capabilities.js";
import { ResumeDomainService } from "./service.js";
import { ResumeDataStore } from "./store.js";
import { proposalInput, testGrant } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-capabilities-")); roots.push(root);
  await mkdir(path.join(root, "me"), { recursive: true });
  await mkdir(path.join(root, "documents", "career"), { recursive: true });
  await writeFile(path.join(root, "me", "profile.md"), "# Synthetic profile\n", "utf8");
  await writeFile(path.join(root, "documents", "career", "spec.md"), "# Synthetic goals\n", "utf8");
  await writeFile(path.join(root, "documents", "career", "plan.md"), "# Synthetic plan\n", "utf8");
  await ensureGitReady(root);
  const store = new ResumeDataStore(root, undefined, {}, false);
  const grant = testGrant();
  await store.initialize(grant.owner_id);
  return { root, store, grant, router: new ResumeCapabilityRouter(new ResumeDomainService(store, () => new Date("2026-08-07T12:00:00.000Z")), new CareerPlacementAdapter(root)) };
}

function context(grant: ReturnType<typeof testGrant>, operationId = crypto.randomUUID()) {
  return { grant, operationId, idempotencyKey: `capability-${operationId}` };
}

describe("named Resume Builder data capabilities", () => {
  it("returns a bounded path-free context through the declared read capability", async () => {
    const { root, grant, router } = await setup();
    const result = await router.execute("career.context.read", { entry_point: "direct" }, context(grant));
    expect(JSON.stringify(result)).not.toContain(root);
    expect(result).toMatchObject({ context_version: 1, entry_point: "direct" });
  });

  it("rejects raw-path fields and app-forged confirmation deterministically", async () => {
    const { grant, router } = await setup();
    await expect(router.execute("career.facts.propose", { ...proposalInput(), raw_path: "/tmp/forbidden" }, context(grant))).rejects.toMatchObject({ code: "invalid_input" });
    const proposed = await router.execute("career.facts.propose", proposalInput(), context(grant)) as { fact: { metadata: { record_id: string } } };
    await expect(router.execute("career.facts.confirm", { fact_record_id: proposed.fact.metadata.record_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, context(grant))).rejects.toMatchObject({ code: "denied" });
  });

  it("does not reveal whether an out-of-scope record exists", async () => {
    const { grant, router } = await setup();
    const proposed = await router.execute("career.facts.propose", proposalInput(), context(grant)) as { fact: { metadata: { record_id: string } } };
    const scoped = testGrant({ record_scopes: [crypto.randomUUID()] });
    await expect(router.execute("career.facts.read", { record_id: proposed.fact.metadata.record_id }, context(scoped))).rejects.toMatchObject({ code: "not_found_within_scope", statusCode: 404 });
  });

  it("keeps inference outside data routing and fails closed when the M6 export broker is absent", async () => {
    const { grant, router } = await setup();
    await expect(router.execute("app.inference.request", {}, context(testGrant({ capabilities: [...grant.capabilities, "app.inference.request"] })))).rejects.toMatchObject({ code: "denied" });
    await expect(router.execute("resume.export.request", { action: "preview", definition_revision_id: crypto.randomUUID() }, context(grant))).rejects.toMatchObject({ code: "recoverable_internal_failure" });
  });

  it("emits content-free capability diagnostics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-audit-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant();
    await store.initialize(grant.owner_id);
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const router = new ResumeCapabilityRouter(new ResumeDomainService(store), new CareerPlacementAdapter(root), (event, details) => events.push({ event, details }));
    const sentinel = "PRIVATE_RESUME_SENTINEL";
    await router.execute("career.facts.propose", proposalInput(sentinel), context(grant));
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("content_digest");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: "app.capability.completed", details: { capability: "career.facts.propose", outcome: "committed" } });
  });

  it("places only confirmed stable-fact references into a Career return", async () => {
    const { root, grant, router } = await setup();
    const proposed = await router.execute("career.facts.propose", proposalInput(), context(grant)) as { fact: { metadata: { record_id: string; revision_id: string } } };
    const rejectedSummary = { summary_version: 1 as const, status: "review_needed" as const, outcome_summary: "Synthetic review", approved_reference: null, stable_fact_proposals: [{ fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, safe_summary: "Synthetic fact", proposed_placement: "owner_profile" as const }], next_career_action: null, updated_at: "2026-08-07T12:00:00.000Z" };
    await expect(router.placeCareerReturn(rejectedSummary, "career", crypto.randomUUID(), grant)).rejects.toMatchObject({ code: "validation_failed" });

    const confirmed = await router.execute("career.facts.confirm", { fact_record_id: proposed.fact.metadata.record_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, { ...context(grant), hostOwnerConfirmed: true }) as { fact: { metadata: { record_id: string; revision_id: string } } };
    const acceptedSummary = { ...rejectedSummary, status: "completed" as const, stable_fact_proposals: [{ ...rejectedSummary.stable_fact_proposals[0]!, fact_revision_id: confirmed.fact.metadata.revision_id }] };
    await expect(router.placeCareerReturn(acceptedSummary, "career", crypto.randomUUID(), grant)).resolves.toMatchObject({ committed: true, reused: false });
    expect(await readFile(path.join(root, "documents", "career", "journal.md"), "utf8")).toContain("Synthetic fact");
  });
});
