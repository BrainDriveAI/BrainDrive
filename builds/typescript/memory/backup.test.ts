import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";

import { beforeEach, describe, expect, it, vi } from "vitest";
const {
  ensureGitReadyMock,
  commitMemoryChangeMock,
  gitStatusPorcelainMock,
  gitCommitAllMock,
  configureBackupRemoteMock,
  pushBackupBranchMock,
  resolveMemoryBackupTokenMock,
  sanitizeMemoryBackupErrorMock,
  cloneBackupBranchMock,
  checkoutBackupCommitMock,
  readBackupHeadCommitMock,
} = vi.hoisted(() => ({
  ensureGitReadyMock: vi.fn<(memoryRoot: string) => Promise<void>>(async () => {}),
  commitMemoryChangeMock: vi.fn<(memoryRoot: string, message: string) => Promise<void>>(async () => {}),
  gitStatusPorcelainMock: vi.fn<(memoryRoot: string) => Promise<string>>(async () => ""),
  gitCommitAllMock: vi.fn<(memoryRoot: string, message: string) => Promise<void>>(async () => {}),
  configureBackupRemoteMock: vi.fn<(memoryRoot: string, repositoryUrl: string) => Promise<void>>(async () => {}),
  pushBackupBranchMock: vi.fn<(memoryRoot: string, token: string) => Promise<void>>(async () => {}),
  resolveMemoryBackupTokenMock: vi.fn<(secretRef: string) => Promise<string>>(async () => "token-value"),
  sanitizeMemoryBackupErrorMock: vi.fn<(error: unknown) => string>((error: unknown) =>
    error instanceof Error ? error.message : "Memory backup operation failed."
  ),
  cloneBackupBranchMock: vi.fn<
    (repositoryUrl: string, token: string, destinationPath: string) => Promise<void>
  >(async () => {}),
  checkoutBackupCommitMock: vi.fn<(backupRepoPath: string, commit: string) => Promise<void>>(async () => {}),
  readBackupHeadCommitMock: vi.fn<(backupRepoPath: string) => Promise<string>>(async () => "abc123def456"),
}));

vi.mock("../git.js", () => ({
  ensureGitReady: ensureGitReadyMock,
  commitMemoryChange: commitMemoryChangeMock,
}));

vi.mock("./backup-git.js", () => ({
  gitStatusPorcelain: gitStatusPorcelainMock,
  gitCommitAll: gitCommitAllMock,
  configureBackupRemote: configureBackupRemoteMock,
  pushBackupBranch: pushBackupBranchMock,
  resolveMemoryBackupToken: resolveMemoryBackupTokenMock,
  sanitizeMemoryBackupError: sanitizeMemoryBackupErrorMock,
  cloneBackupBranch: cloneBackupBranchMock,
  checkoutBackupCommit: checkoutBackupCommitMock,
  readBackupHeadCommit: readBackupHeadCommitMock,
  MEMORY_BACKUP_BRANCH: "braindrive-memory-backup",
}));

import type { Preferences } from "../contracts.js";
import { runMemoryBackup } from "./backup.js";
import { restoreMemoryBackup } from "./backup-restore.js";

function withBackupPreferences(
  patch: Partial<NonNullable<Preferences["memory_backup"]>> = {}
): Preferences {
  return {
    default_model: "openai/gpt-4o-mini",
    approval_mode: "ask-on-write",
    memory_backup: {
      repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
      frequency: "manual",
      token_secret_ref: "backup/git/token",
      ...patch,
    },
  };
}

describe("memory backup engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureGitReadyMock.mockResolvedValue(undefined);
    commitMemoryChangeMock.mockResolvedValue(undefined);
    gitStatusPorcelainMock.mockResolvedValue("");
    gitCommitAllMock.mockResolvedValue(undefined);
    configureBackupRemoteMock.mockResolvedValue(undefined);
    pushBackupBranchMock.mockResolvedValue(undefined);
    resolveMemoryBackupTokenMock.mockResolvedValue("token-value");
    sanitizeMemoryBackupErrorMock.mockImplementation((error: unknown) =>
      error instanceof Error ? error.message : "Memory backup operation failed."
    );
    cloneBackupBranchMock.mockResolvedValue(undefined);
    checkoutBackupCommitMock.mockResolvedValue(undefined);
    readBackupHeadCommitMock.mockResolvedValue("abc123def456");
  });

  it("saves snapshot commit and pushes backup when memory root is dirty", async () => {
    gitStatusPorcelainMock.mockResolvedValue(" M documents/note.md\n");

    const result = await runMemoryBackup("/tmp/memory", withBackupPreferences());

    expect(result.result).toBe("success");
    expect(result.saved_at).toBeDefined();
    expect(ensureGitReadyMock).toHaveBeenCalledWith("/tmp/memory");
    expect(gitCommitAllMock).toHaveBeenCalledTimes(1);
    expect(configureBackupRemoteMock).toHaveBeenCalledWith(
      "/tmp/memory",
      "https://github.com/BrainDriveAI/braindrive-memory.git"
    );
    expect(pushBackupBranchMock).toHaveBeenCalledWith("/tmp/memory", "token-value");
  });

  it("fails when token resolution fails", async () => {
    resolveMemoryBackupTokenMock.mockRejectedValue(new Error("token missing"));

    const result = await runMemoryBackup("/tmp/memory", withBackupPreferences());

    expect(result.result).toBe("failed");
    expect(result.message).toContain("token missing");
  });

  it("fails for invalid repository URL", async () => {
    const result = await runMemoryBackup(
      "/tmp/memory",
      withBackupPreferences({ repository_url: "ssh://github.com/BrainDriveAI/braindrive-memory.git" })
    );

    expect(result.result).toBe("failed");
    expect(configureBackupRemoteMock).not.toHaveBeenCalled();
  });

  it("returns noop when tree is clean and push succeeds", async () => {
    gitStatusPorcelainMock.mockResolvedValue("");

    const result = await runMemoryBackup("/tmp/memory", withBackupPreferences());

    expect(result.result).toBe("noop");
    expect(gitCommitAllMock).not.toHaveBeenCalled();
    expect(pushBackupBranchMock).toHaveBeenCalledTimes(1);
  });

  it("redacts sensitive push failures through sanitized messages", async () => {
    pushBackupBranchMock.mockRejectedValue(
      new Error("Authentication failed for https://x-access-token:secret123@github.com/org/repo.git")
    );
    sanitizeMemoryBackupErrorMock.mockReturnValue(
      "Authentication failed for the backup repository. Verify repository access and PAT scope."
    );

    const result = await runMemoryBackup("/tmp/memory", withBackupPreferences());

    expect(result.result).toBe("failed");
    expect(result.message).toContain("Authentication failed");
    expect(result.message).not.toContain("secret123");
  });
});

