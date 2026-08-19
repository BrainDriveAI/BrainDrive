import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { z } from "zod";

import { canonicalJson } from "../contracts/common.js";
import { ContractViolation } from "../contracts/errors.js";
import { PackageSourceIndexSchema, RevocationListSchema } from "../contracts/package.js";
import { syncDirectoryEntry } from "./filesystem-durability.js";

export type VerifiedSourceIndex = z.infer<typeof PackageSourceIndexSchema>;
export type VerifiedRevocations = z.infer<typeof RevocationListSchema>;

async function writeAtomic(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  try {
    await rename(temporary, target);
    await syncDirectoryEntry(path.dirname(target));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export interface VerifiedPackageAuthorityCache {
  readSourceIndex(): Promise<VerifiedSourceIndex | null>;
  readRevocations(): Promise<VerifiedRevocations | null>;
  storeVerified(sourceIndex: VerifiedSourceIndex, revocations: VerifiedRevocations): Promise<void>;
  storeVerifiedRevocations(revocations: VerifiedRevocations): Promise<void>;
}

export class FileVerifiedPackageAuthorityCache implements VerifiedPackageAuthorityCache {
  readonly layout: { root: string; sourceIndex: string; revocations: string };

  constructor(stateRoot: string) {
    const root = path.join(stateRoot, "host-app-state", "verified-feed");
    this.layout = {
      root,
      sourceIndex: path.join(root, "source-index.json"),
      revocations: path.join(root, "revocations.json"),
    };
  }

  async readSourceIndex(): Promise<VerifiedSourceIndex | null> {
    return this.read(this.layout.sourceIndex, PackageSourceIndexSchema, "package_source_untrusted");
  }

  async readRevocations(): Promise<VerifiedRevocations | null> {
    return this.read(this.layout.revocations, RevocationListSchema, "revocation_metadata_invalid");
  }

  async storeVerified(sourceIndex: VerifiedSourceIndex, revocations: VerifiedRevocations): Promise<void> {
    const parsedSource = PackageSourceIndexSchema.parse(sourceIndex);
    const parsedRevocations = RevocationListSchema.parse(revocations);
    await mkdir(this.layout.root, { recursive: true, mode: 0o700 });
    await writeAtomic(this.layout.sourceIndex, parsedSource);
    try {
      await writeAtomic(this.layout.revocations, parsedRevocations);
    } catch (error) {
      // A torn pair is safe: each independently signed candidate is checked
      // monotonically on the next read before it can authorize execution.
      throw error;
    }
  }

  async storeVerifiedRevocations(revocations: VerifiedRevocations): Promise<void> {
    const parsed = RevocationListSchema.parse(revocations);
    await mkdir(this.layout.root, { recursive: true, mode: 0o700 });
    await writeAtomic(this.layout.revocations, parsed);
  }

  private async read<T>(target: string, schema: z.ZodType<T>, code: "package_source_untrusted" | "revocation_metadata_invalid"): Promise<T | null> {
    try {
      const result = schema.safeParse(JSON.parse(await readFile(target, "utf8")));
      if (!result.success) throw new ContractViolation(code, "Verified package authority cache is invalid");
      return result.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (error instanceof ContractViolation) throw error;
      throw new ContractViolation(code, "Verified package authority cache is unreadable");
    }
  }
}
