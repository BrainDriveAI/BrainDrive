import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type GitResult = {
  stdout: string;
  stderr: string;
};

async function runGit(args: string[], cwd: string): Promise<GitResult> {
  const safeArgs = ["-c", `safe.directory=${cwd}`, ...args];
  return new Promise((resolve, reject) => {
    const child = spawn("git", safeArgs, {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "PAA MCP",
        GIT_AUTHOR_EMAIL: "paa-mcp@local",
        GIT_COMMITTER_NAME: "PAA MCP",
        GIT_COMMITTER_EMAIL: "paa-mcp@local",
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
  await mkdir(memoryRoot, { recursive: true });

  if (!(await hasOwnGitDirectory(memoryRoot))) {
    await runGit(["init"], memoryRoot);
  }

  const gitignorePath = path.join(memoryRoot, ".gitignore");
  await writeIfMissing(gitignorePath, "conversations/*.db-wal\nconversations/*.db-shm\nexports/*.tar.gz\n");

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
  await runGit(["commit", "-m", message], memoryRoot).catch(async (error: Error) => {
    if (!error.message.includes("nothing to commit")) {
      throw error;
    }
  });
}

export async function historyForPath(
  memoryRoot: string,
  targetPath: string
): Promise<Array<{ commit: string; message: string; timestamp: string }>> {
  const relativePath = path.relative(memoryRoot, targetPath);
  const result = await runGit(["log", "--format=%H%x1f%s%x1f%aI", "--", relativePath], memoryRoot);

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
  const snapshotParent = await mkdtemp(path.join(tmpdir(), "paa-memory-export-"));
  const snapshotRoot = path.join(snapshotParent, "snapshot");

  try {
    await cp(memoryRoot, snapshotRoot, { recursive: true, force: true });
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await createTarArchive(snapshotRoot, destinationPath);
  } finally {
    await rm(snapshotParent, { recursive: true, force: true });
  }
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

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    await writeFile(filePath, content, "utf8");
  }
}
