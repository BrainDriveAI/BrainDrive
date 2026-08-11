import { InferencePurposeSchema, ModelCompatibilityEntrySchema, PURPOSE_OUTPUT_SCHEMAS, type InferencePurpose } from "../app-platform/contracts/inference.js";
import type { ModelAdapter } from "../adapters/base.js";
import { buildPolicyMessages, RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "./policy.js";
import { parsePurposeResult, purposeJsonSchema } from "./results.js";
import { validateInferenceClaims } from "./validators.js";
import { conformanceBlocks, conformanceCorpusDigest } from "./conformance-corpus.js";

export const RESUME_CONFORMANCE_PURPOSES = InferencePurposeSchema.options;

export async function runResumeModelConformance(input: {
  adapter: ModelAdapter;
  providerProfileId: string;
  modelId: string;
  testedAt?: Date;
  purposes?: InferencePurpose[];
  onDiagnostic?: (diagnostic: { purpose: InferencePurpose; schemaSuccess: boolean; findings: Array<{ code: string; safe_message: string }> }) => void;
}) {
  if (!input.adapter.completeStructuredNoTools) throw new Error("Adapter lacks structured no-tools completion");
  const testedAt = (input.testedAt ?? new Date()).toISOString();
  const entries: Array<ReturnType<typeof ModelCompatibilityEntrySchema.parse>> = [];
  for (const purpose of input.purposes ?? RESUME_CONFORMANCE_PURPOSES) {
    const blocks = conformanceBlocks(purpose);
    const startedAt = Date.now();
    let parsed: unknown;
    let schemaSuccess = false;
    let validationAccepted = false;
    let providerFailed = false;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const messages = buildPolicyMessages(purpose, blocks, attempt === 2 ? { kind: "structural" } : undefined);
      let response: Awaited<ReturnType<NonNullable<ModelAdapter["completeStructuredNoTools"]>>>;
      try {
        response = await input.adapter.completeStructuredNoTools({
          system: messages.system,
          user: messages.user,
          schemaName: PURPOSE_OUTPUT_SCHEMAS[purpose].replace(/[^a-zA-Z0-9_-]/g, "_"),
          schema: purposeJsonSchema(purpose),
          maxOutputTokens: 8_192,
          timeoutMs: 120_000,
        });
      } catch {
        providerFailed = true;
        break;
      }
      try {
        parsed = parsePurposeResult(purpose, PURPOSE_OUTPUT_SCHEMAS[purpose], JSON.parse(response.text));
        schemaSuccess = true;
        break;
      } catch {
        if (attempt === 2) break;
      }
    }
    const validation = schemaSuccess ? validateInferenceClaims(purpose, parsed, blocks) : null;
    if (validation) validationAccepted = validation.accepted;
    input.onDiagnostic?.({
      purpose,
      schemaSuccess,
      findings: providerFailed
        ? [{ code: "provider_non_conformance", safe_message: "The provider operation did not produce conformance evidence" }]
        : validation?.findings.map(({ code, safe_message }) => ({ code, safe_message })) ?? [],
    });
    const compatible = schemaSuccess && validationAccepted;
    entries.push(ModelCompatibilityEntrySchema.parse({
      registry_version: 1,
      provider_profile_id: input.providerProfileId,
      model_id: input.modelId,
      purpose,
      output_schema_id: PURPOSE_OUTPUT_SCHEMAS[purpose],
      prompt_policy_id: RESUME_PROMPT_POLICY_ID,
      prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
      compatible,
      fixture_corpus_digest: conformanceCorpusDigest(purpose),
      tested_at: testedAt,
      zero_unsupported_claim_gate: validationAccepted,
      schema_success_rate: schemaSuccess ? 1 : 0,
      latency_p95_ms: Math.max(1, Date.now() - startedAt),
    }));
  }
  return { registry_version: 1 as const, entries };
}
