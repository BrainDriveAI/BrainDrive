import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  CareerContextProjectionSchema,
  CareerReturnSummarySchema,
  ResumeDefinitionRecordSchema,
  TailoredVariantRecordSchema,
} from "../app-platform/contracts/data.js";
import { canonicalJson } from "../app-platform/contracts/common.js";
import { commitMemoryChange } from "../git.js";
import { ResumeDomainError } from "./errors.js";
import { craftDefinitionDigest } from "../resume-inference/craft-evaluator.js";
import { resumeQualityStateLabel } from "./quality-state.js";

export type CareerContextProjection = z.infer<typeof CareerContextProjectionSchema>;
export type CareerReturnSummary = z.infer<typeof CareerReturnSummarySchema>;

const CONTEXT_SOURCES = [
  { source_kind: "owner_profile", relativePath: "me/profile.md" },
  { source_kind: "career_spec", relativePath: "documents/career/spec.md" },
  { source_kind: "career_plan", relativePath: "documents/career/plan.md" },
] as const;

const JOURNAL_ANCHOR = "<!-- New entries go directly below this line, newest first, using the standard journal entry format from run-journal.md. Keep this line in place. -->";
const JOURNAL_HEADER = `# Your Career Journal\n\n*Your follow-up history for Career — what's happened since your plan was written, the wins, the blockers, and what you want to do next. BrainDrive keeps this current with you. You can add to it or edit it anytime, and it's never required.*\n\n${JOURNAL_ANCHOR}\n`;

const CareerReturnOperationSchema = z.object({
  operation_id: z.string().uuid(),
  input_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  before_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  after_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  status: z.enum(["pending", "completed"]),
}).strict();

type CareerReturnOperation = z.infer<typeof CareerReturnOperationSchema>;

export class CareerPlacementAdapter {
  private tail = Promise.resolve();

  constructor(public readonly memoryRoot: string, private readonly now = () => new Date()) {}

  async project(entryPoint: "direct" | "career"): Promise<CareerContextProjection> {
    const sources: CareerContextProjection["sources"] = [];
    for (const source of CONTEXT_SOURCES) {
      const filePath = path.join(this.memoryRoot, source.relativePath);
      try {
        const details = await lstat(filePath);
        if (!details.isFile() || details.isSymbolicLink()) {
          throw new ResumeDomainError("validation_failed", `Accepted ${source.source_kind} context is not a regular owner file`, 409);
        }
        const content = await readFile(filePath, "utf8");
        if (Buffer.byteLength(content, "utf8") > 16_384) throw new ResumeDomainError("validation_failed", `Accepted ${source.source_kind} context exceeds its bounded projection`, 413);
        sources.push({
          source_ref: this.sourceRef(source.source_kind), source_kind: source.source_kind, status: "present", content,
          content_digest: `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`,
          last_modified_at: details.mtime.toISOString(),
        });
      } catch (error) {
        if (error instanceof ResumeDomainError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new ResumeDomainError("recoverable_internal_failure", `Accepted ${source.source_kind} context could not be read`, 500);
        }
        sources.push({ source_ref: this.sourceRef(source.source_kind), source_kind: source.source_kind, status: "missing", content: null, content_digest: null, last_modified_at: null });
      }
    }
    return CareerContextProjectionSchema.parse({ context_version: 1, entry_point: entryPoint, sources, generated_at: this.now().toISOString() });
  }

  async placeReturn(summaryInput: CareerReturnSummary, operationId: string): Promise<{ placement: "career_journal"; committed: true; reused: boolean }> {
    try {
      return await this.serial(() => this.placeReturnSerial(summaryInput, operationId));
    } catch (error) {
      if (error instanceof ResumeDomainError || error instanceof z.ZodError) throw error;
      throw new ResumeDomainError("recoverable_internal_failure", "Career return summary placement failed", 500);
    }
  }

