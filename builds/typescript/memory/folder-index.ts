import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { resolveMemoryPath } from "./paths.js";

export type ProjectIndexEntry = {
  fileName: string;
  type: string;
  summary: string;
  readWhen: string;
  importedAt?: string;
};

const SUPPORTING_DOCUMENTS_HEADING = "## Supporting Documents";
const SUPPORTING_DOCUMENTS_TABLE_HEADER = "| File | Type | Summary | Read When | Imported |";
const SUPPORTING_DOCUMENTS_TABLE_SEPARATOR = "|---|---|---|---|---|";
const EMPTY_SUPPORTING_DOCUMENTS_ROW = "| _No supporting documents yet._ | | | | |";

export function defaultFolderIndexContent(): string {
  return [
    "# Folder Index",
    "",
    "This file summarizes the documents in this folder so BrainDrive can decide what to read before answering.",
    "",
    "## Core Files",
    "",
    "| File | Purpose |",
    "|---|---|",
    "| `AGENT.md` | Project-specific agent instructions. |",
    "| `spec.md` | Goals, current reality, constraints, and missing information. |",
    "| `plan.md` | Current action plan and next steps. |",
    "",
    SUPPORTING_DOCUMENTS_HEADING,
    "",
    SUPPORTING_DOCUMENTS_TABLE_HEADER,
    SUPPORTING_DOCUMENTS_TABLE_SEPARATOR,
    EMPTY_SUPPORTING_DOCUMENTS_ROW,
    "",
    "## Notes For This Folder",
    "",
    "- Keep this index brief.",
    "- Add uploaded or user-created supporting documents here.",
    "- Do not copy full document contents into this file.",
    "",
  ].join("\n");
}

export async function ensureProjectIndex(memoryRoot: string, projectId: string): Promise<string> {
  const indexPath = projectIndexPath(memoryRoot, projectId);
  await mkdir(path.dirname(indexPath), { recursive: true });

  try {
    return await readFile(indexPath, "utf8");
  } catch {
    const content = defaultFolderIndexContent();
    await writeFile(indexPath, content, "utf8");
    return content;
  }
}

export async function upsertProjectIndexEntry(
  memoryRoot: string,
  projectId: string,
  entry: ProjectIndexEntry
): Promise<void> {
  const indexPath = projectIndexPath(memoryRoot, projectId);
  const current = await ensureProjectIndex(memoryRoot, projectId);
  const next = upsertProjectIndexEntryContent(current, entry);
  if (next !== current) {
    await writeFile(indexPath, next, "utf8");
  }
}

export async function removeProjectIndexEntry(
  memoryRoot: string,
  projectId: string,
  fileName: string
): Promise<void> {
  const indexPath = projectIndexPath(memoryRoot, projectId);
  let current: string;
  try {
    current = await readFile(indexPath, "utf8");
  } catch {
    return;
  }

  const next = removeProjectIndexEntryContent(current, fileName);
  if (next !== current) {
    await writeFile(indexPath, next, "utf8");
  }
}

export function upsertProjectIndexEntryContent(content: string, entry: ProjectIndexEntry): string {
  const normalizedEntry = normalizeEntry(entry);
  const section = splitSupportingDocumentsSection(content);
  const rows = parseSupportingDocumentRows(section.body)
    .filter((row) => row.fileName !== normalizedEntry.fileName);
  rows.push(normalizedEntry);
  rows.sort((left, right) => left.fileName.localeCompare(right.fileName));

  return replaceSupportingDocumentsSection(content, section, renderSupportingDocumentsTable(rows));
}

export function removeProjectIndexEntryContent(content: string, fileName: string): string {
  const normalizedFileName = normalizeIndexFilePath(fileName);
  if (!normalizedFileName) {
    return content;
  }

  const section = splitSupportingDocumentsSection(content);
  const rows = parseSupportingDocumentRows(section.body);
  const nextRows = rows.filter((row) => row.fileName !== normalizedFileName);
  if (nextRows.length === rows.length) {
    return content;
  }

  return replaceSupportingDocumentsSection(content, section, renderSupportingDocumentsTable(nextRows));
}

function projectIndexPath(memoryRoot: string, projectId: string): string {
  const normalizedProjectId = normalizeProjectId(projectId);
  return resolveMemoryPath(memoryRoot, `documents/${normalizedProjectId}/index.md`);
}

function normalizeProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(normalized)) {
    throw new Error("Invalid project id");
  }
  return normalized;
}

