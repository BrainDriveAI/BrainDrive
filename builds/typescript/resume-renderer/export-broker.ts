import { createHash } from "node:crypto";

import { z } from "zod";

import { OpaqueIdSchema } from "../app-platform/contracts/common.js";
import type { DataAuthority } from "../resume-domain/service.js";
import { ResumeDomainService } from "../resume-domain/service.js";
import { ResumeDomainError } from "../resume-domain/errors.js";
import { renderApprovedResume, renderApprovedResumeCleanText, renderApprovedResumeMarkdown, RESUME_FONT_MANIFEST_DIGEST, type RenderedCleanText, type RenderedResume } from "./renderer.js";
import { verifyArtifactParity, type ArtifactParityEvaluation } from "./parity.js";

const PreviewRequestSchema = z.object({ action: z.literal("preview"), definition_revision_id: OpaqueIdSchema }).strict();
const ExportRequestSchema = z.object({
  action: z.literal("export"),
  format: z.enum(["pdf", "text"]).default("pdf"),
  definition_revision_id: OpaqueIdSchema,
  safe_filename: z.string().min(1).max(128).regex(/^[^/\\]+\.(?:pdf|txt)$/i),
  destination_intent: z.enum(["new_download", "replace_existing"]),
  overwrite_confirmed: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.destination_intent === "replace_existing" && !value.overwrite_confirmed) context.addIssue({ code: "custom", message: "replacement requires explicit overwrite confirmation" });
  if (value.format === "pdf" && !value.safe_filename.toLocaleLowerCase().endsWith(".pdf")) context.addIssue({ code: "custom", path: ["safe_filename"], message: "PDF exports require a .pdf filename" });
  if (value.format === "text" && !value.safe_filename.toLocaleLowerCase().endsWith(".txt")) context.addIssue({ code: "custom", path: ["safe_filename"], message: "Text exports require a .txt filename" });
});
const FinalizeExportRequestSchema = z.object({
  artifact_revision_id: OpaqueIdSchema,
  artifact_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  safe_destination_label: z.string().min(1).max(256).regex(/^[^/\\]+$/),
  outcome: z.enum(["completed", "cancelled", "failed"]),
}).strict();

export type ResumePreview = {
  status: "ready" | "clean_text_only";
  definition: { kind: "general" | "targeted"; safe_label: string; revision_label: string };
  format: "pdf";
  page_count: number;
  lines: string[];
  renderer: { template: string; renderer: string; input_digest: string; parse_back: "passed" | "unavailable" };
  pdf: { status: "ready" | "unavailable"; error_code: null | "pdf_render_failed" };
  clean_text: { text: string; digest: string; input_digest: string; mime_type: "text/plain"; selectable: true; instructions: string };
  parity: { status: "passed" | "blocked"; report_revision_id: string; report_digest: string; disposition: "pass" | "block_preview" | "block_export" | "block_career_projection"; allowed_side_effects: Array<"preview" | "copy" | "text_export" | "pdf_export" | "career_projection">; recovery: string };
};

export type PreparedResumeExport = {
  status: "completed";
  format: "pdf" | "text";
  filename: string;
  mime_type: "application/pdf" | "text/plain";
  bytes_base64: string;
  artifact_revision_id: string;
  artifact_digest: string;
  safe_destination_label: string;
  definition: { kind: "general" | "targeted"; revision_label: string };
  parse_back: "passed";
  parity_report_revision_id: string;
  parity_report_digest: string;
};

export class ResumeExportBroker {
  constructor(
    private readonly domain: ResumeDomainService,
    private readonly audit: (event: string, details: Record<string, unknown>) => void = () => undefined,
    private readonly now = () => new Date(),
    private readonly renderPdf: (definition: Parameters<typeof renderApprovedResume>[0]) => RenderedResume = renderApprovedResume,
  ) {}

