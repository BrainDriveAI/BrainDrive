import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { Dirent } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  PROCESS_GUARDRAIL_CONTRACT_VERSION,
  PROCESS_GUARDRAIL_PROCESS_KIND,
  PROCESS_GUARDRAIL_STATE_SCHEMA_VERSION,
  applyProcessGuardrailTransition,
  isTerminalProcessGuardrailOutcome,
  parseProcessGuardrailState,
  type ProcessGuardrailState,
  type ProcessGuardrailTransition,
} from "../engine/process-guardrails/state-machine.js";
import { auditLog } from "../logger.js";
import { resolveMemoryPath } from "./paths.js";

const DEFAULT_RETENTION_DAYS = 14;
const processGuardrailTupleLocks = new Map<string, Promise<void>>();

export type ProcessGuardrailTuple = {
  conversationId: string;
  pageId: string;
  processKind: typeof PROCESS_GUARDRAIL_PROCESS_KIND;
};

export type ProcessGuardrailStateLoadResult =
  | { status: "missing" }
  | { status: "ok"; state: ProcessGuardrailState }
  | { status: "corrupt"; failureCode: "state_corrupt"; statePath: string }
  | { status: "unsupported"; failureCode: "state_unsupported_version"; statePath: string };

type StateStoreIo = {
  mkdir(target: string, options: { recursive: true; mode: number }): Promise<unknown>;
  readFile(target: string, encoding: "utf8"): Promise<string>;
  writeFile(
    target: string,
    content: string,
    options: { encoding: "utf8"; mode: number }
  ): Promise<void>;
  rename(source: string, target: string): Promise<void>;
  readdir(target: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  unlink(target: string): Promise<void>;
};

type ProcessGuardrailStateStoreOptions = {
  now?: () => Date;
  retentionDays?: number;
  io?: Partial<StateStoreIo>;
};

const defaultIo: StateStoreIo = {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir: async (target, options) => readdir(target, options),
  unlink,
};

export class ProcessGuardrailStateStoreError extends Error {
  constructor(
    readonly code:
      | "state_invalid"
      | "state_exists"
      | "state_load_failed"
      | "state_persist_failed"
      | "state_retention_failed",
    message: string
  ) {
    super(message);
    this.name = "ProcessGuardrailStateStoreError";
  }
}

export class ProcessGuardrailRevisionConflictError extends Error {
  readonly code = "state_revision_conflict";

  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super(`Process guardrail state revision conflict: expected ${expectedRevision}, found ${actualRevision}`);
    this.name = "ProcessGuardrailRevisionConflictError";
  }
}

export class ProcessGuardrailStateRecoveryRequiredError extends Error {
  readonly code = "state_recovery_required";

  constructor(readonly loadStatus: "corrupt" | "unsupported") {
    super(`Process guardrail state requires recovery: ${loadStatus}`);
    this.name = "ProcessGuardrailStateRecoveryRequiredError";
  }
}

export class ProcessGuardrailStateStore {
  private readonly stateDir: string;
  private readonly io: StateStoreIo;
  private readonly retentionDays: number;
  private nextSweepAtMs = 0;
  private retentionSweepInFlight: Promise<void> | null = null;

  constructor(
    private readonly memoryRoot: string,
    private readonly options: ProcessGuardrailStateStoreOptions = {}
  ) {
    this.stateDir = resolveMemoryPath(
      memoryRoot,
      "diagnostics/process-guardrails/state"
    );
    this.io = { ...defaultIo, ...options.io };
    this.retentionDays = normalizePositiveInt(options.retentionDays, DEFAULT_RETENTION_DAYS);
  }

  statePath(tuple: ProcessGuardrailTuple): string {
    return path.join(this.stateDir, `${processGuardrailTupleHash(tuple)}.json`);
  }

  async create(
    tuple: ProcessGuardrailTuple,
    initialState: ProcessGuardrailState
  ): Promise<ProcessGuardrailState> {
    await this.maybeRunRetentionSweep();
    return this.withTupleLock(tuple, async () => {
      const parsed = this.validateTupleState(tuple, initialState);
      const existing = await this.loadUnlocked(tuple);
      if (existing.status !== "missing") {
        if (existing.status === "corrupt" || existing.status === "unsupported") {
          throw new ProcessGuardrailStateRecoveryRequiredError(existing.status);
        }
        throw new ProcessGuardrailStateStoreError(
          "state_exists",
          "Process guardrail state already exists"
        );
      }
      await this.atomicWrite(this.statePath(tuple), parsed);
      return parsed;
    });
  }

