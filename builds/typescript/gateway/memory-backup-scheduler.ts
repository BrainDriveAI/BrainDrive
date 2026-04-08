import { loadPreferences, savePreferences } from "../config.js";
import type { MemoryBackupFrequency, Preferences } from "../contracts.js";
import { auditLog } from "../logger.js";
import { runMemoryBackup, type MemoryBackupRunResult } from "../memory/backup.js";
import { gitStatusPorcelain } from "../memory/backup-git.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_AFTER_CHANGES_POLL_MS = 30_000;
export const DEFAULT_AFTER_CHANGES_DEBOUNCE_MS = 20_000;

export type MemoryBackupSchedulerRunSource = "manual" | "after_changes" | "hourly" | "daily";

export type MemoryBackupSchedulerRunOutcome = {
  result: MemoryBackupRunResult;
  preferences: Preferences;
};

export type MemoryBackupSchedulerOptions = {
  memoryRoot: string;
  loadPreferencesFn?: (memoryRoot: string) => Promise<Preferences>;
  savePreferencesFn?: (memoryRoot: string, preferences: Preferences) => Promise<void>;
  runMemoryBackupFn?: (memoryRoot: string, preferences: Preferences) => Promise<MemoryBackupRunResult>;
  isMemoryDirtyFn?: (memoryRoot: string) => Promise<boolean>;
  isMigrationInProgress?: () => boolean;
  nowFn?: () => Date;
  afterChangesPollMs?: number;
  afterChangesDebounceMs?: number;
};

export class MemoryBackupScheduler {
  private readonly memoryRoot: string;
  private readonly loadPreferencesFn: (memoryRoot: string) => Promise<Preferences>;
  private readonly savePreferencesFn: (memoryRoot: string, preferences: Preferences) => Promise<void>;
  private readonly runMemoryBackupFn: (
    memoryRoot: string,
    preferences: Preferences
  ) => Promise<MemoryBackupRunResult>;
  private readonly isMemoryDirtyFn: (memoryRoot: string) => Promise<boolean>;
  private readonly isMigrationInProgress: () => boolean;
  private readonly nowFn: () => Date;
  private readonly afterChangesPollMs: number;
  private readonly afterChangesDebounceMs: number;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlightRun: Promise<MemoryBackupSchedulerRunOutcome | null> | null = null;
  private closed = false;
  private dirtySinceMs: number | null = null;

  constructor(options: MemoryBackupSchedulerOptions) {
    this.memoryRoot = options.memoryRoot;
    this.loadPreferencesFn = options.loadPreferencesFn ?? loadPreferences;
    this.savePreferencesFn = options.savePreferencesFn ?? savePreferences;
    this.runMemoryBackupFn = options.runMemoryBackupFn ?? runMemoryBackup;
    this.isMemoryDirtyFn = options.isMemoryDirtyFn ?? defaultIsMemoryDirty;
    this.isMigrationInProgress = options.isMigrationInProgress ?? (() => false);
    this.nowFn = options.nowFn ?? (() => new Date());
    this.afterChangesPollMs = options.afterChangesPollMs ?? DEFAULT_AFTER_CHANGES_POLL_MS;
    this.afterChangesDebounceMs = options.afterChangesDebounceMs ?? DEFAULT_AFTER_CHANGES_DEBOUNCE_MS;
  }

  async initialize(): Promise<void> {
    await this.reconfigure();
  }

  async reconfigure(): Promise<void> {
    if (this.closed) {
      return;
    }
    const preferences = await this.loadPreferencesFn(this.memoryRoot);
    this.applySchedule(preferences);
  }

  async triggerManualBackup(): Promise<MemoryBackupSchedulerRunOutcome> {
    const run = await this.runWithLock("manual");
    if (run) {
      return run;
    }

    const preferences = await this.loadPreferencesFn(this.memoryRoot);
    return {
      result: {
        attempted_at: this.nowFn().toISOString(),
        result: "failed",
        message: "Memory backup is unavailable.",
      },
      preferences,
    };
  }

  close(): void {
    this.closed = true;
    this.dirtySinceMs = null;
    this.clearTimer();
  }

  private applySchedule(preferences: Preferences): void {
    this.clearTimer();
    const backup = preferences.memory_backup;
    if (!backup) {
      this.dirtySinceMs = null;
      return;
    }

    if (backup.frequency === "manual") {
      this.dirtySinceMs = null;
      return;
    }

    if (backup.frequency === "after_changes") {
      this.scheduleAfterChangesPoll(this.afterChangesPollMs);
      return;
    }

    this.dirtySinceMs = null;
    const delayMs = computeNextIntervalDelayMs(backup.frequency, backup.last_attempt_at, this.nowFn());
    this.scheduleTimedRun(backup.frequency, delayMs);
  }

