import path from "node:path";
import { readFile } from "node:fs/promises";

export type VersionMetadata = {
  version: string;
  released: string;
  channel: string;
};

const VERSION_FILE_RELATIVE_PATH = path.join("system", "version.json");

type VersionTuple = number[];

export function resolveVersionMetadataPath(memoryRoot: string): string {
  return path.join(memoryRoot, VERSION_FILE_RELATIVE_PATH);
}

export async function loadVersionMetadata(memoryRoot: string): Promise<VersionMetadata | null> {
  try {
    const raw = await readFile(resolveVersionMetadataPath(memoryRoot), "utf8");
    return parseVersionMetadata(raw);
  } catch {
    return null;
  }
}

export function parseVersionMetadata(raw: string): VersionMetadata | null {
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      released?: unknown;
      channel?: unknown;
    };

    const version = normalizeVersionString(parsed.version);
    const released = normalizeMetadataField(parsed.released);
    const channel = normalizeMetadataField(parsed.channel);

    if (!version || !released || !channel) {
      return null;
    }

    return {
      version,
      released,
      channel,
    };
  } catch {
    return null;
  }
}

export function normalizeVersionString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (/^[vV]/.test(trimmed)) {
    const withoutPrefix = trimmed.slice(1).trim();
    return withoutPrefix.length > 0 ? withoutPrefix : null;
  }

  return trimmed;
}

export function compareVersionTuples(left: string, right: string): -1 | 0 | 1 | null {
  const leftTuple = parseNumericVersionTuple(left);
  const rightTuple = parseNumericVersionTuple(right);

  if (!leftTuple || !rightTuple) {
    return null;
  }

  const width = Math.max(leftTuple.length, rightTuple.length);
  for (let index = 0; index < width; index += 1) {
    const leftValue = leftTuple[index] ?? 0;
    const rightValue = rightTuple[index] ?? 0;

    if (leftValue < rightValue) {
      return -1;
    }
    if (leftValue > rightValue) {
      return 1;
    }
  }

  return 0;
}

export function versionsMatch(left: string, right: string): boolean {
  return compareVersionTuples(left, right) === 0;
}

function parseNumericVersionTuple(value: string): VersionTuple | null {
  const normalized = normalizeVersionString(value);
  if (!normalized) {
    return null;
  }

  if (!/^\d+(?:\.\d+)*$/.test(normalized)) {
    return null;
  }

  const tuple = normalized
    .split(".")
    .map((segment) => Number.parseInt(segment, 10));

  if (tuple.some((valuePart) => !Number.isFinite(valuePart) || valuePart < 0)) {
    return null;
  }

  return tuple;
}

function normalizeMetadataField(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