describe("memory backup restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureGitReadyMock.mockResolvedValue(undefined);
    commitMemoryChangeMock.mockResolvedValue(undefined);
    resolveMemoryBackupTokenMock.mockResolvedValue("token-value");
    sanitizeMemoryBackupErrorMock.mockImplementation((error: unknown) =>
      error instanceof Error ? error.message : "Memory backup operation failed."
    );
    cloneBackupBranchMock.mockResolvedValue(undefined);
    checkoutBackupCommitMock.mockResolvedValue(undefined);
    readBackupHeadCommitMock.mockResolvedValue("abc123def456");
  });

  it("restores memory snapshot from backup branch", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "paa-backup-restore-test-"));
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "documents"), { recursive: true });
      await mkdir(path.join(memoryRoot, "conversations"), { recursive: true });
      await mkdir(path.join(memoryRoot, "preferences"), { recursive: true });
      await writeFile(path.join(memoryRoot, "documents", "note.md"), "mutated\n", "utf8");
      await writeFile(path.join(memoryRoot, "preferences", "default.json"), '{"default_model":"mutated"}\n', "utf8");

      cloneBackupBranchMock.mockImplementation(async (_url: string, _token: string, destinationPath: string) => {
        await mkdir(path.join(destinationPath, "documents"), { recursive: true });
        await mkdir(path.join(destinationPath, "conversations"), { recursive: true });
        await mkdir(path.join(destinationPath, "preferences"), { recursive: true });
        await writeFile(path.join(destinationPath, "documents", "note.md"), "restored\n", "utf8");
        await writeFile(
          path.join(destinationPath, "preferences", "default.json"),
          '{"default_model":"restored"}\n',
          "utf8"
        );
      });

      const result = await restoreMemoryBackup(memoryRoot, withBackupPreferences(), {});
      const restoredNote = await readFile(path.join(memoryRoot, "documents", "note.md"), "utf8");

      expect(result.commit).toBe("abc123def456");
      expect(restoredNote).toBe("restored\n");
      expect(commitMemoryChangeMock).toHaveBeenCalledTimes(1);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rolls back local memory if restore apply fails", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "paa-backup-rollback-test-"));
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "documents"), { recursive: true });
      await mkdir(path.join(memoryRoot, "conversations"), { recursive: true });
      await mkdir(path.join(memoryRoot, "preferences"), { recursive: true });
      await writeFile(path.join(memoryRoot, "documents", "note.md"), "pre-restore\n", "utf8");
      await writeFile(path.join(memoryRoot, "preferences", "default.json"), '{"default_model":"pre"}\n', "utf8");

      cloneBackupBranchMock.mockImplementation(async (_url: string, _token: string, destinationPath: string) => {
        await mkdir(path.join(destinationPath, "documents"), { recursive: true });
        await mkdir(path.join(destinationPath, "conversations"), { recursive: true });
        await mkdir(path.join(destinationPath, "preferences"), { recursive: true });
        await writeFile(path.join(destinationPath, "documents", "note.md"), "from-backup\n", "utf8");
        await writeFile(
          path.join(destinationPath, "preferences", "default.json"),
          '{"default_model":"from-backup"}\n',
          "utf8"
        );
      });
      commitMemoryChangeMock.mockRejectedValueOnce(new Error("commit failed"));

      await expect(restoreMemoryBackup(memoryRoot, withBackupPreferences(), {})).rejects.toThrow(
        "commit failed"
      );
      const rolledBackNote = await readFile(path.join(memoryRoot, "documents", "note.md"), "utf8");
      expect(rolledBackNote).toBe("pre-restore\n");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
