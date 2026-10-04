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
  multibaseDecode,
  MultibaseEncoding,
} from "didwebvh-ts";
import type { SigningInput, SigningOutput, DIDLog } from "didwebvh-ts/types";
import {
  Authority,
  check,
  canonical,
  TestSigner,
  validSignature,
} from "./core.js";
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
    authorityState: Authority,
  ) {
    check(
      resolved.meta.updateKeys.includes(this.key),
      "current identity control",
    );
    check(
      authorityState.ownerKey === authority.publicKey &&
        authorityState.meta().active === 1,
      "current owner authority",
    );
    const payload = {
      authorityEpoch: authorityState.meta().epoch,
      authorityId: authorityState.meta().authorityId,
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

export function verifyCurrentIdentityBinding(
  binding: ReturnType<IdentitySigner["binding"]>,
  authority: Authority,
  resolved: {
    did: string;
    meta: { scid: string; versionId: string; updateKeys: string[] };
  },
) {
  const { payload } = binding;
  const state = authority.meta();
  check(
    state.active === 1 &&
      authority.statusAvailable &&
      Date.now() - authority.statusObservedAt < 60000,
    "current authority unavailable",
  );
  check(
    payload.authorityKey === state.owner &&
      payload.authorityEpoch === state.epoch &&
      payload.authorityId === state.authorityId,
    "stale identity authority",
  );
  check(
    payload.did === resolved.did &&
      payload.scid === resolved.meta.scid &&
      payload.version === resolved.meta.versionId &&
      resolved.meta.updateKeys.includes(payload.identityKey),
    "stale identity history",
  );
  const raw = multibaseDecode(payload.identityKey).bytes;
  check(
    raw.length === 34 && raw[0] === 0xed && raw[1] === 0x01,
    "identity key type",
  );
  const publicKey = createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: Buffer.from(raw.subarray(2)).toString("base64url"),
    },
    format: "jwk",
  })
    .export({ type: "spki", format: "pem" })
    .toString();
  check(
    validSignature(
      publicKey,
      "identity-authority-binding",
      payload,
      binding.identityProof,
    ) &&
      validSignature(
        state.owner,
        "identity-authority-accept",
        payload,
        binding.authorityProof,
      ),
    "identity binding proof",
  );
  return payload;
}
