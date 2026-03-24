import { readFile } from "node:fs/promises";
import { z } from "zod";

import type { MasterKeyMaterial } from "./key-provider.js";
import { decryptSecretValue, encryptedSecretEntrySchema, encryptSecretValue } from "./crypto.js";
import { resolveSecretsPaths, type SecretsPaths, writePrivateFile } from "./paths.js";

const secretVaultSchema = z
  .object({
    schema_version: z.literal(1),
    entries: z.record(encryptedSecretEntrySchema),
  })
  .strict();

export type SecretVault = z.infer<typeof secretVaultSchema>;

const emptyVault: SecretVault = {
  schema_version: 1,
  entries: {},
};

export async function loadSecretVault(paths: SecretsPaths = resolveSecretsPaths()): Promise<SecretVault> {
  let raw: string;
  try {
    raw = await readFile(paths.vaultPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        ...emptyVault,
        entries: {},
      };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Secret vault file is not valid JSON: ${paths.vaultPath}`);
  }

  return secretVaultSchema.parse(parsed);
}

export async function saveSecretVault(vault: SecretVault, paths: SecretsPaths = resolveSecretsPaths()): Promise<void> {
  await writePrivateFile(paths.vaultPath, `${JSON.stringify(vault, null, 2)}\n`);
}

export async function getVaultSecret(
  secretRef: string,
  masterKey: MasterKeyMaterial,
  paths: SecretsPaths = resolveSecretsPaths()
): Promise<string | undefined> {
  const normalizedRef = normalizeSecretRef(secretRef);
  const vault = await loadSecretVault(paths);
  const entry = vault.entries[normalizedRef];
  if (!entry) {
    return undefined;
  }
  return decryptSecretValue(entry, masterKey.key, normalizedRef);
}

export async function upsertVaultSecret(
  secretRef: string,
  plaintext: string,
  masterKey: MasterKeyMaterial,
  paths: SecretsPaths = resolveSecretsPaths()
): Promise<void> {
  const normalizedRef = normalizeSecretRef(secretRef);
  const vault = await loadSecretVault(paths);
  const existingEntry = vault.entries[normalizedRef];
  vault.entries[normalizedRef] = await encryptSecretValue({
    plaintext,
    masterKey: masterKey.key,
    keyId: masterKey.keyId,
    aad: normalizedRef,
    createdAt: existingEntry?.created_at,
  });
  await saveSecretVault(vault, paths);
}

export async function deleteVaultSecret(secretRef: string, paths: SecretsPaths = resolveSecretsPaths()): Promise<boolean> {
  const normalizedRef = normalizeSecretRef(secretRef);
  const vault = await loadSecretVault(paths);
  if (!vault.entries[normalizedRef]) {
    return false;
  }
  delete vault.entries[normalizedRef];
  await saveSecretVault(vault, paths);
  return true;
}

export async function rotateVaultSecrets(
  currentMasterKey: MasterKeyMaterial,
  nextMasterKey: MasterKeyMaterial,
  paths: SecretsPaths = resolveSecretsPaths()
): Promise<{ rotated: number }> {
  const vault = await loadSecretVault(paths);
  const updatedEntries: SecretVault["entries"] = {};
  const secretRefs = Object.keys(vault.entries);

  for (const secretRef of secretRefs) {
    const currentEntry = vault.entries[secretRef];
    if (!currentEntry) {
      continue;
    }

    const plaintext = await decryptSecretValue(currentEntry, currentMasterKey.key, secretRef);
    updatedEntries[secretRef] = await encryptSecretValue({
      plaintext,
      masterKey: nextMasterKey.key,
      keyId: nextMasterKey.keyId,
      aad: secretRef,
      createdAt: currentEntry.created_at,
    });
  }

  vault.entries = updatedEntries;
  await saveSecretVault(vault, paths);
  return { rotated: secretRefs.length };
}

export async function listVaultSecretRefs(paths: SecretsPaths = resolveSecretsPaths()): Promise<string[]> {
  const vault = await loadSecretVault(paths);
  return Object.keys(vault.entries).sort();
}

function normalizeSecretRef(secretRef: string): string {
  const normalized = secretRef.trim();
  if (normalized.length === 0) {
    throw new Error("Secret reference must be a non-empty string");
  }
  return normalized;
}
