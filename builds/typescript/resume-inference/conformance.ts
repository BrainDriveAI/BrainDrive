import { InferencePurposeSchema, ModelCompatibilityEntrySchema, PURPOSE_OUTPUT_SCHEMAS, type InferencePurpose } from "../app-platform/contracts/inference.js";
import type { ModelAdapter } from "../adapters/base.js";
import { buildPolicyMessages, promptPolicyIdentity, type ResumeRepairContext } from "./policy.js";
import { parsePurposeResult, purposeJsonSchema } from "./results.js";
import { validateInferenceClaims, type ValidationReport } from "./validators.js";
import { conformanceBlocks, conformanceCorpusDigest } from "./conformance-corpus.js";
import { canonicalizeStrategyResultFromBlocks } from "./strategy.js";
import { deterministicHostFallback, normalizeHostOwnedResult } from "./host-assistance.js";
import { repairResumeDraftFromConfirmedFacts } from "./repair.js";

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
    let validation: ValidationReport | null = null;
    let providerFailed = false;
    let repairContext: ResumeRepairContext | undefined;
    if (purpose === "resume_craft_evaluate") {
      const fallback = deterministicHostFallback(purpose, blocks);
      if (fallback !== null) {
        parsed = parsePurposeResult(purpose, PURPOSE_OUTPUT_SCHEMAS[purpose], fallback);
        schemaSuccess = true;
        validation = validateInferenceClaims(purpose, parsed, blocks);
      }
    }
    for (let attempt = 1; purpose !== "resume_craft_evaluate" && attempt <= 2; attempt += 1) {
      const messages = buildPolicyMessages(purpose, blocks, repairContext);
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
        if (purpose === "resume_strategy") parsed = canonicalizeStrategyResultFromBlocks(parsed, blocks);
        parsed = normalizeHostOwnedResult(purpose, parsed, blocks);
        validation = validateInferenceClaims(purpose, parsed, blocks);
        if (validation.accepted) break;
        if (attempt < 2) {
          repairContext = {
            kind: "validation",
            priorResult: parsed,
            findings: validation.findings.map(({ code, statement_id, safe_message }) => ({ code, statement_id, safe_message })),
          };
        }
      } catch {
        if (attempt < 2) repairContext = { kind: "structural" };
      }
    }
    if (!providerFailed && parsed !== undefined && validation !== null && !validation.accepted && ["general_resume_draft", "targeted_resume_draft"].includes(purpose)) {
      const repaired = repairResumeDraftFromConfirmedFacts(purpose, parsed, validation, blocks);
      if (repaired !== null) {
        const repairedResult = parsePurposeResult(purpose, PURPOSE_OUTPUT_SCHEMAS[purpose], repaired);
        const repairedValidation = validateInferenceClaims(purpose, repairedResult, blocks);
        if (repairedValidation.accepted) {
          parsed = repairedResult;
          validation = repairedValidation;
        }
      }
    }
    const validationAccepted = validation?.accepted ?? false;
    input.onDiagnostic?.({
      purpose,
      schemaSuccess,
      findings: providerFailed
        ? [{ code: "provider_non_conformance", safe_message: "The provider operation did not produce conformance evidence" }]
        : validation?.findings.map(({ code, safe_message }) => ({ code, safe_message })) ?? [],
    });
    const compatible = schemaSuccess && validationAccepted;
    const promptPolicy = promptPolicyIdentity(purpose);
    entries.push(ModelCompatibilityEntrySchema.parse({
      registry_version: 1,
      provider_profile_id: input.providerProfileId,
      model_id: input.modelId,
      purpose,
      output_schema_id: PURPOSE_OUTPUT_SCHEMAS[purpose],
      prompt_policy_id: promptPolicy.id,
      prompt_policy_version: promptPolicy.version,
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