  async load(tuple: ProcessGuardrailTuple): Promise<ProcessGuardrailStateLoadResult> {
    return this.withTupleLock(tuple, () => this.loadUnlocked(tuple));
  }

  async transition(
    tuple: ProcessGuardrailTuple,
    input: {
      expectedRevision: number;
      transition: ProcessGuardrailTransition;
    }
  ): Promise<{
    status: "updated" | "replayed";
    state: ProcessGuardrailState;
  }> {
    await this.maybeRunRetentionSweep();
    return this.withTupleLock(tuple, async () => {
      const loaded = await this.loadUnlocked(tuple);
      if (loaded.status === "missing") {
        throw new ProcessGuardrailStateStoreError(
          "state_load_failed",
          "Process guardrail state does not exist"
        );
      }
      if (loaded.status === "corrupt" || loaded.status === "unsupported") {
        throw new ProcessGuardrailStateRecoveryRequiredError(loaded.status);
      }
      if (loaded.state.last_transition_id === input.transition.transition_id) {
        return { status: "replayed", state: loaded.state };
      }
      if (loaded.state.revision !== input.expectedRevision) {
        throw new ProcessGuardrailRevisionConflictError(
          input.expectedRevision,
          loaded.state.revision
        );
      }

      const next = applyProcessGuardrailTransition(loaded.state, input.transition);
      this.validateTupleState(tuple, next);
      await this.atomicWrite(this.statePath(tuple), next);
      return { status: "updated", state: next };
    });
  }

