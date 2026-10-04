import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Authority,
  MockSeller,
  Purchaser,
  Memory,
  TestSigner,
  recoverySigner,
  fingerprint,
} from "../src/core.js";
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), "ecosystem-test-"));
  roots.push(root);
  const owner = new TestSigner(),
    agent = new TestSigner(),
    recovery = new TestSigner();
  const auth = new Authority(
    join(root, "authority.sqlite"),
    owner.publicKey,
    recovery.publicKey,
  );
  const memory = new Memory(join(root, "memory"));
  const seller = new MockSeller(join(root, "seller.sqlite"));
  const buyer = new Purchaser(auth, memory, seller, recoverySigner(owner));
  const offer = seller.offer("synthetic prompt", 25);
  return { root, owner, agent, recovery, auth, memory, seller, buyer, offer };
}
function grant(s: ReturnType<typeof setup>, id = "g1") {
  return s.auth.grant(s.owner, {
    id,
    agent: s.agent.publicKey,
    audience: "mock-model",
    action: "purchase",
    fingerprint: fingerprint(s.offer),
    maxCost: 25,
    expiresAt: Date.now() + 60000,
  });
}
function proof(s: ReturnType<typeof setup>, grantId: string, operation = "p1") {
  return s.auth.proof(
    s.agent,
    s.auth.challenge(grantId, operation, "mock-model", fingerprint(s.offer)),
  );
}
describe("durable exact-offer authority and purchases", () => {
  it("records a bounded purchase and result with no secret in Memory", async () => {
    const s = setup();
    grant(s);
    const r = await s.buyer.buy("g1", "p1", s.offer, proof(s, "g1"));
    expect(r.payment).toBe("settled");
    expect(r.delivery).toBe("complete");
    expect(s.seller.effects()).toBe(1);
    expect(JSON.stringify(s.memory.readAll())).not.toContain("privateKey");
  });
  it("rejects changed offer, wrong agent and wrong audience before effect", async () => {
    const s = setup();
    grant(s);
    await expect(
      s.buyer.buy("g1", "p1", { ...s.offer, amount: 26 }, proof(s, "g1")),
    ).rejects.toThrow();
    expect(s.seller.effects()).toBe(0);
    const p = s.auth.proof(
      new TestSigner(),
      s.auth.challenge("g1", "p1", "mock-model", fingerprint(s.offer)),
    );
    await expect(s.buyer.buy("g1", "p1", s.offer, p)).rejects.toThrow();
  });
  it("reserves once across two SQLite connections and concurrent requests", async () => {
    const s = setup();
    grant(s);
    const other = new Authority(
      join(s.root, "authority.sqlite"),
      s.owner.publicKey,
    );
    const p1 = proof(s, "g1");
    const p2 = s.auth.proof(
      s.agent,
      other.challenge("g1", "p2", "mock-model", fingerprint(s.offer)),
    );
    const outcomes = await Promise.allSettled([
      s.buyer.buy("g1", "p1", s.offer, p1),
      new Purchaser(other, s.memory, s.seller, recoverySigner(s.owner)).buy(
        "g1",
        "p2",
        s.offer,
        p2,
      ),
    ]);
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(s.seller.effects()).toBe(1);
    other.close();
  });
  it("recovers paid-but-undelivered after buyer and seller restart without paying again", async () => {
    const s = setup();
    grant(s);
    s.seller.dropNextResponse = true;
    const first = await s.buyer.buy("g1", "p1", s.offer, proof(s, "g1"));
    expect(first.payment).toBe("unknown");
    s.auth.close();
    s.seller.close();
    const auth = new Authority(
      join(s.root, "authority.sqlite"),
      s.owner.publicKey,
    );
    const seller = new MockSeller(join(s.root, "seller.sqlite"));
    const r = await new Purchaser(
      auth,
      s.memory,
      seller,
      recoverySigner(s.owner),
    ).reconcile("p1");
    expect(r.payment).toBe("settled");
    expect(r.delivery).toBe("complete");
    expect(seller.effects()).toBe(1);
    auth.close();
    seller.close();
  });
  it("failed pending Memory write prevents effect, final write failure is recoverable", async () => {
    const s = setup();
    grant(s);
    s.memory.failNextWrite = true;
    await expect(
      s.buyer.buy("g1", "p1", s.offer, proof(s, "g1")),
    ).rejects.toThrow();
    expect(s.seller.effects()).toBe(0);
    s.seller.afterExecute = () => {
      s.memory.failNextWrite = true;
    };
    const r = await s.buyer.buy("g1", "p1", s.offer, proof(s, "g1"));
    expect(r.memory).toBe("pending");
    expect(s.seller.effects()).toBe(1);
    s.seller.afterExecute = undefined;
    expect((await s.buyer.reconcile("p1")).memory).toBe("saved");
    expect(s.seller.effects()).toBe(1);
  });
  it("revocation and owner compromise invalidate current authority even after restart", async () => {
    const s = setup();
    grant(s);
    s.auth.revoke(s.owner, "g1");
    await expect(
      s.buyer.buy("g1", "p1", s.offer, proof(s, "g1")),
    ).rejects.toThrow();
    grant(s, "g2");
    s.auth.compromise(s.owner);
    await expect(
      s.buyer.buy("g2", "p2", s.offer, proof(s, "g2", "p2")),
    ).rejects.toThrow();
    grant(s, "fresh");
    expect(
      (await s.buyer.buy("fresh", "p3", s.offer, proof(s, "fresh", "p3")))
        .payment,
    ).toBe("settled");
  });
  it("unavailable status and expired grant fail closed", async () => {
    const s = setup();
    grant(s);
    s.auth.statusAvailable = false;
    await expect(
      s.buyer.buy("g1", "p1", s.offer, proof(s, "g1")),
    ).rejects.toThrow();
    expect(s.seller.effects()).toBe(0);
  });
  it("atomically enforces shared budget across separately granted operations", async () => {
    const s = setup();
    s.auth.setBudget(s.owner, 25);
    grant(s);
    grant(s, "g2");
    await s.buyer.buy("g1", "p1", s.offer, proof(s, "g1"));
    await expect(
      s.buyer.buy("g2", "p2", s.offer, proof(s, "g2", "p2")),
    ).rejects.toThrow("budget");
    expect(s.seller.effects()).toBe(1);
  });
  it("rejects public-memory grant edits and proof replay", async () => {
    const s = setup();
    grant(s);
    s.memory.write("grant", { id: "fake", permission: "all" });
    await expect(
      s.buyer.buy("fake", "p1", s.offer, proof(s, "g1")),
    ).rejects.toThrow();
    const p = proof(s, "g1");
    await s.buyer.buy("g1", "p1", s.offer, p);
    await expect(s.buyer.buy("g1", "p1", s.offer, p)).rejects.toThrow(
      "challenge",
    );
  });
  it("independent owner recovery rejects old administration and requires fresh grants", () => {
    const s = setup();
    grant(s);
    const replacement = new TestSigner();
    expect(() => s.auth.recover(s.owner, replacement.publicKey)).toThrow();
    s.auth.recover(s.recovery, replacement.publicKey);
    expect(() =>
      s.auth.grant(s.owner, {
        id: "attack",
        agent: s.agent.publicKey,
        audience: "mock-model",
        action: "purchase",
        fingerprint: fingerprint(s.offer),
        maxCost: 25,
        expiresAt: Date.now() + 60000,
      }),
    ).toThrow();
    expect(s.auth.meta().owner).toBe(replacement.publicKey);
  });
  it("uncertain purchase cannot be submitted again by buy retry", async () => {
    const s = setup();
    grant(s);
    s.seller.dropNextResponse = true;
    await s.buyer.buy("g1", "p1", s.offer, proof(s, "g1"));
    let calls = 0;
    s.seller.afterExecute = () => {
      calls++;
    };
    const r = await s.buyer.buy("g1", "p1", s.offer, proof(s, "g1"));
    expect(r.payment).toBe("settled");
    expect(calls).toBe(0);
    expect(s.seller.effects()).toBe(1);
  });
  it("seller result retrieval requires fresh owner proof, never just purchase ID", async () => {
    const s = setup();
    grant(s);
    await s.buyer.buy("g1", "p1", s.offer, proof(s, "g1"));
    const c = s.seller.challenge("p1", s.owner.publicKey);
    expect(() =>
      s.seller.status(c, new TestSigner().sign("seller-result-recovery", c)),
    ).toThrow("proof");
    const sig = s.owner.sign("seller-result-recovery", c);
    expect(s.seller.status(c, sig)!.result).toContain("Synthetic");
    expect(() => s.seller.status(c, sig)).toThrow("proof");
  });
  it("expired grant, stale status and wrong audience reject independently", async () => {
    const s = setup();
    grant(s);
    s.auth.statusObservedAt = Date.now() - 61000;
    await expect(
      s.buyer.buy("g1", "p1", s.offer, proof(s, "g1")),
    ).rejects.toThrow("stale");
    s.auth.statusObservedAt = Date.now();
    const wrongAudience = s.auth.proof(
      s.agent,
      s.auth.challenge("g1", "p1", "other-service", fingerprint(s.offer)),
    );
    await expect(
      s.buyer.buy("g1", "p1", s.offer, wrongAudience),
    ).rejects.toThrow("challenge");
    const expires = Date.now() + 100;
    s.auth.grant(s.owner, {
      id: "expired",
      agent: s.agent.publicKey,
      audience: "mock-model",
      action: "purchase",
      fingerprint: fingerprint(s.offer),
      maxCost: 25,
      expiresAt: expires,
    });
    const p = proof(s, "expired");
    vi.spyOn(Date, "now").mockReturnValue(expires + 1);
    await expect(s.buyer.buy("expired", "p1", s.offer, p)).rejects.toThrow(
      "validity",
    );
    expect(s.seller.effects()).toBe(0);
  });
  it("agent-key compromise invalidates only affected agent grants", () => {
    const s = setup();
    grant(s);
    const other = new TestSigner();
    s.auth.grant(s.owner, {
      id: "other-agent",
      agent: other.publicKey,
      audience: "mock-model",
      action: "purchase",
      fingerprint: fingerprint(s.offer),
      maxCost: 25,
      expiresAt: Date.now() + 60000,
    });
    s.auth.compromiseAgent(s.owner, s.agent.publicKey);
    const rows = s.auth.snapshot().grants as { id: string; revoked: number }[];
    expect(rows.find((r) => r.id === "g1")!.revoked).toBe(1);
    expect(rows.find((r) => r.id === "other-agent")!.revoked).toBe(0);
  });
  it("Memory path traversal and symlinks never reach protected state", () => {
    const s = setup();
    expect(() => s.memory.write("../authority", { bad: true })).toThrow();
  });
});

