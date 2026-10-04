import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  Authority,
  atomicFile,
  canonical,
  check,
  fingerprint,
  Memory,
  TestSigner,
  validSignature,
} from "./core.js";
import type { Messenger } from "./messaging.js";
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
interface Manifest {
  schema: 1;
  exportedAt: number;
  owner: string;
  files: { path: string; sha256: string; bytes: number }[];
  dependencies: string[];
  signature: string;
}
function secretFree(value: unknown): void {
  if (typeof value === "string")
    check(!value.includes("PRIVATE KEY-----"), "secret in package");
  if (Array.isArray(value)) for (const v of value) secretFree(v);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      check(
        !/^(private.?key|secret.?key|bearer|access.?token|session.?token|password|master.?key)$/i.test(
          k,
        ),
        "secret field in package",
      );
      secretFree(v);
    }
}
export function exportPackage(
  root: string,
  memory: Memory,
  auth: Authority,
  owner: TestSigner,
  messaging?: Messenger,
) {
  check(!existsSync(root), "export destination exists");
  const staging = root + "." + randomUUID() + ".staging";
  mkdirSync(staging, { recursive: true, mode: 0o700 });
  try {
    const files: Manifest["files"] = [];
    // Single-writer/quiesced caller is required; the authority snapshot itself is transactional.
    const snapshot = auth.tx(() => auth.snapshot());
    const content: Record<string, unknown> = { "authority.json": snapshot };
    for (const [name, record] of Object.entries(memory.readAll()))
      content["memory/" + name] = record;
    if (messaging) content["messaging.json"] = messaging.snapshot();
    for (const [path, value] of Object.entries(content)) {
      secretFree(value);
      const text = JSON.stringify(value, null, 2) + "\n";
      atomicFile(join(staging, path), text);
      files.push({
        path,
        sha256: digest(text),
        bytes: Buffer.byteLength(text),
      });
    }
    const unsigned = {
      schema: 1 as const,
      exportedAt: Date.now(),
      owner: auth.ownerKey,
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
      dependencies: [
        "live authority verification before activation",
        "separate protected secret recovery",
        "provider reconciliation for unresolved effects",
      ],
    };
    const signature = owner.sign("portable-manifest", unsigned);
    check(
      validSignature(auth.ownerKey, "portable-manifest", unsigned, signature),
      "export owner proof",
    );
    atomicFile(
      join(staging, "manifest.json"),
      JSON.stringify({ ...unsigned, signature }, null, 2) + "\n",
    );
    renameSync(staging, root);
    return verifyPackage(root, auth.ownerKey);
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}
export function verifyPackage(root: string, trustedOwner: string) {
  check(
    lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(),
    "package root",
  );
  const manifestPath = join(root, "manifest.json");
  check(
    lstatSync(manifestPath).isFile() &&
      !lstatSync(manifestPath).isSymbolicLink() &&
      lstatSync(manifestPath).size < 100000,
    "manifest file",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  check(
    manifest &&
      manifest.schema === 1 &&
      manifest.owner === trustedOwner &&
      Array.isArray(manifest.files) &&
      manifest.files.length <= 1000,
    "manifest schema/owner",
  );
  const { signature, ...unsigned } = manifest;
  check(
    validSignature(trustedOwner, "portable-manifest", unsigned, signature),
    "manifest signature",
  );
  const content: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const f of manifest.files) {
    check(
      typeof f.path === "string" &&
        (/^(authority|messaging)\.json$/.test(f.path) ||
          /^memory\/[a-zA-Z0-9_-]{1,100}\.json$/.test(f.path)) &&
        !seen.has(f.path),
      "manifest path/duplicate",
    );
    seen.add(f.path);
    const path = join(root, f.path);
    check(
      !lstatSync(dirname(path)).isSymbolicLink(),
      "package directory symlink",
    );
    const stat = lstatSync(path);
    check(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size <= 1000000 &&
        Number.isSafeInteger(f.bytes) &&
        f.bytes === stat.size,
      "package size/type",
    );
    const text = readFileSync(path, "utf8");
    check(digest(text) === f.sha256, "package content hash");
    const value: unknown = JSON.parse(text);
    secretFree(value);
    content[f.path] = value;
  }
  check(seen.has("authority.json"), "missing authority state");
  for (const file of readdirSync(root)) {
    if (file === "manifest.json") continue;
    if (file === "memory") {
      for (const child of readdirSync(join(root, file)))
        check(seen.has("memory/" + child), "unlisted package file");
    } else check(seen.has(file), "unlisted package file");
  }
  return { manifest, content };
}
export function importReadableMemory(
  root: string,
  destination: string,
  trustedOwner: string,
) {
  const pkg = verifyPackage(root, trustedOwner);
  check(!existsSync(destination), "import destination exists");
  const staging = destination + "." + randomUUID() + ".staging";
  try {
    const memory = new Memory(staging);
    for (const [path, value] of Object.entries(pkg.content))
      if (path.startsWith("memory/")) memory.write(path.slice(7, -5), value);
    renameSync(staging, destination);
    return new Memory(destination);
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}
export function restoreVerifiedAuthority(
  root: string,
  database: string,
  liveAuthority: Authority,
  owner: TestSigner,
) {
  check(
    liveAuthority.statusAvailable &&
      Date.now() - liveAuthority.statusObservedAt < 60000,
    "fresh authority unavailable",
  );
  const pkg = verifyPackage(root, liveAuthority.ownerKey);
  const snapshot = pkg.content["authority.json"] as ReturnType<
    Authority["snapshot"]
  >;
  check(
    snapshot?.schema === 1 &&
      fingerprint(snapshot) === fingerprint(liveAuthority.snapshot()),
    "stale or changed authority snapshot",
  );
  const payload = {
    operation: "activate-second-host",
    snapshot: fingerprint(snapshot),
  };
  check(
    validSignature(
      liveAuthority.ownerKey,
      "migration-owner",
      payload,
      owner.sign("migration-owner", payload),
    ),
    "migration owner proof",
  );
  check(!existsSync(database), "authority destination exists");
  check(liveAuthority.meta().active === 1, "source already fenced");
  // Commit source fencing BEFORE target activation. Crash here sacrifices availability, not authority safety.
  liveAuthority.tx(() => {
    check(
      fingerprint(snapshot) === fingerprint(liveAuthority.snapshot()),
      "source changed during handoff",
    );
    liveAuthority.db.exec("UPDATE meta SET active=0 WHERE id=1;");
  });
  const auth = new Authority(
    database,
    liveAuthority.ownerKey,
    snapshot.meta.recovery,
  );
  try {
    auth.tx(() => {
      auth.db
        .prepare("UPDATE meta SET epoch=?,budget=?,authorityId=? WHERE id=1")
        .run(
          snapshot.meta.epoch,
          snapshot.meta.budget,
          snapshot.meta.authorityId,
        );
      for (const certificate of snapshot.recoveries)
        auth.db
          .prepare("INSERT INTO recoveries VALUES (?,?)")
          .run(certificate.epoch, canonical(certificate));
      for (const raw of snapshot.grants) {
        const row = raw as {
          id: string;
          body: string;
          revoked: number;
          operation: string | null;
        };
        auth.db
          .prepare(
            "INSERT INTO grants(id,body,revoked,operation) VALUES (?,?,?,?)",
          )
          .run(row.id, row.body, row.revoked, row.operation);
      }
      for (const raw of snapshot.operations) {
        const row = raw as { id: string; body: string; cost: number };
        auth.db
          .prepare("INSERT INTO operations VALUES (?,?,?)")
          .run(row.id, row.body, row.cost);
      }
    });
    return auth;
  } catch (e) {
    auth.close();
    throw e;
  }
}

/** Restore duplicate/outbox history only. Contacts and queued sending require fresh owner approval. */
export function restoreMessageHistory(
  root: string,
  messenger: Messenger,
  trustedOwner: string,
) {
  const pkg = verifyPackage(root, trustedOwner);
  const state = pkg.content["messaging.json"] as
    ReturnType<Messenger["snapshot"]> | undefined;
  check(state?.schema === 1, "missing message state");
  check(messenger.ownerKey === trustedOwner, "message owner");
  messenger.db.exec("BEGIN IMMEDIATE");
  try {
    for (const raw of state.inbox) {
      const r = raw as {
        sender: string;
        id: string;
        body: string;
        hash: string;
        stored: number;
        notified: number;
      };
      messenger.db
        .prepare("INSERT INTO inbox VALUES (?,?,?,?,?,?)")
        .run(r.sender, r.id, r.body, r.hash, r.stored, r.notified);
    }
    for (const raw of state.outbox) {
      const r = raw as {
        id: string;
        body: string;
        event: string;
        epoch: number;
      };
      messenger.db
        .prepare("INSERT INTO outbox VALUES (?,?,?,?,?)")
        .run(r.id, r.body, r.event, r.epoch, "imported-history");
    }
    messenger.db.exec("COMMIT");
  } catch (e) {
    messenger.db.exec("ROLLBACK");
    throw e;
  }
}
