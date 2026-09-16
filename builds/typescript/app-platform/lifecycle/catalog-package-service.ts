import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { PackageComponentManifestSchema, PackageIdSchema, RuntimeTargetSchema, type PackageComponentManifest } from "../contracts/package-components.js";
import { Sha256DigestSchema } from "../contracts/common.js";
import { AppPlatformError } from "./errors.js";
import {
  InstalledPackageStore,
  ownerSafeAvailablePackageProjection,
  type CapabilityDependencyResolver,
  type OwnerSafeInstalledPackage,
} from "./installed-package-store.js";
import {
  createStage1CatalogPackageSource,
  listStage1CatalogPackages,
  type Stage1CatalogRuntimeTarget,
  type Stage1CatalogSourceConfig,
} from "./stage1-catalog-source.js";
import { readStoredZip, type ZipEntry } from "./zip.js";

const CatalogPackageDescriptorSchema = z.object({
  package_id: PackageIdSchema,
  publisher_id: z.string().min(3).max(128),
  package_version: z.string().min(1).max(64),
  manifest_package_version: z.string().min(1).max(64),
  target: RuntimeTargetSchema,
  archive: z.object({
    digest: Sha256DigestSchema,
    manifest_path: z.string().min(1).max(256),
  }).strict().passthrough(),
}).strict().passthrough();

export type CatalogPackageService = ReturnType<typeof createCatalogPackageService>;

export type LoadedCatalogPackage = {
  manifest: PackageComponentManifest;
  packageDigest: `sha256:${string}`;
  packageRoot: string;
  sourceLabel: string;
};

export function createCatalogPackageService(input: {
  catalogSource: Stage1CatalogSourceConfig | null | undefined;
  packageStore: InstalledPackageStore;
  memoryRoot: string;
  stateRoot?: string;
  target: Stage1CatalogRuntimeTarget;
  includeLaunchablePackages?: boolean;
  dependencyResolver?: CapabilityDependencyResolver | null;
  now?: () => string;
}) {
  const catalogSource = input.catalogSource ?? null;
  const includeLaunchablePackages = input.includeLaunchablePackages ?? false;
  return Object.freeze({
    async availablePackages(): Promise<OwnerSafeInstalledPackage[]> {
      if (!catalogSource) return [];
      const installed = await input.packageStore.listPackages();
      const installedIds = new Set(installed.filter((pack) => pack.state !== "uninstalled").map((pack) => pack.package_id));
      const listings = await listStage1CatalogPackages({
        source: catalogSource,
        target: input.target,
        fallbackCacheRoot: catalogCacheRoot(input.memoryRoot, input.stateRoot),
      });
      const candidates = listings.filter((listing) =>
        (includeLaunchablePackages || !listing.launchableApp) &&
        !installedIds.has(listing.packageId)
      );
      const projections = await Promise.all(candidates.map(async (listing) => {
        const loaded = await loadCatalogPackage({
          catalogSource,
          packageId: listing.packageId,
          memoryRoot: input.memoryRoot,
          stateRoot: input.stateRoot,
          target: input.target,
        });
        return ownerSafeAvailablePackageProjection({
          manifest: loaded.manifest,
          packageDigest: loaded.packageDigest,
          source: { kind: "local_package", label: loaded.sourceLabel },
          dependencyResolver: input.dependencyResolver,
          currentTarget: input.target,
          updatedAt: input.now?.(),
        });
      }));
      return projections.sort((left, right) => left.identity.package_id.localeCompare(right.identity.package_id));
    },
    async installPackage(packageId: string): Promise<LoadedCatalogPackage> {
      if (!catalogSource) throw new AppPlatformError("package_not_found", "Catalog package source is unavailable", 404);
      const loaded = await loadCatalogPackage({
        catalogSource,
        packageId,
        memoryRoot: input.memoryRoot,
        stateRoot: input.stateRoot,
        target: input.target,
      });
      if (!existsSync(path.join(loaded.packageRoot, "manifest.json"))) {
        await extractComponentPackage(loaded.entries, loaded.manifest, loaded.packageRoot, loaded.manifestPath);
      }
      const source = { kind: "local_package" as const, label: loaded.sourceLabel };
      const existing = await input.packageStore.readPackage(loaded.manifest.package_id);
      if (existing && existing.state !== "uninstalled") {
        if (existing.package_digest !== loaded.packageDigest || existing.package_version !== loaded.manifest.package_version) {
          await input.packageStore.updatePackage(loaded.manifest.package_id, {
            manifest: loaded.manifest,
            packageDigest: loaded.packageDigest,
            source,
          });
        }
      } else {
        await input.packageStore.installPackage({
          manifest: loaded.manifest,
          packageDigest: loaded.packageDigest,
          source,
        });
      }
      return {
        manifest: loaded.manifest,
        packageDigest: loaded.packageDigest,
        packageRoot: loaded.packageRoot,
        sourceLabel: loaded.sourceLabel,
      };
    },
    async loadPackage(packageId: string): Promise<LoadedCatalogPackage> {
      if (!catalogSource) throw new AppPlatformError("package_not_found", "Catalog package source is unavailable", 404);
      const loaded = await loadCatalogPackage({
        catalogSource,
        packageId,
        memoryRoot: input.memoryRoot,
        stateRoot: input.stateRoot,
        target: input.target,
      });
      return {
        manifest: loaded.manifest,
        packageDigest: loaded.packageDigest,
        packageRoot: loaded.packageRoot,
        sourceLabel: loaded.sourceLabel,
      };
    },
  });
}

