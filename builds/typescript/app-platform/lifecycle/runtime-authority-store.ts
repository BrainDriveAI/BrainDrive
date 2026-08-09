import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { canonicalJson, OpaqueIdSchema, Sha256DigestSchema, TimestampSchema } from "../contracts/common.js";
import { RESUME_BUILDER_APP_ID } from "../contracts/constants.js";
import { RuntimeIdentitySchema } from "../contracts/supervisor.js";
import { syncDirectoryEntry } from "./filesystem-durability.js";

export const RuntimeAuthorityRecordSchema = z.object({
  runtime_authority_version: z.literal(1),
  app_id: z.literal(RESUME_BUILDER_APP_ID),
  installation_id: OpaqueIdSchema,
  package_version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/),
  package_digest: Sha256DigestSchema,
  grant_id: OpaqueIdSchema,
  runtime: RuntimeIdentitySchema,
  registration_id: OpaqueIdSchema,
  connection_id: OpaqueIdSchema,
  recorded_at: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (
    value.runtime.installation_id !== value.installation_id
    || value.runtime.package_digest !== value.package_digest
  ) {
    context.addIssue({ code: "custom", message: "runtime authority identity mismatch" });
  }
});

export type RuntimeAuthorityRecord = z.infer<typeof RuntimeAuthorityRecordSchema>;

async function writeAtomic(target: string, value: RuntimeAuthorityRecord): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
    await syncDirectoryEntry(path.dirname(target));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Durable M4 reconciliation evidence. It deliberately contains no endpoint, token, argv, environment, or path. */
export class RuntimeAuthorityStore {
  readonly root: string;

  constructor(stateRoot: string, private readonly clock: () => Date = () => new Date()) {
    this.root = path.join(stateRoot, "host-app-state", "runtime-authority");
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  async persist(input: Omit<RuntimeAuthorityRecord, "runtime_authority_version" | "app_id" | "recorded_at">): Promise<RuntimeAuthorityRecord> {
    await this.initialize();
    const record = RuntimeAuthorityRecordSchema.parse({
      runtime_authority_version: 1,
      app_id: RESUME_BUILDER_APP_ID,
      ...input,
      recorded_at: this.clock().toISOString(),
    });
    await writeAtomic(this.pathFor(record.installation_id), record);
    return record;
  }

  async read(installationId: string): Promise<RuntimeAuthorityRecord | null> {
    OpaqueIdSchema.parse(installationId);
    try {
      return RuntimeAuthorityRecordSchema.parse(JSON.parse(await readFile(this.pathFor(installationId), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async remove(installationId: string): Promise<void> {
    OpaqueIdSchema.parse(installationId);
    await rm(this.pathFor(installationId), { force: true });
  }

  private pathFor(installationId: string): string {
    return path.join(this.root, `${installationId}.json`);
  }
}
