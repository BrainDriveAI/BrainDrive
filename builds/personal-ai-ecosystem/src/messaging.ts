import { mkdirSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  generateSecretKey,
  getPublicKey,
  verifyEvent,
  type NostrEvent,
} from "nostr-tools/pure";
import { wrapEvent, unwrapEvent } from "nostr-tools/nip17";
import {
  check,
  canonical,
  fingerprint,
  Memory,
  TestSigner,
  validSignature,
} from "./core.js";
export class MessagingKey {
  #secret: Uint8Array;
  readonly publicKey: string;
  constructor(secret = generateSecretKey()) {
    check(secret.length === 32, "messaging key length");
    this.#secret = secret;
    this.publicKey = getPublicKey(this.#secret);
  }
  saveProtected(file: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, this.#secret, { mode: 0o600, flag: "wx" });
  }
  static recoverProtected(file: string) {
    return new MessagingKey(readFileSync(file));
  }
  wrap(recipient: string, message: string): NostrEvent {
    return wrapEvent(this.#secret, { publicKey: recipient }, message);
  }
  unwrap(event: NostrEvent) {
    return unwrapEvent(event, this.#secret);
  }
}
export interface Message {
  id: string;
  recipient: string;
  body: string;
  sentAt: number;
}
export interface Approval {
  message: Message;
  epoch: number;
  signature: string;
}
/** Local relay fixtures. These implement publication/storage semantics, not a public Nostr relay. */
export class RelayFixture {
  available = true;
  private events = new Map<string, NostrEvent>();
  publish(event: NostrEvent) {
    check(this.available, "relay unavailable");
    check(verifyEvent(structuredClone(event)), "invalid relay event");
    this.events.set(event.id, structuredClone(event));
    return "transport-accepted" as const;
  }
  query(recipient: string) {
    check(this.available, "relay unavailable");
    return [...this.events.values()]
      .filter((e) => e.tags.some((t) => t[0] === "p" && t[1] === recipient))
      .map((e) => structuredClone(e));
  }
}
export class Messenger {
  readonly db: DatabaseSync;
  constructor(
    file: string,
    readonly ownerKey: string,
    readonly keys: MessagingKey,
    readonly memory: Memory,
  ) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db
      .exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS meta(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,messaging TEXT NOT NULL,epoch INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS contacts(pubkey TEXT PRIMARY KEY,identity TEXT NOT NULL,approval TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,body TEXT NOT NULL,event TEXT NOT NULL,epoch INTEGER NOT NULL,status TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS inbox(sender TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL,stored INTEGER NOT NULL DEFAULT 0,notified INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(sender,id));`);
    this.db
      .prepare("INSERT OR IGNORE INTO meta VALUES (1,?,?,0)")
      .run(ownerKey, keys.publicKey);
    chmodSync(file, 0o600);
    const meta = this.db
      .prepare("SELECT owner,messaging FROM meta WHERE id=1")
      .get() as { owner: string; messaging: string };
    check(
      meta.owner === ownerKey && meta.messaging === keys.publicKey,
      "messaging owner mismatch",
    );
  }
  epoch() {
    return (
      this.db.prepare("SELECT epoch FROM meta WHERE id=1").get() as {
        epoch: number;
      }
    ).epoch;
  }
  bind(owner: TestSigner, publicKey: string, identity: string) {
    check(/^[a-f0-9]{64}$/.test(publicKey), "contact key");
    const payload = { publicKey, identity, epoch: this.epoch() };
    const approval = owner.sign("contact-binding", payload);
    check(
      validSignature(this.ownerKey, "contact-binding", payload, approval),
      "contact approval",
    );
    this.db
      .prepare("INSERT OR REPLACE INTO contacts VALUES (?,?,?)")
      .run(publicKey, identity, canonical({ payload, approval }));
  }
  approve(owner: TestSigner, message: Message): Approval {
    const epoch = this.epoch();
    const signature = owner.sign("message-approval", { message, epoch });
    return { message, epoch, signature };
  }
  queue(approval: Approval) {
    const { message, epoch, signature } = approval;
    check(
      /^[\w-]{1,100}$/.test(message.id) &&
        Buffer.byteLength(message.body) <= 4096,
      "message size/id",
    );
    check(Number.isSafeInteger(message.sentAt), "message time");
    check(
      epoch === this.epoch() &&
        validSignature(
          this.ownerKey,
          "message-approval",
          { message, epoch },
          signature,
        ),
      "message approval",
    );
    this.contact(message.recipient);
    const row = this.db
      .prepare("SELECT body FROM outbox WHERE id=?")
      .get(message.id) as { body: string } | undefined;
    if (row) {
      check(row.body === canonical(message), "outbox id conflict");
      return;
    }
    const event = this.keys.wrap(message.recipient, canonical(message));
    this.db
      .prepare("INSERT INTO outbox VALUES (?,?,?,?,?)")
      .run(message.id, canonical(message), canonical(event), epoch, "queued");
  }
  send(id: string, relays: RelayFixture[]) {
    const row = this.db
      .prepare("SELECT event,epoch,status FROM outbox WHERE id=?")
      .get(id) as { event: string; epoch: number; status: string } | undefined;
    check(
      row && row.epoch === this.epoch() && row.status !== "imported-history",
      "outbox authority",
    );
    const event = JSON.parse(row.event) as NostrEvent;
    let accepted = false;
    for (const relay of relays) {
      try {
        relay.publish(event);
        accepted = true;
      } catch {
        /* Exact persisted event is retained for a later authorized retry. */
      }
    }
    this.db
      .prepare("UPDATE outbox SET status=? WHERE id=?")
      .run(accepted ? "transport-accepted" : "uncertain", id);
    return accepted ? "transport-accepted" : "uncertain";
  }
  async sendVia(
    id: string,
    publishers: ((event: NostrEvent) => Promise<boolean>)[],
  ) {
    const row = this.db
      .prepare("SELECT event,epoch,status FROM outbox WHERE id=?")
      .get(id) as { event: string; epoch: number; status: string } | undefined;
    check(
      row && row.epoch === this.epoch() && row.status !== "imported-history",
      "outbox authority",
    );
    let accepted = false;
    for (const publish of publishers) {
      check(row.epoch === this.epoch(), "outbox authority");
      try {
        accepted =
          (await publish(JSON.parse(row.event) as NostrEvent)) || accepted;
      } catch {
        /* Persist uncertainty, never claim delivery. */
      }
    }
    this.db
      .prepare("UPDATE outbox SET status=? WHERE id=?")
      .run(accepted ? "transport-accepted" : "uncertain", id);
    return accepted ? "transport-accepted" : "uncertain";
  }
  receive(event: NostrEvent) {
    check(
      Buffer.byteLength(event.content) <= 20000 &&
        event.kind === 1059 &&
        verifyEvent(structuredClone(event)),
      "invalid gift wrap",
    );
    check(
      event.tags.some((t) => t[0] === "p" && t[1] === this.keys.publicKey),
      "wrong recipient",
    );
    const rumor = this.keys.unwrap(structuredClone(event));
    check(
      rumor.kind === 14 &&
        rumor.tags.some((t) => t[0] === "p" && t[1] === this.keys.publicKey),
      "inner recipient",
    );
    this.contact(rumor.pubkey);
    const msg = JSON.parse(rumor.content) as Message;
    check(
      msg &&
        /^[\w-]{1,100}$/.test(msg.id) &&
        msg.recipient === this.keys.publicKey &&
        typeof msg.body === "string" &&
        Buffer.byteLength(msg.body) <= 4096 &&
        Number.isSafeInteger(msg.sentAt),
      "message schema",
    );
    const hash = fingerprint(msg);
    const existing = this.db
      .prepare("SELECT hash FROM inbox WHERE sender=? AND id=?")
      .get(rumor.pubkey, msg.id) as { hash: string } | undefined;
    check(!existing || existing.hash === hash, "conflicting logical message");
    this.db
      .prepare(
        "INSERT OR IGNORE INTO inbox(sender,id,body,hash) VALUES (?,?,?,?)",
      )
      .run(rumor.pubkey, msg.id, canonical(msg), hash);
    // Failed final Memory persistence leaves the inbox pending; no acknowledgement or notification.
    this.memory.write(
      "message-" +
        fingerprint({ sender: rumor.pubkey, id: msg.id }).slice(0, 32),
      {
        sender: rumor.pubkey,
        message: msg,
        transportEvent: event.id,
        receipt: "endpoint-recorded",
        humanRead: "unsupported",
      },
    );
    const changed = this.db
      .prepare(
        "UPDATE inbox SET stored=1,notified=1 WHERE sender=? AND id=? AND notified=0",
      )
      .run(rumor.pubkey, msg.id);
    return {
      receipt: "endpoint-recorded",
      newNotification: changed.changes === 1,
    };
  }
  private contact(key: string) {
    const row = this.db
      .prepare("SELECT approval FROM contacts WHERE pubkey=?")
      .get(key) as { approval: string } | undefined;
    check(row, "unknown or blocked contact");
    const { payload, approval } = JSON.parse(row.approval) as {
      payload: { publicKey: string; identity: string; epoch: number };
      approval: string;
    };
    check(
      payload.publicKey === key &&
        payload.epoch === this.epoch() &&
        validSignature(this.ownerKey, "contact-binding", payload, approval),
      "stale contact binding",
    );
  }
  invalidate(owner: TestSigner) {
    const payload = { epoch: this.epoch() };
    check(
      validSignature(
        this.ownerKey,
        "messaging-recovery",
        payload,
        owner.sign("messaging-recovery", payload),
      ),
      "messaging recovery",
    );
    this.db.exec("UPDATE meta SET epoch=epoch+1;");
  }
  notifications() {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM inbox WHERE notified=1")
        .get() as { n: number }
    ).n;
  }
  snapshot() {
    return {
      schema: 1,
      inbox: this.db.prepare("SELECT * FROM inbox ORDER BY sender,id").all(),
      outbox: this.db.prepare("SELECT * FROM outbox ORDER BY id").all(),
      contacts: this.db.prepare("SELECT * FROM contacts ORDER BY pubkey").all(),
      epoch: this.epoch(),
    };
  }
  close() {
    this.db.close();
  }
}
