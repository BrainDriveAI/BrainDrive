import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { MODERN_FIXTURE_VERSION } from "../app-platform/lifecycle/fixture-repository.js";
import { createLifecycleHarness } from "../app-platform/lifecycle/test-helpers.js";
import {
  ResumeDataLifecycleAdapter,
  validateResumeDataTransfer,
} from "./lifecycle.js";
import { ResumeDomainService } from "./service.js";
import { ResumeDataStore, type MigrationFaultPoint } from "./store.js";
import { ImmutableInferenceSnapshotBuilder } from "../resume-inference/snapshot.js";
import { authority, definitionInput, ownerDecision, proposalInput, testGrant } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function root(prefix: string) {
  const value = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(value);
  return value;
}

const compatibility = { read_min: 2, read_max: 3, write_version: 3 } as const;

function schemaOneCatalog(ownerId: string, extensions: Record<string, unknown> = {}) {
  const body = {
    catalog_version: 1 as const,
    data_schema_version: 1 as const,
    owner_id: ownerId,
    generation: 0,
    created_at: "2026-08-10T12:00:00.000Z",
    updated_at: "2026-08-10T12:00:00.000Z",
    heads: {}, revisions: {}, operations: {}, extensions,
  };
  return { ...body, integrity_digest: canonicalInputDigest(body) };
}

