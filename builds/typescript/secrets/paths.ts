import os from "node:os";
import path from "node:path";
import { chmod, mkdir, writeFile } from "node:fs/promises";

export type SecretsPaths = {
  homeDir: string;
  vaultPath: string;
  keyPath: string;
};

const DEFAULT_SECRETS_HOME = path.join(os.homedir(), ".config", "paa", "secrets");

export function resolveSecretsPaths(): SecretsPaths {
  const configuredHome = process.env.PAA_SECRETS_HOME?.trim();
  const homeDir = configuredHome ? path.resolve(configuredHome) : DEFAULT_SECRETS_HOME;
  const vaultPath = resolvePathFromEnv(process.env.PAA_SECRETS_VAULT_FILE, path.join(homeDir, "vault.json"));
  const keyPath = resolvePathFromEnv(process.env.PAA_SECRETS_MASTER_KEY_FILE, path.join(homeDir, "master-key.json"));
  return {
    homeDir,
    vaultPath,
    keyPath,
  };
}

export async function ensureSecretsHome(paths: SecretsPaths): Promise<void> {
  await mkdir(paths.homeDir, { recursive: true });
}

export async function writePrivateFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  await setPrivateFileMode(filePath);
}

function resolvePathFromEnv(envValue: string | undefined, fallback: string): string {
  if (!envValue || envValue.trim().length === 0) {
    return fallback;
  }
  return path.resolve(envValue.trim());
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
