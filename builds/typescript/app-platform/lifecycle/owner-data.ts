import path from "node:path";

import type { FirstPartyAppRegistration } from "../contracts/app-registry.js";
import type { AppRetentionClass } from "../contracts/app-registry.js";
import { AppPlatformError } from "./errors.js";
import type { AppLifecycleStore } from "./store.js";

export type OwnerDataSchemaCompatibility = {
  read_min: number;
  read_max: number;
  write_version: number;
};

export type OwnerDataActivationRequest = {
  ownerId: string;
  installationId?: string;
  packageDigest?: string;
  compatibility: OwnerDataSchemaCompatibility;
  reason: "install" | "enable" | "update" | "rollback" | "reinstall";
};

export interface OwnerDataLifecycle {
  readonly retainedClasses?: readonly AppRetentionClass[];
  prepareActivation(request: OwnerDataActivationRequest): Promise<unknown>;
  cleanupDefaultUninstall(): Promise<unknown>;
  repairState?(compatibility: OwnerDataSchemaCompatibility): Promise<{
    state: "missing" | "ready" | "incompatible" | "repair_required";
    safe_message: string;
    retained_schema_version: number | null;
    data_preserved: true;
    owner_export_available: boolean;
  }>;
}

export type AppDataAdapterIdentity = {
  adapter_contract_version: 1;
  app_id: string;
  publisher_id: string;
  binding_id: string;
  data_contract_version: number;
};

export type AppDataBackupIdentity = {
  backup_version: 1;
  app_id: string;
  publisher_id: string;
  adapter_binding_id: string;
  adapter_contract_version: 1;
  data_contract_version: number;
  content_digest: `sha256:${string}`;
};

export type RetainedDataDeleteRequest = {
  operation_id: string;
  owner_id: string;
  app_id: string;
  trusted_owner_confirmation: true;
};

export type RetainedDataOwnerActionRequest = RetainedDataDeleteRequest;

export interface AppDataLifecycleAdapter extends OwnerDataLifecycle {
  readonly identity: AppDataAdapterIdentity;
  readonly namespaceRoot: string;
  validateBackupIdentity(backup: AppDataBackupIdentity): Promise<AppDataBackupIdentity>;
  exportRetainedData?(request: RetainedDataOwnerActionRequest): Promise<{
    exported: true;
    export_digest: `sha256:${string}`;
    retained: true;
  }>;
  archiveRetainedData?(request: RetainedDataOwnerActionRequest): Promise<{
    archived: true;
    archive_digest: `sha256:${string}`;
    retained: true;
  }>;
  deleteRetainedData(request: RetainedDataDeleteRequest): Promise<{
    deleted: true;
    deleted_namespace_digest: `sha256:${string}`;
  }>;
}

export function validateAppDataBackupIdentity(identity: AppDataAdapterIdentity, backup: AppDataBackupIdentity): AppDataBackupIdentity {
  if (
    backup.app_id !== identity.app_id ||
    backup.publisher_id !== identity.publisher_id ||
    backup.adapter_binding_id !== identity.binding_id ||
    backup.adapter_contract_version !== identity.adapter_contract_version ||
    backup.data_contract_version !== identity.data_contract_version ||
    !/^sha256:[a-f0-9]{64}$/.test(backup.content_digest)
  ) {
    throw new AppPlatformError("incompatible_schema", "Backup identity is not compatible with the selected app data adapter");
  }
  return backup;
}

export function assertAppDataAdapterBinding(
  registration: FirstPartyAppRegistration,
  adapter: AppDataLifecycleAdapter,
  memoryRoot: string,
): AppDataLifecycleAdapter {
  const reviewed = registration.data_adapter_registration;
  const expectedRoot = path.resolve(memoryRoot, "apps", registration.route_key);
  const actualRoot = path.resolve(adapter.namespaceRoot);
  if (
    adapter.identity.app_id !== registration.app_id ||
    adapter.identity.publisher_id !== registration.publisher_id ||
    adapter.identity.binding_id !== reviewed.binding_id ||
    adapter.identity.adapter_contract_version !== reviewed.adapter_contract_version ||
    adapter.identity.data_contract_version !== reviewed.data_contract_version ||
    actualRoot !== expectedRoot
  ) {
    throw new AppPlatformError("descriptor_invalid", "App data adapter does not match its reviewed host registration");
  }
  return adapter;
}

