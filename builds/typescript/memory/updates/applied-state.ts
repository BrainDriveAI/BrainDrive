import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { normalizeVersionString } from "./version.js";

const APPLIED_STATE_RELATIVE_PATH = path.join("system", "updates", "applied.json");

export type AppliedItemStatus = "in_progress" | "applied" | "declined" | "failed";

export type AppliedItemDecision = {
  status: AppliedItemStatus;
  decided_at: string;
  note?: string;
  error_summary?: string;
  snapshot_path?: string;
};

export type AppliedRunHistoryEntry = {
  run_id: string;
  started_at: string;
  completed_at?: string;
  applied_item_ids: string[];
  declined_item_ids: string[];
};

export type AppliedState = {
  last_applied: string | null;
  items: Record<string, AppliedItemDecision>;
  runs: AppliedRunHistoryEntry[];
};

export class AppliedStateParseError extends Error {
  constructor(message: string) {
    super(`Applied state parse error: ${message}`);
    this.name = "AppliedStateParseError";
  }
}

export function resolveAppliedStatePath(memoryRoot: string): string {
  return path.join(memoryRoot, APPLIED_STATE_RELATIVE_PATH);
}

export async function loadAppliedState(memoryRoot: string): Promise<AppliedState> {
  try {
    const raw = await readFile(resolveAppliedStatePath(memoryRoot), "utf8");
    return parseAppliedState(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createEmptyAppliedState();
    }
    throw error;
  }
}

export function parseAppliedState(raw: string): AppliedState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppliedStateParseError("File is not valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppliedStateParseError("Root object must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  const lastApplied = parseLastApplied(record.last_applied);
  const items = parseItemDecisions(record.items);
  const runs = parseRunHistory(record.runs);

  return {
    last_applied: lastApplied,
    items,
    runs,
  };
}

export function createEmptyAppliedState(lastApplied: string | null = null): AppliedState {
  return {
    last_applied: normalizeLastAppliedOrNull(lastApplied),
    items: {},
    runs: [],
  };
}

export function lookupItemDecision(state: AppliedState, itemId: string): AppliedItemDecision | null {
  return state.items[itemId] ?? null;
}

export function isItemDeclined(state: AppliedState, itemId: string): boolean {
  return lookupItemDecision(state, itemId)?.status === "declined";
}

export function isTerminalItemStatus(status: AppliedItemStatus): boolean {
  return status === "applied" || status === "declined" || status === "failed";
}

export function serializeAppliedState(state: AppliedState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export async function persistAppliedState(memoryRoot: string, state: AppliedState): Promise<void> {
  const statePath = resolveAppliedStatePath(memoryRoot);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, serializeAppliedState(state), "utf8");
}

function parseLastApplied(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new AppliedStateParseError("last_applied must be a string or null");
  }
  return normalizeLastAppliedOrNull(value);
}

function normalizeLastAppliedOrNull(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = normalizeVersionString(value);
  if (!normalized || !/^\d+(?:\.\d+)*$/.test(normalized)) {
    throw new AppliedStateParseError("last_applied must be a numeric version string");
  }
  return normalized;
}

function parseItemDecisions(value: unknown): Record<string, AppliedItemDecision> {
  if (value === undefined || value === null) {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppliedStateParseError("items must be a JSON object");
  }

  const record = value as Record<string, unknown>;
  const parsed: Record<string, AppliedItemDecision> = {};

  for (const [itemId, decisionValue] of Object.entries(record)) {
    if (itemId.trim().length === 0) {
      throw new AppliedStateParseError("items cannot include an empty item id");
    }

    if (!decisionValue || typeof decisionValue !== "object" || Array.isArray(decisionValue)) {
      throw new AppliedStateParseError(`items.${itemId} must be an object`);
    }

    const decisionRecord = decisionValue as Record<string, unknown>;
    const status = parseDecisionStatus(decisionRecord.status, itemId);
    const decidedAt = parseRequiredString(decisionRecord.decided_at, `items.${itemId}.decided_at`);
    const note = parseOptionalString(decisionRecord.note, `items.${itemId}.note`);
    const errorSummary = parseOptionalString(
      decisionRecord.error_summary,
      `items.${itemId}.error_summary`
    );
    const snapshotPath = parseOptionalString(
      decisionRecord.snapshot_path,
      `items.${itemId}.snapshot_path`
    );

    parsed[itemId] = {
      status,
      decided_at: decidedAt,
      ...(note ? { note } : {}),
      ...(errorSummary ? { error_summary: errorSummary } : {}),
      ...(snapshotPath ? { snapshot_path: snapshotPath } : {}),
    };
  }

  return parsed;
}

function parseDecisionStatus(value: unknown, itemId: string): AppliedItemStatus {
  if (value === "in_progress" || value === "applied" || value === "declined" || value === "failed") {
    return value;
  }
  throw new AppliedStateParseError(
    `items.${itemId}.status must be "in_progress", "applied", "declined", or "failed"`
  );
}

function parseRunHistory(value: unknown): AppliedRunHistoryEntry[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AppliedStateParseError("runs must be an array");
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new AppliedStateParseError(`runs[${index}] must be an object`);
    }

    const record = entry as Record<string, unknown>;
    const completedAt = parseOptionalString(record.completed_at, `runs[${index}].completed_at`);

    return {
      run_id: parseRequiredString(record.run_id, `runs[${index}].run_id`),
      started_at: parseRequiredString(record.started_at, `runs[${index}].started_at`),
      ...(completedAt ? { completed_at: completedAt } : {}),
      applied_item_ids: parseStringArray(record.applied_item_ids, `runs[${index}].applied_item_ids`),
      declined_item_ids: parseStringArray(record.declined_item_ids, `runs[${index}].declined_item_ids`),
    };
  });
}

function parseRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppliedStateParseError(`${field} must be a non-empty string`);
  }
  return value;
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppliedStateParseError(`${field} must be a non-empty string when present`);
  }
  return value;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AppliedStateParseError(`${field} must be an array of strings`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new AppliedStateParseError(`${field}[${index}] must be a non-empty string`);
    }
    return entry;
  });
}
