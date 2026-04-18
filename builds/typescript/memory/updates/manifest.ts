import { createHash } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { normalizeVersionString } from "./version.js";

const MANIFEST_RELATIVE_PATH = path.join("system", "updates", "manifest.md");
const VERSION_HEADER_PATTERN = /^##\s+Version\s+(.+)\s*$/;
const AI_BRIEFING_HEADER_PATTERN = /^###\s+AI Briefing\s*$/;
const ITEM_HEADER_PATTERN = /^###\s+Item:\s+(.+)\s*$/;

export type ManifestFileAction =
  | {
      kind: "write";
      source_path: string;
      target_path: string;
    }
  | {
      kind: "delete";
      target_path: string;
    };

export type ManifestMigrationItem = {
  id: string;
  version: string;
  summary: string;
  ai_briefing: string;
  depends_on: string[];
  file_actions: ManifestFileAction[];
  source_file_paths: string[];
};

export type ManifestVersionSection = {
  version: string;
  ai_briefing: string;
  items: ManifestMigrationItem[];
};

export type UpdatesManifest = {
  versions: ManifestVersionSection[];
  items: ManifestMigrationItem[];
};

export class ManifestParseError extends Error {
  readonly line: number | null;

  constructor(message: string, line: number | null = null) {
    super(line === null ? `Manifest parse error: ${message}` : `Manifest parse error (line ${line}): ${message}`);
    this.name = "ManifestParseError";
    this.line = line;
  }
}

type RawManifestItem = {
  readonly summary: string;
  readonly depends_on: string[];
  readonly file_actions: ManifestFileAction[];
  readonly line: number;
};

export function resolveManifestPath(memoryRoot: string): string {
  return path.join(memoryRoot, MANIFEST_RELATIVE_PATH);
}

export async function loadUpdatesManifest(memoryRoot: string): Promise<UpdatesManifest> {
  const raw = await readFile(resolveManifestPath(memoryRoot), "utf8");
  return parseUpdatesManifest(raw);
}

export function parseUpdatesManifest(raw: string): UpdatesManifest {
  const normalizedRaw = raw.replace(/\r\n/g, "\n");
  const lines = normalizedRaw.split("\n");

  const versions: ManifestVersionSection[] = [];
  const allItems: ManifestMigrationItem[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const versionHeader = VERSION_HEADER_PATTERN.exec(line);
    if (versionHeader) {
      const parsed = parseVersionSection(lines, index, versionHeader[1] ?? "", allItems);
      versions.push(parsed.section);
      allItems.push(...parsed.section.items);
      index = parsed.next_index;
      continue;
    }

    if (line.trim().length === 0 || /^#\s+/.test(line)) {
      index += 1;
      continue;
    }

    throw new ManifestParseError("Unexpected content outside a version section", index + 1);
  }

  if (versions.length === 0) {
    throw new ManifestParseError("Manifest must contain at least one version section");
  }

  return {
    versions,
    items: allItems,
  };
}

