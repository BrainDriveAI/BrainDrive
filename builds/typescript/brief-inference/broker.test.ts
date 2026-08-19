import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { BriefInferenceBroker, type BriefStructuredAdapter, type ResolvedBriefProvider } from "./broker.js";

const source = "Atlas launched in May. The pilot included twelve owner interviews.";
const input = () => ({ source_revision_id: crypto.randomUUID(), source_text: source, source_digest: canonicalInputDigest(source), owner_context: ["Owner considers the pilot promising."] });
const output = (quote = "Atlas launched in May") => ({ title: "Atlas pilot", statements: [{ statement_id: crypto.randomUUID(), text: "Atlas launched in May.", support: { kind: "source_quote", quote } }] });

function provider(result: unknown, options: { finishReason?: "stop" | "length"; pending?: boolean } = {}): ResolvedBriefProvider {
  const completeStructuredNoTools: BriefStructuredAdapter["completeStructuredNoTools"] = vi.fn(async ({ signal }) => {
    if (options.pending) return new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    return { text: JSON.stringify(result), finishReason: options.finishReason ?? "stop" };
  });
  return { providerProfileId: "owner-active", modelId: "accepted-model", compatibility: "brief_structured_no_tools_v1", adapter: { completeStructuredNoTools } };
}

describe("BriefInferenceBroker", () => {
  it("uses fixed no-tools structured execution and accepts independently grounded output", async () => {
    const selected = provider(output());
    const broker = new BriefInferenceBroker(async () => selected);
    await expect(broker.generate(input(), { operationId: crypto.randomUUID() })).resolves.toMatchObject({ title: "Atlas pilot" });
    expect(selected.adapter.completeStructuredNoTools).toHaveBeenCalledWith(expect.objectContaining({ schemaName: "brief_generate_v1", maxOutputTokens: 2048, signal: expect.any(AbortSignal) }));
    expect(JSON.stringify((selected.adapter.completeStructuredNoTools as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("provider-key");
  });

  it.each([
    ["unsupported grounding", async () => provider(output("Revenue doubled"))],
    ["strict schema", async () => provider({ title: "Missing statements", extra: true })],
    ["incompatible provider", async () => ({ ...provider(output()), compatibility: "wrong" as never })],
    ["unavailable provider", async () => { throw new Error("credential unavailable"); }],
  ])("fails closed for %s", async (_label, resolver) => {
    await expect(new BriefInferenceBroker(resolver).generate(input(), { operationId: crypto.randomUUID(), timeoutMs: 50 })).rejects.toMatchObject({ code: expect.stringMatching(/validation_failed|protocol_incompatible/) });
  });

  it("supports cancellation and timeout with bounded attempts", async () => {
    const cancellationProvider = provider(output(), { pending: true });
    const cancellationBroker = new BriefInferenceBroker(async () => cancellationProvider);
    const operationId = crypto.randomUUID();
    const running = cancellationBroker.generate(input(), { operationId, timeoutMs: 1_000 });
    await Promise.resolve();
    expect(cancellationBroker.cancel(operationId)).toBe(true);
    await expect(running).rejects.toMatchObject({ code: "cancelled" });
    const timeoutBroker = new BriefInferenceBroker(async () => provider(output(), { pending: true }));
    await expect(timeoutBroker.generate(input(), { operationId: crypto.randomUUID(), timeoutMs: 5 })).rejects.toMatchObject({ code: "cancelled" });
    const retryProvider = provider(output(), { finishReason: "length" });
    await expect(new BriefInferenceBroker(async () => retryProvider).generate(input(), { operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "validation_failed" });
    expect(retryProvider.adapter.completeStructuredNoTools).toHaveBeenCalledTimes(2);
  });

  it("enforces the byte bound and includes provider resolution in the deadline", async () => {
    const oversized = { ...input(), source_text: "é".repeat(32_768) };
    oversized.source_digest = canonicalInputDigest(oversized.source_text);
    await expect(new BriefInferenceBroker(async () => provider(output())).generate(oversized, { operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(new BriefInferenceBroker(async () => new Promise<ResolvedBriefProvider>(() => undefined)).generate(input(), { operationId: crypto.randomUUID(), timeoutMs: 5 })).rejects.toMatchObject({ code: "cancelled" });
  });

  it("enforces the conservative input-token bound before provider resolution", async () => {
    const oversized = { ...input(), source_text: "a".repeat(20_000) };
    oversized.source_digest = canonicalInputDigest(oversized.source_text);
    const resolver = vi.fn(async () => provider(output()));
    await expect(new BriefInferenceBroker(resolver).generate(oversized, { operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "invalid_input" });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("labels the deterministic corpus and human rubric evidence boundary", async () => {
    const corpus = JSON.parse(await readFile(new URL("./fixtures/corpus.json", import.meta.url), "utf8"));
    const rubric = JSON.parse(await readFile(new URL("./fixtures/evaluation-rubric.json", import.meta.url), "utf8"));
    expect(corpus.evidence_boundary).toBe("synthetic_workflow_and_contract_only");
    expect(rubric.evidence_boundary).toContain("human_review");
    expect(rubric.dimensions.map((item: { name: string }) => item.name)).toEqual(["faithful", "useful", "coherent", "clear"]);
  });
});
