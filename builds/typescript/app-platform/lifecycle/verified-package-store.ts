import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { canonicalJson, canonicalJsonDocumentDigest, OpaqueIdSchema, Sha256DigestSchema, TimestampSchema } from "../contracts/common.js";
import { ContractViolation } from "../contracts/errors.js";
import { CanonicalAppIdSchema, CanonicalPublisherIdSchema, GenericPackageManifestSchema } from "../contracts/app-registry.js";
import { PackageManifestSchema } from "../contracts/package.js";
import { syncDirectoryEntry } from "./filesystem-durability.js";
import type { RuntimePackageManifest } from "./package-verifier.js";

export type PromotableVerifiedPackage = {
  manifest: RuntimePackageManifest;
  packageDigest: `sha256:${string}`;
  descriptorDigest: `sha256:${string}`;
  stageRoot: string;
  entrypoint: string;
  target: "docker_linux_x64" | "desktop_windows_x64";
};

const StoreMetadataSchema = z.object({
  package_store_version: z.literal(1),
  package_digest: Sha256DigestSchema,
  descriptor_digest: Sha256DigestSchema,
  manifest_digest: Sha256DigestSchema,
  manifest_path: z.string(),
  package_version: z.string(),
  app_id: CanonicalAppIdSchema,
  publisher_id: CanonicalPublisherIdSchema,
  entrypoint: z.string(),
  target: z.enum(["docker_linux_x64", "desktop_windows_x64"]),
  promoted_at: TimestampSchema,
}).strict();

const ReferenceSetSchema = z.object({
  package_reference_set_version: z.literal(1),
  package_digest: Sha256DigestSchema,
  reference_ids: z.array(OpaqueIdSchema),
  updated_at: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (new Set(value.reference_ids).size !== value.reference_ids.length) {
    context.addIssue({ code: "custom", message: "duplicate package reference" });
  }
});

export type ImmutablePackageRecord = {
  packageDigest: `sha256:${string}`;
  packageVersion: string;
  contentRoot: string;
  entrypoint: string;
  target: "docker_linux_x64" | "desktop_windows_x64";
  referenceCount: number;
};

export type ImmutablePackageStoreHooks = {
  beforePromotion?(): Promise<void> | void;
};

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
  await rename(temporary, targetPath);
  await syncDirectoryEntry(path.dirname(targetPath));
}

async function chmodTree(root: string, executablePaths: ReadonlySet<string>): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
        await chmod(target, 0o555);
      } else if (entry.isFile()) {
        const relative = path.relative(root, target).split(path.sep).join("/");
        await chmod(target, executablePaths.has(relative) ? 0o555 : 0o444);
      } else {
        throw new ContractViolation("package_unsafe_link", "Immutable package contains a non-file entry");
      }
    }
  };
  await visit(root);
  await chmod(root, 0o555);
}

async function makeTreeRemovable(root: string): Promise<void> {
  await chmod(root, 0o700);
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await chmod(target, 0o700);
        await visit(target);
      } else if (entry.isFile()) {
        await chmod(target, 0o600);
      } else {
        throw new ContractViolation("package_unsafe_link", "Immutable package contains a non-file entry");
      }
    }
  };
  await visit(root);
}

export class ImmutablePackageStore {
  readonly layout: { packages: string; metadata: string; references: string; referenceLocks: string };

  constructor(
    private readonly root: string,
    private readonly clock: () => Date = () => new Date(),
    private readonly hooks: ImmutablePackageStoreHooks = {},
  ) {
    this.layout = {
      packages: path.join(root, "host-app-packages"),
      metadata: path.join(root, "host-app-state", "package-metadata"),
      references: path.join(root, "host-app-state", "package-references"),
      referenceLocks: path.join(root, "host-app-state", "package-reference-locks"),
    };
  }

