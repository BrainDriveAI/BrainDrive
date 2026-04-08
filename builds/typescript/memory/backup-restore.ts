import { cp, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Preferences } from "../contracts.js";
import { commitMemoryChange, ensureGitReady } from "../git.js";
import {
  checkoutBackupCommit,
  cloneBackupBranch,
  MEMORY_BACKUP_BRANCH,
  readBackupHeadCommit,
  resolveMemoryBackupToken,
  sanitizeMemoryBackupError,
} from "./backup-git.js";

export type MemoryBackupRestoreResult = {
  attempted_at: string;
  restored_at: string;
  commit: string;
  source_branch: string;
  warnings: string[];
};

export async function restoreMemoryBackup(
  memoryRoot: string,
  preferences: Preferences,
  options: {
    targetCommit?: string;
  } = {}
): Promise<MemoryBackupRestoreResult> {
  const attemptedAt = new Date().toISOString();
  const config = requireBackupConfig(preferences);
  const token = await resolveMemoryBackupToken(config.tokenSecretRef);
  const workspace = await mkdtemp(path.join(tmpdir(), "paa-memory-backup-restore-"));
  const cloneRoot = path.join(workspace, "backup-clone");
  const stageRoot = path.join(workspace, "staged-memory");
  const rollbackRoot = path.join(workspace, "rollback-memory");

  try {
    await cloneBackupBranch(config.repositoryUrl, token, cloneRoot);
    if (options.targetCommit?.trim()) {
      await checkoutBackupCommit(cloneRoot, options.targetCommit);
    }
    const restoredCommit = await readBackupHeadCommit(cloneRoot);

    await stageMemorySnapshot(cloneRoot, stageRoot);
    await validateStagedMemoryLayout(stageRoot);

    await mkdir(memoryRoot, { recursive: true });
    await cp(memoryRoot, rollbackRoot, { recursive: true, force: true });

    try {
      await replaceMemoryContents(memoryRoot, stageRoot);
      await ensureGitReady(memoryRoot);
      await commitMemoryChange(memoryRoot, `Restore memory backup snapshot ${restoredCommit}`);
    } catch (error) {
      await replaceMemoryContents(memoryRoot, rollbackRoot);
      throw error;
    }

    return {
      attempted_at: attemptedAt,
      restored_at: new Date().toISOString(),
      commit: restoredCommit,
      source_branch: MEMORY_BACKUP_BRANCH,
      warnings: [],
    };
  } catch (error) {
    throw new Error(sanitizeMemoryBackupError(error));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function stageMemorySnapshot(cloneRoot: string, stageRoot: string): Promise<void> {
  await mkdir(stageRoot, { recursive: true });
  const entries = await readdir(cloneRoot, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.name !== ".git")
      .map((entry) =>
        cp(path.join(cloneRoot, entry.name), path.join(stageRoot, entry.name), {
          recursive: true,
          force: true,
        })
      )
  );
}

async function validateStagedMemoryLayout(stageRoot: string): Promise<void> {
  const requiredDirectories = ["conversations", "documents", "preferences"];
  for (const dirName of requiredDirectories) {
    const candidate = path.join(stageRoot, dirName);
    const details = await stat(candidate).catch(() => null);
    if (!details?.isDirectory()) {
      throw new Error(`Backup snapshot is missing required memory directory: ${dirName}`);
    }
  }
}

async function replaceMemoryContents(destinationRoot: string, sourceRoot: string): Promise<void> {
  await mkdir(destinationRoot, { recursive: true });
  const existingEntries = await readdir(destinationRoot, { withFileTypes: true });
  await Promise.all(
    existingEntries
      .filter((entry) => entry.name !== ".git")
      .map((entry) => rm(path.join(destinationRoot, entry.name), { recursive: true, force: true }))
  );

  const sourceEntries = await readdir(sourceRoot, { withFileTypes: true });
  await Promise.all(
    sourceEntries
      .filter((entry) => entry.name !== ".git")
      .map((entry) =>
        cp(path.join(sourceRoot, entry.name), path.join(destinationRoot, entry.name), {
          recursive: true,
          force: true,
        })
      )
  );
}

function requireBackupConfig(preferences: Preferences): {
  repositoryUrl: string;
  tokenSecretRef: string;
} {
  const memoryBackup = preferences.memory_backup;
  if (!memoryBackup) {
    throw new Error("Memory backup settings are not configured");
  }
  if (!memoryBackup.repository_url || memoryBackup.repository_url.trim().length === 0) {
    throw new Error("Memory backup repository URL is not configured");
  }
  if (!memoryBackup.token_secret_ref || memoryBackup.token_secret_ref.trim().length === 0) {
    throw new Error("Memory backup token reference is not configured");
  }
  const repositoryUrl = memoryBackup.repository_url.trim();
  validateRepositoryUrl(repositoryUrl);

  return {
    repositoryUrl,
    tokenSecretRef: memoryBackup.token_secret_ref.trim(),
  };
}

function validateRepositoryUrl(repositoryUrl: string): void {
  const normalized = repositoryUrl.toLowerCase();
  if (normalized.startsWith("ssh://") || normalized.startsWith("git@")) {
    throw new Error("Only https:// repository URLs are supported");
  }
  let parsed: URL;
  try {
    parsed = new URL(repositoryUrl);
  } catch {
    throw new Error("Memory backup repository URL is invalid");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Only https:// repository URLs are supported");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Repository URL cannot include embedded credentials");
  }
}