  async preview(raw: unknown, authority: DataAuthority): Promise<ResumePreview> {
    const input = PreviewRequestSchema.parse(raw);
    const definition = await this.domain.store.readRevision(input.definition_revision_id, authority.grant.record_scopes);
    if (definition.record_type !== "resume_definition") throw new ResumeDomainError("not_found_within_scope", "Resume version was not found", 404);
    const clean = renderApprovedResumeCleanText(definition);
    let rendered: RenderedResume | null = null;
    try { rendered = this.renderPdf(definition); }
    catch { /* Clean text is deliberately prepared before the fallible PDF path. */ }
    const parity = this.evaluateParity(definition, rendered, clean);
    const persistedParity = await this.persistParity(parity, authority, "preview");
    const previewAllowed = parity.unsafe_representations.includes("preview") === false;
    const cleanAllowed = parity.unsafe_representations.includes("clean_text") === false;
    const fallbackText = `${parity.approved_source_lines.join("\n")}\n`;
    const selectedCleanText = cleanAllowed ? clean.text : fallbackText;
    const selectedCleanDigest = cleanAllowed
      ? clean.artifact_digest
      : `sha256:${createHash("sha256").update(fallbackText).digest("hex")}`;
    this.audit("app.validation.completed", { app_id: authority.grant.app_id, installation_id: authority.grant.installation_id, operation_id: authority.operationId, target_category: "resume_definition", target_id: definition.metadata.record_id, outcome: rendered ? "allowed" : "clean_text_only", item_count: clean.logical_lines.length, error_code: rendered ? null : "pdf_render_failed" });
    return {
      status: rendered && previewAllowed ? "ready" : "clean_text_only",
      definition: { kind: definition.definition_kind, safe_label: definition.title, revision_label: `Version ${definition.metadata.revision}` },
      format: "pdf",
      page_count: rendered?.page_count ?? 0,
      lines: rendered && previewAllowed ? rendered.logical_lines : cleanAllowed ? clean.logical_lines : parity.approved_source_lines,
      renderer: { template: `${definition.template_id}@${definition.template_version}`, renderer: rendered ? `${rendered.renderer_id}@${rendered.renderer_version}` : "unavailable", input_digest: rendered?.input_digest ?? clean.input_digest, parse_back: rendered ? "passed" : "unavailable" },
      pdf: { status: rendered ? "ready" : "unavailable", error_code: rendered ? null : "pdf_render_failed" },
      clean_text: { text: selectedCleanText, digest: selectedCleanDigest, input_digest: clean.input_digest, mime_type: "text/plain", selectable: true, instructions: cleanAllowed ? "Select the clean text and copy it manually if Copy or text export is unavailable." : "The generated clean text was blocked. This selectable fallback was reconstructed independently from the unchanged approved source." },
      parity: this.parityProjection(parity, persistedParity.report.metadata.revision_id, persistedParity.report.report_digest),
    };
  }

