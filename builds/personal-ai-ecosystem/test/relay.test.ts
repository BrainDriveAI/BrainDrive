import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MessagingKey, Messenger } from "../src/messaging.js";
import { Memory, TestSigner } from "../src/core.js";
import { LocalNostrRelay, publishWire, queryWire } from "../src/relay.js";
it("synthetic NIP-17 crosses real WebSockets, survives one relay shutdown and recipient restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "nostr-wire-"));
  const aOwner = new TestSigner(),
    bOwner = new TestSigner(),
    aKey = new MessagingKey(),
    bKey = new MessagingKey();
  const a = new Messenger(
    join(root, "a.sqlite"),
    aOwner.publicKey,
    aKey,
    new Memory(join(root, "a-memory")),
  );
  let b = new Messenger(
    join(root, "b.sqlite"),
    bOwner.publicKey,
    bKey,
    new Memory(join(root, "b-memory")),
  );
  let relayA: LocalNostrRelay | undefined, relayB: LocalNostrRelay | undefined;
  try {
    a.bind(aOwner, bKey.publicKey, "did:test:b");
    b.bind(bOwner, aKey.publicKey, "did:test:a");
    bKey.saveProtected(join(root, "protected-backup", "b-key"));
    relayA = await LocalNostrRelay.start(join(root, "relay-a.sqlite"));
    relayB = await LocalNostrRelay.start(join(root, "relay-b.sqlite"));
    const urlA = relayA.url,
      urlB = relayB.url;
    await relayA.close();
    relayA = undefined;
    b.close();
    a.queue(
      a.approve(aOwner, {
        id: "wire-1",
        recipient: bKey.publicKey,
        body: "Synthetic network message",
        sentAt: Date.now(),
      }),
    );
    expect(
      await a.sendVia("wire-1", [
        (event) => publishWire(urlA, event),
        (event) => publishWire(urlB, event),
      ]),
    ).toBe("transport-accepted");
    b = new Messenger(
      join(root, "b.sqlite"),
      bOwner.publicKey,
      MessagingKey.recoverProtected(join(root, "protected-backup", "b-key")),
      new Memory(join(root, "b-memory")),
    );
    const events = await queryWire(urlB, bKey.publicKey);
    expect(events).toHaveLength(1);
    expect(b.receive(events[0]!).newNotification).toBe(true);
    await a.sendVia("wire-1", [(event) => publishWire(urlB, event)]);
    expect(await queryWire(urlB, bKey.publicKey)).toHaveLength(1);
    expect(b.receive(events[0]!).newNotification).toBe(false);
  } finally {
    a.close();
    try {
      b.close();
    } catch {}
    if (relayA) await relayA.close();
    if (relayB) await relayB.close();
    rmSync(root, { recursive: true, force: true });
  }
});
