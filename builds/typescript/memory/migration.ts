import { spawn } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { auditLog } from "../logger.js";
import { resolveSecretsPaths, type SecretsPaths, writePrivateFile } from "../secrets/paths.js";

const MIGRATION_SCHEMA_VERSION = 1 as const;
const MIGRATION_MANIFEST_NAME = "migration-manifest.json";
const MIGRATION_MEMORY_DIR = "memory";
const MIGRATION_SECRETS_DIR = "secrets";
const MIGRATION_VAULT_FILE = "vault.json";
const MIGRATION_MASTER_KEY_FILE = "master-key.json";

type MigrationManifest = {
  schema_version: 1;
  scope: "library-migration";
  exported_at: string;
  includes: {
    memory: true;
    secrets: {
      vault: boolean;
      master_key: boolean;
    };
  };
};

export type MigrationExportResult = {
  archive_path: string;
  file_name: string;
  schema_version: 1;
  includes: MigrationManifest["includes"];
};

export type MigrationImportResult = {
  imported_at: string;
  schema_version: 1;
  source_format: "migration-v1" | "legacy-memory-export";
  restored: {
    memory: true;
    secrets: boolean;
  };
  warnings: string[];
};

type ImportLayout =
  | {
      sourceFormat: "migration-v1";
      memoryRoot: string;
      secretsRoot: string | null;
    }
  | {
      sourceFormat: "legacy-memory-export";
      memoryRoot: string;
      secretsRoot: null;
    };

type SecretSnapshot = {
  path: string;
  content: string | null;
};