  async initialize(): Promise<void> {
    await Promise.all(Object.values(this.layout).map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })));
  }

  async promote(verified: PromotableVerifiedPackage): Promise<ImmutablePackageRecord> {
    await this.initialize();
    const key = verified.packageDigest.slice(7);
    const contentRoot = path.join(this.layout.packages, key);
    const metadataPath = path.join(this.layout.metadata, `${key}.json`);
    const metadata = StoreMetadataSchema.parse({
      package_store_version: 1,
      package_digest: verified.packageDigest,
      descriptor_digest: verified.descriptorDigest,
      manifest_digest: canonicalJsonDocumentDigest(verified.manifest),
      manifest_path: verified.manifest.archive.manifest_path,
      package_version: verified.manifest.package_version,
      app_id: verified.manifest.app_id,
      publisher_id: verified.manifest.publisher_id,
      entrypoint: verified.entrypoint,
      target: verified.target,
      promoted_at: this.clock().toISOString(),
    });
    let renamed = false;
    let promotionStep = "pre_promotion";
    try {
      await this.hooks.beforePromotion?.();
      promotionStep = "publish_content";
      await rename(verified.stageRoot, contentRoot);
      renamed = true;
      const executablePaths = new Set(verified.manifest.files.filter((file) => file.mode === "executable").map((file) => file.path));
      promotionStep = "seal_content";
      await chmodTree(contentRoot, executablePaths);
      promotionStep = "publish_metadata";
      await writeAtomic(metadataPath, metadata, 0o400);
    } catch {
      if (renamed) {
        await makeTreeRemovable(contentRoot).catch(() => undefined);
        await rm(contentRoot, { recursive: true, force: true }).catch(() => undefined);
        throw new ContractViolation("recoverable_internal_failure", `Verified package promotion failed safely during ${promotionStep}`);
      }
      let existing: z.infer<typeof StoreMetadataSchema>;
      try {
        const existingContent = await stat(contentRoot);
        if (!existingContent.isDirectory()) throw new Error("Existing immutable content is not a directory");
        existing = StoreMetadataSchema.parse(JSON.parse(await readFile(metadataPath, "utf8")));
      } catch {
        await rm(verified.stageRoot, { recursive: true, force: true }).catch(() => undefined);
        throw new ContractViolation("recoverable_internal_failure", `Verified package promotion failed safely during ${promotionStep}`);
      }
      if (
        existing.package_digest !== verified.packageDigest
        || existing.descriptor_digest !== verified.descriptorDigest
        || existing.manifest_digest !== canonicalJsonDocumentDigest(verified.manifest)
        || existing.entrypoint !== verified.entrypoint
      ) {
        await rm(verified.stageRoot, { recursive: true, force: true }).catch(() => undefined);
        throw new ContractViolation("recoverable_internal_failure", "Immutable package metadata conflicts with existing content");
      }
      try {
        await this.assertStoredIntegrity(verified);
      } catch (integrityError) {
        await rm(verified.stageRoot, { recursive: true, force: true }).catch(() => undefined);
        throw integrityError;
      }
      await rm(verified.stageRoot, { recursive: true, force: true });
    }
    return this.read(verified.packageDigest);
  }

  async acquire(packageDigest: string, referenceId: string): Promise<ImmutablePackageRecord> {
    Sha256DigestSchema.parse(packageDigest);
    OpaqueIdSchema.parse(referenceId);
    return this.withReferenceLock(packageDigest, async () => {
      const record = await this.read(packageDigest);
      const references = await this.readReferences(packageDigest);
      if (!references.reference_ids.includes(referenceId)) references.reference_ids.push(referenceId);
      references.reference_ids.sort();
      references.updated_at = this.clock().toISOString();
      await writeAtomic(this.referencePath(packageDigest), ReferenceSetSchema.parse(references));
      return { ...record, referenceCount: references.reference_ids.length };
    });
  }

  async release(packageDigest: string, referenceId: string): Promise<ImmutablePackageRecord> {
    Sha256DigestSchema.parse(packageDigest);
    OpaqueIdSchema.parse(referenceId);
    return this.withReferenceLock(packageDigest, async () => {
      const record = await this.read(packageDigest);
      const references = await this.readReferences(packageDigest);
      references.reference_ids = references.reference_ids.filter((candidate) => candidate !== referenceId);
      references.updated_at = this.clock().toISOString();
      await writeAtomic(this.referencePath(packageDigest), ReferenceSetSchema.parse(references));
      return { ...record, referenceCount: references.reference_ids.length };
    });
  }

  async removeIfUnreferenced(packageDigest: string): Promise<boolean> {
    Sha256DigestSchema.parse(packageDigest);
    return this.withReferenceLock(packageDigest, async () => {
      const record = await this.read(packageDigest);
      const references = await this.readReferences(packageDigest);
      if (references.reference_ids.length > 0) return false;
      const key = packageDigest.slice(7);
      const contentRoot = path.resolve(record.contentRoot);
      const packagesRoot = path.resolve(this.layout.packages);
      if (!contentRoot.startsWith(`${packagesRoot}${path.sep}`) || path.dirname(contentRoot) !== packagesRoot) {
        throw new ContractViolation("package_path_invalid", "Immutable package cleanup escaped its authority root");
      }
      await makeTreeRemovable(contentRoot);
      await rm(contentRoot, { recursive: true, force: true });
      await Promise.all([
        chmod(path.join(this.layout.metadata, `${key}.json`), 0o600).catch(() => undefined),
        chmod(this.referencePath(packageDigest), 0o600).catch(() => undefined),
      ]);
      await Promise.all([
        rm(path.join(this.layout.metadata, `${key}.json`), { force: true }),
        rm(this.referencePath(packageDigest), { force: true }),
      ]);
      return true;
    });
  }

  async read(packageDigest: string): Promise<ImmutablePackageRecord> {
    Sha256DigestSchema.parse(packageDigest);
    const key = packageDigest.slice(7);
    const metadata = StoreMetadataSchema.parse(JSON.parse(await readFile(path.join(this.layout.metadata, `${key}.json`), "utf8")));
    const contentRoot = path.join(this.layout.packages, key);
    const info = await stat(contentRoot);
    if (!info.isDirectory()) throw new ContractViolation("recoverable_internal_failure", "Immutable package content is missing");
    const references = await this.readReferences(packageDigest);
    return {
      packageDigest: metadata.package_digest as `sha256:${string}`,
      packageVersion: metadata.package_version,
      contentRoot,
      entrypoint: metadata.entrypoint,
      target: metadata.target,
      referenceCount: references.reference_ids.length,
    };
  }

  async resolveReferencedRuntime(packageDigest: string, referenceId: string): Promise<ImmutablePackageRecord> {
    Sha256DigestSchema.parse(packageDigest);
    OpaqueIdSchema.parse(referenceId);
    const record = await this.read(packageDigest);
    const references = await this.readReferences(packageDigest);
    if (!references.reference_ids.includes(referenceId)) {
      throw new ContractViolation("conflict", "Runtime package reference is not live");
    }
    await this.assertRuntimeContent(record);
    return record;
  }

  /** Rechecks promoted bytes against freshly verified signed inventory before re-enable. */
  async assertStoredIntegrity(verified: PromotableVerifiedPackage): Promise<ImmutablePackageRecord> {
    const record = await this.read(verified.packageDigest);
    if (
      record.packageVersion !== verified.manifest.package_version
      || record.entrypoint !== verified.entrypoint
    ) {
      throw new ContractViolation("package_file_mismatch", "Immutable package metadata differs from verified authority");
    }
    const expected = new Map(verified.manifest.files.map((file) => [file.path, file]));
    expected.set(verified.manifest.archive.manifest_path, {
      path: verified.manifest.archive.manifest_path,
      kind: "file",
      mode: "read_only",
      digest: `sha256:${createHash("sha256").update(`${canonicalJson(verified.manifest)}\n`).digest("hex")}`,
      size_bytes: Buffer.byteLength(`${canonicalJson(verified.manifest)}\n`),
    });
    const observed: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(target);
        else if (entry.isFile()) observed.push(path.relative(record.contentRoot, target).split(path.sep).join("/"));
        else throw new ContractViolation("package_unsafe_link", "Immutable package contains non-file content");
      }
    };
    await visit(record.contentRoot);
    if (observed.length !== expected.size || observed.some((relative) => !expected.has(relative))) {
      throw new ContractViolation("package_file_mismatch", "Immutable package inventory changed after verification");
    }
    for (const [relative, file] of expected) {
      const target = path.resolve(record.contentRoot, ...relative.split("/"));
      if (!target.startsWith(`${path.resolve(record.contentRoot)}${path.sep}`)) {
        throw new ContractViolation("package_path_invalid", "Immutable package path escaped its root");
      }
      const bytes = await readFile(target);
      const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (bytes.byteLength !== file.size_bytes || digest !== file.digest) {
        throw new ContractViolation("package_file_mismatch", "Immutable package bytes changed after verification");
      }
    }
    return record;
  }

  private referencePath(packageDigest: string): string {
    return path.join(this.layout.references, `${packageDigest.slice(7)}.json`);
  }

  private async assertRuntimeContent(record: ImmutablePackageRecord): Promise<void> {
    const metadata = StoreMetadataSchema.parse(JSON.parse(await readFile(path.join(this.layout.metadata, `${record.packageDigest.slice(7)}.json`), "utf8")));
    const manifestPath = path.resolve(record.contentRoot, ...metadata.manifest_path.split("/"));
    if (!manifestPath.startsWith(`${path.resolve(record.contentRoot)}${path.sep}`)) {
      throw new ContractViolation("package_path_invalid", "Stored manifest escaped immutable package authority");
    }
    const manifestBytes = await readFile(manifestPath);
    let manifestCandidate: unknown;
    try { manifestCandidate = JSON.parse(manifestBytes.toString("utf8")); }
    catch { throw new ContractViolation("package_file_mismatch", "Stored package manifest is malformed"); }
    const manifest = manifestCandidate && typeof manifestCandidate === "object" && (manifestCandidate as { manifest_version?: unknown }).manifest_version === 2
      ? GenericPackageManifestSchema.safeParse(manifestCandidate)
      : PackageManifestSchema.safeParse(manifestCandidate);
    if (
      !manifest.success
      || canonicalJsonDocumentDigest(manifest.data) !== metadata.manifest_digest
      || manifest.data.package_version !== metadata.package_version
      || manifest.data.platform_artifacts.find((artifact) => artifact.target === metadata.target)?.entrypoint !== metadata.entrypoint
    ) {
      throw new ContractViolation("package_file_mismatch", "Stored package manifest differs from promoted authority");
    }
    const expected = new Map(manifest.data.files.map((file) => [file.path, file]));
    const observed: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(target);
        else if (entry.isFile()) observed.push(path.relative(record.contentRoot, target).split(path.sep).join("/"));
        else throw new ContractViolation("package_unsafe_link", "Immutable package contains non-file content");
      }
    };
    await visit(record.contentRoot);
    if (
      observed.length !== expected.size + 1
      || !observed.includes(metadata.manifest_path)
      || observed.some((relative) => relative !== metadata.manifest_path && !expected.has(relative))
    ) {
      throw new ContractViolation("package_file_mismatch", "Stored package inventory changed after promotion");
    }
    for (const [relative, file] of expected) {
      const bytes = await readFile(path.resolve(record.contentRoot, ...relative.split("/")));
      if (bytes.byteLength !== file.size_bytes || `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== file.digest) {
        throw new ContractViolation("package_file_mismatch", "Stored package bytes changed after promotion");
      }
    }
  }

  private async readReferences(packageDigest: string): Promise<z.infer<typeof ReferenceSetSchema>> {
    try {
      return ReferenceSetSchema.parse(JSON.parse(await readFile(this.referencePath(packageDigest), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return ReferenceSetSchema.parse({
        package_reference_set_version: 1,
        package_digest: packageDigest,
        reference_ids: [],
        updated_at: this.clock().toISOString(),
      });
    }
  }

  private async withReferenceLock<T>(packageDigest: string, action: () => Promise<T>): Promise<T> {
    await mkdir(this.layout.referenceLocks, { recursive: true, mode: 0o700 });
    const owner = randomUUID();
    const lockPath = path.join(this.layout.referenceLocks, `${packageDigest.slice(7)}.lock`);
    let acquired = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const handle = await open(lockPath, "wx", 0o600);
        try {
          await handle.writeFile(`${owner}\n`, "utf8");
          await handle.sync();
        } finally { await handle.close(); }
        acquired = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const lockInfo = await stat(lockPath).catch(() => null);
        if (lockInfo && Date.now() - lockInfo.mtimeMs > 30_000) {
          await rename(lockPath, path.join(this.layout.referenceLocks, `stale-${packageDigest.slice(7)}-${randomUUID()}.lock`)).catch(() => undefined);
          continue;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
    }
    if (!acquired) throw new ContractViolation("conflict", "Package reference mutation lock did not converge");
    try {
      return await action();
    } finally {
      const currentOwner = await readFile(lockPath, "utf8").catch(() => "");
      if (currentOwner.trim() === owner) await rm(lockPath, { force: true });
    }
  }
}
