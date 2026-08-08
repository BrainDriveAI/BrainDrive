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
}