export async function exportMigrationArchive(
  memoryRoot: string,
  options: {
    secretsPaths?: SecretsPaths;
  } = {}
): Promise<MigrationExportResult> {
  const fileName = `memory-migration-${Date.now()}.tar.gz`;
  const destination = path.join(memoryRoot, "exports", fileName);
  const secretsPaths = options.secretsPaths ?? resolveSecretsPaths();
  const workspace = await mkdtemp(path.join(tmpdir(), "paa-migration-export-"));
  const payloadRoot = path.join(workspace, "payload");
  const payloadMemoryRoot = path.join(payloadRoot, MIGRATION_MEMORY_DIR);
  const payloadSecretsRoot = path.join(payloadRoot, MIGRATION_SECRETS_DIR);
  const payloadVaultPath = path.join(payloadSecretsRoot, MIGRATION_VAULT_FILE);
  const payloadMasterKeyPath = path.join(payloadSecretsRoot, MIGRATION_MASTER_KEY_FILE);

  try {
    await cp(memoryRoot, payloadMemoryRoot, { recursive: true, force: true });
    await mkdir(payloadSecretsRoot, { recursive: true });

    const copiedVault = await copyIfPresent(secretsPaths.vaultPath, payloadVaultPath);
    const copiedMasterKey = await copyIfPresent(secretsPaths.keyPath, payloadMasterKeyPath);
    const manifest: MigrationManifest = {
      schema_version: MIGRATION_SCHEMA_VERSION,
      scope: "library-migration",
      exported_at: new Date().toISOString(),
      includes: {
        memory: true,
        secrets: {
          vault: copiedVault,
          master_key: copiedMasterKey,
        },
      },
    };
    await writePrivateFile(
      path.join(payloadRoot, MIGRATION_MANIFEST_NAME),
      `${JSON.stringify(manifest, null, 2)}\n`
    );

    await mkdir(path.dirname(destination), { recursive: true });
    await createTarArchive(payloadRoot, destination);
    await setPrivateFileMode(destination);

    const result: MigrationExportResult = {
      archive_path: destination,
      file_name: fileName,
      schema_version: MIGRATION_SCHEMA_VERSION,
      includes: manifest.includes,
    };
    auditLog("migration.export", {
      archive_path: result.archive_path,
      file_name: result.file_name,
      schema_version: result.schema_version,
      includes: result.includes,
    });
    return result;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function importMigrationArchive(
  archivePath: string,
  options: {
    memoryRoot: string;
    secretsPaths?: SecretsPaths;
  }
): Promise<MigrationImportResult> {
  const workspace = await mkdtemp(path.join(tmpdir(), "paa-migration-import-"));
  const extractedRoot = path.join(workspace, "payload");
  const rollbackMemoryRoot = path.join(workspace, "rollback-memory");
  const rollbackSecretsRoot = path.join(workspace, "rollback-secrets");
  const stagedMemoryRoot = path.join(workspace, "staged-memory");
  const warnings: string[] = [];
  const secretsPaths = options.secretsPaths ?? resolveSecretsPaths();

  try {
    await mkdir(extractedRoot, { recursive: true });
    await extractTarArchive(archivePath, extractedRoot);

    const layout = await resolveImportLayout(extractedRoot);
    await cp(layout.memoryRoot, stagedMemoryRoot, { recursive: true, force: true });
    await mkdir(options.memoryRoot, { recursive: true });
    await cp(options.memoryRoot, rollbackMemoryRoot, { recursive: true, force: true });

    await mkdir(rollbackSecretsRoot, { recursive: true });
    const rollbackVault = await snapshotSecretFile(
      secretsPaths.vaultPath,
      path.join(rollbackSecretsRoot, MIGRATION_VAULT_FILE)
    );
    const rollbackMasterKey = await snapshotSecretFile(
      secretsPaths.keyPath,
      path.join(rollbackSecretsRoot, MIGRATION_MASTER_KEY_FILE)
    );

    try {
      await replaceDirectoryContents(options.memoryRoot, stagedMemoryRoot);
      let restoredSecrets = false;

      if (layout.secretsRoot) {
        restoredSecrets = await restoreSecretsFromArchive(layout.secretsRoot, secretsPaths);
        if (!restoredSecrets) {
          warnings.push("Migration archive did not include vault/master-key files.");
        }
      } else {
        warnings.push("Imported from legacy memory export; secrets were not included.");
      }

      const result: MigrationImportResult = {
        imported_at: new Date().toISOString(),
        schema_version: MIGRATION_SCHEMA_VERSION,
        source_format: layout.sourceFormat,
        restored: {
          memory: true,
          secrets: restoredSecrets,
        },
        warnings,
      };

      auditLog("migration.import", {
        archive_path: archivePath,
        source_format: result.source_format,
        restored: result.restored,
        warnings_count: result.warnings.length,
      });
      return result;
    } catch (error) {
      await replaceDirectoryContents(options.memoryRoot, rollbackMemoryRoot);
      await restoreSecretSnapshot(rollbackVault);
      await restoreSecretSnapshot(rollbackMasterKey);
      throw error;
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function resolveImportLayout(extractedRoot: string): Promise<ImportLayout> {
  const manifestPath = path.join(extractedRoot, MIGRATION_MANIFEST_NAME);
  const migrationMemoryRoot = path.join(extractedRoot, MIGRATION_MEMORY_DIR);
  const migrationSecretsRoot = path.join(extractedRoot, MIGRATION_SECRETS_DIR);
  const hasManifest = await pathExists(manifestPath);
  const hasMigrationMemory = await isDirectory(migrationMemoryRoot);

  if (hasManifest && hasMigrationMemory) {
    return {
      sourceFormat: "migration-v1",
      memoryRoot: migrationMemoryRoot,
      secretsRoot: (await isDirectory(migrationSecretsRoot)) ? migrationSecretsRoot : null,
    };
  }

  if (await looksLikeMemoryRoot(extractedRoot)) {
    return {
      sourceFormat: "legacy-memory-export",
      memoryRoot: extractedRoot,
      secretsRoot: null,
    };
  }

  const nestedMemoryRoot = await resolveNestedMemoryRoot(extractedRoot);
  if (nestedMemoryRoot) {
    return {
      sourceFormat: "legacy-memory-export",
      memoryRoot: nestedMemoryRoot,
      secretsRoot: null,
    };
  }

  throw new Error("Invalid migration archive: memory payload not found");
}

async function resolveNestedMemoryRoot(extractedRoot: string): Promise<string | null> {
  const entries = await readdir(extractedRoot, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length !== 1) {
    return null;
  }

  const candidate = path.join(extractedRoot, directories[0]!.name);
  return (await looksLikeMemoryRoot(candidate)) ? candidate : null;
}

async function looksLikeMemoryRoot(targetPath: string): Promise<boolean> {
  const requiredDirectories = ["conversations", "documents", "preferences"];
  for (const directory of requiredDirectories) {
    if (!(await isDirectory(path.join(targetPath, directory)))) {
      return false;
    }
  }
  return true;
}

async function replaceDirectoryContents(destinationRoot: string, sourceRoot: string): Promise<void> {
  await mkdir(destinationRoot, { recursive: true });
  const existingEntries = await readdir(destinationRoot, { withFileTypes: true });
  await Promise.all(
    existingEntries.map((entry) =>
      rm(path.join(destinationRoot, entry.name), { recursive: true, force: true })
    )
  );

  const sourceEntries = await readdir(sourceRoot, { withFileTypes: true });
  await Promise.all(
    sourceEntries.map((entry) =>
      cp(path.join(sourceRoot, entry.name), path.join(destinationRoot, entry.name), {
        recursive: true,
        force: true,
      })
    )
  );
}

async function snapshotSecretFile(sourcePath: string, snapshotPath: string): Promise<SecretSnapshot> {
  const content = await readTextIfExists(sourcePath);
  if (content !== null) {
    await writePrivateFile(snapshotPath, content);
  }
  return {
    path: sourcePath,
    content,
  };
}

async function restoreSecretSnapshot(snapshot: SecretSnapshot): Promise<void> {
  if (snapshot.content === null) {
    await rm(snapshot.path, { force: true });
    return;
  }

  await writePrivateFile(snapshot.path, snapshot.content);
}

async function restoreSecretsFromArchive(
  secretsRoot: string,
  secretsPaths: SecretsPaths
): Promise<boolean> {
  const vaultSource = path.join(secretsRoot, MIGRATION_VAULT_FILE);
  const keySource = path.join(secretsRoot, MIGRATION_MASTER_KEY_FILE);

  const vaultContent = await readTextIfExists(vaultSource);
  const keyContent = await readTextIfExists(keySource);

  if (vaultContent === null && keyContent === null) {
    return false;
  }

  if (vaultContent !== null) {
    await writePrivateFile(secretsPaths.vaultPath, vaultContent);
  }

  if (keyContent !== null) {
    await writePrivateFile(secretsPaths.keyPath, keyContent);
  }

  return true;
}

async function copyIfPresent(sourcePath: string, destinationPath: string): Promise<boolean> {
  if (!(await pathExists(sourcePath))) {
    return false;
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { force: true, recursive: false });
  await setPrivateFileMode(destinationPath);
  return true;
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const details = await stat(targetPath);
    return details.isDirectory();
  } catch {
    return false;
  }
}

async function createTarArchive(sourceRoot: string, destinationPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-czf", destinationPath, "."], { cwd: sourceRoot });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `tar failed with ${code}`));
    });
  });
}

async function extractTarArchive(archivePath: string, destinationRoot: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-xzf", archivePath, "-C", destinationRoot], { cwd: destinationRoot });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `tar failed with ${code}`));
    });
  });
}

async function setPrivateFileMode(filePath: string): Promise<void> {
  try {
    await chmod(filePath, 0o600);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTSUP" || code === "ENOSYS" || code === "EPERM") {
      return;
    }
    throw error;
  }
}