export type DeleteRetainedDataInput = {
  store: AppLifecycleStore;
  adapter: AppDataLifecycleAdapter;
  appId: string;
  ownerId: string;
  ownerActorId: string;
  expectedDataRoot: string;
  request: {
    operationId: string;
    idempotencyKey: string;
    ownerActorId: string;
    confirmAppId: string;
    trustedOwnerConfirmation: boolean;
  };
};

export async function deleteRetainedAppData(input: DeleteRetainedDataInput): Promise<{
  operation_id: string;
  app_id: string;
  deleted: true;
  deleted_namespace_digest: `sha256:${string}`;
}> {
  const request = input.request;
  if (
    request.ownerActorId !== input.ownerActorId ||
    request.confirmAppId !== input.appId ||
    request.trustedOwnerConfirmation !== true ||
    input.adapter.identity.app_id !== input.appId ||
    input.store.appId !== input.appId ||
    path.resolve(input.adapter.namespaceRoot) !== path.resolve(input.expectedDataRoot)
  ) {
    throw new AppPlatformError("denied", "Trusted owner confirmation does not match the selected app", 403);
  }
  if (!/^[0-9a-f-]{36}$/i.test(request.operationId)) {
    throw new AppPlatformError("invalid_input", "Data deletion operation identity is invalid", 400);
  }
  return input.store.runIdempotent(request.idempotencyKey, {
    kind: "delete_retained_data",
    app_id: input.appId,
    owner_id: input.ownerId,
    operation_id: request.operationId,
    trusted_owner_confirmation: true,
  }, () => input.store.runDataDeletionMutation(request.operationId, async () => {
    const lifecycle = await input.store.readLifecycle();
    if (lifecycle.app_id !== input.appId || lifecycle.state !== "not_installed") {
      throw new AppPlatformError("invalid_state_transition", "Retained app data can be deleted only when the selected app is uninstalled");
    }
    const existing = await input.store.readDataDeletionTombstone(request.operationId);
    if (existing && (
      existing.app_id !== input.appId ||
      existing.owner_id !== input.ownerId ||
      existing.adapter_binding_id !== input.adapter.identity.binding_id ||
      existing.data_contract_version !== input.adapter.identity.data_contract_version
    )) {
      throw new AppPlatformError("conflict", "Retained-data deletion operation identity conflicts with durable evidence");
    }
    if (existing?.status === "committed") {
      return {
        operation_id: existing.operation_id,
        app_id: existing.app_id,
        deleted: existing.deleted,
        deleted_namespace_digest: existing.deleted_namespace_digest as `sha256:${string}`,
      };
    }
    const startedAt = existing?.started_at ?? new Date().toISOString();
    if (!existing) {
      await input.store.saveDataDeletionTombstone({
        tombstone_version: 1,
        operation_id: request.operationId,
        app_id: input.appId,
        owner_id: input.ownerId,
        adapter_binding_id: input.adapter.identity.binding_id,
        data_contract_version: input.adapter.identity.data_contract_version,
        status: "prepared",
        deleted: false,
        deleted_namespace_digest: null,
        deleted_at: null,
        started_at: startedAt,
        updated_at: startedAt,
      });
    }
    const deleted = await input.adapter.deleteRetainedData({
      operation_id: request.operationId,
      owner_id: input.ownerId,
      app_id: input.appId,
      trusted_owner_confirmation: true,
    });
    const deletedAt = new Date().toISOString();
    await input.store.saveDataDeletionTombstone({
      tombstone_version: 1,
      operation_id: request.operationId,
      app_id: input.appId,
      owner_id: input.ownerId,
      adapter_binding_id: input.adapter.identity.binding_id,
      data_contract_version: input.adapter.identity.data_contract_version,
      status: "committed",
      deleted: true,
      deleted_namespace_digest: deleted.deleted_namespace_digest,
      deleted_at: deletedAt,
      started_at: startedAt,
      updated_at: deletedAt,
    });
    return { operation_id: request.operationId, app_id: input.appId, ...deleted };
  }));
}

export type RetainedDataOwnerActionInput = Omit<DeleteRetainedDataInput, "request"> & {
  action: "export" | "archive";
  request: DeleteRetainedDataInput["request"];
};

