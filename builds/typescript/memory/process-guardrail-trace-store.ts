import path from "node:path";
import type { Dirent, Stats } from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import { z } from "zod";

import { PROCESS_GUARDRAIL_SCOPES } from "../engine/process-guardrails/contracts.js";
import {
  PROCESS_GUARDRAIL_PROCESS_KIND,
  PROCESS_GUARDRAIL_STAGES,
} from "../engine/process-guardrails/state-machine.js";
import { auditLog } from "../logger.js";
import { resolveMemoryPath } from "./paths.js";

const TRACE_SCHEMA_VERSION = 1;
const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const TRACE_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.jsonl$/;
const processGuardrailRunLocks = new Map<string, Promise<void>>();

const timestampSchema = z.string().datetime({ offset: true });
const safeIdentifierSchema = z.string().trim().min(1).max(256);
const safeCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,127}$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const configuredScopeSchema = z.union([
  z.enum(PROCESS_GUARDRAIL_SCOPES),
  z.literal("missing"),
  z.literal("empty"),
]);

const traceReferenceSchema = z
  .object({
    path: z.string().trim().min(1).max(1024),
    digest: digestSchema,
  })
  .strict();

const traceEventSchema = z
  .object({
    schema_version: z.literal(TRACE_SCHEMA_VERSION),
    timestamp: timestampSchema,
    event_id: safeIdentifierSchema,
    sequence: z.number().int().positive(),
    event: z.enum([
      "process_started",
      "process_resumed",
      "stage_activated",
      "candidate_received",
      "validation_passed",
      "validation_failed",
      "retry_scheduled",
      "retry_started",
      "retry_exhausted",
      "stage_accepted",
      "stage_skipped",
      "stage_redo",
      "artifact_reconciled",
      "override_applied",
      "tool_result",
      "stale_result_ignored",
      "process_paused",
      "process_stopped",
      "process_completed",
      "process_failed",
      "trace_degraded",
    ]),
    run_id: safeIdentifierSchema,
    conversation_id: safeIdentifierSchema,
    correlation_id: safeIdentifierSchema,
    process_kind: z.literal(PROCESS_GUARDRAIL_PROCESS_KIND),
    stage: z.enum(PROCESS_GUARDRAIL_STAGES).optional(),
    stage_revision: z.number().int().positive().optional(),
    automatic_attempt: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    configured_scope: configuredScopeSchema,
    resolved_scope: z.enum(PROCESS_GUARDRAIL_SCOPES),
    provider_id: z.enum(["ollama", "braindrive-models", "openrouter"]),
    provider_class: z.enum(["local", "cloud"]),
    model_id: safeIdentifierSchema.optional(),
    state_revision: z.number().int().positive(),
    instruction_refs: z.array(traceReferenceSchema).optional(),
    artifact_refs: z.array(traceReferenceSchema).optional(),
    validator_codes: z.array(safeCodeSchema).optional(),
    tool_call_id: safeIdentifierSchema.optional(),
    model_call_id: safeIdentifierSchema.optional(),
    operation_id: safeIdentifierSchema.optional(),
    status: safeCodeSchema.optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    cost_usd: z.number().nonnegative().optional(),
    retry_class: z.enum(["provider_empty_completion", "structural"]).optional(),
    provider_empty_retry_count: z.number().int().nonnegative().optional(),
    override_category: z.enum(["skip", "reorder", "redo", "stop", "resume"]).optional(),
    recovery_reason: safeCodeSchema.optional(),
    state_before: safeCodeSchema.optional(),
    state_after: safeCodeSchema.optional(),
    terminal_state: z.enum([
      "completed",
      "stopped_by_owner",
      "needs_owner_action",
      "paused_recoverable",
      "failed_internal",
    ]).optional(),
    diagnostic_health: z.enum(["healthy", "degraded"]),
  })
  .strict();

export type ProcessGuardrailTraceEvent = z.infer<typeof traceEventSchema>;