export function catalogPackageRootForDigest(memoryRoot: string, stateRoot: string | undefined, packageDigest: `sha256:${string}`): string {
  return path.join(packageStoreRoot(memoryRoot, stateRoot), "catalog-extracted", packageDigest.slice("sha256:".length));
}

async function loadCatalogPackage(input: {
  catalogSource: Stage1CatalogSourceConfig;
  packageId: string;
  memoryRoot: string;
  stateRoot?: string;
  target: Stage1CatalogRuntimeTarget;
}): Promise<LoadedCatalogPackage & {
  entries: ZipEntry[];
  manifestPath: string;
}> {
  const catalogPackageSource = await createStage1CatalogPackageSource({
    source: input.catalogSource,
    appId: input.packageId,
    target: input.target,
    fallbackCacheRoot: catalogCacheRoot(input.memoryRoot, input.stateRoot),
  });
  const packageKey = `${input.packageId}@${catalogPackageSource.availableVersion}`;
  const packagePaths = catalogPackageSource.repository.packagesByAppVersion?.[packageKey];
  if (!packagePaths) throw new AppPlatformError("package_not_found", "Catalog package artifact is unavailable", 404);

  const descriptor = CatalogPackageDescriptorSchema.parse(JSON.parse(await readFile(packagePaths.descriptorPath, "utf8")));
  if (
    descriptor.package_id !== input.packageId ||
    descriptor.package_version !== catalogPackageSource.availableVersion ||
    descriptor.target !== input.target
  ) {
    throw new AppPlatformError("package_signature_invalid", "Catalog package descriptor is inconsistent");
  }

  const archive = await readFile(packagePaths.archivePath);
  const packageDigest = digestBytes(archive);
  if (packageDigest !== descriptor.archive.digest) {
    throw new AppPlatformError("package_archive_digest_mismatch", "Package archive digest does not match catalog descriptor");
  }
  const entries = readStoredZip(archive);
  const manifestEntry = entries.find((entry) => entry.name === descriptor.archive.manifest_path);
  if (!manifestEntry) throw new AppPlatformError("package_manifest_invalid", "Package manifest is missing");
  const manifest = PackageComponentManifestSchema.parse(JSON.parse(manifestEntry.bytes.toString("utf8")));
  if (
    manifest.package_id !== descriptor.package_id ||
    manifest.publisher_id !== descriptor.publisher_id ||
    manifest.package_version !== descriptor.manifest_package_version
  ) {
    throw new AppPlatformError("package_identity_mismatch", "Package manifest identity does not match catalog descriptor", 403);
  }

  const declared = new Map(manifest.files.map((file) => [file.path, file]));
  const payloadEntries = entries.filter((entry) => entry.name !== descriptor.archive.manifest_path);
  if (payloadEntries.length !== declared.size) {
    throw new AppPlatformError("package_inventory_invalid", "Package contains undeclared or missing entries");
  }
  for (const entry of payloadEntries) {
    const file = declared.get(entry.name);
    if (!file || file.size_bytes !== entry.bytes.length || file.digest !== digestBytes(entry.bytes)) {
      throw new AppPlatformError("package_inventory_invalid", "Package file inventory does not match manifest metadata");
    }
  }

  return {
    manifest,
    packageDigest,
    packageRoot: catalogPackageRootForDigest(input.memoryRoot, input.stateRoot, packageDigest),
    entries,
    manifestPath: descriptor.archive.manifest_path,
    sourceLabel: catalogPackageSource.ownerSafeSource.label,
  };
}

async function extractComponentPackage(
  entries: readonly ZipEntry[],
  manifest: PackageComponentManifest,
  packageRoot: string,
  manifestPath: string,
): Promise<void> {
  await rm(packageRoot, { recursive: true, force: true });
  await mkdir(packageRoot, { recursive: true });
  const declared = new Map(manifest.files.map((file) => [file.path, file]));
  for (const entry of entries) {
    const destination = path.join(packageRoot, ...entry.name.split("/"));
    const resolvedRoot = path.resolve(packageRoot);
    const resolvedDestination = path.resolve(destination);
    if (!resolvedDestination.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new AppPlatformError("package_path_invalid", "Package path escaped the staging root");
    }
    const file = entry.name === manifestPath
      ? { mode: "read_only" as const }
      : declared.get(entry.name);
    if (!file) throw new AppPlatformError("package_inventory_invalid", "Package contains undeclared entries");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, entry.bytes, { mode: file.mode === "executable" ? 0o500 : 0o400 });
    if (file.mode === "executable") await chmod(destination, 0o500).catch(() => undefined);
  }
}

function packageStoreRoot(memoryRoot: string, stateRoot?: string): string {
  return path.resolve(stateRoot ?? path.join(path.dirname(memoryRoot), "app-platform-host"), "state", "packages");
}

function catalogCacheRoot(memoryRoot: string, stateRoot?: string): string {
  return path.join(packageStoreRoot(memoryRoot, stateRoot), "catalog-cache");
}

function digestBytes(value: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
