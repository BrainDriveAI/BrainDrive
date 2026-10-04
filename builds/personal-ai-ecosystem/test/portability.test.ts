import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  Authority,
  TestSigner,
  Memory,
  MockSeller,
  Purchaser,
  recoverySigner,
  fingerprint,
} from "../src/core.js";
import {
  exportPackage,
  importReadableMemory,
  verifyPackage,
  restoreVerifiedAuthority,
} from "../src/portability.js";
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), "portable-ecosystem-"));
  const owner = new TestSigner(),
    recovery = new TestSigner(),
    agent = new TestSigner();
  const auth = new Authority(
    join(root, "authority.sqlite"),
    owner.publicKey,
    recovery.publicKey,
  );
  const memory = new Memory(join(root, "memory"));
  const seller = new MockSeller(join(root, "seller.sqlite"));
  const offer = seller.offer("synthetic", 25);
  auth.grant(owner, {
    id: "g1",
    agent: agent.publicKey,
    audience: "mock-model",
    action: "purchase",
    fingerprint: fingerprint(offer),
    maxCost: 25,
    expiresAt: Date.now() + 60000,
  });
  memory.write("profile", { name: "Synthetic Owner" });
  const pkg = join(root, "package");
  cleanup.push(() => {
    try {
      auth.close();
    } catch {}
    seller.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, owner, recovery, agent, auth, memory, seller, offer, pkg };
}
describe("secret-free portable records and separately verified live authority", () => {
  it("independent Python reads offline inventory; readable import never activates grants", () => {
    const s = setup();
    exportPackage(s.pkg, s.memory, s.auth, s.owner);
    const evidence = JSON.parse(
      execFileSync("python3", ["scripts/verify-package.py", s.pkg], {
        encoding: "utf8",
      }),
    );
    expect(evidence.filesVerified).toBe(2);
    expect(evidence.authorityActivation).toBe("none");
    const imported = importReadableMemory(
      s.pkg,
      join(s.root, "new-memory"),
      s.owner.publicKey,
    );
    expect(imported.readAll()).toEqual(s.memory.readAll());
    expect(
      JSON.stringify(verifyPackage(s.pkg, s.owner.publicKey)),
    ).not.toContain("PRIVATE KEY");
  });
  it("corrupt bytes fail both readers without partial import", () => {
    const s = setup();
    exportPackage(s.pkg, s.memory, s.auth, s.owner);
    writeFileSync(
      join(s.pkg, "memory/profile.json"),
      readFileSync(join(s.pkg, "memory/profile.json"), "utf8").replace(
        "Synthetic",
        "Altered__",
      ),
    );
    expect(() => verifyPackage(s.pkg, s.owner.publicKey)).toThrow("hash");
    expect(() =>
      execFileSync("python3", ["scripts/verify-package.py", s.pkg], {
        stdio: "pipe",
      }),
    ).toThrow();
    expect(() =>
      importReadableMemory(
        s.pkg,
        join(s.root, "new-memory"),
        s.owner.publicKey,
      ),
    ).toThrow();
  });
  it("path traversal, incompatible schema, signature changes and unlisted content reject", () => {
    const s = setup();
    exportPackage(s.pkg, s.memory, s.auth, s.owner);
    const path = join(s.pkg, "manifest.json");
    const original = readFileSync(path, "utf8");
    for (const patch of [
      { schema: 2 },
      { files: [{ path: "../authority.sqlite", sha256: "x", bytes: 1 }] },
      { signature: "invalid" },
    ]) {
      writeFileSync(
        path,
        JSON.stringify({ ...JSON.parse(original), ...patch }),
      );
      expect(() => verifyPackage(s.pkg, s.owner.publicKey)).toThrow();
    }
    writeFileSync(path, original);
    writeFileSync(join(s.pkg, "extra.json"), "{}");
    expect(() => verifyPackage(s.pkg, s.owner.publicKey)).toThrow("unlisted");
  });
  it("rejects secrets and unauthorized export owner", () => {
    const s = setup();
    s.memory.write("secret", { privateKey: "bad" });
    expect(() => exportPackage(s.pkg, s.memory, s.auth, s.owner)).toThrow(
      "secret",
    );
  });
  it("verified routine migration preserves valid grants and consumed/pending state", async () => {
    const s = setup();
    const buyer = new Purchaser(
      s.auth,
      s.memory,
      s.seller,
      recoverySigner(s.owner),
    );
    s.seller.dropNextResponse = true;
    await buyer.buy(
      "g1",
      "p1",
      s.offer,
      s.auth.proof(
        s.agent,
        s.auth.challenge("g1", "p1", "mock-model", fingerprint(s.offer)),
      ),
    );
    exportPackage(s.pkg, s.memory, s.auth, s.owner);
    const imported = importReadableMemory(
      s.pkg,
      join(s.root, "new-memory"),
      s.owner.publicKey,
    );
    const next = restoreVerifiedAuthority(
      s.pkg,
      join(s.root, "new-authority.sqlite"),
      s.auth,
      s.owner,
    );
    expect(() =>
      s.auth.grant(s.owner, {
        id: "old-host",
        agent: s.agent.publicKey,
        audience: "mock-model",
        action: "purchase",
        fingerprint: fingerprint(s.offer),
        maxCost: 25,
        expiresAt: Date.now() + 60000,
      }),
    ).toThrow("fenced");
    expect(next.operation("p1")!.payment).toBe("unknown");
    expect(
      (
        await new Purchaser(
          next,
          imported,
          s.seller,
          recoverySigner(s.owner),
        ).reconcile("p1")
      ).payment,
    ).toBe("settled");
    expect(s.seller.effects()).toBe(1);
    await expect(
      new Purchaser(next, imported, s.seller, recoverySigner(s.owner)).buy(
        "g1",
        "p2",
        s.offer,
        next.proof(
          s.agent,
          next.challenge("g1", "p2", "mock-model", fingerprint(s.offer)),
        ),
      ),
    ).rejects.toThrow("consumed");
    next.close();
  });
  it("stale snapshot cannot revive revoked grants or reset reservations", () => {
    const s = setup();
    exportPackage(s.pkg, s.memory, s.auth, s.owner);
    s.auth.revoke(s.owner, "g1");
    expect(() =>
      restoreVerifiedAuthority(
        s.pkg,
        join(s.root, "new.sqlite"),
        s.auth,
        s.owner,
      ),
    ).toThrow("stale");
  });
  it("missing live status and wrong owner proof prevent authority activation", () => {
    const s = setup();
    exportPackage(s.pkg, s.memory, s.auth, s.owner);
    expect(() =>
      restoreVerifiedAuthority(
        s.pkg,
        join(s.root, "new.sqlite"),
        s.auth,
        new TestSigner(),
      ),
    ).toThrow("proof");
    s.auth.statusAvailable = false;
    expect(() =>
      restoreVerifiedAuthority(
        s.pkg,
        join(s.root, "new.sqlite"),
        s.auth,
        s.owner,
      ),
    ).toThrow("unavailable");
  });
  it("symlinked evidence files and nonempty targets reject", () => {
    const s = setup();
    exportPackage(s.pkg, s.memory, s.auth, s.owner);
    const path = join(s.pkg, "memory/profile.json");
    rmSync(path);
    symlinkSync(join(s.root, "authority.sqlite"), path);
    expect(() => verifyPackage(s.pkg, s.owner.publicKey)).toThrow("type");
  });
});
