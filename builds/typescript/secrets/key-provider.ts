import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";

import { resolveSecretsPaths, type SecretsPaths, writePrivateFile } from "./paths.js";

const MASTER_KEY_BYTES = 32;
const DEFAULT_KEY_ID = "owner-master-v1";

const keyFileSchema = z
  .object({
    schema_version: z.literal(1),
    key_id: z.string().min(1),
    key_b64: z.string().min(1),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict();

export type MasterKeyMaterial = {
  keyId: string;
  key: Buffer;
  source: "env" | "file";
  path?: string;
};

export type MasterKeyInitResult = {
  keyId: string;
  path: string;
  created: boolean;
};

export async function loadMasterKey(paths: SecretsPaths = resolveSecretsPaths()): Promise<MasterKeyMaterial> {
  const envKey = process.env.PAA_SECRETS_MASTER_KEY_B64?.trim();
  if (envKey && envKey.length > 0) {
    const keyId = resolvePreferredKeyId(process.env.PAA_SECRETS_MASTER_KEY_ID);
    return {
      keyId,
      key: parseMasterKey(envKey, "PAA_SECRETS_MASTER_KEY_B64"),
      source: "env",
    };
  }

  return readMasterKeyFromFile(paths.keyPath);
}

export async function initializeMasterKey(
  options: {
    keyId?: string;
    force?: boolean;
    paths?: SecretsPaths;
  } = {}
): Promise<MasterKeyInitResult> {
  const paths = options.paths ?? resolveSecretsPaths();
  const keyId = resolvePreferredKeyId(options.keyId);

  try {
    await readFile(paths.keyPath, "utf8");
    if (!options.force) {
      const existing = await readMasterKeyFromFile(paths.keyPath);
      return {
        keyId: existing.keyId,
        path: paths.keyPath,
        created: false,
      };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  await writeMasterKeyFile(paths, keyId, randomBytes(MASTER_KEY_BYTES));
  return {
    keyId,
    path: paths.keyPath,
    created: true,
  };
}

export async function writeMasterKeyFile(paths: SecretsPaths, keyId: string, key: Buffer): Promise<void> {
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error(`Master key must be ${MASTER_KEY_BYTES} bytes`);
  }

  const now = new Date().toISOString();
  const payload = {
    schema_version: 1 as const,
    key_id: keyId,
    key_b64: key.toString("base64"),
    created_at: now,
    updated_at: now,
  };

  await writePrivateFile(paths.keyPath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function generateMasterKey(): Buffer {
  return randomBytes(MASTER_KEY_BYTES);
}

async function readMasterKeyFromFile(keyPath: string): Promise<MasterKeyMaterial> {
  let raw: string;
  try {
    raw = await readFile(keyPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(
        `Master key is not initialized at ${keyPath}. Run "npm run secrets -- init" to create an owner key.`
      );
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Master key file is not valid JSON: ${keyPath}`);
  }

  const keyFile = keyFileSchema.parse(parsed);
  return {
    keyId: keyFile.key_id,
    key: parseMasterKey(keyFile.key_b64, keyPath),
    source: "file",
    path: keyPath,
  };
}

function resolvePreferredKeyId(explicitKeyId: string | undefined): string {
  const configured = explicitKeyId?.trim() || process.env.PAA_SECRETS_MASTER_KEY_ID?.trim();
  if (!configured || configured.length === 0) {
    return DEFAULT_KEY_ID;
  }
  return configured;
}

function parseMasterKey(encodedKey: string, source: string): Buffer {
  const decoded = Buffer.from(encodedKey, "base64");
  if (decoded.length !== MASTER_KEY_BYTES) {
    throw new Error(`Master key from ${source} must decode to ${MASTER_KEY_BYTES} bytes`);
  }
  return decoded;
}
