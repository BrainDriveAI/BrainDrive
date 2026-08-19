import type { ModelAdapter } from "../adapters/base.js";
import { validateBriefGrounding } from "../brief-domain/grounding.js";
import { BRIEF_OUTPUT_SCHEMA_ID, BRIEF_PROMPT_POLICY_ID, BRIEF_VALIDATION_POLICY_ID, BriefGenerateOutputSchema } from "./contracts.js";
import { BRIEF_OUTPUT_SCHEMA, BRIEF_SYSTEM_POLICY } from "./broker.js";
import { BriefModelCompatibilityEntrySchema } from "./compatibility.js";
import { briefConformanceFixtures, BRIEF_MODEL_CONFORMANCE_CORPUS_DIGEST } from "./conformance-corpus.js";

export async function runBriefModelConformance(input: {
  adapter: ModelAdapter;
  providerProfileId: string;
  modelId: string;
  testedAt?: Date;
  onDiagnostic?: (diagnostic: { fixtureId: string; schemaSuccess: boolean; groundingAccepted: boolean; errorCode: string | null }) => void;
}) {
  if (!input.adapter.completeStructuredNoTools) throw new Error("Adapter lacks structured no-tools completion");
  const fixtures = briefConformanceFixtures();
  let schemaSuccesses = 0;
  let groundingSuccesses = 0;
  const latencies: number[] = [];
  for (const fixture of fixtures) {
    const startedAt = Date.now();
    let schemaSuccess = false;
    let groundingAccepted = false;
    let errorCode: string | null = null;
    try {
      const response = await input.adapter.completeStructuredNoTools({
        system: BRIEF_SYSTEM_POLICY,
        user: JSON.stringify({ source_revision_id: "73000000-0000-4000-8000-000000000001", source: fixture.source, owner_context: [] }),
        schemaName: "brief_generate_v1",
        schema: BRIEF_OUTPUT_SCHEMA,
        maxOutputTokens: 2_048,
        timeoutMs: 120_000,
      });
      if (response.finishReason !== "stop") errorCode = "incomplete_output";
      else {
        const parsed = BriefGenerateOutputSchema.safeParse(JSON.parse(response.text));
        schemaSuccess = parsed.success;
        if (!parsed.success) errorCode = "schema_validation_failed";
        else {
          groundingAccepted = validateBriefGrounding(fixture.source, parsed.data.statements).accepted && parsed.data.statements.every((statement) => statement.support.kind === "source_quote");
          if (!groundingAccepted) errorCode = "grounding_failed";
        }
      }
    } catch {
      errorCode = "provider_non_conformance";
    }
    latencies.push(Math.max(1, Date.now() - startedAt));
    if (schemaSuccess) schemaSuccesses += 1;
    if (groundingAccepted) groundingSuccesses += 1;
    input.onDiagnostic?.({ fixtureId: fixture.id, schemaSuccess, groundingAccepted, errorCode });
  }
  const schemaSuccessRate = fixtures.length === 0 ? 0 : schemaSuccesses / fixtures.length;
  const zeroUnsupportedClaimGate = fixtures.length > 0 && groundingSuccesses === fixtures.length;
  const compatible = schemaSuccessRate === 1 && zeroUnsupportedClaimGate;
  const sortedLatencies = [...latencies].sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.ceil(sortedLatencies.length * 0.95) - 1);
  const entry = BriefModelCompatibilityEntrySchema.parse({
    registry_version: 1,
    provider_profile_id: input.providerProfileId,
    model_id: input.modelId,
    purpose: "brief.generate",
    output_schema_id: BRIEF_OUTPUT_SCHEMA_ID,
    compatible,
    prompt_policy_id: BRIEF_PROMPT_POLICY_ID,
    validation_policy_id: BRIEF_VALIDATION_POLICY_ID,
    fixture_corpus_digest: BRIEF_MODEL_CONFORMANCE_CORPUS_DIGEST,
    tested_at: (input.testedAt ?? new Date()).toISOString(),
    zero_unsupported_claim_gate: zeroUnsupportedClaimGate,
    schema_success_rate: schemaSuccessRate,
    latency_p95_ms: sortedLatencies[p95Index] ?? 1,
  });
  return { registry_version: 1 as const, entries: [entry] };
}
