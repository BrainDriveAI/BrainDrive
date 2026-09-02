import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  AppDocumentMediaType,
  AppDocumentRecord,
  AppDocumentRole,
  AppDocumentStorageAuthority,
  AppStorageRetentionClass,
} from "../contracts/app-storage.js";
import type { WorkspaceDocumentDescriptor } from "../contracts/app-registry.js";
import type { StoredPackage } from "../lifecycle/store.js";
import { AppPlatformError } from "../lifecycle/errors.js";
import type { AppDocumentStorageService } from "../storage/app-document-store.js";

export async function readOrSeedAppDocument(input: {
  documentStorage: AppDocumentStorageService;
  authority: AppDocumentStorageAuthority;
  storedPackage: StoredPackage;
  document: WorkspaceDocumentDescriptor;
  operationId: string;
  idempotencyKey: string;
  audit?: (event: string, details: Record<string, unknown>) => void;
}): Promise<AppDocumentRecord | null> {
  await input.documentStorage.initialize();
  await input.documentStorage.bindActiveAuthority(input.authority);
  const current = await input.documentStorage.readDocument(input.authority, input.document.document_id);
  if (current) return current;
  if (!input.document.initial_content) return null;
  if (!input.document.data_binding_id || input.document.role === "conversation") {
    throw new AppPlatformError("descriptor_invalid", "Initial document content requires a data binding", 409);
  }

  const content = await readInitialContent(input.storedPackage, input.document.initial_content);
  const result = await input.documentStorage.writeDocument({
    request_version: 1,
    authority: input.authority,
    document_id: input.document.document_id,
    document_binding_id: input.document.data_binding_id,
    record_kind: documentStorageRole(input.document) === "app_state" ? "state" : "document",
    role: documentStorageRole(input.document),
    retention_class: defaultRetentionClassForDocument(input.document),
    media_type: input.document.initial_content.media_type,
    expected_revision: null,
    operation_id: input.operationId,
    idempotency_key: childSeedIdempotencyKey(input.idempotencyKey, input.document.document_id),
    content,
  });
  input.audit?.(result.audit.event, result.audit);
  return result.record;
}

export function documentStorageRole(document: Pick<WorkspaceDocumentDescriptor, "role" | "model_access">): AppDocumentRole {
  if (document.role === "source_document") return "source_document";
  if (document.role === "derived_document") return "derived_document";
  if (document.role === "recovery" || document.role === "recovery_document") return "recovery_document";
  if (document.role === "action_result_document" || document.model_access === "action_result") return "action_result_document";
  return "app_state";
}

export function defaultRetentionClassForDocument(document: Pick<WorkspaceDocumentDescriptor, "role" | "model_access">): AppStorageRetentionClass {
  const role = documentStorageRole(document);
  if (role === "recovery_document") return "rollback_recovery_window";
  if (role === "action_result_document") return "durable_operation_lookup";
  return "durable_owner_data";
}

async function readInitialContent(
  storedPackage: StoredPackage,
  initialContent: NonNullable<WorkspaceDocumentDescriptor["initial_content"]>,
): Promise<unknown> {
  const target = path.resolve(storedPackage.package_root, ...initialContent.package_path.split("/"));
  const root = path.resolve(storedPackage.package_root);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new AppPlatformError("package_path_invalid", "Initial app document content escaped package authority", 403);
  }
  const bytes = await readFile(target);
  const contentDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
  if (contentDigest !== initialContent.content_digest) {
    throw new AppPlatformError("package_archive_digest_mismatch", "Initial app document content digest does not match descriptor", 409);
  }
  const text = bytes.toString("utf8");
  if (initialContent.media_type === "application/json") {
    try {
      return JSON.parse(text);
    } catch {
      throw new AppPlatformError("descriptor_invalid", "Initial JSON app document content is malformed", 409);
    }
  }
  return normalizeTextContent(text, initialContent.media_type);
}

function normalizeTextContent(content: string, mediaType: AppDocumentMediaType): string {
  if (mediaType === "text/markdown" || mediaType === "text/plain") return content.trimEnd();
  return content;
}

function childSeedIdempotencyKey(parent: string, documentId: string): string {
  const candidate = `${parent}:seed:${documentId}`;
  if (candidate.length <= 256) return candidate;
  return `seed-${createHash("sha256").update(candidate).digest("hex")}`;
}
