import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  randomUUID,
  type KeyObject,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  chmodSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
    return (
      "{" +
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  throw new Error("unsupported canonical data");
}
export const fingerprint = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export class TestSigner {
  readonly publicKey: string;
  #key: KeyObject;
  constructor(pem?: string) {
    const pair = pem
      ? { privateKey: createPrivateKey(pem), publicKey: createPublicKey(pem) }
      : generateKeyPairSync("ed25519");
    this.#key = pair.privateKey;
    this.publicKey = pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
  }
  sign(domain: string, payload: unknown) {
    return sign(
      null,
      Buffer.from(domain + "\n" + canonical(payload)),
      this.#key,
    ).toString("base64");
  }
  // Fixture setup only. Never exposed by an agent-facing tool or stored in Memory.
  saveProtected(file: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, this.#key.export({ type: "pkcs8", format: "pem" }), {
      mode: 0o600,
      flag: "wx",
    });
  }
}
export function validSignature(
  key: string,
  domain: string,
  payload: unknown,
  signature: string,
): boolean {
  try {
    return verify(
      null,
      Buffer.from(domain + "\n" + canonical(payload)),
      createPublicKey(key),
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}
export function atomicFile(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + randomUUID() + ".tmp";
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, file);
  const dir = openSync(dirname(file), "r");
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
export class Memory {
  failNextWrite = false;
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    check(!lstatSync(root).isSymbolicLink(), "memory symlink");
  }
  write(id: string, value: unknown) {
    check(/^[a-zA-Z0-9_-]{1,100}$/.test(id), "unsafe Memory id");
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("injected Memory write failure");
    }
    const file = join(this.root, id + ".json");
    check(
      !existsSync(file) || !lstatSync(file).isSymbolicLink(),
      "memory symlink",
    );
    atomicFile(file, JSON.stringify(value, null, 2) + "\n");
  }
  readAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const file of readdirSync(this.root)) {
      check(/^[a-zA-Z0-9_-]{1,100}\.json$/.test(file), "unknown Memory file");
      const path = join(this.root, file);
      check(
        lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(),
        "memory symlink",
      );
      result[file] = JSON.parse(readFileSync(path, "utf8"));
    }
    return result;
  }
}
export interface GrantInput {
  id: string;
  agent: string;
  audience: string;
  action: string;
  fingerprint: string;
  maxCost: number;
  expiresAt: number;
}
export interface RecoveryCertificate {
  oldOwner: string;
  newOwner: string;
  recoveryKey: string;
  epoch: number;
  nonce: string;
  signature: string;
}
export interface Grant extends GrantInput {
  recoveryKey: string;
  issuer: string;
  epoch: number;
  issuedAt: number;
  signature: string;
}
export interface Challenge {
  id: string;
  grantId: string;
  operationId: string;
  audience: string;
  fingerprint: string;
  expiresAt: number;
}
export interface Proof {
  challenge: Challenge;
  signature: string;
}
export interface Offer {
  seller: string;
  service: string;
  payee: string;
  asset: string;
  network: string;
  amount: number;
  fees: number;
  expiresAt: number;
  input: string;
  disclosure: string[];
  outputLimit: number;
}
export interface Operation {
  id: string;
  grantId: string;
  fingerprint: string;
  cost: number;
  offer: Offer;
  payment: "pending" | "unknown" | "settled" | "failed";
  delivery: "pending" | "complete";
  memory: "pending" | "saved";
  submitted: boolean;
  result?: string;
}
export class Authority {
  readonly db: DatabaseSync;
  statusAvailable = true;
  statusObservedAt = Date.now();
  constructor(
    file: string,
    initialOwnerKey: string,
    recoveryKey = initialOwnerKey,
  ) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db
      .exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,recovery TEXT NOT NULL,epoch INTEGER NOT NULL,budget INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1,authorityId TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY,body TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,operation TEXT);
 CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY,body TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS recoveries(epoch INTEGER PRIMARY KEY,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY,body TEXT NOT NULL,cost INTEGER NOT NULL);
 `);
    this.db
      .prepare("INSERT OR IGNORE INTO meta VALUES (1,?,?,0,100,1,?)")
      .run(initialOwnerKey, recoveryKey, randomUUID());
    chmodSync(file, 0o600);
    check(this.meta().owner === initialOwnerKey, "owner mismatch");
  }
  get ownerKey() {
    return this.meta().owner;
  }
  meta() {
    return this.db.prepare("SELECT * FROM meta WHERE id=1").get() as {
      owner: string;
      recovery: string;
      epoch: number;
      budget: number;
      active: number;
      authorityId: string;
    };
  }
  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  private admin(owner: TestSigner, action: string, target: unknown) {
    const payload = {
      nonce: randomUUID(),
      epoch: this.meta().epoch,
      action,
      target,
    };
    check(this.meta().active === 1, "host authority fenced");
    check(
      validSignature(
        this.ownerKey,
        "owner-admin",
        payload,
        owner.sign("owner-admin", payload),
      ),
      "owner administration denied",
    );
  }
  grant(owner: TestSigner, input: GrantInput) {
    return this.tx(() => {
      this.admin(owner, "grant", input);
      check(/^[\w-]{1,100}$/.test(input.id), "grant id");
      check(
        Number.isSafeInteger(input.maxCost) && input.maxCost >= 0,
        "grant cost",
      );
      check(input.expiresAt > Date.now(), "expired grant");
      check(
        input.audience &&
          input.action &&
          /^[a-f0-9]{64}$/.test(input.fingerprint),
        "grant scope",
      );
      const body = {
        ...input,
        issuer: this.ownerKey,
        recoveryKey: this.meta().recovery,
        epoch: this.meta().epoch,
        issuedAt: Date.now(),
      };
      const grant: Grant = {
        ...body,
        signature: owner.sign("owner-grant", body),
      };
      this.db
        .prepare("INSERT INTO grants(id,body) VALUES (?,?)")
        .run(input.id, canonical(grant));
      return grant;
    });
  }
  revoke(owner: TestSigner, id: string) {
    this.tx(() => {
      this.admin(owner, "revoke", { id });
      check(
        this.db.prepare("UPDATE grants SET revoked=1 WHERE id=?").run(id)
          .changes === 1,
        "missing grant",
      );
    });
  }
  compromise(owner: TestSigner) {
    this.tx(() => {
      this.admin(owner, "compromise-owner", { owner: this.ownerKey });
      this.db.exec(
        "UPDATE meta SET epoch=epoch+1;UPDATE grants SET revoked=1;",
      );
    });
  }
  recover(recovery: TestSigner, newOwnerKey: string) {
    check(newOwnerKey !== this.ownerKey, "replacement owner required");
    this.tx(() => {
      check(this.meta().active === 1, "host authority fenced");
      const payload = {
        oldOwner: this.ownerKey,
        newOwner: newOwnerKey,
        recoveryKey: this.meta().recovery,
        epoch: this.meta().epoch + 1,
        nonce: randomUUID(),
      };
      const signature = recovery.sign("owner-recovery", payload);
      check(
        validSignature(
          this.meta().recovery,
          "owner-recovery",
          payload,
          signature,
        ),
        "independent recovery denied",
      );
      this.db
        .prepare("INSERT INTO recoveries VALUES (?,?)")
        .run(payload.epoch, canonical({ ...payload, signature }));
      this.db
        .prepare("UPDATE meta SET owner=?,epoch=epoch+1 WHERE id=1")
        .run(newOwnerKey);
      this.db.exec("UPDATE grants SET revoked=1;");
    });
  }
  recoveryCertificates(): RecoveryCertificate[] {
    return (
      this.db.prepare("SELECT body FROM recoveries ORDER BY epoch").all() as {
        body: string;
      }[]
    ).map((r) => JSON.parse(r.body) as RecoveryCertificate);
  }
  compromiseAgent(owner: TestSigner, agent: string) {
    this.tx(() => {
      this.admin(owner, "compromise-agent", { agent });
      for (const row of this.db.prepare("SELECT id,body FROM grants").all() as {
        id: string;
        body: string;
      }[])
        if ((JSON.parse(row.body) as Grant).agent === agent)
          this.db.prepare("UPDATE grants SET revoked=1 WHERE id=?").run(row.id);
    });
  }
  setBudget(owner: TestSigner, cents: number) {
    this.tx(() => {
      this.admin(owner, "set-budget", { cents });
      check(Number.isSafeInteger(cents) && cents >= 0, "budget units");
      this.db.prepare("UPDATE meta SET budget=? WHERE id=1").run(cents);
    });
  }
  challenge(
    grantId: string,
    operationId: string,
    audience: string,
    fp: string,
  ): Challenge {
    const c = {
      id: randomUUID(),
      grantId,
      operationId,
      audience,
      fingerprint: fp,
      expiresAt: Date.now() + 30000,
    };
    this.db
      .prepare("INSERT INTO challenges(id,body) VALUES (?,?)")
      .run(c.id, canonical(c));
    return c;
  }
  proof(agent: TestSigner, challenge: Challenge): Proof {
    return { challenge, signature: agent.sign("agent-operation", challenge) };
  }
  reserve(grantId: string, id: string, offer: Offer, proof: Proof): Operation {
    return this.tx(() => {
      check(this.meta().active === 1, "host authority fenced");
      check(
        this.statusAvailable && Date.now() - this.statusObservedAt < 60000,
        "unavailable or stale authority",
      );
      check(/^[\w-]{1,100}$/.test(id), "operation id");
      const now = Date.now();
      check(
        Number.isSafeInteger(offer.amount) &&
          Number.isSafeInteger(offer.fees) &&
          offer.amount >= 0 &&
          offer.fees >= 0 &&
          Number.isSafeInteger(offer.amount + offer.fees),
        "offer units",
      );
      check(
        offer.expiresAt > now &&
          offer.asset === "TEST-CENTS" &&
          offer.network === "mock",
        "expired or unsupported offer",
      );
      const row = this.db
        .prepare("SELECT * FROM grants WHERE id=?")
        .get(grantId) as
        { body: string; revoked: number; operation: string | null } | undefined;
      check(row, "unknown grant");
      const grant = JSON.parse(row.body) as Grant;
      const { signature, ...signed } = grant;
      check(
        validSignature(this.ownerKey, "owner-grant", signed, signature),
        "grant signature",
      );
      check(
        !row.revoked && grant.epoch === this.meta().epoch,
        "revoked authority",
      );
      check(grant.expiresAt > now && grant.issuedAt <= now, "grant validity");
      check(
        grant.action === "purchase" &&
          grant.audience === offer.service &&
          grant.fingerprint === fingerprint(offer) &&
          offer.amount + offer.fees <= grant.maxCost,
        "grant scope",
      );
      const c = proof.challenge;
      const ch = this.db
        .prepare("SELECT body,used FROM challenges WHERE id=?")
        .get(c.id) as { body: string; used: number } | undefined;
      check(
        ch &&
          !ch.used &&
          ch.body === canonical(c) &&
          c.expiresAt > now &&
          c.grantId === grantId &&
          c.operationId === id &&
          c.audience === offer.service &&
          c.fingerprint === fingerprint(offer),
        "invalid or reused challenge",
      );
      check(
        validSignature(grant.agent, "agent-operation", c, proof.signature),
        "agent proof",
      );
      this.db.prepare("UPDATE challenges SET used=1 WHERE id=?").run(c.id);
      const prior = this.operation(id);
      if (prior) {
        check(
          prior.grantId === grantId && prior.fingerprint === fingerprint(offer),
          "operation conflict",
        );
        return prior;
      }
      check(row.operation === null, "one-use grant consumed");
      const total = this.db
        .prepare("SELECT COALESCE(SUM(cost),0) AS total FROM operations")
        .get() as { total: number };
      check(
        total.total + offer.amount + offer.fees <= this.meta().budget,
        "shared budget exceeded",
      );
      const operation: Operation = {
        id,
        grantId,
        fingerprint: fingerprint(offer),
        cost: offer.amount + offer.fees,
        offer,
        payment: "pending",
        delivery: "pending",
        memory: "pending",
        submitted: false,
      };
      this.db
        .prepare("INSERT INTO operations VALUES (?,?,?)")
        .run(id, canonical(operation), operation.cost);
      this.db
        .prepare("UPDATE grants SET operation=? WHERE id=?")
        .run(id, grantId);
      return operation;
    });
  }
  authorization(id: string): Grant {
    const row = this.db
      .prepare("SELECT body FROM grants WHERE id=?")
      .get(id) as { body: string } | undefined;
    check(row, "missing grant");
    return JSON.parse(row.body) as Grant;
  }
  operation(id: string): Operation | undefined {
    const row = this.db
      .prepare("SELECT body FROM operations WHERE id=?")
      .get(id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as Operation) : undefined;
  }
  update(op: Operation) {
    check(
      this.db
        .prepare("UPDATE operations SET body=? WHERE id=?")
        .run(canonical(op), op.id).changes === 1,
      "missing operation",
    );
  }
  snapshot() {
    return {
      schema: 1,
      meta: this.meta(),
      recoveries: this.recoveryCertificates(),
      grants: this.db
        .prepare("SELECT id,body,revoked,operation FROM grants ORDER BY id")
        .all(),
      operations: this.db
        .prepare("SELECT id,body,cost FROM operations ORDER BY id")
        .all(),
    };
  }
  close() {
    this.db.close();
  }
}
export class MockSeller {
  readonly db: DatabaseSync;
  dropNextResponse = false;
  afterExecute: (() => void) | undefined;
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(
      "PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS purchases(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,buyer TEXT NOT NULL,recovery TEXT NOT NULL,result TEXT NOT NULL);CREATE TABLE IF NOT EXISTS retrievals(id TEXT PRIMARY KEY,body TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0);",
    );
  }
  offer(input: string, amount: number): Offer {
    return {
      seller: "fixture-seller",
      service: "mock-model",
      payee: "fixture-payee",
      asset: "TEST-CENTS",
      network: "mock",
      amount,
      fees: 0,
      expiresAt: Date.now() + 60000,
      input,
      disclosure: ["synthetic-prompt"],
      outputLimit: 100,
    };
  }
  execute(id: string, offer: Offer, ticket: { grant: Grant; proof: Proof }) {
    check(
      offer.seller === "fixture-seller" &&
        offer.payee === "fixture-payee" &&
        offer.service === "mock-model",
      "seller binding",
    );
    check(
      offer.expiresAt > Date.now() &&
        Number.isSafeInteger(offer.amount) &&
        offer.amount >= 0 &&
        Number.isSafeInteger(offer.fees) &&
        offer.fees >= 0 &&
        offer.asset === "TEST-CENTS" &&
        offer.network === "mock",
      "expired or unsupported offer",
    );
    const { signature, ...body } = ticket.grant;
    check(
      validSignature(body.issuer, "owner-grant", body, signature) &&
        body.action === "purchase" &&
        body.audience === offer.service &&
        body.fingerprint === fingerprint(offer) &&
        body.expiresAt > Date.now() &&
        offer.amount + offer.fees <= body.maxCost,
      "seller authorization",
    );
    const c = ticket.proof.challenge;
    check(
      c.operationId === id &&
        c.grantId === body.id &&
        c.audience === offer.service &&
        c.fingerprint === fingerprint(offer) &&
        c.expiresAt > Date.now() &&
        validSignature(
          body.agent,
          "agent-operation",
          c,
          ticket.proof.signature,
        ),
      "seller operation proof",
    );
    const buyer = body.issuer;
    const fp = fingerprint(offer);
    const result =
      "Synthetic model response: " + offer.input.slice(0, offer.outputLimit);
    this.db
      .prepare("INSERT OR IGNORE INTO purchases VALUES (?,?,?,?,?)")
      .run(id, fp, buyer, body.recoveryKey, result);
    const row = this.read(id);
    check(
      row && row.buyer === buyer && row.fingerprint === fp,
      "seller purchase conflict",
    );
    this.afterExecute?.();
    if (this.dropNextResponse) {
      this.dropNextResponse = false;
      throw new Error("response dropped after settlement");
    }
    return row;
  }
  challenge(id: string, buyer: string) {
    const challenge = {
      nonce: randomUUID(),
      id,
      buyer,
      expiresAt: Date.now() + 30000,
    };
    this.db
      .prepare("INSERT INTO retrievals(id,body) VALUES (?,?)")
      .run(challenge.nonce, canonical(challenge));
    return challenge;
  }
  status(
    challenge: ReturnType<MockSeller["challenge"]>,
    signature: string,
    continuity: RecoveryCertificate[] = [],
  ) {
    const row = this.db
      .prepare("SELECT body,used FROM retrievals WHERE id=?")
      .get(challenge.nonce) as { body: string; used: number } | undefined;
    check(
      row &&
        !row.used &&
        row.body === canonical(challenge) &&
        challenge.expiresAt > Date.now() &&
        validSignature(
          challenge.buyer,
          "seller-result-recovery",
          challenge,
          signature,
        ),
      "buyer entitlement proof",
    );
    check(
      this.db
        .prepare("UPDATE retrievals SET used=1 WHERE id=? AND used=0")
        .run(challenge.nonce).changes === 1,
      "retrieval replay",
    );
    const result = this.read(challenge.id);
    if (result && result.buyer !== challenge.buyer) {
      let entitled = result.buyer;
      let previousEpoch = -1;
      for (const certificate of continuity) {
        const { signature, ...payload } = certificate;
        // Certificates preceding this purchase's issuer do not form its chain.
        if (payload.oldOwner !== entitled) continue;
        check(
          payload.recoveryKey === result.recovery &&
            Number.isSafeInteger(payload.epoch) &&
            payload.epoch > previousEpoch &&
            validSignature(
              result.recovery,
              "owner-recovery",
              payload,
              signature,
            ),
          "invalid entitlement continuity",
        );
        entitled = payload.newOwner;
        previousEpoch = payload.epoch;
      }
      check(entitled === challenge.buyer, "buyer entitlement");
    }
    return result;
  }
  private read(id: string) {
    return this.db
      .prepare(
        "SELECT fingerprint,buyer,recovery,result FROM purchases WHERE id=?",
      )
      .get(id) as
      | { fingerprint: string; buyer: string; recovery: string; result: string }
      | undefined;
  }
  effects() {
    return (
      this.db.prepare("SELECT COUNT(*) as n FROM purchases").get() as {
        n: number;
      }
    ).n;
  }
  close() {
    this.db.close();
  }
}
export type RecoverySigner = (
  challenge: ReturnType<MockSeller["challenge"]>,
) => string;
export const recoverySigner =
  (owner: TestSigner): RecoverySigner =>
  (challenge) =>
    owner.sign("seller-result-recovery", challenge);
export class Purchaser {
  constructor(
    readonly auth: Authority,
    readonly memory: Memory,
    readonly seller: MockSeller,
    readonly signRecovery: RecoverySigner,
  ) {}
  async buy(
    grantId: string,
    id: string,
    offer: Offer,
    proof: Proof,
  ): Promise<Operation> {
    let op = this.auth.reserve(grantId, id, offer, proof);
    if (op.submitted) return this.reconcile(id);
    // A durable owner record is required before initiating any external effect.
    this.memory.write(id, op);
    op = { ...op, submitted: true };
    this.auth.update(op);
    try {
      const outcome = this.seller.execute(id, offer, {
        grant: this.auth.authorization(grantId),
        proof,
      });
      op = {
        ...op,
        payment: "settled",
        delivery: "complete",
        result: outcome.result,
      };
    } catch {
      op = { ...op, payment: "unknown" };
    }
    this.auth.update(op);
    return this.saveResult(op);
  }
  async reconcile(id: string): Promise<Operation> {
    const op = this.auth.operation(id);
    check(op, "unknown operation");
    const challenge = this.seller.challenge(id, this.auth.ownerKey);
    const row = this.seller.status(
      challenge,
      this.signRecovery(challenge),
      this.auth.recoveryCertificates(),
    );
    if (!row) return this.saveResult({ ...op, payment: "unknown" });
    check(row.fingerprint === op.fingerprint, "reconciliation conflict");
    const updated: Operation = {
      ...op,
      payment: "settled",
      delivery: "complete",
      result: row.result,
    };
    this.auth.update(updated);
    return this.saveResult(updated);
  }
  private saveResult(op: Operation): Operation {
    try {
      const saved = { ...op, memory: "saved" as const };
      this.memory.write(op.id, saved);
      this.auth.update(saved);
      return saved;
    } catch {
      const pending = { ...op, memory: "pending" as const };
      this.auth.update(pending);
      return pending;
    }
  }
}