function parseVersionSection(
  lines: string[],
  startIndex: number,
  versionLabel: string,
  existingItems: ManifestMigrationItem[]
): { section: ManifestVersionSection; next_index: number } {
  const version = normalizeManifestVersion(versionLabel, startIndex + 1);
  const seenIds = new Set(existingItems.map((item) => item.id));

  const briefingLines: string[] = [];
  const rawItems: RawManifestItem[] = [];
  let mode: "none" | "briefing" | "item" = "none";
  let hasBriefingHeader = false;
  let currentItem: RawManifestItem | null = null;
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (VERSION_HEADER_PATTERN.test(line)) {
      break;
    }

    if (AI_BRIEFING_HEADER_PATTERN.test(line)) {
      if (hasBriefingHeader) {
        throw new ManifestParseError("Duplicate AI Briefing section", index + 1);
      }
      if (rawItems.length > 0 || currentItem) {
        throw new ManifestParseError("AI Briefing must appear before item sections", index + 1);
      }
      hasBriefingHeader = true;
      mode = "briefing";
      index += 1;
      continue;
    }

    const itemHeader = ITEM_HEADER_PATTERN.exec(line);
    if (itemHeader) {
      if (!hasBriefingHeader) {
        throw new ManifestParseError("Version section is missing an AI Briefing", index + 1);
      }
      if (currentItem) {
        rawItems.push(currentItem);
      }
      currentItem = {
        summary: normalizeSummary(itemHeader[1] ?? "", index + 1),
        depends_on: [],
        file_actions: [],
        line: index + 1,
      };
      mode = "item";
      index += 1;
      continue;
    }

    if (mode === "briefing") {
      briefingLines.push(line);
      index += 1;
      continue;
    }

    if (mode === "item") {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        index += 1;
        continue;
      }
      if (!trimmed.startsWith("- ")) {
        throw new ManifestParseError("Item sections only allow list entries", index + 1);
      }
      if (!currentItem) {
        throw new ManifestParseError("Internal parser error: item context missing", index + 1);
      }

      if (trimmed.startsWith("- action:")) {
        const actionValue = trimmed.slice("- action:".length).trim();
        currentItem.file_actions.push(parseFileAction(actionValue, index + 1));
        index += 1;
        continue;
      }

      if (trimmed.startsWith("- depends_on:")) {
        const dependencyValue = trimmed.slice("- depends_on:".length).trim();
        if (dependencyValue.length > 0) {
          currentItem.depends_on.push(...parseDependencies(dependencyValue));
        }
        index += 1;
        continue;
      }

      throw new ManifestParseError("Unsupported item key. Allowed keys: action, depends_on", index + 1);
    }

    if (line.trim().length > 0) {
      throw new ManifestParseError("Unexpected content in version section", index + 1);
    }

    index += 1;
  }

  if (currentItem) {
    rawItems.push(currentItem);
  }

  if (!hasBriefingHeader) {
    throw new ManifestParseError("Version section is missing an AI Briefing", startIndex + 1);
  }

  const aiBriefing = normalizeBriefing(briefingLines);
  if (!aiBriefing) {
    throw new ManifestParseError("AI Briefing cannot be empty", startIndex + 1);
  }

  if (rawItems.length === 0) {
    throw new ManifestParseError("Version section must define at least one item", startIndex + 1);
  }

  const items: ManifestMigrationItem[] = rawItems.map((rawItem) => {
    if (rawItem.file_actions.length === 0) {
      throw new ManifestParseError("Each item must include at least one action", rawItem.line);
    }

    const id = createDeterministicItemId(version, rawItem.summary, rawItem.depends_on, rawItem.file_actions);
    if (seenIds.has(id)) {
      throw new ManifestParseError(`Duplicate item id generated for summary: ${rawItem.summary}`, rawItem.line);
    }
    seenIds.add(id);

    return {
      id,
      version,
      summary: rawItem.summary,
      ai_briefing: aiBriefing,
      depends_on: dedupeStrings(rawItem.depends_on),
      file_actions: rawItem.file_actions,
      source_file_paths: dedupeStrings(
        rawItem.file_actions
          .filter((action): action is Extract<ManifestFileAction, { kind: "write" }> => action.kind === "write")
          .map((action) => action.source_path)
      ),
    };
  });

  return {
    section: {
      version,
      ai_briefing: aiBriefing,
      items,
    },
    next_index: index,
  };
}

function parseFileAction(rawAction: string, line: number): ManifestFileAction {
  const writeMatch = /^write\s+(.+?)\s*->\s*(.+)$/.exec(rawAction);
  if (writeMatch) {
    return {
      kind: "write",
      source_path: normalizeRelativePath(writeMatch[1] ?? "", line, "source"),
      target_path: normalizeRelativePath(writeMatch[2] ?? "", line, "target"),
    };
  }

  const deleteMatch = /^delete\s+(.+)$/.exec(rawAction);
  if (deleteMatch) {
    return {
      kind: "delete",
      target_path: normalizeRelativePath(deleteMatch[1] ?? "", line, "target"),
    };
  }

  throw new ManifestParseError(
    "Action must be `write <source> -> <target>` or `delete <target>`",
    line
  );
}

function parseDependencies(rawValue: string): string[] {
  return dedupeStrings(
    rawValue
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );
}

function createDeterministicItemId(
  version: string,
  summary: string,
  dependsOn: string[],
  fileActions: ManifestFileAction[]
): string {
  const slug = toSlug(summary);
  const canonicalPayload = JSON.stringify({
    summary,
    depends_on: dependsOn,
    file_actions: fileActions,
  });
  const digest = createHash("sha256")
    .update(version)
    .update("\n")
    .update(canonicalPayload)
    .digest("hex")
    .slice(0, 10);
  return `${version}:${slug}:${digest}`;
}

function toSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length === 0) {
    return "item";
  }

  return normalized.slice(0, 48);
}

function normalizeManifestVersion(value: string, line: number): string {
  const normalized = normalizeVersionString(value);
  if (!normalized || !/^\d+(?:\.\d+)*$/.test(normalized)) {
    throw new ManifestParseError(`Invalid version label: ${value.trim()}`, line);
  }
  return normalized;
}

function normalizeSummary(value: string, line: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ManifestParseError("Item summary cannot be empty", line);
  }
  return trimmed;
}

function normalizeBriefing(lines: string[]): string | null {
  const joined = lines.join("\n").trim();
  return joined.length > 0 ? joined : null;
}

function normalizeRelativePath(rawPath: string, line: number, label: "source" | "target"): string {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) {
    throw new ManifestParseError(`${label} path cannot be empty`, line);
  }

  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    throw new ManifestParseError(`${label} path must be relative`, line);
  }

  const normalized = path.posix
    .normalize(trimmed.replace(/\\/g, "/"))
    .replace(/^\.\//, "");

  if (normalized.length === 0 || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new ManifestParseError(`${label} path escapes the allowed root`, line);
  }

  return normalized;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}
