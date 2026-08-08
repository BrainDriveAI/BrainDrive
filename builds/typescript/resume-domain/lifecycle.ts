import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { assertContentFreeAudit, AuditEventSchema } from "../app-platform/contracts/audit.js";
import { canonicalInputDigest, canonicalJson, OpaqueIdSchema } from "../app-platform/contracts/common.js";
import {
  MIGRATION_COMPATIBILITY_POLICY,
  RESUME_DATA_RETENTION_MATRIX,
} from "../app-platform/contracts/data-conformance.js";
import type {
  OwnerDataActivationRequest,
  OwnerDataLifecycle,
  OwnerDataSchemaCompatibility,
} from "../app-platform/lifecycle/owner-data.js";
import { ResumeDomainError } from "./errors.js";
import { ResumeDataStore } from "./store.js";

const RawCatalogIdentitySchema = z.object({
  data_schema_version: z.number().int().nonnegative(),
  owner_id: OpaqueIdSchema,
}).passthrough();

export type ResumeDataTransferValidation =
  | { state: "missing"; schema_version: null; revision_count: 0 }
  | { state: "verified"; schema_version: 1; revision_count: number };

export type ResumeDataRepairState = {
  state: "missing" | "ready" | "incompatible" | "repair_required";
  safe_message: string;
  retained_schema_version: number | null;
  data_preserved: true;
  owner_export_available: boolean;
};

export class ResumeDataLifecycleAdapter implements OwnerDataLifecycle {
  constructor(
    private readonly memoryRoot: string,
    private readonly namespaceRoot = path.join(memoryRoot, "apps", "resume-builder"),
    private readonly audit: (event: string, details: Record<string, unknown>) => void = () => undefined,
  ) {}

  async prepareActivation(request: OwnerDataActivationRequest): Promise<{ state: "ready"; schema_version: 1; migrated: boolean; revision_count: number }> {
    const startedAt = Date.now();
    let raw: z.infer<typeof RawCatalogIdentitySchema> | null;
    try {
      raw = await this.readIdentity();
    } catch (error) {
      const failure = error instanceof ResumeDomainError
        ? error
        : new ResumeDomainError("recoverable_internal_failure", "Retained Resume Builder data could not be validated safely", 500);
      this.emitMigrationAudit(request, null, "failed", failure.code, Date.now() - startedAt, 0);
      throw failure;
    }
    const sourceVersion = raw?.data_schema_version ?? null;
    if (!this.supportsTarget(request.compatibility) || (sourceVersion !== null && sourceVersion > 1)) {
      this.emitMigrationAudit(request, sourceVersion, "denied", "incompatible_schema", Date.now() - startedAt, 0);
      throw new ResumeDomainError("incompatible_schema", "Retained Resume Builder data requires a compatible app version", 409);
    }
    if (raw && raw.owner_id !== request.ownerId) throw new ResumeDomainError("denied", "Retained owner data belongs to a different owner", 403);

    const store = new ResumeDataStore(this.memoryRoot, this.namespaceRoot, {}, false);
    try {
      await store.initialize(request.ownerId);
      const scan = await store.integrityScan();
      this.emitMigrationAudit(request, sourceVersion, "committed", null, Date.now() - startedAt, scan.revision_count);
      return { state: "ready", schema_version: 1, migrated: sourceVersion === 0, revision_count: scan.revision_count };
    } catch (error) {
      const failure = error instanceof ResumeDomainError
        ? error
        : new ResumeDomainError("recoverable_internal_failure", "Retained Resume Builder data could not be validated safely", 500);
      this.emitMigrationAudit(request, sourceVersion, "failed", failure.code, Date.now() - startedAt, 0);
      throw failure;
    }
  }

