import { createHash } from "node:crypto";

import { z } from "zod";

import { OpaqueIdSchema } from "../app-platform/contracts/common.js";
import type { DataAuthority } from "../resume-domain/service.js";
import { ResumeDomainService } from "../resume-domain/service.js";
import { ResumeDomainError } from "../resume-domain/errors.js";
import { renderApprovedResume, renderApprovedResumeCleanText, RESUME_FONT_MANIFEST_DIGEST, type RenderedResume } from "./renderer.js";

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
    this.audit("app.validation.completed", { app_id: authority.grant.app_id, installation_id: authority.grant.installation_id, operation_id: authority.operationId, target_category: "resume_definition", target_id: definition.metadata.record_id, outcome: rendered ? "allowed" : "clean_text_only", item_count: clean.logical_lines.length, error_code: rendered ? null : "pdf_render_failed" });
    return {
      status: rendered ? "ready" : "clean_text_only",
      definition: { kind: definition.definition_kind, safe_label: definition.title, revision_label: `Version ${definition.metadata.revision}` },
      format: "pdf",
      page_count: rendered?.page_count ?? 0,
      lines: rendered?.logical_lines ?? clean.logical_lines,
      renderer: { template: `${definition.template_id}@${definition.template_version}`, renderer: rendered ? `${rendered.renderer_id}@${rendered.renderer_version}` : "unavailable", input_digest: rendered?.input_digest ?? clean.input_digest, parse_back: rendered ? "passed" : "unavailable" },
      pdf: { status: rendered ? "ready" : "unavailable", error_code: rendered ? null : "pdf_render_failed" },
      clean_text: { text: clean.text, digest: clean.artifact_digest, input_digest: clean.input_digest, mime_type: "text/plain", selectable: true, instructions: "Select the clean text and copy it manually if Copy or text export is unavailable." },
    };
  }

  async export(raw: unknown, authority: DataAuthority): Promise<PreparedResumeExport> {
    const input = ExportRequestSchema.parse(raw);
    const definition = await this.domain.store.readRevision(input.definition_revision_id, authority.grant.record_scopes);
    if (definition.record_type !== "resume_definition") throw new ResumeDomainError("not_found_within_scope", "Resume version was not found", 404);
    const pdf = input.format === "pdf" ? this.renderPdf(definition) : null;
    const text = input.format === "text" ? renderApprovedResumeCleanText(definition) : null;
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
}

function derivedUuid(operationId: string, stage: string): string {
  const bytes = createHash("sha256").update(`${operationId}:${stage}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
