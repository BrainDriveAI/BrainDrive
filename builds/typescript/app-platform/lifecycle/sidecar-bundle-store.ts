import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  ComponentIdSchema,
  PackageIdSchema,
  RuntimeTargetSchema,
  type PackageComponentManifest,
  type SidecarDescriptor,
} from "../contracts/package-components.js";
import { ContractViolation } from "../contracts/errors.js";
import { canonicalJson, canonicalJsonDocumentDigest, OpaqueIdSchema, SemverSchema, Sha256DigestSchema, TimestampSchema } from "../contracts/common.js";
import { CanonicalPublisherIdSchema } from "../contracts/app-registry.js";
import { syncDirectoryEntry } from "./filesystem-durability.js";
import { ImmutablePackageStore } from "./verified-package-store.js";

type PackagedProcessTarget = Extract<SidecarDescriptor["targets"][number], { runtime_kind: "packaged_process" }>;
const verifiedSidecarPackageAuthorities = new WeakSet<object>();
const sidecarDriverBundleResolutions = new WeakSet<object>();

const DependencyIdentitySchema = z.object({
  name: z.string(),
  kind: z.enum(["runtime", "language_package", "native_library", "browser_binary", "service_config"]),
  version: SemverSchema,
  digest: Sha256DigestSchema,
  license_id: z.string(),
  provenance_id: ComponentIdSchema,
}).strict();

export const SidecarBundleReferenceSchema = z.object({
  reference_version: z.literal(1),
  bundle_reference_id: OpaqueIdSchema,
  package_id: PackageIdSchema,
  publisher_id: CanonicalPublisherIdSchema,
  package_version: z.string().min(1),
  package_digest: Sha256DigestSchema,
  component_id: ComponentIdSchema,
  target: RuntimeTargetSchema,
  runtime_kind: z.literal("packaged_process"),
  bundle_id: ComponentIdSchema,
  bundle_digest: Sha256DigestSchema,
  lockfile_digest: Sha256DigestSchema,
  cache_strategy: z.enum(["package_version_isolated", "content_addressed_immutable"]),
  content_address: Sha256DigestSchema.nullable(),
  dependencies: z.array(DependencyIdentitySchema).min(1).max(64),
}).strict();

const BundleFileSchema = z.object({
  path: z.string(),
  digest: Sha256DigestSchema,
  size_bytes: z.number().int().nonnegative(),
  mode: z.enum(["read_only", "executable"]),
}).strict();

const StoredBundleMetadataSchema = z.object({
  sidecar_bundle_store_version: z.literal(1),
  package_id: PackageIdSchema,
  publisher_id: CanonicalPublisherIdSchema,
  package_version: z.string().min(1),
  package_digest: Sha256DigestSchema,
  component_id: ComponentIdSchema,
  target: RuntimeTargetSchema,
  runtime_kind: z.literal("packaged_process"),
  bundle_id: ComponentIdSchema,
  bundle_digest: Sha256DigestSchema,
  lockfile_digest: Sha256DigestSchema,
  cache_strategy: z.enum(["package_version_isolated", "content_addressed_immutable"]),
  content_address: Sha256DigestSchema.nullable(),
  artifact_path: z.string(),
  entrypoint_path: z.string(),
  files: z.array(BundleFileSchema).min(1).max(16),
  dependencies: z.array(DependencyIdentitySchema).min(1).max(64),
  promoted_at: TimestampSchema,
}).strict();

export type SidecarBundleReference = z.infer<typeof SidecarBundleReferenceSchema>;

export type StagedSidecarBundle = {
  reference: SidecarBundleReference;
  alreadyStaged: boolean;
};

export type SidecarDriverBundleResolution = {
  packageDigest: `sha256:${string}`;
  contentRoot: string;
  artifactPath: string;
  entrypoint: string;
  target: "desktop_windows_x64" | "desktop_macos_universal";
  bundleDigest: `sha256:${string}`;
  lockfileDigest: `sha256:${string}`;
  contentBytes: number;
  dependencies: SidecarBundleReference["dependencies"];
};

