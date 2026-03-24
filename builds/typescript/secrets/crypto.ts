import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from "node:crypto";
import { z } from "zod";

const kdfParams = {
  N: 16_384,
  r: 8,
  p: 1,
  keylen: 32,
} as const;

const nonceBytes = 12;
const saltBytes = 16;

export const encryptedSecretEntrySchema = z
  .object({
    alg: z.literal("aes-256-gcm"),
    kdf: z.literal("scrypt"),
    kdf_params: z.object({
      N: z.number().int().positive(),
      r: z.number().int().positive(),
      p: z.number().int().positive(),
      keylen: z.number().int().positive(),
    }),
    key_id: z.string().min(1),
    nonce: z.string().min(1),
    salt: z.string().min(1),
    tag: z.string().min(1),
    ciphertext: z.string().min(1),
    aad: z.string().min(1),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict();

export type EncryptedSecretEntry = z.infer<typeof encryptedSecretEntrySchema>;

export async function encryptSecretValue(input: {
  plaintext: string;
  masterKey: Buffer;
  keyId: string;
  aad: string;
  createdAt?: string;
}): Promise<EncryptedSecretEntry> {
  const nonce = randomBytes(nonceBytes);
  const salt = randomBytes(saltBytes);
  const derivedKey = await deriveEncryptionKey(input.masterKey, salt);
  const cipher = createCipheriv("aes-256-gcm", derivedKey, nonce);

  cipher.setAAD(Buffer.from(input.aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(input.plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const now = new Date().toISOString();

  return {
    alg: "aes-256-gcm",
    kdf: "scrypt",
    kdf_params: { ...kdfParams },
    key_id: input.keyId,
    nonce: nonce.toString("base64"),
    salt: salt.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    aad: input.aad,
    created_at: input.createdAt ?? now,
    updated_at: now,
  };
}

export async function decryptSecretValue(
  entry: EncryptedSecretEntry,
  masterKey: Buffer,
  expectedAad?: string
): Promise<string> {
  if (entry.alg !== "aes-256-gcm" || entry.kdf !== "scrypt") {
    throw new Error("Unsupported secret envelope algorithm");
  }

  if (expectedAad && entry.aad !== expectedAad) {
    throw new Error("Secret envelope AAD mismatch");
  }

  const salt = decodeRequiredBase64(entry.salt, "salt");
  const nonce = decodeRequiredBase64(entry.nonce, "nonce");
  const tag = decodeRequiredBase64(entry.tag, "tag");
  const ciphertext = decodeRequiredBase64(entry.ciphertext, "ciphertext");
  const derivedKey = await deriveEncryptionKey(masterKey, salt);
  const decipher = createDecipheriv("aes-256-gcm", derivedKey, nonce);

  decipher.setAAD(Buffer.from(entry.aad, "utf8"));
  decipher.setAuthTag(tag);

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    throw new Error("Secret decryption failed: integrity check failed");
  }
}

async function deriveEncryptionKey(masterKey: Buffer, salt: Buffer): Promise<Buffer> {
  const derived = scryptSync(masterKey, salt, kdfParams.keylen, {
    N: kdfParams.N,
    r: kdfParams.r,
    p: kdfParams.p,
  });
  return Buffer.from(derived);
}

function decodeRequiredBase64(encoded: string, fieldName: string): Buffer {
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length === 0) {
    throw new Error(`Secret envelope field is not valid base64: ${fieldName}`);
  }
  return decoded;
}