  async runRetentionSweep(): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await this.io.readdir(this.stateDir, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        return;
      }
      this.logStoreFailure("process_guardrails.state_retention_failed", "state_retention_failed");
      throw new ProcessGuardrailStateStoreError(
        "state_retention_failed",
        "Unable to enumerate process guardrail state for retention"
      );
    }

    const cutoff = this.now().getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const target = path.join(this.stateDir, entry.name);
      let raw: string;
      try {
        raw = await this.io.readFile(target, "utf8");
      } catch (error) {
        this.logStoreFailure("process_guardrails.state_retention_failed", "state_retention_failed");
        throw new ProcessGuardrailStateStoreError(
          "state_retention_failed",
          "Unable to read process guardrail state during retention"
        );
      }

      const parsed = parseStoredState(raw);
      if (
        parsed.status !== "ok" ||
        !isTerminalProcessGuardrailOutcome(parsed.state.outcome) ||
        !parsed.state.terminal_at ||
        Date.parse(parsed.state.terminal_at) >= cutoff
      ) {
        continue;
      }
      try {
        await this.io.unlink(target);
      } catch (error) {
        this.logStoreFailure("process_guardrails.state_retention_failed", "state_retention_failed");
        throw new ProcessGuardrailStateStoreError(
          "state_retention_failed",
          "Unable to expire process guardrail terminal state"
        );
      }
    }
  }

  private async loadUnlocked(
    tuple: ProcessGuardrailTuple
  ): Promise<ProcessGuardrailStateLoadResult> {
    const statePath = this.statePath(tuple);
    let raw: string;
    try {
      raw = await this.io.readFile(statePath, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        return { status: "missing" };
      }
      this.logStoreFailure("process_guardrails.state_load_failed", "state_load_failed");
      throw new ProcessGuardrailStateStoreError(
        "state_load_failed",
        "Unable to load process guardrail state"
      );
    }

    const parsed = parseStoredState(raw);
    if (parsed.status === "corrupt") {
      auditLog("process_guardrails.state_recovery_required", {
        failure_code: "state_corrupt",
        tuple_hash: processGuardrailTupleHash(tuple),
      });
      return {
        status: "corrupt",
        failureCode: "state_corrupt",
        statePath,
      };
    }
    if (parsed.status === "unsupported") {
      auditLog("process_guardrails.state_recovery_required", {
        failure_code: "state_unsupported_version",
        tuple_hash: processGuardrailTupleHash(tuple),
      });
      return {
        status: "unsupported",
        failureCode: "state_unsupported_version",
        statePath,
      };
    }

    try {
      return { status: "ok", state: this.validateTupleState(tuple, parsed.state) };
    } catch {
      auditLog("process_guardrails.state_recovery_required", {
        failure_code: "state_corrupt",
        tuple_hash: processGuardrailTupleHash(tuple),
      });
      return {
        status: "corrupt",
        failureCode: "state_corrupt",
        statePath,
      };
    }
  }

  private validateTupleState(
    tuple: ProcessGuardrailTuple,
    state: ProcessGuardrailState
  ): ProcessGuardrailState {
    let parsed: ProcessGuardrailState;
    try {
      parsed = parseProcessGuardrailState(state);
    } catch {
      throw new ProcessGuardrailStateStoreError(
        "state_invalid",
        "Process guardrail state is invalid"
      );
    }
    if (
      parsed.conversation_id !== tuple.conversationId ||
      parsed.page_id !== tuple.pageId ||
      parsed.process_kind !== tuple.processKind
    ) {
      throw new ProcessGuardrailStateStoreError(
        "state_invalid",
        "Process guardrail state identity does not match its tuple"
      );
    }
    return parsed;
  }

  private async atomicWrite(
    target: string,
    state: ProcessGuardrailState
  ): Promise<void> {
    const tempPath = `${target}.tmp-${process.pid}-${this.now().getTime()}-${randomUUID()}`;
    try {
      await this.io.mkdir(this.stateDir, { recursive: true, mode: 0o700 });
      await this.io.writeFile(
        tempPath,
        `${JSON.stringify(state, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 }
      );
      await this.io.rename(tempPath, target);
    } catch {
      await this.io.unlink(tempPath).catch(() => undefined);
      this.logStoreFailure("process_guardrails.state_persist_failed", "state_persist_failed");
      throw new ProcessGuardrailStateStoreError(
        "state_persist_failed",
        "Unable to persist process guardrail state"
      );
    }
  }

  private async withTupleLock<T>(
    tuple: ProcessGuardrailTuple,
    operation: () => Promise<T>
  ): Promise<T> {
    const key = processGuardrailTupleHash(tuple);
    const previous = processGuardrailTupleLocks.get(key) ?? Promise.resolve();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => gate);
    processGuardrailTupleLocks.set(key, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (processGuardrailTupleLocks.get(key) === queued) {
        processGuardrailTupleLocks.delete(key);
      }
    }
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async maybeRunRetentionSweep(): Promise<void> {
    const nowMs = this.now().getTime();
    if (nowMs < this.nextSweepAtMs) {
      return;
    }
    if (!this.retentionSweepInFlight) {
      this.retentionSweepInFlight = this.runRetentionSweep()
        .then(() => {
          this.nextSweepAtMs = nowMs + 60 * 60 * 1000;
        })
        .finally(() => {
          this.retentionSweepInFlight = null;
        });
    }
    await this.retentionSweepInFlight;
  }

  private logStoreFailure(event: string, failureCode: string): void {
    auditLog(event, {
      failure_code: failureCode,
      store: "process_guardrail_state",
    });
  }
}

export function processGuardrailTupleHash(tuple: ProcessGuardrailTuple): string {
  return createHash("sha256")
    .update(JSON.stringify([
      tuple.conversationId,
      tuple.pageId,
      tuple.processKind,
    ]))
    .digest("hex");
}

function parseStoredState(raw: string):
  | { status: "ok"; state: ProcessGuardrailState }
  | { status: "corrupt" }
  | { status: "unsupported" } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "corrupt" };
  }
  if (!value || typeof value !== "object") {
    return { status: "corrupt" };
  }
  const record = value as Record<string, unknown>;
  if (
    record.schema_version !== PROCESS_GUARDRAIL_STATE_SCHEMA_VERSION ||
    record.contract_version !== PROCESS_GUARDRAIL_CONTRACT_VERSION
  ) {
    return { status: "unsupported" };
  }
  try {
    return { status: "ok", state: parseProcessGuardrailState(value) };
  } catch {
    return { status: "corrupt" };
  }
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  return value && Number.isInteger(value) && value > 0 ? value : fallback;
}

function isNodeError(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}