export type VerifiedSidecarPackageBundle = {
  readonly authority: "immutable_package_store";
  readonly manifest: PackageComponentManifest;
  readonly packageDigest: `sha256:${string}`;
  readonly packageVersion: string;
  readonly contentRoot: string;
  readonly target: "docker_linux_x64" | "desktop_windows_x64" | "desktop_macos_universal";
};

export type StageSidecarBundleInput = {
  verifiedPackage: VerifiedSidecarPackageBundle;
  sidecarComponentId: string;
  target: "desktop_windows_x64" | "desktop_macos_universal";
  referenceId?: string;
  offline?: boolean;
};

export type SidecarBundleStoreHooks = {
  afterCopyBeforePromotion?(context: { temporaryRoot: string }): Promise<void> | void;
};

export async function createVerifiedSidecarPackageBundleFromStore(input: {
  packageStore: ImmutablePackageStore;
  packageDigest: `sha256:${string}`;
  manifest: PackageComponentManifest;
}): Promise<VerifiedSidecarPackageBundle> {
  if (!(input.packageStore instanceof ImmutablePackageStore)) {
    throw new ContractViolation("authority_widening", "Sidecar bundle staging requires the immutable package store");
  }
  Sha256DigestSchema.parse(input.packageDigest);
  const packageRecord = await input.packageStore.read(input.packageDigest);
  if (
    packageRecord.packageVersion !== input.manifest.package_version
    || packageRecord.manifestDigest !== canonicalJsonDocumentDigest(input.manifest)
    || packageRecord.appId !== input.manifest.package_id
    || packageRecord.publisherId !== input.manifest.publisher_id
  ) {
    throw new ContractViolation("authority_widening", "Verified package store record does not match the sidecar package manifest");
  }
  const bundle = Object.freeze({
    authority: "immutable_package_store" as const,
    manifest: input.manifest,
    packageDigest: packageRecord.packageDigest,
    packageVersion: packageRecord.packageVersion,
    contentRoot: packageRecord.contentRoot,
    target: packageRecord.target,
  });
  verifiedSidecarPackageAuthorities.add(bundle);
  return bundle;
}

function assertVerifiedSidecarPackageBundle(value: unknown): VerifiedSidecarPackageBundle {
  if (!value || typeof value !== "object" || !verifiedSidecarPackageAuthorities.has(value)) {
    throw new ContractViolation("authority_widening", "Sidecar bundle staging requires verified package store authority");
  }
  return value as VerifiedSidecarPackageBundle;
}

export function assertSidecarDriverBundleResolution(value: unknown): SidecarDriverBundleResolution {
  if (!value || typeof value !== "object" || !sidecarDriverBundleResolutions.has(value)) {
    throw new ContractViolation("authority_widening", "Sidecar driver requires verified sidecar bundle store resolution authority");
  }
  return value as SidecarDriverBundleResolution;
}

export class SidecarBundleStore {
  readonly layout: { packages: string; cache: string; metadata: string };

  constructor(
    private readonly root: string,
    private readonly clock: () => Date = () => new Date(),
    private readonly hooks: SidecarBundleStoreHooks = {},
  ) {
    const base = path.join(root, "sidecar-bundles");
    this.layout = {
      packages: path.join(base, "packages"),
      cache: path.join(base, "cache"),
      metadata: path.join(base, "metadata"),
    };
  }

