import { describe, expect, it, vi } from "vitest";

import type { ModelAdapter } from "../adapters/base.js";
import { BRIEF_MODEL_CONFORMANCE_CORPUS_DIGEST } from "./conformance-corpus.js";
import { BRIEF_SYSTEM_POLICY } from "./broker.js";
import { runBriefModelConformance } from "./conformance.js";

function adapter(output: (source: string) => unknown): ModelAdapter {
  return {
    complete: vi.fn(),
    completeStructuredNoTools: vi.fn(async ({ user }) => {
      const source = (JSON.parse(user) as { source: string }).source;
      return { text: JSON.stringify(output(source)), finishReason: "stop" };
    }),
  };
}

describe("Brief model conformance", () => {
  it("emits a compatible entry only for strict, source-grounded output", async () => {
    const selected = adapter((source) => ({
      title: "Atlas pilot",
      statements: [{ statement_id: crypto.randomUUID(), text: "Atlas launched in May.", support: { kind: "source_quote", quote: source.split(".")[0] } }],
    }));
    const result = await runBriefModelConformance({ adapter: selected, providerProfileId: "owner-active", modelId: "model-a", testedAt: new Date("2026-08-13T12:00:00.000Z") });
    expect(result.entries[0]).toMatchObject({
      provider_profile_id: "owner-active", model_id: "model-a", purpose: "brief.generate", compatible: true,
      fixture_corpus_digest: BRIEF_MODEL_CONFORMANCE_CORPUS_DIGEST, zero_unsupported_claim_gate: true, schema_success_rate: 1,
    });
    expect(selected.completeStructuredNoTools).toHaveBeenCalledWith(expect.objectContaining({ schemaName: "brief_generate_v1", maxOutputTokens: 2_048 }));
    expect(BRIEF_SYSTEM_POLICY).toContain("copy support.quote verbatim from one contiguous span");
  });

  it("records non-conformance without retaining raw provider output", async () => {
    const diagnostics: unknown[] = [];
    const selected = adapter(() => ({
      title: "Unsupported",
      statements: [{ statement_id: crypto.randomUUID(), text: "Revenue doubled.", support: { kind: "source_quote", quote: "Revenue doubled" } }],
    }));
    const result = await runBriefModelConformance({ adapter: selected, providerProfileId: "owner-active", modelId: "model-a", onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
    expect(result.entries[0]).toMatchObject({ compatible: false, zero_unsupported_claim_gate: false, schema_success_rate: 1 });
    expect(diagnostics).toEqual([expect.objectContaining({ groundingAccepted: false, errorCode: "grounding_failed" })]);
    expect(JSON.stringify(diagnostics)).not.toContain("Revenue doubled");
  });
});
