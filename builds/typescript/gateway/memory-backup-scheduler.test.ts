import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Preferences } from "../contracts.js";
import { MemoryBackupScheduler } from "./memory-backup-scheduler.js";

function clonePreferences(value: Preferences): Preferences {
  return JSON.parse(JSON.stringify(value)) as Preferences;
}

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

describe("memory backup scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("runs after_changes backup only after dirty debounce window", async () => {
    let preferences = withBackupPreferences({
      frequency: "after_changes",
    });

    const loadPreferencesFn = vi.fn(async () => clonePreferences(preferences));
    const savePreferencesFn = vi.fn(async (_memoryRoot: string, next: Preferences) => {
      preferences = clonePreferences(next);
    });
    const runMemoryBackupFn = vi.fn(async () => ({
      attempted_at: new Date(Date.now()).toISOString(),
      saved_at: new Date(Date.now()).toISOString(),
      result: "success" as const,
    }));
    const isMemoryDirtyFn = vi.fn(async () => true);

    const scheduler = new MemoryBackupScheduler({
      memoryRoot: "/tmp/memory",
      loadPreferencesFn,
      savePreferencesFn,
      runMemoryBackupFn,
      isMemoryDirtyFn,
      nowFn: () => new Date(Date.now()),
      afterChangesPollMs: 30_000,
      afterChangesDebounceMs: 20_000,
    });

    await scheduler.initialize();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runMemoryBackupFn).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(runMemoryBackupFn).toHaveBeenCalledTimes(1);
    expect(savePreferencesFn).toHaveBeenCalledTimes(1);
    expect(preferences.memory_backup?.last_result).toBe("success");

    scheduler.close();
  });

  it("schedules hourly runs based on last_attempt_at timestamp", async () => {
    let preferences = withBackupPreferences({
      frequency: "hourly",
      last_attempt_at: "2026-04-07T12:00:00.000Z",
    });

    vi.setSystemTime(new Date("2026-04-07T12:10:00.000Z"));

    const loadPreferencesFn = vi.fn(async () => clonePreferences(preferences));
    const savePreferencesFn = vi.fn(async (_memoryRoot: string, next: Preferences) => {
      preferences = clonePreferences(next);
    });
    const runMemoryBackupFn = vi.fn(async () => ({
      attempted_at: new Date(Date.now()).toISOString(),
      saved_at: new Date(Date.now()).toISOString(),
      result: "success" as const,
    }));

    const scheduler = new MemoryBackupScheduler({
      memoryRoot: "/tmp/memory",
      loadPreferencesFn,
      savePreferencesFn,
      runMemoryBackupFn,
      nowFn: () => new Date(Date.now()),
    });

    await scheduler.initialize();

    await vi.advanceTimersByTimeAsync(2_999_000);
    expect(runMemoryBackupFn).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(runMemoryBackupFn).toHaveBeenCalledTimes(1);

    scheduler.close();
  });

  it("shares a single in-flight manual backup run", async () => {
    let preferences = withBackupPreferences({ frequency: "manual" });

    const loadPreferencesFn = vi.fn(async () => clonePreferences(preferences));
    const savePreferencesFn = vi.fn(async (_memoryRoot: string, next: Preferences) => {
      preferences = clonePreferences(next);
    });

    let resolveRun!: (value: { attempted_at: string; saved_at: string; result: "success" }) => void;
    const runMemoryBackupFn = vi.fn(
      () =>
        new Promise<{ attempted_at: string; saved_at: string; result: "success" }>((resolve) => {
          resolveRun = resolve;
        })
    );

    const scheduler = new MemoryBackupScheduler({
      memoryRoot: "/tmp/memory",
      loadPreferencesFn,
      savePreferencesFn,
      runMemoryBackupFn,
      nowFn: () => new Date(Date.now()),
    });

    await scheduler.initialize();

    const first = scheduler.triggerManualBackup();
    const second = scheduler.triggerManualBackup();
    await Promise.resolve();
    expect(runMemoryBackupFn).toHaveBeenCalledTimes(1);

    if (typeof resolveRun !== "function") {
      throw new Error("Expected in-flight backup resolver to be initialized");
    }
    resolveRun({
      attempted_at: "2026-04-07T12:00:00.000Z",
      saved_at: "2026-04-07T12:00:01.000Z",
      result: "success",
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.result).toEqual(secondResult.result);
    expect(savePreferencesFn).toHaveBeenCalledTimes(1);

    scheduler.close();
  });

  it("skips timed runs while migration is in progress and retries later", async () => {
    let preferences = withBackupPreferences({
      frequency: "hourly",
      last_attempt_at: "2026-04-07T11:00:00.000Z",
    });
    let migrationInProgress = true;

    const loadPreferencesFn = vi.fn(async () => clonePreferences(preferences));
    const savePreferencesFn = vi.fn(async (_memoryRoot: string, next: Preferences) => {
      preferences = clonePreferences(next);
    });
    const runMemoryBackupFn = vi.fn(async () => ({
      attempted_at: new Date(Date.now()).toISOString(),
      saved_at: new Date(Date.now()).toISOString(),
      result: "success" as const,
    }));

    const scheduler = new MemoryBackupScheduler({
      memoryRoot: "/tmp/memory",
      loadPreferencesFn,
      savePreferencesFn,
      runMemoryBackupFn,
      isMigrationInProgress: () => migrationInProgress,
      nowFn: () => new Date(Date.now()),
      afterChangesPollMs: 1_000,
    });

    await scheduler.initialize();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(runMemoryBackupFn).toHaveBeenCalledTimes(0);

    migrationInProgress = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runMemoryBackupFn).toHaveBeenCalledTimes(1);

    scheduler.close();
  });
});