  async cleanupDefaultUninstall(): Promise<{ outcome: "cleaned" | "repair_required"; durable_records_preserved: true; transient_items_removed: number }> {
    try {
      const raw = await this.readIdentity();
      if (!raw) return { outcome: "cleaned", durable_records_preserved: true, transient_items_removed: 0 };
      const store = new ResumeDataStore(this.memoryRoot, this.namespaceRoot, {}, false);
      const result = await store.cleanupTransientState(raw.owner_id);
      const event = AuditEventSchema.parse({
        event_version: 1,
        event_id: randomUUID(),
        event_name: "app.cleanup.completed",
        occurred_at: new Date().toISOString(),
        correlation_id: randomUUID(),
        actor_id: raw.owner_id,
        owner_id: raw.owner_id,
        app_id: "ai.braindrive.resume-builder",
        publisher_id: "ai.braindrive",
        package_digest: null,
        installation_id: null,
        operation_id: null,
        capability: null,
        target_category: "resume_data_transient",
        target_id: null,
        input_revision: null,
        outcome: "committed",
        error_code: null,
        schema_version: 1,
        duration_ms: 0,
        item_count: result.transient_items_removed,
      });
      assertContentFreeAudit(event);
      const { event_name: eventName, ...details } = event;
      this.audit(eventName, details);
      return { outcome: "cleaned", durable_records_preserved: true, transient_items_removed: result.transient_items_removed };
    } catch {
      return { outcome: "repair_required", durable_records_preserved: true, transient_items_removed: 0 };
    }
  }

  async repairState(compatibility: OwnerDataSchemaCompatibility): Promise<ResumeDataRepairState> {
    try {
      const raw = await this.readIdentity();
      if (!raw) return { state: "missing", safe_message: "No retained Resume Builder data is present.", retained_schema_version: null, data_preserved: true, owner_export_available: false };
      if (!this.supportsTarget(compatibility) || raw.data_schema_version > 1) {
        return { state: "incompatible", safe_message: "The retained data is intact but requires a compatible Resume Builder version.", retained_schema_version: raw.data_schema_version, data_preserved: true, owner_export_available: true };
      }
      const validated = await validateResumeDataTransfer(this.memoryRoot, this.namespaceRoot);
      return { state: "ready", safe_message: "Retained Resume Builder data passed integrity validation.", retained_schema_version: validated.schema_version, data_preserved: true, owner_export_available: true };
    } catch {
      return { state: "repair_required", safe_message: "Retained Resume Builder data is preserved and can be exported for repair.", retained_schema_version: null, data_preserved: true, owner_export_available: true };
    }
  }

  async recordHistory(recordId: string): Promise<{
    history_version: 1;
    record_id: string;
    revision_count: number;
    revisions: Array<Record<string, unknown>>;
  }> {
    if (!OpaqueIdSchema.safeParse(recordId).success) throw new ResumeDomainError("invalid_input", "Record identity is invalid", 400);
    const ownerId = (await this.requireIdentity()).owner_id;
    const store = new ResumeDataStore(this.memoryRoot, this.namespaceRoot, {}, false);
    await store.initialize(ownerId);
    const revisions = (await store.allRevisions())
      .filter((record) => record.metadata.record_id === recordId)
      .sort((left, right) => left.metadata.revision - right.metadata.revision)
      .map((record) => ({
        revision_id: record.metadata.revision_id,
        revision: record.metadata.revision,
        record_type: record.record_type,
        prior_revision_id: record.metadata.prior_revision_id,
        lifecycle_state: record.lifecycle_state,
        updated_at: record.updated_at,
        content_digest: canonicalInputDigest(record),
      }));
    if (revisions.length === 0) throw new ResumeDomainError("not_found_within_scope", "Record was not found within the retained data", 404);
    return { history_version: 1, record_id: recordId, revision_count: revisions.length, revisions };
  }

  async prepareOwnerExport(): Promise<{
    receipt: { export_version: 1; safe_file_name: string; schema_version: 1; record_count: number; operation_count: number; export_digest: string };
    internalArchivePath: string;
  }> {
    const identity = await this.requireIdentity();
    const store = new ResumeDataStore(this.memoryRoot, this.namespaceRoot, {}, false);
    await store.initialize(identity.owner_id);
    const catalog = await store.catalog();
    const records = await store.allRevisions();
    const operations = Object.values(catalog.operations).map((entry) => entry.record).sort((left, right) => left.operation_id.localeCompare(right.operation_id));
    const exportedAt = new Date().toISOString();
    const base = {
      export_version: 1,
      app_id: "ai.braindrive.resume-builder",
      owner_id: identity.owner_id,
      data_schema_version: 1,
      catalog_generation: catalog.generation,
      exported_at: exportedAt,
      compatibility_policy: MIGRATION_COMPATIBILITY_POLICY,
      retention_matrix: RESUME_DATA_RETENTION_MATRIX,
      records,
      operations,
      catalog_extensions: catalog.extensions,
    } as const;
    const exportDigest = canonicalInputDigest(base);
    const payload = { ...base, export_digest: exportDigest };
    const safeFileName = `resume-builder-owner-data-${Date.now()}.json`;
    const exportRoot = path.join(this.memoryRoot, "exports");
    await mkdir(exportRoot, { recursive: true });
    const internalArchivePath = path.join(exportRoot, safeFileName);
    await writeFile(internalArchivePath, `${canonicalJson(payload)}\n`, { encoding: "utf8", mode: 0o600 });
    return {
      receipt: { export_version: 1, safe_file_name: safeFileName, schema_version: 1, record_count: records.length, operation_count: operations.length, export_digest: exportDigest },
      internalArchivePath,
    };
  }

