import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const reportUrl = new URL("./SPEC-10-ACCEPTANCE.md", import.meta.url);

function matrixRows(report: string, id: string): string[] {
  return report.split("\n").filter((line) => line.startsWith(`| ${id} |`));
}

describe("Spec 10 Milestone 6 acceptance record", () => {
  it("maps every stable requirement and gate exactly once while failing release closed", async () => {
    const report = await readFile(reportUrl, "utf8");
    const expected = [
      ...Array.from({ length: 20 }, (_, index) => `RB10-REQ-${String(index + 1).padStart(3, "0")}`),
      ...Array.from({ length: 8 }, (_, index) => `RB10-AI-${String(index + 1).padStart(3, "0")}`),
      ...Array.from({ length: 10 }, (_, index) => `RB10-UX-${String(index + 1).padStart(3, "0")}`),
      ...Array.from({ length: 6 }, (_, index) => `RB10-OBS-${String(index + 1).padStart(3, "0")}`),
      ...Array.from({ length: 12 }, (_, index) => `RB10-INV-${String(index + 1).padStart(3, "0")}`),
      "RB10-OPS-001",
      "RB10-SEC-001",
      "RB10-COMP-001",
      "RB10-DOC-001",
      ...Array.from({ length: 8 }, (_, index) => `RB10-G${index + 1}`),
    ];

    for (const id of expected) expect(matrixRows(report, id), id).toHaveLength(1);

    expect(report).toContain("Disposition: **HOLD — not release-ready**");
    expect(report).toContain("| RB10-G8 | `A1`–`A9`, `B1`–`B4`, and the scoped `D1` deployment smoke pass");
    expect(report).toContain("| `B1` | exact isolated desktop Chrome owner journey | PASS");
    expect(report).toContain("| `B2` | deterministic browser save/recovery matrix | PASS");
    expect(report).toContain("| `B3` | mobile/responsive/200% zoom browser matrix | PASS");
    expect(report).toContain("| `B4` | dense/holdout and exhaustive invalid-candidate browser matrix | PASS");
    expect(report).toContain("| `D1` | controlled dev Docker deployment smoke | PASS");
    expect(report).toContain("| `P1` | bounded live provider dense/holdout validation | FAIL");
    expect(report).toContain("| `C1` | clean immutable source revision | BLOCKED");
    expect(report).toContain("exactly 4 provider calls and an observed $0.03 spend delta");
    expect(matrixRows(report, "RB10-G1")[0]).toContain("PASS — Tier A and deterministic browser timing/loss rows pass");
    expect(matrixRows(report, "RB10-G2")[0]).toContain("PASS — Tier A and browser duplicate/all-guarded rows pass");
    expect(matrixRows(report, "RB10-G3")[0]).toContain("BLOCKED — Tier A/browser continuity and isolated Docker health/restart smoke PASS; required Docker topology/native not run");
    expect(matrixRows(report, "RB10-G4")[0]).toContain("BLOCKED — Tier A/browser/live host recovery PASS; live provider compatibility FAIL; required human evidence not run");
    expect(matrixRows(report, "RB10-G5")[0]).toContain("PASS — Tier A and complete typed invalid-candidate browser presentation pass with zero protected mutation");
    expect(matrixRows(report, "RB10-G6")[0]).toContain("BLOCKED — Tier A/browser bounded-action evidence PASS; live provider compatibility FAIL; required human evidence not run");
    expect(matrixRows(report, "RB10-G7")[0]).toContain("| PASS |");
    expect(matrixRows(report, "RB10-G8")[0]).toContain("| BLOCKED — HOLD |");
  });

  it("keeps the evidence overlay sanitized and free of release overclaim", async () => {
    const report = await readFile(reportUrl, "utf8");
    for (const prohibited of [
      /\/home\//i,
      /C:\\Users\\/i,
      /https?:\/\//i,
      /\bBearer\s+[A-Za-z0-9._-]+/i,
      /\bsk-[A-Za-z0-9_-]{8,}/i,
      /Authorization:\s*\S+/i,
    ]) expect(report).not.toMatch(prohibited);

    expect(report).not.toMatch(/^Disposition: \*\*PASS/m);
    expect(report).not.toContain("| RB10-G8 | PASS");
    expect(report).toContain("Final disposition: **HOLD — not release-ready");
  });

  it("records the exact scoped browser evidence, repair, hashes, and cleanup without broadening it", async () => {
    const report = await readFile(reportUrl, "utf8");
    expect(report).toContain("resume-builder.spec.ts:221");
    expect(report).toContain("PASS; 1 passed in 2.3 minutes");
    expect(report).toContain("PASS; 2 passed / 2 intentionally skipped in 47.9 seconds");
    expect(report).toContain("spec10-browser-recovery-matrix.json");
    expect(report).toContain("spec10-browser-inference-matrix.json");
    expect(report).toContain("29f56d39d0703ef1f0f12b42e151b86f21deaede53b175cb3ccc10cad207b0f9");
    expect(report).toContain("c5e73a6a82fea6dfadab147b82beead65e184e657c35c25ed0371411a72bdc99");
    expect(report).toContain("a1269163cbb037c1e2bcb6d43fd946314d9c6b73e120ec96b0c241926fc4051b");
    expect(report).toContain("5df5ccbce33890983661ccdb37a65f646ac27f12de06c9b7c57fb4069a374e67");
    expect(report).toContain("2bd4d136485a2a45ae2240b4c1385321003f745bc26ff809fd42b716ff3b8854");
    expect(report).toContain("039e588487ed416b7912efe701f3d71e26746982350326f0f5bec8c5e897f5bc");
    expect(report).toContain("sanitized-browser-run.json");
    expect(report).toContain("ee0c22f98caf8558e7e77681ea9ceccb41e9a6094632709fe136fe0cb4565787");
    expect(report).toContain("48dc6f3ded3e629a16fb5bf70e7483776da48004529cfe6825812959061419ad");
    expect(report).toContain("825e3381e1999681a7905d912c66f9ccebc182c4322f6956c16f4731c0de47bc");
    expect(report).toContain("raw Playwright trace was not retained");
    expect(report).toContain("Ports 8911–8913 were free");
    expect(report).toContain("29 confirmed facts, 3 jobs, 29 rendered statements, status `proposed`, and zero approvals");
    expect(report).toContain("isolated Docker app reached `healthy`");
    expect(report).toContain("fatal/unhandled/error log-pattern count was zero");
    expect(report).toContain("7b3a041aea6c4dfdf554c0d67322421637e939fbe4c80d99f6c9206132149bfd");
    expect(report).toContain("Both provider attempts exhausted into `deterministic_fallback`");
    expect(report).toContain("original manifest status is superseded by the tests-first adjudication repair");
    expect(report).toContain("915b7b2175352d6afaba4046e6c102c938ebaa93f2d01b1d8e816ecbab32f847");
    expect(report).toContain("Dense and holdout each returned `stop` and reached `deterministic_validation`");
    expect(report).toContain("Dense final provider codes were `schema_invalid`");
    expect(report).toContain("Holdout final provider codes were `schema_invalid` and `unsupported_claim`");
    expect(report).toContain("8 calls and $0.10 observed spend across two separately approved bounded runs");
    expect(report).toContain("57cc13b091b8fc02e2a17baeda1a2d0657632df54c439876e2c6046d5e50ab9f");
    expect(report).toContain("Dense attempt 1 stopped at `output_schema_validation`");
    expect(report).toContain("`role_bullet_limit_exceeded`, `statement_factual_wording_unsupported`, and `statement_section_not_ordered`");
    expect(report).toContain("Holdout attempt 2 ended `deadline_exceeded` at `provider_request`");
    expect(report).toContain("12 calls and $0.17 observed spend across three separately approved bounded runs");
    expect(report).toContain("c17460b75e53eccab5acb72621ca967b3fc3bbd37d11ad1da20b332a8ca970cf");
    expect(report).toContain("eaabc7b07a7c80810b625dd222ede58652e0ceb39ca48e9c84fe1148f8dc8caa");
    expect(report).toContain("policy 9 diagnostic used exactly 4 calls and $0.05 observed spend");
    expect(report).toContain("Dense attempt 1 failed `purpose_schema_mismatch`");
    expect(report).toContain("`statement_factual_wording_unsupported` and `substantive_role_underrepresented`");
    expect(report).toContain("Holdout received `role_bullet_limit_exceeded` on both attempts");
    expect(report).toContain("16 calls and $0.22 observed spend across four separately approved bounded runs");
    expect(report).toContain("99faeda4cdfc1e12fbb9320c7ebeb8d04d541d7901e28ca3bd8e250c72c24083");
    expect(report).toContain("5dcbd7e590235c92f22b98f806f5f7bbf946b0a2bedf5c36f7c5a0edbdc4d636");
    expect(report).toContain("policy 10 structural-envelope diagnostic used exactly 4 calls and $0.09 observed spend");
    expect(report).toContain("`statement_invalid` and `experience_role_bullet_statement_ids_invalid`");
    expect(report).toContain("`experience_role_binding_invalid`");
    expect(report).toContain("20 calls and $0.31 observed spend across five separately approved bounded runs");
    expect(report).toContain("20b0484485933dc43724633a4b81959c45ce2a706992e0f921e7855f7928d02f");
    expect(report).toContain("44a0774d0778e823ecdf1fe4a358d544a1d100eb1fcd58e648b898ce2e12e7e2");
    expect(report).toContain("policy 11 nested-role diagnostic used exactly 4 calls and $0.05 observed spend");
    expect(report).toContain("Holdout attempt 1 ended with `length`");
    expect(report).toContain("`experience_role_binding_invalid` on both dense attempts and the holdout retry");
    expect(report).toContain("24 calls and $0.36 observed spend across six separately approved bounded runs");
    expect(report).toContain("c8d6273dd02f7a622240f88bedfb0b9d3880908bca380d0cdd1726849d0e9a51");
    expect(report).toContain("b5a602e1fb4c3a592730ef687616de27186129a7071ff6dc2cf1c861e5924ed0");
    expect(report).toContain("policy 12 semantic-binding diagnostic used exactly 4 calls and $0.10 observed spend");
    expect(report).toContain("Dense received `experience_role_top_level_leakage` on both attempts");
    expect(report).toContain("Holdout received `experience_role_heading_shape_invalid` on both attempts");
    expect(report).toContain("28 calls and $0.46 observed spend across seven separately approved bounded runs");
  });
});
