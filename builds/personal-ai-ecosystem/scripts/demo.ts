import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import {
  Authority,
  Memory,
  MockSeller,
  Purchaser,
  TestSigner,
  fingerprint,
  recoverySigner,
  check,
} from "../src/core.js";
import { identityFeasibility } from "../src/identity.js";
import { MessagingKey, Messenger } from "../src/messaging.js";
import { LocalNostrRelay, publishWire, queryWire } from "../src/relay.js";
import {
  describeProvider,
  DirectoryFixture,
  Discovery,
  Trust,
} from "../src/discovery.js";
import {
  exportPackage,
  importReadableMemory,
  restoreVerifiedAuthority,
  restoreMessageHistory,
} from "../src/portability.js";

check(Number(process.versions.node.split(".")[0]) >= 24, "Node 24+ required");
const root = mkdtempSync(join(tmpdir(), "personal-ai-demo-"));
const evidence: string[] = [];
const owner = new TestSigner(),
  recovery = new TestSigner(),
  agent = new TestSigner();
owner.saveProtected(join(root, "independent-backup", "owner.pem"));
recovery.saveProtected(join(root, "independent-backup", "recovery.pem"));
const memory = new Memory(join(root, "host-one", "memory"));
let auth = new Authority(
  join(root, "host-one", "authority.sqlite"),
  owner.publicKey,
  recovery.publicKey,
);
let seller = new MockSeller(join(root, "provider", "seller.sqlite"));
const aliceKey = new MessagingKey(),
  bobKey = new MessagingKey(),
  bobOwner = new TestSigner();