  private supportsTarget(compatibility: OwnerDataSchemaCompatibility): boolean {
    return compatibility.read_min <= 1 && compatibility.read_max >= 1 && compatibility.write_version === 1;
  }

  private async readIdentity(): Promise<z.infer<typeof RawCatalogIdentitySchema> | null> {
    try {
      return RawCatalogIdentitySchema.parse(JSON.parse(await readFile(path.join(this.namespaceRoot, "catalog.json"), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (error instanceof z.ZodError || error instanceof SyntaxError) throw new ResumeDomainError("validation_failed", "Retained Resume Builder data is invalid", 409);
      throw error;
    }
  }

  private async requireIdentity(): Promise<z.infer<typeof RawCatalogIdentitySchema>> {
    const identity = await this.readIdentity();
    if (!identity) throw new ResumeDomainError("not_found_within_scope", "No retained Resume Builder data is available", 404);
    return identity;
  }

  private emitMigrationAudit(
    request: OwnerDataActivationRequest,
    fromVersion: number | null,
    outcome: "committed" | "denied" | "failed",
    errorCode: string | null,
    durationMs: number,
    itemCount: number,
  ): void {
    const event = AuditEventSchema.parse({
      event_version: 1,
      event_id: randomUUID(),
      event_name: "app.migration.completed",
      occurred_at: new Date().toISOString(),
      correlation_id: randomUUID(),
      actor_id: request.ownerId,
      owner_id: request.ownerId,
      app_id: "ai.braindrive.resume-builder",
      publisher_id: "ai.braindrive",
      package_digest: request.packageDigest ?? null,
      installation_id: request.installationId ?? null,
      operation_id: null,
      capability: null,
      target_category: "resume_data_schema",
      target_id: null,
      input_revision: fromVersion && fromVersion > 0 ? fromVersion : null,
      outcome,
      error_code: errorCode,
      schema_version: 1,
      duration_ms: Math.max(0, Math.floor(durationMs)),
      item_count: itemCount,
    });
    assertContentFreeAudit(event);
    const { event_name: eventName, ...details } = event;
    this.audit(eventName, details);
  }
}

export async function validateResumeDataTransfer(
  memoryRoot: string,
  namespaceRoot = path.join(memoryRoot, "apps", "resume-builder"),
): Promise<ResumeDataTransferValidation> {
  const catalogPath = path.join(namespaceRoot, "catalog.json");
  const details = await stat(catalogPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!details) return { state: "missing", schema_version: null, revision_count: 0 };
  if (!details.isFile()) throw new ResumeDomainError("validation_failed", "Resume Builder retained catalog is invalid", 409);
  let identity: z.infer<typeof RawCatalogIdentitySchema>;
  try {
    identity = RawCatalogIdentitySchema.parse(JSON.parse(await readFile(catalogPath, "utf8")));
  } catch {
    throw new ResumeDomainError("validation_failed", "Resume Builder retained catalog is invalid", 409);
  }
  if (identity.data_schema_version > 1) throw new ResumeDomainError("incompatible_schema", "Retained Resume Builder data requires a compatible app version", 409);
  const store = new ResumeDataStore(memoryRoot, namespaceRoot, {}, false);
  await store.initialize(identity.owner_id);
  const scan = await store.integrityScan();
  return { state: "verified", schema_version: 1, revision_count: scan.revision_count };
}
