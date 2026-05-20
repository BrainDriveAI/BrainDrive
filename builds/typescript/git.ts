import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type GitResult = {
  stdout: string;
  stderr: string;
};

const MEMORY_GITIGNORE_ENTRIES = [
  "conversations/*.db-wal",
  "conversations/*.db-shm",
  "exports/*.tar.gz",
  "system/updates/backups/*.tar.gz",
];

const MEMORY_ARCHIVE_EXCLUDES = [
  "./.git",
  "./.git/*",
  "./exports/*.tar.gz",
  "./system/updates/backups/*.tar.gz",
];

async function runGit(args: string[], cwd: string): Promise<GitResult> {
  const safeArgs = ["-c", `safe.directory=${cwd}`, ...args];
  return new Promise((resolve, reject) => {
    const child = spawn("git", safeArgs, {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "PAA MVP",
        GIT_AUTHOR_EMAIL: "paa-mvp@local",
        GIT_COMMITTER_NAME: "PAA MVP",
        GIT_COMMITTER_EMAIL: "paa-mvp@local",
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

      reject(new Error(stderr || stdout || `git ${safeArgs.join(" ")} failed with ${code}`));
    });
  });
}

export async function ensureGitReady(memoryRoot: string): Promise<void> {
  if (!(await hasOwnGitDirectory(memoryRoot))) {
    await runGit(["init"], memoryRoot);
  }

  const gitignorePath = path.join(memoryRoot, ".gitignore");
  await ensureGitIgnoreEntries(gitignorePath, MEMORY_GITIGNORE_ENTRIES);

  const status = await runGit(["status", "--porcelain"], memoryRoot);
  if (status.stdout.trim().length > 0) {
    await runGit(["add", "."], memoryRoot);
    await runGit(["commit", "-m", "Initialize memory root"], memoryRoot).catch(async (error: Error) => {
      if (!error.message.includes("nothing to commit")) {
        throw error;
      }
    });
  }
}

async function hasOwnGitDirectory(memoryRoot: string): Promise<boolean> {
  try {
    await access(path.join(memoryRoot, ".git"));
    return true;
  } catch {
    return false;
  }
}

export async function commitMemoryChange(memoryRoot: string, message: string): Promise<void> {
  const status = await runGit(["status", "--porcelain"], memoryRoot);
  if (status.stdout.trim().length === 0) {
    return;
  }

  await runGit(["add", "."], memoryRoot);
  await runGit(["commit", "-m", message], memoryRoot);
}

export async function historyForPath(memoryRoot: string, targetPath: string): Promise<Array<{ commit: string; message: string; timestamp: string }>> {
  const relativePath = path.relative(memoryRoot, targetPath);
  const result = await runGit([
    "log",
    "--format=%H%x1f%s%x1f%aI",
    "--",
    relativePath,
  ], memoryRoot);

  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [commit, message, timestamp] = line.split("\u001f");
      return { commit, message, timestamp };
    });
}

export async function readFileAtCommit(memoryRoot: string, targetPath: string, commit: string): Promise<string> {
  const relativePath = path.relative(memoryRoot, targetPath).replace(/\\/g, "/");
  const result = await runGit(["show", `${commit}:${relativePath}`], memoryRoot);
  return result.stdout;
}

export async function exportMemoryArchive(memoryRoot: string, destinationPath: string): Promise<void> {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await createTarArchive(memoryRoot, destinationPath, buildMemoryArchiveExcludes(memoryRoot, destinationPath));
}

function buildMemoryArchiveExcludes(memoryRoot: string, destinationPath: string): string[] {
  const excludes = [...MEMORY_ARCHIVE_EXCLUDES];
  const relativeDestination = path.relative(memoryRoot, destinationPath);
  if (relativeDestination && !relativeDestination.startsWith("..") && !path.isAbsolute(relativeDestination)) {
    excludes.push(`./${relativeDestination.split(path.sep).join("/")}`);
  }
  return excludes;
}

async function createTarArchive(sourceRoot: string, destinationPath: string, excludePatterns: string[] = []): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "tar",
      [...excludePatterns.map((pattern) => `--exclude=${pattern}`), "-czf", destinationPath, "."],
      { cwd: sourceRoot }
    );

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

async function ensureGitIgnoreEntries(filePath: string, entries: string[]): Promise<void> {
  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch {
    // Create the file below.
  }

  const existingEntries = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  );
  const missingEntries = entries.filter((entry) => !existingEntries.has(entry));
  if (missingEntries.length === 0) {
    return;
  }

  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(filePath, `${existing}${prefix}${missingEntries.join("\n")}\n`, "utf8");
}