aliceKey.saveProtected(join(root, "independent-backup", "alice-messaging"));
let alice = new Messenger(
  join(root, "host-one", "messages.sqlite"),
  auth,
  aliceKey,
  memory,
);
const bobMemory = new Memory(join(root, "peer", "memory"));
const bobAuthority = new Authority(
  join(root, "peer", "authority.sqlite"),
  bobOwner.publicKey,
);
const bob = new Messenger(
  join(root, "peer", "messages.sqlite"),
  bobAuthority,
  bobKey,
  bobMemory,
);
let relayOne: LocalNostrRelay | undefined;
let relayTwo: LocalNostrRelay | undefined;
let nextAuthority: Authority | undefined;
let description: ReturnType<typeof describeProvider> | undefined;
const provider = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/description") res.end(JSON.stringify(description));
  else if (req.url === "/openapi.json")
    res.end(
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Synthetic model fixture", version: "0.0.1" },
        paths: {
          "/offer": {
            get: { responses: { "200": { description: "Exact mock quote" } } },
          },
        },
      }),
    );
  else if (req.url === "/offer")
    res.end(JSON.stringify(seller.offer("synthetic fixed-price request", 25)));
  else {
    res.statusCode = 404;
    res.end("{}");
  }
});
try {
  const identity = await identityFeasibility();
  memory.write("identity", {
    did: identity.updated.did,
    log: identity.updated.log,
    verification: "local-history proof",
    binding: identity.replacement.binding(owner, identity.resolved, auth),
    dependencies: ["public HTTPS and witness behavior not established"],
  });
  evidence.push("did:webvh local pre-rotation and address continuity verified");
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  const address = provider.address();
  check(address && typeof address !== "string", "provider address");
  const origin = "http://127.0.0.1:" + address.port;
  description = describeProvider(owner, origin);
  const directories = [
    new DirectoryFixture("fixture-A", [origin + "/description"]),
    new DirectoryFixture("fixture-B", [origin + "/description"]),
  ];
  const discovery = new Discovery(memory, [origin], owner.publicKey);
  const d = await discovery.retrieve(
    directories[0]!.search("synthetic model")[0]!.address,
  );
  directories[0]!.available = false;
  await discovery.retrieve(
    directories[1]!.search("synthetic model")[0]!.address,
  );
  await discovery.retrieve(origin + "/description");
  evidence.push(
    "directory replacement and direct HTTP provider description verified",
  );
  const offer = discovery.validateOffer(
    d,
    (await (await fetch(origin + "/offer")).json()) as ReturnType<
      MockSeller["offer"]
    >,
  );
  const issue = (id: string) =>
    auth.grant(owner, {
      id,
      agent: agent.publicKey,
      audience: "mock-model",
      action: "purchase",
      fingerprint: fingerprint(offer),
      maxCost: 25,
      expiresAt: Date.now() + 60000,
    });
  issue("purchase-grant");
  issue("revoked-grant");
  auth.revoke(owner, "revoked-grant");
  issue("future-valid-grant");
  issue("uncertain-grant");
  const buyer = new Purchaser(auth, memory, seller, recoverySigner(owner));
  seller.dropNextResponse = true;
  await buyer.buy(
    "purchase-grant",
    "purchase-one",
    offer,
    auth.proof(
      agent,
      auth.challenge(
        "purchase-grant",
        "purchase-one",
        "mock-model",
        fingerprint(offer),
      ),
    ),
  );
  alice.close();
  auth.close();
  seller.close();
  auth = new Authority(
    join(root, "host-one", "authority.sqlite"),
    owner.publicKey,
    recovery.publicKey,
  );
  seller = new MockSeller(join(root, "provider", "seller.sqlite"));
  alice = new Messenger(
    join(root, "host-one", "messages.sqlite"),
    auth,
    aliceKey,
    memory,
  );
  const recovered = await new Purchaser(
    auth,
    memory,
    seller,
    recoverySigner(owner),
  ).reconcile("purchase-one");
  check(
    recovered.payment === "settled" && seller.effects() === 1,
    "duplicate-free payment recovery",
  );
  evidence.push(
    "buyer/seller restart recovered original result with exactly one mock charge",
  );
  // Durable ambiguous operation is deliberately exported and remains reserved.
  const unknown = auth.reserve(
    "uncertain-grant",
    "purchase-uncertain",
    offer,
    auth.proof(
      agent,
      auth.challenge(
        "uncertain-grant",
        "purchase-uncertain",
        "mock-model",
        fingerprint(offer),
      ),
    ),
  );
  auth.update({ ...unknown, payment: "unknown", submitted: true });
  memory.write("purchase-uncertain", {
    ...unknown,
    payment: "unknown",
    submitted: true,
  });
  alice.bind(owner, bobKey.publicKey, "did:test:bob");
  bob.bind(bobOwner, aliceKey.publicKey, identity.updated.did);
  relayOne = await LocalNostrRelay.start(join(root, "relay-one.sqlite"));
  relayTwo = await LocalNostrRelay.start(join(root, "relay-two.sqlite"));
  const firstRelay = relayOne.url,
    secondRelay = relayTwo.url;
  await relayOne.close();
  relayOne = undefined;
  alice.queue(
    alice.approve(owner, {
      id: "message-one",
      recipient: bobKey.publicKey,
      body: "Synthetic message before migration",
      sentAt: Date.now(),
    }),
  );
  await alice.sendVia("message-one", [
    (e) => publishWire(firstRelay, e),
    (e) => publishWire(secondRelay, e),
  ]);
  const wrapped = (await queryWire(secondRelay, bobKey.publicKey))[0];
  check(wrapped, "message transport");
  check(bob.receive(wrapped).newNotification, "recipient persistence");
  check(!bob.receive(wrapped).newNotification, "message deduplication");
  memory.write("selected-conversation", {
    message: "Synthetic message before migration",
    transport: "NIP-17",
    status: "peer endpoint recorded",
    humanRead: "unsupported",
  });
  evidence.push(
    "real local WebSocket NIP-17 transport, relay failover and one logical notification",
  );
  const reply = bobKey.wrap(
    aliceKey.publicKey,
    JSON.stringify({
      id: "reply-one",
      recipient: aliceKey.publicKey,
      body: "Synthetic peer reply",
      sentAt: Date.now(),
    }),
  );
  alice.receive(reply);
  new Trust(memory).retain([
    {
      kind: "provider-claim",
      source: origin,
      observedAt: Date.now(),
      evidence: d,
    },
    {
      kind: "owner-transaction",
      source: "purchase-one",
      observedAt: Date.now(),
      evidence: recovered,
    },
    {
      kind: "third-party-assessment",
      source: "fixture-review-one",
      observedAt: Date.now(),
      evidence: "positive synthetic review",
    },
    {
      kind: "third-party-assessment",
      source: "fixture-review-two",
      observedAt: Date.now(),
      evidence: "conflicting synthetic review",
    },
    {
      kind: "ai-assessment",
      source: "derived",
      observedAt: Date.now(),
      evidence: "quality remains unknown",
    },
  ]);
  const pkg = join(root, "portable-package");
  exportPackage(pkg, memory, auth, owner, alice);
  const independent = JSON.parse(
    execFileSync("python3", ["scripts/verify-package.py", pkg], {
      encoding: "utf8",
    }),
  );
  const imported = importReadableMemory(
    pkg,
    join(root, "host-two", "memory"),
    owner.publicKey,
  );
  nextAuthority = restoreVerifiedAuthority(
    pkg,
    join(root, "host-two", "authority.sqlite"),
    auth,
    owner,
  );
  auth.close();
  alice.close();
  // Original owner host is now stopped. Independent backups restore only narrow fixture signers.
  const restoredOwner = new TestSigner(
    readFileSync(join(root, "independent-backup", "owner.pem"), "utf8"),
  );
  const nextBuyer = new Purchaser(
    nextAuthority,
    imported,
    seller,
    recoverySigner(restoredOwner),
  );
  check(
    (await nextBuyer.reconcile("purchase-uncertain")).payment === "unknown",
    "uncertainty retained",
  );
  await nextBuyer.buy(
    "future-valid-grant",
    "purchase-two",
    offer,
    nextAuthority.proof(
      agent,
      nextAuthority.challenge(
        "future-valid-grant",
        "purchase-two",
        "mock-model",
        fingerprint(offer),
      ),
    ),
  );
  check(seller.effects() === 2, "fresh post-migration purchase");
  const newMessenger = new Messenger(
    join(root, "host-two", "messages.sqlite"),
    nextAuthority,
    MessagingKey.recoverProtected(
      join(root, "independent-backup", "alice-messaging"),
    ),
    imported,
  );
  restoreMessageHistory(pkg, newMessenger, owner.publicKey);
  newMessenger.bind(restoredOwner, bobKey.publicKey, "did:test:bob");
  check(
    !newMessenger.receive(reply).newNotification,
    "imported inbox deduplication",
  );
  newMessenger.queue(
    newMessenger.approve(restoredOwner, {
      id: "message-two",
      recipient: bobKey.publicKey,
      body: "Synthetic fresh post-migration message",
      sentAt: Date.now(),
    }),
  );
  await newMessenger.sendVia("message-two", [
    (e) => publishWire(secondRelay, e),
  ]);
  for (const event of await queryWire(secondRelay, bobKey.publicKey))
    bob.receive(event);
  check(bob.notifications() === 2, "fresh message and old duplicate");
  newMessenger.close();
  evidence.push(
    "original host stopped; independent secret backup plus fenced authority migration supports fresh synthetic message and mock purchase",
  );
  const report = {
    schema: 1,
    result: "local prototype demonstration passed",
    runtime: process.version,
    platform: process.platform,
    architecture: process.arch,
    root,
    checks: evidence,
    independentReader: independent,
    mockCharges: seller.effects(),
    peerNotifications: bob.notifications(),
    pendingOperation: "unknown and reserved",
    grants:
      "revoked/consumed history preserved; valid grant used after current-state verification",
    missing: [
      "public identity HTTPS/witness ecosystem proof",
      "production messaging forward secrecy/post-compromise protection",
      "real/test-fund payment rails",
      "independent live implementation and hostile-host migration",
      "product runtime integration and Factory qualification",
    ],
  };
  writeFileSync(
    join(root, "demo-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  const out = process.argv[2];
  if (out) {
    mkdirSync(resolve(out), { recursive: true });
    writeFileSync(
      join(resolve(out), "demo-report.json"),
      JSON.stringify(
        {
          ...report,
          root: "task-owned temporary fixture root (not distributed)",
        },
        null,
        2,
      ) + "\n",
    );
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  try {
    auth.close();
  } catch {}
  nextAuthority?.close();
  seller.close();
  try {
    alice.close();
  } catch {}
  bob.close();
  bobAuthority.close();
  if (relayOne) await relayOne.close();
  if (relayTwo) await relayTwo.close();
  provider.closeAllConnections();
  await new Promise<void>((r) => provider.close(() => r()));
}
