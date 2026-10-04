import { expect, it } from "vitest";
import { createServer, type Server } from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import {
  createDID,
  updateDID,
  resolveDID,
  deriveNextKeyHash,
} from "didwebvh-ts";
import type { DIDLog } from "didwebvh-ts/types";
import { IdentitySigner } from "../src/identity.js";
import { TestSigner, validSignature } from "../src/core.js";
async function host(tls: { key: Buffer; cert: Buffer }) {
  let log: DIDLog = [];
  const server = createServer(tls, (req, res) => {
    if (req.url === "/.well-known/did.jsonl") {
      res.writeHead(200, { "Content-Type": "application/jsonl" });
      res.end(log.map((e) => JSON.stringify(e)).join("\n"));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error("host address");
  return {
    server,
    address: "localhost:" + addr.port,
    set: (value: DIDLog) => {
      log = value;
    },
  };
}
const close = (server: Server) =>
  new Promise<void>((r, j) => {
    server.closeAllConnections();
    server.close((e) => (e ? j(e) : r()));
  });
it("private-CA HTTPS histories resolve after address migration with original host shut down", async () => {
  const root = mkdtempSync(join(tmpdir(), "identity-tls-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(root, "server.key"),
      "-out",
      join(root, "ca.pem"),
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
      "-days",
      "1",
    ],
    { stdio: "pipe" },
  );
  const tls = {
    key: readFileSync(join(root, "server.key")),
    cert: readFileSync(join(root, "ca.pem")),
  };
  const priorCAs = getCACertificates("default");
  setDefaultCACertificates([...priorCAs, tls.cert.toString()]);
  const one = await host(tls),
    two = await host(tls);
  let oneOpen = true;
  try {
    const initial = new IdentitySigner(),
      replacement = new IdentitySigner(),
      future = new IdentitySigner();
    const first = await createDID({
      address: one.address,
      signer: initial,
      verificationMethods: [
        {
          id: "#owner",
          type: "Multikey",
          publicKeyMultibase: initial.key,
          purpose: "authentication",
        },
      ],
      updateKeys: [initial.key],
      nextKeyHashes: [await deriveNextKeyHash(replacement.key)],
      portable: true,
      verifier: initial,
      created: "2026-10-04T12:00:00Z",
    });
    one.set(first.log);
    const original = await resolveDID(first.did, {
      verifier: new IdentitySigner(),
    });
    expect(original.meta.error).toBeUndefined();
    const moved = await updateDID({
      log: first.log,
      signer: replacement,
      updateKeys: [replacement.key],
      nextKeyHashes: [await deriveNextKeyHash(future.key)],
      address: two.address,
      verifier: replacement,
      updated: "2026-10-04T12:01:00Z",
    });
    two.set(moved.log);
    const recovery = new TestSigner();
    const location = {
      scid: first.meta.scid,
      did: moved.did,
      version: moved.meta.versionId,
    };
    const signature = recovery.sign("independent-location", location);
    await close(one.server);
    oneOpen = false;
    expect(
      validSignature(
        recovery.publicKey,
        "independent-location",
        location,
        signature,
      ),
    ).toBe(true);
    const independent = await resolveDID(location.did, {
      verifier: new IdentitySigner(),
    });
    expect(independent.meta.error).toBeUndefined();
    expect("scid" in independent.meta ? independent.meta.scid : null).toBe(
      location.scid,
    );
    expect(independent.did).toBe(moved.did);
    expect(location.did).not.toBe(first.did);
  } finally {
    if (oneOpen) await close(one.server);
    await close(two.server);
    setDefaultCACertificates(priorCAs);
    rmSync(root, { recursive: true, force: true });
  }
});
