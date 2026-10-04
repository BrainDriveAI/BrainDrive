import {
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  AbstractCrypto,
  createDID,
  updateDID,
  resolveDIDFromLog,
  deriveNextKeyHash,
  prepareDataForSigning,
  multibaseEncode,
  MultibaseEncoding,
} from "didwebvh-ts";
import type { SigningInput, SigningOutput, DIDLog } from "didwebvh-ts/types";
import { check, canonical, TestSigner, validSignature } from "./core.js";
/** Independent test fixture signer. Owner administration only, never an agent tool. */
export class IdentitySigner extends AbstractCrypto {
  #private: KeyObject;
  readonly key: string;
  readonly publicKeyPem: string;
  constructor() {
    const pair = generateKeyPairSync("ed25519");
    const jwk = pair.publicKey.export({ format: "jwk" });
    check(jwk.x, "Ed25519 x");
    const key = multibaseEncode(
      Buffer.concat([
        Buffer.from([0xed, 0x01]),
        Buffer.from(jwk.x, "base64url"),
      ]),
      MultibaseEncoding.BASE58_BTC,
    );
    super({
      verificationMethod: {
        id: "did:key:" + key + "#" + key,
        type: "Multikey",
        publicKeyMultibase: key,
      },
      useStaticId: true,
    });
    this.#private = pair.privateKey;
    this.key = key;
    this.publicKeyPem = pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
  }
  binding(
    authority: TestSigner,
    resolved: {
      did: string;
      meta: { scid: string; versionId: string; updateKeys: string[] };
    },
  ) {
    check(
      resolved.meta.updateKeys.includes(this.key),
      "current identity control",
    );
    const payload = {
      did: resolved.did,
      scid: resolved.meta.scid,
      version: resolved.meta.versionId,
      identityKey: this.key,
      authorityKey: authority.publicKey,
    };
    const identityProof = sign(
      null,
      Buffer.from("identity-authority-binding\n" + canonical(payload)),
      this.#private,
    ).toString("base64");
    const authorityProof = authority.sign("identity-authority-accept", payload);
    check(
      validSignature(
        this.publicKeyPem,
        "identity-authority-binding",
        payload,
        identityProof,
      ) &&
        validSignature(
          authority.publicKey,
          "identity-authority-accept",
          payload,
          authorityProof,
        ),
      "identity binding proof",
    );
    return {
      payload,
      identityProof,
      authorityProof,
      verification: "locally verified current-control binding",
      externalIdentity: "not established",
    };
  }
  async sign(input: SigningInput): Promise<SigningOutput> {
    const data = await prepareDataForSigning(input.document, input.proof);
    return {
      proofValue: multibaseEncode(
        sign(null, data, this.#private),
        MultibaseEncoding.BASE58_BTC,
      ),
    };
  }
  async verify(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
  ): Promise<boolean> {
    try {
      const raw = publicKey.length === 34 ? publicKey.subarray(2) : publicKey;
      const key = createPublicKey({
        key: {
          kty: "OKP",
          crv: "Ed25519",
          x: Buffer.from(raw).toString("base64url"),
        },
        format: "jwk",
      });
      return verify(null, message, key, signature);
    } catch {
      return false;
    }
  }
}
export async function identityFeasibility() {
  const initial = new IdentitySigner(),
    replacement = new IdentitySigner(),
    future = new IdentitySigner();
  const created = await createDID({
    domain: "owner-one.example",
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
  const first = await resolveDIDFromLog(created.log, { verifier: initial });
  check(!first.meta.error, "initial identity verification");
  const updated = await updateDID({
    log: created.log,
    signer: replacement,
    updateKeys: [replacement.key],
    nextKeyHashes: [await deriveNextKeyHash(future.key)],
    domain: "owner-two.example",
    updated: "2026-10-04T12:01:00Z",
    verifier: replacement,
  });
  const resolved = await resolveDIDFromLog(updated.log, {
    verifier: new IdentitySigner(),
  });
  check(!resolved.meta.error, "updated identity verification");
  check(resolved.meta.scid === first.meta.scid, "SCID continuity");
  check(resolved.meta.updateKeys.includes(replacement.key), "rotation key");
  return { created, updated, resolved, initial, replacement, future };
}
export async function verifyIdentityHistory(log: DIDLog) {
  const result = await resolveDIDFromLog(log, {
    verifier: new IdentitySigner(),
  });
  check(!result.meta.error, "invalid identity history");
  return result;
}