  async export(raw: unknown, authority: DataAuthority): Promise<PreparedResumeExport> {
    const input = ExportRequestSchema.parse(raw);
    const definition = await this.domain.store.readRevision(input.definition_revision_id, authority.grant.record_scopes);
    if (definition.record_type !== "resume_definition") throw new ResumeDomainError("not_found_within_scope", "Resume version was not found", 404);
    const pdf = input.format === "pdf" ? this.tryRenderPdf(definition) : null;
    const text = input.format === "text" ? renderApprovedResumeCleanText(definition) : null;
    const parityClean = text ?? renderApprovedResumeCleanText(definition);
    const parityPdf = pdf ?? this.tryRenderPdf(definition);
    const parity = this.evaluateParity(definition, parityPdf, parityClean);
    const persistedParity = await this.persistParity(parity, authority, `export-${input.format}`);
    const requestedRepresentation = input.format === "pdf" ? "pdf_extraction" : "clean_text";
    if (parity.unsafe_representations.includes(requestedRepresentation)) {
      throw new ResumeDomainError("validation_failed", `The ${input.format.toUpperCase()} export failed artifact parity. The approved source remains unchanged.`);
    }
    const rendered = pdf ?? text!;
    if (authority.isCancelled?.()) throw new ResumeDomainError("cancelled", "Export was cancelled before creating a file");
    const artifactAuthority: DataAuthority = { ...authority, capability: "resume.artifacts.register", operationId: derivedUuid(authority.operationId, "artifact"), idempotencyKey: `${authority.idempotencyKey}:artifact` };
    const artifactResult = await this.domain.registerArtifact({
      definition_revision_id: definition.metadata.revision_id,
      template_id: definition.template_id,
      template_version: definition.template_version,
      renderer_id: pdf?.renderer_id ?? "braindrive.ats-text",
      renderer_version: pdf?.renderer_version ?? "1",
      font_manifest_digest: pdf?.font_manifest_digest ?? RESUME_FONT_MANIFEST_DIGEST,
      validation_run_id: definition.approval_evidence!.validation_run_id,
      findings: [],
      artifact_digest: rendered.artifact_digest,
      format: input.format,
      accepted: true,
    }, artifactAuthority);
    const artifact = artifactResult.artifact;
    if (artifact.record_type !== "artifact") throw new ResumeDomainError("recoverable_internal_failure", "Export artifact registration failed");
    if (authority.isCancelled?.()) {
      await this.domain.recordExportReceipt({ artifact_revision_id: artifact.metadata.revision_id, artifact_digest: artifact.artifact_digest, format: input.format, outcome: "cancelled", exported_at: this.now().toISOString(), safe_destination_label: input.safe_filename }, { ...authority, operationId: derivedUuid(authority.operationId, "cancelled-receipt"), idempotencyKey: `${authority.idempotencyKey}:cancelled` });
      throw new ResumeDomainError("cancelled", "Export was cancelled. The approved resume was preserved.");
    }
    this.audit("app.export.prepared", { app_id: authority.grant.app_id, installation_id: authority.grant.installation_id, operation_id: authority.operationId, target_category: "artifact", target_id: artifact.metadata.record_id, outcome: "prepared", item_count: rendered.bytes.length, error_code: null });
    return {
      status: "completed",
      format: input.format,
      filename: input.safe_filename,
      mime_type: input.format === "pdf" ? "application/pdf" : "text/plain",
      bytes_base64: rendered.bytes.toString("base64"),
      artifact_revision_id: artifact.metadata.revision_id,
      artifact_digest: artifact.artifact_digest,
      safe_destination_label: input.safe_filename,
      definition: { kind: definition.definition_kind, revision_label: `Version ${definition.metadata.revision}` },
      parse_back: "passed",
      parity_report_revision_id: persistedParity.report.metadata.revision_id,
      parity_report_digest: persistedParity.report.report_digest,
    };
  }

  async finalize(raw: unknown, authority: DataAuthority): Promise<{ status: "completed"; receipt_revision_id: string; safe_destination_label: string; outcome: "completed" | "cancelled" | "failed" }> {
    const input = FinalizeExportRequestSchema.parse(raw);
    const artifact = await this.domain.store.readRevision(input.artifact_revision_id, authority.grant.record_scopes);
    if (artifact.record_type !== "artifact" || artifact.artifact_digest !== input.artifact_digest || !["pdf", "text"].includes(artifact.format) || !artifact.accepted) {
      throw new ResumeDomainError("not_found_within_scope", "Prepared export artifact was not found", 404);
    }
    const receiptAuthority = { ...authority, operationId: derivedUuid(authority.operationId, `receipt-${input.outcome}`), idempotencyKey: `${authority.idempotencyKey}:${input.outcome}` };
    const reconciled = await this.reconcileReceipt(input, receiptAuthority);
    if (reconciled) return reconciled;
    const expectedExtension = artifact.format === "pdf" ? ".pdf" : ".txt";
    if (!input.safe_destination_label.toLocaleLowerCase().endsWith(expectedExtension)) throw new ResumeDomainError("validation_failed", "Export destination label does not match the prepared artifact format");
    const receiptResult = await this.domain.recordExportReceipt({ artifact_revision_id: artifact.metadata.revision_id, artifact_digest: artifact.artifact_digest, format: artifact.format, outcome: input.outcome, exported_at: this.now().toISOString(), safe_destination_label: input.safe_destination_label }, receiptAuthority);
    const receipt = receiptResult.receipt;
    if (receipt.record_type !== "export_receipt") throw new ResumeDomainError("recoverable_internal_failure", "Export receipt registration failed");
    this.audit("app.export.completed", { app_id: authority.grant.app_id, installation_id: authority.grant.installation_id, operation_id: authority.operationId, target_category: "artifact", target_id: artifact.metadata.record_id, outcome: input.outcome, item_count: 1, error_code: input.outcome === "failed" ? "export_failed" : null });
    return { status: "completed", receipt_revision_id: receipt.metadata.revision_id, safe_destination_label: receipt.safe_destination_label, outcome: receipt.outcome };
  }