function normalizeEntry(entry: ProjectIndexEntry): ProjectIndexEntry {
  const fileName = normalizeIndexFilePath(entry.fileName);
  if (!fileName) {
    throw new Error("Index entry file name is required");
  }

  return {
    fileName,
    type: normalizeCell(entry.type, "Document"),
    summary: normalizeCell(entry.summary, "Uploaded document."),
    readWhen: normalizeCell(entry.readWhen, `User asks about ${fileName} or information likely contained in it.`),
    importedAt: normalizeCell(entry.importedAt ?? "", ""),
  };
}

function normalizeIndexFilePath(fileName: string): string {
  const normalized = fileName.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    return "";
  }
  return parts.join("/");
}

function normalizeCell(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : fallback;
}

type SupportingDocumentsSection = {
  start: number;
  end: number;
  body: string;
};

function splitSupportingDocumentsSection(content: string): SupportingDocumentsSection {
  const headingPattern = new RegExp(`^${escapeRegExp(SUPPORTING_DOCUMENTS_HEADING)}\\s*$`, "m");
  const headingMatch = headingPattern.exec(content);
  if (!headingMatch || headingMatch.index === undefined) {
    return {
      start: content.length,
      end: content.length,
      body: "",
    };
  }

  const bodyStart = headingMatch.index + headingMatch[0].length;
  const afterHeading = content.slice(bodyStart);
  const nextHeadingMatch = /^##\s+/m.exec(afterHeading);
  const bodyEnd = nextHeadingMatch?.index !== undefined
    ? bodyStart + nextHeadingMatch.index
    : content.length;

  return {
    start: headingMatch.index,
    end: bodyEnd,
    body: content.slice(bodyStart, bodyEnd),
  };
}

function replaceSupportingDocumentsSection(
  content: string,
  section: SupportingDocumentsSection,
  table: string
): string {
  const replacement = `${SUPPORTING_DOCUMENTS_HEADING}\n\n${table}\n\n`;
  if (section.start === content.length && section.end === content.length) {
    const separator = content.endsWith("\n") ? "" : "\n";
    return `${content}${separator}\n${replacement}`;
  }

  const before = content.slice(0, section.start);
  const after = content.slice(section.end).replace(/^\n+/, "");
  return `${before}${replacement}${after}`.replace(/\n?$/, "\n");
}

function parseSupportingDocumentRows(sectionBody: string): ProjectIndexEntry[] {
  const rows: ProjectIndexEntry[] = [];
  for (const line of sectionBody.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
      continue;
    }
    if (trimmed === SUPPORTING_DOCUMENTS_TABLE_HEADER || trimmed === SUPPORTING_DOCUMENTS_TABLE_SEPARATOR) {
      continue;
    }
    if (trimmed.includes("_No supporting documents yet._")) {
      continue;
    }

    const cells = splitMarkdownTableRow(trimmed);
    const fileName = normalizeIndexFilePath(stripBackticks(cells[0] ?? ""));
    if (!fileName) {
      continue;
    }

    rows.push({
      fileName,
      type: cells[1]?.trim() ?? "",
      summary: cells[2]?.trim() ?? "",
      readWhen: cells[3]?.trim() ?? "",
      importedAt: cells[4]?.trim() ?? "",
    });
  }
  return rows;
}

function renderSupportingDocumentsTable(rows: ProjectIndexEntry[]): string {
  const renderedRows = rows.length > 0
    ? rows.map(renderSupportingDocumentRow)
    : [EMPTY_SUPPORTING_DOCUMENTS_ROW];

  return [
    SUPPORTING_DOCUMENTS_TABLE_HEADER,
    SUPPORTING_DOCUMENTS_TABLE_SEPARATOR,
    ...renderedRows,
  ].join("\n");
}

function renderSupportingDocumentRow(entry: ProjectIndexEntry): string {
  return [
    `\`${entry.fileName}\``,
    entry.type,
    entry.summary,
    entry.readWhen,
    entry.importedAt ?? "",
  ].map(escapeMarkdownTableCell).join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function splitMarkdownTableRow(row: string): string[] {
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  const inner = row.replace(/^\|/, "").replace(/\|$/, "");

  for (const character of inner) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }

  cells.push(current.trim());
  return cells;
}

function escapeMarkdownTableCell(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "<br>")
    .replace(/\|/g, "\\|")
    .trim();
}

function stripBackticks(value: string): string {
  return value.trim().replace(/^`+|`+$/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
