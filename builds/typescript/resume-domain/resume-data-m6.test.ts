import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { authority, proposalInput, testGrant } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function root(prefix: string) {
  const value = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(value);
  return value;
}

const compatibility = { read_min: 1, read_max: 1, write_version: 1 } as const;

describe("M6 migration, retention, and retained-data lifecycle", () => {
  it("runs the deterministic 0-to-1 step with recovery and exact provenance while preserving extensions", async () => {
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
    expect(catalog).toMatchObject({ data_schema_version: 1, extensions: legacy.extensions });
    const migrations = await store.list("migration");
    expect(migrations).toHaveLength(1);
    expect(migrations[0]).toMatchObject({
      from_schema_version: 0,
      to_schema_version: 1,
      status: "committed",
      extensions: {
        migration_provenance: {
          provenance_version: 1,
          transformer_id: "resume-data.schema-0-to-1",
          method: "deterministic_no_ai",
        },
      },
    });
    expect((await store.integrityScan()).status).toBe("verified");
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
      expect((await restarted.catalog()).data_schema_version).toBe(1);
      expect((await restarted.integrityScan()).staged_transaction_count).toBe(0);
    }
  });

  it("blocks an unreadable newer schema without changing bytes and offers owner-safe repair/export state", async () => {
    const memoryRoot = await root("bd-resume-m6-newer-");
    const store = new ResumeDataStore(memoryRoot, undefined, {}, false);
    await store.initialize(testGrant().owner_id);
    const catalogPath = path.join(store.namespaceRoot, "catalog.json");
    const newer = { ...JSON.parse(await readFile(catalogPath, "utf8")), data_schema_version: 2 };
    const retained = `${JSON.stringify(newer)}\n`;
    await writeFile(catalogPath, retained, "utf8");
    const adapter = new ResumeDataLifecycleAdapter(memoryRoot, store.namespaceRoot);
    await expect(adapter.prepareActivation({ ownerId: testGrant().owner_id, compatibility, reason: "rollback" })).rejects.toMatchObject({ code: "incompatible_schema" });
    expect(await readFile(catalogPath, "utf8")).toBe(retained);
    await expect(adapter.repairState(compatibility)).resolves.toMatchObject({
      state: "incompatible",
      retained_schema_version: 2,
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
    expect(prepared.receipt).toMatchObject({ export_version: 1, record_count: 2, schema_version: 1 });
    expect(JSON.stringify(prepared.receipt)).not.toContain(memoryRoot);
    expect(JSON.stringify(prepared.receipt)).not.toContain("path");
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
    await expect(validateResumeDataTransfer(dataRoot)).resolves.toMatchObject({ state: "verified", schema_version: 1 });
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
    const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    const newerBytes = `${JSON.stringify({ ...catalog, data_schema_version: 2 })}\n`;
    await writeFile(catalogPath, newerBytes, "utf8");

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
    await writeFile(catalogPath, corruptBytes, "utf8");

    await expect(harness.service.uninstall({ idempotencyKey: "m6-corrupt-uninstall-action" }))
      .resolves.toMatchObject({ record: { state: "not_installed" } });
    expect(await readFile(catalogPath, "utf8")).toBe(corruptBytes);
    expect(harness.supervisor.inspect(installed.record.installation_id!)).toHaveLength(0);
    expect(harness.tokenBroker.isRevoked(installed.record.installation_id!)).toBe(true);
  });
});
