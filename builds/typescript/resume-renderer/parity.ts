import { createHash } from "node:crypto";

import type { z } from "zod";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import type { ArtifactParityReportRecordSchema, ResumeDefinitionRecordSchema } from "../app-platform/contracts/data.js";

type ResumeDefinition = z.infer<typeof ResumeDefinitionRecordSchema>;
type ParityRecord = z.infer<typeof ArtifactParityReportRecordSchema>;
type RepresentationKind = ParityRecord["representations"][number]["kind"];
type MismatchCategory = ParityRecord["mismatch_categories"][number];

type ManifestEntry = {
  ordinal: number;
  role: "title" | "section" | "heading" | "bullet" | "line";
  section_id: string | null;
  statement_id: string | null;
  supporting_fact_revision_ids: string[];
  normalized_text: string;
};

type ParityReportBody = Pick<ParityRecord,
  "parity_version" | "approved_definition_revision_id" | "parity_policy_id" | "parity_policy_version" |
  "representations" | "mismatch_categories" | "disposition" | "report_digest" | "checked_at"
>;

export type ArtifactParityEvaluation = {
  report: ParityReportBody;
  unsafe_representations: Exclude<RepresentationKind, "approved_definition">[];
  approved_source_lines: string[];
};

export const ARTIFACT_PARITY_POLICY_ID = "braindrive.resume-builder.artifact-parity.v1";
export const ARTIFACT_PARITY_POLICY_VERSION = "1";

/**
 * Reconstructs every output independently from the approved data contract.
 * This module deliberately does not import renderer logical-entry or parse-back helpers.
 */
export function verifyArtifactParity(input: {
  definition: ResumeDefinition;
  preview_lines: string[];
  clean_text: string;
  pdf_bytes: Uint8Array | null;
  career_markdown: string;
  checked_at: string;
}): ArtifactParityEvaluation {
  const expected = definitionManifest(input.definition);
  const observations: Array<{ kind: RepresentationKind; manifest: ManifestEntry[]; recovered: boolean }> = [
    { kind: "approved_definition", manifest: expected, recovered: true },
    observed("preview", expected, input.preview_lines.map(normalizeText), true),
    observed("clean_text", expected, input.clean_text.split(/\r?\n/).map(normalizeText).filter(Boolean), false),
    observed("pdf_extraction", expected, input.pdf_bytes ? extractPdfLines(input.pdf_bytes) : [], true),
    observedMarkdown(expected, input.career_markdown),
  ];
  const expectedDigest = manifestDigest(expected);
  const unsafe = observations.slice(1).filter((entry) => !entry.recovered || manifestDigest(entry.manifest) !== expectedDigest);
  const mismatchCategories = classifyMismatches(expected, unsafe);
  const disposition: ParityRecord["disposition"] = unsafe.some((entry) => entry.kind === "preview")
    ? "block_preview"
    : unsafe.some((entry) => entry.kind === "clean_text" || entry.kind === "pdf_extraction")
      ? "block_export"
      : unsafe.some((entry) => entry.kind === "career_projection") ? "block_career_projection" : "pass";
  const reportWithoutDigest = {
    parity_version: 1 as const,
    approved_definition_revision_id: input.definition.metadata.revision_id,
    parity_policy_id: ARTIFACT_PARITY_POLICY_ID,
    parity_policy_version: ARTIFACT_PARITY_POLICY_VERSION,
    representations: observations.map(({ kind, manifest }) => ({
      kind,
      revision_id: derivedUuid(`${input.definition.metadata.revision_id}:${kind}:${manifestDigest(manifest)}`),
      logical_manifest_digest: manifestDigest(manifest),
      entry_count: manifest.length,
    })),
    mismatch_categories: mismatchCategories,
    disposition,
    checked_at: input.checked_at,
  };
  return {
    report: { ...reportWithoutDigest, report_digest: canonicalInputDigest(reportWithoutDigest) },
    unsafe_representations: unsafe.map((entry) => entry.kind as Exclude<RepresentationKind, "approved_definition">),
    approved_source_lines: expected.map((entry) => entry.normalized_text),
  };
}

function definitionManifest(definition: ResumeDefinition): ManifestEntry[] {
  const entries: ManifestEntry[] = [{ ordinal: 0, role: "title", section_id: null, statement_id: null, supporting_fact_revision_ids: [], normalized_text: normalizeText(definition.title) }];
  for (const sectionId of definition.section_order) {
    const statements = definition.statements.filter((statement) => statement.section_id === sectionId);
    if (statements.length === 0) continue;
    if (sectionId !== "contact") entries.push({ ordinal: entries.length, role: "section", section_id: sectionId, statement_id: null, supporting_fact_revision_ids: [], normalized_text: sectionLabel(sectionId) });
    for (const statement of statements) {
      const role = statement.display_role ?? (sectionId === "contact" || sectionId === "summary" ? "line" : "bullet");
      const raw = sectionId === "contact" ? contactLine(definition.title, statement.text) : statement.text;
      const normalizedText = normalizeText(`${role === "bullet" ? "- " : ""}${raw}`);
      if (!normalizedText) continue;
      entries.push({ ordinal: entries.length, role, section_id: sectionId, statement_id: statement.statement_id, supporting_fact_revision_ids: [...statement.supporting_confirmed_fact_revision_ids].sort(), normalized_text: normalizedText });
    }
  }
  return entries;
}