  private async reconcileReceipt(
    input: z.infer<typeof FinalizeExportRequestSchema>,
    authority: DataAuthority,
  ): Promise<{ status: "completed"; receipt_revision_id: string; safe_destination_label: string; outcome: "completed" | "cancelled" | "failed" } | null> {
    try {
      const existing = await this.domain.store.operation(authority.operationId, authority.grant.installation_id, {
        ownerId: authority.grant.owner_id,
        actorId: authority.grant.actor_id,
        grantedCapabilities: authority.grant.capabilities,
        recordScopes: authority.grant.record_scopes,
      });
      const receipt = existing.results.find((record) => record.record_type === "export_receipt");
      if (!receipt || receipt.record_type !== "export_receipt") throw new ResumeDomainError("recoverable_internal_failure", "Export receipt reconciliation failed");
      if (
        receipt.artifact_revision_id !== input.artifact_revision_id ||
        receipt.artifact_digest !== input.artifact_digest ||
        receipt.outcome !== input.outcome ||
        receipt.safe_destination_label !== input.safe_destination_label
      ) throw new ResumeDomainError("idempotency_conflict", "Export completion identity was already used for a different outcome");
      return { status: "completed", receipt_revision_id: receipt.metadata.revision_id, safe_destination_label: receipt.safe_destination_label, outcome: receipt.outcome };
    } catch (error) {
      if (error instanceof ResumeDomainError && error.code === "not_found_within_scope") return null;
      throw error;
    }
  }

  private evaluateParity(definition: Parameters<typeof renderApprovedResume>[0], rendered: RenderedResume | null, clean: RenderedCleanText): ArtifactParityEvaluation {
    return verifyArtifactParity({
      definition,
      preview_lines: rendered?.logical_lines ?? clean.logical_lines,
      clean_text: clean.text,
      pdf_bytes: rendered?.bytes ?? null,
      career_markdown: renderApprovedResumeMarkdown(definition),
      checked_at: this.now().toISOString(),
    });
  }

  private tryRenderPdf(definition: Parameters<typeof renderApprovedResume>[0]): RenderedResume | null {
    try { return this.renderPdf(definition); }
    catch { return null; }
  }

  private async persistParity(parity: ArtifactParityEvaluation, authority: DataAuthority, stage: string) {
    const parityAuthority: DataAuthority = { ...authority, capability: "resume.export.request", operationId: derivedUuid(authority.operationId, `parity-${stage}`), idempotencyKey: `${authority.idempotencyKey}:parity:${stage}` };
    const persisted = await this.domain.writeArtifactParityReport(parity.report, parityAuthority);
    this.audit("app.resume_parity.checked", {
      app_id: authority.grant.app_id,
      installation_id: authority.grant.installation_id,
      operation_id: authority.operationId,
      target_category: "artifact_parity_report",
      target_id: persisted.report.metadata.record_id,
      parity_revision_id: persisted.report.metadata.revision_id,
      parity_digest: persisted.report.report_digest,
      definition_revision_id: persisted.report.approved_definition_revision_id,
      outcome: persisted.report.disposition === "pass" ? "allowed" : "denied",
      item_count: persisted.report.representations.length,
      error_code: persisted.report.disposition === "pass" ? null : "artifact_parity_mismatch",
      timing_class: "automation",
    });
    return persisted;
  }

  private parityProjection(parity: ArtifactParityEvaluation, reportRevisionId: string, reportDigest: string): ResumePreview["parity"] {
    const unsafe = new Set(parity.unsafe_representations);
    return {
      status: parity.report.disposition === "pass" ? "passed" : "blocked",
      report_revision_id: reportRevisionId,
      report_digest: reportDigest,
      disposition: parity.report.disposition,
      allowed_side_effects: [
        ...(!unsafe.has("preview") ? ["preview" as const] : []),
        ...(!unsafe.has("clean_text") ? ["copy" as const, "text_export" as const] : []),
        ...(!unsafe.has("pdf_extraction") ? ["pdf_export" as const] : []),
        ...(!unsafe.has("career_projection") ? ["career_projection" as const] : []),
      ],
      recovery: parity.report.disposition === "pass" ? "All representations match the approved definition." : "Only the affected action is unavailable; the approved source remains unchanged and verified fallback text remains selectable when safe.",
    };
  }
}

function derivedUuid(operationId: string, stage: string): string {
  const bytes = createHash("sha256").update(`${operationId}:${stage}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
