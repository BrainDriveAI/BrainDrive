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
import { ResumeDataStore, type MigrationFaultPoint } from "./store.js";
import { authority, proposalInput, testGrant } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function memoryRoot(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix)); roots.push(root);
  await Promise.all(["conversations", "documents", "preferences"].map((directory) => mkdir(path.join(root, directory), { recursive: true })));
  await writeFile(path.join(root, "preferences", "default.json"), "{}\n", "utf8");
  return root;
}

async function writeSchemaThreeFixture(root: string, extensions: Record<string, unknown> = {}) {
  const namespace = path.join(root, "apps", "resume-builder");
  const ownerId = testGrant().owner_id;
  const recordId = "73000000-0000-4000-8000-000000000001";
  const revisionId = "73000000-0000-4000-8000-000000000002";
  const relativePath = `records/source/${recordId}/${revisionId}.json`;
  const record = {
    schema_version: 3, record_type: "source",
    metadata: {
      record_id: recordId, revision_id: revisionId, revision: 1, created_at: "2026-08-11T12:00:00.000Z",
      created_by: {
        owner_id: ownerId, actor_id: ownerId, app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive",
        package_digest: `sha256:${"a".repeat(64)}`, installation_id: testGrant().installation_id,
      },
      prior_revision_id: null, extensions: { retained_metadata_extension: { exact: true } },
    },
    owner_id: ownerId, updated_at: "2026-08-11T12:00:00.000Z", lifecycle_state: "active",
    sensitivity: "sensitive", retention_class: "durable_provenance_while_referenced",
    extensions: { retained_record_extension: { exact: true } }, source_kind: "owner_interview",
    safe_label: "Synthetic migration source", content_digest: canonicalInputDigest("synthetic-migration-source"),
    captured_at: "2026-08-11T12:00:00.000Z", source_ref: "73000000-0000-4000-8000-000000000003", untrusted_content: true,
  };
  const recordBytes = `${JSON.stringify(record, null, 2)}\n`;
  const locator = {
    record_id: recordId, revision_id: revisionId, revision: 1, record_type: "source",
    relative_path: relativePath, content_digest: canonicalInputDigest(record),
  };
  const body = {
    catalog_version: 1, data_schema_version: 3, owner_id: ownerId, generation: 7,
    created_at: "2026-08-11T12:00:00.000Z", updated_at: "2026-08-11T12:00:00.000Z",
    heads: { [recordId]: { record_id: recordId, revision_id: revisionId, revision: 1, record_type: "source" } },
    revisions: { [revisionId]: locator }, operations: {}, extensions,
  };
  const catalog = { ...body, integrity_digest: canonicalInputDigest(body) };
  await mkdir(path.dirname(path.join(namespace, relativePath)), { recursive: true });
  await writeFile(path.join(namespace, relativePath), recordBytes, "utf8");
  const catalogBytes = `${JSON.stringify(catalog, null, 2)}\n`;
  await writeFile(path.join(namespace, "catalog.json"), catalogBytes, "utf8");
  return { namespace, ownerId, relativePath, revisionId, recordBytes, catalogBytes, extensions };
}

describe("Resume Builder migration, backup participation, and retained reopen", () => {
  it("migrates schema 3 to 4 without rewriting historical bytes or inventing quality state", async () => {
    const root = await memoryRoot("bd-resume-schema4-");
    const fixture = await writeSchemaThreeFixture(root, { retained_catalog_extension: { exact: true } });
    const store = new ResumeDataStore(root, fixture.namespace, {}, false);

    await store.initialize(fixture.ownerId);
    const catalog = await store.catalog();
    expect(catalog).toMatchObject({ data_schema_version: 4, extensions: fixture.extensions });
    expect(await readFile(path.join(fixture.namespace, fixture.relativePath), "utf8")).toBe(fixture.recordBytes);
    expect(catalog.revisions[fixture.revisionId]).toMatchObject({ content_digest: canonicalInputDigest(JSON.parse(fixture.recordBytes)) });
    expect(await store.list("craft_quality_report")).toHaveLength(0);
    expect(await store.list("resume_definition")).toHaveLength(0);
    expect(await store.list("migration")).toEqual([
      expect.objectContaining({
        schema_version: 4, from_schema_version: 3, to_schema_version: 4, status: "committed",
        extensions: { migration_provenance: expect.objectContaining({ transformer_id: "resume-data.schema-3-to-4", method: "deterministic_no_ai" }) },
      }),
    ]);

    await store.initialize(fixture.ownerId);
    expect(await store.list("migration")).toHaveLength(1);
  });

  it("restores schema 3 at every migration fault boundary and converges on restart", async () => {
    const faultPoints: MigrationFaultPoint[] = ["after_snapshot", "after_records", "after_staged_catalog", "after_marker", "after_catalog_switch"];
    for (const faultPoint of faultPoints) {
      const root = await memoryRoot(`bd-resume-schema4-${faultPoint}-`);
      const fixture = await writeSchemaThreeFixture(root, { retained_fault_point: faultPoint });
      const store = new ResumeDataStore(root, fixture.namespace, { migrationFaultPoint: faultPoint }, false);

      await expect(store.initialize(fixture.ownerId)).rejects.toMatchObject({ code: "recoverable_internal_failure" });
      expect(await readFile(path.join(fixture.namespace, "catalog.json"), "utf8")).toBe(fixture.catalogBytes);
      expect(await readFile(path.join(fixture.namespace, fixture.relativePath), "utf8")).toBe(fixture.recordBytes);

      const restarted = new ResumeDataStore(root, fixture.namespace, {}, false);
      await restarted.initialize(fixture.ownerId);
      expect((await restarted.catalog()).data_schema_version).toBe(4);
      expect(await restarted.list("migration")).toHaveLength(1);
      expect(await readFile(path.join(fixture.namespace, fixture.relativePath), "utf8")).toBe(fixture.recordBytes);
    }
  });

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
    expect((await readFile(path.join(namespace, "catalog.json"), "utf8")).includes('"data_schema_version":4')).toBe(true);
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
    expect((await reopened.catalog()).data_schema_version).toBe(4);
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
