import type { Preferences } from "../contracts.js";
import { ensureGitReady } from "../git.js";
import {
  configureBackupRemote,
  gitCommitAll,
  gitStatusPorcelain,
  pushBackupBranch,
  resolveMemoryBackupToken,
  sanitizeMemoryBackupError,
} from "./backup-git.js";

export type MemoryBackupRunResult = {
  attempted_at: string;
  saved_at?: string;
  result: "success" | "failed" | "noop";
  message?: string;
};

type BackupConfig = {
  repositoryUrl: string;
  tokenSecretRef: string;
};

export async function runMemoryBackup(
  memoryRoot: string,
  preferences: Preferences
): Promise<MemoryBackupRunResult> {
  const attemptedAt = new Date().toISOString();

  try {
    const config = requireBackupConfig(preferences);
    const token = await resolveMemoryBackupToken(config.tokenSecretRef);

    await ensureGitReady(memoryRoot);
    const status = await gitStatusPorcelain(memoryRoot);
    const hasLocalChanges = status.trim().length > 0;

    if (hasLocalChanges) {
      await gitCommitAll(memoryRoot, `Memory backup snapshot ${attemptedAt}`);
    }

    await configureBackupRemote(memoryRoot, config.repositoryUrl);
    await pushBackupBranch(memoryRoot, token);

    const savedAt = new Date().toISOString();
    if (hasLocalChanges) {
      return {
        attempted_at: attemptedAt,
        saved_at: savedAt,
        result: "success",
      };
    }

    return {
      attempted_at: attemptedAt,
      saved_at: savedAt,
      result: "noop",
      message: "No local changes to snapshot; backup branch was synchronized.",
    };
  } catch (error) {
    return {
      attempted_at: attemptedAt,
      result: "failed",
      message: sanitizeMemoryBackupError(error),
    };
  }
}

function requireBackupConfig(preferences: Preferences): BackupConfig {
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
