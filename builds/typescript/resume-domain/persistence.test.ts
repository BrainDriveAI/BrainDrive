import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLifecycleHarness } from "../app-platform/lifecycle/test-helpers.js";
import { AppLifecycleService } from "../app-platform/lifecycle/service.js";
import { MODERN_FIXTURE_VERSION } from "../app-platform/lifecycle/fixture-repository.js";
import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { exportMigrationArchive, importMigrationArchive } from "../memory/migration.js";
import { ResumeDomainService } from "./service.js";
import { ResumeDataStore } from "./store.js";
import { authority, proposalInput, testGrant } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function memoryRoot(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix)); roots.push(root);
  await Promise.all(["conversations", "documents", "preferences"].map((directory) => mkdir(path.join(root, directory), { recursive: true })));
  await writeFile(path.join(root, "preferences", "default.json"), "{}\n", "utf8");
  return root;
}

describe("Resume Builder migration, backup participation, and retained reopen", () => {
  it("transactionally migrates a pre-contract catalog and preserves extensions", async () => {
    const source = await memoryRoot("bd-resume-legacy-source-");
    const sourceStore = new ResumeDataStore(source, undefined, {}, false);
    await sourceStore.initialize(testGrant().owner_id);
    const service = new ResumeDomainService(sourceStore, () => new Date("2026-08-07T12:00:00.000Z"));
    await service.proposeFact(proposalInput(), authority("career.facts.propose"));
    const records = [...await sourceStore.list("source"), ...await sourceStore.list("career_fact")];

    const target = await memoryRoot("bd-resume-legacy-target-");
    const namespace = path.join(target, "apps", "resume-builder");
    await mkdir(namespace, { recursive: true });
    await writeFile(path.join(namespace, "catalog.json"), `${JSON.stringify({ catalog_version: 0, data_schema_version: 0, owner_id: testGrant().owner_id, records, extensions: { future_namespace_hint: true } })}\n`, "utf8");
    const migrated = new ResumeDataStore(target, namespace, {}, false);
    await migrated.initialize(testGrant().owner_id);
    expect((await migrated.catalog()).extensions).toEqual({ future_namespace_hint: true });
    expect(await migrated.list("career_fact")).toHaveLength(1);
    expect((await readFile(path.join(namespace, "catalog.json"), "utf8")).includes('"data_schema_version":2')).toBe(true);
  });

  it("restores the pre-migration catalog when deterministic transformation fails", async () => {
    const root = await memoryRoot("bd-resume-migration-rollback-");
    const namespace = path.join(root, "apps", "resume-builder");
    await mkdir(namespace, { recursive: true });
    const legacy = { catalog_version: 0, data_schema_version: 0, owner_id: testGrant().owner_id, records: [], extensions: { preserved: true } };
    await writeFile(path.join(namespace, "catalog.json"), `${JSON.stringify(legacy)}\n`, "utf8");
    const store = new ResumeDataStore(root, namespace, { migrationTransform: () => { throw new Error("synthetic migration failure"); } }, false);
    await expect(store.initialize(testGrant().owner_id)).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    expect(JSON.parse(await readFile(path.join(namespace, "catalog.json"), "utf8"))).toEqual(legacy);
  });

  it("reconciles an interrupted validated migration before opening retained data", async () => {
    const source = await memoryRoot("bd-resume-reconcile-source-");
    const sourceStore = new ResumeDataStore(source, undefined, {}, false);
    await sourceStore.initialize(testGrant().owner_id);
    const stagedCatalog = await readFile(path.join(sourceStore.namespaceRoot, "catalog.json"), "utf8");

    const target = await memoryRoot("bd-resume-reconcile-target-");
    const namespace = path.join(target, "apps", "resume-builder");
    const snapshotId = crypto.randomUUID();
    await mkdir(path.join(namespace, "recovery"), { recursive: true });
    const snapshotRelativePath = `recovery/${snapshotId}.catalog-v0.json`;
    const stagedRelativePath = `catalog.${snapshotId}.staged.json`;
    await writeFile(path.join(namespace, snapshotRelativePath), `${JSON.stringify({ catalog_version: 0, data_schema_version: 0, owner_id: testGrant().owner_id, records: [], extensions: {} })}\n`, "utf8");
    await writeFile(path.join(namespace, stagedRelativePath), stagedCatalog, "utf8");
    await writeFile(path.join(namespace, "migration-transaction.json"), `${JSON.stringify({ marker_version: 1, snapshot_path: snapshotRelativePath, staged_path: stagedRelativePath })}\n`, "utf8");

    const reopened = new ResumeDataStore(target, namespace, {}, false);
    await reopened.initialize(testGrant().owner_id);
    expect((await reopened.catalog()).data_schema_version).toBe(2);
    await expect(readFile(path.join(namespace, "migration-transaction.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("survives whole-memory migration archive export and restore", async () => {
    const source = await memoryRoot("bd-resume-archive-source-");
    const store = new ResumeDataStore(source, undefined, {}, false);
    await store.initialize(testGrant().owner_id);
    const service = new ResumeDomainService(store);
    const proposed = await service.proposeFact(proposalInput(), authority("career.facts.propose"));
    const sourceSecrets = path.join(source, "synthetic-secrets");
    const exported = await exportMigrationArchive(source, { secretsPaths: { homeDir: sourceSecrets, vaultPath: path.join(sourceSecrets, "vault.json"), keyPath: path.join(sourceSecrets, "master-key.json") } });

    const target = await memoryRoot("bd-resume-archive-target-");
    const targetSecrets = path.join(target, "synthetic-secrets");
    await importMigrationArchive(exported.archive_path, { memoryRoot: target, secretsPaths: { homeDir: targetSecrets, vaultPath: path.join(targetSecrets, "vault.json"), keyPath: path.join(targetSecrets, "master-key.json") } });
    const restored = new ResumeDataStore(target, undefined, {}, false);
    await restored.initialize(testGrant().owner_id);
    expect((await restored.readHead(proposed.fact.metadata.record_id)).metadata.revision_id).toBe(proposed.fact.metadata.revision_id);
  });

  it("retains records across uninstall and reopens them under a new installation grant", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-reinstall-")); roots.push(root);
    const harness = await createLifecycleHarness(root);
    const installed = await harness.service.install({ version: MODERN_FIXTURE_VERSION, idempotencyKey: "m4-retain-install", approveCapabilities: true });
    const store = new ResumeDataStore(root, harness.ownerDataRoot, {}, false);
    await store.initialize(installed.grant!.owner_id);
    const service = new ResumeDomainService(store);
    const operationId = crypto.randomUUID();
    const proposed = await service.proposeFact(proposalInput(), { grant: installed.grant!, capability: "career.facts.propose", operationId, idempotencyKey: `retain-${operationId}` });
    await harness.service.uninstall({ idempotencyKey: "m4-retain-uninstall" });
    const reinstalled = await harness.service.install({ version: MODERN_FIXTURE_VERSION, idempotencyKey: "m4-retain-reinstall", approveCapabilities: true });
    expect(reinstalled.record.installation_id).not.toBe(installed.record.installation_id);
    const reopened = new ResumeDataStore(root, harness.ownerDataRoot, {}, false);
    await reopened.initialize(reinstalled.grant!.owner_id);
    expect((await reopened.readHead(proposed.fact.metadata.record_id)).metadata.revision_id).toBe(proposed.fact.metadata.revision_id);
  });

  it("retains an exact recovery draft across uninstall and a newly granted installation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-recovery-reinstall-")); roots.push(root);
    const harness = await createLifecycleHarness(root);
    const installed = await harness.service.install({ version: MODERN_FIXTURE_VERSION, idempotencyKey: "m2-recovery-install", approveCapabilities: true });
    const store = new ResumeDataStore(root, harness.ownerDataRoot, {}, false);
    await store.initialize(installed.grant!.owner_id);
    const service = new ResumeDomainService(store, () => new Date("2026-08-10T12:00:00.000Z"));
    const sessionId = crypto.randomUUID();
    const value = "Exact retained multiline value\nRésumé 東京 🚀";
    const operationId = crypto.randomUUID();
    const saved = await service.saveInterviewRecovery({
      expected_revision: null,
      session_id: sessionId,
      current_topic: "contact",
      completed_topics: [],
      skipped_topics: [],
      slot: { session_id: sessionId, job_fact_revision_id: null, question_id: "contact-question", field_id: "answer" },
      value,
      value_digest: canonicalInputDigest(value),
    }, { grant: installed.grant!, capability: "resume.definitions.write", operationId, idempotencyKey: `recovery-${operationId}` });

    await harness.supervisor.stop(harness.supervisor.inspect(installed.record.installation_id!)[0]!, "reconcile");
    const restartedLifecycle = new AppLifecycleService(harness.dependencies);
    await restartedLifecycle.initialize();
    expect(harness.supervisor.inspect(installed.record.installation_id!)).toHaveLength(1);
    const afterRuntimeRestart = new ResumeDataStore(root, harness.ownerDataRoot, {}, false);
    await afterRuntimeRestart.initialize(installed.grant!.owner_id);
    expect(await afterRuntimeRestart.readHead(saved.progress.metadata.record_id)).toMatchObject({ recovery_draft: { value } });

    await restartedLifecycle.uninstall({ idempotencyKey: "m2-recovery-uninstall" });
    const reinstalled = await restartedLifecycle.install({ version: MODERN_FIXTURE_VERSION, idempotencyKey: "m2-recovery-reinstall", approveCapabilities: true });
    const reopened = new ResumeDataStore(root, harness.ownerDataRoot, {}, false);
    await reopened.initialize(reinstalled.grant!.owner_id);

    expect(await reopened.readHead(saved.progress.metadata.record_id)).toMatchObject({
      current_topic: "contact",
      current_question_id: "contact-question",
      current_field_id: "answer",
      recovery_draft: { value, value_digest: canonicalInputDigest(value), saved_at: "2026-08-10T12:00:00.000Z", acknowledged_revision: 1 },
    });
    expect(await reopened.list("source")).toHaveLength(0);
    expect(await reopened.list("career_fact")).toHaveLength(0);
  });
});
