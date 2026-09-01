import { randomUUID } from "node:crypto";

export * from "./workflow.js";
export * from "./internet-search.js";

export const BRIEF_APP_STORAGE_DOCUMENTS = {
  source: {
    documentId: "brief.source",
    bindingId: "brief.source.current",
    role: "source_document",
    retentionClass: "durable_owner_data",
    mediaType: "text/markdown",
  },
  draft: {
    documentId: "brief.draft",
    bindingId: "brief.draft.current",
    role: "derived_document",
    retentionClass: "durable_owner_data",
    mediaType: "application/json",
  },
  actionResult: {
    documentId: "brief.action-result",
    bindingId: "brief.action-result.latest",
    role: "action_result_document",
    retentionClass: "durable_operation_lookup",
    mediaType: "application/json",
  },
  previewCache: {
    documentId: "brief.preview",
    bindingId: "brief.preview.cache",
    role: "action_result_document",
    retentionClass: "transient_abandoned_operation",
    mediaType: "application/json",
  },
} as const;

export const BRIEF_APP_ACTIONS = [
  {
    actionId: "brief.proof.read",
    kind: "read",
    capability: "brief.records.read",
    inputSchemaId: "brief.proof.read.input.v1",
    resultSchemaId: "brief.proof.read.result.v1",
    idempotencyPolicy: "optional",
    confirmation: "none",
  },
  {
    actionId: "brief.proof.write",
    kind: "write",
    capability: "brief.records.write",
    inputSchemaId: "brief.proof.write.input.v1",
    resultSchemaId: "brief.proof.write.result.v1",
    idempotencyPolicy: "required",
    confirmation: "none",
  },
] as const;

export function buildBriefProofWriteActionInput(input: {
  sourceRevisionId: string;
  expectedCatalogRevision: number;
  title: string;
  statementText: string;
  supportContext: string;
  statementId?: string;
}) {
  return {
    action: "edit",
    source_revision_id: input.sourceRevisionId,
    expected_catalog_revision: input.expectedCatalogRevision,
    title: input.title,
    statements: [{
      statement_id: input.statementId ?? randomUUID(),
      text: input.statementText,
      support: { kind: "owner_context", context: input.supportContext },
    }],
  } as const;
}
