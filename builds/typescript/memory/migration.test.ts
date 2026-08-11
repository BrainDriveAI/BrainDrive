import path from "node:path";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { exportMemoryArchive } from "../git.js";
import { ResumeDomainService } from "../resume-domain/service.js";
import { ResumeDataStore } from "../resume-domain/store.js";
import { authority, proposalInput, testGrant } from "../resume-domain/test-helpers.js";
import { exportMigrationArchive, importMigrationArchive } from "./migration.js";

const execFileAsync = promisify(execFile);

async function writeFixtureMemory(memoryRoot: string, marker: string): Promise<void> {
  await mkdir(path.join(memoryRoot, "conversations"), { recursive: true });
  await mkdir(path.join(memoryRoot, "documents"), { recursive: true });
  await mkdir(path.join(memoryRoot, "preferences"), { recursive: true });
  await writeFile(path.join(memoryRoot, "AGENT.md"), `# ${marker}\n`, "utf8");
  await writeFile(path.join(memoryRoot, "preferences", "default.json"), `{"default_model":"${marker}"}\n`, "utf8");
  await writeFile(path.join(memoryRoot, "documents", "projects.json"), "[]\n", "utf8");
}

describe("memory migration archive", () => {
  it("preserves and revalidates the complete Resume Builder namespace inventory", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "paa-migration-resume-data-test-"));
    const sourceMemory = path.join(tempRoot, "source-memory");
    const targetMemory = path.join(tempRoot, "target-memory");
    const sourceSecrets = path.join(tempRoot, "source-secrets");
    const targetSecrets = path.join(tempRoot, "target-secrets");
    try {
      await writeFixtureMemory(sourceMemory, "source-model");
      await writeFixtureMemory(targetMemory, "target-model");
      const sourceStore = new ResumeDataStore(sourceMemory, undefined, {}, false);
      await sourceStore.initialize(testGrant().owner_id);
      const proposed = await new ResumeDomainService(sourceStore).proposeFact(
        proposalInput("Migration archive durable fact"),
        authority("career.facts.propose"),
      );
      const sourceInventory = await sourceStore.integrityScan();
      const exported = await exportMigrationArchive(sourceMemory, {
        secretsPaths: { homeDir: sourceSecrets, vaultPath: path.join(sourceSecrets, "vault.json"), keyPath: path.join(sourceSecrets, "master-key.json") },
      });

      await importMigrationArchive(exported.archive_path, {
        memoryRoot: targetMemory,
        secretsPaths: { homeDir: targetSecrets, vaultPath: path.join(targetSecrets, "vault.json"), keyPath: path.join(targetSecrets, "master-key.json") },
      });
      const restoredStore = new ResumeDataStore(targetMemory, undefined, {}, false);
      await restoredStore.initialize(testGrant().owner_id);
      expect(await restoredStore.integrityScan()).toMatchObject({
        revision_count: sourceInventory.revision_count,
        operation_count: sourceInventory.operation_count,
        orphan_revision_count: 0,
        staged_transaction_count: 0,
      });
      expect((await restoredStore.readHead(proposed.fact.metadata.record_id)).metadata.revision_id)
        .toBe(proposed.fact.metadata.revision_id);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects an incompatible staged Resume Builder graph before replacing current memory", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "paa-migration-resume-invalid-test-"));
    const sourceMemory = path.join(tempRoot, "source-memory");
    const targetMemory = path.join(tempRoot, "target-memory");
    const archivePath = path.join(tempRoot, "incompatible-memory.tar.gz");
    try {
      await writeFixtureMemory(sourceMemory, "source-model");
      await writeFixtureMemory(targetMemory, "target-model");
      await writeFile(path.join(targetMemory, "documents", "owner-marker.md"), "preserve me\n", "utf8");
      const namespace = path.join(sourceMemory, "apps", "resume-builder");
      await mkdir(namespace, { recursive: true });
      await writeFile(path.join(namespace, "catalog.json"), `${JSON.stringify({
        catalog_version: 2,
        data_schema_version: 3,
        owner_id: testGrant().owner_id,
      })}\n`, "utf8");
      await exportMemoryArchive(sourceMemory, archivePath);

      await expect(importMigrationArchive(archivePath, { memoryRoot: targetMemory })).rejects.toMatchObject({
        code: "incompatible_schema",
      });
      expect(await readFile(path.join(targetMemory, "documents", "owner-marker.md"), "utf8")).toBe("preserve me\n");
      expect(await readFile(path.join(targetMemory, "preferences", "default.json"), "utf8")).toContain("target-model");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("exports and imports memory plus secrets", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "paa-migration-test-"));
    const sourceMemory = path.join(tempRoot, "source-memory");
    const targetMemory = path.join(tempRoot, "target-memory");
    const sourceSecrets = path.join(tempRoot, "source-secrets");
    const targetSecrets = path.join(tempRoot, "target-secrets");
    const sourceSecretsPaths = {
      homeDir: sourceSecrets,
      vaultPath: path.join(sourceSecrets, "vault.json"),
      keyPath: path.join(sourceSecrets, "master-key.json"),
    };
    const targetSecretsPaths = {
      homeDir: targetSecrets,
      vaultPath: path.join(targetSecrets, "vault.json"),
      keyPath: path.join(targetSecrets, "master-key.json"),
    };

    try {
      await writeFixtureMemory(sourceMemory, "source-model");
      await writeFixtureMemory(targetMemory, "target-model");
      await mkdir(sourceSecrets, { recursive: true });
      await mkdir(targetSecrets, { recursive: true });
      await writeFile(sourceSecretsPaths.vaultPath, '{"entries":{"provider/openrouter/api_key":"encrypted"}}\n', "utf8");
      await writeFile(sourceSecretsPaths.keyPath, '{"key_id":"k1","key_b64":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}\n', "utf8");
      await writeFile(targetSecretsPaths.vaultPath, '{"entries":{}}\n', "utf8");
      await writeFile(targetSecretsPaths.keyPath, '{"key_id":"old","key_b64":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="}\n', "utf8");

      const exported = await exportMigrationArchive(sourceMemory, {
        secretsPaths: sourceSecretsPaths,
      });

      await writeFile(path.join(targetMemory, "documents", "old-file.md"), "stale\n", "utf8");
      const imported = await importMigrationArchive(exported.archive_path, {
        memoryRoot: targetMemory,
        secretsPaths: targetSecretsPaths,
      });

      expect(imported.source_format).toBe("migration-v1");
      expect(imported.restored.memory).toBe(true);
      expect(imported.restored.secrets).toBe(true);

      const importedPreferences = await readFile(path.join(targetMemory, "preferences", "default.json"), "utf8");
      expect(importedPreferences).toContain("source-model");
      await expect(readFile(path.join(targetMemory, "documents", "old-file.md"), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });

      const importedVault = await readFile(targetSecretsPaths.vaultPath, "utf8");
      expect(importedVault).toContain("provider/openrouter/api_key");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("imports legacy memory-only archives without touching secrets", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "paa-migration-legacy-test-"));
    const sourceMemory = path.join(tempRoot, "legacy-memory-source");
    const targetMemory = path.join(tempRoot, "legacy-memory-target");
    const archivePath = path.join(tempRoot, "legacy-export.tar.gz");
    const targetSecrets = path.join(tempRoot, "target-secrets");
    const targetSecretsPaths = {
      homeDir: targetSecrets,
      vaultPath: path.join(targetSecrets, "vault.json"),
      keyPath: path.join(targetSecrets, "master-key.json"),
    };

    try {
      await writeFixtureMemory(sourceMemory, "legacy-source-model");
      await writeFixtureMemory(targetMemory, "legacy-target-model");
      await mkdir(targetSecrets, { recursive: true });
      await writeFile(targetSecretsPaths.vaultPath, '{"entries":{"existing":"secret"}}\n', "utf8");

      await exportMemoryArchive(sourceMemory, archivePath);
      const imported = await importMigrationArchive(archivePath, {
        memoryRoot: targetMemory,
        secretsPaths: targetSecretsPaths,
      });

      expect(imported.source_format).toBe("legacy-memory-export");
      expect(imported.restored.memory).toBe(true);
      expect(imported.restored.secrets).toBe(false);
      expect(imported.warnings.some((warning) => warning.includes("legacy"))).toBe(true);

      const importedPreferences = await readFile(path.join(targetMemory, "preferences", "default.json"), "utf8");
      expect(importedPreferences).toContain("legacy-source-model");
      const existingVault = await readFile(targetSecretsPaths.vaultPath, "utf8");
      expect(existingVault).toContain("existing");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves the target git repository during import", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "paa-migration-git-preserve-test-"));
    const sourceMemory = path.join(tempRoot, "source-memory");
    const targetMemory = path.join(tempRoot, "target-memory");
    const targetSecrets = path.join(tempRoot, "target-secrets");
    const targetSecretsPaths = {
      homeDir: targetSecrets,
      vaultPath: path.join(targetSecrets, "vault.json"),
      keyPath: path.join(targetSecrets, "master-key.json"),
    };
    const protectedObjectDir = path.join(targetMemory, ".git", "objects", "1f");

    try {
      await writeFixtureMemory(sourceMemory, "source-model");
      await writeFixtureMemory(targetMemory, "target-model");
      await mkdir(protectedObjectDir, { recursive: true });
      await writeFile(path.join(protectedObjectDir, "539fb90d1ed07a267a221557d2e0f9e60a5bc7"), "git object\n", "utf8");
      await chmod(protectedObjectDir, 0o555);

      const exported = await exportMigrationArchive(sourceMemory);
      const imported = await importMigrationArchive(exported.archive_path, {
        memoryRoot: targetMemory,
        secretsPaths: targetSecretsPaths,
      });

      expect(imported.source_format).toBe("migration-v1");
      expect(imported.restored.memory).toBe(true);
      await expect(
        readFile(path.join(protectedObjectDir, "539fb90d1ed07a267a221557d2e0f9e60a5bc7"), "utf8")
      ).resolves.toContain("git object");

      const importedPreferences = await readFile(path.join(targetMemory, "preferences", "default.json"), "utf8");
      expect(importedPreferences).toContain("source-model");
    } finally {
      await chmod(protectedObjectDir, 0o755).catch(() => {});
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("excludes generated archives and git internals from memory archives", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "paa-migration-exclude-test-"));
    const sourceMemory = path.join(tempRoot, "source-memory");
    const archivePath = path.join(sourceMemory, "system", "updates", "backups", "starter-pack-test.tar.gz");

    try {
      await writeFixtureMemory(sourceMemory, "source-model");
      await mkdir(path.join(sourceMemory, ".git", "objects"), { recursive: true });
      await mkdir(path.join(sourceMemory, "exports"), { recursive: true });
      await mkdir(path.join(sourceMemory, "system", "updates", "backups"), { recursive: true });
      await writeFile(path.join(sourceMemory, ".git", "objects", "large-pack"), "git internals\n", "utf8");
      await writeFile(path.join(sourceMemory, "exports", "old-export.tar.gz"), "old export\n", "utf8");
      await writeFile(path.join(sourceMemory, "system", "updates", "backups", "old-backup.tar.gz"), "old backup\n", "utf8");

      await exportMemoryArchive(sourceMemory, archivePath);

      const { stdout } = await execFileAsync("tar", ["-tzf", archivePath]);
      const entries = stdout
        .split("\n")
        .map((entry) => entry.replace(/\r$/, ""))
        .filter(Boolean);

      expect(entries).toContain("./documents/projects.json");
      expect(entries.some((entry) => entry.startsWith("./.git"))).toBe(false);
      expect(entries.some((entry) => entry.startsWith("./exports/") && entry.endsWith(".tar.gz"))).toBe(false);
      expect(entries.some((entry) => entry.startsWith("./system/updates/backups/") && entry.endsWith(".tar.gz"))).toBe(false);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("excludes generated archives and git internals from migration archives", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "paa-migration-archive-exclude-test-"));
    const sourceMemory = path.join(tempRoot, "source-memory");

    try {
      await writeFixtureMemory(sourceMemory, "source-model");
      await mkdir(path.join(sourceMemory, ".git", "objects"), { recursive: true });
      await mkdir(path.join(sourceMemory, "exports"), { recursive: true });
      await mkdir(path.join(sourceMemory, "system", "updates", "backups"), { recursive: true });
      await writeFile(path.join(sourceMemory, ".git", "objects", "large-pack"), "git internals\n", "utf8");
      await writeFile(path.join(sourceMemory, "exports", "old-export.tar.gz"), "old export\n", "utf8");
      await writeFile(path.join(sourceMemory, "system", "updates", "backups", "old-backup.tar.gz"), "old backup\n", "utf8");

      const exported = await exportMigrationArchive(sourceMemory);

      const { stdout } = await execFileAsync("tar", ["-tzf", exported.archive_path]);
      const entries = stdout
        .split("\n")
        .map((entry) => entry.replace(/\r$/, ""))
        .filter(Boolean);

      expect(entries).toContain("./memory/documents/projects.json");
      expect(entries.some((entry) => entry.startsWith("./memory/.git"))).toBe(false);
      expect(entries.some((entry) => entry.startsWith("./memory/exports/") && entry.endsWith(".tar.gz"))).toBe(false);
      expect(
        entries.some((entry) => entry.startsWith("./memory/system/updates/backups/") && entry.endsWith(".tar.gz"))
      ).toBe(false);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
