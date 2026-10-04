import { afterEach, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import {
  Authority,
  Memory,
  MockSeller,
  Purchaser,
  TestSigner,
  fingerprint,
  recoverySigner,
} from "../src/core.js";
const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.splice(0)) f();
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), "ecosystem-process-"));
  const owner = new TestSigner(),
    agent = new TestSigner();
  const auth = new Authority(join(root, "authority.sqlite"), owner.publicKey);
  const seller = new MockSeller(join(root, "seller.sqlite"));
  const memory = new Memory(join(root, "memory"));
  const offer = seller.offer("synthetic crash fixture", 25);
  clean.push(() => {
    auth.close();
    seller.close();
    rmSync(root, { recursive: true, force: true });
  });
  const grant = (id: string) =>
    auth.grant(owner, {
      id,
      agent: agent.publicKey,
      audience: "mock-model",
      action: "purchase",
      fingerprint: fingerprint(offer),
      maxCost: 25,
      expiresAt: Date.now() + 60000,
    });
  return { root, owner, agent, auth, seller, memory, offer, grant };
}
function worker(
  s: ReturnType<typeof setup>,
  grantId: string,
  id: string,
  mode = "reserve",
) {
  const path = join(s.root, id + ".json");
  const proof = s.auth.proof(
    s.agent,
    s.auth.challenge(grantId, id, "mock-model", fingerprint(s.offer)),
  );
  writeFileSync(
    path,
    JSON.stringify({
      authority: join(s.root, "authority.sqlite"),
      owner: s.owner.publicKey,
      id,
      grantId,
      offer: s.offer,
      proof,
      mode,
      memory: s.memory.root,
      seller: join(s.root, "seller.sqlite"),
    }),
  );
  return new Promise<{
    code: number | null;
    signal: string | null;
    output: string;
  }>((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/process-worker.ts", path],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (d) => {
      output += d.toString();
    });
    child.stderr.on("data", (d) => {
      output += d.toString();
    });
    child.on("close", (code, signal) => resolve({ code, signal, output }));
  });
}
it("two concurrent OS processes cannot consume the same one-use grant", async () => {
  const s = setup();
  s.grant("g1");
  const results = await Promise.all([
    worker(s, "g1", "p1"),
    worker(s, "g1", "p2"),
  ]);
  expect(results.filter((r) => r.code === 0)).toHaveLength(1);
  expect(results.filter((r) => r.code === 1)[0]!.output).toContain("consumed");
  expect(s.auth.snapshot().operations).toHaveLength(1);
});
it("two concurrent OS processes with different grants share one atomic budget", async () => {
  const s = setup();
  s.grant("g1");
  s.grant("g2");
  s.auth.setBudget(s.owner, 25);
  const results = await Promise.all([
    worker(s, "g1", "p1"),
    worker(s, "g2", "p2"),
  ]);
  expect(results.filter((r) => r.code === 0)).toHaveLength(1);
  expect(results.filter((r) => r.code === 1)[0]!.output).toContain("budget");
  expect(s.auth.snapshot().operations).toHaveLength(1);
});
it("SIGKILL after seller effect recovers from pre-effect journal without a second charge", async () => {
  const s = setup();
  s.grant("g1");
  const crash = await worker(s, "g1", "p1", "crash-after-effect");
  expect(crash.signal).toBe("SIGKILL");
  expect(s.seller.effects()).toBe(1);
  expect(s.auth.operation("p1")!.submitted).toBe(true);
  const buyer = new Purchaser(
    s.auth,
    s.memory,
    s.seller,
    recoverySigner(s.owner),
  );
  const fresh = s.auth.proof(
    s.agent,
    s.auth.challenge("g1", "p1", "mock-model", fingerprint(s.offer)),
  );
  const result = await buyer.buy("g1", "p1", s.offer, fresh);
  expect(result.payment).toBe("settled");
  expect(result.delivery).toBe("complete");
  expect(s.seller.effects()).toBe(1);
});