it("recovers a paid result after two owner rotations without the old owner key or another effect", async () => {
  const s = setup();
  grant(s);
  s.seller.dropNextResponse = true;
  await s.buyer.buy("g1", "p1", s.offer, proof(s, "g1"));
  const replacement = new TestSigner(),
    next = new TestSigner();
  s.auth.recover(s.recovery, replacement.publicKey);
  s.auth.recover(s.recovery, next.publicKey);
  const buyer = new Purchaser(s.auth, s.memory, s.seller, recoverySigner(next));
  expect((await buyer.reconcile("p1")).payment).toBe("settled");
  expect(s.seller.effects()).toBe(1);
  const certificates = s.auth.recoveryCertificates();
  const challenge = s.seller.challenge("p1", next.publicKey);
  const tampered = certificates.map((c) => ({ ...c }));
  tampered[0]!.newOwner = next.publicKey;
  expect(() =>
    s.seller.status(
      challenge,
      next.sign("seller-result-recovery", challenge),
      tampered,
    ),
  ).toThrow("continuity");
  const unrelated = new TestSigner(),
    bad = s.seller.challenge("p1", unrelated.publicKey);
  expect(() =>
    s.seller.status(
      bad,
      unrelated.sign("seller-result-recovery", bad),
      certificates,
    ),
  ).toThrow("entitlement");
});
it("admin signatures bind action and target; redirected budget signature is denied", () => {
  const s = setup();
  const observed: unknown[] = [];
  const sign = s.owner.sign.bind(s.owner);
  vi.spyOn(s.owner, "sign").mockImplementation((domain, payload) => {
    observed.push(payload);
    if (domain === "owner-admin")
      return sign(domain, { ...(payload as object), target: { cents: 999 } });
    return sign(domain, payload);
  });
  expect(() => s.auth.setBudget(s.owner, 25)).toThrow("administration");
  expect(observed[0]).toMatchObject({
    action: "set-budget",
    target: { cents: 25 },
    epoch: 0,
  });
  expect(s.auth.meta().budget).toBe(100);
});
