import { createHash } from "node:crypto";

import type { z } from "zod";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import type { ResumeDefinitionRecordSchema } from "../app-platform/contracts/data.js";
import { ResumeDomainError } from "../resume-domain/errors.js";

type ResumeDefinition = z.infer<typeof ResumeDefinitionRecordSchema>;

export const RESUME_TEMPLATE_ID = "resume.single-column" as const;
export const RESUME_TEMPLATE_VERSION = "1" as const;
export const RESUME_RENDERER_ID = "braindrive.ats-pdf" as const;
export const RESUME_RENDERER_VERSION = "1" as const;
export const RESUME_FONT_MANIFEST_DIGEST = canonicalInputDigest({ fonts: [
  { family: "Helvetica", weight: "regular", source: "pdf-core-font", version: "PDF-1.4" },
  { family: "Helvetica", weight: "bold", source: "pdf-core-font", version: "PDF-1.4" },
] });

const MAX_LINE_LENGTH = 88;
const MAX_LINES_PER_PAGE = 48;
const MAX_PAGES = 2;

export type RenderedResume = {
  format: "pdf";
  mime_type: "application/pdf";
  bytes: Buffer;
  artifact_digest: `sha256:${string}`;
  input_digest: `sha256:${string}`;
  logical_lines: string[];
  parsed_lines: string[];
  page_count: number;
  template_id: typeof RESUME_TEMPLATE_ID;
  template_version: typeof RESUME_TEMPLATE_VERSION;
  renderer_id: typeof RESUME_RENDERER_ID;
  renderer_version: typeof RESUME_RENDERER_VERSION;
  font_manifest_digest: typeof RESUME_FONT_MANIFEST_DIGEST;
};

export function sanitizeResumeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapLine(text: string): string[] {
  const safe = sanitizeResumeText(text);
  if (!safe) return [];
  const words = safe.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > MAX_LINE_LENGTH) throw new ResumeDomainError("validation_failed", "Resume content contains an unrenderable long token");
    const next = current ? `${current} ${word}` : word;
    if (next.length > MAX_LINE_LENGTH) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

type LogicalResumeEntry = { text: string; role: "title" | "section" | "heading" | "bullet" | "line" };

function logicalResumeEntries(definition: ResumeDefinition): LogicalResumeEntry[] {
  const entries: LogicalResumeEntry[] = [{ text: sanitizeResumeText(definition.title), role: "title" }];
  for (const sectionId of definition.section_order) {
    const statements = definition.statements.filter((statement) => statement.section_id === sectionId);
    if (statements.length === 0) continue;
    if (sectionId !== "contact") entries.push({ text: sectionLabel(sectionId), role: "section" });
    for (const statement of statements) {
      const role = statement.display_role ?? (sectionId === "contact" || sectionId === "summary" ? "line" : "bullet");
      const value = sectionId === "contact" ? contactLine(definition.title, statement.text) : statement.text;
      if (!value) continue;
      const prefix = role === "bullet" ? "- " : "";
      entries.push(...wrapLine(`${prefix}${value}`).map((text) => ({ text, role })));
    }
  }
  return entries;
}

export function logicalResumeLines(definition: ResumeDefinition): string[] {
  const lines = logicalResumeEntries(definition).map((entry) => entry.text);
  if (lines.some((line) => !line)) throw new ResumeDomainError("validation_failed", "Resume contains empty render content");
  if (lines.length > MAX_LINES_PER_PAGE * MAX_PAGES) throw new ResumeDomainError("validation_failed", "Resume exceeds the accepted two-page renderer limit");
  return lines;
}

