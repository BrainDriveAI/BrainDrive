import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_N = 1 << 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

const HASH_PREFIX = "scrypt";

type ParsedPasswordHash = {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
};

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * 1024 * 1024,
  });

  return [
    HASH_PREFIX,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    toBase64Url(salt),
    toBase64Url(derived),
  ].join("$");
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parsed = parsePasswordHash(encodedHash);
  const derived = scryptSync(password, parsed.salt, parsed.hash.length, {
    N: parsed.n,
    r: parsed.r,
    p: parsed.p,
    maxmem: 128 * 1024 * 1024,
  });

  if (derived.length !== parsed.hash.length) {
    return false;
  }

  return timingSafeEqual(derived, parsed.hash);
}

function parsePasswordHash(encodedHash: string): ParsedPasswordHash {
  const parts = encodedHash.split("$");
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) {
    throw new Error("Unsupported password hash format");
  }

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = fromBase64Url(parts[4]);
  const hash = fromBase64Url(parts[5]);

  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || n <= 0 || r <= 0 || p <= 0) {
    throw new Error("Invalid password hash parameters");
  }

  if (hash.length < 32) {
    throw new Error("Invalid password hash length");
  }

  return { n, r, p, salt, hash };
}

function toBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}