type TraceStoreIo = {
  mkdir(target: string, options: { recursive: true; mode: number }): Promise<unknown>;
  appendFile(
    target: string,
    content: string,
    options: { encoding: "utf8"; mode: number }
  ): Promise<void>;
  readFile(target: string, encoding: "utf8"): Promise<string>;
  readdir(target: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  stat(target: string): Promise<Stats>;
  unlink(target: string): Promise<void>;
};

type ProcessGuardrailTraceStoreOptions = {
  now?: () => Date;
  retentionDays?: number;
  maxFileBytes?: number;
  io?: Partial<TraceStoreIo>;
};

const defaultIo: TraceStoreIo = {
  mkdir,
  appendFile,
  readFile,
  readdir: async (target, options) => readdir(target, options),
  stat,
  unlink,
};

export class ProcessGuardrailTraceStoreError extends Error {
  constructor(
    readonly code:
      | "trace_record_rejected"
      | "trace_sequence_conflict"
      | "trace_corrupt"
      | "trace_load_failed"
      | "trace_persist_failed"
      | "trace_retention_failed",
    message: string
  ) {
    super(message);
    this.name = "ProcessGuardrailTraceStoreError";
  }
}

export class ProcessGuardrailTraceStore {
  private readonly traceDir: string;
  private readonly io: TraceStoreIo;
  private readonly retentionDays: number;
  private readonly maxFileBytes: number;
  private nextSweepAtMs = 0;

  constructor(
    memoryRoot: string,
    private readonly options: ProcessGuardrailTraceStoreOptions = {}
  ) {
    this.traceDir = resolveMemoryPath(
      memoryRoot,
      "diagnostics/process-guardrails/traces"
    );
    this.io = { ...defaultIo, ...options.io };
    this.retentionDays = normalizePositiveInt(options.retentionDays, DEFAULT_RETENTION_DAYS);
    this.maxFileBytes = normalizePositiveInt(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
  }

  async append(event: ProcessGuardrailTraceEvent): Promise<{
    status: "appended" | "replayed";
    event: ProcessGuardrailTraceEvent;
  }> {
    const parsed = this.parseEvent(event);
    return this.withRunLock(parsed.run_id, () => this.appendLocked(parsed));
  }

  private async appendLocked(parsed: ProcessGuardrailTraceEvent): Promise<{
    status: "appended" | "replayed";
    event: ProcessGuardrailTraceEvent;
  }> {
    const existingEvents = await this.readRunEvents(parsed.run_id);
    const existingById = existingEvents.find((candidate) => candidate.event_id === parsed.event_id);
    if (existingById) {
      if (JSON.stringify(existingById) === JSON.stringify(parsed)) {
        return { status: "replayed", event: existingById };
      }
      throw new ProcessGuardrailTraceStoreError(
        "trace_sequence_conflict",
        "Trace event id already exists with different metadata"
      );
    }

    const expectedSequence = (existingEvents.at(-1)?.sequence ?? 0) + 1;
    if (parsed.sequence !== expectedSequence) {
      throw new ProcessGuardrailTraceStoreError(
        "trace_sequence_conflict",
        `Trace sequence must be ${expectedSequence}`
      );
    }

    const line = `${JSON.stringify(parsed)}\n`;
    try {
      await this.io.mkdir(this.traceDir, { recursive: true, mode: 0o700 });
      const nowMs = this.now().getTime();
      if (nowMs >= this.nextSweepAtMs) {
        await this.runRetentionSweep();
        this.nextSweepAtMs = nowMs + 60 * 60 * 1000;
      }
      const dateSegment = parsed.timestamp.slice(0, 10);
      const target = await this.resolveWritableFile(
        dateSegment,
        Buffer.byteLength(line, "utf8")
      );
      await this.io.appendFile(target, line, { encoding: "utf8", mode: 0o600 });
      return { status: "appended", event: parsed };
    } catch (error) {
      if (error instanceof ProcessGuardrailTraceStoreError) {
        throw error;
      }
      auditLog("process_guardrails.trace_persist_failed", {
        failure_code: "trace_persist_failed",
        store: "process_guardrail_trace",
      });
      throw new ProcessGuardrailTraceStoreError(
        "trace_persist_failed",
        "Unable to persist process guardrail trace event"
      );
    }
  }

  async readRunEvents(runId: string): Promise<ProcessGuardrailTraceEvent[]> {
    let entries: Dirent[];
    try {
      entries = await this.io.readdir(this.traceDir, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        return [];
      }
      throw new ProcessGuardrailTraceStoreError(
        "trace_load_failed",
        "Unable to enumerate process guardrail traces"
      );
    }

    const events: ProcessGuardrailTraceEvent[] = [];
    const files = entries
      .filter((entry) => entry.isFile() && TRACE_FILE_PATTERN.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of files) {
      let raw: string;
      try {
        raw = await this.io.readFile(path.join(this.traceDir, entry.name), "utf8");
      } catch {
        throw new ProcessGuardrailTraceStoreError(
          "trace_load_failed",
          "Unable to read process guardrail trace segment"
        );
      }
      for (const line of raw.split(/\r?\n/).filter((value) => value.length > 0)) {
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          throw new ProcessGuardrailTraceStoreError(
            "trace_corrupt",
            "Process guardrail trace contains malformed JSON"
          );
        }
        let parsed: ProcessGuardrailTraceEvent;
        try {
          parsed = this.parseEvent(value);
        } catch {
          throw new ProcessGuardrailTraceStoreError(
            "trace_corrupt",
            "Process guardrail trace contains an invalid record"
          );
        }
        if (parsed.run_id === runId) {
          events.push(parsed);
        }
      }
    }
    events.sort((left, right) => left.sequence - right.sequence);
    for (let index = 0; index < events.length; index += 1) {
      if (events[index]!.sequence !== index + 1) {
        throw new ProcessGuardrailTraceStoreError(
          "trace_corrupt",
          "Process guardrail trace sequence is not reconstructable"
        );
      }
    }
    return events;
  }

  async runRetentionSweep(): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await this.io.readdir(this.traceDir, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        return;
      }
      auditLog("process_guardrails.trace_retention_failed", {
        failure_code: "trace_retention_failed",
        store: "process_guardrail_trace",
      });
      throw new ProcessGuardrailTraceStoreError(
        "trace_retention_failed",
        "Unable to enumerate process guardrail traces for retention"
      );
    }

    const cutoff = beginningOfUtcDay(this.now());
    cutoff.setUTCDate(cutoff.getUTCDate() - this.retentionDays + 1);
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const match = TRACE_FILE_PATTERN.exec(entry.name);
      if (!match) {
        continue;
      }
      const segmentDate = new Date(`${match[1]}T00:00:00.000Z`);
      if (segmentDate.getTime() >= cutoff.getTime()) {
        continue;
      }
      try {
        await this.io.unlink(path.join(this.traceDir, entry.name));
      } catch {
        auditLog("process_guardrails.trace_retention_failed", {
          failure_code: "trace_retention_failed",
          store: "process_guardrail_trace",
        });
        throw new ProcessGuardrailTraceStoreError(
          "trace_retention_failed",
          "Unable to expire process guardrail trace segment"
        );
      }
    }
  }

  private parseEvent(value: unknown): ProcessGuardrailTraceEvent {
    let parsed: ProcessGuardrailTraceEvent;
    try {
      parsed = traceEventSchema.parse(value);
    } catch {
      throw new ProcessGuardrailTraceStoreError(
        "trace_record_rejected",
        "Process guardrail trace record is not allowlisted"
      );
    }
    if (containsSecretShapedValue(parsed)) {
      throw new ProcessGuardrailTraceStoreError(
        "trace_record_rejected",
        "Process guardrail trace record contains secret-shaped data"
      );
    }
    return parsed;
  }

  private async resolveWritableFile(
    dateSegment: string,
    incomingBytes: number
  ): Promise<string> {
    for (let segment = 0; segment < 10_000; segment += 1) {
      const fileName = segment === 0
        ? `${dateSegment}.jsonl`
        : `${dateSegment}.${segment}.jsonl`;
      const target = path.join(this.traceDir, fileName);
      let existingBytes = 0;
      try {
        existingBytes = (await this.io.stat(target)).size;
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) {
          throw error;
        }
      }
      if (
        (existingBytes === 0 && incomingBytes > this.maxFileBytes) ||
        existingBytes + incomingBytes <= this.maxFileBytes
      ) {
        return target;
      }
    }
    throw new ProcessGuardrailTraceStoreError(
      "trace_persist_failed",
      "Process guardrail trace segment limit reached"
    );
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async withRunLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = processGuardrailRunLocks.get(runId) ?? Promise.resolve();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => gate);
    processGuardrailRunLocks.set(runId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (processGuardrailRunLocks.get(runId) === queued) {
        processGuardrailRunLocks.delete(runId);
      }
    }
  }
}

function containsSecretShapedValue(value: unknown): boolean {
  if (typeof value === "string") {
    return (
      /Bearer\s+[A-Za-z0-9._-]{8,}/i.test(value) ||
      /\bsk-[A-Za-z0-9_-]{8,}\b/.test(value) ||
      /-----BEGIN [^-]+ PRIVATE KEY-----/.test(value) ||
      /[?&](?:api[_-]?key|token|password|secret)=/i.test(value)
    );
  }
  if (Array.isArray(value)) {
    return value.some(containsSecretShapedValue);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.values(value as Record<string, unknown>).some(containsSecretShapedValue);
}

function beginningOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  return value && Number.isInteger(value) && value > 0 ? value : fallback;
}

function isNodeError(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}
