import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Memory, TestSigner, MockSeller } from "../src/core.js";
import {
  describeProvider,
  DirectoryFixture,
  Discovery,
  Trust,
} from "../src/discovery.js";
const close: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of close.splice(0)) await fn();
});
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "provider-discovery-"));
  const owner = new TestSigner();
  let payload: unknown;
  let status = 200;
  const server = createServer((req, res) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      Location: "http://169.254.169.254/",
    });
    res.end(JSON.stringify(payload));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error("server address");
  const origin = "http://127.0.0.1:" + addr.port;
  const memory = new Memory(join(root, "memory"));
  payload = describeProvider(owner, origin);
  close.push(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    owner,
    origin,
    memory,
    discovery: new Discovery(memory, [origin], owner.publicKey),
    set: (v: unknown, s = 200) => {
      payload = v;
      status = s;
    },
    description: payload as ReturnType<typeof describeProvider>,
  };
}
describe("direct provider access and replaceable fixture directories", () => {
  it("two directories and direct address identify provider; directory removal does not block access", async () => {
    const s = await setup();
    const a = new DirectoryFixture("directory-A", [s.origin + "/description"]);
    const b = new DirectoryFixture("directory-B", [s.origin + "/description"]);
    expect(a.search("synthetic model")[0]!.address).toBe(
      b.search("synthetic model")[0]!.address,
    );
    a.available = false;
    expect(() => a.search("synthetic model")).toThrow();
    expect(
      (await s.discovery.retrieve(b.search("synthetic model")[0]!.address))
        .provider,
    ).toBe("fixture-seller");
    expect(
      (await s.discovery.retrieve(s.origin + "/description")).provider,
    ).toBe("fixture-seller");
    expect(JSON.stringify(s.memory.readAll())).toContain(
      "publisher-key-control-only",
    );
  });
  it("rejects changed payee, stale description, invalid signature and missing commercial meanings", async () => {
    const s = await setup();
    for (const patch of [
      { payee: "attacker" },
      { expiresAt: 0 },
      { signature: "invalid" },
      { terms: null },
    ]) {
      s.set({ ...s.description, ...patch });
      await expect(
        s.discovery.retrieve(s.origin + "/description"),
      ).rejects.toThrow();
    }
  });
  it("prevents unauthorized local/metadata access and unsafe redirects", async () => {
    const s = await setup();
    await expect(
      s.discovery.retrieve("http://169.254.169.254/"),
    ).rejects.toThrow("configured");
    await expect(s.discovery.retrieve("http://127.0.0.1:1/")).rejects.toThrow(
      "configured",
    );
    s.set({}, 302);
    await expect(
      s.discovery.retrieve(s.origin + "/description"),
    ).rejects.toThrow("redirect");
  });
  it("limits oversized responses and approved minimum search disclosure", async () => {
    const s = await setup();
    s.set("x".repeat(70000));
    await expect(
      s.discovery.retrieve(s.origin + "/description"),
    ).rejects.toThrow("large");
    expect(() =>
      new DirectoryFixture("D", []).search("private owner task"),
    ).toThrow("disclosure");
  });
  it("checks fresh exact offer against provider binding", async () => {
    const s = await setup();
    const seller = new MockSeller(join(s.root, "seller.sqlite"));
    const offer = seller.offer("synthetic", 25);
    expect(s.discovery.validateOffer(s.description, offer)).toBe(offer);
    expect(() =>
      s.discovery.validateOffer(s.description, { ...offer, payee: "changed" }),
    ).toThrow();
    seller.close();
  });
  it("deduplicates source evidence and preserves conflicting category/claims without global rating", async () => {
    const s = await setup();
    const record = {
      kind: "third-party-assessment" as const,
      source: "fixture-review-1",
      observedAt: Date.now(),
      evidence: "claims works",
    };
    const records = new Trust(s.memory).retain([
      record,
      record,
      { ...record, source: "fixture-review-2", evidence: "claims fails" },
      {
        ...record,
        kind: "ai-assessment",
        source: "derived",
        evidence: "uncertain",
      },
    ]);
    expect(records).toHaveLength(3);
    const text = JSON.stringify(s.memory.readAll());
    expect(text).toContain("not-established");
    expect(text).toContain("authorization");
  });
});
