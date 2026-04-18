import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import type { InstallMode } from "../../contracts.js";

const SESSION_RELATIVE_PATH = path.join("system", "updates", "session.json");
const STATE_RELATIVE_PATH = path.join("system", "updates", "state.json");

const TERMINAL_UPDATE_STATUSES = new Set<CodeUpdateSessionStatus>(["completed", "failed"]);

export type CodeUpdateSessionPhase =
  | "requested"
  | "code_update_in_progress"
  | "code_update_complete"
  | "restart_pending"
  | "completed"
  | "failed"
  | "host_execution_unavailable";

export type CodeUpdateSessionStatus = "in_progress" | "completed" | "failed";

export type CodeUpdateSession = {
  update_id: string;
  from_version: string;
  target_version: string;
  phase: CodeUpdateSessionPhase;
  status: CodeUpdateSessionStatus;
  started_at: string;
  updated_at: string;
  last_error: string | null;
};

export type CodeUpdateStateContract = {
  last_checked_at: string;
  last_check_status: string | null;
  last_check_error: string | null;
  last_available_version: string | null;
  last_applied_version: string | null;
  last_applied_app_ref: string | null;
  last_applied_edge_ref: string | null;
  pending_update: boolean;
  pending_reason: string | null;
  consecutive_failures: number;
  next_retry_at: string | null;
};

type HostUpgradeInput = {
  updateId: string;
  mode: "local" | "prod";
  targetVersion: string;
};

type ContainerRestartInput = {
  updateId: string;
  mode: "local" | "prod";
};

export type StartCodeUpdateResult =
  | {
      kind: "started";
      session: CodeUpdateSession;
    }
  | {
      kind: "fallback";
      session: CodeUpdateSession;
      command: string;
      detail: string;
    };

export type RestartCodeUpdateResult =
  | {
      kind: "restarted";
      session: CodeUpdateSession;
    }
  | {
      kind: "fallback";
      session: CodeUpdateSession;
      command: string;
      detail: string;
    };

type CreateCodeUpdateSessionServiceOptions = {
  memoryRoot: string;
  installMode: InstallMode;
  nowFn?: () => Date;
  createUpdateIdFn?: () => string;
  runHostUpgradeFn?: (input: HostUpgradeInput) => Promise<void>;
  runContainerRestartFn?: (input: ContainerRestartInput) => Promise<void>;
};

export class ActiveCodeUpdateSessionError extends Error {
  readonly activeSession: CodeUpdateSession;

  constructor(activeSession: CodeUpdateSession) {
    super(`A code update session is already active (${activeSession.update_id})`);
    this.name = "ActiveCodeUpdateSessionError";
    this.activeSession = activeSession;
  }
}

export class NoActiveCodeUpdateSessionError extends Error {
  constructor() {
    super("No active code update session was found");
    this.name = "NoActiveCodeUpdateSessionError";
  }
}

export class CodeUpdateSessionMismatchError extends Error {
  readonly activeSession: CodeUpdateSession;

  constructor(activeSession: CodeUpdateSession) {
    super(`Active code update session mismatch: ${activeSession.update_id}`);
    this.name = "CodeUpdateSessionMismatchError";
    this.activeSession = activeSession;
  }
}

export class CodeUpdateExecutionError extends Error {
  readonly updateId: string;

  constructor(updateId: string, message: string) {
    super(message);
    this.name = "CodeUpdateExecutionError";
    this.updateId = updateId;
  }
}

export class ContainerRestartExecutionError extends Error {
  readonly updateId: string;

  constructor(updateId: string, message: string) {
    super(message);
    this.name = "ContainerRestartExecutionError";
    this.updateId = updateId;
  }
}

export function resolveCodeUpdateSessionPath(memoryRoot: string): string {
  return path.join(memoryRoot, SESSION_RELATIVE_PATH);
}

export function resolveCodeUpdateStatePath(memoryRoot: string): string {
  return path.join(memoryRoot, STATE_RELATIVE_PATH);
}

