import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";

import { describe, expect, it } from "vitest";

import { exportMemoryArchive } from "../git.js";
import { exportMigrationArchive, importMigrationArchive } from "./migration.js";

async function writeFixtureMemory(memoryRoot: string, marker: string): Promise<void> {
  await mkdir(path.join(memoryRoot, "conversations"), { recursive: true });
  await mkdir(path.join(memoryRoot, "documents"), { recursive: true });
  await mkdir(path.join(memoryRoot, "preferences"), { recursive: true });
  await writeFile(path.join(memoryRoot, "AGENT.md"), `# ${marker}\n`, "utf8");
  await writeFile(path.join(memoryRoot, "preferences", "default.json"), `{"default_model":"${marker}"}\n`, "utf8");
  await writeFile(path.join(memoryRoot, "documents", "projects.json"), "[]\n", "utf8");
}

describe("memory migration archive", () => {
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
});
