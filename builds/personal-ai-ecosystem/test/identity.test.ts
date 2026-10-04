import { describe, expect, it } from "vitest";
import { updateDID } from "didwebvh-ts";
import { identityFeasibility, verifyIdentityHistory } from "../src/identity.js";
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
