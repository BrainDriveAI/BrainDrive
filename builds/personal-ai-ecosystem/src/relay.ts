import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WebSocket, WebSocketServer } from "ws";
import { verifyEvent, type NostrEvent } from "nostr-tools/pure";
import { check, canonical } from "./core.js";
/** Deliberately small loopback NIP-01 EVENT/REQ/EOSE fixture, limited to NIP-17 wraps. */
export class LocalNostrRelay {
  readonly db: DatabaseSync;
  readonly server: WebSocketServer;
  private constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(
      "PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,recipient TEXT NOT NULL,body TEXT NOT NULL);",
    );
    chmodSync(file, 0o600);
    this.server = new WebSocketServer({
      host: "127.0.0.1",
      port: 0,
      maxPayload: 32768,
    });
    this.server.on("connection", (socket) =>
      socket.on("message", (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as unknown[];
          if (message[0] === "EVENT") {
            const event = message[1] as NostrEvent;
            const recipient = event?.tags?.find((t) => t[0] === "p")?.[1];
            check(
              event?.kind === 1059 &&
                recipient &&
                /^[a-f0-9]{64}$/.test(recipient) &&
                verifyEvent(event),
              "invalid event",
            );
            this.db
              .prepare("INSERT OR IGNORE INTO events VALUES (?,?,?)")
              .run(event.id, recipient, canonical(event));
            socket.send(
              JSON.stringify([
                "OK",
                event.id,
                true,
                "stored synthetic fixture",
              ]),
            );
          } else if (message[0] === "REQ") {
            const subscription = message[1];
            const filter = message[2] as { "#p"?: string[]; kinds?: number[] };
            check(
              typeof subscription === "string" &&
                subscription.length <= 100 &&
                filter.kinds?.length === 1 &&
                filter.kinds[0] === 1059 &&
                filter["#p"]?.length === 1,
              "unsupported filter",
            );
            const recipient = filter["#p"][0];
            check(
              recipient && /^[a-f0-9]{64}$/.test(recipient),
              "recipient filter",
            );
            for (const row of this.db
              .prepare(
                "SELECT body FROM events WHERE recipient=? ORDER BY id LIMIT 100",
              )
              .all(recipient) as { body: string }[])
              socket.send(
                JSON.stringify(["EVENT", subscription, JSON.parse(row.body)]),
              );
            socket.send(JSON.stringify(["EOSE", subscription]));
          } else check(message[0] === "CLOSE", "unsupported relay message");
        } catch {
          socket.send(
            JSON.stringify([
              "NOTICE",
              "invalid or unsupported fixture request",
            ]),
          );
        }
      }),
    );
  }
  static async start(file: string) {
    const relay = new LocalNostrRelay(file);
    await new Promise<void>((resolve, reject) => {
      relay.server.once("listening", resolve);
      relay.server.once("error", reject);
    });
    return relay;
  }
  get url() {
    const addr = this.server.address();
    check(addr && typeof addr !== "string", "relay address");
    return "ws://127.0.0.1:" + addr.port;
  }
  async close() {
    for (const socket of this.server.clients) socket.terminate();
    await new Promise<void>((resolve, reject) =>
      this.server.close((e) => (e ? reject(e) : resolve())),
    );
    this.db.close();
  }
}
function connect(url: string) {
  const u = new URL(url);
  check(
    u.protocol === "ws:" &&
      u.hostname === "127.0.0.1" &&
      !u.username &&
      !u.password,
    "fixture relay destination",
  );
  return new WebSocket(url, { maxPayload: 32768 });
}
export async function publishWire(url: string, event: NostrEvent) {
  const socket = connect(url);
  return new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("relay timeout"));
    }, 2000);
    const finish = () => clearTimeout(timer);
    socket.once("error", (error) => {
      finish();
      reject(error);
    });
    socket.once("open", () => socket.send(JSON.stringify(["EVENT", event])));
    socket.on("message", (raw) => {
      try {
        const m = JSON.parse(raw.toString()) as unknown[];
        check(m[0] === "OK" && m[1] === event.id, "unexpected relay response");
        finish();
        socket.close();
        resolve(m[2] === true);
      } catch (e) {
        finish();
        socket.terminate();
        reject(e);
      }
    });
  });
}
export async function queryWire(url: string, recipient: string) {
  const socket = connect(url);
  return new Promise<NostrEvent[]>((resolve, reject) => {
    const events: NostrEvent[] = [];
    const subscription = "synthetic-subscription";
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("relay timeout"));
    }, 2000);
    const finish = () => clearTimeout(timer);
    socket.once("error", (error) => {
      finish();
      reject(error);
    });
    socket.once("open", () =>
      socket.send(
        JSON.stringify([
          "REQ",
          subscription,
          { kinds: [1059], "#p": [recipient] },
        ]),
      ),
    );
    socket.on("message", (raw) => {
      try {
        const m = JSON.parse(raw.toString()) as unknown[];
        check(m[1] === subscription, "unexpected subscription");
        if (m[0] === "EVENT") {
          const event = m[2] as NostrEvent;
          check(
            events.length < 100 && verifyEvent(event),
            "invalid relay event",
          );
          events.push(event);
        } else {
          check(m[0] === "EOSE", "unexpected relay response");
          finish();
          socket.close();
          resolve(events);
        }
      } catch (e) {
        finish();
        socket.terminate();
        reject(e);
      }
    });
  });
}
