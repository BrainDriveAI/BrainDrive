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
