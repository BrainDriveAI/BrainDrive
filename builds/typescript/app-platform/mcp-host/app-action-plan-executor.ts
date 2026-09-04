import { createHash } from "node:crypto";

import type { CapabilityDispatcher } from "../../app-capabilities/dispatcher.js";
import type { AppArtifactExportService } from "../../app-capabilities/artifact-export.js";
import type { CapabilityGrant, StoredPackage } from "../lifecycle/store.js";
import { AppPlatformError } from "../lifecycle/errors.js";
import type { AppDocumentStorageService } from "../storage/app-document-store.js";
import {
  AppActionExecutionPlanSchema,
} from "../contracts/app-action-plan.js";
import type { RuntimeExportBytesReference } from "../contracts/app-action-plan.js";
import type {
  AppDocumentStorageAuthority,
} from "../contracts/app-storage.js";
import type { AppActionDescriptor, WorkspaceDocumentDescriptor } from "../contracts/app-registry.js";
import type { AppChatSessionRecord } from "./app-chat-session.js";
import type { CapabilityDispatchContext } from "../../app-capabilities/dispatcher.js";
import { defaultRetentionClassForDocument, documentStorageRole, readOrSeedAppDocument } from "./app-document-content.js";

type Workspace = {
  documents: ReadonlyArray<WorkspaceDocumentDescriptor>;
};

export async function executeAppActionPlan(input: {
  rawPlan: unknown;
  action: AppActionDescriptor;
  session: AppChatSessionRecord;
  workspace: Workspace;
  grant: CapabilityGrant;
  storedPackage: StoredPackage;
  manifestRequests: CapabilityDispatchContext["manifestRequests"];
  requestedPurposes: NonNullable<CapabilityDispatchContext["requestedPurposes"]>;
  operationId: string;
  idempotencyKey: string;
  ownerConfirmed: boolean;
  now: () => number;
  capabilityDispatcher: CapabilityDispatcher;
  documentStorage: AppDocumentStorageService;
  artifactExports: AppArtifactExportService;
  resolveRuntimeExportBytes?: (reference: RuntimeExportBytesReference, expected: {
    contentDigest: string;
    contentSizeBytes: number;
    mediaType: string;
    filename: string;
  }) => Promise<Buffer>;
  storageAuthority: AppDocumentStorageAuthority;
  artifactAuthority: AppDocumentStorageAuthority;
  audit: (event: string, details: Record<string, unknown>) => void;
}): Promise<unknown> {
  const plan = AppActionExecutionPlanSchema.parse(input.rawPlan);
  if (plan.action_id !== input.action.action_id) {
    throw new AppPlatformError("validation_failed", "App action plan does not match the requested action", 409);
  }
  const allowedCapabilities = new Set(input.action.required_capabilities.map((capability) => `${capability.name}@${capability.version}`));
  const results = new Map<string, unknown>();
  for (const step of plan.steps) {
    if (step.type === "capability.call") {
      const key = `${step.capability}@${step.capability_version}`;
      if (!allowedCapabilities.has(key)) {
        throw new AppPlatformError("denied", "App action plan requested an undeclared capability", 403);
      }
      const result = await input.capabilityDispatcher.execute(step.capability, step.capability_version, step.input, {
        appId: input.session.appId,
        installationId: input.session.installationId,
        packageDigest: input.session.packageDigest,
        sessionId: input.session.sessionId,
        viewId: input.session.viewId,
        lifecycleGeneration: input.session.lifecycleGeneration,
        grantId: input.session.grantId,
        grantRevision: input.session.grantRevision,
        revocationGeneration: input.session.revocationGeneration,
        manifestRequests: input.manifestRequests,
        requestedPurposes: input.requestedPurposes,
        grant: input.grant,
        operationId: input.operationId,
        idempotencyKey: childIdempotencyKey(input.idempotencyKey, step.step_id),
        deadlineAt: input.now() + 120_000,
        ownerConfirmation: {
          confirmed: step.owner_confirmation === "none" ? false : input.ownerConfirmed,
          proofId: step.owner_confirmation === "none" || !input.ownerConfirmed ? undefined : stableProofId(input.operationId, step.step_id),
        },
      });
      results.set(step.step_id, result);
      continue;
    }
    if (step.type === "document.read") {
      const document = input.workspace.documents.find((candidate) => candidate.document_id === step.document_id);
      if (!document || !document.data_binding_id) {
        throw new AppPlatformError("not_found_within_scope", "App action plan referenced an undeclared document", 404);
      }
      if (document.role === "conversation" || document.role === "advanced_resource") {
        throw new AppPlatformError("denied", "App action plan cannot read this workspace item as a document", 403);
      }
      const record = await readOrSeedAppDocument({
        documentStorage: input.documentStorage,
        authority: input.storageAuthority,
        storedPackage: input.storedPackage,
        document,
        operationId: input.operationId,
        idempotencyKey: input.idempotencyKey,
        audit: input.audit,
      });
      results.set(step.step_id, {
        result_version: 1,
        state: record ? "current" : "missing",
        document_id: document.document_id,
        document_binding_id: document.data_binding_id,
        record,
      });
      continue;
    }
    if (step.type === "document.write") {
      const document = input.workspace.documents.find((candidate) => candidate.document_id === step.document_id);
      if (!document || !document.data_binding_id) {
        throw new AppPlatformError("not_found_within_scope", "App action plan referenced an undeclared document", 404);
      }
      if (document.role === "conversation" || document.role === "advanced_resource") {
        throw new AppPlatformError("denied", "App action plan cannot write this workspace item", 403);
      }
      await input.documentStorage.initialize();
      await input.documentStorage.bindActiveAuthority(input.storageAuthority);
      const current = await input.documentStorage.readDocument(input.storageAuthority, document.document_id);
      const result = await input.documentStorage.writeDocument({
        request_version: 1,
        authority: input.storageAuthority,
        document_id: document.document_id,
        document_binding_id: document.data_binding_id,
        record_kind: "document",
        role: documentStorageRole(document),
        retention_class: step.retention_class ?? defaultRetentionClassForDocument(document),
        media_type: step.media_type ?? (typeof step.content === "string" ? "text/markdown" : "application/json"),
        expected_revision: step.expected_revision === "current" ? current?.revision ?? null : null,
        operation_id: input.operationId,
        idempotency_key: childIdempotencyKey(input.idempotencyKey, step.step_id),
        content: step.content,
      });
      input.audit(result.audit.event, result.audit);
      results.set(step.step_id, result);
      continue;
    }
    if (input.action.kind !== "export") {
      throw new AppPlatformError("denied", "Only export actions can prepare app artifacts", 403);
    }
    const bytesBase64 = step.bytes_reference
      ? await resolveReferencedExportBytes(input.resolveRuntimeExportBytes, step.bytes_reference, {
        contentDigest: step.content_digest,
        contentSizeBytes: step.content_size_bytes,
        mediaType: step.media_type,
        filename: step.filename,
      })
      : step.bytes_base64!;
    const prepared = await input.artifactExports.prepareExport({
      request_version: 1,
      authority: input.artifactAuthority,
      operation_id: input.operationId,
      idempotency_key: childIdempotencyKey(input.idempotencyKey, step.step_id),
      source: step.source,
      content_digest: step.content_digest,
      content_size_bytes: step.content_size_bytes,
      retention_class: step.retention_class,
      media_type: step.media_type,
      filename: step.filename,
      destination_intent: step.destination_intent,
      overwrite_confirmed: step.overwrite_confirmed,
      owner_confirmed: input.ownerConfirmed,
      bytes_base64: bytesBase64,
    });
    results.set(step.step_id, prepared);
  }

  const finalResult = plan.final_result ?? { kind: "step_result" as const, step_id: plan.steps.at(-1)!.step_id };
  return finalResult.kind === "literal" ? finalResult.value : results.get(finalResult.step_id);
}