  async initialize(): Promise<void> {
    await Promise.all(Object.values(this.layout).map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })));
  }

  async stage(input: StageSidecarBundleInput): Promise<StagedSidecarBundle> {
    await this.initialize();
    const verifiedPackage = assertVerifiedSidecarPackageBundle(input.verifiedPackage);
    Sha256DigestSchema.parse(verifiedPackage.packageDigest);
    if (verifiedPackage.target !== input.target) {
      throw new ContractViolation("unsupported_target", "Verified package store record is for a different runtime target");
    }
    const sidecar = verifiedPackage.manifest.sidecars.find((candidate) => candidate.component_id === input.sidecarComponentId);
    if (!sidecar) throw new ContractViolation("not_found_within_scope", "Declared sidecar component is not available in the verified package");
    const target = sidecar.targets.find((candidate) => candidate.target === input.target);
    if (!target) throw new ContractViolation("unsupported_target", "Verified package does not declare a desktop sidecar target for this host");
    if (target.runtime_kind !== "packaged_process") {
      throw new ContractViolation("unsupported_target", "Desktop sidecar staging requires a packaged-process target");
    }
    if (target.dependency_bundle.cache.mutable_global_fallback !== false) {
      throw new ContractViolation("authority_widening", "Mutable global runtime fallback is not sidecar bundle authority");
    }

    const metadata = await this.createMetadata(input, verifiedPackage, target);
    const reference = this.createReference(metadata, input.referenceId);
    const contentRoot = this.contentRootFor(metadata);
    const metadataPath = this.metadataPathFor(reference);
    const existing = await stat(contentRoot).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing) {
      if (!existing.isDirectory()) throw new ContractViolation("package_file_mismatch", "Sidecar bundle cache entry is not a directory");
      await this.assertStoredBundle(reference, metadata, contentRoot);
      await this.writeMetadataIfAbsent(metadataPath, metadata);
      return { reference, alreadyStaged: true };
    }

    await this.copyBundleFiles(verifiedPackage.contentRoot, contentRoot, metadata);
    await this.sealTree(contentRoot, new Set(metadata.files.filter((file) => file.mode === "executable").map((file) => file.path)));
    await writeAtomic(metadataPath, metadata, 0o400);
    return { reference, alreadyStaged: false };
  }

  async resolveForDriver(
    referenceInput: SidecarBundleReference,
    _options: { offline?: boolean } = {},
  ): Promise<SidecarDriverBundleResolution> {
    const reference = SidecarBundleReferenceSchema.parse(referenceInput);
    const metadata = StoredBundleMetadataSchema.parse(JSON.parse(await readFile(this.metadataPathFor(reference), "utf8")));
    if (
      metadata.package_digest !== reference.package_digest
      || metadata.component_id !== reference.component_id
      || metadata.target !== reference.target
      || metadata.bundle_digest !== reference.bundle_digest
      || metadata.lockfile_digest !== reference.lockfile_digest
    ) {
      throw new ContractViolation("package_file_mismatch", "Sidecar bundle reference no longer matches staged metadata");
    }
    const contentRoot = this.contentRootFor(metadata);
    await this.assertStoredBundle(reference, metadata, contentRoot);
    const artifactPath = this.resolveInside(contentRoot, metadata.artifact_path);
    const entrypoint = this.resolveInside(contentRoot, metadata.entrypoint_path);
    const resolution = Object.freeze({
      packageDigest: reference.package_digest as `sha256:${string}`,
      contentRoot,
      artifactPath,
      entrypoint,
      target: reference.target as "desktop_windows_x64" | "desktop_macos_universal",
      bundleDigest: reference.bundle_digest as `sha256:${string}`,
      lockfileDigest: reference.lockfile_digest as `sha256:${string}`,
      contentBytes: metadata.files.reduce((total, file) => total + file.size_bytes, 0),
      dependencies: reference.dependencies,
    });
    sidecarDriverBundleResolutions.add(resolution);
    return resolution;
  }

  private async createMetadata(
    input: StageSidecarBundleInput,
    verifiedPackage: VerifiedSidecarPackageBundle,
    target: PackagedProcessTarget,
  ): Promise<z.infer<typeof StoredBundleMetadataSchema>> {
    const filesByPath = new Map(verifiedPackage.manifest.files.map((file) => [file.path, file]));
    const requiredPaths = [
      target.artifact_path,
      target.entrypoint,
      target.dependency_bundle.lockfile_path,
      target.dependency_bundle.provenance_path,
      target.dependency_bundle.sbom_path,
    ];
    const uniquePaths = [...new Set(requiredPaths)];
    const files = [];
    for (const packagePath of uniquePaths) {
      const file = filesByPath.get(packagePath);
      if (!file) throw new ContractViolation("package_file_mismatch", "Sidecar bundle references an undeclared package asset");
      const actualDigest = await this.readAndVerifyPackageFile(verifiedPackage.contentRoot, file.path, file.size_bytes, file.digest);
      files.push({ path: file.path, digest: actualDigest, size_bytes: file.size_bytes, mode: file.mode });
    }
    const artifact = filesByPath.get(target.artifact_path);
    const entrypoint = filesByPath.get(target.entrypoint);
    const lockfile = filesByPath.get(target.dependency_bundle.lockfile_path);
    const provenance = filesByPath.get(target.dependency_bundle.provenance_path);
    const sbom = filesByPath.get(target.dependency_bundle.sbom_path);
    if (!artifact || !entrypoint || !lockfile || !provenance || !sbom) {
      throw new ContractViolation("package_file_mismatch", "Sidecar bundle references missing package assets");
    }
    if (entrypoint.mode !== "executable") {
      throw new ContractViolation("package_descriptor_invalid", "Sidecar entrypoint must be declared executable");
    }
    if (
      artifact.digest !== target.dependency_bundle.bundle_digest
      || lockfile.digest !== target.dependency_bundle.lockfile_digest
      || provenance.digest !== target.dependency_bundle.provenance_digest
      || sbom.digest !== target.dependency_bundle.sbom_digest
    ) {
      throw new ContractViolation("package_digest_mismatch", "Sidecar dependency bundle metadata does not match package inventory");
    }
    return StoredBundleMetadataSchema.parse({
      sidecar_bundle_store_version: 1,
      package_id: verifiedPackage.manifest.package_id,
      publisher_id: verifiedPackage.manifest.publisher_id,
      package_version: verifiedPackage.manifest.package_version,
      package_digest: verifiedPackage.packageDigest,
      component_id: input.sidecarComponentId,
      target: input.target,
      runtime_kind: "packaged_process",
      bundle_id: target.dependency_bundle.bundle_id,
      bundle_digest: target.dependency_bundle.bundle_digest,
      lockfile_digest: target.dependency_bundle.lockfile_digest,
      cache_strategy: target.dependency_bundle.cache.strategy,
      content_address: target.dependency_bundle.cache.content_address,
      artifact_path: target.artifact_path,
      entrypoint_path: target.entrypoint,
      files,
      dependencies: target.dependency_bundle.dependencies,
      promoted_at: this.clock().toISOString(),
    });
  }

  private async readAndVerifyPackageFile(packageRoot: string, packagePath: string, expectedSize: number, expectedDigest: string): Promise<`sha256:${string}`> {
    const target = this.resolveInside(packageRoot, packagePath);
    let bytes;
    try {
      bytes = await readFile(target);
    } catch {
      throw new ContractViolation("package_file_mismatch", "Required sidecar package asset is missing");
    }
    const actualDigest = digest(bytes);
    if (bytes.byteLength !== expectedSize || actualDigest !== expectedDigest) {
      throw new ContractViolation("package_digest_mismatch", "Required sidecar package asset digest does not match verified inventory");
    }
    return actualDigest;
  }

  private async copyBundleFiles(packageRoot: string, contentRoot: string, metadata: z.infer<typeof StoredBundleMetadataSchema>): Promise<void> {
    const temporaryRoot = `${contentRoot}.tmp-${randomUUID()}`;
    try {
      await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
      for (const file of metadata.files) {
        const source = this.resolveInside(packageRoot, file.path);
        const destination = this.resolveInside(temporaryRoot, file.path);
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        await copyFile(source, destination);
      }
      await this.hooks.afterCopyBeforePromotion?.({ temporaryRoot });
      await this.assertStoredBundle(this.createReference(metadata), metadata, temporaryRoot);
      await rename(temporaryRoot, contentRoot);
      await syncDirectoryEntry(path.dirname(contentRoot));
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const reference = this.createReference(metadata);
        await this.assertStoredBundle(reference, metadata, contentRoot);
        return;
      }
      throw error;
    }
  }

  private async assertStoredBundle(reference: SidecarBundleReference, metadata: z.infer<typeof StoredBundleMetadataSchema>, contentRoot: string): Promise<void> {
    const observed: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(target);
        else if (entry.isFile()) observed.push(path.relative(contentRoot, target).split(path.sep).join("/"));
        else throw new ContractViolation("package_unsafe_link", "Sidecar bundle contains non-file content");
      }
    };
    await visit(contentRoot).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw new ContractViolation("package_file_mismatch", "Referenced sidecar bundle is not staged");
      throw error;
    });
    const expected = new Map(metadata.files.map((file) => [file.path, file]));
    if (observed.length !== expected.size || observed.some((relative) => !expected.has(relative))) {
      throw new ContractViolation("package_file_mismatch", "Sidecar bundle inventory changed after staging");
    }
    for (const [relative, file] of expected) {
      const bytes = await readFile(this.resolveInside(contentRoot, relative));
      if (bytes.byteLength !== file.size_bytes || digest(bytes) !== file.digest) {
        throw new ContractViolation("package_file_mismatch", "Sidecar bundle bytes changed after staging");
      }
    }
    if (
      metadata.package_digest !== reference.package_digest
      || metadata.bundle_digest !== reference.bundle_digest
      || metadata.lockfile_digest !== reference.lockfile_digest
    ) {
      throw new ContractViolation("package_file_mismatch", "Sidecar bundle metadata changed after staging");
    }
  }

  private createReference(metadata: z.infer<typeof StoredBundleMetadataSchema>, referenceId: string = randomUUID()): SidecarBundleReference {
    return SidecarBundleReferenceSchema.parse({
      reference_version: 1,
      bundle_reference_id: referenceId,
      package_id: metadata.package_id,
      publisher_id: metadata.publisher_id,
      package_version: metadata.package_version,
      package_digest: metadata.package_digest,
      component_id: metadata.component_id,
      target: metadata.target,
      runtime_kind: "packaged_process",
      bundle_id: metadata.bundle_id,
      bundle_digest: metadata.bundle_digest,
      lockfile_digest: metadata.lockfile_digest,
      cache_strategy: metadata.cache_strategy,
      content_address: metadata.content_address,
      dependencies: metadata.dependencies,
    });
  }

  private contentRootFor(metadata: z.infer<typeof StoredBundleMetadataSchema>): string {
    const digestSegments = [metadata.package_digest, metadata.bundle_digest, metadata.lockfile_digest].map((value) => value.slice(7));
    if (metadata.cache_strategy === "content_addressed_immutable") {
      const contentAddress = metadata.content_address;
      if (!contentAddress) throw new ContractViolation("package_descriptor_invalid", "Content-addressed sidecar cache requires a digest address");
      return path.join(this.layout.cache, contentAddress.slice(7), metadata.lockfile_digest.slice(7));
    }
    return path.join(this.layout.packages, digestSegments[0], metadata.component_id, metadata.target, digestSegments[1], digestSegments[2]);
  }

  private metadataPathFor(reference: SidecarBundleReference): string {
    return path.join(
      this.layout.metadata,
      reference.package_digest.slice(7),
      reference.component_id,
      reference.target,
      `${reference.bundle_digest.slice(7)}-${reference.lockfile_digest.slice(7)}.json`,
    );
  }

  private async writeMetadataIfAbsent(metadataPath: string, metadata: z.infer<typeof StoredBundleMetadataSchema>): Promise<void> {
    try {
      const existing = StoredBundleMetadataSchema.parse(JSON.parse(await readFile(metadataPath, "utf8")));
      if (canonicalJson({ ...existing, promoted_at: metadata.promoted_at }) !== canonicalJson(metadata)) {
        throw new ContractViolation("package_file_mismatch", "Sidecar bundle metadata conflicts with existing content");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeAtomic(metadataPath, metadata, 0o400);
    }
  }

  private resolveInside(root: string, relative: string): string {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(root, ...relative.split("/"));
    if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new ContractViolation("package_path_invalid", "Sidecar bundle path escaped its authority root");
    }
    return resolved;
  }

  private async sealTree(root: string, executablePaths: ReadonlySet<string>): Promise<void> {
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(target);
          await chmod(target, 0o555);
        } else if (entry.isFile()) {
          const relative = path.relative(root, target).split(path.sep).join("/");
          await chmod(target, executablePaths.has(relative) ? 0o555 : 0o444);
        } else {
          throw new ContractViolation("package_unsafe_link", "Sidecar bundle contains non-file content");
        }
      }
    };
    await visit(root);
    await chmod(root, 0o555);
  }
}

async function writeAtomic(targetPath: string, value: unknown, mode = 0o600): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const temporary = `${targetPath}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx", mode);
  try {
    await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, targetPath);
    await syncDirectoryEntry(path.dirname(targetPath));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function digest(bytes: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