export async function runRetainedAppDataOwnerAction(input: RetainedDataOwnerActionInput): Promise<{
  operation_id: string;
  app_id: string;
  action: "export" | "archive";
  retained: true;
  result_digest: `sha256:${string}`;
}> {
  assertTrustedRetainedAction(input);
  const adapterAction = input.action === "export" ? input.adapter.exportRetainedData : input.adapter.archiveRetainedData;
  if (!adapterAction) {
    throw new AppPlatformError("invalid_state_transition", `The selected app has no reviewed retained-data ${input.action} adapter`);
  }
  return input.store.runIdempotent(input.request.idempotencyKey, {
    kind: `${input.action}_retained_data`,
    app_id: input.appId,
    owner_id: input.ownerId,
    operation_id: input.request.operationId,
    trusted_owner_confirmation: true,
  }, () => input.store.runDataDeletionMutation(input.request.operationId, async () => {
    const lifecycle = await input.store.readLifecycle();
    if (lifecycle.app_id !== input.appId || lifecycle.state !== "not_installed") {
      throw new AppPlatformError("invalid_state_transition", "Retained app data can be exported or archived only when the selected app is uninstalled");
    }
    const existing = await input.store.readDataRetentionActionTombstone(input.action, input.request.operationId);
    if (existing && (
      existing.app_id !== input.appId ||
      existing.owner_id !== input.ownerId ||
      existing.adapter_binding_id !== input.adapter.identity.binding_id ||
      existing.data_contract_version !== input.adapter.identity.data_contract_version
    )) {
      throw new AppPlatformError("conflict", "Retained-data owner action identity conflicts with durable evidence");
    }
    if (existing?.status === "committed") {
      return {
        operation_id: existing.operation_id,
        app_id: existing.app_id,
        action: existing.action,
        retained: existing.retained,
        result_digest: existing.result_digest as `sha256:${string}`,
      };
    }
    const startedAt = existing?.started_at ?? new Date().toISOString();
    if (!existing) {
      await input.store.saveDataRetentionActionTombstone({
        tombstone_version: 1,
        operation_id: input.request.operationId,
        app_id: input.appId,
        owner_id: input.ownerId,
        adapter_binding_id: input.adapter.identity.binding_id,
        data_contract_version: input.adapter.identity.data_contract_version,
        action: input.action,
        status: "prepared",
        retained: true,
        result_digest: null,
        completed_at: null,
        started_at: startedAt,
        updated_at: startedAt,
      });
    }
    const request = {
      operation_id: input.request.operationId,
      owner_id: input.ownerId,
      app_id: input.appId,
      trusted_owner_confirmation: true,
    } as const;
    const resultDigest = input.action === "export"
      ? (await input.adapter.exportRetainedData!(request)).export_digest
      : (await input.adapter.archiveRetainedData!(request)).archive_digest;
    const completedAt = new Date().toISOString();
    await input.store.saveDataRetentionActionTombstone({
      tombstone_version: 1,
      operation_id: input.request.operationId,
      app_id: input.appId,
      owner_id: input.ownerId,
      adapter_binding_id: input.adapter.identity.binding_id,
      data_contract_version: input.adapter.identity.data_contract_version,
      action: input.action,
      status: "committed",
      retained: true,
      result_digest: resultDigest,
      completed_at: completedAt,
      started_at: startedAt,
      updated_at: completedAt,
    });
    return { operation_id: input.request.operationId, app_id: input.appId, action: input.action, retained: true, result_digest: resultDigest };
  }));
}

function assertTrustedRetainedAction(input: DeleteRetainedDataInput): void {
  const request = input.request;
  if (
    request.ownerActorId !== input.ownerActorId ||
    request.confirmAppId !== input.appId ||
    request.trustedOwnerConfirmation !== true ||
    input.adapter.identity.app_id !== input.appId ||
    input.store.appId !== input.appId ||
    path.resolve(input.adapter.namespaceRoot) !== path.resolve(input.expectedDataRoot)
  ) {
    throw new AppPlatformError("denied", "Trusted owner confirmation does not match the selected app", 403);
  }
  if (!/^[0-9a-f-]{36}$/i.test(request.operationId)) {
    throw new AppPlatformError("invalid_input", "Data retention operation identity is invalid", 400);
  }
}