  private async placeReturnSerial(summaryInput: CareerReturnSummary, operationId: string): Promise<{ placement: "career_journal"; committed: true; reused: boolean }> {
    const summary = CareerReturnSummarySchema.parse(summaryInput);
    z.string().uuid().parse(operationId);
    const journalPath = path.join(this.memoryRoot, "documents", "career", "journal.md");
    let current: string;
    try { current = await readFile(journalPath, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      current = JOURNAL_HEADER;
    }
    const date = summary.updated_at.slice(0, 10);
    const lines = [`## ${date} - Resume Builder Return`, "", "- Source: Resume Builder", "- Entry:"];
    if (summary.summary_version === 2) {
      lines.push(`  - Quality status: ${resumeQualityStateLabel(summary.quality_state)}`);
      lines.push(`  - Approved resume revision: ${summary.approved_reference.revision_id}`);
      if (summary.craft_report_reference) lines.push(`  - Product craft report revision: ${summary.craft_report_reference.revision_id}`);
    } else {
      lines.push(`  - Status: ${summary.status}`);
      lines.push(`  - Outcome: ${summary.outcome_summary}`);
      if (summary.approved_reference) lines.push(`  - Approved resume: ${summary.approved_reference.safe_label}`);
      if (summary.stable_fact_proposals.length > 0) {
        lines.push("  - Stable fact proposals for owner profile review:");
        for (const proposal of summary.stable_fact_proposals) lines.push(`    - ${proposal.safe_summary}`);
      }
      if (summary.next_career_action) lines.push(`  - Next Career action: ${summary.next_career_action}`);
    }
    lines.push("- Status: needs owner review", "");
    const entry = lines.join("\n");
    const normalized = this.ensureAnchor(current);
    const updated = normalized.replace(JOURNAL_ANCHOR, `${JOURNAL_ANCHOR}\n\n${entry}`);
    const operationPath = path.join(this.memoryRoot, "apps", "resume-builder", "career-return-operations", `${operationId}.json`);
    const inputDigest = this.digest(canonicalJson(summary));
    const pending: CareerReturnOperation = {
      operation_id: operationId,
      input_digest: inputDigest,
      before_digest: this.digest(current),
      after_digest: this.digest(updated),
      status: "pending",
    };
    const existing = await this.readOperation(operationPath);
    if (existing) {
      if (existing.input_digest !== inputDigest) throw new ResumeDomainError("idempotency_conflict", "Career return operation input does not match its first use", 409);
      if (existing.status === "completed") return { placement: "career_journal", committed: true, reused: true };
      const currentDigest = this.digest(current);
      if (currentDigest === existing.after_digest) {
        await this.writeAtomic(operationPath, `${JSON.stringify({ ...existing, status: "completed" }, null, 2)}\n`);
        return { placement: "career_journal", committed: true, reused: true };
      }
      if (currentDigest !== existing.before_digest) throw new ResumeDomainError("conflict", "Career journal changed while return placement was pending", 409);
    } else {
      await this.writeAtomic(operationPath, `${JSON.stringify(pending, null, 2)}\n`);
    }
    await this.writeAtomic(journalPath, updated);
    await this.writeAtomic(operationPath, `${JSON.stringify({ ...(existing ?? pending), status: "completed" }, null, 2)}\n`);
    await commitMemoryChange(this.memoryRoot, "Record Resume Builder Career return summary");
    return { placement: "career_journal", committed: true, reused: false };
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private sourceRef(sourceKind: (typeof CONTEXT_SOURCES)[number]["source_kind"]): string {
    const bytes = createHash("sha256").update(`ai.braindrive.resume-builder:career-context:v1\0${sourceKind}`, "utf8").digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  private digest(content: string): `sha256:${string}` {
    return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
  }

  private async readOperation(operationPath: string): Promise<CareerReturnOperation | null> {
    try { return CareerReturnOperationSchema.parse(JSON.parse(await readFile(operationPath, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (error instanceof SyntaxError || error instanceof z.ZodError) throw new ResumeDomainError("validation_failed", "Career return operation record is invalid", 409);
      throw error;
    }
  }

  private ensureAnchor(content: string): string {
    const occurrences = content.split(JOURNAL_ANCHOR).length - 1;
    if (occurrences === 1) return content;
    if (occurrences > 1) {
      let kept = false;
      return content.split("\n").filter((line) => {
        if (line !== JOURNAL_ANCHOR) return true;
        if (!kept) { kept = true; return true; }
        return false;
      }).join("\n");
    }
    const firstEntry = content.search(/^## \d{4}-\d{2}-\d{2}/m);
    if (firstEntry >= 0) return `${content.slice(0, firstEntry).trimEnd()}\n\n${JOURNAL_ANCHOR}\n\n${content.slice(firstEntry)}`;
    return `${content.trimEnd()}\n\n${JOURNAL_ANCHOR}\n`;
  }

  private async writeAtomic(targetPath: string, content: string): Promise<void> {
    await mkdir(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try { await handle.writeFile(content, "utf8"); await handle.sync(); } finally { await handle.close(); }
    try { await rename(temporaryPath, targetPath); }
    catch (error) { await rm(temporaryPath, { force: true }); throw error; }
  }
}

export function redactedCareerSummaryDigest(summary: CareerReturnSummary): `sha256:${string}` {
  const redacted = summary.summary_version === 2
    ? { quality_state: summary.quality_state, approved: true, has_report: summary.craft_report_reference !== null }
    : { status: summary.status, approved: Boolean(summary.approved_reference), proposal_count: summary.stable_fact_proposals.length, has_next_action: Boolean(summary.next_career_action) };
  return `sha256:${createHash("sha256").update(canonicalJson(redacted)).digest("hex")}`;
}

export function buildCareerReturnSummary(
  definitionInput: z.infer<typeof ResumeDefinitionRecordSchema>,
  variantInput: z.infer<typeof TailoredVariantRecordSchema> | null,
  updatedAt: string,
): Extract<CareerReturnSummary, { summary_version: 2 }> {
  const definition = ResumeDefinitionRecordSchema.parse(definitionInput);
  if (definition.status !== "approved" || !definition.approval_evidence) {
    throw new ResumeDomainError("validation_failed", "Career return requires one exact approved definition");
  }
  const persuasive = definition.approval_evidence.persuasive_quality;
  const qualityState = persuasive?.contract_version === 2 ? "owner_approved" as const : "pre_correction_review" as const;
  const variant = definition.definition_kind === "targeted" ? TailoredVariantRecordSchema.parse(variantInput) : null;
  if (definition.definition_kind === "targeted" && variant?.targeted_definition_revision_id !== definition.metadata.revision_id) {
    throw new ResumeDomainError("validation_failed", "Career return targeted variant does not bind the approved definition");
  }
  return CareerReturnSummarySchema.parse({
    summary_version: 2,
    approved_reference: {
      kind: definition.definition_kind === "general" ? "general_resume" : "tailored_variant",
      record_id: definition.definition_kind === "general" ? definition.metadata.record_id : variant!.metadata.record_id,
      revision_id: definition.definition_kind === "general" ? definition.metadata.revision_id : variant!.metadata.revision_id,
      definition_digest: craftDefinitionDigest(definition),
    },
    quality_state: qualityState,
    craft_report_reference: persuasive?.contract_version === 2 ? {
      revision_id: persuasive.craft_report_revision_id,
      report_digest: persuasive.craft_report_digest,
    } : null,
    updated_at: updatedAt,
  }) as Extract<CareerReturnSummary, { summary_version: 2 }>;
}
