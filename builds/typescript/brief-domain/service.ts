import { randomUUID } from "node:crypto";
import { z } from "zod";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import { BriefGenerateOutputSchema, type BriefGenerateOutput } from "../brief-inference/contracts.js";
import { BriefDataStore } from "./store.js";

export const BriefReadInputSchema = z.object({ action: z.literal("reopen") }).strict();
export const BriefReadResultSchema = z.object({
  source: z.unknown().nullable(), draft: z.unknown().nullable(), approved: z.unknown().nullable(), catalog_revision: z.number().int().nonnegative(),
}).strict();
export const BriefEditInputSchema = z.object({
  action: z.literal("edit"), source_revision_id: z.string().uuid(), title: z.string().trim().min(1).max(160),
  statements: BriefGenerateOutputSchema.shape.statements, expected_catalog_revision: z.number().int().nonnegative(),
}).strict();
export const BriefEditResultSchema = z.object({ draft: z.unknown(), catalog_revision: z.number().int().nonnegative() }).strict();
export const BriefApproveInputSchema = z.object({
  action: z.literal("approve"), draft_revision_id: z.string().uuid(), expected_catalog_revision: z.number().int().nonnegative(),
}).strict();
export const BriefApproveResultSchema = z.object({ approved_revision_id: z.string().uuid(), revision: z.number().int().positive(), predecessor_revision_id: z.string().uuid().nullable() }).strict();
export const BriefGenerateCapabilityInputSchema = z.object({
  purpose_id: z.literal("brief.generate"), version: z.literal(1), input: z.object({ source_text: z.string().trim().min(1).max(32_768), owner_context: z.array(z.string().trim().min(1).max(2_048)).max(8).default([]) }).strict(),
}).strict();
export const BriefGenerateCapabilityResultSchema = z.object({ source: z.unknown(), draft: BriefGenerateOutputSchema.and(z.object({ draft_revision_id: z.string().uuid(), source_revision_id: z.string().uuid(), revision: z.number().int().positive(), content_digest: z.string(), generated_by: z.literal("brief.generate@1"), created_at: z.string() })), catalog_revision: z.number().int().nonnegative() }).strict();

export class BriefDomainService {
  constructor(readonly store: BriefDataStore) {}

  async reopen() {
    const [state, catalog] = await Promise.all([this.store.reopen(), this.store.catalog()]);
    return { ...state, catalog_revision: catalog.revision };
  }

  async generate(raw: unknown, context: { operationId: string; idempotencyKey: string; signal: AbortSignal; executeInference: (request: unknown) => Promise<unknown> }) {
    const request = BriefGenerateCapabilityInputSchema.parse(raw);
    const sourceRevisionId = randomUUID();
    const output = BriefGenerateOutputSchema.parse(await context.executeInference({
      purpose_id: request.purpose_id, version: request.version,
      input: { source_revision_id: sourceRevisionId, source_text: request.input.source_text, source_digest: canonicalInputDigest(request.input.source_text), owner_context: request.input.owner_context },
    })) as BriefGenerateOutput;
    if (context.signal.aborted) throw new AppPlatformError("cancelled", "Brief generation was cancelled", 408);
    let catalog = await this.store.catalog();
    const source = await this.store.saveSource({ source_revision_id: sourceRevisionId, text: request.input.source_text, expected_catalog_revision: catalog.revision, idempotency_key: `${context.idempotencyKey}-source` });
    catalog = await this.store.catalog();
    const draft = await this.store.saveDraft({ source_revision_id: source.source_revision_id, title: output.title, statements: output.statements, generated_by: "brief.generate@1", expected_catalog_revision: catalog.revision, idempotency_key: `${context.idempotencyKey}-draft` });
    return { source, draft, catalog_revision: (await this.store.catalog()).revision };
  }

  async edit(raw: unknown, idempotencyKey: string) {
    const input = BriefEditInputSchema.parse(raw);
    const { action: _action, ...draftInput } = input;
    const draft = await this.store.saveDraft({ ...draftInput, generated_by: "owner_edit", idempotency_key: idempotencyKey });
    return { draft, catalog_revision: (await this.store.catalog()).revision };
  }

  async approve(raw: unknown, context: { idempotencyKey: string; ownerConfirmed: boolean; proofId?: string }) {
    const input = BriefApproveInputSchema.parse(raw);
    if (!context.ownerConfirmed || !context.proofId) throw new AppPlatformError("denied", "Brief approval requires host owner confirmation", 403);
    const { action: _action, ...approveInput } = input;
    const approved = await this.store.approve({ ...approveInput, idempotency_key: context.idempotencyKey, host_owner_confirmed: true, owner_confirmation_proof_id: context.proofId });
    return { approved_revision_id: approved.approved_revision_id, revision: approved.revision, predecessor_revision_id: approved.predecessor_revision_id };
  }
}
