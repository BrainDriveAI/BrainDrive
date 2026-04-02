import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AuthMode, InstallMode } from "../contracts.js";

const SUPPORT_BUNDLE_FILE_NAME_PATTERN = /^support-bundle-\d{13}\.tar\.gz$/;
const AUDIT_FILE_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}(?:\.\d+)?\.jsonl$/;

export type CreateSupportBundleOptions = {
  windowHours: number;
  appVersion: string;
  installMode: InstallMode;
  authMode: AuthMode;
  actorId: string;
};

export type SupportBundleResult = {
  archive_path: string;
  file_name: string;
  included_audit_files: number;
};

export type SupportBundleEntry = {
  file_name: string;
  size_bytes: number;
  updated_at: string;
};

export async function createSupportBundle(
  memoryRoot: string,
  options: CreateSupportBundleOptions
): Promise<SupportBundleResult> {
  const supportBundleDir = supportBundleOutputDir(memoryRoot);
  await mkdir(supportBundleDir, { recursive: true });

  const timestamp = Date.now();
  const fileName = `support-bundle-${timestamp}.tar.gz`;
  const archivePath = path.join(supportBundleDir, fileName);

  const stagingParent = await mkdtemp(path.join(tmpdir(), "braindrive-support-bundle-"));
  const stagingRoot = path.join(stagingParent, "bundle");
  await mkdir(stagingRoot, { recursive: true });

  try {
    const generatedAt = new Date();
    const cutoffDateIso = new Date(generatedAt.getTime() - options.windowHours * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const copySummary = await copyAuditDiagnostics(memoryRoot, stagingRoot, cutoffDateIso);
    await writeRuntimeMetadata(stagingRoot, {
      generated_at: generatedAt.toISOString(),
      scope: "memory-only",
      app_version: options.appVersion,
      install_mode: options.installMode,
      auth_mode: options.authMode,
      actor_id: options.actorId,
      window_hours: options.windowHours,
      cutoff_date_utc: cutoffDateIso,
      included_audit_files: copySummary.includedFiles.length,
    });
    await writeFile(
      path.join(stagingRoot, "metadata", "included-audit-files.json"),
      `${JSON.stringify({ files: copySummary.includedFiles }, null, 2)}\n`,
      "utf8"
    );

    if (copySummary.includedFiles.length === 0) {
      await writeFile(
        path.join(stagingRoot, "metadata", "notes.txt"),
        "No audit JSONL files matched the requested window.\n",
        "utf8"
      );
    }

    await createTarArchive(stagingRoot, archivePath);
    return {
      archive_path: archivePath,
      file_name: fileName,
      included_audit_files: copySummary.includedFiles.length,
    };
  } finally {
    await rm(stagingParent, { recursive: true, force: true });
  }
}

export async function listSupportBundles(memoryRoot: string): Promise<SupportBundleEntry[]> {
  const supportBundleDir = supportBundleOutputDir(memoryRoot);
  try {
    await mkdir(supportBundleDir, { recursive: true });
  } catch {
    return [];
  }

  const entries = await readdir(supportBundleDir, { withFileTypes: true });
  const bundles: SupportBundleEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!SUPPORT_BUNDLE_FILE_NAME_PATTERN.test(entry.name)) {
      continue;
    }
    const absolutePath = path.join(supportBundleDir, entry.name);
    const fileStats = await stat(absolutePath);
    bundles.push({
      file_name: entry.name,
      size_bytes: fileStats.size,
      updated_at: fileStats.mtime.toISOString(),
    });
  }

  bundles.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  return bundles;
}

export function resolveSupportBundleDownloadPath(memoryRoot: string, fileName: string): string | null {
  if (!SUPPORT_BUNDLE_FILE_NAME_PATTERN.test(fileName)) {
    return null;
  }

  const supportBundleDir = supportBundleOutputDir(memoryRoot);
  const candidate = path.resolve(supportBundleDir, fileName);
  const normalizedDir = path.resolve(supportBundleDir);
  if (candidate !== normalizedDir && !candidate.startsWith(`${normalizedDir}${path.sep}`)) {
    return null;
  }

  return candidate;
}

async function writeRuntimeMetadata(stagingRoot: string, metadata: Record<string, unknown>): Promise<void> {
  const metadataDir = path.join(stagingRoot, "metadata");
  await mkdir(metadataDir, { recursive: true });
  await writeFile(path.join(metadataDir, "runtime-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function copyAuditDiagnostics(
  memoryRoot: string,
  stagingRoot: string,
  cutoffDateIso: string
): Promise<{ includedFiles: string[] }> {
  const auditSourceDir = path.join(memoryRoot, "diagnostics", "audit");
  const auditTargetDir = path.join(stagingRoot, "memory", "diagnostics", "audit");
  const includedFiles: string[] = [];

  try {
    const entries = await readdir(auditSourceDir, { withFileTypes: true });
    await mkdir(auditTargetDir, { recursive: true });
    for (const entry of entries) {
      if (!entry.isFile() || !AUDIT_FILE_NAME_PATTERN.test(entry.name)) {
        continue;
      }

      const dateSegment = entry.name.slice(0, 10);
      if (dateSegment < cutoffDateIso) {
        continue;
      }

      const sourceFile = path.join(auditSourceDir, entry.name);
      const targetFile = path.join(auditTargetDir, entry.name);
      await copyFile(sourceFile, targetFile);
      includedFiles.push(`memory/diagnostics/audit/${entry.name}`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  return { includedFiles };
}

function supportBundleOutputDir(memoryRoot: string): string {
  return path.join(memoryRoot, "exports", "support-bundles");
}

async function createTarArchive(sourceRoot: string, destinationPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-czf", destinationPath, "."], { cwd: sourceRoot });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `tar failed with ${code}`));
    });
  });
}
