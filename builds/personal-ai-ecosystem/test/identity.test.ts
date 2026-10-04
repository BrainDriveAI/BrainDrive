import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Authority, TestSigner } from "../src/core.js";
import { describe, expect, it } from "vitest";
import { updateDID, deriveNextKeyHash, resolveDIDFromLog } from "didwebvh-ts";
import {
  IdentitySigner,
  identityFeasibility,
  verifyIdentityHistory,
  verifyCurrentIdentityBinding,
} from "../src/identity.js";
describe("pinned did:webvh local-history feasibility", () => {
  it("creates, verifies, pre-rotates and moves address preserving SCID", async () => {
    const f = await identityFeasibility();
    expect(f.updated.did).not.toBe(f.created.did);
    expect(f.resolved.meta.scid).toBe(f.created.meta.scid);
    expect(f.updated.log).toHaveLength(2);
  });
  it("rejects tampered history", async () => {
    const f = await identityFeasibility();
    const corrupt = structuredClone(f.updated.log);
    corrupt[1]!.state.controller = "did:attacker";
    await expect(verifyIdentityHistory(corrupt)).rejects.toThrow();
  });
  it("old key cannot replace precommitted next key", async () => {
    const f = await identityFeasibility();
    await expect(
      updateDID({
        log: f.created.log,
        signer: f.initial,
        updateKeys: [f.initial.key],
        domain: "attacker.example",
        verifier: f.initial,
      }),
    ).rejects.toThrow();
  });
});

it("resolver rejects an old-key-signed, hash-valid forged update bypassing the honest update API", async () => {
  const f = await identityFeasibility();
  const valid = structuredClone(f.updated.log[1]!);
  const jcs = (v: unknown): string =>
    v === null || typeof v !== "object"
      ? JSON.stringify(v)
      : Array.isArray(v)
        ? "[" + v.map(jcs).join(",") + "]"
        : "{" +
          Object.keys(v)
            .sort()
            .map(
              (k) =>
                JSON.stringify(k) +
                ":" +
                jcs((v as Record<string, unknown>)[k]),
            )
            .join(",") +
          "}";
  const { proof: _proof, ...honest } = valid;
  honest.versionId = f.created.log[0]!.versionId;
  expect("2-" + (await deriveNextKeyHash(jcs(honest)))).toBe(valid.versionId);
  const forged = {
    ...honest,
    parameters: { ...honest.parameters, updateKeys: [f.initial.key] },
  };
  const document = {
    ...forged,
    versionId: "2-" + (await deriveNextKeyHash(jcs(forged))),
  };
  const template = {
    type: "DataIntegrityProof" as const,
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: f.initial.getVerificationMethodId(),
    created: document.versionTime,
    proofPurpose: "assertionMethod",
  } as const;
  const signed = await f.initial.sign({ document, proof: template });
  const log = [
    f.created.log[0]!,
    { ...document, proof: [{ ...template, proofValue: signed.proofValue }] },
  ];
  await expect(
    resolveDIDFromLog(log, { verifier: new IdentitySigner() }),
  ).rejects.toThrow("Not found in nextKeyHashes");
});

it("identity bindings use the shared owner authority version and require renewed proofs after recovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "identity-binding-")),
    owner = new TestSigner(),
    recovery = new TestSigner(),
    replacement = new TestSigner(),
    auth = new Authority(
      join(root, "auth.sqlite"),
      owner.publicKey,
      recovery.publicKey,
    );
  try {
    const f = await identityFeasibility(),
      binding = f.replacement.binding(owner, f.resolved, auth);
    expect(
      verifyCurrentIdentityBinding(binding, auth, f.resolved).authorityEpoch,
    ).toBe(0);
    auth.recover(recovery, replacement.publicKey);
    expect(() =>
      verifyCurrentIdentityBinding(binding, auth, f.resolved),
    ).toThrow("stale identity authority");
    const fresh = f.replacement.binding(replacement, f.resolved, auth);
    expect(
      verifyCurrentIdentityBinding(fresh, auth, f.resolved).authorityEpoch,
    ).toBe(1);
    expect(() =>
      verifyCurrentIdentityBinding(
        { ...fresh, authorityProof: binding.authorityProof },
        auth,
        f.resolved,
      ),
    ).toThrow("proof");
  } finally {
    auth.close();
    rmSync(root, { recursive: true, force: true });
  }
});