function observed(kind: RepresentationKind, expected: ManifestEntry[], lines: string[], mayBeWrapped: boolean) {
  const recoveredLines = mayBeWrapped ? recoverWrappedLines(expected, lines) : lines;
  const recovered = recoveredLines !== null && recoveredLines.length === expected.length && recoveredLines.every((line, index) => line === expected[index]!.normalized_text);
  return { kind, recovered, manifest: recovered ? expected.map((entry) => ({ ...entry })) : rawManifest(recoveredLines ?? lines, expected) };
}

function observedMarkdown(expected: ManifestEntry[], markdown: string) {
  const parsed = markdown.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    if (line.startsWith("## ")) return { role: "section" as const, text: line.slice(3) };
    if (line.startsWith("# ")) return { role: "title" as const, text: line.slice(2) };
    if (line.startsWith("**") && line.endsWith("**")) return { role: "heading" as const, text: line.slice(2, -2) };
    if (line.startsWith("- ")) return { role: "bullet" as const, text: line };
    return { role: "line" as const, text: line };
  }).map((entry) => ({ ...entry, text: normalizeText(entry.text.replace(/\\([\\`*_{}\[\]<>#|])/g, "$1")) }));
  const recovered = parsed.length === expected.length && parsed.every((entry, index) => entry.role === expected[index]!.role && entry.text === expected[index]!.normalized_text);
  return { kind: "career_projection" as const, recovered, manifest: recovered ? expected.map((entry) => ({ ...entry })) : parsed.map((entry, index) => ({ ordinal: index, role: entry.role, section_id: null, statement_id: null, supporting_fact_revision_ids: [], normalized_text: entry.text })) };
}

function recoverWrappedLines(expected: ManifestEntry[], physical: string[]): string[] | null {
  const recovered: string[] = [];
  let cursor = 0;
  for (const entry of expected) {
    let candidate = "";
    while (cursor < physical.length) {
      candidate = normalizeText(candidate ? `${candidate} ${physical[cursor++]}` : physical[cursor++]!);
      if (candidate === entry.normalized_text) break;
      if (!entry.normalized_text.startsWith(candidate)) return null;
    }
    if (candidate !== entry.normalized_text) return null;
    recovered.push(candidate);
  }
  return cursor === physical.length ? recovered : null;
}

function rawManifest(lines: string[], expected: ManifestEntry[]): ManifestEntry[] {
  return lines.map((line, index) => ({
    ordinal: index,
    role: expected[index]?.role ?? "line",
    section_id: null,
    statement_id: null,
    supporting_fact_revision_ids: [],
    normalized_text: normalizeText(line),
  }));
}

function classifyMismatches(expected: ManifestEntry[], unsafe: Array<{ kind: RepresentationKind; manifest: ManifestEntry[]; recovered: boolean }>): MismatchCategory[] {
  const categories = new Set<MismatchCategory>();
  for (const entry of unsafe) {
    if (!entry.recovered) categories.add("field_recovery");
    if (entry.manifest.length !== expected.length) categories.add("count");
    const expectedTexts = expected.map((item) => item.normalized_text);
    const actualTexts = entry.manifest.map((item) => item.normalized_text);
    if (expectedTexts.length === actualTexts.length && [...expectedTexts].sort().join("\n") === [...actualTexts].sort().join("\n") && expectedTexts.join("\n") !== actualTexts.join("\n")) categories.add("order");
    if (manifestDigest(entry.manifest) !== manifestDigest(expected)) categories.add("normalized_digest");
  }
  return (["identity", "association", "field_recovery", "count", "order", "normalized_digest"] as const).filter((category) => categories.has(category));
}

function extractPdfLines(bytes: Uint8Array): string[] {
  const source = Buffer.from(bytes).toString("latin1");
  return [...source.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((match) => {
    const encoded = match[1] ?? "";
    const decoded: number[] = [];
    for (let index = 0; index < encoded.length; index += 1) {
      if (encoded[index] === "\\" && /^[0-7]{3}$/.test(encoded.slice(index + 1, index + 4))) { decoded.push(Number.parseInt(encoded.slice(index + 1, index + 4), 8)); index += 3; continue; }
      if (encoded[index] === "\\" && "\\()".includes(encoded[index + 1] ?? "")) index += 1;
      decoded.push(encoded.charCodeAt(index));
    }
    return normalizeText(Buffer.from(decoded).toString("utf8"));
  });
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();
}

function sectionLabel(value: string): string { return normalizeText(value.replace(/[_-]+/g, " ")).replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function contactLine(title: string, value: string): string { const parts = value.split("|").map((part) => part.trim()).filter(Boolean); if (parts[0]?.toLocaleLowerCase() === title.trim().toLocaleLowerCase()) parts.shift(); return parts.join(" | "); }
function manifestDigest(manifest: ManifestEntry[]) { return canonicalInputDigest(manifest); }
function derivedUuid(seed: string): string { const bytes = createHash("sha256").update(seed).digest().subarray(0, 16); bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80; const value = bytes.toString("hex"); return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`; }