async function writeSchemaTwoFixture(memoryRoot: string, extensions: Record<string, unknown> = {}) {
  const namespace = path.join(memoryRoot, "apps", "resume-builder");
  const ownerId = testGrant().owner_id;
  const installationId = testGrant().installation_id;
  const createdAt = "2026-08-10T12:00:00.000Z";
  const sourceRecordId = crypto.randomUUID();
  const sourceRevisionId = crypto.randomUUID();
  const jobRecordId = crypto.randomUUID();
  const jobRevisionId = crypto.randomUUID();
  const evidenceRecordId = crypto.randomUUID();
  const evidenceRevisionId = crypto.randomUUID();
  const attribution = { owner_id: ownerId, actor_id: ownerId, app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive", package_digest: `sha256:${"a".repeat(64)}`, installation_id: installationId };
  const base = (recordType: string, recordId: string, revisionId: string, updatedAt = createdAt) => ({
    schema_version: 2, record_type: recordType,
    metadata: { record_id: recordId, revision_id: revisionId, revision: 1, created_at: updatedAt, created_by: attribution, prior_revision_id: null, extensions: {} },
    owner_id: ownerId, updated_at: updatedAt, lifecycle_state: "active", sensitivity: "sensitive", retention_class: "durable_owner_data", extensions: {},
  });
  const source = { ...base("source", sourceRecordId, sourceRevisionId), source_kind: "owner_interview", safe_label: "Employment", content_digest: canonicalInputDigest("Employment"), captured_at: createdAt, source_ref: crypto.randomUUID(), untrusted_content: true };
  const confirmation = (revisionId: string) => ({ confirmation_id: crypto.randomUUID(), owner_id: ownerId, actor_id: ownerId, host_mediated: true, decision: "accept", confirmed_at: createdAt, operation_id: crypto.randomUUID(), input_revision_id: revisionId });
  const job = { ...base("career_fact", jobRecordId, jobRevisionId), fact_kind: "employment", state: "confirmed", value: "Synthetic role", source_revision_ids: [sourceRevisionId], confirmation: confirmation(jobRevisionId), supersedes_fact_revision_id: null, review: { reviewed_at: createdAt, review_note: null } };
  const evidence = { ...base("career_fact", evidenceRecordId, evidenceRevisionId, "2026-08-10T13:00:00.000Z"), fact_kind: "job_evidence", state: "confirmed", value: JSON.stringify({ value_version: 1, association: "job", job_fact_revision_id: jobRevisionId, dimension: "outcomes", outcome: "unknown", owner_text: "" }), source_revision_ids: [sourceRevisionId], confirmation: confirmation(evidenceRevisionId), supersedes_fact_revision_id: null, review: { reviewed_at: createdAt, review_note: null } };
  const records = [source, job, evidence];
  const heads: Record<string, unknown> = {};
  const revisions: Record<string, unknown> = {};
  await mkdir(namespace, { recursive: true });
  for (const record of records) {
    const relativePath = `records/${record.record_type}/${record.metadata.record_id}/${record.metadata.revision_id}.json`;
    await mkdir(path.dirname(path.join(namespace, relativePath)), { recursive: true });
    await writeFile(path.join(namespace, relativePath), `${JSON.stringify(record)}\n`, "utf8");
    heads[record.metadata.record_id] = { record_id: record.metadata.record_id, revision_id: record.metadata.revision_id, revision: 1, record_type: record.record_type };
    revisions[record.metadata.revision_id] = { ...heads[record.metadata.record_id] as object, relative_path: relativePath, content_digest: canonicalInputDigest(record) };
  }
  const body = { catalog_version: 1, data_schema_version: 2, owner_id: ownerId, generation: 3, created_at: createdAt, updated_at: "2026-08-10T14:00:00.000Z", heads, revisions, operations: {}, extensions };
  await writeFile(path.join(namespace, "catalog.json"), `${JSON.stringify({ ...body, integrity_digest: canonicalInputDigest(body) })}\n`, "utf8");
  return { namespace, jobRevisionId, evidenceRevisionId, evidenceBytes: await readFile(path.join(namespace, `records/career_fact/${evidenceRecordId}/${evidenceRevisionId}.json`), "utf8") };
}

describe("M6 migration, retention, and retained-data lifecycle", () => {
  it("projects schema-2 non-fact evidence into coverage while preserving history and excluding it from new fact snapshots", async () => {
    const memoryRoot = await root("bd-resume-v3-coverage-");
    const fixture = await writeSchemaTwoFixture(memoryRoot, { future_contract: { retained: true } });
    const cloneRoot = await root("bd-resume-v3-coverage-clone-");
    const cloneNamespace = path.join(cloneRoot, "apps", "resume-builder");
    await cp(fixture.namespace, cloneNamespace, { recursive: true });
    const store = new ResumeDataStore(memoryRoot, fixture.namespace, {}, false);
    await store.initialize(testGrant().owner_id);

    expect(await readFile(path.join(fixture.namespace, (await store.catalog()).revisions[fixture.evidenceRevisionId]!.relative_path), "utf8")).toBe(fixture.evidenceBytes);
    expect(await store.list("job_evidence_coverage")).toEqual([
      expect.objectContaining({
        schema_version: 3, job_fact_revision_id: fixture.jobRevisionId,
        dimensions: expect.objectContaining({ outcomes: { state: "unknown", evidence_revision_ids: [], recorded_at: "2026-08-10T13:00:00.000Z" } }),
        migrated_legacy_evidence_revision_ids: [fixture.evidenceRevisionId],
      }),
    ]);
    expect((await store.catalog()).extensions).toEqual({ future_contract: { retained: true } });
    const cloneStore = new ResumeDataStore(cloneRoot, cloneNamespace, {}, false);
    await cloneStore.initialize(testGrant().owner_id);
    expect(await cloneStore.list("job_evidence_coverage")).toEqual(await store.list("job_evidence_coverage"));

    const grant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
    const request = await new ImmutableInferenceSnapshotBuilder(store).build({
      inference_contract_version: 1, purpose: "requirement_evidence_match", operation_id: crypto.randomUUID(),
      fact_revision_ids: [fixture.jobRevisionId, fixture.evidenceRevisionId],
    }, grant);
    expect(request.input_snapshot.record_revision_ids).toEqual([fixture.jobRevisionId]);
    expect(request.data_blocks[0]?.data).toMatchObject({ facts: [{ revision_id: fixture.jobRevisionId, fact_kind: "employment" }] });
  });

  it("restores schema 2 byte-for-byte for every injected 2-to-3 interruption and succeeds on restart", async () => {
    const faultPoints: MigrationFaultPoint[] = ["after_snapshot", "after_records", "after_staged_catalog", "after_marker", "after_catalog_switch"];
    for (const faultPoint of faultPoints) {
      const memoryRoot = await root(`bd-resume-v3-fault-${faultPoint}-`);
      const fixture = await writeSchemaTwoFixture(memoryRoot, { retained_fault_marker: faultPoint });
      const catalogPath = path.join(fixture.namespace, "catalog.json");
      const bytes = await readFile(catalogPath, "utf8");
      await expect(new ResumeDataStore(memoryRoot, fixture.namespace, { migrationFaultPoint: faultPoint }, false).initialize(testGrant().owner_id)).rejects.toMatchObject({ code: "recoverable_internal_failure" });
      expect(await readFile(catalogPath, "utf8")).toBe(bytes);
      const restarted = new ResumeDataStore(memoryRoot, fixture.namespace, {}, false);
      await restarted.initialize(testGrant().owner_id);
      expect((await restarted.catalog()).data_schema_version).toBe(3);
      expect(await restarted.list("job_evidence_coverage")).toHaveLength(1);
    }
  });
  it("runs deterministic 0-to-1-to-2-to-3 steps with exact provenance while preserving extensions", async () => {
    const memoryRoot = await root("bd-resume-m6-migrate-");
    const namespace = path.join(memoryRoot, "apps", "resume-builder");
    await mkdir(namespace, { recursive: true });
    const legacy = {
      catalog_version: 0,
      data_schema_version: 0,
      owner_id: testGrant().owner_id,
      records: [],
      extensions: { future_safe_extension: { retained: true } },
    };
    await writeFile(path.join(namespace, "catalog.json"), `${JSON.stringify(legacy)}\n`, "utf8");

    const store = new ResumeDataStore(memoryRoot, namespace, {}, false);
    await store.initialize(testGrant().owner_id);
    const catalog = await store.catalog();
    expect(catalog).toMatchObject({ data_schema_version: 3, extensions: legacy.extensions });
    const migrations = (await store.list("migration")).filter((record) => record.record_type === "migration");
    expect(migrations).toHaveLength(3);
    const orderedMigrations = [...migrations].sort((left, right) => left.from_schema_version - right.from_schema_version);
    expect(orderedMigrations.map((migration) => [migration.from_schema_version, migration.to_schema_version])).toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(orderedMigrations[1]).toMatchObject({ status: "committed", extensions: { migration_provenance: {
      provenance_version: 1, transformer_id: "resume-data.schema-1-to-2", method: "deterministic_no_ai",
    } } });
    expect((await store.integrityScan()).status).toBe("verified");
  });

  it("restores schema 1 byte-for-byte for every injected 1-to-2 interruption and succeeds on restart", async () => {
    const faultPoints: MigrationFaultPoint[] = ["after_snapshot", "after_records", "after_staged_catalog", "after_marker", "after_catalog_switch"];
    for (const faultPoint of faultPoints) {
      const memoryRoot = await root(`bd-resume-m1-v2-fault-${faultPoint}-`);
      const namespace = path.join(memoryRoot, "apps", "resume-builder");
      await mkdir(namespace, { recursive: true });
      const schemaOne = schemaOneCatalog(testGrant().owner_id, { retained_fault_marker: faultPoint });
      const bytes = `${JSON.stringify(schemaOne, null, 2)}\n`;
      await writeFile(path.join(namespace, "catalog.json"), bytes, "utf8");
      await expect(new ResumeDataStore(memoryRoot, namespace, { migrationFaultPoint: faultPoint }, false).initialize(testGrant().owner_id))
        .rejects.toMatchObject({ code: "recoverable_internal_failure" });
      expect(await readFile(path.join(namespace, "catalog.json"), "utf8")).toBe(bytes);
      const restarted = new ResumeDataStore(memoryRoot, namespace, {}, false);
      await restarted.initialize(testGrant().owner_id);
      expect(await restarted.catalog()).toMatchObject({ data_schema_version: 3, extensions: schemaOne.extensions });
    }
  });

  it("preserves schema-1 record bytes, locators, digests, operations, and extensions through 1-to-2", async () => {
    const sourceRoot = await root("bd-resume-m1-v2-retained-source-");
    const sourceStore = new ResumeDataStore(sourceRoot, undefined, {}, false);
    await sourceStore.initialize(testGrant().owner_id);
    await new ResumeDomainService(sourceStore).proposeFact(proposalInput(), authority("career.facts.propose"));
    const sourceCatalog = await sourceStore.catalog();

    const targetRoot = await root("bd-resume-m1-v2-retained-target-");
    const targetNamespace = path.join(targetRoot, "apps", "resume-builder");
    const retainedRevisions: Record<string, (typeof sourceCatalog.revisions)[string]> = {};
    const retainedBytes = new Map<string, string>();
    for (const [revisionId, locator] of Object.entries(sourceCatalog.revisions)) {
      const record = JSON.parse(await readFile(path.join(sourceStore.namespaceRoot, locator.relative_path), "utf8"));
      const schemaOneRecord = { ...record, schema_version: 1 };
      const bytes = `${JSON.stringify(schemaOneRecord)}\n`;
      const targetPath = path.join(targetNamespace, locator.relative_path);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, bytes, "utf8");
      retainedBytes.set(revisionId, bytes);
      retainedRevisions[revisionId] = { ...locator, content_digest: canonicalInputDigest(schemaOneRecord) };
    }
    const { integrity_digest: _sourceIntegrity, ...sourceBody } = sourceCatalog;
    const schemaOneBody = {
      ...sourceBody,
      data_schema_version: 1 as const,
      revisions: retainedRevisions,
      extensions: { ...sourceBody.extensions, retained_v2_test: { exact: true } },
    };
    const schemaOne = { ...schemaOneBody, integrity_digest: canonicalInputDigest(schemaOneBody) };
    await mkdir(targetNamespace, { recursive: true });
    await writeFile(path.join(targetNamespace, "catalog.json"), `${JSON.stringify(schemaOne)}\n`, "utf8");

    const migrated = new ResumeDataStore(targetRoot, targetNamespace, {}, false);
    await migrated.initialize(testGrant().owner_id);
    const result = await migrated.catalog();
    expect(result.extensions).toEqual(schemaOne.extensions);
    expect(result.operations).toEqual(schemaOne.operations);
    for (const [revisionId, locator] of Object.entries(retainedRevisions)) {
      expect(result.revisions[revisionId]).toEqual(locator);
      expect(await readFile(path.join(targetNamespace, locator.relative_path), "utf8")).toBe(retainedBytes.get(revisionId));
    }
  });

  it("restores the prior readable catalog for every injected migration failure and succeeds on restart", async () => {
    const faultPoints: MigrationFaultPoint[] = ["after_snapshot", "after_records", "after_staged_catalog", "after_marker", "after_catalog_switch"];
    for (const faultPoint of faultPoints) {
      const memoryRoot = await root(`bd-resume-m6-fault-${faultPoint}-`);
      const namespace = path.join(memoryRoot, "apps", "resume-builder");
      await mkdir(namespace, { recursive: true });
      const legacy = { catalog_version: 0, data_schema_version: 0, owner_id: testGrant().owner_id, records: [], extensions: { faultPoint } };
      const legacyBytes = `${JSON.stringify(legacy, null, 2)}\n`;
      await writeFile(path.join(namespace, "catalog.json"), legacyBytes, "utf8");
      const faulted = new ResumeDataStore(memoryRoot, namespace, { migrationFaultPoint: faultPoint }, false);
      await expect(faulted.initialize(testGrant().owner_id)).rejects.toMatchObject({ code: "recoverable_internal_failure" });
      expect(await readFile(path.join(namespace, "catalog.json"), "utf8")).toBe(legacyBytes);

      const restarted = new ResumeDataStore(memoryRoot, namespace, {}, false);
      await restarted.initialize(testGrant().owner_id);
      expect((await restarted.catalog()).data_schema_version).toBe(3);
      expect((await restarted.integrityScan()).staged_transaction_count).toBe(0);
    }
  });

  it("blocks an unreadable newer schema without changing bytes and offers owner-safe repair/export state", async () => {
    const memoryRoot = await root("bd-resume-m6-newer-");
    const store = new ResumeDataStore(memoryRoot, undefined, {}, false);
    await store.initialize(testGrant().owner_id);
    const catalogPath = path.join(store.namespaceRoot, "catalog.json");
    const newer = { ...JSON.parse(await readFile(catalogPath, "utf8")), data_schema_version: 4 };
    const retained = `${JSON.stringify(newer)}\n`;
    await writeFile(catalogPath, retained, "utf8");
    const adapter = new ResumeDataLifecycleAdapter(memoryRoot, store.namespaceRoot);
    await expect(adapter.prepareActivation({ ownerId: testGrant().owner_id, compatibility, reason: "rollback" })).rejects.toMatchObject({ code: "incompatible_schema" });
    expect(await readFile(catalogPath, "utf8")).toBe(retained);
    await expect(adapter.repairState(compatibility)).resolves.toMatchObject({
      state: "incompatible",
      retained_schema_version: 4,
      data_preserved: true,
      owner_export_available: true,
    });
  });

  it("provides logical path-free history and a complete owner-data export receipt", async () => {
    const memoryRoot = await root("bd-resume-m6-export-");
    const store = new ResumeDataStore(memoryRoot, undefined, {}, false);
    await store.initialize(testGrant().owner_id);
    const service = new ResumeDomainService(store);
    const proposed = await service.proposeFact(proposalInput("Synthetic M6 owner export"), authority("career.facts.propose"));
    const adapter = new ResumeDataLifecycleAdapter(memoryRoot, store.namespaceRoot);
    const history = await adapter.recordHistory(proposed.fact.metadata.record_id);
    expect(history).toMatchObject({ history_version: 1, record_id: proposed.fact.metadata.record_id, revision_count: 1 });
    expect(JSON.stringify(history)).not.toContain(memoryRoot);
    expect(JSON.stringify(history)).not.toContain("relative_path");

    const prepared = await adapter.prepareOwnerExport();
    const exported = JSON.parse(await readFile(prepared.internalArchivePath, "utf8"));
    const { export_digest: exportDigest, ...exportBody } = exported;
    expect(exported.records).toHaveLength(2);
    expect(exportDigest).toBe(canonicalInputDigest(exportBody));
    expect(prepared.receipt).toMatchObject({ export_version: 1, record_count: 2, schema_version: 3 });
    expect(JSON.stringify(prepared.receipt)).not.toContain(memoryRoot);
    expect(JSON.stringify(prepared.receipt)).not.toContain("path");
  });

  it("exports and reconstructs exact natural-language request-to-successor lineage without operational exposure", async () => {
    const memoryRoot = await root("bd-resume-m6-revision-export-");
    const store = new ResumeDataStore(memoryRoot, undefined, {}, false);
    await store.initialize(testGrant().owner_id);
    const service = new ResumeDomainService(store, () => new Date("2026-08-10T12:00:00.000Z"));
    const proposedFact = await service.proposeFact(proposalInput(), authority("career.facts.propose"));
    const confirmationAuthority = authority("career.facts.confirm");
    const confirmed = await service.confirmFact({ fact_record_id: proposedFact.fact.metadata.record_id, fact_revision_id: proposedFact.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmationAuthority, ownerDecision(confirmationAuthority, proposedFact.fact.metadata.revision_id));
    const source = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id), authority("resume.definitions.write"), true);
    const submitted = await service.submitRevisionRequest({ kind: "revision_request", source_definition_revision_id: source.definition.metadata.revision_id, target: { scope: "resume", target_id: null }, request_text: "Reorder the supported wording." }, authority("resume.definitions.write"));
    const generating = await service.recordRevisionOutcome({ kind: "revision_outcome", request_record_id: submitted.request.metadata.record_id, expected_revision: 1, classification: "presentation", state: "generating", clarification: null, resulting_definition_revision_id: null, owner_outcome: null }, authority("resume.definitions.write"));
    const statement = source.definition.record_type === "resume_definition" ? source.definition.statements[0]! : null;
    if (!statement) throw new Error("expected source statement");
    const result = await service.createRevisionProposal({
      kind: "revision_proposal",
      request_record_id: generating.request.metadata.record_id,
      expected_revision: generating.request.metadata.revision,
      draft: {
        source_definition_revision_id: source.definition.metadata.revision_id,
        revision_request_revision_id: generating.request.metadata.revision_id,
        title: "General Resume",
        statements: [{ ...statement, text: "Statement: Synthetic supported" }],
        changed_statement_ids: [statement.statement_id],
        section_order: ["experience"],
      },
    }, authority("resume.definitions.write"));

    const graph = await service.referenceGraph(authority("resume.definitions.read"));
    expect(graph.edges).toEqual(expect.arrayContaining([
      { from_revision_id: result.definition.metadata.revision_id, to_revision_id: generating.request.metadata.revision_id, relation: "derived_from" },
      { from_revision_id: result.request.metadata.revision_id, to_revision_id: result.definition.metadata.revision_id, relation: "resulted_in" },
    ]));
    const prepared = await new ResumeDataLifecycleAdapter(memoryRoot, store.namespaceRoot).prepareOwnerExport();
    const exported = JSON.parse(await readFile(prepared.internalArchivePath, "utf8"));
    expect(exported.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ record_type: "resume_revision_request", request_text: "Reorder the supported wording.", resulting_definition_revision_id: result.definition.metadata.revision_id }),
      expect.objectContaining({ record_type: "resume_definition", metadata: expect.objectContaining({ revision_id: result.definition.metadata.revision_id }), successor_context: expect.objectContaining({ revision_request_revision_id: generating.request.metadata.revision_id }) }),
    ]));
    expect(JSON.stringify(prepared.receipt)).not.toContain("Reorder the supported wording");
  });

  it("validates retained data on lifecycle activation, preserves it on uninstall, removes transients, and rejects old authority after reinstall", async () => {
    const lifecycleRoot = await root("bd-resume-m6-lifecycle-");
    const customizedOwnerFile = path.join(lifecycleRoot, "documents", "career", "owner-custom.md");
    await mkdir(path.dirname(customizedOwnerFile), { recursive: true });
    await writeFile(customizedOwnerFile, "owner customization\n", "utf8");
    const harness = await createLifecycleHarness(lifecycleRoot);
    harness.dependencies.ownerDataLifecycle = new ResumeDataLifecycleAdapter(lifecycleRoot, harness.ownerDataRoot);
    const installed = await harness.service.install({ version: MODERN_FIXTURE_VERSION, idempotencyKey: "m6-install-owner-data", approveCapabilities: true });
    const store = new ResumeDataStore(lifecycleRoot, harness.ownerDataRoot, {}, false);
    await store.initialize(installed.grant!.owner_id);
    const service = new ResumeDomainService(store);
    const proposed = await service.proposeFact(proposalInput(), {
      grant: installed.grant!, capability: "career.facts.propose", operationId: crypto.randomUUID(), idempotencyKey: "m6-proposal-owner-data",
    });
    const abandoned = path.join(harness.ownerDataRoot, "transactions", crypto.randomUUID());
    const abandonedCatalog = path.join(harness.ownerDataRoot, `catalog.${crypto.randomUUID()}.staged.json`);
    await mkdir(abandoned, { recursive: true });
    await writeFile(path.join(abandoned, "invalid-stage"), "transient\n", "utf8");
    await writeFile(abandonedCatalog, "{}\n", "utf8");
    const tokenOperation = crypto.randomUUID();
    const issued = await harness.service.issueSession({ audience: "app_data", capabilities: ["career.facts.read"], operationId: tokenOperation });

    await harness.service.uninstall({ idempotencyKey: "m6-uninstall-owner-data" });
    expect((await store.readHead(proposed.fact.metadata.record_id)).metadata.revision_id).toBe(proposed.fact.metadata.revision_id);
    await expect(readFile(path.join(abandoned, "invalid-stage"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(abandonedCatalog, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(() => harness.tokenBroker.consume(issued.token, {
      audience: "app_data", capability: "career.facts.read", installationId: installed.record.installation_id!, operationId: tokenOperation,
    })).toThrow();

    const reinstalled = await harness.service.install({ version: MODERN_FIXTURE_VERSION, idempotencyKey: "m6-reinstall-owner-data", approveCapabilities: true });
    expect(reinstalled.record.installation_id).not.toBe(installed.record.installation_id);
    expect(reinstalled.grant!.grant_id).not.toBe(installed.grant!.grant_id);
    expect((await new ResumeDataStore(lifecycleRoot, harness.ownerDataRoot, {}, false).readHead(proposed.fact.metadata.record_id)).metadata.revision_id).toBe(proposed.fact.metadata.revision_id);
    expect(await readFile(customizedOwnerFile, "utf8")).toBe("owner customization\n");
  });

  it("validates a transferred namespace while allowing memory without Resume Builder data", async () => {
    const emptyRoot = await root("bd-resume-m6-empty-transfer-");
    await expect(validateResumeDataTransfer(emptyRoot)).resolves.toMatchObject({ state: "missing" });
    const dataRoot = await root("bd-resume-m6-valid-transfer-");
    const store = new ResumeDataStore(dataRoot, undefined, {}, false);
    await store.initialize(testGrant().owner_id);
    await expect(validateResumeDataTransfer(dataRoot)).resolves.toMatchObject({ state: "verified", schema_version: 3 });
  });

  it("blocks lifecycle changes while a whole-memory transfer is active", async () => {
    const lifecycleRoot = await root("bd-resume-m6-transfer-lock-");
    const harness = await createLifecycleHarness(lifecycleRoot);
    harness.dependencies.isMemoryMigrationInProgress = () => true;
    await expect(harness.service.install({
      version: MODERN_FIXTURE_VERSION,
      idempotencyKey: "m6-transfer-lock-install",
      approveCapabilities: true,
    })).rejects.toMatchObject({ code: "invalid_state_transition" });
    expect(await harness.service.status()).toMatchObject({ state: "not_installed", installation_id: null });
  });

  it("refuses uninstall while whole-memory migration is active and retains the installed authority", async () => {
    const lifecycleRoot = await root("bd-resume-m6-uninstall-transfer-lock-");
    const harness = await createLifecycleHarness(lifecycleRoot);
    let migrationActive = false;
    harness.dependencies.isMemoryMigrationInProgress = () => migrationActive;
    const installed = await harness.service.install({
      version: MODERN_FIXTURE_VERSION,
      idempotencyKey: "m6-uninstall-lock-install",
      approveCapabilities: true,
    });
    migrationActive = true;
    await expect(harness.service.uninstall({ idempotencyKey: "m6-uninstall-during-transfer" }))
      .rejects.toMatchObject({ code: "invalid_state_transition" });
    expect(await harness.service.status()).toMatchObject({
      state: "active",
      installation_id: installed.record.installation_id,
      grant_id: installed.record.grant_id,
    });
  });

  it("blocks rollback into an app that cannot read retained data without changing lifecycle or owner bytes", async () => {
    const lifecycleRoot = await root("bd-resume-m6-rollback-");
    const harness = await createLifecycleHarness(lifecycleRoot);
    harness.dependencies.ownerDataLifecycle = new ResumeDataLifecycleAdapter(lifecycleRoot, harness.ownerDataRoot);
    await harness.service.install({ version: "1.0.0", idempotencyKey: "m6-rollback-install-v1", approveCapabilities: true });
    const updated = await harness.service.update({ version: "2.0.0", idempotencyKey: "m6-rollback-update-v2", approveCapabilities: true });
    const catalogPath = path.join(harness.ownerDataRoot, "catalog.json");
    await new ResumeDataStore(lifecycleRoot, harness.ownerDataRoot, {}, false).initialize(testGrant().owner_id);
    const newerBytes = await readFile(catalogPath, "utf8");

    await expect(harness.service.rollback({ idempotencyKey: "m6-rollback-incompatible" }))
      .rejects.toMatchObject({ code: "incompatible_schema" });
    expect(await harness.service.status()).toMatchObject({
      state: "active",
      active_package_digest: updated.record.active_package_digest,
      generation: updated.record.generation,
    });
    expect(await readFile(catalogPath, "utf8")).toBe(newerBytes);
  });

  it("leaves the active runtime and lifecycle pointer intact when update data compatibility fails before staging", async () => {
    const lifecycleRoot = await root("bd-resume-m6-update-compatibility-");
    const harness = await createLifecycleHarness(lifecycleRoot);
    const installed = await harness.service.install({ version: "1.0.0", idempotencyKey: "m6-update-guard-install", approveCapabilities: true });
    harness.dependencies.ownerDataLifecycle = {
      prepareActivation: async () => { throw Object.assign(new Error("synthetic incompatibility"), { code: "incompatible_schema" }); },
      cleanupDefaultUninstall: async () => undefined,
    };
    await expect(harness.service.update({ version: "2.0.0", idempotencyKey: "m6-update-guard-failure", approveCapabilities: true }))
      .rejects.toMatchObject({ code: "incompatible_schema" });
    expect(await harness.service.status()).toMatchObject({
      state: "active",
      active_package_digest: installed.record.active_package_digest,
      generation: installed.record.generation,
    });
    expect(harness.supervisor.inspect(installed.record.installation_id!)).toHaveLength(1);
  });

  it("allows default uninstall to revoke runtime authority while preserving corrupt retained data for repair", async () => {
    const lifecycleRoot = await root("bd-resume-m6-corrupt-uninstall-");
    const harness = await createLifecycleHarness(lifecycleRoot);
    harness.dependencies.ownerDataLifecycle = new ResumeDataLifecycleAdapter(lifecycleRoot, harness.ownerDataRoot);
    const installed = await harness.service.install({ version: "1.0.0", idempotencyKey: "m6-corrupt-uninstall-install", approveCapabilities: true });
    const catalogPath = path.join(harness.ownerDataRoot, "catalog.json");
    const corruptBytes = "{corrupt-retained-data\n";
    await mkdir(harness.ownerDataRoot, { recursive: true });
    await writeFile(catalogPath, corruptBytes, "utf8");

    await expect(harness.service.uninstall({ idempotencyKey: "m6-corrupt-uninstall-action" }))
      .resolves.toMatchObject({ record: { state: "not_installed" } });
    expect(await readFile(catalogPath, "utf8")).toBe(corruptBytes);
    expect(harness.supervisor.inspect(installed.record.installation_id!)).toHaveLength(0);
    expect(harness.tokenBroker.isRevoked(installed.record.installation_id!)).toBe(true);
  });
});
