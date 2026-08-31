import { rm } from "node:fs/promises";
import path from "node:path";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import type {
  AppDataBackupIdentity,
  AppDataLifecycleAdapter,
  OwnerDataActivationRequest,
  RetainedDataDeleteRequest,
  RetainedDataOwnerActionRequest,
} from "../app-platform/lifecycle/owner-data.js";
import { validateAppDataBackupIdentity } from "../app-platform/lifecycle/owner-data.js";
import { BriefDomainError } from "./errors.js";
import { BriefDataStore } from "./store.js";

export class BriefDataLifecycleAdapter implements AppDataLifecycleAdapter {
  readonly retainedClasses = ["app_storage", "artifact_records", "export_receipts", "owner_exports", "lifecycle_tombstone"] as const;
  readonly identity = {
    adapter_contract_version: 1,
    app_id: "ai.braindrive.brief-builder",
    publisher_id: "ai.braindrive",
    binding_id: "data.brief-builder",
    data_contract_version: 1,
  } as const;

  constructor(readonly memoryRoot: string, readonly namespaceRoot = path.join(memoryRoot, "apps", "brief-builder")) {
    if (path.resolve(namespaceRoot) !== path.resolve(memoryRoot, "apps", "brief-builder")) {
      throw new BriefDomainError("denied", "Brief Builder namespace must be host-derived", 403);
    }
  }

  async validateBackupIdentity(backup: AppDataBackupIdentity): Promise<AppDataBackupIdentity> {
    return validateAppDataBackupIdentity(this.identity, backup);
  }

  async prepareActivation(request: OwnerDataActivationRequest): Promise<{ state: "ready"; schema_version: 1; migrated: false; revision_count: number }> {
    if (request.compatibility.read_min !== 1 || request.compatibility.read_max !== 1 || request.compatibility.write_version !== 1) {
      throw new BriefDomainError("validation_failed", "Retained Brief Builder data requires data contract version 1");
    }
    const catalog = await new BriefDataStore(this.memoryRoot, this.namespaceRoot).initialize(request.ownerId);
    if (catalog.owner_id !== request.ownerId || catalog.app_id !== this.identity.app_id) throw new BriefDomainError("denied", "Retained Brief Builder data identity does not match the owner", 403);
    return { state: "ready", schema_version: 1, migrated: false, revision_count: catalog.sources.length + catalog.drafts.length + catalog.approved.length };
  }

  async cleanupDefaultUninstall(): Promise<{ outcome: "cleaned"; durable_records_preserved: true; transient_items_removed: 0 }> {
    return { outcome: "cleaned", durable_records_preserved: true, transient_items_removed: 0 };
  }

  async repairState(): Promise<{ state: "missing" | "ready" | "repair_required"; safe_message: string; retained_schema_version: 1 | null; data_preserved: true; owner_export_available: false }> {
    try {
      const catalog = await new BriefDataStore(this.memoryRoot, this.namespaceRoot).catalog();
      return { state: "ready", safe_message: "Brief Builder owner data is ready.", retained_schema_version: catalog.data_schema_version, data_preserved: true, owner_export_available: false };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return { state: "missing", safe_message: "No retained Brief Builder data was found.", retained_schema_version: null, data_preserved: true, owner_export_available: false };
      return { state: "repair_required", safe_message: "Brief Builder owner data requires recovery before activation.", retained_schema_version: null, data_preserved: true, owner_export_available: false };
    }
  }

  async deleteRetainedData(request: RetainedDataDeleteRequest): Promise<{ deleted: true; deleted_namespace_digest: `sha256:${string}` }> {
    this.assertRetainedDataAuthority(request, "delete");
    const deleted_namespace_digest = canonicalInputDigest({ app_id: request.app_id, owner_id: request.owner_id, operation_id: request.operation_id, namespace: "host_derived" });
    await rm(this.namespaceRoot, { recursive: true, force: true });
    return { deleted: true, deleted_namespace_digest };
  }

  async exportRetainedData(request: RetainedDataOwnerActionRequest): Promise<{ exported: true; export_digest: `sha256:${string}`; retained: true }> {
    this.assertRetainedDataAuthority(request, "export");
    return {
      exported: true,
      export_digest: this.retainedDataActionDigest(request, "export"),
      retained: true,
    };
  }

  async archiveRetainedData(request: RetainedDataOwnerActionRequest): Promise<{ archived: true; archive_digest: `sha256:${string}`; retained: true }> {
    this.assertRetainedDataAuthority(request, "archive");
    return {
      archived: true,
      archive_digest: this.retainedDataActionDigest(request, "archive"),
      retained: true,
    };
  }

  private assertRetainedDataAuthority(request: RetainedDataDeleteRequest, action: "delete" | "export" | "archive"): void {
    if (request.app_id !== this.identity.app_id || request.trusted_owner_confirmation !== true || path.resolve(this.namespaceRoot) !== path.resolve(this.memoryRoot, "apps", "brief-builder")) {
      throw new BriefDomainError("denied", `Retained Brief Builder data ${action} authority is invalid`, 403);
    }
  }

  private retainedDataActionDigest(request: RetainedDataOwnerActionRequest, action: "export" | "archive"): `sha256:${string}` {
    return canonicalInputDigest({
      action,
      app_id: this.identity.app_id,
      owner_id: request.owner_id,
      operation_id: request.operation_id,
      namespace: "host_derived",
      retained: true,
    });
  }
}
