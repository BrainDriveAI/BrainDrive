import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { getVaultSecret } from "../secrets/vault.js";
import { loadMasterKey } from "../secrets/key-provider.js";
import { resolveSecretsPaths } from "../secrets/paths.js";

const GIT_ACTOR = {
  GIT_AUTHOR_NAME: "PAA MVP",
  GIT_AUTHOR_EMAIL: "paa-mvp@local",
  GIT_COMMITTER_NAME: "PAA MVP",
  GIT_COMMITTER_EMAIL: "paa-mvp@local",
};

export const MEMORY_BACKUP_REMOTE_ALIAS = "backup-origin";
export const MEMORY_BACKUP_BRANCH = "braindrive-memory-backup";

type GitCommandOptions = {
  env?: NodeJS.ProcessEnv;
  includeSafeDirectory?: boolean;
};

export async function gitStatusPorcelain(memoryRoot: string): Promise<string> {
  const result = await runGit(["status", "--porcelain"], memoryRoot);
  return result.stdout;
}

export async function gitCommitAll(memoryRoot: string, message: string): Promise<void> {
  await runGit(["add", "."], memoryRoot);
  await runGit(["commit", "-m", message], memoryRoot);
}

export async function configureBackupRemote(memoryRoot: string, repositoryUrl: string): Promise<void> {
  const remotes = (await runGit(["remote"], memoryRoot)).stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (remotes.includes(MEMORY_BACKUP_REMOTE_ALIAS)) {
    await runGit(["remote", "set-url", MEMORY_BACKUP_REMOTE_ALIAS, repositoryUrl], memoryRoot);
    return;
  }
  await runGit(["remote", "add", MEMORY_BACKUP_REMOTE_ALIAS, repositoryUrl], memoryRoot);
}

export async function pushBackupBranch(memoryRoot: string, token: string): Promise<void> {
  await withGitAskPass(token, async (askPassEnv) => {
    await runGit(
      ["push", MEMORY_BACKUP_REMOTE_ALIAS, `HEAD:${MEMORY_BACKUP_BRANCH}`],
      memoryRoot,
      { env: askPassEnv }
    );
  });
}

export async function cloneBackupBranch(
  repositoryUrl: string,
  token: string,
  destinationPath: string
): Promise<void> {
  const cloneParent = path.dirname(destinationPath);
  const cloneName = path.basename(destinationPath);
  await withGitAskPass(token, async (askPassEnv) => {
    await runGit(
      [
        "clone",
        "--branch",
        MEMORY_BACKUP_BRANCH,
        "--single-branch",
        repositoryUrl,
        cloneName,
      ],
      cloneParent,
      {
        env: askPassEnv,
        includeSafeDirectory: false,
      }
    );
  });
}

export async function checkoutBackupCommit(backupRepoPath: string, commit: string): Promise<void> {
  const normalizedCommit = commit.trim();
  if (normalizedCommit.length === 0) {
    throw new Error("Target commit is required");
  }

  await runGit(["rev-parse", "--verify", `${normalizedCommit}^{commit}`], backupRepoPath);
  await runGit(["merge-base", "--is-ancestor", normalizedCommit, "HEAD"], backupRepoPath);
  await runGit(["checkout", normalizedCommit], backupRepoPath);
}

export async function readBackupHeadCommit(backupRepoPath: string): Promise<string> {
  return (await runGit(["rev-parse", "HEAD"], backupRepoPath)).stdout.trim();
}

export async function resolveMemoryBackupToken(secretRef: string): Promise<string> {
  const normalizedSecretRef = secretRef.trim();
  if (normalizedSecretRef.length === 0) {
    throw new Error("Memory backup token secret reference is missing");
  }

  const paths = resolveSecretsPaths();
  const masterKey = await loadMasterKey(paths);
  const token = await getVaultSecret(normalizedSecretRef, masterKey, paths);
  if (!token || token.trim().length === 0) {
    throw new Error("Memory backup token is not configured");
  }

  return token.trim();
}

export function sanitizeMemoryBackupError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("authentication failed") || message.includes("could not read username")) {
    return "Authentication failed for the backup repository. Verify repository access and PAT scope.";
  }
  if (message.includes("repository not found")) {
    return "Backup repository was not found or is not accessible.";
  }
  if (message.includes("couldn't find remote ref") || message.includes("remote branch")) {
    return "Backup branch is not available in the configured repository.";
  }
  if (message.includes("unable to access")) {
    return "Unable to reach the backup repository URL.";
  }
  if (message.includes("token")) {
    return "Backup token is missing or invalid.";
  }

  return "Memory backup operation failed.";
}

async function withGitAskPass(
  token: string,
  run: (env: NodeJS.ProcessEnv) => Promise<void>
): Promise<void> {
  const askPassRoot = await mkdtemp(path.join(tmpdir(), "paa-git-askpass-"));
  const askPassPath = path.join(askPassRoot, "askpass.sh");
  const askPassScript = [
    "#!/bin/sh",
    'case "$1" in',
    '  *Username*) printf "%s\\n" "${PAA_GIT_USERNAME:-x-access-token}" ;;',
    '  *) printf "%s\\n" "${PAA_GIT_PASSWORD}" ;;',
    "esac",
    "",
  ].join("\n");

  try {
    await writeFile(askPassPath, askPassScript, "utf8");
    await chmod(askPassPath, 0o700);
    await run({
      ...process.env,
      ...GIT_ACTOR,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: askPassPath,
      PAA_GIT_USERNAME: "x-access-token",
      PAA_GIT_PASSWORD: token,
    });
  } finally {
    await rm(askPassRoot, { recursive: true, force: true });
  }
}

async function runGit(
  args: string[],
  cwd: string,
  options: GitCommandOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const includeSafeDirectory = options.includeSafeDirectory ?? true;
  const safePrefix = includeSafeDirectory ? ["-c", "safe.directory=*"] : [];
  const fullArgs = [...safePrefix, ...args];

  return new Promise((resolve, reject) => {
    const child = spawn("git", fullArgs, {
      cwd,
      env: {
        ...process.env,
        ...GIT_ACTOR,
        ...(options.env ?? {}),
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `git ${fullArgs.join(" ")} failed with ${code}`));
    });
  });
}

export async function readRemoteUrl(memoryRoot: string, remoteAlias: string): Promise<string | null> {
  const gitConfigPath = path.join(memoryRoot, ".git", "config");
  try {
    const raw = await readFile(gitConfigPath, "utf8");
    const sectionPattern = new RegExp(
      `\\[remote\\s+"${escapeRegExp(remoteAlias)}"\\][\\s\\S]*?(?:\\n\\[|$)`,
      "m"
    );
    const sectionMatch = raw.match(sectionPattern);
    if (!sectionMatch) {
      return null;
    }
    const urlMatch = sectionMatch[0].match(/^\s*url\s*=\s*(.+)$/m);
    return urlMatch?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
