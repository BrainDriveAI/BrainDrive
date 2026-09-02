import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { canonicalJson, Sha256DigestSchema, TimestampSchema } from "../contracts/common.js";
import {
  PackageComponentManifestSchema,
  PackageComponentKindSchema,
  PackageIdSchema,
  RuntimeTargetSchema,
  parsePackageComponentManifestForConformance,
  type CapabilityDependency,
  type PackageComponent,
  type PackageComponentManifest,
  type ProvidedOperation,
  type SidecarDescriptor,
} from "../contracts/package-components.js";
import { AppPlatformError } from "./errors.js";

export const PackageLifecycleStateSchema = z.enum(["enabled", "disabled", "updating", "uninstalled", "quarantined", "failed"]);
export const ComponentLifecycleStateSchema = z.enum(["enabled", "disabled", "stopped", "running", "uninstalled", "unavailable", "failed"]);
export const ComponentHealthStateSchema = z.enum(["not_applicable", "unknown", "healthy", "unhealthy"]);
export const CapabilityDependencyStateSchema = z.enum(["available", "missing", "unavailable", "disabled", "unhealthy", "unauthorized", "selection_required", "unsupported_target", "unknown"]);
const CapabilityDependencyFailureCodeSchema = z.enum(["provider_unavailable", "provider_unhealthy", "provider_selection_required", "unsupported_target", "not_authorized", "invalid_request", "unknown"]);
const ComponentKindProjectionSchema = z.enum([...PackageComponentKindSchema.options, "sidecar"]);
const PackageSourceSchema = z.object({
  kind: z.enum(["repository_fixture", "local_package"]),
  label: z.string().min(1).max(120),
}).strict();
const PackageTrustProjectionSchema = z.object({
  status: z.enum(["verified", "not_verified", "quarantined"]),
  policy_version: z.literal(1),
  checked_at: TimestampSchema.nullable(),
}).strict();
const TargetSupportSchema = z.object({
  target: RuntimeTargetSchema,
  runtime_kind: z.enum(["container", "packaged_process"]),
}).strict();
const SafeCapabilityDependencyProjectionSchema = z.object({
  operation_id: z.string().min(5).max(128),
  requirement: z.enum(["required", "optional"]),
  unavailable_behavior: z.enum(["block_activation", "degrade_with_safe_status"]),
}).strict();
const CapabilityDependencyAvailabilitySchema = SafeCapabilityDependencyProjectionSchema.extend({
  state: CapabilityDependencyStateSchema,
  callable: z.boolean(),
  provider_count: z.number().int().nonnegative(),
  failure_code: CapabilityDependencyFailureCodeSchema.nullable(),
  safe_message: z.string().min(1).max(256),
  checked_at: TimestampSchema.nullable(),
}).strict();
const CapabilityDependencyReadinessSchema = z.object({
  status: z.enum(["ready", "blocked", "degraded", "unknown"]),
  required_available: z.boolean(),
  optional_available: z.boolean(),
  blocking_operation_ids: z.array(z.string().min(5).max(128)).max(64),
  degraded_operation_ids: z.array(z.string().min(5).max(128)).max(64),
}).strict();