export function childIdempotencyKey(parent: string, stepId: string): string {
  const candidate = `${parent}:plan:${stepId}`;
  if (candidate.length <= 256) return candidate;
  return `plan-${createHash("sha256").update(candidate).digest("hex")}`;
}

function stableProofId(operationId: string, stepId: string): string {
  const hex = createHash("sha256").update(`${operationId}:${stepId}:owner-confirmation`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function resolveReferencedExportBytes(
  resolver: ((reference: RuntimeExportBytesReference, expected: {
    contentDigest: string;
    contentSizeBytes: number;
    mediaType: string;
    filename: string;
  }) => Promise<Buffer>) | undefined,
  reference: RuntimeExportBytesReference,
  expected: {
    contentDigest: string;
    contentSizeBytes: number;
    mediaType: string;
    filename: string;
  },
): Promise<string> {
  if (!resolver) {
    throw new AppPlatformError("incompatible_schema", "App action export bytes reference cannot be resolved by this host", 409);
  }
  const bytes = await resolver(reference, expected);
  if (bytes.length !== expected.contentSizeBytes) {
    throw new AppPlatformError("validation_failed", "App action export bytes size did not match the plan", 409);
  }
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== expected.contentDigest) {
    throw new AppPlatformError("validation_failed", "App action export bytes digest did not match the plan", 409);
  }
  return bytes.toString("base64");
}
