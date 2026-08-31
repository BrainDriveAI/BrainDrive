import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AppLifecycleService } from "./service.js";
import { revokeFixtureVersion } from "./fixture-repository.js";
import { createLifecycleHarness } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function harness() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-lifecycle-"));
  roots.push(root);
  return createLifecycleHarness(root);
}

describe("trusted lifecycle service", () => {
  it("runs install, disable, enable, update, rollback, uninstall, and reinstall with exact durable states", async () => {
    const h = await harness();
    const install = await h.service.install({ version: "1.0.0", idempotencyKey: "install-key-00001", approveCapabilities: true });
    expect(install.record.state).toBe("active");
    expect(h.supervisor.inspect(install.record.installation_id!)).toHaveLength(1);

    expect((await h.service.disable({ idempotencyKey: "disable-key-00001" })).record.state).toBe("disabled");
    expect(h.supervisor.inspect(install.record.installation_id!)).toHaveLength(0);
    expect((await h.service.enable({ idempotencyKey: "enable-key-000001" })).record.state).toBe("active");

    const update = await h.service.update({ version: "2.0.0", idempotencyKey: "update-key-000001", approveCapabilities: true });
    expect(update.record.state).toBe("active");
    expect(update.record.last_known_good_package_digest).toBe(install.record.active_package_digest);
    expect((await h.service.rollback({ idempotencyKey: "rollback-key-0001" })).record.active_package_digest).toBe(install.record.active_package_digest);

    await mkdir(h.ownerDataRoot, { recursive: true });
    await writeFile(path.join(h.ownerDataRoot, "sentinel.json"), "owner-data\n", "utf8");
    expect((await h.service.uninstall({ idempotencyKey: "uninstall-key-001" })).record.state).toBe("not_installed");
    expect(await readFile(path.join(h.ownerDataRoot, "sentinel.json"), "utf8")).toBe("owner-data\n");
    const reinstall = await h.service.install({ version: "1.0.0", idempotencyKey: "reinstall-key-01", approveCapabilities: true });
    expect(reinstall.record.installation_id).not.toBe(install.record.installation_id);
    expect(reinstall.grant?.grant_id).not.toBe(install.grant?.grant_id);
  });

  it("uninstall removes runtime and token authority while retaining manifest-declared owner data for reinstall", async () => {
    const h = await harness();
    const install = await h.service.install({ version: "1.0.0", idempotencyKey: "install-key-00001", approveCapabilities: true });
    const session = await h.service.issueSession({
      audience: "app_data",
      capabilities: ["career.context.read"],
      operationId: crypto.randomUUID(),
    });
    await mkdir(h.ownerDataRoot, { recursive: true });
    await writeFile(path.join(h.ownerDataRoot, "retained.json"), "{}\n", "utf8");

    const uninstall = await h.service.uninstall({ idempotencyKey: "uninstall-key-001", installationId: install.record.installation_id });
    expect(uninstall.record.state).toBe("not_installed");
    expect(h.supervisor.inspect(install.record.installation_id!)).toEqual([]);
    expect(h.tokenBroker.isRevoked(install.record.installation_id!)).toBe(true);
    expect(() => h.tokenBroker.consume(session.token, {
      audience: "app_data",
      capability: "career.context.read",
      installationId: install.record.installation_id!,
      appId: h.service.appId,
    })).toThrowError(expect.objectContaining({ code: "token_revoked" }));
    expect(await readFile(path.join(h.ownerDataRoot, "retained.json"), "utf8")).toBe("{}\n");
    await expect(h.store.readUninstallJournal(uninstall.operation.operation_id)).resolves.toMatchObject({
      stage: "committed",
      retained_classes: ["app_storage", "artifact_records", "export_receipts", "owner_exports", "lifecycle_tombstone"],
      removed_classes: expect.arrayContaining(["runtime_registration", "capability_grant", "package_reference", "package_bytes", "disposable_cache"]),
    });

    const reinstall = await h.service.install({ version: "1.0.0", idempotencyKey: "reinstall-key-01", approveCapabilities: true });
    expect(reinstall.record.installation_id).not.toBe(install.record.installation_id);
    expect(reinstall.grant?.grant_id).not.toBe(install.grant?.grant_id);
    expect(h.supervisor.inspect(reinstall.record.installation_id!)).toHaveLength(1);
  });

  it("returns one committed result for duplicate retries and rejects conflicting/concurrent identities", async () => {
    const h = await harness();
    const input = { version: "1.0.0", idempotencyKey: "install-key-00001", approveCapabilities: true } as const;
    const first = await h.service.install(input);
    const retry = await h.service.install(input);
    expect(retry.operation.operation_id).toBe(first.operation.operation_id);
    expect(h.supervisor.startCount).toBe(1);
    await expect(h.service.install({ ...input, version: "2.0.0" })).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("keeps the active last-known-good runtime when candidate readiness fails", async () => {
    const h = await harness();
    const installed = await h.service.install({ version: "1.0.0", idempotencyKey: "install-key-00001", approveCapabilities: true });
    h.supervisor.failNextReadiness = true;
    await expect(h.service.update({ version: "2.0.0", idempotencyKey: "update-key-000001", approveCapabilities: true }))
      .rejects.toMatchObject({ code: "readiness_failed" });
    const status = await h.service.status();
    expect(status.active_package_digest).toBe(installed.record.active_package_digest);
    expect(h.supervisor.inspect(installed.record.installation_id!)).toHaveLength(1);
  });

  it("requires explicit approval for first install and widened update grants", async () => {
    const h = await harness();
    await expect(h.service.install({ version: "1.0.0", idempotencyKey: "install-key-00001", approveCapabilities: false }))
      .rejects.toMatchObject({ code: "grant_approval_required" });
    await h.service.install({ version: "1.0.0", idempotencyKey: "install-key-00002", approveCapabilities: true });
    await expect(h.service.update({ version: "2.0.0", idempotencyKey: "update-key-000001", approveCapabilities: false }))
      .rejects.toMatchObject({ code: "grant_widening_approval_required" });
  });

  it("cancels before the activation commit and reports recovered success after commit", async () => {
    const h = await harness();
    const original = h.dependencies.verifier.verifyAndExtract.bind(h.dependencies.verifier);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    h.dependencies.verifier.verifyAndExtract = async (...args) => { entered(); await gate; return original(...args); };
    const installing = h.service.install({ version: "1.0.0", idempotencyKey: "cancel-install-001", approveCapabilities: true });
    await started;
    const operation = (await h.store.listOperations())[0];
    expect((await h.service.cancel(operation.operation_id)).status).toBe("cancel_requested");
    release();
    await expect(installing).rejects.toMatchObject({ code: "operation_cancelled" });
    expect((await h.service.status()).state).toBe("not_installed");

    h.dependencies.verifier.verifyAndExtract = original;
    const committed = await h.service.install({ version: "1.0.0", idempotencyKey: "commit-install-001", approveCapabilities: true });
    expect((await h.service.cancel(committed.operation.operation_id)).commit_outcome).toBe("committed_response_recovered");
  });

  it("fails closed into quarantine on an explicit signed revocation and removes runtime authority", async () => {
    const h = await harness();
    const installed = await h.service.install({ version: "1.0.0", idempotencyKey: "install-key-00001", approveCapabilities: true });
    await revokeFixtureVersion(h.repository, "1.0.0");
    const quarantined = await h.service.enforceRevocations();
    expect(quarantined.state).toBe("quarantined");
    expect(h.supervisor.inspect(installed.record.installation_id!)).toEqual([]);
    expect(h.tokenBroker.isRevoked(installed.record.installation_id!)).toBe(true);
  });

  it("reconciles an active durable pointer after host restart and removes runtimes for disabled intent", async () => {
    const h = await harness();
    const installed = await h.service.install({ version: "1.0.0", idempotencyKey: "install-key-00001", approveCapabilities: true });
    await h.supervisor.stop(h.supervisor.inspect(installed.record.installation_id!)[0], "reconcile");
    const restarted = new AppLifecycleService(h.dependencies);
    await restarted.initialize();
    expect(h.supervisor.inspect(installed.record.installation_id!)).toHaveLength(1);
    await restarted.disable({ idempotencyKey: "disable-key-00001" });
    await restarted.initialize();
    expect(h.supervisor.inspect(installed.record.installation_id!)).toHaveLength(0);
  });

  it("fails closed without blocking startup when persisted active package metadata is stale", async () => {
    const h = await harness();
    const installed = await h.service.install({ version: "1.0.0", idempotencyKey: "install-key-00001", approveCapabilities: true });
    const digest = installed.record.active_package_digest!;
    const packagePath = path.join(h.store.root, "registry", "packages", `${digest.slice(7)}.json`);
    const stored = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, unknown>;
    stored.manifest = {
      manifest_version: 2,
      app_id: "ai.braindrive.resume-builder",
      publisher_id: "ai.braindrive",
      package_version: "1.0.0",
      presentations: {
        presentation_set_version: 1,
        default_presentation_id: "resume-chat",
        profiles: [],
        workspaces: [{
          workspace_id: "resume-chat",
          label: "Resume Chat",
          documents: [],
          actions: [{
            action_id: "resume.profile.update",
            input_schema_id: "resume.profile.update.input.v1",
            result_schema_id: "resume.profile.update.result.v1",
          }],
        }],
      },
      retention_policy: "retain_owner_data_remove_runtime_authority",
    };
    await writeFile(packagePath, `${JSON.stringify(stored)}\n`, "utf8");

    const restarted = new AppLifecycleService(h.dependencies);
    await expect(restarted.initialize()).resolves.toBeUndefined();
    await expect(restarted.ownerDescriptor()).resolves.toMatchObject({
      record: { state: "failed_recoverable", active_package_digest: digest },
      storedPackage: null,
    });
    expect(h.supervisor.inspect(installed.record.installation_id!)).toEqual([]);
    expect(h.tokenBroker.isRevoked(installed.record.installation_id!)).toBe(true);
    expect((await h.store.readGrant(installed.grant!.grant_id))?.revoked_at).not.toBeNull();
  });
});
