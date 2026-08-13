import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BriefDataLifecycleAdapter } from "./lifecycle.js";
import { BriefDataStore } from "./store.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const quote = "The launch reduced onboarding time by 30 percent.";
const statement = () => ({ statement_id: crypto.randomUUID(), text: "Onboarding became faster.", support: { kind: "source_quote" as const, quote } });

async function setup(hooks = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "brief-domain-"));
  const store = new BriefDataStore(root, path.join(root, "apps", "brief-builder"), hooks);
  await store.initialize(ownerId);
  return { root, store };
}

describe("BriefDataStore", () => {
  it("persists a strict initial workflow and reopens it", async () => {
    const { store } = await setup();
    const source = await store.saveSource({ text: quote, expected_catalog_revision: 0, idempotency_key: "testtesttesttest01" });
    const draft = await store.saveDraft({ source_revision_id: source.source_revision_id, title: "Launch brief", statements: [statement()], generated_by: "brief.generate@1", expected_catalog_revision: 1, idempotency_key: "testtesttesttest02" });
    const approved = await store.approve({ draft_revision_id: draft.draft_revision_id, expected_catalog_revision: 2, idempotency_key: "testtesttesttest03", host_owner_confirmed: true, owner_confirmation_proof_id: crypto.randomUUID() });
    await expect(store.reopen()).resolves.toMatchObject({ source: { source_revision_id: source.source_revision_id }, draft: { draft_revision_id: draft.draft_revision_id }, approved: { approved_revision_id: approved.approved_revision_id } });
    expect(JSON.parse(await readFile(store.catalogPath, "utf8"))).toMatchObject({ app_id: "ai.braindrive.brief-builder", revision: 3 });
  });

  it("enforces CAS and app-scoped idempotency", async () => {
    const { store } = await setup();
    const input = { text: quote, expected_catalog_revision: 0, idempotency_key: "testtesttesttest04" };
    const first = await store.saveSource(input);
    await expect(store.saveSource(input)).resolves.toEqual(first);
    await expect(store.saveSource({ ...input, text: `${quote} Changed.` })).rejects.toMatchObject({ code: "conflict" });
    await expect(store.saveSource({ text: quote, expected_catalog_revision: 0, idempotency_key: "testtesttesttest05" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects unsupported factual additions before draft persistence", async () => {
    const { store } = await setup();
    const source = await store.saveSource({ text: quote, expected_catalog_revision: 0, idempotency_key: "testtesttesttest06" });
    await expect(store.saveDraft({ source_revision_id: source.source_revision_id, title: "Unsupported", statements: [{ ...statement(), support: { kind: "source_quote", quote: "Revenue doubled." } }], generated_by: "brief.generate@1", expected_catalog_revision: 1, idempotency_key: "testtesttesttest07" })).rejects.toMatchObject({ code: "validation_failed" });
    expect((await store.catalog()).drafts).toHaveLength(0);
  });

  it("creates immutable predecessor/successor lineage and preserves the prior approval on later failure", async () => {
    const { store } = await setup();
    const source = await store.saveSource({ text: quote, expected_catalog_revision: 0, idempotency_key: "testtesttesttest08" });
    const firstDraft = await store.saveDraft({ source_revision_id: source.source_revision_id, title: "First", statements: [statement()], generated_by: "brief.generate@1", expected_catalog_revision: 1, idempotency_key: "testtesttesttest09" });
    const first = await store.approve({ draft_revision_id: firstDraft.draft_revision_id, expected_catalog_revision: 2, idempotency_key: "testtesttesttest10", host_owner_confirmed: true, owner_confirmation_proof_id: crypto.randomUUID() });
    const secondDraft = await store.saveDraft({ source_revision_id: source.source_revision_id, title: "Owner edit", statements: [statement()], generated_by: "owner_edit", expected_catalog_revision: 3, idempotency_key: "testtesttesttest11" });
    const second = await store.approve({ draft_revision_id: secondDraft.draft_revision_id, expected_catalog_revision: 4, idempotency_key: "testtesttesttest12", host_owner_confirmed: true, owner_confirmation_proof_id: crypto.randomUUID() });
    expect(await store.lineage(first.approved_revision_id)).toMatchObject({ predecessor: null, successor: { approved_revision_id: second.approved_revision_id } });
    expect(await store.lineage(second.approved_revision_id)).toMatchObject({ predecessor: { approved_revision_id: first.approved_revision_id }, successor: null });
    await expect(store.saveDraft({ source_revision_id: source.source_revision_id, title: "Bad", statements: [{ ...statement(), support: { kind: "source_quote", quote: "Not present" } }], generated_by: "owner_edit", expected_catalog_revision: 5, idempotency_key: "testtesttesttest13" })).rejects.toMatchObject({ code: "validation_failed" });
    expect((await store.reopen()).approved?.approved_revision_id).toBe(second.approved_revision_id);
  });

  it("leaves durable state unchanged when persistence fails", async () => {
    let fail = false;
    const { root, store } = await setup({ beforeCommit: async () => { if (fail) throw new Error("synthetic persistence fault"); } });
    fail = true;
    await expect(store.saveSource({ text: quote, expected_catalog_revision: 0, idempotency_key: "testtesttesttest14" })).rejects.toMatchObject({ code: "persistence_failed" });
    expect((await new BriefDataStore(root).catalog()).revision).toBe(0);
  });
});

describe("BriefDataLifecycleAdapter", () => {
  it("retains on uninstall, restores only the same identity, and explicitly deletes only Brief data", async () => {
    const { root, store } = await setup();
    await store.saveSource({ text: quote, expected_catalog_revision: 0, idempotency_key: "testtesttesttest15" });
    const adapter = new BriefDataLifecycleAdapter(root);
    await expect(adapter.cleanupDefaultUninstall()).resolves.toMatchObject({ durable_records_preserved: true });
    await expect(adapter.prepareActivation({ ownerId, compatibility: { read_min: 1, read_max: 1, write_version: 1 }, reason: "reinstall" })).resolves.toMatchObject({ revision_count: 1 });
    await expect(adapter.validateBackupIdentity({ backup_version: 1, app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive", adapter_binding_id: "data.brief-builder", adapter_contract_version: 1, data_contract_version: 1, content_digest: `sha256:${"a".repeat(64)}` })).rejects.toMatchObject({ code: "incompatible_schema" });
    await expect(adapter.deleteRetainedData({ operation_id: crypto.randomUUID(), owner_id: ownerId, app_id: "ai.braindrive.brief-builder", trusted_owner_confirmation: true })).resolves.toMatchObject({ deleted: true });
    await expect(new BriefDataStore(root).catalog()).rejects.toMatchObject({ code: "ENOENT" });
  });
});
