import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { canonicalInputDigest, canonicalJson } from "../contracts/common.js";
import { LifecycleOperationSchema, LifecycleRecordSchema } from "../contracts/lifecycle.js";
import { CapabilityGrantSchema, PackageManifestSchema, PackageTrustSchema } from "../contracts/package.js";
import { AppPlatformError } from "./errors.js";

const RESUME_APP_ID = "ai.braindrive.resume-builder";

const MigrationReceiptSchema = z.object({
  receipt_version: z.literal(1),
  app_id: z.literal(RESUME_APP_ID),
  from_layout: z.literal("state/registry"),
  to_layout: z.literal("state/apps/resume-builder/registry"),
  source_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  pre_migration_snapshot_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  destination_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  committed_at: z.string().datetime(),
}).strict();

export type ResumeControlStateMigrationResult = {
  outcome: "missing" | "migrated" | "recovered_partial" | "already_migrated";
  app_id: typeof RESUME_APP_ID;
  source_digest: `sha256:${string}` | null;
  destination_digest: `sha256:${string}` | null;
  pre_migration_snapshot_digest: `sha256:${string}` | null;
};

type MigrationFile = { relative: string; bytes: Buffer; digest: `sha256:${string}` };

async function exists(target: string): Promise<boolean> {
  try { await lstat(target); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function collectFiles(root: string): Promise<MigrationFile[]> {
  const files: MigrationFile[] = [];
  async function visit(current: string, relativeRoot: string): Promise<void> {
    const names = await readdir(current);
    for (const name of names.sort()) {
      if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new AppPlatformError("store_corrupt", "Legacy control state contains an unsafe entry name");
      const target = path.join(current, name);
      const relative = relativeRoot ? `${relativeRoot}/${name}` : name;
      const metadata = await lstat(target);
      if (metadata.isSymbolicLink()) throw new AppPlatformError("store_corrupt", "Legacy control state contains a symbolic link");
      if (metadata.isDirectory()) await visit(target, relative);
      else if (metadata.isFile() && name.endsWith(".json")) {
        const bytes = await readFile(target);
        try { JSON.parse(bytes.toString("utf8")); }
        catch { throw new AppPlatformError("store_corrupt", "Legacy control state contains invalid JSON"); }
        files.push({ relative, bytes, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` });
      } else {
        throw new AppPlatformError("store_corrupt", "Legacy control state contains an unsupported entry");
      }
    }
  }
  await visit(root, "");
  return files.sort((left, right) => left.relative.localeCompare(right.relative));
}

function validateLegacyRecords(files: readonly MigrationFile[]): void {
  const byName = new Map(files.map((file) => [file.relative, file]));
  const lifecycleFile = byName.get("lifecycle.json");
  if (!lifecycleFile) throw new AppPlatformError("store_corrupt", "Legacy Resume lifecycle record is missing");
  try {
    const lifecycle = LifecycleRecordSchema.parse(JSON.parse(lifecycleFile.bytes.toString("utf8")));
    if (lifecycle.app_id !== RESUME_APP_ID) throw new Error("identity mismatch");
    for (const file of files) {
      const value = JSON.parse(file.bytes.toString("utf8"));
      if (file.relative.startsWith("operations/")) {
        const operation = LifecycleOperationSchema.parse(value);
        if (operation.app_id !== RESUME_APP_ID) throw new Error("identity mismatch");
      } else if (file.relative.startsWith("grants/")) {
        const grant = CapabilityGrantSchema.parse(value);
        if (grant.app_id !== RESUME_APP_ID) throw new Error("identity mismatch");
      } else if (file.relative.startsWith("packages/")) {
        if (!value || typeof value !== "object" || (value as { store_version?: unknown }).store_version !== 1) throw new Error("invalid stored package");
        const stored = value as { package_digest?: unknown; manifest?: unknown; trust?: unknown };
        const manifest = PackageManifestSchema.parse(stored.manifest);
        PackageTrustSchema.parse(stored.trust);
        if (manifest.app_id !== RESUME_APP_ID || typeof stored.package_digest !== "string") throw new Error("identity mismatch");
      }
    }
  } catch (error) {
    if (error instanceof AppPlatformError) throw error;
    throw new AppPlatformError("store_corrupt", "Legacy Resume control state failed bounded validation");
  }
}

function treeDigest(files: readonly MigrationFile[]): `sha256:${string}` {
  return canonicalInputDigest(files.map((file) => ({ path: file.relative, digest: file.digest, size_bytes: file.bytes.length })));
}

async function copyFiles(files: readonly MigrationFile[], targetRoot: string): Promise<void> {
  await mkdir(targetRoot, { recursive: true, mode: 0o700 });
  for (const file of files) {
    const target = path.join(targetRoot, ...file.relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const handle = await open(target, "wx", 0o600);
    try { await handle.writeFile(file.bytes); await handle.sync(); }
    finally { await handle.close(); }
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try { await handle.sync(); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!(process.platform === "win32" && (code === "EPERM" || code === "EINVAL" || code === "ENOTSUP"))) throw error;
  } finally { await handle.close(); }
}

async function writeAtomicJson(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(`${canonicalJson(value)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary, target); await syncDirectory(path.dirname(target)); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

type ResumeControlStateMigrationInput = {
  stateRoot: string;
  beforeDestinationCommit?: () => Promise<void>;
  audit?: (event: string, details: Record<string, unknown>) => void;
};

async function runLegacyResumeControlStateMigration(input: ResumeControlStateMigrationInput): Promise<ResumeControlStateMigrationResult> {
  const stateRoot = path.resolve(input.stateRoot);
  const sourceRegistry = path.join(stateRoot, "registry");
  if (!(await exists(sourceRegistry))) {
    return { outcome: "missing", app_id: RESUME_APP_ID, source_digest: null, destination_digest: null, pre_migration_snapshot_digest: null };
  }
  const sourceFiles = await collectFiles(sourceRegistry);
  validateLegacyRecords(sourceFiles);
  const sourceDigest = treeDigest(sourceFiles);
  const appRoot = path.join(stateRoot, "apps", "resume-builder");
  const destinationRegistry = path.join(appRoot, "registry");
  const receiptPath = path.join(appRoot, "migration-receipt.json");
  const evidenceRoot = path.join(stateRoot, "migration-evidence", "resume-builder", sourceDigest.slice(7));
  const evidenceRegistry = path.join(evidenceRoot, "registry");

  if (!(await exists(evidenceRegistry))) {
    const evidenceTemporary = `${evidenceRoot}.${randomUUID()}.tmp`;
    await copyFiles(sourceFiles, path.join(evidenceTemporary, "registry"));
    const evidenceFiles = await collectFiles(path.join(evidenceTemporary, "registry"));
    if (treeDigest(evidenceFiles) !== sourceDigest) throw new AppPlatformError("store_corrupt", "Pre-migration control snapshot verification failed");
    await mkdir(path.dirname(evidenceRoot), { recursive: true, mode: 0o700 });
    try { await rename(evidenceTemporary, evidenceRoot); await syncDirectory(path.dirname(evidenceRoot)); }
    catch (error) {
      await rm(evidenceTemporary, { recursive: true, force: true });
      if (!(await exists(evidenceRoot))) throw error;
    }
  }
  const snapshotFiles = await collectFiles(evidenceRegistry);
  const snapshotDigest = treeDigest(snapshotFiles);
  if (snapshotDigest !== sourceDigest) throw new AppPlatformError("conflict", "Pre-migration control snapshot conflicts with legacy source");

  const receipt = await (async () => {
    try { return MigrationReceiptSchema.parse(JSON.parse(await readFile(receiptPath, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new AppPlatformError("store_corrupt", "Resume control-state migration receipt is invalid"); }
  })();
  const destinationExists = await exists(destinationRegistry);
  if (destinationExists) {
    const destinationFiles = await collectFiles(destinationRegistry);
    validateLegacyRecords(destinationFiles);
    const destinationDigest = treeDigest(destinationFiles);
    if (receipt) {
      if (
        receipt.source_digest !== sourceDigest ||
        receipt.pre_migration_snapshot_digest !== snapshotDigest ||
        receipt.destination_digest !== sourceDigest
      ) throw new AppPlatformError("conflict", "Resume control-state migration receipt conflicts with verified source evidence");
      return {
        outcome: "already_migrated",
        app_id: RESUME_APP_ID,
        source_digest: sourceDigest,
        destination_digest: destinationDigest,
        pre_migration_snapshot_digest: snapshotDigest,
      };
    }
    if (destinationDigest !== sourceDigest) throw new AppPlatformError("conflict", "Legacy and app-scoped Resume control state conflict");
    await writeAtomicJson(receiptPath, {
      receipt_version: 1,
      app_id: RESUME_APP_ID,
      from_layout: "state/registry",
      to_layout: "state/apps/resume-builder/registry",
      source_digest: sourceDigest,
      pre_migration_snapshot_digest: snapshotDigest,
      destination_digest: destinationDigest,
      committed_at: new Date().toISOString(),
    });
    return {
      outcome: "recovered_partial",
      app_id: RESUME_APP_ID,
      source_digest: sourceDigest,
      destination_digest: destinationDigest,
      pre_migration_snapshot_digest: snapshotDigest,
    };
  }
  if (receipt) throw new AppPlatformError("conflict", "Resume migration receipt exists without committed app-scoped state");

  await mkdir(path.dirname(appRoot), { recursive: true, mode: 0o700 });
  const appTemporary = `${appRoot}.${randomUUID()}.tmp`;
  try {
    await copyFiles(snapshotFiles, path.join(appTemporary, "registry"));
    const stagedFiles = await collectFiles(path.join(appTemporary, "registry"));
    const stagedDigest = treeDigest(stagedFiles);
    if (stagedDigest !== sourceDigest) throw new AppPlatformError("store_corrupt", "Staged app-scoped Resume control state failed digest verification");
    await input.beforeDestinationCommit?.();
    await rename(appTemporary, appRoot);
    await syncDirectory(path.dirname(appRoot));
    await writeAtomicJson(receiptPath, {
      receipt_version: 1,
      app_id: RESUME_APP_ID,
      from_layout: "state/registry",
      to_layout: "state/apps/resume-builder/registry",
      source_digest: sourceDigest,
      pre_migration_snapshot_digest: snapshotDigest,
      destination_digest: stagedDigest,
      committed_at: new Date().toISOString(),
    });
    return { outcome: "migrated", app_id: RESUME_APP_ID, source_digest: sourceDigest, destination_digest: stagedDigest, pre_migration_snapshot_digest: snapshotDigest };
  } catch (error) {
    await rm(appTemporary, { recursive: true, force: true });
    throw error;
  }
}

export async function migrateLegacyResumeControlState(input: ResumeControlStateMigrationInput): Promise<ResumeControlStateMigrationResult> {
  try {
    const result = await runLegacyResumeControlStateMigration(input);
    input.audit?.("app.control_state_migration.completed", {
      app_id: RESUME_APP_ID,
      operation_id: null,
      from_layout: "singleton_v1",
      to_layout: "app_scoped_v1",
      outcome: result.outcome,
      recovery_action: result.outcome === "recovered_partial" ? "complete_receipt" : "none",
      source_digest: result.source_digest,
      destination_digest: result.destination_digest,
      pre_migration_snapshot_digest: result.pre_migration_snapshot_digest,
    });
    return result;
  } catch (error) {
    input.audit?.("app.control_state_migration.failed", {
      app_id: RESUME_APP_ID,
      operation_id: null,
      from_layout: "singleton_v1",
      to_layout: "app_scoped_v1",
      outcome: "failed",
      recovery_action: "preserve_legacy_and_pre_migration_evidence",
      error_code: error instanceof AppPlatformError ? error.code : "lifecycle_failed",
    });
    throw error;
  }
}