  private scheduleAfterChangesPoll(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.handleAfterChangesPoll();
    }, Math.max(delayMs, 0));
  }

  private scheduleTimedRun(frequency: Extract<MemoryBackupFrequency, "hourly" | "daily">, delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.handleTimedRun(frequency);
    }, Math.max(delayMs, 0));
  }

  private async handleAfterChangesPoll(): Promise<void> {
    if (this.closed) {
      return;
    }

    const preferences = await this.loadPreferencesFn(this.memoryRoot);
    const backup = preferences.memory_backup;
    if (!backup || backup.frequency !== "after_changes") {
      this.applySchedule(preferences);
      return;
    }

    if (this.isMigrationInProgress()) {
      this.scheduleAfterChangesPoll(this.afterChangesPollMs);
      return;
    }

    try {
      const nowMs = this.nowFn().getTime();
      const dirty = await this.isMemoryDirtyFn(this.memoryRoot);
      if (!dirty) {
        this.dirtySinceMs = null;
      } else {
        if (this.dirtySinceMs === null) {
          this.dirtySinceMs = nowMs;
        }
        if (nowMs - this.dirtySinceMs >= this.afterChangesDebounceMs) {
          const run = await this.runWithLock("after_changes");
          if (run) {
            auditLog("settings.memory_backup_auto_save", {
              mode: "after_changes",
              result: run.result.result,
              attempted_at: run.result.attempted_at,
              saved_at: run.result.saved_at,
              message: run.result.message,
            });
          }
          this.dirtySinceMs = null;
        }
      }
    } catch (error) {
      auditLog("settings.memory_backup_auto_save_failed", {
        mode: "after_changes",
        message: renderError(error),
      });
    }

    this.scheduleAfterChangesPoll(this.afterChangesPollMs);
  }

  private async handleTimedRun(frequency: Extract<MemoryBackupFrequency, "hourly" | "daily">): Promise<void> {
    if (this.closed) {
      return;
    }

    const preferences = await this.loadPreferencesFn(this.memoryRoot);
    const backup = preferences.memory_backup;
    if (!backup || backup.frequency !== frequency) {
      this.applySchedule(preferences);
      return;
    }

    if (this.isMigrationInProgress()) {
      this.scheduleTimedRun(frequency, Math.min(this.afterChangesPollMs, intervalMsForFrequency(frequency)));
      return;
    }

    const run = await this.runWithLock(frequency);
    if (run) {
      auditLog("settings.memory_backup_auto_save", {
        mode: frequency,
        result: run.result.result,
        attempted_at: run.result.attempted_at,
        saved_at: run.result.saved_at,
        message: run.result.message,
      });
    }

    const refreshed = await this.loadPreferencesFn(this.memoryRoot);
    this.applySchedule(refreshed);
  }

  private async runWithLock(source: MemoryBackupSchedulerRunSource): Promise<MemoryBackupSchedulerRunOutcome | null> {
    if (this.inFlightRun) {
      return this.inFlightRun;
    }

    const runPromise = this.executeRun(source).finally(() => {
      if (this.inFlightRun === runPromise) {
        this.inFlightRun = null;
      }
    });

    this.inFlightRun = runPromise;
    return runPromise;
  }

  private async executeRun(source: MemoryBackupSchedulerRunSource): Promise<MemoryBackupSchedulerRunOutcome | null> {
    if (source !== "manual" && this.isMigrationInProgress()) {
      return null;
    }

    const preferences = await this.loadPreferencesFn(this.memoryRoot);
    if (!preferences.memory_backup) {
      if (source === "manual") {
        return {
          result: {
            attempted_at: this.nowFn().toISOString(),
            result: "failed",
            message: "Memory backup settings are not configured",
          },
          preferences,
        };
      }

      return null;
    }

    const result = await this.runMemoryBackupFn(this.memoryRoot, preferences);
    const nextPreferences = await this.persistRunResult(result);

    return {
      result,
      preferences: nextPreferences,
    };
  }

  private async persistRunResult(result: MemoryBackupRunResult): Promise<Preferences> {
    const latestPreferences = await this.loadPreferencesFn(this.memoryRoot);
    const latestBackup = latestPreferences.memory_backup;
    if (!latestBackup) {
      return latestPreferences;
    }

    const nextBackup = {
      ...latestBackup,
      last_attempt_at: result.attempted_at,
      ...(result.saved_at ? { last_save_at: result.saved_at } : {}),
      last_result: result.result === "failed" ? ("failed" as const) : ("success" as const),
      last_error: result.result === "failed" ? result.message ?? "Backup failed" : null,
    };

    const nextPreferences: Preferences = {
      ...latestPreferences,
      memory_backup: nextBackup,
    };
    await this.savePreferencesFn(this.memoryRoot, nextPreferences);
    return nextPreferences;
  }

  private clearTimer(): void {
    if (!this.timer) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = null;
  }
}

export function createMemoryBackupScheduler(options: MemoryBackupSchedulerOptions): MemoryBackupScheduler {
  return new MemoryBackupScheduler(options);
}

function computeNextIntervalDelayMs(
  frequency: Extract<MemoryBackupFrequency, "hourly" | "daily">,
  lastAttemptAt: string | undefined,
  now: Date
): number {
  const intervalMs = intervalMsForFrequency(frequency);
  const parsedLastAttemptMs = parseIsoTimestamp(lastAttemptAt);
  if (parsedLastAttemptMs === null) {
    return 0;
  }

  const nextAttemptMs = parsedLastAttemptMs + intervalMs;
  return Math.max(nextAttemptMs - now.getTime(), 0);
}

function intervalMsForFrequency(frequency: Extract<MemoryBackupFrequency, "hourly" | "daily">): number {
  return frequency === "hourly" ? HOUR_MS : DAY_MS;
}

function parseIsoTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

async function defaultIsMemoryDirty(memoryRoot: string): Promise<boolean> {
  const status = await gitStatusPorcelain(memoryRoot);
  return status.trim().length > 0;
}

function renderError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown memory backup scheduling failure";
}