export function renderApprovedResume(definition: ResumeDefinition): RenderedResume {
  if (definition.status !== "approved" || !definition.approval_evidence) {
    throw new ResumeDomainError("validation_failed", "Only an approved, validated definition can be rendered");
  }
  if (definition.template_id !== RESUME_TEMPLATE_ID || definition.template_version !== RESUME_TEMPLATE_VERSION) {
    throw new ResumeDomainError("incompatible_schema", "Resume template is not compatible with the accepted renderer");
  }
  const logicalEntries = logicalResumeEntries(definition);
  const logicalLines = logicalEntries.map((entry) => entry.text);
  const pages = chunk(logicalEntries, MAX_LINES_PER_PAGE);
  const bytes = buildPdf(pages);
  const parsedLines = parseBackPdf(bytes);
  if (JSON.stringify(parsedLines) !== JSON.stringify(logicalLines)) {
    throw new ResumeDomainError("validation_failed", "Rendered resume failed logical-order parse-back validation");
  }
  return {
    format: "pdf",
    mime_type: "application/pdf",
    bytes,
    artifact_digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    input_digest: canonicalInputDigest({ definition_revision_id: definition.metadata.revision_id, approval_evidence: definition.approval_evidence, template_id: definition.template_id, template_version: definition.template_version }),
    logical_lines: logicalLines,
    parsed_lines: parsedLines,
    page_count: pages.length,
    template_id: RESUME_TEMPLATE_ID,
    template_version: RESUME_TEMPLATE_VERSION,
    renderer_id: RESUME_RENDERER_ID,
    renderer_version: RESUME_RENDERER_VERSION,
    font_manifest_digest: RESUME_FONT_MANIFEST_DIGEST,
  };
}

export function renderApprovedResumeMarkdown(definition: ResumeDefinition): string {
  if (definition.status !== "approved" || !definition.approval_evidence) {
    throw new ResumeDomainError("validation_failed", "Only an approved, validated definition can be published");
  }
  const output = [`# ${escapeMarkdownText(definition.title)}`, ""];
  for (const sectionId of definition.section_order) {
    const statements = definition.statements.filter((statement) => statement.section_id === sectionId);
    if (statements.length === 0) continue;
    if (sectionId !== "contact") output.push(`## ${escapeMarkdownText(sectionLabel(sectionId))}`, "");
    for (const statement of statements) {
      const value = sectionId === "contact" ? contactLine(definition.title, statement.text) : statement.text;
      const text = escapeMarkdownText(value);
      if (!text) continue;
      const role = statement.display_role ?? (sectionId === "contact" || sectionId === "summary" ? "line" : "bullet");
      output.push(role === "bullet" ? `- ${text}` : role === "heading" ? `**${text}**` : text);
    }
    output.push("");
  }
  return `${output.join("\n").trimEnd()}\n`;
}

export function parseBackPdf(bytes: Uint8Array): string[] {
  const source = Buffer.from(bytes).toString("latin1");
  const lines: string[] = [];
  for (const match of source.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)) lines.push(unescapePdfText(match[1] ?? ""));
  return lines;
}

function buildPdf(pages: LogicalResumeEntry[][]): Buffer {
  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const contentObjectIds = pages.map((_, index) => 4 + index * 2);
  const regularFontObjectId = 3 + pages.length * 2;
  const boldFontObjectId = regularFontObjectId + 1;
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  pages.forEach((lines, index) => {
    const stream = ["BT", "72 760 Td", ...lines.flatMap((entry) => {
      const bold = entry.role === "title" || entry.role === "section" || entry.role === "heading";
      const font = bold ? "F2" : "F1";
      const size = entry.role === "title" ? 18 : entry.role === "section" ? 11 : entry.role === "heading" ? 10.5 : 10.5;
      const leading = entry.role === "title" ? 24 : entry.role === "section" ? 18 : 14;
      return [`/${font} ${size} Tf`, `(${escapePdfText(entry.text)}) Tj`, `0 -${leading} Td`];
    }), "ET"].join("\n");
    objects[pageObjectIds[index]!] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${regularFontObjectId} 0 R /F2 ${boldFontObjectId} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`;
    objects[contentObjectIds[index]!] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });
  objects[regularFontObjectId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[boldFontObjectId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  let output = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(output, "latin1");
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "latin1");
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, (character) => character === "•" ? "-" : "?");
}

function unescapePdfText(value: string): string {
  return value.replace(/\\([\\()])/g, "$1");
}

function escapeMarkdownText(value: string): string {
  return sanitizeResumeText(value).replace(/([\\`*_{}\[\]<>#|])/g, "\\$1");
}

function sectionLabel(value: string): string {
  return sanitizeResumeText(value.replace(/[_-]+/g, " ")).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function contactLine(title: string, value: string): string {
  const normalizedTitle = title.trim().toLocaleLowerCase();
  const parts = value.split("|").map((part) => part.trim()).filter(Boolean);
  if (parts[0]?.toLocaleLowerCase() === normalizedTitle) parts.shift();
  return parts.join(" | ");
}

function chunk<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}
