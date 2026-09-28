import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { AppLifecycleService } from "./service.js";
import { createLifecycleHarness } from "./test-helpers.js";
import { auditLog, configureAuditFileSink, disableAuditFileSink } from "../../logger.js";
import { createSupportBundle } from "../../memory/support-bundle.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const sha256 = (value: Buffer | string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const execFileAsync = promisify(execFile);
async function missing(filePath: string) { return stat(filePath).then(() => false, (error: NodeJS.ErrnoException) => error.code === "ENOENT"); }

describe("M6 selective uninstall and fresh reinstall", () => {
  it("removes runtime authority, grants, unshared code, and cache while retaining owner data, exports, and a minimal tombstone", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-m6-retention-")); roots.push(root);
    const h = await createLifecycleHarness(root);
    const installOperation = crypto.randomUUID();
    const installed = await h.service.install({ version: "1.0.0", operationId: installOperation, idempotencyKey: installOperation, approveCapabilities: true, ownerActorId: "owner", installationId: null, expectedGeneration: 0 });
    const packageRoot = (await h.store.readPackage(installed.record.active_package_digest!))!.package_root;
    const cacheRoot = path.join(h.dependencies.runtimeRoot, "cache", installed.record.installation_id!);
    const exportRoot = path.join(root, "exports");
    await Promise.all([mkdir(h.ownerDataRoot, { recursive: true }), mkdir(cacheRoot, { recursive: true }), mkdir(exportRoot, { recursive: true })]);
    const retainedPath = path.join(h.ownerDataRoot, "career-and-resume-history.json");
    const exportPath = path.join(exportRoot, "resume.pdf");
    await writeFile(retainedPath, JSON.stringify({ facts: ["opaque"], histories: [1, 2] }), "utf8");
    await writeFile(exportPath, Buffer.from("owner-export-bytes"));
    await writeFile(path.join(cacheRoot, "disposable.tmp"), "cache", "utf8");
    const before = { retained: sha256(await readFile(retainedPath)), ownerExport: sha256(await readFile(exportPath)) };

    const uninstallOperation = crypto.randomUUID();
    const result = await h.service.uninstall({ operationId: uninstallOperation, idempotencyKey: uninstallOperation, ownerActorId: "owner", installationId: installed.record.installation_id, expectedGeneration: installed.record.generation });
    expect(result.record).toMatchObject({ state: "not_installed", installation_id: null, active_package_digest: null, grant_id: null });
    expect(h.supervisor.inspect(installed.record.installation_id!)).toEqual([]);
    expect(h.tokenBroker.isRevoked(installed.record.installation_id!)).toBe(true);
    expect(await h.store.readGrant(installed.grant!.grant_id)).toBeNull();
    expect(await missing(packageRoot)).toBe(true);
    expect(await missing(cacheRoot)).toBe(true);
    expect({ retained: sha256(await readFile(retainedPath)), ownerExport: sha256(await readFile(exportPath)) }).toEqual(before);
    expect(await h.store.readUninstallJournal(uninstallOperation)).toMatchObject({ stage: "committed", package_roots: [], owner_data_preserved: true, retained_classes: expect.arrayContaining(["app_storage", "artifact_records", "export_receipts", "owner_exports", "lifecycle_tombstone"]) });
  });

  it("resumes safely after partial deletion and tolerates already-missing files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-m6-restart-")); roots.push(root);
    const h = await createLifecycleHarness(root);
    const installed = await h.service.install({ version: "1.0.0", idempotencyKey: "m6-restart-install", approveCapabilities: true });
    let interrupted = false;
    h.dependencies.beforeUninstallDelete = async () => { if (!interrupted) { interrupted = true; throw new Error("simulated locked file"); } };
    const operationId = crypto.randomUUID();
    await expect(h.service.uninstall({ operationId, idempotencyKey: operationId, installationId: installed.record.installation_id, expectedGeneration: installed.record.generation })).rejects.toThrow("simulated locked file");
    expect(await h.service.status()).toMatchObject({ state: "uninstalling", active_package_digest: null, grant_id: null, pending_operation_id: operationId });
    h.dependencies.beforeUninstallDelete = undefined;
    const restarted = new AppLifecycleService(h.dependencies);
    await restarted.initialize();
    expect(await restarted.status()).toMatchObject({ state: "not_installed", installation_id: null });
    expect((await h.store.readUninstallJournal(operationId))?.stage).toBe("committed");
  });

  it("keeps shared package bytes and creates fresh installation, grant, and operation identities on reinstall", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-m6-reinstall-")); roots.push(root);
    const h = await createLifecycleHarness(root);
    const first = await h.service.install({ version: "1.0.0", idempotencyKey: "m6-shared-install", approveCapabilities: true });
    const stored = (await h.store.readPackage(first.record.active_package_digest!))!;
    const sharedDigest = `sha256:${"f".repeat(64)}` as const;
    await h.store.savePackage({ ...stored, package_digest: sharedDigest });
    const uninstallOperation = crypto.randomUUID();
    await h.service.uninstall({ operationId: uninstallOperation, idempotencyKey: uninstallOperation, installationId: first.record.installation_id, expectedGeneration: first.record.generation });
    expect(await missing(stored.package_root)).toBe(false);
    expect(await h.store.readPackage(sharedDigest)).not.toBeNull();

    const reinstallOperation = crypto.randomUUID();
    const second = await h.service.reinstall({ version: "1.0.0", operationId: reinstallOperation, idempotencyKey: reinstallOperation, approveCapabilities: true, ownerActorId: "owner", installationId: null, expectedGeneration: (await h.service.status()).generation });
    expect(second.operation).toMatchObject({ operation_id: reinstallOperation, kind: "reinstall" });
    expect(second.record.installation_id).not.toBe(first.record.installation_id);
    expect(second.grant?.grant_id).not.toBe(first.grant?.grant_id);
    expect(second.grant?.revocation_generation).toBe(0);
  });

  it("projects lifecycle support diagnostics through an allowlist with no tokens, content, raw metadata, or broad paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-m6-support-")); roots.push(root);
    configureAuditFileSink(root);
    try {
      auditLog("app.lifecycle.uninstall_summary", {
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
        operation_id: crypto.randomUUID(),
        prior_state: "active",
        result_state: "not_installed",
        removed_classes: ["runtime_registration", "package_bytes"],
        retained_classes: ["app_storage", "owner_exports"],
        owner_data_preserved: true,
        package_root: root,
        connection_token: "secret-token-value",
        raw_metadata: { content: "owner resume content" },
      });
    } finally { disableAuditFileSink(); }
    const bundle = await createSupportBundle(root, { windowHours: 24, appVersion: "m6-test", installMode: "local", installLocation: "local", authMode: "local", actorId: "owner" });
    const extracted = path.join(root, "extracted");
    await mkdir(extracted, { recursive: true });
    await execFileAsync("tar", ["-xzf", bundle.archive_path, "-C", extracted]);
    const lifecycle = await readFile(path.join(extracted, "metadata", "lifecycle-diagnostics.jsonl"), "utf8");
    expect(lifecycle).toContain("app.lifecycle.uninstall_summary");
    expect(lifecycle).toContain("runtime_registration");
    for (const forbidden of [root, "secret-token-value", "owner resume content", "package_root", "connection_token", "raw_metadata"]) expect(lifecycle).not.toContain(forbidden);
  });
});
