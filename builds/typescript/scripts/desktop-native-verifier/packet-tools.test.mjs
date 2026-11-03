import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateDigest } from "./verification-contract.mjs";
import { digestPath, signKatiePacket, verifyExternalPacket, verifyKatiePacket } from "./packet-tools.mjs";

test("Katie packet signatures cover the complete unsigned packet", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const packet = signKatiePacket({
    startedAt: "2026-09-22T12:00:00.000Z",
    openVisibleAt: "2026-09-22T12:02:00.000Z",
    informationBoundary: { signed: true, sources: ["forum post", "production client"] },
    path: ["forum", "Apps", "Install", "Open"],
  }, privateKey);
  assert.equal(verifyKatiePacket(packet, publicKey), true);
  packet.path.push("outside-help");
  assert.equal(verifyKatiePacket(packet, publicKey), false);
});

test("external packets require a valid signature, candidate digest, and fixture digest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "braindrive-packet-integrity-"));
  await writeFile(path.join(root, "raw.json"), "raw evidence\n");
  const candidate = { head: "abc123", branch: "test", platform: "win32", architecture: "x64" };
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const packet = signKatiePacket({
    candidateDigest: candidateDigest(candidate),
    fixtureDigest: await digestPath(root),
    rawEvidence: { events: [{ type: "proof", timestamp: "2026-09-23T00:00:00.000Z" }] },
  }, privateKey);
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.equal((await verifyExternalPacket(packet, { publicKeyPem, candidate, fixturePath: root })).valid, true);
  assert.equal((await verifyExternalPacket(packet, { publicKeyPem, candidate: { ...candidate, head: "different" }, fixturePath: root })).valid, false);
  assert.equal((await verifyExternalPacket({ ...packet, signature: undefined }, { publicKeyPem, candidate, fixturePath: root })).valid, false);
});