export function resolveCanonicalUpgradeFallbackCommand(installMode: InstallMode): string {
  return `./installer/docker/scripts/upgrade.sh ${normalizeUpgradeMode(installMode)}`;
}

export async function loadCodeUpdateSession(memoryRoot: string): Promise<CodeUpdateSession | null> {
  try {
    const raw = await readFile(resolveCodeUpdateSessionPath(memoryRoot), "utf8");
    return parseCodeUpdateSession(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function readCodeUpdateStateContract(memoryRoot: string): Promise<CodeUpdateStateContract | null> {
  try {
    const raw = await readFile(resolveCodeUpdateStatePath(memoryRoot), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    return {
      last_checked_at: coerceString(record.last_checked_at) ?? "",
      last_check_status: coerceNullableString(record.last_check_status),
      last_check_error: coerceNullableString(record.last_check_error),
      last_available_version: coerceNullableString(record.last_available_version),
      last_applied_version: coerceNullableString(record.last_applied_version),
      last_applied_app_ref: coerceNullableString(record.last_applied_app_ref),
      last_applied_edge_ref: coerceNullableString(record.last_applied_edge_ref),
      pending_update: Boolean(record.pending_update),
      pending_reason: coerceNullableString(record.pending_reason),
      consecutive_failures: coerceNonNegativeInteger(record.consecutive_failures, 0),
      next_retry_at: coerceNullableString(record.next_retry_at),
    };
  } catch {
    return null;
  }
}

export function parseCodeUpdateSession(raw: string): CodeUpdateSession {
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const updateId = coerceNonEmptyString(parsed.update_id, "update_id");
  const fromVersion = coerceNonEmptyString(parsed.from_version, "from_version");
  const targetVersion = coerceNonEmptyString(parsed.target_version, "target_version");
  const phase = coerceSessionPhase(parsed.phase);
  const status = coerceSessionStatus(parsed.status);
  const startedAt = coerceNonEmptyString(parsed.started_at, "started_at");
  const updatedAt = coerceNonEmptyString(parsed.updated_at, "updated_at");
  const lastError = coerceNullableString(parsed.last_error);

  return {
    update_id: updateId,
    from_version: fromVersion,
    target_version: targetVersion,
    phase,
    status,
    started_at: startedAt,
    updated_at: updatedAt,
    last_error: lastError,
  };
}

export function createCodeUpdateSessionService(options: CreateCodeUpdateSessionServiceOptions): {
  getSession: () => Promise<CodeUpdateSession | null>;
  startCodeUpdate: (input: { fromVersion: string; targetVersion?: string }) => Promise<StartCodeUpdateResult>;
  restartCodeUpdate: (input?: { updateId?: string }) => Promise<RestartCodeUpdateResult>;
} {
  const nowFn = options.nowFn ?? (() => new Date());
  const createUpdateIdFn = options.createUpdateIdFn ?? (() => randomUUID());
  const mode = normalizeUpgradeMode(options.installMode);

  const getSession = async (): Promise<CodeUpdateSession | null> => {
    return loadCodeUpdateSession(options.memoryRoot);
  };

  const startCodeUpdate = async (input: {
    fromVersion: string;
    targetVersion?: string;
  }): Promise<StartCodeUpdateResult> => {
    const fromVersion = normalizeVersionLabel(input.fromVersion, "unknown");
    const targetVersion = normalizeVersionLabel(input.targetVersion, fromVersion);

    const session = await beginCodeUpdateSession({
      memoryRoot: options.memoryRoot,
      createUpdateIdFn,
      nowFn,
      fromVersion,
      targetVersion,
    });

    await transitionCodeUpdateSession(
      options.memoryRoot,
      {
        phase: "code_update_in_progress",
        status: "in_progress",
        lastError: null,
      },
      nowFn
    );
    await patchCodeUpdateState(options.memoryRoot, {
      pendingUpdate: true,
      pendingReason: "code_update_in_progress",
      now: nowFn,
    });

    if (!options.runHostUpgradeFn) {
      const fallbackCommand = resolveCanonicalUpgradeFallbackCommand(options.installMode);
      const detail =
        "Host-level upgrade execution is unavailable in this runtime. Run the fallback command on the host.";
      const failedSession = await transitionCodeUpdateSession(
        options.memoryRoot,
        {
          phase: "host_execution_unavailable",
          status: "failed",
          lastError: detail,
        },
        nowFn
      );
      return {
        kind: "fallback",
        session: failedSession,
        command: fallbackCommand,
        detail,
      };
    }

    try {
      await options.runHostUpgradeFn({
        updateId: session.update_id,
        mode,
        targetVersion,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Code update execution failed";
      await transitionCodeUpdateSession(
        options.memoryRoot,
        {
          phase: "failed",
          status: "failed",
          lastError: message,
        },
        nowFn
      );
      throw new CodeUpdateExecutionError(session.update_id, message);
    }

    const progressedSession = await transitionCodeUpdateSession(
      options.memoryRoot,
      {
        phase: "code_update_complete",
        status: "in_progress",
        lastError: null,
      },
      nowFn
    );

    return {
      kind: "started",
      session: progressedSession,
    };
  };

  const restartCodeUpdate = async (input: { updateId?: string } = {}): Promise<RestartCodeUpdateResult> => {
    const activeSession = await loadCodeUpdateSession(options.memoryRoot);
    if (!activeSession || TERMINAL_UPDATE_STATUSES.has(activeSession.status)) {
      throw new NoActiveCodeUpdateSessionError();
    }

    if (input.updateId && input.updateId !== activeSession.update_id) {
      throw new CodeUpdateSessionMismatchError(activeSession);
    }

    const restartPendingSession = await transitionCodeUpdateSession(
      options.memoryRoot,
      {
        phase: "restart_pending",
        status: "in_progress",
        lastError: null,
      },
      nowFn
    );
    await patchCodeUpdateState(options.memoryRoot, {
      pendingUpdate: true,
      pendingReason: "restart_pending",
      now: nowFn,
    });

    if (!options.runContainerRestartFn) {
      const fallbackCommand = resolveCanonicalUpgradeFallbackCommand(options.installMode);
      const detail =
        "Container restart execution is unavailable in this runtime. Run the fallback command on the host.";
      const failedSession = await transitionCodeUpdateSession(
        options.memoryRoot,
        {
          phase: "host_execution_unavailable",
          status: "failed",
          lastError: detail,
        },
        nowFn
      );
      return {
        kind: "fallback",
        session: failedSession,
        command: fallbackCommand,
        detail,
      };
    }

    try {
      await options.runContainerRestartFn({
        updateId: restartPendingSession.update_id,
        mode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Container restart execution failed";
      await transitionCodeUpdateSession(
        options.memoryRoot,
        {
          phase: "failed",
          status: "failed",
          lastError: message,
        },
        nowFn
      );
      throw new ContainerRestartExecutionError(restartPendingSession.update_id, message);
    }

    const completedSession = await transitionCodeUpdateSession(
      options.memoryRoot,
      {
        phase: "completed",
        status: "completed",
        lastError: null,
      },
      nowFn
    );
    await patchCodeUpdateState(options.memoryRoot, {
      pendingUpdate: false,
      pendingReason: null,
      now: nowFn,
    });

    return {
      kind: "restarted",
      session: completedSession,
    };
  };

  return {
    getSession,
    startCodeUpdate,
    restartCodeUpdate,
  };
}

async function beginCodeUpdateSession(options: {
  memoryRoot: string;
  fromVersion: string;
  targetVersion: string;
  nowFn: () => Date;
  createUpdateIdFn: () => string;
}): Promise<CodeUpdateSession> {
  const existingSession = await loadCodeUpdateSession(options.memoryRoot);
  if (existingSession && !TERMINAL_UPDATE_STATUSES.has(existingSession.status)) {
    throw new ActiveCodeUpdateSessionError(existingSession);
  }

  const nowIso = options.nowFn().toISOString();
  const nextSession: CodeUpdateSession = {
    update_id: normalizeVersionLabel(options.createUpdateIdFn(), "update"),
    from_version: options.fromVersion,
    target_version: options.targetVersion,
    phase: "requested",
    status: "in_progress",
    started_at: nowIso,
    updated_at: nowIso,
    last_error: null,
  };

  await persistCodeUpdateSession(options.memoryRoot, nextSession);
  return nextSession;
}

async function transitionCodeUpdateSession(
  memoryRoot: string,
  patch: {
    phase: CodeUpdateSessionPhase;
    status: CodeUpdateSessionStatus;
    lastError: string | null;
  },
  nowFn: () => Date
): Promise<CodeUpdateSession> {
  const currentSession = await loadCodeUpdateSession(memoryRoot);
  if (!currentSession) {
    throw new NoActiveCodeUpdateSessionError();
  }

  const nextSession: CodeUpdateSession = {
    ...currentSession,
    phase: patch.phase,
    status: patch.status,
    updated_at: nowFn().toISOString(),
    last_error: patch.lastError,
  };

  await persistCodeUpdateSession(memoryRoot, nextSession);
  return nextSession;
}

async function persistCodeUpdateSession(memoryRoot: string, session: CodeUpdateSession): Promise<void> {
  const sessionPath = resolveCodeUpdateSessionPath(memoryRoot);
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

async function patchCodeUpdateState(
  memoryRoot: string,
  input: {
    pendingUpdate: boolean;
    pendingReason: string | null;
    now: () => Date;
  }
): Promise<void> {
  const statePath = resolveCodeUpdateStatePath(memoryRoot);
  await mkdir(path.dirname(statePath), { recursive: true });

  const existingRecord = await readJsonObject(statePath);
  const nowIso = input.now().toISOString();

  const merged: Record<string, unknown> = {
    ...existingRecord,
    last_checked_at: nowIso,
    last_check_status: coerceNullableString(existingRecord.last_check_status),
    last_check_error: coerceNullableString(existingRecord.last_check_error),
    last_available_version: coerceNullableString(existingRecord.last_available_version),
    last_applied_version: coerceNullableString(existingRecord.last_applied_version),
    last_applied_app_ref: coerceNullableString(existingRecord.last_applied_app_ref),
    last_applied_edge_ref: coerceNullableString(existingRecord.last_applied_edge_ref),
    pending_update: input.pendingUpdate,
    pending_reason: input.pendingReason,
    consecutive_failures: coerceNonNegativeInteger(existingRecord.consecutive_failures, 0),
    next_retry_at: coerceNullableString(existingRecord.next_retry_at),
  };

  await writeFile(statePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

async function readJsonObject(pathname: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(pathname, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    return {};
  }
}

function normalizeUpgradeMode(installMode: InstallMode): "local" | "prod" {
  if (installMode === "prod") {
    return "prod";
  }
  return "local";
}

function coerceSessionPhase(value: unknown): CodeUpdateSessionPhase {
  if (
    value === "requested" ||
    value === "code_update_in_progress" ||
    value === "code_update_complete" ||
    value === "restart_pending" ||
    value === "completed" ||
    value === "failed" ||
    value === "host_execution_unavailable"
  ) {
    return value;
  }

  throw new Error("Invalid code update session phase");
}

function coerceSessionStatus(value: unknown): CodeUpdateSessionStatus {
  if (value === "in_progress" || value === "completed" || value === "failed") {
    return value;
  }

  throw new Error("Invalid code update session status");
}

function coerceNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid or missing ${fieldName}`);
  }

  return value.trim();
}

function normalizeVersionLabel(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function coerceString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function coerceNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return coerceString(value);
}

function coerceNonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : fallback;
}