export const InstalledPackageRecordSchema = z.object({
  store_version: z.literal(1),
  package_id: PackageIdSchema,
  publisher_id: z.string().min(3).max(128),
  package_version: z.string().min(1).max(64),
  package_kind: z.array(PackageComponentKindSchema).min(1).max(3),
  installation_id: z.string().uuid(),
  package_digest: Sha256DigestSchema,
  previous_package_digest: Sha256DigestSchema.nullable(),
  generation: z.number().int().nonnegative(),
  state: PackageLifecycleStateSchema,
  source: PackageSourceSchema,
  trust: PackageTrustProjectionSchema,
  manifest: PackageComponentManifestSchema,
  installed_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();

export const InstalledComponentRecordSchema = z.object({
  record_version: z.literal(1),
  package_id: PackageIdSchema,
  installation_id: z.string().uuid(),
  component_id: z.string().min(3).max(128),
  component_kind: ComponentKindProjectionSchema,
  display_name: z.string().min(1).max(80),
  owner_component_id: z.string().min(3).max(128).nullable(),
  state: ComponentLifecycleStateSchema,
  health: ComponentHealthStateSchema,
  launchable: z.boolean(),
  lifecycle_actions: z.array(z.string().min(1).max(32)).max(10),
  provided_operations: z.array(z.string().min(5).max(128)).max(64),
  required_capabilities: z.array(SafeCapabilityDependencyProjectionSchema).max(64),
  sidecar_count: z.number().int().nonnegative(),
  target_support: z.array(TargetSupportSchema).max(3),
  cleanup_on_uninstall: z.boolean(),
  updated_at: TimestampSchema,
}).strict();

export const PackageUninstallRecordSchema = z.object({
  uninstall_record_version: z.literal(1),
  package_id: PackageIdSchema,
  installation_id: z.string().uuid(),
  package_digest: Sha256DigestSchema,
  operation_id: z.string().uuid(),
  removed_component_ids: z.array(z.string().min(3).max(128)).max(96),
  runtime_state_removed: z.literal(true),
  callable_registrations_cleared: z.literal(true),
  retained: z.object({
    diagnostics: z.literal("bounded_redacted"),
    evidence: z.literal("content_free_bounded"),
    provider_cache: z.literal("delete_by_default_unless_owner_preserves"),
  }).strict(),
  completed_at: TimestampSchema,
}).strict();

export const OwnerSafeInstalledPackageComponentSchema = z.object({
  component_id: z.string(),
  component_kind: ComponentKindProjectionSchema,
  display_name: z.string(),
  owner_component_id: z.string().nullable(),
  state: ComponentLifecycleStateSchema,
  health: ComponentHealthStateSchema,
  launchable: z.boolean(),
  owner_visible_actions: z.array(z.string()),
  provided_operations: z.array(z.string()),
  required_capabilities: z.array(SafeCapabilityDependencyProjectionSchema),
  capability_dependency_status: z.array(CapabilityDependencyAvailabilitySchema),
  dependency_readiness: CapabilityDependencyReadinessSchema,
  sidecar_count: z.number().int().nonnegative(),
  target_support: z.array(TargetSupportSchema),
}).strict();

export const OwnerSafeInstalledPackageSchema = z.object({
  projection_version: z.literal(1),
  identity: z.object({
    package_id: PackageIdSchema,
    display_name: z.string(),
    publisher_id: z.string(),
    installation_id: z.string().uuid(),
    package_digest: Sha256DigestSchema,
  }).strict(),
  package_kind: z.array(PackageComponentKindSchema),
  state: PackageLifecycleStateSchema,
  generation: z.number().int().nonnegative(),
  version: z.object({
    installed: z.string(),
    previous_package_digest: Sha256DigestSchema.nullable(),
  }).strict(),
  trust: PackageTrustProjectionSchema,
  source: PackageSourceSchema,
  components: z.array(OwnerSafeInstalledPackageComponentSchema),
  operations: z.array(z.object({
    operation_id: z.string(),
    provider_component_id: z.string(),
    result_classification: z.literal("generic_envelope"),
  }).strict()),
  capability_dependencies: z.array(SafeCapabilityDependencyProjectionSchema),
  capability_dependency_status: z.array(CapabilityDependencyAvailabilitySchema),
  dependency_readiness: CapabilityDependencyReadinessSchema,
  retention: z.object({
    runtime_authority: z.literal("ephemeral_remove_on_stop_or_uninstall"),
    sidecar_runtime_state: z.literal("remove_on_uninstall"),
    provider_cache: z.literal("delete_by_default_unless_owner_preserves"),
    diagnostics: z.literal("bounded_redacted"),
    evidence: z.literal("content_free_bounded"),
  }).strict(),
  available_actions: z.array(z.string()),
  updated_at: TimestampSchema,
}).strict();

export type InstalledPackageRecord = z.infer<typeof InstalledPackageRecordSchema>;
export type InstalledComponentRecord = z.infer<typeof InstalledComponentRecordSchema>;
export type PackageUninstallRecord = z.infer<typeof PackageUninstallRecordSchema>;
export type OwnerSafeInstalledPackage = z.infer<typeof OwnerSafeInstalledPackageSchema>;
export type ComponentLifecycleState = z.infer<typeof ComponentLifecycleStateSchema>;
export type ComponentHealthState = z.infer<typeof ComponentHealthStateSchema>;
type SafeCapabilityDependency = z.infer<typeof SafeCapabilityDependencyProjectionSchema>;
export type CapabilityDependencyState = z.infer<typeof CapabilityDependencyStateSchema>;
export type CapabilityDependencyAvailability = z.infer<typeof CapabilityDependencyAvailabilitySchema>;
export type CapabilityDependencyReadiness = z.infer<typeof CapabilityDependencyReadinessSchema>;
export type CapabilityDependencyResolution = {
  operation_id: string;
  state: CapabilityDependencyState;
  callable: boolean;
  provider_count: number;
  failure_code: z.infer<typeof CapabilityDependencyFailureCodeSchema> | null;
  safe_message: string;
  checked_at: string | null;
};
export type CapabilityDependencyResolver = {
  resolveDependency(operationId: string): Promise<CapabilityDependencyResolution>;
};

type StoreHooks = { beforeRename?: (targetPath: string) => Promise<void> };
export type InstallPackageInput = {
  manifest: unknown;
  packageDigest: `sha256:${string}`;
  installationId?: string;
  source: z.infer<typeof PackageSourceSchema>;
  trust?: Partial<z.infer<typeof PackageTrustProjectionSchema>>;
  installedAt?: string;
};
export type UpdatePackageInput = Omit<InstallPackageInput, "installationId" | "installedAt"> & {
  updatedAt?: string;
};

async function syncDirectoryEntry(directoryPath: string): Promise<void> {
  const directory = await open(directoryPath, "r");
  try {
    await directory.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EINVAL" || code === "ENOTSUP")) return;
    throw error;
  } finally {
    await directory.close();
  }
}

export class InstalledPackageStore {
  private readonly packagesRoot: string;
  private readonly componentsRoot: string;
  private readonly uninstallRoot: string;
  private tail = Promise.resolve();

  constructor(public readonly root: string, private readonly hooks: StoreHooks = {}) {
    this.packagesRoot = path.join(root, "registry", "installed-packages");
    this.componentsRoot = path.join(root, "registry", "installed-components");
    this.uninstallRoot = path.join(root, "registry", "package-uninstalls");
  }

  async initialize(): Promise<void> {
    await Promise.all([this.packagesRoot, this.componentsRoot, this.uninstallRoot].map((directory) => mkdir(directory, { recursive: true })));
  }

  async installPackage(input: InstallPackageInput): Promise<InstalledPackageRecord> {
    return this.serial(async () => {
      const manifest = this.parseManifest(input.manifest);
      const now = input.installedAt ?? new Date().toISOString();
      const installationId = input.installationId ?? randomUUID();
      const record = InstalledPackageRecordSchema.parse({
        store_version: 1,
        package_id: manifest.package_id,
        publisher_id: manifest.publisher_id,
        package_version: manifest.package_version,
        package_kind: manifest.package_kind,
        installation_id: installationId,
        package_digest: input.packageDigest,
        previous_package_digest: null,
        generation: 1,
        state: "enabled",
        source: input.source,
        trust: trustProjection(input.trust, now),
        manifest,
        installed_at: now,
        updated_at: now,
      });
      await this.writePackageAndComponents(record, manifestComponents(record, manifest, now));
      return record;
    });
  }

  async updatePackage(packageId: string, input: UpdatePackageInput): Promise<InstalledPackageRecord> {
    return this.serial(async () => {
      const prior = await this.requirePackage(packageId);
      if (prior.state === "uninstalled") throw new AppPlatformError("invalid_state_transition", "Cannot update an uninstalled package");
      const manifest = this.parseManifest(input.manifest);
      if (manifest.package_id !== prior.package_id) throw new AppPlatformError("package_identity_mismatch", "Package update changed package identity");
      const now = input.updatedAt ?? new Date().toISOString();
      const record = InstalledPackageRecordSchema.parse({
        ...prior,
        package_version: manifest.package_version,
        package_kind: manifest.package_kind,
        package_digest: input.packageDigest,
        previous_package_digest: prior.package_digest,
        generation: prior.generation + 1,
        state: "enabled",
        source: input.source,
        trust: trustProjection(input.trust, now),
        manifest,
        updated_at: now,
      });
      await this.writePackageAndComponents(record, manifestComponents(record, manifest, now));
      return record;
    });
  }

  async disablePackage(packageId: string, at = new Date().toISOString()): Promise<InstalledPackageRecord> {
    return this.setPackageState(packageId, "disabled", at);
  }

  async enablePackage(packageId: string, at = new Date().toISOString()): Promise<InstalledPackageRecord> {
    return this.setPackageState(packageId, "enabled", at);
  }

  async uninstallPackage(packageId: string, operationId = randomUUID(), at = new Date().toISOString()): Promise<PackageUninstallRecord> {
    return this.serial(async () => {
      const prior = await this.requirePackage(packageId);
      if (prior.state === "uninstalled") throw new AppPlatformError("invalid_state_transition", "Package is already uninstalled");
      const components = await this.listComponents(packageId);
      const uninstalled = InstalledPackageRecordSchema.parse({ ...prior, state: "uninstalled", generation: prior.generation + 1, updated_at: at });
      const nextComponents = components.map((component) => InstalledComponentRecordSchema.parse({ ...component, state: "uninstalled", health: component.component_kind === "sidecar" ? "unknown" : "not_applicable", updated_at: at }));
      const journal = PackageUninstallRecordSchema.parse({
        uninstall_record_version: 1,
        package_id: prior.package_id,
        installation_id: prior.installation_id,
        package_digest: prior.package_digest,
        operation_id: operationId,
        removed_component_ids: nextComponents.map((component) => component.component_id),
        runtime_state_removed: true,
        callable_registrations_cleared: true,
        retained: {
          diagnostics: prior.manifest.retention_policy.diagnostics,
          evidence: prior.manifest.retention_policy.evidence,
          provider_cache: prior.manifest.retention_policy.provider_cache,
        },
        completed_at: at,
      });
      await this.writePackageAndComponents(uninstalled, nextComponents);
      await this.writeAtomic(path.join(this.uninstallRoot, `${operationId}.json`), journal);
      return journal;
    });
  }

  async readPackage(packageId: string): Promise<InstalledPackageRecord | null> {
    try {
      return InstalledPackageRecordSchema.parse(JSON.parse(await readFile(this.packagePath(packageId), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (isZodError(error)) throw new AppPlatformError("store_corrupt", "Installed package record is corrupt");
      throw error;
    }
  }

  async requirePackage(packageId: string): Promise<InstalledPackageRecord> {
    const record = await this.readPackage(packageId);
    if (!record) throw new AppPlatformError("package_not_found", "Installed package record is unavailable", 404);
    return record;
  }

  async listPackages(): Promise<InstalledPackageRecord[]> {
    try {
      const names = (await readdir(this.packagesRoot)).filter((name) => name.endsWith(".json")).sort();
      return await Promise.all(names.map(async (name) => {
        const record = InstalledPackageRecordSchema.parse(JSON.parse(await readFile(path.join(this.packagesRoot, name), "utf8")));
        return record;
      }));
    } catch (error) {
      if (isZodError(error)) throw new AppPlatformError("store_corrupt", "Installed package record is corrupt");
      throw error;
    }
  }

  async readComponent(packageId: string, componentId: string): Promise<InstalledComponentRecord | null> {
    try {
      return InstalledComponentRecordSchema.parse(JSON.parse(await readFile(path.join(this.componentsPath(packageId), `${safeComponentFile(componentId)}.json`), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (isZodError(error)) throw new AppPlatformError("store_corrupt", "Installed component record is corrupt");
      throw error;
    }
  }

  async setSidecarRuntimeState(
    packageId: string,
    componentId: string,
    state: Extract<ComponentLifecycleState, "stopped" | "running" | "uninstalled" | "unavailable" | "failed">,
    health: Extract<ComponentHealthState, "unknown" | "healthy" | "unhealthy">,
    at = new Date().toISOString(),
  ): Promise<InstalledComponentRecord> {
    return this.serial(async () => {
      const prior = await this.requirePackage(packageId);
      if (prior.state === "uninstalled" && state !== "uninstalled") {
        throw new AppPlatformError("invalid_state_transition", "Cannot activate a sidecar from an uninstalled package");
      }
      if (prior.state === "disabled" && state === "running") {
        throw new AppPlatformError("invalid_state_transition", "Cannot start a sidecar from a disabled package");
      }
      const components = await this.listComponents(packageId);
      const index = components.findIndex((component) => component.component_id === componentId);
      if (index < 0) throw new AppPlatformError("not_found_within_scope", "Installed sidecar component is unavailable", 404);
      const component = components[index]!;
      if (component.component_kind !== "sidecar") throw new AppPlatformError("descriptor_invalid", "Component is not a sidecar");
      const updated = InstalledComponentRecordSchema.parse({ ...component, state, health, updated_at: at });
      const nextComponents = components.slice();
      nextComponents[index] = updated;
      await this.writePackageAndComponents(InstalledPackageRecordSchema.parse({ ...prior, updated_at: at }), nextComponents);
      return updated;
    });
  }

  async listComponents(packageId: string): Promise<InstalledComponentRecord[]> {
    const root = this.componentsPath(packageId);
    try {
      const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
      return await Promise.all(names.map(async (name) => InstalledComponentRecordSchema.parse(JSON.parse(await readFile(path.join(root, name), "utf8")))));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      if (isZodError(error)) throw new AppPlatformError("store_corrupt", "Installed component record is corrupt");
      throw error;
    }
  }

  async readUninstallRecord(operationId: string): Promise<PackageUninstallRecord | null> {
    try {
      return PackageUninstallRecordSchema.parse(JSON.parse(await readFile(path.join(this.uninstallRoot, `${operationId}.json`), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (isZodError(error)) throw new AppPlatformError("store_corrupt", "Package uninstall record is corrupt");
      throw error;
    }
  }

  async ownerSafeCatalog(options: { dependencyResolver?: CapabilityDependencyResolver | null } = {}): Promise<OwnerSafeInstalledPackage[]> {
    const packages = await this.listPackages();
    const projections = await Promise.all(packages.map(async (record) => {
      const components = await this.listComponents(record.package_id);
      return await ownerSafePackageProjection(record, components, options);
    }));
    return projections.sort((left, right) => left.identity.package_id.localeCompare(right.identity.package_id));
  }

  private async setPackageState(packageId: string, state: "enabled" | "disabled", at: string): Promise<InstalledPackageRecord> {
    return this.serial(async () => {
      const prior = await this.requirePackage(packageId);
      if (prior.state === "uninstalled") throw new AppPlatformError("invalid_state_transition", "Cannot change an uninstalled package");
      const record = InstalledPackageRecordSchema.parse({ ...prior, state, generation: prior.generation + 1, updated_at: at });
      const components = (await this.listComponents(packageId)).map((component) => InstalledComponentRecordSchema.parse({
        ...component,
        state: component.component_kind === "sidecar" ? "stopped" : state,
        updated_at: at,
      }));
      await this.writePackageAndComponents(record, components);
      return record;
    });
  }

  private parseManifest(candidate: unknown): PackageComponentManifest {
    try {
      return parsePackageComponentManifestForConformance(candidate);
    } catch (error) {
      throw new AppPlatformError("package_manifest_invalid", error instanceof Error ? error.message : "Package component manifest is invalid");
    }
  }

  private async writePackageAndComponents(record: InstalledPackageRecord, components: InstalledComponentRecord[]): Promise<void> {
    await this.writeAtomic(this.packagePath(record.package_id), record);
    const componentRoot = this.componentsPath(record.package_id);
    await rm(componentRoot, { recursive: true, force: true });
    await mkdir(componentRoot, { recursive: true });
    await Promise.all(components.map((component) => this.writeAtomic(path.join(componentRoot, `${safeComponentFile(component.component_id)}.json`), component)));
  }

  private packagePath(packageId: string): string {
    return path.join(this.packagesRoot, `${safePackageFile(packageId)}.json`);
  }

  private componentsPath(packageId: string): string {
    return path.join(this.componentsRoot, safePackageFile(packageId));
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async writeAtomic(targetPath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await this.hooks.beforeRename?.(targetPath);
      await rename(tempPath, targetPath);
      await syncDirectoryEntry(path.dirname(targetPath));
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
  }
}

export async function ownerSafePackageProjection(
  record: InstalledPackageRecord,
  components: readonly InstalledComponentRecord[],
  options: { dependencyResolver?: CapabilityDependencyResolver | null } = {},
): Promise<OwnerSafeInstalledPackage> {
  const manifest = record.manifest;
  const dependencyStatus = await dependencyStatusMap(allManifestDependencies(manifest), options.dependencyResolver ?? null);
  return OwnerSafeInstalledPackageSchema.parse({
    projection_version: 1,
    identity: {
      package_id: record.package_id,
      display_name: manifest.catalog.display_name,
      publisher_id: record.publisher_id,
      installation_id: record.installation_id,
      package_digest: record.package_digest,
    },
    package_kind: record.package_kind,
    state: record.state,
    generation: record.generation,
    version: {
      installed: record.package_version,
      previous_package_digest: record.previous_package_digest,
    },
    trust: record.state === "quarantined" ? { ...record.trust, status: "quarantined" } : record.trust,
    source: record.source,
    components: components.map((component) => ({
      component_id: component.component_id,
      component_kind: component.component_kind,
      display_name: component.display_name,
      owner_component_id: component.owner_component_id,
      state: component.state,
      health: component.health,
      launchable: component.launchable,
      owner_visible_actions: component.state === "uninstalled" ? [] : safeComponentActions(component.lifecycle_actions, readinessForDependencies(component.required_capabilities.map((dependency) => statusForDependency(dependency, dependencyStatus)))),
      provided_operations: component.provided_operations,
      required_capabilities: component.required_capabilities,
      capability_dependency_status: component.required_capabilities.map((dependency) => statusForDependency(dependency, dependencyStatus)),
      dependency_readiness: readinessForDependencies(component.required_capabilities.map((dependency) => statusForDependency(dependency, dependencyStatus))),
      sidecar_count: component.sidecar_count,
      target_support: component.target_support,
    })),
    operations: manifest.provided_operations.map((operation) => ({
      operation_id: operation.operation_id,
      provider_component_id: operation.provider_component_id,
      result_classification: operation.result_classification,
    })),
    capability_dependencies: manifest.capability_dependencies.map(safeDependency),
    capability_dependency_status: manifest.capability_dependencies.map((dependency) => statusForDependency(dependency, dependencyStatus)),
    dependency_readiness: readinessForDependencies(manifest.capability_dependencies.map((dependency) => statusForDependency(dependency, dependencyStatus))),
    retention: {
      runtime_authority: manifest.retention_policy.runtime_binding,
      sidecar_runtime_state: manifest.retention_policy.sidecar_runtime_state,
      provider_cache: manifest.retention_policy.provider_cache,
      diagnostics: manifest.retention_policy.diagnostics,
      evidence: manifest.retention_policy.evidence,
    },
    available_actions: record.state === "uninstalled" ? [] : safePackageActions(packageActions(record), readinessForDependencies(manifest.capability_dependencies.map((dependency) => statusForDependency(dependency, dependencyStatus)))),
    updated_at: record.updated_at,
  });
}

function manifestComponents(record: InstalledPackageRecord, manifest: PackageComponentManifest, now: string): InstalledComponentRecord[] {
  const sidecarsByOwner = new Map<string, SidecarDescriptor[]>();
  for (const sidecar of manifest.sidecars) {
    sidecarsByOwner.set(sidecar.owner_component_id, [...sidecarsByOwner.get(sidecar.owner_component_id) ?? [], sidecar]);
  }
  const operationsByProvider = new Map<string, ProvidedOperation[]>();
  for (const operation of manifest.provided_operations) {
    operationsByProvider.set(operation.provider_component_id, [...operationsByProvider.get(operation.provider_component_id) ?? [], operation]);
  }
  const components = manifest.components.map((component) => componentRecord(record, component, sidecarsByOwner.get(component.component_id) ?? [], operationsByProvider.get(component.component_id) ?? [], manifest.capability_dependencies, now));
  const sidecars = manifest.sidecars.map((sidecar) => sidecarRecord(record, sidecar, now));
  return [...components, ...sidecars];
}

function componentRecord(record: InstalledPackageRecord, component: PackageComponent, sidecars: SidecarDescriptor[], operations: ProvidedOperation[], packageDependencies: CapabilityDependency[], now: string): InstalledComponentRecord {
  return InstalledComponentRecordSchema.parse({
    record_version: 1,
    package_id: record.package_id,
    installation_id: record.installation_id,
    component_id: component.component_id,
    component_kind: component.component_kind,
    display_name: component.display_name,
    owner_component_id: null,
    state: record.state === "disabled" ? "disabled" : record.state === "uninstalled" ? "uninstalled" : "enabled",
    health: "not_applicable",
    launchable: component.launchable,
    lifecycle_actions: component.lifecycle_actions,
    provided_operations: component.component_kind === "capability_provider" ? operations.map((operation) => operation.operation_id) : [],
    required_capabilities: component.component_kind === "app" ? component.requested_capabilities.map(safeDependency) : packageDependencies.map(safeDependency),
    sidecar_count: sidecars.length,
    target_support: [],
    cleanup_on_uninstall: true,
    updated_at: now,
  });
}

function sidecarRecord(record: InstalledPackageRecord, sidecar: SidecarDescriptor, now: string): InstalledComponentRecord {
  return InstalledComponentRecordSchema.parse({
    record_version: 1,
    package_id: record.package_id,
    installation_id: record.installation_id,
    component_id: sidecar.component_id,
    component_kind: "sidecar",
    display_name: sidecar.display_name,
    owner_component_id: sidecar.owner_component_id,
    state: record.state === "uninstalled" ? "uninstalled" : "stopped",
    health: "unknown",
    launchable: false,
    lifecycle_actions: sidecarLifecycleActions(sidecar),
    provided_operations: [],
    required_capabilities: [],
    sidecar_count: 0,
    target_support: sidecar.targets.map((target) => ({ target: target.target, runtime_kind: target.runtime_kind })),
    cleanup_on_uninstall: sidecar.lifecycle.cleanup_on_uninstall,
    updated_at: now,
  });
}

function sidecarLifecycleActions(sidecar: SidecarDescriptor): string[] {
  const actions = ["start", "stop", "health"];
  if (sidecar.lifecycle.restart_policy === "bounded") actions.push("restart");
  return actions;
}

function packageActions(record: InstalledPackageRecord): string[] {
  if (record.state === "enabled") return ["disable", "update", "uninstall"];
  if (record.state === "disabled") return ["enable", "update", "uninstall"];
  if (record.state === "updating") return [];
  if (record.state === "quarantined") return ["uninstall"];
  if (record.state === "failed") return ["uninstall"];
  return [];
}

function allManifestDependencies(manifest: PackageComponentManifest): SafeCapabilityDependency[] {
  const dependencies = new Map<string, SafeCapabilityDependency>();
  for (const dependency of manifest.capability_dependencies) dependencies.set(dependency.operation_id, safeDependency(dependency));
  for (const component of manifest.components) {
    if (component.component_kind === "app") {
      for (const dependency of component.requested_capabilities) dependencies.set(dependency.operation_id, safeDependency(dependency));
    }
  }
  return [...dependencies.values()];
}

function safeDependency(dependency: CapabilityDependency): SafeCapabilityDependency {
  return {
    operation_id: dependency.operation_id,
    requirement: dependency.requirement,
    unavailable_behavior: dependency.unavailable_behavior,
  };
}

async function dependencyStatusMap(dependencies: readonly SafeCapabilityDependency[], resolver: CapabilityDependencyResolver | null): Promise<Map<string, CapabilityDependencyResolution>> {
  const results = new Map<string, CapabilityDependencyResolution>();
  for (const dependency of dependencies) {
    if (results.has(dependency.operation_id)) continue;
    if (!resolver) {
      results.set(dependency.operation_id, dependencyResolution(dependency.operation_id, "unknown", false, 0, "unknown", "Capability dependency readiness has not been checked.", null));
      continue;
    }
    try {
      const resolved = await resolver.resolveDependency(dependency.operation_id);
      results.set(dependency.operation_id, CapabilityDependencyAvailabilitySchema.omit({ requirement: true, unavailable_behavior: true }).parse(resolved));
    } catch {
      results.set(dependency.operation_id, dependencyResolution(dependency.operation_id, "unknown", false, 0, "unknown", "Capability dependency readiness could not be checked.", null));
    }
  }
  return results;
}

function statusForDependency(dependency: SafeCapabilityDependency, statuses: ReadonlyMap<string, CapabilityDependencyResolution>): CapabilityDependencyAvailability {
  const status = statuses.get(dependency.operation_id) ?? dependencyResolution(dependency.operation_id, "unknown", false, 0, "unknown", "Capability dependency readiness has not been checked.", null);
  const state = dependencyState(status);
  return CapabilityDependencyAvailabilitySchema.parse({
    operation_id: dependency.operation_id,
    requirement: dependency.requirement,
    unavailable_behavior: dependency.unavailable_behavior,
    state,
    callable: status.callable && state === "available",
    provider_count: status.provider_count,
    failure_code: status.callable ? null : status.failure_code,
    safe_message: status.callable ? "Capability dependency is available." : status.safe_message,
    checked_at: status.checked_at,
  });
}

function dependencyState(status: CapabilityDependencyResolution): CapabilityDependencyState {
  if (status.callable) return "available";
  if (status.state === "unavailable" && status.provider_count === 0) return "missing";
  return status.state;
}

function readinessForDependencies(dependencies: readonly CapabilityDependencyAvailability[]): CapabilityDependencyReadiness {
  const blocking = dependencies
    .filter((dependency) => dependency.requirement === "required" && !dependency.callable)
    .map((dependency) => dependency.operation_id);
  const degraded = dependencies
    .filter((dependency) => dependency.requirement === "optional" && !dependency.callable)
    .map((dependency) => dependency.operation_id);
  const hasUnknown = dependencies.some((dependency) => dependency.state === "unknown");
  const status = blocking.length > 0 ? "blocked" : degraded.length > 0 ? "degraded" : hasUnknown ? "unknown" : "ready";
  return CapabilityDependencyReadinessSchema.parse({
    status,
    required_available: blocking.length === 0,
    optional_available: degraded.length === 0,
    blocking_operation_ids: blocking,
    degraded_operation_ids: degraded,
  });
}

function safePackageActions(actions: string[], readiness: CapabilityDependencyReadiness): string[] {
  if (readiness.status !== "blocked") return actions;
  return actions.filter((action) => action !== "enable" && action !== "start" && action !== "launch");
}

function safeComponentActions(actions: string[], readiness: CapabilityDependencyReadiness): string[] {
  if (readiness.status !== "blocked") return actions;
  return actions.filter((action) => action !== "enable" && action !== "start" && action !== "launch");
}

function dependencyResolution(
  operationId: string,
  state: CapabilityDependencyState,
  callable: boolean,
  providerCount: number,
  failureCode: z.infer<typeof CapabilityDependencyFailureCodeSchema> | null,
  safeMessage: string,
  checkedAt: string | null,
): CapabilityDependencyResolution {
  return {
    operation_id: operationId,
    state,
    callable,
    provider_count: providerCount,
    failure_code: failureCode,
    safe_message: safeMessage,
    checked_at: checkedAt,
  };
}

function trustProjection(raw: Partial<z.infer<typeof PackageTrustProjectionSchema>> | undefined, now: string): z.infer<typeof PackageTrustProjectionSchema> {
  return PackageTrustProjectionSchema.parse({
    status: raw?.status ?? "verified",
    policy_version: 1,
    checked_at: raw?.checked_at ?? now,
  });
}

function isZodError(error: unknown): error is z.ZodError {
  return error instanceof z.ZodError || (error instanceof Error && error.name === "ZodError");
}

function safePackageFile(value: string): string {
  return PackageIdSchema.parse(value);
}

function safeComponentFile(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
